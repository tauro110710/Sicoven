import assert from 'node:assert/strict';
import testCase from 'node:test';
import { calculateBankAvailableBalance, calculateBsLedgerBalanceAtDate, calculateCashAccountAvailableBalance, validateBankOutgoingAvailability, buildCashOutgoingPlan } from './bankAccountAvailability';
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


// --- Reexpresión monetaria de saldos bancarios (2008, 2018, 2021) ---

const bankMovement = (date: string, bs: { debit?: number; credit?: number }, usd: { debit?: number; credit?: number } = {}) => entry({
  companyId: 'company-a', date,
  items: [{
    accountCode: bank.accountCode, accountName: 'Banco',
    debitBs: bs.debit ?? 0, creditBs: bs.credit ?? 0,
    debitUsd: usd.debit ?? 0, creditUsd: usd.credit ?? 0
  }]
});

testCase('reexpresses an opening entry from the 2008 reconversion to the query scale', () => {
  const opening = entry({
    companyId: 'company-a', date: '2007-12-31', referenceDoc: 'APERTURA-01234567890123456789', type: 'APERTURA',
    items: [{ accountCode: bank.accountCode, accountName: 'Banco', debitBs: 1_000_000, creditBs: 0, debitUsd: 0, creditUsd: 0 }]
  });
  assert.equal(calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 1_000_000, openingDate: '2007-12-31' },
    companyId: 'company-a', asOfDate: '2008-01-15', journalEntries: [opening]
  }), 1000);
});

testCase('reexpresses legacy initial balances from the account opening date without an opening entry', () => {
  const legacy = { ...bank, initialBalanceBs: 100_000_000, openingDate: '2007-06-30' };
  assert.equal(calculateBankAvailableBalance({
    bankAccount: legacy, companyId: 'company-a', asOfDate: '2008-01-02', journalEntries: []
  }), 100_000);
  assert.equal(calculateBankAvailableBalance({
    bankAccount: legacy, companyId: 'company-a', asOfDate: '2018-08-21', journalEntries: []
  }), 1);
  assert.equal(calculateBankAvailableBalance({
    bankAccount: legacy, companyId: 'company-a', asOfDate: '2021-10-01', journalEntries: []
  }), 0);
  assert.equal(calculateBankAvailableBalance({
    bankAccount: legacy, companyId: 'company-a', asOfDate: '2010-01-01', journalEntries: []
  }), 100_000);
});

testCase('uses a single monetary scale when movements cross 2018-08-20', () => {
  const entries = [
    bankMovement('2018-08-19', { debit: 100_000 }),
    bankMovement('2018-08-20', { debit: 500 })
  ];
  assert.equal(calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2018-08-19', journalEntries: entries
  }), 100_000);
  assert.equal(calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2018-08-21', journalEntries: entries
  }), 501);
});

testCase('reexpresses bank movements across the 2021 reconversion', () => {
  const entries = [
    bankMovement('2021-09-30', { debit: 2_000_000 }),
    bankMovement('2021-10-01', { debit: 3 })
  ];
  assert.equal(calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2021-10-01', journalEntries: entries
  }), 5);
});

testCase('sums three monetary eras without producing enormous or tiny balances', () => {
  const entries = [
    bankMovement('2007-12-31', { debit: 100_000_000 }),
    bankMovement('2018-08-19', { debit: 100_000 }),
    bankMovement('2018-08-20', { debit: 5 })
  ];
  const input = {
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a',
    asOfDate: '2018-08-21', journalEntries: entries
  };
  assert.equal(calculateBankAvailableBalance(input), 7);
  const credits = [
    bankMovement('2007-12-31', { credit: 100_000_000 }),
    bankMovement('2018-08-19', { credit: 100_000 })
  ];
  assert.equal(calculateBankAvailableBalance({ ...input, journalEntries: credits }), -2);
});

testCase('keeps USD bank movements untouched by the Bs reconversions', () => {
  const usdBank = { ...bank, currency: 'USD' as const, initialBalanceUsd: 10, initialBalanceBs: 0 };
  const entries = [
    bankMovement('2007-12-31', {}, { debit: 2 }),
    bankMovement('2018-08-19', {}, { debit: 3 }),
    bankMovement('2021-10-01', { credit: 4_000_000 }, { credit: 4 })
  ];
  assert.equal(calculateBankAvailableBalance({
    bankAccount: usdBank, companyId: 'company-a', asOfDate: '2026-11-26', journalEntries: entries
  }), 11);
});

testCase('rejects a payment larger than the reexpressed balance, not the raw historical sum', () => {
  const entries = [
    bankMovement('2018-08-19', { debit: 100_000 }),
    bankMovement('2018-08-20', { debit: 500 })
  ];
  const availableBalance = calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2018-08-21', journalEntries: entries
  });
  // El saldo bruto histórico (100.500) sería engañoso: en la escala vigente solo hay 501.
  assert.equal(availableBalance, 501);
  assert.doesNotThrow(() => validateBankOutgoingAvailability({ availableBalance, requestedAmount: 501, currency: 'BS' }));
  assert.throws(() => validateBankOutgoingAvailability({ availableBalance, requestedAmount: 501.01, currency: 'BS' }),
    /Saldo bancario insuficiente\. Disponible: 501\.00 Bs\.; solicitado: 501\.01 Bs\./);
  assert.throws(() => validateBankOutgoingAvailability({ availableBalance, requestedAmount: 100_500, currency: 'BS' }),
    /Saldo bancario insuficiente/);
});

testCase('validates a transfer against the reexpressed bank balance at the transfer date', () => {
  const entries = [bankMovement('2018-08-19', { debit: 100_000 })];
  const input = { bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', journalEntries: entries };
  const atCutover = calculateBankAvailableBalance({ ...input, asOfDate: '2018-08-20' });
  const beforeCutover = calculateBankAvailableBalance({ ...input, asOfDate: '2018-08-19' });
  assert.equal(atCutover, 1);
  assert.equal(beforeCutover, 100_000);
  assert.doesNotThrow(() => validateBankOutgoingAvailability({ availableBalance: atCutover, requestedAmount: 1, currency: 'BS' }));
  assert.throws(() => validateBankOutgoingAvailability({ availableBalance: atCutover, requestedAmount: 2, currency: 'BS' }), /insuficiente/);
  assert.doesNotThrow(() => validateBankOutgoingAvailability({ availableBalance: beforeCutover, requestedAmount: 100_000, currency: 'BS' }));
});

testCase('does not turn rounding residue into a negative bank balance', () => {
  const entries = [bankMovement('2018-08-19', { debit: 0.001 })];
  const balance = calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2018-08-21', journalEntries: entries
  });
  assert.equal(balance, 0);
  assert.equal(Object.is(balance, -0), false);
  assert.throws(() => validateBankOutgoingAvailability({ availableBalance: balance, requestedAmount: 0.01, currency: 'BS' }), /insuficiente/);
});

testCase('excludes movements after the cut-off date and rejects invalid ledger dates', () => {
  const entries = [
    bankMovement('2018-08-19', { debit: 100_000 }),
    bankMovement('2018-08-22', { debit: 999_999 })
  ];
  assert.equal(calculateBankAvailableBalance({
    bankAccount: { ...bank, initialBalanceBs: 0 }, companyId: 'company-a', asOfDate: '2018-08-20', journalEntries: entries
  }), 1);
  assert.throws(() => calculateBsLedgerBalanceAtDate({
    companyId: 'company-a', accountCode: bank.accountCode, asOfDate: '2018-08-31',
    journalEntries: [bankMovement('2018-02-30', { debit: 1 })]
  }), /fecha inválida/);
  assert.throws(() => calculateBankAvailableBalance({
    bankAccount: bank, companyId: 'company-a', asOfDate: '2018-02-30', journalEntries: []
  }), /fecha de corte/);
});

testCase('rounds historical cash Bs availability to the account posting precision', () => {
  const historical = entry({ companyId: 'company-a', date: '2018-08-20', items: [
    { accountCode: '1.1.1.01', accountName: 'Caja Bs.', debitBs: 100, creditBs: 0, debitUsd: 0, creditUsd: 0 }
  ]});
  assert.equal(calculateCashAccountAvailableBalance({
    companyId: 'company-a', accountCode: '1.1.1.01', asOfDate: '2021-10-01', journalEntries: [historical]
  }), 0);
});
