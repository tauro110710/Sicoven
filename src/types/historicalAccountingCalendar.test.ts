import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalFiscalExercises,
  convertVenezuelanAmount,
  getVenezuelanMonetaryEra,
  roundHistoricalPresentationAmount,
  convertVenezuelanAmountByDate, normalizeBolivarAmountByDate,
  expressBolivarAmountByDate, getBolivarScaleMetadataByDate
} from './historicalAccountingCalendar';

test('genera ejercicios desde el inicio real de operaciones sin imponer año mínimo', () => {
  const exercises = buildHistoricalFiscalExercises({
    companyId: 'company-1',
    operationalStartDate: '2015-04-17',
    throughDate: '2026-11-20',
    closedThroughDate: '2023-12-31',
    closingFiscalYears: [2024]
  });
  assert.equal(exercises.length, 12);
  assert.deepEqual(exercises[0], {
    id: 'company-1:2015',
    companyId: 'company-1',
    fiscalYear: 2015,
    startDate: '2015-04-17',
    endDate: '2015-12-31',
    status: 'CERRADO'
  });
  assert.equal(exercises[8].fiscalYear, 2023);
  assert.equal(exercises[8].status, 'CERRADO');
  assert.equal(exercises[9].status, 'EN_CIERRE');
  assert.equal(exercises[11].status, 'ABIERTO');
});

test('permite reconstruir ejercicios anteriores a 2015 cuando esa fue la fecha real', () => {
  const exercises = buildHistoricalFiscalExercises({
    companyId: 'company-legacy',
    operationalStartDate: '1998-09-03',
    throughDate: '2000-12-31'
  });
  assert.deepEqual(exercises.map(item => item.fiscalYear), [1998, 1999, 2000]);
  assert.equal(exercises[0].startDate, '1998-09-03');
});

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

test('bloquea fechas e importes inválidos y ejercicios con cronología incorrecta', () => {
  assert.throws(() => getVenezuelanMonetaryEra('2021-02-30'));
  assert.throws(() => convertVenezuelanAmount('NaN', 'BOLIVAR_SOBERANO', 'BOLIVAR_DIGITAL'));
  assert.throws(() => buildHistoricalFiscalExercises({
    companyId: 'company-1',
    operationalStartDate: '2026-02-01',
    throughDate: '2025-12-31'
  }));
});


test('date wrappers use the operation-date denomination and exact redenomination boundaries', () => {
  assert.equal(normalizeBolivarAmountByDate('100000000000000', '2007-12-31'), '1');
  assert.equal(normalizeBolivarAmountByDate('100000000000', '2018-08-19'), '1');
  assert.equal(normalizeBolivarAmountByDate('1000000', '2018-08-20'), '1');
  assert.equal(normalizeBolivarAmountByDate('1', '2021-10-01'), '1');
  assert.equal(convertVenezuelanAmountByDate('100000000000', '2010-01-01', '2019-01-01'), '1000000');
  assert.equal(convertVenezuelanAmountByDate('1', '2022-01-01', '2010-01-01'), '100000000000');
});

test('date-scale metadata is suitable for historical report annotations', () => {
  assert.deepEqual(getBolivarScaleMetadataByDate('2019-04-02'), {
    eraId: 'BOLIVAR_SOBERANO',
    label: 'Bolívar Soberano (Bs.S)',
    effectiveFrom: '2018-08-20',
    factorToCurrent: '1000000',
    legalReference: 'Decreto N° 3.548; G.O. N° 41.446; vigencia efectiva 2018-08-20'
  });
  assert.equal(expressBolivarAmountByDate('2.5', '2010-01-01'), '250000000000');
});
