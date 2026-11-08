'use strict';

const path = require('node:path');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { exportCompanyData } = require('./company-data-export.cjs');

function registerCompanyExportIpc({
  ipcMain, runtime, operationContext, companySessionContext,
  licenseView, getActiveSession, dialog, app, getWindow
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !runtime || typeof runtime.listCompanies !== 'function' || typeof runtime.getCompanyDatabase !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      !companySessionContext || typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      !dialog || !app) {
    throw new TypeError('No se pudo registrar la exportación segura de datos por empresa.');
  }
  ipcMain.handle('sicoven:company-export-data', async (event, token, input) => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('Se requiere una sesión contable autenticada para entregar datos de una empresa.');
    const companyId = companySessionContext.getSelectedCompanyId(token);
    const company = runtime.listCompanies().find(item => String(item.id) === companyId && item.status === 'ACTIVE');
    if (!company) throw new Error('No existe una empresa activa seleccionada para exportar.');
    const format = String(input?.format || '').toLowerCase();
    if (!['sqlite', 'json'].includes(format)) throw new Error('Seleccione SQLite o JSON como formato de entrega.');
    const parent = getWindow?.(event.sender);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeRif = String(company.rif || company.id).replace(/[^A-Za-z0-9_-]/g, '_');
    let destination;
    if (format === 'sqlite') {
      const selection = parent
        ? await dialog.showOpenDialog(parent, { title: 'Elegir carpeta para entregar la base de la empresa', properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ title: 'Elegir carpeta para entregar la base de la empresa', properties: ['openDirectory', 'createDirectory'] });
      if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
      destination = path.join(selection.filePaths[0], 'SICOVEN-' + safeRif + '-' + stamp);
    } else {
      const selection = parent
        ? await dialog.showSaveDialog(parent, { title: 'Guardar entrega JSON de la empresa', defaultPath: path.join(app.getPath('documents'), 'SICOVEN-' + safeRif + '-' + stamp + '.json'), filters: [{ name: 'Datos SICOVEN JSON', extensions: ['json'] }] })
        : await dialog.showSaveDialog({ title: 'Guardar entrega JSON de la empresa', defaultPath: path.join(app.getPath('documents'), 'SICOVEN-' + safeRif + '-' + stamp + '.json'), filters: [{ name: 'Datos SICOVEN JSON', extensions: ['json'] }] });
      if (selection.canceled || !selection.filePath) return { ok: false, canceled: true };
      destination = selection.filePath;
    }
    const release = await operationContext.acquireMaintenanceLock();
    try {
      const db = runtime.getCompanyDatabase(companyId);
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('company_data_exported', JSON.stringify({ companyId, actor: actor.username, format, createdAt: new Date().toISOString() }));
      return await exportCompanyData({ db, company, userDataDir: app.getPath('userData'), destination, format });
    } finally {
      release();
    }
  });
}
module.exports = { registerCompanyExportIpc };
