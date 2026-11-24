export type SupplierAdvanceSettlementKind = 'REFUND_RECEIVED' | 'APPLIED_TO_PURCHASE';

export interface SupplierAdvanceCreditNoteAllocation {
  creditNoteId: string;
  amountUsd: number;
  bookValueBs: number;
}

export interface SupplierAdvanceDirectSource {
  id: string;
  amountUsd: number;
  bookValueBs: number;
}

export interface SupplierAdvanceDirectAllocation {
  directAdvanceId: string;
  amountUsd: number;
  bookValueBs: number;
}

export interface SupplierAdvanceCreditNoteSource {
  id: string;
  amountUsd: number;
  bookValueBs: number;
}

export interface SupplierAdvanceSettlement {
  id: string;
  companyId: string;
  supplierRif: string;
  supplierName: string;
  sourceCreditNoteIds: string[];
  /** Exact per-credit-note consumption; required for all newly posted settlements. */
  sourceCreditNoteAllocations?: SupplierAdvanceCreditNoteAllocation[];
  /** Direct cash/bank disbursements funding this settlement. */
  sourceDirectAdvanceIds?: string[];
  sourceDirectAdvanceAllocations?: SupplierAdvanceDirectAllocation[];
  kind: SupplierAdvanceSettlementKind;
  date: string;
  amountUsd: number;
  amountBs: number;
  /** Historical carrying amount removed from supplier advances in Bs. */
  advanceBookValueBs?: number;
  /** Actual Bs received in the bank/cash account; differs from book value by FX. */
  cashReceivedBs?: number;
  exchangeDifferenceBs?: number;
  bcvRate: number;
  /** Required for a refund; identifies the real treasury ledger account. */
  treasuryAccountCode?: string;
  /** Required for an application; identifies a purchase of the same supplier. */
  targetPurchaseId?: string;
  journalEntryId: string;
  reference?: string;
  createdAt: string;
  isReversed?: boolean;
  reversedByJournalEntryId?: string;
}

export interface SupplierAdvanceSettlementDraft {
  supplierRif: string;
  kind: SupplierAdvanceSettlementKind;
  date: string;
  amountUsd: number;
  amountBs: number;
  /** For refunds: actual Bs received. For applications: informational target settlement value. */
  cashReceivedBs?: number;
  bcvRate: number;
  treasuryAccountCode?: string;
  targetPurchaseId?: string;
  reference?: string;
}

export function validateSupplierAdvanceSettlementDraft(
  draft: SupplierAdvanceSettlementDraft,
  availableUsd: number,
  supplierRifForTarget?: string,
  validTreasuryAccountCodes: string[] = []
): string | null {
  if (!draft || typeof draft !== 'object') return 'Los datos de la liquidación no son válidos.';
  const rif = String(draft.supplierRif || '').trim().toUpperCase();
  if (!rif) return 'Debe identificar el RIF del proveedor.';
  if (!['REFUND_RECEIVED', 'APPLIED_TO_PURCHASE'].includes(draft.kind)) return 'El tipo de liquidación no es válido.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) return 'La fecha de liquidación no es válida.';
  const [year, month, day] = draft.date.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return 'La fecha de liquidación no es válida.';
  if (![draft.amountUsd, draft.amountBs, draft.bcvRate, availableUsd].every(Number.isFinite) ||
      draft.amountUsd <= 0 || draft.amountBs <= 0 || draft.bcvRate <= 0 || availableUsd < 0) {
    return 'Importes, saldo y tasa deben ser válidos y mayores que cero.';
  }
  if (draft.amountUsd > availableUsd + 0.000005) return 'La liquidación supera el saldo a favor disponible del proveedor.';
  if (draft.kind === 'REFUND_RECEIVED' && (!Number.isFinite(draft.cashReceivedBs ?? draft.amountBs) || (draft.cashReceivedBs ?? draft.amountBs) <= 0)) return 'El importe efectivamente recibido en Bs debe ser válido.';
  if (draft.kind === 'REFUND_RECEIVED') {
    if (!draft.treasuryAccountCode || !validTreasuryAccountCodes.includes(draft.treasuryAccountCode)) {
      return 'Seleccione una cuenta real de caja o banco para recibir el reembolso.';
    }
    if (draft.targetPurchaseId) return 'Un reembolso recibido no puede aplicarse simultáneamente a una compra.';
  }
  if (draft.kind === 'APPLIED_TO_PURCHASE') {
    if (!draft.targetPurchaseId) return 'Seleccione la factura de compra donde aplicará el anticipo.';
    if (!supplierRifForTarget || supplierRifForTarget.trim().toUpperCase() !== rif) {
      return 'El anticipo solo puede aplicarse a una factura del mismo proveedor (RIF).';
    }
    if (draft.treasuryAccountCode) return 'La aplicación de un anticipo no debe generar movimiento de caja o banco.';
  }
  return null;
}


const roundUsd = (value: number): number => Math.round((value + Number.EPSILON) * 1000000) / 1000000;
const roundBs = (value: number): number => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * Allocates a settlement against each source credit note in deterministic FIFO order.
 * Previously posted active allocations are deducted per note; legacy settlements
 * without allocations are rejected because their source balance cannot be reconstructed safely.
 */
export function allocateSupplierAdvanceCreditNotes(
  sources: SupplierAdvanceCreditNoteSource[],
  settlements: SupplierAdvanceSettlement[],
  companyId: string,
  supplierRif: string,
  requestedUsd: number
): SupplierAdvanceCreditNoteAllocation[] {
  if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
    throw new Error('El importe a distribuir entre notas de crédito debe ser mayor que cero.');
  }
  if (!Array.isArray(sources) || !Array.isArray(settlements)) {
    throw new Error('No se pudo reconstruir el historial de notas de crédito y liquidaciones.');
  }
  const sourceIds = new Set<string>();
  for (const source of sources) {
    if (!source || typeof source.id !== 'string' || !source.id.trim() || sourceIds.has(source.id)) {
      throw new Error('El conjunto de notas de crédito contiene identificadores vacíos o duplicados.');
    }
    if (!Number.isFinite(source.amountUsd) || source.amountUsd <= 0 ||
        !Number.isFinite(source.bookValueBs) || source.bookValueBs < 0) {
      throw new Error('Una nota de crédito fuente tiene importes inválidos.');
    }
    sourceIds.add(source.id);
  }
  const rif = String(supplierRif || '').trim().toUpperCase();
  const usedByNote = new Map<string, { usd: number; bs: number }>();
  for (const settlement of settlements) {
    if (settlement.companyId !== companyId || settlement.isReversed ||
        String(settlement.supplierRif || '').trim().toUpperCase() !== rif) continue;
    const allocations = settlement.sourceCreditNoteAllocations;
    if (!Array.isArray(allocations) || allocations.length === 0) {
      if (!Array.isArray(settlement.sourceCreditNoteIds) || settlement.sourceCreditNoteIds.length === 0) {
        const directAllocations = settlement.sourceDirectAdvanceAllocations || [];
        const directIds = settlement.sourceDirectAdvanceIds || [];
        const directUsd = directAllocations.reduce((sum, item) => sum + Number(item?.amountUsd || 0), 0);
        const directBs = directAllocations.reduce((sum, item) => sum + Number(item?.bookValueBs || 0), 0);
        if (!directAllocations.length || directAllocations.length !== directIds.length ||
            new Set(directIds).size !== directIds.length ||
            directAllocations.some(item => !item || !directIds.includes(item.directAdvanceId) ||
              !Number.isFinite(item.amountUsd) || item.amountUsd <= 0 ||
              !Number.isFinite(item.bookValueBs) || item.bookValueBs < 0) ||
            Math.abs(directUsd - roundUsd(settlement.amountUsd)) > 0.00001 ||
            Math.abs(directBs - roundBs(settlement.advanceBookValueBs ?? settlement.amountBs)) > 0.02) {
          throw new Error('Existe una liquidación histórica de anticipos directos sin distribución individual conciliada.');
        }
        continue;
      }
      throw new Error('Existe una liquidación histórica sin distribución por nota de crédito. Debe conciliarse manualmente antes de continuar.');
    }
    const directAllocations = settlement.sourceDirectAdvanceAllocations || [];
    const combinedUsd = allocations.reduce((sum, item) => sum + Number(item?.amountUsd || 0), 0) +
      directAllocations.reduce((sum, item) => sum + Number(item?.amountUsd || 0), 0);
    const combinedBs = allocations.reduce((sum, item) => sum + Number(item?.bookValueBs || 0), 0) +
      directAllocations.reduce((sum, item) => sum + Number(item?.bookValueBs || 0), 0);
    if (Math.abs(combinedUsd - roundUsd(settlement.amountUsd)) > 0.00001 ||
        Math.abs(combinedBs - roundBs(settlement.advanceBookValueBs ?? settlement.amountBs)) > 0.02) {
      throw new Error('La liquidación histórica ' + String(settlement.id || '') + ' no es conciliable: no coincide con la suma de sus orígenes de anticipo.');
    }
    const allocationError = validateSupplierAdvanceCreditNoteAllocations(
      allocations,
      settlement.sourceCreditNoteIds,
      allocations.reduce((sum, item) => sum + Number(item?.amountUsd || 0), 0),
      allocations.reduce((sum, item) => sum + Number(item?.bookValueBs || 0), 0)
    );
    if (allocationError) {
      throw new Error('La liquidación histórica ' + String(settlement.id || '') + ' no es conciliable: ' + allocationError);
    }
    for (const allocation of allocations) {
      if (!sourceIds.has(allocation.creditNoteId)) {
        throw new Error('Una liquidación histórica referencia una nota de crédito que no está en el conjunto fuente.');
      }
      const current = usedByNote.get(allocation.creditNoteId) || { usd: 0, bs: 0 };
      current.usd = roundUsd(current.usd + allocation.amountUsd);
      current.bs = roundBs(current.bs + allocation.bookValueBs);
      usedByNote.set(allocation.creditNoteId, current);
    }
  }
  let remaining = roundUsd(requestedUsd);
  const result: SupplierAdvanceCreditNoteAllocation[] = [];
  for (const source of sources) {
    if (remaining <= 0.000005) break;
    const used = usedByNote.get(source.id) || { usd: 0, bs: 0 };
    const availableUsd = roundUsd(source.amountUsd - used.usd);
    const availableBsRaw = roundBs(source.bookValueBs - used.bs);
    if (availableUsd < -0.000005 || availableBsRaw < -0.02) {
      throw new Error('Las liquidaciones históricas exceden el saldo de la nota de crédito ' + source.id + '.');
    }
    const availableBs = Math.max(0, availableBsRaw);
    if (availableUsd <= 0.000005) continue;
    const takeUsd = Math.min(remaining, availableUsd);
    const takeBs = takeUsd >= availableUsd - 0.000005
      ? availableBs
      : roundBs(availableBs * takeUsd / availableUsd);
    result.push({ creditNoteId: source.id, amountUsd: roundUsd(takeUsd), bookValueBs: takeBs });
    remaining = roundUsd(remaining - takeUsd);
  }
  if (remaining > 0.000005) {
    throw new Error('La liquidación supera el saldo distribuible de las notas de crédito fuente.');
  }
  return result;
}


export interface SupplierAdvanceFifoSource extends SupplierAdvanceCreditNoteSource {
  date: string;
  kind: 'CREDIT_NOTE' | 'DIRECT_ADVANCE';
}

export interface SupplierAdvanceFifoAllocation {
  creditNoteAllocations: SupplierAdvanceCreditNoteAllocation[];
  directAdvanceAllocations: SupplierAdvanceDirectAllocation[];
}

/**
 * Allocates one supplier settlement across credit notes and direct disbursements
 * in a single chronological FIFO queue. Each allocation retains its source's
 * historical book value; prior active settlements reduce only their exact source.
 */
export function allocateSupplierAdvanceFifo(
  creditNotes: Array<SupplierAdvanceCreditNoteSource & { date: string }>,
  directAdvances: Array<SupplierAdvanceDirectSource & { date: string }>,
  settlements: SupplierAdvanceSettlement[],
  companyId: string,
  supplierRif: string,
  requestedUsd: number,
  settlementDate?: string
): SupplierAdvanceFifoAllocation {
  if (!companyId.trim() || !String(supplierRif || '').trim()) {
    throw new Error('La empresa y el RIF del proveedor son obligatorios para distribuir anticipos.');
  }
  if (!Number.isFinite(requestedUsd) || requestedUsd <= 0) {
    throw new Error('El importe a distribuir entre anticipos debe ser mayor que cero.');
  }
  if (!Array.isArray(creditNotes) || !Array.isArray(directAdvances) || !Array.isArray(settlements)) {
    throw new Error('No se pudo reconstruir el historial de anticipos del proveedor.');
  }
  const rif = supplierRif.trim().toUpperCase();
  if (settlementDate !== undefined) {
    const parts = settlementDate.match(/^(\\d{4})-(\\d{2})-(\\d{2})$/)?.slice(1).map(Number);
    const parsed = parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])) : null;
    if (!parts || !parsed || parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== parts[1] - 1 || parsed.getUTCDate() !== parts[2]) {
      throw new Error('La fecha de liquidación FIFO es inválida.');
    }
  }
  const sources: SupplierAdvanceFifoSource[] = [
    ...creditNotes.map(source => ({ ...source, kind: 'CREDIT_NOTE' as const })),
    ...directAdvances.map(source => ({ ...source, kind: 'DIRECT_ADVANCE' as const }))
  ];
  const sourceKeys = new Set<string>();
  for (const source of sources) {
    const key = source.kind + ':' + source.id;
    if (!source.id?.trim() || sourceKeys.has(key)) {
      throw new Error('El conjunto de anticipos contiene identificadores vacíos o duplicados.');
    }
    const dateParts = String(source.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number);
    const parsedDate = dateParts ? new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2])) : null;
    if (!dateParts || !parsedDate || parsedDate.getUTCFullYear() !== dateParts[0] ||
        parsedDate.getUTCMonth() !== dateParts[1] - 1 || parsedDate.getUTCDate() !== dateParts[2] ||
        !Number.isFinite(source.amountUsd) || source.amountUsd <= 0 ||
        !Number.isFinite(source.bookValueBs) || source.bookValueBs < 0 ||
        (source.kind === 'DIRECT_ADVANCE' && source.bookValueBs <= 0)) {
      throw new Error('Un anticipo fuente contiene fecha o importes históricos inválidos.');
    }
    sourceKeys.add(key);
  }
  const sourceDates = new Map(sources.map(source => [source.kind + ':' + source.id, source.date]));

  const used = new Map<string, { usd: number; bs: number }>();
  for (const settlement of settlements) {
    if (settlement.companyId !== companyId || settlement.isReversed ||
        String(settlement.supplierRif || '').trim().toUpperCase() !== rif) continue;
    const settlementDateParts = String(settlement.date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number);
    const settlementDateParsed = settlementDateParts ? new Date(Date.UTC(settlementDateParts[0], settlementDateParts[1] - 1, settlementDateParts[2])) : null;
    if (!settlementDateParts || !settlementDateParsed || settlementDateParsed.getUTCFullYear() !== settlementDateParts[0] ||
        settlementDateParsed.getUTCMonth() !== settlementDateParts[1] - 1 || settlementDateParsed.getUTCDate() !== settlementDateParts[2]) {
      throw new Error('Una liquidación histórica de anticipos tiene una fecha inválida.');
    }
    const noteAllocations = settlement.sourceCreditNoteAllocations || [];
    const directAllocations = settlement.sourceDirectAdvanceAllocations || [];
    if (!noteAllocations.length && (settlement.sourceCreditNoteIds || []).length) {
      throw new Error('Existe una liquidación histórica sin distribución por nota de crédito. Debe conciliarse manualmente antes de continuar.');
    }
    if (!noteAllocations.length && !directAllocations.length) {
      throw new Error('Existe una liquidación histórica sin distribución individual por origen de anticipo.');
    }
    if (noteAllocations.length) {
      const noteError = validateSupplierAdvanceCreditNoteAllocations(
        noteAllocations,
        settlement.sourceCreditNoteIds || [],
        noteAllocations.reduce((sum, item) => sum + Number(item.amountUsd), 0),
        noteAllocations.reduce((sum, item) => sum + Number(item.bookValueBs), 0)
      );
      if (noteError) throw new Error('La liquidación histórica ' + String(settlement.id || '') + ' no es conciliable: ' + noteError);
    }
    const directIds = directAllocations.map(item => item?.directAdvanceId);
    const declaredDirectIds = settlement.sourceDirectAdvanceIds || [];
    if (directIds.some(id => typeof id !== 'string' || !id.trim()) ||
        new Set(directIds).size !== directIds.length ||
        declaredDirectIds.length !== directIds.length || directIds.some(id => !declaredDirectIds.includes(id)) ||
        directAllocations.some(item => !Number.isFinite(item.amountUsd) || item.amountUsd <= 0 ||
          !Number.isFinite(item.bookValueBs) || item.bookValueBs < 0)) {
      throw new Error('Una liquidación histórica contiene aplicaciones de anticipos directos inválidas.');
    }
    const totalUsd = roundUsd(
      noteAllocations.reduce((sum, item) => sum + item.amountUsd, 0) +
      directAllocations.reduce((sum, item) => sum + item.amountUsd, 0)
    );
    const totalBs = roundBs(
      noteAllocations.reduce((sum, item) => sum + item.bookValueBs, 0) +
      directAllocations.reduce((sum, item) => sum + item.bookValueBs, 0)
    );
    if (Math.abs(totalUsd - roundUsd(settlement.amountUsd)) > 0.00001 ||
        Math.abs(totalBs - roundBs(settlement.advanceBookValueBs ?? settlement.amountBs)) > 0.02) {
      throw new Error('La liquidación histórica ' + String(settlement.id || '') + ' no concilia con sus valores históricos de origen.');
    }
    for (const allocation of noteAllocations) {
      const key = 'CREDIT_NOTE:' + allocation.creditNoteId;
      if (sourceDates.has(key) && sourceDates.get(key)! > settlement.date) {
        throw new Error('Una liquidación histórica consume una nota de crédito anterior a su fecha de origen.');
      }
      if (!sourceKeys.has(key)) throw new Error('Una liquidación histórica referencia una nota de crédito inexistente.');
      const current = used.get(key) || { usd: 0, bs: 0 };
      current.usd = roundUsd(current.usd + allocation.amountUsd);
      current.bs = roundBs(current.bs + allocation.bookValueBs);
      used.set(key, current);
    }
    for (const allocation of directAllocations) {
      const key = 'DIRECT_ADVANCE:' + allocation.directAdvanceId;
      if (sourceDates.has(key) && sourceDates.get(key)! > settlement.date) {
        throw new Error('Una liquidación histórica consume un anticipo directo anterior a su fecha de origen.');
      }
      if (!sourceKeys.has(key)) throw new Error('Una liquidación histórica referencia un anticipo directo inexistente.');
      const current = used.get(key) || { usd: 0, bs: 0 };
      current.usd = roundUsd(current.usd + allocation.amountUsd);
      current.bs = roundBs(current.bs + allocation.bookValueBs);
      used.set(key, current);
    }
  }

  const ordered = sources.filter(source => settlementDate === undefined || source.date <= settlementDate).sort((a, b) =>
    a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id)
  );
  let remaining = roundUsd(requestedUsd);
  const result: SupplierAdvanceFifoAllocation = { creditNoteAllocations: [], directAdvanceAllocations: [] };
  for (const source of ordered) {
    if (remaining <= 0.000005) break;
    const key = source.kind + ':' + source.id;
    const consumed = used.get(key) || { usd: 0, bs: 0 };
    const availableUsd = roundUsd(source.amountUsd - consumed.usd);
    const availableBsRaw = roundBs(source.bookValueBs - consumed.bs);
    if (availableUsd < -0.000005 || availableBsRaw < -0.02) {
      throw new Error('Las aplicaciones históricas exceden el saldo del anticipo ' + source.id + '.');
    }
    if (availableUsd <= 0.000005) continue;
    const availableBs = Math.max(0, availableBsRaw);
    const takeUsd = Math.min(remaining, availableUsd);
    const takeBs = takeUsd >= availableUsd - 0.000005
      ? availableBs
      : roundBs(availableBs * takeUsd / availableUsd);
    if (source.kind === 'CREDIT_NOTE') {
      result.creditNoteAllocations.push({ creditNoteId: source.id, amountUsd: roundUsd(takeUsd), bookValueBs: takeBs });
    } else {
      result.directAdvanceAllocations.push({ directAdvanceId: source.id, amountUsd: roundUsd(takeUsd), bookValueBs: takeBs });
    }
    remaining = roundUsd(remaining - takeUsd);
  }
  if (remaining > 0.000005) {
    throw new Error('La liquidación supera el saldo disponible combinado de anticipos del proveedor.');
  }
  return result;
}

/** Structural and arithmetic validation used by SQLite and backup import guards. */
export function validateSupplierAdvanceCreditNoteAllocations(
  allocations: SupplierAdvanceCreditNoteAllocation[],
  sourceCreditNoteIds: string[],
  amountUsd: number,
  bookValueBs: number
): string | null {
  if (!Array.isArray(allocations) || allocations.length === 0) return 'La liquidación no tiene distribución individual por nota de crédito.';
  const ids = allocations.map(item => item?.creditNoteId);
  if (ids.some(id => typeof id !== 'string' || !id.trim()) || new Set(ids).size !== ids.length) {
    return 'La distribución por nota de crédito contiene identificadores vacíos o duplicados.';
  }
  if (!Array.isArray(sourceCreditNoteIds) || sourceCreditNoteIds.length !== ids.length ||
      ids.some(id => !sourceCreditNoteIds.includes(id))) {
    return 'Las notas fuente no coinciden con la distribución individual.';
  }
  const valid = allocations.every(item => Number.isFinite(item.amountUsd) && item.amountUsd > 0 &&
    Number.isFinite(item.bookValueBs) && item.bookValueBs >= 0);
  if (!valid) return 'La distribución por nota de crédito contiene importes inválidos.';
  const sumUsd = roundUsd(allocations.reduce((sum, item) => sum + item.amountUsd, 0));
  const sumBs = roundBs(allocations.reduce((sum, item) => sum + item.bookValueBs, 0));
  if (Math.abs(sumUsd - roundUsd(amountUsd)) > 0.00001 || Math.abs(sumBs - roundBs(bookValueBs)) > 0.02) {
    return 'La distribución individual no coincide con el importe liquidado ni con su valor histórico.';
  }
  return null;
}
