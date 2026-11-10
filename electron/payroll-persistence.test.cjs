'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const {
  listPayrollEmployees, listPayrollSalaryHistory, getPayrollSalaryForDate, savePayrollEmployee, listPayrollLegalRules, savePayrollLegalRule,
  registerPayrollIpc, createPayrollRun, listPayrollRuns, getPayrollRun, confirmPayrollRun, listConfirmedSalaryEntries, calculatePayrollAnnualRights
} = require('./payroll-persistence.cjs');

function setup() {
  const db = new Database(':memory:');
  initializeTenantDatabase(db);
  db.prepare("INSERT INTO app_state(state_key,state_json) VALUES('accounting',?)")
    .run(JSON.stringify({ companies: [{ id: 'co-a', accountingBcvRateHistory: [
      { id: 'bcv-test-2026-07-15', rate: 100, effectiveDate: '2026-07-15',
        fetchedAt: '2026-07-15T00:00:00.000Z', source: 'BCV test fixture', provider: 'manual', mode: 'MANUAL' }
    ] }] }));
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

test('preserves effective-dated salary history when a worker salary changes', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-321', fullName: 'Elena Mora', hireDate: '2024-03-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const first = listPayrollSalaryHistory(db, 'co-a', employee.id);
    assert.equal(first.length, 1);
    assert.equal(first[0].effectiveFrom, '2024-03-01');
    assert.equal(first[0].baseSalary, 1200);
    savePayrollEmployee(db, 'co-a', { ...employee, baseSalary: 1500, salaryEffectiveFrom: '2026-01-01' });
    const history = listPayrollSalaryHistory(db, 'co-a', employee.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].effectiveFrom, '2026-01-01');
    assert.equal(history[0].baseSalary, 1500);
    assert.equal(history[0].source, 'SALARY_CHANGE');
    assert.equal(history[1].effectiveTo, '2025-12-31');
    assert.equal(history[1].baseSalary, 1200);
    assert.equal(getPayrollSalaryForDate(db, 'co-a', employee.id, '2025-06-30').baseSalary, 1200);
    assert.equal(getPayrollSalaryForDate(db, 'co-a', employee.id, '2026-03-01').baseSalary, 1500);
    assert.throws(() => getPayrollSalaryForDate(db, 'co-b', employee.id, '2026-03-01'), /empresa activa/);
    assert.throws(() => savePayrollEmployee(db, 'co-a', { ...employee, baseSalary: 1600, salaryEffectiveFrom: '2025-12-01' }), /posterior al último cambio/);
    assert.equal(listPayrollSalaryHistory(db, 'co-a', employee.id).length, 2);
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
    const snapshot = JSON.parse(saved.calculation_snapshot_json);
    assert.equal(snapshot.employees[0].salaryRecord.baseSalary, 1200);
    assert.equal(snapshot.employees[0].salaryRecord.effectiveFrom, '2024-05-01');
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

test('calculates annual LOTTT rights for the selected worker using fixed or three-month variable salary', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-111', fullName: 'Ana Rojas', hireDate: '2024-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1500
    });
    const fixed = calculatePayrollAnnualRights(db, 'co-a', {
      employeeId: employee.id, asOfDate: '2026-01-01',
      salaryType: 'FIXED', lastMonthNormalSalary: 3000,
      fiscalYearStart: '2026-01-01'
    });
    assert.equal(fixed.salaryBasis.dailySalary, 100);
    assert.equal(fixed.completedYears, 2);
    assert.equal(fixed.vacationDays, 16);
    assert.equal(fixed.vacationPay, 1600);
    assert.equal(fixed.vacationBonus, 1600);
    const variable = calculatePayrollAnnualRights(db, 'co-a', {
      employeeId: employee.id, asOfDate: '2026-01-01',
      salaryType: 'VARIABLE', previousThreeMonthsNormalSalary: [3000, 3300, 3600]
    });
    assert.equal(variable.salaryBasis.monthlySalary, 3300);
    assert.equal(variable.salaryBasis.monthsAveraged, 3);
    assert.throws(() => calculatePayrollAnnualRights(db, 'co-b', {
      employeeId: employee.id, asOfDate: '2026-01-01', salaryType: 'FIXED', lastMonthNormalSalary: 3000
    }), /empresa activa/);
  } finally { db.close(); }
});

test('returns the immutable payroll snapshot only inside the active company', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-845', fullName: 'Rosa Núñez', hireDate: '2025-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1400
    });
    const created = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 700, isSalary: true }],
        bases: {} }]
    });
    const loaded = getPayrollRun(db, 'co-a', created.id);
    assert.equal(loaded.snapshot.employees[0].fullName, 'Rosa Núñez');
    assert.equal(loaded.snapshot.employees[0].netPay, 700);
    assert.equal(loaded.status, 'DRAFT');
    assert.throws(() => getPayrollRun(db, 'co-b', created.id), /empresa activa/);
    assert.throws(() => getPayrollRun(db, 'co-a', 'missing'), /empresa activa/);
  } finally { db.close(); }
});

test('requires only the salary bases used by legal rules effective in the payroll period', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-991', fullName: 'Julia Méndez', hireDate: '2025-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const ordinary = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 500, isSalary: true }],
        bases: {} }]
    });
    assert.equal(ordinary.snapshot.employees[0].bases.normalSalary, 0);
    assert.equal(ordinary.snapshot.employees[0].netPay, 500);

    savePayrollLegalRule(db, 'co-a', {
      code: 'FAOV-TEST', description: 'Regla que utiliza salario integral', base: 'integralSalary',
      workerRate: 0.01, employerRate: 0.02, effectiveFrom: '2026-06-16',
      sourceReference: 'Fuente normativa de prueba', verifiedAt: '2026-06-16'
    });
    const legal = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-16', periodEnd: '2026-06-30',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 500, isSalary: true }],
        bases: { integralSalary: 600 } }]
    });
    assert.equal(legal.snapshot.employees[0].bases.integralSalary, 600);
    assert.equal(legal.snapshot.employees[0].bases.normalSalary, 0);
    assert.equal(legal.snapshot.employees[0].workerLegalDeductions, 6);

    assert.throws(() => createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 500, isSalary: true }],
        bases: {} }]
    }), /requiere una base salarial positiva: integralSalary/);
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

test('scopes legal rules and salary caps independently to weekly and biweekly payrolls', () => {
  const db = setup();
  try {
    const weeklyEmployee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-610', fullName: 'Luis Rivas', hireDate: '2025-01-01',
      frequency: 'WEEKLY', baseSalary: 600
    });
    const biweeklyEmployee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-611', fullName: 'Marta Solís', hireDate: '2025-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    savePayrollLegalRule(db, 'co-a', {
      code: 'IVSS', description: 'IVSS semanal', base: 'normalSalary', frequencyScope: 'WEEKLY',
      workerRate: 0.04, employerRate: 0.09, baseCap: 500,
      effectiveFrom: '2026-01-01', sourceReference: 'Fuente legal semanal', verifiedAt: '2026-01-01'
    });
    savePayrollLegalRule(db, 'co-a', {
      code: 'IVSS', description: 'IVSS quincenal', base: 'normalSalary', frequencyScope: 'BIWEEKLY',
      workerRate: 0.04, employerRate: 0.10, baseCap: 1000,
      effectiveFrom: '2026-01-01', sourceReference: 'Fuente legal quincenal', verifiedAt: '2026-01-01'
    });
    const weekly = createPayrollRun(db, 'co-a', {
      frequency: 'WEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-07',
      employees: [{ employeeId: weeklyEmployee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 600, isSalary: true }],
        bases: { normalSalary: 600 } }]
    });
    const biweekly = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{ employeeId: biweeklyEmployee.id,
        earnings: [{ code: 'SAL', description: 'Salario', amount: 1200, isSalary: true }],
        bases: { normalSalary: 1200 } }]
    });
    assert.equal(weekly.snapshot.employees[0].contributions[0].base, 500);
    assert.equal(weekly.snapshot.employees[0].workerLegalDeductions, 20);
    assert.equal(weekly.snapshot.employees[0].employerContributions, 45);
    assert.equal(biweekly.snapshot.employees[0].contributions[0].base, 1000);
    assert.equal(biweekly.snapshot.employees[0].workerLegalDeductions, 40);
    assert.equal(biweekly.snapshot.employees[0].employerContributions, 100);
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

test('historical salary query reads only confirmed salary earnings for the selected worker and company', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-880', fullName: 'Nora León', hireDate: '2025-01-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-06-01', periodEnd: '2026-06-15',
      employees: [{
        employeeId: employee.id,
        earnings: [
          { code: 'SAL', description: 'Salario base', amount: 600, isSalary: true },
          { code: 'REIMB', description: 'Reembolso', amount: 35, isSalary: false }
        ],
        bases: { normalSalary: 600, integralSalary: 600, grossSalary: 635 }
      }]
    });
    assert.deepEqual(listConfirmedSalaryEntries(db, 'co-a', employee.id, '2026-06-01', '2026-06-30'), []);
    db.prepare("UPDATE payroll_runs SET status='CONFIRMED',confirmed_at=? WHERE id=?")
      .run('2026-06-16T10:00:00.000Z', run.id);
    const entries = listConfirmedSalaryEntries(db, 'co-a', employee.id, '2026-06-01', '2026-06-30');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, 600);
    assert.equal(entries[0].code, 'SAL');
    assert.equal(entries[0].runId, run.id);
    assert.throws(() => listConfirmedSalaryEntries(db, 'co-b', employee.id, '2026-06-01', '2026-06-30'), /empresa activa/);
    assert.throws(() => listConfirmedSalaryEntries(db, 'co-a', employee.id, '2026-07-01', '2026-06-30'), /rango de consulta/);
  } finally { db.close(); }
});

test('confirms a payroll run once with its accounting entry and is safe to retry', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-881', fullName: 'Luis Rojas', hireDate: '2025-02-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{
        employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario base', amount: 600, isSalary: true }],
        bases: { normalSalary: 600, integralSalary: 600, grossSalary: 600 }
      }]
    });
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, 'journal-123'), /No existe en la contabilidad/);
    const journal = {
      id: 'journal-123', companyId: 'co-a', referenceDoc: 'NOM-' + run.id,
      date: '2026-07-15', bcvRate: 100, items: [
        { accountCode: '6.1.1.01', debitBs: 600, creditBs: 0, debitUsd: 6, creditUsd: 0 },
        { accountCode: '2.1.3.01', debitBs: 0, creditBs: 600, debitUsd: 0, creditUsd: 6 }
      ]
    };
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
      .run(JSON.stringify({ companies: [{ id: 'co-a', accountingBcvRateHistory: [
        { id: 'bcv-test-2026-07-15', rate: 100, effectiveDate: '2026-07-15',
          fetchedAt: '2026-07-15T00:00:00.000Z', source: 'BCV test fixture', provider: 'manual', mode: 'MANUAL' }
      ] }], journalEntries: [journal] }));
    const confirmed = confirmPayrollRun(db, 'co-a', run.id, 'journal-123');
    assert.equal(confirmed.status, 'CONFIRMED');
    assert.equal(confirmed.journalEntryId, 'journal-123');
    assert.equal(confirmed.alreadyConfirmed, false);
    const retry = confirmPayrollRun(db, 'co-a', run.id, 'journal-123');
    assert.equal(retry.alreadyConfirmed, true);
    assert.equal(retry.journalEntryId, 'journal-123');
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, 'journal-other'), /otro asiento/);
    assert.throws(() => confirmPayrollRun(db, 'co-b', run.id, 'journal-123'), /empresa activa/);
    assert.equal(listPayrollRuns(db, 'co-a').find(item => item.id === run.id).status, 'CONFIRMED');
    assert.equal(listConfirmedSalaryEntries(db, 'co-a', employee.id, '2026-07-01', '2026-07-31').length, 1);
  } finally { db.close(); }
});


test('does not substitute the inventory BCV history for the accounting BCV history', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-884', fullName: 'Elena Mora', hireDate: '2025-02-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario base', amount: 600, isSalary: true }],
        bases: {} }]
    });
    const journal = {
      id: 'journal-inventory-rate-only', companyId: 'co-a', referenceDoc: 'NOM-' + run.id,
      date: '2026-07-15', bcvRate: 100, items: [
        { accountCode: '6.1.1.01', debitBs: 600, creditBs: 0, debitUsd: 6, creditUsd: 0 },
        { accountCode: '2.1.3.01', debitBs: 0, creditBs: 600, debitUsd: 0, creditUsd: 6 }
      ]
    };
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
      .run(JSON.stringify({ companies: [{ id: 'co-a', inventoryBcvRateHistory: [
        { id: 'inventory-only', rate: 100, effectiveDate: '2026-07-15' }
      ] }], journalEntries: [journal] }));
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, journal.id), /tasa BCV histórica guardada/);
  } finally { db.close(); }
});

test('refuses a balanced journal whose amounts do not match the payroll snapshot', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-883', fullName: 'Mario Gil', hireDate: '2025-02-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{ employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario base', amount: 600, isSalary: true }],
        bases: {} }]
    });
    const journal = {
      id: 'journal-wrong-amount', companyId: 'co-a', referenceDoc: 'NOM-' + run.id,
      date: '2026-07-15', bcvRate: 100, items: [
        { accountCode: '6.1.1.01', debitBs: 610, creditBs: 0, debitUsd: 6.1, creditUsd: 0 },
        { accountCode: '2.1.3.01', debitBs: 0, creditBs: 610, debitUsd: 0, creditUsd: 6.1 }
      ]
    };
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
      .run(JSON.stringify({ companies: [{ id: 'co-a', accountingBcvRateHistory: [
        { id: 'bcv-test-2026-07-15', rate: 100, effectiveDate: '2026-07-15',
          recordedAt: '2026-07-15T00:00:00.000Z', source: 'LEGACY' }
      ] }], journalEntries: [journal] }));
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, journal.id), /no coinciden con los totales/);
    assert.equal(listPayrollRuns(db, 'co-a').find(item => item.id === run.id).status, 'DRAFT');
  } finally { db.close(); }
});

test('refuses to confirm a payroll with an unbalanced or wrong-date journal', () => {
  const db = setup();
  try {
    const employee = savePayrollEmployee(db, 'co-a', {
      fiscalId: 'V-882', fullName: 'Ana Rivas', hireDate: '2025-02-01',
      frequency: 'BIWEEKLY', baseSalary: 1200
    });
    const run = createPayrollRun(db, 'co-a', {
      frequency: 'BIWEEKLY', periodStart: '2026-07-01', periodEnd: '2026-07-15',
      employees: [{
        employeeId: employee.id,
        earnings: [{ code: 'SAL', description: 'Salario base', amount: 600, isSalary: true }],
        bases: { normalSalary: 600, integralSalary: 600, grossSalary: 600 }
      }]
    });
    const journal = {
      id: 'journal-invalid', companyId: 'co-a', referenceDoc: 'NOM-' + run.id,
      date: '2026-07-15', bcvRate: 100, items: [
        { accountCode: '6.1.1.01', debitBs: 600, creditBs: 0, debitUsd: 6, creditUsd: 0 },
        { accountCode: '2.1.3.01', debitBs: 0, creditBs: 590, debitUsd: 0, creditUsd: 5.9 }
      ]
    };
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
      .run(JSON.stringify({ companies: [{ id: 'co-a', accountingBcvRateHistory: [
        { id: 'bcv-test-2026-07-15', rate: 100, effectiveDate: '2026-07-15',
          fetchedAt: '2026-07-15T00:00:00.000Z', source: 'BCV test fixture', provider: 'manual', mode: 'MANUAL' }
      ] }], journalEntries: [journal] }));
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, 'journal-invalid'), /debe estar cuadrado/);
    assert.equal(listPayrollRuns(db, 'co-a').find(item => item.id === run.id).status, 'DRAFT');
    journal.items[1].creditBs = 600;
    journal.items[1].creditUsd = 6;
    journal.date = '2026-07-14';
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
      .run(JSON.stringify({ companies: [{ id: 'co-a', accountingBcvRateHistory: [
        { id: 'bcv-test-2026-07-15', rate: 100, effectiveDate: '2026-07-15',
          fetchedAt: '2026-07-15T00:00:00.000Z', source: 'BCV test fixture', provider: 'manual', mode: 'MANUAL' }
      ] }], journalEntries: [journal] }));
    assert.throws(() => confirmPayrollRun(db, 'co-a', run.id, 'journal-invalid'), /fecha, tasa BCV/);
    assert.equal(listPayrollRuns(db, 'co-a').find(item => item.id === run.id).status, 'DRAFT');
  } finally { db.close(); }
});
