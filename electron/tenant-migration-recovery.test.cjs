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
const { createEmptyAccountingSnapshot } = require('./tenant-snapshot.cjs');
const { createTenantMigrationOrchestrator } = require('./tenant-migration-orchestrator.cjs');
const { createTenantMigrationJournal } = require('./tenant-migration-journal.cjs');
const {
  inspectTenantMigrationRecovery,
  finalizeTenantMigrationRecovery
} = require('./tenant-migration-recovery.cjs');

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourceDb = new Database(path.join(root, 'sicoven.sqlite'));
  sourceDb.pragma('foreign_keys = ON');
  initializeTenantDatabase(sourceDb);
  sourceDb.exec(
    'CREATE TABLE auth_users (id INTEGER PRIMARY KEY, username TEXT NOT NULL);' +
    'CREATE TABLE auth_sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id));' +
    'CREATE TABLE license_state (id INTEGER PRIMARY KEY, status TEXT NOT NULL);'
  );
  const snapshot = createEmptyAccountingSnapshot();
  snapshot.companies = [{ id: 'company-a', name: 'Comercio A', rif: 'J-12345678-9' }];
  snapshot.currentCompanyId = 'company-a';
  sourceDb.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
    .run(JSON.stringify(snapshot));
  const manager = createCompanyDatabaseManager({
    controlDb: sourceDb,
    userDataDir: root,
    Database,
    assertSqliteIntegrity,
    initializeCompanyDatabase: initializeTenantDatabase,
    schemaVersion: 1
  });
  const options = {
    sourceDb,
    userDataDir: root,
    manager,
    Database,
    assertSqliteIntegrity,
    acquireMaintenanceLock: () => () => {},
    ...overrides
  };
  t.after(() => {
    manager.closeAll();
    if (sourceDb.open) sourceDb.close();
  });
  return { root, sourceDb, manager, options };
}

test('inspects and safely finalizes a registry-complete migration interrupted before journal commit', async t => {
  const { root, manager, options } = fixture(t, {
    createJournal: journalOptions => {
      const journal = createTenantMigrationJournal(journalOptions);
      return Object.freeze({
        ...journal,
        advance(expected, next, patch) {
          if (expected === 'REGISTERING' && next === 'COMMITTED') {
            throw new Error('simulated interruption before final journal commit');
          }
          return journal.advance(expected, next, patch);
        }
      });
    }
  });

  await assert.rejects(
    () => createTenantMigrationOrchestrator(options).execute(),
    /La migración no se confirmó/
  );
  const inspection = inspectTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity });
  assert.equal(inspection.found, true);
  assert.equal(inspection.journal.phase, 'REGISTERING');
  assert.equal(inspection.backup.valid, true);
  assert.equal(inspection.allPrepared, true);
  assert.equal(inspection.allRegistered, true);
  assert.equal(inspection.canFinalize, true);
  assert.equal(inspection.requiresManualRecovery, false);

  const finalized = finalizeTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity });
  assert.equal(finalized.phase, 'COMMITTED');
  const after = inspectTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity });
  assert.equal(after.journal.phase, 'COMMITTED');
  assert.equal(after.canFinalize, false);
  assert.equal(after.requiresManualRecovery, false);
});

test('does not finalize when a registered tenant database fails integrity verification', async t => {
  const { root, manager, options } = fixture(t, {
    createJournal: journalOptions => {
      const journal = createTenantMigrationJournal(journalOptions);
      return Object.freeze({
        ...journal,
        advance(expected, next, patch) {
          if (expected === 'REGISTERING' && next === 'COMMITTED') throw new Error('simulated journal interruption');
          return journal.advance(expected, next, patch);
        }
      });
    }
  });
  await assert.rejects(() => createTenantMigrationOrchestrator(options).execute(), /La migración no se confirmó/);
  const record = manager.listCompanies().find(item => item.id === 'company-a');
  assert.equal(record.status, 'ACTIVE');
  const databasePath = path.join(root, 'companies', 'company-a', 'accounting.sqlite');
  fs.writeFileSync(databasePath, 'corrupted database');
  const inspection = inspectTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity });
  assert.equal(inspection.canFinalize, false);
  assert.equal(inspection.requiresManualRecovery, true);
  assert.equal(inspection.companies[0].databaseValid, false);
  assert.throws(
    () => finalizeTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity }),
    /No es seguro confirmar el journal/
  );
});


test('does not finalize when tenant schema version differs from the control registry', async t => {
  const { root, manager, options } = fixture(t, {
    createJournal: journalOptions => {
      const journal = createTenantMigrationJournal(journalOptions);
      return Object.freeze({
        ...journal,
        advance(expected, next, patch) {
          if (expected === 'REGISTERING' && next === 'COMMITTED') throw new Error('simulated journal interruption');
          return journal.advance(expected, next, patch);
        }
      });
    }
  });
  await assert.rejects(() => createTenantMigrationOrchestrator(options).execute(), /La migración no se confirmó/);
  const databasePath = path.join(root, 'companies', 'company-a', 'accounting.sqlite');
  const tenantDb = new Database(databasePath);
  tenantDb.prepare("UPDATE sicoven_database_meta SET meta_value='999' WHERE meta_key='schema_version'").run();
  tenantDb.close();

  const inspection = inspectTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity });
  assert.equal(inspection.companies[0].databaseValid, true);
  assert.equal(inspection.companies[0].registryMatches, false);
  assert.equal(inspection.canFinalize, false);
  assert.equal(inspection.requiresManualRecovery, true);
  assert.throws(
    () => finalizeTenantMigrationRecovery({ userDataDir: root, manager, Database, assertSqliteIntegrity }),
    /No es seguro confirmar el journal/
  );
});
