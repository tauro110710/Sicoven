export type VatOwnDeclarationStatus = 'DRAFT' | 'FILED';

export interface VatOwnPositionInput {
  outputVatBs: number;
  outputVat16Bs?: number;
  outputVat8Bs?: number;
  purchaseCreditBs: number;
  purchaseCredit16Bs?: number;
  purchaseCredit8Bs?: number;
  receivedWithholdingsBs: number;
  priorCreditBs?: number;
  debitAdjustmentsBs?: number;
  creditAdjustmentsBs?: number;
}

export interface VatOwnPosition {
  outputVatBs: number;
  outputVat16Bs: number;
  outputVat8Bs: number;
  purchaseCreditBs: number;
  purchaseCredit16Bs: number;
  purchaseCredit8Bs: number;
  receivedWithholdingsBs: number;
  priorCreditAppliedBs: number;
  debitAdjustmentsBs: number;
  creditAdjustmentsBs: number;
  netTaxBs: number;
  amountDueBs: number;
  creditCarryForwardBs: number;
}

export interface VatOwnDeclaration {
  id: string;
  companyId: string;
  period: string;
  status: VatOwnDeclarationStatus;
  position: VatOwnPosition;
  sourceIds: string[];
  bcvRate?: number;
  dailySourceChoices?: Record<string, 'Z' | 'INDIVIDUAL'>;
  declarationNumber?: string;
  filedAt?: string;
  createdAt: string;
}

export interface VatOwnDeclarationEvent {
  id: string;
  declarationId: string;
  companyId: string;
  eventType: 'FILED' | 'PAYMENT' | 'REVERSAL';
  occurredAt: string;
  recordedAt: string;
  amountBs?: number;
  declarationNumber?: string;
  reference?: string;
  idempotencyKey: string;
  journalEntryId?: string;
  reversalOfEventId?: string;
  treasuryAccountCode?: string;
  bcvRate?: number;
  note?: string;
}

const amount = (value: number | undefined, field: string): number => {
  const normalized = value ?? 0;
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(field + ' debe ser un importe finito no negativo.');
  }
  return normalized;
};

export function calculateVatOwnPosition(input: VatOwnPositionInput): VatOwnPosition {
  const outputVatBs = amount(input.outputVatBs, 'IVA débito');
  const outputVat16Bs = amount(input.outputVat16Bs ?? outputVatBs, 'IVA débito 16%');
  const outputVat8Bs = amount(input.outputVat8Bs, 'IVA débito 8%');
  if (Math.abs(outputVat16Bs + outputVat8Bs - outputVatBs) > 0.02) {
    throw new Error('El desglose de IVA 16% y 8% no concilia con el débito fiscal total.');
  }
  const purchaseCreditBs = amount(input.purchaseCreditBs, 'Crédito fiscal de compras');
  const purchaseCredit16Bs = amount(input.purchaseCredit16Bs ?? purchaseCreditBs, 'Crédito fiscal 16%');
  const purchaseCredit8Bs = amount(input.purchaseCredit8Bs, 'Crédito fiscal 8%');
  if (Math.abs(purchaseCredit16Bs + purchaseCredit8Bs - purchaseCreditBs) > 0.02) throw new Error('El desglose del crédito fiscal 16% y 8% no concilia con el total.');
  const receivedWithholdingsBs = amount(input.receivedWithholdingsBs, 'Retenciones de IVA recibidas');
  const priorCreditAvailableBs = amount(input.priorCreditBs, 'Crédito de períodos anteriores');
  const debitAdjustmentsBs = amount(input.debitAdjustmentsBs, 'Ajustes al débito');
  const creditAdjustmentsBs = amount(input.creditAdjustmentsBs, 'Ajustes al crédito');
  const balanceBeforePriorCredit = outputVatBs + debitAdjustmentsBs - purchaseCreditBs -
    receivedWithholdingsBs - creditAdjustmentsBs;
  const priorCreditAppliedBs = Math.min(priorCreditAvailableBs, Math.max(0, balanceBeforePriorCredit));
  const unusedPriorCreditBs = priorCreditAvailableBs - priorCreditAppliedBs;
  const netTaxBs = balanceBeforePriorCredit - priorCreditAppliedBs;
  return {
    outputVatBs, outputVat16Bs, outputVat8Bs,
    purchaseCreditBs, purchaseCredit16Bs, purchaseCredit8Bs, receivedWithholdingsBs,
    priorCreditAppliedBs, debitAdjustmentsBs, creditAdjustmentsBs,
    netTaxBs, amountDueBs: Math.max(0, netTaxBs),
    creditCarryForwardBs: Math.max(0, -netTaxBs) + unusedPriorCreditBs
  };
}

export function validateVatOwnDeclarationDraft(input: {
  id: string;
  companyId: string;
  period: string;
  sourceIds: string[];
  createdAt: string;
}): void {
  if (!input.id.trim() || !input.companyId.trim()) throw new Error('La declaración requiere identificador y empresa.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('El período debe tener formato YYYY-MM.');
  if (!input.createdAt || Number.isNaN(Date.parse(input.createdAt))) throw new Error('La fecha de creación no es válida.');
  if (new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error('Una misma fuente no puede incluirse dos veces en la declaración.');
  }
  if (input.sourceIds.some(id => !id.trim())) throw new Error('La declaración contiene una fuente sin identificador.');
}

export function getVatOwnOutstandingBalance(
  declaration: VatOwnDeclaration,
  events: VatOwnDeclarationEvent[]
): number {
  const declarationEvents = events.filter(event =>
    event.companyId === declaration.companyId && event.declarationId === declaration.id
  );
  const reversedPaymentIds = new Set(declarationEvents
    .filter(event => event.eventType === 'REVERSAL' && event.reversalOfEventId)
    .map(event => event.reversalOfEventId));
  const paid = declarationEvents.filter(event =>
    event.eventType === 'PAYMENT' && !reversedPaymentIds.has(event.id)
  ).reduce((sum, event) => sum + amount(event.amountBs, 'Pago registrado'), 0);
  return Math.max(0, declaration.position.amountDueBs - paid);
}

export function validateVatOwnEvent(input: {
  declaration: VatOwnDeclaration;
  events: VatOwnDeclarationEvent[];
  draft: Omit<VatOwnDeclarationEvent, 'id' | 'recordedAt'>;
  sameCompanyDeclarationNumbers?: string[];
}): void {
  const { declaration, events, draft } = input;
  if (draft.companyId !== declaration.companyId || draft.declarationId !== declaration.id) {
    throw new Error('El evento no pertenece a la declaración y empresa seleccionadas.');
  }
  if (!draft.idempotencyKey.trim()) throw new Error('El evento requiere una clave de idempotencia.');
  if (events.some(event => event.idempotencyKey === draft.idempotencyKey)) {
    throw new Error('La operación ya fue registrada; no se admite un duplicado.');
  }
  if (!draft.occurredAt || Number.isNaN(Date.parse(draft.occurredAt))) {
    throw new Error('La fecha del evento no es válida.');
  }
  if (draft.eventType === 'FILED') {
    if (declaration.status !== 'DRAFT') throw new Error('La declaración ya fue presentada.');
    if (!draft.declarationNumber?.trim()) throw new Error('Indique el número oficial de declaración.');
    if (input.sameCompanyDeclarationNumbers?.includes(draft.declarationNumber.trim())) {
      throw new Error('El número oficial ya está asociado a otra declaración de esta empresa.');
    }
    return;
  }
  if (draft.eventType === 'PAYMENT') {
    if (declaration.status !== 'FILED') throw new Error('Presente la declaración antes de registrar su pago.');
    const payment = amount(draft.amountBs, 'El pago');
    if (payment <= 0) throw new Error('El pago debe ser mayor que cero.');
    if (!draft.reference?.trim()) throw new Error('El pago requiere referencia del comprobante o movimiento bancario.');
    if (events.some(event =>
      event.companyId === declaration.companyId &&
      event.eventType === 'PAYMENT' &&
      event.reference?.trim() === draft.reference?.trim()
    )) throw new Error('La referencia de pago ya fue utilizada en esta empresa.');
    if (payment > getVatOwnOutstandingBalance(declaration, events) + 0.000001) {
      throw new Error('El pago supera el saldo pendiente de la declaración.');
    }
    return;
  }
  if (draft.eventType === 'REVERSAL') {
    if (!draft.reversalOfEventId) throw new Error('La reversión debe identificar el evento original.');
    const original = events.find(event =>
      event.id === draft.reversalOfEventId &&
      event.companyId === declaration.companyId &&
      event.declarationId === declaration.id &&
      event.eventType === 'PAYMENT'
    );
    if (!original) throw new Error('El pago original que se intenta revertir no existe en esta declaración.');
    if (events.some(event => event.eventType === 'REVERSAL' && event.reversalOfEventId === original.id)) {
      throw new Error('El pago original ya fue revertido.');
    }
    return;
  }
}


export interface VatOwnDailySalesSource {
  date: string;
  source: 'Z' | 'INDIVIDUAL';
  sourceIds: string[];
  outputVatBs: number;
  outputVat16Bs: number;
  outputVat8Bs: number;
  taxableBase16Bs: number;
  taxableBase8Bs: number;
  taxableBase31Bs: number;
  exemptSalesBs: number;
}

export interface VatOwnDailySourceConflict {
  date: string;
  zSourceIds: string[];
  individualSourceIds: string[];
}

/**
 * Combina días registrados por Z con días registrados por factura individual.
 * Si ambas fuentes existen el mismo día, no elige una ni suma ambas: exige decisión
 * expresa del contador para evitar duplicar las mismas ventas.
 */
export function resolveVatOwnDailySalesSources(input: {
  zReports: Array<{
    id: string; date: string; taxableBase16Bs: number; vat16Bs: number;
    taxableBase8Bs: number; vat8Bs: number; taxableBase31Bs: number; vat31Bs: number;
    exemptSalesBs: number;
  }>;
  sales: Array<{
    id: string; date: string; documentType: '01' | '02' | '03';
    taxableBaseBs: number; taxRate: number; vatAmountBs: number; exemptAmountBs: number;
  }>;
  choices?: Record<string, 'Z' | 'INDIVIDUAL'>;
}): { days: VatOwnDailySalesSource[]; conflicts: VatOwnDailySourceConflict[]; unresolvedDates: string[] } {
  const byDate = new Map<string, { z: VatOwnDailySalesSource | null; individual: VatOwnDailySalesSource | null }>();
  const ensure = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('La fecha de origen del IVA no es válida.');
    if (!byDate.has(date)) byDate.set(date, { z: null, individual: null });
    return byDate.get(date)!;
  };
  for (const report of input.zReports) {
    const day = ensure(report.date);
    if (!day.z) day.z = { date: report.date, source: 'Z', sourceIds: [], outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0, taxableBase16Bs: 0, taxableBase8Bs: 0, taxableBase31Bs: 0, exemptSalesBs: 0 };
    const target = day.z;
    target.sourceIds.push(report.id);
    target.taxableBase16Bs += amount(report.taxableBase16Bs, 'Base 16% del Z');
    target.taxableBase8Bs += amount(report.taxableBase8Bs, 'Base 8% del Z');
    target.taxableBase31Bs += amount(report.taxableBase31Bs, 'Base 31% del Z');
    target.outputVat16Bs += amount(report.vat16Bs, 'IVA 16% del Z') + amount(report.vat31Bs, 'IVA 16% de base 31% del Z');
    target.outputVat8Bs += amount(report.vat8Bs, 'IVA 8% del Z');
    target.outputVatBs += amount(report.vat16Bs, 'IVA 16% del Z') + amount(report.vat8Bs, 'IVA 8% del Z') + amount(report.vat31Bs, 'IVA 16% de base 31% del Z');
    target.exemptSalesBs += amount(report.exemptSalesBs, 'Ventas exentas del Z');
  }
  for (const sale of input.sales) {
    const day = ensure(sale.date);
    if (!day.individual) day.individual = { date: sale.date, source: 'INDIVIDUAL', sourceIds: [], outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0, taxableBase16Bs: 0, taxableBase8Bs: 0, taxableBase31Bs: 0, exemptSalesBs: 0 };
    const target = day.individual;
    const sign = sale.documentType === '03' ? -1 : 1;
    target.sourceIds.push(sale.id);
    target.outputVatBs += sign * amount(sale.vatAmountBs, 'IVA de venta');
    if (sale.taxRate === 8) target.outputVat8Bs += sign * amount(sale.vatAmountBs, 'IVA 8% de venta');
    else target.outputVat16Bs += sign * amount(sale.vatAmountBs, 'IVA 16% de venta');
    target.exemptSalesBs += sign * amount(sale.exemptAmountBs, 'Venta exenta');
    if (sale.taxRate === 16) target.taxableBase16Bs += sign * amount(sale.taxableBaseBs, 'Base 16%');
    else if (sale.taxRate === 8) target.taxableBase8Bs += sign * amount(sale.taxableBaseBs, 'Base 8%');
    else if (sale.taxRate === 31) target.taxableBase31Bs += sign * amount(sale.taxableBaseBs, 'Base 31%');
  }
  const days: VatOwnDailySalesSource[] = [];
  const conflicts: VatOwnDailySourceConflict[] = [];
  const unresolvedDates: string[] = [];
  for (const [date, sources] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (sources.z && sources.individual) {
      conflicts.push({ date, zSourceIds: sources.z.sourceIds, individualSourceIds: sources.individual.sourceIds });
      const choice = input.choices?.[date];
      if (!choice) { unresolvedDates.push(date); continue; }
      days.push(choice === 'Z' ? sources.z : sources.individual);
    } else if (sources.z || sources.individual) {
      days.push((sources.z || sources.individual)!);
    }
  }
  return { days, conflicts, unresolvedDates };
}
