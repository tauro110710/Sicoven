/**
 * Cumplimiento prospectivo del artículo 18 de la Providencia SNAT/2026/00093.
 * Publicada en G.O. 43.484 el 21-10-2026; entra en vigor a los 180 días
 * continuos (19-04-2027). No se reescriben ni invalidan comprobantes históricos.
 */
export const RETENTION_VOUCHER_EMAIL_EFFECTIVE_DATE = '2027-04-19';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function validateRetentionVoucherSupplierEmail(
  supplierEmail: string | undefined,
  voucherIssueDate: string
): void {
  if (!ISO_DATE.test(voucherIssueDate)) {
    throw new Error('La fecha de emisión del comprobante de retención no es válida.');
  }
  const parsed = new Date(voucherIssueDate + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== voucherIssueDate) {
    throw new Error('La fecha de emisión del comprobante de retención no es válida.');
  }

  const email = String(supplierEmail || '').trim();
  if (email.length > 254 || (email && !EMAIL.test(email))) {
    throw new Error('El correo electrónico del proveedor no tiene un formato válido.');
  }
  if (voucherIssueDate >= RETENTION_VOUCHER_EMAIL_EFFECTIVE_DATE && !email) {
    throw new Error(
      'Desde el 19-04-2027, el artículo 18 de la Providencia SNAT/2026/00093 exige el correo electrónico del proveedor en el comprobante de retención. Complete el correo antes de registrar la compra.'
    );
  }
}

/** Article 19 requires fiscal documents to identify the governing providencia. */
export function requiresSnat2026DocumentReference(voucherIssueDate: string): boolean {
  if (!ISO_DATE.test(voucherIssueDate)) return false;
  const parsed = new Date(voucherIssueDate + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === voucherIssueDate &&
    voucherIssueDate >= RETENTION_VOUCHER_EMAIL_EFFECTIVE_DATE;
}
