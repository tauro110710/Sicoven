'use strict';

const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');

function registerCompanySessionIpc({
  ipcMain, companySessionContext, runtime, operationContext, controlDb,
  licenseView, getActiveSession
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !companySessionContext ||
      typeof companySessionContext.listAccessibleCompanies !== 'function' ||
      typeof companySessionContext.selectCompany !== 'function' ||
      typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      !runtime || typeof runtime.createCompany !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      !controlDb || typeof controlDb.prepare !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function') {
    throw new TypeError('No se pudo registrar el IPC seguro de selección y creación de empresa.');
  }

  function requireAuthorizedSession(token) {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('La sesión no está autorizada para administrar empresas.');
    return actor;
  }

  function saveActiveCompanyPreference(companyId) {
    controlDb.prepare(`INSERT INTO app_state(state_key,state_json,updated_at)
      VALUES('active_company_preference',?,datetime('now'))
      ON CONFLICT(state_key) DO UPDATE SET state_json=excluded.state_json,updated_at=datetime('now')`)
      .run(JSON.stringify({ companyId: String(companyId), updatedAt: new Date().toISOString() }));
  }

  ipcMain.handle('sicoven:company-list-accessible', async (_event, token) => {
    requireAuthorizedSession(token);
    return companySessionContext.listAccessibleCompanies(token);
  });

  ipcMain.handle('sicoven:company-registry-status', (_event, token) => {
    requireAuthorizedSession(token);
    const companies = runtime.listCompanies();
    return {
      registeredCount: companies.length,
      activeCount: companies.filter(item => String(item.status) === 'ACTIVE').length,
      companies: companies.map(item => ({
        id: String(item.id), name: String(item.name || ''), rif: String(item.rif || ''),
        status: String(item.status || '')
      }))
    };
  });

  ipcMain.handle('sicoven:company-select-active', async (_event, token, input) => {
    requireAuthorizedSession(token);
    const companyId = String(input?.companyId || '').trim();
    if (!companyId || companyId.length > 120) throw new Error('La empresa solicitada no es válida.');
    const result = await companySessionContext.selectCompany(token, companyId,
      operationContext.getActiveCompanyId?.() ? {} : { skipFlush: true });
    saveActiveCompanyPreference(companyId);
    return result;
  });

  ipcMain.handle('sicoven:company-get-active', (_event, token) => {
    requireAuthorizedSession(token);
    return { companyId: companySessionContext.getSelectedCompanyId(token) };
  });

  ipcMain.handle('sicoven:company-create', async (_event, token, input) => {
    const actor = requireAuthorizedSession(token);
    const company = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : null;
    if (!company) throw new Error('Los datos de la empresa no son válidos.');
    company.id = crypto.randomUUID();
    if (!String(company.name || '').trim() || !String(company.rif || '').trim()) {
      throw new Error('La razón social y el RIF son obligatorios para crear la empresa.');
    }
    const release = await operationContext.acquireMaintenanceLock();
    let created;
    try {
      created = await runtime.createCompany(company, actor);
      const tenantDb = runtime.getCompanyDatabase(company.id);
      tenantDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
        .run('company_created', JSON.stringify({
          companyId: company.id, rif: company.rif, name: company.name,
          actorUserId: actor.id, actorUsername: actor.username, createdAt: new Date().toISOString()
        }));
    } finally {
      release();
    }
    const selection = await companySessionContext.selectCompany(token, company.id, { skipFlush: true });
    saveActiveCompanyPreference(company.id);
    return { ...created, selection };
  });
}

module.exports = { registerCompanySessionIpc };
