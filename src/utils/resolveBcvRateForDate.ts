import type { AccountingBcvRateHistoryEntry } from '../types/accounting';

/**
 * Devuelve la tasa BCV más reciente del historial contable de la empresa
 * cuya `effectiveDate` sea <= a la fecha dada.
 *
 * - Nunca inventa ni aproxima una tasa ausente: devuelve `undefined` como
 *   faltante explícito cuando no existe ninguna entrada aplicable.
 * - Usar para sugerir la tasa en formularios (Tesorería, Inventario) y para
 *   derivar la equivalencia USD de asientos en bolívares con fecha histórica.
 * - No sustituye la obligación del contador de confirmar la tasa cuando la
 *   operación implica conversión real (cuenta USD, importación, etc.).
 */
function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}


export function resolveBcvRateForDate(
  history: AccountingBcvRateHistoryEntry[] | undefined | null,
  date: string
): number | undefined {
  if (!history || history.length === 0) return undefined;
  if (!isValidIsoDate(date)) return undefined;

  let best: AccountingBcvRateHistoryEntry | undefined;
  for (const entry of history) {
    if (!isValidIsoDate(entry.effectiveDate)) continue;
    if (entry.effectiveDate > date) continue;
    const rate = Number(entry.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!best || entry.effectiveDate >= best.effectiveDate) {
      best = entry;
    }
  }
  return best ? Number(best.rate) : undefined;
}
