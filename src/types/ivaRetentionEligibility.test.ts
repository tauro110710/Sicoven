import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIvaRetentionEligibility } from './ivaRetentionEligibility';
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
