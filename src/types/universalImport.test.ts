import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImportSourceSystem, detectUniversalImportFormat, extractUniversalJsonCollections } from './universalImport';

test('detecta arreglos JSON en la raíz sin conocer el nombre del sistema', () => {
  const result = extractUniversalJsonCollections([{ codigo: 'A1' }, { codigo: 'A2' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '$');
  assert.equal(result[0].rows.length, 2);
  assert.equal(result[0].invalidItems, 0);
});

test('descubre varias colecciones anidadas y conserva su ruta', () => {
  const result = extractUniversalJsonCollections({
    app: 'ERP desconocido',
    data: {
      articulos: [{ sku: 'P1' }],
      terceros: [{ rif: 'J-1' }],
      metadata: { version: 2 }
    }
  });
  assert.deepEqual(result.map(item => item.path), ['data.articulos', 'data.terceros']);
  assert.equal(result.reduce((sum, item) => sum + item.rows.length, 0), 2);
});

test('cuenta elementos inválidos sin descartarlos silenciosamente', () => {
  const result = extractUniversalJsonCollections({
    movimientos: [{ id: 1 }, null, 'registro inválido', { id: 2 }]
  });
  assert.equal(result[0].totalItems, 4);
  assert.equal(result[0].rows.length, 2);
  assert.equal(result[0].invalidItems, 2);
});

test('conserva arreglos de escalares para explicar por qué no son importables', () => {
  const result = extractUniversalJsonCollections({ etiquetas: ['uno', 'dos'], productos: [{ id: 1 }] });
  assert.deepEqual(result.map(item => item.path), ['etiquetas', 'productos']);
  assert.equal(result[0].totalItems, 2);
  assert.equal(result[0].rows.length, 0);
  assert.equal(result[0].invalidItems, 2);
});

test('separa formato del archivo y software que lo generó', () => {
  assert.equal(detectUniversalImportFormat('respaldo.JSON'), 'json');
  assert.equal(detectUniversalImportFormat('libro.xlsx'), 'xlsx');
  assert.equal(detectUniversalImportFormat('exportacion.xls'), 'unsupported');
  assert.equal(detectImportSourceSystem({ app: 'POSVEN-Pro', data: {} }).id, 'posven-pro');
  assert.equal(detectImportSourceSystem({ metadata: { Source_System: 'POSVEN Pro' } }).id, 'posven-pro');
  assert.equal(detectImportSourceSystem({ meta: { SOFTWARE: 'POSVEN' } }).id, 'posven-pro');
  assert.equal(detectImportSourceSystem({ app: 'ERP de otra empresa', data: {} }).id, 'unknown');
});
