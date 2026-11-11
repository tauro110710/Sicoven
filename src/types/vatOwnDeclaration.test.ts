import assert from 'node:assert/strict';
import test from 'node:test';
import type { PurchaseRecord } from './accounting';
import {
  getReceivedVatWithholdingSales,
  isValidVatOwnDeclarationPeriod,
  calculateVatOwnPosition,
  calculateVatOwnPurchaseCreditSummary,
  getVatOwnOutstandingBalance,
  resolveVatOwnDailySalesSources,
  resolveVatOwnProrationRate,
  areVatOwnDeclarationSourcesCurrent,
  findExistingVatOwnPaymentReversal,
  resolveVatOwnPaymentBcvRate,
  resolveVatOwnPurchaseCreditTreatment,
  snapshotVatOwnDeclarationRevision,
  validateVatOwnDeclarationDraft,
  validateVatOwnEvent,
  type VatOwnDeclaration,
  type VatOwnDeclarationEvent
} from './vatOwnDeclaration';

test('accepts valid monthly declaration periods and rejects malformed months', () => {
  assert.equal(isValidVatOwnDeclarationPeriod('2026-11'), true);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-01'), true);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-12'), true);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-00'), false);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-13'), false);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-1'), false);
  assert.equal(isValidVatOwnDeclarationPeriod(''), false);
});

const declaration: VatOwnDeclaration = {
  id: 'iva-own-2026-01-company-a',
  companyId: 'company-a',
  period: '2026-01',
  status: 'FILED',
  position: calculateVatOwnPosition({
    outputVatBs: 1000,
    purchaseCreditBs: 300,
    receivedWithholdingsBs: 100,
    priorCreditBs: 50
  }),
  sourceIds: ['sale-1', 'purchase-1'],
  declarationNumber: 'F30-001',
  filedAt: '2026-02-10T10:00:00.000Z',
  createdAt: '2026-02-01T10:00:00.000Z'
};

const payment = (overrides: Partial<Omit<VatOwnDeclarationEvent, 'id' | 'recordedAt'>> = {}) => ({
  declarationId: declaration.id,
  companyId: declaration.companyId,
  eventType: 'PAYMENT' as const,
  occurredAt: '2026-02-12T10:00:00.000Z',
  amountBs: 200,
  reference: 'BANK-001',
  idempotencyKey: 'payment-001',
  ...overrides
});

test('preserves the source invoice VAT credit treatment for corrections and defaults legacy records to common', () => {
  assert.equal(resolveVatOwnPurchaseCreditTreatment('TAXABLE'), 'TAXABLE');
  assert.equal(resolveVatOwnPurchaseCreditTreatment('EXEMPT'), 'EXEMPT');
  assert.equal(resolveVatOwnPurchaseCreditTreatment('COMMON'), 'COMMON');
  assert.equal(resolveVatOwnPurchaseCreditTreatment(undefined), 'COMMON');
});

test('calculates the common-purchase proration from taxable and exempt sales', () => {
  assert.equal(resolveVatOwnProrationRate({
    taxableSalesBaseBs: 750, exemptSalesBaseBs: 250, hasCommonPurchases: true
  }), 0.75);
});

test('does not assume 100% credit when common purchases exist without a sales denominator', () => {
  assert.equal(resolveVatOwnProrationRate({
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0, hasCommonPurchases: true
  }), null);
});

test('allows a zero denominator only when no common purchase VAT depends on proration', () => {
  assert.equal(resolveVatOwnProrationRate({
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0, hasCommonPurchases: false
  }), 1);
});

test('rejects negative or non-finite sales bases for proration', () => {
  assert.equal(resolveVatOwnProrationRate({
    taxableSalesBaseBs: -10, exemptSalesBaseBs: 100, hasCommonPurchases: true
  }), null);
  assert.equal(resolveVatOwnProrationRate({
    taxableSalesBaseBs: Number.NaN, exemptSalesBaseBs: 100, hasCommonPurchases: true
  }), null);
});

test('detects changed declaration source sets without depending on array order', () => {
  assert.equal(areVatOwnDeclarationSourcesCurrent(['sale-1', 'purchase-1'], ['purchase-1', 'sale-1']), true);
  assert.equal(areVatOwnDeclarationSourcesCurrent(['sale-1'], ['sale-1', 'sale-2']), false);
  assert.equal(areVatOwnDeclarationSourcesCurrent(['sale-1', 'sale-2'], ['sale-1']), false);
});

test('resolves the latest effective BCV rate for an IVA payment date', () => {
  const history = [
    { rate: 100, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T10:00:00.000Z' },
    { rate: 105, effectiveDate: '2026-10-10', recordedAt: '2026-10-10T10:00:00.000Z' },
    { rate: 106, effectiveDate: '2026-10-10', recordedAt: '2026-10-11T10:00:00.000Z' },
    { rate: 110, effectiveDate: '2026-10-20', recordedAt: '2026-10-20T10:00:00.000Z' }
  ];
  assert.equal(resolveVatOwnPaymentBcvRate(history, '2026-10-15'), 106);
  assert.equal(resolveVatOwnPaymentBcvRate(history, '2026-10-20'), 110);
  assert.equal(resolveVatOwnPaymentBcvRate(history, '2026-09-30'), null);
});

test('rejects invalid payment dates and invalid BCV history entries', () => {
  assert.equal(resolveVatOwnPaymentBcvRate([
    { rate: 0, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T10:00:00.000Z' },
    { rate: 100, effectiveDate: '2026-02-31', recordedAt: '2026-10-01T10:00:00.000Z' }
  ], '2026-10-10'), null);
  assert.equal(resolveVatOwnPaymentBcvRate([], '2026-02-31'), null);
});

test('recovers an already persisted payment contra-entry without creating a duplicate', () => {
  const reversal = { id: 'reverse-1', companyId: 'company-a', reversalOfEntryId: 'journal-payment-1' };
  assert.deepEqual(
    findExistingVatOwnPaymentReversal([reversal], 'company-a', 'journal-payment-1'),
    reversal
  );
  assert.equal(findExistingVatOwnPaymentReversal([], 'company-a', 'journal-payment-1'), null);
  assert.throws(() => findExistingVatOwnPaymentReversal([
    reversal, { ...reversal, id: 'reverse-2' }
  ], 'company-a', 'journal-payment-1'), /más de un contra-asiento/);
});

test('snapshots a draft revision without sharing mutable source arrays or position objects', () => {
  const draft = { ...declaration, status: 'DRAFT' as const, position: { ...declaration.position }, sourceIds: ['sale-old'], revisions: [] };
  const revision = snapshotVatOwnDeclarationRevision(draft, '2026-02-02T10:00:00.000Z', 'Actualizar fuentes antes de presentar');
  draft.sourceIds.push('sale-new');
  draft.position.amountDueBs = 999;
  assert.equal(revision.revision, 1);
  assert.deepEqual(revision.sourceIds, ['sale-old']);
  assert.notEqual(revision.position.amountDueBs, 999);
  assert.equal(revision.reason, 'Actualizar fuentes antes de presentar');
  assert.throws(() => snapshotVatOwnDeclarationRevision(declaration, '2026-02-02T10:00:00.000Z', 'No debe versionar una presentada'), /borrador no presentado/);
});

test('reverses a prior-period common purchase credit using the original declaration proration', () => {
  const original = {
    id: 'purchase-old', companyId: 'company-a', invoiceDate: '2026-10-05',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    documentType: '03', taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id,
    vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    position: calculateVatOwnPosition({
      outputVatBs: 0, purchaseCreditBs: 80, purchaseCredit16Bs: 80,
      purchaseCreditGrossBs: 160, purchaseCreditGross16Bs: 160,
      purchaseCreditNonEligibleBs: 80, receivedWithholdingsBs: 0,
      prorationRate: 0.5
    })
  };
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  });
  assert.equal(result.gross16Bs, 0);
  assert.equal(result.priorReversalEligible16Bs, 40);
  assert.equal(result.priorReversalNonEligible16Bs, 40);
  assert.deepEqual(result.relatedPurchaseIds, [original.id]);
});

test('blocks a prior-period purchase credit note when its original invoice was never included in a filed declaration', () => {
  const original = {
    id: 'purchase-unfiled', companyId: 'company-a', invoiceDate: '2026-10-05',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note-unfiled', companyId: 'company-a', invoiceDate: '2026-11-05',
    documentType: '03', taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  }), /no aparece en una única declaración IVA anterior presentada/);
});

test('nets same-period purchase credit notes using the source invoice treatment and current proration', () => {
  const original = {
    id: 'purchase-current', companyId: 'company-a', invoiceDate: '2026-11-02',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note-current', companyId: 'company-a', invoiceDate: '2026-11-20',
    documentType: '03', taxRate: 16, vatAmountBs: 40, originalPurchaseId: original.id,
    vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [original, note],
    allPurchases: [original, note], priorDeclarations: [],
    taxableSalesBaseBs: 500, exemptSalesBaseBs: 500
  });
  assert.equal(result.prorationRate, 0.5);
  assert.equal(result.gross16Bs, 120);
  assert.equal(result.eligible16Bs, 60);
  assert.equal(result.nonEligible16Bs, 60);
});

test('calculates debit, credits, prior credit, payable and carry-forward', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 1000,
    purchaseCreditBs: 300,
    receivedWithholdingsBs: 100,
    priorCreditBs: 50
  });
  assert.equal(position.netTaxBs, 550);
  assert.equal(position.amountDueBs, 550);
  assert.equal(position.creditCarryForwardBs, 0);
});

test('separates IVA débito 16% and 8% for the monthly ledger', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 240, outputVat16Bs: 160, outputVat8Bs: 80,
    purchaseCreditBs: 20, purchaseCredit16Bs: 12, purchaseCredit8Bs: 8,
    receivedWithholdingsBs: 10
  });
  assert.equal(position.outputVat16Bs, 160);
  assert.equal(position.outputVat8Bs, 80);
  assert.equal(position.purchaseCredit16Bs, 12);
  assert.equal(position.purchaseCredit8Bs, 8);
  assert.equal(position.amountDueBs, 210);
});

test('applies only the prior credit needed and carries the unused balance forward', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 100, purchaseCreditBs: 20, receivedWithholdingsBs: 10, priorCreditBs: 1000
  });
  assert.equal(position.priorCreditAppliedBs, 70);
  assert.equal(position.amountDueBs, 0);
  assert.equal(position.creditCarryForwardBs, 930);
});

test('preserves excess credits as a carry-forward, not a negative payable', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 100,
    purchaseCreditBs: 250,
    receivedWithholdingsBs: 0
  });
  assert.equal(position.amountDueBs, 0);
  assert.equal(position.creditCarryForwardBs, 150);
});

test('rejects invalid amounts and duplicate source identifiers', () => {
  assert.throws(() => calculateVatOwnPosition({
    outputVatBs: -1, purchaseCreditBs: 0, receivedWithholdingsBs: 0
  }), /no negativo/);
  assert.throws(() => validateVatOwnDeclarationDraft({
    id: 'd1', companyId: 'company-a', period: '2026-01',
    sourceIds: ['same', 'same'], createdAt: '2026-02-01T00:00:00.000Z'
  }), /dos veces/);
});

test('allows partial payment and computes remaining balance', () => {
  const event = { ...payment(), id: 'event-1', recordedAt: '2026-02-12T10:01:00.000Z' };
  validateVatOwnEvent({ declaration, events: [], draft: payment() });
  assert.equal(getVatOwnOutstandingBalance(declaration, [event]), 350);
});

test('rejects IVA payments dated before the declaration was filed', () => {
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ occurredAt: '2026-02-09T10:00:00.000Z' })
  }), /no puede ser anterior a la presentación/);
});

test('rejects overpayment, duplicate idempotency keys and cross-company events', () => {
  const prior = { ...payment(), id: 'event-1', recordedAt: '2026-02-12T10:01:00.000Z' };
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [prior], draft: payment({ amountBs: 1000, idempotencyKey: 'payment-002', reference: 'BANK-002' })
  }), /supera el saldo/);
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [prior], draft: payment()
  }), /duplicado/);
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ companyId: 'company-b' })
  }), /empresa seleccionadas/);
});

test('a payment reversal restores the outstanding balance without deleting history', () => {
  const original = { ...payment(), id: 'event-1', recordedAt: '2026-02-12T10:01:00.000Z' };
  const reversal: VatOwnDeclarationEvent = {
    id: 'event-2',
    declarationId: declaration.id,
    companyId: declaration.companyId,
    eventType: 'REVERSAL',
    occurredAt: '2026-02-13T10:00:00.000Z',
    recordedAt: '2026-02-13T10:01:00.000Z',
    idempotencyKey: 'reversal-001',
    reversalOfEventId: original.id
  };
  validateVatOwnEvent({ declaration, events: [original], draft: {
    declarationId: declaration.id, companyId: declaration.companyId,
    eventType: 'REVERSAL', occurredAt: reversal.occurredAt,
    idempotencyKey: reversal.idempotencyKey, reversalOfEventId: original.id
  }});
  assert.equal(getVatOwnOutstandingBalance(declaration, [original, reversal]), 550);
  assert.equal([original, reversal].length, 2);
});


test('resolves Z and individual sales on different days without blocking the whole month', async () => {
  const { resolveVatOwnDailySalesSources } = await import('./vatOwnDeclaration');
  const result = resolveVatOwnDailySalesSources({
    zReports: [{ id: 'z-1', date: '2026-01-01', taxableBase16Bs: 1000, vat16Bs: 160, taxableBase8Bs: 0, vat8Bs: 0, taxableBase31Bs: 0, vat31Bs: 0, exemptSalesBs: 100 }],
    sales: [{ id: 'sale-1', date: '2026-01-02', documentType: '01', taxableBaseBs: 500, taxRate: 16, vatAmountBs: 80, exemptAmountBs: 0 }]
  });
  assert.equal(result.days.length, 2);
  assert.equal(result.days.reduce((sum, day) => sum + day.outputVatBs, 0), 240);
  assert.deepEqual(result.unresolvedDates, []);
});

test('requires the accountant to choose one source when Z and individual sales overlap on a date', async () => {
  const { resolveVatOwnDailySalesSources } = await import('./vatOwnDeclaration');
  const input = {
    zReports: [{ id: 'z-1', date: '2026-01-01', taxableBase16Bs: 1000, vat16Bs: 160, taxableBase8Bs: 0, vat8Bs: 0, taxableBase31Bs: 0, vat31Bs: 0, exemptSalesBs: 0 }],
    sales: [{ id: 'sale-1', date: '2026-01-01', documentType: '01' as const, taxableBaseBs: 1000, taxRate: 16, vatAmountBs: 160, exemptAmountBs: 0 }]
  };
  const pending = resolveVatOwnDailySalesSources(input);
  assert.deepEqual(pending.unresolvedDates, ['2026-01-01']);
  assert.equal(pending.days.length, 0);
  const resolved = resolveVatOwnDailySalesSources({ ...input, choices: { '2026-01-01': 'Z' } });
  assert.equal(resolved.days.length, 1);
  assert.equal(resolved.days[0].outputVatBs, 160);
  assert.equal(resolved.days[0].sourceIds.length, 1);
});

test('treats the 31% Z alícuota as 16% IVA plus a separate non-IVA additional tax', () => {
  const result = resolveVatOwnDailySalesSources({
    zReports: [{
      id: 'z-31', date: '2026-10-05',
      taxableBase16Bs: 1000, vat16Bs: 160,
      taxableBase8Bs: 500, vat8Bs: 40,
      taxableBase31Bs: 100, vat31Bs: 16,
      exemptSalesBs: 0
    }],
    sales: []
  });
  assert.equal(result.unresolvedDates.length, 0);
  assert.equal(result.days[0].outputVat16Bs, 176);
  assert.equal(result.days[0].outputVat8Bs, 40);
  assert.equal(result.days[0].outputVatBs, 216);
});


test('customer VAT withholdings are retained even when daily sales are sourced from a Z report', () => {
  const sales = [
    { id: 'pos-invoice', companyId: 'co-1', invoiceDate: '2026-11-05', retentionVoucherDate: '2026-11-08', vatWithheldBs: 160, isCancelled: false },
    { id: 'prior-invoice', companyId: 'co-1', invoiceDate: '2026-10-30', retentionVoucherDate: '2026-11-02', vatWithheldBs: 80 },
    { id: 'other-company', companyId: 'co-2', invoiceDate: '2026-11-05', retentionVoucherDate: '2026-11-08', vatWithheldBs: 90 },
    { id: 'cancelled', companyId: 'co-1', invoiceDate: '2026-11-05', retentionVoucherDate: '2026-11-08', vatWithheldBs: 50, isCancelled: true },
    { id: 'no-certificate', companyId: 'co-1', invoiceDate: '2026-11-05', vatWithheldBs: 40 }
  ];
  const rows = getReceivedVatWithholdingSales(sales, 'co-1', '2026-11');
  assert.deepEqual(rows.map(item => item.id), ['pos-invoice', 'prior-invoice']);
});
