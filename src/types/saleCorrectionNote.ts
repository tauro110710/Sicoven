import type { SaleRecord } from './accounting';
import { isValidIsoDate } from './migrationParsing';
import { isBcvRateRequiredForDate } from '../utils/bcvRatePolicy';

export interface SaleCorrectionNoteRequest {
  kind: 'CREDIT' | 'DEBIT';
  sourceSale: SaleRecord;
  noteDate: string;
  noteNumber: string;
  controlNumber: string;
  reason: string;
  workpaperNote?: string;
  taxableBaseBs: number;
  exemptAmountBs: number;
  bcvRate: number;
  fiscalEmissionMedium: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal: boolean;
  priorCreditNotes: SaleRecord[];
  closedThroughDate?: string;
  /** Cantidad efectivamente devuelta por artículo/producto, conciliada contra Kardex. */
  returnedInventoryQuantities?: Record<string, number>;
  /** Cuenta de caja/banco para cobros o reembolsos que exceden la CxC. */
  treasuryAccountCode?: string;
}

export interface SaleCorrectionNoteAmounts {
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  igtfAmountBs: number;
  vatWithheldBs: number;
  totalAmountBs: number;
  netReceivableAdjustmentBs: number;
  taxableBaseUsd: number;
  exemptAmountUsd: number;
  vatAmountUsd: number;
  additionalLuxuryTaxUsd: number;
  igtfAmountUsd: number;
  vatWithheldUsd: number;
  totalAmountUsd: number;
  netReceivableAdjustmentUsd: number;
}

/**
 * Calcula una NC/ND sobre los mismos componentes fiscales de la factura fuente.
 * En alícuota combinada 31%, solo 16% es IVA; el 15% suntuario e IGTF se
 * mantienen separados. Las retenciones se distribuyen proporcionalmente al IVA.
 */
export function calculateSaleCorrectionNote(request: SaleCorrectionNoteRequest): SaleCorrectionNoteAmounts {
  const { sourceSale } = request;
  const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const usd = (value: number) => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
  const normalize = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');

  if (sourceSale.documentType !== '01' || sourceSale.isCancelled) {
    throw new Error('La nota debe afectar una factura de venta vigente tipo 01.');
  }
  if (!isValidIsoDate(sourceSale.invoiceDate) || !String(sourceSale.invoiceNumber || '').trim() ||
      !String(sourceSale.controlNumber || '').trim() || Number(sourceSale.totalAmountBs || 0) <= 0) {
    throw new Error('La factura original debe conservar fecha, número, control y monto para referenciar legalmente la nota.');
  }
  if (!isValidIsoDate(request.noteDate) || request.noteDate < sourceSale.invoiceDate) {
    throw new Error('La fecha de la nota debe ser válida y no anterior a la factura afectada.');
  }
  if (request.closedThroughDate && request.noteDate <= request.closedThroughDate) {
    throw new Error('La fecha de la nota pertenece a un período contable cerrado.');
  }
  if (!['DIGITAL', 'FISCAL_MACHINE', 'CONTINGENCY'].includes(request.fiscalEmissionMedium) ||
      request.sameMediumAsOriginal !== true) {
    throw new Error('La nota debe emitirse por el mismo medio de la factura original y esa condición debe confirmarse expresamente.');
  }
  if (!normalize(request.noteNumber) || !normalize(request.controlNumber) ||
      String(request.reason || '').trim().length < 10) {
    throw new Error('La nota requiere número, control y un motivo de al menos 10 caracteres.');
  }
  const values = [request.taxableBaseBs, request.exemptAmountBs, request.bcvRate,
    sourceSale.taxableBaseBs, sourceSale.exemptAmountBs, sourceSale.taxRate,
    sourceSale.vatAmountBs, sourceSale.totalAmountBs];
  if (!values.every(value => Number.isFinite(Number(value))) ||
      request.taxableBaseBs < 0 || request.exemptAmountBs < 0 ||
      request.taxableBaseBs + request.exemptAmountBs <= 0 ||
      request.bcvRate < 0 || (isBcvRateRequiredForDate(request.noteDate) && request.bcvRate <= 0) || sourceSale.taxableBaseBs < 0 ||
      sourceSale.exemptAmountBs < 0 || sourceSale.taxRate < 0 || sourceSale.taxRate > 100) {
    throw new Error('Los importes, la alícuota o la tasa BCV de la nota no son válidos.');
  }

  const vatRate = sourceSale.taxRate === 31 ? 16 : sourceSale.taxRate;
  const luxuryRate = sourceSale.taxRate === 31 ? 15 : 0;
  const expectedSourceVat = money(sourceSale.taxableBaseBs * vatRate / 100);
  const expectedSourceLuxury = money(sourceSale.taxableBaseBs * luxuryRate / 100);
  if (Math.abs(expectedSourceVat - money(sourceSale.vatAmountBs)) > 0.02) {
    throw new Error('La factura original no concilia el componente IVA con su base y alícuota. En operaciones al 31%, el IVA debe ser 16%.');
  }
  if (Math.abs(expectedSourceLuxury - money(Number(sourceSale.additionalLuxuryTaxBs || 0))) > 0.02) {
    throw new Error('La factura original no concilia el impuesto adicional del 15%; debe corregirse el documento fuente antes de emitir la nota.');
  }
  if (sourceSale.igtfApplicable && (Number(sourceSale.igtfRate || 0) <= 0 || Number(sourceSale.igtfAmountBs || 0) <= 0)) {
    throw new Error('La factura indica IGTF aplicable, pero no conserva su tasa e importe originales.');
  }
  if (Number(sourceSale.vatWithheldBs || 0) > Number(sourceSale.vatAmountBs || 0) + 0.01) {
    throw new Error('La retención de IVA original supera el IVA causado; debe conciliarse antes de emitir la nota.');
  }

  const taxableBaseBs = money(request.taxableBaseBs);
  const exemptAmountBs = money(request.exemptAmountBs);
  const vatAmountBs = money(taxableBaseBs * vatRate / 100);
  const additionalLuxuryTaxBs = money(taxableBaseBs * luxuryRate / 100);
  const igtfAmountBs = sourceSale.igtfApplicable
    ? money((taxableBaseBs + exemptAmountBs + vatAmountBs + additionalLuxuryTaxBs) * Number(sourceSale.igtfRate || 0) / 100)
    : 0;
  const vatWithheldBs = sourceSale.vatAmountBs > 0
    ? money(Number(sourceSale.vatWithheldBs || 0) * vatAmountBs / Number(sourceSale.vatAmountBs))
    : 0;
  const totalAmountBs = money(taxableBaseBs + exemptAmountBs + vatAmountBs + additionalLuxuryTaxBs + igtfAmountBs);
  const netReceivableAdjustmentBs = money(totalAmountBs - vatWithheldBs);
  if (netReceivableAdjustmentBs < 0) throw new Error('La retención distribuida supera el total de la nota.');

  if (request.kind === 'CREDIT') {
    const priorTaxable = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.taxableBaseBs || 0), 0);
    const priorExempt = request.priorCreditNotes.reduce((sum, note) => sum + Number(note.exemptAmountBs || 0), 0);
    const remainingTaxable = money(Number(sourceSale.taxableBaseBs) - priorTaxable);
    const remainingExempt = money(Number(sourceSale.exemptAmountBs) - priorExempt);
    if (taxableBaseBs > remainingTaxable + 0.01 || exemptAmountBs > remainingExempt + 0.01) {
      throw new Error('La nota de crédito supera la base imponible o exenta todavía disponible de la factura original.');
    }
  }

  const taxableBaseUsd = request.bcvRate > 0 ? usd(taxableBaseBs / request.bcvRate) : 0;
  const exemptAmountUsd = request.bcvRate > 0 ? usd(exemptAmountBs / request.bcvRate) : 0;
  const vatAmountUsd = request.bcvRate > 0 ? usd(vatAmountBs / request.bcvRate) : 0;
  const additionalLuxuryTaxUsd = request.bcvRate > 0 ? usd(additionalLuxuryTaxBs / request.bcvRate) : 0;
  const igtfAmountUsd = request.bcvRate > 0 ? usd(igtfAmountBs / request.bcvRate) : 0;
  const vatWithheldUsd = request.bcvRate > 0 ? usd(vatWithheldBs / request.bcvRate) : 0;
  const totalAmountUsd = request.bcvRate > 0 ? usd(totalAmountBs / request.bcvRate) : 0;
  return {
    taxableBaseBs, exemptAmountBs, vatAmountBs, additionalLuxuryTaxBs, igtfAmountBs,
    vatWithheldBs, totalAmountBs, netReceivableAdjustmentBs,
    taxableBaseUsd, exemptAmountUsd, vatAmountUsd, additionalLuxuryTaxUsd, igtfAmountUsd,
    vatWithheldUsd, totalAmountUsd, netReceivableAdjustmentUsd: request.bcvRate > 0 ? usd(netReceivableAdjustmentBs / request.bcvRate) : 0
  };
}
