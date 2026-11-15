'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { createBackup, verifyBackupDirectory } = require('./backup-restore.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('backup verification rejects a control registry that references a missing tenant database', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-backup-registry-mismatch-'));
  const userData = path.join(root, 'user-data');
  const backup = path.join(root, 'backup');
  fs.mkdirSync(userData);
  const sourceDb = new Database(path.join(userData, 'sicoven.sqlite'));
  try {
    sourceDb.exec('CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)');
    sourceDb.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
      .run(JSON.stringify({ companies: [] }));
    await createBackup({ db: sourceDb, userDataDir: userData, destination: backup });
  } finally {
    sourceDb.close();
  }

  const backupDbPath = path.join(backup, 'sicoven.sqlite');
  const backupDb = new Database(backupDbPath);
  try {
    backupDb.exec(`
      CREATE TABLE company_database_registry (
        company_id TEXT PRIMARY KEY,
        rif TEXT NOT NULL,
        name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED'))
      );
    `);
    backupDb.prepare(`
      INSERT INTO company_database_registry
        (company_id,rif,name,relative_path,schema_version,status)
      VALUES(?,?,?,?,?,'ACTIVE')
    `).run('company-a', 'J-12345678-9', 'Empresa A', 'companies/company-a/accounting.sqlite', 1);
  } finally {
    backupDb.close();
  }

  const manifestPath = path.join(backup, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.database.size = fs.statSync(backupDbPath).size;
  manifest.database.sha256 = sha256(backupDbPath);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  try {
    assert.throws(
      () => verifyBackupDirectory(backup),
      /registro multiempresa de la base de control no coincide/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('backup verification accepts an empty company registry when no tenant databases exist', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-backup-empty-registry-'));
  const userData = path.join(root, 'user-data');
  const backup = path.join(root, 'backup');
  fs.mkdirSync(userData);
  const db = new Database(path.join(userData, 'sicoven.sqlite'));
  try {
    db.exec(`
      CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL);
      CREATE TABLE company_database_registry (
        company_id TEXT PRIMARY KEY,
        rif TEXT NOT NULL,
        name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        schema_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED'))
      );
    `);
    db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
      .run(JSON.stringify({ companies: [] }));
    await createBackup({ db, userDataDir: userData, destination: backup });
    assert.equal(verifyBackupDirectory(backup).ok, true);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('backup creation and verification reject SQLite WAL/SHM symbolic links', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-backup-sidecar-symlink-'));
  const userData = path.join(root, 'user-data');
  const backup = path.join(root, 'backup');
  const companyDir = path.join(userData, 'companies', 'company-a');
  fs.mkdirSync(companyDir, { recursive: true });
  const db = new Database(path.join(userData, 'sicoven.sqlite'));
  const tenant = new Database(path.join(companyDir, 'accounting.sqlite'));
  const external = path.join(root, 'external-sidecar');
  fs.writeFileSync(external, 'external data must remain unchanged');
  try {
    db.exec(`
      CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL);
      CREATE TABLE company_database_registry (
        company_id TEXT PRIMARY KEY, rif TEXT NOT NULL, name TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE, schema_version INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED'))
      );
    `);
    db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
      .run(JSON.stringify({ companies: [{ id: 'company-a', rif: 'J-12345678-9', name: 'Empresa A' }] }));
    db.prepare(`INSERT INTO company_database_registry
      (company_id,rif,name,relative_path,schema_version,status)
      VALUES(?,?,?,?,?,'ACTIVE')`)
      .run('company-a', 'J-12345678-9', 'Empresa A', 'companies/company-a/accounting.sqlite', 1);
    tenant.exec('CREATE TABLE sicoven_database_meta(meta_key TEXT PRIMARY KEY,meta_value TEXT NOT NULL)');
    tenant.prepare('INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES(?,?)')
      .run('company_id', 'company-a');
    tenant.prepare('INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES(?,?)')
      .run('schema_version', '1');
  } finally {
    tenant.close();
  }

  const sourceWal = path.join(companyDir, 'accounting.sqlite-wal');
  try {
    fs.symlinkSync(external, sourceWal, 'file');
    await assert.rejects(
      createBackup({ db, userDataDir: userData, destination: backup }),
      /archivo auxiliar SQLite no seguro/
    );
    assert.equal(fs.readFileSync(external, 'utf8'), 'external data must remain unchanged');
    fs.unlinkSync(sourceWal);

    await createBackup({ db, userDataDir: userData, destination: backup });
    const backedTenant = path.join(backup, 'companies', 'company-a', 'accounting.sqlite');
    const backupShm = path.join(backup, 'companies', 'company-a', 'accounting.sqlite-shm');
    fs.symlinkSync(external, backupShm, 'file');
    assert.throws(
      () => verifyBackupDirectory(backup),
      /archivo auxiliar SQLite no seguro/
    );
    assert.equal(fs.readFileSync(external, 'utf8'), 'external data must remain unchanged');
    fs.unlinkSync(backupShm);
    assert.equal(verifyBackupDirectory(backup).ok, true);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
