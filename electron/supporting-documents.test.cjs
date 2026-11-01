const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  initializeDocumentVaultSchema, attachDocument, listDocuments, reviewDocument, getDocument
} = require('./supporting-documents.cjs');

const actor = { id: 7, username: 'contador', role: 'admin' };
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)').run('accounting', JSON.stringify({
    companies: [{ id: 'co-1', name: 'Empresa de prueba' }],
    purchases: [{ id: 'purchase-1', companyId: 'co-1', invoiceNumber: 'FC-001' }],
    sales: [], journalEntries: [], vatVouchers: [], islrVouchers: [], movements: [], bankStatementMovements: []
  }));
  initializeDocumentVaultSchema(db);
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-docs-'));
  return { db, storageDir, close() { db.close(); fs.rmSync(storageDir, { recursive: true, force: true }); } };
}
const pdf = Buffer.from('%PDF-1.7\nSICOVEN DOCUMENT TEST\n%%EOF\n');
function upload(h, overrides = {}) {
  return attachDocument(h.db, {
    storageDir: h.storageDir,
    input: { companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1',
      documentType: 'FACTURA_COMPRA', title: 'Factura proveedor', fileName: 'factura.pdf', ...overrides },
    buffer: pdf, actor
  });
}
test('an optional supporting document can be attached after the accounting record already exists', () => {
  const h = fixture();
  try {
    const result = upload(h);
    assert.equal(result.ok, true);
    assert.equal(result.document.status, 'ATTACHED_UNREVIEWED');
    assert.equal(fs.existsSync(path.join(h.storageDir, result.document.id + '.pdf')), true);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='supporting_document_attached'").get().count, 1);
  } finally { h.close(); }
});
test('document listing requires a valid company scope', () => {
  const h = fixture();
  try {
    assert.throws(() => listDocuments(h.db), /Empresa es obligatorio/);
    assert.throws(() => listDocuments(h.db, { companyId: 'missing' }), /no existe en SQLite/);
    assert.deepEqual(listDocuments(h.db, { companyId: 'co-1' }), []);
  } finally { h.close(); }
});
test('attachment validation rejects mismatched files, unknown entities and cross-company links without writing rows', () => {
  const h = fixture();
  try {
    assert.throws(() => upload(h, { fileName: 'factura.png' }), /Formato no admitido/);
    assert.throws(() => upload(h, { entityId: 'missing' }), /no existe o no pertenece/);
    assert.throws(() => upload(h, { companyId: 'other' }), /empresa asociada/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 0);
    assert.equal(fs.readdirSync(h.storageDir).length, 0);
  } finally { h.close(); }
});
test('document access verifies SHA-256 and does not downgrade a reviewed status', () => {
  const h = fixture();
  try {
    const result = upload(h);
    reviewDocument(h.db, { documentId: result.document.id, decision: 'VERIFIED', reason: 'Factura cotejada contra el soporte recibido.' }, actor);
    assert.equal(listDocuments(h.db, { companyId: 'co-1' })[0].status, 'VERIFIED');
    const opened = getDocument(h.db, { storageDir: h.storageDir, documentId: result.document.id, actor });
    assert.equal(fs.existsSync(opened.path), true);
    assert.equal(listDocuments(h.db)[0].status, 'VERIFIED');
    fs.writeFileSync(opened.path, Buffer.from('%PDF-1.7\nALTERADO\n'));
    assert.throws(() => getDocument(h.db, { storageDir: h.storageDir, documentId: result.document.id, actor }), /SHA-256/);
  } finally { h.close(); }
});
test('replacement preserves both document records and immutable history', () => {
  const h = fixture();
  try {
    const first = upload(h);
    const second = upload(h, { title: 'Factura corregida', replacesDocumentId: first.document.id });
    const rows = listDocuments(h.db, { companyId: 'co-1' });
    assert.equal(rows.length, 2);
    assert.equal(rows.find(row => row.id === first.document.id).status, 'REPLACED');
    assert.equal(rows.find(row => row.id === second.document.id).status, 'ATTACHED_UNREVIEWED');
    assert.throws(() => h.db.prepare('DELETE FROM supporting_documents WHERE id=?').run(first.document.id), /append-only/);
    assert.throws(() => h.db.prepare('UPDATE supporting_documents SET title=? WHERE id=?').run('alterado', second.document.id), /append-only/);
    assert.throws(() => h.db.prepare('DELETE FROM supporting_document_events').run(), /append-only/);
  } finally { h.close(); }
});
test('replacement cannot link a document from another accounting operation and cleans its temporary file', () => {
  const h = fixture();
  try {
    const first = upload(h);
    assert.throws(() => upload(h, { entityId: 'another-purchase', replacesDocumentId: first.document.id }), /no existe o no pertenece/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 1);
    assert.equal(fs.readdirSync(h.storageDir).length, 1);
  } finally { h.close(); }
});
test('document review records an explicit reason and refuses a substituted document', () => {
  const h = fixture();
  try {
    const first = upload(h);
    const second = upload(h, { replacesDocumentId: first.document.id });
    assert.throws(() => reviewDocument(h.db, { documentId: first.document.id, decision: 'VERIFIED', reason: 'Revisión' }, actor), /sustituido/);
    const reviewed = reviewDocument(h.db, { documentId: second.document.id, decision: 'OBSERVATION_REQUIRED', reason: 'El número de control no es legible.' }, actor);
    assert.equal(reviewed.status, 'OBSERVATION_REQUIRED');
    assert.equal(listDocuments(h.db, { companyId: 'co-1' }).find(row => row.id === second.document.id).status, 'OBSERVATION_REQUIRED');
  } finally { h.close(); }
});
