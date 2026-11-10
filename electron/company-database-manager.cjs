const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_SCHEMA_VERSION = 1;
const REGISTRY_TABLE = 'company_database_registry';
const TENANT_META_TABLE = 'sicoven_database_meta';

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
  initializeCompanyDatabase,
  migrateCompanyDatabase = null,
  schemaVersion = DEFAULT_SCHEMA_VERSION
}) {
  if (!controlDb || typeof controlDb.prepare !== 'function' || typeof controlDb.exec !== 'function') {
    throw new TypeError('Se requiere la conexión SQLite local de control.');
  }
  if (typeof Database !== 'function') throw new TypeError('Se requiere el constructor de better-sqlite3.');
  if (typeof assertSqliteIntegrity !== 'function') throw new TypeError('Se requiere el verificador de integridad SQLite.');
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('La versión de esquema debe ser un entero positivo.');
  if (typeof initializeCompanyDatabase !== 'function' || (migrateCompanyDatabase !== null && typeof migrateCompanyDatabase !== 'function')) {
    throw new TypeError('El inicializador de esquema y el migrador opcional de empresa deben ser funciones válidas.');
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
    'SELECT company_id,rif,name,relative_path,schema_version,status,created_at,updated_at FROM ' + REGISTRY_TABLE + ' WHERE company_id=?'
  );

  function assertSafeDirectory(directoryPath, label) {
    const stat = fs.lstatSync(directoryPath);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error(label + ' no es un directorio local seguro; se bloqueó el acceso a SQLite.');
    }
  }

  function assertSafeDatabaseFile(filePath) {
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('El archivo SQLite registrado no es un archivo local regular; se bloqueó la apertura.');
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
  }

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
    if (fs.existsSync(companiesRoot)) assertSafeDirectory(companiesRoot, 'La carpeta companies');
    const companyDirectory = path.dirname(resolved);
    if (fs.existsSync(companyDirectory)) assertSafeDirectory(companyDirectory, 'La carpeta de la empresa');
    assertSafeDatabaseFile(resolved);
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

  function registerExistingCompanies(companyInputs) {
    if (!Array.isArray(companyInputs) || companyInputs.length === 0) {
      throw new TypeError('Se requiere una lista no vacía de empresas para registrar sus bases SQLite existentes.');
    }
    const companies = companyInputs.map(normalizeCompanyMetadata);
    const ids = new Set();
    const rifs = new Set();
    const prepared = companies.map(company => {
      if (ids.has(company.companyId) || rifs.has(company.rif)) {
        throw new Error('La lista de migración contiene identificadores o RIF duplicados.');
      }
      ids.add(company.companyId);
      rifs.add(company.rif);
      if (selectRecord.get(company.companyId)) {
        throw new Error('Una de las empresas ya está registrada en el catálogo local de bases SQLite.');
      }
      const relativePath = expectedRelativePath(company.companyId);
      const filePath = path.resolve(root, relativePath);
      const companyDirectory = path.dirname(filePath);
      if (!fs.existsSync(companiesRoot) || !fs.existsSync(companyDirectory) || !fs.existsSync(filePath)) {
        throw new Error('Falta el archivo SQLite preparado para ' + company.companyId + '. No se registró ninguna empresa.');
      }
      assertSafeDirectory(companiesRoot, 'La carpeta companies');
      assertSafeDirectory(companyDirectory, 'La carpeta de la empresa');
      assertSafeDatabaseFile(filePath);
      const tenantDb = new Database(filePath, { readonly: true, fileMustExist: true });
      try {
        assertSqliteIntegrity(tenantDb);
        const metadataTable = tenantDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TENANT_META_TABLE);
        if (!metadataTable) throw new Error('La base preparada para ' + company.companyId + ' no contiene metadatos de identidad.');
        const meta = tenantDb.prepare('SELECT meta_value FROM ' + TENANT_META_TABLE + ' WHERE meta_key=?');
        const storedId = String(meta.get('company_id')?.meta_value || '');
        const storedVersion = Number(meta.get('schema_version')?.meta_value);
        if (storedId !== company.companyId || !Number.isInteger(storedVersion) ||
            storedVersion < 1 || storedVersion > schemaVersion) {
          throw new Error('La identidad o versión de esquema de la base preparada para ' + company.companyId + ' no es compatible.');
        }
        return { company, relativePath, schemaVersion: storedVersion };
      } finally {
        tenantDb.close();
      }
    });

    const existingRifs = new Set(controlDb.prepare('SELECT rif FROM ' + REGISTRY_TABLE).all().map(row => String(row.rif).toUpperCase()));
    for (const company of companies) {
      if (existingRifs.has(company.rif)) {
        throw new Error('El RIF ' + company.rif + ' ya está registrado en otra empresa local.');
      }
    }

    const insert = controlDb.transaction(() => {
      const statement = controlDb.prepare(`
        INSERT INTO ${REGISTRY_TABLE}
          (company_id,rif,name,relative_path,schema_version,status)
        VALUES(?,?,?,?,?,'ACTIVE')
      `);
      for (const item of prepared) {
        statement.run(item.company.companyId, item.company.rif, item.company.name,
          item.relativePath, item.schemaVersion);
      }
    });
    insert();
    return prepared.map(item => getRecord(item.company.companyId));
  }

  function updateCompanyMetadata(companyInput) {
    const company = normalizeCompanyMetadata(companyInput);
    getRecord(company.companyId);
    const duplicate = controlDb.prepare(
      'SELECT company_id FROM ' + REGISTRY_TABLE + ' WHERE upper(rif)=? AND company_id<>?'
    ).get(company.rif, company.companyId);
    if (duplicate) throw new Error('El RIF ya está asociado a otra empresa del registro local.');
    const result = controlDb.prepare(
      "UPDATE " + REGISTRY_TABLE + " SET rif=?,name=?,updated_at=datetime('now') WHERE company_id=?"
    ).run(company.rif, company.name, company.companyId);
    if (result.changes !== 1) throw new Error('No se pudo actualizar la ficha de la empresa en el registro local.');
    return getRecord(company.companyId);
  }

  function registerCompany(companyInput, initializeCompanyData = null) {
    if (initializeCompanyData !== null && typeof initializeCompanyData !== 'function') {
      throw new TypeError('El inicializador de datos de empresa debe ser una función.');
    }
    const company = normalizeCompanyMetadata(companyInput);
    if (selectRecord.get(company.companyId)) throw new Error('La empresa ya tiene un registro de base SQLite.');
    const duplicateRif = controlDb.prepare('SELECT company_id FROM ' + REGISTRY_TABLE + ' WHERE upper(rif)=?').get(company.rif);
    if (duplicateRif) throw new Error('El RIF ya está asociado a otra empresa del registro local.');
    const relativePath = expectedRelativePath(company.companyId);
    const filePath = path.resolve(root, relativePath);
    fs.mkdirSync(companiesRoot, { recursive: true });
    assertSafeDirectory(companiesRoot, 'La carpeta companies');
    const companyDirectory = path.dirname(filePath);
    fs.mkdirSync(companyDirectory, { recursive: true });
    assertSafeDirectory(companyDirectory, 'La carpeta de la empresa');
    if (fs.existsSync(filePath)) {
      assertSafeDatabaseFile(filePath);
      throw new Error('Existe un archivo SQLite sin registro para esta empresa. Se conserva intacto y requiere inspección; no se sobrescribió.');
    }

    const tenantDb = new Database(filePath);
    try {
      configureDatabase(tenantDb);
      const initialize = tenantDb.transaction(() => {
        tenantDb.exec('CREATE TABLE ' + TENANT_META_TABLE + ' (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL)');
        const insertMeta = tenantDb.prepare('INSERT INTO ' + TENANT_META_TABLE + '(meta_key,meta_value) VALUES(?,?)');
        insertMeta.run('company_id', company.companyId);
        insertMeta.run('schema_version', String(schemaVersion));
        initializeCompanyDatabase(tenantDb, {
          companyId: company.companyId,
          schemaVersion,
          isNew: true
        });
        // Seed the first operational snapshot before the company becomes visible
        // in the control registry. Both schema and initial data share this transaction.
        if (initializeCompanyData) initializeCompanyData(tenantDb, company);
      });
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
      const metadataTable = tenantDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TENANT_META_TABLE);
      if (!metadataTable) throw new Error('La base de empresa no contiene sus metadatos de identidad y esquema. Se bloqueó la apertura.');
      const tenantMeta = tenantDb.prepare('SELECT meta_value FROM ' + TENANT_META_TABLE + ' WHERE meta_key=?');
      const tenantCompanyId = tenantMeta.get('company_id')?.meta_value;
      if (String(tenantCompanyId || '') !== companyId) {
        throw new Error('La identidad interna de la base SQLite no coincide con la empresa registrada. Se bloqueó la apertura.');
      }
      let currentVersion = Number(tenantMeta.get('schema_version')?.meta_value);
      const registeredVersion = Number(record.schema_version);
      if (!Number.isInteger(currentVersion) || currentVersion < 1 || currentVersion > schemaVersion ||
          !Number.isInteger(registeredVersion) || registeredVersion < 1 || registeredVersion > schemaVersion ||
          currentVersion < registeredVersion) {
        throw new Error('La versión de esquema de la empresa no es compatible o no coincide con su registro local.');
      }
      if (currentVersion > registeredVersion) {
        controlDb.prepare('UPDATE ' + REGISTRY_TABLE + " SET schema_version=?,updated_at=datetime('now') WHERE company_id=? AND schema_version=?").run(currentVersion, companyId, registeredVersion);
        if (Number(getRecord(companyId).schema_version) !== currentVersion) {
          throw new Error('No se pudo reconciliar el registro tras una migración local ya confirmada.');
        }
      }
      if (currentVersion < schemaVersion) {
        if (typeof migrateCompanyDatabase !== 'function') {
          throw new Error('No existe una migración SQLite registrada para actualizar esta empresa a la versión requerida.');
        }
        const fromVersion = currentVersion;
        const migrate = tenantDb.transaction(() => {
          migrateCompanyDatabase(tenantDb, { companyId, fromVersion, toVersion: schemaVersion });
          tenantDb.prepare('UPDATE ' + TENANT_META_TABLE + ' SET meta_value=? WHERE meta_key=?').run(String(schemaVersion), 'schema_version');
        });
        migrate();
        assertSqliteIntegrity(tenantDb);
        controlDb.prepare('UPDATE ' + REGISTRY_TABLE + " SET schema_version=?,updated_at=datetime('now') WHERE company_id=? AND schema_version=?").run(schemaVersion, companyId, fromVersion);
        const updated = getRecord(companyId);
        if (Number(updated.schema_version) !== schemaVersion) {
          throw new Error('No se pudo confirmar la nueva versión de esquema en el registro local.');
        }
        currentVersion = schemaVersion;
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

  function resetAllCompanies() {
    const records = listCompanies();
    closeAll();
    const targets = records.map(item => {
      const record = getRecord(item.id);
      const file = resolveRegisteredPath(record);
      return { id: item.id, file, directory: path.dirname(file) };
    });
    // Remove only database files explicitly registered by SICOVEN. Never
    // recursively delete the userData or companies root during a factory reset.
    for (const target of targets) {
      for (const suffix of ['', '-wal', '-shm']) {
        const candidate = target.file + suffix;
        if (!fs.existsSync(candidate)) continue;
        const stat = fs.lstatSync(candidate);
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error('Se encontró un archivo SQLite auxiliar no seguro para ' + target.id + '. Se canceló el reinicio.');
        }
        fs.rmSync(candidate);
      }
    }
    for (const directory of [...new Set(targets.map(item => item.directory))]) {
      if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
    }
    const removeRegistry = controlDb.transaction(() => {
      controlDb.prepare('DELETE FROM ' + REGISTRY_TABLE).run();
    });
    removeRegistry();
    return { removedCompanies: records.length, removedCompanyIds: records.map(item => item.id) };
  }

  return Object.freeze({
    registerCompany,
    registerExistingCompanies,
    updateCompanyMetadata,
    openCompany,
    closeCompany,
    archiveCompany,
    listCompanies,
    closeAll,
    resetAllCompanies,
    isOpen: companyId => openDatabases.has(normalizeCompanyId(companyId)),
    getOpenDatabase: companyId => openDatabases.get(normalizeCompanyId(companyId)) || null,
    getDatabasePath: companyId => resolveRegisteredPath(getRecord(companyId))
  });
}

module.exports = { createCompanyDatabaseManager, normalizeCompanyId, normalizeCompanyMetadata, DEFAULT_SCHEMA_VERSION };
