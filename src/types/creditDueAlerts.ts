export type CreditDueAlertKey = 'OVERDUE' | 'DUE_TODAY' | 'DUE_1_7' | 'DUE_8_30' | 'INVALID_DUE_DATE';

export interface CreditDueAlert {
  key: CreditDueAlertKey;
  label: string;
  documentCount: number;
  outstandingUsd: number;
}

const BUCKETS: { key: CreditDueAlertKey; label: string }[] = [
  { key: 'OVERDUE', label: 'Vencidos' },
  { key: 'DUE_TODAY', label: 'Vencen hoy' },
  { key: 'DUE_1_7', label: 'Próximos 7 días' },
  { key: 'DUE_8_30', label: 'Vencimiento por revisar' },
  { key: 'INVALID_DUE_DATE', label: 'Fecha no válida' }
];

const isoDay = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? Math.floor(parsed.getTime() / 86_400_000)
    : null;
};

/** Read-only operational alerts for outstanding credit documents; never mutates balances. */
export function summarizeCreditDueAlerts(
  documents: { dueDate?: string | null; outstandingUsd: number }[],
  asOfDate: string
): CreditDueAlert[] {
  const asOfDay = isoDay(asOfDate);
  if (asOfDay === null) throw new Error('La fecha de corte de alertas no es válida.');
  const totals = new Map(BUCKETS.map(bucket => [bucket.key, { documentCount: 0, outstandingUsd: 0 }]));
  for (const document of documents) {
    const amount = Number(document.outstandingUsd);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('La cartera contiene un saldo pendiente no válido.');
    if (amount <= 0.005 || !document.dueDate) continue;
    const dueDay = isoDay(document.dueDate);
    if (dueDay === null) {
      const total = totals.get('INVALID_DUE_DATE')!;
      total.documentCount += 1;
      total.outstandingUsd += amount;
      continue;
    }
    const daysUntilDue = dueDay - asOfDay;
    const key: CreditDueAlertKey | null = daysUntilDue < 0 ? 'OVERDUE'
      : daysUntilDue === 0 ? 'DUE_TODAY'
      : daysUntilDue <= 7 ? 'DUE_1_7'
      : daysUntilDue <= 30 ? 'DUE_8_30'
      : null;
    if (!key) continue;
    const total = totals.get(key)!;
    total.documentCount += 1;
    total.outstandingUsd += amount;
  }
  return BUCKETS.map(bucket => ({
    ...bucket,
    documentCount: totals.get(bucket.key)!.documentCount,
    outstandingUsd: Math.round(totals.get(bucket.key)!.outstandingUsd * 1_000_000) / 1_000_000
  }));
}
