export const INVENTORY_BCV_PRIMARY_URL = 'https://bcv.today/api/rate.json';
export const INVENTORY_BCV_FALLBACK_URL = 'https://bcv.today/api/v1/rate.json';
export const INVENTORY_BCV_HISTORY_URL = 'https://bcv.today/api/v1/history.json';

export interface InventoryBcvRateResult {
  rate: number;
  effectiveDate: string;
  fetchedAt: string;
  sourceUrl: string;
  provider: 'bcv.today';
}

export interface InventoryBcvHistoricalRate {
  rate: number;
  effectiveDate: string;
  fetchedAt: string;
  sourceUrl: string;
  provider: 'bcv.today';
}

interface BcvApiPayload {
  USD?: unknown;
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
    const effectiveDate = payload?.effective_date || payload?.date;
    return Number.isFinite(rate) && rate > 0 && isValidDate(effectiveDate) ? payload : null;
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
  if (!isValidDate(effectiveDateCandidate)) {
    throw new Error('La fuente BCV no devolvió una fecha de vigencia válida. No se inventó ni guardó una fecha para esa tasa.');
  }
  const effectiveDate = effectiveDateCandidate;
  const fetchedAt = new Date().toISOString();

  return { rate: Number(rate.toFixed(4)), effectiveDate, fetchedAt, sourceUrl, provider: 'bcv.today' };
}

/** Fetches the available daily history so missed days can be backfilled without altering prior records. */
export async function fetchInventoryBcvHistory(): Promise<InventoryBcvHistoricalRate[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(INVENTORY_BCV_HISTORY_URL, {
      method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal
    });
    if (!response.ok) return [];
    const payload = await response.json() as unknown;
    if (!Array.isArray(payload)) return [];
    const fetchedAt = new Date().toISOString();
    return payload.flatMap((item: any) => {
      const rate = Number(item?.USD);
      const date = item?.effective_date || item?.date;
      if (!Number.isFinite(rate) || rate <= 0 || !isValidDate(date)) return [];
      return [{ rate: Number(rate.toFixed(4)), effectiveDate: date, fetchedAt,
        sourceUrl: INVENTORY_BCV_HISTORY_URL, provider: 'bcv.today' as const }];
    }).sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  } catch {
    return [];
  } finally { clearTimeout(timeout); }
}
