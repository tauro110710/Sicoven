'use strict';

function validDate(value, label) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(label + ' debe usar AAAA-MM-DD.');
  const date = new Date(text + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== text) throw new Error(label + ' no es válida.');
  return date;
}
function money(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(label + ' debe ser un importe no negativo.');
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function addMonthsClamped(date, months) {
  const targetMonth = date.getUTCMonth() + months;
  const firstOfTarget = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}
function completedCalendarMonths(fromDate, toDate) {
  let months = (toDate.getUTCFullYear() - fromDate.getUTCFullYear()) * 12
    + toDate.getUTCMonth() - fromDate.getUTCMonth();
  if (toDate < addMonthsClamped(fromDate, months)) months -= 1;
  return Math.max(0, months);
}
function completedYears(hireDate, asOfDate) {
  const hire = validDate(hireDate, 'Fecha de ingreso');
  const asOf = validDate(asOfDate, 'Fecha de corte');
  if (asOf < hire) throw new Error('La fecha de corte no puede ser anterior al ingreso.');
  return Math.floor(completedCalendarMonths(hire, asOf) / 12);
}
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function completeCalendarMonths(fromDate, toDate) {
  let startYear = fromDate.getUTCFullYear();
  let startMonth = fromDate.getUTCMonth();
  if (fromDate.getUTCDate() > 1) {
    startMonth += 1;
    if (startMonth > 11) { startMonth = 0; startYear += 1; }
  }
  const lastDay = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth() + 1, 0)).getUTCDate();
  let endYear = toDate.getUTCFullYear();
  let endMonth = toDate.getUTCMonth();
  if (toDate.getUTCDate() < lastDay) {
    endMonth -= 1;
    if (endMonth < 0) { endMonth = 11; endYear -= 1; }
  }
  return Math.max(0, (endYear - startYear) * 12 + endMonth - startMonth + 1);
}

/**
 * LOTTT annual rights for fixed or variable salary.
 * dailyNormalSalary must already reflect the legally appropriate salary basis
 * (normal salary; variable salary uses the applicable statutory average).
 */
function calculateAnnualLaborRights(input) {
  const years = completedYears(input.hireDate, input.asOfDate);
  const daily = money(input.dailyNormalSalary, 'Salario diario normal');
  const vacationDays = years < 1 ? 0 : 15 + Math.min(15, Math.max(0, years - 1));
  const vacationBonusDays = years < 1 ? 0 : 15 + Math.min(15, Math.max(0, years - 1));
  const fiscalYearStart = input.fiscalYearStart
    ? validDate(input.fiscalYearStart, 'Inicio del ejercicio')
    : new Date(Date.UTC(validDate(input.asOfDate, 'Fecha de corte').getUTCFullYear(), 0, 1));
  const asOf = validDate(input.asOfDate, 'Fecha de corte');
  if (asOf < fiscalYearStart) throw new Error('El corte no puede ser anterior al inicio del ejercicio.');
  const serviceStartInYear = validDate(input.hireDate, 'Fecha de ingreso') > fiscalYearStart
    ? validDate(input.hireDate, 'Fecha de ingreso') : fiscalYearStart;
  const monthsInFiscalYear = Math.min(12, completeCalendarMonths(serviceStartInYear, asOf));
  const profitSharingMinimumDays = round2(30 * monthsInFiscalYear / 12);
  const profitSharingMaximumDays = round2(120 * monthsInFiscalYear / 12);
  return {
    completedYears: years,
    vacationDays,
    vacationPay: round2(vacationDays * daily),
    vacationBonusDays,
    vacationBonus: round2(vacationBonusDays * daily),
    profitSharingMinimumDays,
    profitSharingMinimum: round2(profitSharingMinimumDays * daily),
    profitSharingMaximumDays,
    profitSharingMaximum: round2(profitSharingMaximumDays * daily),
    monthsInFiscalYear,
    sources: [
      'LOTTT, arts. 131, 190 y 192; Gaceta Oficial N.º 6.076 Extraordinario, 07-05-2012'
    ]
  };
}

/**
 * LOTTT art. 142: quarterly guarantee, additional seniority days and
 * termination comparison. Does not calculate interest or final settlement.
 */
function calculateSeverance(input) {
  const hire = validDate(input.hireDate, 'Fecha de ingreso');
  const asOf = validDate(input.asOfDate, 'Fecha de corte');
  if (asOf < hire) throw new Error('La fecha de corte no puede ser anterior al ingreso.');
  const daily = money(input.dailyIntegralSalary, 'Salario diario integral');
  const monthsElapsed = completedCalendarMonths(hire, asOf);
  const years = Math.floor(monthsElapsed / 12);
  const quarters = Math.floor(monthsElapsed / 3);
  const quarterlyGuaranteeDays = quarters * 15;
  const additionalSeniorityDays = years > 1 ? Math.min(30, (years - 1) * 2) : 0;
  const guaranteeDays = quarterlyGuaranteeDays + additionalSeniorityDays;
  const beforeThreeMonths = asOf < addMonthsClamped(hire, 3);
  const completedMonthDate = addMonthsClamped(hire, monthsElapsed);
  const serviceMonthsForFirstThree = monthsElapsed + (asOf > completedMonthDate ? 1 : 0);
  const exceedsSixMonthFraction = asOf > addMonthsClamped(hire, years * 12 + 6);
  const terminationDays = beforeThreeMonths
    ? serviceMonthsForFirstThree * 5
    : (years + (exceedsSixMonthFraction ? 1 : 0)) * 30;
  const guaranteeAmount = round2(guaranteeDays * daily);
  const terminationAmount = round2(terminationDays * daily);
  return {
    completedYears: years,
    completedMonths: monthsElapsed,
    quarterlyGuaranteeDays,
    additionalSeniorityDays,
    guaranteeDays,
    guaranteeAmount,
    terminationDays,
    terminationAmount,
    greaterAmount: Math.max(guaranteeAmount, terminationAmount),
    greaterBasis: guaranteeAmount >= terminationAmount ? 'GUARANTEE' : 'TERMINATION',
    sources: ['LOTTT, art. 142; Gaceta Oficial N.º 6.076 Extraordinario, 07-05-2012']
  };
}

module.exports = { completedYears, completeCalendarMonths, calculateAnnualLaborRights, calculateSeverance };
