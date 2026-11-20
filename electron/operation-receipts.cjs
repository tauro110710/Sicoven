'use strict';

const crypto = require('node:crypto');

const DURABLE_OPERATION_TYPES = Object.freeze({
  'sicoven:audit-record-correction': 'accounting.audit_correction',
  'sicoven:correction-case-create': 'accounting.correction_case_create',
  'sicoven:correction-case-authorize': 'accounting.correction_case_authorize',
  'sicoven:correction-case-execute': 'accounting.correction_case_execute',
  'sicoven:reopen-accounting-period': 'accounting.reopen_period',
  'sicoven:reopen-accounting-year': 'accounting.reopen_year',
  'sicoven:inflation-index-import': 'inflation.index_import',
  'sicoven:inflation-index-review': 'inflation.index_review',
  'sicoven:inflation-classification-save': 'inflation.classification_save',
  'sicoven:inflation-classification-review': 'inflation.classification_review',
  'sicoven:inflation-source-dossier-create': 'inflation.source_dossier_create',
  'sicoven:inflation-source-dossier-review': 'inflation.source_dossier_review',
  'sicoven:document-review': 'documents.review',
  'sicoven:payroll-employee-save': 'payroll.employee_save',
  'sicoven:payroll-severance-deposit-save': 'payroll.severance_deposit',
  'sicoven:payroll-severance-interest-save': 'payroll.severance_interest',
  'sicoven:payroll-liquidation-create': 'payroll.liquidation_create',
  'sicoven:payroll-run-create': 'payroll.run_create',
  'sicoven:payroll-run-confirm': 'payroll.run_confirm',
  'sicoven:payroll-rule-save': 'payroll.rule_save',
  'sicoven:vat-fiscal-incident-create': 'fiscal.vat_incident_create',
  'sicoven:vat-fiscal-incident-event': 'fiscal.vat_incident_event'
});

function initializeOperationReceiptSchema(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new TypeError('Se requiere SQLite para inicializar el registro de operaciones idempotentes.');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS operation_receipts (
      operation_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_username TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(company_id, operation_type, operation_id)
    );
    CREATE INDEX IF NOT EXISTS operation_receipts_company_created_idx
      ON operation_receipts(company_id, created_at);
    CREATE TRIGGER IF NOT EXISTS operation_receipts_no_update
      BEFORE UPDATE ON operation_receipts
      BEGIN SELECT RAISE(ABORT, 'operation_receipts is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS operation_receipts_no_delete
      BEFORE DELETE ON operation_receipts
      BEGIN SELECT RAISE(ABORT, 'operation_receipts is append-only'); END;
    CREATE TABLE IF NOT EXISTS operation_intents (
      operation_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      ipc_channel TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      request_mode TEXT NOT NULL CHECK(request_mode IN ('object','payroll-run-confirm')),
      request_hash TEXT NOT NULL,
      request_json TEXT NOT NULL,
      actor_user_id INTEGER NOT NULL,
      actor_username TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(company_id, operation_id)
    );
    CREATE INDEX IF NOT EXISTS operation_intents_company_created_idx
      ON operation_intents(company_id, created_at);
    CREATE TABLE IF NOT EXISTS operation_intent_completions (
      company_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      operation_type TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(company_id, operation_id),
      FOREIGN KEY(company_id, operation_id)
        REFERENCES operation_intents(company_id, operation_id)
    );
    CREATE TRIGGER IF NOT EXISTS operation_intents_no_update
      BEFORE UPDATE ON operation_intents
      BEGIN SELECT RAISE(ABORT, 'operation_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS operation_intents_no_delete
      BEFORE DELETE ON operation_intents
      BEGIN SELECT RAISE(ABORT, 'operation_intents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS operation_intent_completions_no_update
      BEFORE UPDATE ON operation_intent_completions
      BEGIN SELECT RAISE(ABORT, 'operation_intent_completions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS operation_intent_completions_no_delete
      BEFORE DELETE ON operation_intent_completions
      BEGIN SELECT RAISE(ABORT, 'operation_intent_completions is append-only'); END;
  `);
}

function createOperationReceiptIdentity(input, companyId, operationType, request, actor) {
  const operationId = String(input?.operationId || '').trim();
  if (!operationId) throw new Error('Falta el identificador estable de la operación. Actualice SICOVEN e inténtelo nuevamente.');
  const serialized = JSON.stringify(request);
  if (typeof serialized !== 'string') throw new TypeError('La solicitud idempotente no se pudo serializar.');
  return {
    operationId,
    companyId: String(companyId || '').trim(),
    operationType,
    requestHash: hashOperationRequest(serialized),
    actor
  };
}

function hashOperationRequest(serializedRequest) {
  if (typeof serializedRequest !== 'string') {
    throw new TypeError('La solicitud idempotente debe estar serializada como texto.');
  }
  return crypto.createHash('sha256').update(serializedRequest, 'utf8').digest('hex');
}

function normalizeOperationIdentity({ operationId, companyId, operationType, requestHash, actor }) {
  const normalized = {
    operationId: String(operationId || '').trim(),
    companyId: String(companyId || '').trim(),
    operationType: String(operationType || '').trim(),
    requestHash: String(requestHash || '').trim(),
    actorUserId: actor?.id == null ? null : Number(actor.id),
    actorUsername: actor?.username == null ? null : String(actor.username)
  };
  if (!normalized.operationId || normalized.operationId.length > 128 ||
      !normalized.companyId || normalized.companyId.length > 120 ||
      !/^[a-z][a-z0-9_.-]{1,79}$/i.test(normalized.operationType) ||
      !/^[a-f0-9]{64}$/i.test(normalized.requestHash) ||
      (normalized.actorUserId !== null && !Number.isSafeInteger(normalized.actorUserId))) {
    throw new TypeError('La identidad de la operación idempotente no es válida.');
  }
  return normalized;
}

function findOperationReceipt(db, input) {
  const identity = normalizeOperationIdentity(input);
  const row = db.prepare(`
    SELECT request_hash,result_json,actor_user_id
    FROM operation_receipts
    WHERE company_id=? AND operation_type=? AND operation_id=?
  `).get(identity.companyId, identity.operationType, identity.operationId);
  if (!row) return { found: false };
  if (String(row.request_hash) !== identity.requestHash ||
      (row.actor_user_id == null ? null : Number(row.actor_user_id)) !== identity.actorUserId) {
    throw new Error('La clave de operación ya fue utilizada con otros datos o por otro usuario; se bloqueó el reintento.');
  }
  let result;
  try { result = JSON.parse(row.result_json); }
  catch { throw new Error('El resultado original de la operación idempotente es ilegible; se bloqueó el reintento.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('El resultado original de la operación idempotente no es válido.');
  }
  return { found: true, result: { ...result, replayed: true } };
}

function normalizeIntentActor(actor) {
  const userId = Number(actor?.id);
  const username = String(actor?.username || '').trim();
  if (!Number.isSafeInteger(userId) || userId <= 0 || !username || username.length > 120) {
    throw new Error('La sesión no contiene una identidad válida para registrar la intención de la operación.');
  }
  return { userId, username };
}

function prepareOperationIntent(db, input, companyId, actor) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Se requiere SQLite para preparar una operación recuperable.');
  const operationId = String(input?.operationId || '').trim();
  const channel = String(input?.channel || '').trim();
  const requestMode = String(input?.requestMode || 'object');
  const selectedCompanyId = String(companyId || '').trim();
  const request = input?.request;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(operationId) || !selectedCompanyId || selectedCompanyId.length > 120 ||
      !Object.prototype.hasOwnProperty.call(DURABLE_OPERATION_TYPES, channel) ||
      !['object','payroll-run-confirm'].includes(requestMode) ||
      !request || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('La intención de operación no contiene una identidad, canal o solicitud válida.');
  }
  if (requestMode === 'payroll-run-confirm' &&
      (channel !== 'sicoven:payroll-run-confirm' || !String(request.runId || '').trim() || !String(request.journalEntryId || '').trim())) {
    throw new TypeError('La confirmación de nómina requiere un borrador y un asiento identificables.');
  }
  if (requestMode === 'object' && channel === 'sicoven:payroll-run-confirm') {
    throw new TypeError('La confirmación de nómina requiere el formato de argumentos específico.');
  }
  if (request.companyId != null && String(request.companyId) !== selectedCompanyId) {
    throw new Error('La intención no pertenece a la empresa activa.');
  }
  const serialized = JSON.stringify(request);
  if (typeof serialized !== 'string' || serialized.length > 1024 * 1024) {
    throw new Error('La solicitud pendiente supera el límite permitido de almacenamiento local.');
  }
  const requestHash = hashOperationRequest(serialized);
  const identity = normalizeIntentActor(actor);
  const existing = db.prepare(`
    SELECT request_hash,ipc_channel,operation_type,request_mode,actor_user_id,actor_username
    FROM operation_intents WHERE company_id=? AND operation_id=?
  `).get(selectedCompanyId, operationId);
  if (existing) {
    if (String(existing.request_hash) !== requestHash ||
        String(existing.ipc_channel) !== channel ||
        String(existing.operation_type) !== DURABLE_OPERATION_TYPES[channel] ||
        String(existing.request_mode) !== requestMode ||
        Number(existing.actor_user_id) !== identity.userId ||
        String(existing.actor_username) !== identity.username) {
      throw new Error('La clave de operación pendiente ya está asociada a otra solicitud, canal, empresa o usuario.');
    }
    const completed = db.prepare(`
      SELECT 1 AS found FROM operation_intent_completions
      WHERE company_id=? AND operation_id=?
    `).get(selectedCompanyId, operationId);
    return { ok: true, operationId, prepared: !completed, completed: Boolean(completed), replayed: true };
  }
  db.prepare(`
    INSERT INTO operation_intents
      (operation_id,company_id,ipc_channel,operation_type,request_mode,request_hash,request_json,actor_user_id,actor_username)
    VALUES(?,?,?,?,?,?,?,?,?)
  `).run(operationId, selectedCompanyId, channel, DURABLE_OPERATION_TYPES[channel], requestMode, requestHash, serialized, identity.userId, identity.username);
  return { ok: true, operationId, prepared: true, completed: false };
}

function listPendingOperationIntents(db, companyId, actor) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Se requiere SQLite para consultar operaciones pendientes.');
  const selectedCompanyId = String(companyId || '').trim();
  const identity = normalizeIntentActor(actor);
  const rows = db.prepare(`
    SELECT i.operation_id,i.ipc_channel,i.request_mode,i.request_hash,i.request_json
    FROM operation_intents i
    LEFT JOIN operation_intent_completions c
      ON c.company_id=i.company_id AND c.operation_id=i.operation_id
    WHERE i.company_id=? AND i.actor_user_id=? AND i.actor_username=? AND c.operation_id IS NULL
    ORDER BY i.created_at,i.operation_id
  `).all(selectedCompanyId, identity.userId, identity.username);
  return rows.map(row => {
    if (!Object.prototype.hasOwnProperty.call(DURABLE_OPERATION_TYPES, String(row.ipc_channel))) {
      throw new Error('Existe una operación pendiente con un canal no reconocido; se bloqueó su recuperación automática.');
    }
    let request;
    try { request = JSON.parse(row.request_json); }
    catch { throw new Error('Una operación pendiente contiene una solicitud ilegible; se bloqueó su recuperación automática.'); }
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        hashOperationRequest(JSON.stringify(request)) !== String(row.request_hash)) {
      throw new Error('Una operación pendiente contiene una solicitud inválida o alterada; se bloqueó su recuperación automática.');
    }
    return {
      operationId: String(row.operation_id),
      channel: String(row.ipc_channel),
      requestMode: String(row.request_mode),
      request
    };
  });
}

function completeOperationIntent(db, identityInput) {
  const identity = normalizeOperationIdentity(identityInput);
  const table = db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name='operation_intents'").get();
  if (!table) return false;
  const intent = db.prepare(`
    SELECT operation_type,actor_user_id,actor_username
    FROM operation_intents WHERE company_id=? AND operation_id=?
  `).get(identity.companyId, identity.operationId);
  if (!intent) return false;
  // El recibo valida el hash de negocio. La intención conserva el hash de la
  // solicitud original del renderer, que puede diferir tras normalizaciones
  // legítimas aplicadas por el handler antes de crear el recibo.
  if (String(intent.operation_type) !== identity.operationType ||
      Number(intent.actor_user_id) !== identity.actorUserId ||
      String(intent.actor_username) !== String(identity.actorUsername || '')) {
    throw new Error('La operación confirmada no coincide con el tipo o el usuario de la intención durable.');
  }
  const existing = db.prepare(`
    SELECT 1 AS found FROM operation_intent_completions
    WHERE company_id=? AND operation_id=?
  `).get(identity.companyId, identity.operationId);
  if (!existing) {
    db.prepare(`
      INSERT INTO operation_intent_completions(company_id,operation_id,operation_type)
      VALUES(?,?,?)
    `).run(identity.companyId, identity.operationId, identity.operationType);
  }
  return true;
}

function registerOperationIntentIpc({ ipcMain, licenseView, getActiveSession, withDatabase }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      typeof withDatabase !== 'function') {
    throw new TypeError('No se pudo registrar el IPC de recuperación durable de operaciones.');
  }
  function authenticate(token) {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida. Inicie sesión nuevamente.');
    return actor;
  }
  ipcMain.handle('sicoven:operation-intent-prepare', (_event, token, input) => {
    const actor = authenticate(token);
    return withDatabase(token, (db, companyId) => prepareOperationIntent(db, input, companyId, actor));
  });
  ipcMain.handle('sicoven:operation-intent-list', (_event, token) => {
    const actor = authenticate(token);
    return withDatabase(token, (db, companyId) => listPendingOperationIntents(db, companyId, actor));
  });
}

function runIdempotentOperation(db, identity, execute) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('Se requiere SQLite para ejecutar una operación idempotente.');
  if (typeof execute !== 'function') throw new TypeError('La operación idempotente requiere una función síncrona.');
  const transaction = db.transaction(() => {
    const prior = findOperationReceipt(db, identity);
    if (prior.found) {
      completeOperationIntent(db, identity);
      return prior.result;
    }
    const result = execute();
    if (result && typeof result.then === 'function') throw new TypeError('Las operaciones idempotentes deben confirmar de forma síncrona dentro de una transacción SQLite.');
    if (result && typeof result === 'object' && result.ok === false) return result;
    recordOperationReceipt(db, identity, result);
    completeOperationIntent(db, identity);
    return result;
  });
  return transaction();
}

function recordOperationReceipt(db, input, result) {
  const identity = normalizeOperationIdentity(input);
  if (!result || typeof result !== 'object' || Array.isArray(result) ||
      typeof result.then === 'function') {
    throw new TypeError('El resultado idempotente debe ser un objeto síncrono serializable.');
  }
  const resultJson = JSON.stringify(result);
  if (typeof resultJson !== 'string' || resultJson.length > 1024 * 1024) {
    throw new Error('El resultado de la operación supera el límite permitido.');
  }
  db.prepare(`
    INSERT INTO operation_receipts
      (operation_id,company_id,operation_type,request_hash,result_json,actor_user_id,actor_username)
    VALUES(?,?,?,?,?,?,?)
  `).run(identity.operationId, identity.companyId, identity.operationType,
    identity.requestHash, resultJson, identity.actorUserId, identity.actorUsername);
}

module.exports = {
  initializeOperationReceiptSchema,
  createOperationReceiptIdentity,
  prepareOperationIntent,
  listPendingOperationIntents,
  registerOperationIntentIpc,
  hashOperationRequest,
  findOperationReceipt,
  recordOperationReceipt,
  runIdempotentOperation
};
