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
