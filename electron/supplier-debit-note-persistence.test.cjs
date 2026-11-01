const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { registerAccountingPersistenceHandler } = require('./accounting-persistence.cjs');

function createHarness() {
  const db = new Database(':memory:');
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
  `);
  const handlers = new Map();
  registerAccountingPersistenceHandler({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db,
    licenseView: () => ({ authorized: true, message: '' }),
    getActiveSession: token => token === 'valid-session'
      ? { id: 1, username: 'e2e-test', role: 'admin' }
      : null
  });
  return { db, save: handlers.get('sicoven:save-state') };
}

const accounts = [
  { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', isMovement: true },
  { code: '1.1.3.01', name: 'IVA crédito fiscal', type: 'ACTIVO', isMovement: true },
  { code: '2.1.1.01', name: 'Cuentas por pagar proveedores', type: 'PASIVO', isMovement: true },
  { code: '6.1.1.01', name: 'Gastos operativos', type: 'GASTOS', isMovement: true }
];

const sourcePurchase = {
  id: 'purchase-source-001',
  companyId: 'company-nd-e2e',
  opNumber: 1,
  invoiceDate: '2026-10-01',
  accountCreditDate: '2026-10-01',
  supplierRif: 'J-12345678-9',
  supplierName: 'Proveedor de prueba controlada',
  invoiceNumber: 'FAC-100',
  controlNumber: 'CTRL-100',
  documentType: '01',
  totalAmountBs: 116,
  taxableBaseBs: 100,
  exemptAmountBs: 0,
  taxRate: 16,
  vatAmountBs: 16,
  retentionRate: 0,
  vatWithheldBs: 0,
  islrWithheldBs: 0,
  igtfAmountBs: 0,
  bcvRate: 100,
  totalAmountUsd: 1.16,
  taxableBaseUsd: 1,
  vatAmountUsd: 0.16,
  vatWithheldUsd: 0,
  islrWithheldUsd: 0,
  igtfAmountUsd: 0,
  paymentTerm: 'CREDITO',
  journalEntryId: 'journal-source-001'
};

const sourceJournal = {
  id: 'journal-source-001',
  companyId: 'company-nd-e2e',
  entryNumber: 1,
  date: '2026-10-01',
  description: 'Factura original de proveedor',
  type: 'COMPRA',
  bcvRate: 100,
  referenceDoc: 'FAC-FAC-100',
  items: [
    { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
    { accountCode: '1.1.3.01', accountName: 'IVA crédito fiscal', debitBs: 16, creditBs: 0, debitUsd: 0.16, creditUsd: 0 },
    { accountCode: '2.1.1.01', accountName: 'CxP proveedor', debitBs: 0, creditBs: 116, debitUsd: 0, creditUsd: 1.16 }
  ],
  createdAt: '2026-10-01T10:00:00.000Z'
};

const baseState = () => ({
  companies: [{ id: 'company-nd-e2e', name: 'Empresa de prueba controlada' }],
  currentCompanyId: 'company-nd-e2e',
  accounts,
  journalEntries: [sourceJournal],
  purchases: [sourcePurchase],
  sales: [],
  products: [],
  movements: [],
  vatVouchers: [],
  islrVouchers: [],
  bankAccounts: [],
  bankStatementMovements: [],
  creditSettlements: [],
  supplierAdvanceSettlements: [],
  displayCurrency: 'DUAL'
});

test('ND tipo 02: flujo de dominio llega a SQLite por IPC y sobrevive a la lectura del snapshot', async () => {
  const { buildSupplierDebitNoteAccountingPlan } = await import('../src/types/supplierDebitNoteAccounting.ts');
  const harness = createHarness();
  try {
    const originalState = baseState();
    assert.equal(harness.save({}, 'valid-session', originalState).ok, true);

    const plan = buildSupplierDebitNoteAccountingPlan({
      draft: {
        companyId: 'company-nd-e2e',
        sourcePurchaseId: sourcePurchase.id,
        debitNoteNumber: 'ND-001',
        controlNumber: 'CTRL-ND-001',
        affectedInvoiceNumber: 'FAC-100',
        issueDate: '2026-10-10',
        recognitionDate: '2026-10-10',
        economicCause: 'ADDITIONAL_EXPENSE',
        reason: 'Gasto adicional documentado por proveedor.',
        debitAccountCode: '6.1.1.01',
        payableAccountCode: '2.1.1.01',
        vatAccountCode: '1.1.3.01',
        taxableBaseBs: 25,
        exemptAmountBs: 0,
        vatAmountBs: 4,
        totalAmountBs: 29,
        taxRate: 16,
        bcvRate: 100,
        fiscalBreakdownReviewed: true,
        withholdingNotApplicableConfirmed: true,
        igtfNotApplicableConfirmed: true,
        fiscalReviewNote: 'Revisión documental y fiscal realizada por el responsable.'
      },
      purchases: [sourcePurchase],
      accounts,
      sourceJournalEntry: sourceJournal
    });

    const debitNote = {
      ...plan.document,
      id: 'purchase-debit-note-001',
      companyId: 'company-nd-e2e',
      opNumber: 2,
      journalEntryId: 'journal-debit-note-001'
    };
    const debitNoteJournal = {
      id: 'journal-debit-note-001',
      companyId: 'company-nd-e2e',
      entryNumber: 2,
      date: '2026-10-10',
      description: 'Nota de débito proveedor ND-001 afecta factura FAC-100',
      type: 'AJUSTE',
      bcvRate: 100,
      referenceDoc: 'ND-PROV-ND-001',
      items: plan.items,
      createdAt: '2026-10-10T10:00:00.000Z'
    };

    const nextState = {
      ...originalState,
      journalEntries: [...originalState.journalEntries, debitNoteJournal],
      purchases: [...originalState.purchases, debitNote]
    };
    assert.equal(harness.save({}, 'valid-session', nextState).ok, true);

    const row = harness.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    assert.ok(row);
    const restored = JSON.parse(row.state_json);
    const restoredNote = restored.purchases.find(item => item.id === debitNote.id);
    const restoredJournal = restored.journalEntries.find(item => item.id === debitNoteJournal.id);
    const restoredSource = restored.purchases.find(item => item.id === sourcePurchase.id);

    assert.equal(restoredNote.documentType, '02');
    assert.equal(restoredNote.originalPurchaseId, sourcePurchase.id);
    assert.equal(restoredNote.affectedInvoiceNumber, sourcePurchase.invoiceNumber);
    assert.equal(restoredNote.paymentTerm, 'CREDITO');
    assert.equal(restoredNote.totalAmountBs, 29);
    assert.equal(restoredNote.totalAmountUsd, 0.29);
    assert.equal(restoredJournal.type, 'AJUSTE');
    assert.equal(restoredJournal.referenceDoc, 'ND-PROV-ND-001');
    assert.equal(restoredJournal.items.reduce((sum, item) => sum + item.debitBs, 0), 29);
    assert.equal(restoredJournal.items.reduce((sum, item) => sum + item.creditBs, 0), 29);
    assert.equal(restoredJournal.items.reduce((sum, item) => sum + item.debitUsd, 0), 0.29);
    assert.equal(restoredJournal.items.reduce((sum, item) => sum + item.creditUsd, 0), 0.29);

    assert.equal(restoredSource.totalAmountBs, 116);
    assert.equal(restoredSource.journalEntryId, sourcePurchase.journalEntryId);
    assert.deepEqual(restored.movements, []);
    assert.deepEqual(restored.vatVouchers, []);
    assert.deepEqual(restored.islrVouchers, []);

    const auditTypes = harness.db.prepare('SELECT event_type FROM audit_events ORDER BY id')
      .all().map(item => item.event_type);
    assert.deepEqual(auditTypes, ['state_saved', 'journal_entry_posted', 'state_saved']);
  } finally {
    harness.db.close();
  }
});
