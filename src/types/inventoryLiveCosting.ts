import type { InventoryMovement, JournalEntryItem } from './accounting';
import {
  calculateFifoIssue,
  calculateWeightedAverageCostDual,
  reconstructFifoLayers,
  type ConsumedFifoLayer,
  type FifoMovementSnapshot,
  type InventoryCostingMethod
} from './inventoryAccounting';
import { reexpressInventoryCostLayers, resolveInventoryCostScale } from './inventoryMonetaryReexpression';

/**
 * Costo de los movimientos de inventario registrados en vivo.
 *
 * Este módulo concentra las decisiones de valoración que comparten las compras,
 * ventas, importaciones, producción y devoluciones: un solo punto resuelve la
 * escala monetaria del costo, reexpresa el promedio o las capas PEPS a la fecha
 * de la operación y devuelve el costo aplicado, el nuevo saldo y sus totales.
 * No persiste, no altera documentos y no crea asientos: solo calcula.
 */

export interface LiveInventoryMovement extends FifoMovementSnapshot {
  productId: string;
}

export interface LiveInventoryCostInput {
  productId: string;
  /** Kardex del artículo, en el orden en que fue registrado. */
  movements: ReadonlyArray<LiveInventoryMovement>;
  openingDate?: string | null;
  /** Fecha contable de la operación que se está valorando. */
  date: string;
  currentStock: number;
  averageBs: number;
  averageUsd: number;
  costingMethod?: InventoryCostingMethod;
  /** Escala ya resuelta del costo vigente, para lotes que comparten fecha. */
  currentScaleDate?: string | null;
}

export interface LiveInventoryCostResult {
  costScaleDate: string;
  unitCostBs: number;
  unitCostUsd: number;
  totalCostBs: number;
  totalCostUsd: number;
  newStock: number;
  newAverageBs: number;
  newAverageUsd: number;
  balanceTotalBs: number;
  balanceTotalUsd: number;
  consumedFifoLayers?: ConsumedFifoLayer[];
}

const roundBs = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;
const roundUsd = (value: number): number => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const requireFinite = (value: number, message: string): number => {
  if (!Number.isFinite(value) || value < 0) throw new Error(message);
  return value;
};

/**
 * Valoración de una entrada (compra, apertura, devolución de cliente o
 * producción terminada). La existencia previa se reexpresa a la escala de la
 * operación antes de ponderarla con el costo de la entrada.
 */
export function calculateLiveEntryCosting(
  input: LiveInventoryCostInput & {
    quantity: number;
    unitCostBs: number;
    unitCostUsd: number;
    /** Importe total ya determinado por el documento (fletes, redondeos). */
    totalCostBs?: number;
    totalCostUsd?: number;
  }
): LiveInventoryCostResult {
  const quantity = requireFinite(Number(input.quantity), 'La cantidad de la entrada debe ser mayor que cero.');
  if (quantity <= 0) throw new Error('La cantidad de la entrada debe ser mayor que cero.');
  const unitCostBs = requireFinite(Number(input.unitCostBs), 'El costo unitario de la entrada no es válido.');
  const unitCostUsd = requireFinite(Number(input.unitCostUsd), 'El costo unitario USD de la entrada no es válido.');
  const currentStock = requireFinite(Number(input.currentStock), 'La existencia previa no es válida.');
  const averageUsd = requireFinite(Number(input.averageUsd), 'El costo promedio USD previo no es válido.');
  const scale = resolveInventoryCostScale({
    productId: input.productId,
    movements: input.movements,
    openingDate: input.openingDate,
    operationDate: input.date,
    quantity: currentStock,
    averageBs: input.averageBs,
    currentScaleDate: input.currentScaleDate
  });
  const totalCostBs = roundBs(input.totalCostBs ?? quantity * unitCostBs);
  const totalCostUsd = roundUsd(input.totalCostUsd ?? quantity * unitCostUsd);
  const weighted = calculateWeightedAverageCostDual(
    currentStock, scale.existingAverageBs, averageUsd,
    quantity, unitCostBs, unitCostUsd
  );
  return {
    costScaleDate: scale.costScaleDate,
    unitCostBs,
    unitCostUsd,
    totalCostBs,
    totalCostUsd,
    newStock: weighted.quantity,
    newAverageBs: weighted.unitCostBs,
    newAverageUsd: weighted.unitCostUsd,
    balanceTotalBs: roundBs(weighted.quantity * weighted.unitCostBs),
    balanceTotalUsd: roundUsd(weighted.quantity * weighted.unitCostUsd)
  };
}

/**
 * Valoración de una salida (venta, consumo de producción, merma o devolución a
 * proveedor). PEPS consume las capas ya reexpresadas a la fecha de la salida;
 * el promedio ponderado se reexpresa antes de multiplicarlo por la cantidad.
 */
export function calculateLiveIssueCosting(
  input: LiveInventoryCostInput & { quantity: number }
): LiveInventoryCostResult {
  const quantity = requireFinite(Number(input.quantity), 'La cantidad de la salida debe ser mayor que cero.');
  if (quantity <= 0) throw new Error('La cantidad de la salida debe ser mayor que cero.');
  const currentStock = requireFinite(Number(input.currentStock), 'La existencia previa no es válida.');
  if (quantity - currentStock > 1e-8) {
    throw new Error(`Existencia insuficiente: disponibles ${currentStock}, solicitadas ${quantity}.`);
  }
  const scale = resolveInventoryCostScale({
    productId: input.productId,
    movements: input.movements,
    openingDate: input.openingDate,
    operationDate: input.date,
    quantity: currentStock,
    averageBs: input.averageBs,
    currentScaleDate: input.currentScaleDate
  });
  const newStock = Math.max(0, currentStock - quantity);
  if (input.costingMethod === 'PEPS') {
    const layers = reexpressInventoryCostLayers(reconstructFifoLayers([...input.movements], currentStock), input.date);
    const layerValueBs = layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0);
    const layerValueUsd = layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostUsd, 0);
    const fifo = calculateFifoIssue(layers, quantity);
    const newAverageBs = newStock > 0 ? Math.max(0, layerValueBs - fifo.totalCostBs) / newStock : 0;
    const newAverageUsd = newStock > 0 ? Math.max(0, layerValueUsd - fifo.totalCostUsd) / newStock : 0;
    return {
      costScaleDate: scale.costScaleDate,
      unitCostBs: fifo.unitCostBs,
      unitCostUsd: fifo.unitCostUsd,
      totalCostBs: fifo.totalCostBs,
      totalCostUsd: fifo.totalCostUsd,
      newStock,
      newAverageBs,
      newAverageUsd,
      balanceTotalBs: roundBs(newStock * newAverageBs),
      balanceTotalUsd: roundUsd(newStock * newAverageUsd),
      consumedFifoLayers: fifo.consumedLayers
    };
  }
  const averageUsd = requireFinite(Number(input.averageUsd), 'El costo promedio USD previo no es válido.');
  const unitCostBs = scale.existingAverageBs;
  const totalCostBs = roundBs(quantity * unitCostBs);
  const totalCostUsd = roundUsd(quantity * averageUsd);
  return {
    costScaleDate: scale.costScaleDate,
    unitCostBs,
    unitCostUsd: averageUsd,
    totalCostBs,
    totalCostUsd,
    newStock,
    newAverageBs: newStock > 0 ? unitCostBs : 0,
    newAverageUsd: newStock > 0 ? averageUsd : 0,
    balanceTotalBs: roundBs(newStock * (newStock > 0 ? unitCostBs : 0)),
    balanceTotalUsd: roundUsd(newStock * (newStock > 0 ? averageUsd : 0))
  };
}

/**
 * Asiento de costo de ventas (CMV) de una salida por venta, con su contrapartida
 * de inventario. Devuelve vacío cuando no hay costo que contabilizar.
 */
export function buildCostOfSalesLines(input: {
  productCode: string;
  quantity: number;
  invoiceNumber: string;
  costOfSalesAccount: { code: string; name: string };
  inventoryAccount: { code: string; name: string };
  totalCostBs: number;
  totalCostUsd: number;
}): JournalEntryItem[] {
  const totalCostBs = Number(input.totalCostBs);
  const totalCostUsd = Number(input.totalCostUsd);
  if (!Number.isFinite(totalCostBs) || totalCostBs < 0 || !Number.isFinite(totalCostUsd) || totalCostUsd < 0) {
    throw new Error('El costo de ventas contiene importes inválidos.');
  }
  if (totalCostBs === 0) return [];
  return [
    {
      accountCode: input.costOfSalesAccount.code,
      accountName: input.costOfSalesAccount.name,
      debitBs: totalCostBs, creditBs: 0,
      debitUsd: totalCostUsd, creditUsd: 0,
      description: `CMV ${input.productCode} · ${input.quantity} und · Fac. ${input.invoiceNumber}`
    },
    {
      accountCode: input.inventoryAccount.code,
      accountName: input.inventoryAccount.name,
      debitBs: 0, creditBs: totalCostBs,
      debitUsd: 0, creditUsd: totalCostUsd,
      description: `Salida inventario ${input.productCode} · venta Fac. ${input.invoiceNumber}`
    }
  ];
}

/** Reexportado para que los flujos no resuelvan la escala por su cuenta. */
export { resolveInventoryCostScale };

/** Tipo usado por los flujos para tipar el Kardex recibido. */
export type LiveInventoryHistory = ReadonlyArray<LiveInventoryMovement>;

export const toLiveInventoryMovement = (movement: InventoryMovement): LiveInventoryMovement => ({
  id: movement.id,
  productId: movement.productId,
  type: movement.type,
  concept: movement.concept,
  quantity: movement.quantity,
  unitCostBs: movement.unitCostBs,
  unitCostUsd: movement.unitCostUsd,
  date: movement.date,
  documentRef: movement.documentRef,
  balanceQty: movement.balanceQty,
  correctionForMovementId: movement.correctionForMovementId,
  consumedFifoLayers: movement.consumedFifoLayers,
  bcvRate: movement.bcvRate,
  costScaleDate: movement.costScaleDate,
  originalUnitCostBs: movement.originalUnitCostBs
});
