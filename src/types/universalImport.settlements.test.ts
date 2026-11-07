import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mapUniversalSettlementPreview,
  planUniversalInvoiceSettlements
} from './universalImport';

const invoice = (id = 'invoice-1', totalUsd = 10) => ({
  id,
  migrationfile: 'legacy.json',
  migrationrowid: 'legacy.json|invoices|0',
  invoiceNumber: id,
  customerRif: 'J-12345678-9',
  totalAmountUsd: totalUsd
});

const payment = (overrides: Record<string, unknown> = {}) => ({
  id: 'payment-1',
  migrationfile: 'legacy.json',
  migrationrowid: 'legacy.json|payments|0',
  invoiceId: 'invoice-1',
  settlementDate: '2026-11-06',
  settlementAmountBs: 1000,
  settlementAmountUsd: 10,
  settlementBcvRate: 100,
  method: 'transferencia',
  bankAccountId: 'bank-1',
  reference: 'TRX-001',
  ...overrides
});

test('previsualiza una transferencia con fecha, tasa, importes y referencia explícitos', () => {
  const result = mapUniversalSettlementPreview(payment());
  assert.equal(result.settlementDate, '2026-11-06');
  assert.equal(result.bcvRate, 100);
  assert.equal(result.amountBs, 1000);
  assert.equal(result.amountUsd, 10);
  assert.equal(result.method, 'BANK_TRANSFER_BS');
  assert.equal(result.bankAccountId, 'bank-1');
  assert.equal(result.reference, 'TRX-001');
  assert.equal(result.sourceRowId, 'legacy.json|payments|0');
});

test('rechaza fechas inexistentes aunque tengan formato ISO', () => {
  assert.throws(() => mapUniversalSettlementPreview(payment({ settlementDate: '2026-02-30' })), /fecha válida/);
});

test('rechaza importes Bs/USD que no concilian con la tasa histórica', () => {
  assert.throws(() => mapUniversalSettlementPreview(payment({ settlementAmountUsd: 9 })), /no concilian/);
});

test('rechaza transferencias sin cuenta bancaria destino', () => {
  assert.throws(() => mapUniversalSettlementPreview(payment({ bankAccountId: '' })), /ID de una cuenta bancaria real/);
});

test('rechaza transferencias sin referencia bancaria', () => {
  assert.throws(() => mapUniversalSettlementPreview(payment({ reference: '' })), /referencia o comprobante/);
});

test('rechaza liquidaciones sin identificador estable de fila', () => {
  assert.throws(() => mapUniversalSettlementPreview(payment({ migrationrowid: '' })), /identificador estable/);
});

test('rechaza un lote que liquida por encima del total de la factura', () => {
  const sourceInvoice = invoice('invoice-1', 10);
  const first = payment({ settlementAmountBs: 700, settlementAmountUsd: 7 });
  const second = payment({
    id: 'payment-2',
    migrationrowid: 'legacy.json|payments|1',
    settlementAmountBs: 400,
    settlementAmountUsd: 4
  });
  assert.throws(
    () => planUniversalInvoiceSettlements([sourceInvoice], [sourceInvoice, first, second], 'sales'),
    /superan su total/
  );
});

test('rechaza una liquidación clasificada como pago de proveedor para una venta', () => {
  const sourceInvoice = invoice();
  const row = payment({ transactionType: 'pago' });
  assert.throws(
    () => planUniversalInvoiceSettlements([sourceInvoice], [sourceInvoice, row], 'sales'),
    /tipo incompatible/
  );
});

test('permite la misma referencia bancaria en cuentas distintas', () => {
  const firstInvoice = invoice('invoice-1', 10);
  const secondInvoice = {
    ...invoice('invoice-2', 10),
    migrationrowid: 'legacy.json|invoices|1'
  };
  const first = payment({ bankAccountId: 'bank-1', reference: 'TRX-009' });
  const second = payment({
    id: 'payment-2',
    migrationrowid: 'legacy.json|payments|1',
    invoiceId: 'invoice-2',
    bankAccountId: 'bank-2',
    reference: 'TRX-009'
  });
  const result = planUniversalInvoiceSettlements(
    [firstInvoice, secondInvoice],
    [firstInvoice, secondInvoice, first, second],
    'sales'
  );
  assert.equal(result.reduce((count, item) => count + item.settlements.length, 0), 2);
});

test('rechaza la misma referencia bancaria repetida en la misma cuenta sin distinguir espacios y mayúsculas', () => {
  const firstInvoice = invoice('invoice-1', 10);
  const secondInvoice = {
    ...invoice('invoice-2', 10),
    migrationrowid: 'legacy.json|invoices|1'
  };
  const first = payment({ bankAccountId: 'bank-1', reference: 'TRX 009' });
  const second = payment({
    id: 'payment-2',
    migrationrowid: 'legacy.json|payments|1',
    invoiceId: 'invoice-2',
    bankAccountId: ' BANK-1 ',
    reference: 'trx009'
  });
  assert.throws(
    () => planUniversalInvoiceSettlements(
      [firstInvoice, secondInvoice],
      [firstInvoice, secondInvoice, first, second],
      'sales'
    ),
    /referencia bancaria.*repetida/
  );
});
