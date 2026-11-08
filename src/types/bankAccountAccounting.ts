import type { Account } from './accounting';

export type BankCurrency = 'BS' | 'USD';
export type BankAccountKind = 'CORRIENTE' | 'AHORRO';

export const BANK_PARENT_ACCOUNT_CODES: Record<BankCurrency, string> = {
  BS: '1.1.1.06',
  USD: '1.1.1.07'
};

export function buildBankAuxiliaryAccounts(
  currentAccounts: Account[],
  currency: BankCurrency,
  bankName: string,
  accountType: BankAccountKind,
  selectedParentCode: string
): { parent: Account; auxiliary: Account; accounts: Account[] } {
  const expectedParentCode = BANK_PARENT_ACCOUNT_CODES[currency];
  if (selectedParentCode !== expectedParentCode) {
    throw new Error('La cuenta padre seleccionada no corresponde a la moneda de la cuenta bancaria.');
  }
  const parent = currentAccounts.find(account => account.code === selectedParentCode);
  if (!parent) {
    throw new Error(`No existe la cuenta padre bancaria ${selectedParentCode}. Restaure o actualice primero el Plan de Cuentas.`);
  }
  if (parent.isMovement || parent.type !== 'ACTIVO' || parent.level !== 4 || parent.parentCode !== '1.1.1') {
    throw new Error('La cuenta padre bancaria debe ser una cuenta agrupadora de Activo, hija de Efectivo y Equivalentes.');
  }

  const children = currentAccounts.filter(account =>
    account.parentCode === selectedParentCode && /^\\d+$/.test(account.code.split('.').at(-1) || '')
  );
  const nextAux = children.reduce(
    (maximum, account) => Math.max(maximum, Number(account.code.split('.').at(-1) || 0)),
    0
  ) + 1;
  const code = selectedParentCode + '.' + String(nextAux).padStart(2, '0');
  if (currentAccounts.some(account => account.code === code)) {
    throw new Error('No se pudo generar un código auxiliar bancario único.');
  }

  const auxiliary: Account = {
    code,
    name: `${bankName} - Cta. ${accountType === 'AHORRO' ? 'Ahorro' : 'Corriente'} ${currency === 'USD' ? 'USD' : 'VES'}`,
    type: 'ACTIVO',
    level: 5,
    isMovement: true,
    parentCode: selectedParentCode
  };
  const accounts = [
    ...currentAccounts.filter(account => account.code !== code),
    auxiliary
  ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return { parent, auxiliary, accounts };
}
