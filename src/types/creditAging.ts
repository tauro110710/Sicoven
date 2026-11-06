export type CreditAgingBucketKey = 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'OVER_90' | 'NO_DUE_DATE';

export interface CreditAgingBucket {
  key: CreditAgingBucketKey;
  label: string;
  documentCount: number;
  outstandingUsd: number;
}

const BUCKETS: { key: CreditAgingBucketKey; label: string }[] = [
  { key: 'CURRENT', label: 'No vencido' },
  { key: 'DAYS_1_30', label: '1–30 días' },
  { key: 'DAYS_31_60', label: '31–60 días' },
  { key: 'DAYS_61_90', label: '61–90 días' },
  { key: 'OVER_90', label: 'Más de 90 días' },
  { key: 'NO_DUE_DATE', label: 'Sin vencimiento' }
];

const isoDay = (value: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    ? Math.floor(parsed.getTime() / 86_400_000)
    : null;
};

/** Groups only outstanding documents by overdue age, using a stable ISO-date comparison. */
export function summarizeCreditAging(
  documents: { dueDate?: string | null; outstandingUsd: number }[],
  asOfDate: string
): CreditAgingBucket[] {
  const asOfDay = isoDay(asOfDate);
  if (asOfDay === null) throw new Error('La fecha de corte de antigüedad no es válida.');
  const totals = new Map(BUCKETS.map(bucket => [bucket.key, { documentCount: 0, outstandingUsd: 0 }]));
  for (const document of documents) {
    const amount = Number(document.outstandingUsd);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('La cartera contiene un saldo pendiente no válido.');
    if (amount <= 0.005) continue;
    const dueDay = document.dueDate ? isoDay(document.dueDate) : null;
    const daysLate = dueDay === null ? null : asOfDay - dueDay;
    const key: CreditAgingBucketKey = daysLate === null ? 'NO_DUE_DATE'
      : daysLate <= 0 ? 'CURRENT'
      : daysLate <= 30 ? 'DAYS_1_30'
      : daysLate <= 60 ? 'DAYS_31_60'
      : daysLate <= 90 ? 'DAYS_61_90'
      : 'OVER_90';
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
