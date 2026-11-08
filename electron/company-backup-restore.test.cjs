'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createTenantRuntime } = require('./tenant-runtime.cjs');
const {
  createCompanyBackup,
  verifyCompanyBackupDirectory,
  restoreCompanyBackup
} = require('./company-backup-restore.cjs');

function fixture(t) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-company-backup-'));
  const controlDb = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  const runtime = createTenantRuntime({ controlDb, userDataDir, Database, assertSqliteIntegrity });
  const company = { id: 'backup-company-a', name: 'Empresa de prueba', rif: 'J-12345678-9' };
  t.after(() => {
    try { runtime.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  return { userDataDir, controlDb, runtime, company };
}

test('creates a verifiable backup bound to exactly one company identity', async t => {
  const { userDataDir, runtime, company } = fixture(t);
  await runtime.createCompany(company);
  const db = runtime.getCompanyDatabase(company.id);
  const destination = path.join(os.tmpdir(), 'sicoven-company-backup-output-' + Date.now() + '-' + Math.random());
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  const result = await createCompanyBackup({ db, company, userDataDir, destination });
  assert.equal(result.ok, true);
  const verified = verifyCompanyBackupDirectory(destination, { Database, assertSqliteIntegrity });
  assert.equal(verified.manifest.companyId, company.id);
  assert.equal(verified.manifest.rif, company.rif);
  assert.equal(verified.manifest.documents.length, 0);
});

test('rejects a backup assigned to a different company before changing data', async t => {
  const { userDataDir, runtime, company } = fixture(t);
  await runtime.createCompany(company);
  const destination = path.join(os.tmpdir(), 'sicoven-company-backup-mismatch-' + Date.now() + '-' + Math.random());
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  await createCompanyBackup({ db: runtime.getCompanyDatabase(company.id), company, userDataDir, destination });
  const operationContext = { acquireMaintenanceLock: async () => () => {} };
  await assert.rejects(
    () => restoreCompanyBackup({
      directory: destination, companyId: 'another-company', runtime, operationContext,
      userDataDir, Database, assertSqliteIntegrity
    }),
    /pertenece a otra empresa/i
  );
  assert.equal(runtime.listCompanies().length, 1);
});

test('restores only the selected company database and preserves the other company', async t => {
  const { userDataDir, runtime, company } = fixture(t);
  const other = { id: 'backup-company-b', name: 'Otra empresa', rif: 'J-87654321-0' };
  await runtime.createCompany(company);
  await runtime.createCompany(other);
  const firstDb = runtime.getCompanyDatabase(company.id);
  const otherDb = runtime.getCompanyDatabase(other.id);
  const originalName = JSON.parse(firstDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json).companies[0].name;
  const destination = path.join(os.tmpdir(), 'sicoven-company-backup-restore-' + Date.now() + '-' + Math.random());
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  await createCompanyBackup({ db: firstDb, company, userDataDir, destination });
  firstDb.prepare("UPDATE app_state SET state_json=json_set(state_json,'$.companies[0].name','Nombre alterado') WHERE state_key='accounting'").run();
  const operationContext = { acquireMaintenanceLock: async () => () => {} };
  const restored = await restoreCompanyBackup({
    directory: destination, companyId: company.id, runtime, operationContext,
    userDataDir, Database, assertSqliteIntegrity
  });
  assert.equal(restored.ok, true);
  const restoredState = JSON.parse(runtime.getCompanyDatabase(company.id).prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
  assert.equal(restoredState.companies[0].name, originalName);
  const otherState = JSON.parse(otherDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
  assert.equal(otherState.companies[0].id, other.id);
  assert.equal(otherState.companies[0].name, other.name);
});
