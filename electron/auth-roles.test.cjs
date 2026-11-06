const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { migrateAuthUserRoles, hasFullSystemAccess } = require('./auth-roles.cjs');

function makeLegacyDatabase() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE auth_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin')),
      is_seed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO auth_users(id,username,password_hash,password_salt,role,is_seed,created_at)
      VALUES(1,'admin','seed-hash','seed-salt','admin',1,'2026-01-01 00:00:00');
    INSERT INTO auth_users(id,username,password_hash,password_salt,role,is_seed,created_at)
      VALUES(2,'owner','owner-hash','owner-salt','admin',0,'2026-01-02 00:00:00');
    INSERT INTO auth_sessions(token_hash,user_id,expires_at)
      VALUES('session-hash',2,'2099-01-01 00:00:00');
  `);
  return db;
}

test('migrates legacy auth roles without changing the seed administrator or active sessions', () => {
  const db = makeLegacyDatabase();
  assert.equal(migrateAuthUserRoles(db), true);
  const users = db.prepare('SELECT * FROM auth_users ORDER BY id').all();
  assert.deepEqual(users.map(user => ({
    id:user.id, username:user.username, password_hash:user.password_hash,
    password_salt:user.password_salt, role:user.role, is_seed:user.is_seed,
    created_at:user.created_at
  })), [
    { id:1, username:'admin', password_hash:'seed-hash', password_salt:'seed-salt', role:'admin', is_seed:1, created_at:'2026-01-01 00:00:00' },
    { id:2, username:'owner', password_hash:'owner-hash', password_salt:'owner-salt', role:'admin', is_seed:0, created_at:'2026-01-02 00:00:00' }
  ]);
  db.prepare("INSERT INTO auth_users(username,password_hash,password_salt,role,is_seed) VALUES('contador_1','counter-hash','counter-salt','contador',0)").run();
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM auth_sessions WHERE user_id=2').get().count, 1);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.throws(() => db.prepare("INSERT INTO auth_users(username,password_hash,password_salt,role) VALUES('bad','x','y','viewer')").run(), /CHECK constraint failed/);
  db.close();
});

test('does not rebuild a database that already supports accountant users', () => {
  const db = makeLegacyDatabase();
  migrateAuthUserRoles(db);
  assert.equal(migrateAuthUserRoles(db), false);
  db.close();
});


test('administrator and accountant have identical full system access while unknown roles are denied', () => {
  assert.equal(hasFullSystemAccess({ id: 1, username: 'admin', role: 'admin' }), true);
  assert.equal(hasFullSystemAccess({ id: 2, username: 'contador', role: 'contador' }), true);
  assert.equal(hasFullSystemAccess({ id: 3, username: 'viewer', role: 'viewer' }), false);
  assert.equal(hasFullSystemAccess(null), false);
});
