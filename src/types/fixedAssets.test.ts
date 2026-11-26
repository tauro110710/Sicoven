import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFixedAssetDepreciation,
  getNextFixedAssetDepreciationPeriod,
  getFixedAssetDepreciationScheduleThrough,
  type FixedAsset
} from './fixedAssets';

const asset = (overrides: Partial<FixedAsset> = {}): FixedAsset => ({
  id:'asset-1',companyId:'company-1',assetCode:'AF-00001',description:'Equipo de oficina',category:'Mobiliario',
  acquisitionDate:'2026-01-10',serviceDate:'2026-01-15',acquisitionCostBs:36500,acquisitionCostUsd:365,acquisitionBcvRate:100,
  residualValueBs:3650,residualValueUsd:36.5,usefulLifeMonths:12,depreciationMethod:'STRAIGHT_LINE',
  assetAccountCode:'1.2.1.01',accumulatedDepreciationAccountCode:'1.2.1.02',depreciationExpenseAccountCode:'5.2.1.01',
  sourceJournalEntryId:'entry-1',sourceJournalLineIndex:0,status:'ACTIVE',depreciationEvents:[],createdAt:'2026-01-10T12:00:00.000Z',
  ...overrides
});

test('prorates the first month from the in-service date and returns the next period', () => {
  const current = asset();
  assert.equal(getNextFixedAssetDepreciationPeriod(current),'2026-01');
  const result = calculateFixedAssetDepreciation(current,'2026-01');
  assert.equal(result.days,17);
  assert.ok(result.amountBs > 0 && result.amountBs < 32850);
  assert.ok(result.amountUsd > 0 && result.amountUsd < 328.5);
});

test('requires chronological periods and does not duplicate a posted period', () => {
  const current = asset({depreciationEvents:[{
    id:'dep-1',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',
    days:17,amountBs:1500,amountUsd:15,journalEntryId:'entry-dep-1',createdAt:'2026-01-31T12:00:00.000Z'
  }]});
  assert.equal(getNextFixedAssetDepreciationPeriod(current),'2026-02');
  assert.throws(()=>calculateFixedAssetDepreciation(current,'2026-01'),/primer período pendiente/);
  assert.throws(()=>calculateFixedAssetDepreciation(current,'2026-03'),/primer período pendiente/);
});

test('allows reposting a reversed period while preserving the reversed event', () => {
  const current = asset({depreciationEvents:[{
    id:'dep-1',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',
    days:17,amountBs:1500,amountUsd:15,journalEntryId:'entry-dep-1',createdAt:'2026-01-31T12:00:00.000Z',
    reversedByJournalEntryId:'entry-reversal'
  }]});
  assert.equal(getNextFixedAssetDepreciationPeriod(current),'2026-01');
});

test('the final period absorbs rounding residue and never depreciates below residual value', () => {
  const initial = asset({usefulLifeMonths:1,serviceDate:'2026-01-15'});
  const first = calculateFixedAssetDepreciation(initial,'2026-01');
  const afterFirst = asset({usefulLifeMonths:1,serviceDate:'2026-01-15',depreciationEvents:[{
    id:'dep-jan',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:first.postingDate,
    days:first.days,amountBs:first.amountBs,amountUsd:first.amountUsd,journalEntryId:'entry-jan',
    createdAt:'2026-01-31T12:00:00.000Z'
  }]});
  const result = calculateFixedAssetDepreciation(afterFirst,'2026-02');
  assert.equal(result.accumulatedBsAfter,32850);
  assert.equal(result.accumulatedUsdAfter,328.5);
  assert.equal(result.netBookValueBsAfter,3650);
  assert.equal(result.netBookValueUsdAfter,36.5);
});

test('rejects invalid dates, life, residual values and malformed history', () => {
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(asset({serviceDate:'2026-02-30'})),/fecha real/);
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(asset({usefulLifeMonths:0})),/vida útil/);
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(asset({residualValueBs:40000})),/valor residual/);
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(asset({depreciationEvents:[{
    id:'dup-1',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',days:1,
    amountBs:1,amountUsd:0.01,journalEntryId:'a',createdAt:'2026-01-31T12:00:00.000Z'
  },{id:'dup-2',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',days:1,
    amountBs:1,amountUsd:0.01,journalEntryId:'b',createdAt:'2026-01-31T12:00:00.000Z'
  }]})),/más de una depreciación/);
});

test('rejects depreciation history outside the asset life or above depreciable cost', () => {
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(asset({depreciationEvents:[{
    id:'dep-late',companyId:'company-1',assetId:'asset-1',period:'2028-01',date:'2028-01-31',
    days:31,amountBs:1,amountUsd:0.01,journalEntryId:'late',createdAt:'2028-01-31T12:00:00.000Z'
  }]})),/inconsistente/);
  const over = asset({depreciationEvents:[{
    id:'dep-over',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',
    days:17,amountBs:40000,amountUsd:400,journalEntryId:'over',createdAt:'2026-01-31T12:00:00.000Z'
  }]});
  assert.throws(()=>calculateFixedAssetDepreciation(over,'2026-02'),/supera el importe depreciable/);
});


test('builds a sequential monthly depreciation schedule only through the company close date', () => {
  const current = asset({ serviceDate: '2026-01-15', usefulLifeMonths: 12 });
  const throughFebruary = getFixedAssetDepreciationScheduleThrough(current, '2026-02-28');
  assert.deepEqual(throughFebruary.map(item => item.period), ['2026-01', '2026-02']);
  assert.equal(throughFebruary[0].postingDate, '2026-01-31');
  assert.equal(throughFebruary[1].postingDate, '2026-02-28');
  const throughJanuary = getFixedAssetDepreciationScheduleThrough(current, '2026-01-30');
  assert.deepEqual(throughJanuary, []);
});

test('monthly schedule catches up consecutive missing periods without duplicating posted periods', () => {
  const current = asset({ depreciationEvents: [{
    id: 'dep-jan', companyId: 'company-1', assetId: 'asset-1', period: '2026-01',
    date: '2026-01-31', days: 17, amountBs: 1500, amountUsd: 15,
    journalEntryId: 'entry-jan', createdAt: '2026-01-31T12:00:00.000Z'
  }] });
  const schedule = getFixedAssetDepreciationScheduleThrough(current, '2026-03-31');
  assert.deepEqual(schedule.map(item => item.period), ['2026-02', '2026-03']);
});


test('registers land as a non-depreciable asset with full residual value and no schedule', () => {
  const land = asset({
    category: 'Terreno', depreciationMethod: 'NON_DEPRECIABLE', usefulLifeMonths: 0,
    residualValueBs: 36500, residualValueUsd: 365,
    accumulatedDepreciationAccountCode: '', depreciationExpenseAccountCode: ''
  });
  assert.equal(getNextFixedAssetDepreciationPeriod(land), null);
  assert.deepEqual(getFixedAssetDepreciationScheduleThrough(land, '2026-12-31'), []);
});

test('allows historical Bs-only fixed assets and depreciation without BCV before 2018', () => {
  const historical = asset({
    acquisitionDate:'2014-01-10',serviceDate:'2014-01-15',acquisitionCostBs:36500,acquisitionCostUsd:0,acquisitionBcvRate:0,
    residualValueBs:3650,residualValueUsd:0
  });
  assert.equal(getNextFixedAssetDepreciationPeriod(historical),'2014-01');
  const result = calculateFixedAssetDepreciation(historical,'2014-01');
  assert.ok(result.amountBs>0);
  assert.equal(result.amountUsd,0);
  assert.equal(result.netBookValueUsdAfter,0);
});

const historicalAsset = (overrides: Partial<FixedAsset> = {}): FixedAsset => asset({
  acquisitionDate:'2017-06-15', serviceDate:'2017-07-01', costScaleDate:'2017-06-15',
  acquisitionCostBs:36_500_000, acquisitionCostUsd:3650, acquisitionBcvRate:3300,
  residualValueBs:3_650_000, residualValueUsd:365, usefulLifeMonths:120,
  ...overrides
});

test('recalcula la depreciación en la escala vigente al cruzar la reconversión de 2018', () => {
  const current = historicalAsset();
  const schedule = getFixedAssetDepreciationScheduleThrough(current, '2018-08-31');
  assert.equal(schedule.length, 14);
  const july = schedule.find(item => item.period === '2018-07');
  const august = schedule.find(item => item.period === '2018-08');
  assert.ok(july && august);
  // Julio aún se expresa en Bs.F: importe depreciable de 32.850.000,00.
  assert.ok(july.amountBs > 278_000 && july.amountBs < 279_000);
  assert.ok(july.netBookValueBsAfter > 32_000_000);
  // Agosto ya se expresa en Bs.S: base de 328,50 y acumulado reexpresado.
  assert.equal(august.postingDate, '2018-08-31');
  assert.ok(august.amountBs > 2.7 && august.amountBs < 2.9);
  assert.ok(august.accumulatedBsAfter > 30 && august.accumulatedBsAfter < 45);
  assert.ok(august.netBookValueBsAfter > 320 && august.netBookValueBsAfter < 335);
  // El costo original nunca se modifica.
  assert.equal(current.acquisitionCostBs, 36_500_000);
});

test('deprecia en Bs. tras la reconversión de 2021 sin acumular escalas incompatibles', () => {
  const current = historicalAsset();
  const schedule = getFixedAssetDepreciationScheduleThrough(current, '2021-10-31');
  const october = schedule.find(item => item.period === '2021-10');
  assert.ok(october);
  // Base reexpresada a Bs. digitales: 0,0003285; ninguna escala anterior se suma nominalmente.
  assert.ok(october.amountBs > 0 && october.amountBs < 0.00001);
  assert.ok(october.accumulatedBsAfter > 0 && october.accumulatedBsAfter < 0.0004);
  assert.ok(october.netBookValueBsAfter > 0.0002 && october.netBookValueBsAfter < 0.0004);
  // USD no se reconvierte: la cuota mantiene la proporción de días.
  assert.ok(october.amountUsd > 27 && october.amountUsd < 29);
});

test('agota el importe depreciable en la escala vigente y respeta el valor residual', () => {
  const current = historicalAsset();
  const schedule = getFixedAssetDepreciationScheduleThrough(current, '2027-12-31');
  assert.equal(schedule.length, 120);
  assert.ok(schedule.every(item => item.amountBs > 0));
  const last = schedule[schedule.length - 1];
  assert.equal(last.period, '2027-06');
  assert.ok(Math.abs(last.netBookValueBsAfter - 0.0000365) < 1e-7);
  assert.equal(last.netBookValueUsdAfter, 365);
  // Al cierre de la vida útil el acumulado queda en la escala vigente, sin mezclar nominales.
  assert.ok(Math.abs(last.accumulatedBsAfter - 0.0003285) < 1e-7);
});

test('rechaza una fecha de escala del costo anterior a la adquisición', () => {
  assert.throws(
    () => getNextFixedAssetDepreciationPeriod(historicalAsset({ costScaleDate: '2017-06-01' })),
    /anterior a la adquisición/
  );
});

test('requires BCV for fixed asset acquisition dated from 2018 when valuation is dual', () => {
  const modernBsOnly = asset({
    acquisitionDate:'2018-01-10',serviceDate:'2018-01-15',acquisitionCostBs:36500,acquisitionCostUsd:0,acquisitionBcvRate:0,
    residualValueBs:3650,residualValueUsd:0
  });
  assert.throws(()=>getNextFixedAssetDepreciationPeriod(modernBsOnly),/tasa BCV es obligatoria desde 2018/);
});
