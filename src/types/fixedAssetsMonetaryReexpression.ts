import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import { isValidIsoCalendarDate } from '../utils/isoDateValidation';
import type { FixedAsset } from './fixedAssets';

/**
 * Mecanismo central de reexpresión monetaria de activos fijos.
 *
 * Todo costo de adquisición, valor residual, depreciación acumulada, valor neto
 * contable y gasto de depreciación en bolívares debe pasar por estas funciones
 * antes de sumarse, restarse o compararse. El único motor de conversión es
 * `reexpressAmountBetweenDates` de `utils/monetaryPolicy`, que aplica las
 * fronteras legales de 2008-01-01, 2018-08-20 y 2021-10-01 con aritmética
 * decimal exacta.
 *
 * Reglas:
 * - La escala del costo de adquisición y del valor residual la define la fecha
 *   contable documentada del activo (`costScaleDate`, que corresponde al asiento
 *   de capitalización; si no existe, la fecha de adquisición). Los importes
 *   originales nunca se reescriben: solo se reexpresan al consultarlos.
 * - Cada evento de depreciación conserva su importe en la escala vigente en su
 *   propia fecha contable. La depreciación acumulada a una fecha se obtiene
 *   reexpresando cada evento desde su fecha, nunca sumando nominales.
 * - Los importes en USD no se reconvierten: el dólar no cambia de escala.
 * - No se mezclan escalas: si falta una fecha contable válida se falla de forma
 *   explícita en lugar de asumir que el importe ya está en la escala vigente.
 */

/** Decimales de cálculo en Bs. para no perder depreciaciones sub-centavo. */
export const FIXED_ASSET_BS_PRECISION = 8;

const invalidDate = (label: string): Error =>
  new Error(label + ' no es una fecha contable válida para determinar la escala monetaria del activo fijo.');

const assertDate = (value: string | null | undefined, label: string): string => {
  if (!isValidIsoCalendarDate(value)) throw invalidDate(label);
  return String(value);
};

export function roundFixedAssetBs(value: number): number {
  if (!Number.isFinite(value)) throw new Error('El importe en bolívares del activo fijo no es un número válido.');
  const factor = 10 ** FIXED_ASSET_BS_PRECISION;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Reexpresa un importe en bolívares de la escala de `fromDate` a la vigente en
 * `toDate`, sin redondear. El redondeo es una decisión del documento que lo usa.
 */
export function reexpressFixedAssetBs(
  amount: number,
  fromDate: string | null | undefined,
  toDate: string | null | undefined
): number {
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('El importe en bolívares del activo fijo debe ser un número finito no negativo.');
  }
  if (value === 0) return 0;
  const source = assertDate(fromDate, 'La fecha contable del activo fijo');
  const target = assertDate(toDate, 'La fecha de consulta del activo fijo');
  if (source === target) return value;
  const converted = Number(reexpressAmountBetweenDates(value, source, target));
  if (!Number.isFinite(converted)) {
    throw new Error('La reexpresión monetaria del activo fijo produjo un importe no válido.');
  }
  return converted;
}

/** Fecha contable que define la escala del costo y del valor residual. */
export function getFixedAssetCostScaleDate(asset: Pick<FixedAsset, 'acquisitionDate' | 'costScaleDate'>): string {
  const scaleDate = asset.costScaleDate || asset.acquisitionDate;
  const acquisitionDate = assertDate(asset.acquisitionDate, 'La fecha de adquisición del activo fijo');
  const result = assertDate(scaleDate, 'La fecha de escala del costo del activo fijo');
  if (result < acquisitionDate) {
    throw new Error('La fecha de escala del costo no puede ser anterior a la fecha de adquisición del activo fijo.');
  }
  return result;
}

/**
 * Depreciación acumulada en Bs. expresada en la escala vigente en `valuationDate`.
 * Cada evento se reexpresa desde su propia fecha contable; los eventos
 * reversados se excluyen salvo que se pida explícitamente lo contrario.
 */
export function getFixedAssetAccumulatedDepreciationAtDate(
  asset: Pick<FixedAsset, 'depreciationEvents'>,
  valuationDate: string,
  options: { includeReversed?: boolean } = {}
): number {
  const target = assertDate(valuationDate, 'La fecha de consulta del activo fijo');
  let accumulated = 0;
  for (const event of asset.depreciationEvents || []) {
    if (event.reversedByJournalEntryId && !options.includeReversed) continue;
    const eventDate = assertDate(event.date, 'La fecha del evento de depreciación');
    accumulated += reexpressFixedAssetBs(Number(event.amountBs), eventDate, target);
  }
  return accumulated;
}

/** Depreciación acumulada en USD. El dólar no se reconvierte. */
export function getFixedAssetAccumulatedDepreciationUsd(
  asset: Pick<FixedAsset, 'depreciationEvents'>,
  options: { includeReversed?: boolean } = {}
): number {
  return (asset.depreciationEvents || []).reduce((sum, event) => {
    if (event.reversedByJournalEntryId && !options.includeReversed) return sum;
    const amount = Number(event.amountUsd);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export interface FixedAssetMonetaryPosition {
  valuationDate: string;
  /** Fecha contable que define la escala del costo original. */
  costScaleDate: string;
  /** Costo de adquisición tal como fue documentado (intacto). */
  historicalCostBs: number;
  /** Costo de adquisición reexpresado a la fecha de consulta. */
  costBs: number;
  residualValueBs: number;
  accumulatedDepreciationBs: number;
  netBookValueBs: number;
  depreciableBaseBs: number;
  historicalCostUsd: number;
  residualValueUsd: number;
  accumulatedDepreciationUsd: number;
  netBookValueUsd: number;
}

/**
 * Posición monetaria completa de un activo a una fecha de consulta. Agrupa
 * costo, residual, acumulado y valor neto en una sola escala, de modo que los
 * reportes no sumen importes de vigencias distintas.
 */
export function getFixedAssetMonetaryPosition(
  asset: FixedAsset,
  valuationDate: string
): FixedAssetMonetaryPosition {
  const target = assertDate(valuationDate, 'La fecha de consulta del activo fijo');
  const costScaleDate = getFixedAssetCostScaleDate(asset);
  const historicalCostBs = Number(asset.acquisitionCostBs);
  const historicalResidualBs = Number(asset.residualValueBs);
  if (!Number.isFinite(historicalCostBs) || !Number.isFinite(historicalResidualBs)) {
    throw new Error('El activo fijo contiene importes en bolívares no válidos.');
  }
  const costBs = reexpressFixedAssetBs(historicalCostBs, costScaleDate, target);
  const residualBs = reexpressFixedAssetBs(historicalResidualBs, costScaleDate, target);
  const accumulatedDepreciationBs = getFixedAssetAccumulatedDepreciationAtDate(asset, target);
  const depreciableBaseBs = Math.max(0, costBs - residualBs);
  const netBookValueBs = Math.max(residualBs, costBs - accumulatedDepreciationBs);
  const historicalCostUsd = Number(asset.acquisitionCostUsd) || 0;
  const residualValueUsd = Number(asset.residualValueUsd) || 0;
  const accumulatedDepreciationUsd = getFixedAssetAccumulatedDepreciationUsd(asset);
  return {
    valuationDate: target,
    costScaleDate,
    historicalCostBs,
    costBs,
    residualValueBs: residualBs,
    accumulatedDepreciationBs,
    netBookValueBs,
    depreciableBaseBs,
    historicalCostUsd,
    residualValueUsd,
    accumulatedDepreciationUsd,
    netBookValueUsd: Math.max(residualValueUsd, historicalCostUsd - accumulatedDepreciationUsd)
  };
}

/**
 * Gasto de depreciación en Bs. de los eventos con fecha contable dentro del
 * rango, expresado en la escala vigente en `valuationDate`. Se usa en reportes
 * de gasto sin alterar los importes originales de cada asiento.
 */
export function getFixedAssetDepreciationExpenseBetweenDates(
  asset: Pick<FixedAsset, 'depreciationEvents'>,
  fromDate: string,
  toDate: string,
  valuationDate: string
): number {
  const from = assertDate(fromDate, 'La fecha inicial del gasto de depreciación');
  const to = assertDate(toDate, 'La fecha final del gasto de depreciación');
  if (from > to) throw new Error('El rango del gasto de depreciación no es cronológico.');
  const target = assertDate(valuationDate, 'La fecha de consulta del activo fijo');
  let expense = 0;
  for (const event of asset.depreciationEvents || []) {
    if (event.reversedByJournalEntryId) continue;
    if (event.date < from || event.date > to) continue;
    expense += reexpressFixedAssetBs(Number(event.amountBs), event.date, target);
  }
  return expense;
}
