import { describe, expect, it } from 'vitest';
import { getVatVoucherDeliveryControl, getVatVoucherDeliveryWindow } from './vatVoucherDelivery';

describe('VAT voucher delivery window (weekday estimate only)', () => {
  it('calculates the first two weekdays of the following month', () => {
    expect(getVatVoucherDeliveryWindow('202610')).toEqual({
      firstDay: '2026-11-02',
      secondDay: '2026-11-03'
    });
  });

  it('skips weekends when the next month starts on Saturday', () => {
    expect(getVatVoucherDeliveryWindow('202607')).toEqual({
      firstDay: '2026-08-03',
      secondDay: '2026-08-04'
    });
  });

  it('rejects malformed periods', () => {
    expect(getVatVoucherDeliveryWindow('202613')).toBeNull();
    expect(getVatVoucherDeliveryWindow('2026-10')).toBeNull();
  });

  it('marks a pending voucher for review after the weekday estimate', () => {
    expect(getVatVoucherDeliveryControl('202610', '2026-11-04').status).toBe('REVIEW');
  });

  it('does not call a recorded delivery late solely from the estimate', () => {
    const result = getVatVoucherDeliveryControl('202610', '2026-11-10', '2026-11-04');
    expect(result.status).toBe('DELIVERED');
    expect(result.needsCalendarReview).toBe(true);
  });

  it('keeps a delivery within the weekday estimate as recorded', () => {
    const result = getVatVoucherDeliveryControl('202610', '2026-11-10', '2026-11-03');
    expect(result.status).toBe('DELIVERED');
    expect(result.needsCalendarReview).toBe(false);
  });
});
