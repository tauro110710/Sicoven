import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatIslrVoucherNumber,
  ISLR_VOUCHER_SEQUENCE_MAX,
  ISLR_VOUCHER_14_DIGIT_EFFECTIVE_DATE,
  getMaxIslrVoucherSequence
} from './islrVoucherNumber';

test('conserva el formato histórico antes de la entrada en vigor', () => {
  assert.equal(formatIslrVoucherNumber('202704', 1, '2027-04-18'), 'ISLR-202704-000001');
});

test('activa AAAAMM + ocho dígitos desde la fecha efectiva', () => {
  assert.equal(ISLR_VOUCHER_14_DIGIT_EFFECTIVE_DATE, '2027-04-19');
  assert.equal(formatIslrVoucherNumber('202704', 1, '2027-04-19'), '20270400000001');
  assert.equal(formatIslrVoucherNumber('202705', 123456, '2027-05-01'), '20270500123456');
});

test('acepta el máximo correlativo de ocho dígitos sin truncarlo', () => {
  assert.equal(formatIslrVoucherNumber('202704', ISLR_VOUCHER_SEQUENCE_MAX, '2027-04-19'), '20270499999999');
});

test('rechaza el desbordamiento sin reiniciar el correlativo', () => {
  assert.throws(() => formatIslrVoucherNumber('202704', ISLR_VOUCHER_SEQUENCE_MAX + 1, '2027-04-19'), /agotó el correlativo/);
});

test('rechaza períodos, fechas y correlativos inconsistentes', () => {
  assert.throws(() => formatIslrVoucherNumber('202713', 1, '2027-04-19'), /mes inválido/);
  assert.throws(() => formatIslrVoucherNumber('202703', 1, '2027-04-19'), /no coincide/);
  assert.throws(() => formatIslrVoucherNumber('202704', 0, '2027-04-19'), /entero positivo/);
  assert.throws(() => formatIslrVoucherNumber('202704', 1, '2027-02-30'), /fecha de emisión/);
});

test('obtiene el mayor correlativo existente, no el número de documentos', () => {
  assert.equal(
    getMaxIslrVoucherSequence('202704', ['ISLR-202704-000001', 'ISLR-202704-000009', '20270400000007', 'otro']),
    9
  );
  assert.equal(getMaxIslrVoucherSequence('202705', ['20270400000099', 'ISLR-202704-000010']), 0);
});
