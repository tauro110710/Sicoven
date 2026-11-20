'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  initializeOperationReceiptSchema, hashOperationRequest, runIdempotentOperation
} = require('./operation-receipts.cjs');

function setup() {
  const db = new Database(':memory:');
  initializeOperationReceiptSchema(db);
  return db;
}
function identity(operationId = 'operation-001', request = { amount: 12 }) {
  return {
    operationId, companyId: 'company-1', operationType: 'accounting.test_operation',
    requestHash: hashOperationRequest(JSON.stringify(request)),
    actor: { id: 7, username: 'contador' }
  };
}

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
