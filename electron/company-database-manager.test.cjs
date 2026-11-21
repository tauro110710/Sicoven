const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createCompanyDatabaseManager } = require('./company-database-manager.cjs');

function fixture(t, overrides = {}) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-company-db-'));
  const controlDb = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  const manager = createCompanyDatabaseManager({
    controlDb,
    userDataDir,
    Database,
    assertSqliteIntegrity,
    initializeCompanyDatabase(db, { companyId }) {
      db.exec(`
        CREATE TABLE company_metadata (company_id TEXT PRIMARY KEY);
        CREATE TABLE ledger_rows (id TEXT PRIMARY KEY, amount REAL NOT NULL);
      `);
      db.prepare('INSERT INTO company_metadata(company_id) VALUES(?)').run(companyId);
    },
    schemaVersion: 1,
    ...overrides
  });
  const managers = [manager];
  const registerManager = additionalManager => {
    managers.push(additionalManager);
    return additionalManager;
  };
  t.after(() => {
    // Close every tenant manager before deleting SQLite files on Windows.
    for (const currentManager of managers.reverse()) {
      try { currentManager.closeAll(); } catch {}
    }
    try { if (controlDb.open) controlDb.close(); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  return { userDataDir, controlDb, manager, registerManager };
}

test('creates a separate local SQLite file for each registered company', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'comp-a', rif: 'J-12345678-9', name: 'Empresa A' });
  manager.registerCompany({ id: 'comp-b', rif: 'J-98765432-1', name: 'Empresa B' });
  const a = manager.openCompany('comp-a');
  const b = manager.openCompany('comp-b');
  a.prepare('INSERT INTO ledger_rows(id,amount) VALUES(?,?)').run('a1', 100);
  b.prepare('INSERT INTO ledger_rows(id,amount) VALUES(?,?)').run('b1', 200);
  assert.equal(a.prepare('SELECT SUM(amount) AS total FROM ledger_rows').get().total, 100);
  assert.equal(b.prepare('SELECT SUM(amount) AS total FROM ledger_rows').get().total, 200);
  assert.notEqual(manager.getDatabasePath('comp-a'), manager.getDatabasePath('comp-b'));
  assert.deepEqual(manager.listCompanies().map(row => row.id).sort(), ['comp-a', 'comp-b']);
});

test('prevents two local companies from sharing the same RIF', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'rif-a', rif: 'J-12345678-9', name: 'Empresa A' });
  assert.throws(
    () => manager.registerCompany({ id: 'rif-b', rif: 'j-12345678-9', name: 'Empresa B' }),
    /RIF ya está asociado/i
  );
  assert.deepEqual(manager.listCompanies().map(item => item.id), ['rif-a']);
});

test('rejects path traversal and malformed company identifiers', t => {
  const { manager } = fixture(t);
  assert.throws(() => manager.registerCompany({ id: '../outside', rif: 'J-12345678-9', name: 'Intruso' }), /identificador.*no es válido/i);
  assert.throws(() => manager.openCompany('../../sicoven'), /identificador.*no es válido/i);
});

test('does not silently recreate a registered company database that is missing', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'comp-missing', rif: 'J-12345678-9', name: 'Empresa faltante' });
  manager.closeCompany('comp-missing');
  fs.rmSync(manager.getDatabasePath('comp-missing'));
  assert.throws(() => manager.openCompany('comp-missing'), /No existe la base SQLite registrada/i);
  assert.equal(fs.existsSync(manager.getDatabasePath('comp-missing')), false);
});

test('archiving closes the database and prevents future operational opens', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'comp-archive', rif: 'J-12345678-9', name: 'Empresa archivada' });
  const db = manager.openCompany('comp-archive');
  db.prepare('INSERT INTO ledger_rows(id,amount) VALUES(?,?)').run('keep', 42);
  manager.archiveCompany('comp-archive');
  assert.equal(db.open, false);
  assert.equal(manager.isOpen('comp-archive'), false);
  assert.throws(() => manager.openCompany('comp-archive'), /está archivada/i);
  assert.equal(fs.existsSync(manager.getDatabasePath('comp-archive')), true);
});

test('registers a verified orphan tenant without reinitializing or overwriting its SQLite data', t => {
  const { manager, userDataDir, controlDb } = fixture(t);
  const filePath = path.join(userDataDir, 'companies', 'comp-recover', 'accounting.sqlite');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const orphan = new Database(filePath);
  orphan.exec(`
    CREATE TABLE sicoven_database_meta(meta_key TEXT PRIMARY KEY,meta_value TEXT NOT NULL);
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('company_id','comp-recover'),('schema_version','1');
    CREATE TABLE preserved(value TEXT NOT NULL);
    INSERT INTO preserved(value) VALUES('initial snapshot retained');
  `);
  orphan.close();

  const result = manager.recoverOrphanedCompany(
    { id: 'comp-recover', rif: 'J-12345678-9', name: 'Empresa recuperada' },
    db => db.prepare('SELECT value FROM preserved').get()?.value === 'initial snapshot retained'
  );
  assert.equal(result.found, true);
  assert.equal(result.recovered, true);
  assert.equal(result.company.id, 'comp-recover');
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_database_registry').get().count, 1);
  const opened = manager.openCompany('comp-recover');
  assert.equal(opened.prepare('SELECT value FROM preserved').get().value, 'initial snapshot retained');
});

test('refuses an orphan tenant whose verifier rejects its contents and preserves the file', t => {
  const { manager, userDataDir, controlDb } = fixture(t);
  const filePath = path.join(userDataDir, 'companies', 'comp-unverified', 'accounting.sqlite');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const orphan = new Database(filePath);
  orphan.exec(`
    CREATE TABLE sicoven_database_meta(meta_key TEXT PRIMARY KEY,meta_value TEXT NOT NULL);
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('company_id','comp-unverified'),('schema_version','1');
    CREATE TABLE preserved(value TEXT NOT NULL);
    INSERT INTO preserved(value) VALUES('do-not-change');
  `);
  orphan.close();

  assert.throws(
    () => manager.recoverOrphanedCompany(
      { id: 'comp-unverified', rif: 'J-12345678-9', name: 'No verificada' },
      () => false
    ),
    /verificación de contenido.*no fue aprobada/i
  );
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_database_registry').get().count, 0);
  const verify = new Database(filePath, { readonly: true, fileMustExist: true });
  assert.equal(verify.prepare('SELECT value FROM preserved').get().value, 'do-not-change');
  verify.close();
});

test('returns not found when no orphan tenant file exists', t => {
  const { manager } = fixture(t);
  const result = manager.recoverOrphanedCompany(
    { id: 'comp-not-created', rif: 'J-12345678-9', name: 'Todavía no creada' },
    () => true
  );
  assert.deepEqual(result, { found: false });
});

test('does not overwrite an orphan SQLite file without a registry record', t => {
  const { manager, userDataDir } = fixture(t);
  const orphanPath = path.join(userDataDir, 'companies', 'comp-orphan', 'accounting.sqlite');
  fs.mkdirSync(path.dirname(orphanPath), { recursive: true });
  const orphan = new Database(orphanPath);
  orphan.exec('CREATE TABLE preserved(value TEXT)');
  orphan.prepare('INSERT INTO preserved(value) VALUES(?)').run('do-not-delete');
  orphan.close();
  assert.throws(() => manager.registerCompany({ id: 'comp-orphan', rif: 'J-12345678-9', name: 'Huérfana' }), /sin registro.*no se sobrescribió/i);
  const verify = new Database(orphanPath, { readonly: true });
  assert.equal(verify.prepare('SELECT value FROM preserved').get().value, 'do-not-delete');
  verify.close();
});

test('closes all active company databases without deleting their files', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'comp-one', rif: 'J-12345678-9', name: 'Una' });
  manager.registerCompany({ id: 'comp-two', rif: 'J-98765432-1', name: 'Dos' });
  manager.openCompany('comp-one');
  manager.openCompany('comp-two');
  assert.equal(manager.closeAll(), 2);
  assert.equal(manager.isOpen('comp-one'), false);
  assert.equal(manager.isOpen('comp-two'), false);
  assert.ok(fs.existsSync(manager.getDatabasePath('comp-one')));
  assert.ok(fs.existsSync(manager.getDatabasePath('comp-two')));
});
test('rejects a database file copied from a different registered company', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'comp-source', rif: 'J-12345678-9', name: 'Origen' });
  manager.registerCompany({ id: 'comp-target', rif: 'J-98765432-1', name: 'Destino' });
  manager.closeAll();
  fs.copyFileSync(manager.getDatabasePath('comp-source'), manager.getDatabasePath('comp-target'));
  assert.throws(() => manager.openCompany('comp-target'), /identidad interna.*no coincide/i);
});

test('migrates tenant schema transactionally and updates its local registry version', t => {
  const { manager, controlDb, userDataDir, registerManager } = fixture(t);
  manager.registerCompany({ id: 'comp-upgrade', rif: 'J-12345678-9', name: 'Empresa actualización' });
  manager.closeAll();
  const upgraded = createCompanyDatabaseManager({
    controlDb, userDataDir, Database, assertSqliteIntegrity,
    initializeCompanyDatabase() {},
    migrateCompanyDatabase(db, { fromVersion, toVersion }) {
      assert.equal(fromVersion, 1);
      assert.equal(toVersion, 2);
      db.exec('ALTER TABLE ledger_rows ADD COLUMN source TEXT');
    },
    schemaVersion: 2
  });
  registerManager(upgraded);
  const db = upgraded.openCompany('comp-upgrade');
  assert.ok(db.prepare('PRAGMA table_info(ledger_rows)').all().some(column => column.name === 'source'));
  const registry = controlDb.prepare('SELECT schema_version FROM company_database_registry WHERE company_id=?').get('comp-upgrade');
  const tenantVersion = db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='schema_version'").get().meta_value;
  assert.equal(registry.schema_version, 2);
  assert.equal(tenantVersion, '2');
});

test('rolls back a failed tenant migration and does not advance the registry', t => {
  const { manager, controlDb, userDataDir, registerManager } = fixture(t);
  manager.registerCompany({ id: 'comp-failed-upgrade', rif: 'J-12345678-9', name: 'Empresa sin migrar' });
  manager.closeAll();
  const brokenUpgrade = createCompanyDatabaseManager({
    controlDb, userDataDir, Database, assertSqliteIntegrity,
    initializeCompanyDatabase() {},
    migrateCompanyDatabase(db) {
      db.exec('CREATE TABLE should_rollback(value TEXT)');
      throw new Error('migration interrupted');
    },
    schemaVersion: 2
  });
  registerManager(brokenUpgrade);
  assert.throws(() => brokenUpgrade.openCompany('comp-failed-upgrade'), /migration interrupted/);
  const registry = controlDb.prepare('SELECT schema_version FROM company_database_registry WHERE company_id=?').get('comp-failed-upgrade');
  assert.equal(registry.schema_version, 1);
  const tenantDb = new Database(brokenUpgrade.getDatabasePath('comp-failed-upgrade'), { readonly: true });
  assert.equal(tenantDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='should_rollback'").get(), undefined);
  tenantDb.close();
});

test('rejects symlinked SQLite WAL and SHM sidecars before opening a company database', t => {
  const { manager } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-sidecar-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  manager.registerCompany({ id: 'comp-sidecar-link', rif: 'J-12345678-9', name: 'Empresa con sidecar enlazado' });
  manager.closeCompany('comp-sidecar-link');
  const databaseFile = manager.getDatabasePath('comp-sidecar-link');
  const outsideFile = path.join(outside, 'outside.sqlite-wal');
  fs.writeFileSync(outsideFile, 'external-sidecar');
  try {
    fs.symlinkSync(outsideFile, databaseFile + '-wal', 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('El sistema no permite crear enlaces simbólicos en este entorno.');
    throw error;
  }
  assert.throws(() => manager.openCompany('comp-sidecar-link'), /archivo auxiliar SQLite.*enlace/i);
  assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'external-sidecar');
});

test('rejects a symlinked company directory instead of opening a database outside userData', t => {
  const { userDataDir, manager } = fixture(t);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  manager.registerCompany({ id: 'comp-link', rif: 'J-12345678-9', name: 'Empresa con ruta enlazada' });
  manager.closeCompany('comp-link');
  const companiesRoot = path.join(userDataDir, 'companies');
  const target = path.join(companiesRoot, 'comp-link');
  const original = path.join(companiesRoot, 'comp-link-original');
  fs.renameSync(target, original);
  fs.copyFileSync(path.join(original, 'accounting.sqlite'), path.join(outside, 'accounting.sqlite'));
  try {
    fs.symlinkSync(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    fs.renameSync(original, target);
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('El sistema no permite crear enlaces simbólicos en este entorno.');
    throw error;
  }
  assert.throws(() => manager.openCompany('comp-link'), /directorio local seguro/i);
});

test('registers verified staged tenant databases as one control-registry transaction', t => {
  const { userDataDir, controlDb, manager } = fixture(t);
  const company = { id: 'staged-a', rif: 'J-12345678-9', name: 'Empresa preparada' };
  const companyDirectory = path.join(userDataDir, 'companies', company.id);
  fs.mkdirSync(companyDirectory, { recursive: true });
  const staged = new Database(path.join(companyDirectory, 'accounting.sqlite'));
  staged.exec(`
    CREATE TABLE sicoven_database_meta (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL);
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('company_id','staged-a');
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('schema_version','1');
    CREATE TABLE ledger_rows (id TEXT PRIMARY KEY, amount REAL NOT NULL);
    INSERT INTO ledger_rows(id,amount) VALUES('legacy-row',321);
  `);
  staged.close();

  const [record] = manager.registerExistingCompanies([company]);
  assert.equal(record.company_id, company.id);
  const tenantDb = manager.openCompany(company.id);
  assert.equal(tenantDb.prepare('SELECT amount FROM ledger_rows WHERE id=?').get('legacy-row').amount, 321);
  assert.equal(manager.listCompanies().length, 1);
});

test('rejects staged tenant database identity mismatch without partial registry insertion', t => {
  const { userDataDir, manager, controlDb } = fixture(t);
  const company = { id: 'staged-b', rif: 'J-12345678-9', name: 'Empresa preparada' };
  const directory = path.join(userDataDir, 'companies', company.id);
  fs.mkdirSync(directory, { recursive: true });
  const staged = new Database(path.join(directory, 'accounting.sqlite'));
  staged.exec(`
    CREATE TABLE sicoven_database_meta (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL);
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('company_id','other-company');
    INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES('schema_version','1');
  `);
  staged.close();
  assert.throws(() => manager.registerExistingCompanies([company]), /identidad o versión de esquema/i);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_database_registry').get().count, 0);
});

test('updates a company RIF and name in the local registry without changing its database file', t => {
  const { manager } = fixture(t);
  manager.registerCompany({ id: 'metadata-a', rif: 'J-12345678-9', name: 'Empresa original' });
  const filePath = manager.getDatabasePath('metadata-a');
  const updated = manager.updateCompanyMetadata({ id: 'metadata-a', rif: 'J-98765432-1', name: 'Empresa rectificada' });
  assert.equal(updated.name, 'Empresa rectificada');
  assert.equal(updated.rif, 'J-98765432-1');
  assert.equal(manager.getDatabasePath('metadata-a'), filePath);
});


test('does not activate a company in the control registry when initial operational data seeding fails', t => {
  const { manager, controlDb, userDataDir } = fixture(t);
  assert.throws(() => manager.registerCompany(
    { id: 'seed-failure', rif: 'J-12345678-9', name: 'Empresa incompleta' },
    tenantDb => {
      tenantDb.prepare('INSERT INTO ledger_rows(id,amount) VALUES(?,?)').run('partial', 99);
      throw new Error('initial snapshot rejected');
    }
  ), /initial snapshot rejected/);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_database_registry WHERE company_id=?').get('seed-failure').count, 0);
  const filePath = path.join(userDataDir, 'companies', 'seed-failure', 'accounting.sqlite');
  assert.equal(fs.existsSync(filePath), true);
  const orphan = new Database(filePath, { readonly: true });
  assert.equal(orphan.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ledger_rows'").get(), undefined);
  orphan.close();
});


test('factory reset removes each registered company database and its supporting documents', t => {
  const { userDataDir, manager, controlDb } = fixture(t);
  manager.registerCompany({ id: 'comp-reset', rif: 'J-12345678-9', name: 'Empresa para reset' });
  const databaseFile = manager.getDatabasePath('comp-reset');
  const companyDirectory = path.dirname(databaseFile);
  const documentsDirectory = path.join(companyDirectory, 'supporting-documents');
  fs.mkdirSync(documentsDirectory, { recursive: true });
  fs.writeFileSync(path.join(documentsDirectory, 'documento.pdf'), 'contenido de prueba');
  const orphanDirectory = path.join(userDataDir, 'companies', 'orphan-company');
  fs.mkdirSync(orphanDirectory, { recursive: true });
  fs.writeFileSync(path.join(orphanDirectory, 'keep.txt'), 'no borrar: sin registro');
  manager.closeAll();

  const result = manager.resetAllCompanies();

  assert.deepEqual(result.removedCompanyIds, ['comp-reset']);
  assert.equal(result.removedCompanies, 1);
  assert.equal(fs.existsSync(companyDirectory), false);
  assert.equal(fs.existsSync(orphanDirectory), true);
  assert.equal(fs.readFileSync(path.join(orphanDirectory, 'keep.txt'), 'utf8'), 'no borrar: sin registro');
  assert.deepEqual(manager.listCompanies(), []);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_database_registry').get().count, 0);
});
