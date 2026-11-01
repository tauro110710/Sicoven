const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
const FORMATS = Object.freeze({
  '.pdf': { mime: 'application/pdf', extension: '.pdf', matches: b => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  '.jpg': { mime: 'image/jpeg', extension: '.jpg', matches: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', extension: '.jpg', matches: b => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.png': { mime: 'image/png', extension: '.png', matches: b => b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
  '.webp': { mime: 'image/webp', extension: '.webp', matches: b => b.length >= 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' }
});
const ENTITY_COLLECTIONS = Object.freeze({
  PURCHASE: 'purchases', SALE: 'sales', JOURNAL_ENTRY: 'journalEntries',
  VAT_VOUCHER: 'vatVouchers', ISLR_VOUCHER: 'islrVouchers',
  INVENTORY_MOVEMENT: 'movements', BANK_STATEMENT_MOVEMENT: 'bankStatementMovements'
});
function requiredText(value, label, max = 180) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new Error(label + ' es obligatorio y no puede exceder ' + max + ' caracteres.');
  return result;
}
function initializeDocumentVaultSchema(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS supporting_documents (id TEXT PRIMARY KEY,company_id TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,document_type TEXT NOT NULL,title TEXT NOT NULL,description TEXT,original_file_name TEXT NOT NULL,mime_type TEXT NOT NULL,extension TEXT NOT NULL,storage_key TEXT NOT NULL UNIQUE,sha256 TEXT NOT NULL,byte_size INTEGER NOT NULL CHECK(byte_size > 0 AND byte_size <= ' + MAX_DOCUMENT_BYTES + '),uploaded_by_user_id INTEGER,uploaded_by_username TEXT NOT NULL,created_at TEXT NOT NULL)',
    'CREATE INDEX IF NOT EXISTS supporting_documents_entity_idx ON supporting_documents(company_id,entity_type,entity_id,created_at)',
    "CREATE TABLE IF NOT EXISTS supporting_document_events (id INTEGER PRIMARY KEY AUTOINCREMENT,document_id TEXT NOT NULL REFERENCES supporting_documents(id),event_type TEXT NOT NULL CHECK(event_type IN ('ATTACHED','REVIEWED','OBSERVATION_RECORDED','REPLACED','ACCESSED')),details_json TEXT NOT NULL,actor_user_id INTEGER,actor_username TEXT NOT NULL,created_at TEXT NOT NULL)",
    'CREATE INDEX IF NOT EXISTS supporting_document_events_document_idx ON supporting_document_events(document_id,id)',
    "CREATE TRIGGER IF NOT EXISTS supporting_documents_no_update BEFORE UPDATE ON supporting_documents BEGIN SELECT RAISE(ABORT, 'supporting_documents is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS supporting_documents_no_delete BEFORE DELETE ON supporting_documents BEGIN SELECT RAISE(ABORT, 'supporting_documents is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS supporting_document_events_no_update BEFORE UPDATE ON supporting_document_events BEGIN SELECT RAISE(ABORT, 'supporting_document_events is append-only'); END",
    "CREATE TRIGGER IF NOT EXISTS supporting_document_events_no_delete BEFORE DELETE ON supporting_document_events BEGIN SELECT RAISE(ABORT, 'supporting_document_events is append-only'); END"
  ].join(';'));
}
function parseAccountingState(db) {
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('No existe un estado contable inicializado.');
  try { return JSON.parse(row.state_json); }
  catch { throw new Error('El estado contable no se puede leer; se protegió la operación documental.'); }
}
function assertLinkedEntity(db, input) {
  const state = parseAccountingState(db);
  const companyId = requiredText(input.companyId, 'Empresa', 120);
  if (!(Array.isArray(state.companies) ? state.companies : []).some(c => String(c.id) === companyId)) throw new Error('La empresa asociada al documento no existe en SQLite.');
  const entityType = requiredText(input.entityType, 'Tipo de operación', 50).toUpperCase();
  const collection = ENTITY_COLLECTIONS[entityType];
  if (!collection) throw new Error('Tipo de operación no admitido para respaldo documental.');
  const entityId = requiredText(input.entityId, 'Identificador de operación', 120);
  const entity = (Array.isArray(state[collection]) ? state[collection] : []).find(item => String(item.id) === entityId && String(item.companyId) === companyId);
  if (!entity) throw new Error('La operación no existe o no pertenece a la empresa seleccionada.');
  return { companyId, entityType, entityId };
}
function normalizeDocument(input, buffer) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Datos del documento inválidos.');
  if (!Buffer.isBuffer(buffer) || buffer.length < 1 || buffer.length > MAX_DOCUMENT_BYTES) throw new Error('El documento debe tener entre 1 byte y 20 MB.');
  const originalFileName = path.basename(requiredText(input.fileName, 'Nombre del archivo', 255));
  const format = FORMATS[path.extname(originalFileName).toLowerCase()];
  if (!format || !format.matches(buffer)) throw new Error('Formato no admitido o contenido que no coincide con su extensión. Use PDF, JPG, PNG o WEBP.');
  return {
    originalFileName, extension: format.extension, mimeType: format.mime,
    documentType: requiredText(input.documentType, 'Tipo de documento', 80).toUpperCase(),
    title: requiredText(input.title, 'Título', 240),
    description: String(input.description || '').trim().slice(0, 2000) || null,
    byteSize: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex')
  };
}
function currentDocumentStatus(db, documentId) {
  const row = db.prepare('SELECT event_type FROM supporting_document_events WHERE document_id=? AND event_type<>'ACCESSED' ORDER BY id DESC LIMIT 1').get(documentId);
  if (!row) return 'ATTACHED_UNREVIEWED';
  return row.event_type === 'REVIEWED' ? 'VERIFIED' : row.event_type === 'OBSERVATION_RECORDED' ? 'OBSERVATION_REQUIRED' : row.event_type === 'REPLACED' ? 'REPLACED' : 'ATTACHED_UNREVIEWED';
}
function attachDocument(db, { storageDir, input, buffer, actor }) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  const linked = assertLinkedEntity(db, input);
  const normalized = normalizeDocument(input, buffer);
  const id = crypto.randomUUID(), storageKey = id + normalized.extension, now = new Date().toISOString();
  const root = path.resolve(storageDir);
  fs.mkdirSync(root, { recursive: true });
  const target = path.join(root, storageKey), temporary = path.join(root, id + '.tmp');
  let written = false;
  try {
    fs.writeFileSync(temporary, buffer, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target); written = true;
    db.transaction(() => {
      let replaced = null;
      if (input.replacesDocumentId) {
        replaced = db.prepare('SELECT * FROM supporting_documents WHERE id=?').get(String(input.replacesDocumentId));
        if (!replaced || replaced.company_id !== linked.companyId || replaced.entity_type !== linked.entityType || replaced.entity_id !== linked.entityId) throw new Error('El documento sustituido no pertenece a esta misma operación.');
        if (currentDocumentStatus(db, replaced.id) === 'REPLACED') throw new Error('El documento indicado ya fue sustituido.');
      }
      db.prepare('INSERT INTO supporting_documents(id,company_id,entity_type,entity_id,document_type,title,description,original_file_name,mime_type,extension,storage_key,sha256,byte_size,uploaded_by_user_id,uploaded_by_username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id, linked.companyId, linked.entityType, linked.entityId, normalized.documentType, normalized.title, normalized.description, normalized.originalFileName, normalized.mimeType, normalized.extension, storageKey, normalized.sha256, normalized.byteSize, actor.id ?? null, actor.username, now);
      const event = db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)');
      event.run(id, 'ATTACHED', JSON.stringify({ sha256: normalized.sha256, byteSize: normalized.byteSize }), actor.id ?? null, actor.username, now);
      if (replaced) event.run(replaced.id, 'REPLACED', JSON.stringify({ replacedByDocumentId: id }), actor.id ?? null, actor.username, now);
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_attached', JSON.stringify({ documentId: id, companyId: linked.companyId, entityType: linked.entityType, entityId: linked.entityId, documentType: normalized.documentType, sha256: normalized.sha256, byteSize: normalized.byteSize, replacedDocumentId: replaced?.id || null, actor: actor.username }));
    })();
  } catch (error) {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    if (written) { try { fs.unlinkSync(target); } catch {} }
    throw error;
  }
  return { ok: true, document: { id, ...linked, documentType: normalized.documentType, title: normalized.title, fileName: normalized.originalFileName, mimeType: normalized.mimeType, sha256: normalized.sha256, byteSize: normalized.byteSize, status: 'ATTACHED_UNREVIEWED', createdAt: now } };
}
function listDocuments(db, filters = {}) {
  const clauses = [], values = [];
  if (filters.companyId) { clauses.push('d.company_id=?'); values.push(String(filters.companyId)); }
  if (filters.entityType) { clauses.push('d.entity_type=?'); values.push(String(filters.entityType).toUpperCase()); }
  if (filters.entityId) { clauses.push('d.entity_id=?'); values.push(String(filters.entityId)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return db.prepare('SELECT d.id,d.company_id AS companyId,d.entity_type AS entityType,d.entity_id AS entityId,d.document_type AS documentType,d.title,d.description,d.original_file_name AS fileName,d.mime_type AS mimeType,d.sha256,d.byte_size AS byteSize,d.uploaded_by_username AS uploadedBy,d.created_at AS createdAt,(SELECT e.event_type FROM supporting_document_events e WHERE e.document_id=d.id AND e.event_type<>'ACCESSED' ORDER BY e.id DESC LIMIT 1) AS lastEvent FROM supporting_documents d ' + where + ' ORDER BY d.created_at DESC,d.rowid DESC').all(...values).map(row => ({
    ...row, status: row.lastEvent === 'REPLACED' ? 'REPLACED' : row.lastEvent === 'REVIEWED' ? 'VERIFIED' : row.lastEvent === 'OBSERVATION_RECORDED' ? 'OBSERVATION_REQUIRED' : 'ATTACHED_UNREVIEWED',
    lastEvent: undefined
  }));
}
function reviewDocument(db, input, actor) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  const id = requiredText(input.documentId, 'Documento', 80), action = String(input.decision || '').toUpperCase();
  if (!['VERIFIED', 'OBSERVATION_REQUIRED'].includes(action)) throw new Error('Decisión documental no admitida.');
  const note = requiredText(input.reason, 'Justificación de revisión', 2000);
  const document = db.prepare('SELECT id,company_id,entity_type,entity_id FROM supporting_documents WHERE id=?').get(id);
  if (!document) throw new Error('El documento solicitado no existe.');
  if (currentDocumentStatus(db, id) === 'REPLACED') throw new Error('No se puede revisar un documento sustituido.');
  const now = new Date().toISOString(), eventType = action === 'VERIFIED' ? 'REVIEWED' : 'OBSERVATION_RECORDED';
  db.transaction(() => {
    db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id, eventType, JSON.stringify({ reason: note }), actor.id ?? null, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_reviewed', JSON.stringify({ documentId: id, decision: action, reason: note, actor: actor.username }));
  })();
  return { ok: true, documentId: id, status: action };
}
function getDocument(db, { storageDir, documentId, actor }) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  const id = requiredText(documentId, 'Documento', 80);
  const row = db.prepare('SELECT id,storage_key,sha256,company_id,entity_type,entity_id FROM supporting_documents WHERE id=?').get(id);
  if (!row) throw new Error('El documento solicitado no existe.');
  const root = path.resolve(storageDir), target = path.resolve(root, row.storage_key);
  if (path.dirname(target) !== root || !/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(row.storage_key)) throw new Error('La ubicación interna del documento no es válida.');
  const buffer = fs.readFileSync(target), digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (digest !== row.sha256) throw new Error('La integridad del documento no coincide con su huella SHA-256.');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id, 'ACCESSED', JSON.stringify({ sha256: digest }), actor.id ?? null, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_accessed', JSON.stringify({ documentId: id, companyId: row.company_id, entityType: row.entity_type, entityId: row.entity_id, actor: actor.username }));
  })();
  return { path: target, mimeType: path.extname(target) === '.pdf' ? 'application/pdf' : path.extname(target) === '.webp' ? 'image/webp' : path.extname(target) === '.png' ? 'image/png' : 'image/jpeg' };
}
function registerDocumentVaultIpc({ ipcMain, db, licenseView, getActiveSession, dialog, shell, app, getWindow }) {
  initializeDocumentVaultSchema(db);
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida.');
    return actor;
  };
  ipcMain.handle('sicoven:document-attach', async (_event, token, input) => {
    const actor = authenticate(token);
    const options = { title: 'Adjuntar soporte documental a SICOVEN', properties: ['openFile'], filters: [{ name: 'Documentos admitidos', extensions: ['pdf','jpg','jpeg','png','webp'] }] };
    const parentWindow = getWindow?.();
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const source = selection.filePaths[0], stat = fs.statSync(source);
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_DOCUMENT_BYTES) throw new Error('El archivo debe tener entre 1 byte y 20 MB.');
    const buffer = fs.readFileSync(source);
    return attachDocument(db, { storageDir: path.join(app.getPath('userData'), 'supporting-documents'), input: { ...input, fileName: path.basename(source) }, buffer, actor });
  });
  ipcMain.handle('sicoven:document-list', (_event, token, filters) => { authenticate(token); return listDocuments(db, filters || {}); });
  ipcMain.handle('sicoven:document-review', (_event, token, input) => { const actor = authenticate(token); return reviewDocument(db, input || {}, actor); });
  ipcMain.handle('sicoven:document-open', async (_event, token, documentId) => {
    const actor = authenticate(token);
    const result = getDocument(db, { storageDir: path.join(app.getPath('userData'), 'supporting-documents'), documentId, actor });
    const error = await shell.openPath(result.path);
    if (error) throw new Error('No se pudo abrir el documento: ' + error);
    return { ok: true };
  });
}
module.exports = { MAX_DOCUMENT_BYTES, initializeDocumentVaultSchema, assertLinkedEntity, normalizeDocument, attachDocument, listDocuments, reviewDocument, getDocument, registerDocumentVaultIpc };
