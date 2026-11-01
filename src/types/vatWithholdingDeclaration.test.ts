import test from 'node:test';
import assert from 'node:assert/strict';
import type { VatRetentionVoucher, VatWithholdingDeclaration } from './accounting';
import {
  buildVatWithholdingDeclaration,
  getVatDeclarationStatus,
  getVatDeclarationWindowRange,
  validateVatDeclarationEventDraft
} from './vatWithholdingDeclaration';

const voucher = (overrides: Partial<VatRetentionVoucher> = {}): VatRetentionVoucher => ({
  id: 'voucher-1', companyId: 'company-1', voucherNumber: '20261000000001',
  date: '2026-10-03', period: '202610', fiscalDate: '2026-10-03',
  fiscalTrigger: 'PAYMENT', supplierRif: 'J-12345678-9', supplierName: 'Proveedor Uno',
  supplierAddress: 'Venezuela', purchaseRecordId: 'purchase-1', invoiceDate: '2026-10-02',
  invoiceNumber: 'FAC-1', controlNumber: 'CTRL-1', totalAmountBs: 1160,
  exemptAmountBs: 0, taxableBaseBs: 1000, taxRate: 16, vatAmountBs: 160,
  retentionRate: 75, vatWithheldBs: 120, bcvRate: 100, totalAmountUsd: 11.6,
  vatWithheldUsd: 1.2, ...overrides
});

const draft = (overrides: Partial<VatWithholdingDeclaration> = {}): VatWithholdingDeclaration =>
  buildVatWithholdingDeclaration({
    id: 'decl-1', companyId: 'company-1', year: 2026, month: 10, window: 'FIRST_HALF',
    vouchers: [voucher()], existingDeclarations: [], createdAt: '2026-10-16T10:00:00.000Z',
    ...overrides
  });

test('quincena helper resolves exact first and second half dates including leap-year month ends', () => {
  assert.deepEqual(getVatDeclarationWindowRange(2026, 10, 'FIRST_HALF'), {
    period: '202610', window: 'FIRST_HALF', startDate: '2026-10-01', endDate: '2026-10-15'
  });
  assert.deepEqual(getVatDeclarationWindowRange(2024, 2, 'SECOND_HALF'), {
    period: '202402', window: 'SECOND_HALF', startDate: '2024-02-16', endDate: '2024-02-29'
  });
  assert.throws(() => getVatDeclarationWindowRange(2026, 13, 'FIRST_HALF'), /año, mes y quincena/);
});

test('declaration snapshots only vouchers in the selected company and exact half-month', () => {
  const result = buildVatWithholdingDeclaration({
    id: 'decl-1', companyId: 'company-1', year: 2026, month: 10, window: 'FIRST_HALF',
    vouchers: [
      voucher(),
      voucher({ id: 'second-half', voucherNumber: '20261000000002', date: '2026-10-16', fiscalDate: '2026-10-16' }),
      voucher({ id: 'other-company', companyId: 'company-2' })
    ],
    existingDeclarations: [], createdAt: '2026-10-16T10:00:00.000Z'
  });
  assert.deepEqual(result.voucherIds, ['voucher-1']);
  assert.equal(result.totalWithheldBs, 120);
  assert.equal(result.zeroOperations, false);
});

test('zero-operation declaration is explicit and rejected if any voucher exists', () => {
  assert.throws(() => draft({ zeroOperations: true }), /existen comprobantes/);
  const result = buildVatWithholdingDeclaration({
    id: 'decl-zero', companyId: 'company-1', year: 2026, month: 10, window: 'SECOND_HALF',
    vouchers: [], existingDeclarations: [], createdAt: '2026-11-01T10:00:00.000Z',
    zeroOperations: true
  });
  assert.equal(result.zeroOperations, true);
  assert.equal(result.voucherIds.length, 0);
  assert.equal(result.totalWithheldBs, 0);
});

test('legacy voucher dates must be verified from source evidence before either half-month can be declared', () => {
  const legacy = voucher({ fiscalDate: undefined, date: '2026-10-03' });
  assert.throws(() => buildVatWithholdingDeclaration({
    id: 'decl-unverified', companyId: 'company-1', year: 2026, month: 10, window: 'FIRST_HALF',
    vouchers: [legacy], existingDeclarations: [], createdAt: '2026-10-16T10:00:00.000Z'
  }), /fecha efectiva de pago\/abono/);

  const firstHalf = buildVatWithholdingDeclaration({
    id: 'decl-first', companyId: 'company-1', year: 2026, month: 10, window: 'FIRST_HALF',
    vouchers: [legacy], existingDeclarations: [], createdAt: '2026-10-16T10:00:00.000Z',
    zeroOperations: true,
    legacyFiscalDates: { [legacy.id]: {
      fiscalDate: '2026-10-20',
      note: 'Se verificó el comprobante bancario del pago y su fecha efectiva.'
    } }
  });
  assert.equal(firstHalf.voucherSnapshots.length, 0);
  assert.equal(firstHalf.legacyDateAssignments[0].confirmedFiscalDate, '2026-10-20');

  const secondHalf = buildVatWithholdingDeclaration({
    id: 'decl-second', companyId: 'company-1', year: 2026, month: 10, window: 'SECOND_HALF',
    vouchers: [legacy], existingDeclarations: [firstHalf],
    createdAt: '2026-11-01T10:00:00.000Z'
  });
  assert.deepEqual(secondHalf.voucherIds, [legacy.id]);
  assert.equal(secondHalf.voucherSnapshots[0].dateBasis, 'MANUALLY_VERIFIED_LEGACY_DATE');
  assert.match(secondHalf.voucherSnapshots[0].dateVerificationNote || '', /comprobante bancario/);
});

test('declaration workflow requires review, filing receipt, then supported payments', () => {
  const declaration = draft();
  const reviewed = { id: 'event-1', declarationId: declaration.id, eventType: 'REVIEWED' as const,
    occurredAt: '2026-10-16', recordedAt: '2026-10-16T10:00:00.000Z' };
  assert.equal(getVatDeclarationStatus(declaration, []), 'PREPARED');
  assert.throws(() => validateVatDeclarationEventDraft(declaration, [], {
    eventType: 'FILED', occurredAt: '2026-10-16', declarationNumber: 'D-1', receiptReference: 'ACK-1'
  }), /revisada/);
  validateVatDeclarationEventDraft(declaration, [], { eventType: 'REVIEWED', occurredAt: '2026-10-16' });
  assert.equal(getVatDeclarationStatus(declaration, [reviewed]), 'REVIEWED');
  const filed = { id: 'event-2', declarationId: declaration.id, eventType: 'FILED' as const,
    occurredAt: '2026-10-17', recordedAt: '2026-10-17T10:00:00.000Z',
    declarationNumber: 'D-1', receiptReference: 'ACK-1' };
  validateVatDeclarationEventDraft(declaration, [reviewed], {
    eventType: 'FILED', occurredAt: '2026-10-17', declarationNumber: 'D-1', receiptReference: 'ACK-1'
  });
  const partial = { id: 'event-3', declarationId: declaration.id, eventType: 'PAYMENT' as const,
    occurredAt: '2026-10-18', recordedAt: '2026-10-18T10:00:00.000Z',
    amountBs: 50, paymentReference: 'TRX-1', evidenceReference: 'REC-1' };
  validateVatDeclarationEventDraft(declaration, [reviewed, filed], {
    eventType: 'PAYMENT', occurredAt: '2026-10-18', amountBs: 50,
    paymentReference: 'TRX-1', evidenceReference: 'REC-1'
  });
  assert.equal(getVatDeclarationStatus(declaration, [reviewed, filed, partial]), 'PARTIALLY_PAID');
  const finalPayment = { id: 'event-4', declarationId: declaration.id, eventType: 'PAYMENT' as const,
    occurredAt: '2026-10-19', recordedAt: '2026-10-19T10:00:00.000Z',
    amountBs: 70, paymentReference: 'TRX-2', evidenceReference: 'REC-2' };
  validateVatDeclarationEventDraft(declaration, [reviewed, filed, partial], {
    eventType: 'PAYMENT', occurredAt: '2026-10-19', amountBs: 70,
    paymentReference: 'TRX-2', evidenceReference: 'REC-2'
  });
  assert.equal(getVatDeclarationStatus(declaration, [reviewed, filed, partial, finalPayment]), 'PAID');
  assert.throws(() => validateVatDeclarationEventDraft(declaration, [reviewed, filed, partial], {
    eventType: 'PAYMENT', occurredAt: '2026-10-19', amountBs: 71,
    paymentReference: 'TRX-3', evidenceReference: 'REC-3'
  }), /no puede superar/);
});

test('due date requires an official SENIAT HTTPS source and is never calculated automatically', () => {
  const declaration = draft();
  assert.throws(() => validateVatDeclarationEventDraft(declaration, [], {
    eventType: 'DUE_DATE_SET', occurredAt: '2026-10-16', dueDate: '2026-10-20',
    officialSourceTitle: 'Calendario', officialReference: 'Gaceta', officialSourceUrl: 'https://example.com/calendar'
  }), /dominio oficial SENIAT/);
  assert.doesNotThrow(() => validateVatDeclarationEventDraft(declaration, [], {
    eventType: 'DUE_DATE_SET', occurredAt: '2026-10-16', dueDate: '2026-10-20',
    officialSourceTitle: 'Calendario oficial SENIAT', officialReference: 'Publicación oficial',
    officialSourceUrl: 'https://www.seniat.gob.ve/calendario'
  }));
});
