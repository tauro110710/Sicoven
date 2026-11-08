'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTenantMigrationOrchestrator } = require('./tenant-migration-orchestrator.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-orchestrator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const snapshot = {
    companies: [{ id: 'company-a', name: 'Comercio A', rif: 'J-12345678-9' }],
    currentCompanyId: 'company-a',
    accounts: [],
    journalEntries: [],
    purchases: [],
    sales: [],
    products: [],
    customers: [],
    suppliers: [],
    movements: [],
    fixedAssets: [],
    vatVouchers: [],
    vatWithholdingDeclarations: [],
    vatWithholdingDeclarationEvents: [],
    islrVouchers: [],
    bankAccounts: [],
    bankStatementMovements: [],
    creditSettlements: [],
    supplierAdvanceSettlements: [],
    supplierDirectAdvances: [],
    islrFiscalEvents: [],
    financialDisclosures: [],
    displayCurrency: 'DUAL'
  };
  const calls = [];
  const sourceDb = {
    open: true,
    prepare(sql) {
      if (sql.includes('SELECT state_json FROM app_state')) return { get: () => ({ state_json: JSON.stringify(snapshot) }) };
      if (sql.includes('FROM audit_events')) return { all: () => [] };
      if (sql.includes('FROM supporting_documents')) return { all: () => [] };
      throw new Error('Consulta inesperada en fixture: ' + sql);
    },
    backup: async destination => { fs.writeFileSync(destination, 'consistent-sqlite-backup-fixture'); calls.push('backup'); }
  };
  class FakeDatabase {
    constructor(file, options = {}) {
      this.file = file;
      this.open = true;
      this.readonly = Boolean(options.readonly);
      this.meta = [];
    }
    pragma(value) {
      if (value === 'foreign_key_check') return [];
      return [];
    }
    exec() {}
    prepare(sql) {
      if (sql.includes('SELECT state_json FROM app_state')) return { get: () => ({ state_json: JSON.stringify(snapshot) }) };
      if (sql.includes('FROM audit_events')) return { all: () => [] };
      if (sql.includes('FROM supporting_documents')) return { all: () => [] };
      if (sql.startsWith('INSERT INTO sicoven_database_meta')) return { run: (...values) => this.meta.push(values) };
      if (sql.includes('SELECT meta_value FROM sicoven_database_meta')) return { get: () => ({ meta_value: path.basename(path.dirname(this.file)) }) };
      if (sql.includes('COUNT(*) AS count FROM audit_events')) return { get: () => ({ count: 0 }) };
      if (sql.includes('COUNT(*) AS count FROM supporting_documents')) return { get: () => ({ count: 0 }) };
      throw new Error('Consulta inesperada en base preparada: ' + sql);
    }
    close() { this.open = false; }
  }
  const manager = {
    listCompanies: () => [],
    registerExistingCompanies(companies) {
      calls.push('register');
      return companies.map(company => ({ id: company.id }));
    }
  };
  const options = {
    sourceDb,
    userDataDir: root,
    manager,
    assertSourceQuiescent: () => true,
    Database: FakeDatabase,
    assertSqliteIntegrity: () => {},
    initializeTenantDatabase: () => {},
    inspectLegacy: () => ({ ok: true, companyCount: 1, companyIds: ['company-a'], errors: [] }),
    partitionSnapshot: () => [snapshot],
    persistSnapshot: () => ({ ok: true }),
    readSnapshot: () => snapshot,
    copyRelational: () => ({ counts: {}, totalRows: 0 }),
    splitAudit: () => ({ byCompany: new Map([['company-a', []]]), counts: { total: 0, assigned: 0, retainedInControl: 0, unresolved: 0 } }),
    copyAudit: () => 0,
    copyDocuments: () => ({ copiedFiles: 0, totalBytes: 0 }),
    getDocumentsRoot: () => path.join(root, 'supporting-documents'),
    ...overrides
  };
  return { root, snapshot, calls, sourceDb, manager, options };
}

test('prepares and validates every company before registering databases, then commits the journal', async t => {
  const { root, calls, options } = fixture(t);
  const result = await createTenantMigrationOrchestrator(options).execute();
  assert.equal(result.ok, true);
  assert.equal(result.phase, 'COMMITTED');
  assert.deepEqual(calls, ['backup', 'register']);
  assert.equal(fs.existsSync(path.join(root, 'companies', 'company-a', 'accounting.sqlite')), true);
  const journalPath = path.join(root, 'tenant-migration', 'tenant-migration-journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
  assert.equal(journal.phase, 'COMMITTED');
  assert.equal(journal.migrationId, result.migrationId);
  assert.deepEqual(journal.completedCompanyIds, ['company-a']);
  assert.equal(fs.existsSync(result.backupPath), true);
});

test('keeps the source and prepared files intact and marks recovery when tenant preparation fails', async t => {
  const { root, calls, options } = fixture(t, {
    persistSnapshot: () => { throw new Error('simulated snapshot write failure'); }
  });
  await assert.rejects(
    () => createTenantMigrationOrchestrator(options).execute(),
    /base heredada y el respaldo permanecen intactos/i
  );
  assert.deepEqual(calls, ['backup']);
  const journal = JSON.parse(fs.readFileSync(
    path.join(root, 'tenant-migration', 'tenant-migration-journal.json'), 'utf8'
  ));
  assert.equal(journal.phase, 'ROLLBACK_REQUIRED');
  assert.match(journal.lastError, /simulated snapshot write failure/);
  assert.equal(fs.existsSync(path.join(root, 'companies', 'company-a', 'accounting.sqlite')), true);
});

test('blocks a failed preflight before creating a backup or company database', async t => {
  const { root, calls, options } = fixture(t, {
    inspectLegacy: () => ({ ok: false, companyCount: 0, companyIds: [], errors: ['unknown table'] })
  });
  await assert.rejects(
    () => createTenantMigrationOrchestrator(options).execute(),
    /inspección previa bloqueó/i
  );
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(root, 'tenant-migration')), false);
  assert.equal(fs.existsSync(path.join(root, 'companies')), false);
});

test('requires an exclusive maintenance gate before inspecting or backing up the legacy database', async t => {
  const { root, calls, options } = fixture(t, { assertSourceQuiescent: () => false });
  await assert.rejects(
    () => createTenantMigrationOrchestrator(options).execute(),
    /mantenimiento exclusivo/i
  );
  assert.deepEqual(calls, []);
  assert.equal(fs.existsSync(path.join(root, 'tenant-migration')), false);
});
