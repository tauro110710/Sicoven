import test from 'node:test';
import assert from 'node:assert/strict';
import { planUniversalInvoiceSettlements } from './universalImport';

const invoice = (id = 'inv-1') => ({
  id, migrationfile: 'origen.json', migrationrowid: 'origen.json|ventas|0',
  invoiceNumber: 'F-001', customerRif: 'J-12345678-9',
  totalAmountBs: 200, totalAmountUsd: 2, bcvRate: 100
});
const settlement = (id = 'pay-1', amountBs = 100) => ({
  id, migrationfile: 'origen.json', migrationrowid: 'origen.json|pagos|0',
  invoiceId: 'inv-1', settlementDate: '2026-11-06',
  settlementAmountBs: amountBs, settlementAmountUsd: amountBs / 100,
  settlementBcvRate: 100, method: 'cash'
});

test('vincula liquidaciones por FK explícita y conserva su clave de origen', () => {
  const result = planUniversalInvoiceSettlements([invoice()], [invoice(), settlement()], 'sales');
  assert.equal(result.length, 1);
  assert.equal(result[0].settlements.length, 1);
  assert.equal(result[0].settlements[0].sourceRowId, 'origen.json|pagos|0');
});

test('no cruza liquidaciones entre archivos', () => {
  const foreign = { ...settlement(), migrationfile: 'otro.json' };
  const result = planUniversalInvoiceSettlements([invoice()], [invoice(), foreign], 'sales');
  assert.deepEqual(result[0].settlements, []);
});

test('rechaza liquidaciones que exceden el total de la factura', () => {
  assert.throws(
    () => planUniversalInvoiceSettlements([invoice()], [invoice(), settlement('pay-1', 150), { ...settlement('pay-2', 100), migrationrowid: 'origen.json|pagos|1' }], 'sales'),
    /superan su total/
  );
});

test('rechaza una misma liquidación asociada a más de una factura', () => {
  const second = { ...invoice('inv-2'), migrationrowid: 'origen.json|ventas|1', invoiceNumber: 'F-002' };
  const shared = settlement();
  const duplicated = { ...shared, migrationrowid: 'origen.json|pagos|1', invoiceId: 'inv-2' };
  assert.throws(
    () => planUniversalInvoiceSettlements([invoice(), second], [invoice(), second, shared, duplicated], 'sales'),
    /vinculada más de una vez/
  );
});
