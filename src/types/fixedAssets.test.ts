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
