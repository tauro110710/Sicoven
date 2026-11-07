export interface InventoryBcvHistoryEntry {
  id: string;
  rate: number;
  effectiveDate: string;
  fetchedAt: string;
  source: string;
  provider: 'bcv.today';
  mode: 'AUTOMATIC' | 'MANUAL';
}

/** Returns the latest saved rate whose effective date is not later than the requested date. */
export function resolveInventoryBcvRate(
  history: InventoryBcvHistoryEntry[],
  effectiveDate: string
): InventoryBcvHistoryEntry | null {
  return [...history]
    .filter(entry => entry.effectiveDate <= effectiveDate && Number.isFinite(entry.rate) && entry.rate > 0)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.fetchedAt.localeCompare(a.fetchedAt))[0] || null;
}

export function appendDailyInventoryBcvRate(
  history: InventoryBcvHistoryEntry[],
  input: Omit<InventoryBcvHistoryEntry, 'id'>
): InventoryBcvHistoryEntry[] {
  const existing = history.find(entry => entry.effectiveDate === input.effectiveDate);
  if (existing) return history;
  return [...history, { ...input, id: 'inventory-bcv-' + input.effectiveDate }]
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
}
