import test from 'node:test';
import assert from 'node:assert/strict';
import { buildClosingEntryItems } from './accountingYearClosing';
import type { Account, JournalEntry } from './accounting';

const accounts: Account[] = [
  { code: '1.1.1', name: 'Banco', type: 'ACTIVO', level: 2, isMovement: true },
  { code: '3.1.1', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 2, isMovement: true },
  { code: '4.1.1', name: 'Ingresos', type: 'INGRESOS', level: 2, isMovement: true },
  { code: '5.1.1', name: 'Costos', type: 'COSTOS', level: 2, isMovement: true },
  { code: '6.1.1', name: 'Gastos', type: 'GASTOS', level: 2, isMovement: true }
];
const line = (accountCode: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) => ({
  accountCode, accountName: accountCode, debitBs, creditBs, debitUsd, creditUsd
});
const entry = (id: string, date: string, items: JournalEntry['items'], companyId = 'co-1'): JournalEntry => ({
  id, companyId, entryNumber: 1, date, description: 'Histórico', type: 'MANUAL',
  bcvRate: 100, items, createdAt: date + 'T12:00:00.000Z'
});
const input = (journalEntries: JournalEntry[], retainedEarningsAccountCode?: string) => ({
  companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31',
  accounts, journalEntries, retainedEarningsAccountCode
});

test('cierra ingresos, costos y gastos y traslada la utilidad al patrimonio en Bs y USD', () => {
  const journal = [
    entry('income', '2026-03-01', [line('1.1.1', 1000, 0, 10, 0), line('4.1.1', 0, 1000, 0, 10)]),
    entry('cost', '2026-04-01', [line('5.1.1', 200, 0, 2, 0), line('1.1.1', 0, 200, 0, 2)]),
    entry('expense', '2026-05-01', [line('6.1.1', 300, 0, 3, 0), line('1.1.1', 0, 300, 0, 3)])
  ];
  const items = buildClosingEntryItems(input(journal, '3.1.1'));
  assert.equal(items.find(item => item.accountCode === '4.1.1')?.debitBs, 1000);
  assert.equal(items.find(item => item.accountCode === '5.1.1')?.creditBs, 200);
  assert.equal(items.find(item => item.accountCode === '6.1.1')?.creditBs, 300);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditBs, 500);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditUsd, 5);
  assert.equal(items.reduce((sum, item) => sum + item.debitBs, 0), items.reduce((sum, item) => sum + item.creditBs, 0));
  assert.equal(items.reduce((sum, item) => sum + item.debitUsd, 0), items.reduce((sum, item) => sum + item.creditUsd, 0));
});

test('traslada una pérdida al debe del patrimonio', () => {
  const journal = [
    entry('income', '2026-03-01', [line('1.1.1', 400, 0, 4, 0), line('4.1.1', 0, 400, 0, 4)]),
    entry('expense', '2026-05-01', [line('6.1.1', 700, 0, 7, 0), line('1.1.1', 0, 700, 0, 7)])
  ];
  const items = buildClosingEntryItems(input(journal, '3.1.1'));
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.debitBs, 300);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.debitUsd, 3);
});

test('no exige cuenta patrimonial cuando el resultado neto es cero', () => {
  const journal = [
    entry('income', '2026-03-01', [line('1.1.1', 500, 0, 5, 0), line('4.1.1', 0, 500, 0, 5)]),
    entry('expense', '2026-05-01', [line('6.1.1', 500, 0, 5, 0), line('1.1.1', 0, 500, 0, 5)])
  ];
  const items = buildClosingEntryItems(input(journal));
  assert.equal(items.length, 2);
  assert.equal(items.some(item => item.accountCode === '3.1.1'), false);
});

test('no mezcla empresas ni movimientos fuera del ejercicio', () => {
  const journal = [
    entry('income', '2026-03-01', [line('1.1.1', 100, 0, 1, 0), line('4.1.1', 0, 100, 0, 1)]),
    entry('prior', '2025-12-31', [line('1.1.1', 900, 0, 9, 0), line('4.1.1', 0, 900, 0, 9)]),
    entry('other-company', '2026-06-01', [line('1.1.1', 800, 0, 8, 0), line('4.1.1', 0, 800, 0, 8)], 'co-2')
  ];
  const items = buildClosingEntryItems(input(journal));
  assert.equal(items.find(item => item.accountCode === '4.1.1')?.debitBs, 100);
});

test('rechaza duplicar el cierre y rechaza asientos descuadrados', () => {
  const close = entry('close', '2026-12-31', [
    line('4.1.1', 100, 0, 1, 0), line('3.1.1', 0, 100, 0, 1)
  ]);
  close.type = 'CIERRE';
  assert.throws(() => buildClosingEntryItems(input([close])), /Ya existe un asiento de cierre/);
  const invalid = entry('invalid', '2026-03-01', [
    line('1.1.1', 100, 0, 1, 0), line('4.1.1', 0, 90, 0, 0.9)
  ]);
  assert.throws(() => buildClosingEntryItems(input([invalid])), /no cuadra/);
});

test('exige una cuenta patrimonial válida para trasladar utilidad o pérdida', () => {
  const journal = [entry('income', '2026-03-01', [
    line('1.1.1', 100, 0, 1, 0), line('4.1.1', 0, 100, 0, 1)
  ])];
  assert.throws(() => buildClosingEntryItems(input(journal)), /cuenta imputable y activa de patrimonio/);
});
