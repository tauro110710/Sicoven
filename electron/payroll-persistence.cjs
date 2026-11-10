'use strict';

const crypto = require('node:crypto');

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
  if (baseSalary <= 0) throw new Error('El salario base debe ser mayor que cero.');
  const active = input.active === false ? 0 : 1;
  const existing = db.prepare('SELECT id FROM payroll_employees WHERE id=? AND company_id=?').get(id, companyId);
  const fiscalDuplicate = db.prepare('SELECT id FROM payroll_employees WHERE company_id=? AND fiscal_id=? AND id<>?').get(companyId, fiscalId, id);
  if (fiscalDuplicate) throw new Error('Ya existe un trabajador con esa cédula/RIF en la empresa activa.');
  if (input.id && !existing) throw new Error('El trabajador no existe en la empresa activa.');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO payroll_employees
    (id,company_id,fiscal_id,full_name,hire_date,position,cost_center,frequency,base_salary,active,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET fiscal_id=excluded.fiscal_id,full_name=excluded.full_name,
    hire_date=excluded.hire_date,position=excluded.position,cost_center=excluded.cost_center,
    frequency=excluded.frequency,base_salary=excluded.base_salary,active=excluded.active,updated_at=excluded.updated_at`)
    .run(id, companyId, fiscalId, fullName, hireDate, position, costCenter, frequency, baseSalary, active,
      existing ? now : now, now);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run(existing ? 'payroll_employee_updated' : 'payroll_employee_created',
      JSON.stringify({ employeeId: id, companyId, fiscalId, fullName }));
  return listPayrollEmployees(db, companyId).find(item => item.id === id);
}
function listPayrollLegalRules(db, companyId) {
  ensureCompany(db, companyId);
  return db.prepare(`SELECT id,company_id AS companyId,code,description,base_key AS base,
    worker_rate AS workerRate,employer_rate AS employerRate,base_cap AS baseCap,
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
  db.prepare(`INSERT INTO payroll_legal_rules
    (id,company_id,code,description,base_key,worker_rate,employer_rate,base_cap,effective_from,effective_to,
     source_reference,verified_at,applicability_json,active)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET description=excluded.description,base_key=excluded.base_key,
    worker_rate=excluded.worker_rate,employer_rate=excluded.employer_rate,base_cap=excluded.base_cap,
    effective_from=excluded.effective_from,effective_to=excluded.effective_to,
    source_reference=excluded.source_reference,verified_at=excluded.verified_at,
    applicability_json=excluded.applicability_json,active=excluded.active`)
    .run(id, companyId, code, description, base, workerRate, employerRate, baseCap, effectiveFrom,
      effectiveTo, sourceReference, verifiedAt, applicability, active);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run(existing ? 'payroll_legal_rule_updated' : 'payroll_legal_rule_created',
      JSON.stringify({ ruleId: id, companyId, code, effectiveFrom, effectiveTo, sourceReference }));
  return listPayrollLegalRules(db, companyId).find(item => item.id === id);
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
  ipcMain.handle('sicoven:payroll-employees-list', (_event, token) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollEmployees(db, companyId));
  });
  ipcMain.handle('sicoven:payroll-employee-save', (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => savePayrollEmployee(db, companyId, input));
  });
  ipcMain.handle('sicoven:payroll-rules-list', (_event, token) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => listPayrollLegalRules(db, companyId));
  });
  ipcMain.handle('sicoven:payroll-rule-save', (_event, token, input) => {
    authenticate(token);
    return withDatabase(token, (db, companyId) => savePayrollLegalRule(db, companyId, input));
  });
}
module.exports = {
  listPayrollEmployees, savePayrollEmployee, listPayrollLegalRules, savePayrollLegalRule,
  registerPayrollIpc
};
