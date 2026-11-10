import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePayroll, type PayrollLegalRule } from './payroll';

const validRule: PayrollLegalRule = {
  code: 'TEST-01',
  description: 'Regla de prueba',
  base: 'normalSalary',
  workerRate: 0.04,
  employerRate: 0.09,
  baseCap: 1000,
  effectiveFrom: '2026-01-01',
  sourceReference: 'Fuente normativa de prueba; no usar como tasa legal',
  verifiedAt: '2026-01-01'
};

const input = {
  periodEnd: '2026-06-30',
  earnings: [{ code: 'SAL', description: 'Salario del período', amount: 1200, isSalary: true }],
  bases: { normalSalary: 1200, integralSalary: 1300, grossSalary: 1200 },
  rules: [validRule]
};

test('calcula deducción y aporte patronal sobre la base topada', () => {
  const result = calculatePayroll(input);
  assert.equal(result.grossEarnings, 1200);
  assert.equal(result.contributions[0].base, 1000);
  assert.equal(result.workerLegalDeductions, 40);
  assert.equal(result.employerContributions, 90);
  assert.equal(result.netPay, 1160);
  assert.equal(result.totalEmployerCost, 1290);
});

test('rechaza reglas sin fuente normativa identificada', () => {
  assert.throws(() => calculatePayroll({ ...input, rules: [{ ...validRule, sourceReference: ' ' }] }), /fuente o fechas/);
});

test('rechaza reglas fuera de vigencia', () => {
  assert.throws(() => calculatePayroll({ ...input, periodEnd: '2025-12-31' }), /no está vigente/);
});

test('rechaza porcentajes inválidos en vez de producir importes silenciosamente', () => {
  assert.throws(() => calculatePayroll({ ...input, rules: [{ ...validRule, workerRate: 4 }] }), /no es válida/);
});

test('rechaza deducciones superiores al salario', () => {
  assert.throws(() => calculatePayroll({
    ...input,
    deductions: [{ code: 'OTRA', description: 'Deducción', amount: 2000 }]
  }), /superan las asignaciones/);
});

test('redondea importes monetarios a dos decimales', () => {
  const result = calculatePayroll({
    ...input,
    bases: { normalSalary: 333.33, integralSalary: 333.33, grossSalary: 333.33 },
    earnings: [{ code: 'SAL', description: 'Salario', amount: 333.33, isSalary: true }],
    rules: [{ ...validRule, baseCap: undefined, workerRate: 0.1, employerRate: 0 }]
  });
  assert.equal(result.workerLegalDeductions, 33.33);
  assert.equal(result.netPay, 300);
});
