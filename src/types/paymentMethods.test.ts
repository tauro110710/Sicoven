import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_METHODS,
  isIgtfEligiblePaymentMethod,
  listPaymentCounterpartAccounts,
  paymentMethodLabel,
  salePaymentCurrencyForMethod,
  suggestPaymentAccountCode,
  validatePaymentMethodSelection
} from './paymentMethods';

const accounts = [
  { code: '1.1.1.01', name: 'Caja Principal (Moneda Nacional Bs.)', type: 'ACTIVO', isMovement: true },
  { code: '1.1.1.02', name: 'Caja Moneda Extranjera (USD)', type: 'ACTIVO', isMovement: true },
  { code: '1.1.1.03', name: 'Bancos Nacionales en Bolívares (BS.)', type: 'ACTIVO', isMovement: false },
  { code: '1.1.1.03.01', name: 'Banco Nacional de Crédito Bs.', type: 'ACTIVO', isMovement: true },
  { code: '1.1.1.04', name: 'Bancos en Moneda Extranjera (USD)', type: 'ACTIVO', isMovement: false },
  { code: '1.1.1.04.01', name: 'Banco Mercantil USD', type: 'ACTIVO', isMovement: true },
  { code: '1.1.2.01', name: 'Cuentas por Cobrar Clientes', type: 'ACTIVO', isMovement: true }
];
const bankAccounts = [
  { companyId: 'c1', accountCode: '1.1.1.03.01', currency: 'BS' as const },
  { companyId: 'c1', accountCode: '1.1.1.04.01', currency: 'USD' as const }
];

test('el catálogo cubre efectivo Bs./USD, transferencias, pago móvil, tarjeta, Biopago y Zelle', () => {
  const codes = PAYMENT_METHODS.map(method => method.code);
  for (const code of ['CASH_BS', 'CASH_USD', 'TRANSFER_BS', 'TRANSFER_USD', 'MOBILE_PAYMENT', 'DEBIT_CARD', 'POS', 'BIOPAGO', 'ZELLE'] as const) {
    assert.ok(codes.includes(code), 'falta el medio ' + code);
  }
});

test('etiqueta también los códigos históricos de ventas y compras', () => {
  assert.equal(paymentMethodLabel('BS'), 'Bolívares / medios nacionales');
  assert.equal(paymentMethodLabel('FOREIGN_CASH'), 'Divisas en efectivo');
  assert.match(paymentMethodLabel('BIOPAGO'), /Biopago/);
});

test('solo los medios en moneda extranjera habilitan la evaluación de IGTF', () => {
  assert.equal(isIgtfEligiblePaymentMethod('ZELLE'), true);
  assert.equal(isIgtfEligiblePaymentMethod('CASH_USD'), true);
  assert.equal(isIgtfEligiblePaymentMethod('CRYPTO'), true);
  assert.equal(isIgtfEligiblePaymentMethod('FOREIGN_CASH'), true);
  assert.equal(isIgtfEligiblePaymentMethod('CASH_BS'), false);
  assert.equal(isIgtfEligiblePaymentMethod('POS'), false);
  assert.equal(isIgtfEligiblePaymentMethod('BIOPAGO'), false);
  assert.equal(isIgtfEligiblePaymentMethod('BS'), false);
});

test('clasifica la moneda de cobro para el control fiscal de la venta', () => {
  assert.equal(salePaymentCurrencyForMethod('CASH_USD'), 'FOREIGN_CASH');
  assert.equal(salePaymentCurrencyForMethod('TRANSFER_USD'), 'FOREIGN_TRANSFER');
  assert.equal(salePaymentCurrencyForMethod('ZELLE'), 'FOREIGN_TRANSFER');
  assert.equal(salePaymentCurrencyForMethod('CRYPTO'), 'CRYPTO');
  assert.equal(salePaymentCurrencyForMethod('MOBILE_PAYMENT'), 'BS');
});

test('solo ofrece cajas y bancos propios de la empresa como contrapartida', () => {
  const list = listPaymentCounterpartAccounts(accounts, [{ companyId: 'c1', accountCode: '1.1.1.03.01' }], 'c1');
  const codes = list.map(account => account.code);
  assert.deepEqual(codes, ['1.1.1.01', '1.1.1.02', '1.1.1.03.01']);
  const otherCompany = listPaymentCounterpartAccounts(accounts, bankAccounts, 'c2');
  assert.deepEqual(otherCompany.map(account => account.code), ['1.1.1.01', '1.1.1.02']);
});

test('sugiere la cuenta de tesorería coherente con el medio elegido', () => {
  const list = listPaymentCounterpartAccounts(accounts, bankAccounts, 'c1');
  assert.equal(suggestPaymentAccountCode('CASH_BS', list), '1.1.1.01');
  assert.equal(suggestPaymentAccountCode('CASH_USD', list), '1.1.1.02');
  assert.equal(suggestPaymentAccountCode('TRANSFER_BS', list), '1.1.1.03.01');
  assert.equal(suggestPaymentAccountCode('ZELLE', list), '1.1.1.04.01');
  assert.equal(suggestPaymentAccountCode('MOBILE_PAYMENT', list), '1.1.1.03.01');
  // Sin banco propio no se sugiere una caja para un medio electrónico.
  const onlyCash = listPaymentCounterpartAccounts(accounts, [], 'c1');
  assert.equal(suggestPaymentAccountCode('TRANSFER_BS', onlyCash), '');
});

test('rechaza contrapartidas que no son Caja/Banco y exige referencia electrónica', () => {
  const list = listPaymentCounterpartAccounts(accounts, bankAccounts, 'c1');
  assert.match(validatePaymentMethodSelection({ method: 'CASH_BS', accountCode: '1.1.2.01', accounts: list }) || '', /Caja o Banco/);
  assert.match(validatePaymentMethodSelection({ method: 'TRANSFER_BS', accountCode: '1.1.1.03.01', accounts: list, reference: '' }) || '', /referencia/);
  assert.equal(validatePaymentMethodSelection({ method: 'CASH_BS', accountCode: '1.1.1.01', accounts: list, reference: '' }), null);
  assert.equal(validatePaymentMethodSelection({ method: 'TRANSFER_BS', accountCode: '1.1.1.03.01', accounts: list, reference: 'TRF-001' }), null);
});
