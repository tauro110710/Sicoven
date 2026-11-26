import test from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryMovement, InventoryProduct } from './accounting';
import {
  reexpressInventoryAverageCost,
  reexpressInventoryCostBs,
  reexpressInventoryCostLayers,
  resolveInventoryCostScale,
  valueInventoryAtDate
} from './inventoryMonetaryReexpression';
import { calculateFifoIssue, calculateWeightedAverageCostDual } from './inventoryAccounting';
import { replayHistoricalInventory } from './historicalInventoryReplay';

const companyId = 'company-reconversion';

const makeProduct = (costingMethod: 'PROMEDIO_PONDERADO' | 'PEPS' = 'PROMEDIO_PONDERADO', overrides: Partial<InventoryProduct> = {}): InventoryProduct => ({
  id: 'product-1', companyId, code: 'SKU-1', name: 'Artículo de reconversión',
  category: 'General', unit: 'Unid', minStock: 0, currentStock: 0,
  avgCostBs: 0, avgCostUsd: 0, lastCostBs: 0, lastCostUsd: 0,
  salesPriceBs: 0, salesPriceUsd: 0, costingMethod,
  openingDate: '2007-01-01', openingBcvRate: 0,
  ...overrides
});

const movement = (overrides: Partial<InventoryMovement> & Pick<InventoryMovement, 'id' | 'date' | 'type' | 'concept' | 'quantity' | 'unitCostBs' | 'unitCostUsd' | 'bcvRate'>): InventoryMovement => ({
  id: overrides.id, companyId, productId: 'product-1',
  productName: 'Artículo de reconversión', productCode: 'SKU-1',
  date: overrides.date, type: overrides.type, concept: overrides.concept,
  documentRef: overrides.documentRef || overrides.id,
  quantity: overrides.quantity, unitCostBs: overrides.unitCostBs,
  unitCostUsd: overrides.unitCostUsd, totalCostBs: 0, totalCostUsd: 0,
  balanceQty: overrides.balanceQty ?? 0, balanceTotalBs: 0, balanceTotalUsd: 0,
  bcvRate: overrides.bcvRate,
  ...(overrides.correctionForMovementId ? { correctionForMovementId: overrides.correctionForMovementId } : {})
});

const replay = (products: InventoryProduct[], movements: InventoryMovement[], startDate = '2007-01-01') =>
  replayHistoricalInventory({ companyId, startDate, products, movements });

test('reexpresa costos en las tres reconversiones sin aproximaciones', () => {
  assert.equal(reexpressInventoryCostBs(1_000_000, '2007-12-31', '2008-01-01'), 1_000);
  assert.equal(reexpressInventoryCostBs(100_000, '2018-08-19', '2018-08-20'), 1);
  assert.equal(reexpressInventoryCostBs(250_000, '2021-09-30', '2021-10-01'), 0.25);
  assert.equal(reexpressInventoryCostBs(1_234_567.89, '2018-08-19', '2018-08-20'), 12.3456789);
});

test('no reexpresa importes de la misma escala y falla ante datos inválidos', () => {
  assert.equal(reexpressInventoryCostBs(1234.56, '2021-10-01', '2021-10-01'), 1234.56);
  assert.equal(reexpressInventoryCostBs(0, '2018-08-19', '2018-08-20'), 0);
  assert.throws(() => reexpressInventoryCostBs(-1, '2018-08-19', '2018-08-20'), /no negativo/);
  assert.throws(() => reexpressInventoryCostBs(10, '2018-02-30', '2018-08-20'), /fechas contables válidas/);
  assert.throws(() => reexpressInventoryAverageCost({ quantity: 1, averageBs: 10, costScaleDate: '', operationDate: '2020-01-01' }));
});

test('reexpresa el costo promedio existente antes de ponderarlo con una entrada nueva', () => {
  const existingAverageAtOperationScale = reexpressInventoryAverageCost({
    quantity: 1, averageBs: 100_000, costScaleDate: '2018-08-19', operationDate: '2018-08-20'
  });
  assert.equal(existingAverageAtOperationScale, 1);
  const weighted = calculateWeightedAverageCostDual(1, existingAverageAtOperationScale, 1, 1, 100, 10);
  assert.equal(weighted.quantity, 2);
  assert.equal(weighted.totalCostBs, 101);
  assert.equal(weighted.unitCostBs, 50.5);
  assert.equal(weighted.unitCostUsd, 5.5);
});

test('las capas PEPS se reexpresan antes de calcular el consumo y conservan su trazabilidad', () => {
  const reexpressed = reexpressInventoryCostLayers([
    { quantity: 1, unitCostBs: 100_000, unitCostUsd: 1, date: '2018-08-19', documentRef: 'FAC-1', sourceMovementId: 'mov-1', bcvRate: 50 },
    { quantity: 1, unitCostBs: 100, unitCostUsd: 10, date: '2018-08-20', documentRef: 'FAC-2', sourceMovementId: 'mov-2', bcvRate: 100 }
  ], '2018-08-21');
  assert.equal(reexpressed[0].unitCostBs, 1);
  assert.equal(reexpressed[0].originalUnitCostBs, 100_000);
  assert.equal(reexpressed[0].date, '2018-08-19');
  assert.equal(reexpressed[0].documentRef, 'FAC-1');
  assert.equal(reexpressed[0].sourceMovementId, 'mov-1');
  assert.equal(reexpressed[0].bcvRate, 50);
  assert.equal(reexpressed[0].costScaleDate, '2018-08-21');
  assert.equal(reexpressed[1].unitCostBs, 100);

  const issue = calculateFifoIssue(reexpressed, 1);
  assert.equal(issue.totalCostBs, 1);
  assert.equal(issue.totalCostUsd, 1);
  assert.equal(issue.consumedLayers?.[0].originalUnitCostBs, 100_000);
  assert.equal(issue.consumedLayers?.[0].costScaleDate, '2018-08-21');
});

test('calcula el costo de venta PEPS después de la reconversión de 2021 con costos de distintas escalas', () => {
  const result = replay([makeProduct('PEPS', { openingDate: '2021-01-01' })], [
    movement({ id: 'layer-2021-09', date: '2021-09-30', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 500_000, unitCostUsd: 1, bcvRate: 500_000 }),
    movement({ id: 'sale-2021-10', date: '2021-10-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 1_000_000 })
  ], '2021-01-01');
  assert.equal(result.movements[1].totalCostBs, 0.5);
  assert.equal(result.movements[1].consumedFifoLayers?.[0].originalUnitCostBs, 500_000);
  assert.equal(result.movements[1].consumedFifoLayers?.[0].costScaleDate, '2021-10-02');
  assert.equal(result.products[0].currentStock, 1);
  assert.equal(result.products[0].avgCostBs, 0.5);
});

test('calcula costo de venta promedio ponderado antes y después de la reconversión de 2008', () => {
  const result = replay([makeProduct('PROMEDIO_PONDERADO')], [
    movement({ id: 'purchase-2007', date: '2007-12-31', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 1_000_000, unitCostUsd: 1, bcvRate: 0 }),
    movement({ id: 'sale-2008', date: '2008-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 0 })
  ]);
  assert.equal(result.movements[1].unitCostBs, 1_000);
  assert.equal(result.movements[1].totalCostBs, 1_000);
  assert.equal(result.products[0].avgCostBs, 1_000);
  assert.equal(result.products[0].currentStock, 1);
});

test('mezcla existencias de 2018 antes y después de la reconversión en una sola escala', () => {
  const result = replay([makeProduct('PROMEDIO_PONDERADO', { openingDate: '2018-01-01' })], [
    movement({ id: 'purchase-bsf', date: '2018-08-19', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100_000, unitCostUsd: 1, bcvRate: 100_000 }),
    movement({ id: 'purchase-bss', date: '2018-08-20', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 }),
    movement({ id: 'sale-bss', date: '2018-08-21', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ], '2018-01-01');
  assert.equal(result.movements[1].totalCostBs, 100);
  assert.equal(result.products[0].avgCostBs, 50.5);
  assert.equal(result.movements[2].totalCostBs, 50.5);
  assert.equal(result.products[0].currentStock, 1);
});

test('la devolución de cliente reexpresa el costo original de la venta a la fecha de la devolución', () => {
  const result = replay([makeProduct('PEPS', { openingDate: '2021-01-01' })], [
    movement({ id: 'purchase', date: '2021-09-30', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 400_000, unitCostUsd: 1, bcvRate: 400_000 }),
    movement({ id: 'sale', date: '2021-09-30', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 400_000 }),
    movement({ id: 'return', date: '2021-10-02', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 999_999, unitCostUsd: 9.99, bcvRate: 1_000_000, correctionForMovementId: 'sale' })
  ], '2021-01-01');
  assert.equal(result.movements[2].totalCostBs, 0.4);
  assert.equal(result.movements[2].unitCostBs, 0.4);
  assert.equal(result.movements[2].unitCostUsd, 1);
  assert.equal(result.products[0].currentStock, 2);
});

test('la devolución de cliente con promedio ponderado reexpresa el costo original sin alterar cantidades', () => {
  const result = replay([makeProduct('PROMEDIO_PONDERADO', { openingDate: '2018-01-01' })], [
    movement({ id: 'purchase', date: '2018-08-19', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 100_000, unitCostUsd: 2, bcvRate: 100_000 }),
    movement({ id: 'sale', date: '2018-08-20', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return', date: '2018-08-21', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 123, unitCostUsd: 1.23, bcvRate: 100, correctionForMovementId: 'sale' })
  ], '2018-01-01');
  assert.equal(result.movements[2].unitCostBs, 1);
  assert.equal(result.movements[2].totalCostBs, 1);
  assert.equal(result.movements[2].quantity, 1);
  assert.equal(result.products[0].currentStock, 2);
});

test('un ajuste negativo posterior a una reconversión consume las capas ya reexpresadas', () => {
  const result = replay([makeProduct('PEPS', { openingDate: '2021-01-01' })], [
    movement({ id: 'layer', date: '2021-09-30', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 300_000, unitCostUsd: 1, bcvRate: 300_000 }),
    movement({ id: 'adjust', date: '2021-10-01', type: 'AJUSTE', concept: 'AJUSTE_EXISTENCIA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 1_000_000, balanceQty: 1 })
  ], '2021-01-01');
  assert.equal(result.movements[1].totalCostBs, 0.3);
  assert.equal(result.movements[1].balanceQty, 1);
  assert.equal(result.movements[1].balanceTotalBs, 0.3);
});

test('la valoración del inventario reexpresa cada artículo antes de sumarlo', () => {
  const total = valueInventoryAtDate([
    { quantity: 1, unitCostBs: 1_000_000, costScaleDate: '2007-12-31' },
    { quantity: 1, unitCostBs: 100_000, costScaleDate: '2018-08-19' },
    { quantity: 2, unitCostBs: 10, costScaleDate: '2021-10-01' }
  ], '2021-10-01');
  assert.ok(Math.abs(total - (20 + 0.000001 + 0.00000001)) < 1e-9);
});

test('determina la escala del costo por el último movimiento o por la apertura', () => {
  const movements = [
    { productId: 'product-1', date: '2018-08-19' },
    { productId: 'product-1', date: '2021-10-01' },
    { productId: 'product-1', date: '' },
    { productId: 'other', date: '2099-01-01' }
  ];
  assert.deepEqual(resolveInventoryCostScale({
    productId: 'product-1', movements, openingDate: '2007-01-01',
    operationDate: '2026-11-26', quantity: 1, averageBs: 100_000
  }), { costScaleDate: '2021-10-01', existingAverageBs: 100_000 });
  assert.equal(resolveInventoryCostScale({
    productId: 'product-1', openingDate: '2015-05-05', operationDate: '2026-11-26', quantity: 0, averageBs: 0
  }).costScaleDate, '2015-05-05');
  assert.equal(resolveInventoryCostScale({
    productId: 'product-1', currentScaleDate: '2018-08-20', operationDate: '2026-11-26', quantity: 1, averageBs: 10
  }).costScaleDate, '2018-08-20');
  assert.throws(() => resolveInventoryCostScale({
    productId: 'product-1', operationDate: '2026-11-26', quantity: 1, averageBs: 10
  }), /escala monetaria del costo/);
});

test('no modifica los documentos originales ni las cantidades físicas', () => {
  const source = [
    movement({ id: 'purchase', date: '2021-09-30', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 500_000, unitCostUsd: 1, bcvRate: 500_000 }),
    movement({ id: 'sale', date: '2021-10-01', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 1_000_000 })
  ];
  const snapshot = JSON.stringify(source);
  replay([makeProduct('PROMEDIO_PONDERADO', { openingDate: '2021-01-01' })], source, '2021-01-01');
  assert.equal(JSON.stringify(source), snapshot);
});
