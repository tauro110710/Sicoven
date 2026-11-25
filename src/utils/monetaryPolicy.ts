import {
  VENEZUELAN_MONETARY_ERAS,
  convertVenezuelanAmountBetweenDates,
  getVenezuelanMonetaryEra,
  normalizeVenezuelanAmountToCurrentScale,
  type VenezuelanMonetaryEraId
} from '../types/historicalAccountingCalendar';
import { BCV_REQUIRED_FROM_DATE, isBcvRateRequiredForDate } from './bcvRatePolicy';
import { isValidIsoCalendarDate } from './isoDateValidation';
import { formatUsd } from './formatters';

/**
 * Regla monetaria única de SICOVEN.
 *
 * Toda pantalla, modal, reporte o cálculo debe resolver la escala y la
 * obligatoriedad de la tasa BCV con `getReglaMonetariaPorFecha(fechaOperacion)`.
 * La fecha que manda es la fecha contable del documento, nunca la fecha en que
 * se digita ni la fecha de registro en el sistema.
 *
 * Reglas:
 * - Antes de 2018-01-01 no se exige tasa BCV y no se admiten campos USD.
 * - Desde 2018-01-01 la tasa BCV es obligatoria y los campos USD se habilitan.
 * - La escala de bolívares se determina por la fecha efectiva de cada
 *   reconversión (2008-01-01, 2018-08-20 y 2021-10-01).
 */

export const USD_SUPPORT_FROM_DATE = BCV_REQUIRED_FROM_DATE;

export interface MonetaryRule {
  /** Fecha contable evaluada, en formato YYYY-MM-DD. */
  date: string;
  /** false cuando la fecha está vacía o no es una fecha de calendario real. */
  isValidDate: boolean;
  eraId: VenezuelanMonetaryEraId | null;
  eraLabel: string;
  /** Denominación que debe mostrarse al contador: Bs.F, Bs.S o Bs. */
  currencyLabel: string;
  /** Potencia de diez que debe dividirse para llevar el monto a la escala vigente. */
  scaleExponent: number;
  /** true solo desde 2018-01-01. */
  requiresBcvRate: boolean;
  /** true solo desde 2018-01-01: habilita campo y columnas en USD. */
  allowsUsd: boolean;
}

const ERA_CURRENCY_LABELS: Record<VenezuelanMonetaryEraId, string> = {
  BOLIVAR_ORIGINAL: 'Bs. (VEB)',
  BOLIVAR_FUERTE: 'Bs.F',
  BOLIVAR_SOBERANO: 'Bs.S',
  BOLIVAR_DIGITAL: 'Bs.'
};

const INVALID_RULE: MonetaryRule = {
  date: '',
  isValidDate: false,
  eraId: null,
  eraLabel: 'Fecha contable no válida',
  currencyLabel: 'Bs.',
  scaleExponent: 0,
  requiresBcvRate: false,
  allowsUsd: false
};

/**
 * Resuelve la regla monetaria de una fecha contable. Es tolerante a entradas
 * vacías o inválidas para poder usarse directamente en formularios; en ese caso
 * devuelve una regla inerte que no exige BCV ni habilita USD.
 */
export function getReglaMonetariaPorFecha(fecha: string | null | undefined): MonetaryRule {
  if (!isValidIsoCalendarDate(fecha)) return { ...INVALID_RULE };
  const era = getVenezuelanMonetaryEra(fecha);
  const requiresBcvRate = isBcvRateRequiredForDate(fecha);
  return {
    date: fecha,
    isValidDate: true,
    eraId: era.id,
    eraLabel: era.label,
    currencyLabel: ERA_CURRENCY_LABELS[era.id],
    scaleExponent: era.cumulativeScaleExponent,
    requiresBcvRate,
    allowsUsd: requiresBcvRate
  };
}

/** Atajo: ¿la operación de esa fecha debe mostrar y exigir tasa BCV? */
export function requiresBcvRateForOperationDate(fecha: string | null | undefined): boolean {
  return getReglaMonetariaPorFecha(fecha).requiresBcvRate;
}

/** Atajo: ¿la operación de esa fecha admite registro o presentación en USD? */
export function allowsUsdForOperationDate(fecha: string | null | undefined): boolean {
  return getReglaMonetariaPorFecha(fecha).allowsUsd;
}

/**
 * Formatea un equivalente USD solo si la fecha contable admite USD.
 * Antes de 2018 devuelve "-" y nunca calcula ni muestra una conversión.
 */
export function formatUsdForDate(amount: number | null | undefined, fecha: string | null | undefined): string {
  if (!getReglaMonetariaPorFecha(fecha).allowsUsd) return '-';
  if (amount === null || amount === undefined || !Number.isFinite(Number(amount))) return '-';
  return formatUsd(Number(amount));
}

/**
 * Presentación dual Bs./USD coherente con la fecha contable. Antes de 2018
 * queda solo el monto en bolívares; el tramo USD se expresa como "-".
 */
export function formatDualCurrencyForDate(
  amountBs: number | null | undefined,
  bcvRate: number | null | undefined,
  fecha: string | null | undefined
): string {
  const bs = Number.isFinite(Number(amountBs)) ? Number(amountBs) : 0;
  const formattedBs = formatBsForDate(bs);
  const rule = getReglaMonetariaPorFecha(fecha);
  if (!rule.allowsUsd) return formattedBs;
  const rate = Number(bcvRate);
  if (!Number.isFinite(rate) || rate <= 0) return formattedBs;
  return formattedBs + ' (' + formatUsd(bs / rate) + ')';
}

function formatBsForDate(amount: number): string {
  return 'Bs. ' + amount.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Reexpresa un monto nominal de bolívares desde la escala de su fecha contable
 * a la escala vigente (bolívar digital). Devuelve un decimal exacto en texto.
 */
export function normalizeAmountToCurrentScale(amount: string | number, fecha: string): string {
  if (!isValidIsoCalendarDate(fecha)) throw new Error('La fecha contable no es válida para normalizar su escala monetaria.');
  return normalizeVenezuelanAmountToCurrentScale(amount, fecha);
}

/**
 * Reexpresa un monto entre dos fechas contables, cada una con su propia escala.
 * Se usa para el arrastre de saldos entre tramos de reconversión.
 */
export function reexpressAmountBetweenDates(amount: string | number, fromDate: string, toDate: string): string {
  if (!isValidIsoCalendarDate(fromDate) || !isValidIsoCalendarDate(toDate)) {
    throw new Error('Las fechas de origen y destino deben ser fechas contables válidas.');
  }
  return convertVenezuelanAmountBetweenDates(amount, fromDate, toDate);
}

export interface ReconversionBoundary {
  date: string;
  label: string;
  eraId: VenezuelanMonetaryEraId;
  previousEraId: VenezuelanMonetaryEraId;
  /** Potencia de diez que se retira al pasar del tramo anterior al nuevo. */
  removedDecimalExponent: number;
  legalReference: string;
}

/**
 * Fronteras legales de reconversión monetaria venezolana. La primera era
 * (1900-01-01) es el origen del bolívar y no constituye un corte a reexpresar.
 */
export const RECONVERSION_BOUNDARIES: readonly ReconversionBoundary[] = VENEZUELAN_MONETARY_ERAS
  .slice(1)
  .map((era, index) => {
    const previous = VENEZUELAN_MONETARY_ERAS[index];
    return {
      date: era.effectiveFrom,
      label: era.label,
      eraId: era.id,
      previousEraId: previous.id,
      removedDecimalExponent: previous.cumulativeScaleExponent - era.cumulativeScaleExponent,
      legalReference: era.legalReference
    };
  });

/** Fronteras de reconversión que caen dentro de un rango contable, inclusive. */
export function getReconversionBoundariesInRange(fromDate: string, toDate: string): ReconversionBoundary[] {
  if (!isValidIsoCalendarDate(fromDate) || !isValidIsoCalendarDate(toDate) || fromDate > toDate) return [];
  return RECONVERSION_BOUNDARIES.filter(boundary => boundary.date >= fromDate && boundary.date <= toDate);
}

/** Siguiente frontera de reconversión posterior a una fecha, o null si ya es la escala vigente. */
export function getNextReconversionBoundary(date: string): ReconversionBoundary | null {
  if (!isValidIsoCalendarDate(date)) return null;
  return RECONVERSION_BOUNDARIES.find(boundary => boundary.date > date) || null;
}
