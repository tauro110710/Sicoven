import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateVatOwnPosition,
  getVatOwnOutstandingBalance,
  resolveVatOwnDailySalesSources,
  validateVatOwnDeclarationDraft,
  validateVatOwnEvent,
  type VatOwnDeclaration,
  type VatOwnDeclarationEvent
} from './vatOwnDeclaration';

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
