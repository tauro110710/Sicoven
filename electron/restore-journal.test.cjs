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

test('journal validates canonical UUID v4 and rollback invariants', () => {
  const h = fixture();
  try {
    const created = createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    assert.throws(() => {
      const invalid = { ...created, operationId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
      require('./restore-journal.cjs').validateJournal(invalid);
    }, /corrupto/);
    assert.throws(() => {
      const invalid = {
        ...created,
        state: 'installed',
        hashes: { ...created.hashes, rollbackDatabase: null }
      };
      require('./restore-journal.cjs').validateJournal(invalid);
    }, /huella de retorno verificada/);
  } finally { h.close(); }
});

test('journal rejects a symlink in any parent directory', () => {
  const h = fixture();
  try {
    const real = path.join(h.root, 'real');
    const linked = path.join(h.root, 'linked');
    fs.mkdirSync(real);
    fs.symlinkSync(real, linked, 'junction');
    assert.throws(() => readJournal(path.join(linked, 'journal.json')), /directorio no real o un enlace/);
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

test('journal rejects dangling symlinks instead of treating them as absent', () => {
  const h = fixture();
  try {
    fs.symlinkSync(path.join(h.root, 'missing-target.json'), h.journalPath);
    assert.throws(() => readJournal(h.journalPath), /no puede ser un enlace/);
    assert.throws(() => createJournal({
      journalPath: h.journalPath,
      sourceDatabaseSha256: HASH_A,
      stagedDatabaseSha256: HASH_B
    }), /Ya existe/);
    assert.equal(fs.lstatSync(h.journalPath).isSymbolicLink(), true);
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

test('journal permits rollback when startup finds the swap not yet completed', () => {
  const h = fixture();
  try {
    createJournal({ journalPath: h.journalPath, sourceDatabaseSha256: HASH_A, stagedDatabaseSha256: HASH_B });
    transitionJournal({ journalPath: h.journalPath, expectedState: 'prepared', nextState: 'rollback_ready', lastStep: 'rollback_snapshot_verified', rollbackDatabaseSha256: HASH_C });
    transitionJournal({ journalPath: h.journalPath, expectedState: 'rollback_ready', nextState: 'rolling_back', lastStep: 'startup_recovery_rollback' });
    assert.equal(readJournal(h.journalPath).state, 'rolling_back');
  } finally { h.close(); }
});
