import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCreditDueAlerts } from './creditDueAlerts';

test('groups outstanding documents into overdue and upcoming due alerts', () => {
  const result = summarizeCreditDueAlerts([
    { dueDate: '2026-11-05', outstandingUsd: 10 },
    { dueDate: '2026-11-06', outstandingUsd: 20 },
    { dueDate: '2026-11-13', outstandingUsd: 30 },
    { dueDate: '2026-11-14', outstandingUsd: 40 },
    { dueDate: '2026-12-06', outstandingUsd: 50 },
    { dueDate: undefined, outstandingUsd: 60 },
    { dueDate: '2026-11-06', outstandingUsd: 0 }
  ], '2026-11-06');
  assert.deepEqual(result.map(bucket => [bucket.key, bucket.documentCount, bucket.outstandingUsd]), [
    ['OVERDUE', 1, 10],
    ['DUE_TODAY', 1, 20],
    ['DUE_1_7', 1, 30],
    ['DUE_8_30', 2, 90]
  ]);
});

test('excludes settled documents and rejects invalid dates or balances', () => {
  assert.throws(() => summarizeCreditDueAlerts([], '2026-02-30'), /fecha de corte/);
  assert.throws(() => summarizeCreditDueAlerts([{ dueDate: '2026-02-30', outstandingUsd: 10 }], '2026-11-06'), /fecha de vencimiento/);
  assert.throws(() => summarizeCreditDueAlerts([{ dueDate: '2026-11-06', outstandingUsd: -1 }], '2026-11-06'), /saldo pendiente/);
});
