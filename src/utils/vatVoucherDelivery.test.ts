import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getVatVoucherDeliveryControl, getVatVoucherDeliveryWindow } from './vatVoucherDelivery';

describe('VAT voucher delivery window (weekday estimate only)', () => {
  it('calculates the first two weekdays of the following month', () => {
    assert.deepEqual(getVatVoucherDeliveryWindow('202610'), {
      firstDay: '2026-11-02',
      secondDay: '2026-11-03'
    });
  });

  it('skips weekends when the next month starts on Saturday', () => {
    assert.deepEqual(getVatVoucherDeliveryWindow('202607'), {
      firstDay: '2026-08-03',
      secondDay: '2026-08-04'
    });
  });

  it('rejects malformed periods', () => {
    assert.equal(getVatVoucherDeliveryWindow('202613'), null);
    assert.equal(getVatVoucherDeliveryWindow('2026-10'), null);
  });

  it('marks a pending voucher for review after the weekday estimate', () => {
    assert.equal(getVatVoucherDeliveryControl('202610', '2026-11-04').status, 'REVIEW');
  });

  it('flags a recorded delivery after the estimate for calendar review, not automatic non-compliance', () => {
    const result = getVatVoucherDeliveryControl('202610', '2026-11-10', '2026-11-04');
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.needsCalendarReview, true);
  });

  it('keeps a delivery within the weekday estimate as recorded', () => {
    const result = getVatVoucherDeliveryControl('202610', '2026-11-10', '2026-11-03');
    assert.equal(result.status, 'DELIVERED');
    assert.equal(result.needsCalendarReview, false);
  });
});
