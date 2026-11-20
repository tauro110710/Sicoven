import { addDecimal, decimalToNumber, decimalToString, divideDecimal, multiplyDecimal, parseDecimal, roundDecimal } from './exactDecimal';

export interface VnrProvisionLedgerBalance {
  provisionBs: number;
  provisionUsd: number;
  entryCount: number;
}

/**
 * Reconstructs the VNR allowance balance from its immutable journal entries.
 * Reversals (including reversals of reversals) follow reversalOfEntryId links.
 * The product's cached Bs. amount is never used to invent a historical USD rate.
 */
export function calculateVnrProvisionLedgerBalance(
  productCode: string,
  journalEntries: Array<{
    id: string;
    referenceDoc?: string;
    reversalOfEntryId?: string;
    items: Array<{
      accountCode: string;
      debitBs: number;
      creditBs: number;
      debitUsd: number;
      creditUsd: number;
    }>;
  }>,
  allowanceAccountCode = '1.1.4.03'
): VnrProvisionLedgerBalance {
  const code = String(productCode || '').trim();
  if (!code || !Array.isArray(journalEntries) || !allowanceAccountCode.trim()) {
    throw new Error('No se puede reconstruir la provisión VNR sin código de artículo, asientos y cuenta correctora válidos.');
  }

  const includedIds = new Set(
    journalEntries
      .filter(entry => String(entry.referenceDoc || '').startsWith('VNR-' + code + '-'))
      .map(entry => String(entry.id))
  );
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const entry of journalEntries) {
      if (entry.reversalOfEntryId && includedIds.has(String(entry.reversalOfEntryId)) && !includedIds.has(String(entry.id))) {
        includedIds.add(String(entry.id));
        expanded = true;
      }
    }
  }

  let provisionBs = 0;
  let provisionUsd = 0;
  let entryCount = 0;
  for (const entry of journalEntries) {
    if (!includedIds.has(String(entry.id))) continue;
    if (!Array.isArray(entry.items)) throw new Error('Un asiento VNR no contiene renglones contables válidos.');
    entryCount += 1;
    for (const line of entry.items) {
      if (line.accountCode !== allowanceAccountCode) continue;
      const values = [line.debitBs, line.creditBs, line.debitUsd, line.creditUsd].map(value => value === undefined || value === null ? 0 : Number(value));
      if (!values.every(value => Number.isFinite(value) && value >= 0)) {
        throw new Error('El historial contable de la provisión VNR contiene importes inválidos.');
      }
      provisionBs += values[1] - values[0];
      provisionUsd += values[3] - values[2];
    }
  }

  if (provisionBs < -0.01 || provisionUsd < -0.000001) {
    throw new Error('Las reversiones del VNR exceden el saldo histórico de la cuenta correctora.');
  }
  return {
    provisionBs: Math.round(Math.max(0, provisionBs) * 100) / 100,
    provisionUsd: Math.round(Math.max(0, provisionUsd) * 1_000_000) / 1_000_000,
    entryCount
  };
}

export type InventoryCostingMethod = 'PROMEDIO_PONDERADO' | 'PEPS';
export type InventoryVatTreatment = 'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO';
export type InventoryItemType = 'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO';

/** Cuenta de inventario por defecto según la naturaleza contable del artículo. */
export function getDefaultInventoryAccountCode(itemType?: InventoryItemType): string {
  if (itemType === 'MATERIA_PRIMA') return '1.1.4.02';
  if (itemType === 'PRODUCTO_EN_PROCESO') return '1.1.4.04';
  return '1.1.4.01';
}

export interface CostLayer {
  quantity: number;
  unitCostBs: number;
  unitCostUsd: number;
  date?: string;
  documentRef?: string;
  sourceMovementId?: string;
}

export interface InventoryCostResult {
  quantity: number;
  totalCostBs: number;
  totalCostUsd: number;
  unitCostBs: number;
  unitCostUsd: number;
}

export interface FifoMovementSnapshot {
  type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
  quantity: number;
  unitCostBs: number;
  unitCostUsd: number;
  date: string;
  documentRef?: string;
  balanceQty: number;
  id?: string;
  concept?: string;
  correctionForMovementId?: string;
}

/**
 * Reconstructs PEPS layers only from the real movement history.
 * It never invents a legacy opening layer to make the current stock balance.
 */
export function reconstructFifoLayers(
  movementsInput: FifoMovementSnapshot[],
  currentStock: number
): CostLayer[] {
  if (!Array.isArray(movementsInput) || !validNonNegative(Number(currentStock))) {
    throw new Error('El Kardex PEPS o la existencia actual no son válidos.');
  }
  const ordered = movementsInput.map((movement, index) => ({ movement, index }))
    .sort((a, b) => a.movement.date.localeCompare(b.movement.date) || a.index - b.index);
  const layers: CostLayer[] = [];
  let runningQuantity = 0;
  const consumeLayers = (quantity: number, reference: string, sourceMovementId?: string) => {
    let remaining = quantity;
    const candidates = sourceMovementId
      ? layers.filter(layer => layer.sourceMovementId === sourceMovementId)
      : layers;
    for (const layer of candidates) {
      const consumed = Math.min(layer.quantity, remaining);
      layer.quantity -= consumed;
      remaining -= consumed;
      if (remaining <= 1e-8) break;
    }
    if (remaining > 1e-8) {
      throw new Error('El historial PEPS no contiene cantidad suficiente en la capa ' +
        (sourceMovementId || 'FIFO') + ' para reconstruir ' + reference + '.');
    }
  };
  for (const { movement } of ordered) {
    const date = String(movement.date || '');
    const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + 'T00:00:00Z') : null;
    if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
      throw new Error('El historial PEPS contiene una fecha inválida.');
    }
    const quantity = Number(movement.quantity);
    const unitCostBs = Number(movement.unitCostBs);
    const unitCostUsd = Number(movement.unitCostUsd);
    const balanceQuantity = Number(movement.balanceQty);
    if (!validNonNegative(unitCostBs) || !validNonNegative(unitCostUsd) ||
        !validNonNegative(balanceQuantity) || !validNonNegative(quantity)) {
      throw new Error('El historial PEPS contiene cantidades, costos o saldos no válidos.');
    }
    if (movement.type === 'ENTRADA') {
      if (!validPositive(quantity)) throw new Error('Una entrada PEPS debe contener una cantidad positiva.');
      layers.push({ quantity, unitCostBs, unitCostUsd, date, documentRef: movement.documentRef, sourceMovementId: movement.id });
      runningQuantity += quantity;
    } else if (movement.type === 'SALIDA') {
      if (!validPositive(quantity)) throw new Error('Una salida PEPS debe contener una cantidad positiva.');
      if (movement.concept === 'DEVOLUCION_COMPRA') {
        if (!movement.correctionForMovementId) throw new Error('Una devolución PEPS a proveedor no identifica la entrada original que debe descargar.');
        consumeLayers(quantity, movement.documentRef || date, movement.correctionForMovementId);
      } else {
        consumeLayers(quantity, movement.documentRef || date);
      }
      runningQuantity -= quantity;
    } else if (movement.type === 'AJUSTE') {
      const delta = balanceQuantity - runningQuantity;
      if (delta > 1e-8) {
        layers.push({ quantity: delta, unitCostBs, unitCostUsd, date, documentRef: movement.documentRef, sourceMovementId: movement.id });
      } else if (delta < -1e-8) {
        consumeLayers(Math.abs(delta), movement.documentRef || date);
      }
      runningQuantity = balanceQuantity;
    } else {
      throw new Error('El historial PEPS contiene un tipo de movimiento desconocido.');
    }
    if (!Number.isFinite(runningQuantity) || runningQuantity < -1e-8 ||
        Math.abs(runningQuantity - balanceQuantity) > 1e-8) {
      throw new Error('El saldo de Kardex no concilia con las capas PEPS en el documento ' + (movement.documentRef || date) + '.');
    }
  }
  if (Math.abs(runningQuantity - Number(currentStock)) > 1e-8) {
    throw new Error('Las capas PEPS reconstruidas (' + runningQuantity + ') no coinciden con la existencia actual (' + currentStock + '). No se crearán capas de costo estimadas.');
  }
  return layers.filter(layer => layer.quantity > 1e-8);
}

const cents = (value: number): number => decimalToNumber(roundDecimal(value, 2));
const usdPrecision = (value: number): number => decimalToNumber(roundDecimal(value, 6));
const exactProductSum = (pairs: Array<[number, number]>): ReturnType<typeof parseDecimal> =>
  pairs.reduce((sum, [quantity, unitCost]) =>
    addDecimal(decimalToString(sum), decimalToString(multiplyDecimal(quantity, unitCost))), parseDecimal(0));
const exactRoundedProductSum = (pairs: Array<[number, number]>, places: number): number =>
  decimalToNumber(roundDecimal(exactProductSum(pairs), places));
const exactQuotient = (dividend: number, divisor: number): number =>
  divisor === 0 ? 0 : decimalToNumber(divideDecimal(dividend, divisor, 18));
const validPositive = (value: number): boolean => Number.isFinite(value) && value > 0;
const validNonNegative = (value: number): boolean => Number.isFinite(value) && value >= 0;

/** Recalcula costo promedio ponderado, sin redondear cantidades intermedias. */
export function calculateWeightedAverageCost(
  existingQuantity: number,
  existingUnitCostBs: number,
  incomingQuantity: number,
  incomingUnitCostBs: number,
  exchangeRate: number
): InventoryCostResult {
  if (!validNonNegative(existingQuantity) || !validNonNegative(existingUnitCostBs) ||
      !validPositive(incomingQuantity) || !validNonNegative(incomingUnitCostBs) ||
      !validPositive(exchangeRate)) {
    throw new Error('Cantidades, costos o tasa BCV inválidos para recalcular el costo promedio.');
  }
  const quantity = decimalToNumber(addDecimal(existingQuantity, incomingQuantity));
  const totalCostBs = exactRoundedProductSum([
    [existingQuantity, existingUnitCostBs],
    [incomingQuantity, incomingUnitCostBs]
  ], 2);
  const totalCostUsd = decimalToNumber(roundDecimal(divideDecimal(totalCostBs, exchangeRate, 6), 6));
  const unitCostBs = quantity > 0 ? exactQuotient(totalCostBs, quantity) : 0;
  const unitCostUsd = quantity > 0 ? exactQuotient(unitCostBs, exchangeRate) : 0;
  return { quantity, totalCostBs, totalCostUsd, unitCostBs, unitCostUsd };
}

/** Recalcula el costo promedio ponderado preservando por separado la valoración histórica en Bs. y USD. */
export function calculateWeightedAverageCostDual(
  existingQuantity: number,
  existingUnitCostBs: number,
  existingUnitCostUsd: number,
  incomingQuantity: number,
  incomingUnitCostBs: number,
  incomingUnitCostUsd: number
): InventoryCostResult {
  if (!validNonNegative(existingQuantity) || !validNonNegative(existingUnitCostBs) ||
      !validNonNegative(existingUnitCostUsd) || !validPositive(incomingQuantity) ||
      !validNonNegative(incomingUnitCostBs) || !validNonNegative(incomingUnitCostUsd)) {
    throw new Error('Cantidades o costos históricos Bs./USD inválidos para recalcular el costo promedio.');
  }
  const quantity = decimalToNumber(addDecimal(existingQuantity, incomingQuantity));
  const totalCostBs = exactRoundedProductSum([
    [existingQuantity, existingUnitCostBs],
    [incomingQuantity, incomingUnitCostBs]
  ], 2);
  const totalCostUsd = exactRoundedProductSum([
    [existingQuantity, existingUnitCostUsd],
    [incomingQuantity, incomingUnitCostUsd]
  ], 6);
  if (!Number.isFinite(quantity) || !Number.isFinite(totalCostBs) || !Number.isFinite(totalCostUsd)) {
    throw new Error('La valoración ponderada dual produjo un importe no finito.');
  }
  return {
    quantity, totalCostBs, totalCostUsd,
    unitCostBs: quantity > 0 ? exactQuotient(totalCostBs, quantity) : 0,
    unitCostUsd: quantity > 0 ? exactQuotient(totalCostUsd, quantity) : 0
  };
}

/** Calcula una salida PEPS consumiendo las capas más antiguas primero. */
export function calculateFifoIssue(layersInput: CostLayer[], quantityToIssue: number): InventoryCostResult {
  if (!validPositive(quantityToIssue)) throw new Error('La cantidad de salida debe ser mayor que cero.');
  if (!Array.isArray(layersInput)) throw new Error('El Kardex PEPS no contiene capas de costo válidas.');
  const layers = layersInput.map(layer => {
    const quantity = Number(layer?.quantity);
    const unitCostBs = Number(layer?.unitCostBs);
    const unitCostUsd = Number(layer?.unitCostUsd);
    if (!validNonNegative(quantity) || !validNonNegative(unitCostBs) || !validNonNegative(unitCostUsd) ||
        (layer.date != null && typeof layer.date !== 'string')) {
      throw new Error('Una capa PEPS contiene cantidad, costo o fecha no válida; no se puede descartar silenciosamente.');
    }
    return { ...layer, quantity, unitCostBs, unitCostUsd };
  }).filter(layer => layer.quantity > 0)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const available = layers.reduce((sum, layer) => sum + layer.quantity, 0);
  if (!Number.isFinite(available)) throw new Error('La existencia acumulada de las capas PEPS no es finita.');
  if (quantityToIssue - available > 1e-8) {
    throw new Error(`Existencia insuficiente para PEPS: disponibles ${available}, solicitadas ${quantityToIssue}.`);
  }
  let remaining = quantityToIssue;
  const consumedLayers: Array<[number, number, number]> = [];
  for (const layer of layers) {
    if (remaining <= 1e-8) break;
    const consumed = Math.min(remaining, layer.quantity);
    consumedLayers.push([consumed, layer.unitCostBs, layer.unitCostUsd]);
    remaining -= consumed;
  }
  if (remaining > 1e-8) {
    throw new Error('No se pudo conciliar el consumo PEPS con las capas disponibles.');
  }
  const totalCostBs = exactRoundedProductSum(consumedLayers.map(([q, bs]) => [q, bs] as [number, number]), 2);
  const totalCostUsd = exactRoundedProductSum(consumedLayers.map(([q, _bs, usd]) => [q, usd] as [number, number]), 6);
  return {
    quantity: quantityToIssue,
    totalCostBs,
    totalCostUsd,
    unitCostBs: exactQuotient(totalCostBs, quantityToIssue),
    unitCostUsd: exactQuotient(totalCostUsd, quantityToIssue)
  };
}

export interface FifoAdjustmentResult extends InventoryCostResult {
  remainingLayers: CostLayer[];
  balanceTotalBs: number;
  balanceTotalUsd: number;
}

/** Applies a signed stock adjustment directly to PEPS layers. */
export function applyFifoAdjustment(layersInput: CostLayer[], delta: number, unitCostBs: number, unitCostUsd: number, date: string, documentRef?: string): FifoAdjustmentResult {
  if (!Array.isArray(layersInput) || !Number.isFinite(delta) || Math.abs(delta) <= 1e-8 || !validNonNegative(unitCostBs) || !validNonNegative(unitCostUsd) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) throw new Error('Los datos del ajuste PEPS no son válidos.');
  const layers = layersInput.map(layer => ({ ...layer })).sort((x, y) => String(x.date || '').localeCompare(String(y.date || '')));
  const available = layers.reduce((sum, layer) => sum + Number(layer.quantity), 0);
  if (!Number.isFinite(available) || layers.some(layer => !validPositive(Number(layer.quantity)) || !validNonNegative(Number(layer.unitCostBs)) || !validNonNegative(Number(layer.unitCostUsd)))) throw new Error('Las capas PEPS disponibles contienen datos inválidos.');
  const quantity = Math.abs(delta);
  let totalCostBs = 0; let totalCostUsd = 0;
  if (delta > 0) {
    totalCostBs = exactRoundedProductSum([[quantity, unitCostBs]], 2); totalCostUsd = exactRoundedProductSum([[quantity, unitCostUsd]], 6);
    layers.push({ quantity, unitCostBs, unitCostUsd, date, documentRef });
  } else {
    if (quantity - available > 1e-8) throw new Error('Existencia insuficiente para PEPS: disponibles ' + available + ', solicitadas ' + quantity + '.');
    const fifo = calculateFifoIssue(layers, quantity); totalCostBs = fifo.totalCostBs; totalCostUsd = fifo.totalCostUsd;
    let remaining = quantity;
    for (const layer of layers) { if (remaining <= 1e-8) break; const consumed = Math.min(layer.quantity, remaining); layer.quantity -= consumed; remaining -= consumed; }
    if (remaining > 1e-8) throw new Error('No se pudo conciliar la reducción del ajuste con las capas PEPS.');
  }
  const remainingLayers = layers.filter(layer => layer.quantity > 1e-8);
  const balanceTotalBs = exactRoundedProductSum(remainingLayers.map(layer => [layer.quantity, layer.unitCostBs] as [number, number]), 2);
  const balanceTotalUsd = exactRoundedProductSum(remainingLayers.map(layer => [layer.quantity, layer.unitCostUsd] as [number, number]), 6);
  return { quantity, totalCostBs, totalCostUsd, unitCostBs: totalCostBs / quantity, unitCostUsd: totalCostUsd / quantity, remainingLayers, balanceTotalBs, balanceTotalUsd };
}
/** Valida los datos comunes antes de aceptar un movimiento del libro de inventario. */
export function validateInventoryMovement(input: {
  date: string;
  quantity: number;
  bcvRate: number;
  unitCostBs: number;
  availableQuantity: number;
  type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
}): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) ||
      new Date(input.date + 'T00:00:00Z').toISOString().slice(0, 10) !== input.date) {
    return 'La fecha del movimiento no es válida.';
  }
  if (!validPositive(input.quantity)) return 'La cantidad debe ser mayor que cero.';
  if (!validPositive(input.bcvRate)) return 'La tasa BCV histórica debe ser mayor que cero.';
  if (!validNonNegative(input.unitCostBs)) return 'El costo unitario no puede ser negativo.';
  if (!validNonNegative(input.availableQuantity)) return 'La existencia disponible no es válida.';
  if (input.type === 'SALIDA' && input.quantity - input.availableQuantity > 1e-8) {
    return `Existencia insuficiente: disponibles ${input.availableQuantity}, solicitadas ${input.quantity}.`;
  }
  return null;
}

/** Normaliza la matriz BOM y consolida componentes repetidos antes de consumir existencias. */
export function normalizeProductionRecipe(
  recipeInput: Array<{ productId: string; quantityPerUnit: number }>,
  finishedProductId: string
): Array<{ productId: string; quantityPerUnit: number }> {
  if (!Array.isArray(recipeInput) || recipeInput.length === 0) {
    throw new Error('Configure primero la matriz insumo-producto del artículo.');
  }
  const quantities = new Map<string, number>();
  for (const line of recipeInput) {
    const productId = String(line?.productId || '').trim();
    const quantity = Number(line?.quantityPerUnit);
    if (!productId || productId === finishedProductId || !Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('La matriz contiene componentes inválidos, cantidades no positivas o una referencia circular directa.');
    }
    const accumulated = (quantities.get(productId) || 0) + quantity;
    if (!Number.isFinite(accumulated) || accumulated <= 0) {
      throw new Error('La cantidad acumulada de un componente de producción no es válida.');
    }
    quantities.set(productId, accumulated);
  }
  return [...quantities.entries()].map(([productId, quantityPerUnit]) => ({ productId, quantityPerUnit }));
}

/** NIC 2: el importe en libros no debe superar el valor neto realizable. */
export function calculateVnrWriteDown(input: {
  quantity: number;
  unitCostBs: number;
  estimatedSellingPricePerUnitBs: number;
  completionCostPerUnitBs: number;
  sellingCostPerUnitBs: number;
}): { carryingValueBs: number; netRealizableValueBs: number; writeDownBs: number; required: boolean } {
  const values = Object.values(input);
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('Los valores para la prueba VNR deben ser números finitos no negativos.');
  }
  const carryingValueBs = cents(input.quantity * input.unitCostBs);
  const netRealizableUnit = Math.max(0, input.estimatedSellingPricePerUnitBs -
    input.completionCostPerUnitBs - input.sellingCostPerUnitBs);
  const netRealizableValueBs = cents(input.quantity * netRealizableUnit);
  const writeDownBs = cents(Math.max(0, carryingValueBs - netRealizableValueBs));
  return { carryingValueBs, netRealizableValueBs, writeDownBs, required: writeDownBs > 0 };
}

/** Fórmula periódica de costo de ventas para revisión/cierre del período. */
export function calculatePeriodicCostOfSales(input: {
  openingInventoryBs: number;
  purchasesAndLandedCostsBs: number;
  closingInventoryBs: number;
}): number {
  const { openingInventoryBs, purchasesAndLandedCostsBs, closingInventoryBs } = input;
  if ([openingInventoryBs, purchasesAndLandedCostsBs, closingInventoryBs].some(v => !Number.isFinite(v) || v < 0)) {
    throw new Error('Los importes del cierre deben ser números finitos no negativos.');
  }
  const result = cents(openingInventoryBs + purchasesAndLandedCostsBs - closingInventoryBs);
  if (result < 0) throw new Error('El inventario final supera el inventario inicial más las compras y costos del período.');
  return result;
}


/**
 * Clears only the current product cost/opening snapshot before a historical
 * reconstruction. Catalog identity, stock, commercial prices and accounting
 * configuration remain unchanged. The opening BCV snapshot is cleared so a
 * current-day rate is not carried back to the selected reconstruction date.
 */
export function prepareProductsForHistoricalReconstruction<T extends {
  avgCostBs: number; avgCostUsd: number; lastCostBs: number; lastCostUsd: number;
  openingDate?: string; openingBcvRate?: number;
}>(products: T[], startDate: string): T[] {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? new Date(startDate + 'T00:00:00.000Z') : null;
  if (!parsed || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== startDate) {
    throw new Error('La fecha inicial de reconstrucción no es válida.');
  }
  return products.map(product => ({
    ...product,
    avgCostBs: 0,
    avgCostUsd: 0,
    lastCostBs: 0,
    lastCostUsd: 0,
    openingDate: startDate,
    openingBcvRate: 0
  } as T));
}
