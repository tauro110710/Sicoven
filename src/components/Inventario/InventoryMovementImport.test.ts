import test from 'node:test';
import assert from 'node:assert/strict';
import { dateValue } from './InventoryMovementImport';

test('normaliza fechas ISO exactas y fechas ISO con hora', () => {
  assert.equal(dateValue('2026-10-27'), '2026-10-27');
  assert.equal(dateValue('2026-10-27T12:30:45Z'), '2026-10-27');
  assert.equal(dateValue('27/10/2026'), '2026-10-27');
});

test('rechaza fechas con sufijos o tiempos inválidos sin truncarlos', () => {
  assert.equal(dateValue('2026-10-27garbage'), '2026-10-27garbage');
  assert.equal(dateValue('2026-10-27T25:61:00Z'), '2026-10-27T25:61:00Z');
  assert.equal(dateValue('2026-02-31'), '2026-02-31');
  assert.equal(dateValue('31/02/2026'), '31/02/2026');
});
