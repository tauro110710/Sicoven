import test from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryMovement, InventoryProduct, PurchaseRecord, SaleRecord } from './accounting';
import { prepareInvoiceHistoricalInventoryReplay } from './invoiceHistoricalInventoryReplay';

const companyId = 'co-replay';
const product = {
  id: 'product-1', companyId, code: 'SKU-1', name: 'Producto',
  category: 'General', unit: 'Unid', minStock: 0, currentStock: 500,
  avgCostBs: 999, avgCostUsd: 9.99, lastCostBs: 999, lastCostUsd: 9.99,
  salesPriceBs: 0, salesPriceUsd: 0, costingMethod: 'PROMEDIO_PONDERADO'
} as InventoryProduct;
const purchase = (overrides: Partial<PurchaseRecord> = {}) => ({
  id: 'p-1', companyId, invoiceDate: '2025-01-01', invoiceNumber: 'P-1',
  documentType: '01', bcvRate: 100, supplierRif: 'J-1', supplierName: 'Proveedor',
  inventoryLines: [{ productId: product.id, quantity: 4, unitCostBs: 10 }],
  ...overrides
} as PurchaseRecord);
const sale = (overrides: Partial<SaleRecord> = {}) => ({
  id: 's-1', companyId, invoiceDate: '2025-01-02', invoiceNumber: 'S-1',
  documentType: '01', bcvRate: 100, customerRif: 'V-1', customerName: 'Cliente',
  inventoryLines: [{ productId: product.id, productCode: product.code, productName: product.name,
    quantity: 2, unitPriceBs: 30, netAmountBs: 60, taxRate: 0, vatAmountBs: 0, exemptAmountBs: 60, totalBs: 60 }],
  ...overrides
} as SaleRecord);
const input = (patch: Partial<Parameters<typeof prepareInvoiceHistoricalInventoryReplay>[0]> = {}) => ({
  companyId, startDate: '2025-01-01', products: [product], purchases: [purchase()], sales: [sale()],
  existingMovements: [] as InventoryMovement[], ...patch
});

test('replays invoice-only purchase and sale history into inventory balances and derived sale cost', () => {
  const result = prepareInvoiceHistoricalInventoryReplay(input());
  assert.deepEqual(result.movements.map(movement => movement.concept), ['COMPRA', 'VENTA']);
  assert.equal(result.movements[1].totalCostBs, 20);
  assert.equal(result.products[0].currentStock, 2);
  assert.equal(result.products[0].avgCostBs, 10);
  assert.equal(product.currentStock, 500, 'does not modify live product snapshot');
});

test('fails closed on existing ledger movements with malformed dates instead of silently omitting them', () => {
  const badMovement = {
    id: 'bad-date', companyId, productId: product.id, productName: product.name, productCode: product.code,
    date: 'bad-date', type: 'ENTRADA', concept: 'COMPRA', documentRef: 'BAD',
    quantity: 1, unitCostBs: 5, unitCostUsd: 0.05, totalCostBs: 5, totalCostUsd: 0.05,
    balanceQty: 0, balanceTotalBs: 0, balanceTotalUsd: 0, bcvRate: 100
  } as InventoryMovement;
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({ purchases: [], sales: [], existingMovements: [badMovement] })), /fecha inválida/);
});

test('honors throughDate and does not include later invoices or ledger movements', () => {
  const result = prepareInvoiceHistoricalInventoryReplay(input({ throughDate: '2025-01-01' }));
  assert.equal(result.movements.length, 1);
  assert.equal(result.products[0].currentStock, 4);
  assert.equal(result.endDate, '2025-01-01');
});

test('rejects same-day invoice order rather than assigning arbitrary FIFO/average cost sequence', () => {
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({
    purchases: [purchase({ invoiceDate: '2025-01-02' })],
    sales: [sale({ invoiceDate: '2025-01-02' })]
  })), /secuencia de registro verificable/);
});

test('reconciles already posted invoice movement and prevents it from being replayed twice', () => {
  const existing = prepareInvoiceHistoricalInventoryReplay(input()).movements;
  const result = prepareInvoiceHistoricalInventoryReplay(input({ existingMovements: existing }));
  assert.equal(result.movements.length, 2);
  assert.equal(result.products[0].currentStock, 2);
});

test('rejects an existing purchase ledger entry with a mismatched USD unit cost', () => {
  const projected = prepareInvoiceHistoricalInventoryReplay(input({ sales: [] })).movements[0];
  const inconsistentExisting = { ...projected, unitCostUsd: projected.unitCostUsd + 1 };
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({
    sales: [], existingMovements: [inconsistentExisting]
  })), /datos difieren/);
});

test('rejects invalid reconstruction start and end dates', () => {
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({ startDate: '2025-02-30' })), /fecha inicial/);
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({ throughDate: '2025-02-30' })), /fecha final/);
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({ throughDate: '2024-12-31' })), /fecha final/);
});

test('does not silently skip malformed ledger dates beyond the replay cutoff', () => {
  const badMovement = {
    id: 'bad-date-after-cutoff', companyId, productId: product.id, productName: product.name, productCode: product.code,
    date: 'zzz-invalid', type: 'ENTRADA', concept: 'COMPRA', documentRef: 'BAD-DATE',
    quantity: 1, unitCostBs: 5, unitCostUsd: 0.05, totalCostBs: 5, totalCostUsd: 0.05,
    balanceQty: 0, balanceTotalBs: 0, balanceTotalUsd: 0, bcvRate: 100
  } as InventoryMovement;
  assert.throws(() => prepareInvoiceHistoricalInventoryReplay(input({ throughDate: '2025-01-31', purchases: [], sales: [], existingMovements: [badMovement] })), /fechas inválidas/);
});
