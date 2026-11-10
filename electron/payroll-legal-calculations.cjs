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
 * Resolves the monthly/daily salary base for vacation under LOTTT art. 121.
 * For piecework, commission or other variable pay, callers must supply the
 * normal salary from the three immediately preceding months.
 */
function calculateVacationSalaryBasis(input) {
  const type = String(input.salaryType || '');
  let monthly;
  let monthsAveraged = 1;
  if (type === 'FIXED') {
    monthly = money(input.lastMonthNormalSalary, 'Salario normal del mes anterior');
  } else if (type === 'VARIABLE') {
    const values = input.previousThreeMonthsNormalSalary;
    if (!Array.isArray(values) || values.length !== 3) {
      throw new Error('Para salario variable de vacaciones se requieren los tres meses inmediatamente anteriores.');
    }
    monthly = round2(values.reduce((sum, value) => sum + money(value, 'Salario normal mensual'), 0) / 3);
    monthsAveraged = 3;
  } else {
    throw new Error('Indique si el salario para vacaciones es fijo o variable.');
  }
  return { monthlySalary: monthly, dailySalary: round2(monthly / 30), monthsAveraged, legalBasis: 'LOTTT art. 121' };
}

/**
 * Resolves the salary base for severance under LOTTT art. 122.
 * Variable salary averages six preceding months and must include all salary
 * concepts plus the legally applicable vacation-bonus/profit-sharing aliquots.
 */
function calculateSeveranceSalaryBasis(input) {
  const type = String(input.salaryType || '');
  let monthly;
  let monthsAveraged = 1;
  if (type === 'FIXED') {
    monthly = money(input.lastMonthlyIntegratedSalary, 'Último salario mensual integrado');
  } else if (type === 'VARIABLE') {
    const values = input.previousSixMonthsIntegratedSalary;
    if (!Array.isArray(values) || values.length !== 6) {
      throw new Error('Para prestaciones con salario variable se requieren los seis meses inmediatamente anteriores.');
    }
    monthly = round2(values.reduce((sum, value) => sum + money(value, 'Salario mensual integrado'), 0) / 6);
    monthsAveraged = 6;
  } else {
    throw new Error('Indique si el salario para prestaciones es fijo o variable.');
  }
  return { monthlySalary: monthly, dailySalary: round2(monthly / 30), monthsAveraged, legalBasis: 'LOTTT art. 122' };
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
 * LOTTT art. 142: compares historical quarterly and seniority deposits
 * (each with its own integral-salary basis) against the termination amount.
 * It intentionally refuses to estimate past deposits from today's salary.
 * Does not calculate interest or final settlement.
 */
function calculateSeverance(input) {
  const hire = validDate(input.hireDate, 'Fecha de ingreso');
  const asOf = validDate(input.asOfDate, 'Fecha de corte');
  if (asOf < hire) throw new Error('La fecha de corte no puede ser anterior al ingreso.');
  const daily = money(input.dailyIntegralSalary, 'Salario diario integral');
  const monthsElapsed = completedCalendarMonths(hire, asOf);
  const years = Math.floor(monthsElapsed / 12);
  const quarters = Math.floor(monthsElapsed / 3);
  if (!Array.isArray(input.quarterlyDeposits)) {
    throw new Error('Para comparar la garantía se requiere el historial de depósitos trimestrales con el salario integral de cada trimestre.');
  }
  if (!Array.isArray(input.additionalSeniorityDeposits)) {
    throw new Error('Para comparar la garantía se requiere el historial de depósitos adicionales por antigüedad.');
  }
  if (input.quarterlyDeposits.length !== quarters) {
    throw new Error('El historial de garantía está incompleto o contiene depósitos trimestrales duplicados: se requieren ' + quarters + ' registros.');
  }
  const expectedSeniorityDeposits = Math.min(years, 15);
  if (input.additionalSeniorityDeposits.length !== expectedSeniorityDeposits) {
    throw new Error('El historial de garantía está incompleto o contiene depósitos adicionales duplicados: se requieren ' + expectedSeniorityDeposits + ' registros anuales.');
  }
  const sumDeposits = (items, label) => items.reduce((sum, item) => {
    const days = money(item.days, label + ' — días');
    const depositDailySalary = money(item.dailyIntegralSalary, label + ' — salario diario integral');
    if (days <= 0 || depositDailySalary <= 0) throw new Error(label + ' debe registrar días y salario diario mayores que cero.');
    return sum + round2(days * depositDailySalary);
  }, 0);
  if (input.quarterlyDeposits.some(item => Math.abs(money(item.days, 'Días trimestrales') - 15) > 0.001)) {
    throw new Error('Cada depósito de garantía trimestral debe representar quince días de salario.');
  }
  const quarterlyGuaranteeAmount = round2(sumDeposits(input.quarterlyDeposits, 'Depósito trimestral'));
  const additionalSeniorityAmount = round2(sumDeposits(input.additionalSeniorityDeposits, 'Depósito adicional'));
  const quarterlyGuaranteeDays = round2(input.quarterlyDeposits.reduce((sum, item) => sum + money(item.days, 'Días trimestrales'), 0));
  const additionalSeniorityDays = round2(input.additionalSeniorityDeposits.reduce((sum, item) => sum + money(item.days, 'Días adicionales'), 0));
  const expectedQuarterlyDays = round2(quarters * 15);
  const expectedAdditionalSeniorityDays = round2(Math.min(years * 2, 30));
  if (Math.abs(quarterlyGuaranteeDays - expectedQuarterlyDays) > 0.001) {
    throw new Error('Los depósitos trimestrales deben representar quince días por cada trimestre completo.');
  }
  if (Math.abs(additionalSeniorityDays - expectedAdditionalSeniorityDays) > 0.001 ||
      input.additionalSeniorityDeposits.some(item => Math.abs(money(item.days, 'Días adicionales') - 2) > 0.001)) {
    throw new Error('Los depósitos adicionales deben ser de dos días por cada año cumplido, acumulativos hasta treinta días.');
  }
  const guaranteeDays = round2(quarterlyGuaranteeDays + additionalSeniorityDays);
  const beforeThreeMonths = asOf < addMonthsClamped(hire, 3);
  const completedMonthDate = addMonthsClamped(hire, monthsElapsed);
  const serviceMonthsForFirstThree = monthsElapsed + (asOf > completedMonthDate ? 1 : 0);
  const exceedsSixMonthFraction = asOf > addMonthsClamped(hire, years * 12 + 6);
  const terminationDays = beforeThreeMonths
    ? serviceMonthsForFirstThree * 5
    : (years + (exceedsSixMonthFraction ? 1 : 0)) * 30;
  const guaranteeAmount = round2(quarterlyGuaranteeAmount + additionalSeniorityAmount);
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


/**
 * LOTTT art. 143: calcula intereses a partir de una serie mensual ya validada.
 * La tasa mensual debe venir de la fuente aplicable; aquí no se convierte una
 * tasa anual ni se presume rendimiento bancario. El capital de cada mes debe
 * reflejar depósitos, anticipos y, si corresponde, capitalización documentada.
 */
function calculateSeveranceInterest(input) {
  const mode = String(input.mode || '');
  const allowed = new Set(['TRUST_OR_FUND', 'AUTHORIZED_BOOK_CREDIT', 'UNDEPOSITED']);
  if (!allowed.has(mode)) throw new Error('Indique el régimen de intereses de la garantía de prestaciones.');
  if (!Array.isArray(input.months) || input.months.length === 0) {
    throw new Error('Se requiere el historial mensual de capital y tasas para calcular intereses.');
  }
  const seen = new Set();
  const details = input.months.map(item => {
    const month = String(item.month || '');
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || seen.has(month)) {
      throw new Error('El historial de intereses contiene un mes inválido o repetido.');
    }
    seen.add(month);
    const capital = money(item.capital, 'Capital del mes ' + month);
    const monthlyRate = Number(item.monthlyRate);
    if (!Number.isFinite(monthlyRate) || monthlyRate < 0 || monthlyRate > 1) {
      throw new Error('La tasa mensual de ' + month + ' debe estar expresada como decimal entre 0 y 1.');
    }
    const sourceReference = String(item.sourceReference || '').trim();
    const verifiedAt = String(item.verifiedAt || '');
    if (!sourceReference) {
      throw new Error('Falta la fuente o fecha de verificación de la tasa de ' + month + '.');
    }
    validDate(verifiedAt, 'Fecha de verificación de la tasa de ' + month);
    return { month, capital, monthlyRate, interest: round2(capital * monthlyRate), sourceReference, verifiedAt };
  }).sort((a, b) => a.month.localeCompare(b.month));
  const totalInterest = round2(details.reduce((sum, item) => sum + item.interest, 0));
  return {
    mode,
    totalInterest,
    monthsCalculated: details.length,
    details,
    legalBasis: 'LOTTT art. 143; Gaceta Oficial N.º 6.076 Extraordinario, 07-05-2012',
    note: mode === 'TRUST_OR_FUND'
      ? 'Se utilizó el rendimiento mensual informado por el fideicomiso o fondo.'
      : mode === 'AUTHORIZED_BOOK_CREDIT'
        ? 'Se requiere que la tasa mensual suministrada corresponda al promedio legal entre las tasas activa y pasiva del BCV y que exista autorización escrita del trabajador.'
        : 'Se requiere que la tasa mensual suministrada corresponda a la tasa activa legal de referencia de los seis principales bancos.'
  };
}


/**
 * LOTTT arts. 131, 132 and 136: distributes 15% of declared net profits
 * in proportion to each worker's salary earned during the fiscal year.
 * The 30-day minimum and four-month maximum are prorated by full service
 * months. If minimums exceed the fund, the employer shortfall is explicit;
 * if caps leave a remainder, it is not assigned arbitrarily.
 *
 * monthlyNormalSalary must already be resolved under the applicable salary
 * rules (fixed previous month or three-month variable average).
 */
function calculateProfitSharingDistribution(input) {
  const netProfits = money(input.netProfits, 'Beneficios líquidos del ejercicio');
  if (!Array.isArray(input.employees) || input.employees.length === 0) {
    throw new Error('Se requiere al menos un trabajador para distribuir utilidades.');
  }
  const seen = new Set();
  const employees = input.employees.map(item => {
    const employeeId = String(item.employeeId || '').trim();
    if (!employeeId || seen.has(employeeId)) throw new Error('La lista de trabajadores contiene un identificador vacío o repetido.');
    seen.add(employeeId);
    const wagesEarned = money(item.wagesEarned, 'Salarios devengados de ' + employeeId);
    const monthlyNormalSalary = money(item.monthlyNormalSalary, 'Salario normal mensual de ' + employeeId);
    const monthsWorked = Number(item.monthsWorked);
    if (!Number.isInteger(monthsWorked) || monthsWorked < 1 || monthsWorked > 12) {
      throw new Error('Los meses completos trabajados por ' + employeeId + ' deben estar entre 1 y 12.');
    }
    if (monthlyNormalSalary <= 0) throw new Error('El salario normal mensual de ' + employeeId + ' debe ser mayor que cero.');
    const minimumDays = round2(30 * monthsWorked / 12);
    const maximumDays = round2(120 * monthsWorked / 12);
    return {
      employeeId, wagesEarned, monthlyNormalSalary, monthsWorked,
      minimumDays, maximumDays,
      minimumAmount: round2(monthlyNormalSalary * monthsWorked / 12),
      maximumAmount: round2(monthlyNormalSalary * 4 * monthsWorked / 12)
    };
  });
  const totalWagesEarned = round2(employees.reduce((sum, item) => sum + item.wagesEarned, 0));
  if (totalWagesEarned <= 0) throw new Error('No hay salarios devengados confirmados para distribuir las utilidades.');
  const distributableFund = round2(netProfits * 0.15);
  const results = employees.map(item => {
    const proportionalShare = round2(distributableFund * item.wagesEarned / totalWagesEarned);
    const amount = round2(Math.max(item.minimumAmount, Math.min(proportionalShare, item.maximumAmount)));
    return { ...item, proportionalShare, amount };
  });
  const totalMinimum = round2(results.reduce((sum, item) => sum + item.minimumAmount, 0));
  const totalMaximum = round2(results.reduce((sum, item) => sum + item.maximumAmount, 0));
  const totalPayable = round2(results.reduce((sum, item) => sum + item.amount, 0));
  return {
    netProfits, statutoryRate: 0.15, distributableFund, totalWagesEarned,
    totalMinimum, totalMaximum, totalPayable,
    employerShortfall: round2(Math.max(0, totalPayable - distributableFund)),
    undistributedRemainder: round2(Math.max(0, distributableFund - totalPayable)),
    employees: results,
    legalBasis: 'LOTTT arts. 131, 132 y 136; Gaceta Oficial N.º 6.076 Extraordinario, 07-05-2012',
    notes: [
      'La participación proporcional se calcula sobre salarios efectivamente devengados en nóminas confirmadas.',
      'El mínimo individual se garantiza; cualquier insuficiencia del fondo queda identificada como obligación patronal adicional.',
      'El excedente que resulte por límites máximos queda sin distribuir hasta que exista criterio legal aplicable.'
    ]
  };
}


/**
 * Builds the legally classified final settlement components.
 * Outstanding vacation balances are entered only after checking the
 * employer's vacation register; the current service-year fraction is derived
 * from complete months under LOTTT art. 196. No unsupported deductions.
 */
function calculateFinalLiquidation(input) {
  const hire = validDate(input.hireDate, 'Fecha de ingreso');
  const end = validDate(input.terminationDate, 'Fecha de terminación');
  if (end < hire) throw new Error('La terminación no puede ser anterior al ingreso.');
  const reason = String(input.terminationReason || '');
  const allowed = [
    'VOLUNTARY_RESIGNATION','JUSTIFIED_WITHDRAWAL_ART80','JUSTIFIED_DISMISSAL_ART79',
    'UNJUSTIFIED_DISMISSAL_ART92','CAUSE_BEYOND_WORKER_WILL_ART92',
    'MUTUAL_AGREEMENT','CONTRACT_EXPIRATION','WORK_COMPLETION',
    'EARLY_FIXED_TERM_WITHDRAWAL_ART83','DEATH_ART145','FORCE_MAJEURE_ART92','TEMPORARY_SUSPENSION'
  ];
  if (!allowed.includes(reason)) throw new Error('Seleccione una causal de terminación reconocida.');
  if (reason === 'TEMPORARY_SUSPENSION') throw new Error('Una suspensión no termina la relación laboral y no genera liquidación final.');
  const dailyNormalSalary = money(input.dailyNormalSalary, 'Salario diario normal a la terminación');
  if (dailyNormalSalary <= 0) throw new Error('El salario diario normal debe ser mayor que cero.');
  const vacationDaysOutstanding = money(input.vacationDaysOutstanding, 'Días de vacaciones vencidas pendientes');
  const vacationBonusDaysOutstanding = money(input.vacationBonusDaysOutstanding, 'Días de bono vacacional vencidos pendientes');
  const vacationBalanceSource = String(input.vacationBalanceSource || '').trim();
  if (!vacationBalanceSource) throw new Error('Indique la fuente del registro de vacaciones y bonos ya disfrutados/pagados.');
  const completedServiceYears = completedYears(input.hireDate, input.terminationDate);
  const currentCycleStart = addMonthsClamped(hire, completedServiceYears * 12);
  const currentCycleMonths = completedCalendarMonths(currentCycleStart, end);
  const statutoryVacationAnnualDays = 15 + Math.min(15, completedServiceYears);
  const statutoryVacationBonusAnnualDays = 15 + Math.min(15, completedServiceYears);
  const hasContractualVacationDays = input.vacationAnnualDays !== undefined && input.vacationAnnualDays !== null && input.vacationAnnualDays !== '';
  const hasContractualBonusDays = input.vacationBonusAnnualDays !== undefined && input.vacationBonusAnnualDays !== null && input.vacationBonusAnnualDays !== '';
  if ((hasContractualVacationDays || hasContractualBonusDays) && !String(input.vacationEntitlementEvidence || '').trim()) {
    throw new Error('Los días superiores de vacaciones o bono vacacional requieren contrato, convención colectiva o fuente normativa verificable.');
  }
  const currentVacationAnnualDays = hasContractualVacationDays
    ? money(input.vacationAnnualDays, 'Días anuales de vacaciones') : statutoryVacationAnnualDays;
  const currentVacationBonusAnnualDays = hasContractualBonusDays
    ? money(input.vacationBonusAnnualDays, 'Días anuales de bono vacacional') : statutoryVacationBonusAnnualDays;
  if (currentVacationAnnualDays < statutoryVacationAnnualDays || currentVacationBonusAnnualDays < statutoryVacationBonusAnnualDays) {
    throw new Error('La condición contractual no puede reducir los mínimos legales de vacaciones o bono vacacional.');
  }
  if (currentVacationAnnualDays > 365 || currentVacationBonusAnnualDays > 365) {
    throw new Error('Los días anuales de vacaciones o bono vacacional exceden un límite válido.');
  }
  const fractionalVacationDays = round2(currentVacationAnnualDays * currentCycleMonths / 12);
  const fractionalVacationBonusDays = round2(currentVacationBonusAnnualDays * currentCycleMonths / 12);
  const vacationDaysPayable = round2(vacationDaysOutstanding + fractionalVacationDays);
  const vacationBonusDaysPayable = round2(vacationBonusDaysOutstanding + fractionalVacationBonusDays);
  const vacationPay = round2(vacationDaysPayable * dailyNormalSalary);
  const vacationBonusPay = round2(vacationBonusDaysPayable * dailyNormalSalary);

  const severancePayable = money(input.severancePayable, 'Prestaciones sociales netas de anticipos');
  const interestStatus = String(input.interestStatus || '');
  const profitSharingStatus = String(input.profitSharingStatus || '');
  if (!['SETTLED','NOT_APPLICABLE'].includes(interestStatus)) throw new Error('Debe conciliar los intereses de prestaciones o marcar documentadamente que no están pendientes.');
  if (!['SETTLED','NOT_APPLICABLE'].includes(profitSharingStatus)) throw new Error('Debe conciliar las utilidades pendientes o marcar documentadamente que no corresponden.');
  if (!String(input.interestStatusEvidence || '').trim()) throw new Error('Indique el soporte del estado de los intereses de prestaciones.');
  if (!String(input.profitSharingSourceReference || '').trim()) throw new Error('Indique el soporte del estado de las utilidades pendientes o ya pagadas.');
  const interestAmount = interestStatus === 'SETTLED' ? money(input.interestAmount, 'Intereses de prestaciones') : 0;
  const profitSharingAmount = profitSharingStatus === 'SETTLED' ? money(input.profitSharingAmount, 'Utilidades pendientes') : 0;
  if (interestAmount > 0 && !String(input.interestSourceReference || '').trim()) throw new Error('Indique la fuente de los intereses reconocidos.');
  const pendingSalaryAmount = money(input.pendingSalaryAmount || 0, 'Salarios y conceptos causados pendientes');
  if (pendingSalaryAmount > 0 && !String(input.pendingSalarySourceReference || '').trim()) throw new Error('Indique el soporte de salarios y conceptos pendientes.');
  const lateInterestAmount = money(input.lateInterestAmount || 0, 'Intereses moratorios');
  const lateInterestSourceReference = String(input.lateInterestSourceReference || '').trim();
  let lateInterestDays = 0;
  if (input.paymentDate) {
    const paymentDate = validDate(input.paymentDate, 'Fecha de pago');
    if (paymentDate < end) throw new Error('La fecha de pago no puede ser anterior a la terminación.');
    const dueDate = new Date(end.getTime());
    dueDate.setUTCDate(dueDate.getUTCDate() + 5);
    if (paymentDate > dueDate) {
      lateInterestDays = Math.floor((paymentDate.getTime() - dueDate.getTime()) / 86400000);
      if (lateInterestAmount <= 0 || !lateInterestSourceReference) {
        throw new Error('El pago posterior a los cinco días exige calcular y soportar los intereses moratorios (arts. 128 y 142.f).');
      }
    } else if (lateInterestAmount > 0) {
      throw new Error('No corresponde interés moratorio si el pago se realizó dentro de los cinco días siguientes a la terminación.');
    }
  } else if (lateInterestAmount > 0) {
    throw new Error('Indique la fecha efectiva de pago para reconocer intereses moratorios.');
  }

  const additionalEarnings = Array.isArray(input.additionalEarnings) ? input.additionalEarnings : [];
  const earningCodes = new Set();
  const additionalEarningsTotal = round2(additionalEarnings.reduce((sum, item) => {
    const code = String(item.code || '').trim();
    if (!code || earningCodes.has(code)) throw new Error('Los conceptos adicionales deben tener códigos no vacíos y no repetidos.');
    earningCodes.add(code);
    const amount = money(item.amount, 'Concepto adicional');
    if (amount > 0 && !String(item.sourceReference || '').trim()) throw new Error('Cada concepto adicional debe tener un comprobante o fuente.');
    return sum + amount;
  }, 0));

  const legalEvidence = String(input.legalEvidence || '').trim();
  const classificationConfirmed = input.legalClassificationConfirmed === true;
  let indemnity = 0;
  let remainingContractWages = 0;
  if (reason === 'JUSTIFIED_WITHDRAWAL_ART80' || reason === 'CAUSE_BEYOND_WORKER_WILL_ART92' || reason === 'FORCE_MAJEURE_ART92') {
    if (!classificationConfirmed || !legalEvidence) throw new Error('La causal indemnizable requiere clasificación legal confirmada y evidencia.');
    indemnity = severancePayable;
  }
  if (reason === 'UNJUSTIFIED_DISMISSAL_ART92') {
    const choice = String(input.workerChoice || '');
    if (choice !== 'NO_REENGAGEMENT') {
      throw new Error('No se puede cerrar la liquidación hasta documentar que el trabajador no solicitará reenganche (art. 92).');
    }
    if (!classificationConfirmed || !legalEvidence) throw new Error('El despido injustificado requiere constancia de la elección del trabajador y evidencia.');
    indemnity = severancePayable;
  }
  if (reason === 'EARLY_FIXED_TERM_WITHDRAWAL_ART83') {
    const contractEndDate = validDate(input.contractEndDate, 'Vencimiento del contrato');
    if (contractEndDate <= end) throw new Error('El vencimiento contractual debe ser posterior a la fecha de retiro.');
    if (!classificationConfirmed || !legalEvidence || !String(input.contractEvidence || '').trim()) {
      throw new Error('El supuesto del artículo 83 requiere contrato, causal justificada y evidencia verificable.');
    }
    remainingContractWages = money(input.remainingContractWages, 'Salarios hasta el vencimiento del contrato');
    indemnity = round2(severancePayable + remainingContractWages);
  }
  let agreedAdditionalAmount = 0;
  if (reason === 'MUTUAL_AGREEMENT') {
    agreedAdditionalAmount = money(input.agreedAdditionalAmount || 0, 'Monto adicional convenido');
    if (!String(input.agreementEvidence || '').trim()) {
      throw new Error('El mutuo acuerdo requiere convenio escrito y soporte de la terminación.');
    }
  }
  if (reason === 'JUSTIFIED_DISMISSAL_ART79' && (!classificationConfirmed || !legalEvidence)) {
    throw new Error('El despido justificado requiere causal documentada y clasificación confirmada.');
  }
  if (reason === 'CONTRACT_EXPIRATION') {
    const contractEndDate = validDate(input.contractEndDate, 'Vencimiento del contrato');
    if (contractEndDate.getTime() !== end.getTime() || !String(input.contractEvidence || '').trim()) {
      throw new Error('El vencimiento de contrato requiere fecha coincidente con la terminación y contrato verificable.');
    }
  }
  if (reason === 'WORK_COMPLETION' && !String(input.contractEvidence || '').trim()) {
    throw new Error('La culminación de obra requiere acta o soporte verificable de finalización.');
  }
  if (reason === 'DEATH_ART145' && !String(input.beneficiaryEvidence || '').trim()) {
    throw new Error('El pago por fallecimiento requiere acreditar a los beneficiarios conforme al artículo 145.');
  }

  const total = round2(severancePayable + vacationPay + vacationBonusPay + interestAmount + lateInterestAmount +
    profitSharingAmount + pendingSalaryAmount + additionalEarningsTotal + indemnity + agreedAdditionalAmount);
  return {
    terminationDate: input.terminationDate, terminationReason: reason, completedServiceYears,
    currentCycleMonths, currentVacationAnnualDays, currentVacationBonusAnnualDays,
    vacationDaysOutstanding, vacationDaysPayable, fractionalVacationDays, vacationPay,
    vacationBonusDaysOutstanding, vacationBonusDaysPayable, fractionalVacationBonusDays, vacationBonusPay,
    dailyNormalSalary, vacationBalanceSource, severancePayable, interestAmount, interestStatus,
    paymentDate:input.paymentDate || null, lateInterestDays, lateInterestAmount, lateInterestSourceReference,
    profitSharingAmount, profitSharingStatus, pendingSalaryAmount, additionalEarnings,
    additionalEarningsTotal, indemnity, remainingContractWages, agreedAdditionalAmount, total,
    legalBases: ['LOTTT arts. 19, 80, 83, 92, 121, 122, 128, 142, 144, 145, 190, 192, 195, 196; GO 6.076 Extraordinario'],
    notes: [
      'Vacaciones y bono vacacional se calculan separadamente con salario normal diario.',
      'La fracción del período en curso utiliza meses completos; las condiciones contractuales/colectivas superiores deben prevalecer si están acreditadas.',
      'No se aplicaron deducciones automáticas ni se descontó preaviso omitido.',
      lateInterestDays > 0 ? 'Se incluyeron intereses moratorios por ' + lateInterestDays + ' días posteriores al plazo legal de cinco días.' : 'No se generaron intereses moratorios dentro del plazo legal o sin fecha de pago registrada.',
      reason === 'DEATH_ART145' ? 'El pago se entrega únicamente a beneficiarios acreditados conforme al artículo 145.' : ''
    ].filter(Boolean)
  };
}

module.exports = { completedYears, completedCalendarMonths, completeCalendarMonths, calculateVacationSalaryBasis, calculateSeveranceSalaryBasis, calculateAnnualLaborRights, calculateSeverance, calculateSeveranceInterest, calculateProfitSharingDistribution, calculateFinalLiquidation };
