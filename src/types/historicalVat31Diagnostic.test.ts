import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalVat31Diagnostic,
  resolveHistoricalVat31AdjustmentDate,
  HISTORICAL_VAT31_ADJUSTMENT_REASON
} from './historicalVat31Diagnostic';
import type { JournalEntry, PurchaseRecord, SaleRecord } from './accounting';

const purchase = (overrides: Partial<PurchaseRecord> = {}): PurchaseRecord => ({
  id: 'purchase-1', companyId: 'company-1', opNumber: 1,
  invoiceDate: '2026-09-15', supplierRif: 'J-12345678-9', supplierName: 'Proveedor Suntuario, C.A.',
  invoiceNumber: 'FAC-001', controlNumber: '00-0001', documentType: '01',
  totalAmountBs: 1310, exemptAmountBs: 0, taxableBaseBs: 1000, taxRate: 31,
  vatAmountBs: 310, retentionRate: 0, vatWithheldBs: 0,
  bcvRate: 100, totalAmountUsd: 13.1, taxableBaseUsd: 10, vatAmountUsd: 3.1, vatWithheldUsd: 0,
  journalEntryId: 'entry-1',
  ...overrides
} as PurchaseRecord);

const sale = (overrides: Partial<SaleRecord> = {}): SaleRecord => ({
  id: 'sale-1', companyId: 'company-1', opNumber: 1,
  invoiceDate: '2026-09-20', customerRif: 'J-98765432-1', customerName: 'Cliente Suntuario, C.A.',
  invoiceNumber: 'FAC-100', controlNumber: '00-0100', documentType: '01',
  totalAmountBs: 1310, exemptAmountBs: 0, taxableBaseBs: 1000, taxRate: 31,
  vatAmountBs: 310, vatWithheldBs: 0,
  bcvRate: 100, totalAmountUsd: 13.1, taxableBaseUsd: 10, vatAmountUsd: 3.1, vatWithheldUsd: 0,
  journalEntryId: 'entry-sale',
  ...overrides
} as SaleRecord);

const entry = (overrides: Partial<JournalEntry> = {}): JournalEntry => ({
  id: 'entry-1', companyId: 'company-1', entryNumber: 10, date: '2026-09-15',
  description: 'Compra FAC-001', type: 'COMPRA', bcvRate: 100, createdAt: '2026-09-15T10:00:00.000Z',
  items: [],
  ...overrides
} as JournalEntry);

const fullVatPurchaseEntry = (id = 'entry-1'): JournalEntry => entry({
  id,
  items: [
    { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0 },
    { accountCode: '1.1.3.01', accountName: 'Crédito Fiscal IVA', debitBs: 310, creditBs: 0, debitUsd: 3.1, creditUsd: 0 },
    { accountCode: '2.1.1.01', accountName: 'Cuentas por pagar', debitBs: 0, creditBs: 1310, debitUsd: 0, creditUsd: 13.1 }
  ]
});

const baseInput = {
  purchases: [] as PurchaseRecord[],
  sales: [] as SaleRecord[],
  journalEntries: [] as JournalEntry[],
  today: '2026-11-26'
};

test('detecta la compra que contabilizó el 31 % completo como IVA y propone el ajuste del 15 %', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [purchase()],
    journalEntries: [fullVatPurchaseEntry()]
  });

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.source, 'PURCHASE');
  assert.equal(finding.side, 'INPUT');
  assert.equal(finding.vatEffect, 'INCREASE');
  assert.equal(finding.documentLabel, 'Factura de compra');
  assert.equal(finding.taxableBaseBs, 1000);
  assert.equal(finding.recordedVatBs, 310);
  assert.equal(finding.correctVatBs, 160);
  assert.equal(finding.overstatedVatBs, 150);
  assert.equal(finding.luxuryTaxBs, 150);
  assert.equal(finding.luxuryTaxTreatment, 'NON_RECOVERABLE_EXPENSE');
  assert.equal(finding.journalEntryNumber, 10);

  const debit = finding.adjustmentLines.find(line => line.debitBs > 0);
  const credit = finding.adjustmentLines.find(line => line.creditBs > 0);
  assert.equal(debit?.accountCode, '6.1.1.13');
  assert.equal(debit?.debitBs, 150);
  assert.equal(credit?.accountCode, '1.1.3.01');
  assert.equal(credit?.creditBs, 150);

  assert.equal(result.totals.inflatedInputVatCreditBs, 150);
  assert.equal(result.totals.inflatedOutputVatDebitBs, 0);
  assert.equal(result.totals.nonRecoverableLuxuryTaxBs, 150);
  assert.equal(result.totals.luxuryTaxPayableBs, 0);
  assert.equal(result.totals.totalAdjustmentDebitBs, 150);
  assert.equal(result.totals.totalAdjustmentCreditBs, 150);
  assert.equal(result.adjustment?.date, '2026-11-26');
  assert.equal(result.adjustment?.reason, HISTORICAL_VAT31_ADJUSTMENT_REASON);
  assert.equal(result.blockedReason, null);
});

test('no marca documentos con el 31 % correctamente separado ni documentos del 16 %', () => {
  const correct = purchase({
    id: 'purchase-ok', invoiceNumber: 'FAC-002', journalEntryId: 'entry-ok',
    vatAmountBs: 160, additionalLuxuryTaxBs: 150, totalAmountBs: 1310
  });
  const standard = purchase({
    id: 'purchase-16', invoiceNumber: 'FAC-003', journalEntryId: undefined,
    taxRate: 16, vatAmountBs: 160, totalAmountBs: 1160
  });
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [correct, standard],
    journalEntries: [entry({
      id: 'entry-ok',
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0 },
        { accountCode: '1.1.3.01', accountName: 'Crédito Fiscal IVA', debitBs: 160, creditBs: 0, debitUsd: 1.6, creditUsd: 0 },
        { accountCode: '6.1.1.13', accountName: 'Suntuario', debitBs: 150, creditBs: 0, debitUsd: 1.5, creditUsd: 0 },
        { accountCode: '2.1.1.01', accountName: 'Cuentas por pagar', debitBs: 0, creditBs: 1310, debitUsd: 0, creditUsd: 13.1 }
      ]
    })]
  });

  assert.deepEqual(result.findings, []);
  assert.equal(result.adjustment, null);
  assert.equal(result.totals.findingCount, 0);
});

test('detecta la venta con débito fiscal inflado y propone el suntuario por pagar', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    sales: [sale()],
    journalEntries: [entry({
      id: 'entry-sale',
      entryNumber: 20,
      type: 'VENTA',
      items: [
        { accountCode: '1.1.2.01', accountName: 'CxC', debitBs: 1310, creditBs: 0, debitUsd: 13.1, creditUsd: 0 },
        { accountCode: '4.1.1.01', accountName: 'Ingresos', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10 },
        { accountCode: '2.1.2.01', accountName: 'Débito Fiscal IVA', debitBs: 0, creditBs: 310, debitUsd: 0, creditUsd: 3.1 }
      ]
    })]
  });

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.source, 'SALE');
  assert.equal(finding.side, 'OUTPUT');
  assert.equal(finding.overstatedVatBs, 150);
  assert.equal(finding.luxuryTaxTreatment, 'TAX_PAYABLE');
  assert.equal(finding.adjustmentLines[0].accountCode, '2.1.2.01');
  assert.equal(finding.adjustmentLines[0].debitBs, 150);
  assert.equal(finding.adjustmentLines[1].accountCode, '2.1.2.08');
  assert.equal(finding.adjustmentLines[1].creditBs, 150);

  assert.equal(result.totals.inflatedOutputVatDebitBs, 150);
  assert.equal(result.totals.luxuryTaxPayableBs, 150);
  assert.equal(result.totals.inflatedInputVatCreditBs, 0);
});

test('detecta la nota de crédito de proveedor y revierte el exceso en sentido contrario', () => {
  const note = purchase({
    id: 'purchase-nc', documentType: '03', invoiceNumber: 'NC-001',
    affectedInvoiceNumber: 'FAC-001', journalEntryId: undefined,
    totalAmountBs: 131, taxableBaseBs: 100, vatAmountBs: 31, totalAmountUsd: 1.31, taxableBaseUsd: 1, vatAmountUsd: 0.31
  });
  const result = buildHistoricalVat31Diagnostic({ ...baseInput, purchases: [note] });

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.documentLabel, 'Nota de crédito de proveedor');
  assert.equal(finding.vatEffect, 'DECREASE');
  assert.equal(finding.overstatedVatBs, 15);
  assert.equal(finding.adjustmentLines[0].accountCode, '1.1.3.01');
  assert.equal(finding.adjustmentLines[0].debitBs, 15);
  assert.equal(finding.adjustmentLines[1].accountCode, '6.1.1.13');
  assert.equal(finding.adjustmentLines[1].creditBs, 15);

  assert.equal(result.totals.pendingVatReversalBs, 15);
  assert.equal(result.totals.inflatedInputVatCreditBs, 0);
  assert.equal(result.totals.nonRecoverableLuxuryTaxBs, -15);
  assert.equal(result.totals.totalAdjustmentDebitBs, 15);
  assert.equal(result.totals.totalAdjustmentCreditBs, 15);
});

test('detecta un asiento manual que registró el 31 % completo como crédito fiscal', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    journalEntries: [fullVatPurchaseEntry('entry-manual')]
  });

  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.source, 'JOURNAL_ENTRY');
  assert.equal(finding.documentType, null);
  assert.equal(finding.reference, 'Asiento #10');
  assert.equal(finding.taxableBaseBs, 1000);
  assert.equal(finding.overstatedVatBs, 150);
  assert.equal(result.totals.journalEntryCount, 1);
  assert.equal(result.totals.documentCount, 0);
  assert.equal(result.adjustment?.lines.length, 2);
});

test('no repite el asiento ya identificado desde su documento vinculado', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [purchase()],
    journalEntries: [fullVatPurchaseEntry()]
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.totals.findingCount, 1);
  assert.equal(result.totals.documentCount, 1);
  assert.equal(result.totals.journalEntryCount, 0);
});

test('no marca el asiento que ya separó el IVA del suntuario', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    journalEntries: [entry({
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0 },
        { accountCode: '1.1.3.01', accountName: 'Crédito Fiscal IVA', debitBs: 160, creditBs: 0, debitUsd: 1.6, creditUsd: 0 },
        { accountCode: '6.1.1.13', accountName: 'Suntuario', debitBs: 150, creditBs: 0, debitUsd: 1.5, creditUsd: 0 },
        { accountCode: '2.1.1.01', accountName: 'Cuentas por pagar', debitBs: 0, creditBs: 1310, debitUsd: 0, creditUsd: 13.1 }
      ]
    })]
  });

  assert.deepEqual(result.findings, []);
});

test('fecha el ajuste en el primer día abierto y lo bloquea si el cierre llega a hoy', () => {
  assert.deepEqual(
    resolveHistoricalVat31AdjustmentDate({ closedThroughDate: '2026-10-31', today: '2026-11-26' }),
    { date: '2026-11-01', blockedReason: null }
  );
  assert.equal(
    resolveHistoricalVat31AdjustmentDate({ closedThroughDate: null, today: '2026-11-26' }).date,
    '2026-11-26'
  );

  const blocked = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [purchase()],
    journalEntries: [fullVatPurchaseEntry()],
    closedThroughDate: '2026-11-26'
  });
  assert.equal(blocked.adjustment, null);
  assert.ok(blocked.blockedReason && /día abierto/.test(blocked.blockedReason));

  const open = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [purchase()],
    journalEntries: [fullVatPurchaseEntry()],
    closedThroughDate: '2026-10-31'
  });
  assert.equal(open.adjustment?.date, '2026-11-01');
});

test('aisla la empresa seleccionada', () => {
  const result = buildHistoricalVat31Diagnostic({
    companyId: 'company-1',
    purchases: [purchase(), purchase({ id: 'other', companyId: 'company-2', invoiceNumber: 'FAC-900', journalEntryId: undefined })],
    sales: [sale({ companyId: 'company-2', id: 'sale-2', journalEntryId: undefined })],
    journalEntries: [fullVatPurchaseEntry()],
    today: '2026-11-26'
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].reference, 'FAC-001');
});

test('el diagnóstico es de solo lectura y no altera documentos ni asientos', () => {
  const purchases = [purchase()];
  const entries = [fullVatPurchaseEntry()];
  const purchasesBefore = structuredClone(purchases);
  const entriesBefore = structuredClone(entries);

  buildHistoricalVat31Diagnostic({ ...baseInput, purchases, journalEntries: entries });

  assert.deepEqual(purchases, purchasesBefore);
  assert.deepEqual(entries, entriesBefore);
});

test('el asiento propuesto siempre cuadra entre debe y haber', () => {
  const result = buildHistoricalVat31Diagnostic({
    ...baseInput,
    purchases: [purchase(), purchase({
      id: 'purchase-nc', documentType: '03', invoiceNumber: 'NC-001',
      journalEntryId: undefined, taxableBaseBs: 200, vatAmountBs: 62, totalAmountBs: 262,
      taxableBaseUsd: 2, vatAmountUsd: 0.62, totalAmountUsd: 2.62
    })],
    sales: [sale()],
    journalEntries: [fullVatPurchaseEntry(), entry({
      id: 'entry-sale', entryNumber: 20, type: 'VENTA',
      items: [
        { accountCode: '1.1.2.01', accountName: 'CxC', debitBs: 1310, creditBs: 0, debitUsd: 13.1, creditUsd: 0 },
        { accountCode: '4.1.1.01', accountName: 'Ingresos', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10 },
        { accountCode: '2.1.2.01', accountName: 'Débito Fiscal IVA', debitBs: 0, creditBs: 310, debitUsd: 0, creditUsd: 3.1 }
      ]
    })]
  });

  assert.equal(result.findings.length, 3);
  assert.equal(result.totals.totalAdjustmentDebitBs, result.totals.totalAdjustmentCreditBs);
  assert.ok(result.adjustment);
  const debit = result.adjustment.lines.reduce((sum, line) => sum + line.debitBs, 0);
  const credit = result.adjustment.lines.reduce((sum, line) => sum + line.creditBs, 0);
  assert.equal(debit, credit);
  // Compra 1.000 (150 suntuario) menos la NC de 200 (30 suntuario) = 120 neto.
  assert.equal(result.totals.nonRecoverableLuxuryTaxBs, 120);
  assert.equal(result.totals.luxuryTaxPayableBs, 150);
  assert.equal(result.totals.pendingVatReversalBs, 30);
});
