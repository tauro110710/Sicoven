import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, BankAccount, JournalEntry } from './accounting';
import {
  getUnclosedResultContribution,
  isBalanceSheetBalanced,
  isTrialBalanceBalanced,
  selectHistoricalReportEntries
} from './accountingReportIntegrity';
import { buildCashFlowReport } from './cashFlowStatement';
import { buildEquityChangesReport } from './equityChanges';
import { buildOpeningEntryItems } from './accountingYearOpening';

const companyId = 'basic-cert-company-a';
const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Banco', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
  { code: '1.1.2.01', name: 'Cuentas por cobrar', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '3.1.1.01', name: 'Capital social', type: 'PATRIMONIO', level: 4, isMovement: true, cashFlowActivity: 'FINANCIACION' },
  { code: '3.1.2.01', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 4, isMovement: true },
  { code: '4.1.1.01', name: 'Ingresos por ventas', type: 'INGRESOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '5.1.1.01', name: 'Costo de ventas', type: 'COSTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '6.1.1.01', name: 'Gastos operativos', type: 'GASTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' }
];

const bankAccounts: BankAccount[] = [{
  id: 'basic-cert-bank',
  companyId,
  accountCode: '1.1.1.01',
  bankName: 'Banco de certificación',
  accountNumber: '00000000000000000001',
  currency: 'BS',
  initialBalanceBs: 0,
  initialBalanceUsd: 0
}];

const line = (accountCode: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) => ({
  accountCode,
  accountName: accounts.find(account => account.code === accountCode)?.name || accountCode,
  debitBs, creditBs, debitUsd, creditUsd
});

const entry = (
  id: string,
  company: string,
  entryNumber: number,
  date: string,
  type: JournalEntry['type'],
  items: JournalEntry['items'],
  exerciseLink?: JournalEntry['exerciseLink']
): JournalEntry => ({
  id, companyId: company, entryNumber, date, type,
  description: id, bcvRate: 100, items,
  createdAt: date + 'T12:00:00.000Z',
  ...(exerciseLink ? { exerciseLink } : {})
});

const entries: JournalEntry[] = [
  entry('opening-2026', companyId, 1, '2026-01-01', 'APERTURA', [
    line('1.1.1.01', 1000, 0, 10, 0),
    line('3.1.1.01', 0, 1000, 0, 10)
  ], {
    priorPeriodStartDate: '2025-01-01',
    priorPeriodEndDate: '2025-12-31',
    nextPeriodStartDate: '2026-01-01'
  }),
  entry('sale-credit-001', companyId, 2, '2026-01-15', 'VENTA', [
    line('1.1.2.01', 500, 0, 5, 0),
    line('4.1.1.01', 0, 500, 0, 5)
  ]),
  entry('customer-receipt-001', companyId, 3, '2026-01-20', 'MANUAL', [
    line('1.1.1.01', 300, 0, 3, 0),
    line('1.1.2.01', 0, 300, 0, 3)
  ]),
  entry('purchase-credit-001', companyId, 4, '2026-01-21', 'COMPRA', [
    line('1.1.4.01', 200, 0, 2, 0),
    line('2.1.1.01', 0, 200, 0, 2)
  ]),
  entry('supplier-payment-001', companyId, 5, '2026-01-25', 'MANUAL', [
    line('2.1.1.01', 100, 0, 1, 0),
    line('1.1.1.01', 0, 100, 0, 1)
  ]),
  entry('operating-expense-001', companyId, 6, '2026-01-26', 'MANUAL', [
    line('6.1.1.01', 50, 0, 0.5, 0),
    line('1.1.1.01', 0, 50, 0, 0.5)
  ]),
  entry('cost-of-sales-001', companyId, 7, '2026-01-27', 'MANUAL', [
    line('5.1.1.01', 100, 0, 1, 0),
    line('1.1.4.01', 0, 100, 0, 1)
  ]),
  // Deliberately large unrelated-company balances must never leak into company A's reports.
  entry('other-company-opening', 'basic-cert-company-b', 1, '2026-01-01', 'APERTURA', [
    line('1.1.1.01', 99999, 0, 999.99, 0),
    line('3.1.1.01', 0, 99999, 0, 999.99)
  ])
];

test('Basic accounting acceptance: one ledger reconciles trial balance, financial position, results, equity, cash flow and next-year opening', () => {
  const situationEntries = selectHistoricalReportEntries(entries, companyId, 2026, 'SITUACION');
  const resultEntries = selectHistoricalReportEntries(entries, companyId, 2026, 'RESULTADOS');
  assert.equal(situationEntries.length, 7);
  assert.equal(resultEntries.length, 6);
  assert.equal(situationEntries.some(item => item.companyId !== companyId), false);

  const totals = accounts.filter(account => account.isMovement).reduce((sum, account) => {
    const movements = situationEntries.flatMap(item => item.items).filter(item => item.accountCode === account.code);
    const debitBs = movements.reduce((value, item) => value + item.debitBs, 0);
    const creditBs = movements.reduce((value, item) => value + item.creditBs, 0);
    const debitUsd = movements.reduce((value, item) => value + item.debitUsd, 0);
    const creditUsd = movements.reduce((value, item) => value + item.creditUsd, 0);
    // Trial-balance debit/credit columns always follow raw debit minus credit,
    // independently of the account's normal balance nature.
    const netBs = debitBs - creditBs;
    const netUsd = debitUsd - creditUsd;
    if (netBs > 0) sum.debitBalancesBs += netBs;
    else sum.creditBalancesBs += Math.abs(netBs);
    if (netUsd > 0) sum.debitBalancesUsd += netUsd;
    else sum.creditBalancesUsd += Math.abs(netUsd);
    sum.totalDebitBs += debitBs;
    sum.totalCreditBs += creditBs;
    sum.totalDebitUsd += debitUsd;
    sum.totalCreditUsd += creditUsd;
    return sum;
  }, {
    totalDebitBs: 0, totalCreditBs: 0, debitBalancesBs: 0, creditBalancesBs: 0,
    totalDebitUsd: 0, totalCreditUsd: 0, debitBalancesUsd: 0, creditBalancesUsd: 0
  });
  assert.equal(totals.totalDebitBs, 2250);
  assert.equal(totals.totalCreditBs, 2250);
  assert.equal(totals.totalDebitUsd, 22.5);
  assert.equal(totals.totalCreditUsd, 22.5);
  assert.equal(totals.debitBalancesBs, 1600);
  assert.equal(totals.creditBalancesBs, 1600);
  assert.equal(totals.debitBalancesUsd, 16);
  assert.equal(totals.creditBalancesUsd, 16);
  assert.equal(isTrialBalanceBalanced(totals), true);

  const byType = (type: Account['type'], field: 'debitBs' | 'creditBs' | 'debitUsd' | 'creditUsd') =>
    resultEntries.flatMap(item => item.items)
      .filter(item => accounts.find(account => account.code === item.accountCode)?.type === type)
      .reduce((sum, item) => sum + item[field], 0);
  const incomeBs = byType('INGRESOS', 'creditBs') - byType('INGRESOS', 'debitBs');
  const costBs = byType('COSTOS', 'debitBs') - byType('COSTOS', 'creditBs');
  const expenseBs = byType('GASTOS', 'debitBs') - byType('GASTOS', 'creditBs');
  const incomeUsd = byType('INGRESOS', 'creditUsd') - byType('INGRESOS', 'debitUsd');
  const costUsd = byType('COSTOS', 'debitUsd') - byType('COSTOS', 'creditUsd');
  const expenseUsd = byType('GASTOS', 'debitUsd') - byType('GASTOS', 'creditUsd');
  const netIncomeBs = incomeBs - costBs - expenseBs;
  const netIncomeUsd = incomeUsd - costUsd - expenseUsd;
  assert.equal(incomeBs, 500);
  assert.equal(costBs, 100);
  assert.equal(expenseBs, 50);
  assert.equal(netIncomeBs, 350);
  assert.equal(netIncomeUsd, 3.5);
  assert.deepEqual(getUnclosedResultContribution('INGRESOS', 0, 500, 0, 5), { bs: 500, usd: 5 });

  const netByType = (type: Account['type'], currency: 'bs' | 'usd') =>
    situationEntries.flatMap(item => item.items).reduce((sum, item) => {
      const account = accounts.find(candidate => candidate.code === item.accountCode);
      if (account?.type !== type) return sum;
      return sum + (currency === 'bs'
        ? item.debitBs - item.creditBs
        : item.debitUsd - item.creditUsd);
    }, 0);
  const assetsBs = netByType('ACTIVO', 'bs');
  const liabilitiesBs = -netByType('PASIVO', 'bs');
  const capitalBs = -netByType('PATRIMONIO', 'bs');
  const equityBs = capitalBs + netIncomeBs;
  const assetsUsd = netByType('ACTIVO', 'usd');
  const liabilitiesUsd = -netByType('PASIVO', 'usd');
  const capitalUsd = -netByType('PATRIMONIO', 'usd');
  const equityUsd = capitalUsd + netIncomeUsd;
  assert.equal(assetsBs, 1450);
  assert.equal(liabilitiesBs, 100);
  assert.equal(capitalBs, 1000);
  assert.equal(equityBs, 1350);
  assert.equal(isBalanceSheetBalanced({
    totalAssetsBs: assetsBs,
    totalLiabilitiesAndEquityBs: liabilitiesBs + equityBs,
    totalAssetsUsd: assetsUsd,
    totalLiabilitiesAndEquityUsd: liabilitiesUsd + equityUsd
  }), true);

  const equity = buildEquityChangesReport(entries, accounts, companyId, 2026);
  assert.equal(equity.openingTotalBs, 1000);
  assert.equal(equity.periodResultBs, 350);
  assert.equal(equity.closingTotalBs, 1350);
  assert.equal(equity.closingTotalUsd, 13.5);

  const cash = buildCashFlowReport(entries, accounts, bankAccounts, companyId, 2026);
  assert.equal(cash.openingCashBs, 1000);
  assert.equal(cash.netChangeBs, 150);
  assert.equal(cash.closingCashBs, 1150);
  assert.equal(cash.ledgerClosingCashBs, 1150);
  assert.equal(cash.isFullyClassified, true);
  assert.equal(cash.isReconciled, true);

  const nextOpening = buildOpeningEntryItems({
    companyId,
    periodStartDate: '2026-01-01',
    periodEndDate: '2026-12-31',
    openingDate: '2027-01-01',
    accounts,
    journalEntries: entries,
    retainedEarningsAccountCode: '3.1.2.01'
  });
  const openingTotals = nextOpening.reduce((sum, item) => ({
    debitBs: sum.debitBs + item.debitBs,
    creditBs: sum.creditBs + item.creditBs,
    debitUsd: sum.debitUsd + item.debitUsd,
    creditUsd: sum.creditUsd + item.creditUsd
  }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
  assert.equal(Math.abs(openingTotals.debitBs - openingTotals.creditBs) < 0.01, true);
  assert.equal(Math.abs(openingTotals.debitUsd - openingTotals.creditUsd) < 0.000001, true);
  assert.equal(nextOpening.find(item => item.accountCode === '3.1.2.01')?.creditBs, 350);
  assert.equal(nextOpening.some(item => item.accountCode === '4.1.1.01' || item.accountCode === '5.1.1.01' || item.accountCode === '6.1.1.01'), false);
});
