export interface HistoricalBcvRate {
  id: string;
  rate: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  source?: string;
  /** DATE = rate applies to a specific effective date; PERIOD = interval. */
  scope: 'DATE' | 'PERIOD';
}

export interface ResolvedBcvRate {
  rate: number;
  effectiveFrom: string;
  effectiveThrough?: string;
  source?: string;
  id: string;
}

/** Resolve only an explicit valid historical rate; never silently fall back to today's rate. */
export function resolveBcvRateForDate(
  effectiveDate: string,
  rates: HistoricalBcvRate[]
): ResolvedBcvRate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !Number.isFinite(Date.parse(effectiveDate))) return null;
  const valid = rates.filter(item =>
    Number.isFinite(item.rate) && item.rate > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.effectiveFrom) &&
    (!item.effectiveThrough || /^\d{4}-\d{2}-\d{2}$/.test(item.effectiveThrough)) &&
    item.effectiveFrom <= effectiveDate &&
    (!item.effectiveThrough || item.effectiveThrough >= effectiveDate)
  );
  if (!valid.length) return null;
  // Prefer the most specific/latest effective entry when overlapping intervals exist.
  valid.sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) ||
    (a.scope === 'DATE' ? -1 : 1) - (b.scope === 'DATE' ? -1 : 1));
  const selected = valid[0];
  return { rate: selected.rate, effectiveFrom: selected.effectiveFrom,
    effectiveThrough: selected.effectiveThrough, source: selected.source, id: selected.id };
}

/** Safe Bs/USD equivalence: null means no rate exists and USD must remain pending. */
export function convertBsToUsd(amountBs: number, rate: number | null | undefined): number | null {
  if (!Number.isFinite(amountBs) || amountBs < 0 || !Number.isFinite(rate) || !(Number(rate) > 0)) return null;
  return amountBs / Number(rate);
}
