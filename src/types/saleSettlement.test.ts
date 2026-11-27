import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSaleSettlementMode } from './saleSettlement';

const accounts = [
  { code: '1.1.1.01', name: 'Caja Principal (Moneda Nacional Bs.)', type: 'ACTIVO', isMovement: true },
  { code: '1.1.1.03.01', name: 'Banco Nacional de Crédito Bs.', type: 'ACTIVO', isMovement: true },
  { code: '1.1.2.01', name: 'Cuentas por Cobrar Clientes', type: 'ACTIVO', isMovement: true }
];

test('exige la cuenta de caja/banco como contrapartida del cobro de contado', () => {
  const message = validateSaleSettlementMode({ paymentTerm: 'CONTADO', paymentMethod: 'CASH_BS', accounts }) || '';
  assert.match(message, /Caja o Banco/);
});

test('rechaza una cuenta por cobrar como contrapartida de un cobro de contado', () => {
  const message = validateSaleSettlementMode({
    paymentTerm: 'CONTADO', paymentMethod: 'CASH_BS', paymentAccountCode: '1.1.2.01', accounts
  }) || '';
  assert.match(message, /Caja o Banco/);
});

test('acepta contado en efectivo con su cuenta de caja', () => {
  assert.equal(validateSaleSettlementMode({
    paymentTerm: 'CONTADO', paymentMethod: 'CASH_BS', paymentAccountCode: '1.1.1.01', accounts
  }), null);
});

test('exige la referencia del comprobante en medios electrónicos', () => {
  const message = validateSaleSettlementMode({
    paymentTerm: 'CONTADO', paymentMethod: 'TRANSFER_BS', paymentAccountCode: '1.1.1.03.01', accounts, paymentReference: ''
  }) || '';
  assert.match(message, /referencia/);
  assert.equal(validateSaleSettlementMode({
    paymentTerm: 'CONTADO', paymentMethod: 'TRANSFER_BS', paymentAccountCode: '1.1.1.03.01', accounts, paymentReference: 'TRF-0001'
  }), null);
});

test('permite ventas a crédito para su circuito de CxC', () => {
  assert.equal(validateSaleSettlementMode({ paymentTerm: 'CREDITO' }), null);
});

test('mantiene compatibilidad con registros históricos sin condición explícita', () => {
  assert.equal(validateSaleSettlementMode({}), null);
});
