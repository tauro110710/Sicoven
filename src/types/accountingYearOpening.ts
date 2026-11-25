import type { Account, JournalEntry, JournalEntryItem } from './accounting';
import { isJournalEntryBalanced } from './journalEntryValidation';
import { convertVenezuelanAmountBetweenDates } from './historicalAccountingCalendar';

export interface OpeningEntryBuildInput {
  companyId: string;
  periodStartDate: string;
  periodEndDate: string;
  openingDate: string;
  accounts: Account[];
  journalEntries: JournalEntry[];
  retainedEarningsAccountCode?: string;
}

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const roundBs = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundUsd = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
type Totals = { debitBs: number; creditBs: number; debitUsd: number; creditUsd: number };
const emptyTotals = (): Totals => ({ debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });

/**
 * La reexpresión de escala y el redondeo por línea pueden dejar residuos de un
 * centavo de bolívar o de una millonésima de dólar. Se absorben en el renglón
 * de mayor importe para no bloquear una apertura que económicamente cuadra;
 * un descuadre mayor al centavo sigue informándose como error real.
 */
function absorbRoundingResidue(
  items: JournalEntryItem[],
  debitKey: 'debitBs' | 'debitUsd',
  creditKey: 'creditBs' | 'creditUsd',
  unit: number
): void {
  const sum = (key: 'debitBs' | 'debitUsd' | 'creditBs' | 'creditUsd') =>
    items.reduce((total, item) => total + Number(item[key] || 0), 0);
  const residual = Math.round((sum(debitKey) - sum(creditKey)) / unit) * unit;
  if (Math.abs(residual) < unit || Math.abs(residual) > 0.01) return;
  const creditLine = [...items]
    .filter(item => Number(item[creditKey]) > 0)
    .sort((a, b) => Number(b[creditKey]) - Number(a[creditKey]))[0];
  if (creditLine) {
    const adjusted = Math.round((Number(creditLine[creditKey]) + residual) / unit) * unit;
    if (adjusted >= 0) {
      creditLine[creditKey] = Number(adjusted.toFixed(unit === 0.01 ? 2 : 6));
      return;
    }
  }
  const debitLine = [...items]
    .filter(item => Number(item[debitKey]) > 0)
    .sort((a, b) => Number(b[debitKey]) - Number(a[debitKey]))[0];
  if (!debitLine) return;
  const adjusted = Math.round((Number(debitLine[debitKey]) - residual) / unit) * unit;
  if (adjusted >= 0) debitLine[debitKey] = Number(adjusted.toFixed(unit === 0.01 ? 2 : 6));
}

/** Prepares an APERTURA draft only; it never persists or posts accounting data. */
export function buildOpeningEntryItems(input: OpeningEntryBuildInput): JournalEntryItem[] {
  const { companyId, periodEndDate, openingDate, accounts, journalEntries } = input;
  if (!companyId.trim()) throw new Error('Debe indicar la empresa del ejercicio.');
  if (!isIsoDate(input.periodStartDate) || !isIsoDate(periodEndDate) || !isIsoDate(openingDate) ||
      input.periodStartDate > periodEndDate || openingDate <= periodEndDate) {
    throw new Error('Las fechas de cierre y apertura deben ser válidas y mantener el orden cronológico.');
  }

  const accountByCode = new Map<string, Account>();
  for (const account of accounts) {
    if (accountByCode.has(account.code)) throw new Error('El catálogo contiene códigos de cuenta duplicados.');
    accountByCode.set(account.code, account);
  }
  if (journalEntries.some(entry => entry.companyId === companyId &&
      entry.type === 'APERTURA' && entry.date === openingDate &&
      !entry.reversedByEntryId && entry.isAdjusted !== true)) {
    throw new Error('Ya existe un asiento de apertura vigente para esta empresa y fecha.');
  }

  const balances = new Map<string, Totals>();
  const profitLoss = { bs: 0, usd: 0 };
  const companyLedger = journalEntries.filter(entry => entry.companyId === companyId);
  for (const entry of companyLedger) {
    if (!isIsoDate(entry.date)) {
      throw new Error('El asiento #' + entry.entryNumber + ' contiene una fecha inválida; no se puede preparar la apertura.');
    }
  }
  const companyHistory = companyLedger.filter(entry => entry.date <= periodEndDate);
  // Only reversals effective on or before the closing date can change
  // the balances being carried forward. Later reversals must not rewrite history.
  const reversedEntryIds = new Set(companyHistory
    .filter(entry => entry.reversalOfEntryId)
    .map(entry => entry.reversalOfEntryId as string));
  // A linked annual opening is the authoritative carry-forward snapshot.
  // Earlier ledger activity is already represented in that opening and must
  // not be added again when preparing the next exercise.
  const latestAnnualOpening = companyHistory
    .filter(entry => entry.type === 'APERTURA' &&
      entry.exerciseLink?.nextPeriodStartDate === entry.date &&
      entry.exerciseLink.nextPeriodStartDate <= input.periodStartDate &&
      isIsoDate(entry.exerciseLink.nextPeriodStartDate) &&
      !reversedEntryIds.has(entry.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber)
    .at(-1);
  const priorEntries = latestAnnualOpening
    ? companyHistory.filter(entry => entry.date >= latestAnnualOpening.date)
    : companyHistory;

  for (const entry of priorEntries) {
    const totals = emptyTotals();
    if (!Array.isArray(entry.items) || entry.items.length < 2) {
      throw new Error('El asiento #' + entry.entryNumber + ' no contiene líneas contables suficientes.');
    }
    for (const line of entry.items) {
      const account = accountByCode.get(line.accountCode);
      if (!account || !account.isMovement) {
        throw new Error('El asiento #' + entry.entryNumber + ' utiliza una cuenta inexistente o no imputable: ' + line.accountCode + '.');
      }
      const values = [line.debitBs, line.creditBs, line.debitUsd, line.creditUsd].map(Number);
      if (values.some(value => !Number.isFinite(value) || value < 0) ||
          (Number(line.debitBs) > 0 && Number(line.creditBs) > 0) ||
          (Number(line.debitUsd) > 0 && Number(line.creditUsd) > 0)) {
        throw new Error('El asiento #' + entry.entryNumber + ' contiene importes inválidos.');
      }
      totals.debitBs += Number(line.debitBs);
      totals.creditBs += Number(line.creditBs);
      totals.debitUsd += Number(line.debitUsd);
      totals.creditUsd += Number(line.creditUsd);

      if (account.type === 'INGRESOS') {
        if (entry.date >= input.periodStartDate) {
          profitLoss.bs += Number(convertVenezuelanAmountBetweenDates(String(Number(line.creditBs) - Number(line.debitBs)), entry.date, openingDate));
          profitLoss.usd += Number(line.creditUsd) - Number(line.debitUsd);
        }
      } else if (account.type === 'COSTOS' || account.type === 'GASTOS') {
        if (entry.date >= input.periodStartDate) {
          // Costs and expenses reduce the period result (income less expenses).
          profitLoss.bs += Number(convertVenezuelanAmountBetweenDates(String(Number(line.creditBs) - Number(line.debitBs)), entry.date, openingDate));
          profitLoss.usd += Number(line.creditUsd) - Number(line.debitUsd);
        }
      } else {
        const current = balances.get(account.code) || emptyTotals();
        current.debitBs += Number(convertVenezuelanAmountBetweenDates(String(line.debitBs), entry.date, openingDate));
        current.creditBs += Number(convertVenezuelanAmountBetweenDates(String(line.creditBs), entry.date, openingDate));
        current.debitUsd += Number(line.debitUsd);
        current.creditUsd += Number(line.creditUsd);
        balances.set(account.code, current);
      }
    }
    if (!isJournalEntryBalanced(totals)) {
      throw new Error('El asiento #' + entry.entryNumber + ' no cuadra en ambas monedas; no se puede preparar la apertura.');
    }
  }

  const resultBs = roundBs(profitLoss.bs);
  const resultUsd = roundUsd(profitLoss.usd);
  if (Math.abs(resultBs) > 0.01 || Math.abs(resultUsd) > 0.000001) {
    const retained = input.retainedEarningsAccountCode
      ? accountByCode.get(input.retainedEarningsAccountCode)
      : undefined;
    if (!retained || retained.type !== 'PATRIMONIO' || !retained.isMovement) {
      throw new Error('Seleccione una cuenta imputable de patrimonio para trasladar el resultado acumulado del ejercicio.');
    }
    const current = balances.get(retained.code) || emptyTotals();
    if (resultBs >= 0) current.creditBs += resultBs;
    else current.debitBs += Math.abs(resultBs);
    if (resultUsd >= 0) current.creditUsd += resultUsd;
    else current.debitUsd += Math.abs(resultUsd);
    balances.set(retained.code, current);
  }

  const items: JournalEntryItem[] = [];
  for (const [code, totals] of balances) {
    const account = accountByCode.get(code)!;
    const netBs = totals.debitBs - totals.creditBs;
    const netUsd = totals.debitUsd - totals.creditUsd;
    // The signed ledger balance already determines the side: debit minus credit.
    // Do not invert credit-nature accounts; their negative net is a credit balance.
    const debitBs = roundBs(Math.max(0, netBs));
    const creditBs = roundBs(Math.max(0, -netBs));
    const debitUsd = roundUsd(Math.max(0, netUsd));
    const creditUsd = roundUsd(Math.max(0, -netUsd));
    if (debitBs || creditBs || debitUsd || creditUsd) {
      items.push({
        accountCode: code, accountName: account.name, debitBs, creditBs, debitUsd, creditUsd,
        description: 'Saldo de apertura trasladado al ' + openingDate
      });
    }
  }
  if (items.length < 2) throw new Error('No existen saldos de balance suficientes para generar un asiento de apertura.');
  absorbRoundingResidue(items, 'debitBs', 'creditBs', 0.01);
  absorbRoundingResidue(items, 'debitUsd', 'creditUsd', 0.000001);
  const total = items.reduce((sum, item) => ({
    debitBs: sum.debitBs + item.debitBs, creditBs: sum.creditBs + item.creditBs,
    debitUsd: sum.debitUsd + item.debitUsd, creditUsd: sum.creditUsd + item.creditUsd
  }), emptyTotals());
  if (!isJournalEntryBalanced(total)) {
    throw new Error('Los saldos históricos no cuadran en ambas monedas (Bs debe ' + total.debitBs + ', Bs haber ' + total.creditBs + ', USD debe ' + total.debitUsd + ', USD haber ' + total.creditUsd + '). Regularice el balance antes de abrir el ejercicio.');
  }
  return items;
}
