/**
 * Builds a read-only dependency plan for a historical accounting replay.
 *
 * This planner deliberately does not mutate source documents, journal entries,
 * tax records, balances, company periods, or SQLite. It identifies the dated
 * source events and derived accounting records that a later transactional
 * replay coordinator must recalculate.
 */

export interface HistoricalReplayRecord {
  id?: string;
  companyId?: string;
  date?: string;
  invoiceDate?: string;
  accountCreditDate?: string;
  settlementDate?: string;
  acquisitionDate?: string;
  serviceDate?: string;
  periodEndDate?: string;
  endDate?: string;
  occurredAt?: string;
  createdAt?: string;
  entryNumber?: number;
  type?: string;
  referenceDoc?: string;
  invoiceNumber?: string;
  documentType?: string;
  journalEntryId?: string;
  isCancelled?: boolean;
  isReversed?: boolean;
  filedAt?: string;
  status?: string;
  depreciationEvents?: HistoricalReplayRecord[];
  [key: string]: unknown;
}

export interface HistoricalAccountingReplaySnapshot {
  companyId: string;
  startDate: string;
  throughDate?: string;
  purchases?: HistoricalReplayRecord[];
  sales?: HistoricalReplayRecord[];
  movements?: HistoricalReplayRecord[];
  bankStatementMovements?: HistoricalReplayRecord[];
  creditSettlements?: HistoricalReplayRecord[];
  supplierAdvanceSettlements?: HistoricalReplayRecord[];
  supplierDirectAdvances?: HistoricalReplayRecord[];
  fixedAssets?: HistoricalReplayRecord[];
  vatVouchers?: HistoricalReplayRecord[];
  islrVouchers?: HistoricalReplayRecord[];
  vatWithholdingDeclarations?: HistoricalReplayRecord[];
  vatWithholdingDeclarationEvents?: HistoricalReplayRecord[];
  vatOwnDeclarations?: HistoricalReplayRecord[];
  vatOwnDeclarationEvents?: HistoricalReplayRecord[];
  islrFiscalEvents?: HistoricalReplayRecord[];
  journalEntries?: HistoricalReplayRecord[];
}

export type HistoricalReplaySourceKind =
  | 'PURCHASE'
  | 'SALE'
  | 'INVENTORY_MOVEMENT'
  | 'BANK_STATEMENT_MOVEMENT'
  | 'CREDIT_SETTLEMENT'
  | 'SUPPLIER_ADVANCE_SETTLEMENT'
  | 'SUPPLIER_DIRECT_ADVANCE'
  | 'FIXED_ASSET'
  | 'FIXED_ASSET_DEPRECIATION'
  | 'VAT_VOUCHER'
  | 'ISLR_VOUCHER'
  | 'VAT_WITHHOLDING_DECLARATION'
  | 'VAT_WITHHOLDING_EVENT'
  | 'VAT_OWN_DECLARATION'
  | 'VAT_OWN_EVENT'
  | 'ISLR_FISCAL_EVENT';

export interface HistoricalReplaySourceEvent {
  key: string;
  collection: string;
  sourceId: string;
  companyId: string;
  kind: HistoricalReplaySourceKind;
  effectiveDate: string;
  recordedAt: string | null;
  reference: string | null;
  linkedJournalEntryId: string | null;
  sourceIndex: number;
}

export interface HistoricalReplayExercise {
  fiscalYear: number;
  startDate: string;
  endDate: string;
  includesYearEndClose: boolean;
  includesNextYearOpening: boolean;
}

export interface HistoricalAccountingReplayPlan {
  companyId: string;
  startDate: string;
  throughDate: string;
  mode: 'READ_ONLY_PLAN';
  sourceEvents: HistoricalReplaySourceEvent[];
  derivedJournalEntryIds: string[];
  affectedExercises: HistoricalReplayExercise[];
  externalDependencies: string[];
  warnings: string[];
  blockers: string[];
  canProceedToTransactionalReplay: boolean;
}

type CollectionSpec = {
  collection: keyof HistoricalAccountingReplaySnapshot;
  kind: HistoricalReplaySourceKind;
  dateFields: string[];
  referenceFields: string[];
};

const SOURCE_COLLECTIONS: CollectionSpec[] = [
  { collection: 'purchases', kind: 'PURCHASE', dateFields: ['accountCreditDate', 'invoiceDate', 'date'], referenceFields: ['invoiceNumber', 'controlNumber'] },
  { collection: 'sales', kind: 'SALE', dateFields: ['invoiceDate', 'date'], referenceFields: ['invoiceNumber', 'controlNumber'] },
  { collection: 'movements', kind: 'INVENTORY_MOVEMENT', dateFields: ['date'], referenceFields: ['documentRef', 'concept'] },
  { collection: 'bankStatementMovements', kind: 'BANK_STATEMENT_MOVEMENT', dateFields: ['date'], referenceFields: ['reference', 'description'] },
  { collection: 'creditSettlements', kind: 'CREDIT_SETTLEMENT', dateFields: ['settlementDate', 'date'], referenceFields: ['reference', 'documentId'] },
  { collection: 'supplierAdvanceSettlements', kind: 'SUPPLIER_ADVANCE_SETTLEMENT', dateFields: ['settlementDate', 'date'], referenceFields: ['targetPurchaseId', 'supplierRif'] },
  { collection: 'supplierDirectAdvances', kind: 'SUPPLIER_DIRECT_ADVANCE', dateFields: ['date'], referenceFields: ['reference', 'supplierRif'] },
  { collection: 'fixedAssets', kind: 'FIXED_ASSET', dateFields: ['acquisitionDate', 'serviceDate'], referenceFields: ['assetCode', 'description'] },
  { collection: 'vatVouchers', kind: 'VAT_VOUCHER', dateFields: ['date'], referenceFields: ['documentNumber', 'reference'] },
  { collection: 'islrVouchers', kind: 'ISLR_VOUCHER', dateFields: ['date'], referenceFields: ['documentNumber', 'reference'] },
  { collection: 'vatWithholdingDeclarations', kind: 'VAT_WITHHOLDING_DECLARATION', dateFields: ['periodEndDate', 'endDate', 'date'], referenceFields: ['period', 'declarationNumber'] },
  { collection: 'vatWithholdingDeclarationEvents', kind: 'VAT_WITHHOLDING_EVENT', dateFields: ['date', 'occurredAt'], referenceFields: ['declarationId', 'eventType'] },
  { collection: 'vatOwnDeclarations', kind: 'VAT_OWN_DECLARATION', dateFields: ['periodEndDate', 'endDate', 'date'], referenceFields: ['period', 'declarationNumber'] },
  { collection: 'vatOwnDeclarationEvents', kind: 'VAT_OWN_EVENT', dateFields: ['occurredAt', 'date'], referenceFields: ['declarationId', 'eventType'] },
  { collection: 'islrFiscalEvents', kind: 'ISLR_FISCAL_EVENT', dateFields: ['date', 'occurredAt'], referenceFields: ['voucherId', 'eventType'] }
];

const isIsoDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const firstText = (record: HistoricalReplayRecord, fields: string[]): string | null => {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
};

const recordedAt = (record: HistoricalReplayRecord): string | null => {
  const value = typeof record.createdAt === 'string' ? record.createdAt : null;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
};

/**
 * Creates a stable, read-only chronological plan for one company.
 * Same-day events use recordedAt when available; missing timestamps are
 * surfaced as warnings instead of inventing a business ordering.
 */
export function buildHistoricalAccountingReplayPlan(
  input: HistoricalAccountingReplaySnapshot
): HistoricalAccountingReplayPlan {
  const companyId = String(input.companyId || '').trim();
  const startDate = String(input.startDate || '');
  const blockers: string[] = [];
  const warnings: string[] = [];
  const externalDependencies: string[] = [];

  if (!companyId) blockers.push('Seleccione una empresa antes de preparar la reconstrucción.');
  if (!isIsoDate(startDate)) blockers.push('La fecha inicial de reconstrucción no es válida.');

  const collected: HistoricalReplaySourceEvent[] = [];
  let sourceIndex = 0;
  for (const spec of SOURCE_COLLECTIONS) {
    const records = input[spec.collection];
    if (records !== undefined && !Array.isArray(records)) {
      blockers.push('La colección ' + String(spec.collection) + ' no tiene un formato válido.');
      continue;
    }
    const seen = new Set<string>();
    for (const record of (records || []) as HistoricalReplayRecord[]) {
      if (String(record.companyId || '') !== companyId) continue;
      const id = String(record.id || '').trim();
      if (!id || seen.has(id)) {
        blockers.push('La colección ' + String(spec.collection) + ' contiene identificadores vacíos o duplicados.');
        continue;
      }
      seen.add(id);
      const rawDate = firstText(record, spec.dateFields);
      const effectiveDate = rawDate ? rawDate.slice(0, 10) : '';
      if (!isIsoDate(effectiveDate)) {
        blockers.push('El registro ' + String(spec.collection) + '/' + id + ' no conserva una fecha efectiva válida.');
        continue;
      }
      if (effectiveDate < startDate) continue;
      const created = recordedAt(record);
      collected.push({
        key: String(spec.collection) + ':' + id,
        collection: String(spec.collection),
        sourceId: id,
        companyId,
        kind: spec.kind,
        effectiveDate,
        recordedAt: created,
        reference: firstText(record, spec.referenceFields),
        linkedJournalEntryId: typeof record.journalEntryId === 'string' ? record.journalEntryId : null,
        sourceIndex: sourceIndex++
      });
      if (spec.kind === 'VAT_OWN_DECLARATION' && record.status === 'FILED') {
        externalDependencies.push('Declaración IVA propio presentada: ' + id + '. Su rectificación debe coordinarse con el procedimiento fiscal correspondiente.');
      }
      if ((spec.kind === 'VAT_WITHHOLDING_DECLARATION' || spec.kind === 'VAT_OWN_DECLARATION') &&
          (record.status === 'FILED' || Boolean(record.filedAt))) {
        externalDependencies.push('Declaración fiscal presentada vinculada al período: ' + id + '.');
      }
      if (spec.kind === 'BANK_STATEMENT_MOVEMENT' && record.isReconciled === true) {
        externalDependencies.push('Movimiento bancario conciliado: ' + id + '. Requiere recalcular y volver a validar la conciliación.');
      }
    }
  }

  for (const asset of (Array.isArray(input.fixedAssets) ? input.fixedAssets : [])) {
    if (String(asset.companyId || '') !== companyId) continue;
    const assetId = String(asset.id || '').trim();
    for (const event of (Array.isArray(asset.depreciationEvents) ? asset.depreciationEvents : [])) {
      const eventId = String(event.id || '').trim();
      const effectiveDate = String(event.date || '').slice(0, 10);
      if (!isIsoDate(effectiveDate)) {
        blockers.push('La depreciación ' + assetId + '/' + eventId + ' no conserva una fecha efectiva válida.');
        continue;
      }
      if (effectiveDate < startDate) continue;
      collected.push({
        key: 'fixedAssets:' + assetId + ':depreciation:' + eventId,
        collection: 'fixedAssets.depreciationEvents',
        sourceId: eventId,
        companyId,
        kind: 'FIXED_ASSET_DEPRECIATION',
        effectiveDate,
        recordedAt: recordedAt(event),
        reference: String(asset.assetCode || assetId),
        linkedJournalEntryId: typeof event.journalEntryId === 'string' ? event.journalEntryId : null,
        sourceIndex: sourceIndex++
      });
    }
  }

  const requestedThroughDate = input.throughDate ? String(input.throughDate) : '';
  if (requestedThroughDate && !isIsoDate(requestedThroughDate)) {
    blockers.push('La fecha final de reconstrucción no es válida.');
  }
  const latestSourceDate = collected.reduce(
    (latest, event) => event.effectiveDate > latest ? event.effectiveDate : latest,
    startDate
  );
  const throughDate = requestedThroughDate || latestSourceDate;
  if (isIsoDate(startDate) && isIsoDate(throughDate) && throughDate < startDate) {
    blockers.push('La fecha final no puede ser anterior a la fecha inicial.');
  }

  const inRangeEvents = collected.filter(event => event.effectiveDate <= throughDate);
  const orderedEvents = [...inRangeEvents].sort((a, b) =>
    a.effectiveDate.localeCompare(b.effectiveDate) ||
    (a.recordedAt || '').localeCompare(b.recordedAt || '') ||
    a.sourceIndex - b.sourceIndex
  );

  const byDate = new Map<string, HistoricalReplaySourceEvent[]>();
  for (const event of orderedEvents) {
    const sameDay = byDate.get(event.effectiveDate) || [];
    sameDay.push(event);
    byDate.set(event.effectiveDate, sameDay);
  }
  for (const [date, events] of byDate) {
    if (events.length > 1 && events.some(event => !event.recordedAt)) {
      warnings.push('El día ' + date + ' contiene varias operaciones y al menos una carece de marca de registro; debe confirmarse el orden original antes de ejecutar la reconstrucción.');
    }
  }

  const derivedJournalEntryIds = (Array.isArray(input.journalEntries) ? input.journalEntries : [])
    .filter(entry => String(entry.companyId || '') === companyId &&
      isIsoDate(String(entry.date || '')) &&
      String(entry.date) >= startDate && String(entry.date) <= throughDate)
    .map(entry => String(entry.id || '').trim())
    .filter(Boolean);

  const firstYear = isIsoDate(startDate) ? Number(startDate.slice(0, 4)) : 0;
  const lastYear = isIsoDate(throughDate) ? Number(throughDate.slice(0, 4)) : firstYear;
  const affectedExercises: HistoricalReplayExercise[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    const yearStart = year + '-01-01';
    const yearEnd = year + '-12-31';
    affectedExercises.push({
      fiscalYear: year,
      startDate: yearStart < startDate ? startDate : yearStart,
      endDate: yearEnd > throughDate ? throughDate : yearEnd,
      includesYearEndClose: throughDate >= yearEnd,
      includesNextYearOpening: throughDate >= yearEnd && year < lastYear
    });
  }

  if (orderedEvents.length === 0 && blockers.length === 0) {
    warnings.push('No hay operaciones fuente dentro del rango seleccionado; no se generará una reconstrucción vacía.');
  }
  if (externalDependencies.length) {
    warnings.push('Hay declaraciones presentadas o conciliaciones externas que requieren validación antes de confirmar la reconstrucción.');
  }

  return {
    companyId,
    startDate,
    throughDate,
    mode: 'READ_ONLY_PLAN',
    sourceEvents: orderedEvents,
    derivedJournalEntryIds: [...new Set(derivedJournalEntryIds)],
    affectedExercises,
    externalDependencies: [...new Set(externalDependencies)],
    warnings,
    blockers,
    canProceedToTransactionalReplay: blockers.length === 0 && orderedEvents.length > 0
  };
}
