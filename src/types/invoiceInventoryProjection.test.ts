import { describe, expect, it } from 'vitest';
import { deriveInvoiceInventoryMovements } from './invoiceInventoryProjection';
import type { InventoryProduct, PurchaseRecord, SaleRecord } from './accounting';

const product = { id: 'p-1', companyId: 'co-1', code: 'SKU1', name: 'Producto', costingMethod: 'PROMEDIO_PONDERADO' } as InventoryProduct;
const purchase = (overrides: Partial<PurchaseRecord> = {}) => ({
  id: 'buy-1', companyId: 'co-1', invoiceDate: '2025-01-01', invoiceNumber: 'P-001',
  documentType: '01', bcvRate: 10, supplierRif: 'J-1', supplierName: 'Proveedor',
  inventoryLines: [{ productId: 'p-1', quantity: 5, unitCostBs: 20 }],
  ...overrides
} as PurchaseRecord);
const sale = (overrides: Partial<SaleRecord> = {}) => ({
  id: 'sale-1', companyId: 'co-1', invoiceDate: '2025-01-02', invoiceNumber: 'S-001',
  documentType: '01', bcvRate: 10, customerRif: 'V-1', customerName: 'Cliente',
  inventoryLines: [{ productId: 'p-1', productCode: 'SKU1', productName: 'Producto', quantity: 2,
    unitPriceBs: 30, netAmountBs: 60, taxRate: 0, vatAmountBs: 0, exemptAmountBs: 60, totalBs: 60 }],
  ...overrides
} as SaleRecord);

describe('deriveInvoiceInventoryMovements', () => {
  it('creates stable purchase entries and zero-cost sale issues from invoice sources', () => {
    const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [sale()] });
    expect(result).toHaveLength(2);
    const entry = result.find(m => m.type === 'ENTRADA')!;
    const issue = result.find(m => m.type === 'SALIDA')!;
    expect(entry).toMatchObject({ id: 'source-purchase-buy-1-p-1', date: '2025-01-01', concept: 'COMPRA', quantity: 5, unitCostBs: 20, totalCostBs: 100, documentRef: 'FAC-P-001' });
    expect(issue).toMatchObject({ id: 'source-sale-sale-1-p-1', date: '2025-01-02', concept: 'VENTA', quantity: 2, unitCostBs: 0, totalCostBs: 0, documentRef: 'FAC-S-001' });
    expect(deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [sale()] }).map(m => m.id)).toEqual(result.map(m => m.id));
  });

  it('ignores canceled invoices, notes and other-company sources', () => {
    const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [
      purchase({ isCancelled: true }), purchase({ id: 'buy-other', companyId: 'co-2' }), purchase({ id: 'note', documentType: '03' })
    ], sales: [sale({ isCancelled: true }), sale({ id: 'sale-other', companyId: 'co-2' }), sale({ id: 'note-sale', documentType: '02' })] });
    expect(result).toEqual([]);
  });

  it('rejects duplicate product lines in a source invoice instead of generating duplicate stock', () => {
    expect(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [
      purchase({ inventoryLines: [{ productId: 'p-1', quantity: 1, unitCostBs: 2 }, { productId: 'p-1', quantity: 2, unitCostBs: 2 }] })
    ], sales: [] })).toThrow(/línea de inventario inválida, duplicada/);
  });

  it('rejects missing products and invalid sale quantities', () => {
    expect(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [], purchases: [], sales: [sale()] })).toThrow(/línea de inventario inválida/);
    expect(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [], sales: [
      sale({ inventoryLines: [{ ...sale().inventoryLines![0], quantity: 0 }] })
    ] })).toThrow(/línea de inventario inválida/);
  });
  it('suppresses a previously recorded invoice Kardex movement when it matches the source exactly', () => {
    const projected = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] });
    const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: projected });
    expect(result).toEqual([]);
  });

  it('blocks a source invoice whose existing ledger entry has a conflicting quantity', () => {
    const existing = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] }).map(m => ({ ...m, quantity: 4 }));
    expect(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: existing })).toThrow(/datos difieren/);
  });
  it('refuses to guess posting order for same-product purchase and sale on the same day', () => {
    const sameDayPurchase = purchase({ invoiceDate: '2025-01-02' });
    const sameDaySale = sale({ invoiceDate: '2025-01-02' });
    expect(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [sameDayPurchase], sales: [sameDaySale] }))
      .toThrow(/sin secuencia de registro común/);
  });
});
