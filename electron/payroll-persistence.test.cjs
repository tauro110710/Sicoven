'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const {
  listPayrollEmployees, savePayrollEmployee, listPayrollLegalRules, savePayrollLegalRule,
  registerPayrollIpc
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
