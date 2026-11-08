import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSupplierAdvanceSettlementJournalItems } from './supplierAdvanceSettlementAccounting';

const accounts = {
  counterpartAccount: { code: '1.1.1.03', name: 'Banco' },
  advanceAccount: { code: '1.1.3.01', name: 'Anticipos a proveedores' },
  fxGainAccount: { code: '4.2.1.01', name: 'Ganancia cambiaria' },
  fxLossAccount: { code: '6.1.1.08', name: 'Pérdida cambiaria' }
};

test('planifica reembolso con ganancia cambiaria sin mutar entradas', () => {
  const input = { kind: 'REFUND_RECEIVED' as const, amountUsd: 10, settlementValueBs: 1100, advanceBookValueBs: 1000, exchangeDifferenceBs: 100, ...accounts };
  const before = structuredClone(input);
  const items = buildSupplierAdvanceSettlementJournalItems(input);
  assert.deepEqual(input, before);
  assert.deepEqual(items.map(item => [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd]), [[1100, 0, 10, 0], [0, 1000, 0, 10], [0, 100, 0, 0]]);
  assert.equal(items[2].accountCode, '4.2.1.01');
});

test('planifica aplicación con pérdida cambiaria conservando valor histórico FIFO', () => {
  const items = buildSupplierAdvanceSettlementJournalItems({ kind: 'APPLIED_TO_PURCHASE' as const, amountUsd: 10, settlementValueBs: 900, advanceBookValueBs: 1000, exchangeDifferenceBs: -100, ...accounts });
  assert.deepEqual(items.map(item => [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd]), [[900, 0, 10, 0], [0, 1000, 0, 10], [100, 0, 0, 0]]);
  assert.equal(items[2].accountCode, '6.1.1.08');
});

test('omite líneas FX cuando no existe diferencia material', () => {
  const items = buildSupplierAdvanceSettlementJournalItems({ kind: 'REFUND_RECEIVED' as const, amountUsd: 10, settlementValueBs: 1000, advanceBookValueBs: 1000, exchangeDifferenceBs: 0, ...accounts });
  assert.equal(items.length, 2);
});

test('rechaza diferencia cambiaria incongruente y cuentas FX incompletas', () => {
  assert.throws(() => buildSupplierAdvanceSettlementJournalItems({ kind: 'REFUND_RECEIVED' as const, amountUsd: 10, settlementValueBs: 1100, advanceBookValueBs: 1000, exchangeDifferenceBs: 50, ...accounts }), /no coincide/);
  assert.throws(() => buildSupplierAdvanceSettlementJournalItems({ kind: 'REFUND_RECEIVED' as const, amountUsd: 10, settlementValueBs: 1100, advanceBookValueBs: 1000, exchangeDifferenceBs: 100, ...accounts, fxGainAccount: undefined }), /Falta la cuenta de ganancia/);
});

test('permite ganancia cambiaria cuando solo existe la cuenta de ganancia', () => {
  const { fxLossAccount: _unused, ...gainOnly } = accounts;
  const items = buildSupplierAdvanceSettlementJournalItems({
    kind: 'REFUND_RECEIVED', amountUsd: 10, settlementValueBs: 1100,
    advanceBookValueBs: 1000, exchangeDifferenceBs: 100, ...gainOnly
  });
  assert.equal(items[2].accountCode, '4.2.1.01');
});

test('permite pérdida cambiaria cuando solo existe la cuenta de pérdida', () => {
  const { fxGainAccount: _unused, ...lossOnly } = accounts;
  const items = buildSupplierAdvanceSettlementJournalItems({
    kind: 'APPLIED_TO_PURCHASE', amountUsd: 10, settlementValueBs: 900,
    advanceBookValueBs: 1000, exchangeDifferenceBs: -100, ...lossOnly
  });
  assert.equal(items[2].accountCode, '6.1.1.08');
});

test('mantiene partida doble en Bs y USD para reembolso y aplicación', () => {
  for (const [kind, settlementValueBs, advanceBookValueBs, exchangeDifferenceBs] of [
    ['REFUND_RECEIVED', 1100, 1000, 100],
    ['APPLIED_TO_PURCHASE', 900, 1000, -100],
    ['REFUND_RECEIVED', 1000, 1000, 0]
  ] as const) {
    const items = buildSupplierAdvanceSettlementJournalItems({
      kind, amountUsd: 10, settlementValueBs, advanceBookValueBs,
      exchangeDifferenceBs, ...accounts
    });
    const sum = (key: 'debitBs' | 'creditBs' | 'debitUsd' | 'creditUsd') =>
      items.reduce((total, item) => total + Number(item[key] || 0), 0);
    assert.equal(Math.round(sum('debitBs') * 100), Math.round(sum('creditBs') * 100));
    assert.equal(Math.round(sum('debitUsd') * 1000000), Math.round(sum('creditUsd') * 1000000));
  }
});
