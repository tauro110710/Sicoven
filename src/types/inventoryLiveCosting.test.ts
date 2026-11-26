import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCostOfSalesLines,
  calculateLiveEntryCosting,
  calculateLiveIssueCosting,
  type LiveInventoryMovement
} from './inventoryLiveCosting';

/**
 * Flujos en vivo que cruzan la reconversión del 2018-08-20. Los movimientos se
 * expresan como los registra el Kardex: cada uno en la escala de su propia
 * fecha contable (Bs.F antes del corte, Bs.S desde el corte).
 */

const purchase = (overrides: Partial<LiveInventoryMovement> & Pick<LiveInventoryMovement, 'id' | 'date' | 'quantity' | 'unitCostBs'>): LiveInventoryMovement => ({
  productId: 'product-1',
  type: 'ENTRADA',
  concept: 'COMPRA',
  unitCostUsd: 1,
  documentRef: overrides.id,
  balanceQty: overrides.quantity,
  bcvRate: 0,
  ...overrides
});

const cmvAccounts = {
  costOfSalesAccount: { code: '5.1.1.01', name: 'Costo de ventas' },
  inventoryAccount: { code: '1.1.4.01', name: 'Inventario de mercancías' }
};

const assertBalancedJournal = (lines: ReturnType<typeof buildCostOfSalesLines>) => {
  const debit = lines.reduce((sum, line) => sum + line.debitBs, 0);
  const credit = lines.reduce((sum, line) => sum + line.creditBs, 0);
  const debitUsd = lines.reduce((sum, line) => sum + line.debitUsd, 0);
  const creditUsd = lines.reduce((sum, line) => sum + line.creditUsd, 0);
  assert.ok(Math.abs(debit - credit) < 0.005);
  assert.ok(Math.abs(debitUsd - creditUsd) < 0.000001);
};

test('venta PEPS en vivo el día de la reconversión consume la capa antigua reexpresada y genera CMV', () => {
  const history: LiveInventoryMovement[] = [
    purchase({ id: 'FAC-1', date: '2018-08-19', quantity: 2, unitCostBs: 100_000, bcvRate: 100_000 }),
    purchase({ id: 'FAC-2', date: '2018-08-20', quantity: 1, unitCostBs: 100, bcvRate: 100, balanceQty: 3 })
  ];
  const issue = calculateLiveIssueCosting({
    productId: 'product-1',
    movements: history,
    openingDate: '2018-01-01',
    date: '2018-08-20',
    currentStock: 3,
    averageBs: 100_000,
    averageUsd: 1,
    costingMethod: 'PEPS',
    quantity: 1
  });
  assert.equal(issue.totalCostBs, 1, 'la capa de Bs.F se reexpresa a Bs.S antes de consumirse');
  assert.equal(issue.unitCostBs, 1);
  assert.equal(issue.newStock, 2);
  assert.equal(issue.newAverageBs, 50.5);
  assert.equal(issue.balanceTotalBs, 101);
  assert.equal(issue.consumedFifoLayers?.length, 1);
  assert.equal(issue.consumedFifoLayers?.[0].originalUnitCostBs, 100_000);
  assert.equal(issue.consumedFifoLayers?.[0].costScaleDate, '2018-08-20');
  assert.equal(issue.consumedFifoLayers?.[0].date, '2018-08-19');
  assert.equal(issue.consumedFifoLayers?.[0].documentRef, 'FAC-1');

  const lines = buildCostOfSalesLines({
    productCode: 'SKU-1', quantity: 1, invoiceNumber: '0001',
    ...cmvAccounts, totalCostBs: issue.totalCostBs, totalCostUsd: issue.totalCostUsd
  });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].accountCode, '5.1.1.01');
  assert.equal(lines[0].debitBs, 1);
  assert.equal(lines[1].accountCode, '1.1.4.01');
  assert.equal(lines[1].creditBs, 1);
  assertBalancedJournal(lines);
});

test('venta promedio ponderado en vivo cruza la reconversión sin mezclar escalas', () => {
  const firstPurchase = purchase({ id: 'FAC-1', date: '2018-08-19', quantity: 1, unitCostBs: 100_000, bcvRate: 100_000 });
  const entry = calculateLiveEntryCosting({
    productId: 'product-1',
    movements: [firstPurchase],
    openingDate: '2018-01-01',
    date: '2018-08-20',
    currentStock: 1,
    averageBs: 100_000,
    averageUsd: 1,
    costingMethod: 'PROMEDIO_PONDERADO',
    quantity: 1,
    unitCostBs: 100,
    unitCostUsd: 1
  });
  assert.equal(entry.totalCostBs, 100);
  assert.equal(entry.newStock, 2);
  assert.equal(entry.newAverageBs, 50.5, 'costo previo reexpresado (1) + entrada (100) entre 2');
  assert.equal(entry.balanceTotalBs, 101);

  const secondPurchase = purchase({ id: 'FAC-2', date: '2018-08-20', quantity: 1, unitCostBs: 100, bcvRate: 100, balanceQty: 2 });
  const history = [firstPurchase, secondPurchase];
  const sale = calculateLiveIssueCosting({
    productId: 'product-1',
    movements: history,
    openingDate: '2018-01-01',
    date: '2018-08-20',
    currentStock: entry.newStock,
    averageBs: entry.newAverageBs,
    averageUsd: entry.newAverageUsd,
    costingMethod: 'PROMEDIO_PONDERADO',
    quantity: 1
  });
  assert.equal(sale.totalCostBs, 50.5);
  assert.equal(sale.unitCostBs, 50.5);
  assert.equal(sale.newStock, 1);
  assert.equal(sale.newAverageBs, 50.5);
  assert.equal(sale.balanceTotalBs, 50.5);

  const lines = buildCostOfSalesLines({
    productCode: 'SKU-1', quantity: 1, invoiceNumber: '0002',
    ...cmvAccounts, totalCostBs: sale.totalCostBs, totalCostUsd: sale.totalCostUsd
  });
  assert.equal(lines[0].debitBs, 50.5);
  assert.equal(lines[1].creditBs, 50.5);
  assertBalancedJournal(lines);
});

test('una salida del día previo a la reconversión conserva la escala anterior', () => {
  const history = [purchase({ id: 'FAC-1', date: '2018-08-19', quantity: 2, unitCostBs: 100_000, bcvRate: 100_000 })];
  const issue = calculateLiveIssueCosting({
    productId: 'product-1',
    movements: history,
    openingDate: '2018-01-01',
    date: '2018-08-19',
    currentStock: 2,
    averageBs: 100_000,
    averageUsd: 2,
    costingMethod: 'PROMEDIO_PONDERADO',
    quantity: 1
  });
  assert.equal(issue.totalCostBs, 100_000);
  assert.equal(issue.newStock, 1);
  assert.equal(issue.balanceTotalBs, 100_000);
});

test('una entrada posterior usa la escala ya resuelta del lote y no reconvierte dos veces', () => {
  const entry = calculateLiveEntryCosting({
    productId: 'product-1',
    movements: [],
    openingDate: '2018-01-01',
    date: '2018-08-20',
    currentStock: 1,
    averageBs: 1,
    averageUsd: 1,
    costingMethod: 'PROMEDIO_PONDERADO',
    currentScaleDate: '2018-08-20',
    quantity: 1,
    unitCostBs: 101,
    unitCostUsd: 1
  });
  assert.equal(entry.newAverageBs, 51);
});

test('no permite vender más existencia que la registrada', () => {
  assert.throws(() => calculateLiveIssueCosting({
    productId: 'product-1',
    movements: [purchase({ id: 'FAC-1', date: '2018-08-19', quantity: 1, unitCostBs: 100_000 })],
    openingDate: '2018-01-01',
    date: '2018-08-20',
    currentStock: 1,
    averageBs: 100_000,
    averageUsd: 1,
    costingMethod: 'PEPS',
    quantity: 2
  }), /Existencia insuficiente/);
});
