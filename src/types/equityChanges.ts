import type { Account, JournalEntry } from './accounting';
import { getReportScaleDate, reexpressReportAmount, roundReportCents, roundReportMicroUsd } from './reportMonetaryReexpression';

export interface EquityChangeRow {
  accountCode: string;
  accountName: string;
  openingBs: number;
  openingUsd: number;
  movementBs: number;
  movementUsd: number;
  closingBs: number;
  closingUsd: number;
  isUnclassifiedResult?: boolean;
}

export interface EquityChangeMovement {
  entryId: string;
  entryNumber: number;
  date: string;
  type: string;
  description: string;
  referenceDoc?: string;
  accountCode: string;
  accountName: string;
  debitBs: number;
  creditBs: number;
  debitUsd: number;
  creditUsd: number;
  netBs: number;
  netUsd: number;
}

export interface EquityChangesReport {
  year: number;
  openingEntryId?: string;
  rows: EquityChangeRow[];
  movements: EquityChangeMovement[];
  openingTotalBs: number;
  openingTotalUsd: number;
  movementTotalBs: number;
  movementTotalUsd: number;
  periodResultBs: number;
  periodResultUsd: number;
  closingTotalBs: number;
  closingTotalUsd: number;
  resultTransferredToEquity: boolean;
}

const amount = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const key = (code: string) => code;
const emptyRow = (accountCode: string, accountName: string): EquityChangeRow => ({
  accountCode, accountName, openingBs: 0, openingUsd: 0,
  movementBs: 0, movementUsd: 0, closingBs: 0, closingUsd: 0
});
const isProfitLoss = (account: Account | undefined) =>
  account?.type === 'INGRESOS' || account?.type === 'COSTOS' || account?.type === 'GASTOS';
/**
 * Resultado de un conjunto de asientos con el redondeo por cuenta del asiento
 * de cierre: cada cuenta nominal aporta su neto en centavos (millonésimas de
 * USD) antes de sumar, para que el estado de cambios coincida al centavo con
 * el resultado contabilizado.
 */
const signedProfitLoss = (entries: JournalEntry[], accountsByCode: Map<string, Account>, reportScaleDate: string) => {
  const byAccount = new Map<string, { bs: number; usd: number }>();
  for (const entry of entries) {
    for (const item of entry.items) {
      if (!isProfitLoss(accountsByCode.get(item.accountCode))) continue;
      const current = byAccount.get(item.accountCode) || { bs: 0, usd: 0 };
      current.bs += reexpressReportAmount(item.creditBs, entry.date, reportScaleDate) -
        reexpressReportAmount(item.debitBs, entry.date, reportScaleDate);
      current.usd += amount(item.creditUsd) - amount(item.debitUsd);
      byAccount.set(item.accountCode, current);
    }
  }
  let bs = 0;
  let usd = 0;
  for (const value of byAccount.values()) {
    bs += roundReportCents(value.bs);
    usd += roundReportMicroUsd(value.usd);
  }
  return { bs: roundReportCents(bs), usd: roundReportMicroUsd(usd) };
};

/**
 * Builds a traceable equity roll-forward from posted ledger entries only.
 * It never infers dividends, contributions, reserves or other labels from
 * descriptions; movements remain linked to their source journal entry. Annual
 * openings are recognized only through exerciseLink, never by APERTURA type alone.
 */
export function buildEquityChangesReport(
  entries: JournalEntry[],
  accounts: Account[],
  companyId: string,
  year: number,
  /** Escala monetaria del reporte; por defecto, el último día del ejercicio. */
  reportScaleDate: string = getReportScaleDate(year)
): EquityChangesReport {
  if (!companyId.trim() || !Number.isInteger(year) || year < 1) {
    throw new Error('La empresa y el ejercicio seleccionado deben ser válidos.');
  }
  const start = String(year).padStart(4, '0') + '-01-01';
  const end = String(year).padStart(4, '0') + '-12-31';
  const companyEntries = entries
    .filter(entry => entry.companyId === companyId && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber);
  const accountsByCode = new Map(accounts.map(account => [account.code, account] as const));
  const equityAccounts = accounts.filter(account => account.isMovement && account.type === 'PATRIMONIO');
  const equityCodes = new Set(equityAccounts.map(account => account.code));
  const annualOpenings = companyEntries.filter(entry =>
    entry.type === 'APERTURA' &&
    entry.exerciseLink?.nextPeriodStartDate?.slice(0, 4) === String(year)
  );
  const openingEntry = annualOpenings.at(-1);
  const rows = new Map<string, EquityChangeRow>();
  for (const account of equityAccounts) rows.set(key(account.code), emptyRow(account.code, account.name));

  const addOpening = (code: string, name: string, bs: number, usd: number) => {
    const row = rows.get(key(code)) || emptyRow(code, name);
    row.openingBs += bs;
    row.openingUsd += usd;
    rows.set(key(code), row);
  };
  const addMovement = (code: string, name: string, bs: number, usd: number) => {
    const row = rows.get(key(code)) || emptyRow(code, name);
    row.movementBs += bs;
    row.movementUsd += usd;
    rows.set(key(code), row);
  };

  if (openingEntry) {
    for (const item of openingEntry.items) {
      if (!equityCodes.has(item.accountCode)) continue;
      const account = accountsByCode.get(item.accountCode);
      addOpening(item.accountCode, account?.name || item.accountName,
        reexpressReportAmount(item.creditBs, openingEntry.date, reportScaleDate) -
          reexpressReportAmount(item.debitBs, openingEntry.date, reportScaleDate),
        amount(item.creditUsd) - amount(item.debitUsd));
    }
  } else {
    for (const entry of companyEntries.filter(item => item.date < start)) {
      for (const item of entry.items) {
        if (!equityCodes.has(item.accountCode)) continue;
        const account = accountsByCode.get(item.accountCode);
        addOpening(item.accountCode, account?.name || item.accountName,
          reexpressReportAmount(item.creditBs, entry.date, reportScaleDate) -
            reexpressReportAmount(item.debitBs, entry.date, reportScaleDate),
          amount(item.creditUsd) - amount(item.debitUsd));
      }
    }
    const priorClosings = companyEntries.filter(entry => entry.date < start && entry.type === 'CIERRE' &&
      entry.items.some(item => equityCodes.has(item.accountCode)) &&
      entry.items.some(item => isProfitLoss(accountsByCode.get(item.accountCode))));
    const lastPriorClosing = priorClosings.at(-1)?.date || '';
    const priorResult = signedProfitLoss(
      companyEntries.filter(entry => entry.date < start && entry.date > lastPriorClosing && entry.type !== 'CIERRE' && entry.type !== 'APERTURA'),
      accountsByCode,
      reportScaleDate
    );
    if (Math.abs(priorResult.bs) > 0.005 || Math.abs(priorResult.usd) > 0.0000005) {
      addOpening('RESULTADOS-ACUMULADOS', 'Resultados acumulados no transferidos', priorResult.bs, priorResult.usd);
    }
  }

  const movements: EquityChangeMovement[] = [];
  const periodEntries = companyEntries.filter(entry => entry.date >= start);
  const periodClosingEntries = periodEntries.filter(entry => entry.type === 'CIERRE' &&
    entry.items.some(item => equityCodes.has(item.accountCode)) &&
    entry.items.some(item => isProfitLoss(accountsByCode.get(item.accountCode))));
  const resultTransferredToEquity = periodClosingEntries.length > 0;

  for (const entry of periodEntries) {
    if (entry.type === 'APERTURA' && entry.exerciseLink?.nextPeriodStartDate) continue;
    for (const item of entry.items) {
      if (!equityCodes.has(item.accountCode)) continue;
      const account = accountsByCode.get(item.accountCode);
      const debitBs = reexpressReportAmount(item.debitBs, entry.date, reportScaleDate);
      const creditBs = reexpressReportAmount(item.creditBs, entry.date, reportScaleDate);
      const debitUsd = amount(item.debitUsd), creditUsd = amount(item.creditUsd);
      const netBs = creditBs - debitBs, netUsd = creditUsd - debitUsd;
      addMovement(item.accountCode, account?.name || item.accountName, netBs, netUsd);
      movements.push({
        entryId: entry.id, entryNumber: entry.entryNumber, date: entry.date,
        type: entry.type, description: item.description || entry.description,
        referenceDoc: entry.referenceDoc, accountCode: item.accountCode,
        accountName: account?.name || item.accountName,
        debitBs, creditBs, debitUsd, creditUsd, netBs, netUsd
      });
    }
  }

  let periodResultBs = 0, periodResultUsd = 0;
  if (!resultTransferredToEquity) {
    const periodResult = signedProfitLoss(
      periodEntries.filter(item => item.type !== 'CIERRE' && item.type !== 'APERTURA'),
      accountsByCode,
      reportScaleDate
    );
    periodResultBs = periodResult.bs;
    periodResultUsd = periodResult.usd;
    if (Math.abs(periodResultBs) > 0.005 || Math.abs(periodResultUsd) > 0.0000005) {
      addMovement('RESULTADO-EJERCICIO', 'Resultado neto del ejercicio', periodResultBs, periodResultUsd);
      const resultRow = rows.get('RESULTADO-EJERCICIO')!;
      resultRow.isUnclassifiedResult = true;
    }
  }

  for (const row of rows.values()) {
    row.closingBs = row.openingBs + row.movementBs;
    row.closingUsd = row.openingUsd + row.movementUsd;
  }
  const values = [...rows.values()];
  const total = (field: 'openingBs' | 'openingUsd' | 'movementBs' | 'movementUsd' | 'closingBs' | 'closingUsd') =>
    values.reduce((sum, row) => sum + row[field], 0);
  return {
    year, openingEntryId: openingEntry?.id, rows: values.filter(row =>
      [row.openingBs, row.openingUsd, row.movementBs, row.movementUsd].some(value => Math.abs(value) > 0.0000005)
    ),
    movements,
    openingTotalBs: total('openingBs'), openingTotalUsd: total('openingUsd'),
    movementTotalBs: total('movementBs'), movementTotalUsd: total('movementUsd'),
    periodResultBs, periodResultUsd,
    closingTotalBs: total('closingBs'), closingTotalUsd: total('closingUsd'),
    resultTransferredToEquity
  };
}
