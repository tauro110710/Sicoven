'use strict';

const { createTenantRuntime } = require('./tenant-runtime.cjs');
const { createTenantOperationContext } = require('./tenant-operation-context.cjs');
const { createCompanySessionContext } = require('./company-session-context.cjs');
const { hasFullSystemAccess } = require('./auth-roles.cjs');

function createTenantRuntimeController({
  controlDb, userDataDir, Database, assertSqliteIntegrity,
  getActiveSession, flushPendingWrites, canAccessCompany = hasFullSystemAccess
}) {
  if (!controlDb || !controlDb.open) throw new TypeError('La base SQLite de control debe estar abierta.');
  if (typeof getActiveSession !== 'function' || typeof flushPendingWrites !== 'function' ||
      typeof canAccessCompany !== 'function') {
    throw new TypeError('El controlador multiempresa requiere validadores de sesión, acceso y persistencia.');
  }

  const runtimeOptions = { userDataDir, Database, assertSqliteIntegrity };
  let activeControlDb = controlDb;
  let implementation = createTenantRuntime({ ...runtimeOptions, controlDb: activeControlDb });

  // Stable facade: the restore workflow can replace the control connection
  // after a global restore without leaving stale prepared statements behind.
  const runtime = Object.freeze({
    listCompanies: (...args) => implementation.listCompanies(...args),
    getCompanyDatabase: (...args) => implementation.getCompanyDatabase(...args),
    loadAccounting: (...args) => implementation.loadAccounting(...args),
    saveAccounting: (...args) => implementation.saveAccounting(...args),
    createCompany: (...args) => implementation.createCompany(...args),
    migrateLegacyDatabase: (...args) => implementation.migrateLegacyDatabase(...args),
    updateCompanyMetadata: (...args) => implementation.updateCompanyMetadata(...args),
    closeCompany: (...args) => implementation.closeCompany(...args),
    closeAll: (...args) => implementation.closeAll(...args),
    isCompanyOpen: (...args) => implementation.isCompanyOpen(...args),
    getCompanyDatabasePath: (...args) => implementation.getCompanyDatabasePath(...args),
    rebindControlDatabase(nextControlDb) {
      if (!nextControlDb || !nextControlDb.open) throw new TypeError('La nueva base de control debe estar abierta.');
      implementation.closeAll();
      implementation = createTenantRuntime({ ...runtimeOptions, controlDb: nextControlDb });
      activeControlDb = nextControlDb;
      return { ok: true, companyCount: implementation.listCompanies().length };
    },
    get controlDb() { return activeControlDb; }
  });

  const operationContext = createTenantOperationContext({ runtime, flushPendingWrites });
  const companySessionContext = createCompanySessionContext({
    runtime,
    operationContext,
    getActiveSession,
    canAccessCompany
  });

  function withDatabase(token, operation) {
    if (typeof operation !== 'function') throw new TypeError('La operación SQLite debe ser una función.');
    // The legacy database remains the operational source only until a tenant
    // registry exists. Once migration registers any company, missing tenant
    // selection is a hard error; it never silently falls back to global data.
    if (runtime.listCompanies().length > 0) {
      return companySessionContext.withSelectedDatabase(token, operation);
    }
    return operation(activeControlDb, null);
  }

  return Object.freeze({
    runtime,
    operationContext,
    companySessionContext,
    withDatabase,
    rebindControlDatabase: nextControlDb => runtime.rebindControlDatabase(nextControlDb)
  });
}

module.exports = { createTenantRuntimeController };
