'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createTenantRuntimeController } = require('./tenant-runtime-controller.cjs');

const token = 'a'.repeat(64);

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-controller-'));
  let controlDb = new Database(path.join(root, 'sicoven.sqlite'));
  let flushes = 0;
  const sessions = new Map([[token, { id: 1, username: 'admin', role: 'admin' }]]);
  const controller = createTenantRuntimeController({
    controlDb, userDataDir: root, Database, assertSqliteIntegrity,
    getActiveSession: value => sessions.get(value) || null,
    flushPendingWrites: async () => { flushes += 1; }
  });
  t.after(() => {
    try { controller.runtime.closeAll(); } catch {}
    try { if (controlDb.open) controlDb.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return {
    root, controller, sessions,
    get controlDb() { return controlDb; },
    replaceControlDb() {
      if (controlDb.open) controlDb.close();
      controlDb = new Database(path.join(root, 'sicoven.sqlite'));
      return controlDb;
    },
    get flushes() { return flushes; }
  };
}

test('uses the legacy control database only while no tenant registry exists', t => {
  const h = fixture(t);
  h.controlDb.exec('CREATE TABLE legacy_probe(value TEXT)');
  h.controlDb.prepare('INSERT INTO legacy_probe(value) VALUES(?)').run('legacy');
  const value = h.controller.withDatabase(token, db => db.prepare('SELECT value FROM legacy_probe').get().value);
  assert.equal(value, 'legacy');
});

test('routes authenticated operations to the selected tenant and never falls back after registration', async t => {
  const h = fixture(t);
  const company = { id: 'tenant-a', name: 'Empresa A', rif: 'J-12345678-9' };
  await h.controller.runtime.createCompany(company);
  await h.controller.companySessionContext.selectCompany(token, company.id, { skipFlush: true });
  const result = await h.controller.withDatabase(token, (db, companyId) => ({
    companyId,
    snapshot: JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json)
  }));
  assert.equal(result.companyId, company.id);
  assert.deepEqual(result.snapshot.companies.map(item => item.id), [company.id]);
  assert.equal(h.flushes, 0);
  assert.throws(() => h.controller.withDatabase('b'.repeat(64), () => true), /Sesión no válida|sesión expiró/i);
});

test('requires tenant selection once any company is registered instead of silently using the control database', async t => {
  const h = fixture(t);
  await h.controller.runtime.createCompany({ id: 'tenant-a', name: 'Empresa A', rif: 'J-12345678-9' });
  assert.throws(() => h.controller.withDatabase(token, () => true), /no tiene una empresa operativa seleccionada/);
});

test('rebinds the tenant registry to the restored control database without stale prepared statements', async t => {
  const h = fixture(t);
  const company = { id: 'tenant-a', name: 'Empresa A', rif: 'J-12345678-9' };
  await h.controller.runtime.createCompany(company);
  await h.controller.companySessionContext.selectCompany(token, company.id);
  h.controller.runtime.closeAll();
  const restoredControlDb = h.replaceControlDb();
  const result = h.controller.rebindControlDatabase(restoredControlDb);
  assert.deepEqual(result, { ok: true, companyCount: 1 });
  const snapshot = await h.controller.withDatabase(token, db =>
    JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json)
  );
  assert.deepEqual(snapshot.companies.map(item => item.id), [company.id]);
});


test('upgrades an existing v1 company database transactionally to the idempotent receipt schema', async t => {
  const h = fixture(t);
  const company = { id: 'tenant-v1-upgrade', name: 'Empresa migrada', rif: 'J-12345678-9' };
  await h.controller.runtime.createCompany(company);
  await h.controller.companySessionContext.selectCompany(token, company.id, { skipFlush: true });
  const original = await h.controller.withDatabase(token, db => ({
    snapshot: db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json,
    auditCount: db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n
  }));
  const filePath = h.controller.runtime.getCompanyDatabasePath(company.id);
  h.controller.runtime.closeCompany(company.id);
  const legacyDb = new Database(filePath);
  try {
    legacyDb.exec('DROP TABLE operation_receipts');
    legacyDb.prepare("UPDATE sicoven_database_meta SET meta_value='1' WHERE meta_key='schema_version'").run();
  } finally {
    legacyDb.close();
  }
  h.controlDb.prepare("UPDATE company_database_registry SET schema_version=1 WHERE company_id=?").run(company.id);

  const migrated = await h.controller.withDatabase(token, db => ({
    hasReceipts: Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='operation_receipts'").get()),
    schemaVersion: db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='schema_version'").get().meta_value,
    snapshot: db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json,
    auditCount: db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n
  }));
  const registryVersion = h.controlDb.prepare('SELECT schema_version FROM company_database_registry WHERE company_id=?').get(company.id).schema_version;
  assert.equal(migrated.hasReceipts, true);
  assert.equal(migrated.schemaVersion, '2');
  assert.equal(registryVersion, 2);
  assert.equal(migrated.snapshot, original.snapshot);
  assert.equal(migrated.auditCount, original.auditCount);
});
