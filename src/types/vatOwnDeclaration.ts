export type VatOwnDeclarationStatus = 'DRAFT' | 'FILED';

export interface VatOwnPositionInput {
  outputVatBs: number;
  purchaseCreditBs: number;
  receivedWithholdingsBs: number;
  priorCreditBs?: number;
  debitAdjustmentsBs?: number;
  creditAdjustmentsBs?: number;
}

export interface VatOwnPosition {
  outputVatBs: number;
  purchaseCreditBs: number;
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
  const purchaseCreditBs = amount(input.purchaseCreditBs, 'Crédito fiscal de compras');
  const receivedWithholdingsBs = amount(input.receivedWithholdingsBs, 'Retenciones de IVA recibidas');
  const priorCreditBs = amount(input.priorCreditBs, 'Crédito de períodos anteriores');
  const debitAdjustmentsBs = amount(input.debitAdjustmentsBs, 'Ajustes al débito');
  const creditAdjustmentsBs = amount(input.creditAdjustmentsBs, 'Ajustes al crédito');
  const netTaxBs = outputVatBs + debitAdjustmentsBs - purchaseCreditBs -
    receivedWithholdingsBs - creditAdjustmentsBs - priorCreditBs;
  return {
    outputVatBs,
    purchaseCreditBs,
    receivedWithholdingsBs,
    priorCreditAppliedBs: priorCreditBs,
    debitAdjustmentsBs,
    creditAdjustmentsBs,
    netTaxBs,
    amountDueBs: Math.max(0, netTaxBs),
    creditCarryForwardBs: Math.max(0, -netTaxBs)
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
  const paid = events.filter(event =>
    event.companyId === declaration.companyId &&
    event.declarationId === declaration.id &&
    event.eventType === 'PAYMENT'
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
