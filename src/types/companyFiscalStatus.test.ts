import test from 'node:test';
import assert from 'node:assert/strict';
import type { Company } from './accounting';
import {
  resolveCompanyFiscalProfileAtDate,
  resolveCompanyFiscalStatusAtDate,
  validateCompanyFiscalStatusEvent,
  validateCompanyFiscalStatusHistory,
  type CompanyFiscalStatusEvent
} from './companyFiscalStatus';

const company = (history: CompanyFiscalStatusEvent[] = []): Company => ({
  id: 'c1', rif: 'J-12345678-9', name: 'EMPRESA', address: '', phone: '', email: '',
  taxpayerType: 'ORDINARIO', defaultIvaRetentionRate: 0, fiscalYear: 2026, bcvRate: 0,
  ivaRetentionAgentBasis: 'NOT_AGENT', isIgtfPerceptionAgent: false,
  fiscalStatusHistory: history
});

const event = (id: string, dimension: CompanyFiscalStatusEvent['dimension'], status: CompanyFiscalStatusEvent['status'], effectiveDate: string): CompanyFiscalStatusEvent => ({
  id, dimension, status, effectiveDate, recordedAt: effectiveDate + 'T12:00:00.000Z',
  ...(dimension === 'SENIAT_SPECIAL_TAXPAYER' ? { authorityReference: 'OFICIO ' + id, authorityDate: effectiveDate } : {})
});

test('resolves historical SENIAT status independently by operation date', () => {
  const c = company([
    event('e1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-01-01'),
    event('e2', 'SENIAT_SPECIAL_TAXPAYER', 'ORDINARIO', '2026-10-15')
  ]);
  assert.equal(resolveCompanyFiscalStatusAtDate(c, 'SENIAT_SPECIAL_TAXPAYER', '2026-09-30'), 'ESPECIAL');
  assert.equal(resolveCompanyFiscalStatusAtDate(c, 'SENIAT_SPECIAL_TAXPAYER', '2026-10-15'), 'ORDINARIO');
  assert.equal(resolveCompanyFiscalStatusAtDate(c, 'SENIAT_SPECIAL_TAXPAYER', '2026-11-01'), 'ORDINARIO');
});

test('resolves IVA agent, personal-firm and IGTF conditions independently', () => {
  const c = company([
    event('e1', 'IVA_RETENTION_AGENT', 'ARTICLE_1_SPECIAL_DESIGNATED', '2026-01-01'),
    event('e2', 'IVA_PERSONAL_FIRM', 'FIRM', '2026-01-01'),
    event('e3', 'IGTF_PERCEPTION_AGENT', 'AGENT', '2026-06-01')
  ]);
  const before = resolveCompanyFiscalProfileAtDate(c, '2026-05-31');
  const after = resolveCompanyFiscalProfileAtDate(c, '2026-06-01');
  assert.equal(before.ivaRetentionAgentBasis, 'ARTICLE_1_SPECIAL_DESIGNATED');
  assert.equal(before.isPersonalFirm, true);
  assert.equal(before.isIgtfPerceptionAgent, false);
  assert.equal(after.isIgtfPerceptionAgent, true);
});

test('does not use future events for earlier operations and falls back to legacy profile', () => {
  const c = company([event('e1', 'IGTF_PERCEPTION_AGENT', 'AGENT', '2026-12-01')]);
  assert.equal(resolveCompanyFiscalStatusAtDate(c, 'IGTF_PERCEPTION_AGENT', '2026-11-30'), 'NOT_AGENT');
  assert.equal(resolveCompanyFiscalStatusAtDate(c, 'IGTF_PERCEPTION_AGENT', '2026-12-01'), 'AGENT');
});

test('requires authority evidence for SENIAT qualification changes', () => {
  const invalid = event('e1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-10-01');
  delete invalid.authorityReference;
  delete invalid.authorityDate;
  assert.ok(validateCompanyFiscalStatusEvent(invalid).some(error => /referencia/.test(error)));
  assert.ok(validateCompanyFiscalStatusEvent(invalid).some(error => /fecha del acto/.test(error)));
});

test('history is append-only and rejects duplicate dimension/effective date', () => {
  const first = event('e1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-01-01');
  assert.throws(() => validateCompanyFiscalStatusHistory([first], []), /inmutable/);
  assert.throws(() => validateCompanyFiscalStatusHistory([], [first, { ...first, id: 'e2' }]), /duplicados|Ya existe/);
  assert.doesNotThrow(() => validateCompanyFiscalStatusHistory([], [first]));
});

test('rejects retroactive additions after a condition timeline has been established', () => {
  const first = event('e1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-01-01');
  const backdated = event('e2', 'SENIAT_SPECIAL_TAXPAYER', 'ORDINARIO', '2025-12-31');
  assert.throws(() => validateCompanyFiscalStatusHistory([first], [first, backdated]), /orden cronológico|retroactivo/);
});

test('keeps VAT registration status independent from SENIAT special qualification', () => {
  const c = company([
    event('v1', 'IVA_TAX_STATUS', 'FORMAL', '2026-01-01'),
    event('s1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-03-01')
  ]);
  const january = resolveCompanyFiscalProfileAtDate(c, '2026-02-28');
  const march = resolveCompanyFiscalProfileAtDate(c, '2026-03-01');
  assert.equal(january.ivaTaxStatus, 'FORMAL');
  assert.equal(january.taxpayerType, 'ORDINARIO');
  assert.equal(march.ivaTaxStatus, 'FORMAL');
  assert.equal(march.taxpayerType, 'ESPECIAL');
});

test('allows an ordinary initial baseline but requires an individual act when ending a special designation', () => {
  const ordinaryBaseline = event('o1', 'SENIAT_SPECIAL_TAXPAYER', 'ORDINARIO', '2026-01-01');
  delete ordinaryBaseline.authorityReference;
  delete ordinaryBaseline.authorityDate;
  assert.doesNotThrow(() => validateCompanyFiscalStatusHistory([], [ordinaryBaseline]));

  const special = event('s1', 'SENIAT_SPECIAL_TAXPAYER', 'ESPECIAL', '2026-01-01');
  const revokedWithoutAct = event('o2', 'SENIAT_SPECIAL_TAXPAYER', 'ORDINARIO', '2026-10-01');
  delete revokedWithoutAct.authorityReference;
  delete revokedWithoutAct.authorityDate;
  assert.throws(() => validateCompanyFiscalStatusHistory([special], [special, revokedWithoutAct]), /pérdida de la calificación/);

  const revokedWithAct = event('o3', 'SENIAT_SPECIAL_TAXPAYER', 'ORDINARIO', '2026-10-01');
  assert.doesNotThrow(() => validateCompanyFiscalStatusHistory([special], [special, revokedWithAct]));
});
