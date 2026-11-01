const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');

const FORMAT = 'SICOVEN_BACKUP_V1';
const DB_FILE = 'sicoven.sqlite';
const DOCS_DIR = 'supporting-documents';
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}
function collectFiles(root, relative = '') {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry => {
    const abs = path.join(root, entry.name), rel = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) throw new Error('El respaldo no admite enlaces simbólicos en documentos.');
    if (entry.isDirectory()) return collectFiles(abs, rel);
    if (!entry.isFile()) throw new Error('El respaldo contiene un elemento documental no admitido.');
    return [{ path: rel, size: fs.statSync(abs).size, sha256: sha256File(abs) }];
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
  const manifestPath = path.join(root, 'manifest.json');
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) throw new Error('El manifiesto del respaldo no existe.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.format !== FORMAT || manifest.application !== 'SICOVEN' || manifest.database?.file !== DB_FILE || !Array.isArray(manifest.documents)) throw new Error('El formato del respaldo no es compatible.');
  const dbPath = path.join(root, DB_FILE);
  if (!fs.existsSync(dbPath) || fs.statSync(dbPath).size !== manifest.database.size || sha256File(dbPath) !== manifest.database.sha256) throw new Error('La huella o el tamaño de la base respaldada no coincide.');
  const integrity = verifyDatabase(dbPath);
  const docsRoot = path.join(root, DOCS_DIR);
  const actual = collectFiles(docsRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.documents)) throw new Error('Los documentos respaldados no coinciden con el manifiesto.');
  return { ok: true, integrity: integrity.integrity, documentCount: actual.length, databaseSha256: manifest.database.sha256, createdAt: manifest.createdAt };
}
module.exports = { FORMAT, createBackup, verifyBackupDirectory };
