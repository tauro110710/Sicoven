'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createTenantRuntime } = require('./tenant-runtime.cjs');

function fixture(t) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-runtime-'));
  const controlDb = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  const runtime = createTenantRuntime({
    controlDb, userDataDir, Database, assertSqliteIntegrity
  });
  t.after(() => {
    try { runtime.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  return { runtime, controlDb };
}

test('keeps authentication/control database separate from company operational databases', async t => {
  const { runtime, controlDb } = fixture(t);
  controlDb.exec('CREATE TABLE control_probe(value TEXT)');
  controlDb.prepare('INSERT INTO control_probe(value) VALUES(?)').run('auth-remains-local');
  await runtime.createCompany({ id: 'runtime-a', name: 'Empresa A', rif: 'J-12345678-9' });
  const tenantDb = runtime.getCompanyDatabase('runtime-a');
  assert.notEqual(tenantDb.name, controlDb.name);
  assert.equal(controlDb.prepare('SELECT value FROM control_probe').get().value, 'auth-remains-local');
  assert.equal(tenantDb.prepare("SELECT state_key FROM app_state WHERE state_key='accounting'").get().state_key, 'accounting');
  assert.equal(runtime.listCompanies().length, 1);
});

test('does not overwrite or silently recreate an existing company database', async t => {
  const { runtime } = fixture(t);
  await runtime.createCompany({ id: 'runtime-b', name: 'Empresa B', rif: 'J-98765432-1' });
  await assert.rejects(
    () => runtime.createCompany({ id: 'runtime-b', name: 'Empresa B duplicada', rif: 'J-11111111-1' }),
    /ya está registrada/i
  );
  assert.equal(runtime.listCompanies().length, 1);
});

test('company operational writes remain isolated across local databases', async t => {
  const { runtime } = fixture(t);
  const a = { id: 'runtime-c', name: 'Empresa C', rif: 'J-12345678-9' };
  const b = { id: 'runtime-d', name: 'Empresa D', rif: 'J-98765432-1' };
  await runtime.createCompany(a);
  await runtime.createCompany(b);
  const dbA = runtime.getCompanyDatabase(a.id);
  const dbB = runtime.getCompanyDatabase(b.id);
  dbA.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
    .run(JSON.stringify({ companies: [a], currentCompanyId: a.id, accounts: [], sales: [{ id: 'sale-a', companyId: a.id }] }));
  assert.equal(JSON.parse(dbA.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json).sales.length, 1);
  assert.equal(JSON.parse(dbB.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json).sales.length, 0);
});

test('exposes explicit lifecycle methods and closes tenant connections without deleting files', async t => {
  const { runtime } = fixture(t);
  await runtime.createCompany({ id: 'runtime-e', name: 'Empresa E', rif: 'J-12345678-9' });
  const file = runtime.getCompanyDatabasePath('runtime-e');
  assert.equal(runtime.isCompanyOpen('runtime-e'), true);
  assert.equal(runtime.closeCompany('runtime-e'), true);
  assert.equal(runtime.isCompanyOpen('runtime-e'), false);
  assert.equal(fs.existsSync(file), true);
});
