import type { InventoryMovement, InventoryProduct, PurchaseRecord, SaleRecord } from './accounting';

/**
 * Converts source invoice merchandise lines into stable, derived Kardex inputs.
 * This is a projection only: it never mutates invoice documents or product balances.
 * Purchase costs come from source lines; sales costs are intentionally left at zero
 * for the historical costing replay to derive from the chronological inventory state.
 */
export function deriveInvoiceInventoryMovements(input: {
  companyId: string;
  products: InventoryProduct[];
  purchases: PurchaseRecord[];
  sales: SaleRecord[];
  existingMovements?: InventoryMovement[];
}): InventoryMovement[] {
  const companyId = String(input.companyId || '').trim();
  if (!companyId) throw new Error('La derivación de Kardex requiere empresa.');
  const products = new Map(input.products.filter(p => p.companyId === companyId).map(p => [p.id, p]));
  const result: InventoryMovement[] = [];
  const existingMovements = input.existingMovements || [];
  const seen = new Set<string>();
  const add = (movement: InventoryMovement) => {
    if (seen.has(movement.id)) throw new Error('El documento fuente genera un movimiento duplicado.');
    seen.add(movement.id);
    const sameId = existingMovements.find(existing => existing.id === movement.id);
    const sourceMatch = existingMovements.find(existing => existing.companyId === companyId &&
      existing.productId === movement.productId && existing.date === movement.date &&
      existing.type === movement.type && existing.concept === movement.concept &&
      existing.documentRef === movement.documentRef);
    const duplicate = sameId || sourceMatch;
    if (duplicate) {
      const sameSource = duplicate.companyId === movement.companyId && duplicate.productId === movement.productId &&
        duplicate.date === movement.date && duplicate.type === movement.type && duplicate.concept === movement.concept &&
        duplicate.documentRef === movement.documentRef && Math.abs(Number(duplicate.quantity) - movement.quantity) < 1e-8 &&
      (movement.concept !== 'COMPRA' || Math.abs(Number(duplicate.unitCostBs) - movement.unitCostBs) < 1e-8);
      if (!sameSource) throw new Error('La factura ' + movement.documentRef + ' coincide con un movimiento existente, pero sus datos difieren; requiere revisión antes de reconstruir.');
      return;
    }
    result.push(movement);
  };
  for (const purchase of input.purchases) {
    if (purchase.companyId !== companyId || purchase.isCancelled || purchase.documentType !== '01' || !purchase.inventoryLines?.length) continue;
    const ref = 'FAC-' + String(purchase.invoiceNumber || '').trim();
    const productIds = new Set<string>();
    for (const line of purchase.inventoryLines) {
      const product = products.get(line.productId);
      const quantity = Number(line.quantity);
      const unitCostBs = Number(line.unitCostBs);
      if (!product || productIds.has(line.productId) || !Number.isFinite(quantity) || quantity <= 0 ||
          !Number.isFinite(unitCostBs) || unitCostBs <= 0) {
        throw new Error('Factura de compra ' + ref + ': línea de inventario inválida, duplicada o sin artículo.');
      }
      productIds.add(line.productId);
      const id = 'source-purchase-' + purchase.id + '-' + line.productId;
      const rate = Number(purchase.bcvRate || 0);
      add({
        id, companyId, productId: product.id, productName: product.name, productCode: product.code,
        date: purchase.invoiceDate, type: 'ENTRADA', concept: 'COMPRA', documentRef: ref,
        quantity, unitCostBs, unitCostUsd: rate > 0 ? unitCostBs / rate : 0,
        totalCostBs: quantity * unitCostBs, totalCostUsd: rate > 0 ? quantity * unitCostBs / rate : 0,
        balanceQty: 0, balanceTotalBs: 0, balanceTotalUsd: 0, bcvRate: rate,
        documentType: 'Factura de compra', counterpartyRif: purchase.supplierRif, counterpartyName: purchase.supplierName,
        costingMethod: product.costingMethod
      });
    }
  }
  for (const sale of input.sales) {
    if (sale.companyId !== companyId || sale.isCancelled || sale.documentType !== '01' || !sale.inventoryLines?.length) continue;
    const ref = 'FAC-' + String(sale.invoiceNumber || '').trim();
    const productIds = new Set<string>();
    for (const line of sale.inventoryLines) {
      const product = products.get(line.productId);
      const quantity = Number(line.quantity);
      if (!product || productIds.has(line.productId) || !Number.isFinite(quantity) || quantity <= 0) {
        throw new Error('Factura de venta ' + ref + ': línea de inventario inválida, duplicada o sin artículo.');
      }
      productIds.add(line.productId);
      const id = 'source-sale-' + sale.id + '-' + line.productId;
      add({
        id, companyId, productId: product.id, productName: line.productName || product.name, productCode: line.productCode || product.code,
        date: sale.invoiceDate, type: 'SALIDA', concept: 'VENTA', documentRef: ref,
        quantity, unitCostBs: 0, unitCostUsd: 0, totalCostBs: 0, totalCostUsd: 0,
        balanceQty: 0, balanceTotalBs: 0, balanceTotalUsd: 0, bcvRate: Number(sale.bcvRate || 0),
        documentType: 'Factura de venta', counterpartyRif: sale.customerRif, counterpartyName: sale.customerName,
        costingMethod: product.costingMethod
      });
    }
  }
  // Invoice collections are separate and do not carry a shared posting sequence.
  // If both a purchase and sale of the same product occur on one date, their
  // true order cannot be inferred safely; refuse rather than manufacture PEPS/average-cost history.
  const sameDayByProduct = new Map<string, Set<string>>();
  for (const movement of result) {
    const key = movement.productId + '|' + movement.date;
    const kinds = sameDayByProduct.get(key) || new Set<string>();
    kinds.add(movement.type);
    sameDayByProduct.set(key, kinds);
  }
  if (Array.from(sameDayByProduct.values()).some(kinds => kinds.has('ENTRADA') && kinds.has('SALIDA'))) {
    throw new Error('Hay compras y ventas del mismo artículo en una misma fecha sin secuencia de registro común; la reconstrucción requiere ordenar esos documentos antes de continuar.');
  }
  // Stable date-only sorting is safe after same-day conflicting event order is rejected.
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
