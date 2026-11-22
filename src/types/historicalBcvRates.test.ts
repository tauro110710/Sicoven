import assert from 'node:assert/strict';
import test from 'node:test';
import { convertBsToUsd, resolveBcvRateForDate, type HistoricalBcvRate } from './historicalBcvRates';

const rates: HistoricalBcvRate[] = [
  { id: 'daily-1', rate: 35, effectiveFrom: '2024-01-15', scope: 'DATE', source: 'BCV' },
  { id: 'period-1', rate: 34, effectiveFrom: '2024-01-01', effectiveThrough: '2024-01-31', scope: 'PERIOD', source: 'Manual period' },
  { id: 'period-2', rate: 36, effectiveFrom: '2024-02-01', effectiveThrough: '2024-02-29', scope: 'PERIOD' }
];

test('resolves rate for the effective date and prioritizes more specific same-date entries', () => {
  assert.equal(resolveBcvRateForDate('2024-01-15', rates)?.rate, 35);
  assert.equal(resolveBcvRateForDate('2024-01-20', rates)?.rate, 34);
  assert.equal(resolveBcvRateForDate('2024-02-29', rates)?.rate, 36);
});

test('returns null when no rate is configured; no present-day fallback', () => {
  assert.equal(resolveBcvRateForDate('2024-03-01', rates), null);
});

test('rejects invalid rates and invalid date strings', () => {
  assert.equal(resolveBcvRateForDate('2024-02-30', rates), null);
  assert.equal(resolveBcvRateForDate('2024-01-15', [{ id:'bad', rate:0, effectiveFrom:'2024-01-01', scope:'PERIOD' }]), null);
});

test('USD conversion remains pending without a valid rate', () => {
  assert.equal(convertBsToUsd(100, null), null);
  assert.equal(convertBsToUsd(100, 0), null);
  assert.equal(convertBsToUsd(100, 25), 4);
});

test('DATE rates apply only to their exact date and malformed calendar dates are rejected', () => {
  const exact: HistoricalBcvRate = { id: 'date-only', rate: 40, effectiveFrom: '2024-03-10', scope: 'DATE' };
  assert.equal(resolveBcvRateForDate('2024-03-10', [exact])?.rate, 40);
  assert.equal(resolveBcvRateForDate('2024-03-11', [exact]), null);
  assert.equal(resolveBcvRateForDate('2024-02-30', rates), null);
  assert.equal(resolveBcvRateForDate('2024-01-20', [{ id:'bad-range', rate: 1, effectiveFrom:'2024-01-01', effectiveThrough:'2024-02-30', scope:'PERIOD' }]), null);
});

test('exact-date rate wins over an overlapping period rate', () => {
  const overlap: HistoricalBcvRate[] = [
    { id: 'period', rate: 30, effectiveFrom: '2024-05-01', effectiveThrough: '2024-05-31', scope: 'PERIOD' },
    { id: 'exact', rate: 32, effectiveFrom: '2024-05-10', scope: 'DATE' }
  ];
  assert.equal(resolveBcvRateForDate('2024-05-10', overlap)?.rate, 32);
});
