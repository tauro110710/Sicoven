'use strict';

const { createCompanyDatabaseManager } = require('./company-database-manager.cjs');
const { initializeTenantDatabase, migrateTenantDatabase } = require('./tenant-schema.cjs');
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
  schemaVersion = 3
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
    migrateCompanyDatabase: migrateTenantDatabase,
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

  async function createCompany(company, actor = null, operation = null) {
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
        const saved = persistAccountingSnapshot(tenantDb, empty, actor, operation?.operationId || null);
        if (saved?.ok !== true) {
          throw new Error('SQLite no confirmó el snapshot inicial de la empresa.');
        }
        tenantDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
          .run('company_created', JSON.stringify({
            companyId: String(company.id), rif: String(company.rif), name: String(company.name),
            actorUserId: actor?.id ?? null, actorUsername: actor?.username || 'system',
            operationId: operation?.operationId || null, requestHash: operation?.requestHash || null,
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

  function verifyCompanyCreation(company, operation) {
    if (!company || typeof company !== 'object' || !operation || typeof operation !== 'object') {
      throw new TypeError('La verificación de creación requiere la empresa y su identidad durable.');
    }
    const companyId = String(company.id || '').trim();
    const operationId = String(operation.operationId || '').trim();
    const requestHash = String(operation.requestHash || '').trim();
    const actor = operation.actor;
    if (!companyId || operationId !== companyId || !/^[a-f0-9]{64}$/i.test(requestHash) ||
        !actor || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 ||
        !String(actor.username || '').trim()) {
      throw new Error('La identidad durable de creación está incompleta o no es válida.');
    }
    const db = manager.openCompany(companyId);
    const snapshot = readTenantSnapshot(db, companyId);
    const savedCompany = snapshot.companies[0];
    if (String(savedCompany.name || '').trim() !== String(company.name || '').trim() ||
        String(savedCompany.rif || '').trim().toUpperCase() !== String(company.rif || '').trim().toUpperCase()) {
      throw new Error('El snapshot inicial no coincide con la identidad durable de creación.');
    }
    const receipt = db.prepare(
      'SELECT operation_id,company_id,operation_type,actor_user_id FROM operation_receipts WHERE operation_id=?'
    ).get(operationId);
    if (!receipt || String(receipt.company_id) !== companyId ||
        String(receipt.operation_type) !== 'accounting.snapshot' ||
        Number(receipt.actor_user_id) !== Number(actor.id)) {
      throw new Error('El recibo durable del snapshot inicial no coincide con la creación.');
    }
    const events = db.prepare(
      "SELECT details_json FROM audit_events WHERE event_type='company_created' ORDER BY id"
    ).all();
    const matches = events.some(event => {
      let details;
      try { details = JSON.parse(event.details_json); } catch { return false; }
      return String(details.companyId || '') === companyId &&
        String(details.operationId || '') === operationId &&
        String(details.requestHash || '') === requestHash &&
        Number(details.actorUserId) === Number(actor.id) &&
        String(details.actorUsername || '') === String(actor.username);
    });
    if (!matches) {
      throw new Error('La evidencia append-only de creación no coincide con el actor o la huella de solicitud.');
    }
    return { ok: true, company: manager.listCompanies().find(item => String(item.id) === companyId) || null };
  }

  function recoverOrphanedCompany(company, operation) {
    if (!operation || typeof operation !== 'object') {
      throw new TypeError('La recuperación requiere la identidad durable de creación.');
    }
    const result = manager.recoverOrphanedCompany(company, db => {
      verifyCompanyCreationDatabase(db, company, operation);
      return true;
    });
    return result;
  }

  function verifyCompanyCreationDatabase(db, company, operation) {
    const companyId = String(company?.id || '').trim();
    const operationId = String(operation?.operationId || '').trim();
    const requestHash = String(operation?.requestHash || '').trim();
    const actor = operation?.actor;
    if (!companyId || operationId !== companyId || !/^[a-f0-9]{64}$/i.test(requestHash) ||
        !actor || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 ||
        !String(actor.username || '').trim()) {
      throw new Error('La identidad durable de creación está incompleta o no es válida.');
    }
    const snapshot = readTenantSnapshot(db, companyId);
    const savedCompany = snapshot.companies[0];
    if (String(savedCompany.name || '').trim() !== String(company.name || '').trim() ||
        String(savedCompany.rif || '').trim().toUpperCase() !== String(company.rif || '').trim().toUpperCase()) {
      throw new Error('El snapshot huérfano no coincide con la solicitud durable de creación.');
    }
    const receipt = db.prepare(
      'SELECT operation_id,company_id,operation_type,actor_user_id FROM operation_receipts WHERE operation_id=?'
    ).get(operationId);
    if (!receipt || String(receipt.company_id) !== companyId ||
        String(receipt.operation_type) !== 'accounting.snapshot' ||
        Number(receipt.actor_user_id) !== Number(actor.id)) {
      throw new Error('El recibo durable del snapshot inicial no coincide con la creación.');
    }
    const events = db.prepare(
      "SELECT details_json FROM audit_events WHERE event_type='company_created' ORDER BY id"
    ).all();
    const matches = events.some(event => {
      let details;
      try { details = JSON.parse(event.details_json); } catch { return false; }
      return String(details.companyId || '') === companyId &&
        String(details.operationId || '') === operationId &&
        String(details.requestHash || '') === requestHash &&
        Number(details.actorUserId) === Number(actor.id) &&
        String(details.actorUsername || '') === String(actor.username);
    });
    if (!matches) {
      throw new Error('La evidencia append-only de creación no coincide con el actor o la huella de solicitud.');
    }
    return true;
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
    recoverOrphanedCompany,
    verifyCompanyCreation,
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
