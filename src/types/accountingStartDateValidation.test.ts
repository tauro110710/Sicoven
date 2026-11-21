import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccountingStartDate } from './accountingStartDateValidation';

test('allows dated operations on or after the company bookkeeping start', () => {
  assert.equal(validateAccountingStartDate('2010-02-01', '2010-02-01'), null);
  assert.equal(validateAccountingStartDate('2010-02-01', '2010-02-15'), null);
  assert.equal(validateAccountingStartDate('2010-02-01', '2026-11-21'), null);
});

test('rejects operations before the company bookkeeping start date', () => {
  assert.match(validateAccountingStartDate('2010-02-01', '2010-01-31') || '', /anterior al inicio/);
});

test('does not impose a start date on legacy companies without one', () => {
  assert.equal(validateAccountingStartDate(undefined, '2000-01-01'), null);
});

test('rejects a corrupt configured start date', () => {
  assert.match(validateAccountingStartDate('2010-02-31', '2010-03-01') || '', /fecha de inicio contable configurada/);
});
