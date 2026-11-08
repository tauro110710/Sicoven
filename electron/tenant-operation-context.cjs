'use strict';

const { readTenantSnapshot } = require('./tenant-persistence.cjs');

function createTenantOperationContext({ runtime, flushPendingWrites }) {
  if (!runtime || typeof runtime.listCompanies !== 'function' ||
      typeof runtime.getCompanyDatabase !== 'function' ||
      typeof runtime.closeCompany !== 'function' ||
      typeof runtime.isCompanyOpen !== 'function') {
    throw new TypeError('El runtime SQLite por empresa no ofrece el contrato de ciclo de vida requerido.');
  }
  if (typeof flushPendingWrites !== 'function') {
    throw new TypeError('Se requiere la función que espera la cola de persistencia del renderer.');
  }

  let activeCompanyId = '';
  let switching = false;
  let activeOperations = 0;
  let idleWaiters = [];

  function requireActiveCompany() {
    if (switching) throw new Error('El cambio de empresa está en curso. La operación fue bloqueada.');
    if (!activeCompanyId) throw new Error('No hay una empresa activa en el contexto operativo.');
    return activeCompanyId;
  }

  function waitForActiveOperations() {
    if (activeOperations === 0) return Promise.resolve();
    return new Promise(resolve => idleWaiters.push(resolve));
  }

  function releaseOperation() {
    activeOperations -= 1;
    if (activeOperations === 0 && idleWaiters.length) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const resolve of waiters) resolve();
    }
  }

  async function withActiveDatabase(operation) {
    if (typeof operation !== 'function') throw new TypeError('La operación SQLite debe ser una función.');
    const companyId = requireActiveCompany();
    const db = runtime.getCompanyDatabase(companyId);
    activeOperations += 1;
    try {
      return await operation(db, companyId);
    } finally {
      releaseOperation();
    }
  }

  async function switchCompany(companyIdInput) {
    const targetId = String(companyIdInput || '').trim();
    if (!targetId) throw new Error('Debe indicar una empresa registrada para cambiar el contexto.');
    if (switching) throw new Error('Ya hay un cambio de empresa en curso.');
    if (targetId === activeCompanyId) {
      return { ok: true, changed: false, companyId: activeCompanyId };
    }

    switching = true;
    let targetOpenedHere = false;
    try {
      // Drain the renderer's serialized persistence queue before blocking the old tenant.
      await flushPendingWrites();
      await waitForActiveOperations();

      const target = runtime.listCompanies().find(record =>
        String(record.id) === targetId && String(record.status) === 'ACTIVE'
      );
      if (!target) throw new Error('La empresa solicitada no está registrada o se encuentra archivada.');

      const wasOpen = runtime.isCompanyOpen(targetId);
      const targetDb = runtime.getCompanyDatabase(targetId);
      targetOpenedHere = !wasOpen;

      // Do not publish the new tenant until both its SQLite file and snapshot identity pass.
      readTenantSnapshot(targetDb, targetId);

      const previousId = activeCompanyId;
      activeCompanyId = targetId;
      if (previousId) runtime.closeCompany(previousId);

      return { ok: true, changed: true, companyId: targetId, previousCompanyId: previousId || null };
    } catch (error) {
      if (targetOpenedHere && targetId !== activeCompanyId) {
        try { runtime.closeCompany(targetId); } catch {}
      }
      throw error;
    } finally {
      switching = false;
    }
  }

  async function clearActiveCompany() {
    if (switching) throw new Error('Ya hay un cambio de empresa en curso.');
    switching = true;
    try {
      await flushPendingWrites();
      await waitForActiveOperations();
      const previousId = activeCompanyId;
      activeCompanyId = '';
      if (previousId) runtime.closeCompany(previousId);
      return { ok: true, previousCompanyId: previousId || null };
    } finally {
      switching = false;
    }
  }

  return Object.freeze({
    switchCompany,
    clearActiveCompany,
    withActiveDatabase,
    getActiveCompanyId: () => activeCompanyId || null,
    isSwitching: () => switching,
    getActiveOperationCount: () => activeOperations
  });
}

module.exports = { createTenantOperationContext };
