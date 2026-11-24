export interface InventoryBcvHistoryEntry {
  id: string;
  rate: number;
  effectiveDate: string;
  fetchedAt: string;
  source: string;
  provider: 'bcv.today' | 'manual';
  mode: 'AUTOMATIC' | 'MANUAL';
  /** Motivo documentado cuando el contador registra o corrige manualmente la tasa. */
  note?: string;
  /** Registro previo del mismo día al que sustituye como valor operativo. */
  correctionOfId?: string;
}

const validEffectiveDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** Returns the latest saved rate whose effective date is not later than the requested date. */
export function resolveInventoryBcvRate(
  history: InventoryBcvHistoryEntry[],
  effectiveDate: string
): InventoryBcvHistoryEntry | null {
  if (!validEffectiveDate(effectiveDate) || !Array.isArray(history)) return null;
  return [...history]
    .filter(entry => validEffectiveDate(entry.effectiveDate) && entry.effectiveDate <= effectiveDate &&
      Number.isFinite(entry.rate) && entry.rate > 0)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) ||
      Number(b.mode === 'MANUAL') - Number(a.mode === 'MANUAL') ||
      b.fetchedAt.localeCompare(a.fetchedAt))[0] || null;
}

/**
 * Automatic provider data never replaces an existing daily record.
 * A manual entry is an append-only correction and may coexist with the
 * automatic record for the same effective date.
 */
export function appendDailyInventoryBcvRate(
  history: InventoryBcvHistoryEntry[],
  input: Omit<InventoryBcvHistoryEntry, 'id'>
): InventoryBcvHistoryEntry[] {
  if (input.mode === 'AUTOMATIC' && history.some(entry => entry.effectiveDate === input.effectiveDate)) return history;
  const id = 'inventory-bcv-' + input.effectiveDate + '-' + input.mode.toLowerCase() + '-' + input.fetchedAt.replace(/[^0-9]/g, '');
  if (history.some(entry => entry.id === id)) return history;
  return [...history, { ...input, id }]
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.fetchedAt.localeCompare(b.fetchedAt));
}