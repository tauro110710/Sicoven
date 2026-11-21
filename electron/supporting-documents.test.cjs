const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const {
  initializeDocumentVaultSchema, assertNoSymlinkPath, attachDocument, listDocuments, reviewDocument, getDocument,
  registerDocumentVaultIpc
} = require('./supporting-documents.cjs');
const { initializeOperationReceiptSchema } = require('./operation-receipts.cjs');

const actor = { id: 7, username: 'contador', role: 'admin' };
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)').run('accounting', JSON.stringify({
    companies: [{ id: 'co-1', name: 'Empresa de prueba', taxStatusHistory: [{ id: 'tax-period-1', effectiveFrom: '2026-01-01', specialTaxpayerStatus: 'ESPECIAL' }] }],
    purchases: [{ id: 'purchase-1', companyId: 'co-1', invoiceNumber: 'FC-001' }],
    sales: [], journalEntries: [], vatVouchers: [], islrVouchers: [], movements: [], bankStatementMovements: []
  }));
  db.exec("CREATE TABLE accounting_correction_cases(id TEXT PRIMARY KEY,company_id TEXT NOT NULL)");
  db.prepare('INSERT INTO accounting_correction_cases(id,company_id) VALUES(?,?)').run('case-1','co-1');
  initializeDocumentVaultSchema(db);
  initializeOperationReceiptSchema(db);
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
    assert.equal(listDocuments(h.db, { companyId: 'co-1' })[0].status, 'VERIFIED');
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

test('correction case evidence is attached to the exact case and company',()=>{
 const h=fixture();try{
  const result=attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'co-1',entityType:'CORRECTION_CASE',entityId:'case-1',documentType:'PAPEL_TRABAJO',title:'Conciliación de corrección',fileName:'soporte.pdf'},buffer:pdf,actor});
  assert.equal(result.document.entityType,'CORRECTION_CASE');
  assert.equal(result.document.entityId,'case-1');
  assert.equal(listDocuments(h.db,{companyId:'co-1',entityType:'CORRECTION_CASE',entityId:'case-1'}).length,1);
  assert.throws(()=>attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'other',entityType:'CORRECTION_CASE',entityId:'case-1',documentType:'PAPEL_TRABAJO',title:'Soporte',fileName:'soporte.pdf'},buffer:pdf,actor}),/empresa asociada/);
 }finally{h.close();}
});

test('tax status period evidence is attached to the exact company and historical period',()=>{
 const h=fixture();try{
  const result=attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'co-1',entityType:'COMPANY_TAX_STATUS_PERIOD',entityId:'tax-period-1',documentType:'SOPORTE_CONDICION_TRIBUTARIA',title:'Providencia de calificación',fileName:'acto.pdf'},buffer:pdf,actor});
  assert.equal(result.document.entityType,'COMPANY_TAX_STATUS_PERIOD');
  assert.equal(result.document.entityId,'tax-period-1');
  assert.equal(listDocuments(h.db,{companyId:'co-1',entityType:'COMPANY_TAX_STATUS_PERIOD',entityId:'tax-period-1'}).length,1);
  assert.throws(()=>attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'co-1',entityType:'COMPANY_TAX_STATUS_PERIOD',entityId:'missing-period',documentType:'SOPORTE_CONDICION_TRIBUTARIA',title:'Soporte',fileName:'acto.pdf'},buffer:pdf,actor}),/no existe o no pertenece/);
  assert.throws(()=>attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'other',entityType:'COMPANY_TAX_STATUS_PERIOD',entityId:'tax-period-1',documentType:'SOPORTE_CONDICION_TRIBUTARIA',title:'Soporte',fileName:'acto.pdf'},buffer:pdf,actor}),/empresa asociada/);
 }finally{h.close();}
});

test('the single accountant can verify their own correction-case evidence',()=>{
 const h=fixture();try{
  const result=attachDocument(h.db,{storageDir:h.storageDir,input:{companyId:'co-1',entityType:'CORRECTION_CASE',entityId:'case-1',documentType:'EVIDENCIA',title:'Soporte',fileName:'soporte.pdf'},buffer:pdf,actor});
  const verified=reviewDocument(h.db,{documentId:result.document.id,decision:'VERIFIED',reason:'El contador cotejó el soporte con el registro fuente y el papel de trabajo.'},actor);
  assert.equal(verified.status,'VERIFIED');
  const persisted = listDocuments(h.db,{companyId:'co-1',entityType:'CORRECTION_CASE',entityId:'case-1'});
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].status,'VERIFIED');
 }finally{h.close();}
});


test('document vault IPC reads and writes through the selected tenant database', async () => {
  const control = fixture();
  const tenant = fixture();
  const handlers = new Map();
  registerDocumentVaultIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: control.db,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'tenant-token' ? actor : null,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [path.join(tenant.storageDir, 'source.pdf')] }) },
    shell: {},
    app: { getPath: () => tenant.storageDir },
    getWindow: () => null,
    withDatabase: async (token, operation) => {
      assert.equal(token, 'tenant-token');
      return operation(tenant.db, 'co-1');
    }
  });
  try {
    const rows = await handlers.get('sicoven:document-list')({}, 'tenant-token', {});
    assert.deepEqual(rows, []);
    assert.equal(control.db.prepare('SELECT COUNT(*) AS n FROM supporting_documents').get().n, 0);

    const sourceFile = path.join(tenant.storageDir, 'source.pdf');
    fs.writeFileSync(sourceFile, pdf);
    const attachResult = await handlers.get('sicoven:document-attach')({}, 'tenant-token', {
      companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1',
      documentType: 'FACTURA_COMPRA', title: 'Factura LAN', fileName: 'factura.pdf'
    });
    assert.equal(attachResult.ok, true);
    const reviewInput = {
      operationId: 'document-review-tenant-001',
      documentId: attachResult.document.id,
      decision: 'VERIFIED',
      reason: 'Factura cotejada con el documento original y sus datos de control.'
    };
    const reviewed = await handlers.get('sicoven:document-review')({}, 'tenant-token', reviewInput);
    const reviewRetry = await handlers.get('sicoven:document-review')({}, 'tenant-token', reviewInput);
    assert.equal(reviewed.status, 'VERIFIED');
    assert.equal(reviewRetry.replayed, true);
    assert.equal(tenant.db.prepare("SELECT COUNT(*) AS n FROM supporting_document_events WHERE document_id=? AND event_type='REVIEWED'").get(attachResult.document.id).n, 1);
    assert.equal(tenant.db.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 1);
    const canonicalPath = path.join(tenant.storageDir, 'companies', 'co-1', 'supporting-documents', attachResult.document.id + '.pdf');
    assert.equal(fs.existsSync(canonicalPath), true);
    let openedPath = null;
    const shell = { openPath: async filePath => { openedPath = filePath; return ''; } };
    const openHandlers = new Map();
    registerDocumentVaultIpc({
      ipcMain: { handle: (channel, handler) => openHandlers.set(channel, handler) },
      db: control.db,
      licenseView: () => ({ authorized: true }),
      getActiveSession: token => token === 'tenant-token' ? actor : null,
      dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sourceFile] }) },
      shell,
      app: { getPath: () => tenant.storageDir },
      getWindow: () => null,
      withDatabase: async (token, operation) => operation(tenant.db, 'co-1')
    });
    await openHandlers.get('sicoven:document-open')({}, 'tenant-token', attachResult.document.id);
    assert.equal(openedPath, canonicalPath);

    const historicalDir = path.join(tenant.storageDir, 'supporting-documents', 'co-1');
    fs.mkdirSync(historicalDir, { recursive: true });
    const historicalPath = path.join(historicalDir, attachResult.document.id + '.pdf');
    fs.renameSync(canonicalPath, historicalPath);
    openedPath = null;
    await openHandlers.get('sicoven:document-open')({}, 'tenant-token', attachResult.document.id);
    assert.equal(openedPath, historicalPath);
    assert.equal(fs.existsSync(historicalPath), true);
  } finally {
    control.close();
    tenant.close();
  }
});

test('document vault rejects symlinked parent directories before opening or writing files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-doc-parent-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-doc-outside-'));
  try {
    const linkedParent = path.join(root, 'companies');
    fs.symlinkSync(outside, linkedParent, 'dir');
    const storageDir = path.join(linkedParent, 'co-1', 'supporting-documents');
    assert.throws(() => assertNoSymlinkPath(root, storageDir, 'El almacén documental'), /directorio intermedio.*seguro/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});


test('durable attachment retries replay the same receipt without duplicate metadata', () => {
  const h = fixture();
  try {
    const request = { operationId: 'document-durable-replay-001', companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1', documentType: 'FACTURA_COMPRA', title: 'Factura recuperable', fileName: 'factura.pdf' };
    const first = attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor });
    const replay = attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: null, actor });
    assert.equal(first.ok, true);
    assert.equal(replay.replayed, true);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM operation_receipts WHERE operation_type='documents.attach'").get().count, 1);
  } finally { h.close(); }
});

test('durable attachment recovers when SQLite fails after the document file is persisted', () => {
  const h = fixture();
  try {
    const request = { operationId: 'document-durable-recover-001', companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1', documentType: 'FACTURA_COMPRA', title: 'Factura recuperable', fileName: 'factura.pdf' };
    h.db.exec("CREATE TRIGGER reject_supporting_document BEFORE INSERT ON supporting_documents BEGIN SELECT RAISE(ABORT, 'simulated metadata interruption'); END");
    assert.throws(() => attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor }), /simulated metadata interruption/);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM operation_intents').get().count, 1);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 0);
    h.db.exec('DROP TRIGGER reject_supporting_document');
    const recovered = attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor });
    assert.equal(recovered.ok, true);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 1);
    assert.equal(h.db.prepare("SELECT COUNT(*) AS count FROM operation_receipts WHERE operation_type='documents.attach'").get().count, 1);
  } finally { h.close(); }
});

test('durable attachment rejects a different source file for the same operation ID', () => {
  const h = fixture();
  try {
    const request = { operationId: 'document-durable-source-001', companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1', documentType: 'FACTURA_COMPRA', title: 'Factura recuperable', fileName: 'factura.pdf' };
    h.db.exec("CREATE TRIGGER reject_supporting_document BEFORE INSERT ON supporting_documents BEGIN SELECT RAISE(ABORT, 'simulated metadata interruption'); END");
    assert.throws(() => attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor }), /simulated metadata interruption/);
    const intent = h.db.prepare('SELECT request_json FROM operation_intents WHERE operation_id=?').get(request.operationId);
    const target = path.join(h.storageDir, JSON.parse(intent.request_json).storageKey);
    const original = fs.readFileSync(target);
    h.db.exec('DROP TRIGGER reject_supporting_document');
    const changed = Buffer.from('%PDF-1.7\nALTERACION DEL SOPORTE\n%%EOF\n');
    assert.throws(() => attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: changed, actor }), /no coinciden con la intención pendiente/);
    assert.deepEqual(fs.readFileSync(target), original);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 0);
  } finally { h.close(); }
});

test('corrupted pending attachment is preserved and never registered as valid evidence', () => {
  const h = fixture();
  try {
    const request = { operationId: 'document-durable-corrupt-001', companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1', documentType: 'FACTURA_COMPRA', title: 'Factura recuperable', fileName: 'factura.pdf' };
    h.db.exec("CREATE TRIGGER reject_supporting_document BEFORE INSERT ON supporting_documents BEGIN SELECT RAISE(ABORT, 'simulated metadata interruption'); END");
    assert.throws(() => attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor }), /simulated metadata interruption/);
    const intent = h.db.prepare('SELECT request_json FROM operation_intents WHERE operation_id=?').get(request.operationId);
    const target = path.join(h.storageDir, JSON.parse(intent.request_json).storageKey);
    const tampered = Buffer.from('%PDF-1.7\nARCHIVO ALTERADO\n%%EOF\n');
    fs.writeFileSync(target, tampered);
    h.db.exec('DROP TRIGGER reject_supporting_document');
    assert.throws(() => attachDocument(h.db, { storageDir: h.storageDir, input: request, buffer: pdf, actor }), /no coincide con el tamaño y SHA-256/);
    assert.deepEqual(fs.readFileSync(target), tampered);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 0);
  } finally { h.close(); }
});

test('document attachment refuses a symlinked tenant directory without writing outside the data root', () => {
  const h = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-docs-outside-'));
  try {
    const companiesDir = path.join(h.storageDir, 'companies');
    fs.symlinkSync(outside, companiesDir, 'dir');
    const targetDir = path.join(companiesDir, 'co-1', 'supporting-documents');
    assert.throws(() => attachDocument(h.db, {
      trustedRoot: h.storageDir, storageDir: targetDir,
      input: { operationId: 'document-symlink-001', companyId: 'co-1', entityType: 'PURCHASE', entityId: 'purchase-1', documentType: 'FACTURA_COMPRA', title: 'Factura', fileName: 'factura.pdf' },
      buffer: pdf, actor
    }), /directorio intermedio.*seguro/i);
    assert.deepEqual(fs.readdirSync(outside), []);
    assert.equal(h.db.prepare('SELECT COUNT(*) AS count FROM supporting_documents').get().count, 0);
  } finally {
    h.close();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
