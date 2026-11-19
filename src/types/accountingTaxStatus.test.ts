import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompanyTaxStatusForDate } from './accounting';
import type { Company, CompanyTaxStatusPeriod } from './accounting';

const special: CompanyTaxStatusPeriod = {
  id: 'special-2026', effectiveFrom: '2026-01-01', effectiveTo: '2026-10-14',
  ivaTaxStatus: 'ORDINARIO', specialTaxpayerStatus: 'ESPECIAL',
  ivaRetentionAgentBasis: 'ARTICLE_1_SPECIAL_DESIGNATED', defaultIvaRetentionRate: 75,
  isIgtfPerceptionAgent: false, notificationReference: 'OFICIO-001',
  notificationDate: '2025-12-15', recordedAt: '2026-11-19T12:00:00.000Z'
};
const ordinary: CompanyTaxStatusPeriod = {
  id: 'ordinary-2026', effectiveFrom: '2026-10-15',
  ivaTaxStatus: 'ORDINARIO', specialTaxpayerStatus: 'NO_ESPECIAL',
  ivaRetentionAgentBasis: 'NOT_AGENT', defaultIvaRetentionRate: 0,
  isIgtfPerceptionAgent: false, supportingDocumentReference: 'ACTO-REVOCACION-002',
  recordedAt: '2026-11-19T12:00:00.000Z'
};
const company = (taxStatusHistory: CompanyTaxStatusPeriod[]): Company => ({
  id: 'company-1', rif: 'J-12345678-9', name: 'PRUEBA', address: '', phone: '', email: '',
  taxpayerType: 'ORDINARIO', defaultIvaRetentionRate: 0, fiscalYear: 2026, bcvRate: 1,
  taxStatusHistory
});

test('resuelve el tramo especial antes del cambio', () => {
  assert.equal(getCompanyTaxStatusForDate(company([special, ordinary]), '2026-10-14')?.specialTaxpayerStatus, 'ESPECIAL');
});
test('resuelve el tramo posterior al cambio', () => {
  assert.equal(getCompanyTaxStatusForDate(company([special, ordinary]), '2026-10-15')?.specialTaxpayerStatus, 'NO_ESPECIAL');
});
test('no inventa condición cuando la fecha cae en un vacío', () => {
  assert.equal(getCompanyTaxStatusForDate(company([special]), '2026-10-15'), undefined);
  assert.equal(getCompanyTaxStatusForDate(company([special, ordinary]), '2026-10-15')?.id, 'ordinary-2026');
});
test('no devuelve estado si la fecha no tiene formato ISO', () => {
  assert.equal(getCompanyTaxStatusForDate(company([special]), '01/10/2026'), undefined);
});
