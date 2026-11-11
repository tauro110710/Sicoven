import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateVatOwnPosition,
  getVatOwnOutstandingBalance,
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
