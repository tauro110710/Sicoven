import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBankStatementLine, matchesBankStatementDualCurrency, validateBankMovementFxSnapshot, isDuplicateBankStatementMovement, calculateBankReconciliationBalances } from './bankStatementMatching';

test('detects repeated statement rows without rejecting distinct movements', () => {
  const existing = [{
    bankAccountId: 'bank-a', date: '2026-11-01', reference: 'TRF 001',
    type: 'DEBIT' as const, amountBs: 250, amountUsd: 1
  }];
  const base = { bankAccountId: 'bank-a', date: '2026-11-01', reference: ' trf   001 ',
    type: 'DEBIT' as const, amountBs: 250, amountUsd: 1 };
  assert.equal(isDuplicateBankStatementMovement({ existing, candidate: base }), true);
  assert.equal(isDuplicateBankStatementMovement({ existing, candidate: { ...base, amountBs: 251 } }), false);
  assert.equal(isDuplicateBankStatementMovement({ existing, candidate: { ...base, type: 'CREDIT' } }), false);
  assert.equal(isDuplicateBankStatementMovement({ existing, candidate: { ...base, date: '2026-11-02' } }), false);
  assert.equal(isDuplicateBankStatementMovement({ existing, candidate: { ...base, bankAccountId: 'bank-b' } }), false);
});

test('verifies the bank reconciliation schedule balances in both Bs and USD', () => {
  const bookMovements = [
    { debitBs: 1000, creditBs: 0, debitUsd: 4, creditUsd: 0, isReconciled: true },
    { debitBs: 100, creditBs: 0, debitUsd: 0.4, creditUsd: 0, isReconciled: false },
    { debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 0.2, isReconciled: false }
  ];
  const statementMovements = [
    { type: 'CREDIT' as const, amountBs: 1000, amountUsd: 4, isReconciled: true },
    { type: 'DEBIT' as const, amountBs: 20, amountUsd: 0.08, isReconciled: false },
    { type: 'CREDIT' as const, amountBs: 20, amountUsd: 0.08, isReconciled: false }
  ];
  const balanced = calculateBankReconciliationBalances({ bookMovements, statementMovements });
  assert.equal(balanced.differenceBs, 0);
  assert.equal(balanced.differenceUsd, 0);
  assert.equal(balanced.isBalanced, true);

  const usdMismatch = calculateBankReconciliationBalances({
    bookMovements,
    statementMovements: statementMovements.map((row, index) => index === 0 ? { ...row, amountUsd: 3.99 } : row)
  });
  assert.equal(usdMismatch.differenceBs, 0);
  assert.equal(usdMismatch.differenceUsd, 0.01);
  assert.equal(usdMismatch.isBalanced, false);
});

test('includes USD-only deposits and payments in transit when Bs is zero', () => {
  const result = calculateBankReconciliationBalances({
    bookMovements: [
      { debitBs: 0, creditBs: 0, debitUsd: 5, creditUsd: 0, isReconciled: false },
      { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 2, isReconciled: false }
    ],
    statementMovements: []
  });
  assert.equal(result.bookBalanceBs, 0);
  assert.equal(result.bookBalanceUsd, 3);
  assert.equal(result.adjustedBankBalanceUsd, 3);
  assert.equal(result.adjustedBookBalanceUsd, 3);
  assert.equal(result.differenceUsd, 0);
  assert.equal(result.isBalanced, true);
});

test('matches Bs bank lines at cent precision and rejects fuzzy five-cent differences', () => {
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'DEBIT', statementAmount: 100.25, debit: 0, credit: 100.25
  }), true);
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'DEBIT', statementAmount: 100.25, debit: 0, credit: 100.20
  }), false);
});

test('matches USD bank lines at six-decimal precision', () => {
  assert.equal(matchesBankStatementLine({
    currency: 'USD', movementType: 'CREDIT', statementAmount: 12.345678, debit: 12.345678, credit: 0
  }), true);
  assert.equal(matchesBankStatementLine({
    currency: 'USD', movementType: 'CREDIT', statementAmount: 12.345678, debit: 12.345677, credit: 0
  }), false);
});

test('requires the correct debit or credit side and rejects invalid amounts', () => {
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'CREDIT', statementAmount: 50, debit: 0, credit: 50
  }), false);
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'CREDIT', statementAmount: 50, debit: 50, credit: 0
  }), true);
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'DEBIT', statementAmount: 0, debit: 0, credit: 0
  }), false);
  assert.equal(matchesBankStatementLine({
    currency: 'BS', movementType: 'DEBIT', statementAmount: 50, debit: 1, credit: 50
  }), false);
});

test('requires a BCV snapshot effective on the bank movement date', () => {
  assert.throws(() => validateBankMovementFxSnapshot({
    date: '2026-10-20', amountBs: 250, amountUsd: 1, bcvRate: 250, bcvRateEffectiveDate: '2026-10-21'
  }), /no puede ser posterior/);
  assert.doesNotThrow(() => validateBankMovementFxSnapshot({
    date: '2026-10-20', amountBs: 250, amountUsd: 1, bcvRate: 250, bcvRateEffectiveDate: '2026-10-19'
  }));
  assert.throws(() => validateBankMovementFxSnapshot({
    date: '2026-10-20', amountBs: 250.03, amountUsd: 1, bcvRate: 250, bcvRateEffectiveDate: '2026-10-20'
  }), /no concilian/);
  assert.doesNotThrow(() => validateBankMovementFxSnapshot({
    date: '2026-10-20', amountBs: 250, amountUsd: 1, bcvRate: 250, bcvRateEffectiveDate: '2026-10-20'
  }));
});

test('reconciles a bank line only when both Bs and USD equivalents match', () => {
  const matching = {
    movementType: 'DEBIT' as const, amountBs: 250, amountUsd: 1,
    debitBs: 0, creditBs: 250, debitUsd: 0, creditUsd: 1
  };
  assert.equal(matchesBankStatementDualCurrency(matching), true);
  assert.equal(matchesBankStatementDualCurrency({ ...matching, creditUsd: 0.99 }), false);
  assert.equal(matchesBankStatementDualCurrency({ ...matching, creditBs: 249.99 }), false);
});
