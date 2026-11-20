'use strict';

const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { hashOperationRequest } = require('./operation-receipts.cjs');

function registerCompanySessionIpc({
  ipcMain, companySessionContext, runtime, operationContext, controlDb,
  licenseView, getActiveSession, assertOperationalReady = () => {}
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !companySessionContext ||
      typeof companySessionContext.listAccessibleCompanies !== 'function' ||
      typeof companySessionContext.selectCompany !== 'function' ||
      typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      !runtime || typeof runtime.createCompany !== 'function' ||
      !operationContext || typeof operationContext.acquireMaintenanceLock !== 'function' ||
      !controlDb || typeof controlDb.prepare !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' || typeof assertOperationalReady !== 'function') {
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
    assertOperationalReady();
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

  ipcMain.handle('sicoven:company-update-metadata', async (_event, token, input) => {
    assertOperationalReady();
    const actor = requireAuthorizedSession(token);
    const companyId = String(input?.companyId || '').trim();
    if (!companyId || companyId !== companySessionContext.getSelectedCompanyId(token)) {
      throw new Error('Solo se puede actualizar la ficha de la empresa activa.');
    }
    const current = runtime.listCompanies().find(item =>
      String(item.id) === companyId && String(item.status) === 'ACTIVE'
    );
    if (!current) throw new Error('La empresa activa no está disponible en el registro local.');
    const name = String(input?.name || '').trim().toUpperCase();
    const rif = String(input?.rif || '').trim().toUpperCase();
    if (!name || !rif) throw new Error('La razón social y el RIF son obligatorios.');
    const release = await operationContext.acquireMaintenanceLock();
    try {
      assertOperationalReady();
      const currentSession = requireAuthorizedSession(token);
      if (companySessionContext.getSelectedCompanyId(token) !== companyId) {
        throw new Error('La empresa activa cambió durante la actualización de su ficha.');
      }
      const previous = { companyId, name: current.name, rif: current.rif };
      const updated = runtime.updateCompanyMetadata({ companyId, name, rif });
      try {
        const tenantDb = runtime.getCompanyDatabase(companyId);
        tenantDb.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
          .run('company_metadata_updated', JSON.stringify({
            companyId, actorUserId: currentSession.id, actorUsername: currentSession.username,
            previous: { name: previous.name, rif: previous.rif },
            next: { name, rif }, updatedAt: new Date().toISOString()
          }));
      } catch (auditError) {
        try { runtime.updateCompanyMetadata(previous); } catch (rollbackError) {
          throw new Error('La ficha cambió, pero falló la auditoría y tampoco pudo revertirse el registro: ' +
            String(rollbackError?.message || rollbackError), { cause: auditError });
        }
        throw auditError;
      }
      return { ok: true, company: updated };
    } finally {
      release();
    }
  });

  ipcMain.handle('sicoven:company-create', async (_event, token, input) => {
    assertOperationalReady();
    const actor = requireAuthorizedSession(token);
    const company = input && typeof input === 'object' && !Array.isArray(input) ? { ...input } : null;
    if (!company) throw new Error('Los datos de la empresa no son válidos.');
    const operationId = String(company.operationId || crypto.randomUUID()).trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(operationId) || operationId === '.' || operationId === '..') throw new Error('Falta un identificador estable válido para la creación de empresa.');
    const requestPayload = { ...company };
    delete requestPayload.operationId;
    delete company.operationId;
    const requestHash = hashOperationRequest(JSON.stringify(requestPayload));
    company.id = operationId;
    if (!String(company.name || '').trim() || !String(company.rif || '').trim()) {
      throw new Error('La razón social y el RIF son obligatorios para crear la empresa.');
    }
    const release = await operationContext.acquireMaintenanceLock();
    let created;
    try {
      assertOperationalReady();
      requireAuthorizedSession(token);
      const registeredCompanies = typeof runtime.listCompanies === 'function' ? runtime.listCompanies() : [];
      const existing = registeredCompanies.find(item => String(item.id) === operationId && String(item.status) === 'ACTIVE');
      if (existing) {
        const tenantDb = runtime.getCompanyDatabase(operationId);
        const receiptRow = tenantDb.prepare("SELECT details_json FROM audit_events WHERE event_type='company_created' ORDER BY id DESC LIMIT 1").get();
        let details = null;
        try { details = receiptRow ? JSON.parse(receiptRow.details_json) : null; } catch {}
        if (!details || String(details.operationId || '') !== operationId ||
            String(details.requestHash || '') !== requestHash ||
            Number(details.actorUserId) !== Number(actor.id)) {
          throw new Error('La clave de creación ya está asociada a otra empresa, solicitud o usuario; no se repetirá la creación.');
        }
        created = { ok: true, company: existing, replayed: true };
      } else {
        // The runtime commits the initial snapshot, its idempotency receipt and
        // the company-created audit evidence before registry visibility.
        created = await runtime.createCompany(company, actor, { operationId, requestHash });
      }
    } finally {
      release();
    }
    const selection = await companySessionContext.selectCompany(token, company.id, { skipFlush: true });
    saveActiveCompanyPreference(company.id);
    return { ...created, selection };
  });
}

module.exports = { registerCompanySessionIpc };
