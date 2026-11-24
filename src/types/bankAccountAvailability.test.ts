import assert from 'node:assert/strict';
import testCase from 'node:test';
import { calculateBankAvailableBalance, calculateCashAccountAvailableBalance, validateBankOutgoingAvailability, buildCashOutgoingPlan } from './bankAccountAvailability';
import type { BankAccount, JournalEntry } from './accounting';

const bank: BankAccount = {
  id: 'bank-1', companyId: 'company-a', accountCode: '1.1.1.06.01',
  bankName: 'Banco de prueba', accountNumber: '01234567890123456789',
  currency: 'BS', initialBalanceBs: 1000, initialBalanceUsd: 4
};

const entry = (overrides: Partial<JournalEntry> & Pick<JournalEntry, 'date' | 'companyId' | 'items'>): JournalEntry => ({
  id: 'entry-' + overrides.date, entryNumber: 1, description: 'Movimiento', type: 'MANUAL',
  bcvRate: 250, createdAt: overrides.date, ...overrides
});

testCase('uses the opening journal entry without double-counting stored initial balance', () => {
  const opening = entry({
    companyId: 'company-a', date: '2026-11-01', referenceDoc: 'APERTURA-01234567890123456789',
    items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 1000, creditBs: 0, debitUsd: 4, creditUsd: 0 }]
  });
  assert.equal(calculateBankAvailableBalance({
    bankAccount: bank, companyId: 'company-a', asOfDate: '2026-11-02', journalEntries: [opening]
  }), 1000);
});

testCase('uses the account initial balance only for legacy accounts without an opening entry', () => {
  const movement = entry({
    companyId: 'company-a', date: '2026-11-02',
    items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 0, creditBs: 250, debitUsd: 0, creditUsd: 1 }]
  });
  assert.equal(calculateBankAvailableBalance({
    bankAccount: bank, companyId: 'company-a', asOfDate: '2026-11-02', journalEntries: [movement]
  }), 750);
});

testCase('filters balances by company and effective date', () => {
  const entries = [
    entry({ companyId: 'company-a', date: '2026-11-01', items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 100, creditBs: 0, debitUsd: 0.4, creditUsd: 0 }] }),
    entry({ companyId: 'company-a', date: '2026-11-04', items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 900, creditBs: 0, debitUsd: 3.6, creditUsd: 0 }] }),
    entry({ companyId: 'company-b', date: '2026-11-01', items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 5000, creditBs: 0, debitUsd: 20, creditUsd: 0 }] })
  ];
  assert.equal(calculateBankAvailableBalance({
    bankAccount: bank, companyId: 'company-a', asOfDate: '2026-11-02', journalEntries: entries
  }), 1100);
});

testCase('calculates availability in the bank account currency, including USD ledger movements', () => {
  const usdBank = { ...bank, currency: 'USD' as const, initialBalanceBs: 0, initialBalanceUsd: 10 };
  const movement = entry({
    companyId: 'company-a', date: '2026-11-02',
    items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 2.123456 }]
  });
  assert.equal(calculateBankAvailableBalance({
    bankAccount: usdBank, companyId: 'company-a', asOfDate: '2026-11-02', journalEntries: [movement]
  }), 7.876544);
});

testCase('calculates both Bs and USD book balances for a USD-denominated bank account', () => {
  const usdBank = { ...bank, currency: 'USD' as const, initialBalanceBs: 1000, initialBalanceUsd: 10 };
  const movement = entry({
    companyId: 'company-a', date: '2026-11-02',
    items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 0, creditBs: 250, debitUsd: 0, creditUsd: 1.25 }]
  });
  const input = { bankAccount: usdBank, companyId: 'company-a', asOfDate: '2026-11-02', journalEntries: [movement] };
  assert.equal(calculateBankAvailableBalance({ ...input, currency: 'BS' }), 750);
  assert.equal(calculateBankAvailableBalance({ ...input, currency: 'USD' }), 8.75);
});

testCase('calculates cash availability from posted Bs ledger movements and effective date', () => {
  const entries = [
    entry({ companyId: 'company-a', date: '2026-11-01', items: [
      { accountCode: '1.1.1.01', accountName: 'Caja Bs.', debitBs: 500, creditBs: 0, debitUsd: 2, creditUsd: 0 }
    ]}),
    entry({ companyId: 'company-a', date: '2026-11-03', items: [
      { accountCode: '1.1.1.01', accountName: 'Caja Bs.', debitBs: 0, creditBs: 120, debitUsd: 0, creditUsd: 0.48 }
    ]}),
    entry({ companyId: 'company-b', date: '2026-11-02', items: [
      { accountCode: '1.1.1.01', accountName: 'Caja Bs.', debitBs: 900, creditBs: 0, debitUsd: 3.6, creditUsd: 0 }
    ]})
  ];
  assert.equal(calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.01', asOfDate: '2026-11-02', journalEntries: entries
  }), 500);
  assert.equal(calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.01', asOfDate: '2026-11-03', journalEntries: entries
  }), 380);
});

testCase('calculates USD cash availability from USD ledger balances', () => {
  const usdCash = entry({ companyId: 'company-a', date: '2026-11-02', items: [
    { accountCode: '1.1.1.02', accountName: 'Caja USD', debitBs: 0, creditBs: 250, debitUsd: 0, creditUsd: 1 }
  ]});
  assert.equal(calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.02', asOfDate: '2026-11-02',
    journalEntries: [usdCash, { ...usdCash, id: 'later', date: '2026-11-03', items: [
      { accountCode: '1.1.1.02', accountName: 'Caja USD', debitBs: 0, creditBs: 0, debitUsd: 2, creditUsd: 0 }
    ]}]
  }), -1);
});

testCase('rejects invalid dates when calculating cash availability', () => {
  assert.throws(() => calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.01', asOfDate: '2026-02-31', journalEntries: []
  }), /fecha de corte/);
});

testCase('allows an outgoing amount up to the exact available balance and rejects any excess', () => {
  assert.doesNotThrow(() => validateBankOutgoingAvailability({
    availableBalance: 100, requestedAmount: 100, currency: 'BS'
  }));
  assert.throws(() => validateBankOutgoingAvailability({
    availableBalance: 100, requestedAmount: 100.01, currency: 'BS'
  }), /Saldo bancario insuficiente/);
  assert.throws(() => validateBankOutgoingAvailability({
    availableBalance: 0.5, requestedAmount: 0.500001, currency: 'USD'
  }), /Saldo bancario insuficiente/);
  assert.throws(() => validateBankOutgoingAvailability({
    availableBalance: -1, requestedAmount: 0.01, currency: 'BS'
  }), /Saldo bancario insuficiente/);
});


testCase('plans net cash withdrawals by currency and ignores same-account offsets', () => {
  const plan = buildCashOutgoingPlan([
    { accountCode: '1.1.1.01', debitBs: 80, creditBs: 120, debitUsd: 0, creditUsd: 0 },
    { accountCode: '1.1.1.01', debitBs: 25, creditBs: 0, debitUsd: 0, creditUsd: 0 },
    { accountCode: '1.1.1.02', debitBs: 0, creditBs: 0, debitUsd: 1.25, creditUsd: 3.5 },
  ]);
  assert.deepEqual(plan, [
    { accountCode: '1.1.1.01', currency: 'BS', amount: 15 },
    { accountCode: '1.1.1.02', currency: 'USD', amount: 2.25 }
  ]);
});

testCase('cash outgoing plan rounds to account precision and excludes net inflows', () => {
  const plan = buildCashOutgoingPlan([
    { accountCode: '1.1.1.01', debitBs: 20, creditBs: 10, debitUsd: 0, creditUsd: 0 },
    { accountCode: '1.1.1.02', debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 1.2345674 }
  ]);
  assert.deepEqual(plan, [{ accountCode: '1.1.1.02', currency: 'USD', amount: 1.234567 }]);
});


testCase('normalizes historical cash Bs movements into the scale effective on the balance date', () => {
  const historical = entry({ companyId: 'company-a', date: '2018-08-20', items: [
    { accountCode: '1.1.1.01', accountName: 'Caja Bs.', debitBs: 100, creditBs: 0, debitUsd: 0, creditUsd: 0 }
  ]});
  assert.equal(calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.01', asOfDate: '2021-10-01', journalEntries: [historical]
  }), 0.0001);
});
