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

test('migrates existing legal rules and permits separate weekly and biweekly versions atomically', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`CREATE TABLE payroll_legal_rules (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, code TEXT NOT NULL, description TEXT NOT NULL,
      base_key TEXT NOT NULL, worker_rate REAL NOT NULL, employer_rate REAL NOT NULL, base_cap REAL,
      effective_from TEXT NOT NULL, effective_to TEXT, source_reference TEXT NOT NULL,
      verified_at TEXT NOT NULL, applicability_json TEXT NOT NULL DEFAULT '{}', active INTEGER NOT NULL DEFAULT 1,
      UNIQUE(company_id, code, effective_from)
    )`);
    db.prepare(`INSERT INTO payroll_legal_rules
      (id,company_id,code,description,base_key,worker_rate,employer_rate,effective_from,source_reference,verified_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run('legacy-rule','co-a','IVSS','IVSS legado','normalSalary',0.04,0.09,'2026-01-01','Fuente histórica','2026-01-01');
    initializeTenantDatabase(db);
    const legacy = db.prepare('SELECT frequency_scope AS frequencyScope FROM payroll_legal_rules WHERE id=?').get('legacy-rule');
    assert.equal(legacy.frequencyScope, 'ALL');
    const insert = db.prepare(`INSERT INTO payroll_legal_rules
      (id,company_id,code,description,base_key,frequency_scope,worker_rate,employer_rate,effective_from,source_reference,verified_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`);
    insert.run('weekly-rule','co-a','IVSS','IVSS semanal','normalSalary','WEEKLY',0.04,0.09,'2026-01-01','Fuente semanal','2026-01-01');
    insert.run('biweekly-rule','co-a','IVSS','IVSS quincenal','normalSalary','BIWEEKLY',0.04,0.10,'2026-01-01','Fuente quincenal','2026-01-01');
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM payroll_legal_rules WHERE company_id='co-a' AND code='IVSS'").get().count, 3);
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
