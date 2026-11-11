import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSaleCorrectionNote } from './saleCorrectionNote';
import type { SaleRecord } from './accounting';

const source: SaleRecord = {
  id: 'sale-source', companyId: 'company-1', opNumber: 1, invoiceDate: '2026-10-01',
  customerRif: 'J-12345678-9', customerName: 'Cliente', invoiceNumber: 'F-100',
  controlNumber: 'C-100', documentType: '01', totalAmountBs: 1260,
  exemptAmountBs: 100, taxableBaseBs: 1000, taxRate: 16, vatAmountBs: 160,
  vatWithheldBs: 0, bcvRate: 100, totalAmountUsd: 12.6, taxableBaseUsd: 10,
  vatAmountUsd: 1.6, vatWithheldUsd: 0, paymentTerm: 'CREDITO'
};

const draft = (overrides: Partial<Parameters<typeof calculateSaleCorrectionNote>[0]> = {}) => ({
  kind: 'CREDIT' as const, sourceSale: source, noteDate: '2026-11-01',
  noteNumber: 'NC-001', controlNumber: 'CTRL-001',
  reason: 'Devolución parcial acordada con el cliente',
  workpaperNote: '',
  taxableBaseBs: 50, exemptAmountBs: 10, bcvRate: 110,
  fiscalEmissionMedium: 'DIGITAL' as const, sameMediumAsOriginal: true,
  priorCreditNotes: [], ...overrides
});

test('calculates a partial sales credit note without mutating its source invoice', () => {
  const before = structuredClone(source);
  const result = calculateSaleCorrectionNote(draft());
  assert.equal(result.taxableBaseBs, 50);
  assert.equal(result.exemptAmountBs, 10);
  assert.equal(result.vatAmountBs, 8);
  assert.equal(result.totalAmountBs, 68);
  assert.equal(result.netReceivableAdjustmentBs, 68);
  assert.equal(source.totalAmountBs, before.totalAmountBs);
  assert.equal(source.invoiceNumber, before.invoiceNumber);
});

test('calculates a sales debit note with the same original VAT rate', () => {
  const result = calculateSaleCorrectionNote(draft({ kind: 'DEBIT', taxableBaseBs: 100, exemptAmountBs: 0 }));
  assert.equal(result.vatAmountBs, 16);
  assert.equal(result.totalAmountBs, 116);
});

test('blocks a credit note that exceeds the remaining original taxable base', () => {
  const prior: SaleRecord = {
    ...source, id: 'nc-prior', documentType: '03', originalSaleId: source.id,
    taxableBaseBs: 980, exemptAmountBs: 0, vatAmountBs: 156.8, totalAmountBs: 1136.8
  };
  assert.throws(() => calculateSaleCorrectionNote(draft({
    priorCreditNotes: [prior], taxableBaseBs: 30
  })), /supera la base imponible/);
});

test('distributes VAT withholding proportionally without blocking the correction', () => {
  const result = calculateSaleCorrectionNote(draft({
    sourceSale: { ...source, vatWithheldBs: 4 }
  }));
  assert.equal(result.vatAmountBs, 8);
  assert.equal(result.vatWithheldBs, 2);
  assert.equal(result.netReceivableAdjustmentBs, 66);
});

test('calculates cash-sale corrections; treasury selection is validated by the accounting workflow', () => {
  const result = calculateSaleCorrectionNote(draft({
    sourceSale: { ...source, paymentTerm: 'CONTADO' }
  }));
  assert.equal(result.totalAmountBs, 68);
  assert.equal(result.netReceivableAdjustmentBs, 68);
});

test('separates 16% VAT, 15% luxury tax and 3% IGTF on combined-rate source invoices', () => {
  const combined: SaleRecord = {
    ...source, taxableBaseBs: 1000, exemptAmountBs: 0, taxRate: 31,
    vatAmountBs: 160, additionalLuxuryTaxBs: 150, igtfApplicable: true,
    igtfRate: 3, igtfAmountBs: 42.3, totalAmountBs: 1352.3
  };
  const result = calculateSaleCorrectionNote(draft({
    sourceSale: combined, taxableBaseBs: 100, exemptAmountBs: 0
  }));
  assert.equal(result.vatAmountBs, 16);
  assert.equal(result.additionalLuxuryTaxBs, 15);
  assert.equal(result.igtfAmountBs, 3.93);
  assert.equal(result.totalAmountBs, 134.93);
});

test('blocks a note dated inside a closed accounting period', () => {
  assert.throws(() => calculateSaleCorrectionNote(draft({
    closedThroughDate: '2026-11-01'
  })), /período contable cerrado/);
});

test('requires explicit matching fiscal emission medium for a correction note', () => {
  assert.throws(() => calculateSaleCorrectionNote(draft({
    fiscalEmissionMedium: '' as any, sameMediumAsOriginal: false
  })), /mismo medio de la factura original/);
});

test('does not require a workpaper attachment or note to calculate a sales correction', () => {
  const result = calculateSaleCorrectionNote(draft({ workpaperNote: '' }));
  assert.equal(result.totalAmountBs, 68);
});
