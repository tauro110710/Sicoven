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
  const validDate = (date: string): boolean => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false;
    const parsed = new Date(date + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const validDate = (date: string): boolean => {
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(date)) return false;
    const parsed = new Date(date + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  if (!validDate(startDate)) throw new Error('La fecha inicial de reconstrucción no es válida.');
  if (input.throughDate && (!validDate(input.throughDate) || input.throughDate < startDate)) {
    throw new Error('La fecha final de reconstrucción no es válida o es anterior a la inicial.');
  }
  const inRange = (date: string): boolean => date >= startDate && (!input.throughDate || date <= input.throughDate);
  const relevantPurchase = (purchase: PurchaseRecord): boolean => purchase.companyId === companyId &&
    (!/^\\d{4}-\\d{2}-\\d{2}$/.test(purchase.invoiceDate) || inRange(purchase.invoiceDate));
  const relevantSale = (sale: SaleRecord): boolean => sale.companyId === companyId &&
    (!/^\\d{4}-\\d{2}-\\d{2}$/.test(sale.invoiceDate) || inRange(sale.invoiceDate));
  const companyMovements = input.existingMovements.filter(movement => movement.companyId === companyId && (!validDate(movement.date) || inRange(movement.date)));
  const sourceMovements = deriveInvoiceInventoryMovements({
    companyId,
    products: input.products,
    purchases: input.purchases.filter(relevantPurchase),
    sales: input.sales.filter(relevantSale),
    existingMovements: companyMovements
  });
  const existingInRange = companyMovements;
  const sourceInRange = sourceMovements;
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
