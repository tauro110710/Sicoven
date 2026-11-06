import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBankStatementLine, matchesBankStatementDualCurrency, validateBankMovementFxSnapshot, isDuplicateBankStatementMovement } from './bankStatementMatching';

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
