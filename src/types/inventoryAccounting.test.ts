import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateWeightedAverageCost,
  calculateWeightedAverageCostDual,
  calculateFifoIssue,
  applyFifoAdjustment,
  reconstructFifoLayers,
  validateInventoryMovement,
  normalizeProductionRecipe,
  getDefaultInventoryAccountCode,
  calculateVnrWriteDown,
  calculatePeriodicCostOfSales,
  calculateVnrProvisionLedgerBalance,
  isUsdInventoryValuationAvailable,
  prepareProductsForHistoricalReconstruction
} from './inventoryAccounting';

describe('disponibilidad de valoración USD del inventario', () => {
  it('marca como no disponible el USD si la existencia activa no conserva costo/tasa histórica', () => {
    assert.equal(isUsdInventoryValuationAvailable({ currentStock: 4, avgCostUsd: 0, openingBcvRate: 0 }, []), false);
    assert.equal(isUsdInventoryValuationAvailable({ currentStock: 4, avgCostUsd: 2, openingBcvRate: 100 }, [{ bcvRate: 0 }]), false);
    assert.equal(isUsdInventoryValuationAvailable({ currentStock: 4, avgCostUsd: 2, openingBcvRate: 100 }, [{ bcvRate: Number.NaN }]), false);
  });
  it('permite USD cuando existencia activa tiene costos y tasas positivas, y no bloquea productos sin stock', () => {
    assert.equal(isUsdInventoryValuationAvailable({ currentStock: 3, avgCostUsd: 1.25, openingBcvRate: 100 }, [{ bcvRate: 100 }, { bcvRate: 200 }]), true);
    assert.equal(isUsdInventoryValuationAvailable({ currentStock: 0, avgCostUsd: 0, openingBcvRate: 0 }, []), true);
  });
});


describe('motor de inventario contable', () => {
  it('recalcula el costo promedio ponderado sin perder el costo previo', () => {
    const result = calculateWeightedAverageCost(10, 100, 5, 160, 80);
    assert.equal(result.quantity, 15);
    assert.equal(result.totalCostBs, 1800);
    assert.equal(result.unitCostBs, 120);
    assert.equal(result.unitCostUsd, 1.5);
  });

  it('preserves historical USD cost when the BCV rate changes', () => {
    const result = calculateWeightedAverageCostDual(10, 100, 2, 5, 160, 2.5);
    assert.equal(result.quantity, 15);
    assert.equal(result.totalCostBs, 1800);
    assert.equal(result.totalCostUsd, 32.5);
    assert.equal(result.unitCostBs, 120);
    assert.equal(result.unitCostUsd, 32.5 / 15);
  });

  it('applies explicit half-away-from-zero rounding to weighted dual-currency totals', () => {
    const result = calculateWeightedAverageCostDual(1, 1.005, 1.0000005, 1, 0, 0);
    assert.equal(result.totalCostBs, 1.01);
    assert.equal(result.totalCostUsd, 1.000001);
    assert.equal(result.unitCostBs, 0.505);
    assert.equal(result.unitCostUsd, 0.5000005);
  });

  it('accumulates PEPS layer products exactly before the currency rounding boundary', () => {
    const result = calculateFifoIssue([
      { quantity: 1, unitCostBs: 1.005, unitCostUsd: 1.0000005, date: '2026-01-01' },
      { quantity: 1, unitCostBs: 0, unitCostUsd: 0, date: '2026-01-02' }
    ], 2);
    assert.equal(result.totalCostBs, 1.01);
    assert.equal(result.totalCostUsd, 1.000001);
    assert.equal(result.unitCostBs, 0.505);
    assert.equal(result.unitCostUsd, 0.5000005);
  });

  it('capitalizes landed costs into the weighted average', () => {
    const result = calculateWeightedAverageCost(10, 100, 5, 180, 80);
    assert.ok(Math.abs(result.unitCostBs - (1900 / 15)) < 1e-8);
    assert.equal(result.totalCostBs, 1900);
  });

  it('reconstruye capas PEPS desde el Kardex y valida la existencia actual', () => {
    const layers = reconstructFifoLayers([
      { type: 'ENTRADA', quantity: 5, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', balanceQty: 5 },
      { type: 'ENTRADA', quantity: 3, unitCostBs: 20, unitCostUsd: 2, date: '2026-01-02', balanceQty: 8 },
      { type: 'SALIDA', quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-03', balanceQty: 6 }
    ], 6);
    assert.deepEqual(layers.map(layer => layer.quantity), [3, 3]);
    assert.equal(layers[0].unitCostBs, 10);
    assert.equal(layers[1].unitCostBs, 20);
  });

  it('restaura devoluciones de clientes PEPS como capas originales independientes', () => {
    const layers = reconstructFifoLayers([
      { id: 'purchase-1', type: 'ENTRADA', quantity: 2, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-01-01', balanceQty: 2 },
      { id: 'purchase-2', type: 'ENTRADA', quantity: 2, unitCostBs: 20, unitCostUsd: 0.2, date: '2026-01-02', balanceQty: 4 },
      { id: 'sale-1', type: 'SALIDA', concept: 'VENTA', quantity: 3, unitCostBs: 0, unitCostUsd: 0, date: '2026-01-03', balanceQty: 1 },
      { id: 'return-1', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-01-04', balanceQty: 2,
        fifoLayers: [{ quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-01-04', sourceMovementId: 'purchase-1' }] }
    ], 2);
    assert.deepEqual(layers.map(layer => [layer.quantity, layer.unitCostBs, layer.sourceMovementId]), [[1, 20, 'purchase-2'], [1, 10, 'purchase-1']]);
    assert.throws(() => reconstructFifoLayers([
      { id: 'purchase-1', type: 'ENTRADA', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-01-01', balanceQty: 1 },
      { id: 'return-1', type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-01-02', balanceQty: 2,
        fifoLayers: [{ quantity: 1, unitCostBs: 10, unitCostUsd: 0.1, date: '2026-02-30' }] }
    ], 2), /no concilian con su cantidad o costos/);
  });


  it('descarga una devolución a proveedor de su capa PEPS original y no de la capa más antigua', () => {
    const layers = reconstructFifoLayers([
      { id: 'purchase-old', type: 'ENTRADA', quantity: 5, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', documentRef: 'FAC-OLD', balanceQty: 5 },
      { id: 'purchase-target', type: 'ENTRADA', quantity: 3, unitCostBs: 20, unitCostUsd: 2, date: '2026-01-02', documentRef: 'FAC-TARGET', balanceQty: 8 },
      { id: 'supplier-return', type: 'SALIDA', concept: 'DEVOLUCION_COMPRA', correctionForMovementId: 'purchase-target',
        quantity: 1, unitCostBs: 20, unitCostUsd: 2, date: '2026-01-03', documentRef: 'NC-PROV-1', balanceQty: 7 }
    ], 7);
    assert.equal(layers.find(layer => layer.sourceMovementId === 'purchase-old')?.quantity, 5);
    assert.equal(layers.find(layer => layer.sourceMovementId === 'purchase-target')?.quantity, 2);
  });

  it('bloquea devoluciones PEPS históricas sin vínculo a la entrada original', () => {
    assert.throws(() => reconstructFifoLayers([
      { id: 'purchase-1', type: 'ENTRADA', quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', documentRef: 'FAC-1', balanceQty: 2 },
      { id: 'return-1', type: 'SALIDA', concept: 'DEVOLUCION_COMPRA', quantity: 1, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-02', documentRef: 'NC-1', balanceQty: 1 }
    ], 1), /no identifica la entrada original/);
  });

  it('bloquea PEPS si faltan capas de apertura o un movimiento excede las capas existentes', () => {
    assert.throws(() => reconstructFifoLayers([
      { type: 'ENTRADA', quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', balanceQty: 2 }
    ], 3), /no coinciden con la existencia actual/);
    assert.throws(() => reconstructFifoLayers([
      { type: 'SALIDA', quantity: 1, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', balanceQty: 0 }
    ], 0), /no contiene cantidad suficiente en la capa FIFO/);
  });

  it('bloquea PEPS cuando los saldos históricos no concilian', () => {
    assert.throws(() => reconstructFifoLayers([
      { type: 'ENTRADA', quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01', balanceQty: 3 }
    ], 3), /saldo de Kardex no concilia/);
  });

  it('PEPS consume primero las capas más antiguas', () => {
    const result = calculateFifoIssue([
      { quantity: 5, unitCostBs: 20, unitCostUsd: 2, date: '2026-02-01' },
      { quantity: 4, unitCostBs: 30, unitCostUsd: 3, date: '2026-01-01' }
    ], 6);
    assert.equal(result.totalCostBs, 160);
    assert.equal(result.totalCostUsd, 16);
    assert.equal(result.unitCostBs, 160 / 6);
  });

  it('rejects PEPS issues when the available layers are insufficient', () => {
    assert.throws(() => calculateFifoIssue([
      { quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01' }
    ], 3), /Existencia insuficiente/);
  });

  it('preserves six decimal places in the USD valuation of FIFO layers', () => {
    const result = calculateFifoIssue([
      { quantity: 1, unitCostBs: 10, unitCostUsd: 0.123456, date: '2026-01-01' },
      { quantity: 1, unitCostBs: 20, unitCostUsd: 0.234567, date: '2026-01-02' }
    ], 2);
    assert.equal(result.totalCostUsd, 0.358023);
    assert.equal(result.unitCostUsd, 0.1790115);
  });

  it('rejects malformed FIFO layers instead of silently dropping them', () => {
    assert.throws(() => calculateFifoIssue([
      { quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01' },
      { quantity: 1, unitCostBs: Number.NaN, unitCostUsd: 1, date: '2026-01-02' }
    ], 1), /Una capa PEPS contiene/);
  });

  it('PEPS registra sobrantes como una nueva capa sin promediar las anteriores', () => {
    const result = applyFifoAdjustment([{ quantity: 4, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01' }], 3, 25, 2.5, '2026-01-03', 'AJ-PLUS');
    assert.equal(result.totalCostBs, 75); assert.equal(result.totalCostUsd, 7.5);
    assert.equal(result.balanceTotalBs, 115); assert.equal(result.balanceTotalUsd, 11.5);
    assert.deepEqual(result.remainingLayers.map(layer => [layer.quantity, layer.unitCostBs]), [[4, 10], [3, 25]]);
  });
  it('PEPS consume las capas más antiguas en ajustes negativos y conserva costos históricos', () => {
    const result = applyFifoAdjustment([{ quantity: 5, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01' }, { quantity: 4, unitCostBs: 20, unitCostUsd: 2, date: '2026-01-02' }], -6, 0, 0, '2026-01-03', 'AJ-MINUS');
    assert.equal(result.totalCostBs, 70); assert.equal(result.totalCostUsd, 7);
    assert.equal(result.balanceTotalBs, 60); assert.equal(result.balanceTotalUsd, 6);
    assert.deepEqual(result.remainingLayers.map(layer => [layer.quantity, layer.unitCostBs]), [[3, 20]]);
  });
  it('PEPS rechaza ajustes negativos superiores a las capas disponibles', () => {
    assert.throws(() => applyFifoAdjustment([{ quantity: 2, unitCostBs: 10, unitCostUsd: 1, date: '2026-01-01' }], -3, 0, 0, '2026-01-02'), /Existencia insuficiente/);
  });
  it('rechaza salidas superiores a la existencia', () => {
    assert.match(validateInventoryMovement({
      date: '2026-10-25', quantity: 3, bcvRate: 100, unitCostBs: 20,
      availableQuantity: 2, type: 'SALIDA'
    }) || '', /Existencia insuficiente/);
  });

  it('rechaza una fecha calendario imposible', () => {
    assert.match(validateInventoryMovement({
      date: '2026-02-30', quantity: 1, bcvRate: 100, unitCostBs: 20,
      availableQuantity: 2, type: 'ENTRADA'
    }) || '', /fecha.*no es válida/i);
  });

  it('asigna la cuenta de inventario por defecto según el tipo de artículo', () => {
    assert.equal(getDefaultInventoryAccountCode('MERCANCIA'), '1.1.4.01');
    assert.equal(getDefaultInventoryAccountCode('MATERIA_PRIMA'), '1.1.4.02');
    assert.equal(getDefaultInventoryAccountCode('PRODUCTO_EN_PROCESO'), '1.1.4.04');
    assert.equal(getDefaultInventoryAccountCode('PRODUCTO_TERMINADO'), '1.1.4.01');
    assert.equal(getDefaultInventoryAccountCode('SUBPRODUCTO'), '1.1.4.01');
    assert.equal(getDefaultInventoryAccountCode(undefined), '1.1.4.01');
  });

  it('consolida componentes repetidos de una matriz de producción', () => {
    assert.deepEqual(normalizeProductionRecipe([
      { productId: 'raw-1', quantityPerUnit: 2 },
      { productId: 'raw-2', quantityPerUnit: 1 },
      { productId: 'raw-1', quantityPerUnit: 3 }
    ], 'finished-1'), [
      { productId: 'raw-1', quantityPerUnit: 5 },
      { productId: 'raw-2', quantityPerUnit: 1 }
    ]);
  });

  it('rechaza componentes de producción inválidos o referencias circulares directas', () => {
    assert.throws(() => normalizeProductionRecipe([{ productId: 'finished-1', quantityPerUnit: 1 }], 'finished-1'), /componentes inválidos/);
    assert.throws(() => normalizeProductionRecipe([{ productId: 'raw-1', quantityPerUnit: Number.NaN }], 'finished-1'), /componentes inválidos/);
    assert.throws(() => normalizeProductionRecipe([{ productId: 'raw-1', quantityPerUnit: 1e309 }], 'finished-1'), /componentes inválidos/);
  });

  it('calcula una provisión cuando el VNR cae por debajo del costo', () => {
    const result = calculateVnrWriteDown({
      quantity: 10, unitCostBs: 100, estimatedSellingPricePerUnitBs: 90,
      completionCostPerUnitBs: 5, sellingCostPerUnitBs: 10
    });
    assert.equal(result.carryingValueBs, 1000);
    assert.equal(result.netRealizableValueBs, 750);
    assert.equal(result.writeDownBs, 250);
    assert.equal(result.required, true);
  });

  it('calcula el costo de ventas periódico', () => {
    assert.equal(calculatePeriodicCostOfSales({
      openingInventoryBs: 10000, purchasesAndLandedCostsBs: 6000, closingInventoryBs: 4000
    }), 12000);
  });

  it('rechaza un cierre cuyo inventario final exceda los recursos disponibles', () => {
    assert.throws(() => calculatePeriodicCostOfSales({
      openingInventoryBs: 1000, purchasesAndLandedCostsBs: 200, closingInventoryBs: 1500
    }), /inventario final supera/i);
  });
});

describe('reconstrucción de provisión VNR desde el Libro Diario', () => {
  const line = (overrides: Partial<{accountCode:string;debitBs:number;creditBs:number;debitUsd:number;creditUsd:number}> = {}) => ({
    accountCode: '1.1.4.03', debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0, ...overrides
  });

  it('reconstruye Bs. y USD acumulados sin recalcular el histórico a la tasa actual', () => {
    const result = calculateVnrProvisionLedgerBalance('ART-01', [
      { id:'vnr-1', referenceDoc:'VNR-ART-01-2026-01-31', items:[line({creditBs:1000,creditUsd:10})] },
      { id:'vnr-2', referenceDoc:'VNR-ART-01-2026-02-28', items:[line({creditBs:500,creditUsd:4})] },
      { id:'other', referenceDoc:'VNR-ART-02-2026-02-28', items:[line({creditBs:9000,creditUsd:90})] }
    ]);
    assert.deepEqual(result, {provisionBs:1500,provisionUsd:14,entryCount:2});
  });

  it('includes a reversal and a subsequent reversal-of-reversal', () => {
    const result = calculateVnrProvisionLedgerBalance('ART-01', [
      { id:'vnr-1', referenceDoc:'VNR-ART-01-2026-01-31', items:[line({creditBs:1000,creditUsd:10})] },
      { id:'rev-1', reversalOfEntryId:'vnr-1', referenceDoc:'REV-1', items:[line({debitBs:200,debitUsd:2})] },
      { id:'rev-2', reversalOfEntryId:'rev-1', referenceDoc:'REV-2', items:[line({creditBs:50,creditUsd:0.5})] }
    ]);
    assert.deepEqual(result, {provisionBs:850,provisionUsd:8.5,entryCount:3});
  });

  it('rejects reversal balances below zero and malformed ledger values', () => {
    assert.throws(() => calculateVnrProvisionLedgerBalance('ART-01', [
      { id:'vnr-1', referenceDoc:'VNR-ART-01-2026-01-31', items:[line({debitBs:1})] }
    ]), /reversiones.*exceden/i);
    assert.throws(() => calculateVnrProvisionLedgerBalance('ART-01', [
      { id:'vnr-1', referenceDoc:'VNR-ART-01-2026-01-31', items:[line({creditUsd:Number.NaN})] }
    ]), /importes inválidos/i);
  });
  it('clears current costs and opening BCV snapshot while preserving catalog and selling prices', () => {
    const [prepared] = prepareProductsForHistoricalReconstruction([{
      id: 'p-1', code: 'ART-001', name: 'Artículo', currentStock: 0,
      avgCostBs: 917.7751, avgCostUsd: 1, lastCostBs: 917.7751, lastCostUsd: 1,
      openingDate: '2026-11-19', openingBcvRate: 917.7751,
      price1: 12.5, salesPriceBs: 11470, salesPriceUsd: 12.5
    }], '2026-01-01');
    assert.equal(prepared.avgCostBs, 0);
    assert.equal(prepared.avgCostUsd, 0);
    assert.equal(prepared.lastCostBs, 0);
    assert.equal(prepared.lastCostUsd, 0);
    assert.equal(prepared.openingDate, '2026-01-01');
    assert.equal(prepared.openingBcvRate, 0);
    assert.equal(prepared.currentStock, 0);
    assert.equal(prepared.code, 'ART-001');
    assert.equal(prepared.name, 'Artículo');
    assert.equal(prepared.price1, 12.5);
    assert.equal(prepared.salesPriceBs, 11470);
  });

  it('accepts reconstruction start dates in prior accounting years such as 2010 and 2000', () => {
    for (const startDate of ['2010-01-01', '2000-01-01']) {
      const [prepared] = prepareProductsForHistoricalReconstruction([{
        id: 'historical-' + startDate, code: 'ART-HIST', name: 'Artículo histórico', currentStock: 0,
        avgCostBs: 100, avgCostUsd: 1, lastCostBs: 100, lastCostUsd: 1,
        openingDate: '2026-01-01', openingBcvRate: 874.7
      }], startDate);
      assert.equal(prepared.openingDate, startDate);
      assert.equal(prepared.openingBcvRate, 0);
      assert.equal(prepared.avgCostBs, 0);
    }
  });

  it('rejects an invalid historical reconstruction start date', () => {
    assert.throws(() => prepareProductsForHistoricalReconstruction([], '2026-02-30'), /fecha inicial/i);
  });

});
