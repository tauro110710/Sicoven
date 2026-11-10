'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const chartSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'defaultChartOfAccounts.ts'), 'utf8');
const accountCodes = [...chartSource.matchAll(/\bcode:\s*'([^']+)'/g)].map(match => match[1]);

test('el plan de cuentas predeterminado no contiene códigos duplicados', () => {
  const duplicates = [...new Set(accountCodes.filter((code, index) => accountCodes.indexOf(code) !== index))];
  assert.deepEqual(duplicates, []);
});

test('las cuentas de nómina requeridas existen una sola vez y son imputables', () => {
  for (const code of ['2.1.3.01', '2.1.3.02', '2.1.3.03', '2.1.3.04', '6.1.1.01', '6.1.1.12']) {
    assert.equal(accountCodes.filter(candidate => candidate === code).length, 1, `La cuenta ${code} debe existir exactamente una vez.`);
    const accountLine = chartSource.split(/\r?\n/).find(line => line.includes(`code: '${code}'`));
    assert.match(accountLine || '', /isMovement:\s*true/, `La cuenta ${code} debe admitir movimientos.`);
  }
});
