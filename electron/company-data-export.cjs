'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');

const MAX_JSON_BYTES = 250 * 1024 * 1024;
const HASH_RE = /^[a-f0-9]{64}$/;

function assertRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(label + ' no es un archivo regular seguro.');
  return stat;
}
function sha256File(file) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let size;
    while ((size = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
function assertCompanyDataIsolation(db, companyId) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  for (const table of tables) {
    const name = String(table.name);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('La base contiene un nombre de tabla no exportable.');
    const columns = db.prepare('PRAGMA table_info("' + name + '")').all();
    if (!columns.some(column => String(column.name).toLowerCase() === 'company_id')) continue;
    const foreignRows = db.prepare('SELECT COUNT(*) AS count FROM "' + name + '" WHERE company_id IS NULL OR CAST(company_id AS TEXT) <> ?').get(String(companyId));
    if (Number(foreignRows?.count || 0) > 0) {
      throw new Error('La tabla ' + name + ' contiene registros sin empresa o pertenecientes a otra empresa. Se bloqueó la entrega para evitar exponer información ajena.');
    }
  }
  return true;
}
function verifyCompanyIdentity(db, companyId, expectedRif) {
  assertSqliteIntegrity(db);
  assertCompanyDataIsolation(db, companyId);
  const metadata = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sicoven_database_meta'").get();
  if (!metadata) throw new Error('La base no contiene metadatos de identidad multiempresa.');
  const id = String(db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get()?.meta_value || '');
  if (id !== String(companyId)) throw new Error('La identidad interna de la base no coincide con la empresa seleccionada.');
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('La base no contiene el estado contable de la empresa.');
  let state;
  try { state = JSON.parse(row.state_json); } catch { throw new Error('El estado contable no es JSON válido.'); }
  if (!Array.isArray(state.companies) || state.companies.length !== 1 ||
      String(state.companies[0]?.id || '') !== String(companyId) ||
      String(state.currentCompanyId || '') !== String(companyId)) {
    throw new Error('El snapshot no pertenece exclusivamente a la empresa seleccionada.');
  }
  const rif = String(state.companies[0].rif || '').trim().toUpperCase();
  if (expectedRif && rif !== String(expectedRif).trim().toUpperCase()) throw new Error('El RIF del snapshot no coincide con el registro local.');
  return { state, company: state.companies[0], rif };
}
function collectDocuments(db, userDataDir) {
  const table = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='supporting_documents'").get();
  if (!table) return [];
  const root = path.join(path.resolve(userDataDir), 'supporting-documents');
  return db.prepare('SELECT id,company_id,entity_type,entity_id,document_type,title,description,original_file_name,mime_type,storage_key,sha256,byte_size,uploaded_by_username,created_at FROM supporting_documents ORDER BY created_at,id')
    .all().map(row => {
      const storageKey = String(row.storage_key || '');
      if (!/^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/i.test(storageKey)) throw new Error('Un documento tiene una clave de almacenamiento inválida.');
      const file = path.join(root, storageKey);
      const stat = assertRegularFile(file, 'Un documento asociado');
      const digest = sha256File(file);
      if (stat.size !== Number(row.byte_size) || digest !== String(row.sha256 || '').toLowerCase() || !HASH_RE.test(digest)) {
        throw new Error('Un documento asociado no superó la verificación de integridad: ' + storageKey);
      }
      return { metadata: row, source: file, size: stat.size, sha256: digest };
    });
}
function exportTablesAsJson(db) {
  const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const output = {};
  for (const table of tables) {
    const name = String(table.name);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error('La base contiene un nombre de tabla no exportable.');
    output[name] = {
      createSql: table.sql,
      rows: db.prepare('SELECT * FROM "' + name + '"').all()
    };
  }
  return output;
}
function writeJsonExport({ db, company, userDataDir, destination }) {
  const identity = verifyCompanyIdentity(db, company.id, company.rif);
  const docs = collectDocuments(db, userDataDir);
  const documentPayload = docs.map(item => ({
    ...item.metadata,
    contentBase64: fs.readFileSync(item.source).toString('base64'),
    sha256: item.sha256
  }));
  const payload = {
    format: 'SICOVEN_COMPANY_DATA_V1',
    application: 'SICOVEN',
    exportedAt: new Date().toISOString(),
    company: { id: String(company.id), name: String(identity.company.name), rif: identity.rif },
    accountingSnapshot: identity.state,
    relationalTables: exportTablesAsJson(db),
    supportingDocuments: documentPayload
  };
  const json = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) throw new Error('La exportación JSON supera 250 MB. Utilice el paquete SQLite para entregar la información completa.');
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error('El archivo de destino ya existe; no se sobrescribirá.');
  const temporary = target + '.tmp-' + crypto.randomUUID();
  try {
    fs.writeFileSync(temporary, json, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } catch (error) {
    try { fs.rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
  return { ok: true, format: 'json', destination: target, bytes: Buffer.byteLength(json, 'utf8'), documentCount: docs.length, companyId: String(company.id) };
}
async function writeSqliteExport({ db, company, userDataDir, destination }) {
  const identity = verifyCompanyIdentity(db, company.id, company.rif);
  const docs = collectDocuments(db, userDataDir);
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error('La carpeta de destino ya existe; no se sobrescribirá.');
  const staging = target + '.tmp-' + crypto.randomUUID();
  fs.mkdirSync(staging, { recursive: false, mode: 0o700 });
  try {
    const databaseFile = path.join(staging, 'accounting.sqlite');
    await db.backup(databaseFile);
    const check = new Database(databaseFile, { readonly: true, fileMustExist: true });
    try { verifyCompanyIdentity(check, company.id, company.rif); }
    finally { check.close(); }
    const docsDirectory = path.join(staging, 'documents');
    fs.mkdirSync(docsDirectory);
    const manifestDocuments = [];
    for (const item of docs) {
      const key = String(item.metadata.storage_key);
      const destinationFile = path.join(docsDirectory, key);
      fs.copyFileSync(item.source, destinationFile, fs.constants.COPYFILE_EXCL);
      if (sha256File(destinationFile) !== item.sha256) throw new Error('Falló la copia de un documento asociado: ' + key);
      manifestDocuments.push({ storageKey: key, size: item.size, sha256: item.sha256 });
    }
    const manifest = {
      format: 'SICOVEN_COMPANY_SQLITE_EXPORT_V1',
      application: 'SICOVEN',
      exportedAt: new Date().toISOString(),
      company: { id: String(company.id), name: String(identity.company.name), rif: identity.rif },
      database: { file: 'accounting.sqlite', size: fs.statSync(databaseFile).size, sha256: sha256File(databaseFile) },
      documents: manifestDocuments
    };
    fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    fs.renameSync(staging, target);
    return { ok: true, format: 'sqlite', destination: target, documentCount: docs.length, companyId: String(company.id), databaseSha256: manifest.database.sha256 };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}
async function exportCompanyData(options) {
  const format = String(options?.format || '').toLowerCase();
  if (format === 'json') return writeJsonExport(options);
  if (format === 'sqlite') return writeSqliteExport(options);
  throw new Error('Formato de entrega no admitido. Seleccione SQLite o JSON.');
}
module.exports = { exportCompanyData, verifyCompanyIdentity, assertCompanyDataIsolation, collectDocuments, exportTablesAsJson };
