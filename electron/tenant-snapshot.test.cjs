'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  partitionAccountingSnapshot,
  mergeAccountingSnapshots,
  createEmptyAccountingSnapshot
} = require('./tenant-snapshot.cjs');

function sample() {
  return {
    companies: [{ id: 'company-a', name: 'Empresa A' }, { id: 'company-b', name: 'Empresa B' }],
    currentCompanyId: 'company-b',
    accounts: [{ code: '1.1.1.01', name: 'Caja' }],
    displayCurrency: 'DUAL',
    journalEntries: [{ id: 'j-a', companyId: 'company-a' }, { id: 'j-b', companyId: 'company-b' }],
    purchases: [{ id: 'p-a', companyId: 'company-a' }],
    sales: [{ id: 's-b', companyId: 'company-b' }],
    products: [{ id: 'prod-a', companyId: 'company-a' }],
    customers: [{ id: 'c-a', companyId: 'company-a' }],
    suppliers: [{ id: 'sup-b', companyId: 'company-b' }],
    movements: [{ id: 'm-b', companyId: 'company-b' }],
    fixedAssets: [{ id: 'fa-a', companyId: 'company-a' }],
    vatVouchers: [{ id: 'vat-a', companyId: 'company-a' }],
    vatWithholdingDeclarations: [{ id: 'decl-a', companyId: 'company-a' }, { id: 'decl-b', companyId: 'company-b' }],
    vatWithholdingDeclarationEvents: [{ id: 'ev-a', declarationId: 'decl-a' }, { id: 'ev-b', declarationId: 'decl-b' }],
    islrVouchers: [{ id: 'islr-b', companyId: 'company-b' }],
    bankAccounts: [{ id: 'bank-a', companyId: 'company-a' }],
    bankStatementMovements: [{ id: 'stmt-b', companyId: 'company-b' }],
    creditSettlements: [{ id: 'credit-a', companyId: 'company-a' }],
    supplierAdvanceSettlements: [{ id: 'adv-a', companyId: 'company-a' }],
    supplierDirectAdvances: [{ id: 'direct-b', companyId: 'company-b' }],
    islrFiscalEvents: [{ id: 'fiscal-b', companyId: 'company-b' }],
    financialDisclosures: [{ id: 'disc-a', companyId: 'company-a' }]
  };
}

test('partitions every operational collection by company and links VAT events through their declaration', () => {
  const parts = partitionAccountingSnapshot(sample());
  assert.equal(parts.length, 2);
  const a = parts.find(part => part.currentCompanyId === 'company-a');
  const b = parts.find(part => part.currentCompanyId === 'company-b');
  assert.deepEqual(a.companies.map(x => x.id), ['company-a']);
  assert.deepEqual(a.journalEntries.map(x => x.id), ['j-a']);
  assert.deepEqual(a.vatWithholdingDeclarationEvents.map(x => x.id), ['ev-a']);
  assert.deepEqual(b.journalEntries.map(x => x.id), ['j-b']);
  assert.deepEqual(b.vatWithholdingDeclarationEvents.map(x => x.id), ['ev-b']);
  assert.deepEqual(a.accounts, b.accounts);
});

test('merge restores the original collections and preferred active company', () => {
  const original = sample();
  const merged = mergeAccountingSnapshots(partitionAccountingSnapshot(original), 'company-b');
  assert.deepEqual(merged.companies.map(x => x.id).sort(), ['company-a', 'company-b']);
  assert.equal(merged.currentCompanyId, 'company-b');
  for (const field of Object.keys(original)) {
    if (Array.isArray(original[field])) assert.deepEqual(merged[field], original[field]);
  }
  assert.deepEqual(merged.accounts, original.accounts);
});

test('rejects orphaned company data and VAT events without a valid declaration relationship', () => {
  const orphan = sample();
  orphan.products.push({ id: 'orphan', companyId: 'missing-company' });
  assert.throws(() => partitionAccountingSnapshot(orphan), /empresa propietaria válida/i);
  const orphanEvent = sample();
  orphanEvent.vatWithholdingDeclarationEvents.push({ id: 'ev-orphan', declarationId: 'missing-declaration' });
  assert.throws(() => partitionAccountingSnapshot(orphanEvent), /no se puede vincular/i);
});

test('rejects inconsistent chart of accounts across company snapshots', () => {
  const parts = partitionAccountingSnapshot(sample());
  parts[1].accounts = [{ code: '1.1.1.02', name: 'Banco' }];
  assert.throws(() => mergeAccountingSnapshots(parts), /planes de cuentas locales no coinciden/i);
});

test('returns a valid empty accounting snapshot when no companies are registered', () => {
  const empty = createEmptyAccountingSnapshot();
  assert.deepEqual(empty.companies, []);
  assert.deepEqual(empty.journalEntries, []);
  assert.deepEqual(empty.vatWithholdingDeclarationEvents, []);
  assert.equal(empty.currentCompanyId, '');
});
