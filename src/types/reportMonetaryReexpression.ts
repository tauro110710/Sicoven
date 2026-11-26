import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import { isValidIsoCalendarDate } from '../utils/isoDateValidation';
import type { Account, JournalEntry } from './accounting';
import { getUnclosedResultContribution, hasAccountMovement } from './accountingReportIntegrity';

/**
 * Política monetaria única de los reportes contables.
 *
 * Todo reporte (Balance de Comprobación, Balance Ajustado, Balance General,
 * Estado de Resultados, Estado de Cambios en el Patrimonio, Flujo de Efectivo y
 * anexos) presenta los bolívares en la escala vigente en la fecha del reporte.
 * Cada línea se reexpresa desde la fecha contable del asiento que la originó con
 * `reexpressAmountBetweenDates`, el mecanismo central del sistema (fronteras
 * 2008-01-01, 2018-08-20 y 2021-10-01).
 *
 * Reglas:
 * - El USD de origen nunca se convierte ni se reconstruye con tasas actuales:
 *   se conserva tal como fue registrado y se acumula en columna separada.
 * - No se reescriben asientos ni documentos: la reexpresión es solo de
 *   presentación.
 * - Un reporte nunca mezcla escalas: si una fecha contable no es válida, falla
 *   de forma explícita.
 * - Todos los reportes de un mismo período comparten la misma fecha de escala.
 */

/**
 * Centavos, con la misma regla de redondeo que el asiento de cierre
 * (`accountingYearClosing`). Los reportes de resultado la aplican por cuenta
 * antes de sumar para reproducir exactamente el resultado contabilizado.
 */
export const roundReportCents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Millonésimas de USD, con la misma regla que el asiento de cierre. */
export const roundReportMicroUsd = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

/** Fecha de escala de un ejercicio fiscal: su último día. */
export function getReportScaleDate(fiscalYear: number): string {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9999) {
    throw new Error('El ejercicio del reporte no es válido para determinar su escala monetaria.');
  }
  return String(fiscalYear).padStart(4, '0') + '-12-31';
}

function assertReportDate(date: string, label: string): string {
  if (!isValidIsoCalendarDate(date)) {
    throw new Error(label + ' no es una fecha contable válida para expresar el reporte.');
  }
  return date;
}

/**
 * Reexpresa un importe en bolívares desde la fecha contable del asiento hasta la
 * escala del reporte. Devuelve el valor exacto de la conversión central.
 */
export function reexpressReportAmount(
  amount: number | string | null | undefined,
  entryDate: string,
  reportDate: string
): number {
  const value = Number(amount ?? 0);
  if (!Number.isFinite(value)) {
    throw new Error('El reporte contiene un importe en bolívares que no es un número válido.');
  }
  if (value === 0) return 0;
  const source = assertReportDate(entryDate, 'La fecha del asiento');
  const target = assertReportDate(reportDate, 'La fecha del reporte');
  if (source === target) return value;
  const converted = Number(reexpressAmountBetweenDates(value, source, target));
  if (!Number.isFinite(converted)) {
    throw new Error('La reexpresión monetaria del reporte produjo un importe no válido.');
  }
  return converted;
}

/** Variante con aritmética decimal exacta, para agregados históricos de gran magnitud. */
export function reexpressReportAmountExact(
  amount: number | string | null | undefined,
  entryDate: string,
  reportDate: string
): string {
  const raw = String(amount ?? '0').trim() || '0';
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error('El reporte contiene un importe en bolívares que no es un número válido.');
  }
  if (value === 0) return '0';
  const source = assertReportDate(entryDate, 'La fecha del asiento');
  const target = assertReportDate(reportDate, 'La fecha del reporte');
  if (source === target) return raw;
  return reexpressAmountBetweenDates(raw, source, target);
}

export interface ReportMovementTotals {
  debitBs: number;
  creditBs: number;
  debitUsd: number;
  creditUsd: number;
}

const emptyTotals = (): ReportMovementTotals => ({ debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });

/** Acumula una línea contable reexpresando su Bs. y conservando su USD original. */
export function accumulateReportLine(
  totals: ReportMovementTotals,
  line: { debitBs?: number; creditBs?: number; debitUsd?: number; creditUsd?: number },
  entryDate: string,
  reportDate: string
): ReportMovementTotals {
  totals.debitBs += reexpressReportAmount(line.debitBs, entryDate, reportDate);
  totals.creditBs += reexpressReportAmount(line.creditBs, entryDate, reportDate);
  totals.debitUsd += Number(line.debitUsd || 0);
  totals.creditUsd += Number(line.creditUsd || 0);
  return totals;
}

/**
 * Movimientos por cuenta de un conjunto de asientos, todos expresados en la
 * escala del reporte. Es el único acumulador que deben usar los reportes.
 */
export function buildReportMovementsByAccount(
  entries: ReadonlyArray<Pick<JournalEntry, 'date' | 'items'>>,
  reportDate: string
): Map<string, ReportMovementTotals> {
  const target = assertReportDate(reportDate, 'La fecha del reporte');
  const byAccount = new Map<string, ReportMovementTotals>();
  for (const entry of entries) {
    assertReportDate(entry.date, 'La fecha del asiento');
    if (entry.date > target) {
      throw new Error('El reporte no puede acumular el asiento del ' + entry.date + ': es posterior a su fecha de cierre (' + target + ').');
    }
    for (const line of entry.items) {
      const totals = byAccount.get(line.accountCode) || emptyTotals();
      accumulateReportLine(totals, line, entry.date, target);
      byAccount.set(line.accountCode, totals);
    }
  }
  return byAccount;
}

/** Signo del saldo normal: +1 deudor (activo, costo, gasto), -1 acreedor. */
export function getNormalBalanceSign(accountType: string | undefined): 1 | -1 {
  return accountType === 'INGRESOS' || accountType === 'PASIVO' || accountType === 'PATRIMONIO' ? -1 : 1;
}

/** Saldo de una cuenta en su naturaleza normal, a partir de movimientos ya homogéneos. */
export function getNormalBalance(type: string | undefined, debitBs: number, creditBs: number): number {
  return getNormalBalanceSign(type) === 1 ? debitBs - creditBs : creditBs - debitBs;
}

export interface ReportAccountRow extends ReportMovementTotals {
  code: string;
  name: string;
  type: string;
  level: number;
  isMovement: boolean;
  /** Sumas del debe y haber (regulares + ajustes), ya reexpresadas. */
  totalDebitBs: number;
  totalCreditBs: number;
  totalDebitUsd: number;
  totalCreditUsd: number;
  /** Movimientos sin ajustes. */
  unadjustedDebitBs: number;
  unadjustedCreditBs: number;
  unadjustedDebitUsd: number;
  unadjustedCreditUsd: number;
  /** Asientos de ajuste. */
  adjDebitBs: number;
  adjCreditBs: number;
  adjDebitUsd: number;
  adjCreditUsd: number;
  /** Saldo final de la hoja de trabajo. */
  adjustedDebitBs: number;
  adjustedCreditBs: number;
  adjustedDebitUsd: number;
  adjustedCreditUsd: number;
  hasMovement: boolean;
}

/**
 * Hoja de trabajo del Balance de Comprobación: separa movimientos regulares y
 * ajustes, ambos reexpresados a la escala del reporte antes de sumar.
 */
export function buildTrialBalanceRows(
  accounts: ReadonlyArray<Account>,
  regularEntries: ReadonlyArray<Pick<JournalEntry, 'date' | 'items'>>,
  adjustmentEntries: ReadonlyArray<Pick<JournalEntry, 'date' | 'items'>>,
  reportDate: string
): ReportAccountRow[] {
  const regular = buildReportMovementsByAccount(regularEntries, reportDate);
  const adjustments = buildReportMovementsByAccount(adjustmentEntries, reportDate);
  return accounts.map(account => {
    const reg = regular.get(account.code) || emptyTotals();
    const adj = adjustments.get(account.code) || emptyTotals();
    const totalDebitBs = reg.debitBs + adj.debitBs;
    const totalCreditBs = reg.creditBs + adj.creditBs;
    const totalDebitUsd = reg.debitUsd + adj.debitUsd;
    const totalCreditUsd = reg.creditUsd + adj.creditUsd;
    const regNetBs = reg.debitBs - reg.creditBs;
    const regNetUsd = reg.debitUsd - reg.creditUsd;
    const adjNetBs = totalDebitBs - totalCreditBs;
    const adjNetUsd = totalDebitUsd - totalCreditUsd;
    return {
      code: account.code,
      name: account.name,
      type: account.type,
      level: account.level,
      isMovement: account.isMovement,
      debitBs: totalDebitBs,
      creditBs: totalCreditBs,
      debitUsd: totalDebitUsd,
      creditUsd: totalCreditUsd,
      totalDebitBs,
      totalCreditBs,
      totalDebitUsd,
      totalCreditUsd,
      unadjustedDebitBs: regNetBs > 0 ? regNetBs : 0,
      unadjustedCreditBs: regNetBs < 0 ? Math.abs(regNetBs) : 0,
      unadjustedDebitUsd: regNetUsd > 0 ? regNetUsd : 0,
      unadjustedCreditUsd: regNetUsd < 0 ? Math.abs(regNetUsd) : 0,
      adjDebitBs: adj.debitBs,
      adjCreditBs: adj.creditBs,
      adjDebitUsd: adj.debitUsd,
      adjCreditUsd: adj.creditUsd,
      adjustedDebitBs: adjNetBs > 0 ? adjNetBs : 0,
      adjustedCreditBs: adjNetBs < 0 ? Math.abs(adjNetBs) : 0,
      adjustedDebitUsd: adjNetUsd > 0 ? adjNetUsd : 0,
      adjustedCreditUsd: adjNetUsd < 0 ? Math.abs(adjNetUsd) : 0,
      hasMovement: hasAccountMovement({ debitBs: totalDebitBs, creditBs: totalCreditBs, debitUsd: totalDebitUsd, creditUsd: totalCreditUsd })
    };
  });
}

export interface ResultAccountRow {
  code: string;
  name: string;
  type: string;
  level: number;
  isMovement: boolean;
  adjustedDebitBs: number;
  adjustedCreditBs: number;
  adjustedDebitUsd: number;
  adjustedCreditUsd: number;
  hasMovement: boolean;
}

/** Cuentas de resultado del ejercicio, en la escala del reporte. */
export function buildIncomeStatementRows(
  accounts: ReadonlyArray<Account>,
  resultEntries: ReadonlyArray<Pick<JournalEntry, 'date' | 'items'>>,
  reportDate: string
): ResultAccountRow[] {
  const movements = buildReportMovementsByAccount(resultEntries, reportDate);
  return accounts.map(account => {
    const totals = movements.get(account.code) || emptyTotals();
    // El asiento de cierre redondea el neto de cada cuenta antes de sumar;
    // el Estado de Resultados sigue ese mismo criterio.
    const netBs = roundReportCents(totals.debitBs - totals.creditBs);
    const netUsd = roundReportMicroUsd(totals.debitUsd - totals.creditUsd);
    return {
      code: account.code,
      name: account.name,
      type: account.type,
      level: account.level,
      isMovement: account.isMovement,
      adjustedDebitBs: netBs > 0 ? netBs : 0,
      adjustedCreditBs: netBs < 0 ? Math.abs(netBs) : 0,
      adjustedDebitUsd: netUsd > 0 ? netUsd : 0,
      adjustedCreditUsd: netUsd < 0 ? Math.abs(netUsd) : 0,
      hasMovement: hasAccountMovement({ debitBs: totals.debitBs, creditBs: totals.creditBs, debitUsd: totals.debitUsd, creditUsd: totals.creditUsd })
    };
  });
}

/**
 * Resultado del ejercicio aún no transferido por cierre, reexpresado a la
 * escala del reporte. Es el contrapeso del Balance General: se acumula sin
 * redondear por cuenta para conservar la ecuación patrimonial (ver la nota
 * dentro de la función).
 */
export function getUnclosedResultAtReportDate(
  entries: ReadonlyArray<Pick<JournalEntry, 'date' | 'type' | 'items'>>,
  accounts: ReadonlyArray<Pick<Account, 'code' | 'type'>>,
  reportDate: string
): { bs: number; usd: number } {
  const accountTypeByCode = new Map(accounts.map(account => [account.code, account.type] as const));
  const isProfitLoss = (code: string) => ['INGRESOS', 'COSTOS', 'GASTOS'].includes(accountTypeByCode.get(code) || '');
  const resultClosingEntries = entries.filter(entry =>
    entry.type === 'CIERRE' &&
    entry.items.some(item => accountTypeByCode.get(item.accountCode) === 'PATRIMONIO') &&
    entry.items.some(item => isProfitLoss(item.accountCode))
  );
  const latestClosingDate = resultClosingEntries.reduce(
    (latest, entry) => (entry.date > latest ? entry.date : latest),
    ''
  );
  const target = assertReportDate(reportDate, 'La fecha del reporte');
  // A propósito NO se redondea por cuenta: este resultado es el contrapeso del
  // Balance General y debe conservar Activo = Pasivo + Patrimonio sobre los
  // saldos reexpresados. Redondear cada cuenta (como hace el asiento de
  // cierre) acumula hasta medio centavo por cuenta y puede descuadrar el
  // balance cuando hay fracciones de centavo. El Estado de Resultados, el
  // estado de cambios y el cierre sí redondean porque reproducen el asiento.
  return entries
    .filter(entry => !latestClosingDate || entry.date > latestClosingDate)
    .reduce((result, entry) => {
      assertReportDate(entry.date, 'La fecha del asiento');
      if (entry.date > target) {
        throw new Error('El resultado del ejercicio no puede incluir el asiento del ' + entry.date + ': es posterior al cierre del reporte.');
      }
      for (const item of entry.items) {
        const accountType = accountTypeByCode.get(item.accountCode);
        if (!['INGRESOS', 'COSTOS', 'GASTOS'].includes(accountType || '')) continue;
        const contribution = getUnclosedResultContribution(
          accountType,
          reexpressReportAmount(item.debitBs, entry.date, reportDate),
          reexpressReportAmount(item.creditBs, entry.date, reportDate),
          Number(item.debitUsd || 0),
          Number(item.creditUsd || 0)
        );
        result.bs += contribution.bs;
        result.usd += contribution.usd;
      }
      return result;
    }, { bs: 0, usd: 0 });
}
