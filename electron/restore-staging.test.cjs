'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBackup } = require('./backup-restore.cjs');
const { createRestoreStaging } = require('./restore-staging.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-staging-'));
  const userDataDir = path.join(root, 'userData');
  fs.mkdirSync(path.join(userDataDir, 'supporting-documents'), { recursive: true });
  const db = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  db.exec('CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)');
  db.prepare('INSERT INTO app_state VALUES(?,?)').run('accounting', JSON.stringify({ companies: [{ id: 'co-1' }], journalEntries: [] }));
  fs.writeFileSync(path.join(userDataDir, 'supporting-documents', 'invoice.pdf'), '%PDF-1.7\\nstaging test\\n');
  const backupDirectory = path.join(root, 'backup');
  return {
    root, userDataDir, backupDirectory, db,
    async makeBackup() { await createBackup({ db, userDataDir, destination: backupDirectory }); },
    close() { db.close(); fs.rmSync(root, { recursive: true, force: true }); }
  };
}

const OPERATION_ID = '123e4567-e89b-42d3-a456-426614174000';

test('copies a verified backup into isolated staging and verifies the copied package', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    const result = createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID });
    assert.equal(result.ok, true);
    assert.equal(result.documentCount, 1);
    assert.equal(fs.existsSync(path.join(result.stagingDirectory, 'manifest.json')), true);
    assert.equal(fs.existsSync(path.join(result.stagingDirectory, 'sicoven.sqlite')), true);
  } finally { h.close(); }
});

test('rejects duplicate operation staging without overwriting existing files', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    const first = createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID });
    const keep = path.join(first.stagingDirectory, 'keep.txt');
    fs.writeFileSync(keep, 'preserve');
    assert.throws(() => createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID }), /Ya existe/);
    assert.equal(fs.readFileSync(keep, 'utf8'), 'preserve');
  } finally { h.close(); }
});

test('rejects a modified source package before creating staging', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    fs.appendFileSync(path.join(h.backupDirectory, 'sicoven.sqlite'), Buffer.from([0]));
    assert.throws(() => createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID }), /huella o el tamaño/);
    assert.equal(fs.existsSync(path.join(h.userDataDir, 'restore-staging')), false);
  } finally { h.close(); }
});

test('rejects a symlinked staging parent', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    const outside = path.join(h.root, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(h.userDataDir, 'restore-staging'), 'junction');
    assert.throws(() => createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID }), /directorio real sin enlaces/);
  } finally { h.close(); }
});


test('does not follow or delete a dangling operation symlink', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    const outside = path.join(h.root, 'outside-target');
    const operationPath = path.join(h.userDataDir, 'restore-staging', OPERATION_ID);
    fs.mkdirSync(path.dirname(operationPath), { recursive: true });
    fs.symlinkSync(outside, operationPath, 'junction');
    assert.throws(
      () => createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID }),
      /Ya existe/
    );
    assert.equal(fs.lstatSync(operationPath).isSymbolicLink(), true);
    assert.equal(fs.existsSync(outside), false);
  } finally { h.close(); }
});

test('does not delete a pre-existing operation directory after a staging failure', async () => {
  const h = fixture();
  try {
    await h.makeBackup();
    const parent = path.join(h.userDataDir, 'restore-staging');
    fs.mkdirSync(parent);
    const operationPath = path.join(parent, OPERATION_ID);
    fs.mkdirSync(operationPath);
    const sentinel = path.join(operationPath, 'keep.txt');
    fs.writeFileSync(sentinel, 'preserve');
    assert.throws(
      () => createRestoreStaging({ backupDirectory: h.backupDirectory, userDataDir: h.userDataDir, operationId: OPERATION_ID }),
      /Ya existe/
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally { h.close(); }
});
