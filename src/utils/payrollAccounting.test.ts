import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollJournalItems } from './payrollAccounting';

const accounts = [
  { code: '6.1.1.01', name: 'Sueldos y salarios', type: 'GASTOS', isMovement: true },
  { code: '6.1.1.12', name: 'Aportes patronales', type: 'GASTOS', isMovement: true },
  { code: '2.1.3.01', name: 'Sueldos por pagar', type: 'PASIVO', isMovement: true },
  { code: '2.1.3.03', name: 'Aportes por enterar', type: 'PASIVO', isMovement: true },
  { code: '2.1.3.04', name: 'Otras deducciones', type: 'PASIVO', isMovement: true }
];

test('builds a balanced dual-currency payroll journal with dedicated expense and liability accounts', () => {
  const items = buildPayrollJournalItems({
    grossEarnings: 1000, workerLegalDeductions: 40, otherDeductions: 20,
    employerContributions: 90, netPay: 940
  }, accounts, 36.5);
  const sum = (key: 'debitBs'|'creditBs'|'debitUsd'|'creditUsd') =>
    Math.round(items.reduce((total, item) => total + item[key], 0) * 100) / 100;
  assert.equal(sum('debitBs'), 1090);
  assert.equal(sum('creditBs'), 1090);
  assert.equal(sum('debitUsd'), sum('creditUsd'));
  assert.equal(items.find(item => item.accountCode === '6.1.1.12')?.debitBs, 90);
  assert.equal(items.find(item => item.accountCode === '2.1.3.04')?.creditBs, 20);
});

test('rejects payroll posting when a required chart account is unavailable', () => {
  assert.throws(() => buildPayrollJournalItems({
    grossEarnings: 1000, workerLegalDeductions: 40, otherDeductions: 20,
    employerContributions: 90, netPay: 940
  }, accounts.filter(account => account.code !== '6.1.1.12'), 36.5), /6.1.1.12/);
});

test('rejects inconsistent totals and invalid exchange rates', () => {
  assert.throws(() => buildPayrollJournalItems({
    grossEarnings: 1000, workerLegalDeductions: 40, otherDeductions: 20,
    employerContributions: 90, netPay: 900
  }, accounts, 36.5), /no cuadra en bolívares/);
  assert.throws(() => buildPayrollJournalItems({
    grossEarnings: 1000, workerLegalDeductions: 40, otherDeductions: 20,
    employerContributions: 90, netPay: 940
  }, accounts, 0), /tasa BCV/);
});
