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

module.exports = { registerTenantMigrationPreflightIpc };
