import test from 'node:test';
import assert from 'node:assert/strict';
import { appendDailyInventoryBcvRate, resolveInventoryBcvRate } from './inventoryBcvRate';

const entry = (effectiveDate: string, rate: number) => ({
  id: 'inventory-bcv-' + effectiveDate,
  rate,
  effectiveDate,
  fetchedAt: effectiveDate + 'T12:00:00.000Z',
  source: 'https://bcv.today/api/rate.json',
  provider: 'bcv.today' as const,
  mode: 'AUTOMATIC' as const
});

test('inventory BCV history appends one immutable entry per effective date', () => {
  const first = appendDailyInventoryBcvRate([], entry('2026-11-06', 890));
  const duplicate = appendDailyInventoryBcvRate(first, entry('2026-11-06', 891));
  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].rate, 890);
});

test('inventory BCV date resolver selects the latest effective rate not after the date', () => {
  const history = [
    entry('2026-11-04', 870),
    entry('2026-11-06', 890)
  ];
  assert.equal(resolveInventoryBcvRate(history, '2026-11-05')?.rate, 870);
  assert.equal(resolveInventoryBcvRate(history, '2026-11-06')?.rate, 890);
  assert.equal(resolveInventoryBcvRate(history, '2026-11-03'), null);
});
