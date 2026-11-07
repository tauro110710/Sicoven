import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImportSourceSystem, detectUniversalImportFormat, extractUniversalJsonCollections, resolveUniversalPartyReference, resolveUniversalPurchaseDetailRows, mapUniversalInventoryMovementType, mapUniversalInventoryMovementConcept, hasUniversalNestedMerchandiseDetails, resolveUniversalInvoiceSettlementRows, hasUniversalInlineSettlementAmount } from './universalImport';

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

test('limita la profundidad de exploración para evitar estructuras JSON patológicas', () => {
  let nested: Record<string, unknown> = { records: [{ id: 1 }] };
  for (let depth = 0; depth < 10; depth++) nested = { child: nested };
  assert.deepEqual(extractUniversalJsonCollections(nested), []);
});


test('resuelve cliente desde una colección relacionada del mismo archivo', () => {
  const rows = [
    { migrationfile: 'archivo-a', migrationrowid: 'facturas|0', invoiceNumber: 'F-1', customerId: 'C-7' },
    { migrationfile: 'archivo-a', migrationrowid: 'clientes|0', id: 'C-7', name: 'Comercial Uno', rif: 'J-12345678-9' },
    { migrationfile: 'archivo-b', migrationrowid: 'clientes|0', id: 'C-7', name: 'Otra empresa', rif: 'J-98765432-1' }
  ];
  const result = resolveUniversalPartyReference(rows, rows[0], 'customer');
  assert.deepEqual(result, { name: 'Comercial Uno', rif: 'J-12345678-9', source: 'related-record' });
});

test('resuelve proveedor mediante identificadores alternativos', () => {
  const rows = [
    { migrationfile: 'archivo-a', migrationrowid: 'compras|0', invoiceNumber: 'C-1', supplier_id: 42 },
    { migrationfile: 'archivo-a', migrationrowid: 'proveedores|0', proveedorId: 42, razonSocial: 'Suministros Uno', rif: 'J-11111111-1' }
  ];
  const result = resolveUniversalPartyReference(rows, rows[0], 'supplier');
  assert.equal(result.name, 'Suministros Uno');
  assert.equal(result.rif, 'J-11111111-1');
  assert.equal(result.source, 'related-record');
});

test('no resuelve referencias entre archivos distintos', () => {
  const rows = [
    { migrationfile: 'archivo-a', invoiceNumber: 'F-1', customerId: 'C-7' },
    { migrationfile: 'archivo-b', id: 'C-7', name: 'Cliente', rif: 'J-12345678-9' }
  ];
  assert.throws(() => resolveUniversalPartyReference(rows, rows[0], 'customer'), /mismo archivo/);
});

test('rechaza referencias de contraparte ambiguas', () => {
  const rows = [
    { migrationfile: 'archivo-a', invoiceNumber: 'F-1', customerId: 'C-7' },
    { migrationfile: 'archivo-a', id: 'C-7', name: 'Cliente A', rif: 'J-12345678-9' },
    { migrationfile: 'archivo-a', id: 'C-7', name: 'Cliente B', rif: 'J-98765432-1' }
  ];
  assert.throws(() => resolveUniversalPartyReference(rows, rows[0], 'customer'), /varios registros/);
});

test('prefiere la contraparte explícita cuando nombre y RIF están presentes', () => {
  const invoice = { migrationfile: 'archivo-a', customerName: 'Cliente directo', customerRif: 'J-12345678-9' };
  assert.deepEqual(resolveUniversalPartyReference([invoice], invoice, 'customer'), {
    name: 'Cliente directo', rif: 'J-12345678-9', source: 'inline'
  });
});


test('resuelve líneas de compra desde una colección relacionada del mismo archivo', () => {
  const invoice = { migrationfile: 'archivo-a', id: 'P-100', invoiceNumber: 'FC-100' };
  const rows = [
    invoice,
    { migrationfile: 'archivo-a', migrationcollection: 'purchaseLines', purchaseId: 'P-100', productCode: 'SKU-1', quantity: 2, unitCostBs: 10 },
    { migrationfile: 'archivo-a', migrationcollection: 'purchaseLines', invoice_id: 'P-100', sku: 'SKU-2', qty: 3, unitCostBs: 5 },
    { migrationfile: 'archivo-b', purchaseId: 'P-100', productCode: 'SKU-3', quantity: 1, unitCostBs: 1 },
    { migrationfile: 'archivo-a', purchaseId: 'P-100', note: 'no es línea de mercancía' }
  ];
  const result = resolveUniversalPurchaseDetailRows(rows, invoice);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(row => row.productCode ?? row.sku), ['SKU-1', 'SKU-2']);
});

test('no enlaza líneas si la factura no tiene identificador explícito', () => {
  const invoice = { migrationfile: 'archivo-a', invoiceNumber: 'FC-100' };
  const rows = [
    invoice,
    { migrationfile: 'archivo-a', purchaseId: 'P-100', productCode: 'SKU-1', quantity: 2 }
  ];
  assert.deepEqual(resolveUniversalPurchaseDetailRows(rows, invoice), []);
});

test('rechaza identificadores de factura contradictorios', () => {
  const invoice = { migrationfile: 'archivo-a', id: 'P-100', purchaseId: 'P-200' };
  assert.throws(() => resolveUniversalPurchaseDetailRows([invoice], invoice), /identificadores incompatibles/);
});


test('preserva dirección, correo y condición fiscal de la contraparte relacionada', () => {
  const invoice = { migrationfile: 'archivo-a', invoiceNumber: 'C-9', supplierId: 'S-9' };
  const rows = [
    invoice,
    { migrationfile: 'archivo-a', id: 'S-9', name: 'Proveedor Uno', rif: 'J-12345678-9', address: 'Av. Principal', email: 'ventas@example.test', taxStatus: 'ORDINARY' }
  ];
  assert.deepEqual(resolveUniversalPartyReference(rows, invoice, 'supplier'), {
    name: 'Proveedor Uno',
    rif: 'J-12345678-9',
    address: 'Av. Principal',
    email: 'ventas@example.test',
    taxStatus: 'ORDINARY',
    source: 'related-record'
  });
});


test('normaliza tipos de movimientos históricos sin inferir valores desconocidos', () => {
  assert.equal(mapUniversalInventoryMovementType('Entrada'), 'ENTRADA');
  assert.equal(mapUniversalInventoryMovementType('OUT'), 'SALIDA');
  assert.equal(mapUniversalInventoryMovementType('adjustment'), 'AJUSTE');
  assert.equal(mapUniversalInventoryMovementType('transfer'), null);
});

test('normaliza conceptos de movimientos históricos y rechaza conceptos desconocidos', () => {
  assert.equal(mapUniversalInventoryMovementConcept('Compra'), 'COMPRA');
  assert.equal(mapUniversalInventoryMovementConcept('Inventario inicial'), 'INVENTARIO_INICIAL');
  assert.equal(mapUniversalInventoryMovementConcept('Autoconsumo'), 'AUTOCONSUMO');
  assert.equal(mapUniversalInventoryMovementConcept('Devolución a proveedor'), 'DEVOLUCION_COMPRA');
  assert.equal(mapUniversalInventoryMovementConcept('consignación'), null);
});


test('detecta detalles de mercancía anidados en facturas de venta', () => {
  assert.equal(hasUniversalNestedMerchandiseDetails({ items: [{ sku: 'A-1', cantidad: 2 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ detalles: [{ codigoProducto: 'A-1', quantity: 1 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ artículos: [{ códigoProducto: 'A-2', cantidad: 3 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ payments: [{ paymentReference: 'P-1', amount: 10 }] }), false);
  assert.equal(hasUniversalNestedMerchandiseDetails({ items: [{ paymentReference: 'P-1', amount: 10 }], lines: [{ sku: 'A-3', qty: 1 }] }), true);
});

test('detecta liquidaciones relacionadas por ID, factura/RIF y sin cruzar archivos', () => {
  const invoice = { migrationfile: 'archivo-a', id: 'F-1' };
  const rows = [
    invoice,
    { migrationfile: 'archivo-a', invoiceId: 'F-1', settlementDate: '2026-01-10', amountBs: 50, method: 'BANK_TRANSFER_BS', reference: 'TR-1' },
    { migrationfile: 'archivo-a', invoiceId: 'F-1', paymentDate: '2026-01-11', amountBs: 10 },
    { migrationfile: 'archivo-a', invoiceId: 'F-1', productCode: 'SKU-1', quantity: 2, amountBs: 50 },
    { migrationfile: 'archivo-b', invoiceId: 'F-1', settlementDate: '2026-01-10', amountBs: 50, method: 'CASH_BS' }
  ];
  assert.equal(resolveUniversalInvoiceSettlementRows(rows, invoice).length, 2);
  const invoiceWithoutId = { migrationfile: 'archivo-a', invoiceNumber: 'F-20', customerRif: 'J-12345678-9' };
  const related = [
    invoiceWithoutId,
    { migrationfile: 'archivo-a', invoiceNumber: 'F-20', customerRif: 'J-12345678-9', fechaCobro: '2026-02-01', monto: 25, medioPago: 'CASH_BS' },
    { migrationfile: 'archivo-a', invoiceNumber: 'F-20', customerRif: 'J-12345678-9', fechaCobro: '2026-02-02', paidAmount: 10, tipoOperacion: 'COBRO' },
    { migrationfile: 'archivo-a', invoiceNumber: 'F-20', customerRif: 'J-99999999-9', fechaCobro: '2026-02-01', monto: 25, medioPago: 'CASH_BS' },
    { migrationfile: 'archivo-b', invoiceNumber: 'F-20', customerRif: 'J-12345678-9', fechaCobro: '2026-02-01', monto: 25, medioPago: 'CASH_BS' }
  ];
  assert.equal(resolveUniversalInvoiceSettlementRows(related, invoiceWithoutId).length, 2);
});

test('detecta pagos embebidos en importes localizados y no confunde saldo cero', () => {
  assert.equal(hasUniversalInlineSettlementAmount({ paidAmountBs: 25 }), true);
  assert.equal(hasUniversalInlineSettlementAmount({ montoCobradoBs: '1.250,00' }), true);
  assert.equal(hasUniversalInlineSettlementAmount({ amountPaid: '75,50' }), true);
  assert.equal(hasUniversalInlineSettlementAmount({ paidAmountBs: 0, amountCollectedUsd: '0.00', totalPaid: 0 }), false);
  assert.equal(hasUniversalInlineSettlementAmount({ outstandingBalanceBs: 25 }), false);
});
