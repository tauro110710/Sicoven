import type { BankAccount, JournalEntry } from './accounting';
import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import { isValidIsoCalendarDate } from '../utils/isoDateValidation';

/**
 * Disponibilidad de caja y bancos bajo una sola política monetaria.
 *
 * Todo saldo en bolívares se calcula reexpresando cada débito, crédito y saldo
 * inicial desde la fecha contable que le dio origen a la escala vigente en la
 * fecha de consulta. La conversión usa el mecanismo central del sistema
 * (`reexpressAmountBetweenDates`, fronteras 2008-01-01, 2018-08-20 y
 * 2021-10-01, aritmética decimal exacta). Los movimientos en USD nunca se
 * reconvierten: el dólar no cambia de escala.
 *
 * Nunca se suman importes de escalas distintas y una diferencia de redondeo
 * inferior a un centavo no produce un saldo negativo artificial.
 */

type MonetaryLedgerEntry = Pick<JournalEntry, 'companyId' | 'date' | 'items'>;

const assertBalanceDate = (
  date: unknown,
  message = 'La fecha de corte para consultar el saldo no es válida.'
): string => {
  if (!isValidIsoCalendarDate(date)) throw new Error(message);
  return date;
};

const reexpressBs = (amount: number, fromDate: string, toDate: string): number => {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error('El libro contiene un importe en bolívares inválido para calcular disponibilidad.');
  }
  if (amount === 0 || fromDate === toDate) return amount;
  const converted = Number(reexpressAmountBetweenDates(amount, fromDate, toDate));
  if (!Number.isFinite(converted)) {
    throw new Error('La reexpresión monetaria del saldo produjo un importe no válido.');
  }
  return converted;
};

const roundBs = (value: number): number => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  // -0.00 no es un sobregiro: es el residuo de comparar escalas distintas.
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * Reexpresa un importe en bolívares desde su fecha contable a la escala vigente
 * en otra fecha. Es la misma política monetaria central que usan caja y bancos.
 */
export function reexpressBsAmountToDate(amount: number, fromDate: string, toDate: string): number {
  assertBalanceDate(fromDate, 'La fecha contable del movimiento bancario no es válida.');
  assertBalanceDate(toDate, 'La fecha de corte para consultar el saldo no es válida.');
  return roundBs(reexpressBs(Number(amount), fromDate, toDate));
}

/**
 * Saldo de una cuenta contable en bolívares a una fecha de corte, con todas sus
 * líneas reexpresadas a la escala vigente en esa fecha.
 */
export function calculateBsLedgerBalanceAtDate(input: {
  companyId: string;
  accountCode: string;
  asOfDate: string;
  journalEntries: ReadonlyArray<MonetaryLedgerEntry>;
  /** Saldo inicial documentado en la escala de `baselineDate`. */
  baselineBs?: number;
  baselineDate?: string | null;
}): number {
  const asOfDate = assertBalanceDate(input.asOfDate);
  const baselineBs = Number(input.baselineBs ?? 0);
  if (!Number.isFinite(baselineBs) || baselineBs < 0) {
    throw new Error('El saldo inicial en bolívares no es un importe válido.');
  }
  let balance = 0;
  if (baselineBs > 0) {
    const baselineDate = input.baselineDate == null || input.baselineDate === ''
      ? asOfDate
      : assertBalanceDate(input.baselineDate);
    balance += reexpressBs(baselineBs, baselineDate, asOfDate);
  }
  for (const entry of input.journalEntries) {
    if (entry.companyId !== input.companyId) continue;
    if (entry.date > asOfDate) continue;
    if (!isValidIsoCalendarDate(entry.date)) {
      throw new Error('El libro diario contiene un asiento con fecha inválida; no se puede calcular la disponibilidad.');
    }
    for (const item of entry.items) {
      if (item.accountCode !== input.accountCode) continue;
      const debit = Number(item.debitBs || 0);
      const credit = Number(item.creditBs || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new Error('El libro diario contiene importes en bolívares inválidos para la cuenta consultada.');
      }
      balance += reexpressBs(debit, entry.date, asOfDate) - reexpressBs(credit, entry.date, asOfDate);
    }
  }
  return roundBs(balance);
}

/**
 * Fecha que define la escala del saldo inicial de una cuenta bancaria: la
 * apertura declarada, el asiento de apertura, el primer movimiento del auxiliar
 * o, en última instancia, la fecha de consulta (sin conversión).
 */
function resolveBankBaselineDate(input: {
  openingDate?: string | null;
  openingEntryDate?: string | null;
  firstMovementDate?: string | null;
  asOfDate: string;
}): string {
  for (const candidate of [input.openingDate, input.openingEntryDate, input.firstMovementDate]) {
    if (isValidIsoCalendarDate(candidate)) return candidate;
  }
  return input.asOfDate;
}

type BankBalanceInput = {
  bankAccount: BankAccount;
  /** Optional ledger currency for dual-currency presentation; defaults to the account's native currency. */
  currency?: BankAccount['currency'];
  companyId: string;
  asOfDate: string;
  journalEntries: Pick<JournalEntry, 'companyId' | 'date' | 'referenceDoc' | 'items'>[];
};

/**
 * Returns the posted ledger balance available in the requested currency on the
 * given date. Opening balances are read from their opening journal entry when
 * one exists; the stored initial balance is only a compatibility baseline for
 * legacy accounts without that entry and is reexpressed from the account's
 * opening scale.
 */
export function calculateBankAvailableBalance(input: BankBalanceInput): number {
  const { bankAccount, companyId, asOfDate, journalEntries } = input;
  const currency = input.currency || bankAccount.currency;
  assertBalanceDate(asOfDate);

  const openingReference = `APERTURA-${bankAccount.accountNumber}`;
  const accountEntries = journalEntries.filter(entry =>
    entry.companyId === companyId &&
    entry.date <= asOfDate &&
    entry.items.some(item => item.accountCode === bankAccount.accountCode)
  );
  const openingEntry = journalEntries.find(entry =>
    entry.companyId === companyId &&
    entry.date <= asOfDate &&
    entry.referenceDoc === openingReference &&
    entry.items.some(item => item.accountCode === bankAccount.accountCode)
  );
  const firstMovementDate = [...accountEntries]
    .map(entry => entry.date)
    .filter(isValidIsoCalendarDate)
    .sort()[0];

  if (currency === 'USD') {
    const initialBalance = Number(bankAccount.initialBalanceUsd || 0);
    if (!Number.isFinite(initialBalance) || initialBalance < 0) {
      throw new Error('El saldo inicial en USD de la cuenta bancaria no es válido.');
    }
    const ledgerBalance = journalEntries.reduce((balance, entry) => {
      if (entry.companyId !== companyId || entry.date > asOfDate) return balance;
      for (const item of entry.items) {
        if (item.accountCode !== bankAccount.accountCode) continue;
        const debit = Number(item.debitUsd || 0);
        const credit = Number(item.creditUsd || 0);
        if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
          throw new Error('El libro contiene importes USD inválidos para la cuenta bancaria.');
        }
        balance += debit - credit;
      }
      return balance;
    }, openingEntry ? 0 : initialBalance);
    const rounded = Math.round((ledgerBalance + Number.EPSILON) * 1_000_000) / 1_000_000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  const initialBalance = Number(bankAccount.initialBalanceBs || 0);
  if (!Number.isFinite(initialBalance) || initialBalance < 0) {
    throw new Error('El saldo inicial en bolívares de la cuenta bancaria no es válido.');
  }
  return calculateBsLedgerBalanceAtDate({
    companyId,
    accountCode: bankAccount.accountCode,
    asOfDate,
    journalEntries,
    baselineBs: openingEntry ? 0 : initialBalance,
    baselineDate: resolveBankBaselineDate({
      openingDate: bankAccount.openingDate,
      openingEntryDate: openingEntry?.date,
      firstMovementDate,
      asOfDate
    })
  });
}

/** Cash accounts have no BankAccount auxiliary; their availability comes directly from the posted ledger. */
export function calculateCashAccountAvailableBalance(input: {
  companyId: string;
  accountCode: '1.1.1.01' | '1.1.1.02';
  asOfDate: string;
  journalEntries: Pick<JournalEntry, 'companyId' | 'date' | 'items'>[];
}): number {
  const asOfDate = assertBalanceDate(input.asOfDate);
  const currency = input.accountCode === '1.1.1.02' ? 'USD' : 'BS';
  if (currency === 'BS') {
    return calculateBsLedgerBalanceAtDate({
      companyId: input.companyId,
      accountCode: input.accountCode,
      asOfDate,
      journalEntries: input.journalEntries
    });
  }
  const balance = input.journalEntries.reduce((total, entry) => {
    if (entry.companyId !== input.companyId || entry.date > asOfDate) return total;
    for (const item of entry.items) {
      if (item.accountCode !== input.accountCode) continue;
      const debit = Number(item.debitUsd || 0);
      const credit = Number(item.creditUsd || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
        throw new Error('El libro contiene importes USD inválidos para la caja.');
      }
      total += debit - credit;
    }
    return total;
  }, 0);
  const rounded = Math.round((balance + Number.EPSILON) * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Rejects an outgoing bank movement when it exceeds the posted balance at its effective date. */
export function validateBankOutgoingAvailability(input: {
  availableBalance: number;
  requestedAmount: number;
  currency: BankAccount['currency'];
}): void {
  const decimals = input.currency === 'USD' ? 6 : 2;
  const scale = 10 ** decimals;
  const available = Math.round(Number(input.availableBalance) * scale) / scale;
  const requested = Math.round(Number(input.requestedAmount) * scale) / scale;
  if (!Number.isFinite(available) || !Number.isFinite(requested) || requested <= 0) {
    throw new Error('No se pudo validar el saldo disponible de la cuenta bancaria.');
  }
  if (available < 0 || requested > available) {
    const currencyLabel = input.currency === 'USD' ? 'USD' : 'Bs.';
    throw new Error(`Saldo bancario insuficiente. Disponible: ${available.toFixed(decimals)} ${currencyLabel}; solicitado: ${requested.toFixed(decimals)} ${currencyLabel}. No se registró el egreso ni la transferencia.`);
  }
}

export type CashOutgoingPlanItem = { accountCode: '1.1.1.01' | '1.1.1.02'; currency: 'BS' | 'USD'; amount: number };

/** Net cash withdrawals by cash ledger account, avoiding false locks for same-account compensating lines. */
export function buildCashOutgoingPlan(items: Pick<JournalEntry['items'][number], 'accountCode' | 'debitBs' | 'creditBs' | 'debitUsd' | 'creditUsd'>[]): CashOutgoingPlanItem[] {
  const plan: CashOutgoingPlanItem[] = [];
  for (const accountCode of ['1.1.1.01', '1.1.1.02'] as const) {
    const currency = accountCode === '1.1.1.02' ? 'USD' : 'BS';
    const decimals = currency === 'USD' ? 6 : 2;
    const scale = 10 ** decimals;
    const net = items.filter(item => item.accountCode === accountCode).reduce((sum, item) => {
      const debit = Number(currency === 'USD' ? item.debitUsd || 0 : item.debitBs || 0);
      const credit = Number(currency === 'USD' ? item.creditUsd || 0 : item.creditBs || 0);
      if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) throw new Error('El asiento contiene importes de caja inválidos.');
      return sum + credit - debit;
    }, 0);
    const amount = Math.round(net * scale) / scale;
    if (amount > 0) plan.push({ accountCode, currency, amount });
  }
  return plan;
}
