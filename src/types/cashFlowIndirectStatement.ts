import type { Account, BankAccount, JournalEntry } from './accounting';
import { buildCashFlowReport, type CashFlowReport } from './cashFlowStatement';
import { reexpressReportAmount, roundReportCents, roundReportMicroUsd } from './reportMonetaryReexpression';

export type CashFlowIndirectTreatment =
  | 'NON_CASH_EXPENSE_ADD_BACK'
  | 'NON_CASH_INCOME_DEDUCT'
  | 'OPERATING_ASSET_INCREASE_DEDUCT'
  | 'OPERATING_LIABILITY_INCREASE_ADD'
  | 'EXCLUDE';

export interface CashFlowIndirectAdjustment {
  accountCode: string;
  accountName: string;
  treatment: CashFlowIndirectTreatment;
  openingBalanceBs: number;
  closingBalanceBs: number;
  changeBs: number;
  adjustmentBs: number;
  openingBalanceUsd: number;
  closingBalanceUsd: number;
  changeUsd: number;
  adjustmentUsd: number;
}

export interface CashFlowIndirectReport {
  year: number;
  netIncomeBs: number;
  netIncomeUsd: number;
  nonCashAdjustmentsBs: number;
  nonCashAdjustmentsUsd: number;
  workingCapitalAdjustmentsBs: number;
  workingCapitalAdjustmentsUsd: number;
  operatingCashFlowBs: number;
  operatingCashFlowUsd: number;
  investingCashFlowBs: number;
  investingCashFlowUsd: number;
  financingCashFlowBs: number;
  financingCashFlowUsd: number;
  netChangeBs: number;
  netChangeUsd: number;
  openingCashBs: number;
  openingCashUsd: number;
  closingCashBs: number;
  closingCashUsd: number;
  ledgerClosingCashBs: number;
  ledgerClosingCashUsd: number;
  reconciliationDifferenceBs: number;
  reconciliationDifferenceUsd: number;
  /** Redondeo de presentación descontado en la conciliación (por cuenta y agregación). */
  roundingDifferenceBs: number;
  roundingDifferenceUsd: number;
  /** Diferencia de conciliación neta del redondeo por cuenta: es la que evalúa `isReconciled`. */
  reconciliationResidualBs: number;
  reconciliationResidualUsd: number;
  isReconciled: boolean;
  isFullyClassified: boolean;
  adjustments: CashFlowIndirectAdjustment[];
  directBasis: CashFlowReport;
}

const finite = (value: unknown): number => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) {
    throw new Error('El Estado de Flujos de Efectivo no puede calcularse: existe un importe no finito en un movimiento contable.');
  }
  return n;
};
const round = (value: number, places: number) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const isLinkedAnnualOpening = (entry: JournalEntry) =>
  entry.type === 'APERTURA' && entry.exerciseLink?.nextPeriodStartDate === entry.date;
const isExcludedFromIncome = (entry: JournalEntry) => entry.type === 'APERTURA' || entry.type === 'CIERRE';
// Cada línea en Bs. se reexpresa a la escala del reporte antes de acumular;
// el USD de origen se conserva sin conversiones cruzadas.
const balanceMovement = (
  entry: JournalEntry,
  code: string,
  normal: 'DEBIT' | 'CREDIT',
  reportScaleDate: string
) =>
  entry.items.filter(item => item.accountCode === code).reduce((sum, item) => ({
    bs: sum.bs + (normal === 'DEBIT'
      ? reexpressReportAmount(item.debitBs, entry.date, reportScaleDate) -
        reexpressReportAmount(item.creditBs, entry.date, reportScaleDate)
      : reexpressReportAmount(item.creditBs, entry.date, reportScaleDate) -
        reexpressReportAmount(item.debitBs, entry.date, reportScaleDate)),
    usd: sum.usd + (normal === 'DEBIT'
      ? finite(item.debitUsd) - finite(item.creditUsd)
      : finite(item.creditUsd) - finite(item.debitUsd))
  }), { bs: 0, usd: 0 });

/**
 * Indirect cash flow. Every non-cash adjustment and working-capital account must
 * carry an explicit account-level treatment. Unknown accounts are never guessed.
 * Investing and financing sections reuse the verified direct-method cash movements;
 * operating cash flow is independently reconstructed from profit and balance changes.
 */
export function buildCashFlowIndirectReport(
  entries: JournalEntry[],
  accounts: Account[],
  bankAccounts: BankAccount[],
  companyId: string,
  year: number
): CashFlowIndirectReport {
  if (!companyId.trim() || !Number.isInteger(year) || year < 1) {
    throw new Error('La empresa y el ejercicio seleccionado deben ser válidos.');
  }
  const end = String(year).padStart(4, '0') + '-12-31';
  for (const entry of entries) {
    if (entry.companyId !== companyId || entry.date > end) continue;
    for (const item of entry.items) {
      finite(item.debitBs);
      finite(item.creditBs);
      finite(item.debitUsd);
      finite(item.creditUsd);
    }
  }
  const direct = buildCashFlowReport(entries, accounts, bankAccounts, companyId, year);
  const start = String(year).padStart(4, '0') + '-01-01';
  const companyEntries = entries.filter(entry =>
    entry.companyId === companyId && /^\d{4}-\d{2}-\d{2}$/.test(entry.date) && entry.date <= end
  );
  const reversedEntryIds = new Set(companyEntries
    .filter(entry => entry.reversalOfEntryId && entry.date < start)
    .map(entry => entry.reversalOfEntryId as string));
  // Carry forward from the latest linked annual opening at or before the
  // selected year's start, including movements posted after that opening.
  const openingBoundary = companyEntries.filter(entry =>
    isLinkedAnnualOpening(entry) && entry.date <= start && !reversedEntryIds.has(entry.id)
  ).sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber).at(-1);
  const priorEntries = companyEntries.filter(entry => entry.date < start);
  const openingBasis = openingBoundary
    ? [openingBoundary, ...companyEntries.filter(entry =>
        entry.date > openingBoundary.date && entry.date < start)]
    : priorEntries;
  const periodEntries = companyEntries.filter(entry =>
    entry.date >= start && entry.date <= end && !isExcludedFromIncome(entry)
  );
  const accountRows: CashFlowIndirectAdjustment[] = [];
  let netIncomeBs = 0;
  let netIncomeUsd = 0;
  // Totales sin redondeo por cuenta: la conciliación se mide contra esta
  // reconstrucción "cruda" para que el redondeo (resultado neto, ajustes y
  // agregación) no genere un descuadre ficticio. El resultado reportado sigue
  // redondeado por cuenta para coincidir con el asiento de cierre.
  let rawNetIncomeBs = 0;
  let rawNetIncomeUsd = 0;
  for (const account of accounts.filter(item => item.isMovement)) {
    if (account.type === 'INGRESOS' || account.type === 'COSTOS' || account.type === 'GASTOS') {
      const movement = periodEntries.reduce((sum, entry) => {
        const value = balanceMovement(entry, account.code, account.type === 'INGRESOS' ? 'CREDIT' : 'DEBIT', end);
        return { bs: sum.bs + value.bs, usd: sum.usd + value.usd };
      }, { bs: 0, usd: 0 });
      const sign = account.type === 'INGRESOS' ? 1 : -1;
      rawNetIncomeBs += movement.bs * sign;
      rawNetIncomeUsd += movement.usd * sign;
      netIncomeBs += roundReportCents(movement.bs) * sign;
      netIncomeUsd += roundReportMicroUsd(movement.usd) * sign;
    }
  }

  const isTreatmentCompatible = (account: Account) => {
    const treatment = account.cashFlowIndirectTreatment;
    if (!treatment || treatment === 'EXCLUDE') return true;
    if (treatment === 'NON_CASH_EXPENSE_ADD_BACK') return account.type === 'COSTOS' || account.type === 'GASTOS';
    if (treatment === 'NON_CASH_INCOME_DEDUCT') return account.type === 'INGRESOS';
    if (treatment === 'OPERATING_ASSET_INCREASE_DEDUCT') return account.type === 'ACTIVO';
    if (treatment === 'OPERATING_LIABILITY_INCREASE_ADD') return account.type === 'PASIVO';
    return false;
  };
  const invalidTreatments = accounts.some(account =>
    account.cashFlowIndirectTreatment !== undefined && !isTreatmentCompatible(account)
  );
  const classifiedAccounts = accounts.filter(account =>
    account.isMovement && account.cashFlowIndirectTreatment &&
    account.cashFlowIndirectTreatment !== 'EXCLUDE' && isTreatmentCompatible(account)
  );
  let rawNonCashAdjustmentsBs = 0;
  let rawNonCashAdjustmentsUsd = 0;
  let rawWorkingCapitalAdjustmentsBs = 0;
  let rawWorkingCapitalAdjustmentsUsd = 0;
  for (const account of classifiedAccounts) {
    const treatment = account.cashFlowIndirectTreatment!;
    const normal = account.type === 'PASIVO' || account.type === 'PATRIMONIO' ? 'CREDIT' : 'DEBIT';
    const opening = openingBasis.reduce((sum, entry) => {
      const value = balanceMovement(entry, account.code, normal, end);
      return { bs: sum.bs + value.bs, usd: sum.usd + value.usd };
    }, { bs: 0, usd: 0 });
    const periodChange = periodEntries.reduce((sum, entry) => {
      const value = balanceMovement(entry, account.code, normal, end);
      return { bs: sum.bs + value.bs, usd: sum.usd + value.usd };
    }, { bs: 0, usd: 0 });
    const closing = { bs: opening.bs + periodChange.bs, usd: opening.usd + periodChange.usd };
    const sign = treatment === 'NON_CASH_INCOME_DEDUCT' || treatment === 'OPERATING_ASSET_INCREASE_DEDUCT' ? -1 : 1;
    const adjustmentBs = periodChange.bs * sign;
    const adjustmentUsd = periodChange.usd * sign;
    if (treatment === 'NON_CASH_EXPENSE_ADD_BACK' || treatment === 'NON_CASH_INCOME_DEDUCT') {
      rawNonCashAdjustmentsBs += adjustmentBs;
      rawNonCashAdjustmentsUsd += adjustmentUsd;
    } else {
      rawWorkingCapitalAdjustmentsBs += adjustmentBs;
      rawWorkingCapitalAdjustmentsUsd += adjustmentUsd;
    }
    accountRows.push({
      accountCode: account.code, accountName: account.name, treatment,
      openingBalanceBs: round(opening.bs, 2), closingBalanceBs: round(closing.bs, 2),
      changeBs: round(periodChange.bs, 2), adjustmentBs: round(adjustmentBs, 2),
      openingBalanceUsd: round(opening.usd, 6), closingBalanceUsd: round(closing.usd, 6),
      changeUsd: round(periodChange.usd, 6), adjustmentUsd: round(adjustmentUsd, 6)
    });
  }

  const nonCash = accountRows.filter(row =>
    row.treatment === 'NON_CASH_EXPENSE_ADD_BACK' || row.treatment === 'NON_CASH_INCOME_DEDUCT'
  );
  const workingCapital = accountRows.filter(row =>
    row.treatment === 'OPERATING_ASSET_INCREASE_DEDUCT' || row.treatment === 'OPERATING_LIABILITY_INCREASE_ADD'
  );
  const nonCashAdjustmentsBs = nonCash.reduce((sum, row) => sum + row.adjustmentBs, 0);
  const nonCashAdjustmentsUsd = nonCash.reduce((sum, row) => sum + row.adjustmentUsd, 0);
  const workingCapitalAdjustmentsBs = workingCapital.reduce((sum, row) => sum + row.adjustmentBs, 0);
  const workingCapitalAdjustmentsUsd = workingCapital.reduce((sum, row) => sum + row.adjustmentUsd, 0);
  const operatingCashFlowBs = round(netIncomeBs + nonCashAdjustmentsBs + workingCapitalAdjustmentsBs, 2);
  const operatingCashFlowUsd = round(netIncomeUsd + nonCashAdjustmentsUsd + workingCapitalAdjustmentsUsd, 6);
  const investingCashFlowBs = direct.activities.INVERSION.netBs;
  const investingCashFlowUsd = direct.activities.INVERSION.netUsd;
  const financingCashFlowBs = direct.activities.FINANCIACION.netBs;
  const financingCashFlowUsd = direct.activities.FINANCIACION.netUsd;
  const netChangeBs = round(operatingCashFlowBs + investingCashFlowBs + financingCashFlowBs, 2);
  const netChangeUsd = round(operatingCashFlowUsd + investingCashFlowUsd + financingCashFlowUsd, 6);
  const reconciliationDifferenceBs = round(direct.ledgerClosingCashBs - (direct.openingCashBs + netChangeBs), 2);
  const reconciliationDifferenceUsd = round(direct.ledgerClosingCashUsd - (direct.openingCashUsd + netChangeUsd), 6);
  // Residuo real: compara el libro contra la reconstrucción indirecta sin
  // redondeos por cuenta ni de agregación. La diferencia visible entre ambos
  // es redondeo de presentación, no descuadre.
  const rawOperatingBs = rawNetIncomeBs + rawNonCashAdjustmentsBs + rawWorkingCapitalAdjustmentsBs;
  const rawOperatingUsd = rawNetIncomeUsd + rawNonCashAdjustmentsUsd + rawWorkingCapitalAdjustmentsUsd;
  const rawNetChangeBs = rawOperatingBs + investingCashFlowBs + financingCashFlowBs;
  const rawNetChangeUsd = rawOperatingUsd + investingCashFlowUsd + financingCashFlowUsd;
  const reconciliationResidualBs = round(direct.ledgerClosingCashBs - (direct.openingCashBs + rawNetChangeBs), 2);
  const reconciliationResidualUsd = round(direct.ledgerClosingCashUsd - (direct.openingCashUsd + rawNetChangeUsd), 6);
  const roundingDifferenceBs = round(reconciliationDifferenceBs - reconciliationResidualBs, 2);
  const roundingDifferenceUsd = round(reconciliationDifferenceUsd - reconciliationResidualUsd, 6);
  const unclassifiedPnl = accounts.some(account =>
    account.isMovement && ['INGRESOS', 'COSTOS', 'GASTOS'].includes(account.type) &&
    periodEntries.some(entry => entry.items.some(item => item.accountCode === account.code)) &&
    account.cashFlowActivity !== 'OPERACION' && !(
      (account.type === 'INGRESOS' && account.cashFlowIndirectTreatment === 'NON_CASH_INCOME_DEDUCT') ||
      (['COSTOS', 'GASTOS'].includes(account.type) && account.cashFlowIndirectTreatment === 'NON_CASH_EXPENSE_ADD_BACK')
    )
  );
  const unclassifiedBalanceChanges = accounts.some(account =>
    account.isMovement && ['ACTIVO', 'PASIVO'].includes(account.type) &&
    !account.code.startsWith('1.1.1.') && account.cashFlowActivity !== 'EFECTIVO_EQUIVALENTE' &&
    account.cashFlowActivity !== 'INVERSION' && account.cashFlowActivity !== 'FINANCIACION' &&
    periodEntries.some(entry => entry.items.some(item => item.accountCode === account.code)) &&
    (!account.cashFlowIndirectTreatment || !isTreatmentCompatible(account))
  );
  const isFullyClassified = direct.isFullyClassified && !unclassifiedPnl && !unclassifiedBalanceChanges && !invalidTreatments;
  return {
    year, netIncomeBs: round(netIncomeBs, 2), netIncomeUsd: round(netIncomeUsd, 6),
    nonCashAdjustmentsBs: round(nonCashAdjustmentsBs, 2), nonCashAdjustmentsUsd: round(nonCashAdjustmentsUsd, 6),
    workingCapitalAdjustmentsBs: round(workingCapitalAdjustmentsBs, 2), workingCapitalAdjustmentsUsd: round(workingCapitalAdjustmentsUsd, 6),
    operatingCashFlowBs, operatingCashFlowUsd, investingCashFlowBs, investingCashFlowUsd,
    financingCashFlowBs, financingCashFlowUsd, netChangeBs, netChangeUsd,
    openingCashBs: direct.openingCashBs, openingCashUsd: direct.openingCashUsd,
    closingCashBs: round(direct.openingCashBs + netChangeBs, 2),
    closingCashUsd: round(direct.openingCashUsd + netChangeUsd, 6),
    ledgerClosingCashBs: direct.ledgerClosingCashBs, ledgerClosingCashUsd: direct.ledgerClosingCashUsd,
    reconciliationDifferenceBs, reconciliationDifferenceUsd,
    roundingDifferenceBs, roundingDifferenceUsd,
    reconciliationResidualBs, reconciliationResidualUsd,
    // La conciliación se mide contra la reconstrucción sin redondeos; un error
    // real de clasificación o de integración sigue superando la tolerancia.
    isReconciled: Math.abs(reconciliationResidualBs) <= 0.05 &&
      Math.abs(reconciliationResidualUsd) <= 0.000005,
    isFullyClassified, adjustments: accountRows, directBasis: direct
  };
}
