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
    ...overrides
  });
  t.after(() => {
    try { manager.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });
  return { userDataDir, controlDb, manager };
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
