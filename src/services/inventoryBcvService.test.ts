import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchInventoryBcvHistory, fetchInventoryBcvRate, INVENTORY_BCV_FALLBACK_URL, INVENTORY_BCV_HISTORY_URL, INVENTORY_BCV_PRIMARY_URL } from './inventoryBcvService';

test('inventory BCV service uses tienda-pos primary endpoint and parses official effective date', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    assert.equal(String(input), INVENTORY_BCV_PRIMARY_URL);
    return new Response(JSON.stringify({ USD: 891.12345, effective_date: '2026-11-06', updated_at: '2026-11-06T13:00:00.000Z' }), { status: 200 });
  };
  try {
    const result = await fetchInventoryBcvRate();
    assert.equal(result.rate, 891.1235);
    assert.equal(result.effectiveDate, '2026-11-06');
    assert.equal(result.sourceUrl, INVENTORY_BCV_PRIMARY_URL);
  } finally { globalThis.fetch = originalFetch; }
});

test('inventory BCV service falls back to the same v1 endpoint used by tienda-pos', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (calls.length === 1) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ USD: 892.5, date: '2026-11-07' }), { status: 200 });
  };
  try {
    const result = await fetchInventoryBcvRate();
    assert.deepEqual(calls, [INVENTORY_BCV_PRIMARY_URL, INVENTORY_BCV_FALLBACK_URL]);
    assert.equal(result.rate, 892.5);
    assert.equal(result.effectiveDate, '2026-11-07');
    assert.equal(result.sourceUrl, INVENTORY_BCV_FALLBACK_URL);
  } finally { globalThis.fetch = originalFetch; }
});


test('inventory BCV history endpoint returns dated rates in chronological order', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    assert.equal(String(input), INVENTORY_BCV_HISTORY_URL);
    return new Response(JSON.stringify([
      { USD: 892, date: '2026-11-07', updated_at: '2026-11-07T12:00:00.000Z' },
      { USD: 890, effective_date: '2026-11-06' },
      { USD: -1, date: '2026-11-05' },
      { USD: 889, date: 'not-a-date' }
    ]), { status: 200 });
  };
  try {
    const result = await fetchInventoryBcvHistory();
    assert.deepEqual(result.map(entry => entry.effectiveDate), ['2026-11-06', '2026-11-07']);
    assert.equal(result[0].rate, 890);
    assert.equal(result[0].sourceUrl, INVENTORY_BCV_HISTORY_URL);
  } finally { globalThis.fetch = originalFetch; }
});
