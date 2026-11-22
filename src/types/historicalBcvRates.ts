export interface HistoricalBcvRate {
  id: string;
  rate: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  source?: string;
  /** DATE = applies only on effectiveFrom; PERIOD = inclusive date interval. */
  scope: 'DATE' | 'PERIOD';
}

export interface ResolvedBcvRate {
  rate: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  source?: string;
  id: string;
}

/** Strict calendar-date validation (rejects rollover dates such as February 30). */
export function isValidHistoricalRateDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Resolve only explicit valid historical rates; never fall back to today's rate. */
export function resolveBcvRateForDate(
  effectiveDate: string,
  rates: HistoricalBcvRate[]
): ResolvedBcvRate | null {
  if (!isValidHistoricalRateDate(effectiveDate)) return null;
  const valid = rates.filter(item => {
    if (!Number.isFinite(item.rate) || item.rate <= 0 || !isValidHistoricalRateDate(item.effectiveFrom)) return false;
    if (item.scope === 'DATE') return item.effectiveFrom === effectiveDate && (!item.effectiveThrough || item.effectiveThrough === effectiveDate);
    if (item.scope !== 'PERIOD' || !item.effectiveThrough || !isValidHistoricalRateDate(item.effectiveThrough)) return false;
    return item.effectiveFrom <= effectiveDate && item.effectiveThrough >= effectiveDate && item.effectiveThrough >= item.effectiveFrom;
  });
  if (!valid.length) return null;
  // Exact-date records win over periods; among records of the same kind, prefer the latest start.
  valid.sort((a, b) => {
    const scopePriority = (a.scope === 'DATE' ? 0 : 1) - (b.scope === 'DATE' ? 0 : 1);
    return scopePriority || b.effectiveFrom.localeCompare(a.effectiveFrom) ||
      (a.effectiveThrough || '').localeCompare(b.effectiveThrough || '') || a.id.localeCompare(b.id);
  });
  const selected = valid[0];
  return {
    rate: selected.rate,
    effectiveFrom: selected.effectiveFrom,
    effectiveThrough: selected.effectiveThrough,
    source: selected.source,
    id: selected.id
  };
}

/** Safe Bs/USD equivalence: null means no valid historical rate and USD stays pending. */
export function convertBsToUsd(amountBs: number, rate: number | null | undefined): number | null {
  if (!Number.isFinite(amountBs) || amountBs < 0 || !Number.isFinite(rate) || !(Number(rate) > 0)) return null;
  return amountBs / Number(rate);
}
