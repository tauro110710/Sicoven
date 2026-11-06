import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateFiscalZTaxBreakdown } from './fiscalZReport';

describe('Reporte Z fiscal tax breakdown', () => {
  it('separates the combined 31% rate into 16% VAT and 15% additional luxury tax', () => {
    const result = calculateFiscalZTaxBreakdown({
      taxableBase16Bs: 1000,
      taxableBase8Bs: 500,
      taxableBase31Bs: 200,
      exemptSalesBs: 100,
      igtfBs: 0
    });
    assert.equal(result.vat16Bs, 160);
    assert.equal(result.vat8Bs, 40);
    assert.equal(result.vat31Bs, 32);
    assert.equal(result.additionalLuxuryTaxBs, 30);
    assert.equal(result.totalSalesBs, 2062);
  });

  it('includes IGTF and exempt sales in the closing total without adding them to VAT bases', () => {
    const result = calculateFiscalZTaxBreakdown({
      taxableBase16Bs: 100,
      taxableBase8Bs: 0,
      taxableBase31Bs: 0,
      exemptSalesBs: 50,
      igtfBs: 4.5
    });
    assert.equal(result.vat16Bs, 16);
    assert.equal(result.additionalLuxuryTaxBs, 0);
    assert.equal(result.totalSalesBs, 170.5);
  });

  it('rounds each tax component to two decimal places', () => {
    const result = calculateFiscalZTaxBreakdown({
      taxableBase16Bs: 10.03,
      taxableBase8Bs: 10.03,
      taxableBase31Bs: 10.03,
      exemptSalesBs: 0,
      igtfBs: 0
    });
    assert.equal(result.vat16Bs, 1.6);
    assert.equal(result.vat8Bs, 0.8);
    assert.equal(result.vat31Bs, 1.6);
    assert.equal(result.additionalLuxuryTaxBs, 1.5);
  });
});
