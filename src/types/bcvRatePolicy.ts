export const BCV_RATE_ENFORCEMENT_START_DATE = '2018-09-07';
export type BcvRateRequirement = 'NOT_APPLICABLE' | 'OPTIONAL' | 'REQUIRED' | 'INVALID_DATE' | 'INVALID_POLICY';
export interface BcvRatePolicyPeriod {
  effectiveFrom: string;
  effectiveTo?: string;
  requirement: 'OPTIONAL' | 'REQUIRED';
}
export const DEFAULT_BCV_RATE_POLICY: readonly BcvRatePolicyPeriod[] = [
  { effectiveFrom: BCV_RATE_ENFORCEMENT_START_DATE, requirement: 'REQUIRED' }
];

/**
 * Policy gate for BCV capture on ordinary transactions.
 * Bs-only transactions never need an FX rate. A caller may supply explicit,
 * date-ranged policy periods; the default keeps the existing threshold until
 * a company-level policy is configured and reviewed.
 */
export function getBcvRateRequirement(
  transactionDate: string,
  needsCurrencyConversion: boolean,
  policy: readonly BcvRatePolicyPeriod[] = DEFAULT_BCV_RATE_POLICY
): BcvRateRequirement {
  if (!isValidIsoDate(transactionDate)) return 'INVALID_DATE';
  if (!needsCurrencyConversion) return 'NOT_APPLICABLE';
  if (!Array.isArray(policy) || policy.some(period =>
    !period || !isValidIsoDate(period.effectiveFrom) ||
    (period.effectiveTo !== undefined && (!isValidIsoDate(period.effectiveTo) || period.effectiveTo < period.effectiveFrom)) ||
    !['OPTIONAL', 'REQUIRED'].includes(period.requirement)
  )) return 'INVALID_POLICY';
  const ordered = [...policy].sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom));
  for (let i=1;i<ordered.length;i+=1) {
    const previous = ordered[i-1];
    if (!previous.effectiveTo || previous.effectiveTo >= ordered[i].effectiveFrom) return 'INVALID_POLICY';
  }
  const matching = ordered.filter(period => period.effectiveFrom <= transactionDate && (!period.effectiveTo || transactionDate <= period.effectiveTo));
  if (matching.length > 1) return 'INVALID_POLICY';
  return matching[0]?.requirement || 'OPTIONAL';
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
