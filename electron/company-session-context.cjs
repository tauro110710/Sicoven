'use strict';

/**
 * Binds the active SQLite tenant to an authenticated main-process session.
 * Renderer-supplied company identifiers are accepted only during selection;
 * every later database operation resolves the tenant from this private map.
 */
function createCompanySessionContext({ runtime, operationContext, getActiveSession, canAccessCompany }) {
  if (!runtime || typeof runtime.listCompanies !== 'function') {
    throw new TypeError('Se requiere el runtime local de empresas.');
  }
  if (!operationContext || typeof operationContext.switchCompany !== 'function' ||
      typeof operationContext.clearActiveCompany !== 'function' ||
      typeof operationContext.withActiveDatabase !== 'function') {
    throw new TypeError('Se requiere el contexto operativo SQLite por empresa.');
  }
  if (typeof getActiveSession !== 'function' || typeof canAccessCompany !== 'function') {
    throw new TypeError('Se requieren validadores de sesión y permisos de empresa.');
  }

  const selectedByToken = new Map();

  function requireSession(tokenInput) {
    const token = String(tokenInput || '');
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Sesión no válida.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('La sesión expiró o no está autorizada.');
    return { token, actor };
  }

  async function selectCompany(tokenInput, companyIdInput) {
    const { token, actor } = requireSession(tokenInput);
    const companyId = String(companyIdInput || '').trim();
    if (!companyId) throw new Error('Debe seleccionar una empresa.');
    const company = runtime.listCompanies().find(item =>
      String(item.id) === companyId && String(item.status) === 'ACTIVE'
    );
    if (!company) throw new Error('La empresa no está registrada o se encuentra archivada.');
    if (await canAccessCompany(actor, company) !== true) {
      throw new Error('El usuario no tiene acceso autorizado a esta empresa.');
    }

    // The operation context closes admission, drains queued writes and flushes
    // the previous tenant before publishing the new active database.
    const switched = await operationContext.switchCompany(companyId);
    selectedByToken.clear();
    selectedByToken.set(token, companyId);
    return { ok: true, changed: Boolean(switched.changed), companyId };
  }

  function getSelectedCompanyId(tokenInput) {
    const { token } = requireSession(tokenInput);
    const selected = selectedByToken.get(token);
    if (!selected || selected !== operationContext.getActiveCompanyId()) {
      throw new Error('La sesión no tiene una empresa operativa seleccionada.');
    }
    return selected;
  }

  function withSelectedDatabase(tokenInput, operation) {
    getSelectedCompanyId(tokenInput);
    return operationContext.withActiveDatabase((database, companyId) => {
      const selected = selectedByToken.get(String(tokenInput));
      if (!selected || selected !== companyId) {
        throw new Error('El contexto de empresa cambió; se bloqueó la operación.');
      }
      return operation(database, companyId);
    });
  }

  async function clearSession(tokenInput) {
    const token = String(tokenInput || '');
    if (!selectedByToken.has(token)) return { ok: true, changed: false };
    if (selectedByToken.get(token) !== operationContext.getActiveCompanyId()) {
      selectedByToken.delete(token);
      return { ok: true, changed: false };
    }
    const result = await operationContext.clearActiveCompany();
    selectedByToken.delete(token);
    return { ok: true, changed: true, previousCompanyId: result.previousCompanyId || null };
  }

  function clearAllSessions() {
    selectedByToken.clear();
  }

  return Object.freeze({ selectCompany, getSelectedCompanyId, withSelectedDatabase, clearSession, clearAllSessions });
}

module.exports = { createCompanySessionContext };
