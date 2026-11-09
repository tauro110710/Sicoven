import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateInventoryPrices, DEFAULT_INVENTORY_PRICING } from './inventoryPricing';

describe('calculateInventoryPrices', () => {
  it('applies markup over cost independently to four price levels', () => {
    const result = calculateInventoryPrices({
      baseCost: 10,
      configuration: { ...DEFAULT_INVENTORY_PRICING, mode: 'AUTOMATIC', margins: [30, 20, 15, 10] }
    });
    assert.deepEqual(result.prices, [13, 12, 11.5, 11]);
    assert.equal(result.exchangeFactor, 1);
  });

  it('calculates gross margin over final selling price, not markup over cost', () => {
    const result = calculateInventoryPrices({
      baseCost: 10,
      configuration: { ...DEFAULT_INVENTORY_PRICING, mode: 'AUTOMATIC', basis: 'SALE', margins: [30, 20, 15, 10] }
    });
    assert.deepEqual(result.prices, [14.29, 12.5, 11.76, 11.11]);
  });

  it('applies the exchange-gap factor after the commercial formula', () => {
    const result = calculateInventoryPrices({
      baseCost: 10,
      configuration: {
        ...DEFAULT_INVENTORY_PRICING,
        mode: 'AUTOMATIC',
        margins: [30, 20, 15, 10],
        applyExchangeGap: true,
        referenceRate: 36,
        replacementRate: 42
      }
    });
    assert.deepEqual(result.prices, [15.17, 14, 13.42, 12.83]);
    assert.equal(Number(result.exchangeGapPercent.toFixed(2)), 16.67);
  });

  it('rejects a missing or invalid reference/replacement rate', () => {
    assert.throws(() => calculateInventoryPrices({
      baseCost: 10,
      configuration: { ...DEFAULT_INVENTORY_PRICING, mode: 'AUTOMATIC', applyExchangeGap: true, referenceRate: 36 }
    }), /ambas tasas positivas/);
  });

  it('rejects a 100% sales margin to prevent division by zero', () => {
    assert.throws(() => calculateInventoryPrices({
      baseCost: 10,
      configuration: { ...DEFAULT_INVENTORY_PRICING, mode: 'AUTOMATIC', basis: 'SALE', margins: [100, 20, 15, 10] }
    }), /menos de 100%/);
  });

  it('does not alter a cost or return calculated prices in manual mode', () => {
    const result = calculateInventoryPrices({
      baseCost: 10,
      configuration: { ...DEFAULT_INVENTORY_PRICING, margins: [30, 20, 15, 10] }
    });
    assert.deepEqual(result.prices, [0, 0, 0, 0]);
  });
});
