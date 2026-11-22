import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidIsoCalendarDate, getLocalISODate, isOperationDateWithinAccountingStart } from './isoDateValidation';

test('accepts dates without an artificial start-year limit, including pre-2012', () => {
  assert.equal(isValidIsoCalendarDate('1900-01-01'), true);
  assert.equal(isValidIsoCalendarDate('2011-12-31'), true);
  assert.equal(isValidIsoCalendarDate('2012-01-01'), true);
});

test('accepts future calendar dates and leap days only in leap years', () => {
  assert.equal(isValidIsoCalendarDate('2099-12-31'), true);
  assert.equal(isValidIsoCalendarDate('2024-02-29'), true);
  assert.equal(isValidIsoCalendarDate('2025-02-29'), false);
});

test('rejects impossible dates and malformed ISO strings', () => {
  for (const value of ['', '2024-2-01', '2024-02-30', '2024-13-01', '2024-00-10', '2024-01-00', 'abcd-ef-gh', null, undefined, 20240101]) {
    assert.equal(isValidIsoCalendarDate(value), false, String(value));
  }
});

test('formats dates using local calendar fields and does not shift the day through UTC', () => {
  assert.equal(getLocalISODate(new Date(2024, 1, 29, 23, 59, 59)), '2024-02-29');
  assert.equal(getLocalISODate(new Date(2099, 11, 31, 0, 0, 0)), '2099-12-31');
});

test('operation dates must be valid and on or after the accounting start date', () => {
  assert.equal(isOperationDateWithinAccountingStart('2024-03-01', '2024-03-01'), true);
  assert.equal(isOperationDateWithinAccountingStart('2024-03-02', '2024-03-01'), true);
  assert.equal(isOperationDateWithinAccountingStart('2024-02-29', '2024-03-01'), false);
  assert.equal(isOperationDateWithinAccountingStart('2024-02-29', '2024-02-29'), true);
  assert.equal(isOperationDateWithinAccountingStart('2024-02-30', '2024-02-29'), false);
  assert.equal(isOperationDateWithinAccountingStart('2024-02-29', 'invalid'), false);
  assert.equal(isOperationDateWithinAccountingStart('2024-02-29'), true);
});
