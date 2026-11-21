import { parseDecimal, decimalToString, type ExactDecimal } from './exactDecimal';

/**
 * Historical bolivar denomination periods. The factor is the number of
 * current (post-2021) bolivars represented by one unit of that period.
 * Values are never silently mutated; conversions are explicit and date-based.
 */
export const VENEZUELAN_MONETARY_PERIODS = [
  { id: 'BOLIVAR_ORIGINAL', label: 'Bolívar anterior a 2008', startsOn: '1900-01-01', endsBefore: '2008-01-01', currentExponent: 14 },
  { id: 'BOLIVAR_FUERTE', label: 'Bolívar Fuerte (Bs.F)', startsOn: '2008-01-01', endsBefore: '2018-08-20', currentExponent: 11 },
  { id: 'BOLIVAR_SOBERANO', label: 'Bolívar Soberano (Bs.S)', startsOn: '2018-08-20', endsBefore: '2021-10-01', currentExponent: 6 },
  { id: 'BOLIVAR_CURRENT', label: 'Bolívar vigente desde 01-10-2021', startsOn: '2021-10-01', endsBefore: null, currentExponent: 0 }
] as const;

export type VenezuelanMonetaryPeriodId = typeof VENEZUELAN_MONETARY_PERIODS[number]['id'];
export interface VenezuelanMonetaryPeriod {
  id: VenezuelanMonetaryPeriodId;
  label: string;
  startsOn: string;
  endsBefore: string | null;
  currentExponent: number;
}

function validateIsoDate(date: string): void {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) throw new Error('La fecha monetaria debe tener formato AAAA-MM-DD.');
  const parsed = new Date(date + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new Error('La fecha monetaria no es válida.');
}

export function getVenezuelanMonetaryPeriod(date: string): VenezuelanMonetaryPeriod {
  validateIsoDate(date);
  const period = [...VENEZUELAN_MONETARY_PERIODS].reverse().find(item => date >= item.startsOn);
  if (!period) throw new Error('No hay escala monetaria venezolana definida para la fecha solicitada.');
  return period;
}

/** Returns a precise scale factor as an integer string (never a floating-point number). */
export function getCurrentBolivarFactor(date: string): string {
  return '1' + '0'.repeat(getVenezuelanMonetaryPeriod(date).currentExponent);
}

/**
 * Shifts a base-10 decimal by a power of ten without binary floating point.
 * Positive shifts multiply; negative shifts add decimal places.
 */
function shiftDecimal(value: string | number | bigint, exponent: number): ExactDecimal {
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 1000) throw new Error('El cambio de escala está fuera del rango permitido.');
  const parsed = parseDecimal(value);
  if (exponent >= 0) return { coefficient: parsed.coefficient * (10n ** BigInt(exponent)), scale: parsed.scale };
  return { coefficient: parsed.coefficient, scale: parsed.scale + -exponent };
}

/** Convert an amount recorded in its operation-date denomination to today's VES scale. */
export function normalizeBolivarAmountToCurrent(amount: string | number | bigint, operationDate: string): string {
  const period = getVenezuelanMonetaryPeriod(operationDate);
  return decimalToString(shiftDecimal(amount, -period.currentExponent));
}

/** Convert a current-scale VES amount to the nominal denomination of a historical date. */
export function expressCurrentBolivarAmountAtDate(amount: string | number | bigint, targetDate: string): string {
  const period = getVenezuelanMonetaryPeriod(targetDate);
  return decimalToString(shiftDecimal(amount, period.currentExponent));
}

/** Convert between historical denominations using effective dates; preserves exact decimal value. */
export function convertBolivarAmountBetweenDates(
  amount: string | number | bigint,
  fromDate: string,
  toDate: string
): string {
  const from = getVenezuelanMonetaryPeriod(fromDate);
  const to = getVenezuelanMonetaryPeriod(toDate);
  return decimalToString(shiftDecimal(amount, to.currentExponent - from.currentExponent));
}

/** Human-readable historical denomination metadata for document/report annotations. */
export function getBolivarScaleMetadata(date: string): {
  periodId: VenezuelanMonetaryPeriodId;
  label: string;
  currentFactor: string;
  effectiveDate: string;
} {
  const period = getVenezuelanMonetaryPeriod(date);
  return { periodId: period.id, label: period.label, currentFactor: getCurrentBolivarFactor(date), effectiveDate: period.startsOn };
}
