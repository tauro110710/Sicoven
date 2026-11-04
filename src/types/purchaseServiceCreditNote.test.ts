import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePurchaseServiceCreditNote } from './purchaseServiceCreditNote';
import type { PurchaseRecord } from './accounting';

const source: PurchaseRecord = {
  id: 'purchase-service', companyId: 'company-1', opNumber: 1,
  invoiceDate: '2026-10-01', accountCreditDate: '2026-10-01',
  supplierRif: 'J-12345678-9', supplierName: 'Proveedor de servicios',
  invoiceNumber: 'FC-100', controlNumber: 'CTRL-100', documentType: '01',
  totalAmountBs: 1160, taxableBaseBs: 1000, exemptAmountBs: 0,
  taxRate: 16, vatAmountBs: 160, retentionRate: 0, vatWithheldBs: 0,
  bcvRate: 100, totalAmountUsd: 11.6, taxableBaseUsd: 10,
  vatAmountUsd: 1.6, vatWithheldUsd: 0, paymentTerm: 'CREDITO'
};

const draft = (overrides: Partial<Parameters<typeof calculatePurchaseServiceCreditNote>[0]> = {}) => ({
  purchase: source, noteDate: '2026-11-01', creditNoteNumber: 'NC-001',
  controlNumber: 'CTRL-NC-001', reason: 'Descuento parcial acordado con proveedor',
  workpaperNote: 'Se verificó el contrato, el servicio y la nota fiscal recibida.',
  taxableBaseBs: 100, exemptAmountBs: 0, bcvRate: 100, fiscalEmissionMedium: 'DIGITAL' as const, sameMediumAsOriginal: true, priorCreditNotes: [],
  ...overrides
});

test('calculates a service purchase credit note in both currencies', () => {
  const result = calculatePurchaseServiceCreditNote(draft());
  assert.equal(result.taxableBaseBs, 100);
  assert.equal(result.vatAmountBs, 16);
  assert.equal(result.totalAmountBs, 116);
  assert.equal(result.totalAmountUsd, 1.16);
  assert.equal(result.netPayableReductionBs, 116);
});

test('blocks service credit notes for invoices with inventory lines', () => {
  assert.throws(() => calculatePurchaseServiceCreditNote(draft({
    purchase: { ...source, inventoryLines: [{ productId: 'p1', quantity: 1, unitCostBs: 1000 }] }
  })), /Kardex/);
});

test('blocks service credit notes when withholding tax must be rectified', () => {
  assert.throws(() => calculatePurchaseServiceCreditNote(draft({
    purchase: { ...source, vatWithheldBs: 20 }
  })), /retenciones/);
});

test('blocks cumulative credit notes above the original taxable base', () => {
  const prior: PurchaseRecord = {
    ...source, id: 'prior-note', documentType: '03', originalPurchaseId: source.id,
    taxableBaseBs: 950, exemptAmountBs: 0, vatAmountBs: 152, totalAmountBs: 1102
  };
  assert.throws(() => calculatePurchaseServiceCreditNote(draft({
    priorCreditNotes: [prior], taxableBaseBs: 100
  })), /supera la base imponible/);
});
