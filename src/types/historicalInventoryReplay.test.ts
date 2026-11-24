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
  balanceQty: overrides.balanceQty ?? 0, balanceTotalBs: 0, balanceTotalUsd: 0,
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
  assert.deepEqual(result.movements[2].consumedFifoLayers, [
    { sourceMovementId: 'layer-first', documentRef: 'layer-first', date: '2010-01-01', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1 },
    { sourceMovementId: 'layer-second', documentRef: 'layer-second', date: '2010-01-01', quantity: 1, unitCostBs: 20, unitCostUsd: 0.2 }
  ]);
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

test('bloquea movimientos anteriores a la fecha de inicio y movimientos de otra empresa', () => {
  assert.throws(() => replay([makeProduct()], [
    movement({ id: 'old', date: '2009-12-31', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 1, unitCostUsd: 0.01, bcvRate: 100 })
  ]), /fuera del rango/);
  const foreign = { ...movement({ id: 'foreign', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 1, unitCostUsd: 0.01, bcvRate: 100 }), companyId: 'other-company' };
  assert.throws(() => replay([makeProduct()], [foreign]), /otra empresa/);
});

test('exige productos preparados y fechas válidas', () => {
  assert.throws(() => replay([{ ...makeProduct(), currentStock: 1 }], []), /existencia y costos iniciales en cero/);
  assert.throws(() => replay([{ ...makeProduct(), openingDate: '2026-01-01' }], []), /no está preparado/);
  const empty = replay([makeProduct()], [] as InventoryMovement[]);
  assert.equal(empty.movements.length, 0);
  assert.equal(empty.products[0].currentStock, 0);
});

test('PEPS devuelve unidades a las capas originales y las ventas posteriores las consumen con su costo fuente', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'layer-first', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, bcvRate: 100 }),
    movement({ id: 'layer-second', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-03', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 2, unitCostBs: 999, unitCostUsd: 9.99, bcvRate: 100, correctionForMovementId: 'sale-1' }),
    movement({ id: 'sale-after-return', date: '2010-01-04', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.equal(result.movements[3].totalCostBs, 20);
  assert.equal(result.movements[3].totalCostUsd, 0.2);
  assert.deepEqual(result.movements[3].consumedFifoLayers, [
    { sourceMovementId: 'layer-first', date: '2010-01-01', documentRef: 'layer-first', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1 }
  ]);
  assert.equal(result.movements[4].totalCostBs, 30, 'consume primero la capa restante anterior y luego la capa restitituida, con sus costos fuente');
  assert.deepEqual(result.movements[4].consumedFifoLayers, [
    { sourceMovementId: 'layer-second', date: '2010-01-01', documentRef: 'layer-second', quantity: 1, unitCostBs: 20, unitCostUsd: 0.2 },
    { sourceMovementId: 'layer-first', date: '2010-01-01', documentRef: 'layer-first', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1 }
  ]);
  assert.equal(result.products[0].currentStock, 1);
});

test('PEPS admite devoluciones parciales acumuladas y rechaza exceder la venta original', () => {
  const source = [
    movement({ id: 'layer-1', date: '2010-01-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 3, unitCostBs: 12, unitCostUsd: 0.12, bcvRate: 100 }),
    movement({ id: 'sale-1', date: '2010-01-02', type: 'SALIDA', concept: 'VENTA', quantity: 2, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 }),
    movement({ id: 'return-1', date: '2010-01-03', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, correctionForMovementId: 'sale-1' }),
    movement({ id: 'return-2', date: '2010-01-04', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, correctionForMovementId: 'sale-1' })
  ];
  const result = replay([makeProduct('PEPS')], source);
  assert.equal(result.products[0].currentStock, 3);
  assert.equal(result.movements[2].totalCostBs, 12);
  assert.equal(result.movements[3].totalCostBs, 12);
  assert.throws(() => replay([makeProduct('PEPS')], [...source,
    movement({ id: 'return-over', date: '2010-01-05', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, correctionForMovementId: 'sale-1' })
  ]), /superan la cantidad de la venta original/);
});


test('normaliza costos Bs históricos al cambiar de reconversión antes de ponderar o consumir', () => {
  const result = replay([makeProduct()], [
    movement({ id: 'purchase-2018', date: '2018-08-20', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 }),
    movement({ id: 'purchase-2021', date: '2021-10-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 })
  ]);
  assert.equal(result.products[0].avgCostBs, 50);
  assert.equal(result.movements[1].totalCostBs, 100);
  assert.equal(result.movements[1].balanceTotalBs, 100);
});

test('PEPS reconvierte las capas Bs antiguas al día de consumo sin alterar USD', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'layer-2018', date: '2018-08-20', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 }),
    movement({ id: 'layer-2021', date: '2021-10-01', type: 'ENTRADA', concept: 'COMPRA', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 }),
    movement({ id: 'sale-2021', date: '2021-10-02', type: 'SALIDA', concept: 'VENTA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100 })
  ]);
  assert.equal(result.movements[2].totalCostBs, 0);
  assert.equal(result.movements[2].totalCostUsd, 1);
  assert.equal(result.products[0].avgCostBs, 100);
});

test('PEPS reconvierte las capas antes de disminuir existencia con un ajuste posterior', () => {
  const result = replay([makeProduct('PEPS')], [
    movement({ id: 'layer-2018', date: '2018-08-20', type: 'ENTRADA', concept: 'COMPRA', quantity: 2, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100 }),
    movement({ id: 'adjust-2021', date: '2021-10-01', type: 'AJUSTE', concept: 'AJUSTE_EXISTENCIA', quantity: 1, unitCostBs: 0, unitCostUsd: 0, bcvRate: 100, balanceQty: 1 })
  ]);
  assert.equal(result.movements[1].balanceQty, 1, 'conserva la existencia objetivo del ajuste');
  assert.equal(result.movements[1].totalCostBs, 0);
  assert.equal(result.movements[1].totalCostUsd, 1);
  assert.equal(result.movements[1].balanceTotalBs, 0);
  assert.equal(result.movements[1].balanceTotalUsd, 1);
  assert.equal(result.products[0].avgCostUsd, 1);
});
