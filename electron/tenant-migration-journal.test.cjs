'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createTenantMigrationJournal } = require('./tenant-migration-journal.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-tenant-journal-'));
  const backup = path.join(root, 'sicoven.sqlite.backup');
  fs.writeFileSync(backup, 'immutable sqlite backup fixture');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let tick = 0;
  const journal = createTenantMigrationJournal({
    userDataDir: root,
    now: () => new Date(Date.UTC(2026, 10, 8, 0, 0, tick++)).toISOString()
  });
  return { root, backup, hash, journal };
}

test('writes a durable journal and advances only through the declared phases', t => {
  const { backup, hash, journal } = fixture(t);
  const created = journal.create({ companyIds: ['company-a', 'company-b'], sourceBackupPath: backup, sourceBackupSha256: hash });
  assert.equal(created.phase, 'PREPARED');
  assert.equal(journal.advance('PREPARED', 'STAGING').phase, 'STAGING');
  journal.markCompanyCompleted('company-a');
  assert.deepEqual(journal.read().completedCompanyIds, ['company-a']);
  assert.equal(journal.advance('STAGING', 'VALIDATING').phase, 'VALIDATING');
  assert.equal(journal.advance('VALIDATING', 'REGISTERING').phase, 'REGISTERING');
  assert.equal(journal.advance('REGISTERING', 'COMMITTED').phase, 'COMMITTED');
  assert.throws(() => journal.advance('COMMITTED', 'STAGING'), /transición.*permitida/i);
});

test('prevents duplicate journal creation and stale phase transitions', t => {
  const { backup, hash, journal } = fixture(t);
  journal.create({ companyIds: ['company-a'], sourceBackupPath: backup, sourceBackupSha256: hash });
  assert.throws(() => journal.create({ companyIds: ['company-b'], sourceBackupPath: backup, sourceBackupSha256: hash }), /Ya existe un journal/);
  assert.throws(() => journal.advance('STAGING', 'VALIDATING'), /fase|estado obsoleto/i);
});

test('requires a valid immutable backup path, checksum, and unique company list', t => {
  const { backup, hash, journal } = fixture(t);
  assert.throws(() => journal.create({ companyIds: ['company-a', 'company-a'], sourceBackupPath: backup, sourceBackupSha256: hash }), /journal|duplicados/i);
  assert.throws(() => journal.create({ companyIds: ['company-a'], sourceBackupPath: backup, sourceBackupSha256: 'bad' }), /journal|incompleto/i);
});

test('refuses to mark unknown companies or record completion outside staging', t => {
  const { backup, hash, journal } = fixture(t);
  journal.create({ companyIds: ['company-a'], sourceBackupPath: backup, sourceBackupSha256: hash });
  assert.throws(() => journal.markCompanyCompleted('company-a'), /staging o validación/i);
  journal.advance('PREPARED', 'STAGING');
  assert.throws(() => journal.markCompanyCompleted('company-b'), /no pertenece/i);
});

test('detects a damaged journal instead of silently resetting migration state', t => {
  const { backup, hash, journal } = fixture(t);
  journal.create({ companyIds: ['company-a'], sourceBackupPath: backup, sourceBackupSha256: hash });
  fs.writeFileSync(journal.path, '{broken');
  assert.throws(() => journal.read(), /dañado/i);
});
