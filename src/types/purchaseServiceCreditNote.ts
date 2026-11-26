import type { PurchaseRecord } from './accounting';
import { isBcvRateRequiredForDate } from '../utils/bcvRatePolicy';
import { isValidIsoDate } from './migrationParsing';
import { calculateFiscalBreakdown } from './vatFiscalEngine';

export interface PurchaseServiceCreditNoteRequest {
  purchase: PurchaseRecord;
  noteDate: string;
  creditNoteNumber: string;
  controlNumber: string;
  reason: string;
  workpaperNote?: string;
  taxableBaseBs: number;
  exemptAmountBs: number;
  bcvRate: number;
  fiscalEmissionMedium: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal: boolean;
  priorCreditNotes: PurchaseRecord[];
  closedThroughDate?: string;
}

export interface PurchaseServiceCreditNoteAmounts {
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  totalAmountBs: number;
  taxableBaseUsd: number;
  exemptAmountUsd: number;
  vatAmountUsd: number;
  additionalLuxuryTaxUsd: number;
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
  if (!isValidIsoDate(purchase.invoiceDate) || !String(purchase.invoiceNumber || '').trim() || !String(purchase.controlNumber || '').trim() || Number(purchase.totalAmountBs || 0) <= 0) {
    throw new Error('La factura original debe conservar fecha, número, control y monto para referenciar legalmente la NC.');
  }
  if (!isValidIsoDate(request.noteDate) || request.noteDate < purchase.invoiceDate) {
    throw new Error('La fecha de la NC debe ser válida y no anterior a la factura original.');
  }
  if (request.closedThroughDate && request.noteDate <= request.closedThroughDate) {
    throw new Error('La fecha de la NC pertenece a un período contable cerrado.');
  }
  if (!['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(request.fiscalEmissionMedium) || request.sameMediumAsOriginal !== true) {
    throw new Error('La NC debe registrarse por el mismo medio de emisión de la factura original y esa condición debe confirmarse expresamente.');
  }
  if (!String(request.creditNoteNumber || '').trim() || !String(request.controlNumber || '').trim() ||
      String(request.reason || '').trim().length < 10) {
    throw new Error('La NC requiere número, control y un motivo de al menos 10 caracteres.');
  }
  const values = [request.taxableBaseBs, request.exemptAmountBs, request.bcvRate,
    purchase.taxableBaseBs, purchase.exemptAmountBs, purchase.taxRate, purchase.vatAmountBs];
  if (!values.every(value => Number.isFinite(Number(value))) ||
      request.taxableBaseBs < 0 || request.exemptAmountBs < 0 ||
      request.taxableBaseBs + request.exemptAmountBs <= 0 ||
      request.bcvRate < 0 || (isBcvRateRequiredForDate(request.noteDate) && request.bcvRate <= 0) || purchase.taxRate < 0 || purchase.taxRate > 100) {
    throw new Error('Los importes, la alícuota o la tasa BCV de la NC no son válidos para la fecha de emisión.');
  }
  const originalBreakdown = calculateFiscalBreakdown({
    taxableBaseBs: Number(purchase.taxableBaseBs),
    exemptAmountBs: Number(purchase.exemptAmountBs),
    taxRate: Number(purchase.taxRate),
    igtfAmountBs: Number(purchase.igtfAmountBs || 0)
  });
  const effectiveVatRate = originalBreakdown.vatRate;
  const expectedVat = originalBreakdown.vatAmountBs;
  const expectedLuxury = originalBreakdown.additionalLuxuryTaxBs;
  const originalLuxury = Number(purchase.additionalLuxuryTaxBs ?? Math.max(0, Number(purchase.vatAmountBs) - expectedVat));
  if (Math.abs(originalLuxury - expectedLuxury) > 0.02) throw new Error('El impuesto adicional del 15% de la factura original no concilia.');
  if (Math.abs(expectedVat - Number(purchase.vatAmountBs)) > 0.02) {
    throw new Error('El IVA original no concilia con la base y alícuota registradas.');
  }
  const expectedOriginalTotal = money(Number(purchase.taxableBaseBs) + Number(purchase.exemptAmountBs) +
    Number(purchase.vatAmountBs) + originalLuxury + Number(purchase.igtfAmountBs || 0));
  if (Math.abs(expectedOriginalTotal - Number(purchase.totalAmountBs)) > 0.02) {
    throw new Error('El total original de la compra de servicios no concilia con IVA e impuesto adicional.');
  }
  const priorTaxable = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.taxableBaseBs || 0), 0);
  const priorExempt = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.exemptAmountBs || 0), 0);
  if (request.taxableBaseBs > money(Number(purchase.taxableBaseBs) - priorTaxable) + 0.01 ||
      request.exemptAmountBs > money(Number(purchase.exemptAmountBs) - priorExempt) + 0.01) {
    throw new Error('La NC supera la base imponible o exenta todavía disponible de la factura original.');
  }
  const taxableBaseBs = money(request.taxableBaseBs);
  const exemptAmountBs = money(request.exemptAmountBs);
  const noteBreakdown = calculateFiscalBreakdown({ taxableBaseBs, exemptAmountBs, taxRate: Number(purchase.taxRate) });
  const vatAmountBs = noteBreakdown.vatAmountBs;
  const additionalLuxuryTaxBs = noteBreakdown.additionalLuxuryTaxBs;
  const totalAmountBs = noteBreakdown.totalAmountBs;
  const taxableBaseUsd = request.bcvRate > 0 ? usd(taxableBaseBs / request.bcvRate) : 0;
  const exemptAmountUsd = request.bcvRate > 0 ? usd(exemptAmountBs / request.bcvRate) : 0;
  const vatAmountUsd = request.bcvRate > 0 ? usd(vatAmountBs / request.bcvRate) : 0;
  const additionalLuxuryTaxUsd = request.bcvRate > 0 ? usd(additionalLuxuryTaxBs / request.bcvRate) : 0;
  const totalAmountUsd = request.bcvRate > 0 ? usd(totalAmountBs / request.bcvRate) : 0;
  return {
    taxableBaseBs, exemptAmountBs, vatAmountBs, additionalLuxuryTaxBs, totalAmountBs,
    taxableBaseUsd, exemptAmountUsd, vatAmountUsd, additionalLuxuryTaxUsd, totalAmountUsd,
    netPayableReductionBs: totalAmountBs, netPayableReductionUsd: totalAmountUsd
  };
}
