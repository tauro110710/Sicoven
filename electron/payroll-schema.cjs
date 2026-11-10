'use strict';

function initializePayrollSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('Se requiere SQLite para inicializar Nómina.');

  db.exec(`
    CREATE TABLE IF NOT EXISTS payroll_employees (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      fiscal_id TEXT NOT NULL,
      full_name TEXT NOT NULL,
      hire_date TEXT NOT NULL,
      position TEXT NOT NULL DEFAULT '',
      cost_center TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('WEEKLY','BIWEEKLY')),
      base_salary REAL NOT NULL CHECK (base_salary >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_id, fiscal_id)
    );

    CREATE TABLE IF NOT EXISTS payroll_salary_history (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      base_salary REAL NOT NULL CHECK (base_salary > 0),
      source TEXT NOT NULL CHECK (source IN ('INITIAL','SALARY_CHANGE','LEGACY_MIGRATION')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(employee_id, effective_from),
      CHECK (effective_to IS NULL OR effective_to >= effective_from)
    );

    CREATE INDEX IF NOT EXISTS idx_payroll_salary_history_employee
      ON payroll_salary_history(company_id, employee_id, effective_from DESC);

    INSERT INTO payroll_salary_history
      (id, company_id, employee_id, effective_from, base_salary, source)
    SELECT lower(hex(randomblob(16))), e.company_id, e.id, e.hire_date, e.base_salary, 'LEGACY_MIGRATION'
    FROM payroll_employees e
    WHERE NOT EXISTS (SELECT 1 FROM payroll_salary_history h WHERE h.employee_id=e.id);

    CREATE TABLE IF NOT EXISTS payroll_legal_rules (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      base_key TEXT NOT NULL CHECK (base_key IN ('normalSalary','integralSalary','grossSalary')),
      frequency_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (frequency_scope IN ('ALL','WEEKLY','BIWEEKLY')),
      worker_rate REAL NOT NULL CHECK (worker_rate >= 0 AND worker_rate <= 1),
      employer_rate REAL NOT NULL CHECK (employer_rate >= 0 AND employer_rate <= 1),
      base_cap REAL CHECK (base_cap IS NULL OR base_cap >= 0),
      effective_from TEXT NOT NULL,
      effective_to TEXT,
      source_reference TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      applicability_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      UNIQUE(company_id, code, effective_from)
    );

    CREATE TABLE IF NOT EXISTS payroll_runs (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      frequency TEXT NOT NULL CHECK (frequency IN ('WEEKLY','BIWEEKLY')),
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('DRAFT','CONFIRMED','VOIDED')),
      calculation_snapshot_json TEXT NOT NULL,
      totals_json TEXT NOT NULL,
      journal_entry_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      UNIQUE(company_id, frequency, period_start, period_end)
    );

    CREATE TABLE IF NOT EXISTS payroll_run_lines (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES payroll_runs(id) ON DELETE RESTRICT,
      employee_id TEXT NOT NULL,
      line_type TEXT NOT NULL CHECK (line_type IN ('EARNING','WORKER_DEDUCTION','EMPLOYER_CONTRIBUTION','PROVISION')),
      code TEXT NOT NULL,
      description TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount >= 0),
      calculation_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE INDEX IF NOT EXISTS idx_payroll_employees_company_active
      ON payroll_employees(company_id, active, full_name);
    CREATE INDEX IF NOT EXISTS idx_payroll_rules_company_effective
      ON payroll_legal_rules(company_id, active, effective_from, effective_to);
    CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_period
      ON payroll_runs(company_id, period_end DESC);
    CREATE INDEX IF NOT EXISTS idx_payroll_lines_run
      ON payroll_run_lines(run_id);
  `);
  const legalRuleColumns = db.pragma('table_info(payroll_legal_rules)');
  if (!legalRuleColumns.some(column => column.name === 'frequency_scope')) {
    db.exec("ALTER TABLE payroll_legal_rules ADD COLUMN frequency_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (frequency_scope IN ('ALL','WEEKLY','BIWEEKLY'))");
  }
  return Object.freeze({
    tables: ['payroll_employees', 'payroll_salary_history', 'payroll_legal_rules', 'payroll_runs', 'payroll_run_lines']
  });
}

module.exports = { initializePayrollSchema };
