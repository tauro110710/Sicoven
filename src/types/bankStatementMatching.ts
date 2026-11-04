import type { BankStatementMovement } from './accounting';

/**
 * Matches one bank-statement row to the bank-account line of a journal entry.
 * Amounts are compared at the precision stored for each currency: cents for
 * Bs. and six decimal places for USD. A five-cent fuzzy match is not accepted.
 */
export function matchesBankStatementLine(input: {
  currency: 'BS' | 'USD';
  movementType: BankStatementMovement['type'];
  statementAmount: number;
  debit: number;
  credit: number;
}): boolean {
  const values = [input.statementAmount, input.debit, input.credit];
  if (!values.every(value => Number.isFinite(Number(value)) && Number(value) >= 0) ||
      Number(input.statementAmount) <= 0) return false;
  const expectsDebit = input.movementType === 'CREDIT';
  const matched = expectsDebit ? Number(input.debit) : Number(input.credit);
  const opposite = expectsDebit ? Number(input.credit) : Number(input.debit);
  if (opposite !== 0) return false;
  return input.currency === 'USD'
    ? Math.round(matched * 1_000_000) === Math.round(Number(input.statementAmount) * 1_000_000)
    : Math.round(matched * 100) === Math.round(Number(input.statementAmount) * 100);
}
