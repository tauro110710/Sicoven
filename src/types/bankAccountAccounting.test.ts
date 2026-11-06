import assert from 'node:assert/strict';
import testCase from 'node:test';
import { buildBankAuxiliaryAccounts } from './bankAccountAccounting';
import type { Account } from './accounting';

const baseAccounts: Account[] = [
  { code: '1', name: 'ACTIVO', type: 'ACTIVO', level: 1, isMovement: false },
  { code: '1.1', name: 'ACTIVO CORRIENTE', type: 'ACTIVO', level: 2, isMovement: false, parentCode: '1' },
  { code: '1.1.1', name: 'Efectivo y Equivalentes', type: 'ACTIVO', level: 3, isMovement: false, parentCode: '1.1' }
];

testCase('crea el primer auxiliar bancario en moneda nacional sin bancos predefinidos', () => {
  const result = buildBankAuxiliaryAccounts(baseAccounts, 'BS', 'Banco de Prueba', 'CORRIENTE');
  assert.equal(result.parent.code, '1.1.1.06');
  assert.equal(result.parent.isMovement, false);
  assert.equal(result.auxiliary.code, '1.1.1.06.01');
  assert.equal(result.auxiliary.level, 5);
  assert.equal(result.auxiliary.parentCode, result.parent.code);
  assert.equal(result.accounts.some(account => account.code === '1.1.1.06.01'), true);
  assert.equal(result.accounts.some(account => /Banesco|Mercantil|Nacional de Crédito/i.test(account.name)), false);
});

testCase('asigna consecutivos sin duplicar auxiliares bancarios', () => {
  const first = buildBankAuxiliaryAccounts(baseAccounts, 'BS', 'Banco Uno', 'CORRIENTE');
  const second = buildBankAuxiliaryAccounts(first.accounts, 'BS', 'Banco Dos', 'AHORRO');
  assert.equal(first.auxiliary.code, '1.1.1.06.01');
  assert.equal(second.auxiliary.code, '1.1.1.06.02');
});

testCase('mantiene una secuencia independiente para bancos en USD', () => {
  const result = buildBankAuxiliaryAccounts(baseAccounts, 'USD', 'Foreign Bank', 'CORRIENTE');
  assert.equal(result.parent.code, '1.1.1.07');
  assert.equal(result.auxiliary.code, '1.1.1.07.01');
});
