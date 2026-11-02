'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJournal, readJournal, transitionJournal, validateJournal } = require('./restore-journal.cjs');

const hash = 'a'.repeat(64);
const id = '123e4567-e89b-42d3-a456-426614174000';

test('journal durably records the authenticated actor before physical changes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-restore-journal-'));
  const journalPath = path.join(root, 'restore-journal.json');
  try {
    const created = createJournal({
      journalPath, operationId: id, actor: 'admin',
      sourceDatabaseSha256: hash, stagedDatabaseSha256: hash,
      sourceManifestSha256: hash, stagedManifestSha256: hash
    });
    assert.equal(created.state, 'prepared');
    assert.equal(readJournal(journalPath).actor, 'admin');
    const rollback = transitionJournal({
      journalPath, expectedState: 'prepared', nextState: 'rollback_ready',
      lastStep: 'rollback_snapshot_verified',
      rollbackDatabaseSha256: hash, rollbackManifestSha256: hash
    });
    assert.equal(rollback.actor, 'admin');
    assert.equal(readJournal(journalPath).state, 'rollback_ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('journal rejects a missing or invalid actor', () => {
  const value = {
    format: 'SICOVEN_RESTORE_JOURNAL_V1', version: 1, operationId: id,
    state: 'prepared', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    hashes: { sourceDatabase: hash, stagedDatabase: hash, sourceManifest: hash, stagedManifest: hash, rollbackDatabase: null, rollbackManifest: null },
    lastStep: 'staging_verified'
  };
  assert.throws(() => validateJournal(value), /journal.*corrupto/i);
  assert.throws(() => validateJournal({ ...value, actor: 'x'.repeat(121) }), /journal.*corrupto/i);
});
