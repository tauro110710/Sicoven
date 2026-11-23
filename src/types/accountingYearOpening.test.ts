import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpeningEntryItems } from './accountingYearOpening';
import type { Account, JournalEntry } from './accounting';

const accounts: Account[] = [
  { code: '1.1.1', name: 'Banco', type: 'ACTIVO', level: 2, isMovement: true },
  { code: '2.1.1', name: 'Proveedores', type: 'PASIVO', level: 2, isMovement: true },
  { code: '3.1.1', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 2, isMovement: true },
  { code: '4.1.1', name: 'Ingresos', type: 'INGRESOS', level: 2, isMovement: true },
  { code: '6.1.1', name: 'Gastos', type: 'GASTOS', level: 2, isMovement: true }
];
const entry = (id: string, date: string, items: JournalEntry['items']): JournalEntry => ({
  id, companyId: 'co-1', entryNumber: 1, date, description: 'Histórico', type: 'MANUAL',
  bcvRate: 100, items, createdAt: date + 'T12:00:00.000Z'
});
const line = (accountCode: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) => ({
  accountCode, accountName: accountCode, debitBs, creditBs, debitUsd, creditUsd
});

test('traslada cuentas de balance y lleva la utilidad a resultados acumulados en ambas monedas', () => {
  const journal = [entry('e1', '2026-12-31', [
    line('1.1.1', 1500, 0, 15, 0), line('2.1.1', 0, 400, 0, 4),
    line('3.1.1', 0, 600, 0, 6), line('4.1.1', 0, 700, 0, 7),
    line('6.1.1', 200, 0, 2, 0)
  ])];
  const items = buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: journal, retainedEarningsAccountCode: '3.1.1'
  });
  assert.equal(items.length, 3);
  assert.deepEqual(items.find(item => item.accountCode === '1.1.1') && {
    debitBs: items.find(item => item.accountCode === '1.1.1')!.debitBs,
    debitUsd: items.find(item => item.accountCode === '1.1.1')!.debitUsd
  }, { debitBs: 1500, debitUsd: 15 });
  assert.equal(items.find(item => item.accountCode === '2.1.1')?.creditBs, 400);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditBs, 1100);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditUsd, 11);
});

test('exige cuenta patrimonial imputable para trasladar resultados', () => {
  const journal = [entry('e1', '2026-12-31', [
    line('1.1.1', 100, 0, 1, 0), line('4.1.1', 0, 100, 0, 1)
  ])];
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: journal
  }), /cuenta imputable de patrimonio/);
});

test('rechaza asientos históricos descuadrados y aperturas duplicadas', () => {
  const unbalanced = [entry('e1', '2026-12-31', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 90, 0, 0.9)
  ])];
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: unbalanced
  }), /no cuadra/);
  const duplicate = entry('open-1', '2027-01-01', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 100, 0, 1)
  ]);
  duplicate.type = 'APERTURA';
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: [duplicate]
  }), /Ya existe un asiento de apertura/);
});

test('no mezcla empresas ni movimientos posteriores al corte', () => {
  const later = entry('later', '2027-01-02', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 100, 0, 1)
  ]);
  const other = entry('other', '2026-12-31', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 100, 0, 1)
  ]);
  other.companyId = 'co-2';
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: [later, other]
  }), /No existen saldos/);
});


test('rechaza asientos históricos con diferencias que exceden la tolerancia estricta de partida doble', () => {
  const unbalancedBs = [entry('bad-bs', '2026-12-31', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 99.985, 0, 1)
  ])];
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: unbalancedBs, retainedEarningsAccountCode: '3.1.1'
  }), /no cuadra/);

  const unbalancedUsd = [entry('bad-usd', '2026-12-31', [
    line('1.1.1', 100, 0, 1, 0), line('2.1.1', 0, 100, 0, 0.99995)
  ])];
  assert.throws(() => buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31', openingDate: '2027-01-01',
    accounts, journalEntries: unbalancedUsd, retainedEarningsAccountCode: '3.1.1'
  }), /no cuadra/);
});

test('uses the latest linked annual opening as the balance carry-forward boundary', () => {
  const opening2025 = entry('opening-2025', '2025-01-01', [
    line('1.1.1', 100, 0, 1, 0), line('3.1.1', 0, 100, 0, 1)
  ]);
  opening2025.type = 'APERTURA';
  opening2025.exerciseLink = {
    priorPeriodStartDate: '2024-01-01', priorPeriodEndDate: '2024-12-31', nextPeriodStartDate: '2025-01-01'
  };
  const priorSale = entry('sale-2025', '2025-06-01', [
    line('1.1.1', 50, 0, 0.5, 0), line('4.1.1', 0, 50, 0, 0.5)
  ]);
  const opening2026 = entry('opening-2026', '2026-01-01', [
    line('1.1.1', 150, 0, 1.5, 0), line('3.1.1', 0, 150, 0, 1.5)
  ]);
  opening2026.type = 'APERTURA';
  opening2026.exerciseLink = {
    priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01'
  };
  const currentExpense = entry('expense-2026', '2026-06-01', [
    line('6.1.1', 20, 0, 0.2, 0), line('1.1.1', 0, 20, 0, 0.2)
  ]);
  const items = buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31',
    openingDate: '2027-01-01', accounts, journalEntries: [opening2025, priorSale, opening2026, currentExpense],
    retainedEarningsAccountCode: '3.1.1'
  });
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitBs, 130);
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitUsd, 1.3);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditBs, 130);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditUsd, 1.3);
});

test('preserva el saldo de apertura al preparar un cierre anterior a una reversión futura', () => {
  const opening = entry('opening-2026', '2026-01-01', [
    line('1.1.1', 150, 0, 1.5, 0), line('3.1.1', 0, 150, 0, 1.5)
  ]);
  opening.type = 'APERTURA';
  opening.exerciseLink = {
    priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01'
  };
  const currentExpense = entry('expense-2026', '2026-06-01', [
    line('6.1.1', 20, 0, 0.2, 0), line('1.1.1', 0, 20, 0, 0.2)
  ]);
  const futureReversal = entry('reversal-2027', '2027-02-01', [
    line('3.1.1', 150, 0, 1.5, 0), line('1.1.1', 0, 150, 0, 1.5)
  ]);
  futureReversal.reversalOfEntryId = opening.id;
  opening.reversedByEntryId = futureReversal.id;
  const items = buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31',
    openingDate: '2027-01-01', accounts, journalEntries: [opening, currentExpense, futureReversal],
    retainedEarningsAccountCode: '3.1.1'
  });
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitBs, 130);
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitUsd, 1.3);
});

test('no vuelve a trasladar ingresos y gastos de ejercicios anteriores al resultado del nuevo período', () => {
  const journal = [
    entry('prior-income', '2025-12-30', [
      line('1.1.1', 100, 0, 1, 0), line('4.1.1', 0, 100, 0, 1)
    ]),
    entry('prior-close', '2025-12-31', [
      line('4.1.1', 100, 0, 1, 0), line('3.1.1', 0, 100, 0, 1)
    ]),
    entry('current-loss', '2026-06-30', [
      line('6.1.1', 20, 0, 0.2, 0), line('1.1.1', 0, 20, 0, 0.2)
    ])
  ];
  const items = buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2026-01-01', periodEndDate: '2026-12-31',
    openingDate: '2027-01-01', accounts, journalEntries: journal,
    retainedEarningsAccountCode: '3.1.1'
  });
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitBs, 80);
  assert.equal(items.find(item => item.accountCode === '3.1.1')?.creditBs, 80);
  assert.equal(items.some(item => item.accountCode === '4.1.1' || item.accountCode === '6.1.1'), false);
});

test('normaliza balances históricos a la escala de la fecha de apertura', () => {
  const journal = [
    entry('legacy-2018', '2018-08-19', [line('1.1.1', 100000000000, 0, 1, 0), line('2.1.1', 0, 100000000000, 0, 1)]),
    entry('post-2018', '2018-08-20', [line('1.1.1', 1000000, 0, 1, 0), line('2.1.1', 0, 1000000, 0, 1)])
  ];
  const items = buildOpeningEntryItems({
    companyId: 'co-1', periodStartDate: '2021-01-01', periodEndDate: '2021-12-31', openingDate: '2022-01-01',
    accounts, journalEntries: journal, retainedEarningsAccountCode: '3.1.1'
  });
  assert.equal(items.find(item => item.accountCode === '1.1.1')?.debitBs, 2);
  assert.equal(items.find(item => item.accountCode === '2.1.1')?.creditBs, 2);
});
