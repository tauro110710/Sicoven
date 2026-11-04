import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateJournalEntryAccounts, isJournalEntryBalanced } from './journalEntryValidation';
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
