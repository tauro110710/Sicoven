import type { InventoryMovement, InventoryProduct, PurchaseRecord, SaleRecord } from './accounting';
import { deriveInvoiceInventoryMovements } from './invoiceInventoryProjection';
import { replayHistoricalInventory, type HistoricalInventoryReplayResult } from './historicalInventoryReplay';

/**
 * Pure invoice-to-Kardex reconstruction coordinator.
 * It merges source invoices with the existing movement history, reconciles
 * invoice duplicates, and replays costing without touching SQLite or live state.
 * Ambiguous same-day posting order is rejected instead of being guessed.
 */
export function prepareInvoiceHistoricalInventoryReplay(input: {
  companyId: string;
  startDate: string;
  throughDate?: string;
  products: InventoryProduct[];
  purchases: PurchaseRecord[];
  sales: SaleRecord[];
  existingMovements: InventoryMovement[];
}): HistoricalInventoryReplayResult {
  const companyId = String(input.companyId || '').trim();
  const startDate = String(input.startDate || '');
  if (!companyId) throw new Error('La reconstrucción de inventario requiere empresa.');
  const companyMovements = input.existingMovements.filter(movement => movement.companyId === companyId);
  const sourceMovements = deriveInvoiceInventoryMovements({
    companyId,
    products: input.products,
    purchases: input.purchases,
    sales: input.sales,
    existingMovements: companyMovements
  });
  const existingInRange = companyMovements.filter(movement => movement.date >= startDate);
  const sourceInRange = sourceMovements.filter(movement => movement.date >= startDate);
  const combined = [...existingInRange, ...sourceInRange];
  const dateByProduct = new Map<string, string[]>();
  for (const movement of combined) {
    const key = movement.productId + '|' + movement.date;
    const ids = dateByProduct.get(key) || [];
    ids.push(movement.id);
    dateByProduct.set(key, ids);
  }
  if ([...dateByProduct.values()].some(ids => ids.length > 1)) {
    throw new Error('Hay varios movimientos del mismo artículo en una fecha sin secuencia de registro verificable; ordene o concilie esos documentos antes de reconstruir PEPS/costo promedio.');
  }
  return replayHistoricalInventory({
    companyId,
    startDate,
    ...(input.throughDate ? { throughDate: input.throughDate } : {}),
    products: input.products.filter(product => product.companyId === companyId),
    movements: combined
  });
}
