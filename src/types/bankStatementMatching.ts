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

/** Validates the dual-currency snapshot of a bank movement against the BCV rate effective on its date. */
export function validateBankMovementFxSnapshot(input: {
  date: string;
  amountBs: number;
  amountUsd: number;
  bcvRate: number;
  bcvRateEffectiveDate?: string;
}): void {
  const parsed = new Date(String(input.date || '') + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || '')) ||
      !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.date) {
    throw new Error('La fecha del movimiento bancario no es válida.');
  }
  const values = [input.amountBs, input.amountUsd, input.bcvRate].map(Number);
  if (values.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new Error('El movimiento y la tasa BCV deben tener importes positivos y válidos en ambas monedas.');
  }
  const rateDate = String(input.bcvRateEffectiveDate || '');
  const parsedRateDate = new Date(rateDate + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(rateDate) ||
      !Number.isFinite(parsedRateDate.getTime()) ||
      parsedRateDate.toISOString().slice(0, 10) !== rateDate ||
      rateDate > input.date) {
    throw new Error('La fecha de vigencia de la tasa BCV debe ser válida y no puede ser posterior al movimiento bancario.');
  }
  if (Math.abs(Math.round(Number(input.amountBs) * 100) / 100 -
      Math.round(Number(input.amountUsd) * Number(input.bcvRate) * 100) / 100) > 0.01) {
    throw new Error('Los importes Bs. y USD del movimiento no concilian con la tasa BCV efectiva en esa fecha.');
  }
}

/** Requires a bank statement line to reconcile in both Bs and USD, not just the bank account's display currency. */
export function matchesBankStatementDualCurrency(input: {
  movementType: 'DEBIT' | 'CREDIT';
  amountBs: number;
  amountUsd: number;
  debitBs: number;
  creditBs: number;
  debitUsd: number;
  creditUsd: number;
}): boolean {
  return matchesBankStatementLine({
    currency: 'BS',
    movementType: input.movementType,
    statementAmount: input.amountBs,
    debit: input.debitBs,
    credit: input.creditBs
  }) && matchesBankStatementLine({
    currency: 'USD',
    movementType: input.movementType,
    statementAmount: input.amountUsd,
    debit: input.debitUsd,
    credit: input.creditUsd
  });
}

/** Detects an already imported bank-statement row using stable bank identity fields. */
export function isDuplicateBankStatementMovement(input: {
  existing: Pick<BankStatementMovement, 'bankAccountId' | 'date' | 'reference' | 'type' | 'amountBs' | 'amountUsd'>[];
  candidate: Pick<BankStatementMovement, 'bankAccountId' | 'date' | 'reference' | 'type' | 'amountBs' | 'amountUsd'>;
}): boolean {
  const normalizeReference = (value: string) => String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
  const candidateReference = normalizeReference(input.candidate.reference);
  if (!candidateReference) return false;
  return input.existing.some(row =>
    row.bankAccountId === input.candidate.bankAccountId &&
    row.date === input.candidate.date &&
    row.type === input.candidate.type &&
    normalizeReference(row.reference) === candidateReference &&
    Math.round(Number(row.amountBs) * 100) === Math.round(Number(input.candidate.amountBs) * 100) &&
    Math.round(Number(row.amountUsd) * 1_000_000) === Math.round(Number(input.candidate.amountUsd) * 1_000_000)
  );
}
