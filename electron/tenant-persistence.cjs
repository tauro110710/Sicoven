'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');

const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');
const {
  partitionAccountingSnapshot,
  mergeAccountingSnapshots
} = require('./tenant-snapshot.cjs');

function readTenantSnapshot(db, companyId) {
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('La base SQLite de ' + companyId + ' no contiene un estado contable inicializado.');
  let snapshot;
  try { snapshot = JSON.parse(row.state_json); }
  catch { throw new Error('El estado contable de ' + companyId + ' no contiene JSON válido.'); }
  if (!snapshot || !Array.isArray(snapshot.companies) || snapshot.companies.length !== 1 ||
      String(snapshot.companies[0]?.id || '') !== String(companyId) ||
      String(snapshot.currentCompanyId || '') !== String(companyId)) {
    throw new Error('La identidad del snapshot no coincide con la base SQLite de ' + companyId + '.');
  }
  return snapshot;
}

function loadTenantAccountingSnapshot(manager, preferredCompanyId = '') {
  if (!manager || typeof manager.listCompanies !== 'function' || typeof manager.openCompany !== 'function') {
    throw new TypeError('Se requiere el gestor local de bases SQLite por empresa.');
  }
  const records = manager.listCompanies().filter(record => record.status === 'ACTIVE');
  if (records.length === 0) return null;
  const snapshots = records.map(record => readTenantSnapshot(manager.openCompany(record.id), record.id));
  return mergeAccountingSnapshots(snapshots, preferredCompanyId);
}

async function saveTenantAccountingSnapshot(manager, state, actor = null) {
  if (!manager || typeof manager.listCompanies !== 'function' || typeof manager.openCompany !== 'function' ||
      typeof manager.registerCompany !== 'function' || typeof manager.archiveCompany !== 'function') {
    throw new TypeError('El gestor local no ofrece las operaciones necesarias para guardar empresas.');
  }

  const partitions = partitionAccountingSnapshot(state);
  const byId = new Map(partitions.map(snapshot => [String(snapshot.companies[0].id), snapshot]));
  const records = manager.listCompanies();
  const activeRecords = records.filter(record => record.status === 'ACTIVE');
  const recordById = new Map(records.map(record => [String(record.id), record]));

  for (const record of activeRecords) {
    if (!byId.has(String(record.id))) {
      throw new Error('La empresa ' + record.id + ' existe en el registro local pero falta en el snapshot. No se eliminará ni archivará automáticamente.');
    }
  }
  for (const snapshot of partitions) {
    const company = snapshot.companies[0];
    const record = recordById.get(String(company.id));
    if (record?.status === 'ARCHIVED') {
      throw new Error('La empresa ' + company.id + ' está archivada y no puede recibir cambios contables.');
    }
  }

  const changed = [];
  for (const snapshot of partitions) {
    const company = snapshot.companies[0];
    const record = recordById.get(String(company.id));
    if (!record) {
      changed.push({ snapshot, isNew: true });
      continue;
    }
    const db = manager.openCompany(company.id);
    const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    if (!row) throw new Error('La empresa ' + company.id + ' tiene una base registrada sin snapshot contable. Se requiere recuperación controlada.');
    let previous;
    try { previous = JSON.parse(row.state_json); }
    catch { throw new Error('El snapshot guardado de ' + company.id + ' no es JSON válido.'); }
    if (JSON.stringify(previous) !== JSON.stringify(snapshot)) changed.push({ snapshot, isNew: false });
  }

  if (changed.length === 0) {
    return { ok: true, savedCompanyIds: [], unchanged: true };
  }

  const newCompanies = changed.filter(item => item.isNew);
  if (newCompanies.length > 1) {
    throw new Error('La creación simultánea de varias empresas requiere el proceso de migración inicial en staging.');
  }

  const backups = new Map();
  const registeredHere = [];
  const transactionId = crypto.randomUUID();
  try {
    if (changed.length > 1) {
      for (const item of changed) {
        if (item.isNew) continue;
        const companyId = String(item.snapshot.companies[0].id);
        const db = manager.openCompany(companyId);
        const backupPath = manager.getDatabasePath(companyId) + '.tenant-backup-' + transactionId;
        try {
          await db.backup(backupPath);
          const stat = fs.statSync(backupPath);
          if (!stat.isFile() || stat.size <= 0) throw new Error('El respaldo transaccional de ' + companyId + ' está vacío.');
          backups.set(companyId, backupPath);
        } catch (error) {
          try { fs.rmSync(backupPath, { force: true }); } catch {}
          throw error;
        }
      }
    }

    for (const item of newCompanies) {
      const company = item.snapshot.companies[0];
      manager.registerCompany(company);
      registeredHere.push(String(company.id));
    }

    for (const item of changed) {
      const company = item.snapshot.companies[0];
      const db = manager.openCompany(company.id);
      const result = persistAccountingSnapshot(db, item.snapshot, actor);
      if (result?.ok !== true) throw new Error('SQLite no confirmó el guardado contable de ' + company.id + '.');
      const saved = readTenantSnapshot(db, company.id);
      if (JSON.stringify(saved) !== JSON.stringify(item.snapshot)) {
        throw new Error('La verificación posterior al guardado detectó diferencias en la base de ' + company.id + '.');
      }
    }

    for (const backupPath of backups.values()) {
      try { fs.rmSync(backupPath, { force: true }); } catch {}
    }
    return { ok: true, savedCompanyIds: changed.map(item => String(item.snapshot.companies[0].id)), unchanged: false };
  } catch (error) {
    const rollbackErrors = [];
    for (const [companyId, backupPath] of backups.entries()) {
      try {
        manager.closeCompany(companyId);
        const databasePath = manager.getDatabasePath(companyId);
        fs.rmSync(databasePath + '-wal', { force: true });
        fs.rmSync(databasePath + '-shm', { force: true });
        fs.copyFileSync(backupPath, databasePath);
        const restored = manager.openCompany(companyId);
        readTenantSnapshot(restored, companyId);
        fs.rmSync(backupPath, { force: true });
      } catch (rollbackError) {
        rollbackErrors.push(companyId + ': ' + String(rollbackError?.message || rollbackError));
      }
    }
    for (const companyId of registeredHere) {
      try { manager.archiveCompany(companyId); }
      catch (rollbackError) { rollbackErrors.push(companyId + ' (archivar alta): ' + String(rollbackError?.message || rollbackError)); }
    }
    if (rollbackErrors.length) {
      throw new Error('Falló el guardado multiempresa y la restauración automática no terminó. Se conservaron respaldos transaccionales para recuperación: ' + rollbackErrors.join('; '), { cause: error });
    }
    for (const backupPath of backups.values()) {
      try { fs.rmSync(backupPath, { force: true }); } catch {}
    }
    throw error;
  }
}

module.exports = {
  readTenantSnapshot,
  loadTenantAccountingSnapshot,
  saveTenantAccountingSnapshot
};
