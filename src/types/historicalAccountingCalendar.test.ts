import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertVenezuelanAmount,
  convertVenezuelanAmountBetweenDates,
  normalizeVenezuelanAmountToCurrentScale,
  getVenezuelanMonetaryEra,
  roundHistoricalPresentationAmount,
  addExactDecimals
} from './historicalAccountingCalendar';

test('determina la escala monetaria histórica por la fecha efectiva legal', () => {
  assert.equal(getVenezuelanMonetaryEra('2015-12-31').id, 'BOLIVAR_FUERTE');
  assert.equal(getVenezuelanMonetaryEra('2018-08-19').id, 'BOLIVAR_FUERTE');
  assert.equal(getVenezuelanMonetaryEra('2018-08-20').id, 'BOLIVAR_SOBERANO');
  assert.equal(getVenezuelanMonetaryEra('2021-09-30').id, 'BOLIVAR_SOBERANO');
  assert.equal(getVenezuelanMonetaryEra('2021-10-01').id, 'BOLIVAR_DIGITAL');
});

test('convierte escalas sin redondear ni perder precisión decimal de origen', () => {
  assert.equal(convertVenezuelanAmount('100000', 'BOLIVAR_SOBERANO', 'BOLIVAR_DIGITAL'), '0.1');
  assert.equal(convertVenezuelanAmount('1000000', 'BOLIVAR_FUERTE', 'BOLIVAR_DIGITAL'), '0.00001');
  assert.equal(convertVenezuelanAmount('100000000000000', 'BOLIVAR_ORIGINAL', 'BOLIVAR_DIGITAL'), '1');
  assert.equal(convertVenezuelanAmount('0.00000001', 'BOLIVAR_DIGITAL', 'BOLIVAR_SOBERANO'), '0.01');
  assert.equal(convertVenezuelanAmount('-1000000', 'BOLIVAR_SOBERANO', 'BOLIVAR_DIGITAL'), '-1');
});

test('separa la conversión nominal del redondeo de presentación', () => {
  const exact = convertVenezuelanAmount('1234567', 'BOLIVAR_SOBERANO', 'BOLIVAR_DIGITAL');
  assert.equal(exact, '1.234567');
  assert.equal(roundHistoricalPresentationAmount(exact, 2), '1.23');
  assert.equal(roundHistoricalPresentationAmount('1.235', 2), '1.24');
  assert.equal(roundHistoricalPresentationAmount('-1.235', 2), '-1.24');
});

test('bloquea fechas e importes inválidos', () => {
  assert.throws(() => getVenezuelanMonetaryEra('2021-02-30'));
  assert.throws(() => convertVenezuelanAmount('NaN', 'BOLIVAR_SOBERANO', 'BOLIVAR_DIGITAL'));
});

test('normalizes report amounts using effective-date monetary scale without mutating source', () => {
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000000000000', '2007-12-31'), '1');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('1000000', '2018-08-19'), '0.00001');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000', '2018-08-20'), '0.1');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100', '2021-10-01'), '100');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('-250000', '2019-05-01'), '-0.25');
});

test('normalization uses exact monetary transition boundaries', () => {
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000000000000', '2007-12-31'), '1');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000000000', '2008-01-01'), '1');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('1000000000', '2018-08-19'), '0.01');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000000', '2018-08-20'), '100');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100000000', '2021-09-30'), '100');
  assert.equal(normalizeVenezuelanAmountToCurrentScale('100', '2021-10-01'), '100');
});

test('converts decimal values expressed in scientific notation exactly as their decimal representation', () => {
  assert.equal(convertVenezuelanAmount('1e-8', 'BOLIVAR_DIGITAL', 'BOLIVAR_DIGITAL'), '0.00000001');
  assert.equal(convertVenezuelanAmount('1.25e3', 'BOLIVAR_DIGITAL', 'BOLIVAR_DIGITAL'), '1250');
  assert.equal(convertVenezuelanAmount('-2.5e-3', 'BOLIVAR_DIGITAL', 'BOLIVAR_DIGITAL'), '-0.0025');
});

test('suma decimales de balances con precisión exacta, sin errores de coma flotante', () => {
  assert.equal(addExactDecimals('0.1', '0.2'), '0.3');
  assert.equal(addExactDecimals('999999999999999999.99', '0.01'), '1000000000000000000');
  assert.equal(addExactDecimals('-0.25', '0.1'), '-0.15');
  assert.equal(addExactDecimals('1.200', '0.008'), '1.208');
  assert.equal(addExactDecimals('10', '-10'), '0');
  assert.equal(addExactDecimals('0.00000000000001', '0.00000000000009'), '0.0000000000001');
  assert.equal(addExactDecimals('1e-8', '2e-8'), '0.00000003');
  assert.equal(addExactDecimals('1.25e3', '-2.5e2'), '1000');
  assert.throws(() => addExactDecimals('NaN', '1'));
});


test('converts bolivar amounts between effective monetary scales without rounding', () => {
  assert.equal(convertVenezuelanAmountBetweenDates('1000000000000', '2017-06-15', '2027-01-01'), '10');
  assert.equal(convertVenezuelanAmountBetweenDates('10', '2027-01-01', '2017-06-15'), '1000000000000');
  assert.equal(convertVenezuelanAmountBetweenDates('0.01', '2021-10-01', '2021-09-30'), '10000');
});
