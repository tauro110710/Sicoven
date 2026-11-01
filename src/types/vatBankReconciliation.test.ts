import test from 'node:test';
import assert from 'node:assert/strict';
import type { BankAccount, BankStatementMovement, VatWithholdingDeclaration, VatWithholdingDeclarationEvent } from './accounting';
import { buildVatBankReconciliationSummary, validateVatPaymentBankLinks } from './vatBankReconciliation';

const declaration: VatWithholdingDeclaration = {
  id: 'decl-1', companyId: 'company-1', period: '202610', window: 'FIRST_HALF',
  startDate: '2026-10-01', endDate: '2026-10-15', zeroOperations: false,
  voucherIds: [], voucherSnapshots: [], legacyDateAssignments: [],
  totalTaxableBaseBs: 1000, totalVatAmountBs: 160, totalWithheldBs: 120,
  createdAt: '2026-10-16T10:00:00.000Z'
};
const account: BankAccount = {
  id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.02',
  bankName: 'Banco de prueba', accountNumber: '00000000000000000001',
  currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0
};
const movement = (id: string, amountBs: number, overrides: Partial<BankStatementMovement> = {}): BankStatementMovement => ({
  id, companyId: 'company-1', bankAccountId: 'bank-1', date: '2026-10-18',
  reference: 'REF-' + id, description: 'Pago SENIAT', type: 'DEBIT',
  amountBs, amountUsd: amountBs / 100, isReconciled: false, ...overrides
});
const filed: VatWithholdingDeclarationEvent = {
  id: 'filed-1', declarationId: declaration.id, eventType: 'FILED',
  occurredAt: '2026-10-17', recordedAt: '2026-10-17T10:00:00.000Z',
  declarationNumber: 'D-1', receiptReference: 'ACUSE-1'
};
const draft = (ids: string[], amountBs: number) => ({
  eventType: 'PAYMENT', occurredAt: '2026-10-19', amountBs,
  paymentReference: 'PAGO-1', bankStatementMovementIds: ids
});
const validate = (
  ids: string[],
  amountBs: number,
  movements = [movement('m-1', 60), movement('m-2', 40)],
  events = [filed],
  bankAccounts: BankAccount[] = [account]
) => validateVatPaymentBankLinks({
  companyId: 'company-1', declaration, draft: draft(ids, amountBs), events,
  bankAccounts, bankMovements: movements
});

test('accepts one bank debit that exactly supports a partial withholding payment', () => {
  assert.doesNotThrow(() => validate(['m-1'], 60));
});

test('accepts several bank debits whose sum exactly supports one enteramiento', () => {
  assert.doesNotThrow(() => validate(['m-1', 'm-2'], 100));
});

test('rejects a bank debit total that differs from the fiscal payment', () => {
  assert.throws(() => validate(['m-1'], 59.99), /coincidir exactamente/);
});

test('rejects credits, missing movements and duplicate movement IDs', () => {
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60, { type: 'CREDIT' })]), /débito bancario/);
  assert.throws(() => validate(['missing'], 60), /débito bancario/);
  assert.throws(() => validate(['m-1', 'm-1'], 120), /al menos un débito/);
});

test('rejects movements from another company or a USD bank account', () => {
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60, { companyId: 'company-2' })]), /empresa activa/);
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60)], [filed], [{ ...account, currency: 'USD' }]), /bolívares/);
});

test('rejects a debit already reconciled with an accounting journal entry', () => {
  assert.throws(() => validate(['m-1'], 60, [
    movement('m-1', 60, { isReconciled: true, reconciledWithJournalEntryId: 'entry-1' })
  ]), /ya fue conciliado/);
  assert.throws(() => validate(['m-1'], 60, [
    movement('m-1', 60, { reconciledJournalEntryIds: ['entry-1'] })
  ]), /ya fue conciliado/);
});

test('rejects a movement already used by a different payment event', () => {
  const priorPayment: VatWithholdingDeclarationEvent = {
    id: 'payment-old', declarationId: 'another-declaration', eventType: 'PAYMENT',
    occurredAt: '2026-10-18', recordedAt: '2026-10-18T10:00:00.000Z',
    amountBs: 60, paymentReference: 'REF', bankStatementMovementIds: ['m-1']
  };
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60)], [filed, priorPayment]), /no puede reutilizarse/);
  const sameDeclarationPayment: VatWithholdingDeclarationEvent = { ...priorPayment, id: 'payment-same', declarationId: declaration.id };
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60)], [filed, sameDeclarationPayment]), /no puede reutilizarse/);
});

test('rejects a bank debit outside the filing-to-payment date interval', () => {
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60, { date: '2026-10-16' })]), /intervalo/);
});

test('reports legacy unlinked payments as pending without changing their history', () => {
  const legacy: VatWithholdingDeclarationEvent = {
    id: 'legacy-payment', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-18', recordedAt: '2026-10-18T10:00:00.000Z',
    amountBs: 25, paymentReference: 'REF-LEGACY'
  };
  const summary = buildVatBankReconciliationSummary(declaration, [filed, legacy], [], [account]);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.pendingAmountBs, 25);
  assert.equal(summary.reconciledCount, 0);
});

test('does not mark a historical link reconciled when the linked debit amount no longer matches', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-1', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1']
  };
  const summary = buildVatBankReconciliationSummary(declaration, [filed, payment], [movement('m-1', 59)], [account]);
  assert.equal(summary.reconciledCount, 0);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.pendingAmountBs, 60);
});

test('does not mark linked credits or USD-account movements reconciled', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-1', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1']
  };
  const credit = buildVatBankReconciliationSummary(declaration, [filed, payment], [movement('m-1', 60, { type: 'CREDIT' })], [account]);
  assert.equal(credit.pendingCount, 1);
  const usd = buildVatBankReconciliationSummary(declaration, [filed, payment], [movement('m-1', 60)], [{ ...account, currency: 'USD' }]);
  assert.equal(usd.pendingCount, 1);
});
