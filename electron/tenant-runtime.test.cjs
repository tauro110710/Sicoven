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
  await runtime.createCompany({ id: 'runtime-a', name: 'Empresa A', rif: 'J-12345678-9' }, { id: 7, username: 'admin' });
  const tenantDb = runtime.getCompanyDatabase('runtime-a');
  assert.notEqual(tenantDb.name, controlDb.name);
  assert.equal(controlDb.prepare('SELECT value FROM control_probe').get().value, 'auth-remains-local');
  assert.equal(tenantDb.prepare("SELECT state_key FROM app_state WHERE state_key='accounting'").get().state_key, 'accounting');
  assert.equal(runtime.listCompanies().length, 1);
  const createdEvent = tenantDb.prepare("SELECT event_type,details_json FROM audit_events WHERE event_type='company_created'").get();
  assert.equal(createdEvent.event_type, 'company_created');
  assert.equal(JSON.parse(createdEvent.details_json).actorUsername, 'admin');
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

test('recovers a complete orphan tenant only after verifying its initial snapshot, receipt and creation audit', async t => {
  const { runtime, controlDb } = fixture(t);
  const operationId = 'runtime-orphan-recovery-001';
  const requestHash = 'b'.repeat(64);
  const actor = { id: 7, username: 'admin' };
  const company = { id: operationId, name: 'Empresa huérfana válida', rif: 'J-12345678-9' };
  await runtime.createCompany(company, actor, { operationId, requestHash });
  const filePath = runtime.getCompanyDatabasePath(operationId);
  runtime.closeCompany(operationId);
  controlDb.prepare('DELETE FROM company_database_registry WHERE company_id=?').run(operationId);

  const result = runtime.recoverOrphanedCompany(company, { operationId, requestHash, actor });
  assert.equal(result.found, true);
  assert.equal(result.recovered, true);
  assert.equal(result.company.id, operationId);
  assert.equal(runtime.listCompanies().length, 1);
  runtime.verifyCompanyCreation(company, { operationId, requestHash, actor });
  assert.equal(fs.existsSync(filePath), true);
});

test('preserves but refuses to register an orphan tenant whose initial snapshot no longer matches its creation intent', async t => {
  const { runtime, controlDb } = fixture(t);
  const operationId = 'runtime-orphan-recovery-invalid';
  const requestHash = 'c'.repeat(64);
  const actor = { id: 7, username: 'admin' };
  const company = { id: operationId, name: 'Empresa válida', rif: 'J-12345678-9' };
  await runtime.createCompany(company, actor, { operationId, requestHash });
  const filePath = runtime.getCompanyDatabasePath(operationId);
  runtime.closeCompany(operationId);
  controlDb.prepare('DELETE FROM company_database_registry WHERE company_id=?').run(operationId);
  const tampered = new Database(filePath);
  tampered.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
    .run(JSON.stringify({ companies: [{ id: operationId, name: 'Otra empresa', rif: 'J-12345678-9' }], currentCompanyId: operationId }));
  tampered.close();

  assert.throws(
    () => runtime.recoverOrphanedCompany(company, { operationId, requestHash, actor }),
    /snapshot huérfano no coincide/i
  );
  assert.equal(runtime.listCompanies().length, 0);
  const verify = new Database(filePath, { readonly: true, fileMustExist: true });
  assert.equal(JSON.parse(verify.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json).companies[0].name, 'Otra empresa');
  verify.close();
});

test('refuses orphan recovery when the durable creation actor or request hash differs', async t => {
  const { runtime, controlDb } = fixture(t);
  const operationId = 'runtime-orphan-identity-check';
  const requestHash = 'd'.repeat(64);
  const actor = { id: 7, username: 'admin' };
  const company = { id: operationId, name: 'Empresa protegida', rif: 'J-12345678-9' };
  await runtime.createCompany(company, actor, { operationId, requestHash });
  const filePath = runtime.getCompanyDatabasePath(operationId);
  runtime.closeCompany(operationId);
  controlDb.prepare('DELETE FROM company_database_registry WHERE company_id=?').run(operationId);

  assert.throws(
    () => runtime.recoverOrphanedCompany(company, {
      operationId, requestHash: 'e'.repeat(64), actor
    }),
    /evidencia append-only de creación no coincide/i
  );
  assert.throws(
    () => runtime.recoverOrphanedCompany(company, {
      operationId, requestHash, actor: { id: 8, username: 'otro-admin' }
    }),
    /evidencia append-only de creación no coincide/i
  );
  assert.equal(runtime.listCompanies().length, 0);
  assert.equal(fs.existsSync(filePath), true);
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


test('exposes factory reset through the tenant runtime and removes only registered company data', async t => {
  const { runtime, controlDb } = fixture(t);
  await runtime.createCompany({ id: 'runtime-reset-a', name: 'Empresa Reset A', rif: 'J-12345678-9' });
  await runtime.createCompany({ id: 'runtime-reset-b', name: 'Empresa Reset B', rif: 'J-98765432-1' });
  const registeredDirectory = path.dirname(runtime.getCompanyDatabasePath('runtime-reset-a'));
  const orphanDirectory = path.join(path.dirname(registeredDirectory), 'orphan-company');
  fs.mkdirSync(orphanDirectory, { recursive: true });
  fs.writeFileSync(path.join(registeredDirectory, 'documento-asociado.txt'), 'documento');
  fs.writeFileSync(path.join(orphanDirectory, 'conservar.txt'), 'no registrado');

  assert.equal(typeof runtime.resetAllCompanies, 'function');
  const result = runtime.resetAllCompanies();

  assert.deepEqual(result.removedCompanyIds.sort(), ['runtime-reset-a', 'runtime-reset-b']);
  assert.equal(result.removedCompanies, 2);
  assert.equal(runtime.listCompanies().length, 0);
  assert.equal(fs.existsSync(registeredDirectory), false);
  assert.equal(fs.readFileSync(path.join(orphanDirectory, 'conservar.txt'), 'utf8'), 'no registrado');
  assert.equal(controlDb.open, true);
});


test('company creation commits its initial snapshot receipt and operation identity with the audit event', async t => {
  const { runtime } = fixture(t);
  const operationId = 'runtime-create-operation-001';
  const requestHash = 'a'.repeat(64);
  const company = { id: operationId, name: 'Empresa con recibo', rif: 'J-12345678-9' };
  await runtime.createCompany(company, { id: 7, username: 'admin' }, { operationId, requestHash });
  const tenantDb = runtime.getCompanyDatabase(operationId);
  const receipt = tenantDb.prepare("SELECT operation_id,company_id,operation_type,actor_user_id FROM operation_receipts WHERE operation_id=?").get(operationId);
  assert.equal(receipt.operation_id, operationId);
  assert.equal(receipt.company_id, operationId);
  assert.equal(receipt.operation_type, 'accounting.snapshot');
  assert.equal(receipt.actor_user_id, 7);
  const event = tenantDb.prepare("SELECT details_json FROM audit_events WHERE event_type='company_created'").get();
  const details = JSON.parse(event.details_json);
  assert.equal(details.operationId, operationId);
  assert.equal(details.requestHash, requestHash);
});
