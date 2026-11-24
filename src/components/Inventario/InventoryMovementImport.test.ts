import test from 'node:test';
import assert from 'node:assert/strict';
import { dateValue, resolveMovementProduct } from './InventoryMovementImport';

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

test('resuelve producto por código y valida que el nombre coincida', () => {
  const products = [{ id: 'p1', code: 'A-10', name: 'Tornillo' }, { id: 'p2', code: 'B-20', name: 'Tuerca' }];
  assert.equal(resolveMovementProduct(products, '', 'A-10', 'Tornillo', 2).id, 'p1');
  assert.throws(() => resolveMovementProduct(products, '', 'A-10', 'Tuerca', 2), /código y nombre identifican productos distintos/);
});

test('no usa nombre o ID como fallback cuando el código suministrado no coincide', () => {
  const products = [{ id: 'p1', code: 'A-10', name: 'Tornillo' }, { id: 'p2', code: 'B-20', name: 'Tuerca' }];
  assert.throws(() => resolveMovementProduct(products, 'p1', 'WRONG', 'Tornillo', 2), /código de artículo no coincide/);
  assert.equal(resolveMovementProduct(products, 'external-source-id', 'A-10', 'Tornillo', 2).id, 'p1');
  assert.throws(() => resolveMovementProduct(products, 'p2', 'A-10', 'Tornillo', 2), /no coincide con el código o nombre/);
});

test('rechaza nombres ambiguos y acepta ID único sin código ni nombre', () => {
  const products = [{ id: 'p1', code: 'A-10', name: 'Tornillo' }, { id: 'p2', code: 'B-20', name: 'Tornillo' }];
  assert.throws(() => resolveMovementProduct(products, '', '', 'Tornillo', 3), /nombre coincide con varios artículos/);
  assert.equal(resolveMovementProduct(products, 'p2', '', '', 3).id, 'p2');
});
