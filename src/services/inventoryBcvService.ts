export const INVENTORY_BCV_PRIMARY_URL = 'https://bcv.today/api/rate.json';
export const INVENTORY_BCV_FALLBACK_URL = 'https://bcv.today/api/v1/rate.json';

export interface InventoryBcvRateResult {
  rate: number;
  effectiveDate: string;
  updatedAt: string;
  sourceUrl: string;
  provider: 'bcv.today';
}

interface BcvApiPayload {
  USD?: unknown;
  updated_at?: unknown;
  effective_date?: unknown;
  date?: unknown;
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function requestRate(url: string): Promise<BcvApiPayload | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });
    if (!response.ok) return null;
    const payload = await response.json() as BcvApiPayload;
    const rate = Number(payload?.USD);
    return Number.isFinite(rate) && rate > 0 ? payload : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Uses the same primary/fallback endpoints as tienda-pos; never fabricates a rate. */
export async function fetchInventoryBcvRate(): Promise<InventoryBcvRateResult> {
  let payload = await requestRate(INVENTORY_BCV_PRIMARY_URL);
  let sourceUrl = INVENTORY_BCV_PRIMARY_URL;
  if (!payload) {
    payload = await requestRate(INVENTORY_BCV_FALLBACK_URL);
    sourceUrl = INVENTORY_BCV_FALLBACK_URL;
  }
  if (!payload) {
    throw new Error('No se pudo consultar la tasa BCV en bcv.today. Se conserva la última tasa guardada.');
  }

  const rate = Number(payload.USD);
  const effectiveDateCandidate = payload.effective_date || payload.date;
  const effectiveDate = isValidDate(effectiveDateCandidate)
    ? effectiveDateCandidate
    : new Date().toISOString().slice(0, 10);
  const updatedAt = typeof payload.updated_at === 'string' && Number.isFinite(Date.parse(payload.updated_at))
    ? payload.updated_at
    : new Date().toISOString();

  return { rate: Number(rate.toFixed(4)), effectiveDate, updatedAt, sourceUrl, provider: 'bcv.today' };
}
