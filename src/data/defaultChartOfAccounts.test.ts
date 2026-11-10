import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHART_OF_ACCOUNTS } from './defaultChartOfAccounts';

test('el plan de cuentas predeterminado no contiene códigos duplicados', () => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const account of DEFAULT_CHART_OF_ACCOUNTS) {
    if (seen.has(account.code)) duplicates.add(account.code);
    seen.add(account.code);
  }
  assert.deepEqual([...duplicates], []);
});

test('las cuentas de nómina requeridas existen una sola vez y son imputables', () => {
  for (const code of ['2.1.3.01', '2.1.3.02', '2.1.3.03', '2.1.3.04', '6.1.1.01', '6.1.1.12']) {
    const matches = DEFAULT_CHART_OF_ACCOUNTS.filter(account => account.code === code);
    assert.equal(matches.length, 1, `La cuenta ${code} debe existir exactamente una vez.`);
    assert.equal(matches[0].isMovement, true, `La cuenta ${code} debe admitir movimientos.`);
  }
});
