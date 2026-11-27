import test from "node:test";
import assert from "node:assert/strict";
import { resolveHistoricalBcvRate } from "./historicalBcvRate";
import type { AccountingBcvRateHistoryEntry, Company } from "../types/accounting";
import type { InventoryBcvHistoryEntry } from "../types/inventoryBcvRate";

const accountingEntry = (effectiveDate: string, rate: number): AccountingBcvRateHistoryEntry => ({
  id: `accounting-${effectiveDate}-${rate}`,
  effectiveDate,
  rate,
  recordedAt: `${effectiveDate}T00:00:00.000Z`,
  source: 'MANUAL',
});

const inventoryEntry = (effectiveDate: string, rate: number): InventoryBcvHistoryEntry => ({
  id: `inventory-${effectiveDate}-${rate}`,
  effectiveDate,
  rate,
  fetchedAt: `${effectiveDate}T12:00:00.000Z`,
  source: 'https://bcv.today/api/v1/history.json',
  provider: 'bcv.today',
  mode: 'AUTOMATIC',
});

const company = (overrides: Partial<Company> = {}): Pick<Company, 'accountingBcvRateHistory' | 'inventoryBcvRateHistory'> => ({
  accountingBcvRateHistory: undefined,
  inventoryBcvRateHistory: undefined,
  ...overrides,
});

test("no sugiere tasa antes del 01/01/2018 aunque existan historiales", () => {
  const data = company({
    accountingBcvRateHistory: [accountingEntry('2017-12-31', 10)],
    inventoryBcvRateHistory: [inventoryEntry('2017-12-31', 10)],
  });
  assert.equal(resolveHistoricalBcvRate(data, '2017-12-31'), undefined);
  assert.equal(resolveHistoricalBcvRate(data, '2016-06-15'), undefined);
});

test("desde el 01/01/2018 resuelve la tasa vigente del historial contable", () => {
  const data = company({ accountingBcvRateHistory: [accountingEntry('2018-01-01', 0.000068), accountingEntry('2024-03-01', 36.5)] });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2018-01-01'), { rate: 0.000068, effectiveDate: '2018-01-01', origin: 'ACCOUNTING' });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2024-02-29'), { rate: 0.000068, effectiveDate: '2018-01-01', origin: 'ACCOUNTING' });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2024-03-15'), { rate: 36.5, effectiveDate: '2024-03-01', origin: 'ACCOUNTING' });
});

test("prioriza el historial contable sobre el de Inventario", () => {
  const data = company({
    accountingBcvRateHistory: [accountingEntry('2024-05-01', 40)],
    inventoryBcvRateHistory: [inventoryEntry('2024-05-01', 39.5)],
  });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2024-05-10'), { rate: 40, effectiveDate: '2024-05-01', origin: 'ACCOUNTING' });
});

test("elige la tasa más reciente entre el historial contable y el de Inventario", () => {
  const data = company({
    accountingBcvRateHistory: [accountingEntry('2024-01-01', 36)],
    inventoryBcvRateHistory: [inventoryEntry('2024-05-01', 38.25), inventoryEntry('2024-08-01', 41)],
  });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2024-06-15'), { rate: 38.25, effectiveDate: '2024-05-01', origin: 'INVENTORY' });
  assert.deepEqual(resolveHistoricalBcvRate(data, '2024-09-01'), { rate: 41, effectiveDate: '2024-08-01', origin: 'INVENTORY' });
});

test("no inventa tasa cuando ninguna fuente tiene registros vigentes", () => {
  const data = company({
    accountingBcvRateHistory: [accountingEntry('2024-06-01', 38)],
    inventoryBcvRateHistory: [inventoryEntry('2024-07-01', 40)],
  });
  assert.equal(resolveHistoricalBcvRate(data, '2024-05-31'), undefined);
  assert.equal(resolveHistoricalBcvRate(company(), '2024-05-31'), undefined);
  assert.equal(resolveHistoricalBcvRate(null, '2024-05-31'), undefined);
});

test("ignora tasas inválidas y fechas mal formadas", () => {
  const data = company({
    accountingBcvRateHistory: [accountingEntry('2024-01-01', 0), accountingEntry('no-es-fecha', 50), accountingEntry('2024-02-01', -3)],
    inventoryBcvRateHistory: [{ ...inventoryEntry('2024-03-01', 10), rate: 0 }],
  });
  assert.equal(resolveHistoricalBcvRate(data, '2024-04-01'), undefined);
});
