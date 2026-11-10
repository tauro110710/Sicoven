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

    CREATE TABLE IF NOT EXISTS payroll_severance_deposits (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
      deposit_date TEXT NOT NULL,
      deposit_kind TEXT NOT NULL CHECK (deposit_kind IN ('QUARTERLY','SENIORITY','ADVANCE')),
      service_year INTEGER,
      service_quarter INTEGER,
      advance_purpose TEXT,
      advance_authorization_reference TEXT,
      days REAL NOT NULL CHECK (days > 0),
      daily_integral_salary REAL NOT NULL CHECK (daily_integral_salary > 0),
      amount REAL NOT NULL CHECK (amount > 0),
      source_reference TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      supersedes_id TEXT REFERENCES payroll_severance_deposits(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_severance_employee_date
      ON payroll_severance_deposits(company_id, employee_id, deposit_date);

    CREATE TABLE IF NOT EXISTS payroll_severance_interest_months (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
      month TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('TRUST_OR_FUND','AUTHORIZED_BOOK_CREDIT','UNDEPOSITED')),
      capital REAL NOT NULL CHECK (capital >= 0),
      monthly_rate REAL NOT NULL CHECK (monthly_rate >= 0 AND monthly_rate <= 1),
      interest REAL NOT NULL CHECK (interest >= 0),
      source_reference TEXT NOT NULL,
      verified_at TEXT NOT NULL,
      mode_evidence TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      supersedes_id TEXT REFERENCES payroll_severance_interest_months(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_id, employee_id, month, mode, id)
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_severance_interest_employee_month
      ON payroll_severance_interest_months(company_id, employee_id, month);

    CREATE TABLE IF NOT EXISTS payroll_liquidations (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      employee_id TEXT NOT NULL REFERENCES payroll_employees(id) ON DELETE RESTRICT,
      termination_date TEXT NOT NULL,
      termination_reason TEXT NOT NULL,
      total REAL NOT NULL CHECK (total >= 0),
      snapshot_json TEXT NOT NULL,
      supersedes_id TEXT REFERENCES payroll_liquidations(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payroll_liquidations_employee_date
      ON payroll_liquidations(company_id, employee_id, termination_date);
    CREATE TRIGGER IF NOT EXISTS payroll_liquidations_no_update
      BEFORE UPDATE ON payroll_liquidations
      BEGIN SELECT RAISE(ABORT, 'payroll liquidation snapshots are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_liquidations_no_delete
      BEFORE DELETE ON payroll_liquidations
      BEGIN SELECT RAISE(ABORT, 'payroll liquidation snapshots are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS payroll_severance_deposits_no_update
      BEFORE UPDATE ON payroll_severance_deposits
      BEGIN SELECT RAISE(ABORT, 'payroll severance history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_severance_deposits_no_delete
      BEFORE DELETE ON payroll_severance_deposits
      BEGIN SELECT RAISE(ABORT, 'payroll severance history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_severance_interest_no_update
      BEFORE UPDATE ON payroll_severance_interest_months
      BEGIN SELECT RAISE(ABORT, 'payroll interest history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS payroll_severance_interest_no_delete
      BEFORE DELETE ON payroll_severance_interest_months
      BEGIN SELECT RAISE(ABORT, 'payroll interest history is append-only'); END;

    CREATE INDEX IF NOT EXISTS idx_payroll_employees_company_active
      ON payroll_employees(company_id, active, full_name);
    CREATE INDEX IF NOT EXISTS idx_payroll_rules_company_effective
      ON payroll_legal_rules(company_id, active, effective_from, effective_to);
    CREATE INDEX IF NOT EXISTS idx_payroll_runs_company_period
      ON payroll_runs(company_id, period_end DESC);
    CREATE INDEX IF NOT EXISTS idx_payroll_lines_run
      ON payroll_run_lines(run_id);
  `);
  const interestColumns = db.pragma('table_info(payroll_severance_interest_months)');
  if (!interestColumns.some(column => column.name === 'mode_evidence')) {
    db.exec("ALTER TABLE payroll_severance_interest_months ADD COLUMN mode_evidence TEXT NOT NULL DEFAULT ''");
  }
  const legalRuleColumns = db.pragma('table_info(payroll_legal_rules)');
  if (!legalRuleColumns.some(column => column.name === 'frequency_scope')) {
    db.exec("ALTER TABLE payroll_legal_rules ADD COLUMN frequency_scope TEXT NOT NULL DEFAULT 'ALL' CHECK (frequency_scope IN ('ALL','WEEKLY','BIWEEKLY'))");
  }
  const severanceColumns = db.pragma('table_info(payroll_severance_deposits)');
  if (!severanceColumns.some(column => column.name === 'service_year')) {
    db.exec('ALTER TABLE payroll_severance_deposits ADD COLUMN service_year INTEGER');
  }
  const advanceColumns = db.pragma('table_info(payroll_severance_deposits)');
  if (!advanceColumns.some(column => column.name === 'service_quarter')) {
    db.exec('ALTER TABLE payroll_severance_deposits ADD COLUMN service_quarter INTEGER');
  }
  if (!advanceColumns.some(column => column.name === 'advance_purpose')) {
    db.exec('ALTER TABLE payroll_severance_deposits ADD COLUMN advance_purpose TEXT');
  }
  if (!advanceColumns.some(column => column.name === 'advance_authorization_reference')) {
    db.exec('ALTER TABLE payroll_severance_deposits ADD COLUMN advance_authorization_reference TEXT');
  }

  const legalRuleSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='payroll_legal_rules'").get()?.sql || '';
  if (legalRuleSchema.includes('UNIQUE(company_id, code, effective_from)')) {
    db.transaction(() => db.exec(`
      DROP INDEX IF EXISTS idx_payroll_rules_company_effective;
      CREATE TABLE payroll_legal_rules_frequency_migration (
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
        UNIQUE(company_id, code, frequency_scope, effective_from)
      );
      INSERT INTO payroll_legal_rules_frequency_migration
        (id,company_id,code,description,base_key,frequency_scope,worker_rate,employer_rate,base_cap,
         effective_from,effective_to,source_reference,verified_at,applicability_json,active)
      SELECT id,company_id,code,description,base_key,frequency_scope,worker_rate,employer_rate,base_cap,
        effective_from,effective_to,source_reference,verified_at,applicability_json,active
      FROM payroll_legal_rules;
      DROP TABLE payroll_legal_rules;
      ALTER TABLE payroll_legal_rules_frequency_migration RENAME TO payroll_legal_rules;
      CREATE INDEX IF NOT EXISTS idx_payroll_rules_company_effective
        ON payroll_legal_rules(company_id, active, effective_from, effective_to);
    `))();
  }
  return Object.freeze({
    tables: ['payroll_employees', 'payroll_salary_history', 'payroll_legal_rules', 'payroll_runs', 'payroll_run_lines', 'payroll_severance_deposits', 'payroll_severance_interest_months', 'payroll_liquidations']
  });
}

module.exports = { initializePayrollSchema };
