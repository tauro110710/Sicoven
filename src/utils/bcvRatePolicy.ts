import { isValidIsoCalendarDate } from './isoDateValidation';

/**
 * BCV rates may be entered manually for any historical date, but SICOVEN must
 * never force a BCV rate for transactions dated before 2018-01-01.
 * The accountant decides whether a historical USD equivalence is needed.
 */
export const BCV_REQUIRED_FROM_DATE = '2018-01-01';

export function isBcvRateRequiredForDate(date: unknown): boolean {
  return isValidIsoCalendarDate(date) && date >= BCV_REQUIRED_FROM_DATE;
}
