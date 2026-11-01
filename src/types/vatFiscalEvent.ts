export type PurchaseVatFiscalTrigger = 'PAYMENT' | 'ACCOUNT_CREDIT';

export interface PurchaseVatFiscalEvent {
  trigger: PurchaseVatFiscalTrigger;
  fiscalDate: string;
  period: string;
}

/**
 * Resolves the first VAT withholding trigger represented by the purchase workflow.
 * Cash purchases use the effective payment date; credit purchases use the
 * account-credit recognition date. The invoice issue date remains documentary.
 */
export function resolvePurchaseVatFiscalEvent(
  paymentTerm: 'CONTADO' | 'CREDITO' | undefined,
  effectiveDate: string
): PurchaseVatFiscalEvent {
  if (paymentTerm !== 'CONTADO' && paymentTerm !== 'CREDITO') {
    throw new Error('La retención IVA requiere una modalidad de pago identificable.');
  }
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(effectiveDate || ''))) {
    throw new Error('La retención IVA requiere una fecha efectiva de pago o abono en cuenta válida.');
  }
  const parsed = new Date(effectiveDate + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== effectiveDate) {
    throw new Error('La fecha efectiva de retención IVA no existe en el calendario.');
  }
  return {
    trigger: paymentTerm === 'CONTADO' ? 'PAYMENT' : 'ACCOUNT_CREDIT',
    fiscalDate: effectiveDate,
    period: effectiveDate.slice(0, 7).replace('-', '')
  };
}
