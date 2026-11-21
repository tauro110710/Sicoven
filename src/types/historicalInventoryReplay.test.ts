import test from 'node:test';
import assert from 'node:assert/strict';
import type { InventoryMovement, InventoryProduct } from './accounting';
import { replayHistoricalInventory } from './historicalInventoryReplay';

const companyId = 'company-replay';
const makeProduct = (costingMethod: 'PROMEDIO_PONDERADO' | 'PEPS' = 'PROMEDIO_PONDERADO'): InventoryProduct => ({
  id: 'product-1', companyId, code: 'SKU-1', name: 'Artículo de prueba',
  category: 'General', unit: 'Unid', minStock: 0, currentStock: 0,
  avgCostBs: 0, avgCostUsd: 0, lastCostBs: 0, lastCostUsd: 0,
  salesPriceBs: 0, salesPriceUsd: 0, costingMethod,
  openingDate: '2010-01-01', openingBcvRate: 0
});

const movement = (overrides: Partial<InventoryMovement> & Pick<InventoryMovement, 'id' | 'date' | 'type' | 'concept' | 'quantity' | 'unitCostBs' | 'unitCostUsd' | 'bcvRate'>): InventoryMovement => ({
  id: overrides.id, companyId, productId: 'product-1',
  productName: 'Artículo de prueba', productCode: 'SKU-1',
  date: overrides.date, type: overrides.type, concept: overrides.concept,
  documentRef: overrides.documentRef || overrides.id,
  quantity: overrides.quantity, unitCostBs: overrides.unitCostBs,
  unitCostUsd: overrides.unitCostUsd, totalCostBs: 0, totalCostUsd: 0,
  balanceQty: 0, balanceTotalBs: 0, balanceTotalUsd: 0,
  bcvRate: overrides.bcvRate,
  ...(overrides.correctionForMovementId ? { correctionForMovementId: overrides.correctionForMovementId } : {}),
  ...(overrides.additionalLandedCostsBs !== undefined ? { additionalLandedCostsBs: overrides.additionalLandedCostsBs } : {})
});

const replay = (products: InventoryProduct[], movements: InventoryMovement[]) =>
  replayHistoricalInventory({ companyId, startDate: '2010-01-01', products, movements });

test('reconstruye promedio ponderado cronológicamente aunque las fuentes lleguen desordenadas', () => {
  const source = [
    movement({ id: 'sale-1', date: '2010-01-03', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 300 }),
    movement({ id: 'purchase-2', date: '2010-01-02', type: 'ENTRADA', concept: 'COMPRA', quantity: 5, unitCostBs: 20, unitCostUsd: 0.1, bcvRate: 200 }),
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 5, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 })
  ];
  const result = replay([makeProduct()], source);
  assert.deepEqual(result.movements.map(item => item.id), ['purchase-1', 'purchase-2', 'sale-1']);
  assert.equal(result.movements[2].totalCostBs, 30);
  assert.equal(result.products[0].currentStock, 8);
  assert.equal(result.products[0].avgCostBs, 15);
  assert.equal(result.products[0].avgCostUsd, 0.1);
  assert.equal(source[0].balanceQty, 0, 'no modifica los documentos fuente');
});

test('capitaliza fletes de entrada y recalcula el costo promedio', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100, additionalLandedCostsBs: 4 })
  ]);
  assert.equal(result.movements[0].unitCostBs, 12);
  assert.equal(result.movements[0].totalCostBs, 24);
  assert.equal(result.products[0].avgCostBs, 12);
});

test('conserva el orden original de movimientos del mismo día para PEPS', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'layer-first', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'layer-second', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.equal(result.movements[2].totalCostBs, 40);
  assert.equal(result.movements[2].totalCostUsd, 0.4);
  assert.equal(result.products[0].currentStock, 1);
  assert.equal(result.products[0].avgCostBs, 20);
});

test('recalcula el costo de una salida usando el costo histórico del promedio', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 4, unitCostBs: 25, unitCostUsd: 0.25, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 999, unitCostUsd: 9.99, bcvRate: 200 })
  ]);
  assert.equal(result.movements[1].unitCostBs, 25);
  assert.equal(result.movements[1].totalCostBs, 25);
  assert.equal(result.movements[1].totalCostUsd, 0.25);
});

test('reconstruye una devolución de cliente enlazada a la venta sin exceder unidades vendidas', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 3, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-03', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 999, unitCostUsd: 9.99, bcvRate: 100, correctionForMovementId: 'sale-1' })
  ]);
  assert.equal(result.products[0].currentStock, 2);
  assert.equal(result.movements[2].balanceQty, 2);
  assert.equal(result.movements[2].unitCostBs, 10, 'usa el costo original de la venta y no el costo digitado en la devolución');
});

test('bloquea salidas anteriores a la primera entrada y no inventa existencia inicial', () => {
  assert.throws(() => replay([makeProduct()], [
    movement({ id: 'sale-1', date: '2010-01-01', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]), /Existencia insuficiente/);
});

test('rejects duplicate movement IDs even when one record falls after the replay cutoff', () => {
  const first = movement({ id: 'same-id', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 5, unitCostUsd: 0.05, bcvRate: 100 });
  const laterDuplicate = movement({ id: 'same-id', date: '2010-01-10', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 7, unitCostUsd: 0.07, bcvRate: 100 });
  assert.throws(() => replayHistoricalInventory({ companyId, startDate: '2010-01-01', throughDate: '2010-01-05', products: [makeProduct()], movements: [first, laterDuplicate] }), /identificadores.*duplicados/);
});

test('bloquea movimientos anteriores a la fecha de inicio y movimientos de otra empresa', () => {
  assert.throws(() => replay([makeProduct()], [
    movement({ id: 'old', date: '2009-12-31', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 1, unitCostUsd: 0.01, bcvRate: 100 })
  ]), /fuera del rango/);
  const foreign = { ...movement({ id: 'foreign', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 1, unitCostUsd: 0.01, bcvRate: 100 }), companyId: 'other-company' };
  assert.throws(() => replay([makeProduct()], [foreign]), /otra empresa/);
});

test('reconstruye sin preparar ni alterar saldos almacenados del catálogo', () => {
  const liveProduct = { ...makeProduct(), currentStock: 99, avgCostBs: 450, avgCostUsd: 4.5, lastCostBs: 500, lastCostUsd: 5, openingDate: '2025-01-01', openingBcvRate: 200 };
  const sourceBefore = { ...liveProduct };
  const result = replay([liveProduct], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 3, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.equal(result.products[0].currentStock, 2);
  assert.equal(result.products[0].avgCostBs, 10);
  assert.equal(result.products[0].lastCostBs, 10);
  assert.deepEqual(liveProduct, sourceBefore, 'no cambia el catálogo vivo');
  const empty = replay([makeProduct()], [] as InventoryMovement[]);
  assert.equal(empty.movements.length, 0);
  assert.equal(empty.products[0].currentStock, 0);
});

test('bloquea devoluciones PEPS de ventas legacy sin detalle de capas', () => {
  assert.throws(() => replay([makeProduct('PEPS')], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-03', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100, correctionForMovementId: 'sale-1' })
  ]), /no puede reconstruirse con precisión/);
});

test('reconstruye devoluciones PEPS con capas exactas y conserva su composición para ventas posteriores', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'purchase-2', date: '2010-01-02', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-03', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-04', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 999, unitCostUsd: 9.99, bcvRate: 100, correctionForMovementId: 'sale-1' }),
    movement({ id: 'sale-2', date: '2010-01-05', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.deepEqual(result.movements[2].fifoLayers?.map(layer => [layer.quantity, layer.unitCostBs]), [[2, 10], [1, 20]]);
  assert.deepEqual(result.movements[3].fifoLayers?.map(layer => [layer.quantity, layer.unitCostBs]), [[1, 10]]);
  assert.equal(result.movements[3].totalCostBs, 10);
  assert.equal(result.movements[4].totalCostBs, 30, 'la siguiente salida consume primero la capa remanente de 20 Bs y luego la devolución de 10 Bs');
  assert.equal(result.products[0].currentStock, 0);
});

test('distribuye varias devoluciones parciales de una venta PEPS sin repetir capas', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'purchase-2', date: '2010-01-02', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-03', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-04', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, correctionForMovementId: 'sale-1' }),
    movement({ id: 'return-2', date: '2010-01-04', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, correctionForMovementId: 'sale-1' }),
    movement({ id: 'sale-2', date: '2010-01-05', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.deepEqual(result.movements[3].fifoLayers?.map(layer => [layer.quantity, layer.unitCostBs]), [[1, 10]]);
  assert.deepEqual(result.movements[4].fifoLayers?.map(layer => [layer.quantity, layer.unitCostBs]), [[1, 10]]);
  assert.equal(result.movements[5].totalCostBs, 30);
  assert.equal(result.products[0].currentStock, 0);
});
test('reconstruye compras, salidas y ajustes en bolívares sin exigir tasa cambiaria', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-bs', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 3, unitCostBs: 12, unitCostUsd: 0, bcvRate: 0 }),
    movement({ id: 'sale-bs', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 0 }),
    movement({ id: 'adjustment-bs', date: '2010-01-03', type: 'AJUSTE', concept: 'AJUSTE', quantity: 1, unitCostBs: 7, unitCostUsd: 0, bcvRate: 0, balanceQty: 3 })
  ]);
  assert.deepEqual(result.movements.map(item => item.balanceQty), [3, 2, 3]);
  assert.deepEqual(result.movements.map(item => item.totalCostBs), [36, 12, 7]);
  assert.equal(result.products[0].currentStock, 3);
  assert.equal(result.products[0].avgCostBs, 31 / 3);
  assert.equal(result.products[0].avgCostUsd, 0);
  assert.equal(result.products[0].lastCostUsd, 0);
});

test('conserva costos USD expresos en registros históricos sin tasa de conversión', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-usd', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 2, bcvRate: 0 }),
    movement({ id: 'sale-usd', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 0 }),
    movement({ id: 'adjustment-usd', date: '2010-01-03', type: 'AJUSTE', concept: 'AJUSTE', quantity: 1, unitCostBs: 5, unitCostUsd: 1, bcvRate: 0, balanceQty: 2 })
  ]);
  assert.equal(result.movements[0].totalCostUsd, 4);
  assert.equal(result.movements[1].totalCostUsd, 2);
  assert.equal(result.movements[2].totalCostUsd, 1);
  assert.equal(result.products[0].avgCostUsd, 1.5);
});

test('ajuste negativo conserva costos USD y saldos finitos cuando no existe tasa BCV', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-negative-usd', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 2, bcvRate: 0 }),
    movement({ id: 'adjustment-negative-usd', date: '2010-01-02', type: 'AJUSTE', concept: 'AJUSTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 0, balanceQty: 1 })
  ]);
  assert.equal(result.movements[1].totalCostUsd, 2);
  assert.equal(result.movements[1].unitCostUsd, 2);
  assert.equal(result.products[0].currentStock, 1);
  assert.equal(result.products[0].avgCostUsd, 2);
  assert.ok(result.movements.every(item => Number.isFinite(item.totalCostUsd) && Number.isFinite(item.balanceTotalUsd)));
});


test('limita el recálculo a la fecha final solicitada sin incluir movimientos posteriores', () => {
  const products = [makeProduct()];
  const movements = [
    movement({ id: 'buy-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 5, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'buy-later', date: '2010-01-03', type: 'ENTRADA', concept: 'COMPRA', quantity: 4, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 })
  ];
  const result = replayHistoricalInventory({ companyId, startDate: '2010-01-01', throughDate: '2010-01-02', products, movements });
  assert.deepEqual(result.processedMovementIds, ['buy-1', 'sale-1']);
  assert.equal(result.products[0].currentStock, 3);
  assert.equal(result.products[0].avgCostBs, 10);
  assert.equal(result.endDate, '2010-01-02');
});

test('rechaza una fecha final inválida o anterior al inicio del replay', () => {
  const products = [makeProduct()];
  const movements: InventoryMovement[] = [];
  assert.throws(() => replayHistoricalInventory({ companyId, startDate: '2010-01-01', throughDate: '2009-12-31', products, movements }), /fecha final/);
  assert.throws(() => replayHistoricalInventory({ companyId, startDate: '2010-01-01', throughDate: '2010-02-30', products, movements }), /fecha final/);
});

test('recalcula automáticamente los costos posteriores cuando se inserta una compra histórica tardía', () => {
  const originalSources = [
    movement({ id: 'purchase-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'purchase-3', date: '2010-01-03', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 30, unitCostUsd: 0.3, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-04', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ];
  const beforeLateEntry = replay([makeProduct()], originalSources);
  assert.equal(beforeLateEntry.movements[2].totalCostBs, 60);
  assert.equal(beforeLateEntry.products[0].currentStock, 1);
  const latePurchase = movement({ id: 'purchase-2-late', date: '2010-01-02', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 });
  const reconstructed = replay([makeProduct()], [...originalSources, latePurchase]);
  assert.deepEqual(reconstructed.movements.map(item => item.id), ['purchase-1', 'purchase-2-late', 'purchase-3', 'sale-1']);
  assert.equal(reconstructed.movements[3].totalCostBs, 60, 'el costo promedio cronológico sigue siendo 20 Bs. tras incorporar la compra intermedia');
  assert.equal(reconstructed.products[0].currentStock, 3);
  assert.equal(reconstructed.products[0].avgCostBs, 20);
  assert.equal(originalSources[2].totalCostBs, 0, 'los movimientos fuente no se modifican al recalcular');
});
