import test from 'node:test';
import assert from 'node:assert/strict';
import { filterCompanyFiscalDocuments, filterActiveFiscalDocuments } from './companyFiscalDocuments';

test('fiscal books only include documents belonging to the selected company', () => {
  const records = [
    { id: 'sale-a', companyId: 'company-a', total: 100 },
    { id: 'sale-b', companyId: 'company-b', total: 900 },
    { id: 'sale-no-company', total: 500 },
  ];
  assert.deepEqual(filterCompanyFiscalDocuments(records, 'company-a'), [records[0]]);
  assert.deepEqual(filterCompanyFiscalDocuments(records, 'company-b'), [records[1]]);
});

test('an empty company selection never exposes unscoped fiscal documents', () => {
  assert.deepEqual(filterCompanyFiscalDocuments<{ id: string; companyId?: string; total: number }>([{ id: 'legacy', total: 1 }], ''), []);
  assert.deepEqual(filterCompanyFiscalDocuments<{ id: string; companyId?: string; total: number }>([{ id: 'legacy', total: 1 }], 'company-a'), []);
});


test('cancelled fiscal documents are excluded from active books and totals', () => {
  const records = [
    { id: 'valid', isCancelled: false, total: 120 },
    { id: 'legacy-active', total: 80 },
    { id: 'cancelled', isCancelled: true, total: 999 },
  ];
  assert.deepEqual(filterActiveFiscalDocuments(records), records.slice(0, 2));
});
