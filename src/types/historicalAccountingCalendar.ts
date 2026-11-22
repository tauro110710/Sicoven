export type VenezuelanMonetaryEraId =
  | 'BOLIVAR_ORIGINAL'
  | 'BOLIVAR_FUERTE'
  | 'BOLIVAR_SOBERANO'
  | 'BOLIVAR_DIGITAL';

export interface VenezuelanMonetaryEra {
  id: VenezuelanMonetaryEraId;
  label: string;
  effectiveFrom: string;
  /** Decimal powers removed from the original bolivar scale to reach this era. */
  cumulativeScaleExponent: number;
  legalReference: string;
}

export const VENEZUELAN_MONETARY_ERAS: readonly VenezuelanMonetaryEra[] = [
  {
    id: 'BOLIVAR_ORIGINAL',
    label: 'Bolívar anterior a 2008',
    effectiveFrom: '1900-01-01',
    cumulativeScaleExponent: 14,
    legalReference: 'Decreto-Ley de Reconversión Monetaria de 2007; vigencia 2008-01-01'
  },
  {
    id: 'BOLIVAR_FUERTE',
    label: 'Bolívar Fuerte (Bs.F)',
    effectiveFrom: '2008-01-01',
    cumulativeScaleExponent: 11,
    legalReference: 'Primera reconversión: 1.000 bolívares anteriores = 1 Bs.F'
  },
  {
    id: 'BOLIVAR_SOBERANO',
    label: 'Bolívar Soberano (Bs.S)',
    effectiveFrom: '2018-08-20',
    cumulativeScaleExponent: 6,
    legalReference: 'Decreto N° 3.548; G.O. N° 41.446; vigencia efectiva 2018-08-20'
  },
  {
    id: 'BOLIVAR_DIGITAL',
    label: 'Bolívar Digital (Bs.)',
    effectiveFrom: '2021-10-01',
    cumulativeScaleExponent: 0,
    legalReference: 'Decreto N° 4.553; G.O. N° 42.185; vigencia 2021-10-01'
  }
] as const;

export interface HistoricalFiscalExercise {
  id: string;
  companyId: string;
  fiscalYear: number;
  startDate: string;
  endDate: string;
  status: 'ABIERTO' | 'EN_CIERRE' | 'CERRADO';
}

export interface BuildHistoricalFiscalExercisesInput {
  companyId: string;
  operationalStartDate: string;
  throughDate: string;
  closedThroughDate?: string | null;
  closingFiscalYears?: number[];
}

/** Builds calendar-year exercises from the company's real start date, with no fixed minimum year. */
export function buildHistoricalFiscalExercises(
  input: BuildHistoricalFiscalExercisesInput
): HistoricalFiscalExercise[] {
  const { companyId, operationalStartDate, throughDate } = input;
  if (!companyId.trim()) throw new Error('Debe indicar la empresa para generar sus ejercicios.');
  if (!isValidIsoDate(operationalStartDate) || !isValidIsoDate(throughDate) ||
      operationalStartDate > throughDate) {
    throw new Error('La fecha de inicio de operaciones y la fecha final deben ser válidas y cronológicas.');
  }
  const closedThroughDate = input.closedThroughDate || '';
  if (closedThroughDate && !isValidIsoDate(closedThroughDate)) {
    throw new Error('La fecha de cierre contable de la empresa no es válida.');
  }
  const closingYears = new Set(input.closingFiscalYears || []);
  const startYear = Number(operationalStartDate.slice(0, 4));
  const endYear = Number(throughDate.slice(0, 4));
  const exercises: HistoricalFiscalExercise[] = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const startDate = year === startYear ? operationalStartDate : year + '-01-01';
    const endDate = year === endYear ? throughDate : year + '-12-31';
    const status = closedThroughDate && endDate <= closedThroughDate
      ? 'CERRADO'
      : closingYears.has(year)
        ? 'EN_CIERRE'
        : 'ABIERTO';
    exercises.push({
      id: companyId + ':' + year,
      companyId,
      fiscalYear: year,
      startDate,
      endDate,
      status
    });
  }
  return exercises;
}

export function getVenezuelanMonetaryEra(date: string): VenezuelanMonetaryEra {
  if (!isValidIsoDate(date)) throw new Error('La fecha de la operación no es válida para determinar su escala monetaria.');
  let selected = VENEZUELAN_MONETARY_ERAS[0];
  for (const era of VENEZUELAN_MONETARY_ERAS) {
    if (date >= era.effectiveFrom) selected = era;
    else break;
  }
  return selected;
}

/**
 * Converts a historical nominal amount between bolivar eras without rounding.
 * Decimal strings are used internally so large 2015-era amounts do not lose integer precision.
 * Rounding belongs only to the applicable presentation/payment rule, never to source evidence.
 */
function expandDecimalExponent(raw: string): string {
  const match = raw.match(/^(-?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
  if (!match || !match[4]) return raw;
  const sign = match[1];
  const whole = match[2];
  const fraction = match[3] || '';
  const digits = whole + fraction;
  const point = whole.length + Number(match[4]);
  if (!Number.isInteger(point) || Math.abs(point) > 10000) return raw;
  if (point <= 0) return sign + '0.' + '0'.repeat(-point) + digits;
  if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length);
  return sign + digits.slice(0, point) + '.' + digits.slice(point);
}

export function convertVenezuelanAmount(
  amount: string | number,
  fromEraId: VenezuelanMonetaryEraId,
  toEraId: VenezuelanMonetaryEraId
): string {
  const source = VENEZUELAN_MONETARY_ERAS.find(era => era.id === fromEraId);
  const target = VENEZUELAN_MONETARY_ERAS.find(era => era.id === toEraId);
  if (!source || !target) throw new Error('La escala monetaria de origen o destino no está reconocida.');
  const raw = expandDecimalExponent(String(amount).trim());
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error('El importe debe ser un número decimal válido.');
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  let coefficient = BigInt((whole + fraction).replace(/^0+(?=\d)/, '') || '0');
  let decimalPlaces = fraction.length;
  const exponentShift = source.cumulativeScaleExponent - target.cumulativeScaleExponent;
  if (exponentShift > 0) decimalPlaces += exponentShift;
  if (exponentShift < 0) coefficient *= 10n ** BigInt(-exponentShift);
  let digits = coefficient.toString();
  if (decimalPlaces > 0) {
    digits = digits.padStart(decimalPlaces + 1, '0');
    const split = digits.length - decimalPlaces;
    digits = digits.slice(0, split) + '.' + digits.slice(split);
  }
  const [resultWhole, resultFraction = ''] = digits.split('.');
  const normalizedWhole = resultWhole.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = resultFraction.replace(/0+$/, '');
  const result = normalizedFraction ? normalizedWhole + '.' + normalizedFraction : normalizedWhole;
  return negative && result !== '0' ? '-' + result : result;
}

/** Normalize historical bolivar values to the current scale for comparative reports, without changing originals. */
export function normalizeVenezuelanAmountToCurrentScale(amount: string | number, effectiveDate: string): string {
  return convertVenezuelanAmount(amount, getVenezuelanMonetaryEra(effectiveDate).id, 'BOLIVAR_DIGITAL');
}


export function roundHistoricalPresentationAmount(amount: string | number, decimalPlaces = 2): string {
  if (!Number.isInteger(decimalPlaces) || decimalPlaces < 0 || decimalPlaces > 12) {
    throw new Error('La precisión de presentación debe estar entre 0 y 12 decimales.');
  }
  const raw = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error('El importe debe ser un número decimal válido.');
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole, fraction = ''] = unsigned.split('.');
  let rounded: bigint;
  if (fraction.length > decimalPlaces) {
    const kept = whole + fraction.slice(0, decimalPlaces);
    const nextDigit = Number(fraction[decimalPlaces]);
    rounded = BigInt(kept || '0') + (nextDigit >= 5 ? 1n : 0n);
  } else {
    rounded = BigInt(whole + fraction.padEnd(decimalPlaces, '0'));
  }
  const digits = rounded.toString().padStart(decimalPlaces + 1, '0');
  const formatted = decimalPlaces === 0
    ? digits
    : digits.slice(0, -decimalPlaces) + '.' + digits.slice(-decimalPlaces);
  return negative && rounded !== 0n ? '-' + formatted : formatted;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
