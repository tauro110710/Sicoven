'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const DatabaseDefault = require('better-sqlite3');
const { assertSqliteIntegrity: assertSqliteIntegrityDefault } = require('./sqlite-integrity.cjs');
const { initializeTenantDatabase: initializeTenantDatabaseDefault } = require('./tenant-schema.cjs');
const { partitionAccountingSnapshot } = require('./tenant-snapshot.cjs');
const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');
const { readTenantSnapshot } = require('./tenant-persistence.cjs');
const { copyCompanyRelationalData } = require('./tenant-relational-migration.cjs');
const { partitionAuditEvents, copyAuditEvents } = require('./tenant-audit-migration.cjs');
const { copyCompanyDocumentFiles } = require('./tenant-document-migration.cjs');
const { inspectLegacyDatabase } = require('./tenant-migration-preflight.cjs');
const { createTenantMigrationJournal } = require('./tenant-migration-journal.cjs');
const { normalizeCompanyId } = require('./company-database-manager.cjs');

function assertSafeDirectory(directory, label) {
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(label + ' no es un directorio local seguro.');
}

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

function readLegacyAccountingSnapshot(sourceDb) {
  const row = sourceDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row || typeof row.state_json !== 'string') throw new Error('No se encontró el snapshot contable heredado; no se iniciará la migración.');
  let snapshot;
  try { snapshot = JSON.parse(row.state_json); }
  catch { throw new Error('El snapshot contable heredado no es JSON válido; no se iniciará la migración.'); }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('El snapshot contable heredado no tiene una estructura válida.');
  return snapshot;
}

function ensureDirectoryAbsent(directory, label) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(label + ' existe, pero no es un directorio local seguro.');
  throw new Error(label + ' ya existe. Se conserva intacto y requiere inspección antes de migrar.');
}

function createTenantMigrationOrchestrator(options) {
  const {
    sourceDb, userDataDir, manager, assertSourceQuiescent,
    getDocumentsRoot = () => path.join(userDataDir, 'supporting-documents'),
    Database = DatabaseDefault,
    assertSqliteIntegrity = assertSqliteIntegrityDefault,
    initializeTenantDatabase = initializeTenantDatabaseDefault,
    inspectLegacy = inspectLegacyDatabase,
    partitionSnapshot = partitionAccountingSnapshot,
    persistSnapshot = persistAccountingSnapshot,
    readSnapshot = readTenantSnapshot,
    copyRelational = copyCompanyRelationalData,
    splitAudit = partitionAuditEvents,
    copyAudit = copyAuditEvents,
    copyDocuments = copyCompanyDocumentFiles,
    createJournal = createTenantMigrationJournal,
    now = () => new Date().toISOString(),
    id = () => crypto.randomUUID()
  } = options || {};

  if (!sourceDb || !sourceDb.open || typeof sourceDb.prepare !== 'function' || typeof sourceDb.backup !== 'function') {
    throw new TypeError('Se requiere la base SQLite heredada abierta y con soporte de respaldo consistente.');
  }
  if (!userDataDir || !path.isAbsolute(userDataDir)) throw new TypeError('La carpeta local de datos de SICOVEN debe ser absoluta.');
  if (!manager || typeof manager.listCompanies !== 'function' || typeof manager.registerExistingCompanies !== 'function') {
    throw new TypeError('Se requiere el gestor local de bases por empresa.');
  }

  const root = path.resolve(userDataDir);
  const migrationRoot = path.join(root, 'tenant-migration');
  const companiesRoot = path.join(root, 'companies');

  async function execute() {
    if (assertSourceQuiescent() !== true) {
      throw new Error('La base heredada no está en mantenimiento exclusivo; se bloqueó la migración para evitar una copia inconsistente.');
    }
    const preflight = inspectLegacy(sourceDb);
    if (!preflight.ok) throw new Error('La inspección previa bloqueó la migración: ' + preflight.errors.join(' '));

    const legacySnapshot = readLegacyAccountingSnapshot(sourceDb);
    const snapshots = partitionSnapshot(legacySnapshot);
    const companies = snapshots.map(snapshot => snapshot.companies[0]);
    const companyIds = companies.map(company => normalizeCompanyId(company.id));
    if (companies.length !== preflight.companyCount ||
        companyIds.length !== preflight.companyIds.length ||
        companyIds.some((companyId, index) => companyId !== preflight.companyIds[index])) {
      throw new Error('La lista de empresas cambió entre la inspección y la partición del snapshot.');
    }

    const registered = manager.listCompanies();
    const existingIds = new Set(registered.map(item => String(item.id)));
    if (companyIds.some(companyId => existingIds.has(companyId))) {
      throw new Error('Una o más empresas ya tienen una base registrada. No se mezclará ni sobrescribirá ninguna base.');
    }

    fs.mkdirSync(migrationRoot, { recursive: true, mode: 0o700 });
    assertSafeDirectory(migrationRoot, 'La carpeta de migración');
    const migrationId = id();
    const backupPath = path.join(migrationRoot, 'sicoven-' + migrationId + '.sqlite.backup');
    if (fs.existsSync(backupPath)) throw new Error('La ruta de respaldo ya existe; no se sobrescribirá.');
    await sourceDb.backup(backupPath);
    const backupStat = fs.lstatSync(backupPath);
    if (backupStat.isSymbolicLink() || !backupStat.isFile() || backupStat.size < 1) {
      throw new Error('El respaldo SQLite consistente no se generó como archivo regular.');
    }

    const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      assertSqliteIntegrity(backupDb);
      const backupPreflight = inspectLegacy(backupDb);
      if (!backupPreflight.ok) throw new Error('El respaldo no superó el mismo inventario previo: ' + backupPreflight.errors.join(' '));
      const backupSnapshot = readLegacyAccountingSnapshot(backupDb);
      if (!isDeepStrictEqual(backupSnapshot, legacySnapshot)) throw new Error('El snapshot del respaldo no coincide con el origen; se canceló la migración.');
      if (backupPreflight.companyIds.length !== companyIds.length ||
          backupPreflight.companyIds.some((companyId, index) => String(companyId) !== String(companyIds[index]))) {
        throw new Error('El inventario de empresas del respaldo no coincide con el inventario previo del origen.');
      }
    } catch (error) {
      if (backupDb.open) backupDb.close();
      throw error;
    }
    const backupHash = sha256File(backupPath);
    let journal = null;
    let journalOwned = false;
    let auditPartition;
    const companyResults = [];

    try {
      let journalIdFirstCall = true;
      journal = createJournal({
        userDataDir: root,
        now,
        id: () => {
          if (journalIdFirstCall) { journalIdFirstCall = false; return migrationId; }
          return crypto.randomUUID();
        }
      });
      journal.create({ companyIds, sourceBackupPath: backupPath, sourceBackupSha256: backupHash });
      journalOwned = true;
      journal.advance('PREPARED', 'STAGING');

      const auditRows = backupDb.prepare('SELECT id,event_type,details_json,created_at FROM audit_events ORDER BY id').all();
      auditPartition = splitAudit(auditRows, companyIds);
      const documentRoot = path.resolve(getDocumentsRoot());
      fs.mkdirSync(companiesRoot, { recursive: true, mode: 0o700 });
      assertSafeDirectory(companiesRoot, 'La carpeta companies');

      for (const snapshot of snapshots) {
        const company = snapshot.companies[0];
        const companyId = normalizeCompanyId(company.id);
        const companyDirectory = path.join(companiesRoot, companyId);
        ensureDirectoryAbsent(companyDirectory, 'La carpeta de datos de ' + companyId);
        fs.mkdirSync(companyDirectory, { recursive: false, mode: 0o700 });
        assertSafeDirectory(companyDirectory, 'La carpeta de datos de ' + companyId);
        const databasePath = path.join(companyDirectory, 'accounting.sqlite');
        const tenantDb = new Database(databasePath);
        let relationalResult;
        let auditCount = 0;
        let documentResult = { copiedFiles: 0, totalBytes: 0 };
        try {
          tenantDb.pragma('journal_mode = WAL');
          tenantDb.pragma('foreign_keys = ON');
          tenantDb.pragma('synchronous = FULL');
          initializeTenantDatabase(tenantDb);
          tenantDb.exec('CREATE TABLE sicoven_database_meta (meta_key TEXT PRIMARY KEY, meta_value TEXT NOT NULL)');
          const insertMeta = tenantDb.prepare('INSERT INTO sicoven_database_meta(meta_key,meta_value) VALUES(?,?)');
          insertMeta.run('company_id', companyId);
          insertMeta.run('schema_version', '1');

          // Preserve original audit IDs first so migration audit rows append after them.
          auditCount = copyAudit(tenantDb, auditPartition.byCompany.get(companyId) || []);
          relationalResult = copyRelational(backupDb, tenantDb, companyId);
          const saved = persistSnapshot(tenantDb, snapshot, null);
          if (saved?.ok !== true) throw new Error('SQLite no confirmó el snapshot de ' + companyId + '.');

          const documents = backupDb.prepare(
            'SELECT storage_key,byte_size,sha256 FROM supporting_documents WHERE company_id=? ORDER BY id'
          ).all(companyId);
          if (documents.length) {
            const destinationDocuments = path.join(companyDirectory, 'supporting-documents');
            fs.mkdirSync(destinationDocuments, { recursive: false, mode: 0o700 });
            documentResult = copyDocuments({ documents, sourceRoot: documentRoot, destinationRoot: destinationDocuments });
          }

          assertSqliteIntegrity(tenantDb);
          const verifiedSnapshot = readSnapshot(tenantDb, companyId);
          if (!isDeepStrictEqual(verifiedSnapshot, snapshot)) throw new Error('El snapshot de ' + companyId + ' no superó la comparación íntegra posterior a la copia.');
          if (tenantDb.pragma('foreign_key_check').length) throw new Error('La base de ' + companyId + ' contiene relaciones SQLite inválidas.');
          const storedAuditCount = Number(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count);
          if (storedAuditCount < auditCount) throw new Error('La auditoría de ' + companyId + ' no conserva todos los eventos asignados.');
          const storedDocumentCount = Number(tenantDb.prepare('SELECT COUNT(*) AS count FROM supporting_documents WHERE company_id=?').get(companyId).count);
          if (storedDocumentCount !== documents.length) throw new Error('El catálogo documental de ' + companyId + ' no conserva todos sus registros.');
          companyResults.push({
            companyId, relationalCounts: relationalResult.counts, relationalRows: relationalResult.totalRows,
            auditEventsCopied: auditCount, auditEventsTotalAfterInitialization: storedAuditCount,
            documentsCopied: documentResult.copiedFiles, documentBytesCopied: documentResult.totalBytes
          });
        } finally {
          if (tenantDb.open) {
            try { tenantDb.pragma('wal_checkpoint(TRUNCATE)'); } finally { tenantDb.close(); }
          }
        }
        journal.markCompanyCompleted(companyId);
      }

      journal.advance('STAGING', 'VALIDATING');
      for (const result of companyResults) {
        const companyId = result.companyId;
        const databasePath = path.join(companiesRoot, companyId, 'accounting.sqlite');
        const verifyDb = new Database(databasePath, { readonly: true, fileMustExist: true });
        try {
          assertSqliteIntegrity(verifyDb);
          const snapshot = readSnapshot(verifyDb, companyId);
          const expected = snapshots.find(item => String(item.companies[0].id) === companyId);
          if (!isDeepStrictEqual(snapshot, expected)) throw new Error('La validación final detectó diferencias en el snapshot de ' + companyId + '.');
          if (verifyDb.pragma('foreign_key_check').length) throw new Error('La validación final detectó claves foráneas inválidas en ' + companyId + '.');
          const identity = verifyDb.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
          if (String(identity?.meta_value || '') !== companyId) throw new Error('La identidad interna no coincide en la base de ' + companyId + '.');
        } finally { verifyDb.close(); }
      }

      journal.advance('VALIDATING', 'REGISTERING');
      const registeredCompanies = manager.registerExistingCompanies(companies);
      if (registeredCompanies.length !== companies.length ||
          companies.some(company => !registeredCompanies.some(item => String(item.id) === String(company.id)))) {
        throw new Error('El registro local no confirmó todas las bases SQLite preparadas.');
      }
      journal.advance('REGISTERING', 'COMMITTED');
      return Object.freeze({
        ok: true, migrationId, phase: 'COMMITTED', backupPath, backupSha256: backupHash,
        companies: Object.freeze(companyResults),
        auditEvents: Object.freeze({
          total: auditPartition.counts.total, assigned: auditPartition.counts.assigned,
          retainedInControl: auditPartition.counts.retainedInControl, unresolved: auditPartition.counts.unresolved
        })
      });
    } catch (error) {
      const current = journalOwned ? journal.read() : null;
      if (current && ['PREPARED', 'STAGING', 'VALIDATING', 'REGISTERING', 'FAILED'].includes(current.phase)) {
        try {
          journal.advance(current.phase, 'ROLLBACK_REQUIRED', {
            lastError: String(error?.message || error).slice(0, 2000)
          });
        } catch {}
      }
      throw new Error(
        'La migración no se confirmó. La base heredada y el respaldo permanecen intactos; los archivos preparados no se eliminaron automáticamente. Revise el journal local antes de reintentar: ' +
        String(error?.message || error),
        { cause: error }
      );
    } finally {
      if (backupDb.open) backupDb.close();
    }
  }

  return Object.freeze({ execute });
}

module.exports = { createTenantMigrationOrchestrator, readLegacyAccountingSnapshot, sha256File };
