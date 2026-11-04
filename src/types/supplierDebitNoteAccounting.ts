import type { Account, JournalEntry, JournalEntryItem, PurchaseRecord } from './accounting';
import { isValidIsoDate } from './migrationParsing';
import type { SupplierDebitNoteEconomicCause } from './supplierDebitNote';

export interface SupplierDebitNoteAccountingDraft {
  companyId: string;
  sourcePurchaseId: string;
  debitNoteNumber: string;
  controlNumber: string;
  affectedInvoiceNumber: string;
  fiscalEmissionMedium: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal: boolean;
  issueDate: string;
  recognitionDate: string;
  economicCause: SupplierDebitNoteEconomicCause;
  reason: string;
  classificationNote?: string;
  debitAccountCode: string;
  /** Explicit destination account for manually reviewed VAT; never inferred. */
  vatAccountCode?: string;
  /** Used only when the source invoice was paid in cash and therefore has no payable line. */
  payableAccountCode?: string;
  taxableBaseBs: number;
  exemptAmountBs: number;
  taxRate: number;
  vatAmountBs: number;
  totalAmountBs: number;
  bcvRate: number;
  /** Explicit professional confirmation of the manually captured document tax breakdown. */
  fiscalBreakdownReviewed: boolean;
  withholdingNotApplicableConfirmed: boolean;
  igtfNotApplicableConfirmed: boolean;
  fiscalReviewNote: string;
  closedThroughDate?: string;
}

export interface SupplierDebitNoteAccountingPlan {
  document: Omit<PurchaseRecord, 'id' | 'opNumber' | 'journalEntryId'>;
  sourcePurchaseId: string;
  debitAccountCode: string;
  payableAccountCode: string;
  items: JournalEntryItem[];
  totalAmountBs: number;
  totalAmountUsd: number;
  fiscalAutomationAllowed: false;
  inventoryPostingAllowed: false;
  fiscalBreakdownReviewed: true;
}

const moneyBs = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const moneyUsd = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const normalizeDocument = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const normalizeRif = (value: unknown) => String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
const allowedCauses: SupplierDebitNoteEconomicCause[] = [
  'PRICE_DIFFERENCE', 'ADDITIONAL_EXPENSE', 'FINANCING_CHARGE',
  'ADDITIONAL_GOODS_RECEIVED', 'INVENTORY_COST_ADJUSTMENT', 'OTHER'
];

/**
 * Builds a reviewable accounting plan for a supplier debit note.
 * It does not persist data, mutate the source invoice, create Kardex movements,
 * calculate withholdings/IGTF, or automate fiscal declarations.
 */
export function buildSupplierDebitNoteAccountingPlan(input: {
  draft: SupplierDebitNoteAccountingDraft;
  purchases: PurchaseRecord[];
  accounts: Account[];
  sourceJournalEntry?: JournalEntry;
}): SupplierDebitNoteAccountingPlan {
  const { draft, purchases, accounts, sourceJournalEntry } = input;
  const companyId = String(draft.companyId || '').trim();
  const sourcePurchaseId = String(draft.sourcePurchaseId || '').trim();
  if (!companyId || !sourcePurchaseId) throw new Error('La ND requiere empresa activa y factura original identificada.');

  const source = purchases.find(item => item.id === sourcePurchaseId && item.companyId === companyId);
  if (!source || source.documentType !== '01' || source.isCancelled) {
    throw new Error('La factura original no existe en la empresa activa, no es tipo 01 o está reversada.');
  }
  if (!sourceJournalEntry || sourceJournalEntry.id !== source.journalEntryId ||
      sourceJournalEntry.companyId !== companyId || sourceJournalEntry.type !== 'COMPRA' ||
      sourceJournalEntry.date !== String(source.accountCreditDate || source.invoiceDate) ||
      normalizeDocument(sourceJournalEntry.referenceDoc) !== normalizeDocument('FAC-' + source.invoiceNumber) ||
      Math.abs(Number(sourceJournalEntry.bcvRate) - Number(source.bcvRate)) > 0.000001) {
    throw new Error('La factura original no tiene un asiento de compra verificable en la empresa activa.');
  }

  const supplierRif = normalizeRif(source.supplierRif);
  if (!supplierRif || !String(source.supplierName || '').trim()) {
    throw new Error('La factura original no conserva identidad válida del proveedor.');
  }
  const debitNoteNumber = String(draft.debitNoteNumber || '').trim();
  const controlNumber = String(draft.controlNumber || '').trim();
  if (!debitNoteNumber || !controlNumber ||
      normalizeDocument(draft.affectedInvoiceNumber) !== normalizeDocument(source.invoiceNumber)) {
    throw new Error('La ND debe identificar número, control y el número exacto de la factura afectada.');
  }
  if (!isValidIsoDate(source.invoiceDate) || !String(source.controlNumber || '').trim() || Number(source.totalAmountBs || 0) <= 0) {
    throw new Error('La factura original debe conservar fecha, número, control y monto para referenciar legalmente la ND.');
  }
  if (!['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(draft.fiscalEmissionMedium) || draft.sameMediumAsOriginal !== true) {
    throw new Error('La ND debe emitirse por el mismo medio de la factura original y esa condición debe confirmarse expresamente.');
  }
  const duplicate = purchases.some(item =>
    item.companyId === companyId && item.documentType === '02' &&
    normalizeRif(item.supplierRif) === supplierRif &&
    normalizeDocument(item.debitNoteNumber || item.invoiceNumber) === normalizeDocument(debitNoteNumber)
  );
  if (duplicate) throw new Error('El número de nota de débito ya existe para este proveedor y empresa.');

  if (!isValidIsoDate(source.invoiceDate) || !isValidIsoDate(draft.issueDate) ||
      !isValidIsoDate(draft.recognitionDate) || draft.issueDate < source.invoiceDate ||
      draft.recognitionDate < draft.issueDate) {
    throw new Error('Las fechas de la ND deben ser válidas y respetar la cronología de la factura original.');
  }
  if (draft.closedThroughDate && (!isValidIsoDate(draft.closedThroughDate) ||
      draft.recognitionDate <= draft.closedThroughDate)) {
    throw new Error('La ND pertenece a un período contable cerrado.');
  }
  if (!allowedCauses.includes(draft.economicCause)) throw new Error('La causa económica de la ND no es válida.');
  const reason = String(draft.reason || '').trim();
  if (reason.length < 10) throw new Error('La ND requiere una justificación de al menos 10 caracteres.');
  const classificationNote = String(draft.classificationNote || '').trim() || undefined;
  if (draft.economicCause === 'OTHER' && (!classificationNote || classificationNote.length < 10)) {
    throw new Error('La causa Otra requiere una clasificación adicional de al menos 10 caracteres.');
  }

  // These causes require item-level receiving/cost evidence and a Kardex-specific
  // workflow. They are deliberately not converted into a generic asset debit.
  if (draft.economicCause === 'ADDITIONAL_GOODS_RECEIVED' ||
      draft.economicCause === 'INVENTORY_COST_ADJUSTMENT') {
    throw new Error('Esta causa requiere el flujo especializado de recepción/ajuste de inventario con líneas y evidencia de Kardex; no se permite contabilizarla como gasto genérico.');
  }
  if (draft.economicCause === 'FINANCING_CHARGE') {
    const selected = accounts.find(item => item.code === draft.debitAccountCode);
    if (!selected || !selected.isMovement || selected.type !== 'GASTOS') {
      throw new Error('Un cargo de financiación debe imputarse a una cuenta de gasto de movimiento del plan de la empresa.');
    }
  } else {
    const selected = accounts.find(item => item.code === draft.debitAccountCode);
    const allowedDebitTypes = ['COSTOS', 'GASTOS'];
    if (!selected || !selected.isMovement || !allowedDebitTypes.includes(selected.type)) {
      throw new Error('La cuenta de débito no es una cuenta de movimiento compatible con la causa económica seleccionada.');
    }
  }

  const rate = Number(draft.bcvRate);
  const taxableBaseBs = moneyBs(Number(draft.taxableBaseBs));
  const exemptAmountBs = moneyBs(Number(draft.exemptAmountBs));
  const vatAmountBs = moneyBs(Number(draft.vatAmountBs));
  const totalAmountBs = moneyBs(Number(draft.totalAmountBs));
  const values = [rate, taxableBaseBs, exemptAmountBs, vatAmountBs, totalAmountBs];
  if (!values.every(Number.isFinite) || rate <= 0 ||
      [taxableBaseBs, exemptAmountBs, vatAmountBs].some(value => value < 0) || totalAmountBs <= 0) {
    throw new Error('La ND contiene tasa o importes no válidos.');
  }
  if (Math.abs(totalAmountBs - moneyBs(taxableBaseBs + exemptAmountBs + vatAmountBs)) > 0.02) {
    throw new Error('El total de la ND no concilia con base imponible, exento e IVA discriminado.');
  }
  const taxRate = Number(draft.taxRate);
  if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100 ||
      Math.abs(moneyBs(taxableBaseBs * taxRate / 100) - vatAmountBs) > 0.01 ||
      (taxableBaseBs === 0 && taxRate !== 0)) {
    throw new Error('El IVA de la ND debe conciliar con una única alícuota explícita; las alícuotas mixtas requieren un desglose especializado.');
  }
  if (vatAmountBs > 0 && !draft.fiscalBreakdownReviewed) {
    throw new Error('El IVA informado en la ND requiere revisión y confirmación profesional antes de preparar el asiento.');
  }
  if (!draft.withholdingNotApplicableConfirmed || !draft.igtfNotApplicableConfirmed ||
      String(draft.fiscalReviewNote || '').trim().length < 10) {
    throw new Error('La ND requiere confirmación profesional expresa de que no aplican retenciones ni IGTF, o debe esperar el módulo fiscal especializado; documente la revisión.');
  }

  const sourcePayableCodes = [...new Set(sourceJournalEntry.items
    .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
    .map(item => String(item.accountCode)))];
  let payableAccountCode = '';
  if (source.paymentTerm === 'CREDITO') {
    if (sourcePayableCodes.length !== 1) {
      throw new Error('La factura original a crédito no conserva una única cuenta auxiliar de CxP verificable.');
    }
    payableAccountCode = sourcePayableCodes[0];
    if (draft.payableAccountCode && draft.payableAccountCode !== payableAccountCode) {
      throw new Error('La cuenta CxP seleccionada no coincide con el auxiliar de la factura original.');
    }
  } else if (source.paymentTerm === 'CONTADO') {
    if (sourcePayableCodes.length !== 0) {
      throw new Error('La factura original de contado contiene una CxP inesperada; concilie su asiento antes de registrar la ND.');
    }
    payableAccountCode = String(draft.payableAccountCode || '');
  } else {
    throw new Error('La modalidad de pago de la factura original no permite determinar la cuenta CxP de la ND.');
  }

  const payableAccount = accounts.find(item => item.code === payableAccountCode);
  if (!payableAccount || !payableAccount.isMovement || payableAccount.type !== 'PASIVO' ||
      !payableAccount.code.startsWith('2.1.1.')) {
    throw new Error('La ND requiere una cuenta auxiliar de CxP de proveedor, de movimiento y perteneciente al pasivo.');
  }
  const debitAccount = accounts.find(item => item.code === draft.debitAccountCode)!;
  const vatAccount = vatAmountBs > 0 ? accounts.find(item =>
    item.code === draft.vatAccountCode && item.isMovement &&
    ['ACTIVO', 'COSTOS', 'GASTOS'].includes(item.type)
  ) : undefined;
  if (vatAmountBs > 0 && !vatAccount) {
    throw new Error('El IVA de la ND requiere una cuenta de destino elegida y validada por el profesional; SICOVEN no infiere que sea crédito fiscal recuperable.');
  }

  const toUsd = (value: number) => moneyUsd(value / rate);
  const line = (account: Account, debit: number, credit: number, description: string): JournalEntryItem => ({
    accountCode: account.code, accountName: account.name,
    debitBs: debit, creditBs: credit, debitUsd: toUsd(debit), creditUsd: toUsd(credit), description
  });
  const debitBase = moneyBs(taxableBaseBs + exemptAmountBs);
  const items: JournalEntryItem[] = [];
  if (debitBase > 0) items.push(line(debitAccount, debitBase, 0,
    'Reconocimiento económico ND proveedor ' + debitNoteNumber + ' · ' + draft.economicCause));
  if (vatAmountBs > 0 && vatAccount) items.push(line(vatAccount, vatAmountBs, 0,
    'IVA discriminado en ND proveedor · revisión profesional registrada'));
  items.push(line(payableAccount, 0, totalAmountBs,
    'Nueva obligación por ND proveedor ' + debitNoteNumber + ' · afecta factura ' + source.invoiceNumber));

  const debitBs = moneyBs(items.reduce((sum, item) => sum + item.debitBs, 0));
  const creditBs = moneyBs(items.reduce((sum, item) => sum + item.creditBs, 0));
  const debitUsd = moneyUsd(items.reduce((sum, item) => sum + item.debitUsd, 0));
  const creditUsd = moneyUsd(items.reduce((sum, item) => sum + item.creditUsd, 0));
  if (Math.abs(debitBs - creditBs) > 0.02 || Math.abs(debitUsd - creditUsd) > 0.000001) {
    throw new Error('El asiento preliminar de la ND no cuadra en Bs. y USD.');
  }

  const totalAmountUsd = toUsd(totalAmountBs);
  const document: Omit<PurchaseRecord, 'id' | 'opNumber' | 'journalEntryId'> = {
    companyId, originalPurchaseId: source.id,
    invoiceDate: draft.issueDate, accountCreditDate: draft.recognitionDate,
    supplierRif: source.supplierRif, supplierName: source.supplierName,
    invoiceNumber: debitNoteNumber, debitNoteNumber, controlNumber,
    affectedInvoiceNumber: source.invoiceNumber,
    affectedInvoiceDate: source.invoiceDate, affectedInvoiceControlNumber: source.controlNumber,
    affectedInvoiceTotalAmountBs: source.totalAmountBs, affectedInvoiceTotalAmountUsd: source.totalAmountUsd,
    fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal,
    documentType: '02',
    totalAmountBs, taxableBaseBs, exemptAmountBs, taxRate,
    vatAmountBs, retentionRate: 0, vatWithheldBs: 0,
    bcvRate: rate, totalAmountUsd,
    taxableBaseUsd: toUsd(taxableBaseBs), vatAmountUsd: toUsd(vatAmountBs), vatWithheldUsd: 0,
    paymentTerm: 'CREDITO',
    supplierDebitNoteReview: {
      economicCause: draft.economicCause,
      reason,
      classificationNote,
      debitAccountCode: debitAccount.code,
      payableAccountCode,
      vatAccountCode: vatAccount?.code,
      vatBreakdownReviewed: vatAmountBs <= 0 || draft.fiscalBreakdownReviewed === true,
      withholdingNotApplicableConfirmed: draft.withholdingNotApplicableConfirmed === true,
      igtfNotApplicableConfirmed: draft.igtfNotApplicableConfirmed === true,
      fiscalReviewNote: String(draft.fiscalReviewNote || '').trim()
    },
    notes: [reason, classificationNote ? 'Clasificación: ' + classificationNote : '', 'Revisión fiscal manual: ' + draft.fiscalReviewNote.trim(), 'Sin retenciones ni IGTF: confirmado por el profesional responsable.'].filter(Boolean).join(' · ')
  };

  return {
    document, sourcePurchaseId: source.id, debitAccountCode: debitAccount.code,
    payableAccountCode, items, totalAmountBs, totalAmountUsd,
    fiscalAutomationAllowed: false, inventoryPostingAllowed: false,
    fiscalBreakdownReviewed: true
  };
}
