const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SCHEMA_VERSION = 1;
const REGISTRY_TABLE = 'company_database_registry';

function normalizeCompanyId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id) || id === '.' || id === '..') {
    throw new Error('El identificador de empresa no es válido para una base SQLite local.');
  }
  return id;
}

function normalizeCompanyMetadata(company) {
  const companyId = normalizeCompanyId(company?.id ?? company?.companyId);
  const rif = String(company?.rif || '').trim().toUpperCase();
  const name = String(company?.name || '').trim();
  if (!rif || rif.length > 40 || !name || name.length > 240) {
    throw new Error('La empresa requiere RIF y razón social válidos para crear su base SQLite.');
  }
  return { companyId, rif, name };
}

function createCompanyDatabaseManager({
  controlDb,
  userDataDir,
  Database,
  assertSqliteIntegrity,
  initializeCompanyDatabase = () => {},
  migrateCompanyDatabase = () => {},
  schemaVersion = DEFAULT_SCHEMA_VERSION
}) {
  if (!controlDb || typeof controlDb.prepare !== 'function' || typeof controlDb.exec !== 'function') {
    throw new TypeError('Se requiere la conexión SQLite local de control.');
  }
  if (typeof Database !== 'function') throw new TypeError('Se requiere el constructor de better-sqlite3.');
  if (typeof assertSqliteIntegrity !== 'function') throw new TypeError('Se requiere el verificador de integridad SQLite.');
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('La versión de esquema debe ser un entero positivo.');
  if (typeof initializeCompanyDatabase !== 'function' || typeof migrateCompanyDatabase !== 'function') {
    throw new TypeError('Los inicializadores de esquema de empresa deben ser funciones.');
  }

  const root = path.resolve(String(userDataDir || ''));
  if (!userDataDir || !path.isAbsolute(root)) throw new TypeError('La carpeta local de datos de SICOVEN debe ser absoluta.');
  const companiesRoot = path.join(root, 'companies');
  const openDatabases = new Map();

  controlDb.exec(`
    CREATE TABLE IF NOT EXISTS ${REGISTRY_TABLE} (
      company_id TEXT PRIMARY KEY,
      rif TEXT NOT NULL,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ARCHIVED')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const selectRecord = controlDb.prepare(
    'SELECT company_id,rif,name,relative_path,schema_version,status,created_at,updated_at FROM ${REGISTRY_TABLE} WHERE company_id=?'
  );

  function expectedRelativePath(companyId) {
    return path.join('companies', companyId, 'accounting.sqlite');
  }

  function resolveRegisteredPath(record) {
    const companyId = normalizeCompanyId(record.company_id);
    const expected = expectedRelativePath(companyId);
    if (path.normalize(record.relative_path) !== path.normalize(expected)) {
      throw new Error('La ruta registrada para la empresa no coincide con la ruta local autorizada. Se bloqueó la apertura.');
    }
    const resolved = path.resolve(root, record.relative_path);
    const prefix = companiesRoot + path.sep;
    if (!resolved.startsWith(prefix) || resolved !== path.resolve(companiesRoot, companyId, 'accounting.sqlite')) {
      throw new Error('La ruta SQLite de la empresa intenta salir del directorio local autorizado.');
    }
    return resolved;
  }

  function configureDatabase(db) {
    assertSqliteIntegrity(db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = FULL');
  }

  function getRecord(companyIdInput) {
    const companyId = normalizeCompanyId(companyIdInput);
    const record = selectRecord.get(companyId);
    if (!record) throw new Error('La empresa no está registrada en el catálogo local de bases SQLite.');
    return record;
  }

  function registerCompany(companyInput) {
    const company = normalizeCompanyMetadata(companyInput);
    if (selectRecord.get(company.companyId)) throw new Error('La empresa ya tiene un registro de base SQLite.');
    const relativePath = expectedRelativePath(company.companyId);
    const filePath = path.resolve(root, relativePath);
    const companyDirectory = path.dirname(filePath);
    fs.mkdirSync(companyDirectory, { recursive: true });
    if (fs.existsSync(filePath)) {
      throw new Error('Existe un archivo SQLite sin registro para esta empresa. Se conserva intacto y requiere inspección; no se sobrescribió.');
    }

    const tenantDb = new Database(filePath);
    try {
      configureDatabase(tenantDb);
      const initialize = tenantDb.transaction(() => initializeCompanyDatabase(tenantDb, {
        companyId: company.companyId,
        schemaVersion,
        isNew: true
      }));
      initialize();
      assertSqliteIntegrity(tenantDb);
    } finally {
      if (tenantDb.open) tenantDb.close();
    }

    const insert = controlDb.transaction(() => {
      controlDb.prepare(`
        INSERT INTO ${REGISTRY_TABLE}
          (company_id,rif,name,relative_path,schema_version,status)
        VALUES(?,?,?,?,?,'ACTIVE')
      `).run(company.companyId, company.rif, company.name, relativePath, schemaVersion);
    });
    insert();
    return getRecord(company.companyId);
  }

  function openCompany(companyIdInput) {
    const companyId = normalizeCompanyId(companyIdInput);
    if (openDatabases.has(companyId)) return openDatabases.get(companyId);
    const record = getRecord(companyId);
    if (record.status !== 'ACTIVE') throw new Error('La empresa está archivada y no puede abrirse para operaciones.');
    const filePath = resolveRegisteredPath(record);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error('No existe la base SQLite registrada para esta empresa. SICOVEN no creará una base vacía ni sustituirá los datos.');
    }

    const tenantDb = new Database(filePath);
    try {
      configureDatabase(tenantDb);
      const currentVersion = Number(record.schema_version);
      if (!Number.isInteger(currentVersion) || currentVersion < 1 || currentVersion > schemaVersion) {
        throw new Error('La versión de esquema de la empresa no es compatible con esta versión de SICOVEN.');
      }
      if (currentVersion < schemaVersion) {
        const migrate = tenantDb.transaction(() => migrateCompanyDatabase(tenantDb, {
          companyId,
          fromVersion: currentVersion,
          toVersion: schemaVersion
        }));
        migrate();
        assertSqliteIntegrity(tenantDb);
        controlDb.prepare(`
          UPDATE ${REGISTRY_TABLE}
          SET schema_version=?,updated_at=datetime('now')
          WHERE company_id=? AND schema_version=?
        `).run(schemaVersion, companyId, currentVersion);
        const updated = getRecord(companyId);
        if (Number(updated.schema_version) !== schemaVersion) {
          throw new Error('No se pudo confirmar la nueva versión de esquema en el registro local.');
        }
      }
      openDatabases.set(companyId, tenantDb);
      return tenantDb;
    } catch (error) {
      if (tenantDb.open) tenantDb.close();
      throw error;
    }
  }

  function closeCompany(companyIdInput) {
    const companyId = normalizeCompanyId(companyIdInput);
    const tenantDb = openDatabases.get(companyId);
    if (!tenantDb) return false;
    if (tenantDb.open) {
      tenantDb.pragma('wal_checkpoint(TRUNCATE)');
      tenantDb.close();
    }
    openDatabases.delete(companyId);
    return true;
  }

  function archiveCompany(companyIdInput) {
    const companyId = normalizeCompanyId(companyIdInput);
    closeCompany(companyId);
    const result = controlDb.prepare(`
      UPDATE ${REGISTRY_TABLE}
      SET status='ARCHIVED',updated_at=datetime('now')
      WHERE company_id=? AND status='ACTIVE'
    `).run(companyId);
    if (result.changes !== 1) throw new Error('No se pudo archivar la empresa; verifique su registro y estado.');
    return getRecord(companyId);
  }

  function listCompanies() {
    return controlDb.prepare(`
      SELECT company_id AS id,rif,name,relative_path AS relativePath,
        schema_version AS schemaVersion,status,created_at AS createdAt,updated_at AS updatedAt
      FROM ${REGISTRY_TABLE}
      ORDER BY name COLLATE NOCASE,company_id
    `).all();
  }

  function closeAll() {
    const ids = [...openDatabases.keys()];
    for (const id of ids) closeCompany(id);
    return ids.length;
  }

  return Object.freeze({
    registerCompany,
    openCompany,
    closeCompany,
    archiveCompany,
    listCompanies,
    closeAll,
    isOpen: companyId => openDatabases.has(normalizeCompanyId(companyId)),
    getOpenDatabase: companyId => openDatabases.get(normalizeCompanyId(companyId)) || null,
    getDatabasePath: companyId => resolveRegisteredPath(getRecord(companyId))
  });
}

module.exports = { createCompanyDatabaseManager, normalizeCompanyId, normalizeCompanyMetadata, DEFAULT_SCHEMA_VERSION };
