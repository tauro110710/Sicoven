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
      () => recoverPendingRestore({ userDataDir }),
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
