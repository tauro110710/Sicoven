import test from 'node:test';
import assert from 'node:assert/strict';
import type { BankAccount, BankStatementMovement, VatWithholdingDeclaration, VatWithholdingDeclarationEvent } from './accounting';
import { buildVatBankReconciliationSummary, getVatPaymentJournalReversalBlocker, validateVatPaymentBankLinks } from './vatBankReconciliation';

const declaration: VatWithholdingDeclaration = {
  id: 'decl-1', companyId: 'company-1', period: '202610', window: 'FIRST_HALF',
  startDate: '2026-10-01', endDate: '2026-10-15', zeroOperations: false,
  voucherIds: [], voucherSnapshots: [], legacyDateAssignments: [],
  totalTaxableBaseBs: 1000, totalVatAmountBs: 160, totalWithheldBs: 120, totalWithheldUsd: 1.2,
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
const paymentJournal = {
  id: 'entry-iva-1', companyId: declaration.companyId, entryNumber: 1,
  date: '2026-10-19', description: 'Enteramiento de retenciones de IVA',
  type: 'RETENCION_IVA' as const, bcvRate: 1,
  referenceDoc: 'IVA-ENTERAMIENTO:' + declaration.id + ':PAGO-1',
  items: [
    { accountCode: '2.1.2.03', accountName: 'IVA por enterar', debitBs: 60, creditBs: 0, debitUsd: 0.6, creditUsd: 0 },
    { accountCode: '1.1.1.02', accountName: 'Banco', debitBs: 0, creditBs: 60, debitUsd: 0, creditUsd: 0.6 }
  ], createdAt: '2026-10-19T10:00:00.000Z'
};
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

test('rejects impossible calendar dates when registering IVA payment support', () => {
  assert.throws(() => validate(['m-1'], 60, [
    movement('m-1', 60, { date: '2026-02-30' })
  ]), /fecha inválidos/);
});

test('rejects IVA payment amounts with fractional cent amounts', () => {
  assert.throws(() => validate(['m-1'], 60.001), /céntimos exactos/);
  assert.throws(() => validate(['m-1'], 0), /céntimos exactos/);
  assert.throws(() => validate(['m-1'], -60), /céntimos exactos/);
  assert.doesNotThrow(() => validate(['m-1'], 60));
});

test('rejects invalid filing and payment dates before bank-link validation', () => {
  const invalidDraft = { ...draft(['m-1'], 60), occurredAt: '2026-02-30' };
  assert.throws(() => validateVatPaymentBankLinks({
    companyId: 'company-1', declaration, draft: invalidDraft, events: [filed],
    bankAccounts: [account], bankMovements: [movement('m-1', 60)]
  }), /fecha del enteramiento IVA es inválida/);
  const invalidFiling = { ...filed, occurredAt: '2026-02-30' };
  assert.throws(() => validateVatPaymentBankLinks({
    companyId: 'company-1', declaration, draft: draft(['m-1'], 60), events: [invalidFiling],
    bankAccounts: [account], bankMovements: [movement('m-1', 60)]
  }), /fecha de presentación IVA es inválida/);
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

test('keeps historical payment links pending when the bank debit was later reconciled to a journal entry', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-1', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1']
  };
  const manuallyReconciled = buildVatBankReconciliationSummary(
    declaration, [filed, payment],
    [movement('m-1', 60, { isReconciled: true, reconciledWithJournalEntryId: 'entry-1' })],
    [account]
  );
  assert.equal(manuallyReconciled.reconciledCount, 0);
  assert.equal(manuallyReconciled.pendingCount, 1);
  const historicallyLinked = buildVatBankReconciliationSummary(
    declaration, [filed, payment],
    [movement('m-1', 60, { reconciledJournalEntryIds: ['entry-1'] })],
    [account]
  );
  assert.equal(historicallyLinked.reconciledCount, 0);
  assert.equal(historicallyLinked.pendingCount, 1);
});

test('recognizes the bank movement reconciled by its own IVA payment journal entry', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-journal', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1'],
    journalEntryId: 'entry-iva-1'
  };
  const summary = buildVatBankReconciliationSummary(declaration, [filed, payment], [
    movement('m-1', 60, {
      isReconciled: true, reconciledWithJournalEntryId: 'entry-iva-1',
      reconciledJournalEntryIds: ['entry-iva-1']
    })
  ], [account], [paymentJournal]);
  assert.equal(summary.reconciledCount, 1);
  assert.equal(summary.pendingCount, 0);

  const beforeFiling = buildVatBankReconciliationSummary(declaration, [filed, {
    ...payment, occurredAt: '2026-10-16'
  }], [
    movement('m-1', 60, {
      date: '2026-10-16', isReconciled: true,
      reconciledWithJournalEntryId: 'entry-iva-1',
      reconciledJournalEntryIds: ['entry-iva-1']
    })
  ], [account], [paymentJournal]);
  assert.equal(beforeFiling.reconciledCount, 0);
  assert.equal(beforeFiling.pendingCount, 1);
});

test('rejects impossible calendar dates in payment bank movements', () => {
  assert.throws(() => validate(['m-1'], 60, [movement('m-1', 60, { date: '2026-02-30' })]), /fecha inválidos/);
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-invalid-date', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1'],
    journalEntryId: 'entry-iva-invalid-date'
  };
  const summary = buildVatBankReconciliationSummary(declaration, [filed, payment], [
    movement('m-1', 60, {
      date: '2026-10-18', isReconciled: true,
      reconciledWithJournalEntryId: 'entry-iva-invalid-date',
      reconciledJournalEntryIds: ['entry-iva-invalid-date']
    })
  ], [account]);
  // A bank link alone is insufficient: reconciliation requires the real,
  // matching IVA journal entry to be present in the supplied accounting ledger.
  assert.equal(summary.reconciledCount, 0);
  assert.equal(summary.pendingCount, 1);
  const invalidSummary = buildVatBankReconciliationSummary(declaration, [filed, payment], [
    movement('m-1', 60, {
      date: '2026-02-30', isReconciled: true,
      reconciledWithJournalEntryId: 'entry-iva-invalid-date',
      reconciledJournalEntryIds: ['entry-iva-invalid-date']
    })
  ], [account], [paymentJournal]);
  assert.equal(invalidSummary.pendingCount, 1);
  const invalidFiledSummary = buildVatBankReconciliationSummary(declaration, [{ ...filed, occurredAt: '2026-02-30' }, payment], [
    movement('m-1', 60, { date: '2026-10-18', isReconciled: true,
      reconciledWithJournalEntryId: 'entry-iva-1', reconciledJournalEntryIds: ['entry-iva-1'] })
  ], [account], [paymentJournal]);
  assert.equal(invalidFiledSummary.reconciledCount, 0);
  assert.equal(invalidFiledSummary.pendingCount, 1);
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

test('accepts a balanced historical-liability payment with a realized FX gain', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-fx', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-fx'],
    journalEntryId: 'entry-iva-1'
  };
  const linkedMovement = movement('m-fx', 60, {
    amountUsd: 0.5, isReconciled: true,
    reconciledWithJournalEntryId: 'entry-iva-1',
    reconciledJournalEntryIds: ['entry-iva-1']
  });
  const journal = {
    ...paymentJournal,
    items: [
      { ...paymentJournal.items[0], debitUsd: 0.6 },
      { ...paymentJournal.items[1], creditUsd: 0.5 },
      { accountCode: '4.2.1.01', accountName: 'Ganancia cambiaria', debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0.1 }
    ]
  };
  const summary = buildVatBankReconciliationSummary(
    declaration, [filed, payment], [linkedMovement], [account], [journal]
  );
  assert.equal(summary.reconciledCount, 1);
  assert.equal(summary.pendingCount, 0);
});

test('blocks generic reversal of a journal linked to an IVA payment event', () => {
  const linkedPayment: VatWithholdingDeclarationEvent = {
    id: 'payment-linked', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, journalEntryId: 'entry-iva-1'
  };
  assert.match(getVatPaymentJournalReversalBlocker([linkedPayment], 'entry-iva-1') || '', /corrección fiscal específico/);
  assert.equal(getVatPaymentJournalReversalBlocker([linkedPayment], 'entry-other'), null);
  assert.equal(getVatPaymentJournalReversalBlocker([filed], 'entry-iva-1'), null);
});

test('keeps a payment pending when its linked journal is missing or does not match the declaration', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-journal', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1'],
    journalEntryId: 'entry-iva-1'
  };
  const linkedMovement = movement('m-1', 60, {
    isReconciled: true, reconciledWithJournalEntryId: 'entry-iva-1',
    reconciledJournalEntryIds: ['entry-iva-1']
  });
  const missing = buildVatBankReconciliationSummary(declaration, [filed, payment], [linkedMovement], [account]);
  assert.equal(missing.pendingCount, 1);
  const wrongReference = buildVatBankReconciliationSummary(declaration, [filed, payment], [linkedMovement], [account], [
    { ...paymentJournal, referenceDoc: 'IVA-ENTERAMIENTO:otra-declaracion:PAGO-1' }
  ]);
  assert.equal(wrongReference.pendingCount, 1);
  const wrongType = buildVatBankReconciliationSummary(declaration, [filed, payment], [linkedMovement], [account], [
    { ...paymentJournal, type: 'MANUAL' as const }
  ]);
  assert.equal(wrongType.pendingCount, 1);
  const wrongCompany = buildVatBankReconciliationSummary(declaration, [filed, payment], [linkedMovement], [account], [
    { ...paymentJournal, companyId: 'company-2' }
  ]);
  assert.equal(wrongCompany.pendingCount, 1);
});


test('requires real balanced journal lines matching the IVA liability and linked bank account', () => {
  const payment: VatWithholdingDeclarationEvent = {
    id: 'payment-journal', declarationId: declaration.id, eventType: 'PAYMENT',
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 60, paymentReference: 'PAGO-1', bankStatementMovementIds: ['m-1'],
    journalEntryId: 'entry-iva-1'
  };
  const linkedMovement = movement('m-1', 60, {
    isReconciled: true, reconciledWithJournalEntryId: 'entry-iva-1',
    reconciledJournalEntryIds: ['entry-iva-1']
  });
  const summaryFor = (items: typeof paymentJournal.items) => buildVatBankReconciliationSummary(
    declaration, [filed, payment], [linkedMovement], [account], [{ ...paymentJournal, items }]
  );
  assert.equal(summaryFor(paymentJournal.items).reconciledCount, 1);
  assert.equal(summaryFor([
    { ...paymentJournal.items[0], debitBs: 59 },
    paymentJournal.items[1]
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    { ...paymentJournal.items[0], accountCode: '2.1.2.99' },
    paymentJournal.items[1]
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    paymentJournal.items[0],
    { ...paymentJournal.items[1], accountCode: '1.1.1.99' }
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    paymentJournal.items[0],
    { ...paymentJournal.items[1], creditBs: 59 }
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    paymentJournal.items[0],
    { ...paymentJournal.items[1], creditUsd: 0.5 }
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    { ...paymentJournal.items[0], debitUsd: 0.5 },
    paymentJournal.items[1],
    { accountCode: '4.2.1.01', accountName: 'Ganancia cambiaria', debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0.1 }
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    { ...paymentJournal.items[0], debitBs: Number.NaN },
    paymentJournal.items[1]
  ]).pendingCount, 1);
  assert.equal(summaryFor([
    paymentJournal.items[0],
    { ...paymentJournal.items[1], debitBs: 1 }
  ]).pendingCount, 1);
});
