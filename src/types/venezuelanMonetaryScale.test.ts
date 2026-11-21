import test from 'node:test';
import assert from 'node:assert/strict';
import {
  VENEZUELAN_MONETARY_PERIODS, getVenezuelanMonetaryPeriod, getCurrentBolivarFactor,
  normalizeBolivarAmountToCurrent, expressCurrentBolivarAmountAtDate,
  convertBolivarAmountBetweenDates, getBolivarScaleMetadata
} from './venezuelanMonetaryScale';

test('identifies each historical denomination period at exact boundaries', () => {
  assert.equal(getVenezuelanMonetaryPeriod('2007-12-31').id, 'BOLIVAR_ORIGINAL');
  assert.equal(getVenezuelanMonetaryPeriod('2008-01-01').id, 'BOLIVAR_FUERTE');
  assert.equal(getVenezuelanMonetaryPeriod('2018-08-19').id, 'BOLIVAR_FUERTE');
  assert.equal(getVenezuelanMonetaryPeriod('2018-08-20').id, 'BOLIVAR_SOBERANO');
  assert.equal(getVenezuelanMonetaryPeriod('2021-09-30').id, 'BOLIVAR_SOBERANO');
  assert.equal(getVenezuelanMonetaryPeriod('2021-10-01').id, 'BOLIVAR_CURRENT');
});

test('exposes cumulative denomination factors exactly', () => {
  assert.equal(getCurrentBolivarFactor('2007-12-31'), '100000000000000');
  assert.equal(getCurrentBolivarFactor('2008-01-01'), '100000000000');
  assert.equal(getCurrentBolivarFactor('2018-08-20'), '1000000');
  assert.equal(getCurrentBolivarFactor('2021-10-01'), '1');
  assert.equal(VENEZUELAN_MONETARY_PERIODS.length, 4);
});

test('normalizes dated historical amounts to current scale without float rounding', () => {
  assert.equal(normalizeBolivarAmountToCurrent('100000000000000', '2007-12-31'), '1');
  assert.equal(normalizeBolivarAmountToCurrent('100000000000', '2010-05-03'), '1');
  assert.equal(normalizeBolivarAmountToCurrent('1000000', '2019-03-10'), '1');
  assert.equal(normalizeBolivarAmountToCurrent('12.3456789', '2022-01-01'), '12.3456789');
  assert.equal(normalizeBolivarAmountToCurrent('-250000', '2019-01-01'), '-0.25');
});

test('expresses current scale in a historical denomination exactly', () => {
  assert.equal(expressCurrentBolivarAmountAtDate('1.25', '2007-12-31'), '125000000000000');
  assert.equal(expressCurrentBolivarAmountAtDate('1.25', '2010-01-01'), '125000000000');
  assert.equal(expressCurrentBolivarAmountAtDate('1.25', '2019-01-01'), '1250000');
  assert.equal(expressCurrentBolivarAmountAtDate('1.25', '2025-01-01'), '1.25');
});

test('converts nominal amounts between dates across one or multiple redenominations', () => {
  assert.equal(convertBolivarAmountBetweenDates('100000000000', '2010-01-01', '2019-01-01'), '100000');
  assert.equal(convertBolivarAmountBetweenDates('1000000', '2019-01-01', '2022-01-01'), '1');
  assert.equal(convertBolivarAmountBetweenDates('100000000000000', '2000-01-01', '2022-01-01'), '1');
  assert.equal(convertBolivarAmountBetweenDates('1', '2022-01-01', '2010-01-01'), '100000000000');
});

test('provides report metadata and rejects invalid dates', () => {
  assert.deepEqual(getBolivarScaleMetadata('2021-10-01'), {
    periodId: 'BOLIVAR_CURRENT', label: 'Bolívar vigente desde 01-10-2021', currentFactor: '1', effectiveDate: '2021-10-01'
  });
  assert.throws(() => getVenezuelanMonetaryPeriod('2018-02-30'), /fecha/);
  assert.throws(() => getVenezuelanMonetaryPeriod(''), /formato/);
});
