import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCreditSettlementJournalItems } from './creditSettlementAccounting';

const cash = { code: '1.1.1.01', name: 'Banco' };
const control = { code: '1.1.2.01', name: 'CxC' };
const gain = { code: '4.2.1.01', name: 'Ganancia cambiaria' };
const loss = { code: '6.1.1.08', name: 'Pérdida cambiaria' };
const base = { method: 'BANK_TRANSFER_BS', amountUsd: 10, amountBs: 1100, invoiceRate: 100, settlementRate: 110, cashAccount: cash, controlAccount: control, fxGainAccount: gain, fxLossAccount: loss };

test('plans a sale collection with exchange gain without mutating its inputs', () => {
  const input = { ...base, kind: 'SALE_COLLECTION' as const };
  const before = structuredClone(input);
  const lines = buildCreditSettlementJournalItems(input);
  assert.deepEqual(input, before);
  assert.equal(lines.length, 3);
  assert.equal(lines[0].debitBs, 1100);
  assert.equal(lines[1].creditBs, 1000);
  assert.equal(lines[2].accountCode, gain.code);
  assert.equal(lines[2].creditBs, 100);
});

test('plans a purchase payment with exchange loss', () => {
  const lines = buildCreditSettlementJournalItems({ ...base, kind: 'PURCHASE_PAYMENT' });
  assert.equal(lines[0].accountCode, control.code);
  assert.equal(lines[1].accountCode, cash.code);
  assert.equal(lines[2].accountCode, loss.code);
  assert.equal(lines[2].debitBs, 100);
});

test('plans equal-rate settlement without an FX account', () => {
  const lines = buildCreditSettlementJournalItems({ ...base, kind: 'SALE_COLLECTION', amountBs: 1000, settlementRate: 100, fxGainAccount: undefined, fxLossAccount: undefined });
  assert.equal(lines.length, 2);
});

test('rejects missing FX account when a difference must be recognized', () => {
  assert.throws(() => buildCreditSettlementJournalItems({ ...base, kind: 'SALE_COLLECTION', fxGainAccount: undefined }), /diferencia cambiaria/);
});

test('rejects amounts that do not reconcile to settlement rate', () => {
  assert.throws(() => buildCreditSettlementJournalItems({ ...base, kind: 'SALE_COLLECTION', amountBs: 1099 }), /no coincide/);
});

test('rejects invalid amounts and unresolved ledger accounts', () => {
  assert.throws(() => buildCreditSettlementJournalItems({ ...base, kind: 'SALE_COLLECTION', amountUsd: 0 }), /válidos/);
  assert.throws(() => buildCreditSettlementJournalItems({ ...base, kind: 'SALE_COLLECTION', cashAccount: undefined as never }), /cuentas contables/);
});
