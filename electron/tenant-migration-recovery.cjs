'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const DatabaseDefault = require('better-sqlite3');
const { assertSqliteIntegrity: assertSqliteIntegrityDefault } = require('./sqlite-integrity.cjs');
const { readTenantSnapshot: readTenantSnapshotDefault } = require('./tenant-persistence.cjs');
const { createTenantMigrationJournal } = require('./tenant-migration-journal.cjs');
const { normalizeCompanyId } = require('./company-database-manager.cjs');
const { validateStorageKey } = require('./tenant-document-migration.cjs');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}

function assertRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(label + ' no es un archivo regular seguro.');
  return stat;
}

function assertDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(label + ' no es un directorio seguro.');
}

function inspectTenantMigrationRecovery(options) {
  const {
    userDataDir,
    manager,
    Database = DatabaseDefault,
    assertSqliteIntegrity = assertSqliteIntegrityDefault,
    readSnapshot = readTenantSnapshotDefault
  } = options || {};
  if (!userDataDir || !path.isAbsolute(userDataDir)) throw new TypeError('La carpeta local de datos debe ser absoluta.');
  if (!manager || typeof manager.listCompanies !== 'function') throw new TypeError('Se requiere el registro local de empresas.');
  const root = path.resolve(userDataDir);
  const migrationRoot = path.join(root, 'tenant-migration');
  const journalPath = path.join(migrationRoot, 'tenant-migration-journal.json');
  if (!fs.existsSync(journalPath)) return Object.freeze({ found: false, canFinalize: false, companies: [] });
  assertDirectory(migrationRoot, 'La carpeta de migración');
  const journal = createTenantMigrationJournal({ userDataDir: root });
  const record = journal.read();
  if (!record) return Object.freeze({ found: false, canFinalize: false, companies: [] });

  const backup = { valid: false, path: record.sourceBackupPath, sha256: record.sourceBackupSha256, errors: [] };
  try {
    const backupPath = path.resolve(record.sourceBackupPath);
    if (path.dirname(backupPath) !== migrationRoot || !/^sicoven-[a-f0-9-]{36}\.sqlite\.backup$/i.test(path.basename(backupPath))) {
      throw new Error('La ruta del respaldo no pertenece a la carpeta local de migración.');
    }
    assertRegularFile(backupPath, 'El respaldo de origen');
    if (sha256File(backupPath) !== record.sourceBackupSha256) throw new Error('El SHA-256 del respaldo no coincide con el journal.');
    const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try { assertSqliteIntegrity(backupDb); } finally { backupDb.close(); }
    backup.valid = true;
  } catch (error) {
    backup.errors.push(String(error?.message || error));
  }

  const registry = new Map(manager.listCompanies().map(item => [String(item.id), item]));
  const companiesRoot = path.join(root, 'companies');
  const companies = record.companyIds.map(companyIdInput => {
    const companyId = normalizeCompanyId(companyIdInput);
    const item = {
      companyId, databaseValid: false, snapshotValid: false, documentsValid: false,
      registered: false, registryMatches: false, errors: []
    };
    const companyDirectory = path.join(companiesRoot, companyId);
    const databasePath = path.join(companyDirectory, 'accounting.sqlite');
    try {
      assertDirectory(companiesRoot, 'La carpeta companies');
      assertDirectory(companyDirectory, 'La carpeta de ' + companyId);
      assertRegularFile(databasePath, 'La base de ' + companyId);
      const db = new Database(databasePath, { readonly: true, fileMustExist: true });
      try {
        assertSqliteIntegrity(db);
        if (db.pragma('foreign_key_check').length) throw new Error('La base contiene claves foráneas inválidas.');
        const identity = db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
        if (String(identity?.meta_value || '') !== companyId) throw new Error('La identidad interna no coincide con la empresa del journal.');
        item.databaseValid = true;

        const snapshot = readSnapshot(db, companyId);
        if (!snapshot || !Array.isArray(snapshot.companies) || snapshot.companies.length !== 1 ||
            String(snapshot.companies[0]?.id || '') !== companyId ||
            String(snapshot.currentCompanyId || '') !== companyId) {
          throw new Error('El snapshot no contiene exactamente la empresa propietaria.');
        }
        item.snapshotValid = true;

        const documents = db.prepare(
          'SELECT storage_key,byte_size,sha256 FROM supporting_documents WHERE company_id=? ORDER BY id'
        ).all(companyId);
        const documentsRoot = path.join(companyDirectory, 'supporting-documents');
        if (documents.length) assertDirectory(documentsRoot, 'El almacén documental de ' + companyId);
        for (const document of documents) {
          const key = validateStorageKey(document.storage_key);
          const filePath = path.resolve(documentsRoot, key);
          if (path.dirname(filePath) !== documentsRoot) throw new Error('Un documento intenta salir del almacén de la empresa.');
          const stat = assertRegularFile(filePath, 'Un documento de ' + companyId);
          if (stat.size !== Number(document.byte_size) || sha256File(filePath) !== String(document.sha256).toLowerCase()) {
            throw new Error('Un documento de ' + companyId + ' no coincide con su tamaño o SHA-256.');
          }
        }
        item.documentsValid = true;
        item.company = snapshot.companies[0];
      } finally { db.close(); }
    } catch (error) {
      item.errors.push(String(error?.message || error));
    }

    const registered = registry.get(companyId);
    if (registered) {
      item.registered = true;
      item.registryMatches = Boolean(item.company &&
        String(registered.status) === 'ACTIVE' &&
        String(registered.name) === String(item.company.name) &&
        String(registered.rif).toUpperCase() === String(item.company.rif).toUpperCase() &&
        path.normalize(String(registered.relativePath)) === path.normalize(path.join('companies', companyId, 'accounting.sqlite')));
      if (!item.registryMatches) item.errors.push('El registro local no coincide con la identidad o ruta de la base preparada.');
    }
    return Object.freeze(item);
  });

  const allPrepared = companies.length > 0 && companies.every(item =>
    item.databaseValid && item.snapshotValid && item.documentsValid && item.errors.length === 0
  );
  const allRegistered = companies.length > 0 && companies.every(item => item.registered && item.registryMatches);
  const canFinalize = record.phase === 'REGISTERING' && backup.valid && allPrepared && allRegistered;
  return Object.freeze({
    found: true,
    journal: record,
    backup: Object.freeze({ ...backup, errors: Object.freeze(backup.errors) }),
    companies: Object.freeze(companies),
    allPrepared,
    allRegistered,
    canFinalize,
    requiresManualRecovery: !backup.valid || !allPrepared || !allRegistered ||
      (record.phase !== 'COMMITTED' && !canFinalize)
  });
}

function finalizeTenantMigrationRecovery(options) {
  const inspection = inspectTenantMigrationRecovery(options);
  if (!inspection.found) throw new Error('No existe una migración que requiera reconciliación.');
  if (!inspection.canFinalize) {
    throw new Error('No es seguro confirmar el journal: el respaldo, las bases, los documentos o el registro no superaron la inspección.');
  }
  const journal = createTenantMigrationJournal({ userDataDir: path.resolve(options.userDataDir) });
  return journal.advance('REGISTERING', 'COMMITTED');
}

module.exports = { inspectTenantMigrationRecovery, finalizeTenantMigrationRecovery, sha256File };
