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
  recordedAt?: string;
  entryNumber?: number;
  type?: string;
  referenceDoc?: string;
  invoiceNumber?: string;
  documentType?: string;
  journalEntryId?: string;
  sourceJournalEntryId?: string;
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
  company?: HistoricalReplayRecord;
  accounts?: HistoricalReplayRecord[];
  products?: HistoricalReplayRecord[];
  bankAccounts?: HistoricalReplayRecord[];
  customers?: HistoricalReplayRecord[];
  suppliers?: HistoricalReplayRecord[];
  financialDisclosures?: HistoricalReplayRecord[];
}

export type HistoricalReplaySourceKind =
  | 'PURCHASE'
  | 'PURCHASE_ACCOUNT_CREDIT'
  | 'SALE'
  | 'INVENTORY_MOVEMENT'
  | 'BANK_STATEMENT_MOVEMENT'
  | 'CREDIT_SETTLEMENT'
  | 'SUPPLIER_ADVANCE_SETTLEMENT'
  | 'SUPPLIER_DIRECT_ADVANCE'
  | 'FIXED_ASSET'
  | 'FIXED_ASSET_PLACED_IN_SERVICE'
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
  /** Other journal entries related to the source document, including entries posted on a different effective date. */
  relatedJournalEntryIds?: string[];
  sourceIndex: number;
}

export interface HistoricalReplayExercise {
  fiscalYear: number;
  startDate: string;
  endDate: string;
  includesYearEndClose: boolean;
  includesNextYearOpening: boolean;
}


export interface HistoricalReplayContextCoverage {
  companyMetadata: boolean;
  taxStatusPeriods: number;
  accountingBcvRateEntries: number;
  functionalCurrencyAssessments: number;
  exchangeabilityAssessments: number;
  chartOfAccounts: number;
  inventoryProducts: number;
  bankAccounts: number;
  customers: number;
  suppliers: number;
  financialDisclosures: number;
}

export interface HistoricalReplaySourceDependency {
  sourceKey: string;
  targetKey: string;
  sourceCollection: string;
  sourceId: string;
  targetCollection: string;
  targetId: string;
  relationType: string;
}

export interface HistoricalReplayJournalEntryRelationship {
  entryId: string;
  relatedEntryId: string;
  relationType: 'REVERSAL_OF' | 'REVERSED_BY' | 'ADJUSTMENT_FOR';
  entryDate: string;
  relatedEntryDate: string;
}

export interface HistoricalAccountingReplayPlan {
  companyId: string;
  startDate: string;
  throughDate: string;
  mode: 'READ_ONLY_PLAN';
  sourceEvents: HistoricalReplaySourceEvent[];
  derivedJournalEntryIds: string[];
  journalEntryRelationships: HistoricalReplayJournalEntryRelationship[];
  sourceDependencies: HistoricalReplaySourceDependency[];
  contextCoverage: HistoricalReplayContextCoverage;
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
  { collection: 'purchases', kind: 'PURCHASE', dateFields: ['invoiceDate', 'date'], referenceFields: ['invoiceNumber', 'controlNumber'] },
  { collection: 'sales', kind: 'SALE', dateFields: ['invoiceDate', 'date'], referenceFields: ['invoiceNumber', 'controlNumber'] },
  { collection: 'movements', kind: 'INVENTORY_MOVEMENT', dateFields: ['date'], referenceFields: ['documentRef', 'concept'] },
  { collection: 'bankStatementMovements', kind: 'BANK_STATEMENT_MOVEMENT', dateFields: ['date'], referenceFields: ['reference', 'description'] },
  { collection: 'creditSettlements', kind: 'CREDIT_SETTLEMENT', dateFields: ['settlementDate', 'date'], referenceFields: ['reference', 'documentId'] },
  { collection: 'supplierAdvanceSettlements', kind: 'SUPPLIER_ADVANCE_SETTLEMENT', dateFields: ['settlementDate', 'date'], referenceFields: ['targetPurchaseId', 'supplierRif'] },
  { collection: 'supplierDirectAdvances', kind: 'SUPPLIER_DIRECT_ADVANCE', dateFields: ['date'], referenceFields: ['reference', 'supplierRif'] },
  { collection: 'fixedAssets', kind: 'FIXED_ASSET', dateFields: ['acquisitionDate'], referenceFields: ['assetCode', 'description'] },
  { collection: 'vatVouchers', kind: 'VAT_VOUCHER', dateFields: ['fiscalDate'], referenceFields: ['voucherNumber', 'invoiceNumber', 'controlNumber'] },
  { collection: 'islrVouchers', kind: 'ISLR_VOUCHER', dateFields: ['date'], referenceFields: ['documentNumber', 'reference'] },
  { collection: 'vatWithholdingDeclarations', kind: 'VAT_WITHHOLDING_DECLARATION', dateFields: ['periodEndDate', 'endDate', 'date'], referenceFields: ['period', 'declarationNumber'] },
  { collection: 'vatWithholdingDeclarationEvents', kind: 'VAT_WITHHOLDING_EVENT', dateFields: ['date', 'occurredAt'], referenceFields: ['declarationId', 'eventType'] },
  { collection: 'vatOwnDeclarations', kind: 'VAT_OWN_DECLARATION', dateFields: ['periodEndDate', 'endDate', 'date'], referenceFields: ['period', 'declarationNumber'] },
  { collection: 'vatOwnDeclarationEvents', kind: 'VAT_OWN_EVENT', dateFields: ['occurredAt', 'date'], referenceFields: ['declarationId', 'eventType'] },
  { collection: 'islrFiscalEvents', kind: 'ISLR_FISCAL_EVENT', dateFields: ['fiscalDate'], referenceFields: ['voucherId', 'kind'] }
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
  const value = typeof record.createdAt === 'string' ? record.createdAt : typeof record.recordedAt === 'string' ? record.recordedAt : null;
  return value && Number.isFinite(Date.parse(value)) ? value : null;
};

const collectRelatedJournalEntryIds = (record: HistoricalReplayRecord): string[] => {
  const ids: unknown[] = [
    record.journalEntryId,
    record.sourceJournalEntryId,
    record.reconciledWithJournalEntryId,
    record.cancelledByJournalEntryId,
    record.correctionEntryId,
    record.reversedByJournalEntryId
  ];
  for (const field of ['reconciledJournalEntryIds', 'correctionEntryIds']) {
    const value = record[field];
    if (Array.isArray(value)) ids.push(...value);
  }
  return [...new Set(ids.filter((value): value is string =>
    typeof value === 'string' && value.trim().length > 0
  ).map(value => value.trim()))];
};

/**
 * Returns only orphaned withholding events that can be attributed to the
 * selected company. Legacy events without a source declaration and without an
 * explicit companyId cannot safely block another company's reconstruction.
 */
/**
 * Detects explicit cross-company links between a withholding event and its
 * source declaration. The mismatch is relevant to either company involved;
 * it must never be silently reassigned to the declaration's company.
 */
export function findCrossCompanyVatWithholdingEvents(
  events: HistoricalReplayRecord[],
  declarations: HistoricalReplayRecord[],
  companyId: string
): HistoricalReplayRecord[] {
  const declarationById = new Map(
    declarations.map(declaration => [String(declaration.id || ''), declaration] as const)
  );
  return events.filter(event => {
    const declaration = declarationById.get(String(event.declarationId || ''));
    if (!declaration) return false;
    const eventCompanyId = String(event.companyId || '').trim();
    const declarationCompanyId = String(declaration.companyId || '').trim();
    if (!eventCompanyId || !declarationCompanyId || eventCompanyId === declarationCompanyId) return false;
    return eventCompanyId === companyId || declarationCompanyId === companyId;
  });
}

export function findOrphanedVatWithholdingEvents(
  events: HistoricalReplayRecord[],
  declarations: HistoricalReplayRecord[],
  companyId: string
): HistoricalReplayRecord[] {
  const declarationById = new Map(
    declarations.map(declaration => [String(declaration.id || ''), declaration] as const)
  );
  return events.filter(event => {
    const declaration = declarationById.get(String(event.declarationId || ''));
    if (declaration) return false;
    return String(event.companyId || '') === companyId;
  });
}

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
  if (!companyId) blockers.push('La reconstrucción histórica requiere una empresa válida.');
  if (!isIsoDate(startDate)) blockers.push('La fecha inicial de reconstrucción no es válida.');
  const externalDependencies: string[] = [];
  const purchaseById = new Map(
    (Array.isArray(input.purchases) ? input.purchases : []).map(record => [String(record.id || ''), record] as const)
  );
  const allJournalEntries = Array.isArray(input.journalEntries) ? input.journalEntries : [];
  const allJournalEntryById = new Map(allJournalEntries.map(entry => [String(entry.id || ''), entry] as const));
  const companyJournalEntries = allJournalEntries.filter(entry => String(entry.companyId || '') === companyId);
  const journalEntryById = new Map(companyJournalEntries.map(entry => [String(entry.id || ''), entry] as const));
  const expandJournalEntryDependencies = (seedIds: string[]): string[] => {
    const visited = new Set<string>();
    const queue = [...seedIds];
    while (queue.length) {
      const id = String(queue.shift() || '').trim();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      const entry = journalEntryById.get(id);
      if (!entry) continue;
      for (const field of ['reversalOfEntryId', 'reversedByEntryId', 'adjustmentForEntryId']) {
        const relatedId = entry[field];
        if (typeof relatedId === 'string' && relatedId.trim() && !visited.has(relatedId.trim())) {
          queue.push(relatedId.trim());
        }
      }
    }
    return [...visited];
  };
  const relatedJournalEntryIdsFor = (kind: HistoricalReplaySourceKind, record: HistoricalReplayRecord): string[] => {
    const ids = collectRelatedJournalEntryIds(record);
    if (kind === 'VAT_VOUCHER' && record.purchaseRecordId) {
      const purchase = purchaseById.get(String(record.purchaseRecordId));
      if (purchase && String(purchase.companyId || '') === companyId) {
        ids.push(...collectRelatedJournalEntryIds(purchase));
      }
    }
    if (kind === 'ISLR_VOUCHER') {
      for (const event of (Array.isArray(input.islrFiscalEvents) ? input.islrFiscalEvents : [])) {
        if (String(event.companyId || '') === companyId && String(event.voucherId || '') === String(record.id || '')) {
          ids.push(...collectRelatedJournalEntryIds(event));
        }
      }
    }
    return expandJournalEntryDependencies([...new Set(ids)]);
  };

  const sourceCollections: Record<string, HistoricalReplayRecord[]> = {
    purchases: (Array.isArray(input.purchases) ? input.purchases : []) as HistoricalReplayRecord[],
    sales: (Array.isArray(input.sales) ? input.sales : []) as HistoricalReplayRecord[],
    movements: (Array.isArray(input.movements) ? input.movements : []) as HistoricalReplayRecord[],
    bankStatementMovements: (Array.isArray(input.bankStatementMovements) ? input.bankStatementMovements : []) as HistoricalReplayRecord[],
    creditSettlements: (Array.isArray(input.creditSettlements) ? input.creditSettlements : []) as HistoricalReplayRecord[],
    supplierAdvanceSettlements: (Array.isArray(input.supplierAdvanceSettlements) ? input.supplierAdvanceSettlements : []) as HistoricalReplayRecord[],
    supplierDirectAdvances: (Array.isArray(input.supplierDirectAdvances) ? input.supplierDirectAdvances : []) as HistoricalReplayRecord[],
    fixedAssets: (Array.isArray(input.fixedAssets) ? input.fixedAssets : []) as HistoricalReplayRecord[],
    vatVouchers: (Array.isArray(input.vatVouchers) ? input.vatVouchers : []) as HistoricalReplayRecord[],
    islrVouchers: (Array.isArray(input.islrVouchers) ? input.islrVouchers : []) as HistoricalReplayRecord[],
    vatWithholdingDeclarations: (Array.isArray(input.vatWithholdingDeclarations) ? input.vatWithholdingDeclarations : []) as HistoricalReplayRecord[],
    vatWithholdingDeclarationEvents: (Array.isArray(input.vatWithholdingDeclarationEvents) ? input.vatWithholdingDeclarationEvents : []) as HistoricalReplayRecord[],
    vatOwnDeclarations: (Array.isArray(input.vatOwnDeclarations) ? input.vatOwnDeclarations : []) as HistoricalReplayRecord[],
    vatOwnDeclarationEvents: (Array.isArray(input.vatOwnDeclarationEvents) ? input.vatOwnDeclarationEvents : []) as HistoricalReplayRecord[],
    islrFiscalEvents: (Array.isArray(input.islrFiscalEvents) ? input.islrFiscalEvents : []) as HistoricalReplayRecord[],
    journalEntries: allJournalEntries as HistoricalReplayRecord[]
  };
  const findSourceRecord = (collection: string, id: string): HistoricalReplayRecord | undefined =>
    (sourceCollections[collection] || []).find(item => String(item.id || '') === id);
  const sourceDependencies: HistoricalReplaySourceDependency[] = [];
  const addSourceDependency = (
    sourceCollection: string, sourceIdValue: unknown,
    targetCollection: string, targetIdValue: unknown, relationType: string
  ): void => {
    const sourceId = String(sourceIdValue || '').trim();
    const targetId = String(targetIdValue || '').trim();
    if (!sourceId || !targetId) return;
    const sourceRecord = findSourceRecord(sourceCollection, sourceId);
    if (!sourceRecord || String(sourceRecord.companyId || '') !== companyId) return;
    const targetRecord = findSourceRecord(targetCollection, targetId);
    if (!targetRecord) {
      blockers.push('El registro ' + sourceCollection + '/' + sourceId +
        ' referencia el registro inexistente ' + targetCollection + '/' + targetId + '.');
      return;
    }
    if (String(targetRecord.companyId || '') !== companyId) {
      blockers.push('El registro ' + sourceCollection + '/' + sourceId +
        ' referencia ' + targetCollection + '/' + targetId + ' de otra empresa.');
      return;
    }
    sourceDependencies.push({
      sourceKey: sourceCollection + ':' + sourceId,
      targetKey: targetCollection + ':' + targetId,
      sourceCollection, sourceId, targetCollection, targetId, relationType
    });
  };

  for (const purchase of sourceCollections.purchases.filter(item => String(item.companyId || '') === companyId)) {
    if (purchase.originalPurchaseId) addSourceDependency('purchases', purchase.id, 'purchases', purchase.originalPurchaseId, 'CORRECTS_PURCHASE');
  }
  for (const sale of sourceCollections.sales.filter(item => String(item.companyId || '') === companyId)) {
    if (sale.originalSaleId) addSourceDependency('sales', sale.id, 'sales', sale.originalSaleId, 'CORRECTS_SALE');
  }
  for (const movement of sourceCollections.movements.filter(item => String(item.companyId || '') === companyId)) {
    if (movement.correctionForMovementId) addSourceDependency('movements', movement.id, 'movements', movement.correctionForMovementId, 'CORRECTS_INVENTORY_MOVEMENT');
  }
  for (const voucher of sourceCollections.vatVouchers.filter(item => String(item.companyId || '') === companyId)) {
    if (voucher.purchaseRecordId) addSourceDependency('vatVouchers', voucher.id, 'purchases', voucher.purchaseRecordId, 'VAT_WITHHOLDING_FOR_PURCHASE');
  }
  for (const event of sourceCollections.islrFiscalEvents.filter(item => String(item.companyId || '') === companyId)) {
    if (event.voucherId) addSourceDependency('islrFiscalEvents', event.id, 'islrVouchers', event.voucherId, 'ISLR_EVENT_FOR_VOUCHER');
    if (event.reversalOfEventId) addSourceDependency('islrFiscalEvents', event.id, 'islrFiscalEvents', event.reversalOfEventId, 'REVERSAL_OF_ISLR_EVENT');
    for (const allocation of (Array.isArray(event.allocations) ? event.allocations : []) as HistoricalReplayRecord[]) {
      if (allocation.purchaseId) addSourceDependency('islrFiscalEvents', event.id, 'purchases', allocation.purchaseId, 'ISLR_EVENT_FOR_PURCHASE');
    }
  }
  for (const declaration of sourceCollections.vatWithholdingDeclarations.filter(item => String(item.companyId || '') === companyId)) {
    for (const voucherId of (Array.isArray(declaration.voucherIds) ? declaration.voucherIds : [])) {
      addSourceDependency('vatWithholdingDeclarations', declaration.id, 'vatVouchers', voucherId, 'DECLARATION_INCLUDES_VAT_VOUCHER');
    }
  }
  for (const event of sourceCollections.vatWithholdingDeclarationEvents.filter(item => String(item.companyId || '') === companyId)) {
    if (event.declarationId) addSourceDependency('vatWithholdingDeclarationEvents', event.id, 'vatWithholdingDeclarations', event.declarationId, 'VAT_WITHHOLDING_EVENT_FOR_DECLARATION');
    for (const movementId of (Array.isArray(event.bankStatementMovementIds) ? event.bankStatementMovementIds : [])) {
      addSourceDependency('vatWithholdingDeclarationEvents', event.id, 'bankStatementMovements', movementId, 'VAT_WITHHOLDING_PAYMENT_BANK_SUPPORT');
    }
  }
  for (const declaration of sourceCollections.vatOwnDeclarations.filter(item => String(item.companyId || '') === companyId)) {
    for (const sourceId of [...(Array.isArray(declaration.sourceIds) ? declaration.sourceIds : []),
      ...(Array.isArray(declaration.relatedSourceIds) ? declaration.relatedSourceIds : [])]) {
      const candidates = ['sales', 'purchases', 'journalEntries'].filter(collection =>
        Boolean(findSourceRecord(collection, String(sourceId || '')))
      );
      if (candidates.length !== 1) {
        blockers.push('La declaración de IVA propio ' + String(declaration.id || '') +
          ' no puede resolver de forma única su fuente ' + String(sourceId || '') + '.');
      } else {
        addSourceDependency('vatOwnDeclarations', declaration.id, candidates[0], sourceId, 'VAT_OWN_DECLARATION_SOURCE');
      }
    }
  }
  for (const event of sourceCollections.vatOwnDeclarationEvents.filter(item => String(item.companyId || '') === companyId)) {
    if (event.declarationId) addSourceDependency('vatOwnDeclarationEvents', event.id, 'vatOwnDeclarations', event.declarationId, 'VAT_OWN_EVENT_FOR_DECLARATION');
    if (event.reversalOfEventId) addSourceDependency('vatOwnDeclarationEvents', event.id, 'vatOwnDeclarationEvents', event.reversalOfEventId, 'REVERSAL_OF_VAT_OWN_EVENT');
  }
  for (const settlement of sourceCollections.creditSettlements.filter(item => String(item.companyId || '') === companyId)) {
    const targetCollection = settlement.kind === 'SALE_COLLECTION' ? 'sales' : 'purchases';
    addSourceDependency('creditSettlements', settlement.id, targetCollection, settlement.documentId, 'SETTLEMENT_FOR_DOCUMENT');
    if (settlement.bankAccountId) {
      const bank = (Array.isArray(input.bankAccounts) ? input.bankAccounts : [])
        .find(item => String(item.id || '') === String(settlement.bankAccountId) && String(item.companyId || '') === companyId);
      if (!bank) blockers.push('La liquidación ' + String(settlement.id || '') + ' referencia una cuenta bancaria inexistente o de otra empresa.');
    }
  }
  for (const settlement of sourceCollections.supplierAdvanceSettlements.filter(item => String(item.companyId || '') === companyId)) {
    for (const creditNoteId of (Array.isArray(settlement.sourceCreditNoteIds) ? settlement.sourceCreditNoteIds : [])) {
      addSourceDependency('supplierAdvanceSettlements', settlement.id, 'purchases', creditNoteId, 'SUPPLIER_ADVANCE_FROM_CREDIT_NOTE');
    }
    for (const directAdvanceId of (Array.isArray(settlement.sourceDirectAdvanceIds) ? settlement.sourceDirectAdvanceIds : [])) {
      addSourceDependency('supplierAdvanceSettlements', settlement.id, 'supplierDirectAdvances', directAdvanceId, 'SUPPLIER_ADVANCE_FROM_DIRECT_DISBURSEMENT');
    }
    if (settlement.targetPurchaseId) addSourceDependency('supplierAdvanceSettlements', settlement.id, 'purchases', settlement.targetPurchaseId, 'SUPPLIER_ADVANCE_APPLIED_TO_PURCHASE');
  }
  for (const asset of sourceCollections.fixedAssets.filter(item => String(item.companyId || '') === companyId)) {
    if (asset.sourceJournalEntryId) addSourceDependency('fixedAssets', asset.id, 'journalEntries', asset.sourceJournalEntryId, 'FIXED_ASSET_ACQUISITION_ENTRY');
    for (const event of (Array.isArray(asset.depreciationEvents) ? asset.depreciationEvents : []) as HistoricalReplayRecord[]) {
      if (event.journalEntryId) addSourceDependency('fixedAssets', asset.id, 'journalEntries', event.journalEntryId, 'FIXED_ASSET_DEPRECIATION_ENTRY');
    }
  }

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
      const created = recordedAt(record);
      if (spec.kind === 'PURCHASE' && record.accountCreditDate !== undefined && record.accountCreditDate !== null && record.accountCreditDate !== '') {
        const accountCreditDate = String(record.accountCreditDate).slice(0, 10);
        if (!isIsoDate(accountCreditDate)) {
          blockers.push('La compra ' + id + ' no conserva una fecha válida de abono en cuenta.');
        } else if (accountCreditDate >= startDate) {
          collected.push({
            key: 'purchases:' + id + ':account-credit',
            collection: 'purchases.accountCreditDate',
            sourceId: id,
            companyId,
            kind: 'PURCHASE_ACCOUNT_CREDIT',
            effectiveDate: accountCreditDate,
            recordedAt: created,
            reference: firstText(record, spec.referenceFields),
            linkedJournalEntryId: typeof record.journalEntryId === 'string' ? record.journalEntryId : null,
            relatedJournalEntryIds: relatedJournalEntryIdsFor(spec.kind, record),
            sourceIndex: sourceIndex++
          });
        }
      }
      if (effectiveDate < startDate) continue;
      collected.push({
        key: String(spec.collection) + ':' + id,
        collection: String(spec.collection),
        sourceId: id,
        companyId,
        kind: spec.kind,
        effectiveDate,
        recordedAt: created,
        reference: firstText(record, spec.referenceFields),
        linkedJournalEntryId: spec.kind === 'PURCHASE' ? null : (spec.kind === 'FIXED_ASSET' ? (typeof record.sourceJournalEntryId === 'string' ? record.sourceJournalEntryId : null) : (typeof record.journalEntryId === 'string' ? record.journalEntryId : null)),
        relatedJournalEntryIds: relatedJournalEntryIdsFor(spec.kind, record),
        sourceIndex: sourceIndex++
      });
      if (spec.kind === 'VAT_OWN_DECLARATION' && (record.status === 'FILED' || Boolean(record.filedAt))) {
        externalDependencies.push('Declaración IVA propio presentada: ' + id + '. Su rectificación debe coordinarse con el procedimiento fiscal correspondiente.');
      } else if (spec.kind === 'VAT_WITHHOLDING_DECLARATION' &&
          (record.status === 'FILED' || Boolean(record.filedAt))) {
        externalDependencies.push('Declaración de retenciones IVA presentada: ' + id + '. Su rectificación debe coordinarse con el procedimiento fiscal correspondiente.');
      }
      if ((spec.kind === 'VAT_WITHHOLDING_EVENT' || spec.kind === 'VAT_OWN_EVENT') && record.eventType === 'FILED') {
        externalDependencies.push('Declaración fiscal presentada mediante evento ' + id + '. Su rectificación debe coordinarse con el procedimiento fiscal correspondiente.');
      }
      if (spec.kind === 'BANK_STATEMENT_MOVEMENT' && record.isReconciled === true) {
        externalDependencies.push('Movimiento bancario conciliado: ' + id + '. Requiere recalcular y volver a validar la conciliación.');
      }
    }
  }

  for (const asset of (Array.isArray(input.fixedAssets) ? input.fixedAssets : [])) {
    if (String(asset.companyId || '') !== companyId) continue;
    const assetId = String(asset.id || '').trim();
    const serviceDate = String(asset.serviceDate || '').slice(0, 10);
    if (serviceDate && serviceDate !== String(asset.acquisitionDate || '').slice(0, 10)) {
      if (!isIsoDate(serviceDate)) {
        blockers.push('El activo fijo ' + assetId + ' no conserva una fecha válida de puesta en servicio.');
      } else if (serviceDate >= startDate) {
        collected.push({
          key: 'fixedAssets:' + assetId + ':service',
          collection: 'fixedAssets.serviceDate',
          sourceId: assetId,
          companyId,
          kind: 'FIXED_ASSET_PLACED_IN_SERVICE',
          effectiveDate: serviceDate,
          recordedAt: recordedAt(asset),
          reference: String(asset.assetCode || assetId),
          linkedJournalEntryId: null,
          relatedJournalEntryIds: relatedJournalEntryIdsFor('FIXED_ASSET_PLACED_IN_SERVICE', asset),
          sourceIndex: sourceIndex++
        });
      }
    }
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
        relatedJournalEntryIds: relatedJournalEntryIdsFor('FIXED_ASSET_DEPRECIATION', event),
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
  const latestJournalEntryDate = (Array.isArray(input.journalEntries) ? input.journalEntries : [])
    .filter(entry => String(entry.companyId || '') === companyId)
    .map(entry => String(entry.date || '').slice(0, 10))
    .filter(date => isIsoDate(date) && date >= startDate)
    .reduce((latest, date) => date > latest ? date : latest, startDate);
  const latestKnownDate = latestJournalEntryDate > latestSourceDate ? latestJournalEntryDate : latestSourceDate;
  const throughDate = requestedThroughDate || latestKnownDate;
  if (isIsoDate(startDate) && isIsoDate(throughDate) && throughDate < startDate) {
    blockers.push('La fecha final no puede ser anterior a la fecha inicial.');
  }

  const validatedLinks = new Set<string>();
  for (const event of collected) {
    for (const journalEntryId of event.relatedJournalEntryIds || []) {
      const validationKey = event.key + '|' + journalEntryId;
      if (validatedLinks.has(validationKey)) continue;
      validatedLinks.add(validationKey);
      const linkedEntry = allJournalEntryById.get(journalEntryId);
      if (!linkedEntry) {
        blockers.push('El documento ' + event.collection + '/' + event.sourceId +
          ' referencia el asiento contable inexistente ' + journalEntryId + '.');
      } else if (String(linkedEntry.companyId || '') !== companyId) {
        blockers.push('El documento ' + event.collection + '/' + event.sourceId +
          ' referencia el asiento ' + journalEntryId + ' de otra empresa.');
      }
    }
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
      const message = 'El día ' + date + ' contiene varias operaciones y al menos una carece de marca de registro; no se puede establecer el orden cronológico real y la reconstrucción queda bloqueada.';
      warnings.push(message);
      blockers.push(message);
      continue;
    }
    if (events.length > 1) {
      const timestamps = events.map(event => String(event.recordedAt || ''));
      if ( new Set(timestamps).size !== timestamps.length ) {
        const message = 'El día ' + date + ' contiene marcas de registro repetidas; no se puede determinar el orden real de esas operaciones y la reconstrucción queda bloqueada.';
        warnings.push(message);
        blockers.push(message);
      }
    }
  }

  const journalEntryRelationships: HistoricalReplayJournalEntryRelationship[] = [];
  const relationshipFields = [
    ['reversalOfEntryId', 'REVERSAL_OF'],
    ['reversedByEntryId', 'REVERSED_BY'],
    ['adjustmentForEntryId', 'ADJUSTMENT_FOR']
  ] as const;
  for (const entry of companyJournalEntries) {
    const entryId = String(entry.id || '').trim();
    const entryDate = String(entry.date || '').slice(0, 10);
    if (!entryId || !isIsoDate(entryDate)) {
      blockers.push('Hay un asiento de la empresa sin identificador o fecha válida.');
      continue;
    }
    for (const [field, relationType] of relationshipFields) {
      const relatedValue = entry[field];
      if (typeof relatedValue !== 'string' || !relatedValue.trim()) continue;
      const relatedId = relatedValue.trim();
      const relatedEntry = allJournalEntryById.get(relatedId);
      if (!relatedEntry) {
        blockers.push('El asiento ' + entryId + ' referencia el asiento relacionado inexistente ' + relatedId + '.');
      } else if (String(relatedEntry.companyId || '') !== companyId) {
        blockers.push('El asiento ' + entryId + ' referencia el asiento relacionado ' + relatedId + ' de otra empresa.');
      } else {
        const relatedDate = String(relatedEntry.date || '').slice(0, 10);
        if (!isIsoDate(relatedDate)) {
          blockers.push('El asiento relacionado ' + relatedId + ' no conserva una fecha válida.');
        } else {
          journalEntryRelationships.push({ entryId, relatedEntryId: relatedId, relationType, entryDate, relatedEntryDate: relatedDate });
        }
      }
    }
  }

  const inRangeJournalEntryIds = companyJournalEntries
    .filter(entry => isIsoDate(String(entry.date || '')) &&
      String(entry.date) >= startDate && String(entry.date) <= throughDate)
    .map(entry => String(entry.id || '').trim())
    .filter(Boolean);
  const derivedJournalEntryIds = expandJournalEntryDependencies(inRangeJournalEntryIds);
  for (const id of derivedJournalEntryIds) {
    const entry = allJournalEntryById.get(id);
    if (entry && isIsoDate(String(entry.date || '')) &&
        (String(entry.date) < startDate || String(entry.date) > throughDate)) {
      externalDependencies.push('El asiento relacionado ' + id + ' está fuera del rango solicitado y debe revisarse junto con su vínculo de reversión o ajuste.');
    }
  }

  const company: HistoricalReplayRecord = input.company || {};
  const taxStatusHistory = Array.isArray(company.taxStatusHistory) ? company.taxStatusHistory as HistoricalReplayRecord[] : [];
  const bcvHistory = Array.isArray(company.accountingBcvRateHistory) ? company.accountingBcvRateHistory as HistoricalReplayRecord[] : [];
  const functionalCurrencyAssessments = Array.isArray(company.functionalCurrencyAssessments) ? company.functionalCurrencyAssessments as HistoricalReplayRecord[] : [];
  const exchangeabilityAssessments = Array.isArray(company.exchangeabilityAssessments) ? company.exchangeabilityAssessments as HistoricalReplayRecord[] : [];
  const accounts = Array.isArray(input.accounts) ? input.accounts : [];
  const products = (Array.isArray(input.products) ? input.products : []).filter(item => String(item.companyId || '') === companyId);
  const bankAccounts = (Array.isArray(input.bankAccounts) ? input.bankAccounts : []).filter(item => String(item.companyId || '') === companyId);
  const contextCoverage: HistoricalReplayContextCoverage = {
    companyMetadata: String(company.id || '') === companyId,
    taxStatusPeriods: taxStatusHistory.length,
    accountingBcvRateEntries: bcvHistory.length,
    functionalCurrencyAssessments: functionalCurrencyAssessments.length,
    exchangeabilityAssessments: exchangeabilityAssessments.length,
    chartOfAccounts: accounts.length,
    inventoryProducts: products.length,
    bankAccounts: bankAccounts.length,
    customers: (Array.isArray(input.customers) ? input.customers : []).filter(item => String(item.companyId || '') === companyId).length,
    suppliers: (Array.isArray(input.suppliers) ? input.suppliers : []).filter(item => String(item.companyId || '') === companyId).length,
    financialDisclosures: (Array.isArray(input.financialDisclosures) ? input.financialDisclosures : []).filter(item => String(item.companyId || '') === companyId).length
  };

  if (input.company && String(input.company.id || '') !== companyId) {
    blockers.push('Los datos generales de la empresa no corresponden a la empresa seleccionada.');
  }
  const taxPeriodsSorted = [...taxStatusHistory].sort((a, b) => String(a.effectiveFrom || '').localeCompare(String(b.effectiveFrom || '')));
  let previousTaxPeriodEnd = '';
  for (const period of taxPeriodsSorted) {
    const from = String(period.effectiveFrom || '');
    const to = period.effectiveTo ? String(period.effectiveTo) : '';
    if (!isIsoDate(from) || (to && (!isIsoDate(to) || to < from))) {
      blockers.push('El historial de condición tributaria contiene un tramo con fechas inválidas.');
      continue;
    }
    if (previousTaxPeriodEnd && from <= previousTaxPeriodEnd) {
      blockers.push('El historial de condición tributaria contiene tramos solapados.');
    }
    previousTaxPeriodEnd = to || '9999-12-31';
  }
  for (const rate of bcvHistory) {
    if (!isIsoDate(String(rate.effectiveDate || '')) || !Number.isFinite(Number(rate.rate)) || Number(rate.rate) <= 0) {
      blockers.push('El historial BCV contable contiene una tasa o fecha inválida.');
    }
  }
  if (taxStatusHistory.length === 0 && orderedEvents.some(event =>
      ['PURCHASE', 'PURCHASE_ACCOUNT_CREDIT', 'SALE', 'VAT_VOUCHER', 'ISLR_VOUCHER', 'VAT_WITHHOLDING_DECLARATION', 'VAT_WITHHOLDING_EVENT', 'VAT_OWN_DECLARATION', 'VAT_OWN_EVENT', 'ISLR_FISCAL_EVENT'].includes(event.kind))) {
    warnings.push('La empresa no tiene historial tributario por vigencia documentado; la reconstrucción deberá validar expresamente la condición aplicable a cada fecha sin inferirla.');
  }
  if (taxStatusHistory.length > 0) {
    const taxSensitiveKinds = new Set<HistoricalReplaySourceKind>([
      'PURCHASE', 'PURCHASE_ACCOUNT_CREDIT', 'SALE', 'VAT_VOUCHER', 'ISLR_VOUCHER', 'ISLR_FISCAL_EVENT'
    ]);
    for (const event of orderedEvents) {
      if (!taxSensitiveKinds.has(event.kind)) continue;
      const matchingPeriods = taxPeriodsSorted.filter(period => {
        const from = String(period.effectiveFrom || '');
        const to = period.effectiveTo ? String(period.effectiveTo) : '';
        return from <= event.effectiveDate && (!to || event.effectiveDate <= to);
      });
      if (matchingPeriods.length !== 1) {
        blockers.push('La operación ' + event.collection + '/' + event.sourceId +
          ' no tiene exactamente un tramo de condición tributaria vigente para ' + event.effectiveDate + '.');
      }
    }
  }
  if (!company.accountingFramework || !company.accountingFrameworkVersion || !company.accountingFrameworkAdoptionDate) {
    warnings.push('El marco contable, su versión o su fecha documentada de adopción están incompletos; requieren criterio profesional antes de recalcular estados históricos.');
  }

  const accountByCode = new Map(accounts.map(account => [String(account.code || ''), account] as const));
  if (input.accounts) {
    for (const entry of companyJournalEntries.filter(item => isIsoDate(String(item.date || '')) &&
        String(item.date) >= startDate && String(item.date) <= throughDate)) {
      for (const line of (Array.isArray(entry.items) ? entry.items : []) as HistoricalReplayRecord[]) {
        const code = String(line.accountCode || '');
        const account = accountByCode.get(code);
        if (!account) blockers.push('El asiento ' + String(entry.id || '') + ' utiliza una cuenta no encontrada en el catálogo actual: ' + code + '.');
        else if (account.isMovement === false) blockers.push('El asiento ' + String(entry.id || '') + ' utiliza una cuenta no imputable: ' + code + '.');
      }
    }
  }
  if (input.products) {
    const productIds = new Set(products.map(product => String(product.id || '')));
    for (const movement of (Array.isArray(input.movements) ? input.movements : []).filter(item => String(item.companyId || '') === companyId)) {
      if (!productIds.has(String(movement.productId || ''))) {
        blockers.push('El movimiento de inventario ' + String(movement.id || '') + ' referencia un artículo inexistente en el catálogo de la empresa.');
      }
    }
    for (const purchase of (Array.isArray(input.purchases) ? input.purchases : []).filter(item => String(item.companyId || '') === companyId)) {
      for (const line of (Array.isArray(purchase.inventoryLines) ? purchase.inventoryLines : []) as HistoricalReplayRecord[]) {
        if (!productIds.has(String(line.productId || ''))) blockers.push('La compra ' + String(purchase.id || '') + ' contiene una línea de inventario sin artículo maestro válido.');
      }
    }
    for (const sale of (Array.isArray(input.sales) ? input.sales : []).filter(item => String(item.companyId || '') === companyId)) {
      for (const line of (Array.isArray(sale.inventoryLines) ? sale.inventoryLines : []) as HistoricalReplayRecord[]) {
        if (!productIds.has(String(line.productId || ''))) blockers.push('La venta ' + String(sale.id || '') + ' contiene una línea de inventario sin artículo maestro válido.');
      }
    }
  }
  if (input.bankAccounts) {
    const bankAccountById = new Map(bankAccounts.map(account => [String(account.id || ''), account] as const));
    for (const movement of (Array.isArray(input.bankStatementMovements) ? input.bankStatementMovements : []).filter(item => String(item.companyId || '') === companyId)) {
      const bank = bankAccountById.get(String(movement.bankAccountId || ''));
      if (!bank) blockers.push('El movimiento bancario ' + String(movement.id || '') + ' referencia una cuenta bancaria inexistente.');
      else if (input.accounts && !accountByCode.has(String(bank.accountCode || ''))) {
        blockers.push('La cuenta bancaria ' + String(bank.id || '') + ' referencia una cuenta contable inexistente: ' + String(bank.accountCode || '') + '.');
      }
    }
  }

  if (input.accounts) {
    const requireMovementAccount = (label: string, accountCodeValue: unknown): void => {
      const accountCode = String(accountCodeValue || '').trim();
      if (!accountCode) return;
      const account = accountByCode.get(accountCode);
      if (!account) blockers.push(label + ' referencia una cuenta contable inexistente: ' + accountCode + '.');
      else if (account.isMovement === false) blockers.push(label + ' referencia una cuenta contable no imputable: ' + accountCode + '.');
    };
    for (const bank of bankAccounts) requireMovementAccount('La cuenta bancaria ' + String(bank.id || ''), bank.accountCode);
    for (const product of products) {
      for (const field of ['inventoryAccountCode', 'costOfSalesAccountCode', 'adjustmentAccountCode', 'openingBalanceAccountCode']) {
        requireMovementAccount('El artículo ' + String(product.id || ''), product[field]);
      }
    }
    for (const purchase of sourceCollections.purchases.filter(item => String(item.companyId || '') === companyId)) {
      requireMovementAccount('La compra ' + String(purchase.id || ''), purchase.paymentAccountCode);
      const review = purchase.supplierDebitNoteReview;
      if (review && typeof review === 'object') {
        const reviewRecord = review as HistoricalReplayRecord;
        for (const field of ['debitAccountCode', 'payableAccountCode', 'vatAccountCode']) {
          requireMovementAccount('La revisión de nota de débito de proveedor ' + String(purchase.id || ''), reviewRecord[field]);
        }
      }
    }
    for (const advance of sourceCollections.supplierDirectAdvances.filter(item => String(item.companyId || '') === companyId)) {
      requireMovementAccount('El anticipo directo ' + String(advance.id || ''), advance.treasuryAccountCode);
    }
    for (const settlement of sourceCollections.supplierAdvanceSettlements.filter(item => String(item.companyId || '') === companyId)) {
      if (settlement.kind === 'REFUND_RECEIVED' && !settlement.treasuryAccountCode) {
        blockers.push('El reembolso de anticipo ' + String(settlement.id || '') + ' no identifica la cuenta real de caja o banco.');
      }
      requireMovementAccount('La liquidación de anticipo ' + String(settlement.id || ''), settlement.treasuryAccountCode);
    }
    for (const event of sourceCollections.vatOwnDeclarationEvents.filter(item => String(item.companyId || '') === companyId)) {
      if (event.eventType === 'PAYMENT' && !event.treasuryAccountCode) {
        blockers.push('El pago de IVA propio ' + String(event.id || '') + ' no identifica la cuenta de tesorería utilizada.');
      }
      requireMovementAccount('El evento de IVA propio ' + String(event.id || ''), event.treasuryAccountCode);
    }
    for (const asset of sourceCollections.fixedAssets.filter(item => String(item.companyId || '') === companyId)) {
      for (const field of ['assetAccountCode', 'accumulatedDepreciationAccountCode', 'depreciationExpenseAccountCode']) {
        requireMovementAccount('El activo fijo ' + String(asset.id || ''), asset[field]);
      }
    }
  }

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
    journalEntryRelationships: [...new Map(journalEntryRelationships.map(item => [item.entryId + '|' + item.relatedEntryId + '|' + item.relationType, item])).values()],
    sourceDependencies: [...new Map(sourceDependencies.map(item => [item.sourceKey + '|' + item.targetKey + '|' + item.relationType, item])).values()],
    contextCoverage,
    affectedExercises,
    externalDependencies: [...new Set(externalDependencies)],
    warnings,
    blockers: [...new Set(blockers)],
    canProceedToTransactionalReplay: blockers.length === 0 && orderedEvents.length > 0
  };
}
