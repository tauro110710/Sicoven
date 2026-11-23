import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, JournalEntry, PurchaseRecord } from './accounting';
import { buildSupplierDebitNoteAccountingPlan, type SupplierDebitNoteAccountingDraft } from './supplierDebitNoteAccounting';

const source: PurchaseRecord = {
  id: 'purchase-1', companyId: 'company-1', opNumber: 1,
  invoiceDate: '2026-10-01', accountCreditDate: '2026-10-01',
  supplierRif: 'J-12345678-9', supplierName: 'Proveedor Original C.A.',
  invoiceNumber: 'FAC-100', controlNumber: 'CTRL-100', documentType: '01',
  totalAmountBs: 116, taxableBaseBs: 100, exemptAmountBs: 0, taxRate: 16,
  vatAmountBs: 16, retentionRate: 0, vatWithheldBs: 0, bcvRate: 100,
  totalAmountUsd: 1.16, taxableBaseUsd: 1, vatAmountUsd: 0.16, vatWithheldUsd: 0,
  paymentTerm: 'CREDITO', journalEntryId: 'journal-source'
};
const accounts: Account[] = [
  { code: '2.1.1.01', name: 'Cuentas por pagar proveedores', type: 'PASIVO', level: 4, isMovement: true },
  { code: '6.1.1.01', name: 'Gastos operativos', type: 'GASTOS', level: 4, isMovement: true },
  { code: '6.1.1.02', name: 'Gastos financieros', type: 'GASTOS', level: 4, isMovement: true },
  { code: '5.1.1.01', name: 'Costos', type: 'COSTOS', level: 4, isMovement: true },
  { code: '1.1.3.01', name: 'IVA crédito fiscal', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', level: 4, isMovement: true }
];
const sourceEntry: JournalEntry = {
  id: 'journal-source', companyId: 'company-1', entryNumber: 1,
  date: '2026-10-01', description: 'Factura original', type: 'COMPRA',
  bcvRate: 100, referenceDoc: 'FAC-FAC-100',
  items: [
    { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
    { accountCode: '1.1.3.01', accountName: 'IVA crédito fiscal', debitBs: 16, creditBs: 0, debitUsd: 0.16, creditUsd: 0 },
    { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 0, creditBs: 116, debitUsd: 0, creditUsd: 1.16 }
  ],
  createdAt: '2026-10-01T10:00:00.000Z'
};
const draft = (overrides: Partial<SupplierDebitNoteAccountingDraft> = {}): SupplierDebitNoteAccountingDraft => ({
  companyId: 'company-1', sourcePurchaseId: 'purchase-1',
  debitNoteNumber: 'ND-001', controlNumber: 'CTRL-ND-001',
  affectedInvoiceNumber: 'FAC-100', fiscalEmissionMedium: 'DIGITAL', sameMediumAsOriginal: true,
  issueDate: '2026-10-10',
  recognitionDate: '2026-10-10', economicCause: 'ADDITIONAL_EXPENSE',
  reason: 'Gasto adicional documentado por proveedor.',
  debitAccountCode: '6.1.1.01', vatAccountCode: '1.1.3.01', taxableBaseBs: 25, exemptAmountBs: 0,
  vatAmountBs: 4, totalAmountBs: 29, taxRate: 16, bcvRate: 100,
  fiscalBreakdownReviewed: true, withholdingNotApplicableConfirmed: true,
  igtfNotApplicableConfirmed: true, fiscalReviewNote: 'Revisión documental y fiscal realizada por el responsable.', ...overrides
});
const build = (value = draft(), purchase = source, entry = sourceEntry, accountList = accounts, allPurchases: PurchaseRecord[] = [purchase]) =>
  buildSupplierDebitNoteAccountingPlan({ draft: value, purchases: allPurchases, accounts: accountList, sourceJournalEntry: entry });

test('builds a separate payable document and balanced dual-currency journal without changing the source invoice', () => {
  const plan = build();
  assert.equal(plan.document.documentType, '02');
  assert.equal(plan.document.vatCreditTreatment, 'COMMON');
  assert.equal(plan.document.originalPurchaseId, source.id);
  assert.equal(plan.document.affectedInvoiceNumber, source.invoiceNumber);
  assert.equal(plan.document.paymentTerm, 'CREDITO');
  assert.equal(plan.document.totalAmountBs, 29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.debitBs, 0), 29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.creditBs, 0), 29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.debitUsd, 0), 0.29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.creditUsd, 0), 0.29);
  assert.equal(plan.fiscalAutomationAllowed, false);
  assert.equal(plan.inventoryPostingAllowed, false);
  assert.equal(source.totalAmountBs, 116);
});

test('inherits the source invoice VAT credit treatment for supplier debit notes', () => {
  const taxableSource = { ...source, vatCreditTreatment: 'TAXABLE' as const };
  const exemptSource = { ...source, vatCreditTreatment: 'EXEMPT' as const };
  assert.equal(build(draft(), taxableSource).document.vatCreditTreatment, 'TAXABLE');
  assert.equal(build(draft(), exemptSource).document.vatCreditTreatment, 'EXEMPT');
});

test('uses the original supplier payable auxiliary for a credit invoice', () => {
  assert.equal(build().payableAccountCode, '2.1.1.01');
  assert.throws(() => build(draft({ payableAccountCode: '2.1.1.99' })), /no coincide con el auxiliar/);
});

test('creates an independent payable for a cash-paid source invoice, never a fictitious source payable', () => {
  const cashSource = { ...source, paymentTerm: 'CONTADO' as const };
  const cashEntry = { ...sourceEntry, items: sourceEntry.items.filter(item => item.accountCode !== '2.1.1.01') };
  const plan = build(draft({ payableAccountCode: '2.1.1.01' }), cashSource, cashEntry);
  assert.equal(plan.payableAccountCode, '2.1.1.01');
  assert.equal(plan.document.paymentTerm, 'CREDITO');
  assert.throws(() => build(draft({ payableAccountCode: '' }), cashSource, cashEntry), /cuenta auxiliar de CxP/);
  assert.throws(() => build(draft({ payableAccountCode: '6.1.1.01' }), cashSource, cashEntry), /cuenta auxiliar de CxP/);
});

test('rejects missing or cross-company original documents and invalid links', () => {
  assert.throws(() => build(draft({ sourcePurchaseId: 'missing' })), /no existe en la empresa activa/);
  assert.throws(() => build(draft({ companyId: 'company-2' })), /no existe en la empresa activa/);
  assert.throws(() => build(draft(), { ...source, isCancelled: true }), /no existe en la empresa activa/);
  assert.throws(() => build(draft(), source, { ...sourceEntry, companyId: 'company-2' }), /asiento de compra verificable/);
});

test('rejects duplicate supplier note numbers within the company', () => {
  const existing: PurchaseRecord = { ...source, id: 'existing-note', documentType: '02', debitNoteNumber: 'ND-001', invoiceNumber: 'ND-001' };
  assert.throws(() => build(draft(), source, sourceEntry, accounts, [source, existing]), /número de nota de débito ya existe/);
  const otherSupplier = { ...existing, id: 'other-supplier-note', supplierRif: 'J-99999999-9' };
  assert.doesNotThrow(() => build(draft(), source, sourceEntry, accounts, [source, otherSupplier]));
});

test('rejects nonmatching affected invoice, invalid chronology, closed period and missing justification', () => {
  assert.throws(() => build(draft({ affectedInvoiceNumber: 'FAC-999' })), /número exacto/);
  assert.throws(() => build(draft({ issueDate: '2026-09-30' })), /cronología/);
  assert.throws(() => build(draft({ closedThroughDate: '2026-10-10' })), /período contable cerrado/);
  assert.throws(() => build(draft({ reason: 'cargo' })), /justificación/);
});

test('rejects financing charges unless the selected account is an expense account', () => {
  assert.throws(() => build(draft({ economicCause: 'FINANCING_CHARGE', debitAccountCode: '1.1.4.01' })), /gasto de movimiento/);
  assert.doesNotThrow(() => build(draft({ economicCause: 'FINANCING_CHARGE', debitAccountCode: '6.1.1.02' })));
});

test('blocks inventory-related causes until item-level receipt and costing controls exist', () => {
  assert.throws(() => build(draft({ economicCause: 'ADDITIONAL_GOODS_RECEIVED' })), /flujo especializado de recepción/);
  assert.throws(() => build(draft({ economicCause: 'INVENTORY_COST_ADJUSTMENT' })), /flujo especializado de recepción/);
});

test('requires professional review of manually entered VAT and a valid VAT control account', () => {
  assert.throws(() => build(draft({ fiscalBreakdownReviewed: false })), /revisión y confirmación profesional/);
  assert.throws(() => build(draft({ vatAccountCode: undefined })), /cuenta de destino elegida y validada/);
});

test('requires explicit professional confirmation when withholding and IGTF are not applicable', () => {
  assert.throws(() => build(draft({ withholdingNotApplicableConfirmed: false })), /confirmación profesional expresa/);
  assert.throws(() => build(draft({ igtfNotApplicableConfirmed: false })), /confirmación profesional expresa/);
  assert.throws(() => build(draft({ fiscalReviewNote: 'No' })), /confirmación profesional expresa/);
});

test('rejects non-liability or non-movement payable accounts', () => {
  const wrong = accounts.map(item => item.code === '2.1.1.01' ? { ...item, type: 'GASTOS' as const } : item);
  assert.throws(() => build(draft({ payableAccountCode: '6.1.1.01' }), { ...source, paymentTerm: 'CONTADO' }, { ...sourceEntry, items: sourceEntry.items.filter(item => item.accountCode !== '2.1.1.01') }, wrong), /cuenta auxiliar de CxP/);
});

test('rejects nonconciliating totals and invalid rates', () => {
  assert.throws(() => build(draft({ totalAmountBs: 30 })), /no concilia/);
  assert.throws(() => build(draft({ taxRate: 15 })), /una única alícuota explícita/);
  assert.throws(() => build(draft({ bcvRate: 0 })), /tasa o importes no válidos/);
});

test('stores a snapshot of the original invoice for immutable correction traceability', () => {
  const plan = build();
  assert.equal(plan.document.affectedInvoiceDate, source.invoiceDate);
  assert.equal(plan.document.affectedInvoiceControlNumber, source.controlNumber);
  assert.equal(plan.document.affectedInvoiceTotalAmountBs, source.totalAmountBs);
  assert.equal(plan.document.affectedInvoiceTotalAmountUsd, source.totalAmountUsd);
  assert.equal(plan.document.fiscalEmissionMedium, 'DIGITAL');
  assert.equal(plan.document.sameMediumAsOriginal, true);
  assert.equal(source.invoiceNumber, 'FAC-100');
  assert.equal(source.totalAmountBs, 116);
});

test('blocks a price difference on an inventory invoice until item-level revaluation is supported', () => {
  const inventorySource = { ...source, inventoryLines: [{ productId: 'p-1', quantity: 1, unitCostBs: 100 }] };
  assert.throws(() => buildSupplierDebitNoteAccountingPlan({
    draft: draft({ economicCause: 'PRICE_DIFFERENCE' }),
    purchases: [inventorySource], accounts,
    sourceJournalEntry: { ...sourceEntry, items: [
      { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
      { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
    ] }
  }), /revalorizar lotes\/capas y Kardex/);
});

test('posts a historical supplier debit note in Bs only when no BCV rate is supplied', () => {
  const historicalSource = { ...source, invoiceDate: '2014-01-01', accountCreditDate: '2014-01-01', bcvRate: 0, totalAmountUsd: 0, taxableBaseUsd: 0, vatAmountUsd: 0 };
  const historicalEntry = { ...sourceEntry, date: '2014-01-01', bcvRate: 0, items: sourceEntry.items.map(item => ({ ...item, debitUsd: 0, creditUsd: 0 })) };
  const plan = build(draft({ issueDate: '2014-02-01', recognitionDate: '2014-02-01', bcvRate: 0 }), historicalSource, historicalEntry, accounts, [historicalSource]);
  assert.equal(plan.totalAmountBs, 29);
  assert.equal(plan.totalAmountUsd, 0);
  assert.equal(plan.items.reduce((sum, item) => sum + item.debitBs, 0), 29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.creditBs, 0), 29);
  assert.equal(plan.items.reduce((sum, item) => sum + item.debitUsd + item.creditUsd, 0), 0);
});
