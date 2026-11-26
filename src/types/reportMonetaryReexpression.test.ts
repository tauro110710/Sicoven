import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, JournalEntry } from './accounting';
import {
  buildIncomeStatementRows,
  buildReportMovementsByAccount,
  buildTrialBalanceRows,
  getReportScaleDate,
  getUnclosedResultAtReportDate,
  reexpressReportAmount,
  reexpressReportAmountExact,
  roundReportCents,
  roundReportMicroUsd
} from './reportMonetaryReexpression';
import { isBalanceSheetBalanced, isTrialBalanceBalanced, selectHistoricalReportEntries } from './accountingReportIntegrity';
import { buildClosingEntryItems } from './accountingYearClosing';
import { buildEquityChangesReport } from './equityChanges';
import { buildDisclosureAccountMovements } from './financialDisclosures';
import { buildCashFlowReport } from './cashFlowStatement';
import { buildCashFlowIndirectReport } from './cashFlowIndirectStatement';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
  { code: '1.2.1.01', name: 'Mobiliario', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'INVERSION' },
  { code: '2.1.1.01', name: 'Cuentas por pagar', type: 'PASIVO', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '3.1.1.01', name: 'Capital social', type: 'PATRIMONIO', level: 4, isMovement: true, cashFlowActivity: 'FINANCIACION' },
  { code: '4.1.1.01', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '5.1.1.01', name: 'Gastos operacionales', type: 'GASTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' }
];

const entry = (
  id: string,
  entryNumber: number,
  date: string,
  lines: Array<[string, number, number, number, number]>,
  type: JournalEntry['type'] = 'MANUAL'
): JournalEntry => ({
  id, companyId: 'company-1', entryNumber, date,
  description: 'Asiento ' + id, type, bcvRate: 100,
  createdAt: date + 'T12:00:00.000Z',
  items: lines.map(([accountCode, debitBs, creditBs, debitUsd, creditUsd]) => ({
    accountCode,
    accountName: accounts.find(account => account.code === accountCode)?.name || accountCode,
    debitBs, creditBs, debitUsd, creditUsd
  }))
});

// Ejercicio 2018 atraviesa la reconversión del 20-08-2018; ejercicio 2021, la
// reconversión del 01-10-2021. Los importes pre-2018 son bolívares fuertes.
const entries: JournalEntry[] = [
  entry('cap-2018', 1, '2018-06-01', [['1.1.1.01', 1_000_000_000_000, 0, 10, 0], ['3.1.1.01', 0, 1_000_000_000_000, 0, 10]]),
  entry('gasto-2018', 2, '2018-09-01', [['5.1.1.01', 5_000_000, 0, 5, 0], ['1.1.1.01', 0, 5_000_000, 0, 5]]),
  entry('ingreso-2021', 3, '2021-10-15', [['1.1.1.01', 30, 0, 3, 0], ['4.1.1.01', 0, 30, 0, 3]])
];

const assertClose = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, 'esperado ' + expected + ' y se obtuvo ' + actual);

test('la escala del reporte es el cierre del ejercicio y falla con ejercicios inválidos', () => {
  assert.equal(getReportScaleDate(2018), '2018-12-31');
  assert.equal(getReportScaleDate(2021), '2021-12-31');
  assert.throws(() => getReportScaleDate(0), /ejercicio del reporte no es válido/);
  assert.throws(() => reexpressReportAmount(10, '2018-02-30', '2018-12-31'), /fecha contable válida/);
});

test('reexpresa cada importe a la escala del reporte sin alterar el USD', () => {
  assert.equal(reexpressReportAmount(1_000_000_000_000, '2018-06-01', '2018-12-31'), 10_000_000);
  assert.equal(reexpressReportAmount(5_000_000, '2018-09-01', '2018-12-31'), 5_000_000);
  assert.equal(reexpressReportAmount(1_000_000_000_000, '2018-06-01', '2021-12-31'), 10);
  assert.equal(reexpressReportAmountExact(1_000_000_000_000, '2018-06-01', '2021-12-31'), '10');
  assert.equal(reexpressReportAmountExact('0.1', '2021-10-01', '2021-12-31'), '0.1');
});

test('el Balance de Comprobación cruza 2018 en una sola escala y sigue cuadrado', () => {
  const reportDate = getReportScaleDate(2018);
  const reportEntries = entries.filter(entry => entry.date <= reportDate);
  const rows = buildTrialBalanceRows(accounts, reportEntries, [], reportDate);
  const active = rows.filter(row => row.hasMovement);
  const totalDebit = active.reduce((sum, row) => sum + row.totalDebitBs, 0);
  const totalCredit = active.reduce((sum, row) => sum + row.totalCreditBs, 0);
  const debitBalances = active.reduce((sum, row) => sum + row.adjustedDebitBs, 0);
  const creditBalances = active.reduce((sum, row) => sum + row.adjustedCreditBs, 0);
  assertClose(totalDebit, 15_000_000);
  assertClose(totalCredit, 15_000_000);
  assert.equal(isTrialBalanceBalanced({
    totalDebitBs: totalDebit, totalCreditBs: totalCredit,
    debitBalancesBs: debitBalances, creditBalancesBs: creditBalances,
    totalDebitUsd: 15, totalCreditUsd: 15, debitBalancesUsd: 5, creditBalancesUsd: 5
  }), true);
  const cash = active.find(row => row.code === '1.1.1.01');
  assert.ok(cash);
  assertClose(cash.adjustedDebitBs, 5_000_000);
});

test('el Estado de Resultados y el Balance General cuadran en la escala del reporte', () => {
  const reportDate = getReportScaleDate(2018);
  const reportEntries = entries.filter(entry => entry.date <= reportDate);
  const rows = buildTrialBalanceRows(accounts, reportEntries, [], reportDate).filter(row => row.hasMovement);
  const resultRows = buildIncomeStatementRows(accounts, reportEntries, reportDate).filter(row => row.hasMovement);
  const unclosed = getUnclosedResultAtReportDate(reportEntries, accounts, reportDate);

  const assets = rows.filter(row => row.type === 'ACTIVO').reduce((sum, row) => sum + row.adjustedDebitBs - row.adjustedCreditBs, 0);
  const liabilities = rows.filter(row => row.type === 'PASIVO').reduce((sum, row) => sum + row.adjustedCreditBs - row.adjustedDebitBs, 0);
  const equityBase = rows.filter(row => row.type === 'PATRIMONIO').reduce((sum, row) => sum + row.adjustedCreditBs - row.adjustedDebitBs, 0);
  assertClose(assets, 5_000_000);
  assertClose(unclosed.bs, -5_000_000);
  assertClose(liabilities + equityBase + unclosed.bs, assets);
  assert.equal(isBalanceSheetBalanced({
    totalAssetsBs: assets,
    totalLiabilitiesAndEquityBs: liabilities + equityBase + unclosed.bs,
    totalAssetsUsd: 8,
    totalLiabilitiesAndEquityUsd: 8
  }), true);

  const income = resultRows.filter(row => row.type === 'INGRESOS').reduce((sum, row) => sum + row.adjustedCreditBs, 0);
  const expenses = resultRows.filter(row => row.type === 'GASTOS').reduce((sum, row) => sum + row.adjustedDebitBs, 0);
  assertClose(income, 0);
  assertClose(expenses, 5_000_000);
  assertClose(income - expenses, unclosed.bs);
});

test('los reportes del ejercicio 2021 reexpresan saldos iniciales, movimientos y saldos finales', () => {
  const reportDate = getReportScaleDate(2021);
  const reportEntries = entries.filter(entry => entry.date <= reportDate);
  const rows = buildTrialBalanceRows(accounts, reportEntries, [], reportDate).filter(row => row.hasMovement);
  const cash = rows.find(row => row.code === '1.1.1.01');
  assert.ok(cash);
  assertClose(cash.adjustedDebitBs, 35);
  const capital = rows.find(row => row.code === '3.1.1.01');
  assert.ok(capital);
  assertClose(capital.adjustedCreditBs, 10);
  const result = getUnclosedResultAtReportDate(reportEntries, accounts, reportDate);
  assertClose(result.bs, 25);
  const capitalUsd = rows.find(row => row.code === '3.1.1.01');
  assertClose(Number(capitalUsd?.adjustedCreditUsd), 10);
});

test('el Estado de Cambios en el Patrimonio reexpresa apertura, movimientos y resultado', () => {
  const report = buildEquityChangesReport(entries, accounts, 'company-1', 2018, getReportScaleDate(2018));
  assertClose(report.openingTotalBs, 0);
  assertClose(report.movementTotalBs, 5_000_000);
  assertClose(report.periodResultBs, -5_000_000);
  assertClose(report.closingTotalBs, 5_000_000);
  const capital = report.rows.find(row => row.accountCode === '3.1.1.01');
  assert.ok(capital);
  assertClose(capital.movementBs, 10_000_000);
  // El USD conserva los importes registrados, sin reconstruirlos con tasas.
  assertClose(capital.movementUsd, 10);
});

test('el anexo cuantitativo de revelaciones usa la escala del ejercicio', () => {
  const rows = buildDisclosureAccountMovements(entries, accounts, 'company-1', 2018);
  const cash = rows.find(row => row.accountCode === '1.1.1.01');
  assert.ok(cash);
  assertClose(cash.debitBs, 10_000_000);
  assertClose(cash.creditBs, 5_000_000);
  assertClose(cash.debitUsd, 10);
});

test('el Flujo de Efectivo directo e indirecto concilia al cruzar 2021', () => {
  const direct = buildCashFlowReport(entries, accounts, [], 'company-1', 2021);
  assertClose(direct.openingCashBs, 5);
  assertClose(direct.netChangeBs, 30);
  assertClose(direct.closingCashBs, 35);
  assertClose(direct.ledgerClosingCashBs, 35);
  assert.equal(direct.isReconciled, true);

  const indirect = buildCashFlowIndirectReport(entries, accounts, [], 'company-1', 2021);
  assertClose(indirect.netIncomeBs, 30);
  assertClose(indirect.openingCashBs, 5);
  assertClose(indirect.operatingCashFlowBs, 30);
  assertClose(indirect.netChangeBs, 30);
  assertClose(indirect.closingCashBs, 35);
  assertClose(indirect.ledgerClosingCashBs, 35);
  assert.equal(indirect.isReconciled, true);
});

test('las sumas de movimientos por cuenta son homogéneas y conservan el USD de origen', () => {
  const movements = buildReportMovementsByAccount(entries, getReportScaleDate(2021));
  const cash = movements.get('1.1.1.01');
  assert.ok(cash);
  assertClose(cash.debitBs, 40);
  assertClose(cash.creditBs, 5);
  assertClose(cash.debitUsd, 13);
  assertClose(cash.creditUsd, 5);
});

test('el Estado de Resultados y el estado de cambios en el patrimonio coinciden al centavo con el asiento de cierre', () => {
  // Ejercicio 2018 con fracciones de centavo al cruzar la reconversión del
  // 20-08-2018: dos gastos quedan en 10,005 Bs. a la fecha de cierre. El asiento
  // de cierre redondea cada cuenta (10,01) y traslada 0,99; sumar las líneas
  // sin redondear por cuenta daría 1,00.
  const alignmentAccounts: Account[] = [
    { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
    { code: '3.3.1.01', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 4, isMovement: true },
    { code: '4.1.1.01', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true },
    { code: '5.1.1.01', name: 'Gasto A', type: 'GASTOS', level: 4, isMovement: true },
    { code: '5.1.2.01', name: 'Gasto B', type: 'GASTOS', level: 4, isMovement: true }
  ];
  const alignmentEntries: JournalEntry[] = [
    entry('cierre-ingreso', 1, '2018-08-19', [
      ['1.1.1.01', 2_101_000, 0, 100, 0],
      ['4.1.1.01', 0, 2_101_000, 0, 100]
    ]),
    entry('cierre-gasto-a', 2, '2018-08-19', [
      ['5.1.1.01', 1_000_500, 0, 50, 0],
      ['1.1.1.01', 0, 1_000_500, 0, 50]
    ]),
    entry('cierre-gasto-b', 3, '2018-08-19', [
      ['5.1.2.01', 1_000_500, 0, 50, 0],
      ['1.1.1.01', 0, 1_000_500, 0, 50]
    ])
  ];
  const typeByCode = new Map(alignmentAccounts.map(account => [account.code, account.type] as const));
  const isNominal = (code: string) => ['INGRESOS', 'COSTOS', 'GASTOS'].includes(typeByCode.get(code) || '');

  const closingItems = buildClosingEntryItems({
    companyId: 'company-1',
    periodStartDate: '2018-01-01',
    periodEndDate: '2018-12-31',
    accounts: alignmentAccounts,
    journalEntries: alignmentEntries,
    retainedEarningsAccountCode: '3.3.1.01'
  });
  const closedResultBs = roundReportCents(closingItems
    .filter(item => isNominal(item.accountCode))
    .reduce((sum, item) => sum + item.debitBs - item.creditBs, 0));
  const closedResultUsd = roundReportMicroUsd(closingItems
    .filter(item => isNominal(item.accountCode))
    .reduce((sum, item) => sum + item.debitUsd - item.creditUsd, 0));
  assert.equal(closedResultBs, 0.99);
  assert.equal(closedResultUsd, 0);
  const transfer = closingItems.find(item => item.accountCode === '3.3.1.01');
  assert.ok(transfer);
  assert.equal(transfer.creditBs, closedResultBs);

  const resultEntries = selectHistoricalReportEntries(alignmentEntries, 'company-1', 2018, 'RESULTADOS');
  const resultRows = buildIncomeStatementRows(alignmentAccounts, resultEntries, '2018-12-31');
  const incomeBs = resultRows.filter(row => row.type === 'INGRESOS')
    .reduce((sum, row) => sum + row.adjustedCreditBs - row.adjustedDebitBs, 0);
  const expensesBs = resultRows.filter(row => row.type === 'COSTOS' || row.type === 'GASTOS')
    .reduce((sum, row) => sum + row.adjustedDebitBs - row.adjustedCreditBs, 0);
  const incomeUsd = resultRows.filter(row => row.type === 'INGRESOS')
    .reduce((sum, row) => sum + row.adjustedCreditUsd - row.adjustedDebitUsd, 0);
  const expensesUsd = resultRows.filter(row => row.type === 'COSTOS' || row.type === 'GASTOS')
    .reduce((sum, row) => sum + row.adjustedDebitUsd - row.adjustedCreditUsd, 0);
  assert.equal(roundReportCents(expensesBs), 20.02);
  assert.equal(roundReportCents(incomeBs - expensesBs), closedResultBs);
  assert.equal(roundReportMicroUsd(incomeUsd - expensesUsd), closedResultUsd);

  const equity = buildEquityChangesReport(alignmentEntries, alignmentAccounts, 'company-1', 2018, '2018-12-31');
  assert.equal(equity.resultTransferredToEquity, false);
  assert.equal(equity.periodResultBs, closedResultBs);
  assert.equal(equity.periodResultUsd, closedResultUsd);
  const equityResultRow = equity.rows.find(row => row.accountCode === 'RESULTADO-EJERCICIO');
  assert.ok(equityResultRow);
  assert.equal(equityResultRow.movementBs, closedResultBs);

  // La prueba discrimina: sumar las líneas reexpresadas sin redondear por
  // cuenta produce 1,00 y no coincide con el asiento de cierre.
  const unrounded = roundReportCents(alignmentEntries.reduce((sum, source) => sum + source.items.reduce((lineSum, item) => {
    if (!isNominal(item.accountCode)) return lineSum;
    return lineSum + reexpressReportAmount(item.creditBs, source.date, '2018-12-31') -
      reexpressReportAmount(item.debitBs, source.date, '2018-12-31');
  }, 0), 0));
  assert.equal(unrounded, 1);
  assert.notEqual(unrounded, closedResultBs);
});

test('el resultado no cerrado mantiene cuadrada la ecuación del Balance General con fracciones de centavo', () => {
  // Cada cuenta nominal queda a 0,00499 del centavo al reexpresar 2018 desde
  // antes del 20-08: los ingresos redondean hacia abajo y los gastos hacia
  // arriba. Con 12 cuentas, redondear por cuenta acumularía 0,05988, más que la
  // tolerancia de 0,05 del Balance General; por eso el contrapeso no redondea.
  const halfCentAccounts: Account[] = [
    { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
    ...Array.from({ length: 7 }, (_, index) => ({
      code: `4.1.0.0${index + 1}`, name: `Ingreso ${index + 1}`, type: 'INGRESOS' as const, level: 4, isMovement: true
    })),
    ...Array.from({ length: 5 }, (_, index) => ({
      code: `5.1.0.0${index + 1}`, name: `Gasto ${index + 1}`, type: 'GASTOS' as const, level: 4, isMovement: true
    }))
  ];
  const halfCentEntries: JournalEntry[] = [
    ...Array.from({ length: 7 }, (_, index) => entry(`fraccion-ingreso-${index + 1}`, index + 1, '2018-08-19', [
      ['1.1.1.01', 1_234_499, 0, 10, 0],
      [`4.1.0.0${index + 1}`, 0, 1_234_499, 0, 10]
    ])),
    ...Array.from({ length: 5 }, (_, index) => entry(`fraccion-gasto-${index + 1}`, index + 8, '2018-08-19', [
      [`5.1.0.0${index + 1}`, 1_234_501, 0, 10, 0],
      ['1.1.1.01', 0, 1_234_501, 0, 10]
    ]))
  ];

  const trial = buildTrialBalanceRows(halfCentAccounts, halfCentEntries, [], '2018-12-31');
  const totalActivoBs = trial.filter(row => row.type === 'ACTIVO')
    .reduce((sum, row) => sum + row.adjustedDebitBs - row.adjustedCreditBs, 0);
  const totalActivoUsd = trial.filter(row => row.type === 'ACTIVO')
    .reduce((sum, row) => sum + row.adjustedDebitUsd - row.adjustedCreditUsd, 0);

  const unclosed = getUnclosedResultAtReportDate(halfCentEntries, halfCentAccounts, '2018-12-31');
  assertClose(unclosed.bs, 24.68988);
  assertClose(unclosed.bs, totalActivoBs);
  assert.equal(isBalanceSheetBalanced({
    totalAssetsBs: totalActivoBs,
    totalLiabilitiesAndEquityBs: unclosed.bs,
    totalAssetsUsd: totalActivoUsd,
    totalLiabilitiesAndEquityUsd: unclosed.usd
  }), true);

  // Si el Balance General usara el resultado redondeado por cuenta, el desvío
  // supera la tolerancia y la ecuación aparece descuadrada.
  const resultRows = buildIncomeStatementRows(halfCentAccounts, halfCentEntries, '2018-12-31');
  const roundedPerAccountBs =
    resultRows.filter(row => row.type === 'INGRESOS')
      .reduce((sum, row) => sum + row.adjustedCreditBs - row.adjustedDebitBs, 0) -
    resultRows.filter(row => row.type === 'GASTOS')
      .reduce((sum, row) => sum + row.adjustedDebitBs - row.adjustedCreditBs, 0);
  assert.equal(roundReportCents(roundedPerAccountBs), 24.63);
  assert.ok(Math.abs(roundedPerAccountBs - unclosed.bs) > 0.05);
  assert.equal(isBalanceSheetBalanced({
    totalAssetsBs: totalActivoBs,
    totalLiabilitiesAndEquityBs: roundedPerAccountBs,
    totalAssetsUsd: totalActivoUsd,
    totalLiabilitiesAndEquityUsd: unclosed.usd
  }), false);
});
