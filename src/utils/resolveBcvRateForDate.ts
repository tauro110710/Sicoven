import type { AccountingBcvRateHistoryEntry } from '../types/accounting';

const isValidIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Devuelve la entrada del historial contable vigente para una fecha: la más
 * reciente cuya fecha efectiva sea igual o anterior. No inventa tasas.
 */
export function resolveBcvRateEntryForDate(
  history: AccountingBcvRateHistoryEntry[] | null | undefined,
  effectiveDate: string
): AccountingBcvRateHistoryEntry | undefined {
  if (!Array.isArray(history) || !isValidIsoDate(effectiveDate)) return undefined;
  let best: AccountingBcvRateHistoryEntry | undefined;
  for (const entry of history) {
    if (!entry || !isValidIsoDate(entry.effectiveDate) || entry.effectiveDate > effectiveDate) continue;
    const rate = Number(entry.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!best || entry.effectiveDate >= best.effectiveDate) best = entry;
  }
  return best;
}

/** Returns the latest saved rate whose effective date is not later than the requested date. */
export function resolveBcvRateForDate(
  history: AccountingBcvRateHistoryEntry[] | null | undefined,
  effectiveDate: string
): number | undefined {
  return resolveBcvRateEntryForDate(history, effectiveDate)?.rate;
}
