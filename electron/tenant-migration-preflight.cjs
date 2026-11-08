'use strict';

const { GLOBAL_REFERENCE_TABLES, COMPANY_TABLES, CHILD_TABLES } = require('./tenant-relational-migration.cjs');

const CONTROL_TABLES = Object.freeze([
  'auth_users',
  'auth_sessions',
  'license_state',
  'company_database_registry'
]);
const SNAPSHOT_TABLES = Object.freeze(['app_state']);
const AUDIT_TABLES = Object.freeze(['audit_events']);
const INTERNAL_TABLES = Object.freeze(['sqlite_sequence', 'sqlite_stat1', 'sqlite_stat4']);

const CLASSIFICATION = new Map([
  ...CONTROL_TABLES.map(name => [name, 'CONTROL']),
  ...SNAPSHOT_TABLES.map(name => [name, 'SNAPSHOT']),
  ...AUDIT_TABLES.map(name => [name, 'AUDIT']),
  ...GLOBAL_REFERENCE_TABLES.map(name => [name, 'GLOBAL_REFERENCE']),
  ...COMPANY_TABLES.map(item => [item.table, 'COMPANY']),
  ...CHILD_TABLES.map(item => [item.table, 'CHILD']),
  ...INTERNAL_TABLES.map(name => [name, 'SQLITE_INTERNAL'])
]);

function inspectLegacyDatabase(db) {
  if (!db || typeof db.prepare !== 'function') {
    throw new TypeError('Se requiere la base SQLite heredada para ejecutar la inspección previa.');
  }
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(row => String(row.name));
  const classified = [];
  const unknownTables = [];
  for (const name of tables) {
    const category = CLASSIFICATION.get(name);
    if (!category) unknownTables.push(name);
    else classified.push({ name, category });
  }
  const missingRequired = ['app_state', 'audit_events', ...CONTROL_TABLES.filter(name => name !== 'company_database_registry')]
    .filter(name => !tables.includes(name));
  const stateRows = tables.includes('app_state')
    ? db.prepare('SELECT state_key,state_json,updated_at FROM app_state ORDER BY state_key').all()
    : [];
  const accountingRows = stateRows.filter(row => row.state_key === 'accounting');
  const errors = [];
  if (unknownTables.length) errors.push('Hay tablas sin clasificación explícita: ' + unknownTables.join(', ') + '.');
  if (missingRequired.length) errors.push('Faltan tablas esperadas de control o estado: ' + missingRequired.join(', ') + '.');
  if (accountingRows.length !== 1) errors.push('Debe existir exactamente un snapshot contable heredado.');
  let accountingSnapshot = null;
  if (accountingRows.length === 1) {
    try {
      accountingSnapshot = JSON.parse(accountingRows[0].state_json);
      if (!accountingSnapshot || typeof accountingSnapshot !== 'object' || Array.isArray(accountingSnapshot) ||
          !Array.isArray(accountingSnapshot.companies)) {
        errors.push('El snapshot contable no contiene una lista válida de empresas.');
      }
    } catch {
      errors.push('El snapshot contable heredado no contiene JSON válido.');
    }
  }
  if (accountingSnapshot) {
    const ids = new Set();
    const rifs = new Set();
    for (const company of accountingSnapshot.companies) {
      const id = String(company?.id || '').trim();
      const rif = String(company?.rif || '').trim().toUpperCase();
      if (!id || ids.has(id)) errors.push('El snapshot contiene identificadores de empresa vacíos o duplicados.');
      if (!rif || rifs.has(rif)) errors.push('El snapshot contiene RIF vacíos o duplicados.');
      ids.add(id);
      rifs.add(rif);
    }
    if (accountingSnapshot.companies.length === 0) {
      errors.push('No hay empresas en el snapshot; no se puede inferir ni crear una base por empresa.');
    }
  }
  return Object.freeze({
    ok: errors.length === 0,
    tables: Object.freeze(classified),
    unknownTables: Object.freeze(unknownTables),
    missingRequired: Object.freeze(missingRequired),
    companyCount: Array.isArray(accountingSnapshot?.companies) ? accountingSnapshot.companies.length : 0,
    companyIds: Object.freeze((accountingSnapshot?.companies || []).map(company => String(company.id))),
    errors: Object.freeze(errors)
  });
}

module.exports = { CONTROL_TABLES, SNAPSHOT_TABLES, AUDIT_TABLES, inspectLegacyDatabase };
