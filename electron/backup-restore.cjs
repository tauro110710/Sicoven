const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { hasFullSystemAccess } = require('./auth-roles.cjs');

const FORMAT = 'SICOVEN_BACKUP_V1';
const DB_FILE = 'sicoven.sqlite';
const DOCS_DIR = 'supporting-documents';
const COMPANIES_DIR = 'companies';
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_DOCUMENTS = 10000;
const MAX_RELATIVE_PATH = 1024;
const HASH_CHUNK_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

function lstatIfExists(target) {
  try { return fs.lstatSync(target); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function assertRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + ' debe ser un archivo regular sin enlaces.');
  return stat;
}

function assertDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + ' debe ser un directorio real sin enlaces.');
  return stat;
}

function assertSafeSqliteSidecars(file, label) {
  // SQLite may follow WAL/SHM siblings automatically when a database is opened.
  // Inspect them before every open so backup/restore never follows a pre-existing link.
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = lstatIfExists(file + suffix);
    if (sidecar && (!sidecar.isFile() || sidecar.isSymbolicLink())) {
      throw new Error(label + ' contiene un archivo auxiliar SQLite no seguro; se bloqueó el acceso.');
    }
  }
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(HASH_CHUNK_SIZE);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function validateRelativeDocumentPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_RELATIVE_PATH ||
      value.includes('\\') || value.includes('\0') || value.startsWith('/') ||
      /^[a-zA-Z]:/.test(value)) {
    throw new Error('El manifiesto contiene una ruta documental no válida.');
  }
  const parts = value.split('/');
  const reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (parts.some(part => !part || part === '.' || part === '..' ||
      /[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || reserved.test(part)) ||
      path.posix.normalize(value) !== value) {
    throw new Error('El manifiesto contiene una ruta documental no segura.');
  }
  return value;
}

function collectFiles(root, relative = '') {
  if (!lstatIfExists(root)) return [];
  assertDirectory(root, 'La carpeta documental');
  return fs.readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const abs = path.join(root, entry.name);
      const rel = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('El respaldo no admite enlaces simbólicos en documentos.');
      if (entry.isDirectory()) return collectFiles(abs, rel);
      if (!entry.isFile()) throw new Error('El respaldo contiene un elemento documental no admitido.');
      validateRelativeDocumentPath(rel);
      return [{ path: rel, size: fs.statSync(abs).size, sha256: sha256File(abs) }];
    });
}

function collectDirectories(root, relative = '') {
  if (!lstatIfExists(root)) return [];
  assertDirectory(root, 'La carpeta documental');
  return fs.readdirSync(root, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap(entry => {
      const abs = path.join(root, entry.name);
      const rel = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('El respaldo no admite enlaces simbólicos en documentos.');
      if (entry.isDirectory()) {
        validateRelativeDocumentPath(rel);
        return [rel, ...collectDirectories(abs, rel)];
      }
      if (!entry.isFile()) throw new Error('El respaldo contiene un elemento documental no admitido.');
      return [];
    });
}

function verifyDatabase(file) {
  assertSafeSqliteSidecars(file, 'La base SQLite del respaldo');
  const check = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = assertSqliteIntegrity(check);
    const state = check.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    if (!state) throw new Error('El respaldo no contiene el estado contable.');
    JSON.parse(state.state_json);
    const registryTable = check.prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='company_database_registry'"
    ).get();
    let companyRegistry = null;
    if (registryTable) {
      companyRegistry = check.prepare(
        'SELECT company_id,relative_path,schema_version,status FROM company_database_registry ORDER BY company_id'
      ).all().map(row => ({
        companyId: String(row.company_id || ''),
        relativePath: String(row.relative_path || ''),
        schemaVersion: Number(row.schema_version),
        status: String(row.status || '')
      }));
      const seen = new Set();
      for (const item of companyRegistry) {
        if (!/^[A-Za-z0-9_-]{1,120}$/.test(item.companyId) ||
            item.relativePath !== COMPANIES_DIR + '/' + item.companyId + '/accounting.sqlite' ||
            !Number.isInteger(item.schemaVersion) || item.schemaVersion < 1 ||
            !['ACTIVE', 'ARCHIVED'].includes(item.status) || seen.has(item.companyId)) {
          throw new Error('El registro de empresas de la base de control contiene una identidad, ruta, versión o estado inválido.');
        }
        seen.add(item.companyId);
      }
    }
    return {
      integrity,
      companies: check.prepare("SELECT json_extract(state_json,'$.companies') AS companies FROM app_state WHERE state_key='accounting'").get()?.companies ?? null,
      companyRegistry
    };
  } finally { check.close(); }
}

function collectCompanyDatabases(root) {
  const directory = path.join(root, COMPANIES_DIR);
  if (!lstatIfExists(directory)) return [];
  assertDirectory(directory, 'El directorio de bases por empresa');
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).map(entry => {
    if (entry.isSymbolicLink() || !entry.isDirectory() || !/^[A-Za-z0-9_-]{1,120}$/.test(entry.name)) {
      throw new Error('El registro local contiene una carpeta de empresa no válida.');
    }
    const fromDir = path.join(directory, entry.name);
    assertDirectory(fromDir, 'La carpeta de empresa');
    const relative = COMPANIES_DIR + '/' + entry.name + '/accounting.sqlite';
    const file = path.join(root, ...relative.split('/'));
    assertRegularFile(file, 'La base SQLite de ' + entry.name);
    assertSafeSqliteSidecars(file, 'La base SQLite de ' + entry.name);
    const check = new Database(file, { readonly: true, fileMustExist: true });
    try {
      assertSqliteIntegrity(check);
      const metaTable = check.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sicoven_database_meta'").get();
      if (!metaTable) throw new Error('La base de ' + entry.name + ' no contiene identidad multiempresa.');
      const companyId = String(check.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get()?.meta_value || '');
      if (companyId !== entry.name) throw new Error('La identidad interna de una base no coincide con su carpeta.');
    } finally { check.close(); }
    const documentsDirectory = path.join(fromDir, 'supporting-documents');
    const documents = collectFiles(documentsDirectory).map(item => ({
      path: 'supporting-documents/' + item.path,
      size: item.size,
      sha256: item.sha256
    }));
    return { path: relative, companyId: entry.name, size: fs.statSync(file).size, sha256: sha256File(file), documents };
  });
}

async function copyCompanyDatabaseTree(source, destination) {
  if (!lstatIfExists(source)) return [];
  assertDirectory(source, 'El directorio de bases por empresa');
  fs.mkdirSync(destination, { recursive: false });
  const manifest = [];
  for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || !entry.isDirectory() || !/^[A-Za-z0-9_-]{1,120}$/.test(entry.name)) {
      throw new Error('El directorio de empresas contiene una entrada no permitida.');
    }
    const fromDir = path.join(source, entry.name), toDir = path.join(destination, entry.name);
    assertDirectory(fromDir, 'La carpeta de empresa');
    fs.mkdirSync(toDir, { recursive: false });
    const entries = fs.readdirSync(fromDir);
    if (entries.some(name => !['accounting.sqlite', 'supporting-documents'].includes(name))) {
      throw new Error('La carpeta de una empresa contiene archivos inesperados.');
    }
    const from = path.join(fromDir, 'accounting.sqlite'), to = path.join(toDir, 'accounting.sqlite');
    assertRegularFile(from, 'La base SQLite de ' + entry.name);
    assertSafeSqliteSidecars(from, 'La base SQLite de ' + entry.name);
    const tenantDb = new Database(from);
    try { await tenantDb.backup(to); }
    finally { if (tenantDb.open) tenantDb.close(); }
    assertSafeSqliteSidecars(to, 'La copia SQLite de ' + entry.name);
    const check = new Database(to, { readonly: true, fileMustExist: true });
    try {
      assertSqliteIntegrity(check);
      const storedId = String(check.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get()?.meta_value || '');
      if (storedId !== entry.name) throw new Error('La copia de seguridad perdió la identidad de ' + entry.name + '.');
    } finally { check.close(); }
    const sourceDocuments = path.join(fromDir, 'supporting-documents');
    if (lstatIfExists(sourceDocuments)) {
      assertDirectory(sourceDocuments, 'Los documentos de la empresa');
      const copiedDocuments = collectFiles(sourceDocuments);
      const destinationDocuments = path.join(toDir, 'supporting-documents');
      fs.mkdirSync(destinationDocuments, { recursive: false });
      for (const item of copiedDocuments) {
        const sourceFile = path.join(sourceDocuments, ...item.path.split('/'));
        const targetFile = path.join(destinationDocuments, ...item.path.split('/'));
        fs.mkdirSync(path.dirname(targetFile), { recursive: true });
        fs.copyFileSync(sourceFile, targetFile, fs.constants.COPYFILE_EXCL);
        if (sha256File(targetFile) !== item.sha256 || fs.statSync(targetFile).size !== item.size) {
          throw new Error('Falló la verificación de un documento de la empresa ' + entry.name + ': ' + item.path);
        }
      }
    }
    const documents = collectFiles(path.join(toDir, 'supporting-documents')).map(item => ({
      path: 'supporting-documents/' + item.path, size: item.size, sha256: item.sha256
    }));
    manifest.push({ path: COMPANIES_DIR + '/' + entry.name + '/accounting.sqlite', companyId: entry.name,
      size: fs.statSync(to).size, sha256: sha256File(to), documents });
  }
  return manifest;
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.format !== FORMAT || manifest.application !== 'SICOVEN' ||
      !manifest.database || typeof manifest.database !== 'object' ||
      manifest.database.file !== DB_FILE ||
      !Number.isSafeInteger(manifest.database.size) || manifest.database.size <= 0 ||
      typeof manifest.database.sha256 !== 'string' || !HASH_RE.test(manifest.database.sha256) ||
      typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
      !Array.isArray(manifest.documents) || manifest.documents.length > MAX_DOCUMENTS ||
      (manifest.companyDatabases !== undefined && (!Array.isArray(manifest.companyDatabases) || manifest.companyDatabases.length > 10000))) {
    throw new Error('El formato del respaldo no es compatible o el manifiesto es inválido.');
  }
  const companyIds = new Set();
  for (const item of manifest.companyDatabases || []) {
    if (!item || !/^[A-Za-z0-9_-]{1,120}$/.test(String(item.companyId || '')) || item.path !== COMPANIES_DIR + '/' + item.companyId + '/accounting.sqlite' || companyIds.has(item.companyId) || !Number.isSafeInteger(item.size) || item.size <= 0 || typeof item.sha256 !== 'string' || !HASH_RE.test(item.sha256) ||
        (item.documents !== undefined && (!Array.isArray(item.documents) || item.documents.length > MAX_DOCUMENTS))) {
      throw new Error('El manifiesto contiene una base de empresa inválida o duplicada.');
    }
    const documentPaths = new Set();
    for (const document of item.documents || []) {
      if (!document || typeof document.path !== 'string' || !document.path.startsWith('supporting-documents/')) {
        throw new Error('El manifiesto contiene un documento de empresa inválido.');
      }
      validateRelativeDocumentPath(document.path);
      if (documentPaths.has(document.path) || !Number.isSafeInteger(document.size) || document.size < 0 ||
          typeof document.sha256 !== 'string' || !HASH_RE.test(document.sha256)) {
        throw new Error('El manifiesto contiene una ruta o huella documental de empresa inválida.');
      }
      documentPaths.add(document.path);
    }
    companyIds.add(item.companyId);
  }
  const seen = new Set();
  for (const item of manifest.documents) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('El manifiesto contiene una entrada documental inválida.');
    }
    validateRelativeDocumentPath(item.path);
    if (seen.has(item.path)) throw new Error('El manifiesto contiene rutas documentales duplicadas.');
    seen.add(item.path);
    if (!Number.isSafeInteger(item.size) || item.size < 0 ||
        typeof item.sha256 !== 'string' || !HASH_RE.test(item.sha256)) {
      throw new Error('El manifiesto contiene tamaño o huella documental inválidos.');
    }
  }
}

async function createBackup({ db, userDataDir, destination, allowInternalDestination = false }) {
  if (!db?.open) throw new Error('La base de datos no está disponible para respaldar.');
  const root = path.resolve(userDataDir), target = path.resolve(destination);
  if (!allowInternalDestination && (target === root || target.startsWith(root + path.sep))) throw new Error('El destino del respaldo no puede estar dentro de los datos activos de SICOVEN.');
  if (lstatIfExists(target)) throw new Error('El destino del respaldo ya existe; no se sobrescribirá.');
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = target + '.tmp-' + crypto.randomUUID();
  fs.mkdirSync(staging, { recursive: false });
  try {
    await db.backup(path.join(staging, DB_FILE));
    verifyDatabase(path.join(staging, DB_FILE));
    const sourceDocs = path.join(root, DOCS_DIR), targetDocs = path.join(staging, DOCS_DIR);
    if (lstatIfExists(sourceDocs)) {
      assertDirectory(sourceDocs, 'La carpeta documental de origen');
      const files = collectFiles(sourceDocs);
      fs.mkdirSync(targetDocs, { recursive: true });
      for (const item of files) {
        const from = path.join(sourceDocs, ...item.path.split('/'));
        const to = path.join(targetDocs, ...item.path.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
        if (sha256File(to) !== item.sha256) throw new Error('Falló la verificación de un documento durante el respaldo: ' + item.path);
      }
    }
    const companyDatabases = await copyCompanyDatabaseTree(path.join(root, COMPANIES_DIR), path.join(staging, COMPANIES_DIR));
    const manifest = {
      format: FORMAT, application: 'SICOVEN', createdAt: new Date().toISOString(),
      database: { file: DB_FILE, size: fs.statSync(path.join(staging, DB_FILE)).size, sha256: sha256File(path.join(staging, DB_FILE)) },
      documents: collectFiles(targetDocs),
      companyDatabases
    };
    validateManifest(manifest);
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    verifyBackupDirectory(staging);
    fs.renameSync(staging, target);
    return { ok: true, destination: target, databaseSha256: manifest.database.sha256, documentCount: manifest.documents.length, createdAt: manifest.createdAt };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

function verifyBackupDirectory(directory) {
  const root = path.resolve(directory);
  assertDirectory(root, 'La raíz del respaldo');
  const manifestPath = path.join(root, 'manifest.json');
  if (!lstatIfExists(manifestPath)) throw new Error('El manifiesto del respaldo no existe.');
  const manifestStat = assertRegularFile(manifestPath, 'El manifiesto');
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error('El manifiesto excede el tamaño máximo permitido.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const dbPath = path.join(root, DB_FILE);
  if (!lstatIfExists(dbPath) ||
      assertRegularFile(dbPath, 'La base de datos').size !== manifest.database.size ||
      sha256File(dbPath) !== manifest.database.sha256) {
    throw new Error('La huella o el tamaño de la base respaldada no coincide.');
  }
  const integrity = verifyDatabase(dbPath);
  const docsRoot = path.join(root, DOCS_DIR);
  if (lstatIfExists(docsRoot)) assertDirectory(docsRoot, 'La carpeta de documentos respaldados');
  const actual = collectFiles(docsRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.documents)) throw new Error('Los documentos respaldados no coinciden con el manifiesto.');
  const expectedDirectories = [...new Set(manifest.documents.flatMap(item => {
    const parts = item.path.split('/');
    return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort();
  const actualDirectories = collectDirectories(docsRoot);
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories)) throw new Error('La estructura de directorios del respaldo no coincide con el manifiesto.');
  const actualCompanyDatabases = collectCompanyDatabases(root);
  const expectedCompanyDatabases = (manifest.companyDatabases || []).map(item => ({
    ...item, documents: item.documents || []
  }));
  if (JSON.stringify(actualCompanyDatabases) !== JSON.stringify(expectedCompanyDatabases)) {
    throw new Error('Las bases SQLite o los documentos de las empresas no coinciden con el manifiesto global.');
  }
  const registry = integrity.companyRegistry;
  if (registry === null && expectedCompanyDatabases.length > 0) {
    throw new Error('El respaldo contiene bases de empresas, pero la base de control no contiene su registro multiempresa.');
  }
  if (registry !== null) {
    const registryIds = registry.map(item => item.companyId).sort();
    const manifestIds = expectedCompanyDatabases.map(item => item.companyId).sort();
    if (JSON.stringify(registryIds) !== JSON.stringify(manifestIds)) {
      throw new Error('El registro multiempresa de la base de control no coincide con las bases SQLite incluidas en el respaldo.');
    }
  }
  const allowedRootEntries = new Set(['manifest.json', DB_FILE, DOCS_DIR, COMPANIES_DIR]);
  for (const entry of fs.readdirSync(root)) {
    if (!allowedRootEntries.has(entry)) throw new Error('El respaldo contiene elementos inesperados.');
  }
  return { ok: true, integrity: integrity.integrity, documentCount: actual.length, databaseSha256: manifest.database.sha256, createdAt: manifest.createdAt };
}

function registerBackupIpc({ ipcMain, db, licenseView, getActiveSession, dialog, app, getWindow, operationContext = null, runtime = null, assertOperationalReady = () => {} }) {
  if (typeof assertOperationalReady !== 'function') throw new TypeError('La verificación del estado de restauración global no es válida.');
  if (operationContext && typeof operationContext.acquireMaintenanceLock !== 'function') {
    throw new TypeError('El respaldo global requiere un bloqueo de mantenimiento válido.');
  }
  async function runGlobalBackup(operation) {
    const release = operationContext ? await operationContext.acquireMaintenanceLock() : () => {};
    try {
      runtime?.closeAll?.();
      return await operation();
    } finally {
      release();
    }
  }
  ipcMain.handle('sicoven:backup-create', async (_event, token) => {
    assertOperationalReady();
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('Se requiere una sesión autenticada con rol contable (admin o contador) para crear respaldos.');
    const parentWindow = getWindow?.();
    const options = { title: 'Seleccionar carpeta para el respaldo completo de SICOVEN', properties: ['openDirectory', 'createDirectory'] };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(selection.filePaths[0], 'SICOVEN-backup-' + stamp);
    const result = await runGlobalBackup(() =>
      createBackup({ db, userDataDir: app.getPath('userData'), destination })
    );
    try {
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('accounting_backup_created', JSON.stringify({ actor: actor.username, destination: path.basename(destination), databaseSha256: result.databaseSha256, documentCount: result.documentCount, createdAt: result.createdAt }));
    } catch (auditError) {
      try {
        fs.rmSync(destination, { recursive: true, force: true });
      } catch (cleanupError) {
        throw new Error('Falló la auditoría y no se pudo retirar el paquete no auditado. Conserva la carpeta para revisión: ' + cleanupError.message);
      }
      throw new Error('No se pudo registrar la auditoría; el paquete no auditado fue retirado.');
    }
    return result;
  });
}

module.exports = { FORMAT, createBackup, verifyBackupDirectory, registerBackupIpc };
