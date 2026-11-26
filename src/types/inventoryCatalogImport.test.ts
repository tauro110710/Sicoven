import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INVENTORY_CATALOG_COLUMNS, buildCatalogImportPreview, validateCatalogInventoryBatch, validateCatalogInventoryRow } from './inventoryCatalogImport';

const options = { columns: {}, defaults: { openingDate: '2026-11-01' } };

describe('importación de catálogo con columnas seleccionables', () => {
  it('carga el catálogo en cero cuando no se marca ninguna columna', () => {
    const product = validateCatalogInventoryRow({ code: 'A1', nombre: 'Harina P.A.N.' }, 2, options);
    assert.equal(product.code, 'A1');
    assert.equal(product.currentStock, 0);
    assert.equal(product.avgCostBs, 0);
    assert.equal(product.avgCostUsd, 0);
    assert.equal(product.price1, 0);
    assert.equal(product.salesPriceBs, 0);
    assert.equal(product.minStock, 0);
    assert.equal(product.targetMarginPercent, undefined);
    assert.equal(product.openingBcvRate, 0);
    assert.equal(product.openingDate, '2026-11-01');
  });

  it('ignora las columnas del archivo que el contador no marcó', () => {
    const row = { code: 'A1', name: 'Harina', existencia: '50', costo: '12,5', precio1: '20', margen: '60' };
    const product = validateCatalogInventoryRow(row, 2, options);
    assert.equal(product.currentStock, 0);
    assert.equal(product.avgCostBs, 0);
    assert.equal(product.price1, 0);
    assert.equal(product.targetMarginPercent, undefined);
  });

  it('lee solo las columnas marcadas y aplica el valor por defecto en las demás', () => {
    const row = { code: 'A1', name: 'Harina', existencia: '50', costo: '12,5', precio1: '20', margen: '60' };
    const product = validateCatalogInventoryRow(row, 2, {
      columns: { currentStock: true, avgCostBs: true, price1: true, targetMarginPercent: true },
      defaults: { openingDate: '2026-11-01', openingBcvRate: 50, minStock: 5 },
    });
    assert.equal(product.currentStock, 50);
    assert.equal(product.avgCostBs, 12.5);
    assert.equal(product.avgCostUsd, 0.25);
    assert.equal(product.price1, 20);
    assert.equal(product.targetMarginPercent, 60);
    assert.equal(product.minStock, 5);
  });

  it('exige tasa BCV cuando hay existencia o costo, pero no en el catálogo en cero', () => {
    const row = { code: 'A1', name: 'Harina', existencia: '10', costo: '3' };
    assert.throws(() => validateCatalogInventoryRow(row, 2, { columns: { currentStock: true, avgCostBs: true } }), /tasa BCV/);
    assert.doesNotThrow(() => validateCatalogInventoryRow({ code: 'A1', name: 'Harina' }, 2, options));
  });

  it('rechaza existencia sin costo marcado y explica cómo resolverlo', () => {
    const row = { code: 'A1', name: 'Harina', existencia: '10' };
    assert.throws(
      () => validateCatalogInventoryRow(row, 2, { columns: { currentStock: true } }),
      /marcó existencia sin costo/
    );
  });

  it('avisa si marcó una columna que el archivo no trae', () => {
    const row = { code: 'A1', name: 'Harina' };
    assert.throws(
      () => validateCatalogInventoryRow(row, 2, { columns: { avgCostBs: true } }),
      /marcó la columna costo promedio/
    );
  });

  it('convierte el margen y la alícuota y aplica los códigos contables estándar', () => {
    const row = { code: 'A1', name: 'Harina', iva: '8%', margen: '35,5' };
    const product = validateCatalogInventoryRow(row, 2, {
      columns: { vatTreatment: true, targetMarginPercent: true },
      defaults: { openingDate: '2026-11-01' },
    });
    assert.equal(product.vatTreatment, 'REDUCIDA_8');
    assert.equal(product.targetMarginPercent, 35.5);
    assert.equal(product.inventoryAccountCode, '1.1.4.01');
    assert.equal(product.openingBalanceAccountCode, '3.3.1.01');
  });

  it('respeta cuentas contables indicadas por el contador y el producto en proceso', () => {
    const product = validateCatalogInventoryRow({ code: 'A1', name: 'Mezcla' }, 2, {
      columns: {},
      defaults: { openingDate: '2026-11-01', itemType: 'PRODUCTO_EN_PROCESO' },
      accounts: { inventory: '1.1.4.99' },
    });
    assert.equal(product.itemType, 'PRODUCTO_EN_PROCESO');
    assert.equal(product.inventoryAccountCode, '1.1.4.04');
  });

  it('detecta códigos repetidos antes de importar el lote', () => {
    assert.throws(
      () => validateCatalogInventoryBatch([
        { code: 'A1', name: 'Uno' },
        { code: 'a1', name: 'Repetido' },
      ], options),
      /repetido/
    );
  });

  it('rechaza filas sin código o sin descripción', () => {
    assert.throws(() => validateCatalogInventoryRow({ name: 'Solo nombre' }, 3, options), /Fila 3: falta el código/);
    assert.throws(() => validateCatalogInventoryRow({ code: 'A1' }, 3, options), /Fila 3: falta la descripción/);
  });

  it('no acepta montos negativos ni textos donde va un número', () => {
    assert.throws(
      () => validateCatalogInventoryRow({ code: 'A1', name: 'X', precio1: 'abc' }, 2, { columns: { price1: true } }),
      /no es un número válido/
    );
    assert.throws(
      () => validateCatalogInventoryRow({ code: 'A1', name: 'X', existencia: '-1' }, 2, { columns: { currentStock: true } }),
      /no puede ser negativo/
    );
  });
});

describe('vista previa del catálogo antes de importar', () => {
  it('muestra por artículo qué campos quedan en cero o vacíos y por qué', () => {
    const preview = buildCatalogImportPreview(
      [{ code: 'A1', name: 'Harina P.A.N.', existencia: '50', costo: '12,5', precio1: '20', margen: '30' }],
      { columns: {}, defaults: { openingDate: '2026-11-01', openingBcvRate: 50 } }
    );
    const row = preview.rows[0];
    const field = (key: string) => row.fields.find(item => item.key === key)!;

    assert.equal(row.error, null);
    assert.equal(preview.ready, true);
    assert.equal(preview.prepared.length, 1);
    assert.equal(field('currentStock').value, '0');
    assert.equal(field('currentStock').empty, true);
    assert.equal(field('currentStock').fromFile, false);
    assert.match(field('currentStock').note, /sin tildar/);
    assert.equal(field('targetMarginPercent').value, 'vacío');
    assert.equal(field('targetMarginPercent').empty, true);
    // Los estándares de SICOVEN no se informan como cero ni vacío.
    assert.equal(field('category').value, 'General');
    assert.equal(field('category').empty, false);
    assert.equal(field('vatTreatment').value, '16 % general');
    assert.equal(field('openingBcvRate').value, '50');
    assert.deepEqual(row.emptyLabels, [
      'Existencia',
      'Costo promedio (Bs)',
      'Precio de venta',
      'Margen de ganancia (%)',
      'Stock mínimo',
    ]);
    assert.equal(preview.articlesWithEmptyValues, 1);
    assert.equal(preview.offFields.length, INVENTORY_CATALOG_COLUMNS.length);
  });

  it('avisa cuando la columna está tildada pero el archivo trae cero o vacío', () => {
    const preview = buildCatalogImportPreview(
      [{ code: 'A1', name: 'Harina', existencia: '0', costo: '0', precio1: '0', margen: '0', minStock: '', tasaBcv: '50' }],
      {
        columns: { currentStock: true, avgCostBs: true, price1: true, targetMarginPercent: true, minStock: true, openingBcvRate: true },
      }
    );
    const row = preview.rows[0];
    const stock = row.fields.find(item => item.key === 'currentStock')!;
    const minStock = row.fields.find(item => item.key === 'minStock')!;

    assert.equal(stock.fromFile, true);
    assert.equal(stock.empty, true);
    assert.match(stock.note, /Leído del archivo/);
    assert.equal(minStock.fromFile, false);
    assert.equal(minStock.empty, true);
    assert.match(minStock.note, /celda está vacía/);
    assert.doesNotMatch(minStock.note, /Leído del archivo/);
    assert.deepEqual(row.emptyLabels, [
      'Existencia',
      'Costo promedio (Bs)',
      'Precio de venta',
      'Margen de ganancia (%)',
      'Stock mínimo',
    ]);
  });

  it('no marca como leído del archivo un valor que viene del estándar de SICOVEN', () => {
    const preview = buildCatalogImportPreview(
      [{ code: 'A1', name: 'Harina' }],
      {
        columns: { category: true, unit: true, vatTreatment: true, itemType: true, costingMethod: true, minStock: true },
        defaults: { openingDate: '2026-11-01' },
      }
    );
    const row = preview.rows[0];
    const field = (key: string) => row.fields.find(item => item.key === key)!;

    assert.equal(field('category').value, 'General');
    assert.equal(field('category').fromFile, false);
    assert.match(field('category').note, /estándar de SICOVEN/);
    assert.doesNotMatch(field('category').note, /Leído del archivo/);

    assert.equal(field('vatTreatment').value, '16 % general');
    assert.equal(field('vatTreatment').fromFile, false);
    assert.match(field('vatTreatment').note, /estándar de SICOVEN/);

    assert.equal(field('minStock').value, '0');
    assert.equal(field('minStock').fromFile, false);
    assert.match(field('minStock').note, /celda está vacía/);
    assert.doesNotMatch(field('minStock').note, /Leído del archivo/);
  });

  it('informa filas inválidas y códigos repetidos sin lanzar ni preparar la escritura', () => {
    const preview = buildCatalogImportPreview(
      [
        { code: 'A1', name: 'Uno', existencia: '0' },
        { code: 'a1', name: 'Repetido', existencia: '0' },
        { name: 'Sin código' },
        { code: 'B1', name: 'Stock sin costo', existencia: '5' },
      ],
      { columns: { currentStock: true } }
    );

    assert.equal(preview.total, 4);
    assert.equal(preview.errorCount, 3);
    assert.equal(preview.ready, false);
    assert.equal(preview.prepared.length, 1);
    assert.equal(preview.prepared[0].code, 'A1');
    assert.equal(preview.rows[0].error, null);
    assert.match(preview.rows[1].error!, /repetido/);
    assert.match(preview.rows[2].error!, /falta el código/);
    assert.match(preview.rows[3].error!, /existencia sin costo/);
  });

  it('entrega para escribir los mismos valores que muestra la vista previa', () => {
    const preview = buildCatalogImportPreview(
      [{ code: 'A1', name: 'Harina', existencia: '4', costo: '10', precio1: '20' }],
      {
        columns: { currentStock: true, avgCostBs: true, price1: true },
        defaults: { openingDate: '2026-11-01', openingBcvRate: 50 },
      }
    );
    const price = preview.rows[0].fields.find(item => item.key === 'price1')!;

    assert.equal(preview.ready, true);
    assert.equal(preview.prepared.length, 1);
    assert.equal(preview.prepared[0].currentStock, 4);
    assert.equal(preview.prepared[0].avgCostBs, 10);
    assert.equal(preview.prepared[0].avgCostUsd, 0.2);
    assert.equal(preview.prepared[0].price1, 20);
    assert.equal(price.value, '20');
    assert.equal(price.empty, false);
    assert.equal(preview.rows[0].createsOpeningMovement, true);
    assert.equal(preview.articlesWithOpeningMovement, 1);
  });
});
