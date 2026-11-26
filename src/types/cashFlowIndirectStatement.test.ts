import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account, BankAccount, JournalEntry } from './accounting';
import { buildCashFlowIndirectReport } from './cashFlowIndirectStatement';
import { buildClosingEntryItems } from './accountingYearClosing';
import { roundReportCents, roundReportMicroUsd } from './reportMonetaryReexpression';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
  { code: '1.1.2.01', name: 'Cuentas por cobrar', type: 'ACTIVO', level: 4, isMovement: true, cashFlowIndirectTreatment: 'OPERATING_ASSET_INCREASE_DEDUCT' },
  { code: '1.2.1', name: 'Depreciación acumulada', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'INVERSION' },
  { code: '2.1.1.01', name: 'Cuentas por pagar', type: 'PASIVO', level: 4, isMovement: true, cashFlowIndirectTreatment: 'OPERATING_LIABILITY_INCREASE_ADD' },
  { code: '5.1.1', name: 'Gasto depreciación', type: 'GASTOS', level: 4, isMovement: true, cashFlowIndirectTreatment: 'NON_CASH_EXPENSE_ADD_BACK' },
  { code: '4.1.1', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '5.1.2', name: 'Gastos operacionales', type: 'GASTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
  { code: '3.1.1', name: 'Capital social', type: 'PATRIMONIO', level: 4, isMovement: true, cashFlowActivity: 'FINANCIACION' }
];
const banks: BankAccount[] = [];
const line = (accountCode: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) =>
  ({ accountCode, accountName: accountCode, debitBs, creditBs, debitUsd, creditUsd });
const entry = (id: string, date: string, items: JournalEntry['items'], type: JournalEntry['type'] = 'MANUAL', exerciseLink?: JournalEntry['exerciseLink']): JournalEntry =>
  ({ id, companyId: 'co-1', entryNumber: 1, date, description: id, type, bcvRate: 1, items, createdAt: date, exerciseLink });

describe('cash flow indirect method', () => {
  it('reconciles profit plus depreciation and working-capital changes in both currencies', () => {
    const entries = [
      entry('opening', '2026-01-01', [
        line('1.1.1.01', 100, 0, 10, 0),
        line('1.1.2.01', 20, 0, 2, 0),
        line('2.1.1.01', 0, 10, 0, 1),
        line('3.1.1', 0, 110, 0, 11)
      ], 'APERTURA', { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01' }),
      entry('sale-credit', '2026-02-01', [
        line('1.1.2.01', 50, 0, 5, 0),
        line('4.1.1', 0, 50, 0, 5)
      ]),
      entry('cash-sale', '2026-02-02', [
        line('1.1.1.01', 100, 0, 10, 0),
        line('4.1.1', 0, 100, 0, 10)
      ]),
      entry('depreciation', '2026-03-01', [
        line('5.1.1', 30, 0, 3, 0),
        line('1.2.1', 0, 30, 0, 3)
      ]),
      entry('payable-increase', '2026-04-01', [
        line('5.1.2', 20, 0, 2, 0),
        line('2.1.1.01', 0, 20, 0, 2)
      ]),
      entry('cash-expense', '2026-05-01', [
        line('5.1.2', 10, 0, 1, 0),
        line('1.1.1.01', 0, 10, 0, 1)
      ])
    ];
    const report = buildCashFlowIndirectReport(entries, accounts, banks, 'co-1', 2026);
    assert.equal(report.netIncomeBs, 90);
    assert.equal(report.nonCashAdjustmentsBs, 30);
    assert.equal(report.workingCapitalAdjustmentsBs, -50 + 20);
    assert.equal(report.operatingCashFlowBs, 90);
    assert.equal(report.operatingCashFlowUsd, 9);
    assert.equal(report.isReconciled, true);
  });

  it('keeps the opening balance when an annual opening is reversed on the first day of the year', () => {
    const opening = entry('opening-2026', '2026-01-01', [
      line('1.1.1.01', 100, 0, 10, 0),
      line('3.1.1', 0, 100, 0, 10)
    ], 'APERTURA', {
      priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01'
    });
    const reversal = entry('reversal-opening-2026', '2026-01-01', [
      line('3.1.1', 100, 0, 10, 0),
      line('1.1.1.01', 0, 100, 0, 10)
    ]);
    reversal.reversalOfEntryId = opening.id;
    opening.reversedByEntryId = reversal.id;
    const report = buildCashFlowIndirectReport([opening, reversal], accounts, banks, 'co-1', 2026);
    assert.equal(report.openingCashBs, 100);
    assert.equal(report.netChangeBs, -100);
    assert.equal(report.closingCashBs, 0);
    assert.equal(report.isReconciled, true);
  });

  it('uses the latest prior annual opening and subsequent pre-period movements for indirect opening balances', () => {
    const history = entry('history-2024', '2024-06-01', [
      line('1.1.2.01', 100, 0, 1, 0),
      line('3.1.1', 0, 100, 0, 1)
    ]);
    const opening2025 = entry('opening-2025', '2025-01-01', [
      line('1.1.1.01', 200, 0, 20, 0),
      line('1.1.2.01', 200, 0, 2, 0),
      line('3.1.1', 0, 400, 0, 40)
    ], 'APERTURA', {
      priorPeriodStartDate: '2024-01-01', priorPeriodEndDate: '2024-12-31', nextPeriodStartDate: '2025-01-01'
    });
    const priorSale = entry('prior-sale-credit', '2025-06-01', [
      line('1.1.2.01', 50, 0, 5, 0),
      line('4.1.1', 0, 50, 0, 5)
    ]);
    const currentExpense = entry('current-cash-expense', '2026-06-01', [
      line('5.1.2', 20, 0, 2, 0),
      line('1.1.1.01', 0, 20, 0, 2)
    ]);
    const report = buildCashFlowIndirectReport(
      [history, opening2025, priorSale, currentExpense], accounts, banks, 'co-1', 2026
    );
    const receivables = report.adjustments.find(row => row.accountCode === '1.1.2.01');
    assert.equal(receivables?.openingBalanceBs, 250);
    assert.equal(report.openingCashBs, 200);
    assert.equal(report.netChangeBs, -20);
    assert.equal(report.closingCashBs, 180);
    assert.equal(report.isReconciled, true);
  });

  it('redondea el resultado neto por cuenta igual que el asiento de cierre', () => {
    // Ejercicio 2018 que cruza la reconversión del 20-08: cada gasto queda en
    // 10,005 Bs. El cierre redondea cada cuenta (10,01) y traslada 0,99; sumar
    // las líneas sin redondear por cuenta daría 1,00.
    const halfCentAccounts: Account[] = [
      { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
      { code: '4.1.1', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
      { code: '5.1.2', name: 'Gasto A', type: 'GASTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
      { code: '5.1.3', name: 'Gasto B', type: 'GASTOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
      { code: '3.3.1', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 4, isMovement: true, cashFlowActivity: 'FINANCIACION' }
    ];
    const halfCentEntries = [
      entry('ingreso-medio-centavo', '2018-08-19', [
        line('1.1.1.01', 2_101_000, 0, 100, 0),
        line('4.1.1', 0, 2_101_000, 0, 100)
      ]),
      entry('gasto-medio-centavo-a', '2018-08-19', [
        line('5.1.2', 1_000_500, 0, 50, 0),
        line('1.1.1.01', 0, 1_000_500, 0, 50)
      ]),
      entry('gasto-medio-centavo-b', '2018-08-19', [
        line('5.1.3', 1_000_500, 0, 50, 0),
        line('1.1.1.01', 0, 1_000_500, 0, 50)
      ])
    ];
    const closingItems = buildClosingEntryItems({
      companyId: 'co-1',
      periodStartDate: '2018-01-01',
      periodEndDate: '2018-12-31',
      accounts: halfCentAccounts,
      journalEntries: halfCentEntries,
      retainedEarningsAccountCode: '3.3.1'
    });
    const closingNominalItems = closingItems.filter(item => ['4.1.1', '5.1.2', '5.1.3'].includes(item.accountCode));
    const closingResultBs = roundReportCents(closingNominalItems
      .reduce((sum, item) => sum + item.debitBs - item.creditBs, 0));
    const closingResultUsd = roundReportMicroUsd(closingNominalItems
      .reduce((sum, item) => sum + item.debitUsd - item.creditUsd, 0));
    assert.equal(closingResultBs, 0.99);

    const report = buildCashFlowIndirectReport(halfCentEntries, halfCentAccounts, banks, 'co-1', 2018);
    assert.equal(report.netIncomeBs, closingResultBs);
    assert.equal(report.netIncomeUsd, closingResultUsd);
    assert.equal(report.netIncomeBs, 0.99);
    // Sin el redondeo por cuenta, el resultado neto habría sido 1,00.
    assert.notEqual(report.netIncomeBs, 1);
    assert.equal(report.isReconciled, true);
  });

  it('mantiene conciliado el flujo indirecto con muchas cuentas de fracción de centavo', () => {
    // Doce cuentas nominales liquidadas en efectivo al 2018-08-19 (antes de la
    // reconversión del 20-08): cada ingreso queda en 12,34499 Bs. y cada gasto
    // en 12,34501 Bs. El libro mueve 24,68988 de efectivo, mientras que el
    // resultado redondeado por cuenta es 24,63: la diferencia bruta (0,06)
    // supera la tolerancia de 0,05 y es solo redondeo, no un descuadre.
    const manyAccounts: Account[] = [
      { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
      ...Array.from({ length: 7 }, (_, index): Account => ({
        code: `4.1.${index + 1}`, name: `Ingreso ${index + 1}`, type: 'INGRESOS', level: 4,
        isMovement: true, cashFlowActivity: 'OPERACION'
      })),
      ...Array.from({ length: 5 }, (_, index): Account => ({
        code: `5.1.${index + 1}`, name: `Gasto ${index + 1}`, type: 'GASTOS', level: 4,
        isMovement: true, cashFlowActivity: 'OPERACION'
      }))
    ];
    const manyEntries = [
      ...Array.from({ length: 7 }, (_, index) => entry(`ingreso-${index + 1}`, '2018-08-19', [
        line('1.1.1.01', 1_234_499, 0, 12, 0),
        line(`4.1.${index + 1}`, 0, 1_234_499, 0, 12)
      ])),
      ...Array.from({ length: 5 }, (_, index) => entry(`gasto-${index + 1}`, '2018-08-19', [
        line(`5.1.${index + 1}`, 1_234_501, 0, 12, 0),
        line('1.1.1.01', 0, 1_234_501, 0, 12)
      ]))
    ];
    const report = buildCashFlowIndirectReport(manyEntries, manyAccounts, banks, 'co-1', 2018);
    assert.equal(report.netIncomeBs, 24.63);
    assert.equal(report.reconciliationDifferenceBs, 0.06);
    assert.ok(Math.abs(report.reconciliationDifferenceBs) > 0.05);
    assert.equal(report.roundingDifferenceBs, 0.06);
    assert.ok(Math.abs(report.reconciliationResidualBs) < 0.005);
    assert.equal(report.isReconciled, true);
  });

  it('descuenta también el redondeo por cuenta de los ajustes en la conciliación', () => {
    // Doce cuentas por cobrar que aumentan 12,34501 Bs. cada una al 2018-08-19.
    // Cada ajuste de capital de trabajo se redondea a 12,35 (0,00499 de residuo
    // por cuenta, 0,05988 en total) y el resultado neto (148,14012) se redondea
    // a 148,14. El libro no mueve efectivo, así que la diferencia bruta es 0,06
    // y solo cierra descontando también el redondeo de los ajustes.
    const receivableAccounts: Account[] = [
      { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true, cashFlowActivity: 'EFECTIVO_EQUIVALENTE' },
      { code: '4.1.1', name: 'Ingresos operacionales', type: 'INGRESOS', level: 4, isMovement: true, cashFlowActivity: 'OPERACION' },
      ...Array.from({ length: 12 }, (_, index): Account => ({
        code: `1.1.2.${index + 1}`, name: `Cuentas por cobrar ${index + 1}`, type: 'ACTIVO', level: 4,
        isMovement: true, cashFlowIndirectTreatment: 'OPERATING_ASSET_INCREASE_DEDUCT'
      }))
    ];
    const creditSales = Array.from({ length: 12 }, (_, index) =>
      entry(`venta-credito-${index + 1}`, '2018-08-19', [
        line(`1.1.2.${index + 1}`, 1_234_501, 0, 12, 0),
        line('4.1.1', 0, 1_234_501, 0, 12)
      ]));
    const report = buildCashFlowIndirectReport(creditSales, receivableAccounts, banks, 'co-1', 2018);
    assert.equal(report.netIncomeBs, 148.14);
    assert.equal(report.workingCapitalAdjustmentsBs, -148.2);
    assert.equal(report.reconciliationDifferenceBs, 0.06);
    assert.ok(Math.abs(report.reconciliationDifferenceBs) > 0.05);
    assert.equal(report.isReconciled, true);
    assert.equal(report.roundingDifferenceBs, 0.06);
    assert.ok(Math.abs(report.reconciliationResidualBs) < 0.005);
  });

  it('isolates companies and refuses invalid periods', () => {
    const other = entry('other', '2026-01-01', [line('1.1.1.01', 0, 100, 0, 10)]);
    other.companyId = 'co-2';
    assert.equal(buildCashFlowIndirectReport([other], accounts, banks, 'co-1', 2026).netIncomeBs, 0);
    assert.throws(() => buildCashFlowIndirectReport([], accounts, banks, '', 2026));
  });

  it('rejects non-finite monetary values instead of silently converting them to zero', () => {
    const invalid = entry('invalid-amount', '2026-01-02', [
      line('1.1.1.01', Number.NaN, 0, 1, 0),
      line('4.1.1', 0, 1, 0, 1)
    ]);
    assert.throws(
      () => buildCashFlowIndirectReport([invalid], accounts, banks, 'co-1', 2026),
      /importe no finito/
    );
  });

  it('preserves sub-cent USD precision and rejects a material cash-flow reconciliation difference', () => {
    const precisionAccounts = [
      ...accounts,
      { code: '5.1.3', name: 'Gasto sin ajuste indirecto', type: 'GASTOS' as const,
        level: 4, isMovement: true, cashFlowActivity: 'OPERACION' as const },
      { code: '2.1.1.02', name: 'Pasivo sin tratamiento indirecto', type: 'PASIVO' as const,
        level: 4, isMovement: true }
    ];
    const report = buildCashFlowIndirectReport([
      entry('precision-only', '2026-06-01', [
        line('5.1.3', 100, 0, 0.004, 0),
        line('4.1.1', 0, 100, 0, 0),
        line('2.1.1.02', 0, 0, 0, 0.004)
      ])
    ], precisionAccounts, banks, 'co-1', 2026);
    assert.equal(report.netIncomeUsd, -0.004);
    assert.equal(report.reconciliationDifferenceUsd, 0.004);
    assert.equal(report.isReconciled, false);
  });

  it('does not silently mark unknown income and balance accounts as classified', () => {
    const incomplete = accounts.map(account => account.code === '4.1.1'
      ? { ...account, cashFlowActivity: undefined, cashFlowIndirectTreatment: undefined }
      : account);
    const report = buildCashFlowIndirectReport([
      entry('sale', '2026-01-01', [line('1.1.1.01', 10, 0, 1, 0), line('4.1.1', 0, 10, 0, 1)])
    ], incomplete, banks, 'co-1', 2026);
    assert.equal(report.isFullyClassified, false);
  });
});
