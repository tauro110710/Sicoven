const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { restoreWindowFocus } = require('./window-focus.cjs');
const {
  initializeOperationReceiptSchema, prepareOperationIntent, createOperationReceiptIdentity,
  findOperationReceipt, runIdempotentOperation, hashOperationRequest
} = require('./operation-receipts.cjs');

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
function assertNoSymlinkPath(trustedRoot, target, label = 'El almacén documental') {
  const root = path.resolve(trustedRoot);
  const destination = path.resolve(target);
  const relative = path.relative(root, destination);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(label + ' intenta salir de la carpeta local autorizada.');
  }
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error('La carpeta raíz de datos de SICOVEN no es un directorio local seguro.');
  }
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(label + ' contiene un directorio intermedio que no es seguro.');
    }
  }
  return destination;
}
function operationRequest(input) {
  const { operationId, ...request } = input || {};
  return request;
}
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
  const entityId = requiredText(input.entityId, 'Identificador de operación', 120);
  if (entityType === 'COMPANY_TAX_STATUS_PERIOD') {
    const company = (Array.isArray(state.companies) ? state.companies : []).find(item => String(item.id) === companyId);
    const period = company && Array.isArray(company.taxStatusHistory)
      ? company.taxStatusHistory.find(item => String(item.id) === entityId)
      : null;
    if (!period) throw new Error('El período de condición tributaria no existe o no pertenece a la empresa seleccionada.');
    return { companyId, entityType, entityId };
  }
  if (entityType === 'CORRECTION_CASE') {
    const correctionCase = db.prepare('SELECT id FROM accounting_correction_cases WHERE id=? AND company_id=?').get(entityId,companyId);
    if (!correctionCase) throw new Error('El expediente de corrección no existe o no pertenece a la empresa seleccionada.');
    return { companyId, entityType, entityId };
  }
  const collection = ENTITY_COLLECTIONS[entityType];
  if (!collection) throw new Error('Tipo de operación no admitido para respaldo documental.');
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
  const row = db.prepare("SELECT event_type FROM supporting_document_events WHERE document_id=? AND event_type<>'ACCESSED' ORDER BY id DESC LIMIT 1").get(documentId);
  if (!row) return 'ATTACHED_UNREVIEWED';
  return row.event_type === 'REVIEWED' ? 'VERIFIED' : row.event_type === 'OBSERVATION_RECORDED' ? 'OBSERVATION_REQUIRED' : row.event_type === 'REPLACED' ? 'REPLACED' : 'ATTACHED_UNREVIEWED';
}
function readDocumentIntent(db, companyId, operationId, actor) {
  const row = db.prepare(`
    SELECT i.operation_type,i.ipc_channel,i.request_hash,i.request_json,i.actor_user_id,i.actor_username,
      c.operation_id AS completed_operation_id
    FROM operation_intents i
    LEFT JOIN operation_intent_completions c
      ON c.company_id=i.company_id AND c.operation_id=i.operation_id
    WHERE i.company_id=? AND i.operation_id=?
  `).get(companyId, operationId);
  if (!row) return null;
  if (row.ipc_channel !== 'sicoven:document-attach' || row.operation_type !== 'documents.attach' ||
      Number(row.actor_user_id) !== Number(actor.id) ||
      String(row.actor_username) !== String(actor.username)) {
    throw new Error('La clave de adjunto ya pertenece a otra operación o usuario; se bloqueó el reintento.');
  }
  let request;
  try { request = JSON.parse(row.request_json); } catch {}
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      hashOperationRequest(JSON.stringify(request)) !== String(row.request_hash)) {
    throw new Error('La intención durable del documento está dañada o no coincide con su huella.');
  }
  return { request, requestHash: String(row.request_hash), completed: Boolean(row.completed_operation_id) };
}

function assertDocumentFile(filePath, expectedHash, expectedSize) {
  let stat;
  try { stat = fs.lstatSync(filePath); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('El archivo documental pendiente no es un archivo regular seguro.');
  if (stat.size !== Number(expectedSize) || crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') !== expectedHash) {
    throw new Error('El archivo documental pendiente no coincide con el tamaño y SHA-256 de la intención; se conserva intacto.');
  }
  return true;
}

function persistStagedDocumentFile({ root, request, buffer }) {
  const staging = path.join(root, request.stagingKey);
  const target = path.join(root, request.storageKey);
  if (path.dirname(staging) !== root || path.dirname(target) !== root) {
    throw new Error('La intención contiene una ruta documental fuera del almacén autorizado.');
  }
  const stageExists = assertDocumentFile(staging, request.sha256, request.byteSize);
  let targetExists = assertDocumentFile(target, request.sha256, request.byteSize);
  if (!stageExists && !targetExists && buffer) {
    const digest = crypto.createHash('sha256').update(buffer).digest('hex');
    if (buffer.length !== Number(request.byteSize) || digest !== request.sha256) {
      throw new Error('El archivo seleccionado no coincide con el SHA-256 de la intención pendiente.');
    }
    const fd = fs.openSync(staging, 'wx', 0o600);
    try { fs.writeFileSync(fd, buffer); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
  }
  const nowStageExists = assertDocumentFile(staging, request.sha256, request.byteSize);
  targetExists = assertDocumentFile(target, request.sha256, request.byteSize);
  if (!targetExists && nowStageExists) {
    try { fs.linkSync(staging, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      assertDocumentFile(target, request.sha256, request.byteSize);
    }
    targetExists = assertDocumentFile(target, request.sha256, request.byteSize);
  }
  if (!targetExists) {
    const error = new Error('La operación documental conserva una intención pendiente, pero falta el archivo original. Seleccione nuevamente el mismo soporte para recuperarla.');
    error.code = 'SICOVEN_DOCUMENT_SOURCE_REQUIRED';
    throw error;
  }
  if (nowStageExists) {
    assertDocumentFile(staging, request.sha256, request.byteSize);
    fs.unlinkSync(staging);
  }
  return target;
}

function attachDocument(db, { storageDir, trustedRoot = path.dirname(path.resolve(storageDir)), input, buffer = null, actor }) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  initializeOperationReceiptSchema(db);
  const operationId = String(input?.operationId || crypto.randomUUID()).trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId)) throw new Error('El identificador estable del adjunto no es válido.');
  const companyId = requiredText(input?.companyId, 'Empresa', 120);
  let intent = readDocumentIntent(db, companyId, operationId, actor);
  let request;
  if (intent) {
    request = intent.request;
    if (String(request.companyId) !== companyId ||
        String(request.stagingKey) !== operationId + '.pending' ||
        !/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(String(request.storageKey || '')) ||
        !/^[a-f0-9]{64}$/.test(String(request.sha256 || '')) ||
        !Number.isSafeInteger(Number(request.byteSize)) || Number(request.byteSize) < 1 || Number(request.byteSize) > MAX_DOCUMENT_BYTES) {
      throw new Error('La intención de adjunto contiene metadatos o rutas no válidas; se conservó para inspección.');
    }
    if (buffer) {
      const candidate = normalizeDocument(input, buffer);
      for (const key of ['originalFileName','documentType','title','description','mimeType','extension','sha256','byteSize']) {
        if ((candidate[key] ?? null) !== (request[key] ?? null)) {
          throw new Error('El archivo o los datos seleccionados no coinciden con la intención pendiente; no se sustituyó el soporte original.');
        }
      }
    }
  } else {
    if (!buffer) {
      const missing = new Error('Se requiere seleccionar el archivo original para iniciar el adjunto.');
      missing.code = 'SICOVEN_DOCUMENT_SOURCE_REQUIRED';
      throw missing;
    }
    const linked = assertLinkedEntity(db, input);
    const normalized = normalizeDocument(input, buffer);
    const id = crypto.randomUUID();
    request = {
      companyId: linked.companyId, entityType: linked.entityType, entityId: linked.entityId,
      replacesDocumentId: input.replacesDocumentId ? String(input.replacesDocumentId) : null,
      documentId: id, storageKey: id + normalized.extension, stagingKey: operationId + '.pending',
      ...normalized
    };
    if (request.replacesDocumentId) {
      const replaced = db.prepare('SELECT * FROM supporting_documents WHERE id=?').get(request.replacesDocumentId);
      if (!replaced || replaced.company_id !== linked.companyId || replaced.entity_type !== linked.entityType || replaced.entity_id !== linked.entityId) {
        throw new Error('El documento sustituido no pertenece a esta misma operación.');
      }
      if (currentDocumentStatus(db, replaced.id) === 'REPLACED') throw new Error('El documento indicado ya fue sustituido.');
    }
    prepareOperationIntent(db, {
      operationId, channel: 'sicoven:document-attach', requestMode: 'object', request
    }, linked.companyId, actor);
    intent = readDocumentIntent(db, linked.companyId, operationId, actor);
  }

  const identity = createOperationReceiptIdentity({ operationId }, companyId, 'documents.attach', request, actor);
  const root = assertNoSymlinkPath(trustedRoot, storageDir, 'El almacén documental');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  assertNoSymlinkPath(trustedRoot, root, 'El almacén documental');
  const target = persistStagedDocumentFile({ root, request, buffer });
  const prior = findOperationReceipt(db, identity);
  if (prior.found) return prior.result;

  const now = new Date().toISOString();
  return runIdempotentOperation(db, identity, () => {
    const linked = assertLinkedEntity(db, request);
    let replaced = null;
    if (request.replacesDocumentId) {
      replaced = db.prepare('SELECT * FROM supporting_documents WHERE id=?').get(String(request.replacesDocumentId));
      if (!replaced || replaced.company_id !== linked.companyId || replaced.entity_type !== linked.entityType || replaced.entity_id !== linked.entityId) {
        throw new Error('El documento sustituido no pertenece a esta misma operación.');
      }
      if (currentDocumentStatus(db, replaced.id) === 'REPLACED') throw new Error('El documento indicado ya fue sustituido.');
    }
    if (!assertDocumentFile(target, request.sha256, request.byteSize)) {
      throw new Error('El archivo final no está disponible para confirmar el registro documental.');
    }
    db.prepare('INSERT INTO supporting_documents(id,company_id,entity_type,entity_id,document_type,title,description,original_file_name,mime_type,extension,storage_key,sha256,byte_size,uploaded_by_user_id,uploaded_by_username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(request.documentId, linked.companyId, linked.entityType, linked.entityId, request.documentType, request.title, request.description, request.originalFileName, request.mimeType, request.extension, request.storageKey, request.sha256, request.byteSize, actor.id ?? null, actor.username, now);
    const event = db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)');
    event.run(request.documentId, 'ATTACHED', JSON.stringify({ sha256: request.sha256, byteSize: request.byteSize }), actor.id ?? null, actor.username, now);
    if (replaced) event.run(replaced.id, 'REPLACED', JSON.stringify({ replacedByDocumentId: request.documentId }), actor.id ?? null, actor.username, now);
    const result = { ok: true, document: {
      id: request.documentId, ...linked, documentType: request.documentType, title: request.title,
      fileName: request.originalFileName, mimeType: request.mimeType, sha256: request.sha256,
      byteSize: request.byteSize, status: 'ATTACHED_UNREVIEWED', createdAt: now
    } };
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_attached', JSON.stringify({
      documentId: request.documentId, companyId: linked.companyId, entityType: linked.entityType,
      entityId: linked.entityId, documentType: request.documentType, sha256: request.sha256,
      byteSize: request.byteSize, replacedDocumentId: replaced?.id || null, actor: actor.username
    }));
    return result;
  });
}
function listDocuments(db, filters = {}) {
  const clauses = [], values = [];
  const companyId = requiredText(filters.companyId, 'Empresa', 120);
  const state = parseAccountingState(db);
  if (!(Array.isArray(state.companies) ? state.companies : []).some(company => String(company.id) === companyId)) {
    throw new Error('La empresa seleccionada no existe en SQLite.');
  }
  clauses.push('d.company_id=?'); values.push(companyId);
  if (filters.entityType) { clauses.push('d.entity_type=?'); values.push(String(filters.entityType).toUpperCase()); }
  if (filters.entityId) { clauses.push('d.entity_id=?'); values.push(String(filters.entityId)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return db.prepare("SELECT d.id,d.company_id AS companyId,d.entity_type AS entityType,d.entity_id AS entityId,d.document_type AS documentType,d.title,d.description,d.original_file_name AS fileName,d.mime_type AS mimeType,d.sha256,d.byte_size AS byteSize,d.uploaded_by_username AS uploadedBy,d.created_at AS createdAt,(SELECT e.event_type FROM supporting_document_events e WHERE e.document_id=d.id AND e.event_type<>'ACCESSED' ORDER BY e.id DESC LIMIT 1) AS lastEvent FROM supporting_documents d " + where + " ORDER BY d.created_at DESC,d.rowid DESC").all(...values).map(row => ({
    ...row, status: row.lastEvent === 'REPLACED' ? 'REPLACED' : row.lastEvent === 'REVIEWED' ? 'VERIFIED' : row.lastEvent === 'OBSERVATION_RECORDED' ? 'OBSERVATION_REQUIRED' : 'ATTACHED_UNREVIEWED',
    lastEvent: undefined
  }));
}
function reviewDocument(db, input, actor) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  const id = requiredText(input.documentId, 'Documento', 80), action = String(input.decision || '').toUpperCase();
  if (!['VERIFIED', 'OBSERVATION_REQUIRED'].includes(action)) throw new Error('Decisión documental no admitida.');
  const note = requiredText(input.reason, 'Justificación de revisión', 2000);
  const document = db.prepare('SELECT id,company_id,entity_type,entity_id,uploaded_by_user_id,uploaded_by_username FROM supporting_documents WHERE id=?').get(id);
  if (!document) throw new Error('El documento solicitado no existe.');

  if (currentDocumentStatus(db, id) === 'REPLACED') throw new Error('No se puede revisar un documento sustituido.');
  const now = new Date().toISOString(), eventType = action === 'VERIFIED' ? 'REVIEWED' : 'OBSERVATION_RECORDED';
  db.transaction(() => {
    db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id, eventType, JSON.stringify({ reason: note }), actor.id ?? null, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_reviewed', JSON.stringify({ documentId: id, decision: action, reason: note, actor: actor.username }));
  })();
  return { ok: true, documentId: id, status: action };
}
function getDocument(db, { storageDir, storageDirs, trustedRoot = path.dirname(path.resolve(storageDir || storageDirs?.[0] || '.')), documentId, actor }) {
  if (!actor?.username) throw new Error('Sesión no válida.');
  const id = requiredText(documentId, 'Documento', 80);
  const row = db.prepare('SELECT id,storage_key,sha256,company_id,entity_type,entity_id FROM supporting_documents WHERE id=?').get(id);
  if (!row) throw new Error('El documento solicitado no existe.');
  if (!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/.test(row.storage_key)) throw new Error('La ubicación interna del documento no es válida.');
  const roots = [...new Set((Array.isArray(storageDirs) ? storageDirs : [storageDir]).filter(Boolean).map(value => assertNoSymlinkPath(trustedRoot, value, 'La ruta del almacén documental')))];
  if (!roots.length) throw new Error('No se configuró una ubicación documental válida.');
  let target = null, buffer = null, lastMissing = null;
  for (const root of roots) {
    const candidate = path.resolve(root, row.storage_key);
    if (path.dirname(candidate) !== root) throw new Error('La ubicación interna del documento no es válida.');
    try {
      const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('El documento almacenado no es un archivo regular seguro.');
      target = candidate;
      buffer = fs.readFileSync(candidate);
      break;
    } catch (error) {
      if (error.code === 'ENOENT') { lastMissing = error; continue; }
      throw error;
    }
  }
  if (!target || !buffer) {
    const missing = new Error('No se encontró el archivo del documento en las ubicaciones actuales ni en el almacén histórico.');
    missing.code = 'ENOENT';
    if (lastMissing) missing.cause = lastMissing;
    throw missing;
  }
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  if (digest !== row.sha256) throw new Error('La integridad del documento no coincide con su huella SHA-256.');
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO supporting_document_events(document_id,event_type,details_json,actor_user_id,actor_username,created_at) VALUES(?,?,?,?,?,?)').run(id, 'ACCESSED', JSON.stringify({ sha256: digest }), actor.id ?? null, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('supporting_document_accessed', JSON.stringify({ documentId: id, companyId: row.company_id, entityType: row.entity_type, entityId: row.entity_id, actor: actor.username }));
  })();
  return { path: target, mimeType: path.extname(target) === '.pdf' ? 'application/pdf' : path.extname(target) === '.webp' ? 'image/webp' : path.extname(target) === '.png' ? 'image/png' : 'image/jpeg' };
}
function registerDocumentVaultIpc({ ipcMain, db, licenseView, getActiveSession, dialog, shell, app, getWindow, withDatabase = null }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      (withDatabase !== null && typeof withDatabase !== 'function')) {
    throw new Error('No se pudo registrar el repositorio documental.');
  }
  if (!withDatabase) initializeDocumentVaultSchema(db);
  const runWithDatabase = (token, operation) => withDatabase
    ? withDatabase(token, (activeDb, companyId) => operation(activeDb, companyId))
    : operation(db, null);
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida.');
    return actor;
  };
  ipcMain.handle('sicoven:document-attach', async (_event, token, input) => {
    const actor = authenticate(token);
    const userDataDir = app.getPath('userData');
    const attach = (activeDb, companyId, payload, buffer) => {
      if (companyId && String(payload?.companyId || '') !== companyId) throw new Error('El documento no pertenece a la empresa activa.');
      return attachDocument(activeDb, {
        trustedRoot: userDataDir,
        storageDir: path.join(userDataDir, 'companies', companyId || 'legacy', 'supporting-documents'),
        input: payload, buffer, actor
      });
    };
    try {
      const existing = await runWithDatabase(token, (activeDb, companyId) => attach(activeDb, companyId, input, null));
      return existing;
    } catch (error) {
      if (error?.code !== 'SICOVEN_DOCUMENT_SOURCE_REQUIRED') throw error;
    }
    const options = { title: 'Adjuntar o recuperar soporte documental en SICOVEN', properties: ['openFile'], filters: [{ name: 'Documentos admitidos', extensions: ['pdf','jpg','jpeg','png','webp'] }] };
    const parentWindow = getWindow?.();
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    restoreWindowFocus(parentWindow);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true, pending: Boolean(input?.operationId) };
    const source = selection.filePaths[0], stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > MAX_DOCUMENT_BYTES) {
      throw new Error('El archivo debe ser un archivo regular seguro de entre 1 byte y 20 MB.');
    }
    const buffer = fs.readFileSync(source);
    const payload = { ...(input || {}), fileName: path.basename(source) };
    return runWithDatabase(token, (activeDb, companyId) => attach(activeDb, companyId, payload, buffer));
  });
  ipcMain.handle('sicoven:document-list', (_event, token, filters) => {
    authenticate(token);
    return runWithDatabase(token, (activeDb, companyId) => {
      if (companyId && filters?.companyId && String(filters.companyId) !== companyId) throw new Error('La consulta documental no pertenece a la empresa activa.');
      return listDocuments(activeDb, { ...(filters || {}), ...(companyId ? { companyId } : {}) });
    });
  });
  ipcMain.handle('sicoven:document-review', (_event, token, input) => {
    const actor = authenticate(token);
    return runWithDatabase(token, (activeDb, companyId) => {
      const row = activeDb.prepare('SELECT company_id AS companyId FROM supporting_documents WHERE id=?').get(String(input?.documentId || ''));
      if (!row || (companyId && String(row.companyId) !== companyId)) throw new Error('El documento no pertenece a la empresa activa.');
      const identity = createOperationReceiptIdentity(input, row.companyId,
        'documents.review', operationRequest(input), actor);
      return runIdempotentOperation(activeDb, identity, () => reviewDocument(activeDb, input || {}, actor));
    });
  });
  ipcMain.handle('sicoven:document-open', async (_event, token, documentId) => {
    const actor = authenticate(token);
    const result = await runWithDatabase(token, (activeDb, companyId) => {
      const row = activeDb.prepare('SELECT company_id AS companyId FROM supporting_documents WHERE id=?').get(String(documentId || ''));
      if (!row || (companyId && String(row.companyId) !== companyId)) throw new Error('El documento no pertenece a la empresa activa.');
      const userDataDir = app.getPath('userData');
      const tenantId = companyId || 'legacy';
      return getDocument(activeDb, { trustedRoot: userDataDir, storageDirs: [
        path.join(userDataDir, 'companies', tenantId, 'supporting-documents'),
        path.join(userDataDir, 'supporting-documents', tenantId)
      ], documentId, actor });
    });
    const error = await shell.openPath(result.path);
    if (error) throw new Error('No se pudo abrir el documento: ' + error);
    return { ok: true };
  });
}
module.exports = { MAX_DOCUMENT_BYTES, initializeDocumentVaultSchema, assertNoSymlinkPath, assertLinkedEntity, normalizeDocument, attachDocument, listDocuments, reviewDocument, getDocument, registerDocumentVaultIpc };
