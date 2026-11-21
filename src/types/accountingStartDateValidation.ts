/** Enforces the company's chosen start of ordinary bookkeeping on new dated operations. */
export function validateAccountingStartDate(
  accountingStartDate: string | undefined,
  operationDate: string,
  operationLabel = 'La operación'
): string | null {
  if (!accountingStartDate) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(accountingStartDate)) {
    return 'La fecha de inicio contable configurada en la empresa no es válida. Corrija la ficha de la empresa antes de registrar operaciones.';
  }
  const start = new Date(accountingStartDate + 'T00:00:00.000Z');
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0, 10) !== accountingStartDate) {
    return 'La fecha de inicio contable configurada en la empresa no es válida. Corrija la ficha de la empresa antes de registrar operaciones.';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(operationDate)) return null;
  if (operationDate < accountingStartDate) {
    return operationLabel + ' es anterior al inicio del registro contable de esta empresa (' + accountingStartDate + '). No se registró.';
  }
  return null;
}
