import type { PurchaseRecord } from './accounting';
import { isValidIsoDate } from './migrationParsing';
import { isBcvRateRequiredForDate } from '../utils/bcvRatePolicy';

/**
 * Economic cause selected by the accounting professional.
 * Selecting a cause never authorizes an automatic journal, tax or inventory posting.
 */
export type SupplierDebitNoteEconomicCause =
  | 'PRICE_DIFFERENCE'
  | 'ADDITIONAL_EXPENSE'
  | 'FINANCING_CHARGE'
  | 'ADDITIONAL_GOODS_RECEIVED'
  | 'INVENTORY_COST_ADJUSTMENT'
  | 'OTHER';

export interface SupplierDebitNotePreflightDraft {
  companyId: string;
  sourcePurchaseId: string;
  debitNoteNumber: string;
  controlNumber: string;
  affectedInvoiceNumber: string;
  issueDate: string;
  recognitionDate: string;
  economicCause: SupplierDebitNoteEconomicCause;
  reason: string;
  classificationNote?: string;
  totalAmountBs: number;
  bcvRate: number;
  closedThroughDate?: string;
  purchases: PurchaseRecord[];
}

export interface SupplierDebitNotePreflightResult {
  sourcePurchaseId: string;
  companyId: string;
  supplierRif: string;
  supplierName: string;
  debitNoteNumber: string;
  affectedInvoiceNumber: string;
  issueDate: string;
  recognitionDate: string;
  economicCause: SupplierDebitNoteEconomicCause;
  reason: string;
  classificationNote?: string;
  totalAmountBs: number;
  bcvRate: number;
  /** Deliberately false: this preflight is not a posting or accounting approval. */
  postingAllowed: false;
  inventoryPostingAllowed: false;
  fiscalAutomationAllowed: false;
}

const normalizeDocument = (value: unknown) =>
  String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const normalizeRif = (value: unknown) =>
  String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export function validateSupplierDebitNotePreflight(
  draft: SupplierDebitNotePreflightDraft
): SupplierDebitNotePreflightResult {
  const companyId = String(draft.companyId || '').trim();
  const sourcePurchaseId = String(draft.sourcePurchaseId || '').trim();
  if (!companyId || !sourcePurchaseId) {
    throw new Error('La nota de débito requiere empresa activa y factura original identificada.');
  }

  const source = draft.purchases.find(item =>
    item.id === sourcePurchaseId && item.companyId === companyId
  );
  if (!source || source.documentType !== '01' || source.isCancelled) {
    throw new Error('La factura original no existe en la empresa activa, no es tipo 01 o está anulada.');
  }

  const supplierRif = normalizeRif(source.supplierRif);
  if (!supplierRif || !String(source.supplierName || '').trim()) {
    throw new Error('La factura original no conserva identidad válida del proveedor.');
  }

  const debitNoteNumber = String(draft.debitNoteNumber || '').trim();
  const controlNumber = String(draft.controlNumber || '').trim();
  const affectedInvoiceNumber = String(draft.affectedInvoiceNumber || '').trim();
  if (!debitNoteNumber || !controlNumber || !affectedInvoiceNumber ||
      normalizeDocument(affectedInvoiceNumber) !== normalizeDocument(source.invoiceNumber)) {
    throw new Error('La nota debe identificar número, control y el número exacto de la factura afectada.');
  }

  const duplicate = draft.purchases.some(item =>
    item.companyId === companyId &&
    item.documentType === '02' &&
    normalizeRif(item.supplierRif) === supplierRif &&
    normalizeDocument(item.debitNoteNumber || item.invoiceNumber) === normalizeDocument(debitNoteNumber)
  );
  if (duplicate) {
    throw new Error('El número de nota de débito ya existe para este proveedor y empresa.');
  }

  if (!isValidIsoDate(source.invoiceDate) ||
      !isValidIsoDate(draft.issueDate) ||
      !isValidIsoDate(draft.recognitionDate) ||
      draft.issueDate < source.invoiceDate ||
      draft.recognitionDate < draft.issueDate) {
    throw new Error('Las fechas de la nota deben ser válidas y no anteriores a la factura original; el reconocimiento no puede preceder a su emisión.');
  }
  if (draft.closedThroughDate &&
      (!isValidIsoDate(draft.closedThroughDate) || draft.recognitionDate <= draft.closedThroughDate)) {
    throw new Error('La fecha efectiva de reconocimiento pertenece a un período contable cerrado.');
  }

  const totalAmountBs = Number(draft.totalAmountBs);
  const bcvRate = Number(draft.bcvRate);
  if (!Number.isFinite(totalAmountBs) || totalAmountBs <= 0 ||
      !Number.isFinite(bcvRate) || bcvRate < 0 || (isBcvRateRequiredForDate(draft.recognitionDate) && bcvRate <= 0)) {
    throw new Error('El importe de la nota debe ser positivo; la tasa BCV solo es obligatoria desde 2018.');
  }

  const allowedCauses: SupplierDebitNoteEconomicCause[] = [
    'PRICE_DIFFERENCE',
    'ADDITIONAL_EXPENSE',
    'FINANCING_CHARGE',
    'ADDITIONAL_GOODS_RECEIVED',
    'INVENTORY_COST_ADJUSTMENT',
    'OTHER'
  ];
  if (!allowedCauses.includes(draft.economicCause)) {
    throw new Error('Selecciona una causa económica válida para la nota de débito.');
  }
  const reason = String(draft.reason || '').trim();
  if (reason.length < 10) {
    throw new Error('La justificación de la nota de débito debe contener al menos 10 caracteres.');
  }
  const classificationNote = String(draft.classificationNote || '').trim() || undefined;
  if (draft.economicCause === 'OTHER' && (!classificationNote || classificationNote.length < 10)) {
    throw new Error('La causa “Otra” requiere una explicación de clasificación de al menos 10 caracteres.');
  }

  return {
    sourcePurchaseId,
    companyId,
    supplierRif,
    supplierName: String(source.supplierName).trim(),
    debitNoteNumber,
    affectedInvoiceNumber: String(source.invoiceNumber).trim(),
    issueDate: draft.issueDate,
    recognitionDate: draft.recognitionDate,
    economicCause: draft.economicCause,
    reason,
    classificationNote,
    totalAmountBs,
    bcvRate,
    postingAllowed: false,
    inventoryPostingAllowed: false,
    fiscalAutomationAllowed: false
  };
}
