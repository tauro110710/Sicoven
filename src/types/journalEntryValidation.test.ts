import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalEntryAccounts, isJournalEntryBalanced, convertBsToUsdAmount, isJournalEntryCurrencyPolicySatisfied } from './journalEntryValidation';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../data/defaultChartOfAccounts';

describe('journal entry account validation', () => {
  it('accepts existing movement accounts', () => {
    const movement = DEFAULT_CHART_OF_ACCOUNTS.find(account => account.isMovement);
    assert.ok(movement);
    assert.doesNotThrow(() => validateJournalEntryAccounts([{ accountCode: movement!.code }], DEFAULT_CHART_OF_ACCOUNTS));
  });

  it('rejects account codes absent from the chart', () => {
    assert.throws(
      () => validateJournalEntryAccounts([{ accountCode: '9.9.9.99' }], DEFAULT_CHART_OF_ACCOUNTS),
      /no existe en el plan de cuentas/
    );
  });

  it('rejects grouping accounts that cannot receive postings', () => {
    const grouping = DEFAULT_CHART_OF_ACCOUNTS.find(account => !account.isMovement);
    assert.ok(grouping);
    assert.throws(
      () => validateJournalEntryAccounts([{ accountCode: grouping!.code }], DEFAULT_CHART_OF_ACCOUNTS),
      /es agrupadora/
    );
  });

  it('rejects inactive movement accounts', () => {
    const movement = DEFAULT_CHART_OF_ACCOUNTS.find(account => account.isMovement);
    assert.ok(movement);
    assert.throws(
      () => validateJournalEntryAccounts([{ accountCode: movement!.code }], [{ ...movement!, isActive: false }]),
      /está inactiva/
    );
  });

  it('rejects blank account codes', () => {
    assert.throws(
      () => validateJournalEntryAccounts([{ accountCode: '  ' }], DEFAULT_CHART_OF_ACCOUNTS),
      /no existe en el plan de cuentas/
    );
  });
});


describe('journal entry dual-currency balance indicator', () => {
  it('accepts an entry balanced in Bs. and USD', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 1000, creditBs: 1000, debitUsd: 10, creditUsd: 10 }), true);
  });
  it('rejects an entry balanced in Bs. but unbalanced in USD', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 1000, creditBs: 1000, debitUsd: 10, creditUsd: 9.99 }), false);
  });
  it('rejects an entry balanced in USD but unbalanced in Bs.', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 1000, creditBs: 999, debitUsd: 10, creditUsd: 10 }), false);
  });
  it('rejects USD imbalances that the former one-cent context tolerance allowed', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 1000, creditBs: 1000, debitUsd: 10, creditUsd: 9.991 }), false);
  });
  it('accepts sub-micro-dollar floating-point noise within the journal tolerance', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 1000, creditBs: 1000, debitUsd: 10, creditUsd: 9.9999995 }), true);
  });
  it('rejects empty or invalid entries', () => {
    assert.equal(isJournalEntryBalanced({ debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 }), false);
    assert.equal(isJournalEntryBalanced({ debitBs: -1, creditBs: -1, debitUsd: 0, creditUsd: 0 }), false);
  });
});

test('la conversión manual Bs./USD conserva precisión interna y no redondea cada renglón a centavos', () => {
  const value = convertBsToUsdAmount(100, 900);
  assert.equal(value, 100 / 900);
  assert.ok(Math.abs(value * 900 - 100) < 1e-10);
});

test('la conversión manual rechaza importes o tasas inválidos', () => {
  assert.throws(() => convertBsToUsdAmount(-1, 900), /importe en Bs/);
  assert.throws(() => convertBsToUsdAmount(100, 0), /tasa BCV/);
  assert.throws(() => convertBsToUsdAmount(Number.NaN, 900), /importe en Bs/);
});

test('mantiene conciliación USD al dividir un importe en varios renglones', () => {
  const debitUsd = Array.from({ length: 10 }, () => convertBsToUsdAmount(1, 3))
    .reduce((sum, amount) => sum + amount, 0);
  const creditUsd = convertBsToUsdAmount(10, 3);
  assert.ok(Math.abs(debitUsd - creditUsd) < 0.000001);
});

test('acepta asientos historicos cuadrados solo en Bs. cuando no existe equivalencia USD', () => {
  assert.equal(isJournalEntryBalanced({ debitBs: 1120000, creditBs: 1120000, debitUsd: 0, creditUsd: 0 }), true);
});

test('exige cuadrar USD cuando el asiento ya contiene equivalencias convertidas', () => {
  assert.equal(isJournalEntryBalanced({ debitBs: 1120000, creditBs: 1120000, debitUsd: 1120000, creditUsd: 1119999 }), false);
});

describe('date-aware journal BCV policy', () => {
  it('allows historical Bs-only journal entries with no BCV rate', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2014-01-01',bcvRate:0,debitBs:1120000,debitUsd:0}),true);
  });
  it('allows historical USD-only journal entries with no BCV rate', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2017-12-31',bcvRate:0,debitBs:0,debitUsd:500}),true);
  });
  it('allows historical voluntary dual-currency entries when the rate is supplied', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2017-12-31',bcvRate:6.3,debitBs:630,debitUsd:100}),true);
  });
  it('rejects historical dual-currency entries without an explicit rate', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2017-12-31',bcvRate:0,debitBs:630,debitUsd:100}),false);
  });
  it('rejects historical rate-only entries that omit one currency side', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2017-12-31',bcvRate:6.3,debitBs:630,debitUsd:0}),false);
  });
  it('allows Bs-only entries without BCV after 2018 when no conversion is required', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2018-01-01',bcvRate:0,debitBs:630,debitUsd:0}),true);
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2026-11-22',bcvRate:0,debitBs:630,debitUsd:0}),true);
  });
  it('requires BCV for post-2018 entries that actually contain dual-currency equivalents', () => {
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2018-01-01',bcvRate:0,debitBs:630,debitUsd:100}),false);
    assert.equal(isJournalEntryCurrencyPolicySatisfied({date:'2018-01-01',bcvRate:6.3,debitBs:630,debitUsd:100}),true);
  });
  it('rejects invalid dates instead of treating them as pre-2018', () => {
    for (const date of ['', '2018-02-30', 'abc']) {
      assert.equal(isJournalEntryCurrencyPolicySatisfied({date,bcvRate:0,debitBs:630,debitUsd:0}),false);
    }
  });
});
