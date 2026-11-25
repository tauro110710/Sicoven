import type { JournalEntry } from './accounting';
import { getVenezuelanMonetaryEra, addExactDecimals, roundHistoricalPresentationAmount } from './historicalAccountingCalendar';
import { RECONVERSION_BOUNDARIES, reexpressAmountBetweenDates } from '../utils/monetaryPolicy';
import { isValidIsoCalendarDate } from '../utils/isoDateValidation';

/**
 * Arrastre informativo de saldos en una frontera de reconversión monetaria.
 *
 * El tramo anterior conserva sus montos originales para auditoría y no se
 * reescribe. Este cálculo reexpresa el saldo neto de cada cuenta a la escala
 * del nuevo tramo, de modo que el contador pueda conciliar el cierre del tramo
 * anterior con la apertura del siguiente sin mezclar ceros de escalas distintas.
 *
 * No modifica asientos, no crea duplicados y no altera los saldos contables.
 */

export interface ReconversionCarryForwardLine {
  accountCode: string;
  accountName: string;
  /** Debe menos Haber en la escala original del tramo anterior (decimal exacto). */
  originalNetBs: string;
  /** Saldo neto reexpresado a la escala del nuevo tramo (decimal exacto). */
  reexpressedNetBs: string;
  /** Saldo reexpresado ubicado en la columna que corresponde. */
  debitBs: string;
  creditBs: string;
}

export interface ReconversionCarryForward {
  companyId: string;
  boundaryDate: string;
  fromEraId: string;
  toEraId: string;
  fromEraLabel: string;
  toEraLabel: string;
  removedDecimalExponent: number;
  /** Último día del tramo anterior incluido en el saldo. */
  sourceThroughDate: string;
  /** Primer día del tramo anterior; los asientos previos pertenecen a un tramo anterior. */
  sourceFromDate: string;
  lines: ReconversionCarryForwardLine[];
  totalDebitBs: string;
  totalCreditBs: string;
  isBalanced: boolean;
  warnings: string[];
}

export interface BuildReconversionCarryForwardInput {
  companyId: string;
  /** Fecha de la reconversión a la que se desea arrastrar (p. ej. 2018-08-20). */
  boundaryDate: string;
  entries: JournalEntry[];
}

function dayBefore(isoDate: string): string {
  const value = new Date(isoDate + 'T00:00:00.000Z');
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function trimNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Los asientos contienen un importe no numérico.');
  return String(value);
}

function negateDecimal(value: string): string {
  return value === '0' ? '0' : '-' + value;
}

export function buildReconversionCarryForward(input: BuildReconversionCarryForwardInput): ReconversionCarryForward {
  const companyId = String(input.companyId || '').trim();
  if (!companyId) throw new Error('Seleccione la empresa cuyo saldo se reexpresará.');
  const boundary = RECONVERSION_BOUNDARIES.find(item => item.date === input.boundaryDate);
  if (!boundary) {
    throw new Error('La fecha indicada no es una frontera de reconversión monetaria reconocida (2008-01-01, 2018-08-20 o 2021-10-01).');
  }
  const sourceThroughDate = dayBefore(boundary.date);
  if (!isValidIsoCalendarDate(sourceThroughDate)) throw new Error('La fecha de la reconversión no permite calcular su cierre.');

  const fromEra = getVenezuelanMonetaryEra(sourceThroughDate);
  const toEra = getVenezuelanMonetaryEra(boundary.date);
  const warnings: string[] = [];

  // Cada tramo se reexpresa por separado: no se suman montos nominales de
  // escalas distintas. El tramo anterior comienza en la frontera inmediatamente
  // precedente (o en el origen del bolívar para la primera reconversión).
  const boundaryIndex = RECONVERSION_BOUNDARIES.findIndex(item => item.date === boundary.date);
  const sourceFromDate = boundaryIndex > 0 ? RECONVERSION_BOUNDARIES[boundaryIndex - 1].date : '1900-01-01';

  const relevant = input.entries.filter(entry => String(entry.companyId || '') === companyId);
  const previous = relevant.filter(entry => isValidIsoCalendarDate(entry.date) &&
    entry.date >= sourceFromDate && entry.date < boundary.date);
  if (previous.length === 0) {
    warnings.push('No existen asientos del tramo ' + fromEra.label + ' anteriores a la reconversión; el arrastre sería cero.');
  }
  const earlierTramoCount = relevant.filter(entry => isValidIsoCalendarDate(entry.date) && entry.date < sourceFromDate).length;
  if (earlierTramoCount > 0) {
    warnings.push('Hay ' + earlierTramoCount + ' asiento(s) de un tramo anterior (' + sourceFromDate + '). Reexprese primero esa frontera: no se mezclan escalas distintas en el mismo saldo.');
  }
  for (const entry of relevant) {
    if (!isValidIsoCalendarDate(entry.date)) {
      warnings.push('Hay un asiento con fecha inválida que no puede incluirse en el arrastre.');
      break;
    }
  }

  const balances = new Map<string, { accountName: string; net: string }>();
  for (const entry of previous) {
    for (const item of entry.items || []) {
      const accountCode = String(item.accountCode || '').trim();
      if (!accountCode) continue;
      const current = balances.get(accountCode) || { accountName: item.accountName || accountCode, net: '0' };
      const debit = trimNumber(Number(item.debitBs) || 0);
      const credit = trimNumber(Number(item.creditBs) || 0);
      const next = addExactDecimals(current.net, addExactDecimals(debit, negateDecimal(credit)));
      balances.set(accountCode, { accountName: current.accountName || item.accountName || accountCode, net: next });
    }
  }

  const lines: ReconversionCarryForwardLine[] = [];
  for (const accountCode of [...balances.keys()].sort((a, b) => a.localeCompare(b))) {
    const balance = balances.get(accountCode)!;
    if (balance.net === '0') continue;
    const reexpressed = reexpressAmountBetweenDates(balance.net, sourceThroughDate, boundary.date);
    if (reexpressed === '0') continue;
    const isDebit = !reexpressed.startsWith('-');
    const absolute = isDebit ? reexpressed : reexpressed.slice(1);
    lines.push({
      accountCode,
      accountName: balance.accountName,
      originalNetBs: balance.net,
      reexpressedNetBs: reexpressed,
      debitBs: isDebit ? absolute : '0',
      creditBs: isDebit ? '0' : absolute
    });
  }

  const totalDebitBs = lines.reduce((sum, line) => addExactDecimals(sum, line.debitBs), '0');
  const totalCreditBs = lines.reduce((sum, line) => addExactDecimals(sum, line.creditBs), '0');
  const difference = addExactDecimals(totalDebitBs, negateDecimal(totalCreditBs));
  const isBalanced = difference === '0';
  if (!isBalanced) {
    warnings.push('El saldo reexpresado no cuadra; revise asientos incompletos o con partida doble rota antes de usarlo como referencia.');
  }

  return {
    companyId,
    boundaryDate: boundary.date,
    fromEraId: fromEra.id,
    toEraId: toEra.id,
    fromEraLabel: fromEra.label,
    toEraLabel: toEra.label,
    removedDecimalExponent: boundary.removedDecimalExponent,
    sourceThroughDate,
    sourceFromDate,
    lines,
    totalDebitBs,
    totalCreditBs,
    isBalanced,
    warnings
  };
}

/** Presentación con dos decimales del saldo reexpresado, sin alterar el valor exacto guardado. */
export function formatCarryForwardAmount(amount: string): string {
  return roundHistoricalPresentationAmount(amount, 2);
}
