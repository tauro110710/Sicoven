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

test('automatic inventory BCV history does not duplicate an effective date', () => {
  const first = appendDailyInventoryBcvRate([], entry('2026-11-06', 890));
  const duplicate = appendDailyInventoryBcvRate(first, { ...entry('2026-11-06', 891), fetchedAt: '2026-11-06T13:00:00.000Z' });
  assert.equal(first.length, 1);
  assert.equal(duplicate.length, 1);
  assert.equal(duplicate[0].rate, 890);
});

test('manual BCV entry appends a same-day correction and becomes the effective value', () => {
  const automatic = appendDailyInventoryBcvRate([], entry('2026-11-06', 890));
  const corrected = appendDailyInventoryBcvRate(automatic, {
    rate: 891.25,
    effectiveDate: '2026-11-06',
    fetchedAt: '2026-11-06T15:00:00.000Z',
    source: 'Registro manual del contador',
    provider: 'manual',
    mode: 'MANUAL',
    note: 'Corrección por publicación oficial consultada fuera de línea',
    correctionOfId: automatic[0].id
  });
  assert.equal(corrected.length, 2);
  assert.equal(corrected[0].rate, 890);
  assert.equal(corrected[1].rate, 891.25);
  assert.equal(resolveInventoryBcvRate(corrected, '2026-11-06')?.mode, 'MANUAL');
  assert.equal(resolveInventoryBcvRate(corrected, '2026-11-06')?.rate, 891.25);
});

test('same-day manual corrections take precedence even if their saved timestamp is earlier than automatic data', () => {
  const history = [
    { ...entry('2026-11-06', 890), fetchedAt: '2026-11-06T17:00:00.000Z' },
    { ...entry('2026-11-06', 891.25), mode: 'MANUAL' as const, provider: 'manual' as const, source: 'Manual', fetchedAt: '2026-11-06T15:00:00.000Z', correctionOfId: 'auto-id' }
  ];
  assert.equal(resolveInventoryBcvRate(history, '2026-11-06')?.rate, 891.25);
  assert.equal(resolveInventoryBcvRate(history, '2026-11-06')?.mode, 'MANUAL');
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