import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReglaMonetariaPorFecha,
  requiresBcvRateForOperationDate,
  allowsUsdForOperationDate,
  formatUsdForDate,
  formatDualCurrencyForDate,
  normalizeAmountToCurrentScale,
  reexpressAmountBetweenDates,
  RECONVERSION_BOUNDARIES,
  getNextReconversionBoundary
} from './monetaryPolicy';

test('resuelve la escala monetaria por la fecha contable de la operación', () => {
  assert.equal(getReglaMonetariaPorFecha('2007-12-31').eraId, 'BOLIVAR_ORIGINAL');
  assert.equal(getReglaMonetariaPorFecha('2008-01-01').eraId, 'BOLIVAR_FUERTE');
  assert.equal(getReglaMonetariaPorFecha('2010-06-15').eraId, 'BOLIVAR_FUERTE');
  assert.equal(getReglaMonetariaPorFecha('2018-08-19').eraId, 'BOLIVAR_FUERTE');
  assert.equal(getReglaMonetariaPorFecha('2018-08-20').eraId, 'BOLIVAR_SOBERANO');
  assert.equal(getReglaMonetariaPorFecha('2021-09-30').eraId, 'BOLIVAR_SOBERANO');
  assert.equal(getReglaMonetariaPorFecha('2021-10-01').eraId, 'BOLIVAR_DIGITAL');
  assert.equal(getReglaMonetariaPorFecha('2026-11-25').eraId, 'BOLIVAR_DIGITAL');
});

test('la tasa BCV solo es obligatoria desde el 1 de enero de 2018', () => {
  for (const date of ['2010-01-01', '2017-12-31', '2007-12-31']) {
    const rule = getReglaMonetariaPorFecha(date);
    assert.equal(rule.requiresBcvRate, false);
    assert.equal(rule.allowsUsd, false);
    assert.equal(requiresBcvRateForOperationDate(date), false);
    assert.equal(allowsUsdForOperationDate(date), false);
  }
  for (const date of ['2018-01-01', '2018-08-19', '2026-11-25']) {
    const rule = getReglaMonetariaPorFecha(date);
    assert.equal(rule.requiresBcvRate, true);
    assert.equal(rule.allowsUsd, true);
  }
});

test('las fechas vacías o inválidas nunca habilitan BCV ni USD', () => {
  for (const date of ['', null, undefined, '2018-02-30', 'texto']) {
    const rule = getReglaMonetariaPorFecha(date);
    assert.equal(rule.isValidDate, false);
    assert.equal(rule.requiresBcvRate, false);
    assert.equal(rule.allowsUsd, false);
  }
});

test('la presentación en USD muestra "-" antes de 2018 y el monto desde 2018', () => {
  assert.equal(formatUsdForDate(1500, '2010-05-05'), '-');
  assert.equal(formatUsdForDate(1500, '2017-12-31'), '-');
  assert.equal(formatUsdForDate(1500, '2018-01-01'), '$ 1,500.00');
  assert.equal(formatUsdForDate(null, '2019-01-01'), '-');
});

test('la presentación dual mantiene solo bolívares antes de 2018', () => {
  assert.equal(formatDualCurrencyForDate(100, 200, '2017-12-31'), 'Bs. 100,00');
  assert.match(formatDualCurrencyForDate(100, 200, '2018-01-01'), /^Bs\. 100,00 \(\$ 0\.50\)$/);
});

test('normaliza montos históricos solo con fechas contables válidas', () => {
  assert.equal(normalizeAmountToCurrentScale('1000000', '2018-08-19'), '0.00001');
  assert.equal(normalizeAmountToCurrentScale('100000', '2018-08-20'), '0.1');
  assert.throws(() => normalizeAmountToCurrentScale('100', '2018-13-01'));
});

test('reexpresa saldos entre tramos de reconversión', () => {
  assert.equal(reexpressAmountBetweenDates('100000', '2018-08-19', '2018-08-20'), '1');
  assert.equal(reexpressAmountBetweenDates('1000000', '2018-08-19', '2018-08-20'), '10');
  assert.equal(reexpressAmountBetweenDates('250000', '2021-09-30', '2021-10-01'), '0.25');
});

test('expone las fronteras de reconversión legales', () => {
  assert.deepEqual(RECONVERSION_BOUNDARIES.map(item => item.date), ['2008-01-01', '2018-08-20', '2021-10-01']);
  assert.equal(RECONVERSION_BOUNDARIES[0].removedDecimalExponent, 3);
  assert.equal(RECONVERSION_BOUNDARIES[1].removedDecimalExponent, 5);
  assert.equal(RECONVERSION_BOUNDARIES[2].removedDecimalExponent, 6);
  assert.equal(getNextReconversionBoundary('2010-01-01')?.date, '2018-08-20');
  assert.equal(getNextReconversionBoundary('2020-01-01')?.date, '2021-10-01');
  assert.equal(getNextReconversionBoundary('2022-01-01'), null);
});
