import type {
  BankAccount,
  BankStatementMovement,
  VatWithholdingDeclaration,
  VatWithholdingDeclarationEvent
} from './accounting';

export interface VatPaymentBankLinkDraft {
  eventType: string;
  occurredAt: string;
  amountBs?: number;
  bankStatementMovementIds?: string[];
}

const cents = (value: number) => Math.round((value + Number.EPSILON) * 100);

export function validateVatPaymentBankLinks(input: {
  companyId: string;
  declaration: VatWithholdingDeclaration;
  draft: VatPaymentBankLinkDraft;
  events: VatWithholdingDeclarationEvent[];
  bankAccounts: BankAccount[];
  bankMovements: BankStatementMovement[];
}): void {
  if (input.draft.eventType !== 'PAYMENT') return;
  const ids = input.draft.bankStatementMovementIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.some(id => !String(id || '').trim()) ||
      new Set(ids).size !== ids.length) {
    throw new Error('Seleccione al menos un débito bancario real para respaldar el enteramiento.');
  }
  const filed = input.events.find(event =>
    event.declarationId === input.declaration.id && event.eventType === 'FILED');
  if (!filed) throw new Error('No existe una presentación previa que permita conciliar el enteramiento.');
  const usedIds = new Set(input.events
    .filter(event => event.eventType === 'PAYMENT')
    .flatMap(event => event.bankStatementMovementIds || []));
  const movements = ids.map(id => {
    if (usedIds.has(id)) throw new Error('Un movimiento bancario ya está vinculado a otro enteramiento y no puede reutilizarse.');
    const movement = input.bankMovements.find(item => item.id === id);
    if (!movement || movement.companyId !== input.companyId || movement.type !== 'DEBIT') {
      throw new Error('Cada soporte debe ser un débito bancario existente de la empresa activa.');
    }
    const account = input.bankAccounts.find(item =>
      item.id === movement.bankAccountId && item.companyId === input.companyId);
    if (!account || account.currency !== 'BS') {
      throw new Error('El enteramiento IVA debe conciliarse contra una cuenta bancaria en bolívares de la empresa activa.');
    }
    const amount = Number(movement.amountBs);
    if (!Number.isFinite(amount) || amount <= 0 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(movement.date) ||
        movement.date < filed.occurredAt.slice(0, 10) ||
        movement.date > input.draft.occurredAt.slice(0, 10)) {
      throw new Error('El débito bancario tiene importe o fecha inválidos, o está fuera del intervalo entre presentación y enteramiento.');
    }
    return movement;
  });
  const totalCents = movements.reduce((sum, item) => sum + cents(Number(item.amountBs)), 0);
  if (totalCents !== cents(Number(input.draft.amountBs))) {
    throw new Error('El importe del enteramiento debe coincidir exactamente con la suma de los débitos bancarios seleccionados.');
  }
}

export interface VatBankReconciliationLine {
  eventId: string;
  occurredAt: string;
  amountBs: number;
  paymentReference: string;
  status: 'RECONCILIADO' | 'PENDIENTE';
  movements: BankStatementMovement[];
}

export function buildVatBankReconciliationSummary(
  declaration: VatWithholdingDeclaration,
  events: VatWithholdingDeclarationEvent[],
  bankMovements: BankStatementMovement[],
  bankAccounts: BankAccount[]
): {
  lines: VatBankReconciliationLine[];
  reconciledAmountBs: number;
  pendingAmountBs: number;
  reconciledCount: number;
  pendingCount: number;
} {
  const payments = events.filter(event =>
    event.declarationId === declaration.id && event.eventType === 'PAYMENT');
  const lines = payments.map(event => {
    const ids = event.bankStatementMovementIds || [];
    const movements = ids.map(id => bankMovements.find(item =>
      item.id === id && item.companyId === declaration.companyId)).filter(Boolean) as BankStatementMovement[];
    const validMovements = movements.filter(movement => {
      const account = bankAccounts.find(item =>
        item.id === movement.bankAccountId && item.companyId === declaration.companyId);
      return movement.type === 'DEBIT' && account?.currency === 'BS' &&
        Number.isFinite(Number(movement.amountBs)) && Number(movement.amountBs) > 0 &&
        /^\\d{4}-\\d{2}-\\d{2}$/.test(movement.date);
    });
    const linkedTotalCents = validMovements.reduce((sum, movement) => sum + cents(Number(movement.amountBs)), 0);
    const complete = ids.length > 0 && movements.length === ids.length &&
      validMovements.length === ids.length && linkedTotalCents === cents(Number(event.amountBs || 0));
    return {
      eventId: event.id,
      occurredAt: event.occurredAt,
      amountBs: Number(event.amountBs || 0),
      paymentReference: event.paymentReference || '',
      status: complete ? 'RECONCILIADO' as const : 'PENDIENTE' as const,
      movements
    };
  });
  const reconciledAmountBs = lines.filter(line => line.status === 'RECONCILIADO')
    .reduce((sum, line) => sum + line.amountBs, 0);
  const pendingAmountBs = lines.filter(line => line.status === 'PENDIENTE')
    .reduce((sum, line) => sum + line.amountBs, 0);
  return {
    lines,
    reconciledAmountBs,
    pendingAmountBs,
    reconciledCount: lines.filter(line => line.status === 'RECONCILIADO').length,
    pendingCount: lines.filter(line => line.status === 'PENDIENTE').length
  };
}
