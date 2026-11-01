import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIvaRetentionEligibility, resolveIvaBuyerAgentStatus } from './ivaRetentionEligibility';
const ordinary = { buyerAgentStatus: 'SPECIAL_DESIGNATED' as const, supplierTaxStatus: 'ORDINARY' as const, vatAmount: 160 };

test('applies general 75 percent rate', () => {
  const r = evaluateIvaRetentionEligibility(ordinary);
  assert.equal(r.status, 'WITHHOLD'); assert.equal(r.retentionRate, 75); assert.equal(r.withheldAmount, 120);
});
test('does not withhold when buyer is not an agent', () => {
  const r = evaluateIvaRetentionEligibility({ ...ordinary, buyerAgentStatus: 'NOT_AGENT' });
  assert.equal(r.status, 'NOT_APPLICABLE'); assert.equal(r.withheldAmount, 0);
});
test('requires review for unknown buyer or supplier status', () => {
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, buyerAgentStatus: 'UNKNOWN' }).status, 'REVIEW');
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'UNKNOWN' }).status, 'REVIEW');
});
test('excludes formal suppliers and Article 3 operations', () => {
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'FORMAL' }).status, 'EXCLUDED');
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'FORMAL', article3Exclusions: ['IMPORT_PERCEPTION_CREDIT'] }).status, 'EXCLUDED');
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, article3Exclusions: ['PETTY_CASH_UP_TO_20_UT'] }).status, 'EXCLUDED');
});
test('does not apply Article 1 retention to a special supplier', () => {
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'SPECIAL' }).status, 'NOT_APPLICABLE');
});
test('applies Article 2 only to qualifying transactions', () => {
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, buyerAgentStatus: 'ARTICLE_2_BUYER', article2Transaction: false }).status, 'NOT_APPLICABLE');
  const r = evaluateIvaRetentionEligibility({ buyerAgentStatus: 'ARTICLE_2_BUYER', supplierTaxStatus: 'UNKNOWN', article2Transaction: true, vatAmount: 160 });
  assert.equal(r.retentionRate, 100); assert.equal(r.withheldAmount, 160);
});
test('requires Portal Fiscal confirmation for a non-registered supplier', () => {
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'NON_REGISTERED' }).status, 'REVIEW');
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, supplierTaxStatus: 'NON_REGISTERED', portalRetentionRate: 100 }).retentionRate, 100);
});
test('uses 100 percent when VAT is not separately stated and reconstructs the tax', () => {
  const r = evaluateIvaRetentionEligibility({ buyerAgentStatus: 'SPECIAL_DESIGNATED', supplierTaxStatus: 'ORDINARY', vatNotDiscriminated: true, taxableAmountIncludingVat: 1160, taxRate: 16 });
  assert.equal(r.vatAmount, 160); assert.equal(r.retentionRate, 100); assert.equal(r.withheldAmount, 160);
});
test('uses 100 percent for a formal invoice defect', () => {
  const r = evaluateIvaRetentionEligibility({ ...ordinary, invoiceFormalDefect: true });
  assert.equal(r.retentionRate, 100); assert.equal(r.withheldAmount, 160);
});
test('reconstructs VAT from taxable gross amount and applies 75 percent otherwise', () => {
  const r = evaluateIvaRetentionEligibility({ buyerAgentStatus: 'SPECIAL_DESIGNATED', supplierTaxStatus: 'ORDINARY', taxableAmountIncludingVat: 1160, taxRate: 16 });
  assert.equal(r.vatAmount, 160); assert.equal(r.retentionRate, 75); assert.equal(r.withheldAmount, 120);
});
test('does not invent a tax amount when the input is incomplete and handles zero VAT', () => {
  assert.equal(evaluateIvaRetentionEligibility({ buyerAgentStatus: 'SPECIAL_DESIGNATED', supplierTaxStatus: 'ORDINARY' }).status, 'REVIEW');
  assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, vatAmount: 0 }).status, 'NO_VAT');
});


test('requires explicit Portal Fiscal confirmation for Article 3 numerals 3, 9 and 10', () => {
  const portalCases = ['PERCEPTION_AGENT_SPECIFIC_GOODS', 'EXPORTER_RECOVERY_REGISTER', 'SUPPLIER_EXEMPT_SALES_OVER_50'] as const;
  for (const exclusion of portalCases) {
    const pending = evaluateIvaRetentionEligibility({ ...ordinary, article3Exclusions: [exclusion] });
    assert.equal(pending.status, 'REVIEW');
    const confirmed = evaluateIvaRetentionEligibility({ ...ordinary, article3Exclusions: [exclusion], portalArticle3ExclusionConfirmed: true });
    assert.equal(confirmed.status, 'EXCLUDED');
  }
});

test('does not require Portal Fiscal confirmation for directly identifiable Article 3 exclusions', () => {
  const r = evaluateIvaRetentionEligibility({ ...ordinary, article3Exclusions: ['PETTY_CASH_UP_TO_20_UT'], operationAmountBs: 500, unitTaxValueBs: 43 });
  assert.equal(r.status, 'EXCLUDED');
});


test('Article 3 exclusions are individually recognized without making Portal Fiscal assumptions', () => {
  const exclusions = [
    'NOT_SUBJECT_EXEMPT_EXONERATED', 'FORMAL_SUPPLIER', 'EMPLOYEE_TRAVEL_EXPENSE',
    'DOMICILIARY_UTILITIES', 'SPECIAL_PUBLIC_PURCHASER',
    'SPECIAL_NONBUSINESS_PUBLIC_ENTITY', 'COT_ARTICLE_146'
  ] as const;
  for (const exclusion of exclusions) {
    assert.equal(evaluateIvaRetentionEligibility({ ...ordinary, article3Exclusions: [exclusion] }).status, 'EXCLUDED', exclusion);
  }
});

test('Article 3 numeral 4 requires confirmation that import perception was actually supported', () => {
  assert.equal(evaluateIvaRetentionEligibility({
    ...ordinary, article3Exclusions: ['IMPORT_PERCEPTION_CREDIT']
  }).status, 'REVIEW');
  const confirmed = evaluateIvaRetentionEligibility({
    ...ordinary, article3Exclusions: ['IMPORT_PERCEPTION_CREDIT'],
    supplierImportPerceptionConfirmed: true
  });
  assert.equal(confirmed.status, 'EXCLUDED');
  assert.match(confirmed.legalBasis || '', /numeral\(es\) 4/);
});

test('Article 3 numerals 6 and 7 apply only when the operation does not exceed 20 verified UT', () => {
  for (const exclusion of ['REIMBURSABLE_UP_TO_20_UT', 'PETTY_CASH_UP_TO_20_UT'] as const) {
    const withinLimit = evaluateIvaRetentionEligibility({
      ...ordinary, article3Exclusions: [exclusion], operationAmountBs: 860, unitTaxValueBs: 43
    });
    assert.equal(withinLimit.status, 'EXCLUDED');
    assert.match(withinLimit.legalBasis || '', exclusion === 'REIMBURSABLE_UP_TO_20_UT' ? /numeral\(es\) 6/ : /numeral\(es\) 7/);
    const aboveLimit = evaluateIvaRetentionEligibility({
      ...ordinary, article3Exclusions: [exclusion], operationAmountBs: 860.01, unitTaxValueBs: 43
    });
    assert.equal(aboveLimit.status, 'WITHHOLD');
    assert.equal(aboveLimit.retentionRate, 75);
    assert.match(aboveLimit.reason, /supera el límite de 20 UT/);
    assert.equal(evaluateIvaRetentionEligibility({
      ...ordinary, article3Exclusions: [exclusion], operationAmountBs: 500
    }).status, 'REVIEW');
  }
});


test('Article 1 agent status requires special designation and a personal-firm condition for natural persons', () => {
  assert.equal(resolveIvaBuyerAgentStatus({ agentBasis: 'ARTICLE_1_SPECIAL_DESIGNATED', taxpayerType: 'ESPECIAL', rif: 'J-12345678-9' }), 'SPECIAL_DESIGNATED');
  assert.equal(resolveIvaBuyerAgentStatus({ agentBasis: 'ARTICLE_1_SPECIAL_DESIGNATED', taxpayerType: 'ESPECIAL', rif: 'V-12345678-9' }), 'UNKNOWN');
  assert.equal(resolveIvaBuyerAgentStatus({ agentBasis: 'ARTICLE_1_SPECIAL_DESIGNATED', taxpayerType: 'ESPECIAL', rif: 'V-12345678-9', isPersonalFirm: true }), 'SPECIAL_DESIGNATED');
  assert.equal(resolveIvaBuyerAgentStatus({ agentBasis: 'ARTICLE_1_SPECIAL_DESIGNATED', taxpayerType: 'ORDINARIO', rif: 'J-12345678-9' }), 'UNKNOWN');
  assert.equal(resolveIvaBuyerAgentStatus({ agentBasis: 'ARTICLE_2_METALS', taxpayerType: 'ORDINARIO', rif: 'V-12345678-9' }), 'ARTICLE_2_BUYER');
});
