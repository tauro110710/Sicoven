import type { Account } from './accounting';

/** Resolve the explicitly selected debit account for a non-inventory purchase. */
export function resolveNonInventoryPurchaseDebitAccount(
  accounts: Account[],
  selectedAccountCode: string | undefined,
  baseAmountBs: number
): Account | undefined {
  if (!Number.isFinite(baseAmountBs) || baseAmountBs < 0) {
    throw new Error('La base de la compra no es válida.');
  }
  if (baseAmountBs === 0) return undefined;
  const code = String(selectedAccountCode || '').trim();
  const account = accounts.find(item => item.code === code && item.isMovement && (
    item.type === 'GASTOS' || (item.type === 'ACTIVO' && item.code.startsWith('1.2.'))
  ));
  if (!account) {
    throw new Error('La compra no tiene una clasificación contable válida. Seleccione una cuenta de gasto o activo; no se asignará Honorarios Profesionales automáticamente.');
  }
  return account;
}
