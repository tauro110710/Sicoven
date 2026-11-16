const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { assertSqliteIntegrity, assertSafeSqliteSidecars } = require('./sqlite-integrity.cjs');

test('SQLite integrity check accepts a healthy database', () => {
  const db = new Database(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id));');
    assert.deepEqual(assertSqliteIntegrity(db), { ok: true, quickCheck: 'ok', foreignKeyViolations: 0 });
  } finally {
    db.close();
  }
});

test('SQLite integrity check rejects foreign-key violations without changing rows', () => {
  const db = new Database(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = OFF; CREATE TABLE parent(id INTEGER PRIMARY KEY); CREATE TABLE child(parent_id INTEGER REFERENCES parent(id)); INSERT INTO child(parent_id) VALUES(99); PRAGMA foreign_keys = ON;');
    assert.throws(() => assertSqliteIntegrity(db), /relaciones foráneas inconsistentes/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM child').get().count, 1);
  } finally {
    db.close();
  }
});

test('SQLite integrity check rejects an invalid quick_check result', () => {
  const fakeDb = {
    pragma(name) {
      if (name === 'quick_check') return [{ quick_check: 'database disk image is malformed' }];
      throw new Error('foreign_key_check must not run after quick_check fails');
    }
  };
  assert.throws(() => assertSqliteIntegrity(fakeDb), /no superó PRAGMA quick_check/);
});

test('SQLite sidecar validation accepts absent or regular WAL/SHM files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-sqlite-sidecars-'));
  const databasePath = path.join(directory, 'sicoven.sqlite');
  try {
    assert.equal(assertSafeSqliteSidecars(databasePath), undefined);
    fs.writeFileSync(databasePath + '-wal', 'regular wal');
    fs.writeFileSync(databasePath + '-shm', 'regular shm');
    assert.equal(assertSafeSqliteSidecars(databasePath), undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite sidecar validation rejects symbolic links without changing the external target', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-sqlite-sidecars-'));
  const externalPath = path.join(directory, 'external.txt');
  const sidecarPath = path.join(directory, 'sicoven.sqlite-wal');
  try {
    fs.writeFileSync(externalPath, 'preserve this content');
    try {
      fs.symlinkSync(externalPath, sidecarPath, 'file');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
        t.skip('El entorno no permite crear enlaces simbólicos de archivo.');
        return;
      }
      throw error;
    }
    assert.throws(() => assertSafeSqliteSidecars(path.join(directory, 'sicoven.sqlite')), /archivo auxiliar SQLite no seguro/);
    assert.equal(fs.readFileSync(externalPath, 'utf8'), 'preserve this content');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('SQLite sidecar validation rejects directories at WAL/SHM paths', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-sqlite-sidecars-'));
  try {
    fs.mkdirSync(path.join(directory, 'sicoven.sqlite-shm'));
    assert.throws(() => assertSafeSqliteSidecars(path.join(directory, 'sicoven.sqlite')), /archivo auxiliar SQLite no seguro/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
