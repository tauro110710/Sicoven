import test from 'node:test';
import assert from 'node:assert/strict';
import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import {
  getFixedAssetAccumulatedDepreciationAtDate,
  getFixedAssetCostScaleDate,
  getFixedAssetDepreciationExpenseBetweenDates,
  getFixedAssetMonetaryPosition,
  reexpressFixedAssetBs
} from './fixedAssetsMonetaryReexpression';
import type { FixedAsset, FixedAssetDepreciationEvent } from './fixedAssets';

const event = (overrides: Partial<FixedAssetDepreciationEvent> = {}): FixedAssetDepreciationEvent => ({
  id: 'dep-1', companyId: 'company-1', assetId: 'asset-1', period: '2018-07', date: '2018-07-31',
  days: 31, amountBs: 1000, amountUsd: 1, journalEntryId: 'entry-dep-1',
  createdAt: '2018-07-31T12:00:00.000Z', ...overrides
});

const asset = (overrides: Partial<FixedAsset> = {}): FixedAsset => ({
  id: 'asset-1', companyId: 'company-1', assetCode: 'AF-00001', description: 'Equipo de oficina',
  category: 'Mobiliario', acquisitionDate: '2017-06-15', serviceDate: '2017-07-01',
  costScaleDate: '2017-06-15', acquisitionCostBs: 36_500_000, acquisitionCostUsd: 3650,
  acquisitionBcvRate: 3300, residualValueBs: 3_650_000, residualValueUsd: 365,
  usefulLifeMonths: 120, depreciationMethod: 'STRAIGHT_LINE',
  assetAccountCode: '1.2.1.01', accumulatedDepreciationAccountCode: '1.2.1.05',
  depreciationExpenseAccountCode: '6.1.1.06', sourceJournalEntryId: 'entry-1',
  sourceJournalLineIndex: 0, status: 'ACTIVE', depreciationEvents: [],
  createdAt: '2017-06-15T12:00:00.000Z', ...overrides
});

test('usa la fecha del asiento de capitalización como escala del costo', () => {
  assert.equal(getFixedAssetCostScaleDate(asset()), '2017-06-15');
  assert.equal(getFixedAssetCostScaleDate(asset({ costScaleDate: undefined })), '2017-06-15');
  assert.equal(getFixedAssetCostScaleDate(asset({ acquisitionDate: '2017-06-10', costScaleDate: '2017-06-15' })), '2017-06-15');
  assert.throws(() => getFixedAssetCostScaleDate(asset({ costScaleDate: '2017-06-01' })), /anterior a la fecha de adquisición/);
});

test('reexpresa cada importe desde su propia fecha, sin tocar el valor original', () => {
  assert.equal(reexpressFixedAssetBs(36_500_000, '2017-06-15', '2018-08-31'), 365);
  assert.equal(reexpressFixedAssetBs(36_500_000, '2017-06-15', '2021-10-31'), 0.000365);
  assert.equal(reexpressFixedAssetBs(3_650_000, '2017-06-15', '2021-10-31'), 0.0000365);
  assert.throws(() => reexpressFixedAssetBs(10, '2017-02-30', '2021-10-31'), /fecha contable válida/);
});

test('la depreciación acumulada se reconstruye evento por evento y excluye reversadas', () => {
  const current = asset({ depreciationEvents: [
    event({ id: 'dep-2018-07', period: '2018-07', date: '2018-07-31', amountBs: 1_000_000 }),
    event({ id: 'dep-2018-08', period: '2018-08', date: '2018-08-31', amountBs: 500 }),
    event({ id: 'dep-2018-09', period: '2018-09', date: '2018-09-30', amountBs: 700, reversedByJournalEntryId: 'entry-rev' })
  ] });
  const accumulated = getFixedAssetAccumulatedDepreciationAtDate(current, '2018-12-31');
  const expected = Number(reexpressAmountBetweenDates(1_000_000, '2018-07-31', '2018-12-31')) +
    Number(reexpressAmountBetweenDates(500, '2018-08-31', '2018-12-31'));
  assert.ok(Math.abs(accumulated - expected) < 1e-9);
  const withReversed = getFixedAssetAccumulatedDepreciationAtDate(current, '2018-12-31', { includeReversed: true });
  assert.ok(withReversed > accumulated);
});

test('la posición monetaria mezcla una sola escala en Bs. y conserva los importes USD', () => {
  const current = asset({ depreciationEvents: [event({ amountBs: 1_000_000, amountUsd: 100 })] });
  const position = getFixedAssetMonetaryPosition(current, '2021-10-31');
  assert.equal(position.historicalCostBs, 36_500_000);
  assert.equal(position.costScaleDate, '2017-06-15');
  assert.ok(Math.abs(position.costBs - 0.000365) < 1e-12);
  assert.ok(Math.abs(position.residualValueBs - 0.0000365) < 1e-12);
  assert.ok(Math.abs(position.accumulatedDepreciationBs - 0.00001) < 1e-12);
  assert.ok(position.netBookValueBs >= position.residualValueBs);
  // El dólar no cambia de escala.
  assert.equal(position.historicalCostUsd, 3650);
  assert.equal(position.accumulatedDepreciationUsd, 100);
  assert.equal(position.netBookValueUsd, 3550);
});

test('el gasto de depreciación de un rango se expresa en la escala de consulta', () => {
  const current = asset({ depreciationEvents: [
    event({ id: 'dep-2017-12', period: '2017-12', date: '2017-12-31', amountBs: 1_000_000 }),
    event({ id: 'dep-2018-01', period: '2018-01', date: '2018-01-31', amountBs: 2_000_000 }),
    event({ id: 'dep-2019-01', period: '2019-01', date: '2019-01-31', amountBs: 10 })
  ] });
  const expense = getFixedAssetDepreciationExpenseBetweenDates(current, '2018-01-01', '2018-12-31', '2021-10-31');
  assert.ok(Math.abs(expense - 0.00002) < 1e-12);
  assert.throws(() => getFixedAssetDepreciationExpenseBetweenDates(current, '2019-12-31', '2019-01-01', '2021-10-31'), /cronológico/);
});
