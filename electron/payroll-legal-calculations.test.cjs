'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { completedYears, calculateAnnualLaborRights, calculateSeverance } = require('./payroll-legal-calculations.cjs');

test('calculates vacation and vacation bonus days by completed service years', () => {
  assert.equal(completedYears('2024-05-15','2025-05-14'),0);
  assert.equal(completedYears('2024-05-15','2025-05-15'),1);
  assert.equal(calculateAnnualLaborRights({hireDate:'2024-05-15',asOfDate:'2025-05-15',dailyNormalSalary:100}).vacationDays,15);
  assert.equal(calculateAnnualLaborRights({hireDate:'2020-01-01',asOfDate:'2026-01-01',dailyNormalSalary:100}).vacationDays,20);
  assert.equal(calculateAnnualLaborRights({hireDate:'2000-01-01',asOfDate:'2026-01-01',dailyNormalSalary:100}).vacationBonusDays,30);
});

test('returns the LOTTT minimum annual profit-sharing floor and upper statutory limit', () => {
  const result = calculateAnnualLaborRights({hireDate:'2024-01-01',asOfDate:'2025-12-31',dailyNormalSalary:100});
  assert.equal(result.profitSharingMinimumDays,30);
  assert.equal(result.profitSharingMinimum,3000);
  assert.equal(result.profitSharingMaximumDays,120);
  assert.equal(result.profitSharingMaximum,12000);
});

test('compares severance guarantee against termination calculation', () => {
  const result = calculateSeverance({hireDate:'2022-01-01',asOfDate:'2026-01-01',dailyIntegralSalary:100});
  assert.equal(result.completedYears,4);
  assert.equal(result.quarterlyGuaranteeDays,240);
  assert.equal(result.additionalSeniorityDays,6);
  assert.equal(result.guaranteeAmount,24600);
  assert.equal(result.terminationDays,120);
  assert.equal(result.greaterBasis,'GUARANTEE');
});

test('rejects invalid dates, negative salaries and a cutoff before hiring', () => {
  assert.throws(()=>completedYears('2024-02-30','2025-01-01'),/no es válida/);
  assert.throws(()=>calculateAnnualLaborRights({hireDate:'2024-01-01',asOfDate:'2025-01-01',dailyNormalSalary:-1}),/no negativo/);
  assert.throws(()=>calculateSeverance({hireDate:'2025-01-01',asOfDate:'2024-12-31',dailyIntegralSalary:100}),/anterior al ingreso/);
});

test('prorates annual profit-sharing floor by full calendar months in the fiscal year', () => {
  const result = calculateAnnualLaborRights({
    hireDate:'2025-07-15', fiscalYearStart:'2025-01-01', asOfDate:'2025-12-31', dailyNormalSalary:120
  });
  assert.equal(result.monthsInFiscalYear,5);
  assert.equal(result.profitSharingMinimumDays,12.5);
  assert.equal(result.profitSharingMinimum,1500);
});
test('applies five days per month or fraction for service shorter than three months', () => {
  const result = calculateSeverance({hireDate:'2026-01-15',asOfDate:'2026-03-20',dailyIntegralSalary:100});
  assert.equal(result.terminationDays,15);
  assert.equal(result.terminationAmount,1500);
});
