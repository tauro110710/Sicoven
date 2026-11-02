'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { appendRestoreOutcome, reconcileRestoreAudit, FILE } = require('./restore-audit-ledger.cjs');

const operationId = '123e4567-e89b-42d3-a456-426614174000';
const databaseSha256 = 'a'.repeat(64);

test('durable outcome ledger is idempotent and replays audit into SQLite', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-ledger-'));
  const db = new Database(path.join(root, 'sicoven.sqlite'));
  try {
    db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))");
    const first = appendRestoreOutcome({ userDataDir: root, operationId, actor: 'admin', outcome: 'RESTORE_COMMITTED', databaseSha256, documentCount: 2 });
    const duplicate = appendRestoreOutcome({ userDataDir: root, operationId, actor: 'admin', outcome: 'RESTORE_COMMITTED', databaseSha256, documentCount: 2 });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(fs.readFileSync(path.join(root, FILE), 'utf8').split('\n').filter(Boolean).length, 1);
    assert.equal(reconcileRestoreAudit({ db, userDataDir: root }).inserted, 1);
    assert.equal(reconcileRestoreAudit({ db, userDataDir: root }).inserted, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, 1);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('ledger refuses an incomplete final record', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-ledger-invalid-'));
  try {
    fs.writeFileSync(path.join(root, FILE), '{"broken":true}');
    assert.throws(() => require('./restore-audit-ledger.cjs').readRecords(path.join(root, FILE)), /registro incompleto/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
