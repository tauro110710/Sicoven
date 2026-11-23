import { isBcvRateRequiredForDate } from '../utils/bcvRatePolicy';

export type CreditSettlementKind = 'SALE_COLLECTION' | 'PURCHASE_PAYMENT';
export type SettlementMethod = 'CASH_BS' | 'CASH_USD' | 'BANK_TRANSFER_BS' | 'BANK_TRANSFER_USD' | 'OTHER';

export interface FxFiscalAdjustmentSnapshot { direction: 'DEBIT_NOTE' | 'CREDIT_NOTE' | 'NONE' | 'REVIEW_REQUIRED'; deltaBaseBs: number; deltaVatBs: number; deltaExemptBs: number; deltaTotalBs: number; explanation: string; }

export interface CreditSettlement {
  id: string;
  companyId: string;
  documentId: string;
  kind: CreditSettlementKind;
  settlementDate: string; // YYYY-MM-DD, actual date funds were received/paid
  bcvRate: number; // official rate recorded for this settlement; never replaces invoice rate
  amountUsd: number; // portion of invoice settled, expressed in USD equivalent
  amountBs: number; // actual nominal Bs received/paid
  method: SettlementMethod;
  /** Auxiliar bancario de la empresa activa cuando el medio es transferencia. */
  bankAccountId?: string;
  reference?: string;
  notes?: string;
  /** Calculation snapshot only; never represents an issued fiscal note. */
  fxFiscalAdjustmentProposal?: FxFiscalAdjustmentSnapshot;
  journalEntryId: string;
  createdAt: string;
  /** La liquidación se conserva para auditoría, pero deja de reducir el saldo al reversarse. */
  isReversed?: boolean;
  reversedByJournalEntryId?: string;
}

export interface CreditBalance {
  documentId: string;
  originalAmountUsd: number;
  originalAmountBs: number;
  settledAmountUsd: number;
  settledAmountBs: number;
  outstandingUsd: number;
  outstandingBsAtInvoiceRate: number;
  settlementCount: number;
  /** Reducción documental por notas de crédito; no se considera pago de efectivo. */
  creditedByNotesUsd?: number;
  creditedByNotesBs?: number;
  /** Increase to the receivable/payable caused by debit notes. */
  debitedByNotesUsd?: number;
  debitedByNotesBs?: number;
  /** Supplier advances applied directly to this invoice without a cash payment. */
  creditedBySupplierAdvancesUsd?: number;
  creditedBySupplierAdvancesBs?: number;
}

/** Read-only FX exposure calculation; never posts or changes the original credit document. */
export interface CreditFxExposure {
  valuationBs: number;
  differenceBs: number;
}
export function calculateCreditFxExposure(
  outstandingUsd: number,
  bookValueBs: number,
  valuationRate: number
): CreditFxExposure {
  if (![outstandingUsd, bookValueBs, valuationRate].every(Number.isFinite) ||
      outstandingUsd < 0 || bookValueBs < 0 || valuationRate <= 0) {
    throw new Error('Los importes y la tasa del análisis de exposición deben ser finitos y no negativos; la tasa debe ser mayor que cero.');
  }
  const roundBs = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const valuationBs = roundBs(outstandingUsd * valuationRate);
  return { valuationBs, differenceBs: roundBs(valuationBs - bookValueBs) };
}

export interface CreditDocumentAdjustmentRecord {
  netReceivableAdjustmentUsd?: number;
  netReceivableAdjustmentBs?: number;
  netPayableReductionUsd?: number;
  netPayableReductionBs?: number;
  totalAmountUsd?: number;
  totalAmountBs?: number;
}
export interface CreditDocumentAdjustmentTotals {
  creditedByNotesUsd: number;
  creditedByNotesBs: number;
  debitedByNotesUsd: number;
  debitedByNotesBs: number;
}
/** Documental adjustments are distinct from cash settlements. Purchase debit notes increase CxP by their full fiscal total; sale debit notes use their net receivable adjustment. */
export function summarizeCreditDocumentAdjustments(
  kind: CreditSettlementKind,
  creditNotes: CreditDocumentAdjustmentRecord[],
  debitNotes: CreditDocumentAdjustmentRecord[]
): CreditDocumentAdjustmentTotals {
  const amount = (value: number | undefined): number => {
    const parsed=Number(value ?? 0);
    if(!Number.isFinite(parsed) || parsed<0) throw new Error('Una NC/ND contiene un importe no válido para el auxiliar de crédito.');
    return parsed;
  };
  const creditedByNotesUsd = creditNotes.reduce((sum,item)=>sum+amount(
    kind === 'PURCHASE_PAYMENT' ? (item.netPayableReductionUsd ?? item.netReceivableAdjustmentUsd) : item.netReceivableAdjustmentUsd
  ),0);
  const creditedByNotesBs = creditNotes.reduce((sum,item)=>sum+amount(
    kind === 'PURCHASE_PAYMENT' ? (item.netPayableReductionBs ?? item.netReceivableAdjustmentBs) : item.netReceivableAdjustmentBs
  ),0);
  const debitedByNotesUsd = debitNotes.reduce((sum,item)=>sum+amount(
    kind === 'PURCHASE_PAYMENT' ? item.totalAmountUsd : item.netReceivableAdjustmentUsd
  ),0);
  const debitedByNotesBs = debitNotes.reduce((sum,item)=>sum+amount(
    kind === 'PURCHASE_PAYMENT' ? item.totalAmountBs : item.netReceivableAdjustmentBs
  ),0);
  return {creditedByNotesUsd,creditedByNotesBs,debitedByNotesUsd,debitedByNotesBs};
}

export interface CreditSettlementDraft {
  documentId: string;
  kind: CreditSettlementKind;
  settlementDate: string;
  bcvRate: number;
  amountUsd: number;
  amountBs: number;
  method: SettlementMethod;
  /** Auxiliar bancario de la empresa activa cuando el medio es transferencia. */
  bankAccountId?: string;
  reference?: string;
  notes?: string;
}

/**
 * Computes remaining principal in invoice currency. Historical invoice values
 * are inputs only and must never be rewritten by a settlement.
 */
export function calculateCreditBalance(
  documentId: string,
  originalAmountUsd: number,
  originalAmountBs: number,
  settlements: CreditSettlement[]
): CreditBalance {
  // Una liquidación reversada permanece en el historial, pero no puede seguir
  // reduciendo el principal ni inflar el contador de pagos/cobros vigentes.
  const relevant = settlements.filter(item => item.documentId === documentId && !item.isReversed);
  const settledAmountUsd = relevant.reduce((sum, item) => sum + item.amountUsd, 0);
  const settledAmountBs = relevant.reduce((sum, item) => sum + item.amountBs, 0);
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  return {
    documentId,
    originalAmountUsd: money(originalAmountUsd),
    originalAmountBs: money(originalAmountBs),
    settledAmountUsd: money(settledAmountUsd),
    settledAmountBs: money(settledAmountBs),
    outstandingUsd: money(Math.max(0, originalAmountUsd - settledAmountUsd)),
    // Remaining principal is valued at the original invoice's implied rate, not
    // by subtracting nominal Bs paid at a potentially different settlement rate.
    outstandingBsAtInvoiceRate: money(originalAmountUsd > 0
      ? Math.max(0, originalAmountUsd - settledAmountUsd) * (originalAmountBs / originalAmountUsd)
      : Math.max(0, originalAmountBs - settledAmountBs)),
    settlementCount: relevant.length
  };
}

/**
 * Validation shared by the UI and accounting context. Fiscal VAT values and
 * original document amounts are deliberately not changed here.
 */
export function validateCreditSettlement(
  draft: CreditSettlementDraft,
  outstandingUsd: number,
  outstandingBs = 0
): string | null {
  if (!draft || typeof draft !== 'object') return 'Los datos de la liquidación no son válidos.';
  if (typeof draft.documentId !== 'string') return 'Debe seleccionar la factura de crédito.';
  if (!['SALE_COLLECTION', 'PURCHASE_PAYMENT'].includes(draft.kind)) return 'El tipo de liquidación no es válido.';
  if (typeof draft.settlementDate !== 'string') return 'La fecha de liquidación no es válida.';
  if (!['CASH_BS', 'CASH_USD', 'BANK_TRANSFER_BS', 'BANK_TRANSFER_USD', 'OTHER'].includes(draft.method)) return 'Seleccione un medio de pago válido.';
  if ((draft.method === 'BANK_TRANSFER_BS' || draft.method === 'BANK_TRANSFER_USD') && (typeof draft.bankAccountId !== 'string' || !draft.bankAccountId.trim())) return 'Seleccione la cuenta bancaria auxiliar de esta empresa para vincular el cobro o pago.';
  if ((draft.method === 'BANK_TRANSFER_BS' || draft.method === 'BANK_TRANSFER_USD') && (typeof draft.reference !== 'string' || !draft.reference.trim())) return 'La referencia o comprobante de la transferencia es obligatorio.';
  if (draft.method === 'OTHER') return 'El medio «Otro» no está habilitado porque no identifica una cuenta de tesorería verificable.';
  if (draft.reference != null && (typeof draft.reference !== 'string' || draft.reference.length > 200)) return 'La referencia no puede superar 200 caracteres.';
  if (!draft.documentId.trim()) return 'Debe seleccionar la factura de crédito.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.settlementDate)) return 'La fecha de liquidación no es válida.';
  const [year, month, day] = draft.settlementDate.split('-').map(Number);
  const parsedDate = new Date(Date.UTC(year, month - 1, day));
  if (parsedDate.getUTCFullYear() !== year ||
      parsedDate.getUTCMonth() !== month - 1 ||
      parsedDate.getUTCDate() !== day) return 'La fecha de liquidación no es válida.';
  if (!Number.isFinite(draft.bcvRate) || draft.bcvRate < 0) return 'La tasa BCV no puede ser negativa ni inválida.';
  if (!Number.isFinite(outstandingUsd) || outstandingUsd < 0 || !Number.isFinite(outstandingBs) || outstandingBs < 0) return 'El saldo pendiente de la factura no es válido; actualice los datos antes de liquidar.';
  if (!Number.isFinite(draft.amountUsd) || draft.amountUsd < 0) return 'El abono USD no puede ser negativo ni inválido.';
  if (draft.amountUsd > outstandingUsd + 0.005) return 'El abono supera el saldo pendiente de la factura.';
  if (!Number.isFinite(draft.amountBs) || draft.amountBs < 0) return 'El importe efectivamente pagado/cobrado en Bs no puede ser negativo.';
  const isUsdMethod = draft.method === 'CASH_USD' || draft.method === 'BANK_TRANSFER_USD';
  if (draft.amountUsd <= 0) {
    if (outstandingUsd > 0.005) return 'Este documento mantiene saldo USD; indique el abono USD o registre una tasa para liquidarlo.';
    if (draft.amountBs <= 0) return 'El abono en Bs debe ser mayor que cero.';
    if (draft.amountBs > outstandingBs + 0.01) return 'El abono en Bs supera el saldo pendiente nominal de la factura.';
    if (isUsdMethod) return 'Una liquidación en USD requiere un importe USD y su tasa de conversión.';
    return null;
  }
  if (outstandingUsd <= 0.005) return 'La factura no tiene saldo USD pendiente para aplicar este abono.';
  if (draft.amountBs <= 0 && !isUsdMethod) return 'El importe efectivamente pagado/cobrado en Bs debe ser mayor que cero.';
  if (draft.amountBs < 0) return 'El importe en Bs no puede ser negativo.';
  if (isBcvRateRequiredForDate(draft.settlementDate) && draft.bcvRate <= 0) return 'La tasa BCV es obligatoria para liquidaciones USD desde 2018.';
  if (isUsdMethod && draft.bcvRate <= 0) return 'La tasa BCV es obligatoria para liquidaciones en USD.';
  if (draft.bcvRate > 0) {
    const expectedBs = Math.round(draft.amountUsd * draft.bcvRate * 100) / 100;
    const actualBs = Math.round(draft.amountBs * 100) / 100;
    if (Math.abs(actualBs - expectedBs) >= 0.01) return 'El importe en Bs no coincide con el equivalente a la tasa de liquidación. Revise la tasa o el importe.';
  }
  return null;
}
