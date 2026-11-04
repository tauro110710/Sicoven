import type { PurchaseRecord } from './accounting';
import { isValidIsoDate } from './migrationParsing';

export interface PurchaseServiceCreditNoteRequest {
  purchase: PurchaseRecord;
  noteDate: string;
  creditNoteNumber: string;
  controlNumber: string;
  reason: string;
  workpaperNote: string;
  taxableBaseBs: number;
  exemptAmountBs: number;
  bcvRate: number;
  priorCreditNotes: PurchaseRecord[];
  closedThroughDate?: string;
}

export interface PurchaseServiceCreditNoteAmounts {
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  totalAmountBs: number;
  taxableBaseUsd: number;
  exemptAmountUsd: number;
  vatAmountUsd: number;
  totalAmountUsd: number;
  netPayableReductionBs: number;
  netPayableReductionUsd: number;
}

/** NC parcial para compras de servicios contabilizadas a costo/gasto, sin Kardex ni retenciones. */
export function calculatePurchaseServiceCreditNote(request: PurchaseServiceCreditNoteRequest): PurchaseServiceCreditNoteAmounts {
  const { purchase } = request;
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const usd = (value: number) => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  if (purchase.documentType !== '01' || purchase.isCancelled) {
    throw new Error('La NC debe afectar una factura de compra vigente tipo 01.');
  }
  if (purchase.inventoryLines?.length) {
    throw new Error('La factura contiene mercancía. Debe utilizarse el flujo de devolución con Kardex y costo histórico.');
  }
  if (Number(purchase.vatWithheldBs || 0) > 0 || Number(purchase.islrWithheldBs || 0) > 0 ||
      Number(purchase.igtfAmountBs || 0) > 0 || purchase.igtfApplicable) {
    throw new Error('La factura contiene retenciones o IGTF. Requiere el circuito de rectificación fiscal y enteramiento; no se aplicó una NC genérica.');
  }
  if (!['CREDITO', 'CONTADO'].includes(purchase.paymentTerm || '')) {
    throw new Error('La modalidad de la compra no permite determinar el efecto sobre CxP o anticipo del proveedor.');
  }
  if (!isValidIsoDate(request.noteDate) || request.noteDate < purchase.invoiceDate) {
    throw new Error('La fecha de la NC debe ser válida y no anterior a la factura original.');
  }
  if (request.closedThroughDate && request.noteDate <= request.closedThroughDate) {
    throw new Error('La fecha de la NC pertenece a un período contable cerrado.');
  }
  if (!String(request.creditNoteNumber || '').trim() || !String(request.controlNumber || '').trim() ||
      String(request.reason || '').trim().length < 10 || String(request.workpaperNote || '').trim().length < 10) {
    throw new Error('La NC requiere número, control, motivo y papel de trabajo de al menos 10 caracteres.');
  }
  const values = [request.taxableBaseBs, request.exemptAmountBs, request.bcvRate,
    purchase.taxableBaseBs, purchase.exemptAmountBs, purchase.taxRate, purchase.vatAmountBs];
  if (!values.every(value => Number.isFinite(Number(value))) ||
      request.taxableBaseBs < 0 || request.exemptAmountBs < 0 ||
      request.taxableBaseBs + request.exemptAmountBs <= 0 ||
      request.bcvRate <= 0 || purchase.taxRate < 0 || purchase.taxRate > 100) {
    throw new Error('Los importes, la alícuota o la tasa BCV de la NC no son válidos.');
  }
  if (Math.abs(money(Number(purchase.taxableBaseBs) * Number(purchase.taxRate) / 100) - Number(purchase.vatAmountBs)) > 0.02) {
    throw new Error('El IVA original no concilia con la base y alícuota registradas.');
  }
  const priorTaxable = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.taxableBaseBs || 0), 0);
  const priorExempt = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.exemptAmountBs || 0), 0);
  if (request.taxableBaseBs > money(Number(purchase.taxableBaseBs) - priorTaxable) + 0.01 ||
      request.exemptAmountBs > money(Number(purchase.exemptAmountBs) - priorExempt) + 0.01) {
    throw new Error('La NC supera la base imponible o exenta todavía disponible de la factura original.');
  }
  const taxableBaseBs = money(request.taxableBaseBs);
  const exemptAmountBs = money(request.exemptAmountBs);
  const vatAmountBs = money(taxableBaseBs * Number(purchase.taxRate) / 100);
  const totalAmountBs = money(taxableBaseBs + exemptAmountBs + vatAmountBs);
  const taxableBaseUsd = usd(taxableBaseBs / request.bcvRate);
  const exemptAmountUsd = usd(exemptAmountBs / request.bcvRate);
  const vatAmountUsd = usd(vatAmountBs / request.bcvRate);
  const totalAmountUsd = usd(totalAmountBs / request.bcvRate);
  return {
    taxableBaseBs, exemptAmountBs, vatAmountBs, totalAmountBs,
    taxableBaseUsd, exemptAmountUsd, vatAmountUsd, totalAmountUsd,
    netPayableReductionBs: totalAmountBs, netPayableReductionUsd: totalAmountUsd
  };
}
