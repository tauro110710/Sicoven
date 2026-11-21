'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  initializeOperationReceiptSchema, createOperationReceiptIdentity, hashOperationRequest, runIdempotentOperation,
  prepareOperationIntent, listPendingOperationIntents, registerOperationIntentIpc, recordOperationReceipt
} = require('./operation-receipts.cjs');

function setup() {
  const db = new Database(':memory:');
  initializeOperationReceiptSchema(db);
  return db;
}
function identity(operationId = 'operation-001', request = { amount: 12 }) {
  return {
    operationId, companyId: 'company-1', operationType: 'accounting.audit_correction',
    requestHash: hashOperationRequest(JSON.stringify(request)),
    actor: { id: 7, username: 'contador' }
  };
}

test('operation identity requires a caller-supplied stable ID and binds company, type, request and actor', () => {
  const actor = { id: 7, username: 'contador' };
  assert.throws(() => createOperationReceiptIdentity({}, 'company-1', 'accounting.test_operation', { amount: 12 }, actor),
    /Falta el identificador estable/);
  const identity = createOperationReceiptIdentity(
    { operationId: 'stable-001' }, 'company-1', 'accounting.test_operation', { amount: 12 }, actor
  );
  assert.equal(identity.operationId, 'stable-001');
  assert.equal(identity.companyId, 'company-1');
  assert.equal(identity.operationType, 'accounting.test_operation');
  assert.equal(identity.requestHash, hashOperationRequest(JSON.stringify({ amount: 12 })));
  assert.deepEqual(identity.actor, actor);
});

test('atomic operation receipt returns the original result without repeating effects', () => {
  const db = setup();
  try {
    db.exec('CREATE TABLE effects(id TEXT PRIMARY KEY)');
    let executions = 0;
    const key = identity();
    const execute = () => {
      executions += 1;
      db.prepare('INSERT INTO effects(id) VALUES(?)').run('effect-1');
      return { ok: true, resultId: 'effect-1' };
    };
    const first = runIdempotentOperation(db, key, execute);
    const retry = runIdempotentOperation(db, key, execute);
    assert.deepEqual(first, { ok: true, resultId: 'effect-1' });
    assert.deepEqual(retry, { ok: true, resultId: 'effect-1', replayed: true });
    assert.equal(executions, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM effects').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 1);
  } finally { db.close(); }
});

test('operation receipt and business effect roll back together on failure', () => {
  const db = setup();
  try {
    db.exec('CREATE TABLE effects(id TEXT PRIMARY KEY)');
    assert.throws(() => runIdempotentOperation(db, identity(), () => {
      db.prepare('INSERT INTO effects(id) VALUES(?)').run('effect-failed');
      throw new Error('interrupted before commit');
    }), /interrupted before commit/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM effects').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 0);
  } finally { db.close(); }
});

test('rejected business results do not create a success receipt', () => {
  const db = setup();
  try {
    const result = runIdempotentOperation(db, identity(), () => ({ ok: false, message: 'rejected' }));
    assert.deepEqual(result, { ok: false, message: 'rejected' });
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 0);
  } finally { db.close(); }
});

test('operation key cannot be reused for another request or actor', () => {
  const db = setup();
  try {
    const key = identity();
    runIdempotentOperation(db, key, () => ({ ok: true, id: 'original' }));
    assert.throws(() => runIdempotentOperation(db, identity('operation-001', { amount: 13 }), () => ({ ok: true, id: 'other' })),
      /ya fue utilizada con otros datos/);
    assert.throws(() => runIdempotentOperation(db, { ...key, actor: { id: 8, username: 'otro' } }, () => ({ ok: true })),
      /ya fue utilizada con otros datos/);
  } finally { db.close(); }
});


const durableActor = { id: 7, username: 'contador' };
const durableRequest = { amount: 12, reference: 'REC-001' };
function durableIntent(operationId = 'durable-001', request = durableRequest) {
  return {
    operationId,
    channel: 'sicoven:audit-record-correction',
    requestMode: 'object',
    request
  };
}

test('pending operation intent survives closing and reopening the tenant SQLite database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-operation-intents-'));
  const databasePath = path.join(directory, 'tenant.sqlite');
  let db = new Database(databasePath);
  try {
    initializeOperationReceiptSchema(db);
    const prepared = prepareOperationIntent(db, durableIntent(), 'company-1', durableActor);
    assert.equal(prepared.prepared, true);
    db.close();
    db = new Database(databasePath);
    initializeOperationReceiptSchema(db);
    assert.deepEqual(listPendingOperationIntents(db, 'company-1', durableActor), [{
      operationId: 'durable-001',
      channel: 'sicoven:audit-record-correction',
      requestMode: 'object',
      request: durableRequest
    }]);
    let effectCalls = 0;
    const recovered = runIdempotentOperation(db, {
      operationId: 'durable-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(durableRequest)),
      actor: durableActor
    }, () => {
      effectCalls += 1;
      return { ok: true, id: 'recovered-after-restart' };
    });
    assert.equal(recovered.id, 'recovered-after-restart');
    assert.equal(effectCalls, 1);
    assert.deepEqual(listPendingOperationIntents(db, 'company-1', durableActor), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 1);
    db.close();
    db = new Database(databasePath);
    initializeOperationReceiptSchema(db);
    const afterLostReply = runIdempotentOperation(db, {
      operationId: 'durable-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(durableRequest)),
      actor: durableActor
    }, () => {
      effectCalls += 1;
      return { ok: true, id: 'must-not-run-twice' };
    });
    assert.equal(afterLostReply.id, 'recovered-after-restart');
    assert.equal(afterLostReply.replayed, true);
    assert.equal(effectCalls, 1);
  } finally {
    if (db.open) db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('successful receipt and durable intent completion commit together', () => {
  const db = setup();
  try {
    const request = { amount: 12, reference: 'REC-001' };
    prepareOperationIntent(db, durableIntent('durable-commit-001', request), 'company-1', durableActor);
    const normalizedBusinessRequest = { ...request, normalizedByHandler: true };
    const key = {
      operationId: 'durable-commit-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(normalizedBusinessRequest)),
      actor: durableActor
    };
    const result = runIdempotentOperation(db, key, () => ({ ok: true, id: 'saved-1' }));
    assert.equal(result.id, 'saved-1');
    assert.deepEqual(listPendingOperationIntents(db, 'company-1', durableActor), []);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_intent_completions').get().count, 1);
  } finally { db.close(); }
});

test('failed business transaction leaves the durable intent pending for recovery', () => {
  const db = setup();
  try {
    const request = { amount: 12, reference: 'REC-001' };
    prepareOperationIntent(db, durableIntent('durable-failed-001', request), 'company-1', durableActor);
    const key = {
      operationId: 'durable-failed-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(request)),
      actor: durableActor
    };
    assert.throws(() => runIdempotentOperation(db, key, () => {
      throw new Error('interrupted before commit');
    }), /interrupted before commit/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_intent_completions').get().count, 0);
    assert.equal(listPendingOperationIntents(db, 'company-1', durableActor).length, 1);
  } finally { db.close(); }
});

test('recovery reconciles an existing receipt without re-executing the business handler', () => {
  const db = setup();
  try {
    const request = { amount: 12, reference: 'REC-001' };
    prepareOperationIntent(db, durableIntent('durable-receipt-only-001', request), 'company-1', durableActor);
    const key = {
      operationId: 'durable-receipt-only-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(request)),
      actor: durableActor
    };
    // Simulate interruption after the receipt was persisted but before any
    // intent-completion marker was written.
    recordOperationReceipt(db, key, { ok: true, id: 'already-committed' });
    assert.equal(listPendingOperationIntents(db, 'company-1', durableActor).length, 1);
    let businessHandlerCalls = 0;
    const reconciled = runIdempotentOperation(db, key, () => {
      businessHandlerCalls += 1;
      return { ok: true, id: 'must-not-run' };
    });
    assert.deepEqual(reconciled, { ok: true, id: 'already-committed', replayed: true });
    assert.equal(businessHandlerCalls, 0);
    assert.equal(listPendingOperationIntents(db, 'company-1', durableActor).length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_intent_completions').get().count, 1);
  } finally { db.close(); }
});

test('intent completion failure rolls back the receipt and business effect', () => {
  const db = setup();
  try {
    db.exec('CREATE TABLE effects(id TEXT PRIMARY KEY)');
    const request = { amount: 12, reference: 'REC-001' };
    prepareOperationIntent(db, durableIntent('durable-rollback-001', request), 'company-1', durableActor);
    db.exec(`CREATE TRIGGER fail_intent_completion BEFORE INSERT ON operation_intent_completions
      BEGIN SELECT RAISE(ABORT, 'completion interrupted'); END;`);
    const key = {
      operationId: 'durable-rollback-001',
      companyId: 'company-1',
      operationType: 'accounting.audit_correction',
      requestHash: hashOperationRequest(JSON.stringify(request)),
      actor: durableActor
    };
    assert.throws(() => runIdempotentOperation(db, key, () => {
      db.prepare('INSERT INTO effects(id) VALUES(?)').run('effect-1');
      return { ok: true, id: 'effect-1' };
    }), /completion interrupted/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM effects').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 0);
    assert.equal(listPendingOperationIntents(db, 'company-1', durableActor).length, 1);
  } finally { db.close(); }
});

test('a receipt from another operation type cannot complete a prepared intent', () => {
  const db = setup();
  try {
    const request = { amount: 12, reference: 'REC-001' };
    prepareOperationIntent(db, durableIntent('durable-type-mismatch-001', request), 'company-1', durableActor);
    const wrongType = {
      operationId: 'durable-type-mismatch-001',
      companyId: 'company-1',
      operationType: 'accounting.correction_case_create',
      requestHash: hashOperationRequest(JSON.stringify(request)),
      actor: durableActor
    };
    assert.throws(() => runIdempotentOperation(db, wrongType, () => ({ ok: true, id: 'wrong' })),
      /no coincide con el tipo o el usuario/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 0);
    assert.equal(listPendingOperationIntents(db, 'company-1', durableActor).length, 1);
  } finally { db.close(); }
});

test('payroll confirmation intent preserves its positional request shape', () => {
  const db = setup();
  try {
    const request = { runId: 'payroll-run-1', journalEntryId: 'journal-1' };
    prepareOperationIntent(db, {
      operationId: 'payroll-confirm-001',
      channel: 'sicoven:payroll-run-confirm',
      requestMode: 'payroll-run-confirm',
      request
    }, 'company-1', durableActor);
    assert.deepEqual(listPendingOperationIntents(db, 'company-1', durableActor), [{
      operationId: 'payroll-confirm-001',
      channel: 'sicoven:payroll-run-confirm',
      requestMode: 'payroll-run-confirm',
      request
    }]);
  } finally { db.close(); }
});

test('intent keys cannot be reused across requests, channels or actors', () => {
  const db = setup();
  try {
    prepareOperationIntent(db, durableIntent(), 'company-1', durableActor);
    assert.throws(() => prepareOperationIntent(db,
      durableIntent('durable-001', { amount: 13, reference: 'REC-001' }), 'company-1', durableActor),
    /ya está asociada/);
    assert.throws(() => prepareOperationIntent(db,
      { ...durableIntent(), channel: 'sicoven:untrusted-write' }, 'company-1', durableActor),
    /no contiene una identidad/);
    assert.throws(() => prepareOperationIntent(db, durableIntent(), 'company-1',
      { id: 8, username: 'otro' }), /ya está asociada/);
    assert.equal(listPendingOperationIntents(db, 'company-1', { id: 8, username: 'otro' }).length, 0);
    assert.equal(listPendingOperationIntents(db, 'company-1', { id: 7, username: 'contador-renombrado' }).length, 1);
    assert.equal(prepareOperationIntent(db, durableIntent(), 'company-1',
      { id: 7, username: 'contador-renombrado' }).replayed, true);
  } finally { db.close(); }
});

test('durable operation intent IPC requires a valid license and authenticated tenant session', () => {
  const db = setup();
  const handlers = new Map();
  try {
    registerOperationIntentIpc({
      ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
      licenseView: () => ({ authorized: true }),
      getActiveSession: token => token === 'valid' ? durableActor : null,
      withDatabase: (_token, operation) => operation(db, 'company-1')
    });
    assert.throws(() => handlers.get('sicoven:operation-intent-prepare')({}, 'bad', {
      ...durableIntent(), operationId: 'ipc-intent-001'
    }), /Sesión no válida/);
    assert.equal(handlers.get('sicoven:operation-intent-prepare')({}, 'valid', {
      ...durableIntent(), operationId: 'ipc-intent-001'
    }).prepared, true);
    assert.equal(handlers.get('sicoven:operation-intent-list')({}, 'valid').length, 1);
  } finally { db.close(); }
});
