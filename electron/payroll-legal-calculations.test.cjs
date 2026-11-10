'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { completedYears, calculateVacationSalaryBasis, calculateSeveranceSalaryBasis, calculateAnnualLaborRights, calculateSeverance } = require('./payroll-legal-calculations.cjs');

test('uses three prior months for variable vacation salary and six for variable severance salary', () => {
  const fixedVacation = calculateVacationSalaryBasis({salaryType:'FIXED',lastMonthNormalSalary:3000});
  assert.equal(fixedVacation.monthlySalary,3000);
  assert.equal(fixedVacation.dailySalary,100);
  const variableVacation = calculateVacationSalaryBasis({
    salaryType:'VARIABLE',previousThreeMonthsNormalSalary:[3000,3300,3600]
  });
  assert.equal(variableVacation.monthlySalary,3300);
  assert.equal(variableVacation.dailySalary,110);
  assert.equal(variableVacation.monthsAveraged,3);
  assert.throws(() => calculateVacationSalaryBasis({
    salaryType:'VARIABLE',previousThreeMonthsNormalSalary:[3000,3300]
  }), /tres meses/);

  const fixedSeverance = calculateSeveranceSalaryBasis({salaryType:'FIXED',lastMonthlyIntegratedSalary:4500});
  assert.equal(fixedSeverance.dailySalary,150);
  const variableSeverance = calculateSeveranceSalaryBasis({
    salaryType:'VARIABLE',previousSixMonthsIntegratedSalary:[4200,4300,4400,4500,4600,4800]
  });
  assert.equal(variableSeverance.monthlySalary,4466.67);
  assert.equal(variableSeverance.dailySalary,148.89);
  assert.equal(variableSeverance.monthsAveraged,6);
  assert.throws(() => calculateSeveranceSalaryBasis({
    salaryType:'VARIABLE',previousSixMonthsIntegratedSalary:[4200,4300,4400,4500,4600]
  }), /seis meses/);
});

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
  const result = calculateSeverance({
    hireDate:'2022-01-01',asOfDate:'2026-01-01',dailyIntegralSalary:100,
    quarterlyDeposits:Array.from({length:16},()=>({days:15,dailyIntegralSalary:100})),
    additionalSeniorityDeposits:Array.from({length:3},()=>({days:2,dailyIntegralSalary:100}))
  });
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
test('applies five days per month or fraction only before the three-calendar-month anniversary', () => {
  const partial = calculateSeverance({hireDate:'2026-01-31',asOfDate:'2026-04-29',dailyIntegralSalary:100,quarterlyDeposits:[],additionalSeniorityDeposits:[]});
  assert.equal(partial.completedMonths,2);
  assert.equal(partial.terminationDays,15);
  assert.equal(partial.terminationAmount,1500);
  const exact = calculateSeverance({hireDate:'2026-01-31',asOfDate:'2026-04-30',dailyIntegralSalary:100,quarterlyDeposits:[{days:15,dailyIntegralSalary:100}],additionalSeniorityDeposits:[]});
  assert.equal(exact.completedMonths,3);
  assert.equal(exact.quarterlyGuaranteeDays,15);
  assert.equal(exact.terminationDays,0);
  assert.equal(exact.greaterAmount,1500);
});
test('values each historical quarterly and seniority deposit with its own integral salary', () => {
  const result = calculateSeverance({
    hireDate:'2024-01-01',asOfDate:'2026-01-01',dailyIntegralSalary:200,
    quarterlyDeposits:[
      {days:15,dailyIntegralSalary:100},{days:15,dailyIntegralSalary:110},
      {days:15,dailyIntegralSalary:120},{days:15,dailyIntegralSalary:130},
      {days:15,dailyIntegralSalary:140},{days:15,dailyIntegralSalary:150},
      {days:15,dailyIntegralSalary:160},{days:15,dailyIntegralSalary:170}
    ],
    additionalSeniorityDeposits:[{days:2,dailyIntegralSalary:115}]
  });
  assert.equal(result.quarterlyGuaranteeDays,120);
  assert.equal(result.additionalSeniorityDays,2);
  assert.equal(result.guaranteeAmount,16430);
  assert.equal(result.terminationAmount,12000);
  assert.equal(result.greaterBasis,'GUARANTEE');
});

test('requires historical salary bases instead of revaluing all old deposits at current salary', () => {
  assert.throws(() => calculateSeverance({
    hireDate:'2022-01-01',asOfDate:'2026-01-01',dailyIntegralSalary:100
  }), /historial de depósitos trimestrales/);
});

test('counts a service fraction strictly greater than six months in the termination comparison', () => {
  const exactSix = calculateSeverance({hireDate:'2025-01-31',asOfDate:'2025-07-31',dailyIntegralSalary:100,quarterlyDeposits:Array.from({length:2},()=>({days:15,dailyIntegralSalary:100})),additionalSeniorityDeposits:[]});
  assert.equal(exactSix.terminationDays,0);
  const overSix = calculateSeverance({hireDate:'2025-01-31',asOfDate:'2025-08-01',dailyIntegralSalary:100,quarterlyDeposits:Array.from({length:2},()=>({days:15,dailyIntegralSalary:100})),additionalSeniorityDeposits:[]});
  assert.equal(overSix.terminationDays,30);
  const oneYearAndSixMonths = calculateSeverance({hireDate:'2024-01-31',asOfDate:'2025-07-31',dailyIntegralSalary:100,quarterlyDeposits:Array.from({length:6},()=>({days:15,dailyIntegralSalary:100})),additionalSeniorityDeposits:[{days:2,dailyIntegralSalary:100}]});
  assert.equal(oneYearAndSixMonths.terminationDays,30);
  const oneYearAndMoreThanSix = calculateSeverance({hireDate:'2024-01-31',asOfDate:'2025-08-01',dailyIntegralSalary:100,quarterlyDeposits:Array.from({length:6},()=>({days:15,dailyIntegralSalary:100})),additionalSeniorityDeposits:[{days:2,dailyIntegralSalary:100}]});
  assert.equal(oneYearAndMoreThanSix.terminationDays,60);
});

test('uses clamped calendar anniversaries for month-end and leap-day service', () => {
  assert.equal(completedYears('2024-02-29','2025-02-27'),0);
  assert.equal(completedYears('2024-02-29','2025-02-28'),1);
  const result = calculateSeverance({hireDate:'2026-01-31',asOfDate:'2026-04-30',dailyIntegralSalary:100,quarterlyDeposits:[{days:15,dailyIntegralSalary:100}],additionalSeniorityDeposits:[]});
  assert.equal(result.completedMonths,3);
});
