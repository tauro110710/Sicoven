/**
 * Registro transaccional de una compra después de haber pasado todas
 * las validaciones de dominio y fiscales.
 *
 * Esta función encapsula la escritura real que antes estaba dentro de
 * `AccountingContext.addPurchase()`, permitiendo pruebas de integración
 * en Node sin necesidad de montar el provider React ni tener SQLite
 * disponible.
 *
 * El caller debe haber ejecutado previamente:
 *   1. `validatePurchaseAmounts(purchaseData)` - validación de tipos, finitud, signo, total > 0, consistencia fiscal
 *   2. Validación del crédito fiscal IVA (`['TAXABLE','EXEMPT','COMMON']`)
 *   3. `assertFiscalBreakdown(..., { toleranceBs, requireTotal })` - desglose fiscal con motor central
 *   4. Todas las validaciones de retenciones, IGTF, BCV y concepto ISLR
 *
 * Esta función NO valida por su cuenta: asume que las validaciones anteriores
 * ya fueron ejecutadas y solo se responsabiliza de la escritura persistente.
 */
import type { PurchaseRecord } from './accounting';

/** Interfaz de entrada para el registro de una compra. */
export interface PurchaseRegistrationInput {
  totalAmountBs: number;
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs?: number;
  igtfAmountBs?: number;
  vatWithheldBs: number;
  islrWithheldBs?: number;
  retentionRate?: number;
  islrRate?: number;
  islrSubtrahendBs?: number;
  taxRate?: number;
  bcvRate?: number;
  totalAmountUsd?: number;
  taxableBaseUsd?: number;
  exemptAmountUsd?: number;
  vatAmountUsd?: number;
  additionalLuxuryTaxUsd?: number;
  vatWithheldUsd?: number;
  islrWithheldUsd?: number;
  igtfAmountUsd?: number;
  supplierRif: string;
  invoiceNumber: string;
  documentType: '01' | '02' | '03';
  invoiceDate: string;
  paymentTerm: 'CONTADO' | 'CREDITO';
  paymentAccountCode?: string;
  paymentReference?: string;
  igtfApplicable?: boolean;
  paymentMethod?: string;
  vatCreditTreatment?: 'TAXABLE' | 'EXEMPT' | 'COMMON';
  ivaRetentionDecision?: unknown;
  accountCreditDate?: string;
  fiscReviewNote?: string;
  ivgRatePercent?: number;
}

/** Interfaz de resultado del registro de una compra. */
export interface PurchaseRegistrationResult {
  purchase: PurchaseRecord;
  journalEntry: unknown;
  retentionVouchers: Array<{ type: 'IVA' | 'ISLR'; date: string }>;
  bcvEquivalency: { rate: number; usdAmount: number } | null;
}

/** Store interno mutable para simular SQLite cuando no hay disponible. */
let internalPurchaseRegistrations: PurchaseRecord[] = [];

/** Obtiene todas las compras registradas vía la función interna (útil en tests). */
export const getInternalRegistrations = (): PurchaseRecord[] => [...internalPurchaseRegistrations];

/** Reinicia el store interno (útil entre test groups). */
export const resetInternalRegistrations = (): void => {
  internalPurchaseRegistrations.length = 0;
};

/** Escribe una compra registrada en el store interno (usado por pruebas en Node). */
/ * En producción real, esto sería reemplazado por la llamada a `window.sicovenStore.save`. */
export const registerPurchaseInternal = (input: PurchaseRegistrationInput): PurchaseRecord => {
  // Construir el objeto PurchaseRecord con los campos básicos seguros
  const purchaseBody: any = {
    id: `pur-${internalPurchaseRegistrations.length + 1}`,
    companyId: 'default',
    opNumber: internalPurchaseRegistrations.length + 1,
    supplierRif: input.supplierRif,
    invoiceNumber: input.invoiceNumber,
    documentType: input.documentType,
    invoiceDate: input.invoiceDate,
    paymentTerm: input.paymentTerm,
    totalAmountBs: input.totalAmountBs,
    exemptAmountBs: input.exemptAmountBs,
    taxableBaseBs: input.taxableBaseBs,
    vatAmountBs: input.vatAmountBs,
    additionalLuxuryTaxBs: input.additionalLuxuryTaxBs,
    additionalLuxuryTaxUsd: input.additionalLuxuryTaxUsd,
    igtfAmountBs: input.igtfAmountBs,
    igtfAmountUsd: input.igtfAmountUsd,
    vatWithheldBs: input.vatWithheldBs,
    islrRate: input.islrRate,
    islrSubtrahendBs: input.islrSubtrahendBs,
    islrWithheldBs: input.islrWithheldBs,
    vatCreditTreatment: input.vatCreditTreatment ?? 'TAXABLE',
    retentionRate: input.retentionRate,
    taxRate: input.taxRate,
    bcvRate: input.bcvRate,
    totalAmountUsd: input.totalAmountUsd,
    taxableBaseUsd: input.taxableBaseUsd,
    exemptAmountUsd: input.exemptAmountUsd,
    vatAmountUsd: input.vatAmountUsd,
    ivaRetentionDecision: input.ivaRetentionDecision,
    accountCreditDate: input.accountCreditDate,
    fiscReviewNote: input.fiscReviewNote,
    ivgRatePercent: input.ivgRatePercent,
    controlNumber: `ctrl-${internalPurchaseRegistrations.length + 1}`,
    supplierName: input.supplierRif || 'Proveedor',
    supplierAddress: undefined,
    supplierEmail: undefined,
    supplierTaxStatus: undefined,
    netPayableReductionBs: undefined,
    netPayableReductionUsd: undefined,
    supplierAdvanceBs: undefined,
    supplierAdvanceUsd: undefined,
    creditNoteLines: undefined,
    creditNoteNumber: undefined,
    debitNoteNumber: undefined,
    affectedInvoiceNumber: undefined,
    affectedInvoiceControlNumber: undefined,
    affectedInvoiceTotalAmountBs: undefined,
    affectedInvoiceTotalAmountUsd: undefined,
    fiscalEmissionMedium: undefined,
    sameMediumAsOriginal: undefined,
    originalPurchaseId: undefined,
  };

  // Type assertion to PurchaseRecord - all extra properties are optional in the interface
  const purchase: PurchaseRecord = purchaseBody as unknown as PurchaseRecord;
  internalPurchaseRegistrations.push(purchase);
  return purchase;
};
