'use strict';

const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { inspectLegacyDatabase } = require('./tenant-migration-preflight.cjs');

function registerTenantMigrationPreflightIpc({ ipcMain, db, licenseView, getActiveSession }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !db || typeof db.prepare !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function') {
    throw new TypeError('No se pudo registrar la inspección previa de migración SQLite por empresa.');
  }

  ipcMain.handle('sicoven:tenant-migration-preflight', (_event, token) => {
    const licensing = licenseView();
    if (!licensing.authorized) {
      throw new Error(licensing.message || 'Licencia no autorizada.');
    }
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) {
      throw new Error('Se requiere una sesión contable autenticada para inspeccionar la migración.');
    }

    // Read-only inspection. It never creates the tenant registry, changes schemas,
    // stages files, migrates rows, or registers an operational database.
    const result = inspectLegacyDatabase(db);
    return Object.freeze({
      ...result,
      readOnly: true,
      migrationStarted: false,
      sourceDatabase: 'sicoven.sqlite'
    });
  });
}


function registerTenantMigrationExecuteIpc({ ipcMain, db, runtime, operationContext, licenseView, getActiveSession, assertOperationalReady = () => {} }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !db || typeof db.prepare !== 'function' ||
      !runtime || typeof runtime.migrateLegacyDatabase !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' || typeof assertOperationalReady !== 'function') {
    throw new TypeError('No se pudo registrar la ejecución protegida de migración SQLite por empresa.');
  }

  ipcMain.handle('sicoven:tenant-migration-execute', async (_event, token) => {
    assertOperationalReady();
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) {
      throw new Error('Se requiere una sesión contable autenticada para ejecutar la migración.');
    }
    const preflight = inspectLegacyDatabase(db);
    if (!preflight.ok) {
      throw new Error('La inspección previa bloqueó la migración: ' + preflight.errors.join(' '));
    }
    const result = await runtime.migrateLegacyDatabase({
      sourceDb: db,
      acquireMaintenanceLock: () => operationContext.acquireMaintenanceLock()
    });
    return Object.freeze({
      ...result,
      actor: actor.username,
      sourceDatabase: 'sicoven.sqlite',
      sourcePreserved: true,
      globalBackupRestoreRetained: true
    });
  });
}

module.exports = { registerTenantMigrationPreflightIpc, registerTenantMigrationExecuteIpc };
