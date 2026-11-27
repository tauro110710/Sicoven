import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHistoricalBcvRate } from '../../utils/historicalBcvRate';
import type { InventoryBcvHistoryEntry } from '../../types/inventoryBcvRate';
import { nextHistoricalBcvRateFieldValue } from './useHistoricalBcvRate';

const inventoryEntry = (effectiveDate: string, rate: number): InventoryBcvHistoryEntry => ({
  id: `inventory-${effectiveDate}-${rate}`,
  effectiveDate,
  rate,
  fetchedAt: `${effectiveDate}T12:00:00.000Z`,
  source: 'https://bcv.today/api/v1/history.json',
  provider: 'bcv.today',
  mode: 'AUTOMATIC'
});

const company = {
  accountingBcvRateHistory: undefined,
  inventoryBcvRateHistory: [
    inventoryEntry('2024-05-01', 38.25),
    inventoryEntry('2024-05-18', 39.4)
  ]
};

test('compra histórica: autocompleta la tasa vigente desde el historial de Inventario', () => {
  const suggestion = resolveHistoricalBcvRate(company, '2024-05-15');
  assert.deepEqual(suggestion, { rate: 38.25, effectiveDate: '2024-05-01', origin: 'INVENTORY' });

  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2024-05-15',
    previousDate: null,
    value: '',
    usdEnabled: true,
    suggestion,
    preserveManualEdit: true
  });
  assert.equal(nextValue, '38.25');
});

test('al cambiar la fecha vuelve a sugerir la tasa histórica de la nueva fecha', () => {
  const suggestion = resolveHistoricalBcvRate(company, '2024-05-20');
  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2024-05-20',
    previousDate: '2024-05-15',
    value: '38.25',
    usdEnabled: true,
    suggestion,
    preserveManualEdit: true
  });
  assert.equal(nextValue, '39.4');
});

test('una actualización del historial no pisa una tasa escrita manualmente', () => {
  const suggestion = resolveHistoricalBcvRate(company, '2024-05-15');
  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2024-05-15',
    previousDate: '2024-05-15',
    value: '38,25',
    usdEnabled: true,
    suggestion,
    preserveManualEdit: true
  });
  assert.equal(nextValue, null);
});

test('antes de 2018 limpia la tasa y no sugiere equivalencias', () => {
  const suggestion = resolveHistoricalBcvRate(company, '2017-12-31');
  assert.equal(suggestion, undefined);
  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2017-12-31',
    previousDate: '2018-01-02',
    value: '38,25',
    usdEnabled: false,
    suggestion,
    preserveManualEdit: true
  });
  assert.equal(nextValue, '');
});

test('sin tasa registrada ni respaldo deja el campo vacío, sin inventar un valor', () => {
  const suggestion = resolveHistoricalBcvRate(company, '2023-01-01');
  assert.equal(suggestion, undefined);
  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2023-01-01',
    previousDate: null,
    value: '',
    usdEnabled: true,
    suggestion,
    preserveManualEdit: true
  });
  assert.equal(nextValue, null);
});

test('usa el respaldo y el formato del formulario cuando no hay tasa histórica', () => {
  const nextValue = nextHistoricalBcvRateFieldValue({
    date: '2023-01-01',
    previousDate: null,
    value: '',
    usdEnabled: true,
    suggestion: undefined,
    preserveManualEdit: false,
    fallbackRate: 12.5,
    format: rate => String(rate).replace('.', ',')
  });
  assert.equal(nextValue, '12,5');
});
