const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAccountingSnapshot, exceedsUsdPayable } = require('./accounting-integrity.cjs');
const Database = require('better-sqlite3');

const line = (debitBs, creditBs, debitUsd, creditUsd) => ({
  accountCode: debitBs > 0 || creditBs > 0 ? '1.1.1.01' : '4.1.1.01',
  accountName: 'Cuenta de prueba', debitBs, creditBs, debitUsd, creditUsd
});
const sourceEntry = () => ({
  id: 'entry-1', companyId: 'company-1', entryNumber: 1, date: '2026-10-01',
  description: 'Asiento original', type: 'MANUAL', bcvRate: 100,
  items: [line(100, 0, 1, 0), line(0, 100, 0, 1)],
  createdAt: '2026-10-01T10:00:00.000Z'
});
const reversalEntry = () => ({
  id: 'entry-2', companyId: 'company-1', entryNumber: 2, date: '2026-10-02',
  description: 'REVERSIÓN / Corrección documentada', type: 'AJUSTE', bcvRate: 100, referenceDoc: 'REV-1',
  items: [line(0, 100, 0, 1), line(100, 0, 1, 0)],
  createdAt: '2026-10-02T10:00:00.000Z', reversalOfEntryId: 'entry-1',
  reversalReason: 'Corrección documentada de error', workpaperNote: 'Papel de trabajo y soporte revisado'
});
const emptyState = (journalEntries = []) => ({
  journalEntries, purchases: [], sales: [], movements: [], creditSettlements: [],
  bankStatementMovements: [], vatVouchers: [], islrVouchers: [], islrFiscalEvents: [], products: [], companies: [], accounts: []
});

test('SQLite rejects reuse of a lower unused journal sequence number', () => {
  const prior = { ...sourceEntry(), entryNumber: 5 };
  const lower = { ...sourceEntry(), id: 'entry-lower', entryNumber: 4 };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([prior]), emptyState([prior, lower])
  ), /correlativo de asiento no creciente/);
  const next = { ...sourceEntry(), id: 'entry-next', entryNumber: 6 };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    emptyState([prior]), emptyState([prior, next])
  ));
});


test('SQLite validates direct supplier advance disbursements against the exact cash/bank journal', () => {
  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true },
    { code: '6.1.1.01', name: 'Gastos', type: 'GASTOS', isMovement: true }
  ];
  const journal = {
    id: 'advance-journal', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Anticipo directo proveedor',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: 'TRX-ADV-1',
    items: [
      { accountCode: '1.1.2.03', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const advance = {
    id: 'advance-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', date: '2026-10-10', amountUsd: 100,
    bookValueBs: 10000, bcvRate: 100, treasuryAccountCode: '1.1.1.01',
    paymentCurrency: 'BS', paidAmount: 10000, reference: 'TRX-ADV-1', support: 'REC-ADV-1',
    journalEntryId: 'advance-journal', createdAt: '2026-10-10T10:00:00.000Z'
  };
  const previous = { ...emptyState(), supplierDirectAdvances: [] };
  const next = { ...emptyState([journal]), accounts, supplierDirectAdvances: [advance] };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, supplierDirectAdvances: [{ ...advance, treasuryAccountCode: '6.1.1.01' }]
  }), /cuenta de tesorería inválidos/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, supplierDirectAdvances: [{ ...advance, bookValueBs: 9000 }]
  }), /importes, moneda, referencia o cuenta/);
});

test('SQLite accepts a linked contra-entry reversal of an unused direct supplier advance', () => {
  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true }
  ];
  const original = {
    id: 'advance-original', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Anticipo directo', type: 'ANTICIPO_PROVEEDOR',
    bcvRate: 100, referenceDoc: 'ADV-REV-1', reversedByEntryId: 'advance-reversal',
    isAdjusted: true,
    items: [
      { accountCode: '1.1.2.03', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const reversal = {
    id: 'advance-reversal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-11', description: 'Reversión documentada del anticipo',
    type: 'AJUSTE', bcvRate: 100, referenceDoc: 'REV-1',
    reversalOfEntryId: 'advance-original', reversalReason: 'El desembolso fue registrado por duplicado.',
    workpaperNote: 'Se verificó el comprobante original y el movimiento bancario antes de revertir.',
    items: [
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 },
      { accountCode: '1.1.1.01', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const source = {
    id: 'advance-source-reversed', companyId: 'company-1', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', date: '2026-10-10', amountUsd: 100, bookValueBs: 10000,
    bcvRate: 100, treasuryAccountCode: '1.1.1.01', paymentCurrency: 'BS',
    paidAmount: 10000, reference: 'ADV-REV-1', support: 'REC-REV-1',
    journalEntryId: 'advance-original', createdAt: '2026-10-10T10:00:00.000Z',
    isReversed: true, reversedByJournalEntryId: 'advance-reversal'
  };
  const previous = {
    ...emptyState([ { ...original, reversedByEntryId: undefined, isAdjusted: undefined } ]),
    accounts, supplierDirectAdvances: [{ ...source, isReversed: false, reversedByJournalEntryId: undefined }]
  };
  const next = {
    ...emptyState([original, reversal]), accounts, supplierDirectAdvances: [source]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
});

test('SQLite accepts a direct supplier advance refund allocated to its original cash disbursement', () => {
  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true }
  ];
  const directJournal = {
    id: 'direct-journal', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Anticipo directo',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: 'TRX-DIRECT-1',
    items: [
      { accountCode: '1.1.2.03', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const refundJournal = {
    id: 'refund-journal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-11', description: 'Reembolso anticipo directo',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: 'REFUND-1',
    items: [
      { accountCode: '1.1.1.01', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const source = {
    id: 'direct-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', date: '2026-10-10', amountUsd: 100,
    bookValueBs: 10000, bcvRate: 100, treasuryAccountCode: '1.1.1.01',
    paymentCurrency: 'BS', paidAmount: 10000, reference: 'TRX-DIRECT-1', support: 'REC-DIRECT-1',
    journalEntryId: 'direct-journal', createdAt: '2026-10-10T10:00:00.000Z'
  };
  const settlement = {
    id: 'direct-refund-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', sourceCreditNoteIds: [], sourceCreditNoteAllocations: [],
    sourceDirectAdvanceIds: ['direct-1'],
    sourceDirectAdvanceAllocations: [{ directAdvanceId: 'direct-1', amountUsd: 100, bookValueBs: 10000 }],
    kind: 'REFUND_RECEIVED', date: '2026-10-11', amountUsd: 100, amountBs: 10000,
    advanceBookValueBs: 10000, cashReceivedBs: 10000, bcvRate: 100,
    treasuryAccountCode: '1.1.1.01', journalEntryId: 'refund-journal',
    reference: 'REFUND-1', createdAt: '2026-10-11T10:00:00.000Z'
  };
  const previous = { ...emptyState(), supplierDirectAdvances: [], supplierAdvanceSettlements: [] };
  const next = {
    ...emptyState([directJournal, refundJournal]), accounts,
    supplierDirectAdvances: [source], supplierAdvanceSettlements: [settlement],
    bankAccounts: []
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    supplierAdvanceSettlements: [{ ...settlement,
      sourceDirectAdvanceAllocations: [{ directAdvanceId: 'direct-1', amountUsd: 101, bookValueBs: 10100 }]
    }]
  }), /exceden el saldo individual de un desembolso directo|distribución individual que no coincide/);
});

test('SQLite validates ISLR event structure and historical UT during every state save', () => {
  const invalidUtEvent = {
    id: 'islr-event-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    conceptCode: '003', fiscalDate: '2025-07-10', sequence: 1, kind: 'PAYMENT',
    allocations: [{ purchaseId: 'purchase-1', baseAmountBs: 100 }],
    basePercentage: 90, unitTaxValueBs: 9, withheldAmountBs: 0,
    journalEntryId: 'entry-1', createdAt: '2025-07-10T12:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(), { ...emptyState([sourceEntry()]), islrFiscalEvents: [invalidUtEvent] }
  ), /snapshot de UT ISLR/);
});

test('SQLite rejects ISLR events linked to a missing invoice', () => {
  const event = {
    id: 'islr-event-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    conceptCode: '003', fiscalDate: '2026-10-01', sequence: 1, kind: 'PAYMENT',
    allocations: [{ purchaseId: 'missing-purchase', baseAmountBs: 100 }],
    basePercentage: 90, unitTaxValueBs: 43, withheldAmountBs: 0,
    journalEntryId: 'entry-1', createdAt: '2026-10-01T12:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(), { ...emptyState([sourceEntry()]), islrFiscalEvents: [event] }
  ), /factura inexistente/);
});

test('SQLite prevents ISLR allocations above taxable plus exempt invoice base', () => {
  const purchase = {
    id: 'purchase-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    documentType: '01', taxableBaseBs: 800, exemptAmountBs: 200, isCancelled: false
  };
  const event = {
    id: 'islr-event-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    conceptCode: '003', fiscalDate: '2026-10-01', sequence: 1, kind: 'PAYMENT',
    allocations: [{ purchaseId: 'purchase-1', baseAmountBs: 1000.02 }],
    basePercentage: 90, unitTaxValueBs: 43, withheldAmountBs: 0,
    journalEntryId: 'entry-1', createdAt: '2026-10-01T12:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(), { ...emptyState([sourceEntry()]), purchases: [purchase], islrFiscalEvents: [event] }
  ), /superior a la base de la factura/);
});

test('SQLite preserves unchanged legacy invoice links but strictly validates new or changed links', () => {
  const legacyInvoice = {
    id: 'legacy-purchase', companyId: 'company-1', documentType: '01',
    invoiceNumber: 'OLD-100', journalEntryId: 'legacy-entry'
  };
  const legacyEntry = {
    ...sourceEntry(), id: 'legacy-entry', companyId: 'company-2', type: 'MANUAL'
  };
  const legacyState = {
    ...emptyState([legacyEntry]),
    purchases: [legacyInvoice]
  };

  // Upgrading/saving an unchanged historical record must not brick the local database.
  assert.doesNotThrow(() => validateAccountingSnapshot(legacyState, structuredClone(legacyState)));

  // The same invalid relationship is rejected when introduced by a new invoice.
  const newInvoice = { ...legacyInvoice, id: 'new-purchase', invoiceNumber: 'NEW-100' };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([legacyEntry]),
    { ...emptyState([legacyEntry]), purchases: [newInvoice] }
  ), /vínculo de factura con un asiento/);

  // Sales allow a controlled journalEntryId update, so the strict link check must catch it.
  const legacySale = {
    id: 'legacy-sale', companyId: 'company-1', documentType: '01',
    invoiceNumber: 'SALE-100', journalEntryId: 'legacy-entry'
  };
  const legacySalesState = { ...emptyState([legacyEntry]), sales: [legacySale] };
  const changedSale = { ...legacySale, journalEntryId: 'other-entry' };
  const otherEntry = { ...legacyEntry, id: 'other-entry', companyId: 'company-1', type: 'MANUAL' };
  assert.throws(() => validateAccountingSnapshot(
    legacySalesState,
    { ...emptyState([legacyEntry, otherEntry]), sales: [changedSale] }
  ), /vínculo de factura con un asiento/);
});


test('SQLite reconciles every new sale with its complete invoice journal in Bs and USD', () => {
  const sale = {
    id: 'sale-new-1', companyId: 'company-1', invoiceDate: '2026-11-04',
    invoiceNumber: 'V-1001', documentType: '01', bcvRate: 100,
    taxableBaseBs: 1000, exemptAmountBs: 0, taxRate: 16, vatAmountBs: 160,
    vatWithheldBs: 40, igtfAmountBs: 0, totalAmountBs: 1160,
    totalAmountUsd: 11.6, taxableBaseUsd: 10, vatAmountUsd: 1.6,
    vatWithheldUsd: 0.4, journalEntryId: 'sale-journal-1'
  };
  const journal = {
    id: 'sale-journal-1', companyId: 'company-1', entryNumber: 1,
    date: sale.invoiceDate, description: 'Factura de venta V-1001',
    type: 'VENTA', bcvRate: 100, referenceDoc: 'FAC- V-1001',
    items: [
      { accountCode: '1.1.3.03', debitBs: 40, creditBs: 0, debitUsd: 0.4, creditUsd: 0 },
      { accountCode: '1.1.2.01', debitBs: 1120, creditBs: 0, debitUsd: 11.2, creditUsd: 0 },
      { accountCode: '4.1.1.01', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10 },
      { accountCode: '2.1.2.01', debitBs: 0, creditBs: 160, debitUsd: 0, creditUsd: 1.6 }
    ],
    createdAt: '2026-11-04T10:00:00.000Z'
  };
  const previous = emptyState();
  const next = { ...emptyState([journal]), sales: [sale] };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    sales: [{ ...sale, taxableBaseBs: 900 }]
  }), /venta: el asiento no concilia/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    sales: [{ ...sale, igtfAmountUsd: 0.01 }]
  }), /venta: el asiento no concilia/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    journalEntries: [{ ...journal, items: journal.items.map(item => {
      if (item.accountCode === '4.1.1.01') return { ...item, creditBs: 999 };
      if (item.accountCode === '2.1.2.01') return { ...item, creditBs: 161, creditUsd: 1.61 };
      return item;
    }) }]
  }), /venta: el asiento no concilia/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    journalEntries: [{ ...journal, items: [...journal.items,
      { accountCode: '6.1.1.01', debitBs: 1, creditBs: 0, debitUsd: 0.01, creditUsd: 0 },
      { accountCode: '6.1.1.01', debitBs: 0, creditBs: 1, debitUsd: 0, creditUsd: 0.01 }
    ] }]
  }), /venta: el asiento no concilia/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...emptyState(), sales: [{ ...sale, journalEntryId: undefined }]
  }), /falta su asiento contable enlazado/);

  const igftSale = {
    ...sale, igtfApplicable: true, igtfRate: 3,
    paymentTerm: 'CONTADO', paymentCurrency: 'FOREIGN_CASH',
    igtfAmountBs: 34.8, igtfAmountUsd: 0.348,
    totalAmountBs: 1194.8, totalAmountUsd: 11.948
  };
  const igftJournal = {
    ...journal,
    items: journal.items.map(item => item.accountCode === '1.1.2.01'
      ? { ...item, debitBs: 1154.8, debitUsd: 11.548 } : item)
      .concat([{ accountCode: '2.1.2.06', debitBs: 0, creditBs: 34.8, debitUsd: 0, creditUsd: 0.348 }])
  };
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...emptyState([igftJournal]),
    companies: [{ id: 'company-1', isIgtfPerceptionAgent: false }],
    sales: [igftSale]
  }), /venta: el asiento no concilia/);
});

test('SQLite rejects physical deletion of a posted journal entry', () => {
  assert.throws(
    () => validateAccountingSnapshot(emptyState([sourceEntry()]), emptyState([])),
    /eliminación del asiento histórico/
  );
});

test('SQLite rejects changes to the financial content of an existing journal entry', () => {
  const original = sourceEntry();
  const edited = { ...original, description: 'Texto alterado' };
  assert.throws(
    () => validateAccountingSnapshot(emptyState([original]), emptyState([edited])),
    /modificación del contenido histórico/
  );
});

test('SQLite accepts one new, balanced contra-entry with reciprocal immutable linkage', () => {
  const original = sourceEntry();
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    emptyState([original]),
    emptyState([linkedOriginal, reversal])
  ));
});

test('SQLite rejects a balanced contra-entry whose lines do not exactly reverse the source', () => {
  const original = sourceEntry();
  const reversal = {
    ...reversalEntry(),
    items: [line(50, 0, 0.5, 0), line(0, 50, 0, 0.5)]
  };
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([original]), emptyState([linkedOriginal, reversal])
  ), /no invierte exactamente Debe\/Haber/);
});

test('SQLite rejects a contra-entry without reciprocal linkage or supporting paper', () => {
  const original = sourceEntry();
  const reversal = { ...reversalEntry(), workpaperNote: '' };
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([original]), emptyState([linkedOriginal, reversal])
  ), /contra-asiento sin origen, enlace recíproco, justificación, papel de trabajo o fecha válida/);
});

test('SQLite rejects a second contra-entry for the same original', () => {
  const original = sourceEntry();
  const first = reversalEntry();
  const second = { ...reversalEntry(), id: 'entry-3', entryNumber: 3 };
  const linkedOriginal = { ...original, reversedByEntryId: first.id, isAdjusted: true };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([original]),
    emptyState([linkedOriginal, first, second])
  ), /segunda reversión/);
});

test('SQLite rejects supplier-return movements imported through a snapshot or backup', () => {
  const returnMovement = {
    id: 'supplier-return-1', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-12', type: 'SALIDA', concept: 'DEVOLUCION_COMPRA',
    documentRef: 'NC-100', quantity: 1, totalCostBs: 100
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState(), movements: [returnMovement] }
  ), /cada línea de nota de crédito debe tener exactamente su salida de Kardex asociada/);
});

test('SQLite rejects supplier debit/credit notes imported as new purchase records', () => {
  const note = {
    id: 'purchase-note-1', companyId: 'company-1', invoiceNumber: 'NC-100',
    supplierRif: 'J-12345678-9', documentType: '03', totalAmountBs: 100
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState(), purchases: [note] }
  ), /falta factura original, proveedor, soporte/);
});

test('SQLite rejects supplier debit notes imported directly without an authorized accounting flow', () => {
  const note = {
    id: 'purchase-note-1', companyId: 'company-1', invoiceNumber: 'ND-100',
    supplierRif: 'J-12345678-9', documentType: '02', totalAmountBs: 100
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState(), purchases: [note] }
  ), /ND tipo 02/);
});

test('SQLite rejects a purchase whose declared inventory lines are missing from Kardex', () => {
  const purchase = {
    id: 'purchase-new', companyId: 'company-1', invoiceDate: '2026-10-10',
    supplierRif: 'J-12345678-9', invoiceNumber: 'FAC-100', documentType: '01',
    totalAmountBs: 200, taxableBaseBs: 200, exemptAmountBs: 0, taxRate: 0, vatAmountBs: 0,
    vatWithheldBs: 0, islrWithheldBs: 0, igtfAmountBs: 0, bcvRate: 100,
    totalAmountUsd: 2, taxableBaseUsd: 2, vatAmountUsd: 0, vatWithheldUsd: 0,
    islrWithheldUsd: 0, igtfAmountUsd: 0, journalEntryId: 'purchase-entry',
    inventoryLines: [{ productId: 'p-1', quantity: 2, unitCostBs: 100 }]
  };
  const entry = {
    id: 'purchase-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Compra', type: 'COMPRA', bcvRate: 100, referenceDoc: 'FAC-100',
    items: [line(200, 0, 2, 0), line(0, 200, 0, 2)],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState([entry]), purchases: [purchase] }
  ), /número de entradas de Kardex no coincide/);
});

test('SQLite accepts a purchase only when invoice, inventory debit and Kardex lines reconcile', () => {
  const purchase = {
    id: 'purchase-new', companyId: 'company-1', invoiceDate: '2026-10-10',
    supplierRif: 'J-12345678-9', invoiceNumber: '100', documentType: '01',
    totalAmountBs: 200, taxableBaseBs: 200, exemptAmountBs: 0, taxRate: 0, vatAmountBs: 0,
    vatWithheldBs: 0, islrWithheldBs: 0, igtfAmountBs: 0, bcvRate: 100,
    totalAmountUsd: 2, taxableBaseUsd: 2, vatAmountUsd: 0, vatWithheldUsd: 0,
    islrWithheldUsd: 0, igtfAmountUsd: 0, journalEntryId: 'purchase-entry',
    inventoryLines: [{ productId: 'p-1', quantity: 2, unitCostBs: 100 }]
  };
  const entry = {
    id: 'purchase-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Compra', type: 'COMPRA', bcvRate: 100, referenceDoc: 'FAC-100',
    items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 200, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 0, creditBs: 200, debitUsd: 0, creditUsd: 2 }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const movement = {
    id: 'movement-new', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-10', type: 'ENTRADA', concept: 'COMPRA',
    documentRef: ' FAC - 100 ', counterpartyRif: 'J-12345678-9',
    quantity: 2, unitCostBs: 100, unitCostUsd: 1, totalCostBs: 200, totalCostUsd: 2, bcvRate: 100
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState([entry]), purchases: [purchase], movements: [movement], products: [{ id: 'p-1', companyId: 'company-1', inventoryAccountCode: '1.1.4.01' }] }
  ));
  for (const invalidMovement of [
    { ...movement, counterpartyRif: '' },
    { ...movement, unitCostBs: 90 },
    { ...movement, unitCostUsd: 0.9 }
  ]) {
    assert.throws(() => validateAccountingSnapshot(
      emptyState(),
      { ...emptyState([entry]), purchases: [purchase], movements: [invalidMovement] }
    ), /una entrada de Kardex no coincide/);
  }
});

test('SQLite accepts cash purchase posted directly to selected cash/bank account with no payable', () => {
  const purchase = {
    id: 'purchase-cash', companyId: 'company-1', invoiceDate: '2026-10-10', accountCreditDate: '2026-10-10',
    supplierRif: 'J-12345678-9', invoiceNumber: '101', documentType: '01',
    totalAmountBs: 232, taxableBaseBs: 200, exemptAmountBs: 0, taxRate: 16, vatAmountBs: 32,
    vatWithheldBs: 0, islrWithheldBs: 0, igtfAmountBs: 0, bcvRate: 100,
    totalAmountUsd: 2.32, taxableBaseUsd: 2, vatAmountUsd: 0.32, vatWithheldUsd: 0,
    islrWithheldUsd: 0, igtfAmountUsd: 0, journalEntryId: 'purchase-cash-entry',
    paymentTerm: 'CONTADO', paymentAccountCode: '1.1.1.01', paymentReference: 'EG-0001',
    inventoryLines: [{ productId: 'p-1', quantity: 2, unitCostBs: 100 }]
  };
  const entry = {
    id: 'purchase-cash-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Compra contado', type: 'COMPRA', bcvRate: 100, referenceDoc: 'FAC-101',
    items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 200, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '1.1.3.01', accountName: 'IVA Crédito Fiscal', debitBs: 32, creditBs: 0, debitUsd: 0.32, creditUsd: 0 },
      { accountCode: '1.1.1.01', accountName: 'Caja Principal', debitBs: 0, creditBs: 232, debitUsd: 0, creditUsd: 2.32 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const movement = {
    id: 'movement-cash', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-10', type: 'ENTRADA', concept: 'COMPRA',
    documentRef: 'FAC-101', counterpartyRif: 'J-12345678-9',
    quantity: 2, unitCostBs: 100, unitCostUsd: 1, totalCostBs: 200, totalCostUsd: 2, bcvRate: 100
  };
  const account = { code: '1.1.1.01', name: 'Caja Principal', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' };
  const state = { ...emptyState([entry]), accounts: [account], purchases: [purchase], movements: [movement], products: [{ id: 'p-1', companyId: 'company-1', inventoryAccountCode: '1.1.4.01' }] };
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), state));
  const invalid = structuredClone(state);
  invalid.purchases[0].paymentAccountCode = '2.1.1.01';
  assert.throws(() => validateAccountingSnapshot(emptyState(), invalid), /asiento no reconoce en Bs\. y USD/);
});

test('SQLite accepts cash expense purchase with effective payment/account-credit date different from invoice date', () => {
  const purchase = {
    id: 'purchase-cash-expense', companyId: 'company-1',
    invoiceDate: '2026-10-09', accountCreditDate: '2026-10-10',
    supplierRif: 'J-12345678-9', invoiceNumber: '102', documentType: '01',
    totalAmountBs: 232, taxableBaseBs: 200, exemptAmountBs: 0, taxRate: 16, vatAmountBs: 32,
    vatWithheldBs: 0, islrWithheldBs: 0, igtfAmountBs: 0, bcvRate: 100,
    totalAmountUsd: 2.32, taxableBaseUsd: 2, vatAmountUsd: 0.32, vatWithheldUsd: 0,
    islrWithheldUsd: 0, igtfAmountUsd: 0, journalEntryId: 'purchase-cash-expense-entry',
    paymentTerm: 'CONTADO', paymentAccountCode: '1.1.1.01', paymentReference: 'TRF-102'
  };
  const entry = {
    id: 'purchase-cash-expense-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Compra contado gasto', type: 'COMPRA',
    bcvRate: 100, referenceDoc: 'FAC-102',
    items: [
      { accountCode: '6.1.1.04', accountName: 'Honorarios Profesionales', debitBs: 200, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '1.1.3.01', accountName: 'IVA Crédito Fiscal', debitBs: 32, creditBs: 0, debitUsd: 0.32, creditUsd: 0 },
      { accountCode: '1.1.1.01', accountName: 'Caja Principal', debitBs: 0, creditBs: 232, debitUsd: 0, creditUsd: 2.32 }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const account = { code: '1.1.1.01', name: 'Caja Principal', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' };
  const validState = { ...emptyState([entry]), accounts: [account], purchases: [purchase] };
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), validState));

  const alteredVat = structuredClone(validState);
  alteredVat.purchases[0].vatAmountBs = 31;
  alteredVat.purchases[0].totalAmountBs = 231;
  alteredVat.purchases[0].totalAmountUsd = 2.31;
  assert.throws(() => validateAccountingSnapshot(emptyState(), alteredVat),
    /factura de compra: el asiento no concilia en Bs\. y USD/);
});

test('SQLite rejects a purchase when the inventory debit differs from its Kardex total', () => {
  const purchase = {
    id: 'purchase-new', companyId: 'company-1', invoiceDate: '2026-10-10',
    supplierRif: 'J-12345678-9', invoiceNumber: '100', documentType: '01',
    totalAmountBs: 200, taxableBaseBs: 200, exemptAmountBs: 0, taxRate: 0, vatAmountBs: 0,
    vatWithheldBs: 0, islrWithheldBs: 0, igtfAmountBs: 0, bcvRate: 100,
    totalAmountUsd: 2, taxableBaseUsd: 2, vatAmountUsd: 0, vatWithheldUsd: 0,
    islrWithheldUsd: 0, igtfAmountUsd: 0, journalEntryId: 'purchase-entry',
    inventoryLines: [{ productId: 'p-1', quantity: 2, unitCostBs: 100 }]
  };
  const entry = {
    id: 'purchase-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Compra', type: 'COMPRA', bcvRate: 100, referenceDoc: 'FAC-100',
    items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 150, creditBs: 0, debitUsd: 1.5, creditUsd: 0 },
      { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 0, creditBs: 150, debitUsd: 0, creditUsd: 1.5 }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const movement = {
    id: 'movement-new', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-10', type: 'ENTRADA', concept: 'COMPRA',
    documentRef: 'FAC-100', counterpartyRif: 'J-12345678-9',
    quantity: 2, unitCostBs: 100, unitCostUsd: 1, totalCostBs: 200, totalCostUsd: 2, bcvRate: 100
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState([entry]), purchases: [purchase], movements: [movement], products: [{ id: 'p-1', companyId: 'company-1', inventoryAccountCode: '1.1.4.01' }] }
  ), /asiento no reconoce en Bs\. y USD/);
});


test('SQLite reconciles purchase inventory across multiple product auxiliary accounts', () => {
  const { prior, next } = supplierCreditFixture();
  const product = next.products.find(item => item.id === 'p-1');
  product.inventoryAccountCode = '1.1.4.07';
  const originalEntry = next.journalEntries.find(item => item.id === 'purchase-entry');
  originalEntry.items.find(item => item.accountCode === '1.1.4.01').accountCode = '1.1.4.07';
  const noteEntry = next.journalEntries.find(item => item.id === 'credit-entry');
  noteEntry.items.find(item => item.accountCode === '1.1.4.01').accountCode = '1.1.4.07';
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));

  const corrupted = structuredClone(next);
  corrupted.journalEntries.find(item => item.id === 'purchase-entry')
    .items.find(item => item.accountCode === '1.1.4.07').accountCode = '1.1.4.01';
  assert.throws(() => validateAccountingSnapshot(prior, corrupted),
    /asiento no reconoce en Bs\. y USD|factura original o el asiento fiscal no están conciliados|modificación del contenido histórico del asiento/);
});

test('SQLite rejects purchase inventory lines whose product is absent from the company catalog', () => {
  const { prior, next } = supplierCreditFixture();
  next.products = [];
  assert.throws(() => validateAccountingSnapshot(prior, next), /no existe el artículo asociado/);
});

test('SQLite keeps inventory movements append-only', () => {
  const movement = { id: 'mov-1', companyId: 'company-1', productId: 'p-1', quantity: 2, totalCostBs: 200 };
  assert.throws(() => validateAccountingSnapshot(
    { ...emptyState(), movements: [movement] },
    { ...emptyState(), movements: [] }
  ), /eliminación del registro histórico en movements/);
});


test('SQLite validates a sales invoice and its collection created in the same atomic batch', () => {
  const sale = {
    id: 'sale-batch-collection', companyId: 'company-1', opNumber: 1,
    invoiceDate: '2026-10-10', customerRif: 'J-12345678-9', customerName: 'Cliente',
    invoiceNumber: 'S-100', controlNumber: 'CTRL-S-100', documentType: '01',
    totalAmountBs: 116, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 16,
    vatAmountBs: 16, vatWithheldBs: 0, vatWithheldUsd: 0,
    igtfAmountBs: 0, igtfAmountUsd: 0, igtfApplicable: false,
    bcvRate: 100, totalAmountUsd: 1.16, taxableBaseUsd: 1,
    vatAmountUsd: 0.16, paymentTerm: 'CREDITO',
    journalEntryId: 'sale-batch-entry', inventoryLines: []
  };
  const saleJournal = {
    id: 'sale-batch-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Factura venta S-100', type: 'VENTA',
    bcvRate: 100, referenceDoc: 'FAC-S-100',
    items: [
      { accountCode: '1.1.2.01', debitBs: 116, creditBs: 0, debitUsd: 1.16, creditUsd: 0 },
      { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 },
      { accountCode: '2.1.2.01', debitBs: 0, creditBs: 16, debitUsd: 0, creditUsd: 0.16 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const paymentJournal = {
    id: 'sale-batch-collection-entry', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-11', description: 'Cobro factura S-100', type: 'AJUSTE',
    bcvRate: 110, referenceDoc: 'S-100',
    items: [
      { accountCode: '1.1.1.03', debitBs: 55, creditBs: 0, debitUsd: 0.5, creditUsd: 0 },
      { accountCode: '1.1.2.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 0.5 },
      { accountCode: '4.2.1.01', debitBs: 0, creditBs: 5, debitUsd: 0, creditUsd: 0 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const accounts = [
    { code: '1.1.2.01', name: 'Cuentas por cobrar clientes', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.03', name: 'Banco', type: 'ACTIVO', isMovement: true },
    { code: '4.2.1.01', name: 'Ganancia cambiaria', type: 'INGRESOS', isMovement: true }
  ];
  const settlement = {
    id: 'sale-batch-collection', companyId: 'company-1',
    documentId: sale.id, kind: 'SALE_COLLECTION',
    settlementDate: '2026-10-11', bcvRate: 110,
    amountUsd: 0.5, amountBs: 55, method: 'BANK_TRANSFER_BS',
    bankAccountId: 'bank-1', reference: 'SALE TRX 100',
    journalEntryId: paymentJournal.id, createdAt: '2026-10-11T10:00:00.000Z'
  };
  const prior = { ...emptyState(), accounts, sales: [], journalEntries: [], creditSettlements: [],
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03', currency: 'BS' }] };
  const next = {
    ...prior, sales: [sale],
    journalEntries: [saleJournal, paymentJournal],
    creditSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...next,
    journalEntries: [saleJournal, {
      ...paymentJournal,
      items: paymentJournal.items.map(line => line.accountCode === '1.1.2.01'
        ? { ...line, accountCode: '1.1.2.99' } : line)
    }]
  }), /cobro de una factura.*ND de venta/);
  const priorDuplicate = {
    ...prior,
    creditSettlements: [{
      id: 'prior-sale-bank-payment', companyId: 'company-1', documentId: 'other-sale',
      kind: 'SALE_COLLECTION', bankAccountId: 'bank-1', reference: 'SALE   TRX 100', isReversed: false
    }]
  };
  assert.throws(() => validateAccountingSnapshot(priorDuplicate, {
    ...next,
    creditSettlements: [...priorDuplicate.creditSettlements, settlement]
  }), /referencia/);
});

test('SQLite rejects sales collections that exceed net receivable after withholding', () => {
  const sale = {
    id: 'sale-overpayment', companyId: 'company-1', opNumber: 1,
    invoiceDate: '2026-10-10', customerRif: 'J-12345678-9', customerName: 'Cliente',
    invoiceNumber: 'S-101', controlNumber: 'CTRL-S-101', documentType: '01',
    totalAmountBs: 116, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 16,
    vatAmountBs: 16, vatWithheldBs: 16, vatWithheldUsd: 0.16,
    igtfAmountBs: 0, igtfAmountUsd: 0, igtfApplicable: false,
    bcvRate: 100, totalAmountUsd: 1.16, taxableBaseUsd: 1,
    vatAmountUsd: 0.16, paymentTerm: 'CREDITO',
    journalEntryId: 'sale-overpayment-entry', inventoryLines: []
  };
  const saleJournal = {
    id: 'sale-overpayment-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-10', description: 'Factura venta S-101', type: 'VENTA',
    bcvRate: 100, referenceDoc: 'FAC-S-101',
    items: [
      { accountCode: '1.1.2.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.3.03', debitBs: 16, creditBs: 0, debitUsd: 0.16, creditUsd: 0 },
      { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 },
      { accountCode: '2.1.2.01', debitBs: 0, creditBs: 16, debitUsd: 0, creditUsd: 0.16 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const settlement = {
    id: 'sale-overpayment-settlement', companyId: 'company-1',
    documentId: sale.id, kind: 'SALE_COLLECTION',
    settlementDate: '2026-10-11', bcvRate: 100,
    amountUsd: 1.01, amountBs: 101, method: 'CASH_BS',
    journalEntryId: 'sale-overpayment-payment', createdAt: '2026-10-11T10:00:00.000Z'
  };
  const paymentJournal = {
    id: 'sale-overpayment-payment', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-11', description: 'Cobro excesivo S-101', type: 'AJUSTE',
    bcvRate: 100, referenceDoc: 'S-101',
    items: [
      { accountCode: '1.1.1.01', debitBs: 101, creditBs: 0, debitUsd: 1.01, creditUsd: 0 },
      { accountCode: '1.1.2.01', debitBs: 0, creditBs: 101, debitUsd: 0, creditUsd: 1.01 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const accounts = [
    { code: '1.1.2.01', name: 'Cuentas por cobrar clientes', type: 'ACTIVO', isMovement: true },
    { code: '1.1.3.03', name: 'IVA retenido por cobrar', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', isMovement: true },
    { code: '4.1.1.01', name: 'Ventas', type: 'INGRESOS', isMovement: true },
    { code: '2.1.2.01', name: 'IVA débito fiscal', type: 'PASIVO', isMovement: true }
  ];
  const prior = { ...emptyState(), accounts, sales: [], journalEntries: [], creditSettlements: [] };
  const next = {
    ...prior, sales: [sale],
    journalEntries: [saleJournal, paymentJournal],
    creditSettlements: [settlement]
  };
  assert.throws(() => validateAccountingSnapshot(prior, next), /principal neto de CxC/);
});

test('SQLite allows reversal metadata on a settlement but not edits to its amount', () => {
  const original = sourceEntry();
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  const settlement = {
    id: 's-1', companyId: 'company-1', documentId: 'purchase-1',
    journalEntryId: original.id, amountUsd: 10, amountBs: 1000, isReversed: false
  };
  const reversed = { ...settlement, isReversed: true, reversedByJournalEntryId: reversal.id };
  const previous = { ...emptyState([original]), creditSettlements: [settlement] };
  const next = { ...emptyState([linkedOriginal, reversal]), creditSettlements: [reversed] };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(
    previous,
    { ...next, creditSettlements: [{ ...reversed, amountUsd: 11 }] }
  ), /modificación de un registro histórico en creditSettlements/);
});

test('SQLite permits bank reconciliation metadata changes without changing imported statement facts', () => {
  const statement = { id: 'bank-1', companyId: 'company-1', reference: 'TRX-1', amountBs: 1000, isReconciled: false };
  const reconciled = { ...statement, isReconciled: true, reconciledWithJournalEntryId: 'entry-2', matchedBy: 'MANUAL' };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState(), bankStatementMovements: [statement] },
    { ...emptyState(), bankStatementMovements: [reconciled] }
  ));
  assert.throws(() => validateAccountingSnapshot(
    { ...emptyState(), bankStatementMovements: [statement] },
    { ...emptyState(), bankStatementMovements: [{ ...reconciled, amountBs: 1200 }] }
  ), /modificación de un registro histórico en bankStatementMovements/);
});

test('SQLite preserves historical bank reconciliation links after unreconciliation', () => {
  const statement = {
    id: 'bank-historical', companyId: 'company-1', bankAccountId: 'bank-1',
    reference: 'TRX-1', amountBs: 1000, isReconciled: true,
    reconciledWithJournalEntryId: 'entry-1', reconciledJournalEntryIds: ['entry-1']
  };
  const unreconciled = {
    ...statement, isReconciled: false, reconciledWithJournalEntryId: undefined,
    matchedBy: undefined, reconciledAt: undefined
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState(), bankStatementMovements: [statement] },
    { ...emptyState(), bankStatementMovements: [unreconciled] }
  ));
  assert.throws(() => validateAccountingSnapshot(
    { ...emptyState(), bankStatementMovements: [statement] },
    { ...emptyState(), bankStatementMovements: [{ ...unreconciled, reconciledJournalEntryIds: [] }] }
  ), /historial de conciliación bancaria/);
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState(), bankStatementMovements: [statement] },
    { ...emptyState(), bankStatementMovements: [{ ...unreconciled, reconciledJournalEntryIds: ['entry-1', 'entry-2'] }] }
  ));
});

test('SQLite refuses deletion of historical legacy-company journal entries', () => {
  const demoEntry = { ...sourceEntry(), id: 'demo-entry', companyId: 'comp-1' };
  assert.throws(() => validateAccountingSnapshot(
    emptyState([demoEntry]), emptyState([])
  ), /eliminación del asiento histórico/);
});

test('SQLite accepts fiscal cancellation only when linked to its immutable contra-entry', () => {
  const original = { ...sourceEntry(), type: 'VENTA', referenceDoc: 'FAC-100' };
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  const oldSale = {
    id: 'sale-1', companyId: 'company-1', invoiceNumber: '100',
    journalEntryId: original.id, isCancelled: false
  };
  const cancelledSale = {
    ...oldSale, isCancelled: true, cancelledByJournalEntryId: reversal.id,
    cancellationReason: 'Factura emitida con datos incorrectos',
    cancellationNote: 'Soporte revisado y justificación archivada'
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState([original]), sales: [oldSale] },
    { ...emptyState([linkedOriginal, reversal]), sales: [cancelledSale] }
  ));
});

test('SQLite rejects a fiscal cancellation without an actual contra-entry', () => {
  const original = { ...sourceEntry(), type: 'COMPRA', referenceDoc: 'FAC-200' };
  const oldPurchase = {
    id: 'purchase-1', companyId: 'company-1', invoiceNumber: '200',
    journalEntryId: original.id, isCancelled: false
  };
  const cancelledPurchase = {
    ...oldPurchase, isCancelled: true, cancelledByJournalEntryId: 'missing-entry',
    cancellationReason: 'Documento incorrecto', cancellationNote: 'Soporte revisado y archivado'
  };
  assert.throws(() => validateAccountingSnapshot(
    { ...emptyState([original]), purchases: [oldPurchase] },
    { ...emptyState([original]), purchases: [cancelledPurchase] }
  ), /cancelación del documento fiscal.*contra-asiento enlazado/i);
});

test('SQLite allows repairing a missing invoice-to-entry link only to the matching original entry', () => {
  const original = { ...sourceEntry(), type: 'VENTA', referenceDoc: 'FAC-400' };
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  const oldSale = { id: 'sale-4', companyId: 'company-1', invoiceNumber: '400', isCancelled: false };
  const cancelledSale = {
    ...oldSale, journalEntryId: original.id, isCancelled: true,
    cancelledByJournalEntryId: reversal.id,
    cancellationReason: 'Factura con vínculo histórico incompleto',
    cancellationNote: 'Se verificó la referencia original y el contra-asiento'
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState([original]), sales: [oldSale] },
    { ...emptyState([linkedOriginal, reversal]), sales: [cancelledSale] }
  ));
});

test('SQLite accepts reversal of a settlement only when the settlement points to its contra-entry', () => {
  const original = sourceEntry();
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  const oldSettlement = {
    id: 'settlement-1', companyId: 'company-1', documentId: 'purchase-1',
    journalEntryId: original.id, amountUsd: 10, amountBs: 1000, isReversed: false
  };
  const reversedSettlement = {
    ...oldSettlement, isReversed: true, reversedByJournalEntryId: reversal.id
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState([original]), creditSettlements: [oldSettlement] },
    { ...emptyState([linkedOriginal, reversal]), creditSettlements: [reversedSettlement] }
  ));
});

test('SQLite requires fiscal retention correction flags to link to the document reversal', () => {
  const original = { ...sourceEntry(), type: 'COMPRA', referenceDoc: 'FAC-300' };
  const reversal = reversalEntry();
  const linkedOriginal = { ...original, reversedByEntryId: reversal.id, isAdjusted: true };
  const oldPurchase = {
    id: 'purchase-3', companyId: 'company-1', invoiceNumber: '300',
    journalEntryId: original.id, isCancelled: false
  };
  const cancelledPurchase = {
    ...oldPurchase, isCancelled: true, cancelledByJournalEntryId: reversal.id,
    cancellationReason: 'Factura con error de identificación',
    cancellationNote: 'Documento de soporte revisado por el contador'
  };
  const oldVoucher = { id: 'vat-1', companyId: 'company-1', purchaseRecordId: oldPurchase.id, requiresFiscalCorrection: false };
  const correctedVoucher = {
    ...oldVoucher, requiresFiscalCorrection: true, correctionEntryId: reversal.id,
    correctionNote: 'Requiere rectificación fiscal documentada'
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(
    { ...emptyState([original]), purchases: [oldPurchase], vatVouchers: [oldVoucher] },
    { ...emptyState([linkedOriginal, reversal]), purchases: [cancelledPurchase], vatVouchers: [correctedVoucher] }
  ));
});

test('SQLite rejects reopening or deleting a closed accounting period', () => {
  const previous = { ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa', closedThroughDate: '2026-09-30' }] };
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa', closedThroughDate: '2026-08-31' }]
  }), /bloqueó la reapertura/);
  assert.throws(() => validateAccountingSnapshot(previous, emptyState()), /bloqueó la reapertura/);
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, {
    ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa', closedThroughDate: '2026-10-31' }]
  }));
});

test('SQLite audit_events table rejects UPDATE and DELETE operations', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL
      );
      CREATE TRIGGER audit_events_no_update
        BEFORE UPDATE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
      CREATE TRIGGER audit_events_no_delete
        BEFORE DELETE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
    `);
    const insert = db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)');
    insert.run('journal_entry_reversed', JSON.stringify({ entryId: 'entry-2' }));
    assert.throws(() => db.prepare("UPDATE audit_events SET event_type='changed' WHERE id=1").run(), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM audit_events WHERE id=1').run(), /append-only/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  } finally {
    db.close();
  }
});


const supplierCreditFixture = () => {
  const originalPurchase = {
    id: 'purchase-original', companyId: 'company-1', opNumber: 1,
    invoiceDate: '2026-10-01', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', invoiceNumber: '100', controlNumber: '00-100',
    documentType: '01', totalAmountBs: 238.96, taxableBaseBs: 200,
    exemptAmountBs: 0, taxRate: 16, vatAmountBs: 32, retentionRate: 75,
    vatWithheldBs: 24, islrWithheldBs: 2, islrSubtrahendBs: 0,
    bcvRate: 100, totalAmountUsd: 2.3896, taxableBaseUsd: 2,
    vatAmountUsd: 0.32, vatWithheldUsd: 0.24, islrWithheldUsd: 0.02,
    igtfAmountBs: 6.96, igtfAmountUsd: 0.0696,
    paymentTerm: 'CREDITO', journalEntryId: 'purchase-entry',
    inventoryLines: [{ productId: 'p-1', quantity: 2, unitCostBs: 100 }]
  };
  const originalEntry = {
    id: 'purchase-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-01', description: 'Compra', type: 'COMPRA', bcvRate: 100,
    referenceDoc: 'FAC-100',
    items: [
      { accountCode: '1.1.4.01', debitBs: 200, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '1.1.3.01', debitBs: 32, creditBs: 0, debitUsd: 0.32, creditUsd: 0 },
      { accountCode: '6.1.1.11', debitBs: 6.96, creditBs: 0, debitUsd: 0.0696, creditUsd: 0 },
      { accountCode: '2.1.2.03', debitBs: 0, creditBs: 24, debitUsd: 0, creditUsd: 0.24 },
      { accountCode: '2.1.2.04', debitBs: 0, creditBs: 2, debitUsd: 0, creditUsd: 0.02 },
      { accountCode: '2.1.1.01', debitBs: 0, creditBs: 212.96, debitUsd: 0, creditUsd: 2.1296 }
    ],
    createdAt: '2026-10-01T10:00:00.000Z'
  };
  const originalMovement = {
    id: 'purchase-movement', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-01', type: 'ENTRADA', concept: 'COMPRA',
    documentRef: 'FAC-100', counterpartyRif: 'J-12345678-9',
    quantity: 2, unitCostBs: 100, unitCostUsd: 1, totalCostBs: 200,
    totalCostUsd: 2, bcvRate: 100
  };
  const product = { id: 'p-1', companyId: 'company-1', currentStock: 1, inventoryAccountCode: '1.1.4.01' };
  const noteEntry = {
    id: 'credit-entry', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'Nota de crédito NC-001', type: 'AJUSTE',
    bcvRate: 100, referenceDoc: 'NC-PROV-NC-001',
    items: [
      { accountCode: '2.1.1.01', debitBs: 106.48, creditBs: 0, debitUsd: 1.0648, creditUsd: 0 },
      { accountCode: '2.1.2.03', debitBs: 12, creditBs: 0, debitUsd: 0.12, creditUsd: 0 },
      { accountCode: '2.1.2.04', debitBs: 1, creditBs: 0, debitUsd: 0.01, creditUsd: 0 },
      { accountCode: '1.1.4.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 },
      { accountCode: '1.1.3.01', debitBs: 0, creditBs: 16, debitUsd: 0, creditUsd: 0.16 },
      { accountCode: '6.1.1.11', debitBs: 0, creditBs: 3.48, debitUsd: 0, creditUsd: 0.0348 }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const returnMovement = {
    id: 'return-movement', companyId: 'company-1', productId: 'p-1',
    date: '2026-10-10', type: 'SALIDA', concept: 'DEVOLUCION_COMPRA',
    documentRef: 'NC-PROV-NC-001', quantity: 1, unitCostBs: 100, unitCostUsd: 1, bcvRate: 100,
    totalCostBs: 100, totalCostUsd: 1, balanceQty: 1, correctionForMovementId: 'purchase-movement',
    journalEntryId: 'credit-entry', counterpartyRif: 'J-12345678-9'
  };
  const note = {
    id: 'purchase-credit-note', companyId: 'company-1', opNumber: 2,
    invoiceDate: '2026-10-10', supplierRif: 'J-12345678-9',
    supplierName: 'Proveedor', invoiceNumber: 'NC-001', controlNumber: '00-NC-001',
    creditNoteNumber: 'NC-001', affectedInvoiceNumber: '100', affectedInvoiceDate: originalPurchase.invoiceDate,
    affectedInvoiceControlNumber: originalPurchase.controlNumber,
    affectedInvoiceTotalAmountBs: originalPurchase.totalAmountBs,
    affectedInvoiceTotalAmountUsd: originalPurchase.totalAmountUsd,
    fiscalEmissionMedium: 'DIGITAL', sameMediumAsOriginal: true, documentType: '03',
    totalAmountBs: 119.48, taxableBaseBs: 100, exemptAmountBs: 0,
    taxRate: 16, vatAmountBs: 16, retentionRate: 75, vatWithheldBs: 12,
    islrWithheldBs: 1, bcvRate: 100, totalAmountUsd: 1.1948,
    taxableBaseUsd: 1, vatAmountUsd: 0.16, vatWithheldUsd: 0.12,
    islrWithheldUsd: 0.01, igtfAmountBs: 3.48, igtfAmountUsd: 0.0348,
    journalEntryId: 'credit-entry', originalPurchaseId: 'purchase-original',
    netPayableReductionBs: 106.48, netPayableReductionUsd: 1.0648,
    notes: 'Mercancía defectuosa devuelta',
    creditNoteLines: [{ productId: 'p-1', originalMovementId: 'purchase-movement',
      movementId: 'return-movement', quantity: 1, unitCostBs: 100, inventoryCostBs: 100 }]
  };
  const vatVoucher = { id: 'vat-original', companyId: 'company-1', purchaseRecordId: originalPurchase.id,
    invoiceNumber: originalPurchase.invoiceNumber, supplierRif: originalPurchase.supplierRif,
    requiresFiscalCorrection: false };
  const islrVoucher = { id: 'islr-original', companyId: 'company-1', invoiceNumber: originalPurchase.invoiceNumber,
    supplierRif: originalPurchase.supplierRif, requiresFiscalCorrection: false };
  const correctedVatVoucher = { ...vatVoucher, requiresFiscalCorrection: true,
    correctionEntryId: noteEntry.id, correctionEntryIds: [noteEntry.id], correctionNote: 'Nota de crédito NC-001 requiere revisar retención fiscal' };
  const correctedIslrVoucher = { ...islrVoucher, requiresFiscalCorrection: true,
    correctionEntryId: noteEntry.id, correctionEntryIds: [noteEntry.id], correctionNote: 'Nota de crédito NC-001 requiere revisar retención fiscal' };
  const prior = { ...emptyState([originalEntry]), purchases: [originalPurchase],
    movements: [originalMovement], products: [{ ...product, currentStock: 2 }],
    vatVouchers: [vatVoucher], islrVouchers: [islrVoucher] };
  const next = { ...emptyState([originalEntry, noteEntry]), purchases: [originalPurchase, note],
    movements: [originalMovement, returnMovement], products: [product],
    vatVouchers: [correctedVatVoucher], islrVouchers: [correctedIslrVoucher] };
  return { prior, next, note, returnMovement };
};

function applySupplierAdvanceToFixture(next, note, advanceBs) {
  note.supplierAdvanceBs = advanceBs;
  note.supplierAdvanceUsd = advanceBs / 100;
  note.netPayableReductionBs = Math.round((Number(note.totalAmountBs) -
    Number(note.vatWithheldBs || 0) - Number(note.islrWithheldBs || 0) - advanceBs) * 100) / 100;
  note.netPayableReductionUsd = Math.round((Number(note.totalAmountUsd) -
    Number(note.vatWithheldUsd || 0) - Number(note.islrWithheldUsd || 0) - note.supplierAdvanceUsd) * 1000000) / 1000000;
  const journal = next.journalEntries.find(item => item.id === note.journalEntryId);
  const payable = journal.items.find(item => String(item.accountCode || '').startsWith('2.1.1.'));
  payable.debitBs = note.netPayableReductionBs;
  payable.debitUsd = note.netPayableReductionUsd;
  journal.items.push({
    accountCode: '1.1.2.03', debitBs: advanceBs, creditBs: 0,
    debitUsd: note.supplierAdvanceUsd, creditUsd: 0
  });
}

test('SQLite reconciles concurrent supplier returns independently when companies reuse product ids', () => {
  const { prior, next } = supplierCreditFixture();
  const clone = (value, suffix) => ({ ...value,
    id: value.id + suffix, companyId: 'company-2',
    ...(value.journalEntryId ? { journalEntryId: value.journalEntryId + suffix } : {}),
    ...(value.correctionEntryId ? { correctionEntryId: value.correctionEntryId + suffix } : {}),
    ...(value.correctionEntryIds ? { correctionEntryIds: value.correctionEntryIds.map(id => id + suffix) } : {}),
    ...(value.purchaseRecordId ? { purchaseRecordId: value.purchaseRecordId + suffix } : {}),
    ...(value.originalPurchaseId ? { originalPurchaseId: value.originalPurchaseId + suffix } : {}),
    ...(value.originalMovementId ? { originalMovementId: value.originalMovementId + suffix } : {}),
    ...(value.movementId ? { movementId: value.movementId + suffix } : {}),
    ...(value.correctionForMovementId ? { correctionForMovementId: value.correctionForMovementId + suffix } : {}),
    ...(value.creditNoteLines ? { creditNoteLines: value.creditNoteLines.map(line => ({
      ...line, originalMovementId: line.originalMovementId + suffix,
      movementId: line.movementId + suffix
    })) } : {})
  });
  const originalPurchase = clone(prior.purchases[0], '-2');
  const originalEntry = clone(prior.journalEntries[0], '-2');
  const originalMovement = clone(prior.movements[0], '-2');
  const productPrior = { ...prior.products[0], companyId: 'company-2' };
  const note = clone(next.purchases[1], '-2');
  const noteEntry = clone(next.journalEntries[1], '-2');
  const returnMovement = clone(next.movements[1], '-2');
  const productNext = { ...next.products[0], companyId: 'company-2' };
  prior.purchases.push(originalPurchase);
  prior.journalEntries.push(originalEntry);
  prior.movements.push(originalMovement);
  prior.products.push(productPrior);
  next.purchases.push(originalPurchase, note);
  next.journalEntries.push(originalEntry, noteEntry);
  next.movements.push(originalMovement, returnMovement);
  next.products.push(productNext);
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
});

test('SQLite accepts a supplier credit note only with linked stock return, balanced journal, taxes, AP reduction and flagged retention vouchers', () => {
  const { prior, next } = supplierCreditFixture();
  assert.equal(next.vatVouchers[0].correctionEntryId, 'credit-entry');
  assert.equal(next.islrVouchers[0].correctionEntryId, 'credit-entry');
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
});

test('SQLite rejects duplicate references to the same original stock movement in one supplier credit note', () => {
  const { prior, next } = supplierCreditFixture();
  const note = next.purchases.find(item => item.id === 'purchase-credit-note');
  const returnMovement = next.movements.find(item => item.id === 'return-movement');
  note.creditNoteLines.push({ ...note.creditNoteLines[0], movementId: 'return-movement-duplicate' });
  next.movements.push({ ...returnMovement, id: 'return-movement-duplicate' });
  assert.throws(() => validateAccountingSnapshot(prior, next), /salida física no concilia|línea de nota de crédito|existencia final del artículo/i);
});

test('SQLite reconciles supplier credit note against the payable auxiliary used by the original purchase', () => {
  const { prior, next } = supplierCreditFixture();
  const originalEntry = next.journalEntries.find(item => item.id === 'purchase-entry');
  const creditEntry = next.journalEntries.find(item => item.id === 'credit-entry');
  originalEntry.items.find(item => item.accountCode === '2.1.1.01').accountCode = '2.1.1.09';
  creditEntry.items.find(item => item.accountCode === '2.1.1.01').accountCode = '2.1.1.09';
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
  creditEntry.items.find(item => item.accountCode === '2.1.1.09').accountCode = '2.1.1.01';
  assert.throws(() => validateAccountingSnapshot(prior, next), /no está balanceado o no revierte CxP/);
});

test('SQLite rejects supplier credit note amounts posted to the opposite side of the payable auxiliary', () => {
  const { prior, next } = supplierCreditFixture();
  const entry = next.journalEntries.find(item => item.id === 'credit-entry');
  entry.items.push(
    { accountCode: '2.1.1.01', debitBs: 0, creditBs: 1, debitUsd: 0, creditUsd: 0.01 },
    { accountCode: '1.1.1.01', debitBs: 1, creditBs: 0, debitUsd: 0.01, creditUsd: 0 }
  );
  assert.throws(() => validateAccountingSnapshot(prior, next), /no está balanceado o no revierte CxP/);
});

test('SQLite rejects a retention correction flag linked to an unrelated entry', () => {
  const { prior, next } = supplierCreditFixture();
  next.vatVouchers[0].correctionEntryId = 'unrelated-entry';
  next.vatVouchers[0].correctionEntryIds.push('unrelated-entry');
  assert.throws(() => validateAccountingSnapshot(prior, next), /corrección de retención IVA/);
});


test('SQLite accepts a supplier advance application to a purchase invoice created in the same atomic batch', () => {
  const { prior: fixturePrior, next: fixtureNext } = supplierCreditFixture();
  const originalPurchase = structuredClone(fixturePrior.purchases[0]);
  const originalEntry = structuredClone(fixturePrior.journalEntries[0]);
  const originalMovement = structuredClone(fixturePrior.movements[0]);
  const product = structuredClone(fixturePrior.products[0]);
  const vatVoucher = structuredClone(fixturePrior.vatVouchers[0]);
  const islrVoucher = structuredClone(fixturePrior.islrVouchers[0]);
  originalPurchase.id = 'purchase-created-in-batch';
  originalPurchase.invoiceNumber = '101';
  originalPurchase.controlNumber = '00-101';
  originalPurchase.journalEntryId = 'purchase-created-in-batch-entry';
  originalEntry.id = 'purchase-created-in-batch-entry';
  originalEntry.entryNumber = 1;
  originalEntry.referenceDoc = 'FAC-101';
  originalEntry.items.find(item => item.accountCode === '2.1.1.01').description = 'Cuenta por pagar proveedor';
  originalMovement.id = 'purchase-created-in-batch-movement';
  originalMovement.documentRef = 'FAC-101';
  originalPurchase.inventoryLines = [];
  originalMovement.quantity = 0;
  originalMovement.totalCostBs = 0;
  originalMovement.totalCostUsd = 0;
  originalPurchase.paymentTerm = 'CREDITO';

  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true },
    { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', isMovement: true }
  ];
  const directJournal = {
    id: 'batch-direct-source-journal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'Anticipo directo', type: 'ANTICIPO_PROVEEDOR',
    bcvRate: 100, referenceDoc: 'DIRECT-BATCH-1',
    items: [
      { accountCode: '1.1.2.03', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const applicationJournal = {
    id: 'batch-application-journal', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-11', description: 'Aplicación anticipo a factura 101',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: '101',
    items: [
      { accountCode: '2.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const source = {
    id: 'batch-direct-source', companyId: 'company-1', supplierRif: originalPurchase.supplierRif,
    supplierName: originalPurchase.supplierName, date: '2026-10-10', amountUsd: 1,
    bookValueBs: 100, bcvRate: 100, treasuryAccountCode: '1.1.1.01',
    paymentCurrency: 'BS', paidAmount: 100, reference: 'DIRECT-BATCH-1',
    support: 'REC-DIRECT-BATCH-1', journalEntryId: directJournal.id,
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const settlement = {
    id: 'batch-advance-application', companyId: 'company-1',
    supplierRif: originalPurchase.supplierRif, supplierName: originalPurchase.supplierName,
    sourceCreditNoteIds: [], sourceCreditNoteAllocations: [],
    sourceDirectAdvanceIds: [source.id],
    sourceDirectAdvanceAllocations: [{ directAdvanceId: source.id, amountUsd: 1, bookValueBs: 100 }],
    kind: 'APPLIED_TO_PURCHASE', date: '2026-10-11', amountUsd: 1, amountBs: 100,
    advanceBookValueBs: 100, bcvRate: 100, targetPurchaseId: originalPurchase.id,
    journalEntryId: applicationJournal.id, reference: 'APPLY-BATCH-1',
    createdAt: '2026-10-11T10:00:00.000Z'
  };
  const prior = {
    ...emptyState(), accounts, purchases: [], journalEntries: [], movements: [],
    products: [], vatVouchers: [], islrVouchers: [],
    supplierDirectAdvances: [], supplierAdvanceSettlements: []
  };
  const next = {
    ...prior,
    purchases: [originalPurchase],
    journalEntries: [originalEntry, directJournal, applicationJournal],
    movements: [],
    products: [product],
    vatVouchers: [{ ...vatVoucher, purchaseRecordId: originalPurchase.id, invoiceNumber: originalPurchase.invoiceNumber }],
    islrVouchers: [{ ...islrVoucher, invoiceNumber: originalPurchase.invoiceNumber }],
    supplierDirectAdvances: [source],
    supplierAdvanceSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
});


test('SQLite validates a purchase invoice and its credit payment created in the same atomic batch', () => {
  const { prior: basePrior } = supplierCreditFixture();
  const purchase = structuredClone(basePrior.purchases[0]);
  const purchaseJournal = structuredClone(basePrior.journalEntries[0]);
  const movement = structuredClone(basePrior.movements[0]);
  const product = { ...basePrior.products[0], currentStock: 2 };
  const vatVoucher = structuredClone(basePrior.vatVouchers[0]);
  const islrVoucher = structuredClone(basePrior.islrVouchers[0]);
  const settlementRate = 110;
  const amountUsd = 0.5;
  const amountBs = 55;
  const expectedPayableBs = 50;
  const paymentJournal = {
    id: 'purchase-batch-payment-entry', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-11', description: 'Pago parcial factura 100', type: 'AJUSTE',
    bcvRate: settlementRate, referenceDoc: purchase.invoiceNumber,
    items: [
      { accountCode: '2.1.1.01', debitBs: expectedPayableBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0 },
      { accountCode: '1.1.1.03', debitBs: 0, creditBs: amountBs, debitUsd: 0, creditUsd: amountUsd },
      { accountCode: '6.1.1.08', debitBs: 5, creditBs: 0, debitUsd: 0, creditUsd: 0 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const settlement = {
    id: 'purchase-batch-payment', companyId: 'company-1',
    documentId: purchase.id, kind: 'PURCHASE_PAYMENT',
    settlementDate: '2026-10-11', bcvRate: settlementRate,
    amountUsd, amountBs, method: 'BANK_TRANSFER_BS', bankAccountId: 'bank-1', reference: 'BANK 100',
    journalEntryId: paymentJournal.id, createdAt: '2026-10-11T10:00:00.000Z'
  };
  const accounts = [
    { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', isMovement: true },
    { code: '1.1.3.01', name: 'IVA crédito fiscal', type: 'ACTIVO', isMovement: true },
    { code: '6.1.1.11', name: 'IGTF', type: 'GASTOS', isMovement: true },
    { code: '2.1.2.03', name: 'IVA retenido por pagar', type: 'PASIVO', isMovement: true },
    { code: '2.1.2.04', name: 'ISLR retenido por pagar', type: 'PASIVO', isMovement: true },
    { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', isMovement: true },
    { code: '1.1.1.03', name: 'Banco', type: 'ACTIVO', isMovement: true },
    { code: '6.1.1.08', name: 'Pérdida cambiaria', type: 'GASTOS', isMovement: true }
  ];
  const prior = {
    ...basePrior, purchases: [], journalEntries: [], movements: [], products: [],
    vatVouchers: [], islrVouchers: [], creditSettlements: [], accounts,
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03', currency: 'BS' }]
  };
  const next = {
    ...prior, purchases: [purchase],
    journalEntries: [purchaseJournal, paymentJournal],
    movements: [movement], products: [product],
    vatVouchers: [vatVoucher], islrVouchers: [islrVoucher],
    creditSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...next,
    journalEntries: [purchaseJournal, {
      ...paymentJournal,
      items: paymentJournal.items.map(line => line.accountCode === '2.1.1.01'
        ? { ...line, accountCode: '2.1.1.99' } : line)
    }]
  }), /pago de una factura.*ND de proveedor/);
  const priorDuplicate = {
    ...prior,
    creditSettlements: [{
      id: 'prior-bank-payment', companyId: 'company-1', documentId: 'other-purchase',
      kind: 'PURCHASE_PAYMENT', bankAccountId: 'bank-1', reference: 'BANK   100', isReversed: false
    }]
  };
  assert.throws(() => validateAccountingSnapshot(priorDuplicate, {
    ...next,
    creditSettlements: [...priorDuplicate.creditSettlements, settlement]
  }), /referencia duplicada/);
});

test('SQLite applies a direct supplier advance to a future payable and reduces the remaining AP ceiling', () => {
  const { prior: basePrior } = supplierCreditFixture();
  const originalPurchase = basePrior.purchases[0];
  const originalEntry = basePrior.journalEntries[0];
  const payableLine = originalEntry.items.find(item => item.accountCode === '2.1.1.01');
  payableLine.description = 'Cuenta por pagar proveedor';
  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true },
    { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', isMovement: true }
  ];
  const directJournal = {
    id: 'direct-source-journal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'Anticipo directo', type: 'ANTICIPO_PROVEEDOR',
    bcvRate: 100, referenceDoc: 'DIRECT-1',
    items: [
      { accountCode: '1.1.2.03', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const applicationJournal = {
    id: 'direct-application-journal', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-11', description: 'Aplicación anticipo a factura', type: 'ANTICIPO_PROVEEDOR',
    bcvRate: 100, referenceDoc: originalPurchase.invoiceNumber,
    items: [
      { accountCode: '2.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const source = {
    id: 'direct-source-1', companyId: 'company-1', supplierRif: originalPurchase.supplierRif,
    supplierName: originalPurchase.supplierName, date: '2026-10-10', amountUsd: 1,
    bookValueBs: 100, bcvRate: 100, treasuryAccountCode: '1.1.1.01',
    paymentCurrency: 'BS', paidAmount: 100, reference: 'DIRECT-1', support: 'REC-DIRECT-1',
    journalEntryId: 'direct-source-journal', createdAt: '2026-10-10T10:00:00.000Z'
  };
  const settlement = {
    id: 'direct-application-1', companyId: 'company-1', supplierRif: originalPurchase.supplierRif,
    supplierName: originalPurchase.supplierName, sourceCreditNoteIds: [], sourceCreditNoteAllocations: [],
    sourceDirectAdvanceIds: ['direct-source-1'],
    sourceDirectAdvanceAllocations: [{ directAdvanceId: 'direct-source-1', amountUsd: 1, bookValueBs: 100 }],
    kind: 'APPLIED_TO_PURCHASE', date: '2026-10-11', amountUsd: 1, amountBs: 100,
    advanceBookValueBs: 100, bcvRate: 100, targetPurchaseId: originalPurchase.id,
    journalEntryId: 'direct-application-journal', reference: 'APPLY-1',
    createdAt: '2026-10-11T10:00:00.000Z'
  };
  const previous = {
    ...basePrior, accounts,
    supplierDirectAdvances: [], supplierAdvanceSettlements: []
  };
  const next = {
    ...previous,
    journalEntries: [...previous.journalEntries, directJournal, applicationJournal],
    supplierDirectAdvances: [source], supplierAdvanceSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    supplierAdvanceSettlements: [{ ...settlement, amountUsd: 2, amountBs: 200, advanceBookValueBs: 200,
      sourceDirectAdvanceAllocations: [{ directAdvanceId: 'direct-source-1', amountUsd: 2, bookValueBs: 200 }]
    }],
    journalEntries: [...previous.journalEntries, directJournal, {
      ...applicationJournal,
      items: [
        { accountCode: '2.1.1.01', debitBs: 200, creditBs: 0, debitUsd: 2, creditUsd: 0 },
        { accountCode: '1.1.2.03', debitBs: 0, creditBs: 200, debitUsd: 0, creditUsd: 2 }
      ]
    }]
  }), /exceden el saldo individual de un desembolso directo|exceden los saldos de notas de crédito y desembolsos directos|superan el principal neto de CxP/);
});

test('SQLite reconciles the portion of a supplier credit note applied to AP and the excess recorded as an advance', () => {
  const { prior, next } = supplierCreditFixture();
  const note = next.purchases[1];
  const entry = next.journalEntries.find(item => item.id === note.journalEntryId);
  note.netPayableReductionBs = 96.48;
  note.netPayableReductionUsd = 0.9648;
  note.supplierAdvanceBs = 10;
  note.supplierAdvanceUsd = 0.1;
  const payable = entry.items.find(item => item.accountCode === '2.1.1.01');
  payable.debitBs = 96.48;
  payable.debitUsd = 0.9648;
  entry.items.push({ accountCode: '1.1.2.03', debitBs: 10, creditBs: 0, debitUsd: 0.1, creditUsd: 0 });
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
  note.supplierAdvanceBs = 9;
  assert.throws(() => validateAccountingSnapshot(prior, next), /no revierte CxP, inventario, IVA, retenciones e IGTF/);
});

test('SQLite rejects impossible calendar dates on supplier credit notes', () => {
  const { prior, next } = supplierCreditFixture();
  next.purchases[1].invoiceDate = '2026-02-30';
  next.journalEntries[1].date = '2026-02-30';
  next.movements[1].date = '2026-02-30';
  assert.throws(() => validateAccountingSnapshot(prior, next), /falta factura original, proveedor, soporte/);
});

test('SQLite rejects supplier credit note without the linked physical return', () => {
  const { prior, next } = supplierCreditFixture();
  next.movements = next.movements.filter(item => item.id !== 'return-movement');
  assert.throws(() => validateAccountingSnapshot(prior, next), /cada línea de nota de crédito debe tener exactamente su salida/);
});

test('SQLite rejects a return movement linked to the note but assigned to another product or date', () => {
  for (const mutate of [
    movement => { movement.productId = 'different-product'; },
    movement => { movement.date = '2026-10-11'; },
    movement => { movement.unitCostBs = 99; }
  ]) {
    const { prior, next } = supplierCreditFixture();
    mutate(next.movements[1]);
    assert.throws(() => validateAccountingSnapshot(prior, next), /la salida física no concilia/);
  }
});

test('SQLite rejects supplier credit note whose journal does not reverse VAT or AP correctly', () => {
  const { prior, next } = supplierCreditFixture();
  next.journalEntries[1].items[0].debitBs = 50;
  assert.throws(() => validateAccountingSnapshot(prior, next), /no cuadra simultáneamente/);
});

test('SQLite rejects cumulative supplier returns above the original invoice quantity', () => {
  const { prior, next } = supplierCreditFixture();
  const secondNote = {
    ...next.purchases[1], id: 'purchase-credit-note-2', invoiceNumber: 'NC-002',
    creditNoteNumber: 'NC-002', opNumber: 3, journalEntryId: 'credit-entry-2',
    totalAmountBs: 179.22, taxableBaseBs: 150, vatAmountBs: 24,
    vatWithheldBs: 18, islrWithheldBs: 1.5, igtfAmountBs: 5.22,
    totalAmountUsd: 1.7922, taxableBaseUsd: 1.5, vatAmountUsd: 0.24,
    vatWithheldUsd: 0.18, islrWithheldUsd: 0.015, igtfAmountUsd: 0.0522,
    netPayableReductionBs: 159.72, netPayableReductionUsd: 1.5972,
    creditNoteLines: [{ ...next.purchases[1].creditNoteLines[0], quantity: 1.5, inventoryCostBs: 150, movementId: 'return-movement-2' }]
  };
  const secondMovement = { ...next.movements[1], id: 'return-movement-2', quantity: 1.5,
    totalCostBs: 150, totalCostUsd: 1.5, documentRef: 'NC-PROV-NC-002',
    correctionForMovementId: 'purchase-movement', journalEntryId: 'credit-entry-2' };
  const secondEntry = {
    ...next.journalEntries[1], id: 'credit-entry-2', entryNumber: 3,
    referenceDoc: 'NC-PROV-NC-002',
    items: [
      { accountCode: '2.1.1.01', debitBs: 159.72, creditBs: 0, debitUsd: 1.5972, creditUsd: 0 },
      { accountCode: '2.1.2.03', debitBs: 18, creditBs: 0, debitUsd: 0.18, creditUsd: 0 },
      { accountCode: '2.1.2.04', debitBs: 1.5, creditBs: 0, debitUsd: 0.015, creditUsd: 0 },
      { accountCode: '1.1.4.01', debitBs: 0, creditBs: 150, debitUsd: 0, creditUsd: 1.5 },
      { accountCode: '1.1.3.01', debitBs: 0, creditBs: 24, debitUsd: 0, creditUsd: 0.24 },
      { accountCode: '6.1.1.11', debitBs: 0, creditBs: 5.22, debitUsd: 0, creditUsd: 0.0522 }
    ]
  };
  next.purchases.push(secondNote);
  next.movements.push(secondMovement);
  next.journalEntries.push(secondEntry);
  assert.throws(() => validateAccountingSnapshot(prior, next), /devoluciones acumuladas superan/);
});


test('Production SQLite persistence rolls back the updated snapshot when the final audit insert fails and survives database reopen', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-credit-note-'));
  const filename = path.join(directory, 'sicoven.sqlite');
  const { prior, next } = supplierCreditFixture();
  let db;
  try {
    db = new Database(filename);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = FULL');
    db.exec(`
      CREATE TABLE app_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
      CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
    `);
    db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)')
      .run('accounting', JSON.stringify(prior));

    db.exec(`CREATE TRIGGER reject_supplier_credit_audit BEFORE INSERT ON audit_events
      WHEN NEW.event_type='state_saved'
      BEGIN SELECT RAISE(ABORT, 'simulated audit write failure'); END;`);
    assert.throws(() => persistAccountingSnapshot(db, next), /simulated audit write failure/);
    assert.deepEqual(
      JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json),
      prior,
      'el fallo de auditoría debe revertir también el estado contable'
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 0);

    db.exec('DROP TRIGGER reject_supplier_credit_audit');
    const saved = persistAccountingSnapshot(db, next);
    assert.equal(saved.ok, true);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    db = null;

    db = new Database(filename);
    const reopened = JSON.parse(
      db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json
    );
    assert.equal(reopened.purchases.find(item => item.id === 'purchase-credit-note').documentType, '03');
    assert.equal(reopened.purchases.find(item => item.id === 'purchase-credit-note').originalPurchaseId, 'purchase-original');
    assert.equal(reopened.movements.find(item => item.id === 'return-movement').journalEntryId, 'credit-entry');
    assert.equal(reopened.journalEntries.find(item => item.id === 'credit-entry').referenceDoc, 'NC-PROV-NC-001');
    assert.equal(reopened.vatVouchers[0].correctionEntryIds[0], 'credit-entry');
    assert.equal(reopened.islrVouchers[0].correctionEntryIds[0], 'credit-entry');
    const audit = db.prepare("SELECT details_json FROM audit_events WHERE event_type='supplier_credit_note_posted'").get();
    assert.ok(audit);
    assert.equal(JSON.parse(audit.details_json).documentId, 'purchase-credit-note');
  } finally {
    if (db?.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite rejects supplier credit notes when the original payable or tax journal is not reconciled', () => {
  const { prior, next } = supplierCreditFixture();
  const alteredOriginal = {
    ...prior.journalEntries[0],
    items: prior.journalEntries[0].items.map(item => item.accountCode === '2.1.1.01'
      ? { ...item, creditBs: 200, creditUsd: 2 } : item)
  };
  const alteredPrior = { ...prior, journalEntries: [alteredOriginal] };
  const alteredNext = {
    ...next,
    journalEntries: [alteredOriginal, ...next.journalEntries.filter(item => item.id !== alteredOriginal.id)]
  };
  assert.throws(() => validateAccountingSnapshot(alteredPrior, alteredNext),
    /factura original o el asiento fiscal no están conciliados/);
});

test('SQLite rejects supplier advance settlements without source credit notes and linked journal', () => {
  const invalid = {
    id: 'advance-settlement-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    kind: 'REFUND_RECEIVED', date: '2026-10-30', amountUsd: 10, amountBs: 1000,
    advanceBookValueBs: 900, cashReceivedBs: 1000, bcvRate: 100,
    sourceCreditNoteIds: ['missing-credit-note'], sourceCreditNoteAllocations: [{ creditNoteId: 'missing-credit-note', amountUsd: 10, bookValueBs: 900 }], treasuryAccountCode: '1.1.1.03',
    journalEntryId: 'missing-journal', createdAt: '2026-10-30T10:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(
    emptyState(),
    { ...emptyState(), supplierAdvanceSettlements: [invalid] }
  ), /notas de crédito inexistentes/);
});

test('SQLite rejects supplier advance allocations that exceed the individual credit-note balance', () => {
  const { prior, next, note } = supplierCreditFixture();
  applySupplierAdvanceToFixture(next, note, 10);
  const makeRefund = (id, entryNumber, amountUsd, date) => {
    const cashBs = amountUsd * 100;
    const journalId = id + '-journal';
    return {
      journal: {
        id: journalId, companyId: 'company-1', entryNumber, date,
        description: 'Reembolso anticipo', type: 'ANTICIPO_PROVEEDOR', bcvRate: 100,
        items: [
          { accountCode: '1.1.1.03', debitBs: cashBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0 },
          { accountCode: '1.1.2.03', debitBs: 0, creditBs: cashBs, debitUsd: 0, creditUsd: amountUsd }
        ],
        createdAt: date + 'T10:00:00.000Z'
      },
      settlement: {
        id, companyId: 'company-1', supplierRif: 'J-12345678-9',
        kind: 'REFUND_RECEIVED', date, amountUsd, amountBs: cashBs,
        advanceBookValueBs: cashBs, cashReceivedBs: cashBs, bcvRate: 100,
        sourceCreditNoteIds: [note.id],
        sourceCreditNoteAllocations: [{ creditNoteId: note.id, amountUsd, bookValueBs: cashBs }],
        treasuryAccountCode: '1.1.1.03', journalEntryId: journalId,
        createdAt: date + 'T10:00:00.000Z'
      }
    };
  };
  const first = makeRefund('refund-1', 3, 0.06, '2026-10-20');
  const second = makeRefund('refund-2', 4, 0.05, '2026-10-21');
  const adjustedNext = {
    ...next,
    journalEntries: [...next.journalEntries, first.journal, second.journal],
    supplierAdvanceSettlements: [first.settlement, second.settlement],
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03' }]
  };
  assert.throws(() => validateAccountingSnapshot(prior, adjustedNext),
    /liquidaciones de anticipos que exceden los saldos de notas de crédito y desembolsos directos/);
});

test('SQLite restores an individual credit-note advance allocation after its settlement is reversed', () => {
  const { prior, next, note } = supplierCreditFixture();
  applySupplierAdvanceToFixture(next, note, 10);
  const original = {
    id: 'refund-reversed-journal', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-20', description: 'Reembolso luego reversado',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100,
    reversedByEntryId: 'refund-reversal-journal', isAdjusted: true,
    items: [
      { accountCode: '1.1.1.03', debitBs: 6, creditBs: 0, debitUsd: 0.06, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 6, debitUsd: 0, creditUsd: 0.06 }
    ]
  };
  const reversal = {
    id: 'refund-reversal-journal', companyId: 'company-1', entryNumber: 4,
    date: '2026-10-21', description: 'REVERSIÓN / reembolso',
    type: 'AJUSTE', bcvRate: 100, reversalOfEntryId: original.id,
    referenceDoc: 'REV-3',
    reversalReason: 'Restituir el anticipo recibido por error',
    workpaperNote: 'Se cotejó el recibo bancario y el asiento original',
    items: [
      { accountCode: '1.1.1.03', debitBs: 0, creditBs: 6, debitUsd: 0, creditUsd: 0.06 },
      { accountCode: '1.1.2.03', debitBs: 6, creditBs: 0, debitUsd: 0.06, creditUsd: 0 }
    ]
  };
  const active = {
    id: 'refund-active-settlement', companyId: 'company-1', supplierRif: 'J-12345678-9',
    kind: 'REFUND_RECEIVED', date: '2026-10-22', amountUsd: 0.05, amountBs: 5,
    advanceBookValueBs: 5, cashReceivedBs: 5, bcvRate: 100,
    sourceCreditNoteIds: [note.id],
    sourceCreditNoteAllocations: [{ creditNoteId: note.id, amountUsd: 0.05, bookValueBs: 5 }],
    treasuryAccountCode: '1.1.1.03', journalEntryId: 'refund-active-journal',
    createdAt: '2026-10-22T10:00:00.000Z'
  };
  const activeJournal = {
    id: 'refund-active-journal', companyId: 'company-1', entryNumber: 5,
    date: '2026-10-22', description: 'Reembolso posterior',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100,
    items: [
      { accountCode: '1.1.1.03', debitBs: 5, creditBs: 0, debitUsd: 0.05, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 5, debitUsd: 0, creditUsd: 0.05 }
    ]
  };
  const reversedSettlement = {
    id: 'refund-reversed-settlement', companyId: 'company-1', supplierRif: 'J-12345678-9',
    kind: 'REFUND_RECEIVED', date: '2026-10-20', amountUsd: 0.06, amountBs: 6,
    advanceBookValueBs: 6, cashReceivedBs: 6, bcvRate: 100,
    sourceCreditNoteIds: [note.id],
    sourceCreditNoteAllocations: [{ creditNoteId: note.id, amountUsd: 0.06, bookValueBs: 6 }],
    treasuryAccountCode: '1.1.1.03', journalEntryId: original.id,
    isReversed: true, reversedByJournalEntryId: reversal.id,
    createdAt: '2026-10-20T10:00:00.000Z'
  };
  const adjustedNext = {
    ...next,
    journalEntries: [...next.journalEntries, original, reversal, activeJournal],
    supplierAdvanceSettlements: [reversedSettlement, active],
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03' }]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, adjustedNext));
});

test('SQLite rejects supplier advance settlements with an unbalanced linked journal', () => {
  const { prior, next, note } = supplierCreditFixture();
  applySupplierAdvanceToFixture(next, note, 10);
  const journal = {
    id: 'advance-journal', companyId: 'company-1', entryNumber: 3, date: '2026-10-30',
    description: 'Liquidación anticipo', type: 'ANTICIPO_PROVEEDOR', bcvRate: 100,
    items: [
      { accountCode: '1.1.1.03', debitBs: 10, creditBs: 0, debitUsd: 0.1, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 9.98, debitUsd: 0, creditUsd: 0.1 }
    ],
    createdAt: '2026-10-30T10:00:00.000Z'
  };
  const settlement = {
    id: 'advance-settlement-2', companyId: 'company-1', supplierRif: 'J-12345678-9',
    kind: 'REFUND_RECEIVED', date: '2026-10-30', amountUsd: 0.1, amountBs: 10,
    advanceBookValueBs: 10, cashReceivedBs: 10, bcvRate: 100,
    sourceCreditNoteIds: [note.id],
    sourceCreditNoteAllocations: [{ creditNoteId: note.id, amountUsd: 0.1, bookValueBs: 10 }],
    treasuryAccountCode: '1.1.1.03', journalEntryId: 'advance-journal',
    createdAt: '2026-10-30T10:00:00.000Z'
  };
  const adjustedNext = {
    ...next,
    journalEntries: [...next.journalEntries, journal],
    supplierAdvanceSettlements: [settlement],
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03' }]
  };
  assert.throws(() => validateAccountingSnapshot(prior, adjustedNext),
    /asiento de anticipo descuadrado|no cuadra simultáneamente en Bs\. y USD/);
});


test('SQLite rejects supplier advance refunds posted to an unrelated account instead of the exact FX gain account', () => {
  const { prior, next, note } = supplierCreditFixture();
  applySupplierAdvanceToFixture(next, note, 10);
  const journal = {
    id: 'advance-fx-journal', companyId: 'company-1', entryNumber: 3, date: '2026-10-30',
    description: 'Reembolso anticipo con ganancia cambiaria', type: 'ANTICIPO_PROVEEDOR', bcvRate: 100,
    items: [
      { accountCode: '1.1.1.03', debitBs: 10, creditBs: 0, debitUsd: 0.1, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 9, debitUsd: 0, creditUsd: 0.1 },
      { accountCode: '4.2.1.99', debitBs: 0, creditBs: 1, debitUsd: 0, creditUsd: 0 }
    ],
    createdAt: '2026-10-30T10:00:00.000Z'
  };
  const settlement = {
    id: 'advance-fx-settlement', companyId: 'company-1', supplierRif: 'J-12345678-9',
    kind: 'REFUND_RECEIVED', date: '2026-10-30', amountUsd: 0.1, amountBs: 9,
    advanceBookValueBs: 9, cashReceivedBs: 10, bcvRate: 100,
    sourceCreditNoteIds: [note.id],
    sourceCreditNoteAllocations: [{ creditNoteId: note.id, amountUsd: 0.1, bookValueBs: 9 }],
    treasuryAccountCode: '1.1.1.03', journalEntryId: journal.id,
    createdAt: '2026-10-30T10:00:00.000Z'
  };
  const adjustedNext = {
    ...next, journalEntries: [...next.journalEntries, journal],
    supplierAdvanceSettlements: [settlement],
    bankAccounts: [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.03' }]
  };
  assert.throws(() => validateAccountingSnapshot(prior, adjustedNext),
    /cuenta de tesorería, efectivo recibido o diferencial cambiario no concilian exactamente/);
});


test('SQLite rejects supplier credit notes with an invalid BCV rate', () => {
  const { prior, next } = supplierCreditFixture();
  const note = next.purchases.find(item => item.id === 'purchase-credit-note');
  note.bcvRate = Number.NaN;
  assert.throws(() => validateAccountingSnapshot(prior, next), /falta factura original, proveedor, soporte, líneas de Kardex o reducción de CxP válida/);
});

test('SQLite rejects supplier credit note lines with non-numeric quantities', () => {
  const { prior, next } = supplierCreditFixture();
  const note = next.purchases.find(item => item.id === 'purchase-credit-note');
  note.creditNoteLines[0].quantity = Number.NaN;
  assert.throws(() => validateAccountingSnapshot(prior, next), /la salida física no concilia con la entrada original/);
});

test('SQLite rejects balanced supplier credit note journals with unrelated accounts', () => {
  const { prior, next } = supplierCreditFixture();
  const journal = next.journalEntries.find(item => item.id === 'credit-entry');
  journal.items.push(
    { accountCode: '9.9.9.99', debitBs: 1, creditBs: 0, debitUsd: 0, creditUsd: 0 },
    { accountCode: '9.9.9.99', debitBs: 0, creditBs: 1, debitUsd: 0, creditUsd: 0 }
  );
  assert.throws(() => validateAccountingSnapshot(prior, next), /nota de crédito: el asiento no está balanceado o no revierte CxP/);
});


test('SQLite rejects supplier credit notes whose USD totals do not match the recorded BCV rate', () => {
  const { prior, next } = supplierCreditFixture();
  const note = next.purchases.find(item => item.id === 'purchase-credit-note');
  note.totalAmountUsd += 0.05;
  assert.throws(() => validateAccountingSnapshot(prior, next), /nota de crédito: el asiento no está balanceado o no revierte CxP/);
});


test('SQLite rejects supplier return movements with a different BCV rate or USD unit cost', () => {
  for (const mutate of [
    movement => { movement.bcvRate = 200; },
    movement => { movement.unitCostUsd = 0.75; }
  ]) {
    const { prior, next } = supplierCreditFixture();
    const movement = next.movements.find(item => item.id === 'return-movement');
    mutate(movement);
    assert.throws(() => validateAccountingSnapshot(prior, next), /la salida física no concilia con la entrada original/);
  }
});

test('SQLite rejects supplier return movements with an invalid final stock balance', () => {
  const { prior, next } = supplierCreditFixture();
  const movement = next.movements.find(item => item.id === 'return-movement');
  movement.balanceQty = Number.NaN;
  assert.throws(() => validateAccountingSnapshot(prior, next), /la salida física no concilia con la entrada original/);
});

test('SQLite preserves legacy company history instead of allowing demo-ID deletion bypasses', () => {
  const prior = emptyState();
  prior.movements = [{
    id: 'movement-legacy-1', companyId: 'comp-1', productId: 'product-1',
    quantity: 1, type: 'ENTRADA', date: '2025-01-01'
  }];
  const next = emptyState();
  assert.throws(
    () => validateAccountingSnapshot(prior, next),
    /bloqueó la eliminación del registro histórico en movements/
  );
});


test('SQLite preserves the ISLR fiscal event ledger as append-only history', () => {
  const fiscalEvent = {
    id: 'islr-event-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    conceptCode: '003', fiscalDate: '2026-10-01', sequence: 1, kind: 'PAYMENT',
    allocations: [{ purchaseId: 'purchase-1', baseAmountBs: 100 }],
    basePercentage: 90, unitTaxValueBs: 43, withheldAmountBs: 0,
    journalEntryId: 'entry-1', createdAt: '2026-10-01T10:00:00.000Z'
  };
  const purchase = {
    id: 'purchase-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
    documentType: '01', taxableBaseBs: 100, exemptAmountBs: 0, isCancelled: false
  };
  const secondPurchase = { ...purchase, id: 'purchase-2' };
  const prior = { ...emptyState([sourceEntry()]), purchases: [purchase, secondPurchase], islrFiscalEvents: [fiscalEvent] };
  const secondEntry = { ...sourceEntry(), id: 'entry-2', entryNumber: 2 };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, {
    ...emptyState([sourceEntry(), secondEntry]), purchases: [purchase, secondPurchase],
    islrFiscalEvents: [fiscalEvent, {
      ...fiscalEvent, id: 'islr-event-2', sequence: 2, journalEntryId: 'entry-2',
      allocations: [{ purchaseId: 'purchase-2', baseAmountBs: 100 }]
    }]
  }));
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...emptyState([sourceEntry()]), purchases: [purchase, secondPurchase],
    islrFiscalEvents: []
  }), /eliminación del registro histórico en islrFiscalEvents/);
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...emptyState([sourceEntry()]), purchases: [purchase, secondPurchase],
    islrFiscalEvents: [{ ...fiscalEvent, withheldAmountBs: 10 }]
  }), /modificación de un registro histórico en islrFiscalEvents/);
});

test('SQLite accepts a supplier credit note from a cash purchase as a supplier advance without creating or reducing AP', () => {
  const { prior, next, note } = supplierCreditFixture();
  const original = next.purchases.find(item => item.id === 'purchase-original');
  original.paymentTerm = 'CONTADO';
  original.paymentAccountCode = '1.1.1.01';
  original.paymentReference = 'EG-100';
  const originalEntry = next.journalEntries.find(item => item.id === 'purchase-entry');
  originalEntry.items.find(item => item.accountCode === '2.1.1.01').accountCode = '1.1.1.01';
  const treasury = { code: '1.1.1.01', name: 'Caja Principal', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' };
  prior.accounts = [treasury];
  next.accounts = [treasury];

  note.netPayableReductionBs = 0;
  note.netPayableReductionUsd = 0;
  note.supplierAdvanceBs = 106.48;
  note.supplierAdvanceUsd = 1.0648;
  const noteEntry = next.journalEntries.find(item => item.id === 'credit-entry');
  noteEntry.items.find(item => item.accountCode === '2.1.1.01').accountCode = '1.1.2.03';
  assert.equal(originalEntry.items.some(item => String(item.accountCode).startsWith('2.1.1.')), false);
  assert.equal(noteEntry.items.some(item => String(item.accountCode).startsWith('2.1.1.')), false);
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
});

test('SQLite rejects a cash-purchase credit note that posts any amount to a fictitious AP auxiliary', () => {
  const { prior, next, note } = supplierCreditFixture();
  const original = next.purchases.find(item => item.id === 'purchase-original');
  original.paymentTerm = 'CONTADO';
  original.paymentAccountCode = '1.1.1.01';
  original.paymentReference = 'EG-100';
  const originalEntry = next.journalEntries.find(item => item.id === 'purchase-entry');
  originalEntry.items.find(item => item.accountCode === '2.1.1.01').accountCode = '1.1.1.01';
  const treasury = { code: '1.1.1.01', name: 'Caja Principal', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' };
  prior.accounts = [treasury];
  next.accounts = [treasury];
  note.netPayableReductionBs = 0;
  note.netPayableReductionUsd = 0;
  note.supplierAdvanceBs = 106.48;
  note.supplierAdvanceUsd = 1.0648;
  const noteEntry = next.journalEntries.find(item => item.id === 'credit-entry');
  const advanceDebit = noteEntry.items.find(item => item.accountCode === '2.1.1.01');
  advanceDebit.accountCode = '1.1.2.03';
  advanceDebit.debitBs = 105.48;
  advanceDebit.debitUsd = 1.0548;
  noteEntry.items.push({ accountCode: '2.1.1.01', debitBs: 1, creditBs: 0, debitUsd: 0.01, creditUsd: 0 });
  assert.throws(() => validateAccountingSnapshot(prior, next), /no está balanceado|no revierte CxP|modalidad de pago/);
});

test('SQLite validates the full contado purchase matrix: cash/bank, currencies, VAT and withholdings without fictitious AP', () => {
  const makeFixture = ({
    invoiceNumber, accountCode, taxable = 200, exempt = 0, vat = 32,
    vatWithheld = 0, islrWithheld = 0, expense = false, reference = 'PAY-REF'
  }) => {
    const rate = 100;
    const total = taxable + exempt + vat;
    const net = total - vatWithheld - islrWithheld;
    const purchaseId = 'cash-matrix-' + invoiceNumber;
    const entryId = purchaseId + '-entry';
    const items = [{
      accountCode: expense ? '6.1.1.04' : '1.1.4.01',
      accountName: expense ? 'Gastos operativos' : 'Inventario',
      debitBs: taxable + exempt, creditBs: 0,
      debitUsd: (taxable + exempt) / rate, creditUsd: 0
    }];
    if (vat > 0) items.push({
      accountCode: '1.1.3.01', accountName: 'IVA Crédito Fiscal',
      debitBs: vat, creditBs: 0, debitUsd: vat / rate, creditUsd: 0
    });
    if (vatWithheld > 0) items.push({
      accountCode: '2.1.2.03', accountName: 'Retenciones IVA por enterar',
      debitBs: 0, creditBs: vatWithheld, debitUsd: 0, creditUsd: vatWithheld / rate
    });
    if (islrWithheld > 0) items.push({
      accountCode: '2.1.2.04', accountName: 'Retenciones ISLR por enterar',
      debitBs: 0, creditBs: islrWithheld, debitUsd: 0, creditUsd: islrWithheld / rate
    });
    items.push({
      accountCode, accountName: 'Caja/Banco seleccionado',
      debitBs: 0, creditBs: net, debitUsd: 0, creditUsd: net / rate,
      description: 'Pago contado con soporte ' + reference
    });
    const purchase = {
      id: purchaseId, companyId: 'company-1', invoiceDate: '2026-10-10',
      accountCreditDate: '2026-10-10', supplierRif: 'J-12345678-9',
      supplierName: 'Proveedor', invoiceNumber, documentType: '01',
      totalAmountBs: total, taxableBaseBs: taxable, exemptAmountBs: exempt,
      taxRate: taxable > 0 ? 16 : 0, vatAmountBs: vat,
      vatWithheldBs: vatWithheld, islrWithheldBs: islrWithheld,
      igtfAmountBs: 0, bcvRate: rate,
      totalAmountUsd: total / rate, taxableBaseUsd: taxable / rate,
      vatAmountUsd: vat / rate, vatWithheldUsd: vatWithheld / rate,
      islrWithheldUsd: islrWithheld / rate, igtfAmountUsd: 0,
      journalEntryId: entryId, paymentTerm: 'CONTADO',
      paymentAccountCode: accountCode, paymentReference: reference,
      ...(expense ? {} : { inventoryLines: [{ productId: 'matrix-product', quantity: 1, unitCostBs: taxable + exempt }] })
    };
    const entry = {
      id: entryId, companyId: 'company-1', entryNumber: 1,
      date: '2026-10-10', description: 'Compra contado ' + invoiceNumber,
      type: 'COMPRA', bcvRate: rate, referenceDoc: 'FAC-' + invoiceNumber,
      items, createdAt: '2026-10-10T10:00:00.000Z'
    };
    const accounts = [
      { code: '1.1.1.01', name: 'Caja Principal Bs.', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.1.02', name: 'Caja Moneda Extranjera USD', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.1.03', name: 'Banco Nacional Bs.', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.1.04', name: 'Banco USD', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.3.01', name: 'IVA Crédito Fiscal', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '2.1.2.03', name: 'Retenciones IVA', type: 'PASIVO', level: 4, isMovement: true },
      { code: '2.1.2.04', name: 'Retenciones ISLR', type: 'PASIVO', level: 4, isMovement: true },
      { code: '6.1.1.04', name: 'Gastos operativos', type: 'GASTOS', level: 4, isMovement: true }
    ];
    const product = { id: 'matrix-product', companyId: 'company-1', inventoryAccountCode: '1.1.4.01' };
    const movement = {
      id: purchaseId + '-movement', companyId: 'company-1', productId: 'matrix-product',
      date: '2026-10-10', type: 'ENTRADA', concept: 'COMPRA',
      documentRef: 'FAC-' + invoiceNumber, counterpartyRif: 'J-12345678-9',
      quantity: 1, unitCostBs: taxable + exempt, unitCostUsd: (taxable + exempt) / rate,
      totalCostBs: taxable + exempt, totalCostUsd: (taxable + exempt) / rate, bcvRate: rate
    };
    return {
      purchase, entry, accounts, product, movement,
      state: {
        ...emptyState([entry]), accounts, purchases: [purchase],
        products: expense ? [] : [product], movements: expense ? [] : [movement]
      }
    };
  };

  const scenarios = [
    { invoiceNumber: 'M-001', accountCode: '1.1.1.01', reference: 'CASH-BS' },
    { invoiceNumber: 'M-002', accountCode: '1.1.1.02', reference: 'CASH-USD' },
    { invoiceNumber: 'M-003', accountCode: '1.1.1.03', reference: 'BANK-BS' },
    { invoiceNumber: 'M-004', accountCode: '1.1.1.04', reference: 'BANK-USD' },
    { invoiceNumber: 'M-005', accountCode: '1.1.1.01', vatWithheld: 24, reference: 'VAT-RET' },
    { invoiceNumber: 'M-006', accountCode: '1.1.1.01', islrWithheld: 5, reference: 'ISLR-RET' },
    { invoiceNumber: 'M-007', accountCode: '1.1.1.01', vatWithheld: 24, islrWithheld: 5, reference: 'BOTH-RET' },
    { invoiceNumber: 'M-008', accountCode: '1.1.1.01', taxable: 0, exempt: 200, vat: 0, reference: 'EXEMPT' },
    { invoiceNumber: 'M-009', accountCode: '1.1.1.03', expense: true, reference: 'EXPENSE-BANK' }
  ];
  for (const scenario of scenarios) {
    const fixture = makeFixture(scenario);
    assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), fixture.state), scenario.invoiceNumber);
    assert.equal(fixture.entry.items.some(item => String(item.accountCode).startsWith('2.1.1.')), false,
      'contado no debe crear una CxP ficticia: ' + scenario.invoiceNumber);
    const cashLine = fixture.entry.items.find(item => item.accountCode === scenario.accountCode);
    assert.equal(cashLine.creditBs, fixture.purchase.totalAmountBs -
      fixture.purchase.vatWithheldBs - fixture.purchase.islrWithheldBs);
  }

  const base = makeFixture({ invoiceNumber: 'M-NEG', accountCode: '1.1.1.01' });
  for (const invalidCode of ['6.1.1.04', '1.1.4.01', '2.1.1.01']) {
    const invalid = structuredClone(base.state);
    invalid.purchases[0].paymentAccountCode = invalidCode;
    invalid.journalEntries[0].items.find(item => item.accountCode === '1.1.1.01').accountCode = invalidCode;
    assert.throws(() => validateAccountingSnapshot(emptyState(), invalid), /asiento no reconoce en Bs\. y USD/);
  }
  const missingReference = structuredClone(base.state);
  missingReference.purchases[0].paymentReference = '';
  assert.throws(() => validateAccountingSnapshot(emptyState(), missingReference), /asiento no reconoce en Bs\. y USD/);
  const duplicate = {
    ...base.purchase, id: 'cash-matrix-duplicate', journalEntryId: 'cash-matrix-duplicate-entry'
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...base.state, purchases: [...base.state.purchases, duplicate]
  }), /factura de compra duplicada/);
});

test('SQLite blocks new journal entries and source documents dated inside a closed period', () => {
  const company = { id: 'company-1', name: 'Empresa de prueba', closedThroughDate: '2026-09-30' };
  const prior = { ...emptyState(), companies: [company] };
  const entry = { ...sourceEntry(), date: '2026-09-30' };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, journalEntries: [entry]
  }), /período cerrado/);
  const purchase = { id: 'purchase-1', companyId: 'company-1', invoiceDate: '2026-09-15' };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, purchases: [purchase]
  }), /período cerrado/);
  const sale = { id: 'sale-1', companyId: 'company-1', invoiceDate: '2026-09-01' };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, sales: [sale]
  }), /período cerrado/);
  const openEntry = { ...entry, id: 'entry-open', date: '2026-10-01' };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, {
    ...prior, journalEntries: [openEntry]
  }));
});

test('SQLite permits closing an existing historical period without treating prior transactions as new', () => {
  const entry = sourceEntry();
  const prior = { ...emptyState([entry]), companies: [{ id: 'company-1', name: 'Empresa' }] };
  const next = { ...prior, companies: [{ id: 'company-1', name: 'Empresa', closedThroughDate: '2026-10-01' }] };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, next));
});


function vatDeclarationFixture(overrides = {}) {
  const voucher = {
    id: 'vat-1', companyId: 'company-1', voucherNumber: '20261000000001',
    date: '2026-10-03', period: '202610', fiscalDate: '2026-10-03',
    supplierRif: 'J-12345678-9', supplierName: 'Proveedor Uno',
    taxableBaseBs: 1000, vatAmountBs: 160, vatWithheldBs: 120,
    requiresFiscalCorrection: false
  };
  const declaration = {
    id: 'vat-decl-1', companyId: 'company-1', period: '202610',
    window: 'FIRST_HALF', startDate: '2026-10-01', endDate: '2026-10-15',
    zeroOperations: false, voucherIds: ['vat-1'],
    voucherSnapshots: [{
      voucherId: 'vat-1', voucherNumber: voucher.voucherNumber,
      supplierRif: voucher.supplierRif, supplierName: voucher.supplierName,
      fiscalDate: voucher.fiscalDate, dateBasis: 'FISCAL_EVENT',
      taxableBaseBs: 1000, vatAmountBs: 160, vatWithheldBs: 120,
      requiresFiscalCorrection: false
    }],
    totalTaxableBaseBs: 1000, totalVatAmountBs: 160, totalWithheldBs: 120,
    createdAt: '2026-10-16T10:00:00.000Z'
  };
  return {
    ...emptyState(),
    companies: [{ id: 'company-1', name: 'Empresa Uno' }],
    vatVouchers: [voucher],
    vatWithholdingDeclarations: [declaration],
    vatWithholdingDeclarationEvents: [],
    ...overrides
  };
}


function vatOwnPositionFixture(overrides = {}) {
  return {
    outputVatBs: 100, outputVat16Bs: 100, outputVat8Bs: 0,
    purchaseCreditBs: 0, purchaseCredit16Bs: 0, purchaseCredit8Bs: 0,
    purchaseCreditGrossBs: 0, purchaseCreditGross16Bs: 0, purchaseCreditGross8Bs: 0,
    purchaseCreditNonEligibleBs: 0, purchaseCreditReversalBs: 0,
    purchaseCreditReversal16Bs: 0, purchaseCreditReversal8Bs: 0,
    purchaseCreditReversalNonEligibleBs: 0, purchaseCreditReversalNonEligible16Bs: 0,
    purchaseCreditReversalNonEligible8Bs: 0, prorationRate: 1,
    taxableSalesBaseBs: 625, exemptSalesBaseBs: 0, receivedWithholdingsBs: 0,
    priorCreditAppliedBs: 0, debitAdjustmentsBs: 0, creditAdjustmentsBs: 0,
    creditAdjustments16Bs: 0, creditAdjustments8Bs: 0, netTaxBs: 100,
    amountDueBs: 100, creditCarryForwardBs: 0, ...overrides
  };
}

function vatOwnDeclarationFixture(overrides = {}) {
  const declaration = {
    id: 'vat-own-1', companyId: 'company-1', period: '2026-11',
    status: 'DRAFT', position: vatOwnPositionFixture(),
    sourceIds: [], relatedSourceIds: [], sourceSnapshots: {}, bcvRate: 874,
    dailySourceChoices: {}, purchaseVatReclassificationItems: [],
    createdAt: '2026-11-11T10:00:00.000Z'
  };
  return {
    ...emptyState(),
    accounts: [
      { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', isMovement: true },
      { code: '2.1.2.01', name: 'IVA débito', type: 'PASIVO', isMovement: true },
      { code: '2.1.2.09', name: 'IVA por enterar', type: 'PASIVO', isMovement: true }
    ],
    companies: [{ id: 'company-1', name: 'Empresa Uno', bcvRate: 874, accountingBcvRateHistory: [
      { id: 'bcv-oct', rate: 874, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'bcv-nov', rate: 874, effectiveDate: '2026-11-01', recordedAt: '2026-11-01T08:00:00.000Z' }
    ] }],
    vatOwnDeclarations: [declaration],
    vatOwnDeclarationEvents: [],
    ...overrides
  };
}

function vatOwnFilingEntry() {
  return {
    id: 'entry-iva-filed', companyId: 'company-1', entryNumber: 1,
    date: '2026-11-11', description: 'Determinación mensual del IVA · 2026-10',
    type: 'AJUSTE', bcvRate: 874, referenceDoc: 'IVA-MENSUAL:2026-10',
    items: [
      { accountCode: '2.1.2.01', accountName: 'IVA débito', debitBs: 100, creditBs: 0, debitUsd: 100 / 874, creditUsd: 0 },
      { accountCode: '2.1.2.09', accountName: 'IVA por enterar', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 100 / 874 }
    ],
    createdAt: '2026-11-11T16:00:00.000Z'
  };
}

function vatOwnFiledState() {
  const base = vatOwnDeclarationFixture();
  const journal = vatOwnFilingEntry();
  const declaration = {
    ...base.vatOwnDeclarations[0], period: '2026-10', status: 'FILED',
    declarationNumber: 'IVA-2026-001', filedAt: '2026-11-11T12:00:00.000-04:00'
  };
  const event = {
    id: 'vat-own-event-filed', declarationId: declaration.id, companyId: declaration.companyId,
    eventType: 'FILED', occurredAt: declaration.filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
    declarationNumber: declaration.declarationNumber, idempotencyKey: 'FILED:' + declaration.id,
    journalEntryId: journal.id
  };
  return {
    ...base, vatOwnDeclarations: [declaration],
    vatOwnDeclarationEvents: [event], journalEntries: [journal]
  };
}

test('SQLite rechecks fiscal source snapshots at the exact moment an IVA draft is filed', () => {
  const purchase = {
    id: 'purchase-iva-source', companyId: 'company-1', invoiceDate: '2026-10-05',
    accountCreditDate: null, documentType: '01', invoiceNumber: 'FC-IVA-001', controlNumber: 'CTRL-IVA-001',
    supplierRif: 'J-12345678-9', supplierName: 'Proveedor Uno',
    totalAmountBs: 1160, totalAmountUsd: 1.33, taxableBaseBs: 1000, taxableBaseUsd: 1.14,
    exemptAmountBs: 0, exemptAmountUsd: 0, taxRate: 16, vatAmountBs: 160, vatAmountUsd: 0.18,
    additionalLuxuryTaxBs: 0, additionalLuxuryTaxUsd: 0, igtfApplicable: false, igtfRate: 0,
    igtfAmountBs: 0, igtfAmountUsd: 0, vatCreditTreatment: 'TAXABLE',
    vatWithheldBs: 0, vatWithheldUsd: 0, retentionRate: 0, voucherNumber: null,
    bcvRate: 874, journalEntryId: null, originalPurchaseId: null,
    affectedInvoiceNumber: null, affectedInvoiceDate: null, affectedInvoiceControlNumber: null,
    isCancelled: false
  };
  const snapshot = JSON.stringify({
    kind: 'PURCHASE', id: purchase.id, invoiceDate: purchase.invoiceDate,
    accountCreditDate: null, documentType: purchase.documentType, invoiceNumber: purchase.invoiceNumber,
    controlNumber: purchase.controlNumber, supplierRif: purchase.supplierRif, supplierName: purchase.supplierName,
    totalAmountBs: purchase.totalAmountBs, totalAmountUsd: purchase.totalAmountUsd,
    taxableBaseBs: purchase.taxableBaseBs, taxableBaseUsd: purchase.taxableBaseUsd,
    exemptAmountBs: purchase.exemptAmountBs, exemptAmountUsd: 0,
    taxRate: purchase.taxRate, vatAmountBs: purchase.vatAmountBs, vatAmountUsd: purchase.vatAmountUsd,
    additionalLuxuryTaxBs: 0, additionalLuxuryTaxUsd: 0, igtfApplicable: false, igtfRate: 0,
    igtfAmountBs: 0, igtfAmountUsd: 0, vatCreditTreatment: 'TAXABLE',
    vatWithheldBs: 0, vatWithheldUsd: 0, retentionRate: 0, voucherNumber: null,
    bcvRate: 874, journalEntryId: null, originalPurchaseId: null,
    affectedInvoiceNumber: null, affectedInvoiceDate: null, affectedInvoiceControlNumber: null,
    isCancelled: false, journal: null
  });
  const draft = {
    ...vatOwnDeclarationFixture(),
    purchases: [purchase],
    vatOwnDeclarations: [{
      ...vatOwnDeclarationFixture().vatOwnDeclarations[0],
      period: '2026-10', sourceIds: [purchase.id], sourceSnapshots: { [purchase.id]: snapshot }
    }]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), draft));
  const filedDeclaration = {
    ...draft.vatOwnDeclarations[0], status: 'FILED',
    declarationNumber: 'IVA-2026-STALE', filedAt: '2026-11-11T12:00:00.000-04:00'
  };
  const filingEntry = vatOwnFilingEntry();
  const filingEvent = {
    id: 'vat-own-event-stale-snapshot', declarationId: filedDeclaration.id,
    companyId: filedDeclaration.companyId, eventType: 'FILED',
    occurredAt: filedDeclaration.filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
    declarationNumber: filedDeclaration.declarationNumber,
    idempotencyKey: 'FILED:' + filedDeclaration.id, journalEntryId: filingEntry.id
  };
  assert.throws(() => validateAccountingSnapshot(draft, {
    ...draft,
    purchases: [{ ...purchase, vatAmountBs: 150 }],
    vatOwnDeclarations: [filedDeclaration],
    vatOwnDeclarationEvents: [filingEvent],
    journalEntries: [filingEntry]
  }), /huellas fiscales del borrador ya no coinciden/);
});

test('SQLite accepts a new IVA own-account draft with exact fiscal source snapshots', () => {
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), vatOwnDeclarationFixture()));
});

test('SQLite blocks deletion, direct filing and unversioned edits of IVA own-account drafts', () => {
  const prior = vatOwnDeclarationFixture();
  assert.throws(() => validateAccountingSnapshot(prior, { ...prior, vatOwnDeclarations: [] }), /eliminación de una declaración IVA/);
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...prior, vatOwnDeclarations: [{ ...prior.vatOwnDeclarations[0], status: 'FILED', declarationNumber: 'X', filedAt: '2026-11-11T12:00:00.000-04:00' }]
  }), /insertar directamente una declaración IVA/);
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, vatOwnDeclarations: [{ ...prior.vatOwnDeclarations[0], position: vatOwnPositionFixture({ outputVatBs: 90, outputVat16Bs: 90, amountDueBs: 90, netTaxBs: 90 }) }]
  }), /no conserva una versión íntegra/);
});

test('SQLite accepts a versioned IVA own-account draft refresh and blocks mutation after filing', () => {
  const prior = vatOwnDeclarationFixture();
  const old = prior.vatOwnDeclarations[0];
  const revision = {
    revision: 1, revisedAt: '2026-11-11T11:00:00.000Z',
    reason: 'Actualización por conciliación de documentos',
    position: { ...old.position }, sourceIds: [...old.sourceIds],
    relatedSourceIds: [...old.relatedSourceIds], bcvRate: old.bcvRate,
    dailySourceChoices: { ...old.dailySourceChoices },
    purchaseVatReclassificationItems: [], sourceSnapshots: {}, createdAt: old.createdAt
  };
  const updated = {
    ...old, position: vatOwnPositionFixture({ outputVatBs: 120, outputVat16Bs: 120, netTaxBs: 120, amountDueBs: 120 }),
    updatedAt: '2026-11-11T11:00:00.000Z', revisions: [revision]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, {
    ...prior, vatOwnDeclarations: [updated]
  }));
  const filed = vatOwnFiledState();
  assert.throws(() => validateAccountingSnapshot(filed, {
    ...filed, vatOwnDeclarations: [{ ...filed.vatOwnDeclarations[0], declarationNumber: 'ALTERADA' }]
  }), /declaración IVA ya presentada/);
});

test('SQLite blocks filing a current-month IVA return before the month has ended', () => {
  const prior = vatOwnDeclarationFixture();
  const declaration = {
    ...prior.vatOwnDeclarations[0], status: 'FILED',
    declarationNumber: 'IVA-NOV-EARLY', filedAt: '2026-11-11T12:00:00.000-04:00'
  };
  const event = {
    id: 'vat-own-event-early', declarationId: declaration.id, companyId: declaration.companyId,
    eventType: 'FILED', occurredAt: declaration.filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
    declarationNumber: declaration.declarationNumber, idempotencyKey: 'FILED:' + declaration.id
  };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, vatOwnDeclarations: [declaration], vatOwnDeclarationEvents: [event]
  }), /antes de finalizar el período fiscal mensual/);
});

test('SQLite preserves legacy filed IVA declarations without new source fingerprints but requires them on new filing', () => {
  const legacyFiled = vatOwnFiledState();
  delete legacyFiled.vatOwnDeclarations[0].sourceSnapshots;
  assert.doesNotThrow(() => validateAccountingSnapshot(legacyFiled, legacyFiled));
  const draft = vatOwnDeclarationFixture();
  const declaration = {
    ...draft.vatOwnDeclarations[0], status: 'FILED',
    declarationNumber: 'IVA-LEGACY-TRY', filedAt: '2026-11-11T12:00:00.000-04:00'
  };
  delete declaration.sourceSnapshots;
  assert.throws(() => validateAccountingSnapshot(draft, {
    ...draft, vatOwnDeclarations: [declaration],
    vatOwnDeclarationEvents: [{
      id: 'vat-own-event-no-snapshot', declarationId: declaration.id, companyId: declaration.companyId,
      eventType: 'FILED', occurredAt: declaration.filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
      declarationNumber: declaration.declarationNumber, idempotencyKey: 'FILED:' + declaration.id
    }]
  }), /huellas documentales fiscales antes de presentar/);
});

test('SQLite requires the filed IVA own-account declaration to have exactly one matching filing event and determination entry', () => {
  const filed = vatOwnFiledState();
  const priorDraft = vatOwnDeclarationFixture();
  priorDraft.vatOwnDeclarations[0].period = '2026-10';
  assert.doesNotThrow(() => validateAccountingSnapshot(priorDraft, filed));
  assert.throws(() => validateAccountingSnapshot(priorDraft, {
    ...filed, vatOwnDeclarationEvents: []
  }), /no coincide con su evento de presentación/);
  assert.throws(() => validateAccountingSnapshot(priorDraft, {
    ...filed, vatOwnDeclarationEvents: [{
      ...filed.vatOwnDeclarationEvents[0], declarationNumber: 'OTRO-NÚMERO'
    }]
  }), /número, fecha o asiento de determinación coincidente/);
});

test('SQLite enforces prior-period continuity and blocks a later filing before an earlier active month', () => {
  const sale = {
    id: 'sale-october', companyId: 'company-1', invoiceDate: '2026-10-15',
    documentType: '01', invoiceNumber: 'F-001', isCancelled: false
  };
  const base = {
    ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa Uno', bcvRate: 874, accountingBcvRateHistory: [
      { id: 'bcv-oct', rate: 874, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'bcv-nov', rate: 874, effectiveDate: '2026-11-01', recordedAt: '2026-11-01T08:00:00.000Z' }
    ] }], sales: [sale]
  };
  const novemberDraft = {
    ...vatOwnDeclarationFixture().vatOwnDeclarations[0], id: 'vat-own-2026-11', period: '2026-11'
  };
  assert.throws(() => validateAccountingSnapshot(base, {
    ...base, vatOwnDeclarations: [novemberDraft], vatOwnDeclarationEvents: []
  }), /períodos anteriores con actividad fiscal sin presentar/);

  const zeroPosition = vatOwnPositionFixture({
    outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0,
    netTaxBs: 0, amountDueBs: 0, creditCarryForwardBs: 0
  });
  const octoberFiled = {
    id: 'vat-own-2026-10', companyId: 'company-1', period: '2026-10',
    status: 'FILED', position: zeroPosition, sourceIds: [], relatedSourceIds: [],
    sourceSnapshots: {}, bcvRate: 874, dailySourceChoices: {},
    declarationNumber: 'IVA-OCT-001', filedAt: '2026-11-01T12:00:00.000-04:00',
    createdAt: '2026-10-31T10:00:00.000Z'
  };
  const octoberEvent = {
    id: 'vat-own-event-october', declarationId: octoberFiled.id, companyId: 'company-1',
    eventType: 'FILED', occurredAt: octoberFiled.filedAt, recordedAt: '2026-11-01T16:00:00.000Z',
    declarationNumber: octoberFiled.declarationNumber, idempotencyKey: 'FILED:' + octoberFiled.id
  };
  const prior = {
    ...base, vatOwnDeclarations: [octoberFiled],
    vatOwnDeclarationEvents: [octoberEvent]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(prior, {
    ...prior, vatOwnDeclarations: [octoberFiled, novemberDraft]
  }));
  const decemberDraft = {
    ...vatOwnDeclarationFixture().vatOwnDeclarations[0], id: 'vat-own-2026-12', period: '2026-12'
  };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior, vatOwnDeclarations: [octoberFiled, decemberDraft]
  }), /períodos anteriores con actividad fiscal sin presentar/);

  const novemberFiled = {
    ...novemberDraft, id: 'vat-own-2026-10-later', period: '2026-10',
    position: zeroPosition, status: 'FILED', declarationNumber: 'IVA-OCT-LATER',
    filedAt: '2026-11-11T12:00:00.000-04:00'
  };
  const novemberEvent = {
    id: 'vat-own-event-november', declarationId: novemberFiled.id, companyId: 'company-1',
    eventType: 'FILED', occurredAt: novemberFiled.filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
    declarationNumber: novemberFiled.declarationNumber, idempotencyKey: 'FILED:' + novemberFiled.id
  };
  const laterFiledPrior = {
    ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa Uno', bcvRate: 874, accountingBcvRateHistory: [
      { id: 'bcv-oct', rate: 874, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'bcv-nov', rate: 874, effectiveDate: '2026-11-01', recordedAt: '2026-11-01T08:00:00.000Z' }
    ] }], vatOwnDeclarations: [novemberFiled], vatOwnDeclarationEvents: [novemberEvent]
  };
  const octoberDraft = {
    ...vatOwnDeclarationFixture().vatOwnDeclarations[0], id: 'vat-own-2026-09', period: '2026-09'
  };
  assert.throws(() => validateAccountingSnapshot(laterFiledPrior, {
    ...laterFiledPrior, vatOwnDeclarations: [novemberFiled, octoberDraft]
  }), /período posterior presentado/);
});

test('SQLite validates partial IVA payments, prevents overpayment and protects their event history', () => {
  const filed = vatOwnFiledState();
  const paymentJournal = {
    id: 'entry-iva-payment', companyId: 'company-1', entryNumber: 2,
    date: '2026-11-11', description: 'Pago IVA mensual', type: 'AJUSTE',
    bcvRate: 874, referenceDoc: 'IVA-PAGO:vat-own-1:TRX-001',
    items: [
      { accountCode: '2.1.2.09', debitBs: 50, creditBs: 0, debitUsd: 50 / 874, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 50 / 874 }
    ], createdAt: '2026-11-11T17:00:00.000Z'
  };
  const payment = {
    id: 'vat-own-event-payment', declarationId: 'vat-own-1', companyId: 'company-1',
    eventType: 'PAYMENT', occurredAt: '2026-11-11T13:00:00.000-04:00',
    recordedAt: '2026-11-11T17:00:00.000Z', amountBs: 50, reference: 'TRX-001',
    idempotencyKey: 'PAYMENT:vat-own-1:TRX-001', journalEntryId: paymentJournal.id,
    treasuryAccountCode: '1.1.1.01', bcvRate: 874
  };
  const withPayment = {
    ...filed, journalEntries: [...filed.journalEntries, paymentJournal],
    vatOwnDeclarationEvents: [...filed.vatOwnDeclarationEvents, payment]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(filed, withPayment));
  assert.throws(() => validateAccountingSnapshot(filed, {
    ...withPayment,
    vatOwnDeclarationEvents: [...withPayment.vatOwnDeclarationEvents, {
      ...payment, id: 'vat-own-event-overpay', idempotencyKey: 'PAYMENT:OVER',
      reference: 'TRX-002', amountBs: 60
    }]
  }), /saldo disponible/);
  assert.throws(() => validateAccountingSnapshot(withPayment, {
    ...withPayment,
    vatOwnDeclarationEvents: withPayment.vatOwnDeclarationEvents.filter(item => item.id !== payment.id)
  }), /eliminación del registro histórico en vatOwnDeclarationEvents/);
});

test('SQLite accepts one linked IVA payment reversal and rejects duplicate or unrelated reversals', () => {
  const filed = vatOwnFiledState();
  const paymentJournal = {
    id: 'entry-iva-payment', companyId: 'company-1', entryNumber: 2,
    date: '2026-11-11', description: 'Pago IVA mensual', type: 'AJUSTE',
    bcvRate: 874, referenceDoc: 'IVA-PAGO:vat-own-1:TRX-001',
    items: [
      { accountCode: '2.1.2.09', debitBs: 50, creditBs: 0, debitUsd: 50 / 874, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 50 / 874 }
    ], createdAt: '2026-11-11T17:00:00.000Z'
  };
  const payment = {
    id: 'vat-own-event-payment', declarationId: 'vat-own-1', companyId: 'company-1',
    eventType: 'PAYMENT', occurredAt: '2026-11-11T13:00:00.000-04:00',
    recordedAt: '2026-11-11T17:00:00.000Z', amountBs: 50, reference: 'TRX-001',
    idempotencyKey: 'PAYMENT:vat-own-1:TRX-001', journalEntryId: paymentJournal.id,
    treasuryAccountCode: '1.1.1.01', bcvRate: 874
  };
  const paid = {
    ...filed, journalEntries: [...filed.journalEntries, paymentJournal],
    vatOwnDeclarationEvents: [...filed.vatOwnDeclarationEvents, payment]
  };
  const reversalJournal = {
    id: 'entry-iva-reversal', companyId: 'company-1', entryNumber: 3,
    date: '2026-11-11', description: 'Reversión de pago IVA', type: 'AJUSTE',
    bcvRate: 874, referenceDoc: 'REV-2', reversalOfEntryId: paymentJournal.id,
    reversalReason: 'Reversión de pago por referencia incorrecta', workpaperNote: 'Soporte bancario revisado y conciliado',
    items: [
      { accountCode: '2.1.2.09', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 50 / 874 },
      { accountCode: '1.1.1.01', debitBs: 50, creditBs: 0, debitUsd: 50 / 874, creditUsd: 0 }
    ], createdAt: '2026-11-11T18:00:00.000Z'
  };
  const reversal = {
    id: 'vat-own-event-reversal', declarationId: 'vat-own-1', companyId: 'company-1',
    eventType: 'REVERSAL', occurredAt: '2026-11-11T14:00:00.000-04:00',
    recordedAt: '2026-11-11T18:00:00.000Z', idempotencyKey: 'REVERSAL:vat-own-event-payment',
    reversalOfEventId: payment.id, journalEntryId: reversalJournal.id,
    note: 'Reversión por referencia bancaria incorrecta'
  };
  const reversed = {
    ...paid, journalEntries: [...paid.journalEntries.map(item => item.id === paymentJournal.id ? { ...item, reversedByEntryId: reversalJournal.id, isAdjusted: true } : item), reversalJournal],
    vatOwnDeclarationEvents: [...paid.vatOwnDeclarationEvents, reversal]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(paid, reversed));
  assert.throws(() => validateAccountingSnapshot(paid, {
    ...reversed,
    vatOwnDeclarationEvents: [...reversed.vatOwnDeclarationEvents, {
      ...reversal, id: 'vat-own-event-reversal-2', idempotencyKey: 'REVERSAL:duplicate',
      journalEntryId: reversalJournal.id
    }]
  }), /reversión de un pago IVA/);
});

test('SQLite accepts an immutable VAT withholding declaration snapshot with exact voucher totals', () => {
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), vatDeclarationFixture()));
});

test('SQLite blocks a zero-operation declaration when a withholding voucher exists in the selected window', () => {
  const state = vatDeclarationFixture();
  const zeroDeclaration = {
    ...state.vatWithholdingDeclarations[0],
    id: 'vat-decl-zero',
    zeroOperations: true,
    voucherIds: [],
    voucherSnapshots: [],
    totalTaxableBaseBs: 0,
    totalVatAmountBs: 0,
    totalWithheldBs: 0
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state, vatWithholdingDeclarations: [zeroDeclaration]
  }), /no incluye exactamente todos los comprobantes/);
});

test('SQLite rejects a VAT declaration with a duplicate period window or duplicate voucher allocation', () => {
  const state = vatDeclarationFixture();
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarations: [
      ...state.vatWithholdingDeclarations,
      { ...state.vatWithholdingDeclarations[0], id: 'vat-decl-2' }
    ]
  }), /misma empresa y quincena/);
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarations: [
      state.vatWithholdingDeclarations[0],
      { ...state.vatWithholdingDeclarations[0], id: 'vat-decl-2', window: 'SECOND_HALF',
        startDate: '2026-10-16', endDate: '2026-10-31' }
    ]
  }), /fuera de la quincena|snapshot fiscal|snapshot no incluye exactamente/);
});

test('SQLite rejects VAT declaration snapshots whose voucher, period or totals do not reconcile', () => {
  const state = vatDeclarationFixture();
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarations: [{ ...state.vatWithholdingDeclarations[0], totalWithheldBs: 999 }]
  }), /no concilian/);
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarations: [{ ...state.vatWithholdingDeclarations[0],
      voucherSnapshots: [{ ...state.vatWithholdingDeclarations[0].voucherSnapshots[0], fiscalDate: '2026-10-20' }]
    }]
  }), /fuera de la quincena/);
});

test('SQLite blocks review if new vouchers appear in the declaration half-month after its snapshot was prepared', () => {
  const prior = vatDeclarationFixture();
  const lateVoucher = {
    ...prior.vatVouchers[0],
    id: 'vat-late-2', voucherNumber: '20261000000002',
    date: '2026-10-10', fiscalDate: '2026-10-10',
    taxableBaseBs: 500, vatAmountBs: 80, vatWithheldBs: 60
  };
  const reviewed = {
    id: 'vat-review-late', declarationId: 'vat-decl-1', eventType: 'REVIEWED',
    occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(prior, {
    ...prior,
    vatVouchers: [...prior.vatVouchers, lateVoucher],
    vatWithholdingDeclarationEvents: [reviewed]
  }), /correcciones pendientes, fechas históricas no verificadas o una transición inválida/);
  assert.throws(() => validateAccountingSnapshot({
    ...prior, vatWithholdingDeclarationEvents: [reviewed]
  }, {
    ...prior,
    vatVouchers: [...prior.vatVouchers, lateVoucher],
    vatWithholdingDeclarationEvents: [reviewed, {
      id: 'vat-file-late', declarationId: 'vat-decl-1', eventType: 'FILED',
      occurredAt: '2026-10-17', recordedAt: '2026-10-17T10:00:00.000Z',
      declarationNumber: 'DECL-LATE', receiptReference: 'ACK-LATE'
    }]
  }), /presentación/);
});

test('SQLite enforces review, filing receipt and supported payment event order for VAT declarations', () => {
  const state = vatDeclarationFixture();
  const declaration = state.vatWithholdingDeclarations[0];
  const reviewed = { id: 'vat-event-1', declarationId: declaration.id, eventType: 'REVIEWED',
    occurredAt: '2026-10-16', recordedAt: '2026-10-16T11:00:00.000Z' };
  const filed = { id: 'vat-event-2', declarationId: declaration.id, eventType: 'FILED',
    occurredAt: '2026-10-17', recordedAt: '2026-10-17T11:00:00.000Z',
    declarationNumber: 'DECL-001', receiptReference: 'ACUSE-001' };
  const payment = { id: 'vat-event-3', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-18', recordedAt: '2026-10-18T11:00:00.000Z',
    amountBs: 120, paymentReference: 'TRX-001', bankStatementMovementIds: ['vat-bank-1'] };
  const paymentBankSupport = {
    bankAccounts: [{ id: 'vat-bank-account', companyId: declaration.companyId, currency: 'BS' }],
    bankStatementMovements: [{
      id: 'vat-bank-1', companyId: declaration.companyId, bankAccountId: 'vat-bank-account',
      date: '2026-10-18', type: 'DEBIT', amountBs: 120
    }]
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state, vatWithholdingDeclarationEvents: [filed]
  }), /presentación/);
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state, vatWithholdingDeclarationEvents: [reviewed, payment]
  }), /enteramiento/);
  // A bank debit alone is not sufficient: every new IVA payment must be
  // atomically linked to its RETENCION_IVA journal and reconciled movement.
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state, ...paymentBankSupport, vatWithholdingDeclarationEvents: [reviewed, filed, payment]
  }), /asiento contable IVA correspondiente/);
});

test('SQLite blocks review of VAT declarations with pending fiscal corrections or unacknowledged legacy dates', () => {
  const corrected = vatDeclarationFixture();
  corrected.vatVouchers[0].requiresFiscalCorrection = true;
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...corrected,
    vatWithholdingDeclarationEvents: [{
      id: 'vat-review', declarationId: 'vat-decl-1', eventType: 'REVIEWED',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z'
    }]
  }), /correcciones pendientes/);

  const legacy = vatDeclarationFixture();
  legacy.vatVouchers[0].fiscalDate = undefined;
  legacy.vatVouchers[0].date = '2026-10-03';
  legacy.vatWithholdingDeclarations[0].legacyDateAssignments = [{
    voucherId: 'vat-1', confirmedFiscalDate: '2026-10-03',
    note: 'Se verificó el soporte bancario del pago efectivo.'
  }];
  legacy.vatWithholdingDeclarations[0].voucherSnapshots[0].dateBasis = 'MANUALLY_VERIFIED_LEGACY_DATE';
  legacy.vatWithholdingDeclarations[0].voucherSnapshots[0].dateVerificationNote =
    'Se verificó el soporte bancario del pago efectivo.';
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), legacy));
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), {
    ...legacy,
    vatWithholdingDeclarationEvents: [{
      id: 'vat-review', declarationId: 'vat-decl-1', eventType: 'REVIEWED',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z'
    }]
  }));
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...legacy,
    vatWithholdingDeclarations: [{
      ...legacy.vatWithholdingDeclarations[0], legacyDateAssignments: []
    }]
  }), /sin fecha fiscal confirmada/);
});

test('SQLite rejects conflicting legacy fiscal-date assignments between the two half-month declarations', () => {
  const first = vatDeclarationFixture();
  first.vatVouchers[0].fiscalDate = undefined;
  first.vatVouchers[0].date = '2026-10-03';
  first.vatWithholdingDeclarations[0].legacyDateAssignments = [{
    voucherId: 'vat-1', confirmedFiscalDate: '2026-10-03',
    note: 'Se verificó el soporte bancario del pago efectivo.'
  }];
  first.vatWithholdingDeclarations[0].voucherSnapshots[0].dateBasis = 'MANUALLY_VERIFIED_LEGACY_DATE';
  first.vatWithholdingDeclarations[0].voucherSnapshots[0].dateVerificationNote =
    'Se verificó el soporte bancario del pago efectivo.';
  const contradictory = {
    id: 'vat-decl-second-half', companyId: 'company-1', period: '202610',
    window: 'SECOND_HALF', startDate: '2026-10-16', endDate: '2026-10-31',
    zeroOperations: true, voucherIds: [], voucherSnapshots: [],
    legacyDateAssignments: [{
      voucherId: 'vat-1', confirmedFiscalDate: '2026-10-20',
      note: 'Se verificó un soporte distinto para asignar la misma retención.'
    }],
    totalTaxableBaseBs: 0, totalVatAmountBs: 0, totalWithheldBs: 0,
    createdAt: '2026-11-01T10:00:00.000Z'
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...first,
    vatWithholdingDeclarations: [...first.vatWithholdingDeclarations, contradictory]
  }), /fechas fiscales legacy contradictorias/);
});

test('SQLite requires a verifiable fiscal source for recorded declaration due dates', () => {
  const state = vatDeclarationFixture();
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarationEvents: [{
      id: 'vat-due', declarationId: 'vat-decl-1', eventType: 'DUE_DATE_SET',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z',
      dueDate: '2026-10-20', officialSourceTitle: 'Calendario',
      officialReference: 'Publicación', officialSourceUrl: 'https://example.com/calendar'
    }]
  }), /fuente fiscal identificada/);
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarationEvents: [{
      id: 'vat-due', declarationId: 'vat-decl-1', eventType: 'DUE_DATE_SET',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z',
      dueDate: '2026-10-20', officialSourceTitle: 'Calendario oficial SENIAT',
      officialReference: 'Publicación oficial', officialSourceUrl: 'https://www.seniat.gob.ve/calendario'
    }]
  }));
});


test('SQLite validates one-time VAT voucher delivery date and electronic consent', () => {
  const base = vatDeclarationFixture();
  const physical = {
    ...base.vatVouchers[0],
    deliveryDate: '2026-10-04',
    deliveryMethod: 'PHYSICAL'
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), {
    ...base, vatVouchers: [physical]
  }));

  const electronicWithoutConsent = {
    ...base.vatVouchers[0],
    deliveryDate: '2026-10-04',
    deliveryMethod: 'ELECTRONIC'
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...base, vatVouchers: [electronicWithoutConsent]
  }), /entrega del comprobante IVA/);

  const electronicWithConsent = {
    ...base.vatVouchers[0],
    deliveryDate: '2026-10-04',
    deliveryMethod: 'ELECTRONIC',
    electronicDeliveryAgreed: true
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), {
    ...base, vatVouchers: [electronicWithConsent]
  }));

  const beforeIssue = {
    ...base.vatVouchers[0],
    deliveryDate: '2026-10-02',
    deliveryMethod: 'PHYSICAL'
  };
  assert.throws(() => validateAccountingSnapshot(emptyState(), {
    ...base, vatVouchers: [beforeIssue]
  }), /entrega del comprobante IVA/);

  const deliveredState = { ...base, vatVouchers: [physical] };
  const changedDelivery = { ...physical, deliveryDate: '2026-10-05' };
  assert.throws(() => validateAccountingSnapshot(deliveredState, {
    ...base, vatVouchers: [changedDelivery]
  }), /marca histórica deliveryDate/);
});


test('SQLite accepts a dated SENIAT calendar source preserved as a Gaceta Oficial copy', () => {
  const state = vatDeclarationFixture();
  assert.doesNotThrow(() => validateAccountingSnapshot(emptyState(), {
    ...state,
    vatWithholdingDeclarationEvents: [{
      id: 'vat-due-gazette', declarationId: 'vat-decl-1', eventType: 'DUE_DATE_SET',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z',
      dueDate: '2026-11-10',
      officialSourceTitle: 'Gaceta Oficial N.º 43.273',
      officialReference: 'Providencia SNAT/2025/000091',
      officialSourceUrl: 'https://iusdata.com/wp-content/uploads/2025/12/1-SENIAT-GO-43.273-2025-DIC-09.pdf'
    }]
  }));
});


test('SQLite accepts a supplier debit note only as an independent, balanced, linked type-02 payable', () => {
  const accounts = [
    { code: '2.1.1.01', name: 'Cuentas por pagar proveedores', type: 'PASIVO', isMovement: true },
    { code: '6.1.1.01', name: 'Gastos operativos', type: 'GASTOS', isMovement: true },
    { code: '1.1.3.01', name: 'IVA crédito fiscal', type: 'ACTIVO', isMovement: true },
    { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', isMovement: true }
  ];
  const company = { id: 'company-1', name: 'Empresa de prueba', closedThroughDate: null };
  const original = {
    id: 'purchase-1', companyId: 'company-1', opNumber: 1,
    invoiceDate: '2026-10-01', accountCreditDate: '2026-10-01',
    supplierRif: 'J-12345678-9', supplierName: 'Proveedor Original C.A.',
    invoiceNumber: 'FAC-100', controlNumber: 'CTRL-100', documentType: '01',
    totalAmountBs: 1160, taxableBaseBs: 1000, exemptAmountBs: 0, taxRate: 16,
    vatAmountBs: 160, retentionRate: 0, vatWithheldBs: 0,
    bcvRate: 100, totalAmountUsd: 11.6, taxableBaseUsd: 10, vatAmountUsd: 1.6,
    vatWithheldUsd: 0, paymentTerm: 'CREDITO', journalEntryId: 'source-entry'
  };
  const originalJournal = {
    id: 'source-entry', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-01', description: 'Factura de compra FAC-100',
    type: 'COMPRA', bcvRate: 100, referenceDoc: 'FAC-FAC-100',
    items: [
      { accountCode: '1.1.4.01', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0 },
      { accountCode: '1.1.3.01', debitBs: 160, creditBs: 0, debitUsd: 1.6, creditUsd: 0 },
      { accountCode: '2.1.1.01', debitBs: 0, creditBs: 1160, debitUsd: 0, creditUsd: 11.6 }
    ],
    createdAt: '2026-10-01T10:00:00.000Z'
  };
  const note = {
    id: 'debit-note-1', companyId: 'company-1', opNumber: 2,
    invoiceDate: '2026-10-10', accountCreditDate: '2026-10-10',
    supplierRif: original.supplierRif, supplierName: original.supplierName,
    invoiceNumber: 'ND-001', debitNoteNumber: 'ND-001', controlNumber: 'CTRL-ND-001',
    affectedInvoiceNumber: original.invoiceNumber, affectedInvoiceDate: original.invoiceDate,
    affectedInvoiceControlNumber: original.controlNumber,
    affectedInvoiceTotalAmountBs: original.totalAmountBs, affectedInvoiceTotalAmountUsd: original.totalAmountUsd,
    fiscalEmissionMedium: 'DIGITAL', sameMediumAsOriginal: true, documentType: '02',
    originalPurchaseId: original.id,
    totalAmountBs: 29, taxableBaseBs: 25, exemptAmountBs: 0, taxRate: 16,
    vatAmountBs: 4, retentionRate: 0, vatWithheldBs: 0,
    bcvRate: 100, totalAmountUsd: 0.29, taxableBaseUsd: 0.25,
    vatAmountUsd: 0.04, vatWithheldUsd: 0,
    paymentTerm: 'CREDITO', journalEntryId: 'nd-entry',
    supplierDebitNoteReview: {
      economicCause: 'ADDITIONAL_EXPENSE',
      reason: 'Gasto adicional documentado por proveedor.',
      debitAccountCode: '6.1.1.01', payableAccountCode: '2.1.1.01',
      vatAccountCode: '1.1.3.01', vatBreakdownReviewed: true,
      withholdingNotApplicableConfirmed: true, igtfNotApplicableConfirmed: true,
      fiscalReviewNote: 'Revisión profesional documentada.'
    },
    notes: 'Gasto adicional documentado · Revisión fiscal manual: desglose confirmado · Sin retenciones ni IGTF: confirmado.'
  };
  const noteJournal = {
    id: 'nd-entry', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'Nota de débito proveedor ND-001',
    type: 'AJUSTE', bcvRate: 100, referenceDoc: 'ND-PROV-ND-001',
    items: [
      { accountCode: '6.1.1.01', debitBs: 25, creditBs: 0, debitUsd: 0.25, creditUsd: 0 },
      { accountCode: '1.1.3.01', debitBs: 4, creditBs: 0, debitUsd: 0.04, creditUsd: 0 },
      { accountCode: '2.1.1.01', debitBs: 0, creditBs: 29, debitUsd: 0, creditUsd: 0.29 }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const unrelatedDebitNoteMovement = {
    id: 'unrelated-nd-movement', companyId: 'company-1',
    documentRef: 'ND-PROV-ND-OTHER', documentType: 'Nota de débito',
    type: 'ENTRADA', quantity: 1
  };
  const previous = {
    ...emptyState([originalJournal]),
    purchases: [original], accounts, companies: [company],
    movements: [unrelatedDebitNoteMovement]
  };
  const next = {
    ...emptyState([originalJournal, noteJournal]),
    purchases: [original, note], accounts, companies: [company],
    movements: [unrelatedDebitNoteMovement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));

  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, purchases: [original, { ...note, journalEntryId: undefined }]
  }), /ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, purchases: [original, { ...note, affectedInvoiceNumber: 'FAC-999' }]
  }), /ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, purchases: [original, { ...note, vatWithheldBs: 2 }]
  }), /ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, purchases: [original, { ...note, supplierDebitNoteReview: undefined }]
  }), /ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, journalEntries: [originalJournal, { ...noteJournal, items: [
      ...noteJournal.items.slice(0, 2),
      { ...noteJournal.items[2], creditBs: 28 }
    ] }]
  }), /ND tipo 02|no cuadra simultáneamente/);
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, movements: [unrelatedDebitNoteMovement, {
      id: 'fake-nd-movement', companyId: 'company-1', documentRef: 'ND-PROV-ND-001',
      type: 'ENTRADA', quantity: 1
    }]
  }), /ND tipo 02/);
  const cancelledNote = {
    ...note, isCancelled: true, cancelledByJournalEntryId: 'nd-reversal-entry',
    cancellationReason: 'Se comprobó un error documental.',
    cancellationNote: 'Papel de trabajo conserva comparación y soporte.'
  };
  const reversedSourceJournal = {
    ...noteJournal, reversedByEntryId: 'nd-reversal-entry', isAdjusted: true
  };
  const reversalJournal = {
    id: 'nd-reversal-entry', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-11', description: 'Reversión ND-001',
    type: 'AJUSTE', bcvRate: 100, referenceDoc: 'REV-2',
    reversalOfEntryId: 'nd-entry', reversalReason: 'Se comprobó un error documental.',
    workpaperNote: 'Papel de trabajo conserva comparación y soporte.',
    priorPeriodAdjustment: false,
    items: [
      { accountCode: '6.1.1.01', debitBs: 0, creditBs: 25, debitUsd: 0, creditUsd: 0.25 },
      { accountCode: '1.1.3.01', debitBs: 0, creditBs: 4, debitUsd: 0, creditUsd: 0.04 },
      { accountCode: '2.1.1.01', debitBs: 29, creditBs: 0, debitUsd: 0.29, creditUsd: 0 }
    ],
    createdAt: '2026-10-11T10:00:00.000Z'
  };
  const cancellation = {
    ...next,
    purchases: [original, cancelledNote],
    journalEntries: [originalJournal, reversedSourceJournal, reversalJournal]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(next, cancellation));
  assert.throws(() => validateAccountingSnapshot(next, {
    ...cancellation,
    creditSettlements: [{
      id: 'active-payment', companyId: 'company-1', documentId: note.id,
      kind: 'PURCHASE_PAYMENT', isReversed: false
    }]
  }), /anulación de ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(next, {
    ...cancellation,
    supplierAdvanceSettlements: [{
      id: 'active-advance-application', companyId: 'company-1',
      targetPurchaseId: note.id, kind: 'APPLIED_TO_PURCHASE', isReversed: false
    }]
  }), /anulación de ND tipo 02/);
  assert.throws(() => validateAccountingSnapshot(next, {
    ...cancellation,
    journalEntries: [originalJournal, reversedSourceJournal, {
      ...reversalJournal,
      items: reversalJournal.items.map(item => item.accountCode === '2.1.1.01'
        ? { ...item, debitBs: 28 } : item)
    }]
  }), /anulación de ND tipo 02|no cuadra simultáneamente/);
  assert.throws(() => validateAccountingSnapshot(next, {
    ...cancellation,
    purchases: [original, { ...cancelledNote, cancellationNote: '' }]
  }), /anulación de ND tipo 02|papel de trabajo/);
});


test('SQLite accepts applying a supplier direct advance to a separate type-02 debit-note payable', () => {
  const { prior: basePrior } = supplierCreditFixture();
  const original = basePrior.purchases[0];
  const originalEntry = basePrior.journalEntries.find(entry => entry.id === original.journalEntryId);
  const accounts = [
    { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true },
    { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', isMovement: true },
    { code: '6.1.1.01', name: 'Gastos', type: 'GASTOS', isMovement: true }
  ];
  const debitNote = {
    id: 'debit-note-advance-target', companyId: 'company-1', opNumber: 2,
    invoiceDate: '2026-10-10', accountCreditDate: '2026-10-10',
    supplierRif: original.supplierRif, supplierName: original.supplierName,
    invoiceNumber: 'ND-ADV-1', debitNoteNumber: 'ND-ADV-1', controlNumber: 'CTRL-ND-ADV-1',
    affectedInvoiceNumber: original.invoiceNumber, documentType: '02',
    originalPurchaseId: original.id,
    totalAmountBs: 100, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 0,
    vatAmountBs: 0, retentionRate: 0, vatWithheldBs: 0,
    bcvRate: 100, totalAmountUsd: 1, taxableBaseUsd: 1, vatAmountUsd: 0, vatWithheldUsd: 0,
    paymentTerm: 'CREDITO', journalEntryId: 'nd-advance-target-journal',
    notes: 'Diferencia de precio documentada · Revisión fiscal manual: verificada · Sin retenciones ni IGTF: confirmado.'
  };
  const debitNoteJournal = {
    id: 'nd-advance-target-journal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'ND proveedor ND-ADV-1',
    type: 'AJUSTE', bcvRate: 100, referenceDoc: 'ND-PROV-ND-ADV-1',
    items: [
      { accountCode: '6.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '2.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1, description: 'Nueva obligación por ND proveedor ND-ADV-1' }
    ],
    createdAt: '2026-10-10T10:00:00.000Z'
  };
  const directJournal = {
    id: 'nd-target-direct-advance-journal', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-10', description: 'Anticipo directo', type: 'ANTICIPO_PROVEEDOR',
    bcvRate: 100, referenceDoc: 'DIRECT-ND-1',
    items: [
      { accountCode: '1.1.2.03', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-10T11:00:00.000Z'
  };
  const applicationJournal = {
    id: 'nd-target-advance-application-journal', companyId: 'company-1', entryNumber: 4,
    date: '2026-10-11', description: 'Aplicación anticipo a ND proveedor',
    type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: debitNote.invoiceNumber,
    items: [
      { accountCode: '2.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.2.03', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const directAdvance = {
    id: 'nd-target-direct-advance', companyId: 'company-1',
    supplierRif: original.supplierRif, supplierName: original.supplierName,
    date: '2026-10-10', amountUsd: 1, bookValueBs: 100, bcvRate: 100,
    treasuryAccountCode: '1.1.1.01', paymentCurrency: 'BS', paidAmount: 100,
    reference: 'DIRECT-ND-1', support: 'REC-DIRECT-ND-1',
    journalEntryId: directJournal.id, createdAt: '2026-10-10T11:00:00.000Z'
  };
  const settlement = {
    id: 'nd-target-advance-application', companyId: 'company-1',
    supplierRif: original.supplierRif, supplierName: original.supplierName,
    sourceCreditNoteIds: [], sourceCreditNoteAllocations: [],
    sourceDirectAdvanceIds: [directAdvance.id],
    sourceDirectAdvanceAllocations: [{ directAdvanceId: directAdvance.id, amountUsd: 1, bookValueBs: 100 }],
    kind: 'APPLIED_TO_PURCHASE', date: '2026-10-11',
    amountUsd: 1, amountBs: 100, advanceBookValueBs: 100, bcvRate: 100,
    targetPurchaseId: debitNote.id, journalEntryId: applicationJournal.id,
    reference: 'APPLY-ND-1', createdAt: '2026-10-11T10:00:00.000Z'
  };
  const previous = {
    ...basePrior,
    purchases: [...basePrior.purchases, debitNote],
    journalEntries: [...basePrior.journalEntries, debitNoteJournal],
    accounts,
    supplierDirectAdvances: [],
    supplierAdvanceSettlements: []
  };
  const next = {
    ...previous,
    journalEntries: [...previous.journalEntries, directJournal, applicationJournal],
    supplierDirectAdvances: [directAdvance],
    supplierAdvanceSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
});


test('SQLite accepts and constrains a cash payment against the ND own payable and exchange difference', () => {
  const { prior: basePrior } = supplierCreditFixture();
  const original = basePrior.purchases[0];
  const debitNote = {
    id: 'nd-payment-target', companyId: 'company-1', opNumber: 2,
    invoiceDate: '2026-10-10', accountCreditDate: '2026-10-10',
    supplierRif: original.supplierRif, supplierName: original.supplierName,
    invoiceNumber: 'ND-PAY-1', debitNoteNumber: 'ND-PAY-1', controlNumber: 'CTRL-ND-PAY-1',
    affectedInvoiceNumber: original.invoiceNumber, documentType: '02',
    originalPurchaseId: original.id,
    totalAmountBs: 100, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 0,
    vatAmountBs: 0, retentionRate: 0, vatWithheldBs: 0,
    bcvRate: 100, totalAmountUsd: 1, taxableBaseUsd: 1, vatAmountUsd: 0, vatWithheldUsd: 0,
    paymentTerm: 'CREDITO', journalEntryId: 'nd-payment-source-journal',
    notes: 'Diferencia de precio documentada · Revisión fiscal manual: verificada · Sin retenciones ni IGTF: confirmado.'
  };
  const ndSourceJournal = {
    id: 'nd-payment-source-journal', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-10', description: 'ND proveedor ND-PAY-1',
    type: 'AJUSTE', bcvRate: 100, referenceDoc: 'ND-PROV-ND-PAY-1',
    items: [
      { accountCode: '6.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '2.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const paymentJournal = {
    id: 'nd-payment-settlement-journal', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-11', description: 'Pago ND-PAY-1', type: 'AJUSTE',
    bcvRate: 110, referenceDoc: 'ND-PAY-1',
    items: [
      { accountCode: '2.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '1.1.1.01', debitBs: 0, creditBs: 110, debitUsd: 0, creditUsd: 1 },
      { accountCode: '6.1.1.08', debitBs: 10, creditBs: 0, debitUsd: 0, creditUsd: 0 }
    ], createdAt: '2026-10-11T10:00:00.000Z'
  };
  const settlement = {
    id: 'nd-payment-settlement', companyId: 'company-1',
    documentId: debitNote.id, kind: 'PURCHASE_PAYMENT',
    settlementDate: '2026-10-11', bcvRate: 110,
    amountUsd: 1, amountBs: 110, method: 'CASH_BS',
    journalEntryId: paymentJournal.id, createdAt: '2026-10-11T10:00:00.000Z'
  };
  const accounts = [
    { code: '2.1.1.01', name: 'Cuentas por pagar proveedores', type: 'PASIVO', isMovement: true },
    { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true },
    { code: '6.1.1.01', name: 'Gastos operativos', type: 'GASTOS', isMovement: true },
    { code: '6.1.1.08', name: 'Pérdida cambiaria', type: 'GASTOS', isMovement: true }
  ];
  const previous = {
    ...basePrior,
    purchases: [...basePrior.purchases, debitNote],
    journalEntries: [...basePrior.journalEntries, ndSourceJournal],
    accounts
  };
  const next = {
    ...previous,
    journalEntries: [...previous.journalEntries, paymentJournal],
    creditSettlements: [settlement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next,
    journalEntries: [...previous.journalEntries, {
      ...paymentJournal,
      items: paymentJournal.items.map(line => line.accountCode === '2.1.1.01'
        ? { ...line, accountCode: '2.1.1.99' } : line)
    }]
  }), /pago de una factura.*ND de proveedor/);
});


test('SQLite compares supplier payable applications at USD cent precision', () => {
  const netPayable = 1270.0729927007299 - 131.38686131386862 - 21.8978102189781;
  const roundedPayment = 1116.79;
  assert.equal(exceedsUsdPayable(roundedPayment, netPayable), false);
  assert.equal(exceedsUsdPayable(1116.80, netPayable), true);
});

test('SQLite accepts a sales credit note only when linked merchandise was fully returned with dual-currency cost entries', () => {
  const originalInvoice = {
    id: 'sale-invoice-journal', companyId: 'company-1', entryNumber: 1,
    date: '2026-10-01', description: 'Factura de venta F-100', type: 'VENTA', bcvRate: 100,
    referenceDoc: 'FAC-F-100',
    items: [
      { accountCode: '1.1.2.01', debitBs: 116, creditBs: 0, debitUsd: 1.16, creditUsd: 0 },
      { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 },
      { accountCode: '2.1.2.01', debitBs: 0, creditBs: 16, debitUsd: 0, creditUsd: 0.16 }
    ], createdAt: '2026-10-01T10:00:00.000Z'
  };
  const source = {
    id: 'sale-original', companyId: 'company-1', opNumber: 1,
    invoiceDate: '2026-10-01', customerRif: 'J-12345678-9', customerName: 'Cliente',
    invoiceNumber: 'F-100', controlNumber: 'CTRL-100', documentType: '01',
    totalAmountBs: 116, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 16, vatAmountBs: 16,
    vatWithheldBs: 0, bcvRate: 100, totalAmountUsd: 1.16, taxableBaseUsd: 1,
    vatAmountUsd: 0.16, vatWithheldUsd: 0, paymentTerm: 'CREDITO',
    journalEntryId: originalInvoice.id
  };
  const noteJournal = {
    id: 'sale-credit-journal', companyId: 'company-1', entryNumber: 4,
    date: '2026-10-10', description: 'NC de venta NC-100', type: 'AJUSTE', bcvRate: 100,
    referenceDoc: 'NC-CLI-NC-100',
    items: [
      { accountCode: '4.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '2.1.2.01', debitBs: 16, creditBs: 0, debitUsd: 0.16, creditUsd: 0 },
      { accountCode: '1.1.2.01', debitBs: 0, creditBs: 116, debitUsd: 0, creditUsd: 1.16 }
    ], createdAt: '2026-10-10T10:00:00.000Z'
  };
  const note = {
    ...source, id: 'sale-credit-note', opNumber: 2, invoiceDate: '2026-10-10',
    invoiceNumber: 'NC-100', controlNumber: 'CTRL-NC-100', documentType: '03',
    creditNoteNumber: 'NC-100', originalSaleId: source.id, affectedInvoiceNumber: source.invoiceNumber,
    affectedInvoiceDate: source.invoiceDate, affectedInvoiceControlNumber: source.controlNumber,
    affectedInvoiceTotalAmountBs: source.totalAmountBs, affectedInvoiceTotalAmountUsd: source.totalAmountUsd,
    fiscalEmissionMedium: 'DIGITAL', sameMediumAsOriginal: true,
    taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 16, vatAmountBs: 16, totalAmountBs: 116,
    bcvRate: 100, taxableBaseUsd: 1, exemptAmountUsd: 0, vatAmountUsd: 0.16, totalAmountUsd: 1.16,
    netReceivableAdjustmentBs: 116, netReceivableAdjustmentUsd: 1.16,
    paymentTerm: 'CREDITO', journalEntryId: noteJournal.id,
    correctionReason: 'Devolución total de mercancía vendida.',
    correctionWorkpaper: 'Se verificó la devolución física total y su costo histórico.'
  };
  const originalCostJournal = {
    id: 'sale-cost-original', companyId: 'company-1', entryNumber: 2,
    date: '2026-10-01', description: 'Costo de venta original', type: 'INVENTARIO', bcvRate: 100,
    referenceDoc: 'FAC-F-100',
    items: [
      { accountCode: '5.1.1.01', debitBs: 50, creditBs: 0, debitUsd: 0.5, creditUsd: 0 },
      { accountCode: '1.1.4.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 0.5 }
    ], createdAt: '2026-10-01T10:01:00.000Z'
  };
  const returnCostJournal = {
    id: 'sale-cost-return', companyId: 'company-1', entryNumber: 3,
    date: '2026-10-10', description: 'Costo de devolución cliente', type: 'INVENTARIO', bcvRate: 100,
    referenceDoc: 'DEV-CLIENTE-100',
    items: [
      { accountCode: '1.1.4.01', debitBs: 50, creditBs: 0, debitUsd: 0.5, creditUsd: 0 },
      { accountCode: '5.1.1.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 0.5 }
    ], createdAt: '2026-10-10T10:01:00.000Z'
  };
  const originalMovement = {
    id: 'sale-stock-out', companyId: 'company-1', productId: 'product-1',
    productCode: 'P-1', date: '2026-10-01', type: 'SALIDA', concept: 'VENTA',
    documentRef: 'FAC-F-100', journalEntryId: originalCostJournal.id,
    quantity: 1, unitCostBs: 50, unitCostUsd: 0.5, totalCostBs: 50, totalCostUsd: 0.5,
    bcvRate: 100, balanceQty: 0
  };
  const returnMovement = {
    ...originalMovement, id: 'sale-stock-return', date: '2026-10-10',
    type: 'ENTRADA', concept: 'DEVOLUCION_CLIENTE', documentRef: 'DEV-CLIENTE-100',
    journalEntryId: returnCostJournal.id, correctionForMovementId: originalMovement.id,
    balanceQty: 1
  };
  const product = {
    id: 'product-1', companyId: 'company-1', code: 'P-1', name: 'Artículo',
    currentStock: 1, inventoryAccountCode: '1.1.4.01', costOfSalesAccountCode: '5.1.1.01'
  };
  const accounts = [
    { code: '1.1.2.01', name: 'Cuentas por cobrar', type: 'ACTIVO', isMovement: true },
    { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', isMovement: true },
    { code: '2.1.2.01', name: 'IVA débito fiscal', type: 'PASIVO', isMovement: true },
    { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', isMovement: true },
    { code: '5.1.1.01', name: 'Costo de ventas', type: 'COSTOS', isMovement: true }
  ];
  const previous = {
    ...emptyState([originalInvoice, originalCostJournal]), sales: [source],
    movements: [originalMovement], products: [product], accounts,
    companies: [{ id: 'company-1', name: 'Empresa de prueba' }]
  };
  const next = {
    ...previous, sales: [source, note],
    journalEntries: [...previous.journalEntries, returnCostJournal, noteJournal],
    movements: [originalMovement, returnMovement]
  };
  assert.doesNotThrow(() => validateAccountingSnapshot(previous, next));
  assert.throws(() => validateAccountingSnapshot(previous, {
    ...next, movements: [originalMovement]
  }), /documento, factura original, saldo fiscal, soporte o asiento correctivo/);
});
