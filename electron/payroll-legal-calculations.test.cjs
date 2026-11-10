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
    additionalSeniorityDeposits:Array.from({length:4},()=>({days:2,dailyIntegralSalary:100}))
  });
  assert.equal(result.completedYears,4);
  assert.equal(result.quarterlyGuaranteeDays,240);
  assert.equal(result.additionalSeniorityDays,8);
  assert.equal(result.guaranteeAmount,24800);
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
    additionalSeniorityDeposits:[{days:2,dailyIntegralSalary:115},{days:2,dailyIntegralSalary:125}]
  });
  assert.equal(result.quarterlyGuaranteeDays,120);
  assert.equal(result.additionalSeniorityDays,4);
  assert.equal(result.guaranteeAmount,16680);
  assert.equal(result.terminationAmount,12000);
  assert.equal(result.greaterBasis,'GUARANTEE');
});



test('rejects missing, duplicated or non-fifteen-day quarterly deposits', () => {
  const input={hireDate:'2025-01-01',asOfDate:'2025-07-01',dailyIntegralSalary:100,
    additionalSeniorityDeposits:[],quarterlyDeposits:[{days:15,dailyIntegralSalary:100},{days:15,dailyIntegralSalary:100}]};
  assert.equal(calculateSeverance(input).quarterlyGuaranteeDays,30);
  assert.throws(()=>calculateSeverance({...input,quarterlyDeposits:[...input.quarterlyDeposits,{days:15,dailyIntegralSalary:100}]}),/duplicados/);
  assert.throws(()=>calculateSeverance({...input,quarterlyDeposits:[{days:10,dailyIntegralSalary:100},{days:20,dailyIntegralSalary:100}]}),/quince días/);
});

test('matches the TSJ reference case: 8 years, 9 months and 24 days means 35 quarters plus 16 seniority days', () => {
  const result = calculateSeverance({
    hireDate:'2017-01-01', asOfDate:'2025-10-25', dailyIntegralSalary:200,
    quarterlyDeposits:Array.from({length:35},(_,index)=>({days:15,dailyIntegralSalary:100+index})),
    additionalSeniorityDeposits:Array.from({length:8},(_,index)=>({days:2,dailyIntegralSalary:150+index}))
  });
  assert.equal(result.completedYears,8);
  assert.equal(result.completedMonths,105);
  assert.equal(result.quarterlyGuaranteeDays,525);
  assert.equal(result.additionalSeniorityDays,16);
  assert.equal(result.guaranteeDays,541);
  assert.equal(result.terminationDays,270);
  assert.equal(result.greaterBasis,'GUARANTEE');
});

test('caps annual seniority deposits at thirty days and rejects missing or excessive history', () => {
  const common={hireDate:'2000-01-01',asOfDate:'2016-01-01',dailyIntegralSalary:100,
    quarterlyDeposits:Array.from({length:64},()=>({days:15,dailyIntegralSalary:100}))};
  assert.equal(calculateSeverance({...common,additionalSeniorityDeposits:Array.from({length:15},()=>({days:2,dailyIntegralSalary:100}))}).additionalSeniorityDays,30);
  assert.throws(()=>calculateSeverance({...common,additionalSeniorityDeposits:Array.from({length:14},()=>({days:2,dailyIntegralSalary:100}))}),/15 registros anuales/);
  assert.throws(()=>calculateSeverance({...common,additionalSeniorityDeposits:Array.from({length:15},()=>({days:3,dailyIntegralSalary:100}))}),/dos días por cada año/);
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

test('calculates severance interest by the applicable art. 143 regime using verified monthly rates', () => {
  const { calculateSeveranceInterest } = require('./payroll-legal-calculations.cjs');
  const months = [
    {month:'2026-01',capital:10000,monthlyRate:0.01,sourceReference:'BCV rate record Jan 2026',verifiedAt:'2026-02-01'},
    {month:'2026-02',capital:12000,monthlyRate:0.012,sourceReference:'BCV rate record Feb 2026',verifiedAt:'2026-03-01'}
  ];
  const book = calculateSeveranceInterest({mode:'AUTHORIZED_BOOK_CREDIT',months});
  assert.equal(book.totalInterest,244);
  assert.equal(book.monthsCalculated,2);
  assert.match(book.note,/autorización escrita/);
  const trust = calculateSeveranceInterest({mode:'TRUST_OR_FUND',months});
  assert.equal(trust.totalInterest,244);
  const overdue = calculateSeveranceInterest({mode:'UNDEPOSITED',months});
  assert.match(overdue.note,/seis principales bancos/);
  assert.throws(()=>calculateSeveranceInterest({mode:'AUTHORIZED_BOOK_CREDIT',months:[{...months[0],sourceReference:''}]}),/fuente o fecha/);
  assert.throws(()=>calculateSeveranceInterest({mode:'UNDEPOSITED',months:[{...months[0],monthlyRate:1.2}]}),/tasa mensual/);
  assert.throws(()=>calculateSeveranceInterest({mode:'OTHER',months}),/régimen de intereses/);
});


test('distributes the 15% profit-sharing fund in proportion to confirmed annual wages', () => {
  const { calculateProfitSharingDistribution } = require('./payroll-legal-calculations.cjs');
  const result = calculateProfitSharingDistribution({
    netProfits: 100000,
    employees: [
      { employeeId: 'A', wagesEarned: 60000, monthlyNormalSalary: 3000, monthsWorked: 12 },
      { employeeId: 'B', wagesEarned: 40000, monthlyNormalSalary: 3000, monthsWorked: 12 }
    ]
  });
  assert.equal(result.distributableFund, 15000);
  assert.equal(result.totalWagesEarned, 100000);
  assert.equal(result.employees[0].proportionalShare, 9000);
  assert.equal(result.employees[1].proportionalShare, 6000);
  assert.equal(result.totalPayable, 15000);
  assert.equal(result.employerShortfall, 0);
});

test('guarantees prorated individual minimums and exposes any employer shortfall', () => {
  const { calculateProfitSharingDistribution } = require('./payroll-legal-calculations.cjs');
  const result = calculateProfitSharingDistribution({
    netProfits: 10000,
    employees: [
      { employeeId: 'A', wagesEarned: 6000, monthlyNormalSalary: 3000, monthsWorked: 12 },
      { employeeId: 'B', wagesEarned: 4000, monthlyNormalSalary: 3000, monthsWorked: 6 }
    ]
  });
  assert.equal(result.distributableFund, 1500);
  assert.equal(result.employees[0].minimumDays, 30);
  assert.equal(result.employees[0].minimumAmount, 3000);
  assert.equal(result.employees[1].minimumDays, 15);
  assert.equal(result.employees[1].minimumAmount, 1500);
  assert.equal(result.totalPayable, 4500);
  assert.equal(result.employerShortfall, 3000);
});

test('does not redistribute amounts withheld by the four-month maximum', () => {
  const { calculateProfitSharingDistribution } = require('./payroll-legal-calculations.cjs');
  const result = calculateProfitSharingDistribution({
    netProfits: 200000,
    employees: [
      { employeeId: 'A', wagesEarned: 50000, monthlyNormalSalary: 3000, monthsWorked: 12 },
      { employeeId: 'B', wagesEarned: 50000, monthlyNormalSalary: 3000, monthsWorked: 12 }
    ]
  });
  assert.equal(result.employees[0].proportionalShare, 15000);
  assert.equal(result.employees[0].maximumAmount, 12000);
  assert.equal(result.totalPayable, 24000);
  assert.equal(result.undistributedRemainder, 6000);
});

test('rejects missing wage denominator, duplicate employees and invalid service months', () => {
  const { calculateProfitSharingDistribution } = require('./payroll-legal-calculations.cjs');
  assert.throws(() => calculateProfitSharingDistribution({
    netProfits: 10000,
    employees: [{ employeeId: 'A', wagesEarned: 0, monthlyNormalSalary: 1000, monthsWorked: 12 }]
  }), /salarios devengados confirmados/);
  assert.throws(() => calculateProfitSharingDistribution({
    netProfits: 10000,
    employees: [
      { employeeId: 'A', wagesEarned: 1000, monthlyNormalSalary: 1000, monthsWorked: 12 },
      { employeeId: 'A', wagesEarned: 1000, monthlyNormalSalary: 1000, monthsWorked: 12 }
    ]
  }), /identificador vacío o repetido/);
  assert.throws(() => calculateProfitSharingDistribution({
    netProfits: 10000,
    employees: [{ employeeId: 'A', wagesEarned: 1000, monthlyNormalSalary: 1000, monthsWorked: 0 }]
  }), /meses completos/);
});


test('calculates final settlement vacation, bonus, salary arrears, profit sharing and severance separately', () => {
  const { calculateFinalLiquidation } = require('./payroll-legal-calculations.cjs');
  const result = calculateFinalLiquidation({
    hireDate:'2024-01-01', terminationDate:'2026-07-01',
    terminationReason:'VOLUNTARY_RESIGNATION', dailyNormalSalary:100,
    vacationDaysOutstanding:5, vacationBonusDaysOutstanding:3,
    vacationBalanceSource:'Registro de vacaciones 2024-2026',
    severancePayable:12000, interestStatus:'SETTLED', interestAmount:120,
    interestSourceReference:'Intereses mensuales verificados',interestStatusEvidence:'Historial mensual conciliado',
    profitSharingStatus:'SETTLED', profitSharingAmount:800,
    profitSharingSourceReference:'Cálculo anual confirmado',
    pendingSalaryAmount:500, pendingSalarySourceReference:'Nómina pendiente'
  });
  assert.equal(result.currentCycleMonths,6);
  assert.equal(result.currentVacationAnnualDays,17);
  assert.equal(result.fractionalVacationDays,8.5);
  assert.equal(result.vacationPay,1350);
  assert.equal(result.currentVacationBonusAnnualDays,17);
  assert.equal(result.fractionalVacationBonusDays,8.5);
  assert.equal(result.vacationBonusPay,1150);
  assert.equal(result.indemnity,0);
  assert.equal(result.total,15920);
});

test('adds the equivalent severance indemnity only to legally classified art. 80 and art. 92 exits', () => {
  const { calculateFinalLiquidation } = require('./payroll-legal-calculations.cjs');
  const base={hireDate:'2020-01-01',terminationDate:'2026-01-01',dailyNormalSalary:100,
    vacationDaysOutstanding:0,vacationBonusDaysOutstanding:0,vacationBalanceSource:'Registro conciliado',
    severancePayable:10000,interestStatus:'NOT_APPLICABLE',interestStatusEvidence:'Intereses conciliados',profitSharingStatus:'NOT_APPLICABLE',profitSharingSourceReference:'Utilidades pagadas o no causadas'};
  const art80=calculateFinalLiquidation({...base,terminationReason:'JUSTIFIED_WITHDRAWAL_ART80',legalClassificationConfirmed:true,legalEvidence:'Acta de Inspectoría'});
  const art92=calculateFinalLiquidation({...base,terminationReason:'UNJUSTIFIED_DISMISSAL_ART92',workerChoice:'NO_REENGAGEMENT',legalClassificationConfirmed:true,legalEvidence:'Constancia de opción del trabajador'});
  const resignation=calculateFinalLiquidation({...base,terminationReason:'VOLUNTARY_RESIGNATION'});
  const justifiedDismissal=calculateFinalLiquidation({...base,terminationReason:'JUSTIFIED_DISMISSAL_ART79',legalClassificationConfirmed:true,legalEvidence:'Causal acreditada'});
  assert.equal(art80.indemnity,10000);
  assert.equal(art92.indemnity,10000);
  assert.equal(resignation.indemnity,0);
  assert.equal(justifiedDismissal.indemnity,0);
});

test('fails closed for unresolved dismissal, suspension, missing evidence and unproven special cases', () => {
  const { calculateFinalLiquidation } = require('./payroll-legal-calculations.cjs');
  const base={hireDate:'2024-01-01',terminationDate:'2026-01-01',dailyNormalSalary:100,
    vacationDaysOutstanding:0,vacationBonusDaysOutstanding:0,vacationBalanceSource:'Registro',
    severancePayable:1000,interestStatus:'NOT_APPLICABLE',interestStatusEvidence:'Sin intereses pendientes',profitSharingStatus:'NOT_APPLICABLE',profitSharingSourceReference:'Utilidades conciliadas'};
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'UNJUSTIFIED_DISMISSAL_ART92'}),/no solicitará reenganche/);
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'TEMPORARY_SUSPENSION'}),/no termina la relación/);
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'JUSTIFIED_WITHDRAWAL_ART80'}),/clasificación legal confirmada/);
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'DEATH_ART145'}),/beneficiarios/);
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'EARLY_FIXED_TERM_WITHDRAWAL_ART83'}),/Vencimiento del contrato/);
  assert.throws(()=>calculateFinalLiquidation({...base,terminationReason:'VOLUNTARY_RESIGNATION',profitSharingStatus:'PENDING'}),/utilidades pendientes/);
});
