'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { registerTenantMigrationPreflightIpc, registerTenantMigrationExecuteIpc } = require('./tenant-migration-preflight-ipc.cjs');

function fixture(options = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER);
    CREATE TABLE license_state(id INTEGER PRIMARY KEY,status TEXT);
  `);
  const { REQUIRED_RELATIONAL_TABLES } = require('./tenant-migration-preflight.cjs');
  for (const table of REQUIRED_RELATIONAL_TABLES) db.exec('CREATE TABLE "' + table + '" (id TEXT PRIMARY KEY)');
  db.prepare('INSERT INTO app_state VALUES(?,?,?)').run(
    'accounting',
    JSON.stringify({ companies: [{ id: 'company-a', rif: 'J-12345678-9', name: 'Empresa A' }] }),
    '2026-11-08'
  );
  const handlers = new Map();
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
  const licenseView = options.licenseView || (() => ({ authorized: true }));
  const getActiveSession = options.getActiveSession || (() => ({ id: 1, username: 'contador', role: 'contador' }));
  registerTenantMigrationPreflightIpc({ ipcMain, db, licenseView, getActiveSession });
  return { db, handlers };
}

test('exposes an authenticated read-only preflight without changing the legacy database', () => {
  const { db, handlers } = fixture();
  try {
    const before = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    const result = handlers.get('sicoven:tenant-migration-preflight')({}, 'valid-session');
    const after = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.migrationStarted, false);
    assert.equal(result.sourceDatabase, 'sicoven.sqlite');
    assert.deepEqual(result.companyIds, ['company-a']);
    assert.deepEqual(after, before);
  } finally { db.close(); }
});

test('rejects requests without an authorized license', () => {
  const { db, handlers } = fixture({ licenseView: () => ({ authorized: false, message: 'Licencia vencida.' }) });
  try {
    assert.throws(
      () => handlers.get('sicoven:tenant-migration-preflight')({}, 'token'),
      /Licencia vencida/
    );
  } finally { db.close(); }
});

test('rejects missing or non-accounting sessions', () => {
  for (const session of [null, { id: 2, username: 'invitado', role: 'viewer' }]) {
    const { db, handlers } = fixture({ getActiveSession: () => session });
    try {
      assert.throws(
        () => handlers.get('sicoven:tenant-migration-preflight')({}, 'token'),
        /sesión contable autenticada/
      );
    } finally { db.close(); }
  }
});

test('returns blockers without attempting migration when the legacy snapshot is ambiguous', () => {
  const { db, handlers } = fixture();
  try {
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify({ companies: [] }));
    const result = handlers.get('sicoven:tenant-migration-preflight')({}, 'valid-session');
    assert.equal(result.ok, false);
    assert.equal(result.readOnly, true);
    assert.equal(result.migrationStarted, false);
    assert.match(result.errors.join(' '), /No hay empresas/);
  } finally { db.close(); }
});


test('executes migration only after authenticated preflight and an exclusive maintenance lock', async () => {
  const { db, handlers } = fixture();
  let lockAcquired = 0;
  let lockReleased = 0;
  let migrationCalls = 0;
  const runtime = {
    migrateLegacyDatabase: async options => {
      migrationCalls += 1;
      const release = await options.acquireMaintenanceLock();
      lockAcquired += 1;
      try { return { ok: true, phase: 'COMMITTED', companies: [{ companyId: 'company-a' }] }; }
      finally { release(); lockReleased += 1; }
    }
  };
  const operationContext = {
    acquireMaintenanceLock: async () => () => {}
  };
  registerTenantMigrationExecuteIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    db, runtime, operationContext,
    licenseView: () => ({ authorized: true }),
    getActiveSession: () => ({ id: 1, username: 'contador', role: 'contador' })
  });
  try {
    const result = await handlers.get('sicoven:tenant-migration-execute')({}, 'valid-session');
    assert.equal(result.phase, 'COMMITTED');
    assert.equal(result.sourcePreserved, true);
    assert.equal(result.globalBackupRestoreRetained, true);
    assert.equal(migrationCalls, 1);
    assert.equal(lockAcquired, 1);
    assert.equal(lockReleased, 1);
  } finally { db.close(); }
});

test('does not start migration without an authorized accounting session', async () => {
  const { db, handlers } = fixture();
  let migrationCalls = 0;
  registerTenantMigrationExecuteIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    db,
    runtime: { migrateLegacyDatabase: async () => { migrationCalls += 1; return { ok: true }; } },
    operationContext: { acquireMaintenanceLock: async () => () => {} },
    licenseView: () => ({ authorized: true }),
    getActiveSession: () => null
  });
  try {
    await assert.rejects(
      handlers.get('sicoven:tenant-migration-execute')({}, 'invalid-session'),
      /sesión contable autenticada/
    );
    assert.equal(migrationCalls, 0);
  } finally { db.close(); }
});
