import test from 'node:test';
import assert from 'node:assert/strict';
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

test('creates stable purchase entries and zero-cost sale issues from invoice sources', () => {
  const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [sale()] });
  assert.equal(result.length, 2);
  const entry = result.find(m => m.type === 'ENTRADA')!;
  const issue = result.find(m => m.type === 'SALIDA')!;
  assert.deepEqual({ id: entry.id, date: entry.date, concept: entry.concept, quantity: entry.quantity, unitCostBs: entry.unitCostBs, totalCostBs: entry.totalCostBs, documentRef: entry.documentRef }, { id: 'source-purchase-buy-1-p-1', date: '2025-01-01', concept: 'COMPRA', quantity: 5, unitCostBs: 20, totalCostBs: 100, documentRef: 'FAC-P-001' });
  assert.deepEqual({ id: issue.id, date: issue.date, concept: issue.concept, quantity: issue.quantity, unitCostBs: issue.unitCostBs, totalCostBs: issue.totalCostBs, documentRef: issue.documentRef }, { id: 'source-sale-sale-1-p-1', date: '2025-01-02', concept: 'VENTA', quantity: 2, unitCostBs: 0, totalCostBs: 0, documentRef: 'FAC-S-001' });
  assert.deepEqual(deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [sale()] }).map(m => m.id), result.map(m => m.id));
});

test('ignores canceled invoices, notes and other-company sources', () => {
  const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [
    purchase({ isCancelled: true }), purchase({ id: 'buy-other', companyId: 'co-2' }), purchase({ id: 'note', documentType: '03' })
  ], sales: [sale({ isCancelled: true }), sale({ id: 'sale-other', companyId: 'co-2' }), sale({ id: 'note-sale', documentType: '02' })] });
  assert.deepEqual(result, []);
});

test('rejects invalid dates in invoice sources before projecting Kardex', () => {
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase({ invoiceDate: '2025-02-30' })], sales: [] }), /línea de inventario inválida/);
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [], sales: [sale({ invoiceDate: 'not-a-date' })] }), /línea de inventario inválida/);
});

test('rejects duplicate product lines in a source invoice instead of generating duplicate stock', () => {
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [
    purchase({ inventoryLines: [{ productId: 'p-1', quantity: 1, unitCostBs: 2 }, { productId: 'p-1', quantity: 2, unitCostBs: 2 }] })
  ], sales: [] }), /línea de inventario inválida, duplicada/);
});

test('rejects missing products and invalid sale quantities', () => {
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [], purchases: [], sales: [sale()] }), /línea de inventario inválida/);
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [], sales: [
    sale({ inventoryLines: [{ ...sale().inventoryLines![0], quantity: 0 }] })
  ] }), /línea de inventario inválida/);
});

test('suppresses a previously recorded invoice Kardex movement when it matches the source exactly', () => {
  const projected = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] });
  const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: projected });
  assert.deepEqual(result, []);
});

test('blocks a source invoice whose existing ledger entry has a conflicting quantity', () => {
  const existing = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] }).map(m => ({ ...m, quantity: 4 }));
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: existing }), /datos difieren/);
});

test('rejects ambiguous duplicate existing Kardex records for one invoice source', () => {
  const existing = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] });
  const duplicateLedger = [...existing, { ...existing[0], id: 'duplicate-row' }];
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: duplicateLedger }), /varios movimientos del Kardex/);
});

test('blocks matching source movements when supplier metadata differs', () => {
  const existing = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [] })
    .map(m => ({ ...m, counterpartyRif: 'J-OTHER' }));
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase()], sales: [], existingMovements: existing }), /datos difieren/);
});

test('still detects same-day ordering ambiguity when both invoice movements already exist in Kardex', () => {
  const sameDayPurchase = purchase({ invoiceDate: '2025-01-02' });
  const sameDaySale = sale({ invoiceDate: '2025-01-02' });
  const existing = [
    ...deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [sameDayPurchase], sales: [] }),
    ...deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [], sales: [sameDaySale] })
  ];
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [sameDayPurchase], sales: [sameDaySale], existingMovements: existing }), /sin secuencia de registro común/);
});

test('refuses to guess posting order for same-product purchase and sale on the same day', () => {
  const sameDayPurchase = purchase({ invoiceDate: '2025-01-02' });
  const sameDaySale = sale({ invoiceDate: '2025-01-02' });
  assert.throws(() => deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [sameDayPurchase], sales: [sameDaySale] }), /sin secuencia de registro común/);
});

test('accepts a valid leap-day invoice date after calendar validation', () => {
  const result = deriveInvoiceInventoryMovements({ companyId: 'co-1', products: [product], purchases: [purchase({ invoiceDate: '2024-02-29' })], sales: [] });
  assert.equal(result[0].date, '2024-02-29');
});
