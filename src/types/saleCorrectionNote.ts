import type { SaleRecord } from './accounting';
import { isValidIsoDate } from './migrationParsing';

export interface SaleCorrectionNoteRequest {
  kind: 'CREDIT' | 'DEBIT';
  sourceSale: SaleRecord;
  noteDate: string;
  noteNumber: string;
  controlNumber: string;
  reason: string;
  workpaperNote: string;
  taxableBaseBs: number;
  exemptAmountBs: number;
  bcvRate: number;
  fiscalEmissionMedium: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal: boolean;
  priorCreditNotes: SaleRecord[];
  closedThroughDate?: string;
}

export interface SaleCorrectionNoteAmounts {
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  totalAmountBs: number;
  netReceivableAdjustmentBs: number;
  taxableBaseUsd: number;
  exemptAmountUsd: number;
  vatAmountUsd: number;
  totalAmountUsd: number;
  netReceivableAdjustmentUsd: number;
}

/**
 * Valida y calcula una NC/ND parcial de venta. No emite el documento ni muta
 * el original. Los casos con retenciones, IGTF, inventario o contado se bloquean
 * hasta que exista un circuito específico para sus efectos auxiliares/fiscales.
 */
export function calculateSaleCorrectionNote(request: SaleCorrectionNoteRequest): SaleCorrectionNoteAmounts {
  const { sourceSale } = request;
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const usd = (value: number) => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  const normalize = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\\s+/g, '');

  if (sourceSale.documentType !== '01' || sourceSale.isCancelled) {
    throw new Error('La nota debe afectar una factura de venta vigente tipo 01.');
  }
  if (sourceSale.paymentTerm !== 'CREDITO') {
    throw new Error('La factura de contado requiere un flujo de devolución/reembolso de tesorería; no se puede ajustar como CxC.');
  }
  if (Number(sourceSale.vatWithheldBs || 0) > 0 || String(sourceSale.retentionVoucherNumber || '').trim()) {
    throw new Error('La factura tiene retención de IVA del cliente. Primero debe tramitarse y documentarse la corrección del comprobante y su efecto fiscal; no se modificó la factura.');
  }
  if (Number(sourceSale.igtfAmountBs || 0) > 0 || sourceSale.igtfApplicable) {
    throw new Error('La factura contiene IGTF. Requiere un circuito específico de percepción, enteramiento y eventual reintegro antes de emitir la nota.');
  }
  if (!isValidIsoDate(sourceSale.invoiceDate) || !String(sourceSale.invoiceNumber || '').trim() || !String(sourceSale.controlNumber || '').trim() || Number(sourceSale.totalAmountBs || 0) <= 0) {
    throw new Error('La factura original debe conservar fecha, número, control y monto para referenciar legalmente la nota.');
  }
  if (!isValidIsoDate(request.noteDate) || request.noteDate < sourceSale.invoiceDate) {
    throw new Error('La fecha de la nota debe ser válida y no anterior a la factura afectada.');
  }
  if (request.closedThroughDate && request.noteDate <= request.closedThroughDate) {
    throw new Error('La fecha de la nota pertenece a un período contable cerrado.');
  }
  if (!['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(request.fiscalEmissionMedium) || request.sameMediumAsOriginal !== true) {
    throw new Error('La nota debe emitirse por el mismo medio de la factura original y esa condición debe confirmarse expresamente.');
  }
  if (!normalize(request.noteNumber) || !normalize(request.controlNumber) ||
      String(request.reason || '').trim().length < 10 ||
      String(request.workpaperNote || '').trim().length < 10) {
    throw new Error('La nota requiere número, control, motivo y papel de trabajo de al menos 10 caracteres.');
  }
  const values = [request.taxableBaseBs, request.exemptAmountBs, request.bcvRate,
    sourceSale.taxableBaseBs, sourceSale.exemptAmountBs, sourceSale.taxRate,
    sourceSale.vatAmountBs, sourceSale.totalAmountBs];
  if (!values.every(value => Number.isFinite(Number(value))) ||
      request.taxableBaseBs < 0 || request.exemptAmountBs < 0 ||
      request.taxableBaseBs + request.exemptAmountBs <= 0 ||
      request.bcvRate <= 0 || sourceSale.taxableBaseBs < 0 ||
      sourceSale.exemptAmountBs < 0 || sourceSale.taxRate < 0 || sourceSale.taxRate > 100) {
    throw new Error('Los importes, la alícuota o la tasa BCV de la nota no son válidos.');
  }
  if (Math.abs(money(sourceSale.taxableBaseBs * sourceSale.taxRate / 100) - money(sourceSale.vatAmountBs)) > 0.02) {
    throw new Error('La factura original no concilia su IVA con la base y alícuota registradas.');
  }
  const taxableBaseBs = money(request.taxableBaseBs);
  const exemptAmountBs = money(request.exemptAmountBs);
  const vatAmountBs = money(taxableBaseBs * sourceSale.taxRate / 100);
  const totalAmountBs = money(taxableBaseBs + exemptAmountBs + vatAmountBs);
  if (request.kind === 'CREDIT') {
    const priorTaxable = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.taxableBaseBs || 0), 0);
    const priorExempt = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.exemptAmountBs || 0), 0);
    const remainingTaxable = money(Number(sourceSale.taxableBaseBs) - priorTaxable);
    const remainingExempt = money(Number(sourceSale.exemptAmountBs) - priorExempt);
    if (taxableBaseBs > remainingTaxable + 0.01 || exemptAmountBs > remainingExempt + 0.01) {
      throw new Error('La nota de crédito supera la base imponible o exenta todavía disponible de la factura original.');
    }
      }
  const taxableBaseUsd = usd(taxableBaseBs / request.bcvRate);
  const exemptAmountUsd = usd(exemptAmountBs / request.bcvRate);
  const vatAmountUsd = usd(vatAmountBs / request.bcvRate);
  const totalAmountUsd = usd(totalAmountBs / request.bcvRate);
  return {
    taxableBaseBs, exemptAmountBs, vatAmountBs, totalAmountBs,
    netReceivableAdjustmentBs: totalAmountBs,
    taxableBaseUsd, exemptAmountUsd, vatAmountUsd, totalAmountUsd,
    netReceivableAdjustmentUsd: totalAmountUsd
  };
}
