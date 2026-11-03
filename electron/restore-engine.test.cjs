'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const { createBackup, verifyBackupDirectory } = require('./backup-restore.cjs');
const { createJournal, transitionJournal, readJournal } = require('./restore-journal.cjs');
const { recoverPendingRestore } = require('./restore-engine.cjs');
const { FILE: LEDGER_FILE } = require('./restore-audit-ledger.cjs');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

test('rolled_back recovery refuses to clean evidence when active SQLite differs from verified rollback', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-rolled-back-recovery-'));
  const userData = path.join(root, 'user-data');
  const operationId = '123e4567-e89b-42d3-a456-426614174000';
  const operationRoot = path.join(userData, 'restore-operations');
  const operationDir = path.join(operationRoot, operationId);
  const rollbackDir = path.join(operationDir, 'rollback');
  const journalPath = path.join(userData, 'restore-journal.json');
  const dbPath = path.join(userData, 'sicoven.sqlite');
  fs.mkdirSync(userData);
  fs.mkdirSync(operationRoot);
  fs.mkdirSync(operationDir);
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)");
    db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)").run(JSON.stringify({ companies: [], marker: 'original' }));
    const rollback = await createBackup({
      db, userDataDir: userData, destination: rollbackDir, allowInternalDestination: true
    });
    const rollbackManifest = sha256(path.join(rollbackDir, 'manifest.json'));
    const originalHash = sha256(dbPath);
    createJournal({
      journalPath, operationId, actor: 'admin',
      sourceDatabaseSha256: originalHash,
      stagedDatabaseSha256: 'b'.repeat(64),
      sourceManifestSha256: 'c'.repeat(64),
      stagedManifestSha256: 'd'.repeat(64)
    });
    transitionJournal({
      journalPath, expectedState: 'prepared', nextState: 'rollback_ready',
      lastStep: 'rollback_snapshot_verified',
      rollbackDatabaseSha256: rollback.databaseSha256,
      rollbackManifestSha256: rollbackManifest
    });
    transitionJournal({ journalPath, expectedState: 'rollback_ready', nextState: 'installing', lastStep: 'physical_swap_started' });
    transitionJournal({ journalPath, expectedState: 'installing', nextState: 'rolling_back', lastStep: 'rollback_started' });
    transitionJournal({ journalPath, expectedState: 'rolling_back', nextState: 'rolled_back', lastStep: 'startup_rollback_verified' });

    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify({ companies: [], marker: 'unexpected-active-state' }));
    db.close();

    assert.throws(
      () => recoverPendingRestore({ userDataDir: userData }),
      /base activa no coincide con el staging/
    );
    assert.equal(readJournal(journalPath).state, 'rolled_back');
    assert.equal(fs.existsSync(rollbackDir), true);
    assert.equal(fs.existsSync(path.join(userData, LEDGER_FILE)), false);
    assert.equal(verifyBackupDirectory(rollbackDir).databaseSha256, rollback.databaseSha256);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('rolled_back recovery rejects a valid but journal-unbound replacement snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-rolled-back-journal-binding-'));
  const userData = path.join(root, 'user-data');
  const operationId = '123e4567-e89b-42d3-a456-426614174001';
  const operationRoot = path.join(userData, 'restore-operations');
  const operationDir = path.join(operationRoot, operationId);
  const rollbackDir = path.join(operationDir, 'rollback');
  const journalPath = path.join(userData, 'restore-journal.json');
  const dbPath = path.join(userData, 'sicoven.sqlite');
  fs.mkdirSync(userData);
  fs.mkdirSync(operationRoot);
  fs.mkdirSync(operationDir);
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)");
    db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)").run(JSON.stringify({ companies: [], marker: 'original' }));
    const rollback = await createBackup({
      db, userDataDir: userData, destination: rollbackDir, allowInternalDestination: true
    });
    const rollbackManifest = sha256(path.join(rollbackDir, 'manifest.json'));
    const originalHash = sha256(dbPath);
    createJournal({
      journalPath, operationId, actor: 'admin',
      sourceDatabaseSha256: originalHash,
      stagedDatabaseSha256: 'b'.repeat(64),
      sourceManifestSha256: 'c'.repeat(64),
      stagedManifestSha256: 'd'.repeat(64)
    });
    transitionJournal({
      journalPath, expectedState: 'prepared', nextState: 'rollback_ready',
      lastStep: 'rollback_snapshot_verified',
      rollbackDatabaseSha256: rollback.databaseSha256,
      rollbackManifestSha256: rollbackManifest
    });
    transitionJournal({ journalPath, expectedState: 'rollback_ready', nextState: 'installing', lastStep: 'physical_swap_started' });
    transitionJournal({ journalPath, expectedState: 'installing', nextState: 'rolling_back', lastStep: 'rollback_started' });
    transitionJournal({ journalPath, expectedState: 'rolling_back', nextState: 'rolled_back', lastStep: 'startup_rollback_verified' });
    db.close();
    // A completed physical rollback installs the exact verified snapshot bytes.
    fs.copyFileSync(path.join(rollbackDir, 'sicoven.sqlite'), dbPath);

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    journal.hashes.rollbackDatabase = 'e'.repeat(64);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    assert.throws(
      () => recoverPendingRestore({ userDataDir: userData }),
      /snapshot de retorno no coincide con las huellas del journal/
    );
    assert.equal(readJournal(journalPath).state, 'rolled_back');
    assert.equal(fs.existsSync(rollbackDir), true);
    assert.equal(fs.existsSync(path.join(userData, LEDGER_FILE)), false);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('committed recovery rejects a staged snapshot that no longer matches journal hashes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-committed-journal-binding-'));
  const userData = path.join(root, 'user-data');
  const operationId = '123e4567-e89b-42d3-a456-426614174002';
  const operationRoot = path.join(userData, 'restore-operations');
  const operationDir = path.join(operationRoot, operationId);
  const stagingRoot = path.join(userData, 'restore-staging');
  const stagedDir = path.join(stagingRoot, operationId);
  const journalPath = path.join(userData, 'restore-journal.json');
  const dbPath = path.join(userData, 'sicoven.sqlite');
  fs.mkdirSync(userData);
  fs.mkdirSync(operationRoot);
  fs.mkdirSync(operationDir);
  fs.mkdirSync(stagingRoot);
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)");
    db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)").run(JSON.stringify({ companies: [], marker: 'restored' }));
    const staged = await createBackup({
      db, userDataDir: userData, destination: stagedDir, allowInternalDestination: true
    });
    const stagedManifest = sha256(path.join(stagedDir, 'manifest.json'));
    createJournal({
      journalPath, operationId, actor: 'admin',
      sourceDatabaseSha256: sha256(dbPath),
      stagedDatabaseSha256: staged.databaseSha256,
      sourceManifestSha256: 'c'.repeat(64),
      stagedManifestSha256: stagedManifest
    });
    transitionJournal({
      journalPath, expectedState: 'prepared', nextState: 'rollback_ready',
      lastStep: 'rollback_snapshot_verified',
      rollbackDatabaseSha256: 'a'.repeat(64),
      rollbackManifestSha256: 'b'.repeat(64)
    });
    transitionJournal({ journalPath, expectedState: 'rollback_ready', nextState: 'installing', lastStep: 'physical_swap_started' });
    transitionJournal({ journalPath, expectedState: 'installing', nextState: 'installed', lastStep: 'database_and_documents_verified' });
    transitionJournal({ journalPath, expectedState: 'installed', nextState: 'committed', lastStep: 'restore_committed' });
    db.close();
    // A committed restore installs the exact staged SQLite file, not a logical re-save.
    fs.copyFileSync(path.join(stagedDir, 'sicoven.sqlite'), dbPath);

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    journal.hashes.stagedDatabase = 'e'.repeat(64);
    fs.writeFileSync(journalPath, JSON.stringify(journal));
    assert.throws(
      () => recoverPendingRestore({ userDataDir: userData }),
      /staging confirmado no coincide con las huellas del journal/
    );
    assert.equal(readJournal(journalPath).state, 'committed');
    assert.equal(fs.existsSync(stagedDir), true);
    assert.equal(fs.existsSync(path.join(userData, LEDGER_FILE)), false);
  } finally {
    if (db.open) db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('prepared recovery preserves its journal when cleanup encounters an unsafe staging path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-cleanup-preflight-'));
  const userData = path.join(root, 'user-data');
  const operationId = '123e4567-e89b-42d3-a456-426614174003';
  const operationRoot = path.join(userData, 'restore-operations');
  const operationDir = path.join(operationRoot, operationId);
  const stagingRoot = path.join(userData, 'restore-staging');
  const stagingPath = path.join(stagingRoot, operationId);
  const journalPath = path.join(userData, 'restore-journal.json');
  fs.mkdirSync(userData);
  fs.mkdirSync(operationRoot);
  fs.mkdirSync(operationDir);
  fs.mkdirSync(stagingRoot);
  fs.writeFileSync(stagingPath, 'unsafe-not-a-directory');
  try {
    createJournal({
      journalPath, operationId, actor: 'admin',
      sourceDatabaseSha256: 'a'.repeat(64),
      stagedDatabaseSha256: 'b'.repeat(64),
      sourceManifestSha256: 'c'.repeat(64),
      stagedManifestSha256: 'd'.repeat(64)
    });
    assert.throws(
      () => recoverPendingRestore({ userDataDir: userData }),
      /Staging de restauración no es un directorio real/
    );
    assert.equal(readJournal(journalPath).state, 'prepared');
    assert.equal(fs.existsSync(operationDir), true);
    assert.equal(fs.readFileSync(stagingPath, 'utf8'), 'unsafe-not-a-directory');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


function makeDatabase(file, marker) {
  const database = new Database(file);
  database.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)");
  database.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
    .run(JSON.stringify({ companies: [{ id: marker }], marker }));
  return database;
}

test('executeRestore installs verified SQLite and documents and archives the rollback snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-execute-restore-success-'));
  const userData = path.join(root, 'active');
  const sourceData = path.join(root, 'source');
  const backupDir = path.join(root, 'external-backup');
  fs.mkdirSync(userData);
  fs.mkdirSync(sourceData);
  fs.mkdirSync(path.join(userData, 'supporting-documents'));
  fs.mkdirSync(path.join(sourceData, 'supporting-documents'));
  fs.writeFileSync(path.join(userData, 'supporting-documents', 'old.txt'), 'old-document');
  fs.writeFileSync(path.join(sourceData, 'supporting-documents', 'new.txt'), 'new-document');
  const sourceDb = makeDatabase(path.join(sourceData, 'sicoven.sqlite'), 'restored');
  let activeDb = makeDatabase(path.join(userData, 'sicoven.sqlite'), 'original');
  try {
    await createBackup({ db: sourceDb, userDataDir: sourceData, destination: backupDir });
    sourceDb.close();
    const result = await require('./restore-engine.cjs').executeRestore({
      backupDirectory: backupDir,
      userDataDir: userData,
      db: activeDb,
      getDb: () => activeDb,
      closeDatabase: async () => { if (activeDb?.open) activeDb.close(); },
      reopenDatabase: async () => { activeDb = new Database(path.join(userData, 'sicoven.sqlite')); },
      actor: 'admin'
    });
    assert.equal(result.ok, true);
    assert.equal(activeDb.prepare("SELECT json_extract(state_json,'$.marker') AS marker FROM app_state WHERE state_key='accounting'").get().marker, 'restored');
    assert.equal(fs.readFileSync(path.join(userData, 'supporting-documents', 'new.txt'), 'utf8'), 'new-document');
    assert.equal(fs.existsSync(path.join(userData, 'supporting-documents', 'old.txt')), false);
    const historyDir = path.join(userData, 'restore-history', result.operationId);
    assert.equal(verifyBackupDirectory(historyDir).ok, true);
    assert.equal(fs.existsSync(path.join(userData, 'restore-journal.json')), false);
    assert.equal(fs.existsSync(path.join(userData, LEDGER_FILE)), true);
  } finally {
    if (activeDb?.open) activeDb.close();
    if (sourceDb.open) sourceDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('executeRestore rolls back to the original SQLite and documents when reopening the restored DB fails once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-execute-restore-rollback-'));
  const userData = path.join(root, 'active');
  const sourceData = path.join(root, 'source');
  const backupDir = path.join(root, 'external-backup');
  fs.mkdirSync(userData);
  fs.mkdirSync(sourceData);
  fs.mkdirSync(path.join(userData, 'supporting-documents'));
  fs.mkdirSync(path.join(sourceData, 'supporting-documents'));
  fs.writeFileSync(path.join(userData, 'supporting-documents', 'original.txt'), 'original-document');
  fs.writeFileSync(path.join(sourceData, 'supporting-documents', 'replacement.txt'), 'replacement-document');
  const sourceDb = makeDatabase(path.join(sourceData, 'sicoven.sqlite'), 'replacement');
  let activeDb = makeDatabase(path.join(userData, 'sicoven.sqlite'), 'original');
  let reopenAttempts = 0;
  try {
    await createBackup({ db: sourceDb, userDataDir: sourceData, destination: backupDir });
    sourceDb.close();
    await assert.rejects(
      require('./restore-engine.cjs').executeRestore({
        backupDirectory: backupDir,
        userDataDir: userData,
        db: activeDb,
        getDb: () => activeDb,
        closeDatabase: async () => { if (activeDb?.open) activeDb.close(); },
        reopenDatabase: async () => {
          reopenAttempts += 1;
          if (reopenAttempts === 1) throw new Error('injected reopen failure');
          activeDb = new Database(path.join(userData, 'sicoven.sqlite'));
        },
        actor: 'admin'
      }),
      /injected reopen failure/
    );
    assert.equal(reopenAttempts, 2);
    assert.equal(activeDb.prepare("SELECT json_extract(state_json,'$.marker') AS marker FROM app_state WHERE state_key='accounting'").get().marker, 'original');
    assert.equal(fs.readFileSync(path.join(userData, 'supporting-documents', 'original.txt'), 'utf8'), 'original-document');
    assert.equal(fs.existsSync(path.join(userData, 'supporting-documents', 'replacement.txt')), false);
    assert.equal(fs.existsSync(path.join(userData, 'restore-journal.json')), false);
    assert.equal(fs.existsSync(path.join(userData, LEDGER_FILE)), true);
  } finally {
    if (activeDb?.open) activeDb.close();
    if (sourceDb.open) sourceDb.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
