'use strict';

const GLOBAL_REFERENCE_TABLES = Object.freeze([
  'inflation_index_sources',
  'inflation_index_series',
  'inflation_index_observations',
  'inflation_index_approvals'
]);

const COMPANY_TABLES = Object.freeze([
  { table: 'accounting_exercise_links', companyColumn: 'company_id' },
  { table: 'party_masters', companyColumn: 'company_id' },
  { table: 'period_reopenings', companyColumn: 'company_id' },
  { table: 'accounting_correction_cases', companyColumn: 'company_id' },
  { table: 'inflation_classification_decisions', companyColumn: 'company_id' },
  { table: 'inflation_source_dossiers', companyColumn: 'company_id' },
  { table: 'supporting_documents', companyColumn: 'company_id' },
  { table: 'vat_fiscal_incidents', companyColumn: 'company_id' },
  { table: 'payroll_employees', companyColumn: 'company_id' },
  { table: 'payroll_legal_rules', companyColumn: 'company_id' },
  { table: 'payroll_runs', companyColumn: 'company_id' }
]);

// Tablas opcionales añadidas en versiones posteriores de Nómina.
const OPTIONAL_COMPANY_TABLES = Object.freeze([
  { table: 'accounting_year_reopenings', companyColumn: 'company_id' },
  { table: 'payroll_severance_deposits', companyColumn: 'company_id' },
  { table: 'payroll_severance_interest_months', companyColumn: 'company_id' },
  { table: 'payroll_liquidations', companyColumn: 'company_id' },
  { table: 'operation_receipts', companyColumn: 'company_id' }
]);

const CHILD_TABLES = Object.freeze([
  { table: 'accounting_correction_case_events', parentTable: 'accounting_correction_cases', parentId: 'id', foreignKey: 'case_id' },
  { table: 'accounting_correction_case_workflow_events', parentTable: 'accounting_correction_cases', parentId: 'id', foreignKey: 'case_id' },
  { table: 'inflation_classification_reviews', parentTable: 'inflation_classification_decisions', parentId: 'id', foreignKey: 'decision_id' },
  { table: 'inflation_source_dossier_evidence', parentTable: 'inflation_source_dossiers', parentId: 'id', foreignKey: 'dossier_id' },
  { table: 'inflation_source_dossier_reviews', parentTable: 'inflation_source_dossiers', parentId: 'id', foreignKey: 'dossier_id' },
  { table: 'supporting_document_events', parentTable: 'supporting_documents', parentId: 'id', foreignKey: 'document_id' },
  { table: 'vat_fiscal_incident_events', parentTable: 'vat_fiscal_incidents', parentId: 'id', foreignKey: 'incident_id' },
  { table: 'vat_fiscal_incident_references', parentTable: 'vat_fiscal_incidents', parentId: 'id', foreignKey: 'incident_id' },
  { table: 'payroll_run_lines', parentTable: 'payroll_runs', parentId: 'id', foreignKey: 'run_id' },
  { table: 'payroll_salary_history', parentTable: 'payroll_employees', parentId: 'id', foreignKey: 'employee_id' }
]);

const ALL_TABLES = Object.freeze([
  ...GLOBAL_REFERENCE_TABLES,
  ...COMPANY_TABLES.map(item => item.table),
  ...OPTIONAL_COMPANY_TABLES.map(item => item.table),
  ...CHILD_TABLES.map(item => item.table)
]);

function assertIdentifier(value) {
  const identifier = String(value || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error('Se rechazó un identificador SQL fuera del manifiesto de migración.');
  }
  return identifier;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
}

function readRows(db, table, where = '', values = []) {
  assertIdentifier(table);
  if (!tableExists(db, table)) {
    throw new Error('La base heredada no contiene la tabla requerida para migración: ' + table + '.');
  }
  return db.prepare('SELECT * FROM "' + table + '"' + where).all(...values);
}

function insertRows(db, table, rows) {
  if (!rows.length) return 0;
  assertIdentifier(table);
  const columns = Object.keys(rows[0]);
  if (!columns.length || columns.some(column => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(column))) {
    throw new Error('La tabla ' + table + ' contiene columnas no admitidas por el migrador.');
  }
  const expected = columns.join('|');
  for (const row of rows) {
    if (Object.keys(row).join('|') !== expected) {
      throw new Error('La estructura de filas de ' + table + ' cambió durante la migración.');
    }
  }
  const quotedColumns = columns.map(column => '"' + column + '"').join(',');
  const placeholders = columns.map(() => '?').join(',');
  const insert = db.prepare('INSERT INTO "' + table + '" (' + quotedColumns + ') VALUES (' + placeholders + ')');
  for (const row of rows) insert.run(...columns.map(column => row[column]));
  return rows.length;
}

function copyCompanyRelationalData(sourceDb, destinationDb, companyIdInput) {
  const companyId = String(companyIdInput || '').trim();
  if (!companyId) throw new Error('Se requiere el identificador de la empresa para copiar sus tablas auxiliares.');
  if (!sourceDb || !destinationDb || typeof sourceDb.prepare !== 'function' || typeof destinationDb.prepare !== 'function') {
    throw new TypeError('Se requieren las bases SQLite de origen y destino.');
  }
  for (const table of ALL_TABLES) {
    const optional = OPTIONAL_COMPANY_TABLES.some(item => item.table === table);
    if (!tableExists(sourceDb, table)) {
      if (optional) continue;
      throw new Error('La base heredada no contiene la tabla requerida para migración: ' + table + '.');
    }
    if (!tableExists(destinationDb, table)) {
      throw new Error('La base destino no inicializó la tabla requerida: ' + table + '.');
    }
  }

  const counts = Object.create(null);
  const copy = destinationDb.transaction(() => {
    for (const table of GLOBAL_REFERENCE_TABLES) {
      counts[table] = insertRows(destinationDb, table, readRows(sourceDb, table));
    }

    const parentRows = new Map();
    for (const definition of [...COMPANY_TABLES, ...OPTIONAL_COMPANY_TABLES]) {
      if (!tableExists(sourceDb, definition.table)) { counts[definition.table] = 0; parentRows.set(definition.table, []); continue; }
      const rows = readRows(sourceDb, definition.table, ' WHERE "' + definition.companyColumn + '"=?', [companyId]);
      counts[definition.table] = insertRows(destinationDb, definition.table, rows);
      parentRows.set(definition.table, rows);
    }

    for (const definition of CHILD_TABLES) {
      const parents = parentRows.get(definition.parentTable) || [];
      const parentIds = parents.map(row => row[definition.parentId]);
      if (parentIds.some(value => value === null || value === undefined || String(value) === '')) {
        throw new Error('La tabla padre ' + definition.parentTable + ' contiene IDs vacíos.');
      }
      if (parentIds.length === 0) {
        counts[definition.table] = 0;
        continue;
      }
      const placeholders = parentIds.map(() => '?').join(',');
      const rows = readRows(sourceDb, definition.table,
        ' WHERE "' + definition.foreignKey + '" IN (' + placeholders + ')', parentIds);
      counts[definition.table] = insertRows(destinationDb, definition.table, rows);
    }

    const violations = destinationDb.pragma('foreign_key_check');
    if (violations.length) {
      throw new Error('La migración de tablas auxiliares produjo relaciones SQLite inválidas; se revirtió la transacción.');
    }
  });
  copy();
  return Object.freeze({
    companyId,
    counts: Object.freeze({ ...counts }),
    totalRows: Object.values(counts).reduce((sum, count) => sum + count, 0)
  });
}

module.exports = {
  GLOBAL_REFERENCE_TABLES,
  COMPANY_TABLES,
  OPTIONAL_COMPANY_TABLES,
  CHILD_TABLES,
  copyCompanyRelationalData
};
