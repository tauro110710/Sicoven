'use strict';

const { createCompanyDatabaseManager } = require('./company-database-manager.cjs');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const {
  loadTenantAccountingSnapshot,
  saveTenantAccountingSnapshot,
  readTenantSnapshot
} = require('./tenant-persistence.cjs');
const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');
const { createEmptyAccountingSnapshot } = require('./tenant-snapshot.cjs');
const { createTenantMigrationOrchestrator } = require('./tenant-migration-orchestrator.cjs');

function createTenantRuntime({
  controlDb,
  userDataDir,
  Database,
  assertSqliteIntegrity,
  schemaVersion
}) {
  if (!controlDb || typeof controlDb.prepare !== 'function' || !controlDb.open) {
    throw new TypeError('La base local de control debe estar abierta antes de crear el runtime multiempresa.');
  }
  const manager = createCompanyDatabaseManager({
    controlDb,
    userDataDir,
    Database,
    assertSqliteIntegrity,
    initializeCompanyDatabase: initializeTenantDatabase,
    schemaVersion
  });

  function listCompanies() {
    return manager.listCompanies();
  }

  function getCompanyDatabase(companyId) {
    const id = String(companyId || '').trim();
    if (!id) throw new Error('Seleccione una empresa antes de acceder a sus datos operativos.');
    return manager.openCompany(id);
  }

  function loadAccounting(preferredCompanyId = '') {
    return loadTenantAccountingSnapshot(manager, preferredCompanyId);
  }

  async function saveAccounting(state, actor = null) {
    return saveTenantAccountingSnapshot(manager, state, actor);
  }

  async function createCompany(company, actor = null) {
    if (!company || typeof company !== 'object') throw new TypeError('La ficha de empresa es obligatoria.');
    const existing = manager.listCompanies().find(item => String(item.id) === String(company.id));
    if (existing) throw new Error('La empresa ya está registrada. No se reemplazará ni reinicializará su base SQLite.');
    const empty = createEmptyAccountingSnapshot();
    empty.companies = [{ ...company, id: String(company.id), name: String(company.name), rif: String(company.rif) }];
    empty.currentCompanyId = String(company.id);
    try {
      // The manager keeps the tenant out of the control registry until this
      // callback commits the initial snapshot together with schema creation.
      manager.registerCompany(company, tenantDb => {
        const saved = persistAccountingSnapshot(tenantDb, empty, actor);
        if (saved?.ok !== true) {
          throw new Error('SQLite no confirmó el snapshot inicial de la empresa.');
        }
        tenantDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
          .run('company_created', JSON.stringify({
            companyId: String(company.id), rif: String(company.rif), name: String(company.name),
            actorUserId: actor?.id ?? null, actorUsername: actor?.username || 'system',
            createdAt: new Date().toISOString()
          }));
      });
      const db = manager.openCompany(company.id);
      const verified = readTenantSnapshot(db, company.id);
      if (verified.companies.length !== 1 || String(verified.companies[0].rif) !== String(company.rif)) {
        throw new Error('La verificación posterior no coincide con la identidad de la empresa recién creada.');
      }
      const identity = db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
      if (String(identity?.meta_value || '') !== String(company.id)) {
        throw new Error('La comprobación de identidad de la base recién creada no coincide.');
      }
      return { ok: true, company: manager.listCompanies().find(item => item.id === String(company.id)) };
    } catch (error) {
      // Preserve the newly created file for recovery; never delete a database after a partial failure.
      throw new Error('La empresa no quedó inicializada por completo. Su archivo SQLite se conserva para recuperación y no debe sobrescribirse: ' + String(error?.message || error));
    }
  }

  async function migrateLegacyDatabase({ sourceDb, acquireMaintenanceLock, getDocumentsRoot } = {}) {
    if (!sourceDb || !sourceDb.open) throw new TypeError('La base SQLite heredada debe permanecer abierta durante la migración.');
    if (typeof acquireMaintenanceLock !== 'function') throw new TypeError('La migración requiere un bloqueo de mantenimiento exclusivo.');
    if (manager.listCompanies().length > 0) {
      throw new Error('Ya existen empresas registradas en SQLite individual. No se repetirá ni mezclará la migración.');
    }
    const orchestrator = createTenantMigrationOrchestrator({
      sourceDb,
      userDataDir,
      manager,
      acquireMaintenanceLock,
      ...(typeof getDocumentsRoot === 'function' ? { getDocumentsRoot } : {})
    });
    return orchestrator.execute();
  }

  function updateCompanyMetadata(company) {
    return manager.updateCompanyMetadata(company);
  }

  function closeCompany(companyId) {
    return manager.closeCompany(companyId);
  }

  function closeAll() {
    return manager.closeAll();
  }

  function resetAllCompanies() {
    return manager.resetAllCompanies();
  }

  return Object.freeze({
    listCompanies,
    getCompanyDatabase,
    loadAccounting,
    saveAccounting,
    createCompany,
    migrateLegacyDatabase,
    updateCompanyMetadata,
    closeCompany,
    closeAll,
    resetAllCompanies,
    isCompanyOpen: companyId => manager.isOpen(companyId),
    getCompanyDatabasePath: companyId => manager.getDatabasePath(companyId),
    // Control DB is intentionally exposed only for auth, licensing and registry operations.
    controlDb
  });
}

module.exports = { createTenantRuntime };
