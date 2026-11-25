import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReconversionCarryForward } from './reconversionCarryForward';
import type { JournalEntry } from './accounting';

function entry(overrides: Partial<JournalEntry> & Pick<JournalEntry, 'id' | 'date'>): JournalEntry {
  return {
    companyId: 'company-1',
    entryNumber: 1,
    description: 'Asiento de prueba',
    type: 'MANUAL',
    bcvRate: 0,
    createdAt: '2026-11-25T00:00:00.000Z',
    items: [],
    ...overrides
  };
}

const entries: JournalEntry[] = [
  entry({
    id: 'e1',
    date: '2018-06-01',
    items: [
      { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 1000000, creditBs: 0, debitUsd: 0, creditUsd: 0 },
      { accountCode: '3.1.1.01', accountName: 'Capital', debitBs: 0, creditBs: 1000000, debitUsd: 0, creditUsd: 0 }
    ]
  }),
  entry({
    id: 'e2',
    date: '2018-08-20',
    items: [
      { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 500, creditBs: 0, debitUsd: 0, creditUsd: 0 },
      { accountCode: '4.1.1.01', accountName: 'Ingresos', debitBs: 0, creditBs: 500, debitUsd: 0, creditUsd: 0 }
    ]
  })
];

test('reexpresa el saldo del tramo anterior y excluye el día de la reconversión', () => {
  const result = buildReconversionCarryForward({ companyId: 'company-1', boundaryDate: '2018-08-20', entries });
  assert.equal(result.sourceThroughDate, '2018-08-19');
  assert.equal(result.sourceFromDate, '2008-01-01');
  assert.equal(result.fromEraId, 'BOLIVAR_FUERTE');
  assert.equal(result.toEraId, 'BOLIVAR_SOBERANO');
  assert.equal(result.removedDecimalExponent, 5);
  assert.equal(result.lines.length, 2);
  const cash = result.lines.find(line => line.accountCode === '1.1.1.01')!;
  assert.equal(cash.originalNetBs, '1000000');
  assert.equal(cash.reexpressedNetBs, '10');
  assert.equal(cash.debitBs, '10');
  const capital = result.lines.find(line => line.accountCode === '3.1.1.01')!;
  assert.equal(capital.creditBs, '10');
  assert.equal(result.totalDebitBs, '10');
  assert.equal(result.totalCreditBs, '10');
  assert.equal(result.isBalanced, true);
});

test('no incluye asientos de otra empresa ni posteriores al corte', () => {
  const result = buildReconversionCarryForward({
    companyId: 'company-1',
    boundaryDate: '2021-10-01',
    entries: [
      entry({ id: 'a', date: '2021-09-30', items: [
        { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 250000, creditBs: 0, debitUsd: 0, creditUsd: 0 },
        { accountCode: '3.1.1.01', accountName: 'Capital', debitBs: 0, creditBs: 250000, debitUsd: 0, creditUsd: 0 }
      ] }),
      entry({ id: 'b', date: '2021-09-30', companyId: 'company-2', items: [
        { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 999999, creditBs: 0, debitUsd: 0, creditUsd: 0 },
        { accountCode: '3.1.1.01', accountName: 'Capital', debitBs: 0, creditBs: 999999, debitUsd: 0, creditUsd: 0 }
      ] })
    ]
  });
  const cash = result.lines.find(line => line.accountCode === '1.1.1.01')!;
  assert.equal(cash.debitBs, '0.25');
  assert.equal(result.isBalanced, true);
});

test('no mezcla escalas de tramos distintos al reexpresar una frontera', () => {
  const result = buildReconversionCarryForward({
    companyId: 'company-1',
    boundaryDate: '2021-10-01',
    entries: [
      entry({ id: 'fuerte', date: '2015-01-01', items: [
        { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 999999999, creditBs: 0, debitUsd: 0, creditUsd: 0 },
        { accountCode: '3.1.1.01', accountName: 'Capital', debitBs: 0, creditBs: 999999999, debitUsd: 0, creditUsd: 0 }
      ] }),
      entry({ id: 'soberano', date: '2021-09-30', items: [
        { accountCode: '1.1.1.01', accountName: 'Caja', debitBs: 250000, creditBs: 0, debitUsd: 0, creditUsd: 0 },
        { accountCode: '3.1.1.01', accountName: 'Capital', debitBs: 0, creditBs: 250000, debitUsd: 0, creditUsd: 0 }
      ] })
    ]
  });
  assert.equal(result.sourceFromDate, '2018-08-20');
  assert.equal(result.lines.find(line => line.accountCode === '1.1.1.01')?.debitBs, '0.25');
  assert.ok(result.warnings.some(warning => warning.includes('tramo anterior')));
});

test('rechaza fechas que no sean fronteras de reconversión', () => {
  assert.throws(() => buildReconversionCarryForward({ companyId: 'company-1', boundaryDate: '2018-06-01', entries }));
});

test('advierte cuando el tramo anterior no tiene asientos', () => {
  const result = buildReconversionCarryForward({ companyId: 'company-1', boundaryDate: '2008-01-01', entries: [] });
  assert.equal(result.lines.length, 0);
  assert.equal(result.isBalanced, true);
  assert.ok(result.warnings.some(warning => warning.includes('No existen asientos')));
});
