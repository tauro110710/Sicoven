import test from 'node:test';
import assert from 'node:assert/strict';
import { getUniversalMasterTemplate } from './universalImportTemplates';

test('product template exposes four stable price fields and a single declared currency', () => {
  const template = getUniversalMasterTemplate('inventory');
  const headers = template.csv.split('\\r\\n')[0].split(',');
  assert.ok(headers.includes('Precio_1'));
  assert.ok(headers.includes('Precio_2'));
  assert.ok(headers.includes('Precio_3'));
  assert.ok(headers.includes('Precio_4'));
  assert.ok(headers.includes('Moneda_Precio'));
  assert.match(template.fileName, /Productos/);
});

test('customer and supplier templates are separate master-data templates', () => {
  const customers = getUniversalMasterTemplate('customers');
  const suppliers = getUniversalMasterTemplate('suppliers');
  assert.notEqual(customers.fileName, suppliers.fileName);
  assert.ok(customers.csv.startsWith('Nombre,TipoIdentificacion,Identificacion'));
  assert.ok(suppliers.csv.startsWith('Nombre,TipoIdentificacion,Identificacion'));
});
