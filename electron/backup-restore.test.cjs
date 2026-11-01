const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { createBackup, verifyBackupDirectory } = require('./backup-restore.cjs');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-backup-'));
  const userDataDir = path.join(root, 'userData');
  fs.mkdirSync(path.join(userDataDir, 'supporting-documents'), { recursive: true });
  const db = new Database(path.join(userDataDir, 'sicoven.sqlite'));
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL);");
  db.prepare('INSERT INTO app_state VALUES(?,?)').run('accounting', JSON.stringify({ companies: [{ id: 'co-1' }], journalEntries: [] }));
  fs.writeFileSync(path.join(userDataDir, 'supporting-documents', 'sample.pdf'), '%PDF-1.7\\nbackup test\\n');
  return { root, userDataDir, db, close() { db.close(); fs.rmSync(root, { recursive: true, force: true }); } };
}
test('backup captures a consistent SQLite database and all supporting documents with verifiable hashes', async () => {
  const h = fixture();
  try {
    const destination = path.join(h.root, 'export', 'SICOVEN-backup');
    const result = await createBackup({ db: h.db, userDataDir: h.userDataDir, destination });
    assert.equal(result.ok, true);
    assert.equal(result.documentCount, 1);
    assert.equal(verifyBackupDirectory(destination).ok, true);
  } finally { h.close(); }
});
test('backup rejects an existing destination and never overwrites it', async () => {
  const h = fixture();
  try {
    const destination = path.join(h.root, 'existing');
    fs.mkdirSync(destination);
    fs.writeFileSync(path.join(destination, 'keep.txt'), 'keep');
    await assert.rejects(createBackup({ db: h.db, userDataDir: h.userDataDir, destination }), /ya existe/);
    assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'keep');
  } finally { h.close(); }
});
test('backup verification rejects a modified document or database', async () => {
  const h = fixture();
  try {
    const destination = path.join(h.root, 'backup');
    await createBackup({ db: h.db, userDataDir: h.userDataDir, destination });
    fs.writeFileSync(path.join(destination, 'supporting-documents', 'sample.pdf'), 'tampered');
    assert.throws(() => verifyBackupDirectory(destination), /documentos respaldados/);
  } finally { h.close(); }
});
test('backup refuses symbolic links in the document vault', async () => {
  const h = fixture();
  try {
    const outside = path.join(h.root, 'outside.pdf');
    fs.writeFileSync(outside, '%PDF-1.7');
    fs.symlinkSync(outside, path.join(h.userDataDir, 'supporting-documents', 'linked.pdf'));
    await assert.rejects(createBackup({ db: h.db, userDataDir: h.userDataDir, destination: path.join(h.root, 'backup') }), /enlaces simbólicos/);
  } finally { h.close(); }
});
