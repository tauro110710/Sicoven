import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, AccountType, JournalEntry, JournalEntryItem } from '../types/accounting';
import { allowsUsdForOperationDate, formatUsdForDate, getReglaMonetariaPorFecha } from '../utils/monetaryPolicy';
import { isJournalEntryBalanced, isJournalEntryCurrencyPolicySatisfied, validateJournalEntryAccounts } from '../types/journalEntryValidation';
import { buildPayrollJournalItems } from '../utils/payrollAccounting';
import { buildCreditSettlementJournalItems } from '../types/creditSettlementAccounting';
import { buildSupplierAdvanceSettlementJournalItems } from '../types/supplierAdvanceSettlementAccounting';
import { calculateFifoIssue, calculateWeightedAverageCostDual, validateInventoryMovement } from '../types/inventoryAccounting';
import { buildClosingEntryItems } from '../types/accountingYearClosing';
import { buildOpeningEntryItems } from '../types/accountingYearOpening';
import { buildReconversionCarryForward } from '../types/reconversionCarryForward';

/**
 * Simulación de empresas registradas hoy (25/11/2026) con inicio de
 * operaciones en 2013, 2020 y 2025. Recorre los circuitos contables reales
 * (compra, venta, cobro, nómina, inventario, anticipo, cierre y apertura) con
 * las funciones puras que gobiernan cada asiento, para demostrar que la fecha
 * de registro nunca altera la regla monetaria de la fecha contable.
 */

const companyId = 'empresa-simulada';
const TODAY = '2026-11-25';

const chart: Array<[string, string, AccountType]> = [
  ['1.1.1.01', 'Banco en bolívares', 'ACTIVO'],
  ['1.1.3.01', 'IVA crédito fiscal', 'ACTIVO'],
  ['1.1.4.01', 'Inventario de mercancías', 'ACTIVO'],
  ['1.2.1.01', 'Cuentas por cobrar clientes', 'ACTIVO'],
  ['1.2.3.01', 'Anticipos a proveedores', 'ACTIVO'],
  ['2.1.1.01', 'Cuentas por pagar proveedores', 'PASIVO'],
  ['2.1.2.01', 'IVA débito fiscal por pagar', 'PASIVO'],
  ['2.1.3.01', 'Nómina por pagar', 'PASIVO'],
  ['2.1.3.03', 'Aportes legales por enterar', 'PASIVO'],
  ['2.1.3.04', 'Otras deducciones por pagar', 'PASIVO'],
  ['3.1.1.01', 'Capital social', 'PATRIMONIO'],
  ['3.3.1.01', 'Resultados acumulados', 'PATRIMONIO'],
  ['4.1.1.01', 'Ingresos por ventas', 'INGRESOS'],
  ['4.3.1.01', 'Ganancia cambiaria', 'INGRESOS'],
  ['5.1.1.01', 'Costo de ventas', 'COSTOS'],
  ['6.1.1.01', 'Sueldos y asignaciones', 'GASTOS'],
  ['6.1.1.12', 'Aportes patronales', 'GASTOS'],
  ['6.1.4.01', 'Pérdida cambiaria', 'GASTOS']
];

const accounts: Account[] = chart.map(([code, name, type]) => ({
  code, name, type, level: 5, isMovement: true, isActive: true
}));
const account = (code: string) => accounts.find(item => item.code === code)!;

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
// Igual que convertBsToUsdAmount: se conserva la precisión interna y el redondeo
// queda solo para presentación, evitando falsos descuadres por línea.
const toUsd = (amountBs: number, rate: number) => (rate > 0 ? amountBs / rate : 0);

function line(code: string, debitBs: number, creditBs: number, rate: number): JournalEntryItem {
  const target = account(code);
  return {
    accountCode: target.code, accountName: target.name,
    debitBs: round2(debitBs), creditBs: round2(creditBs),
    debitUsd: toUsd(debitBs, rate), creditUsd: toUsd(creditBs, rate)
  };
}

const totalsOf = (items: JournalEntryItem[]) => items.reduce((sum, item) => ({
  debitBs: sum.debitBs + Number(item.debitBs || 0),
  creditBs: sum.creditBs + Number(item.creditBs || 0),
  debitUsd: sum.debitUsd + Number(item.debitUsd || 0),
  creditUsd: sum.creditUsd + Number(item.creditUsd || 0)
}), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });

function post(
  ledger: JournalEntry[],
  date: string,
  type: JournalEntry['type'],
  description: string,
  rate: number,
  items: JournalEntryItem[]
): JournalEntry {
  validateJournalEntryAccounts(items, accounts);
  const totals = totalsOf(items);
  assert.ok(
    isJournalEntryBalanced(totals),
    `${description}: el asiento no cuadra (Bs ${totals.debitBs}/${totals.creditBs}, USD ${totals.debitUsd}/${totals.creditUsd}).`
  );
  assert.ok(
    isJournalEntryCurrencyPolicySatisfied({ date, bcvRate: rate, debitBs: totals.debitBs, debitUsd: totals.debitUsd }),
    `${description}: la política monetaria de ${date} rechazó el asiento.`
  );
  if (!allowsUsdForOperationDate(date)) {
    assert.equal(rate, 0, `${description}: una operación anterior a 2018 no puede llevar tasa BCV.`);
    assert.equal(totals.debitUsd, 0, `${description}: una operación anterior a 2018 no puede llevar USD.`);
  }
  const entry: JournalEntry = {
    id: `${companyId}-${ledger.length + 1}`,
    companyId,
    entryNumber: ledger.length + 1,
    date, description, type,
    bcvRate: rate,
    items,
    createdAt: `${TODAY}T12:00:00.000Z`
  };
  ledger.push(entry);
  return entry;
}

function simulateCompany(startYear: string, rate: number) {
  const ledger: JournalEntry[] = [];
  const startDate = `${startYear}-01-02`;
  const monetaryRule = getReglaMonetariaPorFecha(startDate);
  assert.equal(monetaryRule.isValidDate, true);
  assert.equal(monetaryRule.requiresBcvRate, allowsUsdForOperationDate(startDate));

  // 1. Aporte de capital: la empresa se registra hoy pero opera desde startYear.
  post(ledger, startDate, 'APERTURA', 'Aporte inicial de capital', rate, [
    line('1.1.1.01', 5_000_000, 0, rate),
    line('3.1.1.01', 0, 5_000_000, rate)
  ]);

  // 2. Compra nacional de mercancía a crédito con IVA 16%.
  const purchaseBase = 1_000_000;
  const purchaseVat = round2(purchaseBase * 0.16);
  post(ledger, `${startYear}-02-10`, 'COMPRA', 'Factura de compra nacional', rate, [
    line('1.1.4.01', purchaseBase, 0, rate),
    line('1.1.3.01', purchaseVat, 0, rate),
    line('2.1.1.01', 0, purchaseBase + purchaseVat, rate)
  ]);

  // 3. Venta de mercancía a crédito con IVA 16%.
  const saleBase = 2_000_000;
  const saleVat = round2(saleBase * 0.16);
  const saleTotal = saleBase + saleVat;
  post(ledger, `${startYear}-03-15`, 'VENTA', 'Factura de venta a crédito', rate, [
    line('1.2.1.01', saleTotal, 0, rate),
    line('4.1.1.01', 0, saleBase, rate),
    line('2.1.2.01', 0, saleVat, rate)
  ]);

  // 4. Cobro de la factura a la misma tasa histórica.
  const collection = buildCreditSettlementJournalItems({
    kind: 'SALE_COLLECTION',
    method: 'BANK_TRANSFER_BS',
    amountBs: saleTotal,
    amountUsd: toUsd(saleTotal, rate),
    invoiceRate: rate,
    settlementRate: rate,
    cashAccount: account('1.1.1.01'),
    controlAccount: account('1.2.1.01'),
    fxGainAccount: account('4.3.1.01'),
    fxLossAccount: account('6.1.4.01')
  });
  post(ledger, `${startYear}-04-20`, 'VENTA', 'Cobro de factura de crédito', rate, collection);

  // 5. Nómina del período (sin equivalencia USD antes de 2018).
  const payrollItems = buildPayrollJournalItems({
    grossEarnings: 500_000,
    workerLegalDeductions: 50_000,
    otherDeductions: 10_000,
    employerContributions: 100_000,
    netPay: 440_000
  }, accounts, rate);
  post(ledger, `${startYear}-05-25`, 'MANUAL', 'Nómina mensual', rate, payrollItems);

  // 6. Inventario: costo promedio ponderado dual y salida PEPS.
  const weighted = calculateWeightedAverageCostDual(0, 0, 0, 10, 100_000, toUsd(100_000, rate));
  assert.equal(weighted.quantity, 10);
  const movementError = validateInventoryMovement({
    date: `${startYear}-06-10`, quantity: 4, bcvRate: rate, unitCostBs: weighted.unitCostBs,
    availableQuantity: weighted.quantity, type: 'SALIDA'
  });
  assert.equal(movementError, null, `El Kardex rechazó una salida válida en ${startYear}.`);
  const fifo = calculateFifoIssue(
    [{ quantity: 10, unitCostBs: 100_000, unitCostUsd: toUsd(100_000, rate), date: `${startYear}-02-10` }],
    4
  );
  assert.equal(fifo.quantity, 4);
  post(ledger, `${startYear}-06-10`, 'INVENTARIO', 'Salida de mercancía por PEPS', rate, [
    line('5.1.1.01', fifo.totalCostBs, 0, rate),
    line('1.1.4.01', 0, fifo.totalCostBs, rate)
  ]);

  // 7. Anticipo a proveedor: este circuito solo existe en moneda extranjera desde 2018.
  if (monetaryRule.allowsUsd) {
    const advanceUsd = 100;
    const settlementValueBs = round2(advanceUsd * rate);
    const advanceBookValueBs = round2(advanceUsd * rate * 0.9);
    const advanceItems = buildSupplierAdvanceSettlementJournalItems({
      kind: 'REFUND_RECEIVED',
      amountUsd: advanceUsd,
      settlementValueBs,
      advanceBookValueBs,
      exchangeDifferenceBs: round2(settlementValueBs - advanceBookValueBs),
      counterpartAccount: account('1.1.1.01'),
      advanceAccount: account('1.2.3.01'),
      fxGainAccount: account('4.3.1.01'),
      fxLossAccount: account('6.1.4.01')
    });
    post(ledger, `${startYear}-07-15`, 'MANUAL', 'Reembolso de anticipo a proveedor', rate, advanceItems);
  }

  return { ledger, rate, startDate };
}

function closeAndOpen(ledger: JournalEntry[], periodStartDate: string, periodEndDate: string, closingRate: number, openingDate: string, openingRate: number) {
  const closingItems = buildClosingEntryItems({
    companyId, periodStartDate, periodEndDate, accounts, journalEntries: ledger,
    retainedEarningsAccountCode: '3.3.1.01'
  });
  post(ledger, periodEndDate, 'CIERRE', 'Cierre del ejercicio ' + periodEndDate.slice(0, 4), closingRate, closingItems);

  const openingItems = buildOpeningEntryItems({
    companyId, periodStartDate, periodEndDate, openingDate, accounts, journalEntries: ledger,
    retainedEarningsAccountCode: '3.3.1.01'
  });
  const opening = post(ledger, openingDate, 'APERTURA', 'Apertura del ejercicio ' + openingDate.slice(0, 4), openingRate, openingItems);
  // El vínculo de ejercicio evita duplicar saldos al preparar la apertura siguiente.
  opening.exerciseLink = { priorPeriodStartDate: periodStartDate, priorPeriodEndDate: periodEndDate, nextPeriodStartDate: openingDate };
}

test('empresa registrada hoy con inicio de operaciones en 2013 asienta todo su ciclo en bolívares fuertes', () => {
  const { ledger } = simulateCompany('2013', 0);
  assert.ok(ledger.length >= 6);
  assert.equal(getReglaMonetariaPorFecha('2013-01-02').eraId, 'BOLIVAR_FUERTE');
  assert.equal(getReglaMonetariaPorFecha('2013-01-02').requiresBcvRate, false);
  assert.equal(formatUsdForDate(1500, '2013-01-02'), '-');
  for (const entry of ledger) {
    assert.equal(entry.bcvRate, 0);
    assert.equal(totalsOf(entry.items).debitUsd, 0);
  }
  closeAndOpen(ledger, '2013-01-01', '2013-12-31', 0, '2014-01-01', 0);
  assert.equal(ledger.at(-1)?.type, 'APERTURA');
  assert.ok(isJournalEntryBalanced(totalsOf(ledger.at(-1)!.items)));
});

test('empresa registrada hoy con inicio de operaciones en 2020 asienta su ciclo en Bs.S y cruza la reconversión de 2021', () => {
  const { ledger } = simulateCompany('2020', 120_000);
  assert.ok(ledger.length >= 7);
  assert.equal(getReglaMonetariaPorFecha('2020-01-02').eraId, 'BOLIVAR_SOBERANO');
  assert.equal(getReglaMonetariaPorFecha('2020-01-02').requiresBcvRate, true);
  assert.notEqual(formatUsdForDate(120_000, '2020-01-02'), '-');

  // Cierre del primer ejercicio y continuación de operaciones en 2021 (Bs.S).
  closeAndOpen(ledger, '2020-01-01', '2020-12-31', 120_000, '2021-01-01', 120_000);
  post(ledger, '2021-09-15', 'VENTA', 'Venta de septiembre 2021', 120_000, [
    line('1.2.1.01', 1_160_000, 0, 120_000),
    line('4.1.1.01', 0, 1_000_000, 120_000),
    line('2.1.2.01', 0, 160_000, 120_000)
  ]);
  // Cierre parcial justo antes de la reconversión del 01/10/2021.
  closeAndOpen(ledger, '2021-01-01', '2021-09-30', 120_000, '2021-10-01', 120_000);

  const opening = ledger.at(-1)!;
  assert.equal(opening.type, 'APERTURA');
  assert.equal(getReglaMonetariaPorFecha(opening.date).eraId, 'BOLIVAR_DIGITAL');
  // El saldo de apertura llega reexpresado a la escala del bolívar digital.
  const openingBs = totalsOf(opening.items).debitBs;
  assert.ok(openingBs > 0 && openingBs < 1_000_000, 'La apertura 2021-10-01 no fue reexpresada a bolívar digital.');
});

test('empresa registrada hoy con inicio de operaciones en 2025 asienta su ciclo completo con tasa BCV obligatoria', () => {
  const { ledger } = simulateCompany('2025', 40);
  assert.ok(ledger.length >= 7);
  assert.equal(getReglaMonetariaPorFecha('2025-01-02').eraId, 'BOLIVAR_DIGITAL');
  for (const entry of ledger) {
    assert.ok(entry.bcvRate > 0, `El asiento ${entry.entryNumber} no conservó tasa BCV.`);
    assert.ok(totalsOf(entry.items).debitUsd > 0);
  }
  closeAndOpen(ledger, '2025-01-01', '2025-12-31', 40, '2026-01-01', 40);
  assert.equal(ledger.at(-1)?.type, 'APERTURA');
});

test('el arrastre de reconversión reexpresa el tramo anterior sin mezclar escalas', () => {
  const carry = buildReconversionCarryForward({
    companyId,
    boundaryDate: '2018-08-20',
    entries: [
      {
        id: '2018-1', companyId, entryNumber: 1, date: '2018-08-19', type: 'APERTURA', bcvRate: 100,
        description: 'Saldo del tramo Bs.F', createdAt: `${TODAY}T12:00:00.000Z`,
        items: [line('1.1.4.01', 3_000_000, 0, 100), line('3.1.1.01', 0, 3_000_000, 100)]
      }
    ]
  });
  assert.equal(carry.fromEraId, 'BOLIVAR_FUERTE');
  assert.equal(carry.toEraId, 'BOLIVAR_SOBERANO');
  assert.equal(carry.isBalanced, true);
  assert.deepEqual(carry.lines.map(item => item.accountCode), ['1.1.4.01', '3.1.1.01']);
  assert.equal(carry.totalDebitBs, '30');
  assert.equal(carry.totalCreditBs, '30');
});
