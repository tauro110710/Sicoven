export type InventoryPricingMode = 'MANUAL' | 'AUTOMATIC';
export type InventoryPricingBasis = 'COST' | 'SALE';

export interface InventoryPricingConfiguration {
  mode: InventoryPricingMode;
  basis: InventoryPricingBasis;
  /** Porcentajes independientes para Precio 1..4. */
  margins: [number, number, number, number];
  applyExchangeGap: boolean;
  /** Tasas expresadas en Bs. por unidad de la misma divisa (USD o EUR). */
  referenceRate?: number;
  replacementRate?: number;
}

export interface InventoryPricingResult {
  prices: [number, number, number, number];
  exchangeGapPercent: number;
  exchangeFactor: number;
}

/**
 * Calcula precios comerciales sin tocar el costo contable del inventario.
 * El factor de brecha compara dos tasas de la misma divisa; nunca sustituye
 * la tasa BCV histórica/fiscal registrada en cada operación.
 */
export function calculateInventoryPrices(input: {
  baseCost: number;
  configuration: InventoryPricingConfiguration;
}): InventoryPricingResult {
  const { baseCost, configuration } = input;
  if (!Number.isFinite(baseCost) || baseCost < 0) {
    throw new Error('El costo base debe ser un importe finito no negativo.');
  }
  if (!configuration || !['MANUAL', 'AUTOMATIC'].includes(configuration.mode) ||
      !['COST', 'SALE'].includes(configuration.basis) ||
      !Array.isArray(configuration.margins) || configuration.margins.length !== 4) {
    throw new Error('La configuración de precios está incompleta o no es válida.');
  }
  const margins = configuration.margins.map(Number);
  if (margins.some(value => !Number.isFinite(value) || value < 0 || value >= 100)) {
    throw new Error('Cada porcentaje debe estar entre 0% y menos de 100%.');
  }

  let exchangeFactor = 1;
  let exchangeGapPercent = 0;
  if (configuration.applyExchangeGap) {
    const referenceRate = Number(configuration.referenceRate);
    const replacementRate = Number(configuration.replacementRate);
    if (!Number.isFinite(referenceRate) || referenceRate <= 0 ||
        !Number.isFinite(replacementRate) || replacementRate <= 0) {
      throw new Error('La protección cambiaria requiere ambas tasas positivas y verificables.');
    }
    exchangeFactor = replacementRate / referenceRate;
    exchangeGapPercent = (exchangeFactor - 1) * 100;
    if (!Number.isFinite(exchangeFactor) || exchangeFactor <= 0) {
      throw new Error('El factor de brecha cambiaria no es válido.');
    }
  }

  const prices = margins.map(margin => {
    if (configuration.mode === 'MANUAL') return 0;
    const basePrice = configuration.basis === 'COST'
      ? baseCost * (1 + margin / 100)
      : (margin === 0 ? baseCost : baseCost / (1 - margin / 100));
    const result = basePrice * exchangeFactor;
    if (!Number.isFinite(result) || result < 0) {
      throw new Error('El cálculo produjo un precio no válido.');
    }
    return Math.round((result + Number.EPSILON) * 100) / 100;
  }) as [number, number, number, number];

  return { prices, exchangeGapPercent, exchangeFactor };
}

export const DEFAULT_INVENTORY_PRICING: InventoryPricingConfiguration = {
  mode: 'MANUAL',
  basis: 'COST',
  margins: [30, 20, 15, 10],
  applyExchangeGap: false
};
