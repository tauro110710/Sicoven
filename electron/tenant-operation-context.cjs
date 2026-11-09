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
  let flushing = false;
  let maintenanceLockHeld = false;
  let activeOperations = 0;
  let idleWaiters = [];
  // Serialize asynchronous database work as well as tracking it for safe tenant switches.
  // A rejected operation must not poison the queue for subsequent operations.
  let operationTail = Promise.resolve();

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

  async function runWithActiveDatabase(operation, allowDuringFlush) {
    if (typeof operation !== 'function') throw new TypeError('La operación SQLite debe ser una función.');
    if (switching && !(allowDuringFlush && flushing)) {
      throw new Error('El cambio de empresa está en curso. La operación fue bloqueada.');
    }
    const companyId = activeCompanyId;
    if (!companyId) throw new Error('No hay una empresa activa en el contexto operativo.');

    // Admission happens synchronously before the switch gate can close. Queued work
    // therefore remains attached to the company that was active when it was submitted.
    activeOperations += 1;
    const execution = operationTail.then(() => {
      const db = runtime.getCompanyDatabase(companyId);
      return operation(db, companyId);
    });
    operationTail = execution.then(() => undefined, () => undefined);
    return execution.finally(releaseOperation);
  }

  function withActiveDatabase(operation) {
    return runWithActiveDatabase(operation, false);
  }

  // Only the already-queued persistence drain may use this lane while a switch is flushing.
  function withPersistenceDatabase(operation) {
    return runWithActiveDatabase(operation, true);
  }

  async function acquireMaintenanceLock() {
    if (switching || maintenanceLockHeld) throw new Error('Ya existe un cambio de empresa o un bloqueo de mantenimiento en curso.');
    switching = true;
    flushing = false;
    try {
      await waitForActiveOperations();
      flushing = true;
      await flushPendingWrites();
      flushing = false;
      await waitForActiveOperations();
      maintenanceLockHeld = true;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        maintenanceLockHeld = false;
        flushing = false;
        switching = false;
      };
    } catch (error) {
      flushing = false;
      switching = false;
      throw error;
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
    flushing = false;
    let targetOpenedHere = false;
    try {
      // First drain operations admitted before the switch gate closed. When
      // no tenant is active yet (initial post-migration selection), there are
      // no tenant writes to flush; the migration itself already drained the
      // legacy renderer queue before registering the new databases.
      const previousId = activeCompanyId;
      await waitForActiveOperations();
      if (previousId) {
        flushing = true;
        await flushPendingWrites();
        flushing = false;
        await waitForActiveOperations();
      }

      const target = runtime.listCompanies().find(record =>
        String(record.id) === targetId && String(record.status) === 'ACTIVE'
      );
      if (!target) throw new Error('La empresa solicitada no está registrada o se encuentra archivada.');

      const wasOpen = runtime.isCompanyOpen(targetId);
      const targetDb = runtime.getCompanyDatabase(targetId);
      targetOpenedHere = !wasOpen;

      // Do not publish the new tenant until both its SQLite file and snapshot identity pass.
      readTenantSnapshot(targetDb, targetId);

      if (previousId) runtime.closeCompany(previousId);
      activeCompanyId = targetId;

      return { ok: true, changed: true, companyId: targetId, previousCompanyId: previousId || null };
    } catch (error) {
      if (targetOpenedHere && targetId !== activeCompanyId) {
        try { runtime.closeCompany(targetId); } catch {}
      }
      throw error;
    } finally {
      flushing = false;
      switching = false;
    }
  }

  async function clearActiveCompany() {
    if (switching) throw new Error('Ya hay un cambio de empresa en curso.');
    switching = true;
    flushing = false;
    try {
      await waitForActiveOperations();
      flushing = true;
      await flushPendingWrites();
      flushing = false;
      await waitForActiveOperations();
      const previousId = activeCompanyId;
      if (previousId) runtime.closeCompany(previousId);
      activeCompanyId = '';
      return { ok: true, previousCompanyId: previousId || null };
    } finally {
      flushing = false;
      switching = false;
    }
  }

  return Object.freeze({
    switchCompany,
    clearActiveCompany,
    acquireMaintenanceLock,
    withActiveDatabase,
    withPersistenceDatabase,
    getActiveCompanyId: () => activeCompanyId || null,
    isSwitching: () => switching,
    getActiveOperationCount: () => activeOperations
  });
}

module.exports = { createTenantOperationContext };
