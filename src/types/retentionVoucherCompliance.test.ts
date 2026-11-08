import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RETENTION_VOUCHER_EMAIL_EFFECTIVE_DATE,
  validateRetentionVoucherSupplierEmail
} from './retentionVoucherCompliance';

test('permits historical retention vouchers without supplier email', () => {
  assert.doesNotThrow(() => validateRetentionVoucherSupplierEmail(undefined, '2027-04-18'));
});

test('requires supplier email from the effective date of SNAT/2026/00093', () => {
  assert.equal(RETENTION_VOUCHER_EMAIL_EFFECTIVE_DATE, '2027-04-19');
  assert.throws(
    () => validateRetentionVoucherSupplierEmail(undefined, '2027-04-19'),
    /exige el correo electrónico del proveedor/
  );
  assert.doesNotThrow(() => validateRetentionVoucherSupplierEmail('proveedor@ejemplo.com', '2027-04-19'));
});

test('rejects malformed supplier email when supplied', () => {
  assert.throws(
    () => validateRetentionVoucherSupplierEmail('correo-no-valido', '2026-11-07'),
    /formato válido/
  );
  assert.throws(
    () => validateRetentionVoucherSupplierEmail('x'.repeat(250) + '@a.com', '2026-11-07'),
    /formato válido/
  );
});

test('rejects invalid voucher issue dates', () => {
  assert.throws(() => validateRetentionVoucherSupplierEmail('a@b.com', '2027-02-30'), /fecha de emisión/);
  assert.throws(() => validateRetentionVoucherSupplierEmail('a@b.com', ''), /fecha de emisión/);
});
