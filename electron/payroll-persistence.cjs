'use strict';

const crypto = require('node:crypto');
const { calculateVacationSalaryBasis, calculateAnnualLaborRights } = require('./payroll-legal-calculations.cjs');

function text(value, label, max = 240, min = 1) {
  const result = String(value ?? '').trim();
  if (result.length < min || result.length > max) throw new Error(label + ' debe contener entre ' + min + ' y ' + max + ' caracteres.');
  return result;
}
function date(value, label) {
  const result = text(value, label, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(label + ' debe usar AAAA-MM-DD.');
  const parsed = new Date(result + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(label + ' no es una fecha válida.');
  return result;
}
function positiveOrZero(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new Error(label + ' debe ser un número igual o mayor que cero.');
  return Math.round((result + Number.EPSILON) * 100) / 100;
}
function readState(db) {
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('No existe un estado contable para validar la empresa activa.');
  const state = JSON.parse(row.state_json);
  if (!state || !Array.isArray(state.companies)) throw new Error('El estado contable no contiene empresas válidas.');
  return state;
}
function ensureCompany(db, companyId) {
  const state = readState(db);
  const company = state.companies.find(item => String(item.id) === String(companyId));
  if (!company) throw new Error('La empresa activa no existe en esta base de datos.');
  return company;
}
function listPayrollEmployees(db, companyId) {
  ensureCompany(db, companyId);
  return db.prepare(`SELECT id, company_id AS companyId, fiscal_id AS fiscalId, full_name AS fullName,
    hire_date AS hireDate, position, cost_center AS costCenter, frequency,
    base_salary AS baseSalary, active FROM payroll_employees
    WHERE company_id=? ORDER BY active DESC, full_name COLLATE NOCASE`).all(companyId)
    .map(row => ({ ...row, active: Boolean(row.active) }));
}
function listPayrollSalaryHistory(db, companyId, employeeId) {
  ensureCompany(db, companyId);
  const id = text(employeeId, 'Trabajador', 120);
  const employee = db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId);
  if (!employee) throw new Error('El trabajador no pertenece a la empresa activa.');
  return db.prepare(`SELECT id, company_id AS companyId, employee_id AS employeeId,
    effective_from AS effectiveFrom, effective_to AS effectiveTo, base_salary AS baseSalary,
    source, created_at AS createdAt FROM payroll_salary_history
    WHERE company_id=? AND employee_id=? ORDER BY effective_from DESC`).all(companyId, id);
}
function getPayrollSalaryForDate(db, companyId, employeeId, effectiveDate) {
  ensureCompany(db, companyId);
  const id = text(employeeId, 'Trabajador', 120);
  const asOf = date(effectiveDate, 'Fecha de consulta salarial');
  const employee = db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId);
  if (!employee) throw new Error('El trabajador no pertenece a la empresa activa.');
  const row = db.prepare(`SELECT id, company_id AS companyId, employee_id AS employeeId,
    effective_from AS effectiveFrom, effective_to AS effectiveTo, base_salary AS baseSalary,
    source FROM payroll_salary_history WHERE company_id=? AND employee_id=?
      AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)
    ORDER BY effective_from DESC LIMIT 1`).get(companyId, id, asOf, asOf);
  if (!row) throw new Error('No existe un salario histórico registrado para ' + asOf + '. Revise la ficha del trabajador.');
  return row;
}
function savePayrollEmployee(db, companyId, input) {
  ensureCompany(db, companyId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La ficha del trabajador es inválida.');
  const id = input.id ? text(input.id, 'Identificador', 120) : crypto.randomUUID();
  const fiscalId = text(input.fiscalId, 'Cédula/RIF', 40).toUpperCase();
  const fullName = text(input.fullName, 'Nombre completo', 180);
  const hireDate = date(input.hireDate, 'Fecha de ingreso');
  const position = input.position ? text(input.position, 'Cargo', 120, 0) : '';
  const costCenter = input.costCenter ? text(input.costCenter, 'Centro de costos', 120) : null;
  const frequency = String(input.frequency || '');
  if (!['WEEKLY', 'BIWEEKLY'].includes(frequency)) throw new Error('La periodicidad debe ser semanal o quincenal.');
  const baseSalary = positiveOrZero(input.baseSalary, 'Salario base');
  const salaryEffectiveFrom = date(input.salaryEffectiveFrom || (input.id ? new Date().toISOString().slice(0,10) : hireDate), 'Vigencia del salario');
  if (baseSalary <= 0) throw new Error('El salario base debe ser mayor que cero.');
  const active = input.active === false ? 0 : 1;
  const existing = db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId);
  const fiscalDuplicate = db.prepare('SELECT id FROM payroll_employees WHERE company_id=? AND fiscal_id=? AND id<>?').get(companyId, fiscalId, id);
  if (fiscalDuplicate) throw new Error('Ya existe un trabajador con esa cédula/RIF en la empresa activa.');
  if (input.id && !existing) throw new Error('El trabajador no existe en la empresa activa.');
  const now = new Date().toISOString();
  const previousSalary = existing
    ? db.prepare('SELECT base_salary AS baseSalary FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId)
    : null;
  const salaryChanged = !existing || Number(previousSalary.baseSalary) !== baseSalary;
  const latestSalary = existing
    ? db.prepare('SELECT effective_from AS effectiveFrom FROM payroll_salary_history WHERE company_id=? AND employee_id=? ORDER BY effective_from DESC LIMIT 1').get(companyId, id)
    : null;
  if (salaryChanged && latestSalary && salaryEffectiveFrom <= latestSalary.effectiveFrom) {
    throw new Error('La vigencia del nuevo salario debe ser posterior al último cambio registrado (' + latestSalary.effectiveFrom + ').');
  }
  const persistEmployee = db.transaction(() => {
    db.prepare(`INSERT INTO payroll_employees
      (id,company_id,fiscal_id,full_name,hire_date,position,cost_center,frequency,base_salary,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET fiscal_id=excluded.fiscal_id,full_name=excluded.full_name,
      hire_date=excluded.hire_date,position=excluded.position,cost_center=excluded.cost_center,
      frequency=excluded.frequency,base_salary=excluded.base_salary,active=excluded.active,updated_at=excluded.updated_at`)
      .run(id, companyId, fiscalId, fullName, hireDate, position, costCenter, frequency, baseSalary, active, now, now);
    if (salaryChanged) {
      const priorDay = new Date(salaryEffectiveFrom + 'T00:00:00.000Z');
      priorDay.setUTCDate(priorDay.getUTCDate() - 1);
      if (latestSalary) db.prepare(`UPDATE payroll_salary_history SET effective_to=?
        WHERE company_id=? AND employee_id=? AND effective_to IS NULL`).run(
          priorDay.toISOString().slice(0,10), companyId, id);
      db.prepare(`INSERT INTO payroll_salary_history
        (id,company_id,employee_id,effective_from,effective_to,base_salary,source)
        VALUES(?,?,?,?,NULL,?,?)`).run(crypto.randomUUID(), companyId, id, salaryEffectiveFrom, baseSalary,
          existing ? 'SALARY_CHANGE' : 'INITIAL');
    }
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run(existing ? 'payroll_employee_updated' : 'payroll_employee_created',
        JSON.stringify({ employeeId: id, companyId, fiscalId, fullName, salaryChanged, salaryEffectiveFrom: salaryChanged ? salaryEffectiveFrom : null, baseSalary }));
  });
  persistEmployee();
  return listPayrollEmployees(db, companyId).find(item => item.id === id);
}
function listPayrollLegalRules(db, companyId) {
  ensureCompany(db, companyId);
  return db.prepare(`SELECT id,company_id AS companyId,code,description,base_key AS base,
    frequency_scope AS frequencyScope,worker_rate AS workerRate,employer_rate AS employerRate,base_cap AS baseCap,
    effective_from AS effectiveFrom,effective_to AS effectiveTo,
    source_reference AS sourceReference,verified_at AS verifiedAt,
    applicability_json AS applicabilityJson,active FROM payroll_legal_rules
    WHERE company_id=? ORDER BY code,effective_from DESC`).all(companyId)
    .map(row => ({ ...row, active: Boolean(row.active), applicability: JSON.parse(row.applicabilityJson) }));
}
function savePayrollLegalRule(db, companyId, input) {
  ensureCompany(db, companyId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La regla legal es inválida.');
  const id = input.id ? text(input.id, 'Identificador de regla', 120) : crypto.randomUUID();
  const code = text(input.code, 'Código', 60).toUpperCase();
  const description = text(input.description, 'Descripción', 240);
  const base = String(input.base || '');
  if (!['normalSalary', 'integralSalary', 'grossSalary'].includes(base)) throw new Error('La base de cálculo no está permitida.');
  const frequencyScope = String(input.frequencyScope || 'ALL');
  if (!['ALL','WEEKLY','BIWEEKLY'].includes(frequencyScope)) throw new Error('La periodicidad de aplicación de la regla no es válida.');
  const workerRate = Number(input.workerRate), employerRate = Number(input.employerRate);
  for (const [label, rate] of [['trabajador', workerRate], ['patronal', employerRate]]) {
    if (!Number.isFinite(rate) || rate < 0 || rate > 1) throw new Error('La tasa ' + label + ' debe estar entre 0 y 1.');
  }
  const baseCap = input.baseCap == null || input.baseCap === '' ? null : positiveOrZero(input.baseCap, 'Tope de base');
  const effectiveFrom = date(input.effectiveFrom, 'Vigente desde');
  const effectiveTo = input.effectiveTo ? date(input.effectiveTo, 'Vigente hasta') : null;
  if (effectiveTo && effectiveTo < effectiveFrom) throw new Error('La fecha final no puede ser anterior a la inicial.');
  const sourceReference = text(input.sourceReference, 'Fuente normativa', 1000);
  const verifiedAt = date(input.verifiedAt, 'Fecha de verificación');
  const applicability = input.applicability && typeof input.applicability === 'object' && !Array.isArray(input.applicability)
    ? JSON.stringify(input.applicability) : '{}';
  const active = input.active === false ? 0 : 1;
  const existing = db.prepare('SELECT id FROM payroll_legal_rules WHERE id=? AND company_id=?').get(id, companyId);
  if (input.id && !existing) throw new Error('La regla no existe en la empresa activa.');
  const overlapping = db.prepare(`SELECT id FROM payroll_legal_rules
    WHERE company_id=? AND code=? AND id<>?
      AND (frequency_scope='ALL' OR ?='ALL' OR frequency_scope=?)
      AND effective_from<=COALESCE(?, '9999-12-31')
      AND COALESCE(effective_to, '9999-12-31')>=?`).get(companyId, code, id, frequencyScope, frequencyScope, effectiveTo, effectiveFrom);
  if (overlapping) throw new Error('La vigencia de esta regla se solapa con otra versión del mismo código y periodicidad.');
  db.prepare(`INSERT INTO payroll_legal_rules
    (id,company_id,code,description,base_key,frequency_scope,worker_rate,employer_rate,base_cap,effective_from,effective_to,
     source_reference,verified_at,applicability_json,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET description=excluded.description,base_key=excluded.base_key,
    frequency_scope=excluded.frequency_scope,worker_rate=excluded.worker_rate,employer_rate=excluded.employer_rate,base_cap=excluded.base_cap,
    effective_from=excluded.effective_from,effective_to=excluded.effective_to,
    source_reference=excluded.source_reference,verified_at=excluded.verified_at,
    applicability_json=excluded.applicability_json,active=excluded.active`)
    .run(id, companyId, code, description, base, frequencyScope, workerRate, employerRate, baseCap, effectiveFrom,
      effectiveTo, sourceReference, verifiedAt, applicability, active);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run(existing ? 'payroll_legal_rule_updated' : 'payroll_legal_rule_created',
      JSON.stringify({ ruleId: id, companyId, code, effectiveFrom, effectiveTo, sourceReference }));
  return listPayrollLegalRules(db, companyId).find(item => item.id === id);
}

function calculateEmployeeDraft(db, companyId, employee, input, periodEnd, frequency) {
  if (!input || !Array.isArray(input.earnings) || input.earnings.length === 0) throw new Error('Cada trabajador requiere al menos una asignación.');
  const salaryRecord = getPayrollSalaryForDate(db, companyId, employee.id, periodEnd);
  const suppliedBases = input.bases && typeof input.bases === 'object' && !Array.isArray(input.bases)
    ? input.bases : {};
  const earnings = input.earnings.map(line => ({
    code: text(line.code, 'Código de asignación', 60),
    description: text(line.description, 'Descripción de asignación', 180),
    amount: positiveOrZero(line.amount, 'Importe de asignación'),
    isSalary: line.isSalary === true
  }));
  const deductions = (input.deductions || []).map(line => ({
    code: text(line.code, 'Código de deducción', 60),
    description: text(line.description, 'Descripción de deducción', 180),
    amount: positiveOrZero(line.amount, 'Importe de deducción')
  }));
  const rules = db.prepare(`SELECT code,description,base_key AS base,worker_rate AS workerRate,
    employer_rate AS employerRate,base_cap AS baseCap,effective_from AS effectiveFrom,
    effective_to AS effectiveTo,source_reference AS sourceReference,verified_at AS verifiedAt,
    applicability_json AS applicabilityJson
    FROM payroll_legal_rules WHERE company_id=? AND active=1 AND effective_from<=?
    AND (effective_to IS NULL OR effective_to>=?) AND frequency_scope IN ('ALL',?) ORDER BY code`).all(companyId, periodEnd, periodEnd, frequency);
  const requiredBases = new Set(rules.map(rule => rule.base));
  const bases = {};
  for (const key of ['normalSalary', 'integralSalary', 'grossSalary']) {
    const raw = suppliedBases[key];
    const value = raw == null || raw === '' ? 0 : positiveOrZero(raw, 'Base ' + key);
    if (requiredBases.has(key) && value <= 0) {
      throw new Error('La regla legal vigente requiere una base salarial positiva: ' + key + '.');
    }
    bases[key] = value;
  }
  const contributions = rules.map(rule => {
    const applicability = JSON.parse(rule.applicabilityJson || '{}');
    if (Object.keys(applicability).length > 0) {
      throw new Error('La regla ' + rule.code + ' depende de condiciones de empresa o trabajador aún no configuradas; no se aplicó automáticamente.');
    }
    if (!rule.sourceReference || !rule.verifiedAt || rule.verifiedAt > new Date().toISOString().slice(0,10)) {
      throw new Error('La regla ' + rule.code + ' no tiene verificación válida.');
    }
    const rateWorker = Number(rule.workerRate), rateEmployer = Number(rule.employerRate);
    if (!Number.isFinite(rateWorker) || rateWorker < 0 || rateWorker > 1 ||
        !Number.isFinite(rateEmployer) || rateEmployer < 0 || rateEmployer > 1) throw new Error('Tasa inválida en ' + rule.code + '.');
    const baseValue = Number(bases[rule.base]);
    const base = Math.round(Math.min(baseValue, rule.baseCap == null ? baseValue : Number(rule.baseCap)) * 100) / 100;
    return {
      code: rule.code, description: rule.description, base,
      workerAmount: Math.round(base * rateWorker * 100) / 100,
      employerAmount: Math.round(base * rateEmployer * 100) / 100,
      sourceReference: rule.sourceReference, verifiedAt: rule.verifiedAt,
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo
    };
  });
  const grossEarnings = Math.round(earnings.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const salaryEarnings = Math.round(earnings.filter(line => line.isSalary).reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const workerLegalDeductions = Math.round(contributions.reduce((sum, line) => sum + line.workerAmount, 0) * 100) / 100;
  const employerContributions = Math.round(contributions.reduce((sum, line) => sum + line.employerAmount, 0) * 100) / 100;
  const otherDeductions = Math.round(deductions.reduce((sum, line) => sum + line.amount, 0) * 100) / 100;
  const netPay = Math.round((grossEarnings - workerLegalDeductions - otherDeductions) * 100) / 100;
  if (netPay < 0) throw new Error('Las deducciones superan las asignaciones de ' + employee.fullName + '.');
  return {
    employeeId: employee.id, fiscalId: employee.fiscalId, fullName: employee.fullName,
    salaryRecord,
    earnings, deductions, bases: { normalSalary: Number(bases.normalSalary), integralSalary: Number(bases.integralSalary), grossSalary: Number(bases.grossSalary) },
    contributions, grossEarnings, salaryEarnings, workerLegalDeductions, employerContributions,
    otherDeductions, netPay, totalEmployerCost: Math.round((grossEarnings + employerContributions) * 100) / 100
  };
}
function createPayrollRun(db, companyId, input) {
  const company = ensureCompany(db, companyId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La nómina es inválida.');
  const frequency = String(input.frequency || '');
  if (!['WEEKLY','BIWEEKLY'].includes(frequency)) throw new Error('La periodicidad debe ser semanal o quincenal.');
  const periodStart = date(input.periodStart, 'Inicio del período');
  const periodEnd = date(input.periodEnd, 'Fin del período');
  if (periodEnd < periodStart) throw new Error('El fin del período no puede ser anterior al inicio.');
  const overlappingRun = db.prepare(`SELECT period_start AS periodStart, period_end AS periodEnd
    FROM payroll_runs
    WHERE company_id=? AND frequency=? AND status<>'VOIDED'
      AND period_start<=? AND period_end>=?
    LIMIT 1`).get(companyId, frequency, periodEnd, periodStart);
  if (overlappingRun) {
    throw new Error('Ya existe una nómina ' + frequency + ' para un período que se cruza con ' +
      overlappingRun.periodStart + ' al ' + overlappingRun.periodEnd + '. Revise el período antes de continuar.');
  }
  if (!Array.isArray(input.employees) || input.employees.length === 0) throw new Error('Seleccione al menos un trabajador.');
  const seen = new Set();
  const calculations = input.employees.map(item => {
    const employeeId = text(item.employeeId, 'Trabajador', 120);
    if (seen.has(employeeId)) throw new Error('Un trabajador aparece más de una vez en esta nómina.');
    seen.add(employeeId);
    const employee = db.prepare(`SELECT id,fiscal_id AS fiscalId,full_name AS fullName,frequency,active
      FROM payroll_employees WHERE id=? AND company_id=?`).get(employeeId, companyId);
    if (!employee || !employee.active) throw new Error('Un trabajador no pertenece a la empresa activa o está inactivo.');
    if (employee.frequency !== frequency) throw new Error('La periodicidad de ' + employee.fullName + ' no coincide con la nómina.');
    return calculateEmployeeDraft(db, companyId, employee, item, periodEnd, frequency);
  });
  const totals = calculations.reduce((sum, item) => ({
    grossEarnings: sum.grossEarnings + item.grossEarnings,
    workerLegalDeductions: sum.workerLegalDeductions + item.workerLegalDeductions,
    otherDeductions: sum.otherDeductions + item.otherDeductions,
    employerContributions: sum.employerContributions + item.employerContributions,
    netPay: sum.netPay + item.netPay,
    totalEmployerCost: sum.totalEmployerCost + item.totalEmployerCost
  }), { grossEarnings:0, workerLegalDeductions:0, otherDeductions:0, employerContributions:0, netPay:0, totalEmployerCost:0 });
  for (const key of Object.keys(totals)) totals[key] = Math.round(totals[key] * 100) / 100;
  const id = crypto.randomUUID();
  const snapshot = {
    version: 1, companyId, frequency, periodStart, periodEnd, createdAt: new Date().toISOString(),
    companySnapshot: {
      name: String(company.name || ''), rif: String(company.rif || ''),
      address: String(company.address || ''), phone: String(company.phone || '')
    },
    employees: calculations
  };
  const insert = db.transaction(() => {
    db.prepare(`INSERT INTO payroll_runs
      (id,company_id,frequency,period_start,period_end,status,calculation_snapshot_json,totals_json)
      VALUES(?,?,?,?,?,'DRAFT',?,?)`).run(id, companyId, frequency, periodStart, periodEnd, JSON.stringify(snapshot), JSON.stringify(totals));
    const lineInsert = db.prepare(`INSERT INTO payroll_run_lines
      (id,run_id,employee_id,line_type,code,description,amount,calculation_json)
      VALUES(?,?,?,?,?,?,?,?)`);
    for (const employee of calculations) {
      for (const line of employee.earnings) lineInsert.run(crypto.randomUUID(),id,employee.employeeId,'EARNING',line.code,line.description,line.amount,JSON.stringify({isSalary:line.isSalary}));
      for (const line of employee.deductions) lineInsert.run(crypto.randomUUID(),id,employee.employeeId,'WORKER_DEDUCTION',line.code,line.description,line.amount,'{}');
      for (const line of employee.contributions) {
        if (line.workerAmount) lineInsert.run(crypto.randomUUID(),id,employee.employeeId,'WORKER_DEDUCTION',line.code,line.description,line.workerAmount,JSON.stringify(line));
        if (line.employerAmount) lineInsert.run(crypto.randomUUID(),id,employee.employeeId,'EMPLOYER_CONTRIBUTION',line.code,line.description,line.employerAmount,JSON.stringify(line));
      }
    }
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('payroll_run_created',JSON.stringify({runId:id,companyId,frequency,periodStart,periodEnd,employeeCount:calculations.length,totals}));
  });
  insert();
  return { id, companyId, frequency, periodStart, periodEnd, status:'DRAFT', employeeCount:calculations.length, totals, snapshot };
}
function calculatePayrollAnnualRights(db, companyId, input) {
  ensureCompany(db, companyId);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Los datos del cálculo legal son inválidos.');
  const employeeId = text(input.employeeId, 'Trabajador', 120);
  const employee = db.prepare('SELECT id,full_name AS fullName,hire_date AS hireDate FROM payroll_employees WHERE id=? AND company_id=? AND active=1')
    .get(employeeId, companyId);
  if (!employee) throw new Error('El trabajador no pertenece a la empresa activa o está inactivo.');
  const basis = calculateVacationSalaryBasis(input);
  const rights = calculateAnnualLaborRights({
    hireDate: employee.hireDate, asOfDate: input.asOfDate,
    dailyNormalSalary: basis.dailySalary, fiscalYearStart: input.fiscalYearStart
  });
  return { employeeId, fullName: employee.fullName, asOfDate: input.asOfDate, salaryBasis: basis, ...rights };
}

function listPayrollRuns(db, companyId) {
  ensureCompany(db, companyId);
  return db.prepare(`SELECT id,company_id AS companyId,frequency,period_start AS periodStart,
    period_end AS periodEnd,status,totals_json AS totalsJson,created_at AS createdAt,
    confirmed_at AS confirmedAt,journal_entry_id AS journalEntryId
    FROM payroll_runs WHERE company_id=? ORDER BY period_end DESC,created_at DESC`).all(companyId)
    .map(row => ({...row,totals:JSON.parse(row.totalsJson)}));
}

function getPayrollRun(db, companyId, runId) {
  ensureCompany(db, companyId);
  const id = text(runId, 'Nómina', 120);
  const row = db.prepare(`SELECT id,company_id AS companyId,frequency,period_start AS periodStart,
    period_end AS periodEnd,status,calculation_snapshot_json AS snapshotJson,
    totals_json AS totalsJson,created_at AS createdAt,confirmed_at AS confirmedAt,
    journal_entry_id AS journalEntryId FROM payroll_runs WHERE id=? AND company_id=?`).get(id, companyId);
  if (!row) throw new Error('La nómina no pertenece a la empresa activa.');
  return { ...row, snapshot: JSON.parse(row.snapshotJson), totals: JSON.parse(row.totalsJson) };
}

function confirmPayrollRun(db, companyId, runId, journalEntryId) {
  const company = ensureCompany(db, companyId);
  const id = text(runId, 'Nómina', 120);
  const journalId = text(journalEntryId, 'Asiento contable', 120);
  const confirm = db.transaction(() => {
    const run = db.prepare(`SELECT id,status,journal_entry_id AS journalEntryId,period_start AS periodStart,
      period_end AS periodEnd,totals_json AS totalsJson,confirmed_at AS confirmedAt
      FROM payroll_runs WHERE id=? AND company_id=?`).get(id, companyId);
    if (!run) throw new Error('La nómina no pertenece a la empresa activa.');
    if (run.status === 'CONFIRMED') {
      if (run.journalEntryId !== journalId) throw new Error('La nómina ya fue confirmada con otro asiento contable.');
      return { id: run.id, companyId, status: run.status, journalEntryId: run.journalEntryId,
        periodStart: run.periodStart, periodEnd: run.periodEnd, totals: JSON.parse(run.totalsJson), confirmedAt: run.confirmedAt, alreadyConfirmed: true };
    }
    if (run.status !== 'DRAFT') throw new Error('Solo se puede confirmar una nómina en borrador.');

    // The accounting snapshot and payroll tables share this tenant database.
    // Validate the persisted journal before changing the payroll status.
    const state = readState(db);
    const journal = Array.isArray(state.journalEntries)
      ? state.journalEntries.find(entry => entry && String(entry.id) === journalId &&
          String(entry.companyId) === String(companyId) && String(entry.referenceDoc || '') === 'NOM-' + id)
      : null;
    if (!journal) throw new Error('No existe en la contabilidad de esta empresa el asiento correspondiente a esta nómina.');
    if (journal.date !== run.periodEnd || !Array.isArray(journal.items) || journal.items.length < 2 ||
        !Number.isFinite(Number(journal.bcvRate)) || Number(journal.bcvRate) <= 0) {
      throw new Error('El asiento de nómina no tiene fecha, tasa BCV o líneas contables válidas para el período.');
    }
    const rates = Array.isArray(company.accountingBcvRateHistory) ? company.accountingBcvRateHistory
      .filter(item => item && item.effectiveDate <= run.periodEnd && Number.isFinite(Number(item.rate)) && Number(item.rate) > 0)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || String(b.fetchedAt || '').localeCompare(String(a.fetchedAt || ''))) : [];
    const applicableRate = rates[0];
    const rateAgeDays = applicableRate
      ? Math.floor((Date.parse(run.periodEnd + 'T00:00:00Z') - Date.parse(applicableRate.effectiveDate + 'T00:00:00Z')) / 86400000)
      : Infinity;
    if (!applicableRate || rateAgeDays < 0 || rateAgeDays > 7 ||
        Math.abs(Number(journal.bcvRate) - Number(applicableRate.rate)) > 0.0001) {
      throw new Error('El asiento debe usar la tasa BCV histórica guardada, vigente al cierre del período de nómina.');
    }
    let debitBs = 0, creditBs = 0, debitUsd = 0, creditUsd = 0;
    for (const item of journal.items) {
      const values = ['debitBs','creditBs','debitUsd','creditUsd'].map(key => Number(item[key]));
      if (!item.accountCode || values.some(value => !Number.isFinite(value) || value < 0) ||
          (values[0] > 0 && values[1] > 0) || (values[2] > 0 && values[3] > 0)) {
        throw new Error('El asiento de nómina contiene líneas contables inválidas.');
      }
      debitBs += values[0]; creditBs += values[1]; debitUsd += values[2]; creditUsd += values[3];
    }
    const balanced = (debit, credit) => debit > 0 && credit > 0 && Math.abs(debit - credit) <= 0.01;
    if (!balanced(debitBs, creditBs) || !balanced(debitUsd, creditUsd)) {
      throw new Error('El asiento de nómina debe estar cuadrado en bolívares y dólares antes de confirmarse.');
    }
    const totals = JSON.parse(run.totalsJson);
    const amountFor = (code, side) => journal.items
      .filter(item => String(item.accountCode) === code)
      .reduce((sum, item) => sum + Number(item[side] || 0), 0);
    const expectedAmounts = [
      ['6.1.1.01', 'debitBs', Number(totals.grossEarnings || 0)],
      ['6.1.1.12', 'debitBs', Number(totals.employerContributions || 0)],
      ['2.1.3.01', 'creditBs', Number(totals.netPay || 0)],
      ['2.1.3.03', 'creditBs', Number(totals.workerLegalDeductions || 0) + Number(totals.employerContributions || 0)],
      ['2.1.3.04', 'creditBs', Number(totals.otherDeductions || 0)]
    ];
    if (expectedAmounts.some(([code, side, expected]) => Math.abs(amountFor(code, side) - expected) > 0.01)) {
      throw new Error('Los importes del asiento no coinciden con los totales guardados de esta nómina.');
    }

    const now = new Date().toISOString();
    const result = db.prepare(`UPDATE payroll_runs SET status='CONFIRMED',journal_entry_id=?,confirmed_at=?
      WHERE id=? AND company_id=? AND status='DRAFT'`).run(journalId, now, id, companyId);
    if (result.changes !== 1) throw new Error('La nómina cambió mientras se confirmaba. Actualice e intente nuevamente.');
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('payroll_run_confirmed', JSON.stringify({ runId:id, companyId, journalEntryId:journalId, confirmedAt:now }));
    return { id, companyId, status:'CONFIRMED', journalEntryId:journalId,
      periodStart:run.periodStart, periodEnd:run.periodEnd, totals:JSON.parse(run.totalsJson), confirmedAt:now, alreadyConfirmed:false };
  });
  return confirm();
}
function listConfirmedSalaryEntries(db, companyId, employeeId, fromDate, toDate) {
  ensureCompany(db, companyId);
  const id = text(employeeId, 'Trabajador', 120);
  const from = date(fromDate, 'Desde');
  const to = date(toDate, 'Hasta');
  if (to < from) throw new Error('El rango de consulta no es válido.');
  const employee = db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId);
  if (!employee) throw new Error('El trabajador no pertenece a la empresa activa.');
  const rows = db.prepare(`SELECT r.id AS runId,r.frequency,r.period_start AS periodStart,
      r.period_end AS periodEnd,l.id AS lineId,l.code,l.description,l.amount,l.calculation_json AS calculationJson
    FROM payroll_runs r
    JOIN payroll_run_lines l ON l.run_id=r.id
    WHERE r.company_id=? AND r.status='CONFIRMED' AND l.employee_id=?
      AND l.line_type='EARNING' AND r.period_start<=? AND r.period_end>=?
    ORDER BY r.period_start,r.period_end,l.code`).all(companyId,id,to,from);
  return rows.filter(row => {
    let calculation;
    try { calculation = JSON.parse(row.calculationJson || '{}'); } catch { return false; }
    return calculation.isSalary === true;
  }).map(row => ({
    runId: row.runId, lineId: row.lineId, frequency: row.frequency,
    periodStart: row.periodStart, periodEnd: row.periodEnd,
    code: row.code, description: row.description, amount: Number(row.amount)
  }));
}

function registerPayrollIpc({ ipcMain, getActiveSession, withDatabase }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof getActiveSession !== 'function' || typeof withDatabase !== 'function') {
    throw new Error('No se pudo registrar el módulo de Nómina.');
  }
  const authenticate = token => {
    const actor = getActiveSession(token);
    if (!actor) throw new Error('La sesión expiró. Inicie sesión nuevamente.');
    return actor;
  };
  ipcMain.handle('sicoven:payroll-employees-list', async (_event, token) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollEmployees(db, companyId));
  });
  ipcMain.handle('sicoven:payroll-salary-for-date', async (_event, token, employeeId, effectiveDate) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => getPayrollSalaryForDate(db, companyId, employeeId, effectiveDate));
  });
  ipcMain.handle('sicoven:payroll-salary-history-list', async (_event, token, employeeId) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollSalaryHistory(db, companyId, employeeId));
  });
  ipcMain.handle('sicoven:payroll-employee-save', async (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => savePayrollEmployee(db, companyId, input));
  });
  ipcMain.handle('sicoven:payroll-run-get', async (_event, token, runId) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => getPayrollRun(db, companyId, runId));
  });
  ipcMain.handle('sicoven:payroll-run-confirm', async (_event, token, runId, journalEntryId) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => confirmPayrollRun(db, companyId, runId, journalEntryId));
  });
  ipcMain.handle('sicoven:payroll-salary-entries-list', async (_event, token, employeeId, fromDate, toDate) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listConfirmedSalaryEntries(db, companyId, employeeId, fromDate, toDate));
  });
  ipcMain.handle('sicoven:payroll-annual-rights-calculate', async (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => calculatePayrollAnnualRights(db, companyId, input));
  });
  ipcMain.handle('sicoven:payroll-run-create', async (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => createPayrollRun(db, companyId, input));
  });
  ipcMain.handle('sicoven:payroll-runs-list', async (_event, token) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollRuns(db, companyId));
  });
  ipcMain.handle('sicoven:payroll-rules-list', async (_event, token) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollLegalRules(db, companyId));
  });
  ipcMain.handle('sicoven:payroll-rule-save', async (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => savePayrollLegalRule(db, companyId, input));
  });
}
module.exports = {
  listPayrollEmployees, listPayrollSalaryHistory, getPayrollSalaryForDate, savePayrollEmployee, listPayrollLegalRules, savePayrollLegalRule,
  createPayrollRun, listPayrollRuns, getPayrollRun, confirmPayrollRun, listConfirmedSalaryEntries,
  calculatePayrollAnnualRights, registerPayrollIpc
};
