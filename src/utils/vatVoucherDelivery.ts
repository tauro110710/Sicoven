/**
 * Estima los dos primeros días de lunes a viernes del período siguiente
 * para orientar el control del art. 16 de la Providencia SNAT/2025/000054.
 *
 * No incorpora feriados nacionales, estadales ni bancarios. Por eso el
 * resultado es informativo y nunca debe presentarse como vencimiento legal
 * definitivo sin validar el calendario oficial aplicable.
 */
export function getVatVoucherDeliveryWindow(period: string): { firstDay: string; secondDay: string } | null {
  if (!/^\d{6}$/.test(period)) return null;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  if (month < 1 || month > 12 || year < 1900 || year > 9999) return null;

  const businessDays: string[] = [];
  for (let offset = 0; offset < 10 && businessDays.length < 2; offset += 1) {
    const date = new Date(Date.UTC(year, month, 1 + offset));
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      businessDays.push(date.toISOString().slice(0, 10));
    }
  }
  return businessDays.length === 2
    ? { firstDay: businessDays[0], secondDay: businessDays[1] }
    : null;
}

export type VatVoucherDeliveryControl =
  | { status: 'DELIVERED'; estimatedWindow: { firstDay: string; secondDay: string } | null; needsCalendarReview: boolean }
  | { status: 'PENDING'; estimatedWindow: { firstDay: string; secondDay: string } | null; needsCalendarReview: boolean }
  | { status: 'REVIEW'; estimatedWindow: { firstDay: string; secondDay: string } | null; needsCalendarReview: true };

export function getVatVoucherDeliveryControl(
  period: string,
  today: string,
  deliveryDate?: string
): VatVoucherDeliveryControl {
  const estimatedWindow = getVatVoucherDeliveryWindow(period);
  if (!estimatedWindow) return { status: 'REVIEW', estimatedWindow: null, needsCalendarReview: true };
  if (deliveryDate) {
    return {
      status: 'DELIVERED',
      estimatedWindow,
      needsCalendarReview: deliveryDate > estimatedWindow.secondDay
    };
  }
  return {
    status: today > estimatedWindow.secondDay ? 'REVIEW' : 'PENDING',
    estimatedWindow,
    needsCalendarReview: true
  };
}
