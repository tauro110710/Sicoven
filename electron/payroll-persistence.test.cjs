'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const {
  listPayrollEmployees, savePayrollEmployee, listPayrollLegalRules, savePayrollLegalRule,
  registerPayrollIpc, createPayrollRun, listPayrollRuns
} = require('./payroll-persistence.cjs');

function setup() {
  const db = new Database(':memory:');
  initializeTenantDatabase(db);
  db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
    .run(JSON.stringify({ companies: [{ id: 'co-a' }] }));
  return db;
}

test('saves and lists employee records scoped to the active company tenant', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'v-123', fullName: 'Pedro Pérez', hireDate: '2024-01-01',
      position: 'Vendedor', frequency: 'BIWEEKLY', baseSalary: 1500
    });
    assert.equal(employee.companyId, 'co-a');
    assert.equal(employee.fiscalId, 'V-123');
    assert.equal(listPayrollEmployees(db, 'co-a').length, 1);
    assert.throws(() => savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-123', fullName: 'Duplicado', hireDate: '2024-01-01',
      frequency: 'WEEKLY', baseSalary: 100
    }), /Ya existe un trabajador/);
    assert.throws(() => listPayrollEmployees(db, 'co-b'), /empresa activa/);
  } finally { db.close(); }
});

test('updates an existing worker without allowing cross-company IDs', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-123', fullName: 'Pedro Pérez', hireDate: '2024-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1500
    });
    const updated = savePayrollEmployee(db, 'co-a', { ...employee, fullName: 'Pedro A. Pérez', baseSalary: 1800 });
    assert.equal(updated.fullName, 'Pedro A. Pérez');
    assert.equal(updated.baseSalary, 1800);
    assert.throws(() => savePayrollEmployee(db, 'co-b', { ...employee, fullName: 'Intento' }), /empresa activa/);
  } finally { db.close(); }
});

test('stores only legal rules with source and effective dates', () => {
  const db = setup();
  try {
    const rule = savePayrollLegalRule(db, 'co-a', {
      code: 'FAOV', description: 'Regla FAOV parametrizada', base: 'integralSalary',
      workerRate: 0.01, employerRate: 0.02, effectiveFrom: '2026-01-01',
      sourceReference: 'Gaceta por verificar', verifiedAt: '2026-01-01'
    });
    assert.equal(rule.code, 'FAOV');
    assert.equal(listPayrollLegalRules(db, 'co-a').length, 1);
    assert.throws(() => savePayrollLegalRule(db, 'co-a', {
      code: 'BAD', description: 'Sin fuente', base: 'grossSalary',
      workerRate: 0, employerRate: 0, effectiveFrom: '2026-01-01',
      sourceReference: '', verifiedAt: '2026-01-01'
    }), /Fuente normativa/);
  } finally { db.close(); }
});

test('IPC requires an active session and scopes every request to its active tenant', async () => {
  const db = setup();
  try {
    const handlers = new Map();
    registerPayrollIpc({
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      getActiveSession: token => token === 'valid' ? { username: 'contador' } : null,
      withDatabase: async (token, operation) => operation(db, 'co-a')
    });
    const list = handlers.get('sicoven:payroll-employees-list');
    const save = handlers.get('sicoven:payroll-employee-save');
    await assert.rejects(() => list({}, 'expired'), /sesión expiró/);
    const result = await save({}, 'valid', {
      fiscalId: 'V-456', fullName: 'Ana Gómez', hireDate: '2025-01-01',
      frequency: 'WEEKLY', baseSalary: 900
    });
    assert.equal(result.companyId, 'co-a');
  } finally { db.close(); }
});

test('creates an immutable draft payroll snapshot and prevents duplicate periods', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-789', fullName: 'Luis Rojas', hireDate: '2024-05-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    savePayrollLegalRule(db, 'co-a', {
      code: 'RULE-TEST', description: 'Regla de prueba', base: 'normalSalary',
      workerRate: 0.01, employerRate: 0.02, effectiveFrom: '2026-01-01',
      sourceReference: 'Norma de prueba', verifiedAt: '2026-01-01'
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{
        employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 1000, isSalary: true }],
        deductions: [{ code: 'ADV', description: 'Anticipo', amount: 50 }],
        bases: { normalSalary: 1000, integralSalary: 1100, grossSalary: 1000 }
      }]
    });
    assert.equal(run.status, 'DRAFT');
    assert.equal(run.totals.netPay, 940);
    assert.equal(listPayrollRuns(db, 'co-a').length, 1);
    const saved = db.prepare('SELECT calculation_snapshot_json FROM payroll_runs WHERE id=?').get(run.id);
    assert.match(saved.calculation_snapshot_json, /RULE-TEST/);
    assert.throws(() => createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{ employeeId: employee.id, earnings: [{code:'SAL',description:'Salario',amount:1000}], bases:{normalSalary:1000,integralSalary:1000,grossSalary:1000} }]
    }), /Ya existe una nómina BIWEEKLY/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM payroll_runs').get().count, 1);
    assert.throws(() => createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-10', periodEnd: '2026-06-25',
      employees: [{ employeeId: employee.id, earnings: [{code:'SAL',description:'Salario',amount:1000}], bases:{normalSalary:1000,integralSalary:1000,grossSalary:1000} }]
    }), /se cruza con 2026-06-01 al 2026-06-15/);
    const nextPeriod = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-16', periodEnd: '2026-06-30',
      employees: [{ employeeId: employee.id, earnings: [{code:'SAL',description:'Salario',amount:1000}], bases:{normalSalary:1000,integralSalary:1000,grossSalary:1000} }]
    });
    assert.equal(nextPeriod.status, 'DRAFT');
    const weeklyEmployee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-790', fullName: 'Carla Suárez', hireDate: '2024-05-01',
      frequency: 'WEEKLY', baseSalary: 600
    });
    const weekly = createPayrollRun(db, 'co-a', {
      frequency: 'WEEKLY', periodStart: '2026-06-10', periodEnd: '2026-06-16',
      employees: [{ employeeId: weeklyEmployee.id, earnings: [{code:'SAL',description:'Salario',amount:500}], bases:{normalSalary:500,integralSalary:500,grossSalary:500} }]
    });
    assert.equal(weekly.status, 'DRAFT');
  } finally { db.close(); }
});

test('rejects payroll runs that mix company employees or mismatched frequencies', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-999', fullName: 'Marta Gil', hireDate: '2025-01-01',
      frequency: 'WEEKLY', baseSalary: 500
    });
    assert.throws(() => createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{ employeeId: employee.id, earnings: [{code:'SAL',description:'Salario',amount:500}], bases:{normalSalary:500,integralSalary:500,grossSalary:500} }]
    }), /no coincide/);
  } finally { db.close(); }
});

test('rejects overlapping effective periods for versions of the same legal rule', () => {
  const db = setup();
  try {
    savePayrollLegalRule(db, 'co-a', {
      code:'IVSS', description:'IVSS vigente', base:'normalSalary',
      workerRate:0.04, employerRate:0.09, effectiveFrom:'2026-01-01',
      effectiveTo:'2026-12-31', sourceReference:'Fuente normativa', verifiedAt:'2026-01-01'
    });
    assert.throws(() => savePayrollLegalRule(db, 'co-a', {
      code:'IVSS', description:'IVSS duplicado', base:'normalSalary',
      workerRate:0.04, employerRate:0.10, effectiveFrom:'2026-06-01',
      effectiveTo:null, sourceReference:'Fuente normativa', verifiedAt:'2026-06-01'
    }), /se solapa/);
  } finally { db.close(); }
});

test('does not silently apply a legal rule with unconfigured applicability conditions', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId:'V-202', fullName:'Rosa Díaz', hireDate:'2024-01-01',
      frequency:'BIWEEKLY', baseSalary:1000
    });
    savePayrollLegalRule(db, 'co-a', {
      code:'IVSS', description:'IVSS según riesgo', base:'normalSalary',
      workerRate:0.04, employerRate:0.09, effectiveFrom:'2026-01-01',
      sourceReference:'Fuente normativa', verifiedAt:'2026-01-01',
      applicability:{ employerRiskClass:'LOW' }
    });
    assert.throws(() => createPayrollRun(db, 'co-a', {
      frequency:'BIWEEKLY', periodStart:'2026-06-01', periodEnd:'2026-06-15',
      employees:[{ employeeId:employee.id, earnings:[{code:'SAL',description:'Salario',amount:500,isSalary:true}],
        bases:{normalSalary:500,integralSalary:500,grossSalary:500} }]
    }), /condiciones de empresa o trabajador/);
  } finally { db.close(); }
});
