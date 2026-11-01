'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createJournal,
  readJournal,
  transitionJournal
} = require('./restore-journal.cjs');

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-journal-'));
  const directory = path.join(root, 'restore');
  fs.mkdirSync(directory);
  const journalPath = path.join(directory, 'journal.json');
  return { root, directory, journalPath, close() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('journal persists prepared state and can be read after reopening', () => {
  const h = fixture();
  try {
    const created = createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    const reopened = readJournal(h.journalPath);
    assert.equal(reopened.operationId, created.operationId);
    assert.equal(reopened.state, 'prepared');
    assert.equal(reopened.hashes.sourceDatabase, HASH_A);
  } finally { h.close(); }
});

test('journal enforces ordered transitions and requires a verified rollback hash', () => {
  const h = fixture();
  try {
    createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    assert.throws(() => transitionJournal({ journalPath: h.journalPath, expectedState: 'prepared', nextState: 'installing', lastStep: 'swap' }), /no permitida/);
    assert.throws(() => transitionJournal({ journalPath: h.journalPath, expectedState: 'prepared', nextState: 'rollback_ready', lastStep: 'snapshot' }), /huella verificada/);
    transitionJournal({ journalPath: h.journalPath, expectedState: 'prepared', nextState: 'rollback_ready', lastStep: 'snapshot_verified', rollbackDatabaseSha256: HASH_C });
    assert.equal(readJournal(h.journalPath).hashes.rollbackDatabase, HASH_C);
  } finally { h.close(); }
});

test('journal rejects stale expected states and duplicate operations', () => {
  const h = fixture();
  try {
    createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    assert.throws(() => createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B }), /Ya existe/);
    assert.throws(() => transitionJournal({ journalPath: h.journalPath, expectedState: 'rollback_ready', nextState: 'installing', lastStep: 'swap' }), /cambió/);
  } finally { h.close(); }
});

test('journal rejects a symlink and corrupt JSON without modifying it', () => {
  const h = fixture();
  try {
    const target = path.join(h.root, 'target.json');
    fs.writeFileSync(target, '{}');
    fs.symlinkSync(target, h.journalPath);
    assert.throws(() => readJournal(h.journalPath), /no puede ser un enlace/);
    fs.unlinkSync(h.journalPath);
    fs.writeFileSync(h.journalPath, '{broken');
    assert.throws(() => readJournal(h.journalPath));
    assert.equal(fs.readFileSync(h.journalPath, 'utf8'), '{broken');
  } finally { h.close(); }
});

test('journal atomically replaces the existing file across the complete commit path', () => {
  const h = fixture();
  try {
    createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    const states = [
      ['prepared', 'rollback_ready', 'rollback_snapshot_verified', HASH_C],
      ['rollback_ready', 'installing', 'database_swap_started'],
      ['installing', 'installed', 'database_and_documents_verified'],
      ['installed', 'committed', 'restore_committed']
    ];
    for (const [expectedState, nextState, lastStep, rollbackDatabaseSha256] of states) {
      transitionJournal({
        journalPath: h.journalPath,
        expectedState,
        nextState,
        lastStep,
        ...(rollbackDatabaseSha256 ? { rollbackDatabaseSha256 } : {})
      });
      const persisted = readJournal(h.journalPath);
      assert.equal(persisted.state, nextState);
      assert.equal(persisted.lastStep, lastStep);
    }
    assert.equal(readJournal(h.journalPath).hashes.rollbackDatabase, HASH_C);
    assert.equal(fs.readdirSync(h.directory).filter(name => name.startsWith('journal.json.tmp-')).length, 0);
  } finally { h.close(); }
});
