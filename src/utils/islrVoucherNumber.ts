/**
 * Numeración de comprobantes de retención ISLR.
 *
 * La numeración AAAAMM + ocho dígitos secuenciales se activa desde
 * 19-04-2027, fecha de entrada en vigor prevista para el artículo 18
 * de la Providencia Administrativa SNAT/2026/00093.
 *
 * Los comprobantes anteriores conservan exactamente su formato histórico.
 */
export const ISLR_VOUCHER_14_DIGIT_EFFECTIVE_DATE = '2027-04-19';
export const ISLR_VOUCHER_SEQUENCE_MAX = 99_999_999;

export function formatIslrVoucherNumber(period: string, sequence: number, issueDate: string): string {
  if (!/^\\d{6}$/.test(period)) {
    throw new Error('El período ISLR debe tener formato AAAAMM.');
  }
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  if (month < 1 || month > 12) {
    throw new Error('El período ISLR contiene un mes inválido.');
  }
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(issueDate) ||
      !Number.isFinite(Date.parse(issueDate + 'T00:00:00')) ||
      new Date(issueDate + 'T00:00:00').toISOString().slice(0, 10) !== issueDate) {
    throw new Error('La fecha de emisión ISLR no es válida.');
  }
  if (issueDate.slice(0, 7).replace('-', '') !== period) {
    throw new Error('El período ISLR no coincide con la fecha efectiva del comprobante.');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('El correlativo ISLR debe ser un entero positivo.');
  }

  if (issueDate < ISLR_VOUCHER_14_DIGIT_EFFECTIVE_DATE) {
    // Compatibilidad: no renumerar ni alterar la presentación histórica.
    return `ISLR-${period}-${String(sequence).padStart(6, '0')}`;
  }

  if (sequence > ISLR_VOUCHER_SEQUENCE_MAX) {
    throw new Error('Se agotó el correlativo ISLR de ocho dígitos del período. No se permite reiniciar ni reutilizar números.');
  }
  return `${period}${String(sequence).padStart(8, '0')}`;
}

/**
 * Recupera el mayor correlativo ya emitido para un período, aceptando
 * los dos formatos históricos/futuros. Nunca deduce el siguiente número
 * a partir del total de documentos, porque podrían existir huecos.
 */
export function getMaxIslrVoucherSequence(period: string, voucherNumbers: readonly string[]): number {
  if (!/^\\d{6}$/.test(period)) {
    throw new Error('El período ISLR debe tener formato AAAAMM.');
  }
  let maximum = 0;
  for (const value of voucherNumbers) {
    const legacy = value.match(new RegExp('^ISLR-' + period + '-(\\\\d+)$'));
    const current = value.match(new RegExp('^' + period + '(\\\\d{8})$'));
    const raw = legacy?.[1] ?? current?.[1];
    if (raw !== undefined) {
      const sequence = Number(raw);
      if (Number.isSafeInteger(sequence) && sequence > maximum) maximum = sequence;
    }
  }
  return maximum;
}
