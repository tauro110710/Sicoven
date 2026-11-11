import assert from 'node:assert/strict';
import test from 'node:test';
import type { JournalEntry, PurchaseRecord } from './accounting';
import {
  getReceivedVatWithholdingSales,
  isValidVatOwnDeclarationPeriod,
  calculateVatOwnPosition,
  calculateVatOwnPurchaseCreditSummary,
  getUnfiledVatOwnActivityPeriods,
  areVatOwnSourceSnapshotsCurrent,
  getVatOwnFiledLaterPeriods,
  buildVatOwnPurchaseVatReclassificationItems,
  getVatOwnOutstandingBalance,
  getVatOwnNewCreditCarryForward,
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

test('posts customer withholding adjustments in the month of the corrective sales document', () => {
  const rows = [
    { id: 'sale-original', companyId: 'company-a', documentType: '01' as const, invoiceDate: '2026-10-01', retentionVoucherDate: '2026-10-20', vatWithheldBs: 100 },
    { id: 'sale-credit-note', companyId: 'company-a', documentType: '03' as const, invoiceDate: '2026-11-05', retentionVoucherDate: '2026-10-20', vatWithheldBs: 20 },
    { id: 'sale-debit-note', companyId: 'company-a', documentType: '02' as const, invoiceDate: '2026-11-06', retentionVoucherDate: '2026-10-20', vatWithheldBs: 10 },
    { id: 'sale-current', companyId: 'company-a', documentType: '01' as const, invoiceDate: '2026-11-07', retentionVoucherDate: '2026-11-12', vatWithheldBs: 30 }
  ];
  const received = getReceivedVatWithholdingSales(rows, 'company-a', '2026-11');
  assert.deepEqual(received.map(item => item.id), ['sale-credit-note', 'sale-debit-note', 'sale-current']);
  assert.equal(received.reduce((sum, item) => sum + (item.documentType === '03' ? -1 : 1) * item.vatWithheldBs, 0), 20);
});

test('does not repost unused prior IVA credit when carrying the remaining balance forward', () => {
  assert.equal(getVatOwnNewCreditCarryForward({
    priorCreditAvailableBs: 100, priorCreditAppliedBs: 50, totalCreditCarryForwardBs: 50
  }), 0);
  assert.equal(getVatOwnNewCreditCarryForward({
    priorCreditAvailableBs: 100, priorCreditAppliedBs: 0, totalCreditCarryForwardBs: 150
  }), 50);
  assert.equal(getVatOwnNewCreditCarryForward({
    priorCreditAvailableBs: 100, priorCreditAppliedBs: 100, totalCreditCarryForwardBs: 0
  }), 0);
  assert.equal(getVatOwnNewCreditCarryForward({
    priorCreditAvailableBs: 0, priorCreditAppliedBs: 0, totalCreditCarryForwardBs: 75
  }), 75);
  assert.throws(() => getVatOwnNewCreditCarryForward({
    priorCreditAvailableBs: 20, priorCreditAppliedBs: 30, totalCreditCarryForwardBs: 0
  }), /supera el saldo anterior/);
});

test('accepts valid monthly declaration periods and rejects malformed months', () => {
  assert.equal(isValidVatOwnDeclarationPeriod('2026-11'), true);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-01'), true);
  assert.equal(isValidVatOwnDeclarationPeriod('2026-12'), true);
  assert.equal(isValidVatOwnDeclarationPeriod(' 2026-11 '), true);
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

test('requires fiscal source snapshots to match before presenting a declaration', () => {
  const original = { sale1: JSON.stringify({ invoice: 'F-001', base: 100, control: '0001' }), z1: JSON.stringify({ date: '2026-11-01', vat: 16 }) };
  assert.equal(areVatOwnSourceSnapshotsCurrent(original, { ...original }), true);
  assert.equal(areVatOwnSourceSnapshotsCurrent(original, {
    ...original, sale1: JSON.stringify({ invoice: 'F-001', base: 100, control: '0002' })
  }), false);
  assert.equal(areVatOwnSourceSnapshotsCurrent(original, { sale1: original.sale1 }), false);
  assert.equal(areVatOwnSourceSnapshotsCurrent(undefined, original), false);
});

test('requires earlier months with fiscal activity to be filed before preparing a later month', () => {
  const filedOctober = { ...declaration, period: '2026-10', status: 'FILED' as const };
  const drafts = [{ ...declaration, period: '2026-11', status: 'DRAFT' as const }];
  assert.deepEqual(getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: ['2026-10-05', '2026-11-08', '2026-12-01'],
    declarations: [filedOctober, ...drafts]
  }), ['2026-11']);
  assert.deepEqual(getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: ['2026-10-05', '2026-12-01'],
    declarations: [filedOctober]
  }), ['2026-11']);
  assert.deepEqual(getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: [], declarations: [filedOctober]
  }), ['2026-11']);
  const draftNovember = { ...declaration, companyId: 'company-a', period: '2026-11', status: 'DRAFT' as const };
  assert.deepEqual(getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: [], declarations: [filedOctober, draftNovember]
  }), ['2026-11']);
  assert.deepEqual(getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: [], declarations: []
  }), []);
  assert.deepEqual(getVatOwnFiledLaterPeriods({
    companyId: 'company-a', targetPeriod: '2026-09',
    declarations: [filedOctober, ...drafts]
  }), ['2026-10']);
  assert.deepEqual(getVatOwnFiledLaterPeriods({
    companyId: 'company-a', targetPeriod: '2026-10',
    declarations: [filedOctober]
  }), []);
  assert.throws(() => getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: ['not-a-date'], declarations: []
  }), /fecha fiscal inválida/);
  assert.throws(() => getUnfiledVatOwnActivityPeriods({
    companyId: 'company-a', targetPeriod: '2026-12',
    activityDates: ['2026-02-31'], declarations: []
  }), /fecha fiscal inválida/);
});

test('classifies the 31% purchase rate as 16% creditable IVA and excludes the separate luxury tax', () => {
  const purchase = {
    id: 'purchase-31', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', documentType: '01', taxRate: 31,
    taxableBaseBs: 1000, vatAmountBs: 160, additionalLuxuryTaxBs: 150,
    vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [purchase],
    allPurchases: [purchase], priorDeclarations: [],
    taxableSalesBaseBs: 1000, exemptSalesBaseBs: 0
  });
  assert.equal(result.gross16Bs, 160);
  assert.equal(result.eligible16Bs, 160);
  assert.equal(result.nonEligible16Bs, 0);
  assert.equal(result.gross8Bs, 0);
});

test('keeps the additional luxury tax outside the purchase VAT credit at the combined 31% rate', () => {
  const purchase = {
    id: 'purchase-luxury-tax', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', documentType: '01', taxRate: 31,
    taxableBaseBs: 1000, exemptAmountBs: 0, vatAmountBs: 160,
    additionalLuxuryTaxBs: 150, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [purchase],
    allPurchases: [purchase], priorDeclarations: [],
    taxableSalesBaseBs: 1000, exemptSalesBaseBs: 0
  });
  assert.equal(result.gross16Bs, 160);
  assert.equal(result.eligible16Bs, 160);
  assert.equal(result.nonEligible16Bs, 0);
  assert.equal(result.gross8Bs, 0);
});

test('reverses a prior-period common purchase credit using the original declaration proration', () => {
  const original = {
    id: 'purchase-old', companyId: 'company-a', invoiceDate: '2026-10-05', supplierRif: 'J-12345678-9',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note', companyId: 'company-a', invoiceDate: '2026-11-05', supplierRif: 'J-12345678-9',
    documentType: '03', taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id,
    vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({ kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9', vatCreditTreatment: 'COMMON', taxRate: 16, vatAmountBs: 160 })
    },
    position: calculateVatOwnPosition({
      outputVatBs: 0, purchaseCreditBs: 80, purchaseCredit16Bs: 80,
      purchaseCreditGrossBs: 160, purchaseCreditGross16Bs: 160,
      purchaseCreditNonEligibleBs: 80, receivedWithholdingsBs: 0,
      taxableSalesBaseBs: 500, exemptSalesBaseBs: 500, prorationRate: 0.5
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

test('reverses only the 16% VAT component of a prior 31% combined-rate purchase credit note', () => {
  const original = {
    id: 'purchase-prior-combined-31', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'FC-31-OLD', documentType: '01',
    taxRate: 31, vatAmountBs: 160, additionalLuxuryTaxBs: 150, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-prior-combined-31-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-31-OLD', documentType: '03',
    taxRate: 31, vatAmountBs: 80, additionalLuxuryTaxBs: 75, originalPurchaseId: original.id
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 31, vatAmountBs: 160,
        additionalLuxuryTaxBs: 150
      })
    }
  };
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  });
  assert.equal(result.gross16Bs, 0);
  assert.equal(result.gross8Bs, 0);
  assert.equal(result.priorReversalEligible16Bs, 80);
  assert.equal(result.priorReversalEligible8Bs, 0);
  assert.equal(result.priorReversalNonEligible16Bs, 0);
  assert.equal(result.reclassifications[0].taxRate, 31);
});

test('routes a prior-period 8% credit note reversal to the 8% VAT bucket', () => {
  const original = {
    id: 'purchase-prior-8', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'FC-8-OLD', documentType: '01',
    taxRate: 8, vatAmountBs: 80, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-prior-8-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-8-OLD', documentType: '03',
    taxRate: 8, vatAmountBs: 40, originalPurchaseId: original.id
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 8, vatAmountBs: 80
      })
    }
  };
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  });
  assert.equal(result.priorReversalEligible8Bs, 40);
  assert.equal(result.priorReversalEligible16Bs, 0);
  assert.equal(result.priorReversalNonEligible8Bs, 0);
  assert.equal(result.reclassifications[0].taxRate, 8);
});

test('blocks a prior-period credit note when the filed original declaration has no fiscal treatment snapshot', () => {
  const original = {
    id: 'purchase-missing-historical-snapshot', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', documentType: '01', taxRate: 16,
    vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-note-missing-historical-snapshot', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', documentType: '03', taxRate: 16, vatAmountBs: 80,
    originalPurchaseId: original.id, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    position: calculateVatOwnPosition({
      outputVatBs: 0, purchaseCreditBs: 80, purchaseCredit16Bs: 80,
      purchaseCreditGrossBs: 160, purchaseCreditGross16Bs: 160,
      purchaseCreditNonEligibleBs: 80, receivedWithholdingsBs: 0,
      taxableSalesBaseBs: 500, exemptSalesBaseBs: 500, prorationRate: 0.5
    })
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  }), /no conserva la huella fiscal de la factura original/);
});

test('uses the original filed declaration snapshot if a purchase VAT treatment was later edited', () => {
  const original = {
    id: 'purchase-historical-treatment', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', documentType: '01', taxRate: 8,
    vatAmountBs: 80, vatCreditTreatment: 'EXEMPT'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-historical-treatment-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', documentType: '03', taxRate: 16, vatAmountBs: 80,
    originalPurchaseId: original.id
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9', vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
      })
    },
    position: calculateVatOwnPosition({
      outputVatBs: 0, purchaseCreditBs: 80, purchaseCredit16Bs: 80,
      purchaseCreditGrossBs: 160, purchaseCreditGross16Bs: 160,
      purchaseCreditNonEligibleBs: 80, receivedWithholdingsBs: 0,
      taxableSalesBaseBs: 500, exemptSalesBaseBs: 500, prorationRate: 0.5
    })
  };
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  });
  assert.equal(result.priorReversalEligible16Bs, 80);
  assert.equal(result.priorReversalNonEligible16Bs, 0);
  assert.equal(result.reclassifications[0].taxRate, 16);
});
 
test('blocks a prior-period credit note when the live supplier RIF differs from the filed invoice identity', () => {
  const original = {
    id: 'purchase-rif-history', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-87654321-0', documentType: '01', taxRate: 16,
    vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-rif-history-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-87654321-0', documentType: '03', taxRate: 16,
    vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', status: 'FILED' as const,
    sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01',
        supplierRif: 'J-12345678-9', vatCreditTreatment: 'TAXABLE',
        taxRate: 16, vatAmountBs: 160
      })
    }
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 1000, exemptSalesBaseBs: 0
  }), /RIF del proveedor de la nota de crédito no coincide con la huella histórica/);
});

test('blocks an unresolved prior filed source related to the original invoice even when its live record was removed', () => {
  const original = {
    id: 'purchase-missing-note-source-original', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'F-300', documentType: '01',
    taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const currentNote = {
    id: 'purchase-missing-note-source-current', companyId: 'company-a', invoiceDate: '2026-12-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-302', documentType: '03',
    taxRate: 16, vatAmountBs: 40, originalPurchaseId: original.id
  } as PurchaseRecord;
  const originalSnapshot = JSON.stringify({
    kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
    vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
  });
  const filedOriginal = {
    ...declaration, period: '2026-10', status: 'FILED' as const,
    sourceIds: [original.id], sourceSnapshots: { [original.id]: originalSnapshot }
  };
  const filedNovember = {
    ...declaration, period: '2026-11', status: 'FILED' as const,
    sourceIds: ['purchase-deleted-credit-note'], relatedSourceIds: [original.id],
    sourceSnapshots: { [original.id]: originalSnapshot }
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-12', purchases: [currentNote],
    allPurchases: [original, currentNote], priorDeclarations: [filedOriginal, filedNovember],
    taxableSalesBaseBs: 1000, exemptSalesBaseBs: 0
  }), /relacionada con la factura actual no conserva su huella fiscal histórica/);
});

test('blocks cumulative reversal when a previously filed credit note has no immutable snapshot', () => {
  const original = {
    id: 'purchase-cumulative-legacy-original', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'F-200', documentType: '01',
    taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const previousNote = {
    id: 'purchase-cumulative-legacy-note', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-201', documentType: '03',
    taxRate: 16, vatAmountBs: 100, originalPurchaseId: original.id
  } as PurchaseRecord;
  const currentNote = {
    id: 'purchase-cumulative-legacy-current', companyId: 'company-a', invoiceDate: '2026-12-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-202', documentType: '03',
    taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  const filedOriginal = {
    ...declaration, period: '2026-10', status: 'FILED' as const,
    sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
      })
    }
  };
  const filedNovember = {
    ...declaration, period: '2026-11', status: 'FILED' as const,
    sourceIds: [previousNote.id], relatedSourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
      })
    }
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-12', purchases: [currentNote],
    allPurchases: [original, previousNote, currentNote],
    priorDeclarations: [filedOriginal, filedNovember],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  }), /no conserva su huella fiscal histórica/);
});

test('blocks cumulative prior-period credit notes that exceed the original invoice VAT', () => {
  const original = {
    id: 'purchase-cumulative-original', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'F-100', documentType: '01',
    taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const previousNote = {
    id: 'purchase-cumulative-note-nov', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-101', documentType: '03',
    taxRate: 16, vatAmountBs: 100, originalPurchaseId: original.id
  } as PurchaseRecord;
  const currentNote = {
    id: 'purchase-cumulative-note-dec', companyId: 'company-a', invoiceDate: '2026-12-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-102', documentType: '03',
    taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  const filedOriginal = {
    ...declaration, period: '2026-10', status: 'FILED' as const,
    sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
      })
    }
  };
  const filedNovember = {
    ...declaration, period: '2026-11', status: 'FILED' as const,
    sourceIds: [previousNote.id], relatedSourceIds: [original.id],
    sourceSnapshots: {
      [previousNote.id]: JSON.stringify({
        kind: 'PURCHASE', id: previousNote.id, documentType: '03',
        originalPurchaseId: original.id, supplierRif: 'J-12345678-9', taxRate: 16, vatAmountBs: 100
      }),
      [original.id]: JSON.stringify({
        kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
        vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
      })
    }
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-12', purchases: [currentNote],
    allPurchases: [original, previousNote, currentNote],
    priorDeclarations: [filedOriginal, filedNovember],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  }), /notas de crédito acumuladas superan el IVA histórico de la factura original/);
});

test('accepts partial credit notes across filed periods up to the original VAT limit', () => {
  const original = {
    id: 'purchase-cumulative-valid-original', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'F-150', documentType: '01',
    taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const previousNote = {
    id: 'purchase-cumulative-valid-note-nov', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-151', documentType: '03',
    taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  const currentNote = {
    id: 'purchase-cumulative-valid-note-dec', companyId: 'company-a', invoiceDate: '2026-12-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'NC-152', documentType: '03',
    taxRate: 16, vatAmountBs: 80, originalPurchaseId: original.id
  } as PurchaseRecord;
  const originalSnapshot = JSON.stringify({
    kind: 'PURCHASE', id: original.id, documentType: '01', supplierRif: 'J-12345678-9',
    vatCreditTreatment: 'TAXABLE', taxRate: 16, vatAmountBs: 160
  });
  const filedOriginal = {
    ...declaration, period: '2026-10', status: 'FILED' as const,
    sourceIds: [original.id], sourceSnapshots: { [original.id]: originalSnapshot }
  };
  const filedNovember = {
    ...declaration, period: '2026-11', status: 'FILED' as const,
    sourceIds: [previousNote.id], relatedSourceIds: [original.id],
    sourceSnapshots: {
      [previousNote.id]: JSON.stringify({
        kind: 'PURCHASE', id: previousNote.id, documentType: '03',
        originalPurchaseId: original.id, supplierRif: 'J-12345678-9', taxRate: 16, vatAmountBs: 80
      }),
      [original.id]: originalSnapshot
    }
  };
  const result = calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-12', purchases: [currentNote],
    allPurchases: [original, previousNote, currentNote],
    priorDeclarations: [filedOriginal, filedNovember],
    taxableSalesBaseBs: 1000, exemptSalesBaseBs: 0
  });
  assert.equal(result.priorReversalEligible16Bs, 80);
  assert.equal(result.priorReversalNonEligible16Bs, 0);
  assert.equal(result.reclassifications.length, 1);
  assert.equal(result.reclassifications[0].basePurchaseId, original.id);
});

test('blocks a prior-period credit note when the filed snapshot has no historical tax rate', () => {
  const original = {
    id: 'purchase-missing-historical-rate', companyId: 'company-a', invoiceDate: '2026-10-05',
    supplierRif: 'J-12345678-9', documentType: '01', taxRate: 16, vatAmountBs: 160
  } as PurchaseRecord;
  const note = {
    id: 'purchase-note-missing-historical-rate', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', documentType: '03', taxRate: 16, vatAmountBs: 80,
    originalPurchaseId: original.id
  } as PurchaseRecord;
  const prior = {
    ...declaration, period: '2026-10', sourceIds: [original.id],
    sourceSnapshots: {
      [original.id]: JSON.stringify({ kind: 'PURCHASE', id: original.id, vatCreditTreatment: 'TAXABLE' })
    }
  };
  assert.throws(() => calculateVatOwnPurchaseCreditSummary({
    companyId: 'company-a', period: '2026-11', purchases: [note],
    allPurchases: [original, note], priorDeclarations: [prior],
    taxableSalesBaseBs: 0, exemptSalesBaseBs: 0
  }), /tratamiento, la alícuota y el IVA bruto históricos/);
});

test('requires an original purchase journal even when its VAT is fully creditable', () => {
  const purchase = {
    id: 'purchase-taxable-no-journal', companyId: 'company-a', invoiceDate: '2026-11-05',
    supplierRif: 'J-12345678-9', invoiceNumber: 'FC-100', documentType: '01',
    taxRate: 16, vatAmountBs: 160, taxableBaseBs: 1000, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  assert.throws(() => buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [purchase], journalEntries: [],
    summary: {
      prorationRate: 1, gross16Bs: 160, gross8Bs: 0,
      eligible16Bs: 160, eligible8Bs: 0, nonEligible16Bs: 0, nonEligible8Bs: 0,
      priorReversalEligible16Bs: 0, priorReversalEligible8Bs: 0,
      priorReversalNonEligible16Bs: 0, priorReversalNonEligible8Bs: 0,
      relatedPurchaseIds: [],
      reclassifications: [{ purchaseId: purchase.id, basePurchaseId: purchase.id, taxRate: 16, nonEligibleSignedBs: 0 }]
    }
  }), /no conserva su asiento de compra/);
});

test('reclassifies non-creditable VAT to the original inventory/expense debit account', () => {
  const original = {
    id: 'purchase-reclass', companyId: 'company-a', invoiceDate: '2026-11-02', supplierRif: 'J-12345678-9',
    documentType: '01', taxRate: 16, vatAmountBs: 160, taxableBaseBs: 1000,
    exemptAmountBs: 0, journalEntryId: 'purchase-journal'
  } as PurchaseRecord;
  const sourceJournal = {
    id: 'purchase-journal', companyId: 'company-a', date: '2026-11-02',
    entryNumber: 1, description: 'Compra', type: 'COMPRA', bcvRate: 200,
    createdAt: '2026-11-02T10:00:00.000Z',
    items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 5, creditUsd: 0 },
      { accountCode: '1.1.3.01', accountName: 'IVA crédito', debitBs: 160, creditBs: 0, debitUsd: 0.8, creditUsd: 0 }
    ]
  } as JournalEntry;
  const items = buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [original], journalEntries: [sourceJournal],
    summary: {
      prorationRate: 0.5, gross16Bs: 160, gross8Bs: 0,
      eligible16Bs: 80, eligible8Bs: 0, nonEligible16Bs: 80, nonEligible8Bs: 0,
      priorReversalEligible16Bs: 0, priorReversalEligible8Bs: 0,
      priorReversalNonEligible16Bs: 0, priorReversalNonEligible8Bs: 0,
      relatedPurchaseIds: [],
      reclassifications: [{ purchaseId: original.id, basePurchaseId: original.id, taxRate: 16, nonEligibleSignedBs: 80 }]
    }
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].accountCode, '1.1.4.01');
  assert.equal(items[0].debitBs, 80);
  assert.equal(items[1].accountCode, '1.1.3.01');
  assert.equal(items[1].creditBs, 80);
  assert.equal(items.reduce((sum, item) => sum + item.debitBs, 0), items.reduce((sum, item) => sum + item.creditBs, 0));
  assert.throws(() => buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [original], journalEntries: [
      sourceJournal,
      { id: 'purchase-journal-reversal', companyId: 'company-a', reversalOfEntryId: sourceJournal.id } as JournalEntry
    ],
    summary: {
      prorationRate: 0.5, gross16Bs: 160, gross8Bs: 0,
      eligible16Bs: 80, eligible8Bs: 0, nonEligible16Bs: 80, nonEligible8Bs: 0,
      priorReversalEligible16Bs: 0, priorReversalEligible8Bs: 0,
      priorReversalNonEligible16Bs: 0, priorReversalNonEligible8Bs: 0,
      relatedPurchaseIds: [],
      reclassifications: [{ purchaseId: original.id, basePurchaseId: original.id, taxRate: 16, nonEligibleSignedBs: 80 }]
    }
  }), /asiento de compra fue revertido/);
});

test('allocates non-creditable VAT proportionally across multiple original debit accounts', () => {
  const original = {
    id: 'purchase-multi-account', companyId: 'company-a', invoiceDate: '2026-11-02',
    documentType: '01', taxRate: 16, vatAmountBs: 160, taxableBaseBs: 1000,
    exemptAmountBs: 0, journalEntryId: 'purchase-multi-journal'
  } as PurchaseRecord;
  const sourceJournal = {
    id: 'purchase-multi-journal', companyId: 'company-a', date: '2026-11-02',
    entryNumber: 2, description: 'Compra distribuida', type: 'COMPRA', bcvRate: 200,
    createdAt: '2026-11-02T10:00:00.000Z',
    items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 600, creditBs: 0, debitUsd: 3, creditUsd: 0 },
      { accountCode: '6.1.1.01', accountName: 'Gasto operativo', debitBs: 400, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '1.1.3.01', accountName: 'IVA crédito', debitBs: 160, creditBs: 0, debitUsd: 0.8, creditUsd: 0 }
    ]
  } as JournalEntry;
  const items = buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [original], journalEntries: [sourceJournal],
    summary: {
      prorationRate: 0.5, gross16Bs: 160, gross8Bs: 0,
      eligible16Bs: 80, eligible8Bs: 0, nonEligible16Bs: 80, nonEligible8Bs: 0,
      priorReversalEligible16Bs: 0, priorReversalEligible8Bs: 0,
      priorReversalNonEligible16Bs: 0, priorReversalNonEligible8Bs: 0,
      relatedPurchaseIds: [],
      reclassifications: [{ purchaseId: original.id, basePurchaseId: original.id, taxRate: 16, nonEligibleSignedBs: 80 }]
    }
  });
  assert.deepEqual(items.map(item => [item.accountCode, item.debitBs, item.creditBs]), [
    ['1.1.4.01', 48, 0],
    ['6.1.1.01', 32, 0],
    ['1.1.3.01', 0, 80]
  ]);
  assert.equal(items.reduce((sum, item) => sum + item.debitBs, 0), 80);
  assert.equal(items.reduce((sum, item) => sum + item.creditBs, 0), 80);
  assert.equal(items.reduce((sum, item) => sum + item.debitUsd, 0), 0.4);
  assert.equal(items.reduce((sum, item) => sum + item.creditUsd, 0), 0.4);
});

test('reverses the prior non-creditable VAT reclassification when a prior-period purchase is credited', () => {
  const original = {
    id: 'purchase-reclass-old', companyId: 'company-a', invoiceDate: '2026-10-02',
    documentType: '01', taxRate: 16, vatAmountBs: 160, taxableBaseBs: 1000,
    exemptAmountBs: 0, journalEntryId: 'purchase-journal-old'
  } as PurchaseRecord;
  const sourceJournal = {
    id: 'purchase-journal-old', companyId: 'company-a', date: '2026-10-02',
    entryNumber: 1, description: 'Compra', type: 'COMPRA', bcvRate: 200,
    createdAt: '2026-10-02T10:00:00.000Z',
    items: [{ accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 5, creditUsd: 0 }]
  } as JournalEntry;
  const sourcePurchaseSnapshot = JSON.stringify({
    kind: 'PURCHASE', id: original.id, invoiceNumber: 'FC-OLD',
    taxRate: 16, vatAmountBs: 160, taxableBaseBs: 1000, exemptAmountBs: 0,
    journalEntryId: sourceJournal.id,
    journal: {
      id: sourceJournal.id, date: sourceJournal.date, type: sourceJournal.type,
      items: [{ accountCode: '1.1.4.01', debitBs: 1000, creditBs: 0, debitUsd: 5, creditUsd: 0 }]
    }
  });
  const summary = {
    prorationRate: 1, gross16Bs: 0, gross8Bs: 0, eligible16Bs: 0, eligible8Bs: 0,
    nonEligible16Bs: 0, nonEligible8Bs: 0, priorReversalEligible16Bs: 40,
    priorReversalEligible8Bs: 0, priorReversalNonEligible16Bs: 40,
    priorReversalNonEligible8Bs: 0, relatedPurchaseIds: [original.id],
    reclassifications: [{
      purchaseId: 'credit-note-old', basePurchaseId: original.id, taxRate: 16,
      nonEligibleSignedBs: -40, sourcePurchaseSnapshot
    }]
  };
  const items = buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [original], journalEntries: [sourceJournal], summary
  });
  assert.equal(items[0].accountCode, '1.1.4.01');
  assert.equal(items[0].creditBs, 40);
  assert.equal(items[1].accountCode, '1.1.3.01');
  assert.equal(items[1].debitBs, 40);
  assert.equal(items.reduce((sum, item) => sum + item.debitUsd, 0), 0.2);
  assert.equal(items.reduce((sum, item) => sum + item.creditUsd, 0), 0.2);
  const changedJournal = {
    ...sourceJournal,
    items: [{ ...sourceJournal.items[0], accountCode: '6.1.1.01' }]
  } as JournalEntry;
  assert.throws(() => buildVatOwnPurchaseVatReclassificationItems({
    companyId: 'company-a', period: '2026-11', bcvRate: 200,
    allPurchases: [original], journalEntries: [changedJournal], summary
  }), /difiere de la huella fiscal presentada/);
});

test('blocks a prior-period purchase credit note when its original invoice was never included in a filed declaration', () => {
  const original = {
    id: 'purchase-unfiled', companyId: 'company-a', invoiceDate: '2026-10-05', supplierRif: 'J-12345678-9',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'TAXABLE'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note-unfiled', companyId: 'company-a', invoiceDate: '2026-11-05', supplierRif: 'J-12345678-9',
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
    id: 'purchase-current', companyId: 'company-a', invoiceDate: '2026-11-02', supplierRif: 'J-12345678-9',
    documentType: '01', taxRate: 16, vatAmountBs: 160, vatCreditTreatment: 'COMMON'
  } as PurchaseRecord;
  const note = {
    id: 'purchase-credit-note-current', companyId: 'company-a', invoiceDate: '2026-11-20', supplierRif: 'J-12345678-9',
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

test('keeps negative output VAT adjustments split by rate and increases carry-forward correctly', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0,
    purchaseCreditBs: 0, receivedWithholdingsBs: 0,
    debitAdjustmentsBs: 20, creditAdjustmentsBs: 100,
    creditAdjustments16Bs: 0, creditAdjustments8Bs: 100
  });
  assert.equal(position.creditAdjustmentsBs, 100);
  assert.equal(position.creditAdjustments16Bs, 0);
  assert.equal(position.creditAdjustments8Bs, 100);
  assert.equal(position.netTaxBs, -80);
  assert.equal(position.creditCarryForwardBs, 80);
  assert.throws(() => calculateVatOwnPosition({
    outputVatBs: 0, purchaseCreditBs: 0, receivedWithholdingsBs: 0,
    creditAdjustmentsBs: 100, creditAdjustments16Bs: 40, creditAdjustments8Bs: 40
  }), /desglose de ajustes al crédito fiscal/);
});

test('adds reversal of eligible purchase credit from a prior-period credit note before applying carry-forward', () => {
  const position = calculateVatOwnPosition({
    outputVatBs: 100, purchaseCreditBs: 0, purchaseCreditReversalBs: 40,
    purchaseCreditReversal16Bs: 40, purchaseCreditReversal8Bs: 0,
    receivedWithholdingsBs: 0, priorCreditBs: 80
  });
  assert.equal(position.amountDueBs, 60);
  assert.equal(position.priorCreditAppliedBs, 80);
  assert.equal(position.creditCarryForwardBs, 0);
  assert.equal(position.purchaseCreditReversalBs, 40);
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
  assert.throws(() => validateVatOwnDeclarationDraft({
    id: 'd2', companyId: 'company-a', period: '2026-01',
    sourceIds: ['purchase-1'], relatedSourceIds: ['purchase-1'],
    createdAt: '2026-02-01T00:00:00.000Z'
  }), /separados de las fuentes directas/);
  assert.throws(() => validateVatOwnDeclarationDraft({
    id: 'd3', companyId: 'company-a', period: '2026-01', sourceIds: [],
    purchaseVatReclassificationItems: [{
      accountCode: '1.1.4.01', accountName: 'Inventario',
      debitBs: -10, creditBs: 0, debitUsd: 0, creditUsd: 0
    }], createdAt: '2026-02-01T00:00:00.000Z'
  }), /importes inválidos/);
});

test('does not allow presenting a monthly IVA declaration before its fiscal month closes', () => {
  const draftDeclaration = { ...declaration, status: 'DRAFT' as const, declarationNumber: undefined, filedAt: undefined };
  const filing = {
    declarationId: draftDeclaration.id, companyId: draftDeclaration.companyId,
    eventType: 'FILED' as const, declarationNumber: 'F30-001',
    idempotencyKey: 'FILED:' + draftDeclaration.id
  };
  assert.throws(() => validateVatOwnEvent({
    declaration: draftDeclaration, events: [],
    draft: { ...filing, occurredAt: '2026-01-31T23:00:00.000Z' }
  }), /antes de que finalice el período fiscal seleccionado/);
  assert.doesNotThrow(() => validateVatOwnEvent({
    declaration: draftDeclaration, events: [],
    draft: { ...filing, occurredAt: '2026-02-01T00:01:00.000Z' }
  }));
});

test('rejects future-dated IVA payments', () => {
  const future = new Date();
  future.setDate(future.getDate() + 1);
  const futureDate = future.getFullYear() + '-' + String(future.getMonth() + 1).padStart(2, '0') + '-' + String(future.getDate()).padStart(2, '0');
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ occurredAt: futureDate + 'T12:00:00.000Z' })
  }), /fecha del pago no puede ser futura/);
});

test('rejects malformed or impossible IVA event timestamps', () => {
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ occurredAt: '2026-02-31T10:00:00.000Z' })
  }), /fecha del evento no es válida/);
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ occurredAt: '2026-02-12' })
  }), /fecha del evento no es válida/);
});

test('allows partial payment and computes remaining balance', () => {
  const event = { ...payment(), id: 'event-1', recordedAt: '2026-02-12T10:01:00.000Z' };
  validateVatOwnEvent({ declaration, events: [], draft: payment() });
  assert.equal(getVatOwnOutstandingBalance(declaration, [event]), 350);
});

test('rejects IVA payments dated before the declaration was filed', () => {
  assert.throws(() => validateVatOwnEvent({
    declaration, events: [], draft: payment({ occurredAt: '2026-02-09T10:00:00.000Z' })
  }), /no puede ser anterior al día de presentación/);
  assert.doesNotThrow(() => validateVatOwnEvent({
    declaration: { ...declaration, filedAt: '2026-02-10T12:00:00-04:00' },
    events: [], draft: payment({ occurredAt: '2026-02-10T12:00:00.000Z' })
  }));
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

test('includes individual sales entered at 0% in the exempt base used by monthly IVA proration', async () => {
  const { resolveVatOwnDailySalesSources } = await import('./vatOwnDeclaration');
  const result = resolveVatOwnDailySalesSources({
    zReports: [],
    sales: [{
      id: 'sale-exempt-0', date: '2026-01-03', documentType: '01',
      taxableBaseBs: 500, taxRate: 0, vatAmountBs: 0, exemptAmountBs: 100
    }]
  });
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].exemptSalesBs, 600);
  assert.equal(result.days[0].taxableBase16Bs + result.days[0].taxableBase8Bs + result.days[0].taxableBase31Bs, 0);
  assert.equal(result.days[0].outputVatBs, 0);
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
