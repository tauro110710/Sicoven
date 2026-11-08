import assert from 'node:assert/strict';
import testCase from 'node:test';
import { buildBankAuxiliaryAccounts, BANK_PARENT_ACCOUNT_CODES } from './bankAccountAccounting';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../data/defaultChartOfAccounts';
import type { Account } from './accounting';

const parents: Account[] = DEFAULT_CHART_OF_ACCOUNTS.filter(account =>
  account.code === BANK_PARENT_ACCOUNT_CODES.BS || account.code === BANK_PARENT_ACCOUNT_CODES.USD
);

testCase('el plan base contiene solamente las dos cuentas padre bancarias y ninguna entidad bancaria precargada', () => {
  assert.equal(parents.length, 2);
  assert.deepEqual(parents.map(account => account.code), ['1.1.1.06', '1.1.1.07']);
  assert.deepEqual(parents.map(account => account.name), ['Bancos Nacionales en Bolívares (BS.)', 'Bancos en Moneda Extranjera (USD)']);
  assert.equal(parents.some(account => /EUR|VES/i.test(account.name)), false);
  assert.ok(parents.every(account => account.type === 'ACTIVO' && !account.isMovement && account.parentCode === '1.1.1'));
  assert.equal(DEFAULT_CHART_OF_ACCOUNTS.some(account => /Banesco|Mercantil|Banco de Venezuela/i.test(account.name)), false);
});

testCase('crea el primer auxiliar nacional bajo la cuenta padre BS. seleccionada', () => {
  const result = buildBankAuxiliaryAccounts(parents, 'BS', 'Banco de Prueba', 'CORRIENTE', '1.1.1.06');
  assert.equal(result.parent.code, '1.1.1.06');
  assert.equal(result.auxiliary.code, '1.1.1.06.01');
  assert.equal(result.auxiliary.parentCode, result.parent.code);
  assert.equal(result.auxiliary.isMovement, true);
});

testCase('crea auxiliares extranjeros con secuencia independiente', () => {
  const first = buildBankAuxiliaryAccounts(parents, 'USD', 'Banco Exterior', 'CORRIENTE', '1.1.1.07');
  const second = buildBankAuxiliaryAccounts(first.accounts, 'USD', 'Banco Exterior', 'AHORRO', '1.1.1.07');
  assert.equal(first.auxiliary.code, '1.1.1.07.01');
  assert.equal(second.auxiliary.code, '1.1.1.07.02');
});

testCase('rechaza una cuenta padre incompatible con la moneda seleccionada', () => {
  assert.throws(
    () => buildBankAuxiliaryAccounts(parents, 'BS', 'Banco de Prueba', 'CORRIENTE', '1.1.1.07'),
    /no corresponde a la moneda/
  );
});

testCase('no crea auxiliares si falta o está mal configurada la cuenta padre', () => {
  assert.throws(
    () => buildBankAuxiliaryAccounts([], 'BS', 'Banco de Prueba', 'CORRIENTE', '1.1.1.06'),
    /No existe la cuenta padre/
  );
  const invalid = parents.map(account => account.code === '1.1.1.06' ? { ...account, isMovement: true } : account);
  assert.throws(
    () => buildBankAuxiliaryAccounts(invalid, 'BS', 'Banco de Prueba', 'CORRIENTE', '1.1.1.06'),
    /cuenta agrupadora/
  );
});
