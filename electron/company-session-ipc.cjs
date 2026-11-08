'use strict';

function registerCompanySessionIpc({ ipcMain, companySessionContext, licenseView, getActiveSession }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      !companySessionContext ||
      typeof companySessionContext.listAccessibleCompanies !== 'function' ||
      typeof companySessionContext.selectCompany !== 'function' ||
      typeof companySessionContext.getSelectedCompanyId !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function') {
    throw new TypeError('No se pudo registrar el IPC seguro de selección de empresa.');
  }

  function requireAuthorizedSession(token) {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    if (!getActiveSession(token)) throw new Error('La sesión expiró o no está autorizada.');
  }

  ipcMain.handle('sicoven:company-list-accessible', async (_event, token) => {
    requireAuthorizedSession(token);
    return companySessionContext.listAccessibleCompanies(token);
  });

  ipcMain.handle('sicoven:company-select-active', async (_event, token, input) => {
    requireAuthorizedSession(token);
    const companyId = String(input?.companyId || '').trim();
    if (!companyId || companyId.length > 120) throw new Error('La empresa solicitada no es válida.');
    return companySessionContext.selectCompany(token, companyId);
  });

  ipcMain.handle('sicoven:company-get-active', (_event, token) => {
    requireAuthorizedSession(token);
    return { companyId: companySessionContext.getSelectedCompanyId(token) };
  });
}

module.exports = { registerCompanySessionIpc };
