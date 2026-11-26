import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, JournalEntry } from './accounting';
import { buildClosingEntryItems } from './accountingYearClosing';
import { buildHistoricalBalanceSummary } from './historicalBalancesReport';
import { roundReportCents } from './reportMonetaryReexpression';
import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '3.3.1.01', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 4, isMovement: true },
  { code: '4.1.1.01', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true },
  { code: '5.1.1.01', name: 'Gasto A', type: 'GASTOS', level: 4, isMovement: true },
  { code: '5.1.2.01', name: 'Gasto B', type: 'GASTOS', level: 4, isMovement: true }
];

const entry = (
  id: string,
  entryNumber: number,
  date: string,
  lines: Array<[string, number, number, number, number]>
): JournalEntry => ({
  id,
  companyId: 'company-1',
  entryNumber,
  date,
  description: 'Asiento ' + id,
  type: 'MANUAL',
  bcvRate: 100,
  createdAt: date + 'T12:00:00.000Z',
  items: lines.map(([accountCode, debitBs, creditBs, debitUsd, creditUsd]) => ({
    accountCode,
    accountName: accounts.find(account => account.code === accountCode)?.name || accountCode,
    debitBs,
    creditBs,
    debitUsd,
    creditUsd
  }))
});

// Ejercicio 2018: cruza la reconversión del 20-08-2018. Los importes previos
// se dividen entre 100.000 al presentarse al cierre y dejan fracciones de
// centavo, que es justo donde el redondeo por cuenta puede separar el reporte
// del asiento contabilizado.
const entries2018: JournalEntry[] = [
  entry('capital', 1, '2018-06-01', [
    ['1.1.1.01', 1_000_000_000_000, 0, 10, 0],
    ['3.3.1.01', 0, 1_000_000_000_000, 0, 10]
  ]),
  entry('ingreso', 2, '2018-08-19', [
    ['1.1.1.01', 2_101_000, 0, 100, 0],
    ['4.1.1.01', 0, 2_101_000, 0, 100]
  ]),
  entry('gasto-a', 3, '2018-08-19', [
    ['5.1.1.01', 1_000_500, 0, 50, 0],
    ['1.1.1.01', 0, 1_000_500, 0, 50]
  ]),
  entry('gasto-b', 4, '2018-08-19', [
    ['5.1.2.01', 1_000_500, 0, 50, 0],
    ['1.1.1.01', 0, 1_000_500, 0, 50]
  ])
];

// El cierre invierte los saldos nominales: debita los acreedores (ingresos) y
// acredita los deudores (costos y gastos). Cada línea vale el saldo natural de
// la cuenta con el signo opuesto, de modo que la suma de (debe − haber) de las
// líneas nominales es exactamente el resultado trasladado al patrimonio.
const closingResult = (items: ReturnType<typeof buildClosingEntryItems>) =>
  items.reduce((sum, item) => {
    const type = accounts.find(a => a.code === item.accountCode)?.type || '';
    if (!['INGRESOS', 'COSTOS', 'GASTOS'].includes(type)) return sum;
    return sum + (item.debitBs - item.creditBs);
  }, 0);

test('el resultado del balance histórico coincide al centavo con el asiento de cierre', () => {
  const closingItems = buildClosingEntryItems({
    companyId: 'company-1',
    periodStartDate: '2018-01-01',
    periodEndDate: '2018-12-31',
    accounts,
    journalEntries: entries2018,
    retainedEarningsAccountCode: '3.3.1.01'
  });
  const summary = buildHistoricalBalanceSummary({
    entries: entries2018,
    accounts,
    companyId: 'company-1',
    year: 2018,
    kind: 'RESULTADOS'
  });

  assert.equal(summary.reportScaleDate, '2018-12-31');

  // El asiento de cierre redondea el neto de cada cuenta a centavos antes de
  // sumar: el ingreso de 21,010 Bs. cierra en 21,01 y cada gasto de 10,005 Bs.
  // en 10,01 (20,02). Resultado contabilizado: 0,99 Bs. Sin el redondeo por
  // cuenta el resultado sería 1,00 y no coincidiría con el asiento.
  const closed = roundReportCents(closingResult(closingItems));
  assert.equal(closed, 0.99);
  assert.equal(summary.resultadoBs, closed, 'el reporte debe reproducir el resultado contabilizado al centavo');

  // La transferencia al patrimonio refleja exactamente ese mismo resultado.
  const transfer = closingItems.find(item => item.accountCode === '3.3.1.01');
  assert.ok(transfer);
  assert.equal(roundReportCents(transfer!.creditBs - transfer!.debitBs), summary.resultadoBs);
});

test('sumar los netos sin redondear por cuenta se desvía del asiento de cierre', () => {
  const summary = buildHistoricalBalanceSummary({
    entries: entries2018,
    accounts,
    companyId: 'company-1',
    year: 2018,
    kind: 'RESULTADOS'
  });
  // Mismo cálculo sin el redondeo por cuenta que aplica el cierre: se acumula
  // el neto exacto de cada cuenta y se redondea una sola vez al final.
  const netsByAccount = new Map<string, number>();
  for (const asiento of entries2018) {
    for (const line of asiento.items) {
      const account = accounts.find(a => a.code === line.accountCode);
      if (!account || !['INGRESOS', 'COSTOS', 'GASTOS'].includes(account.type)) continue;
      const credit = Number(reexpressAmountBetweenDates(line.creditBs, asiento.date, '2018-12-31'));
      const debit = Number(reexpressAmountBetweenDates(line.debitBs, asiento.date, '2018-12-31'));
      netsByAccount.set(line.accountCode, (netsByAccount.get(line.accountCode) ?? 0) + credit - debit);
    }
  }
  const naive = roundReportCents([...netsByAccount.values()].reduce((total, net) => total + net, 0));
  assert.equal(naive, 1, 'sin redondear por cuenta el resultado se separa un centavo del cierre');
  assert.notEqual(naive, summary.resultadoBs);
  assert.ok(Math.abs(naive - summary.resultadoBs) >= 0.01);
});

test('el balance de situación usa el mismo resultado y la misma escala de cierre', () => {
  const situacion = buildHistoricalBalanceSummary({
    entries: entries2018,
    accounts,
    companyId: 'company-1',
    year: 2018,
    kind: 'SITUACION'
  });
  const resultados = buildHistoricalBalanceSummary({
    entries: entries2018,
    accounts,
    companyId: 'company-1',
    year: 2018,
    kind: 'RESULTADOS'
  });
  assert.equal(situacion.resultadoBs, resultados.resultadoBs);
  assert.equal(situacion.totalPatrimonioBs, roundReportCents(situacion.patrimonioBaseBs + situacion.resultadoBs));
});

test('coincide también cuando una cuenta acumula líneas de ambos lados de la reconversión', () => {
  const conVariasLineas: JournalEntry[] = [
    entry('ingreso-1', 1, '2018-06-15', [
      ['1.1.1.01', 1_234_567, 0, 12, 0],
      ['4.1.1.01', 0, 1_234_567, 0, 12]
    ]),
    entry('ingreso-2', 2, '2018-09-15', [
      ['1.1.1.01', 7_654_321, 0, 78, 0],
      ['4.1.1.01', 0, 7_654_321, 0, 78]
    ]),
    entry('gasto-1', 3, '2018-06-15', [
      ['5.1.1.01', 345_678, 0, 4, 0],
      ['1.1.1.01', 0, 345_678, 0, 4]
    ]),
    entry('gasto-2', 4, '2018-09-15', [
      ['5.1.2.01', 987_654, 0, 6, 0],
      ['1.1.1.01', 0, 987_654, 0, 6]
    ])
  ];
  const closingItems = buildClosingEntryItems({
    companyId: 'company-1',
    periodStartDate: '2018-01-01',
    periodEndDate: '2018-12-31',
    accounts,
    journalEntries: conVariasLineas,
    retainedEarningsAccountCode: '3.3.1.01'
  });
  const summary = buildHistoricalBalanceSummary({
    entries: conVariasLineas,
    accounts,
    companyId: 'company-1',
    year: 2018,
    kind: 'RESULTADOS'
  });
  const closed = roundReportCents(closingResult(closingItems));
  assert.ok(Math.abs(closed) > 0.01, 'el caso debe trasladar un resultado al patrimonio');
  assert.equal(summary.resultadoBs, closed);
  const transfer = closingItems.find(item => item.accountCode === '3.3.1.01');
  assert.ok(transfer, 'el cierre debe trasladar el resultado a resultados acumulados');
  assert.equal(roundReportCents(transfer!.creditBs - transfer!.debitBs), summary.resultadoBs);
});
