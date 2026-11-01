import test from 'node:test';
import assert from 'node:assert/strict';
import type { PurchaseRecord } from './accounting';
import {
  validateSupplierDebitNotePreflight,
  type SupplierDebitNotePreflightDraft
} from './supplierDebitNote';

const sourcePurchase: PurchaseRecord = {
  id: 'purchase-1',
  companyId: 'company-1',
  opNumber: 1,
  invoiceDate: '2026-10-01',
  supplierRif: 'J-12345678-9',
  supplierName: 'Proveedor Original C.A.',
  invoiceNumber: 'FAC-100',
  controlNumber: 'CTRL-100',
  documentType: '01',
  totalAmountBs: 116,
  taxableBaseBs: 100,
  exemptAmountBs: 0,
  taxRate: 16,
  vatAmountBs: 16,
  retentionRate: 0,
  vatWithheldBs: 0,
  bcvRate: 100,
  totalAmountUsd: 1.16,
  taxableBaseUsd: 1,
  vatAmountUsd: 0.16,
  vatWithheldUsd: 0,
  paymentTerm: 'CREDITO'
};

const draft = (overrides: Partial<SupplierDebitNotePreflightDraft> = {}): SupplierDebitNotePreflightDraft => ({
  companyId: 'company-1',
  sourcePurchaseId: 'purchase-1',
  debitNoteNumber: 'ND-001',
  controlNumber: 'CTRL-ND-001',
  affectedInvoiceNumber: 'FAC-100',
  issueDate: '2026-10-10',
  recognitionDate: '2026-10-10',
  economicCause: 'ADDITIONAL_EXPENSE',
  reason: 'Cargo adicional documentado por el proveedor.',
  totalAmountBs: 25,
  bcvRate: 100,
  purchases: [sourcePurchase],
  ...overrides
});

test('valida el vínculo documental y devuelve un preflight sin autorización de contabilizar', () => {
  const result = validateSupplierDebitNotePreflight(draft());
  assert.equal(result.sourcePurchaseId, sourcePurchase.id);
  assert.equal(result.supplierRif, 'J123456789');
  assert.equal(result.affectedInvoiceNumber, 'FAC-100');
  assert.equal(result.postingAllowed, false);
  assert.equal(result.inventoryPostingAllowed, false);
  assert.equal(result.fiscalAutomationAllowed, false);
});

test('rechaza factura original inexistente o de otra empresa', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    sourcePurchaseId: 'missing'
  })), /no existe en la empresa activa/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    companyId: 'company-2'
  })), /no existe en la empresa activa/);
});

test('rechaza factura original anulada o que no sea tipo 01', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    purchases: [{ ...sourcePurchase, isCancelled: true }]
  })), /no existe en la empresa activa/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    purchases: [{ ...sourcePurchase, documentType: '03' }]
  })), /no existe en la empresa activa/);
});

test('exige coincidencia exacta normalizada con el número de factura afectada', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    affectedInvoiceNumber: 'FAC-999'
  })), /número exacto de la factura afectada/);
});

test('rechaza ND duplicada para el mismo proveedor y empresa', () => {
  const existing: PurchaseRecord = {
    ...sourcePurchase,
    id: 'debit-note-existing',
    invoiceNumber: 'ND-001',
    debitNoteNumber: 'ND-001',
    documentType: '02'
  };
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    purchases: [sourcePurchase, existing]
  })), /número de nota de débito ya existe/);
});

test('permite el mismo número documental para otro proveedor o empresa', () => {
  const otherSupplier: PurchaseRecord = {
    ...sourcePurchase,
    id: 'other-supplier-note',
    supplierRif: 'J-99999999-9',
    invoiceNumber: 'ND-001',
    debitNoteNumber: 'ND-001',
    documentType: '02'
  };
  assert.doesNotThrow(() => validateSupplierDebitNotePreflight(draft({
    purchases: [sourcePurchase, otherSupplier]
  })));
});

test('rechaza fechas imposibles, cronología invertida y períodos cerrados', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    issueDate: '2026-02-30'
  })), /fechas de la nota deben ser válidas/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    issueDate: '2026-09-30'
  })), /fechas de la nota deben ser válidas/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    recognitionDate: '2026-10-09'
  })), /fechas de la nota deben ser válidas/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    closedThroughDate: '2026-10-10'
  })), /período contable cerrado/);
});

test('rechaza importes y tasas inválidos', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    totalAmountBs: 0
  })), /valores numéricos positivos/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    totalAmountBs: Number.NaN
  })), /valores numéricos positivos/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    bcvRate: -1
  })), /valores numéricos positivos/);
});

test('exige causa económica explícita y justificación suficiente', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    economicCause: 'UNKNOWN' as any
  })), /causa económica válida/);
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    reason: 'cargo'
  })), /justificación.*10 caracteres/);
});

test('la causa Otra exige explicación de clasificación', () => {
  assert.throws(() => validateSupplierDebitNotePreflight(draft({
    economicCause: 'OTHER',
    classificationNote: 'Otro'
  })), /causa “Otra” requiere/);
  assert.doesNotThrow(() => validateSupplierDebitNotePreflight(draft({
    economicCause: 'OTHER',
    classificationNote: 'Servicio accesorio no incluido en catálogo de causas.'
  })));
});

test('la clasificación no autoriza movimiento de inventario ni tratamiento fiscal automático', () => {
  const result = validateSupplierDebitNotePreflight(draft({
    economicCause: 'ADDITIONAL_GOODS_RECEIVED'
  }));
  assert.equal(result.inventoryPostingAllowed, false);
  assert.equal(result.fiscalAutomationAllowed, false);
  assert.equal(result.postingAllowed, false);
});
