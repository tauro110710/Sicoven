'use strict';

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

  if (changed.length > 1) {
    throw new Error('El cambio afecta a varias empresas o a parámetros globales compartidos. Se bloqueó el guardado parcial; requiere un coordinador transaccional recuperable antes de continuar.');
  }
  if (changed.length === 0) return { ok: true, savedCompanyIds: [], unchanged: true };

  const { snapshot, isNew } = changed[0];
  const company = snapshot.companies[0];
  let registeredHere = false;
  let metadataUpdated = false;
  const previousRecord = recordById.get(String(company.id));
  try {
    if (isNew) {
      manager.registerCompany(company);
      registeredHere = true;
    } else if (previousRecord &&
        (String(previousRecord.name) !== String(company.name) || String(previousRecord.rif).toUpperCase() !== String(company.rif).toUpperCase())) {
      manager.updateCompanyMetadata(company);
      metadataUpdated = true;
    }
    const db = manager.openCompany(company.id);
    const result = persistAccountingSnapshot(db, snapshot, actor);
    if (result?.ok !== true) throw new Error('SQLite no confirmó el guardado contable de ' + company.id + '.');
    const saved = readTenantSnapshot(db, company.id);
    if (JSON.stringify(saved) !== JSON.stringify(snapshot)) {
      throw new Error('La verificación posterior al guardado detectó diferencias en la base de ' + company.id + '.');
    }
    return { ok: true, savedCompanyIds: [company.id], unchanged: false };
  } catch (error) {
    const rollbackErrors = [];
    if (metadataUpdated && previousRecord) {
      try {
        manager.updateCompanyMetadata({
          id: company.id,
          rif: previousRecord.rif,
          name: previousRecord.name
        });
      } catch (rollbackError) {
        rollbackErrors.push('no se pudo restaurar la ficha del registro local: ' + String(rollbackError?.message || rollbackError));
      }
    }
    if (registeredHere) {
      try { manager.archiveCompany(company.id); }
      catch (rollbackError) { rollbackErrors.push('no se pudo archivar la base recién creada: ' + String(rollbackError?.message || rollbackError)); }
    }
    if (rollbackErrors.length) {
      throw new Error('Falló el guardado de ' + company.id + ' y la reversión de metadatos quedó incompleta: ' + rollbackErrors.join('; '), { cause: error });
    }
    throw error;
  }
}

module.exports = {
  readTenantSnapshot,
  loadTenantAccountingSnapshot,
  saveTenantAccountingSnapshot
};
