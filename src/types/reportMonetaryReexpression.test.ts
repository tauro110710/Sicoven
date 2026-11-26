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
  reexpressReportAmountExact
} from './reportMonetaryReexpression';
import { isBalanceSheetBalanced, isTrialBalanceBalanced } from './accountingReportIntegrity';
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
