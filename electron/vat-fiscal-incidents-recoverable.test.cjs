'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  initializeOperationReceiptSchema
} = require('./operation-receipts.cjs');
const {
  initializeVatFiscalIncidentSchema,
  registerVatFiscalIncidentIpc
} = require('./vat-fiscal-incidents.cjs');

function setup() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  initializeOperationReceiptSchema(db);
  initializeVatFiscalIncidentSchema(db);
  const state = {
    companies: [{ id: 'company-1' }],
    purchases: [{ id: 'purchase-1', companyId: 'company-1', documentType: '01', invoiceNumber: 'F-001' }],
    vatVouchers: [], vatWithholdingDeclarations: [], vatWithholdingDeclarationEvents: [],
    bankStatementMovements: [], journalEntries: []
  };
  db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)").run(JSON.stringify(state));
  const handlers = new Map();
  const actor = { id: 7, username: 'contador', role: 'admin' };
  registerVatFiscalIncidentIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db,
    licenseView: () => ({ authorized: true }),
    getActiveSession: () => actor,
    withDatabase: (_token, callback) => callback(db, 'company-1')
  });
  return { db, handlers };
}

test('VAT fiscal incident creation returns the original result after a confirmed commit retry', () => {
  const { db, handlers } = setup();
  try {
    const handler = handlers.get('sicoven:vat-fiscal-incident-create');
    const input = {
      operationId: 'vat-incident-create-001',
      companyId: 'company-1',
      purchaseId: 'purchase-1',
      reason: 'Factura de proveedor requiere revisión tributaria',
      detectedAt: '2026-01-15'
    };
    const first = handler({}, 'session', input);
    const retry = handler({}, 'session', input);
    assert.equal(first.id, retry.id);
    assert.equal(retry.replayed, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vat_fiscal_incidents').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vat_fiscal_incident_events').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 1);
  } finally { db.close(); }
});

test('VAT fiscal incident event returns its original aggregate without duplicating the event', () => {
  const { db, handlers } = setup();
  try {
    const create = handlers.get('sicoven:vat-fiscal-incident-create');
    const incident = create({}, 'session', {
      operationId: 'vat-incident-create-002',
      companyId: 'company-1',
      purchaseId: 'purchase-1',
      reason: 'Factura de proveedor requiere revisión tributaria',
      detectedAt: '2026-01-15'
    });
    const eventHandler = handlers.get('sicoven:vat-fiscal-incident-event');
    const input = {
      operationId: 'vat-incident-event-001',
      incidentId: incident.id,
      eventType: 'REVIEW_RECORDED',
      decisionText: 'Se revisaron los soportes y se documentó el hallazgo',
      declarationId: ''
    };
    const first = eventHandler({}, 'session', input);
    const retry = eventHandler({}, 'session', input);
    assert.equal(first.id, retry.id);
    assert.equal(retry.replayed, true);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vat_fiscal_incident_events').get().n, 2);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 2);
  } finally { db.close(); }
});
