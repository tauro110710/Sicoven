import type { Account } from './accounting';
import { isPurchasePaymentAccount, type PurchasePaymentAccount } from './purchaseSettlement';

export interface CompanyBankAccountRef { companyId: string; accountCode: string; }

/** Resolve a treasury account's currency without assuming every unknown account is Bs. */
export function resolveTreasuryAccountCurrency(
  accountCode: string,
  configuredBankCurrency?: 'BS' | 'USD'
): 'BS' | 'USD' {
  if (configuredBankCurrency) return configuredBankCurrency;
  if (accountCode === '1.1.1.01' || ['1.1.1.03', '1.1.1.04'].includes(accountCode)) return 'BS';
  if (accountCode === '1.1.1.02' || accountCode === '1.1.1.05') return 'USD';
  throw new Error('La cuenta de tesorería no está asociada a una cuenta bancaria de la empresa ni tiene una moneda de caja conocida.');
}

/** Only cash drawers and bank auxiliaries belonging to the active company may settle its purchases. */
export function getCompanyPurchasePaymentAccounts(
  accounts: PurchasePaymentAccount[],
  bankAccounts: CompanyBankAccountRef[],
  companyId: string
): PurchasePaymentAccount[] {
  const ownedBankCodes = new Set(bankAccounts.filter(bank => bank.companyId === companyId).map(bank => bank.accountCode));
  return accounts.filter(account => isPurchasePaymentAccount(account) && (
    !/^1\.1\.1\.0[3-9](?:\.|$)/.test(account.code) || ownedBankCodes.has(account.code)
  ));
}


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
    item.type === 'GASTOS' || item.type === 'COSTOS' || (item.type === 'ACTIVO' && item.code.startsWith('1.2.'))
  ));
  if (!account) {
    throw new Error('La compra no tiene una clasificación contable válida. Seleccione una cuenta de gasto o activo; no se asignará Honorarios Profesionales automáticamente.');
  }
  return account;
}
