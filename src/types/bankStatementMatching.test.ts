import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesBankStatementLine } from './bankStatementMatching';

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
