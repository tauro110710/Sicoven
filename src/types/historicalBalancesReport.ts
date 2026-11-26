import type { Account, JournalEntry } from './accounting';
import { selectHistoricalReportEntries, type HistoricalReportKind } from './accountingReportIntegrity';
import { getReportScaleDate, roundReportCents, roundReportMicroUsd } from './reportMonetaryReexpression';
import { reexpressAmountBetweenDates } from '../utils/monetaryPolicy';

/**
 * Balances históricos comparativos por ejercicio.
 *
 * Cada ejercicio se presenta en la escala de su propia fecha de cierre
 * (`getReportScaleDate`), la misma que usa `buildClosingEntryItems` al
 * cancelar las cuentas nominales. El resultado del ejercicio se acumula
 * redondeando el neto firmado de CADA cuenta a centavos, con la misma función
 * que el asiento de cierre, para que ambas cifras coincidan al centavo y no
 * solo por aproximación.
 *
 * Por eso los Bs. se acumulan con los mismos dobles que usa el cierre
 * (`Number(reexpressAmountBetweenDates(...))` y suma numérica) en vez de con
 * aritmética decimal exacta: en los casos de medio centavo, sumar en decimal
 * exacto y redondear después puede caer de un lado distinto al del asiento
 * contabilizado. La igualdad al centavo exige reproducir su aritmética.
 */

export interface HistoricalBalanceRow extends Account {
  debitBs: number;
  creditBs: number;
  debitUsd: number;
  creditUsd: number;
  balanceBs: number;
  balanceUsd: number;
}

export interface HistoricalBalanceSummary {
  year: number;
  kind: HistoricalReportKind;
  /** Fecha de cierre del ejercicio: escala monetaria del reporte. */
  reportScaleDate: string;
  rows: HistoricalBalanceRow[];
  count: number;
  totalActivoBs: number;
  totalPasivoBs: number;
  patrimonioBaseBs: number;
  totalPatrimonioBs: number;
  resultadoBs: number;
  totalActivoUsd: number;
  totalPasivoUsd: number;
  patrimonioBaseUsd: number;
  totalPatrimonioUsd: number;
  resultadoUsd: number;
}

const isNominal = (type: string) => type === 'INGRESOS' || type === 'COSTOS' || type === 'GASTOS';
const isCreditNormal = (type: string) => type === 'INGRESOS' || type === 'PASIVO' || type === 'PATRIMONIO';

export function buildHistoricalBalanceSummary(input: {
  entries: JournalEntry[];
  accounts: Account[];
  companyId: string;
  year: number;
  kind: HistoricalReportKind;
}): HistoricalBalanceSummary {
  const { entries, accounts, companyId, year, kind } = input;
  const reportScaleDate = getReportScaleDate(year);
  const selected = selectHistoricalReportEntries(entries, companyId, year, kind);

  const rows: HistoricalBalanceRow[] = [];
  for (const account of accounts) {
    let debitBs = 0;
    let creditBs = 0;
    let debitUsd = 0;
    let creditUsd = 0;
    for (const entry of selected) {
      for (const item of entry.items) {
        if (item.accountCode !== account.code) continue;
        debitBs += Number(reexpressAmountBetweenDates(item.debitBs, entry.date, reportScaleDate));
        creditBs += Number(reexpressAmountBetweenDates(item.creditBs, entry.date, reportScaleDate));
        debitUsd += Number(item.debitUsd || 0);
        creditUsd += Number(item.creditUsd || 0);
      }
    }

    // El neto firmado (haber − debe) se redondea igual que en el asiento de
    // cierre; su valor con signo es la contribución exacta al resultado.
    const signedNetBs = roundReportCents(creditBs - debitBs);
    const signedNetUsd = roundReportMicroUsd(creditUsd - debitUsd);

    let balanceBs: number;
    let balanceUsd: number;
    if (kind === 'RESULTADOS') {
      if (!isNominal(account.type)) continue;
      balanceBs = account.type === 'INGRESOS' ? signedNetBs : -signedNetBs;
      balanceUsd = account.type === 'INGRESOS' ? signedNetUsd : -signedNetUsd;
    } else {
      if (!['ACTIVO', 'PASIVO', 'PATRIMONIO', 'INGRESOS', 'COSTOS', 'GASTOS'].includes(account.type)) continue;
      if (isNominal(account.type)) {
        balanceBs = account.type === 'INGRESOS' ? signedNetBs : -signedNetBs;
        balanceUsd = account.type === 'INGRESOS' ? signedNetUsd : -signedNetUsd;
      } else {
        balanceBs = roundReportCents(isCreditNormal(account.type) ? creditBs - debitBs : debitBs - creditBs);
        balanceUsd = roundReportMicroUsd(isCreditNormal(account.type) ? creditUsd - debitUsd : debitUsd - creditUsd);
      }
    }

    if (balanceBs === 0 && balanceUsd === 0) continue;
    rows.push({ ...account, debitBs, creditBs, debitUsd, creditUsd, balanceBs, balanceUsd });
  }

  const sum = (type: string, field: 'balanceBs' | 'balanceUsd') =>
    rows.filter(row => row.type === type).reduce((total, row) => total + row[field], 0);

  const ingresosBs = sum('INGRESOS', 'balanceBs');
  const costosBs = sum('COSTOS', 'balanceBs');
  const gastosBs = sum('GASTOS', 'balanceBs');
  const ingresosUsd = sum('INGRESOS', 'balanceUsd');
  const costosUsd = sum('COSTOS', 'balanceUsd');
  const gastosUsd = sum('GASTOS', 'balanceUsd');
  const resultadoBs = roundReportCents(ingresosBs - costosBs - gastosBs);
  const resultadoUsd = roundReportMicroUsd(ingresosUsd - costosUsd - gastosUsd);

  const patrimonioBaseBs = sum('PATRIMONIO', 'balanceBs');
  const patrimonioBaseUsd = sum('PATRIMONIO', 'balanceUsd');

  return {
    year,
    kind,
    reportScaleDate,
    rows,
    count: selected.length,
    totalActivoBs: sum('ACTIVO', 'balanceBs'),
    totalPasivoBs: sum('PASIVO', 'balanceBs'),
    patrimonioBaseBs,
    totalPatrimonioBs: roundReportCents(patrimonioBaseBs + resultadoBs),
    resultadoBs,
    totalActivoUsd: sum('ACTIVO', 'balanceUsd'),
    totalPasivoUsd: sum('PASIVO', 'balanceUsd'),
    patrimonioBaseUsd,
    totalPatrimonioUsd: roundReportMicroUsd(patrimonioBaseUsd + resultadoUsd),
    resultadoUsd
  };
}
