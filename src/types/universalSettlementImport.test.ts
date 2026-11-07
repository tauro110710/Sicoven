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

test('rechaza una factura seleccionada dos veces para impedir duplicar sus liquidaciones', () => {
  const selected = invoice();
  assert.throws(
    () => planUniversalInvoiceSettlements([selected, selected], [selected, settlement()], 'sales'),
    /clave de origen vacía o duplicada/
  );
});


test('rechaza importes liquidados agregados sin detalle de movimientos', () => {
  const source = { ...invoice(), paidAmountBs: 100 };
  assert.throws(
    () => planUniversalInvoiceSettlements([source], [source], 'sales'),
    /desglosarse en registros/
  );
});

test('rechaza tipos declarados desconocidos en una liquidación', () => {
  const row = { ...settlement(), transactionType: 'ajuste-desconocido' };
  assert.throws(
    () => planUniversalInvoiceSettlements([invoice()], [invoice(), row], 'sales'),
    /tipo de operación no reconocido/
  );
});


test('reconoce transferencia bancaria en USD escrita en español', () => {
  const row = { ...settlement(), method: 'transferencia USD', bankAccountId: 'bank-usd', reference: 'TRX-009' };
  const result = planUniversalInvoiceSettlements([invoice()], [invoice(), row], 'sales');
  assert.equal(result[0].settlements[0].method, 'BANK_TRANSFER_USD');
  assert.equal(result[0].settlements[0].bankAccountId, 'bank-usd');
});
