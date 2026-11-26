import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import { isValidIsoCalendarDate } from '../utils/isoDateValidation';

/**
 * Mecanismo central de reexpresión monetaria del inventario.
 *
 * Toda capa PEPS, costo promedio, movimiento de Kardex, devolución, ajuste,
 * producción, costo de venta y valoración debe pasar por estas funciones antes
 * de sumar, ponderar o consumir importes. El único motor de conversión es
 * `reexpressAmountBetweenDates` de `utils/monetaryPolicy`, que aplica las
 * fronteras legales de 2008-01-01, 2018-08-20 y 2021-10-01 con aritmética
 * decimal exacta y sin aproximaciones.
 *
 * Reglas:
 * - La fecha que define la escala de un importe es la fecha contable del
 *   documento que lo originó, nunca la fecha de digitación ni la de registro.
 * - Convertir nunca altera el costo original: se conserva en
 *   `originalUnitCostBs` junto con su fecha de escala, documento, movimiento de
 *   origen y tasa BCV.
 * - No se convierten cantidades físicas ni se reescriben documentos originales.
 * - Si no se puede determinar la escala de un importe, se falla de forma
 *   explícita en lugar de asumir que ya está en la escala vigente.
 */

/** Trazabilidad histórica que acompaña a todo costo reexpresado. */
export interface InventoryCostTrace {
  /** Costo unitario tal como fue documentado, en la escala de su fecha. */
  originalUnitCostBs?: number;
  /** Fecha contable que define la escala monetaria del costo documentado. */
  costScaleDate?: string;
  /** Documento que respalda el costo original. */
  documentRef?: string;
  /** Movimiento de Kardex que originó la capa. */
  sourceMovementId?: string;
  /** Tasa BCV histórica del documento original, conservada sin alteración. */
  bcvRate?: number;
}

/** Capa de costo con procedencia y escala monetaria explícitas. */
export interface InventoryCostLayer extends InventoryCostTrace {
  quantity: number;
  unitCostBs: number;
  unitCostUsd: number;
  date?: string;
}

const invalidCostAmount = (): Error =>
  new Error('El costo de inventario debe ser un importe numérico finito no negativo.');

const invalidCostDate = (): Error =>
  new Error('La escala monetaria del costo requiere fechas contables válidas.');

const latestValidDate = (dates: Array<string | null | undefined>): string | null => {
  let latest: string | null = null;
  for (const value of dates) {
    if (!isValidIsoCalendarDate(value)) continue;
    if (latest === null || value > latest) latest = value;
  }
  return latest;
};

/**
 * Único punto de resolución de la escala del costo de un artículo.
 *
 * La escala del costo vigente la define el último movimiento valorado del
 * artículo; si solo tiene existencia inicial, manda su fecha de apertura. En
 * procesos donde el costo ya fue reexpresado a la fecha de la operación (por
 * ejemplo, varias líneas de una misma factura), `currentScaleDate` evita una
 * doble conversión.
 *
 * Devuelve además el costo promedio existente ya reexpresado a la fecha de la
 * operación, de modo que compras, ventas, importación, producción, devoluciones
 * y valoración compartan exactamente la misma regla.
 */
export interface InventoryCostScaleResolution {
  costScaleDate: string;
  existingAverageBs: number;
}

export function resolveInventoryCostScale(input: {
  productId: string;
  movements?: ReadonlyArray<{ productId: string; date: string }>;
  openingDate?: string | null;
  operationDate: string;
  quantity: number;
  averageBs: number;
  /** Escala ya conocida del costo vigente; tiene prioridad sobre los movimientos. */
  currentScaleDate?: string | null;
}): InventoryCostScaleResolution {
  if (!isValidIsoCalendarDate(input.operationDate)) throw invalidCostDate();
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) < 0) {
    throw new Error('La existencia para resolver la escala del costo no es válida.');
  }
  const productId = String(input.productId || '').trim();
  if (!productId) throw new Error('La escala del costo requiere un artículo identificado.');
  const fromCurrent = isValidIsoCalendarDate(input.currentScaleDate) ? input.currentScaleDate : null;
  const fromMovements = latestValidDate((input.movements || [])
    .filter(movement => String(movement?.productId || '') === productId)
    .map(movement => movement?.date));
  const costScaleDate = fromCurrent || fromMovements || (isValidIsoCalendarDate(input.openingDate) ? input.openingDate : null);
  if (!costScaleDate) {
    // Sin existencia ni costo no hay escala que interpretar; con importes
    // reales, se falla de forma explícita en vez de asumir la escala vigente.
    if (Number(input.quantity) > 0 && Number(input.averageBs) > 0) {
      throw new Error('No se puede determinar la escala monetaria del costo: el artículo no conserva una fecha contable válida.');
    }
    return { costScaleDate: input.operationDate, existingAverageBs: Number(input.averageBs) || 0 };
  }
  return {
    costScaleDate,
    existingAverageBs: reexpressInventoryAverageCost({
      quantity: input.quantity,
      averageBs: input.averageBs,
      costScaleDate,
      operationDate: input.operationDate
    })
  };
}

/**
 * Reexpresa un importe de costo en bolívares de la escala de `fromDate` a la
 * escala vigente en `toDate`. Devuelve un número sin redondear; el redondeo de
 * presentación corresponde al documento, nunca a la evidencia de origen.
 */
export function reexpressInventoryCostBs(
  amount: number | string,
  fromDate: string | null | undefined,
  toDate: string | null | undefined
): number {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value < 0) throw invalidCostAmount();
  if (value === 0) return 0;
  if (!isValidIsoCalendarDate(fromDate) || !isValidIsoCalendarDate(toDate)) throw invalidCostDate();
  if (fromDate === toDate) return value;
  return Number(reexpressAmountBetweenDates(value, fromDate, toDate));
}

/**
 * Reexpresa el costo promedio de las existencias existentes a la escala de la
 * operación antes de mezclarlo con una entrada nueva. Si no hay existencia, el
 * costo debe ser cero y la escala es irrelevante.
 */
export function reexpressInventoryAverageCost(input: {
  quantity: number;
  averageBs: number;
  costScaleDate: string | null | undefined;
  operationDate: string | null | undefined;
}): number {
  if (!Number.isFinite(Number(input.quantity)) || Number(input.quantity) < 0) {
    throw new Error('La existencia para reexpresar el costo promedio no es válida.');
  }
  if (Number(input.quantity) === 0 || Number(input.averageBs) === 0) return Number(input.averageBs) || 0;
  return reexpressInventoryCostBs(input.averageBs, input.costScaleDate, input.operationDate);
}

/**
 * Reexpresa todas las capas PEPS a la escala de la fecha de la operación antes
 * de consumirlas. Conserva cantidad física y trazabilidad de cada capa; la capa
 * original no se muta.
 */
export function reexpressInventoryCostLayers<T extends InventoryCostLayer>(
  layers: readonly T[],
  operationDate: string | null | undefined
): Array<T & { originalUnitCostBs: number; costScaleDate: string }> {
  if (!Array.isArray(layers)) throw new Error('Las capas de costo del inventario no tienen un formato válido.');
  if (!isValidIsoCalendarDate(operationDate)) throw invalidCostDate();
  return layers.map(layer => {
    const quantity = Number(layer?.quantity);
    const unitCostBs = Number(layer?.unitCostBs);
    if (!Number.isFinite(quantity) || quantity < 0) throw invalidCostAmount();
    if (!Number.isFinite(unitCostBs) || unitCostBs < 0) throw invalidCostAmount();
    const costScaleDate = layer.costScaleDate || layer.date;
    if (!isValidIsoCalendarDate(costScaleDate)) {
      throw new Error('Una capa PEPS no conserva la fecha contable que define su escala monetaria.');
    }
    return {
      ...layer,
      quantity,
      unitCostUsd: Number(layer.unitCostUsd),
      unitCostBs: reexpressInventoryCostBs(unitCostBs, costScaleDate, operationDate),
      originalUnitCostBs: layer.originalUnitCostBs ?? unitCostBs,
      // `costScaleDate` describe la escala del costo ya reexpresado; la fecha,
      // el importe y el documento originales quedan intactos en la capa.
      costScaleDate: operationDate
    };
  });
}

/**
 * Valoración del inventario a una fecha de presentación común. Cada artículo se
 * reexpresa desde su propia escala antes de sumarse: nunca se agregan importes
 * de escalas distintas. La provisión VNR opcional se reexpresa con la misma
 * fecha de escala que el costo del artículo.
 */
export function valueInventoryAtDate(
  items: ReadonlyArray<{
    quantity: number;
    unitCostBs: number;
    costScaleDate?: string | null;
    /** Provisión VNR expresada en la escala de `costScaleDate`. */
    provisionBs?: number;
  }>,
  presentationDate: string
): number {
  if (!Array.isArray(items)) throw new Error('La valoración del inventario no tiene un formato válido.');
  if (!isValidIsoCalendarDate(presentationDate)) throw invalidCostDate();
  return items.reduce((total, item) => {
    const quantity = Number(item.quantity);
    const unitCostBs = Number(item.unitCostBs);
    const provisionBs = Number(item.provisionBs || 0);
    if (![quantity, unitCostBs, provisionBs].every(value => Number.isFinite(value) && value >= 0)) {
      throw invalidCostAmount();
    }
    if (quantity === 0) return total;
    const cost = reexpressInventoryCostBs(unitCostBs, item.costScaleDate, presentationDate);
    const provision = provisionBs > 0
      ? reexpressInventoryCostBs(provisionBs, item.costScaleDate, presentationDate)
      : 0;
    return total + Math.max(0, quantity * cost - provision);
  }, 0);
}
