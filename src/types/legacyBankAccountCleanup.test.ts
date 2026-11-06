import assert from 'node:assert/strict';
import testCase from 'node:test';
import { removeUnusedLegacyDefaultBanks } from './legacyBankAccountCleanup';
import type { Account, BankAccount, JournalEntry } from './accounting';

const legacyAccounts: Account[] = [
  { code: '1.1.1.03', name: 'Banco Nacional de Crédito', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' },
  { code: '1.1.1.04', name: 'Banesco Banco Universal', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' },
  { code: '1.1.1.05', name: 'Banco Mercantil', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' },
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, parentCode: '1.1.1' }
];

testCase('elimina los tres bancos predeterminados cuando no tienen movimientos ni auxiliares', () => {
  const result = removeUnusedLegacyDefaultBanks(legacyAccounts);
  assert.deepEqual(result.map(account => account.code), ['1.1.1.01']);
});

testCase('conserva un banco predeterminado asociado a una cuenta bancaria real', () => {
  const banks = [{ accountCode: '1.1.1.04' }] as BankAccount[];
  const result = removeUnusedLegacyDefaultBanks(legacyAccounts, [], banks);
  assert.deepEqual(result.map(account => account.code), ['1.1.1.04', '1.1.1.01']);
});

testCase('conserva un banco predeterminado utilizado por un asiento histórico', () => {
  const journals = [{ items: [{ accountCode: '1.1.1.05' }] }] as JournalEntry[];
  const result = removeUnusedLegacyDefaultBanks(legacyAccounts, journals, []);
  assert.deepEqual(result.map(account => account.code), ['1.1.1.05', '1.1.1.01']);
});
