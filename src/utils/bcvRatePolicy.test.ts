import test from 'node:test';
import assert from 'node:assert/strict';
import { isBcvRateRequiredForDate, BCV_REQUIRED_FROM_DATE } from './bcvRatePolicy';

test('BCV is not mandatory before 2018 even when historical rates existed', () => {
  for (const date of ['1900-01-01', '2014-01-01', '2017-12-31']) assert.equal(isBcvRateRequiredForDate(date), false);
});

test('BCV requirement starts on January 1, 2018', () => {
  assert.equal(BCV_REQUIRED_FROM_DATE, '2018-01-01');
  assert.equal(isBcvRateRequiredForDate('2018-01-01'), true);
  assert.equal(isBcvRateRequiredForDate('2026-11-22'), true);
});

test('invalid dates do not trigger a BCV requirement', () => {
  for (const date of ['', '2018-02-30', 'invalid', null, undefined]) assert.equal(isBcvRateRequiredForDate(date), false);
});
