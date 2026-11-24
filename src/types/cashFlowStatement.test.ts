import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account, BankAccount, JournalEntry } from './accounting';
import { buildCashFlowReport } from './cashFlowStatement';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
  { code: '4.1', name: 'Ingresos operacionales', type: 'INGRESOS', level: 2, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '5.1', name: 'Gastos operacionales', type: 'GASTOS', level: 2, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '3.1', name: 'Capital social', type: 'PATRIMONIO', level: 2, isMovement: true, cashFlowActivity: 'FINANCIACION' },
  { code: '1.2', name: 'Propiedad, planta y equipo', type: 'ACTIVO', level: 2, isMovement: true, cashFlowActivity: 'INVERSION' }
];
const banks: BankAccount[] = [
  { id: 'bank-1', companyId: 'co-1', accountCode: '1.1.1.03', bankName: 'Banco A', accountNumber: '12345678901234567890', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 },
  { id: 'bank-2', companyId: 'co-1', accountCode: '1.1.1.04', bankName: 'Banco B', accountNumber: '12345678901234567891', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 }
];
const entry = (id: string, date: string, type: JournalEntry['type'], items: JournalEntry['items'], exerciseLink?: JournalEntry['exerciseLink']): JournalEntry => ({
  id, companyId: 'co-1', entryNumber: Number(id.replace(/\D/g, '')) || 1,
  date, description: id, type, bcvRate: 1, items, createdAt: date, exerciseLink
  it('includes cash movements posted after a prior annual opening on the same date in the carry-forward', () => {
    const priorOpening = entry('opening-2025', '2025-01-01', 'APERTURA', [
      line('1.1.1.01', 'Caja principal', 200, 0, 20, 0),
      line('3.1', 'Capital social', 0, 200, 0, 20)
    ], { priorPeriodStartDate: '2024-01-01', priorPeriodEndDate: '2024-12-31', nextPeriodStartDate: '2025-01-01' });
    const sameDayReceipt = entry('receipt-2025-sameday', '2025-01-01', 'VENTA', [
      line('1.1.1.01', 'Caja principal', 30, 0, 3, 0),
      line('4.1', 'Ingresos operacionales', 0, 30, 0, 3)
    ]);
    const report = buildCashFlowReport([sameDayReceipt, priorOpening], accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 230);
    assert.equal(report.openingCashUsd, 23);
    assert.equal(report.closingCashBs, 230);
    assert.equal(report.ledgerClosingCashBs, 230);
    assert.equal(report.reconciliationDifferenceBs, 0);
    assert.equal(report.isReconciled, true);
  });

});
const line = (accountCode: string, accountName: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) => ({
  accountCode, accountName, debitBs, creditBs, debitUsd, creditUsd
});

describe('cash flow statement', () => {
  it('classifies operating receipts and payments and reconciles cash in both currencies', () => {
    const entries = [
      entry('opening-2025', '2025-01-01', 'APERTURA', [line('1.1.1.01', 'Caja principal', 50, 0, 5, 0)]),
      entry('receipt-1', '2026-02-01', 'VENTA', [
        line('1.1.1.01', 'Caja principal', 100, 0, 10, 0),
        line('4.1', 'Ingresos operacionales', 0, 100, 0, 10)
      ]),
      entry('payment-1', '2026-03-01', 'MANUAL', [
        line('5.1', 'Gastos operacionales', 40, 0, 4, 0),
        line('1.1.1.01', 'Caja principal', 0, 40, 0, 4)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 50);
    assert.equal(report.openingCashUsd, 5);
    assert.equal(report.netChangeBs, 60);
    assert.equal(report.netChangeUsd, 6);
    assert.equal(report.closingCashBs, 110);
    assert.equal(report.closingCashUsd, 11);
    assert.equal(report.activities.OPERACION.receiptsBs, 100);
    assert.equal(report.activities.OPERACION.paymentsBs, 40);
    assert.equal(report.activities.OPERACION.netBs, 60);
    assert.equal(report.activities.OPERACION.receiptsUsd, 10);
    assert.equal(report.activities.OPERACION.paymentsUsd, 4);
    assert.equal(report.activities.OPERACION.netUsd, 6);
    assert.equal(report.isFullyClassified, true);
    assert.equal(report.isReconciled, true);
  });

  it('separates investing payments from financing receipts', () => {
    const entries = [
      entry('investment-1', '2026-02-01', 'MANUAL', [
        line('1.2', 'Propiedad, planta y equipo', 75, 0, 7.5, 0),
        line('1.1.1.01', 'Caja principal', 0, 75, 0, 7.5)
      ]),
      entry('financing-1', '2026-03-01', 'MANUAL', [
        line('1.1.1.01', 'Caja principal', 200, 0, 20, 0),
        line('3.1', 'Capital social', 0, 200, 0, 20)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.activities.INVERSION.paymentsBs, 75);
    assert.equal(report.activities.INVERSION.netBs, -75);
    assert.equal(report.activities.FINANCIACION.receiptsBs, 200);
    assert.equal(report.activities.FINANCIACION.netBs, 200);
    assert.equal(report.netChangeBs, 125);
    assert.equal(report.isFullyClassified, true);
    assert.equal(report.isReconciled, true);
  });

  it('rejects malformed dates and invalid monetary values instead of silently treating them as zero', () => {
    const invalidAmount = entry('invalid-amount', '2026-02-01', 'MANUAL', [
      line('1.1.1.01', 'Caja principal', Number.NaN, 0, 1, 0),
      line('4.1', 'Ingresos operacionales', 0, 0, 0, 1)
    ]);
    assert.throws(() => buildCashFlowReport([invalidAmount], accounts, banks, 'co-1', 2026), /importes inválidos/);
    const negativeAmount = entry('negative-amount', '2026-02-01', 'MANUAL', [
      line('1.1.1.01', 'Caja principal', 0, 0, -1, 0),
      line('4.1', 'Ingresos operacionales', 0, 0, 0, 1)
    ]);
    assert.throws(() => buildCashFlowReport([negativeAmount], accounts, banks, 'co-1', 2026), /importes inválidos/);
    const invalidDate = entry('invalid-date', '2026-02-30', 'MANUAL', [
      line('1.1.1.01', 'Caja principal', 100, 0, 1, 0),
      line('4.1', 'Ingresos operacionales', 0, 100, 0, 1)
    ]);
    assert.throws(() => buildCashFlowReport([invalidDate], accounts, banks, 'co-1', 2026), /fecha inválida/);
  });

  it('does not classify transfers between company cash accounts as operating flows', () => {
    const entries = [
      entry('transfer-1', '2026-02-01', 'MANUAL', [
        line('1.1.1.03', 'Banco A', 0, 25, 0, 2.5),
        line('1.1.1.04', 'Banco B', 25, 0, 2.5, 0)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.netChangeBs, 0);
    assert.equal(report.activities.OPERACION.netBs, 0);
    assert.equal(report.isReconciled, true);
  });

  it('marks cash movements with unclassified counterpart accounts instead of inventing activity', () => {
    const entries = [
      entry('unclassified-1', '2026-02-01', 'MANUAL', [
        line('1.1.1.01', 'Caja principal', 0, 30, 0, 3),
        line('3.1', 'Capital social', 30, 0, 3, 0)
      ])
    ];
    const unclassifiedAccounts = accounts.map(account => account.code === '3.1' ? { ...account, cashFlowActivity: undefined } : account);
    const report = buildCashFlowReport(entries, unclassifiedAccounts, banks, 'co-1', 2026);
    assert.equal(report.unclassifiedNetBs, -30);
    assert.equal(report.activities.SIN_CLASIFICAR.paymentsBs, 30);
    assert.equal(report.isFullyClassified, false);
    assert.equal(report.lines.length, 1);
    assert.equal(report.lines[0].activity, 'SIN_CLASIFICAR');
    assert.equal(report.isReconciled, true);
  });

  it('does not mark offsetting unclassified receipts and payments as complete', () => {
    const entries = [
      entry('unclassified-in', '2026-02-01', 'MANUAL', [
        line('1.1.1.01', 'Caja principal', 0, 25, 0, 2.5),
        line('3.1', 'Capital social', 25, 0, 2.5, 0)
      ]),
      entry('unclassified-out', '2026-03-01', 'MANUAL', [
        line('1.1.1.01', 'Caja principal', 25, 0, 2.5, 0),
        line('3.1', 'Capital social', 0, 25, 0, 2.5)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts.map(account => account.code === '3.1' ? { ...account, cashFlowActivity: undefined } : account), banks, 'co-1', 2026);
    assert.equal(report.unclassifiedNetBs, 0);
    assert.equal(report.activities.SIN_CLASIFICAR.receiptsBs + report.activities.SIN_CLASIFICAR.paymentsBs, 50);
    assert.equal(report.isFullyClassified, false);
  });

  it('uses a prior annual opening as the carry-forward boundary when the current year has no opening', () => {
    const olderOpening = entry('opening-2024', '2024-01-01', 'APERTURA', [
      line('1.1.1.01', 'Caja principal', 100, 0, 10, 0),
      line('3.1', 'Capital social', 0, 100, 0, 10)
    ], { priorPeriodStartDate: '2023-01-01', priorPeriodEndDate: '2023-12-31', nextPeriodStartDate: '2024-01-01' });
    const priorOpening = entry('opening-2025', '2025-01-01', 'APERTURA', [
      line('1.1.1.01', 'Caja principal', 200, 0, 20, 0),
      line('3.1', 'Capital social', 0, 200, 0, 20)
    ], { priorPeriodStartDate: '2024-01-01', priorPeriodEndDate: '2024-12-31', nextPeriodStartDate: '2025-01-01' });
    const priorMovement = entry('prior-receipt', '2025-06-01', 'VENTA', [
      line('1.1.1.01', 'Caja principal', 50, 0, 5, 0),
      line('4.1', 'Ingresos operacionales', 0, 50, 0, 5)
    ]);
    const currentMovement = entry('current-payment', '2026-06-01', 'MANUAL', [
      line('5.1', 'Gastos operacionales', 20, 0, 2, 0),
      line('1.1.1.01', 'Caja principal', 0, 20, 0, 2)
    ]);
    // Deliberately shuffle history: the most recent linked opening must be chosen by date, not array order.
    const report = buildCashFlowReport([priorOpening, currentMovement, olderOpening, priorMovement], accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 250);
    assert.equal(report.openingCashUsd, 25);
    assert.equal(report.netChangeBs, -20);
    assert.equal(report.netChangeUsd, -2);
    assert.equal(report.closingCashBs, 230);
    assert.equal(report.ledgerClosingCashBs, 230);
    assert.equal(report.isReconciled, true);
  });

  it('counts a same-day reversal of the linked annual opening as a period cash flow', () => {
    const opening = entry('opening-2026', '2026-01-01', 'APERTURA', [
      line('1.1.1.01', 'Caja principal', 100, 0, 10, 0),
      line('3.1', 'Capital social', 0, 100, 0, 10)
    ], { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01' });
    const reversal = entry('reversal-opening-2026', '2026-01-01', 'AJUSTE', [
      line('3.1', 'Capital social', 100, 0, 10, 0),
      line('1.1.1.01', 'Caja principal', 0, 100, 0, 10)
    ]);
    reversal.reversalOfEntryId = opening.id;
    opening.reversedByEntryId = reversal.id;
    const report = buildCashFlowReport([opening, reversal], accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 100);
    assert.equal(report.netChangeBs, -100);
    assert.equal(report.closingCashBs, 0);
    assert.equal(report.isReconciled, true);
  });

  it('treats a linked annual opening as opening cash, not as a period cash flow', () => {
    const entries = [
      entry('prior-year-cash', '2025-12-31', 'MANUAL', [
        line('1.1.1.01', 'Caja principal', 50, 0, 5, 0),
        line('3.1', 'Capital social', 0, 50, 0, 5)
      ]),
      entry('annual-opening-2026', '2026-01-01', 'APERTURA', [
        line('1.1.1.01', 'Caja principal', 500, 0, 50, 0),
        line('3.1', 'Capital social', 0, 500, 0, 50)
      ], { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01' })
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 500);
    assert.equal(report.openingCashUsd, 50);
    assert.equal(report.netChangeBs, 0);
    assert.equal(report.closingCashBs, 500);
    assert.equal(report.ledgerClosingCashBs, 500);
    assert.equal(report.reconciliationDifferenceBs, 0);
    assert.equal(report.activities.FINANCIACION.netBs, 0);
    assert.equal(report.isReconciled, true);
  });

  it('isolates companies and rejects invalid report periods', () => {
    assert.throws(() => buildCashFlowReport([], accounts, banks, '', 2026));
    assert.throws(() => buildCashFlowReport([], accounts, banks, 'co-1', 0));
    const other = entry('other-1', '2026-01-01', 'MANUAL', [line('1.1.1.01', 'Caja principal', 0, 50, 0, 5)]);
    other.companyId = 'co-2';
    assert.equal(buildCashFlowReport([other], accounts, banks, 'co-1', 2026).closingCashBs, 0);
  });
  it('normalizes historical Bs opening cash and direct cash flows to the current monetary scale', () => {
    const entries = [
      entry('opening-2013', '2013-01-01', 'APERTURA', [
        line('1.1.1.01', 'Caja principal', 200000000000, 0, 2, 0),
        line('3.1', 'Capital social', 0, 200000000000, 0, 2)
      ]),
      entry('receipt-2014', '2014-02-01', 'VENTA', [
        line('1.1.1.01', 'Caja principal', 100000000000, 0, 1, 0),
        line('4.1', 'Ingresos operacionales', 0, 100000000000, 0, 1)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2014);
    assert.equal(report.openingCashBs, 2);
    assert.equal(report.netChangeBs, 1);
    assert.equal(report.closingCashBs, 3);
    assert.equal(report.ledgerClosingCashBs, 3);
    assert.equal(report.reconciliationDifferenceBs, 0);
    assert.equal(report.activities.OPERACION.receiptsBs, 1);
    assert.equal(report.activities.OPERACION.netBs, 1);
    assert.equal(report.openingCashUsd, 2);
    assert.equal(report.netChangeUsd, 1);
    assert.equal(report.closingCashUsd, 3);
    assert.equal(report.isReconciled, true);
    assert.equal(report.isFullyClassified, true);
  });

  it('excludes entries after year end from cash movement and reconciliation', () => {
    const entries = [
      entry('opening-2025', '2025-01-01', 'APERTURA', [
        line('1.1.1.01', 'Caja principal', 50, 0, 5, 0),
        line('3.1', 'Capital social', 0, 50, 0, 5)
      ]),
      entry('receipt-2026', '2026-12-31', 'VENTA', [
        line('1.1.1.01', 'Caja principal', 100, 0, 10, 0),
        line('4.1', 'Ingresos operacionales', 0, 100, 0, 10)
      ]),
      entry('receipt-2027', '2027-01-01', 'VENTA', [
        line('1.1.1.01', 'Caja principal', 900, 0, 90, 0),
        line('4.1', 'Ingresos operacionales', 0, 900, 0, 90)
      ])
    ];
    const report = buildCashFlowReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 50);
    assert.equal(report.netChangeBs, 100);
    assert.equal(report.closingCashBs, 150);
    assert.equal(report.ledgerClosingCashBs, 150);
    assert.equal(report.reconciliationDifferenceBs, 0);
    assert.equal(report.isReconciled, true);
  });

});