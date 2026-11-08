import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { allocateSupplierAdvanceFifo } from './supplierAdvanceSettlement';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractUniversalJsonCollections,
  classifyUniversalInvoiceRows,
  selectUniversalRowsByStableKeys,
  buildUniversalInvoiceIdentity,
  findUniversalInvoiceJournalCollision,
  mapUniversalSupplierDirectAdvanceDraft,
  mapUniversalSupplierAdvanceSettlementDraft
} from './universalImport';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { persistAccountingSnapshot } = require('../../electron/accounting-persistence.cjs');

const emptyState = () => ({
  companies: [
    { id: 'company-1', name: 'Empresa origen', rif: 'J-11111111-1' },
    { id: 'company-2', name: 'Empresa destino', rif: 'J-22222222-2' }
  ],
  currentCompanyId: 'company-1',
  accounts: [
    { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
    { code: '1.1.1.03', name: 'Banco Bs', type: 'ACTIVO', level: 4, isMovement: true },
    { code: '1.1.2.01', name: 'Cuentas por cobrar', type: 'ACTIVO', level: 4, isMovement: true },
    { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', level: 4, isMovement: true },
    { code: '4.2.1.01', name: 'Ganancia cambiaria', type: 'INGRESOS', level: 4, isMovement: true }
  ],
  journalEntries: [],
  purchases: [],
  sales: [],
  products: [],
  movements: [],
  vatVouchers: [],
  vatWithholdingDeclarations: [],
  vatWithholdingDeclarationEvents: [],
  islrVouchers: [],
  bankAccounts: [],
  bankStatementMovements: [],
  creditSettlements: [],
  supplierAdvanceSettlements: [],
  supplierDirectAdvances: [],
  islrFiscalEvents: [],
  financialDisclosures: [],
  displayCurrency: 'DUAL'
});

const journalEntry = (id: string, companyId: string, entryNumber: number, referenceDoc: string) => ({
  id,
  companyId,
  entryNumber,
  date: '2026-11-07',
  description: 'Importación de prueba ' + referenceDoc,
  type: 'MANUAL',
  bcvRate: 100,
  referenceDoc,
  items: [
    { accountCode: '1.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
    { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
  ],
  createdAt: '2026-11-07T10:00:00.000Z'
});

test('integración: análisis JSON, selección individual, empresa destino, duplicados y rollback SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sicoven-universal-import-'));
  const databasePath = join(directory, 'integration.sqlite');
  let db: any;
  try {
    db = new Database(databasePath);
    db.exec(`
      CREATE TABLE app_state (
        state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
        details_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    const initial: any = emptyState();
    initial.journalEntries.push(journalEntry('prior-company-1', 'company-1', 1, 'FAC-ANTERIOR'));
    assert.equal(persistAccountingSnapshot(db, initial, { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const sourceJson = {
      ventas: [
        { invoiceNumber: 'F-001', invoiceDate: '2026-11-06', totalAmountBs: 100, customerName: 'Cliente Uno', customerRif: 'J-33333333-3' },
        { invoiceNumber: 'F-002', invoiceDate: '2026-11-07', totalAmountBs: 100, customerName: 'Cliente Dos', customerRif: 'J-44444444-4' }
      ]
    };
    const collections = extractUniversalJsonCollections(sourceJson);
    assert.equal(collections.length, 1);
    const rows = collections.flatMap(collection => collection.rows.map((row, index) => ({
      ...row,
      migrationfile: 'origen.json',
      migrationcollection: collection.path,
      migrationrowid: 'origen.json|' + collection.path + '|' + index
    })));
    const classified = classifyUniversalInvoiceRows(rows);
    assert.equal(classified.sales.length, 2);
    const selected = selectUniversalRowsByStableKeys(classified.sales, ['origen.json|ventas|1']);
    assert.deepEqual(selected.map(row => row.invoiceNumber), ['F-002']);

    const selectedIdentity = buildUniversalInvoiceIdentity('sales', selected[0].invoiceNumber, selected[0].customerRif);
    const alreadyImported = new Set(initial.sales.map((row: any) => buildUniversalInvoiceIdentity('sales', row.invoiceNumber, row.customerRif)));
    assert.equal(alreadyImported.has(selectedIdentity), false);
    assert.equal(
      findUniversalInvoiceJournalCollision('F-002', initial.journalEntries, 'VENTA'),
      undefined
    );
    assert.ok(findUniversalInvoiceJournalCollision('ANTERIOR', initial.journalEntries, 'VENTA'));

    const sourceSaleEntry = {
      ...journalEntry('sale-source-company-2', 'company-2', 1, 'FAC-F-002'),
      date: '2026-11-06',
      type: 'VENTA',
      items: [
        { accountCode: '1.1.2.01', accountName: 'Cuentas por cobrar', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0, description: 'CxC factura F-002' },
        { accountCode: '4.1.1.01', accountName: 'Ingresos', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10, description: 'Venta F-002' }
      ]
    };
    const importedEntry = {
      ...journalEntry('settlement-journal-company-2', 'company-2', 2, 'F-002'),
      type: 'AJUSTE',
      items: [
        { accountCode: '1.1.1.03', accountName: 'Banco Bs', debitBs: 1100, creditBs: 0, debitUsd: 10, creditUsd: 0, description: 'Cobro por transferencia' },
        { accountCode: '1.1.2.01', accountName: 'Cuentas por cobrar', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10, description: 'Cancelación de CxC' },
        { accountCode: '4.2.1.01', accountName: 'Ganancia cambiaria', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 0, description: 'Ganancia cambiaria' }
      ]
    };
    const importedSale = {
      id: 'sale-company-2-1',
      companyId: 'company-2',
      documentType: '01',
      paymentTerm: 'CREDITO',
      paymentCurrency: 'BS',
      invoiceDate: '2026-11-06',
      invoiceNumber: 'F-002',
      controlNumber: 'CTRL-F-002',
      customerName: 'Cliente Dos',
      customerRif: 'J-44444444-4',
      totalAmountBs: 1000,
      taxableBaseBs: 1000,
      exemptAmountBs: 0,
      vatAmountBs: 0,
      vatWithheldBs: 0,
      igtfAmountBs: 0,
      totalAmountUsd: 10,
      taxableBaseUsd: 10,
      vatAmountUsd: 0,
      vatWithheldUsd: 0,
      igtfAmountUsd: 0,
      taxRate: 0,
      bcvRate: 100,
      journalEntryId: sourceSaleEntry.id,
      isCancelled: false
    };
    const importedSettlement = {
      id: 'settlement-company-2-1',
      companyId: 'company-2',
      documentId: importedSale.id,
      kind: 'SALE_COLLECTION',
      settlementDate: '2026-11-07',
      amountBs: 1100,
      amountUsd: 10,
      method: 'BANK_TRANSFER_BS',
      bankAccountId: 'bank-company-2-bs',
      reference: 'TRX-SETTLEMENT-001',
      bcvRate: 110,
      journalEntryId: importedEntry.id,
      isReversed: false
    };
    const imported = {
      ...initial,
      sales: [importedSale],
      bankAccounts: [{ id: 'bank-company-2-bs', companyId: 'company-2', accountCode: '1.1.1.03', currency: 'BS' }],
      journalEntries: [...initial.journalEntries, sourceSaleEntry, importedEntry],
      creditSettlements: [importedSettlement]
    };
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    const postedAudit = db.prepare("SELECT details_json FROM audit_events WHERE event_type='credit_settlement_posted'").all();
    assert.equal(postedAudit.length, 1, 'la liquidación debe generar una entrada de auditoría al persistirse');
    const postedDetails = JSON.parse(postedAudit[0].details_json);
    assert.deepEqual(
      [postedDetails.settlementId, postedDetails.companyId, postedDetails.documentId, postedDetails.kind,
        postedDetails.amountBs, postedDetails.amountUsd, postedDetails.reference, postedDetails.journalEntryId],
      [importedSettlement.id, 'company-2', importedSettlement.documentId, 'SALE_COLLECTION',
        1100, 10, 'TRX-SETTLEMENT-001', importedEntry.id]
    );
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='credit_settlement_posted'").get().n,
      1,
      'guardar nuevamente el mismo snapshot no debe duplicar el evento de auditoría de la liquidación'
    );

    db.close();
    db = new Database(databasePath, { readonly: true });
    const saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.currentCompanyId, 'company-1', 'la importación no debe cambiar la empresa activa');
    assert.deepEqual(saved.journalEntries.map((entry: any) => [entry.id, entry.companyId]), [
      ['prior-company-1', 'company-1'],
      ['sale-source-company-2', 'company-2'],
      ['settlement-journal-company-2', 'company-2']
    ]);
    assert.equal(saved.journalEntries.filter((entry: any) => entry.companyId === 'company-1').length, 1);
    assert.equal(saved.journalEntries.filter((entry: any) => entry.companyId === 'company-2').length, 2);
    assert.equal(saved.journalEntries.some((entry: any) => entry.referenceDoc === 'FAC-F-001'), false);

    db.close();
    db = new Database(databasePath);
    const beforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    db.exec(`CREATE TRIGGER reject_import_midway BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected end-to-end import failure'); END;`);
    const failedAttempt = {
      ...imported,
      journalEntries: [...imported.journalEntries, journalEntry('must-rollback', 'company-2', 3, 'FAC-F-003')]
    };
    assert.throws(
      () => persistAccountingSnapshot(db, failedAttempt, { id: 1, username: 'admin', role: 'admin' }),
      /injected end-to-end import failure/
    );
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeFailure);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, auditCount);
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('FIFO de anticipos: notas de crédito y desembolsos directos comparten una cola cronológica y conservan el valor histórico', () => {
  const notes = [
    { id: 'NC-OLDER', date: '2026-11-02', amountUsd: 10, bookValueBs: 900 },
    { id: 'NC-NEWER', date: '2026-11-05', amountUsd: 8, bookValueBs: 880 }
  ];
  const direct = [
    { id: 'ADV-OLDEST', date: '2026-11-01', amountUsd: 10, bookValueBs: 1200 },
    { id: 'ADV-NEWER', date: '2026-11-04', amountUsd: 5, bookValueBs: 650 }
  ];
  const allocation = allocateSupplierAdvanceFifo(notes, direct, [], 'company-2', 'J-22222222-2', 15);
  assert.deepEqual(allocation.directAdvanceAllocations, [
    { directAdvanceId: 'ADV-OLDEST', amountUsd: 10, bookValueBs: 1200 }
  ]);
  assert.deepEqual(allocation.creditNoteAllocations, [
    { creditNoteId: 'NC-OLDER', amountUsd: 5, bookValueBs: 450 }
  ]);

  const previouslyPosted = [{
    id: 'SET-001',
    companyId: 'company-2',
    supplierRif: 'J-22222222-2',
    supplierName: 'Proveedor',
    sourceCreditNoteIds: [],
    sourceDirectAdvanceIds: ['ADV-OLDEST'],
    sourceDirectAdvanceAllocations: [{ directAdvanceId: 'ADV-OLDEST', amountUsd: 4, bookValueBs: 480 }],
    kind: 'APPLIED_TO_PURCHASE' as const,
    date: '2026-11-03',
    amountUsd: 4,
    amountBs: 480,
    advanceBookValueBs: 480,
    bcvRate: 120,
    targetPurchaseId: 'PUR-001',
    journalEntryId: 'JE-001',
    createdAt: '2026-11-03T10:00:00.000Z'
  }];
  const afterPrevious = allocateSupplierAdvanceFifo(notes, direct, previouslyPosted, 'company-2', 'J-22222222-2', 7);
  assert.deepEqual(afterPrevious.directAdvanceAllocations, [
    { directAdvanceId: 'ADV-OLDEST', amountUsd: 6, bookValueBs: 720 }
  ]);
  // After the oldest direct disbursement is exhausted, the 2026-11-02
  // credit note precedes the newer 2026-11-04 direct advance in global FIFO.
  assert.deepEqual(afterPrevious.creditNoteAllocations, [
    { creditNoteId: 'NC-OLDER', amountUsd: 1, bookValueBs: 90 }
  ]);

  const reversedHistory = previouslyPosted.map(item => ({ ...item, isReversed: true }));
  const afterReversal = allocateSupplierAdvanceFifo(notes, direct, reversedHistory, 'company-2', 'J-22222222-2', 7);
  assert.deepEqual(afterReversal.directAdvanceAllocations, [
    { directAdvanceId: 'ADV-OLDEST', amountUsd: 7, bookValueBs: 840 }
  ]);
  assert.deepEqual(afterReversal.creditNoteAllocations, []);

  assert.throws(
    () => allocateSupplierAdvanceFifo(
      [{ ...notes[0], date: '2026-02-31' }], direct, [], 'company-2', 'J-22222222-2', 1
    ),
    /fecha o importes históricos inválidos/
  );
});


test('importador universal: mapea anticipos directos, reembolsos y aplicaciones solo con operación y soporte explícitos', () => {
  const directRow = {
    migrationrowid: 'origen.json|anticipos|1',
    migrationfile: 'origen.json',
    operationType: 'SUPPLIER_DIRECT_ADVANCE',
    supplierName: 'Proveedor Uno',
    supplierRif: 'J-22222222-2',
    date: '2026-11-01',
    amountUsd: 10,
    bcvRate: 100,
    treasuryAccountCode: '1.1.1.03',
    paymentCurrency: 'BS',
    paidAmount: 1000,
    reference: 'TRF-001',
    support: 'Comprobante-001'
  };
  const direct = mapUniversalSupplierDirectAdvanceDraft(directRow, [directRow]);
  assert.equal(direct.sourceRowId, directRow.migrationrowid);
  assert.deepEqual(direct.draft, {
    supplierRif: 'J-22222222-2',
    supplierName: 'Proveedor Uno',
    date: '2026-11-01',
    amountUsd: 10,
    bcvRate: 100,
    treasuryAccountCode: '1.1.1.03',
    paymentCurrency: 'BS',
    paidAmount: 1000,
    reference: 'TRF-001',
    support: 'Comprobante-001'
  });

  const refundRow = {
    migrationrowid: 'origen.json|anticipos|2',
    migrationfile: 'origen.json',
    transactionType: 'REFUND_RECEIVED',
    supplierName: 'Proveedor Uno',
    supplierRif: 'J-22222222-2',
    date: '2026-11-03',
    amountUsd: 4,
    amountBs: 420,
    bcvRate: 105,
    treasuryAccountCode: '1.1.1.03',
    cashReceivedBs: 420,
    reference: 'REF-001'
  };
  const refund = mapUniversalSupplierAdvanceSettlementDraft(refundRow, [refundRow]);
  assert.equal(refund.draft.kind, 'REFUND_RECEIVED');
  assert.equal(refund.draft.cashReceivedBs, 420);
  assert.equal(refund.draft.treasuryAccountCode, '1.1.1.03');

  const applicationRow = {
    migrationrowid: 'origen.json|anticipos|3',
    migrationfile: 'origen.json',
    transactionType: 'APPLIED_TO_PURCHASE',
    supplierName: 'Proveedor Uno',
    supplierRif: 'J-22222222-2',
    date: '2026-11-04',
    amountUsd: 3,
    amountBs: 315,
    bcvRate: 105
  };
  const application = mapUniversalSupplierAdvanceSettlementDraft(applicationRow, [applicationRow], 'purchase-created-in-batch');
  assert.equal(application.draft.kind, 'APPLIED_TO_PURCHASE');
  assert.equal(application.draft.targetPurchaseId, 'purchase-created-in-batch');
  assert.throws(() => mapUniversalSupplierAdvanceSettlementDraft(applicationRow, [applicationRow]));
  assert.throws(() => mapUniversalSupplierDirectAdvanceDraft({ ...directRow, operationType: 'PAYMENT' }, [directRow]));
});
