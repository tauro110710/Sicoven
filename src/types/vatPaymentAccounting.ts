import type { Account, BankAccount, BankStatementMovement, JournalEntryItem } from './accounting';
import { isValidIsoDate } from './migrationParsing';

export interface VatPaymentAccountingPlan {
  date: string;
  amountBs: number;
  amountUsd: number;
  bcvRate: number;
  items: JournalEntryItem[];
}

/**
 * Builds the double-currency accounting lines from the historical bank movements.
 * It deliberately does not consult the current BCV rate.
 */
export function buildVatPaymentAccountingPlan(input: {
  occurredAt: string;
  movements: BankStatementMovement[];
  bankAccounts: BankAccount[];
  accounts: Account[];
}): VatPaymentAccountingPlan {
  const date = String(input.occurredAt || '').slice(0, 10);
  if (!isValidIsoDate(date)) {
    throw new Error('La fecha del enteramiento no es válida para el asiento contable.');
  }
  if (!input.movements.length) throw new Error('El enteramiento requiere débitos bancarios vinculados.');
  const liability = input.accounts.find(account => account.code === '2.1.2.03' && account.type === 'PASIVO' && account.isMovement);
  if (!liability) throw new Error('No está disponible la cuenta de movimiento 2.1.2.03 para retenciones de IVA por enterar.');
  const grouped = new Map<string, { account: BankAccount; amountBs: number; amountUsd: number }>();
  for (const movement of input.movements) {
    if (movement.type !== 'DEBIT') throw new Error('Solo los débitos bancarios pueden respaldar el enteramiento de IVA.');
    const bank = input.bankAccounts.find(account =>
      account.id === movement.bankAccountId && account.companyId === movement.companyId);
    if (!bank || bank.currency !== 'BS') throw new Error('La contrapartida bancaria del enteramiento debe ser una cuenta en bolívares.');
    const account = input.accounts.find(item => item.code === bank.accountCode && item.type === 'ACTIVO' && item.isMovement);
    if (!account) throw new Error('La cuenta contable bancaria ' + bank.accountCode + ' no existe o no acepta movimientos.');
    const bs = Number(movement.amountBs);
    const usd = Number(movement.amountUsd);
    if (!Number.isFinite(bs) || bs <= 0 || !Number.isFinite(usd) || usd <= 0) {
      throw new Error('El débito bancario ' + movement.reference + ' no tiene equivalentes históricos positivos en Bs. y USD.');
    }
    const current = grouped.get(bank.accountCode) || { account: bank, amountBs: 0, amountUsd: 0 };
    current.amountBs += bs;
    current.amountUsd += usd;
    grouped.set(bank.accountCode, current);
  }
  const amountBs = Math.round([...grouped.values()].reduce((sum, item) => sum + item.amountBs, 0) * 100) / 100;
  const amountUsd = Math.round([...grouped.values()].reduce((sum, item) => sum + item.amountUsd, 0) * 1000000) / 1000000;
  if (amountBs <= 0 || amountUsd <= 0) throw new Error('El importe histórico del enteramiento no permite generar un asiento en doble moneda.');
  const items: JournalEntryItem[] = [{
    accountCode: liability.code, accountName: liability.name,
    debitBs: amountBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0,
    description: 'Cancelación de retenciones de IVA enteradas al SENIAT'
  }];
  for (const [code, group] of grouped) {
    const account = input.accounts.find(item => item.code === code)!;
    const bs = Math.round(group.amountBs * 100) / 100;
    const usd = Math.round(group.amountUsd * 1000000) / 1000000;
    items.push({
      accountCode: account.code, accountName: account.name,
      debitBs: 0, creditBs: bs, debitUsd: 0, creditUsd: usd,
      description: 'Débito bancario ' + group.account.bankName + ' · ' + group.account.accountNumber
    });
  }
  const bcvRate = amountBs / amountUsd;
  const debitBs = items.reduce((sum, item) => sum + item.debitBs, 0);
  const creditBs = items.reduce((sum, item) => sum + item.creditBs, 0);
  const debitUsd = items.reduce((sum, item) => sum + item.debitUsd, 0);
  const creditUsd = items.reduce((sum, item) => sum + item.creditUsd, 0);
  if (Math.abs(debitBs - creditBs) >= 0.01 || Math.abs(debitUsd - creditUsd) >= 0.000001) {
    throw new Error('Los débitos bancarios no permiten construir un asiento equilibrado en ambas monedas.');
  }
  return { date, amountBs, amountUsd, bcvRate, items };
}

