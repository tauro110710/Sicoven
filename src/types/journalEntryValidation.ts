import type { Account, JournalEntryItem } from './accounting';

/**
 * Prevents posting to missing or grouping accounts before the entry reaches
 * application state or SQLite persistence. Historical entries are not rewritten.
 */

/** Convierte Bs. a USD con la tasa explícita del asiento sin redondear cada renglón.
 * La presentación puede mostrar seis decimales; el valor interno conserva precisión
 * para que el redondeo por línea no genere falsos descuadres en el total del asiento.
 */
export function convertBsToUsdAmount(amountBs: number, bcvRate: number): number {
  if (!Number.isFinite(amountBs) || amountBs < 0) {
    throw new Error('El importe en Bs. debe ser finito y no negativo.');
  }
  if (!Number.isFinite(bcvRate) || bcvRate <= 0) {
    throw new Error('La tasa BCV debe ser finita y mayor que cero.');
  }
  return amountBs / bcvRate;
}

export function validateJournalEntryAccounts(
  items: Pick<JournalEntryItem, 'accountCode'>[],
  accounts: Account[]
): void {
  for (const line of items) {
    const code = String(line.accountCode || '').trim();
    const account = accounts.find(candidate => candidate.code === code);
    if (!account) {
      throw new Error('La cuenta ' + (code || '(sin código)') + ' no existe en el plan de cuentas.');
    }
    if (!account.isMovement) {
      throw new Error('La cuenta ' + code + ' es agrupadora y no admite movimientos contables.');
    }
  }
}


/** An entry is balanced only when both Bs. and USD totals balance. */
export function isJournalEntryBalanced(
  totals: { debitBs: number; creditBs: number; debitUsd: number; creditUsd: number },
  toleranceBs = 0.01,
  toleranceUsd = 0.000001
): boolean {
  const values = [totals.debitBs, totals.creditBs, totals.debitUsd, totals.creditUsd];
  if (!values.every(value => Number.isFinite(value) && value >= 0)) return false;
  const hasMovement = totals.debitBs > 0 || totals.creditBs > 0 ||
    totals.debitUsd > 0 || totals.creditUsd > 0;
  return hasMovement &&
    Math.abs(totals.debitBs - totals.creditBs) < toleranceBs &&
    Math.abs(totals.debitUsd - totals.creditUsd) < toleranceUsd;
}
