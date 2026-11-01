import type {
  VatDeclarationWindow,
  VatDeclarationVoucherSnapshot,
  VatRetentionVoucher,
  VatWithholdingDeclaration,
  VatWithholdingDeclarationEvent
} from './accounting';

export interface VatDeclarationWindowRange {
  period: string;
  window: VatDeclarationWindow;
  startDate: string;
  endDate: string;
}

export function getVatDeclarationWindowRange(year: number, month: number, window: VatDeclarationWindow): VatDeclarationWindowRange {
  if (!Number.isInteger(year) || year < 2000 || year > 9999 ||
      !Number.isInteger(month) || month < 1 || month > 12 ||
      (window !== 'FIRST_HALF' && window !== 'SECOND_HALF')) {
    throw new Error('Seleccione un año, mes y quincena válidos.');
  }
  const mm = String(month).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const startDay = window === 'FIRST_HALF' ? 1 : 16;
  const endDay = window === 'FIRST_HALF' ? 15 : lastDay;
  const iso = (day: number) => String(year).padStart(4, '0') + '-' + mm + '-' + String(day).padStart(2, '0');
  return {
    period: String(year).padStart(4, '0') + mm,
    window,
    startDate: iso(startDay),
    endDate: iso(endDay)
  };
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function buildVatWithholdingDeclaration(input: {
  id: string;
  companyId: string;
  year: number;
  month: number;
  window: VatDeclarationWindow;
  vouchers: VatRetentionVoucher[];
  existingDeclarations: VatWithholdingDeclaration[];
  createdAt: string;
  createdBy?: string;
  zeroOperations?: boolean;
}): VatWithholdingDeclaration {
  const range = getVatDeclarationWindowRange(input.year, input.month, input.window);
  if (!input.id.trim() || !input.companyId.trim() || !validDate(input.createdAt.slice(0, 10))) {
    throw new Error('La declaración requiere identificadores y fecha de creación válidos.');
  }
  if (input.existingDeclarations.some(item =>
    item.companyId === input.companyId && item.period === range.period && item.window === range.window)) {
    throw new Error('Ya existe una declaración registrada para esta empresa y quincena.');
  }
  const alreadyDeclared = new Set(input.existingDeclarations
    .filter(item => item.companyId === input.companyId)
    .flatMap(item => item.voucherIds));
  const candidates = input.vouchers.filter(voucher => {
    const fiscalDate = voucher.fiscalDate || voucher.date;
    return voucher.companyId === input.companyId && fiscalDate >= range.startDate && fiscalDate <= range.endDate;
  });
  if (input.zeroOperations) {
    if (candidates.length > 0) {
      throw new Error('No puede preparar una declaración sin operaciones: existen comprobantes de retención en la quincena.');
    }
  } else if (candidates.length === 0) {
    throw new Error('No hay comprobantes en esta quincena. Use expresamente la opción de declaración sin operaciones si corresponde.');
  }
  for (const voucher of candidates) {
    if (alreadyDeclared.has(voucher.id)) {
      throw new Error('El comprobante ' + voucher.voucherNumber + ' ya está incluido en otra declaración. No se permite duplicarlo.');
    }
  }
  const snapshots: VatDeclarationVoucherSnapshot[] = candidates.map(voucher => {
    const fiscalDate = voucher.fiscalDate || voucher.date;
    const values = [voucher.taxableBaseBs, voucher.vatAmountBs, voucher.vatWithheldBs].map(Number);
    if (!validDate(fiscalDate) || !values.every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error('El comprobante ' + voucher.voucherNumber + ' contiene fecha o importes inválidos.');
    }
    return {
      voucherId: voucher.id,
      voucherNumber: voucher.voucherNumber,
      supplierRif: voucher.supplierRif,
      supplierName: voucher.supplierName,
      fiscalDate,
      dateBasis: voucher.fiscalDate ? 'FISCAL_EVENT' : 'LEGACY_DOCUMENT_DATE',
      taxableBaseBs: money(values[0]),
      vatAmountBs: money(values[1]),
      vatWithheldBs: money(values[2]),
      requiresFiscalCorrection: Boolean(voucher.requiresFiscalCorrection)
    };
  });
  const sum = (field: 'taxableBaseBs' | 'vatAmountBs' | 'vatWithheldBs') =>
    money(snapshots.reduce((total, item) => total + item[field], 0));
  return {
    id: input.id,
    companyId: input.companyId,
    ...range,
    zeroOperations: Boolean(input.zeroOperations),
    voucherIds: snapshots.map(item => item.voucherId),
    voucherSnapshots: snapshots,
    totalTaxableBaseBs: sum('taxableBaseBs'),
    totalVatAmountBs: sum('vatAmountBs'),
    totalWithheldBs: sum('vatWithheldBs'),
    createdAt: input.createdAt,
    ...(input.createdBy ? { createdBy: input.createdBy } : {})
  };
}

export type VatDeclarationStatus = 'PREPARED' | 'REVIEWED' | 'FILED' | 'PARTIALLY_PAID' | 'PAID';

export function getVatDeclarationStatus(
  declaration: VatWithholdingDeclaration,
  events: VatWithholdingDeclarationEvent[]
): VatDeclarationStatus {
  const related = events.filter(event => event.declarationId === declaration.id);
  if (related.some(event => event.eventType === 'PAYMENT')) {
    const paid = money(related.filter(event => event.eventType === 'PAYMENT')
      .reduce((sum, event) => sum + Number(event.amountBs || 0), 0));
    if (paid >= declaration.totalWithheldBs - 0.0001) return 'PAID';
    return 'PARTIALLY_PAID';
  }
  if (related.some(event => event.eventType === 'FILED')) return 'FILED';
  if (related.some(event => event.eventType === 'REVIEWED')) return 'REVIEWED';
  return 'PREPARED';
}

export function validateVatDeclarationEventDraft(
  declaration: VatWithholdingDeclaration,
  events: VatWithholdingDeclarationEvent[],
  draft: Omit<VatWithholdingDeclarationEvent, 'id' | 'declarationId' | 'recordedAt'>
): void {
  const related = events.filter(event => event.declarationId === declaration.id);
  const status = getVatDeclarationStatus(declaration, events);
  if (!validDate(draft.occurredAt.slice(0, 10))) throw new Error('La fecha del evento no es válida.');
  if (draft.eventType === 'REVIEWED') {
    if (status !== 'PREPARED') throw new Error('La declaración solo puede revisarse una vez y antes de presentarse.');
    if (declaration.voucherSnapshots.some(item => item.requiresFiscalCorrection)) {
      throw new Error('No se puede aprobar la revisión: existen comprobantes con corrección fiscal pendiente.');
    }
    if (declaration.voucherSnapshots.some(item => item.dateBasis === 'LEGACY_DOCUMENT_DATE') &&
        (!draft.acknowledgedLegacyDates || String(draft.note || '').trim().length < 10)) {
      throw new Error('La quincena contiene comprobantes históricos sin fecha fiscal explícita. Documente la verificación de fechas antes de revisar.');
    }
  } else if (draft.eventType === 'FILED') {
    if (status !== 'REVIEWED') throw new Error('La declaración debe estar revisada antes de registrar su presentación.');
    if (!String(draft.declarationNumber || '').trim() || !String(draft.receiptReference || '').trim()) {
      throw new Error('La presentación requiere número de declaración y referencia/acuse.');
    }
  } else if (draft.eventType === 'PAYMENT') {
    if (status !== 'FILED' && status !== 'PARTIALLY_PAID') throw new Error('Solo se puede registrar un enteramiento después de presentar la declaración.');
    const amount = Number(draft.amountBs);
    const paid = related.filter(event => event.eventType === 'PAYMENT')
      .reduce((sum, event) => sum + Number(event.amountBs || 0), 0);
    if (!Number.isFinite(amount) || amount <= 0 || money(paid + amount) > declaration.totalWithheldBs + 0.01) {
      throw new Error('El pago debe ser positivo y no puede superar el total retenido de la declaración.');
    }
    if (!String(draft.paymentReference || '').trim() || !String(draft.evidenceReference || '').trim()) {
      throw new Error('El enteramiento requiere referencia bancaria y soporte documental.');
    }
  } else if (draft.eventType === 'DUE_DATE_SET') {
    if (!validDate(String(draft.dueDate || '')) ||
        !String(draft.officialSourceTitle || '').trim() ||
        !String(draft.officialReference || '').trim() ||
        !/^https:\/\/(www\.)?seniat\.gob\.ve\//i.test(String(draft.officialSourceUrl || ''))) {
      throw new Error('El vencimiento requiere fecha y fuente oficial SENIAT verificable (título, referencia y URL HTTPS).');
    }
    if (related.some(event => event.eventType === 'DUE_DATE_SET')) {
      throw new Error('Ya existe un vencimiento documentado para esta declaración; no se sobrescribe.');
    }
  } else {
    throw new Error('Tipo de evento fiscal no admitido.');
  }
}
