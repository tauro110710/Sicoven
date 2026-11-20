'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase, migrateTenantDatabase } = require('./tenant-schema.cjs');

test('tenant schema initializes all operational tables without duplicating control authentication or license tables', () => {
  const db = new Database(':memory:');
  try {
    const first = initializeTenantDatabase(db);
    const second = initializeTenantDatabase(db);
    assert.deepEqual(first.operationalTables, second.operationalTables);
    const existing = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    for (const table of first.operationalTables) assert.ok(existing.has(table), 'missing tenant table ' + table);
    for (const controlTable of ['auth_users', 'auth_sessions', 'license_state']) {
      assert.equal(existing.has(controlTable), false, controlTable + ' must remain only in local control database');
    }
    const triggers = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row => row.name));
    assert.ok(triggers.has('audit_events_no_update'));
    assert.ok(triggers.has('audit_events_no_delete'));
    assert.ok(triggers.has('operation_receipts_no_update'));
    assert.ok(triggers.has('operation_receipts_no_delete'));
  } finally { db.close(); }
});

test('schema v2 to v3 creates durable operation intent tables for existing tenants', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE operation_receipts (
        company_id TEXT NOT NULL, operation_type TEXT NOT NULL, operation_id TEXT NOT NULL,
        request_hash TEXT NOT NULL, actor_user_id INTEGER NOT NULL, result_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(company_id,operation_type,operation_id)
      );
    `);
    migrateTenantDatabase(db, { fromVersion: 2, toVersion: 3 });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    assert.ok(tables.has('operation_intents'));
    assert.ok(tables.has('operation_intent_completions'));
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='operation_intents_actor_sequence_idx'").get());
  } finally { db.close(); }
});

test('schema v1 upgrades directly to v3 without requiring an intermediate application launch', () => {
  const db = new Database(':memory:');
  try {
    migrateTenantDatabase(db, { fromVersion: 1, toVersion: 3 });
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    assert.ok(tables.has('operation_receipts'));
    assert.ok(tables.has('operation_intents'));
    assert.ok(tables.has('operation_intent_completions'));
  } finally { db.close(); }
});

test('tenant audit log remains append-only after schema initialization', () => {
  const db = new Database(':memory:');
  try {
    initializeTenantDatabase(db);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('tenant_test', '{}');
    const id = db.prepare("SELECT id FROM audit_events WHERE event_type='tenant_test'").get().id;
    assert.throws(() => db.prepare('UPDATE audit_events SET details_json=? WHERE id=?').run('{"changed":true}', id), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM audit_events WHERE id=?').run(id), /append-only/);
  } finally { db.close(); }
});
