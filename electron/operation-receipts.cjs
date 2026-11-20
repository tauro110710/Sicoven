'use strict';

const crypto = require('node:crypto');

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
  `);
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

function runIdempotentOperation(db, identity, execute) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('Se requiere SQLite para ejecutar una operación idempotente.');
  if (typeof execute !== 'function') throw new TypeError('La operación idempotente requiere una función síncrona.');
  const transaction = db.transaction(() => {
    const prior = findOperationReceipt(db, identity);
    if (prior.found) return prior.result;
    const result = execute();
    if (result && typeof result.then === 'function') throw new TypeError('Las operaciones idempotentes deben confirmar de forma síncrona dentro de una transacción SQLite.');
    recordOperationReceipt(db, identity, result);
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
  hashOperationRequest,
  findOperationReceipt,
  recordOperationReceipt,
  runIdempotentOperation
};
