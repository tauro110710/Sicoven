import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupplierAdvanceSettlementJournalItems } from './supplierAdvanceSettlementAccounting';

const accounts = {
  counterpartAccount: { code: '1.1.1.03', name: 'Banco' },
  advanceAccount: { code: '1.1.3.01', name: 'Anticipos a proveedores' },
  fxGainAccount: { code: '4.2.1.01', name: 'Ganancia cambiaria' },
  fxLossAccount: { code: '6.1.1.08', name: 'Pérdida cambiaria' }
};

test('planifica reembolso con ganancia cambiaria sin mutar sus entradas', () => {
  const input = {
    kind: 'REFUND_RECEIVED' as const, amountUsd: 10,
    settlementValueBs: 1100, advanceBookValueBs: 1000,
    exchangeDifferenceBs: 100, ...accounts
  };
  const before = structuredClone(input);
  const items = buildSupplierAdvanceSettlementJournalItems(input);
  assert.deepEqual(input, before);
  assert.deepEqual(items.map(item => [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd]), [
    [1100, 0, 10, 0], [0, 1000, 0, 10], [0, 100, 0, 0]
  ]);
  assert.equal(items[2].accountCode, '4.2.1.01');
});

test('planifica aplicación con pérdida cambiaria y conserva valor histórico FIFO', () => {
  const items = buildSupplierAdvanceSettlementJournalItems({
    kind: 'APPLIED_TO_PURCHASE', amountUsd: 10,
    settlementValueBs: 900, advanceBookValueBs: 1000,
    exchangeDifferenceBs: -100, ...accounts
  });
  assert.deepEqual(items.map(item => [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd]), [
    [900, 0, 10, 0], [0, 1000, 0, 10], [100, 0, 0, 0]
  ]);
  assert.equal(items[2].accountCode, '6.1.1.08');
});

test('no agrega líneas FX cuando la diferencia es menor a un céntimo', () => {
  const items = buildSupplierAdvanceSettlementJournalItems({
    kind: 'REFUND_RECEIVED', amountUsd: 10,
    settlementValueBs: 1000, advanceBookValueBs: 1000,
    exchangeDifferenceBs: 0, ...accounts
  });
  assert.equal(items.length, 2);
});

test('rechaza diferencia cambiaria incongruente y cuentas incompletas', () => {
  assert.throws(() => buildSupplierAdvanceSettlementJournalItems({
    kind: 'REFUND_RECEIVED', amountUsd: 10,
    settlementValueBs: 1100, advanceBookValueBs: 1000,
    exchangeDifferenceBs: 50, ...accounts
  }), /no coincide/);
  assert.throws(() => buildSupplierAdvanceSettlementJournalItems({
    kind: 'REFUND_RECEIVED', amountUsd: 10,
    settlementValueBs: 1100, advanceBookValueBs: 1000,
    exchangeDifferenceBs: 100, ...accounts, fxGainAccount: undefined
  }), /Faltan las cuentas/);
});
