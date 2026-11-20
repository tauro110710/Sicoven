'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');

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
