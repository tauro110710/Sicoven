import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reexpressInventoryAverageCost,
  reexpressInventoryCostBs,
  reexpressInventoryCostLayers,
  resolveInventoryCostScale,
  valueInventoryAtDate
} from './inventoryMonetaryReexpression';
import { calculateFifoIssue, calculateWeightedAverageCostDual } from './inventoryAccounting';

const companyId = 'company-reconversion';

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

