import test from 'node:test';
import assert from 'node:assert/strict';
import { BCV_RATE_ENFORCEMENT_START_DATE, getBcvRateRequirement } from './bcvRatePolicy';

test('BCV enforcement begins on the configured September 7, 2018 threshold', () => {
  assert.equal(BCV_RATE_ENFORCEMENT_START_DATE, '2018-09-07');
  assert.equal(getBcvRateRequirement('2018-09-06', true), 'OPTIONAL');
  assert.equal(getBcvRateRequirement('2018-09-07', true), 'REQUIRED');
});

test('Bs-only transactions never require BCV regardless of date', () => {
  assert.equal(getBcvRateRequirement('2018-09-07', false), 'NOT_APPLICABLE');
  assert.equal(getBcvRateRequirement('2026-11-21', false), 'NOT_APPLICABLE');
});

test('invalid dates fail policy classification closed', () => {
  assert.equal(getBcvRateRequirement('2018-02-30', true), 'INVALID_DATE');
  assert.equal(getBcvRateRequirement('', false), 'INVALID_DATE');
});


test('permits BCV optional/required rules configured for date ranges', () => {
  const policy = [
    { effectiveFrom: '2018-01-01', effectiveTo: '2019-12-31', requirement: 'OPTIONAL' as const },
    { effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31', requirement: 'REQUIRED' as const },
    { effectiveFrom: '2021-01-01', requirement: 'OPTIONAL' as const }
  ];
  assert.equal(getBcvRateRequirement('2019-05-01', true, policy), 'OPTIONAL');
  assert.equal(getBcvRateRequirement('2020-05-01', true, policy), 'REQUIRED');
  assert.equal(getBcvRateRequirement('2022-05-01', true, policy), 'OPTIONAL');
  assert.equal(getBcvRateRequirement('2017-12-31', true, policy), 'OPTIONAL');
});

test('rejects overlapping or malformed BCV date policies', () => {
  const overlap = [
    { effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31', requirement: 'REQUIRED' as const },
    { effectiveFrom: '2020-06-01', requirement: 'OPTIONAL' as const }
  ];
  assert.equal(getBcvRateRequirement('2020-08-01', true, overlap), 'INVALID_POLICY');
  assert.equal(getBcvRateRequirement('2020-08-01', true, [{ effectiveFrom: '2020-02-30', requirement: 'OPTIONAL' }]), 'INVALID_POLICY');
});
