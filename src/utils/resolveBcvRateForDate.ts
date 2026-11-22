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
export function resolveBcvRateForDate(
  history: AccountingBcvRateHistoryEntry[] | undefined | null,
  date: string
): number | undefined {
  if (!history || history.length === 0) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;

  let best: AccountingBcvRateHistoryEntry | undefined;
  for (const entry of history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate)) continue;
    if (entry.effectiveDate > date) continue;
    const rate = Number(entry.rate);
    if (!Number.isFinite(rate) || rate <= 0) continue;
    if (!best || entry.effectiveDate >= best.effectiveDate) {
      best = entry;
    }
  }
  return best ? Number(best.rate) : undefined;
}
