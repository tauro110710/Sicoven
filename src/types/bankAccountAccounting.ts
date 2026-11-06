import type { Account } from './accounting';

export type BankCurrency = 'BS' | 'USD';
export type BankAccountKind = 'CORRIENTE' | 'AHORRO';

export function buildBankAuxiliaryAccounts(
  currentAccounts: Account[],
  currency: BankCurrency,
  bankName: string,
  accountType: BankAccountKind
): { parent: Account; auxiliary: Account; accounts: Account[] } {
  const parentCode = currency === 'USD' ? '1.1.1.07' : '1.1.1.06';
  const controlName = currency === 'USD'
    ? 'Bancos Moneda Extranjera (control)'
    : 'Bancos Moneda Nacional (control)';
  const existingParent = currentAccounts.find(account => account.code === parentCode);
  const parent: Account = existingParent
    ? { ...existingParent, name: controlName, type: 'ACTIVO', isMovement: false, level: 4, parentCode: '1.1.1' }
    : { code: parentCode, name: controlName, type: 'ACTIVO', level: 4, isMovement: false, parentCode: '1.1.1' };

  const children = currentAccounts.filter(account =>
    account.parentCode === parentCode && /^\\d+$/.test(account.code.split('.').at(-1) || '')
  );
  const nextAux = children.reduce(
    (maximum, account) => Math.max(maximum, Number(account.code.split('.').at(-1) || 0)),
    0
  ) + 1;
  const code = parentCode + '.' + String(nextAux).padStart(2, '0');
  if (currentAccounts.some(account => account.code === code)) {
    throw new Error('No se pudo generar un código auxiliar bancario único.');
  }

  const auxiliary: Account = {
    code,
    name: `${bankName} - Cta. ${accountType === 'AHORRO' ? 'Ahorro' : 'Corriente'} ${currency === 'USD' ? 'USD' : 'Bs.'}`,
    type: 'ACTIVO',
    level: 5,
    isMovement: true,
    parentCode
  };
  const accounts = [
    ...currentAccounts.filter(account => account.code !== parentCode && account.code !== code),
    parent,
    auxiliary
  ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return { parent, auxiliary, accounts };
}
