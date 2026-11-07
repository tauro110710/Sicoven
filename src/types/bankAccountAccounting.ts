import type { Account } from './accounting';

export type BankCurrency = 'BS' | 'USD';
export type BankAccountKind = 'CORRIENTE' | 'AHORRO';

export function buildBankAuxiliaryAccounts(
  currentAccounts: Account[],
  currency: BankCurrency,
  bankName: string,
  accountType: BankAccountKind
): { parent: Account; auxiliary: Account; accounts: Account[] } {
  // Una sola cuenta matriz para todos los bancos; la moneda se conserva en la ficha bancaria.
  const parentCode = '1.1.1.03';
  const existingParent = currentAccounts.find(account => account.code === parentCode);
  if (!existingParent) {
    throw new Error('No existe la cuenta matriz 1.1.1.03 – BANCOS. Cree o restaure primero esta cuenta totalizadora en el Catálogo de Cuentas.');
  }
  if (existingParent.isMovement) {
    throw new Error('La cuenta matriz de Bancos (1.1.1.03) debe ser de tipo Totalizadora / Grupo; no puede recibir movimientos directos.');
  }
  if (existingParent.type !== 'ACTIVO' || existingParent.level !== 4 || existingParent.parentCode !== '1.1.1') {
    throw new Error('La cuenta matriz 1.1.1.03 debe pertenecer a Efectivo y Equivalentes, ser de Activo y estar en el nivel 4.');
  }

  const children = currentAccounts.filter(account =>
    account.parentCode === parentCode && /^\d+$/.test(account.code.split('.').at(-1) || '')
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
    ...currentAccounts.filter(account => account.code !== code),
    auxiliary
  ].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));

  return { parent: existingParent, auxiliary, accounts };
}
