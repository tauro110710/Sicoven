import type { JournalEntryItem } from '../types/accounting';

export interface PayrollPostingTotals {
  grossEarnings: number;
  workerLegalDeductions: number;
  otherDeductions: number;
  employerContributions: number;
  netPay: number;
}

type PayrollPostingAccount = { code: string; name: string; type: string; isMovement: boolean };

const roundMoney = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

export function buildPayrollJournalItems(
  totals: PayrollPostingTotals,
  accounts: PayrollPostingAccount[],
  bcvRate: number
): JournalEntryItem[] {
  if (!Number.isFinite(bcvRate) || bcvRate <= 0) throw new Error('La tasa BCV debe ser mayor que cero.');
  const values = Object.entries(totals);
  if (values.some(([, value]) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
    throw new Error('La nómina contiene totales inválidos.');
  }
  const rows = [
    { code: '6.1.1.01', type: 'GASTOS', debit: Number(totals.grossEarnings), credit: 0, description: 'Sueldos y asignaciones de nómina' },
    { code: '6.1.1.12', type: 'GASTOS', debit: Number(totals.employerContributions), credit: 0, description: 'Aportes patronales de nómina' },
    { code: '2.1.3.01', type: 'PASIVO', debit: 0, credit: Number(totals.netPay), description: 'Neto de nómina por pagar a trabajadores' },
    { code: '2.1.3.03', type: 'PASIVO', debit: 0, credit: Number(totals.workerLegalDeductions) + Number(totals.employerContributions), description: 'Aportes legales de trabajadores y patronales por enterar' },
    { code: '2.1.3.04', type: 'PASIVO', debit: 0, credit: Number(totals.otherDeductions), description: 'Otras deducciones de nómina por pagar' }
  ].filter(row => row.debit > 0 || row.credit > 0);
  if (!rows.length) throw new Error('La nómina no contiene importes que puedan contabilizarse.');
  const items: JournalEntryItem[] = rows.map(row => {
    const account = accounts.find(item => item.code === row.code && item.isMovement && item.type === row.type);
    if (!account) throw new Error('Falta una cuenta contable activa para nómina: ' + row.code + '.');
    return {
      accountCode: account.code, accountName: account.name,
      debitBs: roundMoney(row.debit), creditBs: roundMoney(row.credit),
      debitUsd: roundMoney(row.debit / bcvRate), creditUsd: roundMoney(row.credit / bcvRate),
      description: row.description
    };
  });
  const sum = (key: keyof JournalEntryItem) => items.reduce((total, item) => total + Number(item[key] || 0), 0);
  const debitBs = sum('debitBs'), creditBs = sum('creditBs');
  if (debitBs <= 0 || Math.abs(debitBs - creditBs) > 0.01) {
    throw new Error('El asiento calculado no cuadra en bolívares.');
  }
  const usdRounding = roundMoney(sum('debitUsd') - sum('creditUsd'));
  const roundingLine = items.filter(item => item.creditBs > 0).sort((a, b) => b.creditBs - a.creditBs)[0];
  if (!roundingLine || Math.abs(usdRounding) > 0.05) {
    throw new Error('La conversión del asiento excede la tolerancia de redondeo en USD.');
  }
  roundingLine.creditUsd = roundMoney(roundingLine.creditUsd + usdRounding);
  if (roundingLine.creditUsd < 0 || sum('debitUsd') <= 0 || Math.abs(sum('debitUsd') - sum('creditUsd')) > 0.01) {
    throw new Error('El asiento no cuadra en dólares después del redondeo.');
  }
  return items;
}
