'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { exportCompanyData } = require('./company-data-export.cjs');

function registerCompanyExportIpc({
  ipcMain, runtime, operationContext, companySessionContext,
  licenseView, getActiveSession, dialog, app, getWindow, assertOperationalReady = () => {}
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !runtime || typeof runtime.listCompanies !== 'function' || typeof runtime.getCompanyDatabase !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      !companySessionContext || typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      typeof assertOperationalReady !== 'function' || !dialog || !app) {
    throw new TypeError('No se pudo registrar la exportación segura de datos por empresa.');
  }
  ipcMain.handle('sicoven:company-export-data', async (event, token, input) => {
    assertOperationalReady();
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
      // The dialog and maintenance drain are asynchronous. Revalidate the
      // credential, license and selected tenant after the wait, immediately
      // before opening the tenant database or writing an export artifact.
      const currentLicense = licenseView();
      if (!currentLicense.authorized) throw new Error(currentLicense.message || 'Licencia no autorizada.');
      const currentActor = getActiveSession(token);
      if (!hasFullSystemAccess(currentActor)) throw new Error('La sesión expiró o perdió permisos durante la preparación de la entrega.');
      const selectedCompanyId = companySessionContext.getSelectedCompanyId(token);
      if (selectedCompanyId !== companyId) throw new Error('La empresa activa cambió durante la preparación de la entrega.');
      const currentCompany = runtime.listCompanies().find(item =>
        String(item.id) === companyId && item.status === 'ACTIVE' &&
        String(item.rif || '').toUpperCase() === String(company.rif || '').toUpperCase()
      );
      if (!currentCompany) throw new Error('La empresa dejó de estar activa o cambió su identidad durante la preparación de la entrega.');

      const db = runtime.getCompanyDatabase(companyId);
      const exportId = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('company_data_export_started', JSON.stringify({
          exportId, companyId, actor: currentActor.username, format, destination, startedAt
        }));

      let result;
      try {
        result = await exportCompanyData({
          db, company: currentCompany, userDataDir: app.getPath('userData'), destination, format
        });
      } catch (error) {
        try {
          db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
            .run('company_data_export_failed', JSON.stringify({
              exportId, companyId, actor: currentActor.username, format,
              destination, failedAt: new Date().toISOString(),
              error: String(error?.message || error).slice(0, 1000)
            }));
        } catch (auditError) {
          throw new Error('La exportación falló y tampoco pudo asentarse su resultado en la auditoría: ' +
            String(auditError?.message || auditError), { cause: error });
        }
        throw error;
      }

      // Keep the STARTED event if this final append fails: it is durable evidence
      // that an artifact may have been produced and needs reconciliation.
      db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('company_data_exported', JSON.stringify({
          exportId, companyId, actor: currentActor.username, format,
          destination: result.destination, createdAt: new Date().toISOString()
        }));
      return { ...result, exportId };
    } finally {
      release();
    }
  });
}
module.exports = { registerCompanyExportIpc };
