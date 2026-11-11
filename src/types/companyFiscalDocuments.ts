/**
 * Restricts fiscal-document collections to the active company.
 * The accounting context intentionally keeps records from all local companies;
 * every company-facing ledger/export must scope before filtering or aggregating.
 */
export function filterCompanyFiscalDocuments<T extends { companyId?: string | null }>(
  records: readonly T[],
  companyId: string
): T[] {
  if (!companyId.trim()) return [];
  return records.filter(record => record.companyId === companyId);
}
