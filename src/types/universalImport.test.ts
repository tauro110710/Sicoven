import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImportSourceSystem, detectUniversalImportFormat, extractUniversalJsonCollections, resolveUniversalPartyReference, resolveUniversalPurchaseDetailRows, prepareUniversalSaleInventoryLines, prepareUniversalPurchaseInventoryLines, hasUniversalNestedMerchandiseDetails, mapUniversalInventoryMovementType, mapUniversalInventoryMovementConcept, classifyUniversalInvoiceRows, groupUniversalJournalRows, isUniversalMovementTypeConceptValid, normalizeUniversalDocumentReference, findUniversalInvoiceJournalCollision } from './universalImport';

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


test('detecta detalles de mercancía anidados en una factura de venta', () => {
  assert.equal(hasUniversalNestedMerchandiseDetails({ items: [{ sku: 'A-1', cantidad: 2 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ detalles: [{ codigoProducto: 'A-1', quantity: 1 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ artículos: [{ códigoProducto: 'A-2', cantidad: 3 }] }), true);
  assert.equal(hasUniversalNestedMerchandiseDetails({ payments: [{ paymentReference: 'P-1', amount: 10 }] }), false);
  assert.equal(hasUniversalNestedMerchandiseDetails({ items: [] }), false);
  assert.equal(hasUniversalNestedMerchandiseDetails({ items: [{ paymentReference: 'P-1', amount: 10 }], lines: [{ sku: 'A-3', qty: 1 }] }), true);
});

test('detecta renglones de mercancía relacionados por referencia explícita sin cruzar archivos', () => {
  const invoice = { migrationfile: 'archivo-a', id: 'F-1' };
  const rows = [invoice, { migrationfile: 'archivo-a', invoiceId: 'F-1', productCode: 'SKU-1', quantity: 2 }, { migrationfile: 'archivo-b', invoiceId: 'F-1', productCode: 'SKU-2', quantity: 1 }];
  assert.equal(resolveUniversalPurchaseDetailRows(rows, invoice).length, 1);
});


test('prepara líneas de venta y concilia mercancía, IVA y exento con la factura', () => {
  const products = [
    { id: 'p1', code: 'A-1', name: 'Artículo 16%', vatTreatment: 'GENERAL_16' as const },
    { id: 'p2', code: 'B-1', name: 'Artículo exento', vatTreatment: 'EXENTO' as const }
  ];
  const lines = prepareUniversalSaleInventoryLines([
    { sku: 'A-1', quantity: 2, unitPriceBs: 50 },
    { sku: 'B-1', quantity: 1, unitPriceBs: 20 }
  ], products, { taxRate: 16, taxableBaseBs: 100, exemptAmountBs: 20, vatAmountBs: 16 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0].totalBs, 116);
  assert.equal(lines[1].exemptAmountBs, 20);
});

test('bloquea ventas con tasas mezcladas, artículo ajeno o totales que no concilian', () => {
  const products = [
    { id: 'p1', code: 'A-1', name: 'Artículo 16%', vatTreatment: 'GENERAL_16' as const },
    { id: 'p2', code: 'B-1', name: 'Artículo 8%', vatTreatment: 'REDUCIDA_8' as const }
  ];
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'B-1', quantity: 1, unitPriceBs: 10 }], products, { taxRate: 16, taxableBaseBs: 10, exemptAmountBs: 0, vatAmountBs: 1.6, bcvRate: 10 }));
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'A-1', quantity: 1, unitPriceBs: 10, taxRate: 31 }], products, { taxRate: 31, taxableBaseBs: 10, exemptAmountBs: 0, vatAmountBs: 4.6, bcvRate: 10 }));
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'A-1', quantity: 1, unitPriceBs: 10 }, { sku: 'A-1', quantity: 1, unitPriceBs: 5 }], products, { taxRate: 16, taxableBaseBs: 15, exemptAmountBs: 0, vatAmountBs: 2.4, bcvRate: 10 }));
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'NO-EXISTE', quantity: 1, unitPriceBs: 10 }], products, { taxRate: 16, taxableBaseBs: 10, exemptAmountBs: 0, vatAmountBs: 1.6, bcvRate: 10 }));
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'A-1', quantity: 1, unitPriceBs: 10 }], products, { taxRate: 16, taxableBaseBs: 11, exemptAmountBs: 0, vatAmountBs: 1.76, bcvRate: 10 }));
  assert.throws(() => prepareUniversalSaleInventoryLines([{ sku: 'A-1', quantity: 1, price: 10 }], products, { taxRate: 16, taxableBaseBs: 10, exemptAmountBs: 0, vatAmountBs: 1.6, bcvRate: 10 }));
  const usdLine = prepareUniversalSaleInventoryLines([{ sku: 'A-1', quantity: 1, unitPriceUsd: 2 }], products, { taxRate: 16, taxableBaseBs: 20, exemptAmountBs: 0, vatAmountBs: 3.2, bcvRate: 10 });
  assert.equal(usdLine[0].unitPriceBs, 20);
  assert.equal(usdLine[0].unitPriceUsd, 2);
});


test('prepara líneas de compra por SKU y concilia costo, cantidad y base imponible', () => {
  const products = [{ id: 'p1', code: 'A-1' }, { id: 'p2', code: 'B-1' }];
  const lines = prepareUniversalPurchaseInventoryLines([
    { sku: 'A-1', quantity: 2, unitCostBs: 50 },
    { sku: 'B-1', cantidad: 1, costoUnitarioBs: 20 }
  ], products, { taxableBaseBs: 100, exemptAmountBs: 20, bcvRate: 10 });
  assert.deepEqual(lines, [
    { productId: 'p1', quantity: 2, unitCostBs: 50 },
    { productId: 'p2', quantity: 1, unitCostBs: 20 }
  ]);
});

test('convierte costos USD explícitos y valida conciliación Bs/USD', () => {
  const products = [{ id: 'p1', code: 'A-1' }];
  const converted = prepareUniversalPurchaseInventoryLines([
    { sku: 'A-1', quantity: 2, unitCostUsd: 5 }
  ], products, { taxableBaseBs: 100, exemptAmountBs: 0, bcvRate: 10 });
  assert.equal(converted[0].unitCostBs, 50);
  assert.deepEqual(prepareUniversalPurchaseInventoryLines([
    { sku: 'A-1', quantity: 2, unitCostBs: 50, unitCostUsd: 5 }
  ], products, { taxableBaseBs: 100, exemptAmountBs: 0, bcvRate: 10 }), converted);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([
    { sku: 'A-1', quantity: 2, unitCostBs: 50, unitCostUsd: 7 }
  ], products, { taxableBaseBs: 100, exemptAmountBs: 0, bcvRate: 10 }), /no concilia/);
});

test('bloquea líneas de compra ambiguas, duplicadas, ajenas o sin conciliación', () => {
  const products = [{ id: 'p1', code: 'A-1' }];
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'A-1', quantity: 1, cost: 10 }], products, { taxableBaseBs: 10, exemptAmountBs: 0, bcvRate: 1 }), /No se asociará por descripción/);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'A-1', quantity: 1, price: 10 }], products, { taxableBaseBs: 10, exemptAmountBs: 0, bcvRate: 1 }), /No se asociará por descripción/);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'A-1', quantity: 1, unitCostBs: 10 }, { sku: 'A-1', quantity: 1, unitCostBs: 5 }], products, { taxableBaseBs: 15, exemptAmountBs: 0, bcvRate: 1 }), /aparece más de una vez/);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'NO-EXISTE', quantity: 1, unitCostBs: 10 }], products, { taxableBaseBs: 10, exemptAmountBs: 0, bcvRate: 1 }), /No se asociará por descripción/);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'A-1', quantity: 1, unitCostBs: 10 }], products, { taxableBaseBs: 11, exemptAmountBs: 0, bcvRate: 1 }), /no concilian/);
  assert.throws(() => prepareUniversalPurchaseInventoryLines([{ sku: 'A-1', quantity: 1, unitCostUsd: 10 }], products, { taxableBaseBs: 10, exemptAmountBs: 0, bcvRate: 0 }), /tasa BCV positiva/);
});


test('clasifica ventas y compras por los campos de cada factura sin cruzar colecciones del mismo archivo', () => {
  const rows = [
    { migrationfile: 'respaldo.json', migrationcollection: 'ventas', migrationrowid: 'ventas|0', invoiceNumber: 'V-1', fecha: '2026-01-02', total: 116, clienteId: 'C-1' },
    { migrationfile: 'respaldo.json', migrationcollection: 'compras', migrationrowid: 'compras|0', invoiceNumber: 'C-1', fecha: '2026-01-03', total: 232, proveedorId: 'P-1' },
    { migrationfile: 'respaldo.json', migrationcollection: 'otros', migrationrowid: 'otros|0', invoiceNumber: 'X-1', fecha: '2026-01-04', total: 50, clienteId: 'C-1', proveedorId: 'P-1' },
    { migrationfile: 'otro.json', migrationcollection: 'ventas', migrationrowid: 'ventas|0', invoiceNumber: 'V-2', fecha: '2026-01-05', total: 80, customerName: 'Cliente' }
  ];
  const result = classifyUniversalInvoiceRows(rows);
  assert.deepEqual(result.sales.map(row => row.invoiceNumber), ['V-1','V-2']);
  assert.deepEqual(result.purchases.map(row => row.invoiceNumber), ['C-1']);
  assert.deepEqual(result.ambiguous.map(row => row.invoiceNumber), ['X-1']);
});

test('no clasifica una fila como factura si carece de fecha, total o contraparte explícita', () => {
  const rows = [
    { invoiceNumber: 'V-1', customerName: 'Cliente' },
    { invoiceNumber: 'V-2', fecha: '2026-01-02', customerName: 'Cliente' },
    { invoiceNumber: 'V-3', fecha: '2026-01-02', total: 10 }
  ];
  const result = classifyUniversalInvoiceRows(rows);
  assert.equal(result.sales.length, 0);
  assert.equal(result.purchases.length, 0);
  assert.equal(result.ambiguous.length, 0);
});

test('agrupa asientos por archivo, fecha y referencia sin mezclar fuentes', () => {
  const groups = groupUniversalJournalRows([
    { migrationfile: 'a.json', date: '2026-01-01', referenceDoc: 'AS-1', accountCode: '1.1' },
    { migrationfile: 'a.json', date: '2026-01-01', referenceDoc: 'AS-1', accountCode: '3.1' },
    { migrationfile: 'b.json', date: '2026-01-01', referenceDoc: 'AS-1', accountCode: '1.1' },
    { migrationfile: 'a.json', date: '2026-01-02', referenceDoc: 'AS-1', accountCode: '1.1' }
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map(group => group.rows.length), [2,1,1]);
  assert.deepEqual(groups.map(group => group.sourceFile), ['a.json','b.json','a.json']);
});

test('valida correspondencia entre tipo y concepto de movimiento y normaliza referencias FAC', () => {
  assert.equal(isUniversalMovementTypeConceptValid('ENTRADA','COMPRA'), true);
  assert.equal(isUniversalMovementTypeConceptValid('SALIDA','VENTA'), true);
  assert.equal(isUniversalMovementTypeConceptValid('SALIDA','MERMA'), true);
  assert.equal(isUniversalMovementTypeConceptValid('AJUSTE','AJUSTE'), true);
  assert.equal(isUniversalMovementTypeConceptValid('ENTRADA','VENTA'), false);
  assert.equal(isUniversalMovementTypeConceptValid('SALIDA','COMPRA'), false);
  assert.equal(normalizeUniversalDocumentReference('FAC-000123'), '000123');
  assert.equal(normalizeUniversalDocumentReference('Factura 000123'), '000123');
});


test('resuelve detalles de venta POSVEN por ventaId dentro del mismo archivo', () => {
  const invoice = { migrationfile: 'posven.json', id: 'SALE-9', numero: 'V-9' };
  const rows = [
    invoice,
    { migrationfile: 'posven.json', ventaId: 'SALE-9', codigoProducto: 'SKU-9', cantidad: 2, precioUnitarioBs: 15 },
    { migrationfile: 'otro.json', ventaId: 'SALE-9', codigoProducto: 'SKU-10', cantidad: 1, precioUnitarioBs: 10 }
  ];
  assert.equal(resolveUniversalPurchaseDetailRows(rows, invoice).length, 1);
});

test('agrupa diarios desde encabezados normalizados por el lector universal', () => {
  const groups = groupUniversalJournalRows([
    { migrationfile: 'a.json', fecha: '2026-01-01', numeroasiento: '1', cuenta: '1.1' },
    { migrationfile: 'a.json', fecha: '2026-01-01', numeroasiento: '1', cuenta: '3.1' }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rows.length, 2);
});


test('normaliza prefijos repetidos y detecta asientos que ya representan una factura', () => {
  assert.equal(normalizeUniversalDocumentReference('FAC-000123'), '000123');
  assert.equal(normalizeUniversalDocumentReference('Factura 000123'), '000123');
  assert.equal(normalizeUniversalDocumentReference('FAC-FAC-000123'), '000123');
  assert.equal(normalizeUniversalDocumentReference('FAC'), 'FAC');
  const entries = [
    { referenceDoc: 'FAC-000123' },
    { referenceDoc: 'FAC-000124' }
  ];
  assert.equal(findUniversalInvoiceJournalCollision('000123', entries)?.referenceDoc, 'FAC-000123');
  assert.equal(findUniversalInvoiceJournalCollision('Factura 000124', entries)?.referenceDoc, 'FAC-000124');
  assert.equal(findUniversalInvoiceJournalCollision('000125', entries), undefined);
});
