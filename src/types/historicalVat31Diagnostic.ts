/**
 * Diagnóstico de solo lectura del IVA en documentos con tasa combinada 31 %.
 *
 * El 31 % equivale a 16 % de IVA más 15 % de impuesto adicional al consumo
 * suntuario. Este módulo detecta compras, ventas, notas y asientos donde el
 * 31 % completo quedó registrado como IVA, sin impuesto suntuario separado.
 *
 * Garantías:
 * - No modifica documentos, asientos ni el calendario fiscal. Solo lee.
 * - No reescribe importes históricos: la corrección se propone como un asiento
 *   nuevo, fechado en el primer día del período abierto.
 * - Los importes se derivan con el motor fiscal único (16 % y 15 %) y el mismo
 *   criterio de redondeo de bolívares.
 */

import type { JournalEntry, PurchaseRecord, SaleRecord } from './accounting';
import {
  LUXURY_COMBINED_RATE,
  LUXURY_CONSUMPTION_RATE,
  LUXURY_TAX_EXPENSE_ACCOUNT,
  LUXURY_TAX_PAYABLE_ACCOUNT,
  VAT_INPUT_ACCOUNT_BY_RATE,
  VAT_OUTPUT_ACCOUNT_BY_RATE,
  VAT_STANDARD_RATE,
  roundFiscalBs
} from './vatFiscalEngine';

export type HistoricalVat31Source = 'PURCHASE' | 'SALE' | 'JOURNAL_ENTRY';
export type HistoricalVat31Side = 'INPUT' | 'OUTPUT';
/** INCREASE eleva el IVA registrado; DECREASE lo reduce (notas de crédito). */
export type HistoricalVat31VatEffect = 'INCREASE' | 'DECREASE';
export type HistoricalVat31LuxuryTreatment = 'NON_RECOVERABLE_EXPENSE' | 'TAX_PAYABLE';
export type HistoricalVat31DocumentType = '01' | '02' | '03';

const TOLERANCE_BS = 0.05;
const VAT_INPUT_ACCOUNT_CODE = VAT_INPUT_ACCOUNT_BY_RATE[VAT_STANDARD_RATE];
const VAT_OUTPUT_ACCOUNT_CODE = VAT_OUTPUT_ACCOUNT_BY_RATE[VAT_STANDARD_RATE];
const INPUT_BASE_PREFIXES = ['1.1.4.', '5.', '6.'];
const OUTPUT_BASE_PREFIXES = ['4.'];
const NON_BASE_ACCOUNT_CODES = new Set([
  VAT_INPUT_ACCOUNT_CODE,
  VAT_OUTPUT_ACCOUNT_CODE,
  VAT_INPUT_ACCOUNT_BY_RATE[8],
  VAT_OUTPUT_ACCOUNT_BY_RATE[8],
  LUXURY_TAX_EXPENSE_ACCOUNT,
  LUXURY_TAX_PAYABLE_ACCOUNT,
  '2.1.2.06',
  '6.1.1.11',
  '2.1.2.03',
  '2.1.2.04',
  '1.1.3.03'
]);

export const HISTORICAL_VAT31_ADJUSTMENT_REASON =
  'Reclasificación del impuesto adicional al consumo suntuario (15 %) incluido ' +
  'indebidamente en el IVA de documentos con tasa combinada del 31 %. El asiento ' +
  'se propone en el período abierto y no modifica los documentos ni los asientos ' +
  'históricos.';

export interface HistoricalVat31AdjustmentLine {
  accountCode: string;
  accountName: string;
  debitBs: number;
  creditBs: number;
  description: string;
}

export interface HistoricalVat31Finding {
  id: string;
  source: HistoricalVat31Source;
  side: HistoricalVat31Side;
  documentType: HistoricalVat31DocumentType | null;
  documentLabel: string;
  date: string;
  reference: string;
  partyName: string;
  taxableBaseBs: number;
  recordedVatBs: number;
  correctVatBs: number;
  /** Diferencia entre el IVA registrado y el IVA del 16 %. */
  overstatedVatBs: number;
  vatEffect: HistoricalVat31VatEffect;
  /** Componente del 15 % que corresponde al impuesto suntuario. */
  luxuryTaxBs: number;
  luxuryTaxTreatment: HistoricalVat31LuxuryTreatment;
  journalEntryId: string | null;
  journalEntryNumber: number | null;
  adjustmentLines: HistoricalVat31AdjustmentLine[];
}

export interface HistoricalVat31Totals {
  findingCount: number;
  documentCount: number;
  journalEntryCount: number;
  taxableBase31Bs: number;
  recordedVatBs: number;
  correctVatBs: number;
  /** Crédito fiscal de compras y notas de débito inflado por el 15 % suntuario. */
  inflatedInputVatCreditBs: number;
  /** Débito fiscal de ventas y notas de débito inflado por el 15 % suntuario. */
  inflatedOutputVatDebitBs: number;
  /** IVA reducido de más en notas de crédito que debe revertirse. */
  pendingVatReversalBs: number;
  /** Gasto suntuario no recuperable a reconocer (neto de notas de crédito). */
  nonRecoverableLuxuryTaxBs: number;
  /** Pasivo suntuario a reconocer en ventas (neto de notas de crédito). */
  luxuryTaxPayableBs: number;
  totalAdjustmentDebitBs: number;
  totalAdjustmentCreditBs: number;
}

export interface HistoricalVat31AdjustmentProposal {
  date: string;
  reason: string;
  lines: HistoricalVat31AdjustmentLine[];
}

export interface HistoricalVat31Diagnostic {
  findings: HistoricalVat31Finding[];
  totals: HistoricalVat31Totals;
  adjustment: HistoricalVat31AdjustmentProposal | null;
  /** Presente cuando hay hallazgos pero no existe un período abierto para el ajuste. */
  blockedReason: string | null;
}

export interface HistoricalVat31DiagnosticInput {
  companyId?: string;
  purchases: ReadonlyArray<PurchaseRecord>;
  sales: ReadonlyArray<SaleRecord>;
  journalEntries: ReadonlyArray<JournalEntry>;
  /** Último día bloqueado; el ajuste se propone el día siguiente. */
  closedThroughDate?: string | null;
  /** Fecha local actual en formato YYYY-MM-DD. */
  today: string;
}

interface EntryVat31Pattern {
  side: HistoricalVat31Side;
  effect: HistoricalVat31VatEffect;
  baseBs: number;
  vatBs: number;
}

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const addOneDay = (value: string): string => {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

const money = (value: unknown): number => roundFiscalBs(Number(value) || 0);

/** Documento con IVA del 31 % y sin el 15 % suntuario separado. */
const isFullCombinedVatBooked = (baseBs: number, vatBs: number, luxuryTaxBs: number): boolean => {
  if (baseBs <= 0 || vatBs <= 0) return false;
  if (Math.abs(vatBs - baseBs * LUXURY_COMBINED_RATE / 100) > TOLERANCE_BS) return false;
  if (luxuryTaxBs > TOLERANCE_BS) return false;
  return Math.abs(vatBs - baseBs * VAT_STANDARD_RATE / 100) > TOLERANCE_BS;
};

/**
 * Detecta un asiento que registró el 31 % completo en la cuenta de IVA.
 * Solo considera líneas de base del mismo lado del asiento y exige que no
 * exista una línea de impuesto suntuario (si existe, el asiento ya separó).
 */
const detectEntryVat31Pattern = (entry: JournalEntry): EntryVat31Pattern | null => {
  if (entry.type === 'CIERRE' || entry.type === 'APERTURA') return null;
  const hasLuxuryLine = entry.items.some(item =>
    (String(item.accountCode || '') === LUXURY_TAX_EXPENSE_ACCOUNT && money(item.debitBs) > 0) ||
    (String(item.accountCode || '') === LUXURY_TAX_PAYABLE_ACCOUNT && money(item.creditBs) > 0));
  if (hasLuxuryLine) return null;

  for (const vatLine of entry.items) {
    const code = String(vatLine.accountCode || '');
    if (code !== VAT_INPUT_ACCOUNT_CODE && code !== VAT_OUTPUT_ACCOUNT_CODE) continue;
    const debit = money(vatLine.debitBs);
    const credit = money(vatLine.creditBs);
    if (debit <= 0 && credit <= 0) continue;

    const side: HistoricalVat31Side = code === VAT_INPUT_ACCOUNT_CODE ? 'INPUT' : 'OUTPUT';
    const effect: HistoricalVat31VatEffect =
      (side === 'INPUT' ? debit > 0 : credit > 0) ? 'INCREASE' : 'DECREASE';
    const vatBs = side === 'INPUT' ? (debit > 0 ? debit : credit) : (credit > 0 ? credit : debit);
    const baseUsesDebit = (side === 'INPUT') === (effect === 'INCREASE');
    const prefixes = side === 'INPUT' ? INPUT_BASE_PREFIXES : OUTPUT_BASE_PREFIXES;

    let best: { baseBs: number; difference: number } | null = null;
    for (const item of entry.items) {
      const itemCode = String(item.accountCode || '');
      if (NON_BASE_ACCOUNT_CODES.has(itemCode)) continue;
      if (!prefixes.some(prefix => itemCode.startsWith(prefix))) continue;
      const baseBs = money(baseUsesDebit ? item.debitBs : item.creditBs);
      if (baseBs <= 0) continue;
      const difference = Math.abs(vatBs - baseBs * LUXURY_COMBINED_RATE / 100);
      if (difference <= TOLERANCE_BS && (!best || difference < best.difference)) {
        best = { baseBs, difference };
      }
    }
    if (best) return { side, effect, baseBs: best.baseBs, vatBs };
  }
  return null;
};

const documentEffect = (documentType: HistoricalVat31DocumentType): HistoricalVat31VatEffect =>
  documentType === '03' ? 'DECREASE' : 'INCREASE';

const documentLabel = (
  source: Exclude<HistoricalVat31Source, 'JOURNAL_ENTRY'>,
  documentType: HistoricalVat31DocumentType
): string => {
  if (source === 'PURCHASE') {
    if (documentType === '02') return 'Nota de débito de proveedor';
    if (documentType === '03') return 'Nota de crédito de proveedor';
    return 'Factura de compra';
  }
  if (documentType === '02') return 'Nota de débito de cliente';
  if (documentType === '03') return 'Nota de crédito de cliente';
  return 'Factura de venta';
};

const buildAdjustmentLines = (input: {
  side: HistoricalVat31Side;
  effect: HistoricalVat31VatEffect;
  amountBs: number;
  reference: string;
}): HistoricalVat31AdjustmentLine[] => {
  const amount = roundFiscalBs(input.amountBs);
  if (amount <= 0) return [];
  const detail = ' · ' + input.reference;
  if (input.side === 'INPUT' && input.effect === 'INCREASE') {
    return [
      { accountCode: LUXURY_TAX_EXPENSE_ACCOUNT, accountName: 'Impuesto adicional al consumo suntuario no recuperable', debitBs: amount, creditBs: 0, description: 'Reconocimiento del suntuario 15 % no recuperable' + detail },
      { accountCode: VAT_INPUT_ACCOUNT_CODE, accountName: 'Crédito Fiscal IVA Compras (16 %)', debitBs: 0, creditBs: amount, description: 'Reversión del exceso de crédito fiscal IVA' + detail }
    ];
  }
  if (input.side === 'INPUT') {
    return [
      { accountCode: VAT_INPUT_ACCOUNT_CODE, accountName: 'Crédito Fiscal IVA Compras (16 %)', debitBs: amount, creditBs: 0, description: 'Restitución del crédito fiscal IVA reducido en exceso' + detail },
      { accountCode: LUXURY_TAX_EXPENSE_ACCOUNT, accountName: 'Impuesto adicional al consumo suntuario no recuperable', debitBs: 0, creditBs: amount, description: 'Reversión del gasto suntuario 15 %' + detail }
    ];
  }
  if (input.effect === 'INCREASE') {
    return [
      { accountCode: VAT_OUTPUT_ACCOUNT_CODE, accountName: 'Débito Fiscal IVA Ventas (16 %)', debitBs: amount, creditBs: 0, description: 'Reversión del exceso de débito fiscal IVA' + detail },
      { accountCode: LUXURY_TAX_PAYABLE_ACCOUNT, accountName: 'Impuesto adicional al consumo suntuario por pagar', debitBs: 0, creditBs: amount, description: 'Reconocimiento del suntuario 15 % por pagar' + detail }
    ];
  }
  return [
    { accountCode: LUXURY_TAX_PAYABLE_ACCOUNT, accountName: 'Impuesto adicional al consumo suntuario por pagar', debitBs: amount, creditBs: 0, description: 'Reversión del suntuario 15 % por pagar' + detail },
    { accountCode: VAT_OUTPUT_ACCOUNT_CODE, accountName: 'Débito Fiscal IVA Ventas (16 %)', debitBs: 0, creditBs: amount, description: 'Restitución del débito fiscal IVA reducido en exceso' + detail }
  ];
};

const buildDocumentFinding = (input: {
  source: Exclude<HistoricalVat31Source, 'JOURNAL_ENTRY'>;
  document: PurchaseRecord | SaleRecord;
  entry?: JournalEntry;
}): HistoricalVat31Finding | null => {
  const { document, entry } = input;
  if (document.isCancelled) return null;
  if (Number(document.taxRate) !== LUXURY_COMBINED_RATE) return null;

  const documentBase = money(document.taxableBaseBs);
  const documentVat = money(document.vatAmountBs);
  const documentLuxury = money(document.additionalLuxuryTaxBs ?? 0);
  if (!isFullCombinedVatBooked(documentBase, documentVat, documentLuxury)) return null;

  const side: HistoricalVat31Side = input.source === 'PURCHASE' ? 'INPUT' : 'OUTPUT';
  const pattern = entry ? detectEntryVat31Pattern(entry) : null;
  if (entry && (!pattern || pattern.side !== side || Math.abs(pattern.vatBs - documentVat) > TOLERANCE_BS)) {
    // El asiento no confirma que se haya contabilizado el 31 % completo como IVA.
    return null;
  }

  const baseBs = pattern ? pattern.baseBs : documentBase;
  const recordedVatBs = pattern ? pattern.vatBs : documentVat;
  const correctVatBs = roundFiscalBs(baseBs * VAT_STANDARD_RATE / 100);
  const overstatedVatBs = roundFiscalBs(recordedVatBs - correctVatBs);
  if (overstatedVatBs <= 0) return null;

  const documentType = document.documentType as HistoricalVat31DocumentType;
  const vatEffect = pattern ? pattern.effect : documentEffect(documentType);
  const reference = String(document.invoiceNumber || document.id);
  return {
    id: (input.source === 'PURCHASE' ? 'purchase:' : 'sale:') + document.id,
    source: input.source,
    side,
    documentType,
    documentLabel: documentLabel(input.source, documentType),
    date: document.invoiceDate,
    reference,
    partyName: input.source === 'PURCHASE'
      ? (document as PurchaseRecord).supplierName
      : (document as SaleRecord).customerName,
    taxableBaseBs: baseBs,
    recordedVatBs,
    correctVatBs,
    overstatedVatBs,
    vatEffect,
    luxuryTaxBs: roundFiscalBs(baseBs * LUXURY_CONSUMPTION_RATE / 100),
    luxuryTaxTreatment: side === 'INPUT' ? 'NON_RECOVERABLE_EXPENSE' : 'TAX_PAYABLE',
    journalEntryId: entry?.id ?? null,
    journalEntryNumber: entry?.entryNumber ?? null,
    adjustmentLines: buildAdjustmentLines({ side, effect: vatEffect, amountBs: overstatedVatBs, reference })
  };
};

const buildEntryFinding = (entry: JournalEntry, pattern: EntryVat31Pattern): HistoricalVat31Finding => {
  const reference = 'Asiento #' + entry.entryNumber;
  const correctVatBs = roundFiscalBs(pattern.baseBs * VAT_STANDARD_RATE / 100);
  const overstatedVatBs = roundFiscalBs(pattern.vatBs - correctVatBs);
  return {
    id: 'journal:' + entry.id,
    source: 'JOURNAL_ENTRY',
    side: pattern.side,
    documentType: null,
    documentLabel: 'Asiento contable',
    date: entry.date,
    reference,
    partyName: entry.description || '',
    taxableBaseBs: pattern.baseBs,
    recordedVatBs: pattern.vatBs,
    correctVatBs,
    overstatedVatBs,
    vatEffect: pattern.effect,
    luxuryTaxBs: roundFiscalBs(pattern.baseBs * LUXURY_CONSUMPTION_RATE / 100),
    luxuryTaxTreatment: pattern.side === 'INPUT' ? 'NON_RECOVERABLE_EXPENSE' : 'TAX_PAYABLE',
    journalEntryId: entry.id,
    journalEntryNumber: entry.entryNumber,
    adjustmentLines: buildAdjustmentLines({
      side: pattern.side,
      effect: pattern.effect,
      amountBs: overstatedVatBs,
      reference
    })
  };
};

const mergeAdjustmentLines = (
  findings: ReadonlyArray<HistoricalVat31Finding>
): HistoricalVat31AdjustmentLine[] => {
  const merged = new Map<string, HistoricalVat31AdjustmentLine>();
  for (const finding of findings) {
    for (const line of finding.adjustmentLines) {
      const current = merged.get(line.accountCode);
      if (current) {
        current.debitBs = roundFiscalBs(current.debitBs + line.debitBs);
        current.creditBs = roundFiscalBs(current.creditBs + line.creditBs);
      } else {
        merged.set(line.accountCode, { ...line });
      }
    }
  }
  return [...merged.values()].filter(line => line.debitBs > 0 || line.creditBs > 0);
};

/**
 * Resuelve la fecha del ajuste en el primer día abierto. Nunca propone una
 * fecha dentro del período cerrado ni una fecha futura.
 */
export function resolveHistoricalVat31AdjustmentDate(input: {
  closedThroughDate?: string | null;
  today: string;
}): { date: string | null; blockedReason: string | null } {
  if (!isIsoDate(input.today)) throw new Error('La fecha actual del diagnóstico no es válida.');
  const closedThroughDate = input.closedThroughDate;
  if (!closedThroughDate) return { date: input.today, blockedReason: null };
  if (!isIsoDate(closedThroughDate)) {
    throw new Error('La fecha del período cerrado no es válida para proponer el ajuste.');
  }
  const nextOpenDate = addOneDay(closedThroughDate);
  if (nextOpenDate > input.today) {
    return {
      date: null,
      blockedReason: 'El período cerrado alcanza la fecha actual y no existe un día abierto para fechar el ajuste. Cierre el período vigente o espere al siguiente día hábil contable.'
    };
  }
  return { date: nextOpenDate, blockedReason: null };
}

/**
 * Ejecuta el diagnóstico completo. Es una función pura: no escribe, no ordena
 * los arreglos originales y no altera ningún documento ni asiento.
 */
export function buildHistoricalVat31Diagnostic(
  input: HistoricalVat31DiagnosticInput
): HistoricalVat31Diagnostic {
  const purchases = input.companyId
    ? input.purchases.filter(item => item.companyId === input.companyId)
    : [...input.purchases];
  const sales = input.companyId
    ? input.sales.filter(item => item.companyId === input.companyId)
    : [...input.sales];
  const journalEntries = input.companyId
    ? input.journalEntries.filter(item => item.companyId === input.companyId)
    : [...input.journalEntries];
  const entryById = new Map(journalEntries.map(entry => [entry.id, entry]));

  const findings: HistoricalVat31Finding[] = [];
  const usedEntryIds = new Set<string>();
  for (const document of purchases) {
    const entry = document.journalEntryId ? entryById.get(document.journalEntryId) : undefined;
    const finding = buildDocumentFinding({ source: 'PURCHASE', document, entry });
    if (finding) {
      findings.push(finding);
      if (finding.journalEntryId) usedEntryIds.add(finding.journalEntryId);
    }
  }
  for (const document of sales) {
    const entry = document.journalEntryId ? entryById.get(document.journalEntryId) : undefined;
    const finding = buildDocumentFinding({ source: 'SALE', document, entry });
    if (finding) {
      findings.push(finding);
      if (finding.journalEntryId) usedEntryIds.add(finding.journalEntryId);
    }
  }
  for (const entry of journalEntries) {
    if (usedEntryIds.has(entry.id)) continue;
    const pattern = detectEntryVat31Pattern(entry);
    if (!pattern) continue;
    const finding = buildEntryFinding(entry, pattern);
    if (finding.overstatedVatBs > 0) findings.push(finding);
  }

  findings.sort((a, b) => b.date.localeCompare(a.date) || a.reference.localeCompare(b.reference));

  let taxableBase31Bs = 0;
  let recordedVatBs = 0;
  let correctVatBs = 0;
  let inflatedInputVatCreditBs = 0;
  let inflatedOutputVatDebitBs = 0;
  let pendingVatReversalBs = 0;
  let nonRecoverableLuxuryTaxBs = 0;
  let luxuryTaxPayableBs = 0;
  for (const finding of findings) {
    taxableBase31Bs += finding.taxableBaseBs;
    recordedVatBs += finding.recordedVatBs;
    correctVatBs += finding.correctVatBs;
    if (finding.vatEffect === 'INCREASE') {
      if (finding.side === 'INPUT') inflatedInputVatCreditBs += finding.overstatedVatBs;
      else inflatedOutputVatDebitBs += finding.overstatedVatBs;
    } else {
      pendingVatReversalBs += finding.overstatedVatBs;
    }
    const sign = finding.vatEffect === 'INCREASE' ? 1 : -1;
    if (finding.luxuryTaxTreatment === 'NON_RECOVERABLE_EXPENSE') {
      nonRecoverableLuxuryTaxBs += sign * finding.luxuryTaxBs;
    } else {
      luxuryTaxPayableBs += sign * finding.luxuryTaxBs;
    }
  }

  const adjustmentLines = mergeAdjustmentLines(findings);
  const totals: HistoricalVat31Totals = {
    findingCount: findings.length,
    documentCount: findings.filter(finding => finding.source !== 'JOURNAL_ENTRY').length,
    journalEntryCount: findings.filter(finding => finding.source === 'JOURNAL_ENTRY').length,
    taxableBase31Bs: money(taxableBase31Bs),
    recordedVatBs: money(recordedVatBs),
    correctVatBs: money(correctVatBs),
    inflatedInputVatCreditBs: money(inflatedInputVatCreditBs),
    inflatedOutputVatDebitBs: money(inflatedOutputVatDebitBs),
    pendingVatReversalBs: money(pendingVatReversalBs),
    nonRecoverableLuxuryTaxBs: money(nonRecoverableLuxuryTaxBs),
    luxuryTaxPayableBs: money(luxuryTaxPayableBs),
    totalAdjustmentDebitBs: money(adjustmentLines.reduce((sum, line) => sum + line.debitBs, 0)),
    totalAdjustmentCreditBs: money(adjustmentLines.reduce((sum, line) => sum + line.creditBs, 0))
  };

  if (!findings.length) {
    return { findings, totals, adjustment: null, blockedReason: null };
  }

  const { date, blockedReason } = resolveHistoricalVat31AdjustmentDate({
    closedThroughDate: input.closedThroughDate,
    today: input.today
  });
  if (!date) return { findings, totals, adjustment: null, blockedReason };

  return {
    findings,
    totals,
    adjustment: { date, reason: HISTORICAL_VAT31_ADJUSTMENT_REASON, lines: adjustmentLines },
    blockedReason: null
  };
}
