'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { hasFullSystemAccess } = require('./auth-roles.cjs');

const FORMAT = 'SICOVEN_COMPANY_BACKUP_V1';
const DATABASE_FILE = 'accounting.sqlite';
const DOCUMENTS_DIR = 'documents';
const HASH_RE = /^[a-f0-9]{64}$/;
const STORAGE_KEY_RE = /^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/;

function exists(target) {
  try { fs.lstatSync(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function assertDirectory(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(label + ' debe ser un directorio real y seguro.');
}
function assertFile(target, label) {
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + ' debe ser un archivo regular y seguro.');
  return stat;
}
function hashFile(target) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(target, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function assertStorageKey(value) {
  const key = String(value || '');
  if (!STORAGE_KEY_RE.test(key)) throw new Error('La base contiene una clave documental no válida.');
  return key;
}
function readCompanyIdentity(db, companyId) {
  const metaTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sicoven_database_meta'").get();
  if (!metaTable) throw new Error('La SQLite no contiene metadatos de identidad multiempresa.');
  const meta = db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
  if (String(meta?.meta_value || '') !== String(companyId)) throw new Error('La identidad interna de la SQLite no coincide con la empresa seleccionada.');
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('La SQLite no contiene el estado contable de la empresa.');
  let state;
  try { state = JSON.parse(row.state_json); } catch { throw new Error('El estado contable de la empresa no es JSON válido.'); }
  if (!Array.isArray(state.companies) || state.companies.length !== 1 ||
      String(state.companies[0]?.id || '') !== String(companyId) ||
      String(state.currentCompanyId || '') !== String(companyId)) {
    throw new Error('El snapshot contable no pertenece exclusivamente a la empresa seleccionada.');
  }
  return { rif: String(state.companies[0].rif || '').trim().toUpperCase(), name: String(state.companies[0].name || '') };
}
function listCompanyDocuments(db) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supporting_documents'").get();
  if (!table) return [];
  return db.prepare('SELECT storage_key AS storageKey,sha256,byte_size AS size FROM supporting_documents ORDER BY storage_key').all()
    .map(row => ({ storageKey: assertStorageKey(row.storageKey), sha256: String(row.sha256 || '').toLowerCase(), size: Number(row.size) }));
}
function validateManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest) ||
      manifest.format !== FORMAT || manifest.application !== 'SICOVEN' ||
      typeof manifest.companyId !== 'string' || !/^[A-Za-z0-9_-]{1,120}$/.test(manifest.companyId) ||
      typeof manifest.rif !== 'string' || !manifest.rif ||
      !manifest.database || manifest.database.file !== DATABASE_FILE ||
      !Number.isSafeInteger(manifest.database.size) || manifest.database.size < 1 ||
      !HASH_RE.test(String(manifest.database.sha256 || '')) ||
      !Array.isArray(manifest.documents) || manifest.documents.length > 10000) {
    throw new Error('El manifiesto del respaldo individual es inválido o incompatible.');
  }
  const seen = new Set();
  for (const item of manifest.documents) {
    const key = assertStorageKey(item?.storageKey);
    if (seen.has(key) || !Number.isSafeInteger(item.size) || item.size < 1 || !HASH_RE.test(String(item.sha256 || ''))) {
      throw new Error('El manifiesto contiene documentos duplicados o datos de integridad inválidos.');
    }
    seen.add(key);
  }
}
function verifyCompanyDatabase(file, manifest, Database, assertSqliteIntegrity) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const integrity = assertSqliteIntegrity(db);
    const identity = readCompanyIdentity(db, manifest.companyId);
    if (identity.rif !== String(manifest.rif).toUpperCase()) throw new Error('El RIF de la base no coincide con el manifiesto del respaldo.');
    const documents = listCompanyDocuments(db);
    const expected = manifest.documents.map(item => ({ storageKey: item.storageKey, sha256: item.sha256, size: item.size }));
    if (JSON.stringify(documents) !== JSON.stringify(expected)) throw new Error('Los documentos registrados en SQLite no coinciden con el manifiesto.');
    return { integrity, identity };
  } finally { db.close(); }
}
async function createCompanyBackup({ db, company, userDataDir, destination }) {
  if (!db?.open) throw new Error('La base de la empresa no está abierta.');
  const companyId = String(company?.id || '');
  if (!companyId) throw new Error('La empresa seleccionada no es válida.');
  const root = path.resolve(userDataDir), target = path.resolve(destination);
  if (target === root || target.startsWith(root + path.sep)) throw new Error('El respaldo debe guardarse fuera de los datos activos de SICOVEN.');
  if (exists(target)) throw new Error('El destino ya existe; no se sobrescribirá ningún respaldo.');
  const identity = readCompanyIdentity(db, companyId);
  if (identity.rif !== String(company.rif || '').trim().toUpperCase()) throw new Error('La identidad de la base no coincide con la ficha de la empresa.');
  const staging = target + '.tmp-' + crypto.randomUUID();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.mkdirSync(staging, { recursive: false });
  try {
    const databasePath = path.join(staging, DATABASE_FILE);
    await db.backup(databasePath);
    const sourceDocuments = path.join(root, 'supporting-documents');
    const documentRows = listCompanyDocuments(db);
    const documentsRoot = path.join(staging, DOCUMENTS_DIR);
    if (documentRows.length) {
      if (!exists(sourceDocuments)) throw new Error('Falta el almacén local de documentos asociados a la empresa.');
      assertDirectory(sourceDocuments, 'El almacén documental');
      fs.mkdirSync(documentsRoot, { recursive: false });
      for (const item of documentRows) {
        if (!HASH_RE.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1) throw new Error('Un registro documental contiene integridad inválida.');
        const from = path.join(sourceDocuments, item.storageKey);
        assertFile(from, 'Un documento asociado');
        if (fs.statSync(from).size !== item.size || hashFile(from) !== item.sha256) throw new Error('Un documento asociado no supera la verificación SHA-256: ' + item.storageKey);
        fs.copyFileSync(from, path.join(documentsRoot, item.storageKey), fs.constants.COPYFILE_EXCL);
      }
    }
    const manifest = {
      format: FORMAT, application: 'SICOVEN', createdAt: new Date().toISOString(),
      companyId, rif: identity.rif, companyName: identity.name,
      database: { file: DATABASE_FILE, size: fs.statSync(databasePath).size, sha256: hashFile(databasePath) },
      documents: documentRows
    };
    validateManifest(manifest);
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    verifyCompanyBackupDirectory(staging, { Database: db.constructor, assertSqliteIntegrity: value => value.pragma('integrity_check') });
    fs.renameSync(staging, target);
    return { ok: true, companyId, destination: target, databaseSha256: manifest.database.sha256, documentCount: manifest.documents.length, createdAt: manifest.createdAt };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
function verifyCompanyBackupDirectory(directory, { Database, assertSqliteIntegrity }) {
  if (typeof Database !== 'function' || typeof assertSqliteIntegrity !== 'function') throw new TypeError('Faltan validadores SQLite para verificar el respaldo.');
  const root = path.resolve(directory);
  assertDirectory(root, 'La carpeta del respaldo');
  const manifestPath = path.join(root, 'manifest.json');
  assertFile(manifestPath, 'El manifiesto');
  if (fs.statSync(manifestPath).size > 8 * 1024 * 1024) throw new Error('El manifiesto excede el tamaño permitido.');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  validateManifest(manifest);
  const databasePath = path.join(root, DATABASE_FILE);
  const stat = assertFile(databasePath, 'La base del respaldo');
  if (stat.size !== manifest.database.size || hashFile(databasePath) !== manifest.database.sha256) throw new Error('La huella o el tamaño de la SQLite no coincide con el manifiesto.');
  const verified = verifyCompanyDatabase(databasePath, manifest, Database, assertSqliteIntegrity);
  const docsRoot = path.join(root, DOCUMENTS_DIR);
  if (manifest.documents.length) assertDirectory(docsRoot, 'La carpeta documental del respaldo');
  const expectedNames = new Set(manifest.documents.map(item => item.storageKey));
  const actualNames = exists(docsRoot) ? fs.readdirSync(docsRoot) : [];
  if (actualNames.some(name => !expectedNames.has(name)) || actualNames.length !== expectedNames.size) throw new Error('El contenido documental del respaldo no coincide con el manifiesto.');
  for (const item of manifest.documents) {
    const file = path.join(docsRoot, item.storageKey);
    assertFile(file, 'Un documento del respaldo');
    if (fs.statSync(file).size !== item.size || hashFile(file) !== item.sha256) throw new Error('Falló la integridad del documento: ' + item.storageKey);
  }
  const allowed = new Set(['manifest.json', DATABASE_FILE, DOCUMENTS_DIR]);
  if (fs.readdirSync(root).some(name => !allowed.has(name))) throw new Error('El respaldo contiene archivos o carpetas no admitidos.');
  return { ok: true, manifest, identity: verified.identity };
}
async function restoreCompanyBackup({ directory, companyId, runtime, operationContext, userDataDir, Database, assertSqliteIntegrity }) {
  const verified = verifyCompanyBackupDirectory(directory, { Database, assertSqliteIntegrity });
  const manifest = verified.manifest;
  if (String(manifest.companyId) !== String(companyId)) throw new Error('El respaldo pertenece a otra empresa. No se modificó ninguna base.');
  const record = runtime.listCompanies().find(item => String(item.id) === String(companyId) && item.status === 'ACTIVE');
  if (!record || String(record.rif).toUpperCase() !== String(manifest.rif).toUpperCase()) throw new Error('La empresa registrada no coincide con la identidad del respaldo.');
  const release = await operationContext.acquireMaintenanceLock();
  const root = path.resolve(userDataDir);
  const documentRoot = path.join(root, 'supporting-documents');
  let rollbackPath = null, databasePath = null, installed = false;
  try {
    const liveDb = runtime.getCompanyDatabase(companyId);
    liveDb.pragma('wal_checkpoint(TRUNCATE)');
    databasePath = runtime.getCompanyDatabasePath(companyId);
    runtime.closeCompany(companyId);
    rollbackPath = databasePath + '.rollback-' + crypto.randomUUID();
    fs.copyFileSync(databasePath, rollbackPath, fs.constants.COPYFILE_EXCL);
    const incomingPath = path.join(path.resolve(directory), DATABASE_FILE);
    const stagedPath = databasePath + '.incoming-' + crypto.randomUUID();
    fs.copyFileSync(incomingPath, stagedPath, fs.constants.COPYFILE_EXCL);
    try {
      fs.renameSync(databasePath, databasePath + '.pre-restore-' + crypto.randomUUID());
      fs.renameSync(stagedPath, databasePath);
      installed = true;
      const restoredDb = runtime.getCompanyDatabase(companyId);
      const identity = readCompanyIdentity(restoredDb, companyId);
      if (identity.rif !== String(manifest.rif).toUpperCase()) throw new Error('La base restaurada no conserva la identidad de la empresa.');
      if (manifest.documents.length) fs.mkdirSync(documentRoot, { recursive: true });
      for (const item of manifest.documents) {
        const target = path.join(documentRoot, item.storageKey);
        if (exists(target)) {
          assertFile(target, 'Un documento local existente');
          if (fs.statSync(target).size !== item.size || hashFile(target) !== item.sha256) throw new Error('Existe una clave documental con contenido distinto; se bloqueó la restauración: ' + item.storageKey);
        } else {
          fs.copyFileSync(path.join(path.resolve(directory), DOCUMENTS_DIR, item.storageKey), target, fs.constants.COPYFILE_EXCL);
        }
      }
      assertSqliteIntegrity(restoredDb);
    } catch (error) {
      try { runtime.closeCompany(companyId); } catch {}
      if (installed && exists(databasePath)) fs.renameSync(databasePath, databasePath + '.failed-restore-' + crypto.randomUUID());
      if (rollbackPath && exists(rollbackPath)) fs.renameSync(rollbackPath, databasePath);
      runtime.getCompanyDatabase(companyId);
      throw new Error('La restauración individual falló y se recuperó la SQLite anterior: ' + String(error?.message || error), { cause: error });
    }
    if (rollbackPath && exists(rollbackPath)) fs.unlinkSync(rollbackPath);
    return { ok: true, companyId, restoredDatabaseSha256: manifest.database.sha256, documentCount: manifest.documents.length };
  } finally {
    release();
  }
}
function registerCompanyBackupIpc({ ipcMain, runtime, operationContext, companySessionContext, licenseView, getActiveSession, dialog, app, getWindow, Database, assertSqliteIntegrity }) {
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('Se requiere una sesión contable autenticada para respaldar o restaurar una empresa.');
    return actor;
  };
  ipcMain.handle('sicoven:company-backup-create', async (event, token) => {
    const actor = authenticate(token);
    const companyId = companySessionContext.getSelectedCompanyId(token);
    const company = runtime.listCompanies().find(item => String(item.id) === companyId && item.status === 'ACTIVE');
    if (!company) throw new Error('No existe una empresa activa seleccionada.');
    const parent = getWindow?.(event.sender);
    const selection = parent
      ? await dialog.showOpenDialog(parent, { title: 'Guardar respaldo de la empresa', properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ title: 'Guardar respaldo de la empresa', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const destination = path.join(selection.filePaths[0], 'SICOVEN-' + companyId + '-backup-' + new Date().toISOString().replace(/[:.]/g, '-'));
    const release = await operationContext.acquireMaintenanceLock();
    try {
      const db = runtime.getCompanyDatabase(companyId);
      const result = await createCompanyBackup({ db, company, userDataDir: app.getPath('userData'), destination });
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('company_backup_created', JSON.stringify({ companyId, actor: actor.username, destination: path.basename(destination), databaseSha256: result.databaseSha256, documentCount: result.documentCount, createdAt: result.createdAt }));
      return result;
    } finally { release(); }
  });
  ipcMain.handle('sicoven:company-backup-restore', async (event, token) => {
    authenticate(token);
    const companyId = companySessionContext.getSelectedCompanyId(token);
    const parent = getWindow?.(event.sender);
    const selection = parent
      ? await dialog.showOpenDialog(parent, { title: 'Seleccionar respaldo de esta empresa', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: 'Seleccionar respaldo de esta empresa', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    return restoreCompanyBackup({ directory: selection.filePaths[0], companyId, runtime, operationContext, userDataDir: app.getPath('userData'), Database, assertSqliteIntegrity });
  });
}
module.exports = { FORMAT, createCompanyBackup, verifyCompanyBackupDirectory, restoreCompanyBackup, registerCompanyBackupIpc, readCompanyIdentity, listCompanyDocuments };
