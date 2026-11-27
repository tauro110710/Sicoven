import type { Company } from '../types/accounting';
import { resolveInventoryBcvRate } from '../types/inventoryBcvRate';
import { isBcvRateRequiredForDate } from './bcvRatePolicy';
import { resolveBcvRateEntryForDate } from './resolveBcvRateForDate';

export type HistoricalBcvRateOrigin = 'ACCOUNTING' | 'INVENTORY';

export interface HistoricalBcvRate {
  rate: number;
  /** Fecha de vigencia de la tasa que se está sugiriendo (puede ser anterior a la fecha consultada). */
  effectiveDate: string;
  origin: HistoricalBcvRateOrigin;
}

export type HistoricalBcvRateCompany = Pick<Company, 'accountingBcvRateHistory' | 'inventoryBcvRateHistory'>;

/**
 * Resuelve la tasa BCV histórica aplicable a una fecha contable.
 *
 * Regla única: antes del 01/01/2018 no se sugiere ni se admite tasa BCV.
 * Se elige la tasa vigente más reciente entre ambas fuentes; si coinciden en
 * fecha, prevalece el historial contable (registro del contador). El historial
 * diario de Inventario actúa como respaldo para fechas sin registro contable.
 *
 * Solo devuelve tasas existentes; nunca fabrica un valor.
 */
export function resolveHistoricalBcvRate(
  company: HistoricalBcvRateCompany | null | undefined,
  effectiveDate: string
): HistoricalBcvRate | undefined {
  if (!company || !isBcvRateRequiredForDate(effectiveDate)) return undefined;

  const accounting = resolveBcvRateEntryForDate(company.accountingBcvRateHistory, effectiveDate);
  const inventory = resolveInventoryBcvRate(company.inventoryBcvRateHistory || [], effectiveDate);

  if (!inventory) {
    return accounting ? { rate: accounting.rate, effectiveDate: accounting.effectiveDate, origin: 'ACCOUNTING' } : undefined;
  }
  if (!accounting || inventory.effectiveDate > accounting.effectiveDate) {
    return { rate: inventory.rate, effectiveDate: inventory.effectiveDate, origin: 'INVENTORY' };
  }
  return { rate: accounting.rate, effectiveDate: accounting.effectiveDate, origin: 'ACCOUNTING' };
}

/** Etiqueta legible del origen de la tasa sugerida. */
export function historicalBcvRateOriginLabel(origin: HistoricalBcvRateOrigin): string {
  return origin === 'ACCOUNTING'
    ? 'historial contable de la empresa'
    : 'tasa diaria BCV sincronizada por Inventario';
}
