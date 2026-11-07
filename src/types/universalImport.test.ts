import test from 'node:test';
import assert from 'node:assert/strict';
import { extractUniversalJsonCollections } from './universalImport';

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

test('no interpreta arreglos de escalares como colecciones de registros', () => {
  const result = extractUniversalJsonCollections({ etiquetas: ['uno', 'dos'], productos: [{ id: 1 }] });
  assert.deepEqual(result.map(item => item.path), ['productos']);
});
