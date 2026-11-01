const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');

const FORMAT = 'SICOVEN_BACKUP_V1';
const DB_FILE = 'sicoven.sqlite';
const DOCS_DIR = 'supporting-documents';
const HASH_RE = /^[a-f0-9]{64}$/;
const MAX_DOCUMENTS = 10000;
const MAX_RELATIVE_PATH = 1024;
const HASH_CHUNK_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;

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
  if (!fs.existsSync(root)) return [];
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
  if (!fs.existsSync(root)) return [];
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
  const check = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = assertSqliteIntegrity(check);
    const state = check.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    if (!state) throw new Error('El respaldo no contiene el estado contable.');
    JSON.parse(state.state_json);
    return { integrity, companies: check.prepare("SELECT json_extract(state_json,'$.companies') AS companies FROM app_state WHERE state_key='accounting'").get()?.companies ?? null };
  } finally { check.close(); }
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.format !== FORMAT || manifest.application !== 'SICOVEN' ||
      !manifest.database || typeof manifest.database !== 'object' ||
      manifest.database.file !== DB_FILE ||
      !Number.isSafeInteger(manifest.database.size) || manifest.database.size <= 0 ||
      typeof manifest.database.sha256 !== 'string' || !HASH_RE.test(manifest.database.sha256) ||
      typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) ||
      !Array.isArray(manifest.documents) || manifest.documents.length > MAX_DOCUMENTS) {
    throw new Error('El formato del respaldo no es compatible o el manifiesto es inválido.');
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

async function createBackup({ db, userDataDir, destination }) {
  if (!db?.open) throw new Error('La base de datos no está disponible para respaldar.');
  const root = path.resolve(userDataDir), target = path.resolve(destination);
  if (target === root || target.startsWith(root + path.sep)) throw new Error('El destino del respaldo no puede estar dentro de los datos activos de SICOVEN.');
  if (fs.existsSync(target)) throw new Error('El destino del respaldo ya existe; no se sobrescribirá.');
  const parent = path.dirname(target);
  fs.mkdirSync(parent, { recursive: true });
  const staging = target + '.tmp-' + crypto.randomUUID();
  fs.mkdirSync(staging, { recursive: false });
  try {
    await db.backup(path.join(staging, DB_FILE));
    verifyDatabase(path.join(staging, DB_FILE));
    const sourceDocs = path.join(root, DOCS_DIR), targetDocs = path.join(staging, DOCS_DIR);
    if (fs.existsSync(sourceDocs)) {
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
    const manifest = {
      format: FORMAT, application: 'SICOVEN', createdAt: new Date().toISOString(),
      database: { file: DB_FILE, size: fs.statSync(path.join(staging, DB_FILE)).size, sha256: sha256File(path.join(staging, DB_FILE)) },
      documents: collectFiles(targetDocs)
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
  if (!fs.existsSync(manifestPath)) throw new Error('El manifiesto del respaldo no existe.');
  const manifestStat = assertRegularFile(manifestPath, 'El manifiesto');
  if (manifestStat.size > MAX_MANIFEST_BYTES) throw new Error('El manifiesto excede el tamaño máximo permitido.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const dbPath = path.join(root, DB_FILE);
  if (!fs.existsSync(dbPath) ||
      assertRegularFile(dbPath, 'La base de datos').size !== manifest.database.size ||
      sha256File(dbPath) !== manifest.database.sha256) {
    throw new Error('La huella o el tamaño de la base respaldada no coincide.');
  }
  const integrity = verifyDatabase(dbPath);
  const docsRoot = path.join(root, DOCS_DIR);
  if (fs.existsSync(docsRoot)) assertDirectory(docsRoot, 'La carpeta de documentos respaldados');
  const actual = collectFiles(docsRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.documents)) throw new Error('Los documentos respaldados no coinciden con el manifiesto.');
  const expectedDirectories = [...new Set(manifest.documents.flatMap(item => {
    const parts = item.path.split('/');
    return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'));
  }))].sort();
  const actualDirectories = collectDirectories(docsRoot);
  if (JSON.stringify(actualDirectories) !== JSON.stringify(expectedDirectories)) throw new Error('La estructura de directorios del respaldo no coincide con el manifiesto.');
  const allowedRootEntries = new Set(['manifest.json', DB_FILE, DOCS_DIR]);
  for (const entry of fs.readdirSync(root)) {
    if (!allowedRootEntries.has(entry)) throw new Error('El respaldo contiene elementos inesperados.');
  }
  return { ok: true, integrity: integrity.integrity, documentCount: actual.length, databaseSha256: manifest.database.sha256, createdAt: manifest.createdAt };
}

function registerBackupIpc({ ipcMain, db, licenseView, getActiveSession, dialog, app, getWindow }) {
  ipcMain.handle('sicoven:backup-create', async (_event, token) => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor || String(actor.role || '').toLowerCase() !== 'admin') throw new Error('Solo un administrador autenticado puede crear respaldos.');
    const parentWindow = getWindow?.();
    const options = { title: 'Seleccionar carpeta para el respaldo completo de SICOVEN', properties: ['openDirectory', 'createDirectory'] };
    const selection = parentWindow ? await dialog.showOpenDialog(parentWindow, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(selection.filePaths[0], 'SICOVEN-backup-' + stamp);
    const result = await createBackup({ db, userDataDir: app.getPath('userData'), destination });
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
