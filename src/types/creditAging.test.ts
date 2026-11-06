import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCreditAging } from './creditAging';

test('groups outstanding balances into current and overdue day ranges', () => {
  const result = summarizeCreditAging([
    { dueDate: '2026-11-06', outstandingUsd: 10 },
    { dueDate: '2026-11-05', outstandingUsd: 20 },
    { dueDate: '2026-10-07', outstandingUsd: 30 },
    { dueDate: '2026-10-06', outstandingUsd: 40 },
    { dueDate: '2026-09-07', outstandingUsd: 50 },
    { dueDate: '2026-09-06', outstandingUsd: 60 },
    { dueDate: '2026-08-08', outstandingUsd: 70 },
    { dueDate: '2026-08-07', outstandingUsd: 80 },
    { dueDate: undefined, outstandingUsd: 90 },
    { dueDate: '2026-11-01', outstandingUsd: 0 }
  ], '2026-11-06');
  assert.deepEqual(result.map(bucket => [bucket.key, bucket.documentCount, bucket.outstandingUsd]), [
    ['CURRENT', 1, 10],
    ['DAYS_1_30', 2, 50],
    ['DAYS_31_60', 2, 90],
    ['DAYS_61_90', 2, 130],
    ['OVER_90', 1, 80],
    ['NO_DUE_DATE', 1, 90]
  ]);
});

test('keeps due dates after the cutoff in the current bucket and excludes settled balances', () => {
  const result = summarizeCreditAging([
    { dueDate: '2026-12-01', outstandingUsd: 15 },
    { dueDate: '2026-10-01', outstandingUsd: 0.005 }
  ], '2026-11-06');
  assert.equal(result[0].documentCount, 1);
  assert.equal(result[0].outstandingUsd, 15);
  assert.equal(result.reduce((sum, bucket) => sum + bucket.documentCount, 0), 1);
});

test('rejects invalid cutoff dates and negative or non-finite balances', () => {
  assert.throws(() => summarizeCreditAging([], '2026-02-30'), /fecha de corte/);
  assert.throws(() => summarizeCreditAging([{ dueDate: '2026-11-01', outstandingUsd: -1 }], '2026-11-06'), /saldo pendiente/);
  assert.throws(() => summarizeCreditAging([{ dueDate: '2026-11-01', outstandingUsd: NaN }], '2026-11-06'), /saldo pendiente/);
});
