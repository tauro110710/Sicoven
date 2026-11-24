import type { InventoryMovement, InventoryProduct } from './accounting';
import { convertVenezuelanAmountBetweenDates } from './historicalAccountingCalendar';
import {
  applyFifoAdjustment,
  calculateFifoIssue,
  calculateWeightedAverageCostDual,
  reconstructFifoLayers,
  type FifoMovementSnapshot
} from './inventoryAccounting';

export interface HistoricalInventoryReplayInput {
  companyId: string;
  startDate: string;
  products: InventoryProduct[];
  movements: InventoryMovement[];
}

export interface HistoricalInventoryReplayResult {
  companyId: string;
  startDate: string;
  endDate: string;
  products: InventoryProduct[];
  movements: InventoryMovement[];
  processedMovementIds: string[];
}

interface ProductState {
  product: InventoryProduct;
  quantity: number;
  averageBs: number;
  averageUsd: number;
  lastCostBs: number;
  lastCostUsd: number;
  lastBsDate: string;
  history: InventoryMovement[];
}

const roundBs = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const roundUsd = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const validDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const validPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const validNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

const toFifoSnapshot = (movement: InventoryMovement, targetDate = movement.date): FifoMovementSnapshot => ({
  id: movement.id,
  type: movement.type,
  concept: movement.concept,
  quantity: movement.quantity,
  unitCostBs: movement.unitCostBs > 0 && validDate(movement.date) && validDate(targetDate)
    ? Number(convertVenezuelanAmountBetweenDates(movement.unitCostBs, movement.date, targetDate))
    : movement.unitCostBs,
  unitCostUsd: movement.unitCostUsd,
  date: movement.date,
  documentRef: movement.documentRef,
  balanceQty: movement.balanceQty,
  correctionForMovementId: movement.correctionForMovementId
});

/**
 * Replays an already-recorded inventory ledger from a zero-stock historical
 * starting point. This function is deliberately pure: it never persists,
 * edits source documents, creates journal entries, or changes fiscal records.
 *
 * For movements sharing a date, the original array order is retained. That
 * order is the recorded posting order and is therefore part of the source
 * history; sorting same-day documents by their visible reference could change
 * FIFO consumption and is not permitted.
 */
export function replayHistoricalInventory(input: HistoricalInventoryReplayInput): HistoricalInventoryReplayResult {
  const companyId = String(input.companyId || '').trim();
  const startDate = String(input.startDate || '');
  if (!companyId) throw new Error('La reconstrucción de inventario requiere una empresa.');
  if (!validDate(startDate)) throw new Error('La fecha inicial de reconstrucción no es válida.');
  if (!Array.isArray(input.products) || !input.products.length) {
    throw new Error('La empresa no tiene artículos para reconstruir.');
  }
  if (!Array.isArray(input.movements)) throw new Error('El historial de Kardex no tiene un formato válido.');

  const states = new Map<string, ProductState>();
  for (const product of input.products) {
    if (product.companyId !== companyId || !String(product.id || '').trim() || states.has(product.id)) {
      throw new Error('El catálogo contiene artículos duplicados o pertenecientes a otra empresa.');
    }
    const openingValues = [
      product.currentStock, product.avgCostBs, product.avgCostUsd,
      product.lastCostBs, product.lastCostUsd
    ].map(Number);
    if (openingValues.some(value => !Number.isFinite(value) || value !== 0)) {
      throw new Error('La reconstrucción exige artículos preparados con existencia y costos iniciales en cero. No se inventarán saldos de apertura.');
    }
    if (product.openingDate !== startDate || Number(product.openingBcvRate || 0) !== 0) {
      throw new Error('El artículo no está preparado para la fecha inicial seleccionada. Ejecute primero la preparación histórica autorizada.');
    }
    states.set(product.id, {
      product: { ...product },
      quantity: 0,
      averageBs: 0,
      averageUsd: 0,
      lastCostBs: 0,
      lastCostUsd: 0,
      lastBsDate: startDate,
      history: []
    });
  }

  const seenIds = new Set<string>();
  const ordered = input.movements.map((movement, index) => ({ movement, index }))
    .filter(({ movement }) => movement.companyId === companyId)
    .sort((a, b) => a.movement.date.localeCompare(b.movement.date) || a.index - b.index);

  if (input.movements.some(movement => movement.companyId !== companyId)) {
    throw new Error('El lote contiene movimientos de otra empresa; no se mezclará información entre empresas.');
  }

  const replayed: InventoryMovement[] = [];
  const replayedById = new Map<string, InventoryMovement>();
  const returnedBySale = new Map<string, number>();

  for (const { movement: source } of ordered) {
    const id = String(source.id || '').trim();
    if (!id || seenIds.has(id)) throw new Error('El historial contiene identificadores de movimiento vacíos o duplicados.');
    seenIds.add(id);
    if (!validDate(source.date) || source.date < startDate) {
      throw new Error('El movimiento ' + (source.documentRef || id) + ' está fuera del rango o tiene una fecha inválida.');
    }
    const state = states.get(source.productId);
    if (!state) throw new Error('El movimiento ' + (source.documentRef || id) + ' referencia un artículo inexistente en la empresa.');
    if (state.quantity > 0 && state.averageBs > 0 && state.lastBsDate !== source.date) {
      state.averageBs = Number(convertVenezuelanAmountBetweenDates(state.averageBs, state.lastBsDate, source.date));
    }
    const rate = Number(source.bcvRate || 0);
    const requestedQuantity = Number(source.quantity);
    const requestedUnitCostBs = Number(source.unitCostBs);
    const requestedUnitCostUsd = Number(source.unitCostUsd);
    const landedCostsBs = Number(source.additionalLandedCostsBs || 0);
    if (!validPositive(rate) || !validPositive(requestedQuantity) ||
        !validNonNegative(requestedUnitCostBs) || !validNonNegative(requestedUnitCostUsd) ||
        !validNonNegative(landedCostsBs)) {
      throw new Error('El movimiento ' + (source.documentRef || id) + ' contiene tasa, cantidad o costos inválidos.');
    }
    if (source.type === 'SALIDA' && source.concept === 'DEVOLUCION_COMPRA') {
      throw new Error('La reconstrucción no puede recalcular devoluciones a proveedor sin el flujo atómico de nota de crédito y CxP.');
    }

    let movementQuantity = requestedQuantity;
    let unitCostBs = requestedUnitCostBs;
    let unitCostUsd = requestedUnitCostUsd > 0 ? requestedUnitCostUsd : roundUsd(requestedUnitCostBs / rate);
    let totalCostBs = 0;
    let totalCostUsd = 0;
    let consumedFifoLayers: InventoryMovement['consumedFifoLayers'];
    let nextQuantity = state.quantity;
    let nextAverageBs = state.averageBs;
    let nextAverageUsd = state.averageUsd;
    const isAdjustment = source.type === 'AJUSTE';
    const targetQuantity = isAdjustment ? Number(source.balanceQty) : 0;
    const effectiveUnitCostBs = source.type === 'ENTRADA'
      ? requestedUnitCostBs + landedCostsBs / requestedQuantity
      : requestedUnitCostBs;

    if (source.type === 'ENTRADA') {
      let entryUnitCostBs = effectiveUnitCostBs;
      let entryUnitCostUsd = roundUsd(effectiveUnitCostBs / rate);
      if (source.concept === 'DEVOLUCION_CLIENTE') {
        const original = source.correctionForMovementId ? replayedById.get(source.correctionForMovementId) : undefined;
        if (!original || original.type !== 'SALIDA' || original.concept !== 'VENTA' ||
            original.productId !== source.productId || source.date < original.date) {
          throw new Error('La devolución de cliente ' + (source.documentRef || id) + ' no está vinculada a una salida de venta válida.');
        }
        const returned = (returnedBySale.get(original.id) || 0) + requestedQuantity;
        if (returned - Number(original.quantity) > 1e-8) {
          throw new Error('Las devoluciones acumuladas superan la cantidad de la venta original ' + (original.documentRef || original.id) + '.');
        }
        returnedBySale.set(original.id, returned);
        if (state.product.costingMethod === 'PEPS') {
          throw new Error('La devolución PEPS requiere conservar el detalle de capas consumidas por la venta original; no se aplicará un costo promedio estimado.');
        }
        entryUnitCostBs = Number(convertVenezuelanAmountBetweenDates(original.unitCostBs, original.date, source.date));
        entryUnitCostUsd = Number(original.unitCostUsd);
      }
      if (!validNonNegative(entryUnitCostBs) || !validNonNegative(entryUnitCostUsd)) {
        throw new Error('El costo efectivo de entrada no es válido en ' + (source.documentRef || id) + '.');
      }
      unitCostBs = entryUnitCostBs;
      unitCostUsd = entryUnitCostUsd;
      if (state.product.costingMethod === 'PEPS') {
        const priorLayers = reconstructFifoLayers(state.history.map(movement => toFifoSnapshot(movement, source.date)), state.quantity);
        totalCostBs = roundBs(requestedQuantity * entryUnitCostBs);
        totalCostUsd = roundUsd(requestedQuantity * entryUnitCostUsd);
        nextQuantity += requestedQuantity;
        const totalBs = roundBs(priorLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0) + totalCostBs);
        const totalUsd = roundUsd(priorLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostUsd, 0) + totalCostUsd);
        nextAverageBs = nextQuantity > 0 ? totalBs / nextQuantity : 0;
        nextAverageUsd = nextQuantity > 0 ? totalUsd / nextQuantity : 0;
      } else {
        const weighted = calculateWeightedAverageCostDual(
          state.quantity, state.averageBs, state.averageUsd,
          requestedQuantity, entryUnitCostBs, entryUnitCostUsd
        );
        totalCostBs = roundBs(requestedQuantity * entryUnitCostBs);
        totalCostUsd = roundUsd(requestedQuantity * entryUnitCostUsd);
        nextQuantity = weighted.quantity;
        nextAverageBs = weighted.unitCostBs;
        nextAverageUsd = weighted.unitCostUsd;
      }
      state.lastCostBs = unitCostBs;
      state.lastCostUsd = unitCostUsd;
    } else if (source.type === 'SALIDA') {

      if (requestedQuantity - state.quantity > 1e-8) {
        throw new Error('Existencia insuficiente al reconstruir ' + (source.documentRef || id) + ': disponibles ' + state.quantity + ', solicitadas ' + requestedQuantity + '.');
      }
      if (state.product.costingMethod === 'PEPS') {
        const layers = reconstructFifoLayers(state.history.map(movement => toFifoSnapshot(movement, source.date)), state.quantity);
        const fifo = calculateFifoIssue(layers, requestedQuantity);
        totalCostBs = fifo.totalCostBs;
        totalCostUsd = fifo.totalCostUsd;
        consumedFifoLayers = fifo.consumedLayers;
        unitCostBs = fifo.unitCostBs;
        unitCostUsd = fifo.unitCostUsd;
        let remaining = requestedQuantity;
        const remainingLayers = layers.map(layer => ({ ...layer }));
        for (const layer of remainingLayers) {
          if (remaining <= 1e-8) break;
          const consumed = Math.min(layer.quantity, remaining);
          layer.quantity -= consumed;
          remaining -= consumed;
        }
        if (remaining > 1e-8) throw new Error('No se pudieron consumir las capas PEPS durante la reconstrucción.');
        const remainingBs = roundBs(remainingLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0));
        const remainingUsd = roundUsd(remainingLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostUsd, 0));
        nextQuantity = state.quantity - requestedQuantity;
        nextAverageBs = nextQuantity > 0 ? remainingBs / nextQuantity : 0;
        nextAverageUsd = nextQuantity > 0 ? remainingUsd / nextQuantity : 0;
      } else {
        unitCostBs = state.averageBs;
        unitCostUsd = state.averageUsd;
        totalCostBs = roundBs(requestedQuantity * unitCostBs);
        totalCostUsd = roundUsd(requestedQuantity * unitCostUsd);
        nextQuantity = state.quantity - requestedQuantity;
        nextAverageBs = nextQuantity > 0 ? state.averageBs : 0;
        nextAverageUsd = nextQuantity > 0 ? state.averageUsd : 0;
      }
    } else if (source.type === 'AJUSTE') {
      if (!Number.isFinite(targetQuantity) || targetQuantity < 0 || Math.abs(targetQuantity - state.quantity) <= 1e-8) {
        throw new Error('El ajuste ' + (source.documentRef || id) + ' no contiene una existencia final válida o no modifica el saldo.');
      }
      const delta = targetQuantity - state.quantity;
      movementQuantity = Math.abs(delta);
      if (state.product.costingMethod === 'PEPS') {
        const layers = reconstructFifoLayers(state.history.map(movement => toFifoSnapshot(movement, source.date)), state.quantity);
        const adjusted = applyFifoAdjustment(layers, delta, requestedUnitCostBs,
          roundUsd(requestedUnitCostBs / rate), source.date, source.documentRef);
        totalCostBs = adjusted.totalCostBs;
        totalCostUsd = adjusted.totalCostUsd;
        unitCostBs = adjusted.unitCostBs;
        unitCostUsd = adjusted.unitCostUsd;
        nextQuantity = targetQuantity;
        nextAverageBs = nextQuantity > 0 ? adjusted.balanceTotalBs / nextQuantity : 0;
        nextAverageUsd = nextQuantity > 0 ? adjusted.balanceTotalUsd / nextQuantity : 0;
      } else if (delta > 0) {
        const weighted = calculateWeightedAverageCostDual(
          state.quantity, state.averageBs, state.averageUsd,
          delta, requestedUnitCostBs, roundUsd(requestedUnitCostBs / rate)
        );
        totalCostBs = roundBs(delta * requestedUnitCostBs);
        totalCostUsd = roundUsd(delta * requestedUnitCostBs / rate);
        unitCostBs = requestedUnitCostBs;
        unitCostUsd = roundUsd(requestedUnitCostBs / rate);
        nextQuantity = weighted.quantity;
        nextAverageBs = weighted.unitCostBs;
        nextAverageUsd = weighted.unitCostUsd;
        state.lastCostBs = unitCostBs;
        state.lastCostUsd = unitCostUsd;
      } else {
        totalCostBs = roundBs(movementQuantity * state.averageBs);
        totalCostUsd = roundUsd(movementQuantity * state.averageUsd);
        unitCostBs = state.averageBs;
        unitCostUsd = state.averageUsd;
        nextQuantity = targetQuantity;
        nextAverageBs = nextQuantity > 0 ? state.averageBs : 0;
        nextAverageUsd = nextQuantity > 0 ? state.averageUsd : 0;
      }
    } else {
      throw new Error('El movimiento ' + (source.documentRef || id) + ' tiene un tipo desconocido.');
    }

    if (![nextQuantity, nextAverageBs, nextAverageUsd, totalCostBs, totalCostUsd].every(Number.isFinite) ||
        nextQuantity < -1e-8 || nextAverageBs < 0 || nextAverageUsd < 0) {
      throw new Error('El recálculo produjo un saldo o costo inválido en ' + (source.documentRef || id) + '.');
    }

    const nextMovement: InventoryMovement = {
      ...source,
      quantity: movementQuantity,
      unitCostBs,
      unitCostUsd,
      ...(consumedFifoLayers ? { consumedFifoLayers } : {}),
      totalCostBs,
      totalCostUsd,
      balanceQty: Math.max(0, nextQuantity),
      balanceTotalBs: roundBs(Math.max(0, nextQuantity) * nextAverageBs),
      balanceTotalUsd: roundUsd(Math.max(0, nextQuantity) * nextAverageUsd)
    };
    state.quantity = Math.max(0, nextQuantity);
    state.averageBs = nextAverageBs;
    state.averageUsd = nextAverageUsd;
    state.history.push(nextMovement);
    state.lastBsDate = source.date;
    replayedById.set(nextMovement.id, nextMovement);
    replayed.push(nextMovement);
  }

  const products = input.products.map(product => {
    const state = states.get(product.id)!;
    return {
      ...product,
      currentStock: state.quantity,
      avgCostBs: state.averageBs,
      avgCostUsd: state.averageUsd,
      lastCostBs: state.lastCostBs,
      lastCostUsd: state.lastCostUsd
    };
  });
  return {
    companyId,
    startDate,
    endDate: replayed.reduce((latest, movement) => movement.date > latest ? movement.date : latest, startDate),
    products,
    movements: replayed,
    processedMovementIds: replayed.map(movement => movement.id)
  };
}
