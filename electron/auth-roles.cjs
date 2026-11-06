function migrateAuthUserRoles(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new Error('No se puede migrar el catálogo de usuarios sin una conexión SQLite válida.');
  }
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='auth_users'").get();
  if (!schema) return false;
  const sql = String(schema.sql || '');
  if (/['"]contador['"]/.test(sql)) return false;
  const columns = new Set(db.prepare('PRAGMA table_info(auth_users)').all().map(column => String(column.name)));
  const required = ['id', 'username', 'password_hash', 'password_salt', 'role', 'is_seed', 'created_at'];
  if (required.some(column => !columns.has(column))) {
    throw new Error('El esquema de usuarios no coincide con la estructura conocida; se bloqueó la migración para proteger las credenciales.');
  }

  db.pragma('foreign_keys = OFF');
  try {
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE auth_users_role_migration (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          password_hash TEXT NOT NULL,
          password_salt TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('admin','contador')),
          is_seed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      db.exec(`
        INSERT INTO auth_users_role_migration
          (id,username,password_hash,password_salt,role,is_seed,created_at)
        SELECT id,username,password_hash,password_salt,role,is_seed,created_at
        FROM auth_users;
      `);
      db.exec('DROP TABLE auth_users;');
      db.exec('ALTER TABLE auth_users_role_migration RENAME TO auth_users;');
    });
    migrate();
  } finally {
    db.pragma('foreign_keys = ON');
  }
  const violations = db.pragma('foreign_key_check');
  if (violations.length) {
    throw new Error('La migración de roles detectó referencias de sesión inválidas; no se habilitará el acceso de usuarios.');
  }
  return true;
}

function hasFullSystemAccess(actor) {
  return Boolean(actor && ['admin', 'contador'].includes(String(actor.role || '')));
}

module.exports = { migrateAuthUserRoles, hasFullSystemAccess };
