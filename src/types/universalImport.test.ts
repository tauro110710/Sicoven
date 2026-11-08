import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePosvenBackupMapping, detectImportSourceSystem, detectUniversalImportFormat, extractUniversalJsonCollections, resolveUniversalPartyReference, resolveUniversalPurchaseDetailRows, prepareUniversalSaleInventoryLines, prepareUniversalPurchaseInventoryLines, hasUniversalNestedMerchandiseDetails, mapUniversalInventoryMovementType, mapUniversalInventoryMovementConcept, classifyUniversalInvoiceRows, groupUniversalJournalRows, isUniversalMovementTypeConceptValid, normalizeUniversalDocumentReference, findUniversalInvoiceJournalCollision, buildUniversalInvoiceIdentity, mapUniversalInventoryCostingMethod, mapUniversalInventoryVatTreatment, resolveUniversalInvoiceSettlementRows, hasUniversalInlineSettlementAmount, selectUniversalRowsByStableKeys, mapUniversalSettlementPreview, mapUniversalInventoryItemType, isUniversalProductCollectionPath, getUniversalJsonValueAtPath, planUniversalInvoiceSettlements, selectUniversalInvoiceSettlements, validateUniversalSettlementDestination } from './universalImport';



test('la selección individual de liquidaciones conserva solo las claves marcadas y sus facturas', () => {
  const plans = [
    { invoiceRowId: 'invoice-1', invoiceKind: 'sales' as const, settlements: [
      { sourceRowId: 'payment-1', settlementDate: '2026-11-01', bcvRate: 100, amountUsd: 5, amountBs: 500, method: 'CASH_BS' as const },
      { sourceRowId: 'payment-2', settlementDate: '2026-11-02', bcvRate: 100, amountUsd: 3, amountBs: 300, method: 'CASH_BS' as const }
    ] },
    { invoiceRowId: 'invoice-2', invoiceKind: 'purchases' as const, settlements: [
      { sourceRowId: 'payment-3', settlementDate: '2026-11-03', bcvRate: 100, amountUsd: 2, amountBs: 200, method: 'CASH_BS' as const }
    ] }
  ];
  const selected = selectUniversalInvoiceSettlements(plans, ['payment-2', 'payment-3']);
  assert.deepEqual(selected.map(plan => [plan.invoiceRowId, plan.settlements.map(item => item.sourceRowId)]), [
    ['invoice-1', ['payment-2']], ['invoice-2', ['payment-3']]
  ]);
  assert.equal(selectUniversalInvoiceSettlements(plans, []).reduce((sum, plan) => sum + plan.settlements.length, 0), 0);
});

test('la selección individual rechaza claves ausentes o duplicadas', () => {
  const plans = [{ invoiceRowId: 'invoice-1', invoiceKind: 'sales' as const, settlements: [
    { sourceRowId: 'payment-1', settlementDate: '2026-11-01', bcvRate: 100, amountUsd: 5, amountBs: 500, method: 'CASH_BS' as const }
  ] }];
  assert.throws(() => selectUniversalInvoiceSettlements(plans, ['missing']), /ya no está disponible/);
  assert.throws(() => selectUniversalInvoiceSettlements(plans, ['payment-1', 'payment-1']), /vacías o duplicadas/);
  assert.throws(() => selectUniversalInvoiceSettlements([{ ...plans[0], settlements: [...plans[0].settlements, ...plans[0].settlements] }], ['payment-1']), /vacía o duplicada/);
});

test('detecta arreglos JSON en la raíz sin conocer el nombre del sistema', () => {
  const result = extractUniversalJsonCollections([{ codigo: 'A1' }, { codigo: 'A2' }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].path, '$');
  assert.equal(result[0].rows.length, 2);
  assert.equal(result[0].invalidItems, 0);
});

test('mapea la estructura POSVEN real y separa facturas de recibos CxC', () => {
  const backup = { app: 'posven-pro', version: 3, data: {
    productos: [{ id: 'p1', codigo: 'A1' }],
    ventas: [
      { id: 'C4-V-0001', cliente: 'Cliente A', totalUSD: 10, items: [{ productoId: 'p1', cantidad: 1 }] },
      { id: 'C4-CXC-0001', cliente: 'Cliente A', totalUSD: 2, items: [{ productoId: 'ABONO', cantidad: 1 }] }
    ],
    cxc: [
      { id: 'CRD-1', ventaId: 'C4-V-0001', cliente: 'Cliente A [V-123]', historialPagos: [{ id: 'C4-CXC-0001', reciboId: 'C4-CXC-0001' }] },
      { id: 'CRD-LEGACY', historialPagos: [] }
    ],
    compras: [
      { id: 'CP1', numeroFactura: '01', proveedor: 'Proveedor A' },
      { id: 'CP2', numeroFactura: '02', proveedor: 'Proveedor A' },
      { id: 'CP3', numeroFactura: '01', proveedor: 'Proveedor A' }
    ],
    proveedores: [{ id: 'S1', nombre: 'Proveedor A' }],
    cxp: [
      { id: 'XP1', numeroFactura: '01', proveedor: 'Proveedor A', historialPagos: [{ id: 'P2' }] },
      { id: 'XP2', numeroFactura: '99', proveedor: 'Otro', historialPagos: [] }
    ],
    movimientos: [
      { id: 'M1', productoId: 'p1', tipo: 'venta' },
      { id: 'M2', productoId: 'p1', tipo: 'compra' },
      { id: 'M3', productoId: 'p1', tipo: 'inicial' },
      { id: 'M4', productoId: 'p1', tipo: 'ajuste_entrada' },
      { id: 'M5', productoId: 'missing', tipo: 'ajuste_salida' }
    ],
    libroDiario: [{ id: 'L1', tipo: 'ingreso', montoUSD: 10, montoBS: 100 }],
    terminales: [{ id: 'T1', cashHistory: [{ id: 'C1' }, { id: 'C2' }] }],
    reportesZ: [{ id: 'Z1' }],
    devoluciones: [{ id: 'D1', ventaId: 'C4-V-0001' }],
    anulaciones: [{ id: 'A1', ventaId: 'C4-V-0001' }],
    users: [{ id: 'U1' }]
  } };
  const result = analyzePosvenBackupMapping(backup);
  assert.equal(result.salesInvoices, 1);
  assert.equal(result.salesCollectionReceipts, 2);
  assert.equal(result.collectionReceiptsLinkedToHistory, 1);
  assert.equal(result.collectionReceiptsWithoutHistory, 1);
  assert.equal(result.salesProductLines, 1);
  assert.equal(result.unresolvedSalesProductLines, 0);
  assert.equal(result.salesMissingFiscalControl, 1);
  assert.equal(result.salesMissingCustomerRif, 1);
  assert.equal(result.salesCustomerRifResolvedByRelatedRecord, 1);
  assert.equal(result.salesCustomerRifStillUnresolved, 0);
  assert.equal(result.salesMissingTaxRate, 1);
  assert.equal(result.salesWithLinkedReceivable, 1);
  assert.equal(result.receivables, 2);
  assert.equal(result.receivablesLinkedToSales, 1);
  assert.equal(result.receivablesWithoutSaleLink, 1);
  assert.equal(result.receivablePaymentEvents, 1);
  assert.equal(result.purchases, 3);
  assert.equal(result.purchasesWithUniqueSupplier, 3);
  assert.equal(result.payablesWithUniquePurchaseMatch, 0);
  assert.equal(result.payablesWithAmbiguousPurchaseMatch, 1);
  assert.equal(result.payablesWithoutPurchaseMatch, 1);
  assert.equal(result.payablePaymentEvents, 1);
  assert.equal(result.movements, 5);
  assert.equal(result.movementsWithProductResolved, 4);
  assert.equal(result.movementSaleRows, 1);
  assert.equal(result.movementPurchaseRows, 1);
  assert.equal(result.movementOpeningRows, 1);
  assert.equal(result.movementAdjustmentRows, 2);
  assert.equal(result.movementsMissingCostAndBcv, 5);
  assert.equal(result.cashbookRows, 1);
  assert.equal(result.cashbookRowsWithDoubleEntryAccounts, 0);
  assert.equal(result.cashbookRowsWithDebitCredit, 0);
  assert.equal(result.cashSessions, 2);
  assert.equal(result.terminals, 1);
  assert.equal(result.zReports, 1);
  assert.equal(result.returnsLinkedToSales, 1);
  assert.equal(result.voidsLinkedToSales, 1);
  assert.equal(result.hasBankAccounts, false);
  assert.equal(result.hasRetentionVouchers, false);
  assert.equal(result.hasFixedAssets, false);
  assert.equal(result.hasChartOfAccounts, false);
  assert.equal(result.users, 1);
});

test('reconoce rutas anidadas de productos sin confundir detalles de ventas', () => {
  assert.equal(isUniversalProductCollectionPath('productos'), true);
  assert.equal(isUniversalProductCollectionPath('catalogo.productos'), true);
  assert.equal(isUniversalProductCollectionPath('inventario.products'), true);
  assert.equal(isUniversalProductCollectionPath('ventas.detalles'), false);
  assert.equal(isUniversalProductCollectionPath('compras'), false);
});

test('resuelve una colección JSON por ruta anidada sin alterar el respaldo', () => {
  const source = { catalogo: { inventario: { productos: [{ codigo: 'A1' }] } } };
  const selected = getUniversalJsonValueAtPath(source, 'catalogo.inventario.productos');
  assert.deepEqual(selected, [{ codigo: 'A1' }]);
  assert.equal(getUniversalJsonValueAtPath(source, 'catalogo.inventario.noExiste'), undefined);
  assert.deepEqual(source.catalogo.inventario.productos, [{ codigo: 'A1' }]);
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
  const typedEntries = [
    { referenceDoc: 'FAC-000123', type: 'VENTA' },
    { referenceDoc: 'FAC-000123', type: 'COMPRA' }
  ];
  assert.equal(findUniversalInvoiceJournalCollision('000123', typedEntries, 'VENTA')?.type, 'VENTA');
  assert.equal(findUniversalInvoiceJournalCollision('000123', typedEntries, 'COMPRA')?.type, 'COMPRA');
  assert.equal(findUniversalInvoiceJournalCollision('000123', [typedEntries[0]], 'COMPRA'), undefined);
  assert.equal(findUniversalInvoiceJournalCollision('000123', [{ referenceDoc: 'FAC-000123', type: 'MANUAL' }], 'VENTA')?.type, 'MANUAL');
  assert.equal(findUniversalInvoiceJournalCollision('000123', [{ referenceDoc: 'FAC-000123', type: 'MANUAL' }], 'COMPRA')?.type, 'MANUAL');
});


test('identifica facturas de venta globalmente y compras por proveedor según el dominio SICOVEN', () => {
  assert.equal(buildUniversalInvoiceIdentity('sales', ' FAC 0001 ', 'J-111'), '0001');
  assert.equal(buildUniversalInvoiceIdentity('sales', 'FAC0001', 'J-222'), '0001');
  assert.equal(buildUniversalInvoiceIdentity('purchases', '0001', 'J-111'), '0001|J111');
  assert.equal(buildUniversalInvoiceIdentity('purchases', '0001', 'J-222'), '0001|J222');
});


test('interpreta costos de compra con espacios, miles y decimales en formatos locales', () => {
  const products = [
    { id: 'p1', code: 'SKU-1' },
    { id: 'p2', code: 'SKU-2' }
  ];
  const bsLines = prepareUniversalPurchaseInventoryLines([
    { codigo: 'SKU-1', cantidad: '2', costoUnitarioBs: '1.234,50' }
  ], products, { taxableBaseBs: 2469, exemptAmountBs: 0, bcvRate: 100 });
  assert.deepEqual(bsLines, [{ productId: 'p1', quantity: 2, unitCostBs: 1234.5 }]);

  const usdLines = prepareUniversalPurchaseInventoryLines([
    { sku: 'SKU-2', qty: '2', cost: ' 2,50 ', currency: 'USD' }
  ], products, { taxableBaseBs: 500, exemptAmountBs: 0, bcvRate: 100 });
  assert.deepEqual(usdLines, [{ productId: 'p2', quantity: 2, unitCostBs: 250 }]);
});


test('la clasificación de inventario universal exige valores de origen reconocibles y nunca asigna defaults', () => {
  assert.equal(mapUniversalInventoryCostingMethod('PEPS'), 'PEPS');
  assert.equal(mapUniversalInventoryCostingMethod('FIFO'), 'PEPS');
  assert.equal(mapUniversalInventoryCostingMethod('Promedio ponderado'), 'PROMEDIO_PONDERADO');
  assert.equal(mapUniversalInventoryCostingMethod(''), null);
  assert.equal(mapUniversalInventoryCostingMethod('LIFO'), null);

  assert.equal(mapUniversalInventoryVatTreatment('16%'), 'GENERAL_16');
  assert.equal(mapUniversalInventoryVatTreatment('IVA 8'), 'REDUCIDA_8');
  assert.equal(mapUniversalInventoryVatTreatment('Exento'), 'EXENTO');
  assert.equal(mapUniversalInventoryVatTreatment('Exonerado'), 'EXONERADO');
  assert.equal(mapUniversalInventoryVatTreatment(''), null);
  assert.equal(mapUniversalInventoryVatTreatment('31%'), null);
  assert.equal(mapUniversalInventoryVatTreatment('General'), null);

  assert.equal(mapUniversalInventoryItemType('Mercancía'), 'MERCANCIA');
  assert.equal(mapUniversalInventoryItemType('Materia prima'), 'MATERIA_PRIMA');
  assert.equal(mapUniversalInventoryItemType('Producto en proceso'), 'PRODUCTO_EN_PROCESO');
  assert.equal(mapUniversalInventoryItemType('Producto terminado'), 'PRODUCTO_TERMINADO');
  assert.equal(mapUniversalInventoryItemType('Subproducto'), 'SUBPRODUCTO');
  assert.equal(mapUniversalInventoryItemType(''), null);
  assert.equal(mapUniversalInventoryItemType('Producto'), null);
  assert.equal(mapUniversalInventoryItemType('servicio'), null);
});


test('detecta liquidaciones por identificador explícito solo dentro del mismo archivo', () => {
  const invoice = { migrationfile: 'ventas.json', id: 'sale-1', invoiceNumber: 'F-001', customerRif: 'J-123' };
  const linked = { migrationfile: 'ventas.json', invoiceId: 'sale-1', date: '2026-11-05', amountBs: 40, method: 'TRANSFERENCIA' };
  const foreignFile = { migrationfile: 'pagos.json', invoiceId: 'sale-1', date: '2026-11-05', amountBs: 40, method: 'TRANSFERENCIA' };
  assert.deepEqual(resolveUniversalInvoiceSettlementRows([invoice, linked, foreignFile], invoice), [linked]);
});

test('detecta liquidaciones por factura y RIF exactos cuando no existe ID', () => {
  const invoice = { migrationfile: 'origen.json', invoiceNumber: 'FAC-77', customerRif: 'J-12345678-9' };
  const linked = { migrationfile: 'origen.json', invoiceNumber: 'FAC-77', partyRif: 'J-12345678-9', fechaPago: '2026-11-05', montoBs: '125,00', medioPago: 'Banco' };
  const wrongParty = { migrationfile: 'origen.json', invoiceNumber: 'FAC-77', partyRif: 'J-99999999-9', fechaPago: '2026-11-05', montoBs: 125, medioPago: 'Banco' };
  assert.deepEqual(resolveUniversalInvoiceSettlementRows([invoice, linked, wrongParty], invoice), [linked]);
});

test('no confunde renglones de mercancía con liquidaciones', () => {
  const invoice = { migrationfile: 'origen.json', id: 'sale-1' };
  const line = { migrationfile: 'origen.json', saleId: 'sale-1', productCode: 'SKU-1', quantity: 2, date: '2026-11-05', amountBs: 50 };
  assert.deepEqual(resolveUniversalInvoiceSettlementRows([invoice, line], invoice), []);
});

test('detecta importes pagados positivos embebidos y permite campos de pago en cero', () => {
  assert.equal(hasUniversalInlineSettlementAmount({ montoPagado: '1.250,00' }), true);
  assert.equal(hasUniversalInlineSettlementAmount({ amountCollectedUsd: '0.00' }), false);
  assert.equal(hasUniversalInlineSettlementAmount({ totalPaidBs: 0 }), false);
});

test('rechaza identificadores contradictorios en la factura al buscar liquidaciones', () => {
  const invoice = { migrationfile: 'origen.json', id: 'sale-1', invoiceId: 'sale-2', invoiceNumber: 'F-001', customerRif: 'J-123' };
  assert.throws(() => resolveUniversalInvoiceSettlementRows([invoice], invoice), /identificadores incompatibles/);
});


test('la selección individual importa exclusivamente las claves estables marcadas', () => {
  const collections = extractUniversalJsonCollections({
    ventas: [
      { invoiceNumber: 'F-001', customerName: 'Cliente 1', customerRif: 'J-1' },
      { invoiceNumber: 'F-002', customerName: 'Cliente 2', customerRif: 'J-2' }
    ]
  });
  const rows = collections.flatMap(collection => collection.rows.map((row, index) => ({
    ...row,
    migrationfile: 'ventas.json',
    migrationcollection: collection.path,
    migrationrowid: 'ventas.json|' + collection.path + '|' + index
  })));
  const selected = selectUniversalRowsByStableKeys(rows, ['ventas.json|ventas|1']);
  assert.deepEqual(selected.map(row => row.invoiceNumber), ['F-002']);
  assert.equal(selectUniversalRowsByStableKeys(rows, []).length, 0);
});

test('la selección individual rechaza claves ausentes, duplicadas y ambiguas', () => {
  const rows = [
    { migrationrowid: 'file.json|ventas|0', invoiceNumber: 'F-001' },
    { migrationrowid: 'file.json|ventas|1', invoiceNumber: 'F-002' }
  ];
  assert.throws(() => selectUniversalRowsByStableKeys(rows, ['file.json|ventas|9']), /ya no está disponible/);
  assert.throws(() => selectUniversalRowsByStableKeys(rows, ['file.json|ventas|0', 'file.json|ventas|0']), /claves de registro duplicadas/);
  assert.throws(() => selectUniversalRowsByStableKeys([...rows, { ...rows[0], invoiceNumber: 'F-003' }], ['file.json|ventas|0']), /no es única/);
});


test('normaliza cobros en efectivo con fecha, BCV y equivalencia Bs/USD explícitos', () => {
 const r=mapUniversalSettlementPreview({migrationrowid:'origen.json|cobros|0',fechaCobro:'2026-10-15',tasaBcv:250,montoBs:2500,medioPago:'efectivo'});
 assert.equal(r.amountUsd,10);assert.equal(r.method,'CASH_BS');assert.equal(r.settlementDate,'2026-10-15');
});
test('rechaza liquidaciones sin tasa, fecha inválida, diferencias cambiarias o banco no identificado', () => {
 const b={migrationrowid:'f|pagos|0',fechaPago:'2026-10-15',tasaBcv:250,montoBs:2500,medioPago:'efectivo'};
 assert.throws(()=>mapUniversalSettlementPreview({...b,tasaBcv:undefined}),/tasa BCV histórica/);
 assert.throws(()=>mapUniversalSettlementPreview({...b,fechaPago:'2026-02-30'}),/fecha válida/);
 assert.throws(()=>mapUniversalSettlementPreview({...b,montoUsd:20}),/no concilian/);
 assert.throws(()=>mapUniversalSettlementPreview({...b,medioPago:'transferencia',referencia:'TR-1'}),/ID de una cuenta bancaria real/);
 assert.throws(()=>mapUniversalSettlementPreview({...b,medioPago:'transferencia',bankAccountId:'BANK-1'}),/referencia o comprobante/);
});

 
test('el plan de liquidaciones bloquea referencias bancarias repetidas ignorando espacios y mayúsculas en todo el lote', () => {
  const invoices = [
    { migrationfile: 'origen.json', migrationrowid: 'ventas|0', id: 'V-1', invoiceNumber: 'F-1', customerRif: 'J-1', totalAmountUsd: 100 },
    { migrationfile: 'origen.json', migrationrowid: 'ventas|1', id: 'V-2', invoiceNumber: 'F-2', customerRif: 'J-2', totalAmountUsd: 100 }
  ];
  const settlements = [
    { migrationfile: 'origen.json', migrationrowid: 'cobros|0', invoiceId: 'V-1', settlementDate: '2026-11-06', bcvRate: 100, amountBs: 1000, amountUsd: 10, method: 'TRANSFERENCIA', bankAccountId: 'BANK-01', reference: 'AB 123' },
    { migrationfile: 'origen.json', migrationrowid: 'cobros|1', invoiceId: 'V-2', settlementDate: '2026-11-06', bcvRate: 100, amountBs: 500, amountUsd: 5, method: 'TRANSFERENCIA', bankAccountId: ' bank-01 ', reference: 'ab123' }
  ];
  assert.throws(() => planUniversalInvoiceSettlements(invoices, [...invoices, ...settlements], 'sales'), /referencia bancaria .*repetida en la misma cuenta/);
});

test('el plan de liquidaciones conserva referencias iguales en cuentas bancarias distintas', () => {
  const invoices = [
    { migrationfile: 'origen.json', migrationrowid: 'ventas|0', id: 'V-1', invoiceNumber: 'F-1', customerRif: 'J-1', totalAmountUsd: 100 },
    { migrationfile: 'origen.json', migrationrowid: 'ventas|1', id: 'V-2', invoiceNumber: 'F-2', customerRif: 'J-2', totalAmountUsd: 100 }
  ];
  const settlements = [
    { migrationfile: 'origen.json', migrationrowid: 'cobros|0', invoiceId: 'V-1', settlementDate: '2026-11-06', bcvRate: 100, amountBs: 1000, amountUsd: 10, method: 'TRANSFERENCIA', bankAccountId: 'BANK-01', reference: 'AB-123' },
    { migrationfile: 'origen.json', migrationrowid: 'cobros|1', invoiceId: 'V-2', settlementDate: '2026-11-06', bcvRate: 100, amountBs: 500, amountUsd: 5, method: 'TRANSFERENCIA', bankAccountId: 'BANK-02', reference: 'AB-123' }
  ];
  const plan = planUniversalInvoiceSettlements(invoices, [...invoices, ...settlements], 'sales');
  assert.equal(plan.length, 2);
  assert.equal(plan.reduce((sum, item) => sum + item.settlements.length, 0), 2);
});


test('valida destinos bancarios históricos por empresa, moneda y auxiliar de movimiento', () => {
  const settlement = {
    settlementDate: '2026-11-05', bcvRate: 100, amountUsd: 10, amountBs: 1000,
    method: 'BANK_TRANSFER_BS' as const, bankAccountId: 'bank-bs', reference: 'TRX-1', sourceRowId: 'payment-1'
  };
  const bankAccounts = [{ id: 'bank-bs', companyId: 'company-1', accountCode: '1.1.1.03', currency: 'BS' as const }];
  const accounts = [{ code: '1.1.1.03', type: 'ACTIVO', isMovement: true }];
  assert.equal(validateUniversalSettlementDestination(settlement, 'company-1', bankAccounts, accounts), null);
  assert.match(validateUniversalSettlementDestination(settlement, 'company-2', bankAccounts, accounts) || '', /inexistente o perteneciente a otra empresa/);
  assert.match(validateUniversalSettlementDestination(settlement, 'company-1', [{ ...bankAccounts[0], currency: 'USD' as const }], accounts) || '', /moneda/);
  assert.match(validateUniversalSettlementDestination(settlement, 'company-1', bankAccounts, [{ ...accounts[0], isMovement: false }]) || '', /auxiliar contable/);
});

test('valida transferencia USD y no permite vincular caja a una cuenta bancaria', () => {
  const usd = {
    settlementDate: '2026-11-05', bcvRate: 100, amountUsd: 10, amountBs: 1000,
    method: 'BANK_TRANSFER_USD' as const, bankAccountId: 'bank-usd', reference: 'TRX-USD', sourceRowId: 'payment-usd'
  };
  const banks = [{ id: 'bank-usd', companyId: 'company-1', accountCode: '1.1.1.07.01', currency: 'USD' as const }];
  const accounts = [{ code: '1.1.1.07.01', type: 'ACTIVO', isMovement: true }];
  assert.equal(validateUniversalSettlementDestination(usd, 'company-1', banks, accounts), null);
  assert.match(validateUniversalSettlementDestination({ ...usd, method: 'CASH_BS' as const }, 'company-1', banks, accounts) || '', /efectivo no puede identificar/);
});
