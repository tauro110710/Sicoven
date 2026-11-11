'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  initializeVatFiscalIncidentSchema, createVatFiscalIncident,
  recordVatFiscalIncidentEvent, getVatFiscalIncident,
  registerVatFiscalIncidentIpc
} = require('./vat-fiscal-incidents.cjs');

const actor = { id: 7, username: 'admin', role: 'admin' };
function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  `);
  const state = {
    companies: [{ id: 'co-1' }, { id: 'co-2' }],
    purchases: [
      { id: 'invoice-1', companyId: 'co-1', documentType: '01', invoiceNumber: 'FAC-100' },
      { id: 'credit-1', companyId: 'co-1', documentType: '03', creditNoteNumber: 'NC-9', affectedInvoiceNumber: 'FAC-100', originalPurchaseId: 'invoice-1' },
      { id: 'debit-1', companyId: 'co-1', documentType: '02', debitNoteNumber: 'ND-10', affectedInvoiceNumber: 'FAC-100', originalPurchaseId: 'invoice-1' },
      { id: 'debit-2', companyId: 'co-2', documentType: '02', debitNoteNumber: 'ND-2', affectedInvoiceNumber: 'FAC-200', originalPurchaseId: 'invoice-2' },
      { id: 'invoice-2', companyId: 'co-2', documentType: '01', invoiceNumber: 'FAC-200' }
    ],
    vatVouchers: [{ id: 'voucher-1', companyId: 'co-1', purchaseRecordId: 'invoice-1', correctionEntryIds: ['journal-1'] }],
    vatWithholdingDeclarations: [{ id: 'declaration-1', companyId: 'co-1', voucherIds: ['voucher-1'] }],
    vatWithholdingDeclarationEvents: [
      { id: 'filed-1', declarationId: 'declaration-1', eventType: 'FILED' },
      { id: 'payment-1', declarationId: 'declaration-1', eventType: 'PAYMENT', bankStatementMovementIds: ['bank-1'] },
      { id: 'payment-2', declarationId: 'declaration-1', eventType: 'PAYMENT', bankStatementMovementIds: ['bank-1'] }
    ],
    bankStatementMovements: [{ id: 'bank-1', companyId: 'co-1' }, { id: 'bank-2', companyId: 'co-2' }],
    journalEntries: [{ id: 'journal-1', companyId: 'co-1' }, { id: 'journal-unrelated', companyId: 'co-1' }]
  };
  db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)').run('accounting', JSON.stringify(state));
  initializeVatFiscalIncidentSchema(db);
  return { db, state };
}
function createInput(overrides = {}) {
  return {
    companyId: 'co-1', purchaseId: 'credit-1', vatVoucherId: 'voucher-1',
    declarationId: 'declaration-1', declarationEventIds: ['filed-1', 'payment-1'],
    bankMovementIds: ['bank-1'], reason: 'La nota de crédito afecta la retención de la factura original.',
    detectedAt: '2026-10-20', ...overrides
  };
}

test('creates a purchase credit-note incident linked to its original invoice, voucher, declaration and payment trail', () => {
  const { db } = fixture();
  const before = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
  const incident = createVatFiscalIncident(db, createInput(), actor);
  assert.equal(incident.status, 'OPEN');
  assert.equal(incident.resolved, false);
  assert.equal(incident.originalPurchaseId, 'invoice-1');
  assert.deepEqual(incident.declarationEventIds, ['filed-1', 'payment-1']);
  assert.deepEqual(incident.bankMovementIds, ['bank-1']);
  assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 1);
  db.close();
});

test('rejects cross-company documents, vouchers, declaration events and bank movements', () => {
  const { db } = fixture();
  assert.throws(() => createVatFiscalIncident(db, createInput({ companyId: 'co-2' }), actor), /documento fuente/);
  assert.throws(() => createVatFiscalIncident(db, createInput({ vatVoucherId: 'missing' }), actor), /comprobante IVA/);
  assert.throws(() => createVatFiscalIncident(db, createInput({ declarationEventIds: ['missing'] }), actor), /evento fiscal/);
  assert.throws(() => createVatFiscalIncident(db, createInput({ bankMovementIds: ['bank-2'] }), actor), /movimiento bancario/);
  db.close();
});

test('requires a declaration to contain the selected voucher and payment event to support bank movement', () => {
  const { db } = fixture();
  assert.throws(() => createVatFiscalIncident(db, createInput({ declarationId: null }), actor), /declaración vinculada/);
  assert.throws(() => createVatFiscalIncident(db, createInput({ declarationEventIds: ['filed-1'] }), actor), /solo pueden vincularse/);
  db.close();
});

test('rejects a note whose linked original invoice does not match its affected invoice number', () => {
  const { db, state } = fixture();
  const altered = { ...state, purchases: state.purchases.map(item =>
    item.id === 'credit-1' ? { ...item, affectedInvoiceNumber: 'FAC-999' } : item) };
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(altered));
  assert.throws(() => createVatFiscalIncident(db, createInput(), actor), /no coincide con el número/);
  db.close();
});

test('recovers the original invoice by affected number when the stored originalPurchaseId is stale', () => {
  const { db, state } = fixture();
  const altered = { ...state, purchases: state.purchases.map(item =>
    item.id === 'credit-1' ? { ...item, originalPurchaseId: 'deleted-invoice-id' } : item) };
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(altered));
  const incident = createVatFiscalIncident(db, createInput(), actor);
  assert.equal(incident.originalPurchaseId, 'invoice-1');
  assert.equal(incident.vatVoucherId, 'voucher-1');
  db.close();
});

test('prevents duplicate incident cases for the same company and source document', () => {
  const { db } = fixture();
  createVatFiscalIncident(db, createInput(), actor);
  assert.throws(() => createVatFiscalIncident(db, createInput(), actor), /UNIQUE constraint failed/);
  db.close();
});

test('prevents reusing the same voucher, declaration payment event or bank movement across incident dossiers', () => {
  {
    const { db } = fixture();
    createVatFiscalIncident(db, createInput({ declarationEventIds: [], bankMovementIds: [] }), actor);
    assert.throws(() => createVatFiscalIncident(db, createInput({
      purchaseId: 'debit-1', vatVoucherId: 'voucher-1', declarationId: null,
      declarationEventIds: [], bankMovementIds: []
    }), actor), /UNIQUE constraint failed/);
    db.close();
  }
  {
    const { db } = fixture();
    createVatFiscalIncident(db, createInput({ vatVoucherId: undefined, declarationEventIds: ['payment-1'], bankMovementIds: [] }), actor);
    assert.throws(() => createVatFiscalIncident(db, createInput({
      purchaseId: 'debit-1', vatVoucherId: undefined, declarationEventIds: ['payment-1'], bankMovementIds: []
    }), actor), /UNIQUE constraint failed/);
    db.close();
  }
  {
    const { db } = fixture();
    createVatFiscalIncident(db, createInput({ vatVoucherId: undefined, declarationEventIds: ['payment-1'], bankMovementIds: ['bank-1'] }), actor);
    assert.throws(() => createVatFiscalIncident(db, createInput({
      purchaseId: 'debit-1', vatVoucherId: undefined, declarationEventIds: ['payment-2'], bankMovementIds: ['bank-1']
    }), actor), /UNIQUE constraint failed/);
    db.close();
  }
});

test('records append-only review and action events without marking the incident resolved', () => {
  const { db } = fixture();
  const created = createVatFiscalIncident(db, createInput(), actor);
  const reviewed = recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'REVIEW_RECORDED',
    decisionText: 'Se revisó el soporte y se documentó que debe evaluarse el tratamiento en la declaración afectada.',
    declarationId: 'declaration-1', declarationEventIds: ['filed-1'], bankMovementIds: []
  }, actor);
  assert.equal(reviewed.status, 'REVIEW_DOCUMENTED');
  const acted = recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se registró la actuación del contador y se dejó constancia de la referencia externa pendiente de verificación.',
    declarationId: 'declaration-1', journalEntryId: 'journal-1',
    externalReference: 'EXP-EXT-2026-01'
  }, actor);
  assert.equal(acted.status, 'ACTION_DOCUMENTED');
  assert.equal(acted.resolved, false);
  assert.equal(acted.events.length, 3);
  assert.throws(() => db.prepare('UPDATE vat_fiscal_incidents SET reason=? WHERE id=?').run('alterado', created.id), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM vat_fiscal_incident_events WHERE incident_id=?').run(created.id), /append-only/);
  assert.equal(getVatFiscalIncident(db, created.id).events.length, 3);
  db.close();
});

test('rejects event attempts to attach another company journal or unlinked bank movement', () => {
  const { db } = fixture();
  const created = createVatFiscalIncident(db, createInput(), actor);
  recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'REVIEW_RECORDED',
    decisionText: 'Se revisó el expediente y se documentó la verificación previa de la evidencia fiscal.',
    declarationId: 'declaration-1'
  }, actor);
  assert.throws(() => recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se intenta vincular un asiento que no pertenece a la empresa del expediente.',
    declarationId: 'declaration-1', journalEntryId: 'missing-journal'
  }, actor), /asiento correctivo/);
  assert.throws(() => recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se intenta vincular un movimiento bancario no incluido en el pago del expediente.',
    declarationId: 'declaration-1', declarationEventIds: ['filed-1'], bankMovementIds: ['bank-1']
  }, actor), /solo pueden vincularse/);
  db.close();
});

test('rejects a same-company journal entry that is not linked to the original VAT voucher correction trail', () => {
  const { db } = fixture();
  const created = createVatFiscalIncident(db, createInput(), actor);
  recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'REVIEW_RECORDED',
    decisionText: 'Se revisó el expediente y se cotejó el comprobante con la declaración del período.',
    declarationId: 'declaration-1'
  }, actor);
  assert.throws(() => recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se intenta adjuntar un asiento de la empresa sin vínculo con el comprobante IVA original.',
    declarationId: 'declaration-1', journalEntryId: 'journal-unrelated'
  }, actor), /enlazado previamente al comprobante IVA original/);
  const valid = recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se adjunta el asiento correctivo previamente vinculado al comprobante IVA original.',
    declarationId: 'declaration-1', journalEntryId: 'journal-1'
  }, actor);
  assert.equal(valid.events.find(event => event.eventType === 'ACTION_RECORDED' && event.decisionText.startsWith('Se adjunta el asiento correctivo')).journalEntryId, 'journal-1');
  db.close();
});

test('does not allow adding a declaration to an incident created without one', () => {
  const { db } = fixture();
  const created = createVatFiscalIncident(db, createInput({
    vatVoucherId: undefined, declarationId: undefined,
    declarationEventIds: [], bankMovementIds: []
  }), actor);
  assert.equal(created.declarationId, null);
  assert.throws(() => recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'REVIEW_RECORDED',
    decisionText: 'Se intenta incorporar después una declaración que no fue vinculada al abrir el expediente.',
    declarationId: 'declaration-1'
  }, actor), /declaración del expediente es inmutable/);
  assert.equal(getVatFiscalIncident(db, created.id).events.length, 1);
  db.close();
});

test('requires a documented decision and permits either full-access role', () => {
  const { db } = fixture();
  assert.throws(() => createVatFiscalIncident(db, createInput({ reason: 'corto' }), actor), /Motivo/);
  assert.throws(() => createVatFiscalIncident(db, createInput(), { username: 'operator', role: 'user' }), /rol contable/);
  const accountant = createVatFiscalIncident(db, createInput({ documentNumber: 'FACT-002' }), { id: 8, username: 'contador', role: 'contador' });
  assert.ok(accountant.id);
  db.close();
});

test('allows the accountant to record an action directly without a separate review step', () => {
  const { db } = fixture();
  const created = createVatFiscalIncident(db, createInput(), actor);
  assert.equal(created.status, 'OPEN');
  const acted = recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'El contador registró directamente la actuación y su referencia externa para seguimiento.',
    declarationId: 'declaration-1', externalReference: 'EXT-REF-1'
  }, actor);
  assert.equal(acted.status, 'ACTION_DOCUMENTED');
  assert.equal(acted.events.some(event => event.eventType === 'REVIEW_RECORDED'), false);
  assert.equal(acted.resolved, false);
  assert.throws(() => recordVatFiscalIncidentEvent(db, {
    incidentId: created.id, eventType: 'ACTION_RECORDED',
    decisionText: 'Se registra una actuación sin documento ni asiento ni referencia externa verificable.',
    declarationId: 'declaration-1'
  }, actor), /requiere al menos una referencia externa/);
  db.close();
});


test('VAT fiscal incident IPC writes only to the authenticated tenant database', async () => {
  const control = fixture().db;
  const tenant = fixture().db;
  const handlers = new Map();
  registerVatFiscalIncidentIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: control,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'tenant-token' ? actor : null,
    withDatabase: async (token, operation) => {
      assert.equal(token, 'tenant-token');
      return operation(tenant, 'co-1');
    }
  });
  try {
    const created = await handlers.get('sicoven:vat-fiscal-incident-create')({}, 'tenant-token', createInput());
    assert.ok(created.id);
    assert.equal(tenant.prepare('SELECT COUNT(*) AS n FROM vat_fiscal_incidents').get().n, 1);
    assert.equal(control.prepare('SELECT COUNT(*) AS n FROM vat_fiscal_incidents').get().n, 0);
  } finally {
    control.close();
    tenant.close();
  }
});
