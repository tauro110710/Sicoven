import type { BankAccount, JournalEntry } from './accounting';

type BankBalanceInput = {
  bankAccount: BankAccount;
  /** Optional ledger currency for dual-currency presentation; defaults to the account's native currency. */
  currency?: BankAccount['currency'];
  companyId: string;
  asOfDate: string;
  journalEntries: Pick<JournalEntry, 'companyId' | 'date' | 'referenceDoc' | 'items'>[];
};

/**
 * Returns the posted ledger balance available in the bank account's own
 * currency on the requested date. Opening balances are read from their
 * opening journal entry when one exists; the stored initial balance is only
 * a compatibility baseline for legacy accounts without that entry.
 */
export function calculateBankAvailableBalance(input: BankBalanceInput): number {
  const { bankAccount, companyId, asOfDate, journalEntries } = input;
  const currency = input.currency || bankAccount.currency;
  const parsedDate = new Date(String(asOfDate || '') + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOfDate || '')) ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== asOfDate) {
    throw new Error('La fecha de corte para consultar el saldo bancario no es válida.');
  }

  const openingReference = `APERTURA-${bankAccount.accountNumber}`;
  const hasOpeningEntry = journalEntries.some(entry =>
    entry.companyId === companyId &&
    entry.date <= asOfDate &&
    entry.referenceDoc === openingReference &&
    entry.items.some(item => {
      if (item.accountCode !== bankAccount.accountCode) return false;
      const debit = currency === 'USD' ? Number(item.debitUsd || 0) : Number(item.debitBs || 0);
      const credit = currency === 'USD' ? Number(item.creditUsd || 0) : Number(item.creditBs || 0);
      return Number.isFinite(debit) && Number.isFinite(credit) && (debit !== 0 || credit !== 0);
    })
  );
  const initialBalance = currency === 'USD'
    ? Number(bankAccount.initialBalanceUsd || 0)
    : Number(bankAccount.initialBalanceBs || 0);
  const baseline = hasOpeningEntry ? 0 : initialBalance;
  const decimals = currency === 'USD' ? 6 : 2;
  const scale = 10 ** decimals;

  const ledgerBalance = journalEntries.reduce((balance, entry) => {
    if (entry.companyId !== companyId || entry.date > asOfDate) return balance;
    for (const item of entry.items) {
      if (item.accountCode !== bankAccount.accountCode) continue;
      const debit = currency === 'USD' ? Number(item.debitUsd || 0) : Number(item.debitBs || 0);
      const credit = currency === 'USD' ? Number(item.creditUsd || 0) : Number(item.creditBs || 0);
      balance += debit - credit;
    }
    return balance;
  }, baseline);

  return Math.round(ledgerBalance * scale) / scale;
}

/** Cash accounts have no BankAccount auxiliary; their availability comes directly from the posted ledger. */
export function calculateCashAccountAvailableBalance(input: {
  companyId: string;
  accountCode: '1.1.1.01' | '1.1.1.02';
  asOfDate: string;
  journalEntries: Pick<JournalEntry, 'companyId' | 'date' | 'items'>[];
}): number {
  const parsedDate = new Date(String(input.asOfDate || '') + 'T00:00:00.000Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.asOfDate || '')) ||
      !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== input.asOfDate) {
    throw new Error('La fecha de corte para consultar el saldo de caja no es válida.');
  }
  const currency = input.accountCode === '1.1.1.02' ? 'USD' : 'BS';
  const decimals = currency === 'USD' ? 6 : 2;
  const scale = 10 ** decimals;
  const balance = input.journalEntries.reduce((total, entry) => {
    if (entry.companyId !== input.companyId || entry.date > input.asOfDate) return total;
    for (const item of entry.items) {
      if (item.accountCode !== input.accountCode) continue;
      total += currency === 'USD'
        ? Number(item.debitUsd || 0) - Number(item.creditUsd || 0)
        : Number(item.debitBs || 0) - Number(item.creditBs || 0);
    }
    return total;
  }, 0);
  return Math.round(balance * scale) / scale;
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
