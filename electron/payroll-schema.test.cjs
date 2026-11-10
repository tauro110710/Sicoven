'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');

test('initializes payroll tables idempotently inside each company tenant', () => {
  const db = new Database(':memory:');
  try {
    const first = initializeTenantDatabase(db);
    const second = initializeTenantDatabase(db);
    assert.deepEqual(first.operationalTables, second.operationalTables);
    for (const name of ['payroll_employees', 'payroll_salary_history', 'payroll_legal_rules', 'payroll_runs', 'payroll_run_lines']) {
      assert.ok(first.operationalTables.includes(name));
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
    }
    const legalRuleColumns = db.pragma('table_info(payroll_legal_rules)');
    const frequencyScope = legalRuleColumns.find(column => column.name === 'frequency_scope');
    assert.ok(frequencyScope);
    assert.equal(frequencyScope.dflt_value, "'ALL'");
  } finally { db.close(); }
});

test('prevents duplicate employee fiscal IDs within one company and invalid payroll frequencies', () => {
  const db = new Database(':memory:');
  try {
    initializeTenantDatabase(db);
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='payroll_salary_history'").get());
    const insert = db.prepare(`INSERT INTO payroll_employees
      (id, company_id, fiscal_id, full_name, hire_date, frequency, base_salary)
      VALUES(?,?,?,?,?,?,?)`);
    insert.run('e1', 'co-a', 'V-123', 'Trabajador Uno', '2025-01-01', 'BIWEEKLY', 100);
    assert.throws(() => insert.run('e2', 'co-a', 'V-123', 'Trabajador Dos', '2025-02-01', 'BIWEEKLY', 100));
    assert.throws(() => insert.run('e3', 'co-a', 'V-456', 'Trabajador Tres', '2025-02-01', 'MONTHLY', 100));
    insert.run('e4', 'co-b', 'V-123', 'Trabajador Otra Empresa', '2025-01-01', 'WEEKLY', 100);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payroll_employees').get().count, 2);
  } finally { db.close(); }
});

test('requires unique payroll period and retains calculation snapshot on the run', () => {
  const db = new Database(':memory:');
  try {
    initializeTenantDatabase(db);
    const insert = db.prepare(`INSERT INTO payroll_runs
      (id, company_id, frequency, period_start, period_end, status, calculation_snapshot_json, totals_json)
      VALUES(?,?,?,?,?,?,?,?)`);
    insert.run('r1', 'co-a', 'BIWEEKLY', '2026-01-01', '2026-01-15', 'DRAFT', '{"rule":"v1"}', '{"net":100}');
    assert.throws(() => insert.run('r2', 'co-a', 'BIWEEKLY', '2026-01-01', '2026-01-15', 'DRAFT', '{}', '{}'));
    assert.equal(db.prepare('SELECT calculation_snapshot_json FROM payroll_runs WHERE id=?').get('r1').calculation_snapshot_json, '{"rule":"v1"}');
  } finally { db.close(); }
});
