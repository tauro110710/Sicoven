import type { Account, JournalEntry, JournalEntryItem } from './accounting';
import { isJournalEntryBalanced } from './journalEntryValidation';

export interface ClosingEntryBuildInput {
  companyId: string;
  periodStartDate: string;
  periodEndDate: string;
  accounts: Account[];
  journalEntries: JournalEntry[];
  retainedEarningsAccountCode?: string;
}

type Totals = { debitBs: number; creditBs: number; debitUsd: number; creditUsd: number };
const emptyTotals = (): Totals => ({ debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
const roundBs = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const roundUsd = (value: number) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Builds the year-end closing journal lines; persistence and posting are handled by AccountingContext. */
export function buildClosingEntryItems(input: ClosingEntryBuildInput): JournalEntryItem[] {
  const { companyId, periodStartDate, periodEndDate, accounts, journalEntries } = input;
  if (!String(companyId || '').trim()) throw new Error('Debe indicar la empresa del ejercicio.');
  if (!isIsoDate(periodStartDate) || !isIsoDate(periodEndDate) || periodStartDate > periodEndDate) {
    throw new Error('El período del cierre anual contiene fechas inválidas.');
  }

  const accountByCode = new Map<string, Account>();
  for (const account of accounts) {
    if (accountByCode.has(account.code)) throw new Error('El catálogo contiene códigos de cuenta duplicados.');
    accountByCode.set(account.code, account);
  }

  const companyEntries = journalEntries.filter(entry => entry.companyId === companyId);
  for (const entry of companyEntries) {
    if (!isIsoDate(entry.date)) {
      throw new Error('El asiento #' + entry.entryNumber + ' contiene una fecha inválida; no se puede cerrar el ejercicio.');
    }
  }
  if (companyEntries.some(entry => entry.type === 'CIERRE' && entry.date === periodEndDate)) {
    throw new Error('Ya existe un asiento de cierre para este ejercicio. No se permite duplicarlo.');
  }

  const periodEntries = companyEntries.filter(entry =>
    entry.date >= periodStartDate && entry.date <= periodEndDate
  );
  if (!periodEntries.length) throw new Error('No existen movimientos contables en el ejercicio que se intenta cerrar.');

  const nominalBalances = new Map<string, Totals>();
  let resultBs = 0;
  let resultUsd = 0;

  for (const entry of periodEntries) {
    if (!Array.isArray(entry.items) || entry.items.length < 2) {
      throw new Error('El asiento #' + entry.entryNumber + ' no contiene líneas contables suficientes.');
    }
    const totals = emptyTotals();
    for (const line of entry.items) {
      const account = accountByCode.get(line.accountCode);
      if (!account || !account.isMovement) {
        throw new Error('El asiento #' + entry.entryNumber + ' utiliza una cuenta inexistente o no imputable: ' + line.accountCode + '.');
      }
      const values = [line.debitBs, line.creditBs, line.debitUsd, line.creditUsd].map(Number);
      if (values.some(value => !Number.isFinite(value) || value < 0) ||
          (Number(line.debitBs) > 0 && Number(line.creditBs) > 0) ||
          (Number(line.debitUsd) > 0 && Number(line.creditUsd) > 0)) {
        throw new Error('El asiento #' + entry.entryNumber + ' contiene importes inválidos.');
      }
      totals.debitBs += Number(line.debitBs);
      totals.creditBs += Number(line.creditBs);
      totals.debitUsd += Number(line.debitUsd);
      totals.creditUsd += Number(line.creditUsd);

      if (['INGRESOS', 'COSTOS', 'GASTOS'].includes(account.type)) {
        const current = nominalBalances.get(account.code) || emptyTotals();
        current.debitBs += Number(line.debitBs);
        current.creditBs += Number(line.creditBs);
        current.debitUsd += Number(line.debitUsd);
        current.creditUsd += Number(line.creditUsd);
        nominalBalances.set(account.code, current);
        // Result = income - costs - expenses, with each account's natural balance.
        const sign = account.type === 'INGRESOS' ? 1 : -1;
        resultBs += sign * (Number(line.creditBs) - Number(line.debitBs));
        resultUsd += sign * (Number(line.creditUsd) - Number(line.debitUsd));
      }
    }
    if (!isJournalEntryBalanced(totals)) {
      throw new Error('El asiento #' + entry.entryNumber + ' no cuadra en Bs. y USD; no se puede cerrar el ejercicio.');
    }
  }

  const items: JournalEntryItem[] = [];
  for (const [code, totals] of nominalBalances) {
    const account = accountByCode.get(code)!;
    const netBs = roundBs(totals.debitBs - totals.creditBs);
    const netUsd = roundUsd(totals.debitUsd - totals.creditUsd);
    const debitBs = roundBs(Math.max(0, netBs));
    const creditBs = roundBs(Math.max(0, -netBs));
    const debitUsd = roundUsd(Math.max(0, netUsd));
    const creditUsd = roundUsd(Math.max(0, -netUsd));
    if (debitBs || creditBs || debitUsd || creditUsd) {
      items.push({
        accountCode: code, accountName: account.name,
        debitBs, creditBs, debitUsd, creditUsd,
        description: 'Cancelación de saldo nominal al cierre del ejercicio ' + periodEndDate.slice(0, 4)
      });
    }
  }

  const netResultBs = roundBs(resultBs);
  const netResultUsd = roundUsd(resultUsd);
  if (Math.abs(netResultBs) > 0.01 || Math.abs(netResultUsd) > 0.000001) {
    const retained = input.retainedEarningsAccountCode
      ? accountByCode.get(input.retainedEarningsAccountCode)
      : undefined;
    if (!retained || retained.type !== 'PATRIMONIO' || !retained.isMovement || retained.isActive === false) {
      throw new Error('Seleccione una cuenta imputable y activa de patrimonio para trasladar el resultado del ejercicio.');
    }
    items.push({
      accountCode: retained.code, accountName: retained.name,
      debitBs: roundBs(Math.max(0, -netResultBs)),
      creditBs: roundBs(Math.max(0, netResultBs)),
      debitUsd: roundUsd(Math.max(0, -netResultUsd)),
      creditUsd: roundUsd(Math.max(0, netResultUsd)),
      description: 'Traslado del resultado del ejercicio a resultados acumulados'
    });
  }

  if (items.length < 2) throw new Error('El ejercicio no contiene saldos nominales suficientes para generar un asiento de cierre.');
  const total = items.reduce((sum, item) => ({
    debitBs: sum.debitBs + item.debitBs, creditBs: sum.creditBs + item.creditBs,
    debitUsd: sum.debitUsd + item.debitUsd, creditUsd: sum.creditUsd + item.creditUsd
  }), emptyTotals());
  if (!isJournalEntryBalanced(total)) {
    throw new Error('El asiento de cierre no cuadra en ambas monedas. Revise el balance y las diferencias históricas antes de cerrar.');
  }
  return items;
}
