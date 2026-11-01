import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, BankAccount, BankStatementMovement } from './accounting';
import { buildVatPaymentAccountingPlan } from './vatPaymentAccounting';

const accounts: Account[] = [
  { code: '2.1.2.03', name: 'Retenciones de IVA por Enterar', type: 'PASIVO', level: 4, isMovement: true },
  { code: '1.1.1.03', name: 'Banco Bs. 1', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.1.04', name: 'Banco Bs. 2', type: 'ACTIVO', level: 4, isMovement: true }
];
const banks: BankAccount[] = [
  { id: 'b1', companyId: 'c1', accountCode: '1.1.1.03', bankName: 'Banco Uno', accountNumber: '001', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 },
  { id: 'b2', companyId: 'c1', accountCode: '1.1.1.04', bankName: 'Banco Dos', accountNumber: '002', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 }
];
const movement = (id: string, bankAccountId: string, amountBs: number, amountUsd: number): BankStatementMovement => ({
  id, companyId: 'c1', bankAccountId, date: '2026-10-20', reference: id, description: 'Enteramiento SENIAT',
  type: 'DEBIT', amountBs, amountUsd, isReconciled: false
});

test('builds a balanced dual-currency entry using historical bank equivalents', () => {
  const plan = buildVatPaymentAccountingPlan({
    occurredAt: '2026-10-20',
    movements: [movement('m1', 'b1', 75, 0.5), movement('m2', 'b1', 25, 0.2)],
    bankAccounts: banks, accounts
  });
  assert.equal(plan.amountBs, 100);
  assert.equal(plan.amountUsd, 0.7);
  assert.equal(plan.bcvRate, 100 / 0.7);
  assert.equal(plan.items.length, 2);
  assert.equal(plan.items[0].accountCode, '2.1.2.03');
  assert.equal(plan.items[1].accountCode, '1.1.1.03');
  assert.equal(plan.items[0].debitBs, plan.items[1].creditBs);
  assert.equal(plan.items[0].debitUsd, plan.items[1].creditUsd);
});

test('groups bank credits by account when an enteramiento uses multiple accounts', () => {
  const plan = buildVatPaymentAccountingPlan({
    occurredAt: '2026-10-20',
    movements: [movement('m1', 'b1', 60, 0.4), movement('m2', 'b2', 40, 0.3)],
    bankAccounts: banks, accounts
  });
  assert.equal(plan.items.length, 3);
  assert.deepEqual(plan.items.slice(1).map(item => item.accountCode), ['1.1.1.03', '1.1.1.04']);
  assert.equal(plan.items.reduce((sum, item) => sum + item.creditBs, 0), 100);
  assert.equal(plan.items.reduce((sum, item) => sum + item.creditUsd, 0), 0.7);
});

test('rejects missing historical USD equivalent and a missing liability account', () => {
  assert.throws(() => buildVatPaymentAccountingPlan({
    occurredAt: '2026-10-20', movements: [movement('m1', 'b1', 100, 0)],
    bankAccounts: banks, accounts
  }), /equivalentes históricos/);
  assert.throws(() => buildVatPaymentAccountingPlan({
    occurredAt: '2026-10-20', movements: [movement('m1', 'b1', 100, 1)],
    bankAccounts: banks, accounts: accounts.filter(item => item.code !== '2.1.2.03')
  }), /2.1.2.03/);
});
