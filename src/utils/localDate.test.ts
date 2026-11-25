import test from 'node:test';
import assert from 'node:assert/strict';
import { toLocalIsoDate } from './localDate';

test('la fecha local no se adelanta al día siguiente por usar UTC', () => {
  const lateNightUtc = new Date('2026-11-26T02:30:00.000Z');
  // Venezuela es UTC-4: a las 22:30 locales del 25 todavía es 25.
  assert.equal(toLocalIsoDate(lateNightUtc, 240), '2026-11-25');
  assert.equal(toLocalIsoDate(lateNightUtc, 0), '2026-11-26');
  // Un huso positivo no debe retrasar el día.
  assert.equal(toLocalIsoDate(new Date('2026-11-25T23:30:00.000Z'), -60), '2026-11-26');
});
