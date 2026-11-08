'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const { createCompanyDatabaseManager } = require('./company-database-manager.cjs');
const {
  loadTenantAccountingSnapshot,
  saveTenantAccountingSnapshot
} = require('./tenant-persistence.cjs');

function fixture(t) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-persistence-'));
  const controlDb = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  const manager = createCompanyDatabaseManager({
    controlDb,
    userDataDir,
    Database,
    assertSqliteIntegrity,
    initializeCompanyDatabase: initializeTenantDatabase
  });
  t.after(() => {
    try { manager.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  return { manager };
}

function snapshot(companies, overrides = {}) {
  const empty = {
    companies,
    currentCompanyId: companies[0]?.id || '',
    accounts: [{ code: '1.1.1.01', name: 'Caja' }],
    journalEntries: [], purchases: [], sales: [], products: [], customers: [], suppliers: [],
    movements: [], fixedAssets: [], vatVouchers: [], vatWithholdingDeclarations: [],
    vatWithholdingDeclarationEvents: [], islrVouchers: [], bankAccounts: [],
    bankStatementMovements: [], creditSettlements: [], supplierAdvanceSettlements: [],
    supplierDirectAdvances: [], islrFiscalEvents: [], financialDisclosures: [],
    displayCurrency: 'DUAL'
  };
  return { ...empty, ...overrides };
}

test('saves and reloads each company in its own SQLite file', async t => {
  const { manager } = fixture(t);
  const companyA = { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const first = snapshot([companyA], {
    sales: [{ id: 'sale-a', companyId: 'company-a', totalAmountBs: 100 }]
  });
  assert.deepEqual(await saveTenantAccountingSnapshot(manager, first), {
    ok: true, savedCompanyIds: ['company-a'], unchanged: false
  });
  const loaded = loadTenantAccountingSnapshot(manager, 'company-a');
  assert.deepEqual(loaded.sales, first.sales);
  assert.deepEqual(loaded.companies, [companyA]);

  const companyB = { id: 'company-b', name: 'Empresa B', rif: 'J-98765432-1' };
  const both = snapshot([companyA, companyB], {
    sales: [{ id: 'sale-a', companyId: 'company-a', totalAmountBs: 100 }]
  });
  assert.deepEqual(await saveTenantAccountingSnapshot(manager, both), {
    ok: true, savedCompanyIds: ['company-b'], unchanged: false
  });
  const combined = loadTenantAccountingSnapshot(manager, 'company-b');
  assert.equal(combined.currentCompanyId, 'company-b');
  assert.deepEqual(combined.sales, both.sales);
  assert.equal(manager.getDatabasePath('company-a') !== manager.getDatabasePath('company-b'), true);
});

test('coordinates shared chart updates across company databases', async t => {
  const { manager } = fixture(t);
  const a = { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const b = { id: 'company-b', name: 'Empresa B', rif: 'J-98765432-1' };
  const initial = snapshot([a]);
  await saveTenantAccountingSnapshot(manager, initial);
  await saveTenantAccountingSnapshot(manager, snapshot([a, b]));
  const before = loadTenantAccountingSnapshot(manager);
  const changed = snapshot([a, b], {
    accounts: [{ code: '1.1.1.02', name: 'Banco' }]
  });
  await saveTenantAccountingSnapshot(manager, changed);
  const after = loadTenantAccountingSnapshot(manager);
  assert.deepEqual(after.accounts, changed.accounts);
});

test('does not silently remove a registered company from the accounting snapshot', async t => {
  const { manager } = fixture(t);
  const a = { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const b = { id: 'company-b', name: 'Empresa B', rif: 'J-98765432-1' };
  await saveTenantAccountingSnapshot(manager, snapshot([a]));
  await saveTenantAccountingSnapshot(manager, snapshot([a, b]));
  await assert.rejects(() => saveTenantAccountingSnapshot(manager, snapshot([a])), /falta en el snapshot/i);
});

test('blocks tenant snapshots that contain data owned by another company', async t => {
  const { manager } = fixture(t);
  const a = { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const invalid = snapshot([a], {
    sales: [{ id: 'sale-b', companyId: 'company-b', totalAmountBs: 200 }]
  });
  await assert.rejects(() => saveTenantAccountingSnapshot(manager, invalid), /empresa propietaria válida/i);
});

test('returns null only when the local registry contains no active companies', async t => {
  const { manager } = fixture(t);
  assert.equal(loadTenantAccountingSnapshot(manager), null);
});

test('rolls back every company database if one database rejects a coordinated write', async t => {
  const { manager } = fixture(t);
  const a = { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' };
  const b = { id: 'company-b', name: 'Empresa B', rif: 'J-98765432-1' };
  await saveTenantAccountingSnapshot(manager, snapshot([a]));
  await saveTenantAccountingSnapshot(manager, snapshot([a, b]));
  const before = loadTenantAccountingSnapshot(manager);
  const dbB = manager.openCompany('company-b');
  dbB.exec(`CREATE TRIGGER reject_tenant_write BEFORE UPDATE ON app_state
    BEGIN SELECT RAISE(ABORT, 'injected tenant persistence failure'); END;`);
  const changed = snapshot([a, b], {
    accounts: [{ code: '1.1.1.02', name: 'Banco' }]
  });
  await assert.rejects(() => saveTenantAccountingSnapshot(manager, changed), /injected tenant persistence failure/);
  const after = loadTenantAccountingSnapshot(manager);
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.companies.map(company => company.id).sort(), ['company-a', 'company-b']);
});
