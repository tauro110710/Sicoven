export const BCV_RATE_ENFORCEMENT_START_DATE = '2018-09-07';

export type BcvRateRequirement = 'NOT_APPLICABLE' | 'OPTIONAL' | 'REQUIRED' | 'INVALID_DATE';

/**
 * Policy gate for BCV-rate capture on ordinary transactions.
 * A Bs-only transaction never needs a rate. For transactions needing foreign-currency
 * equivalence, BCV capture is mandatory from 2018-09-07; before that date it is
 * optional as requested, and missing equivalence must remain absent (never zero).
 */
export function getBcvRateRequirement(transactionDate: string, needsCurrencyConversion: boolean): BcvRateRequirement {
  if (!isValidIsoDate(transactionDate)) return 'INVALID_DATE';
  if (!needsCurrencyConversion) return 'NOT_APPLICABLE';
  return transactionDate >= BCV_RATE_ENFORCEMENT_START_DATE ? 'REQUIRED' : 'OPTIONAL';
}


function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
