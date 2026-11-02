import { isValidIsoDate } from './migrationParsing';
import type {
  BankAccount,
  BankStatementMovement,
  VatWithholdingDeclaration,
  VatWithholdingDeclarationEvent,
  JournalEntry
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
    if (movement.isReconciled || movement.reconciledWithJournalEntryId ||
        (movement.reconciledJournalEntryIds || []).length > 0) {
      throw new Error('El débito bancario ya fue conciliado con un asiento y no puede respaldar un nuevo enteramiento IVA.');
    }
    const account = input.bankAccounts.find(item =>
      item.id === movement.bankAccountId && item.companyId === input.companyId);
    if (!account || account.currency !== 'BS') {
      throw new Error('El enteramiento IVA debe conciliarse contra una cuenta bancaria en bolívares de la empresa activa.');
    }
    const amount = Number(movement.amountBs);
    if (!Number.isFinite(amount) || amount <= 0 ||
        !isValidIsoDate(movement.date) ||
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

function hasValidVatPaymentJournal(
  entry: JournalEntry,
  amountBs: number,
  expectedLiabilityUsd: number,
  movements: BankStatementMovement[],
  bankAccounts: BankAccount[]
): boolean {
  if (!Array.isArray(entry.items) || entry.items.length < 2) return false;
  const values = entry.items.flatMap(item => [
    item.debitBs, item.creditBs, item.debitUsd, item.creditUsd
  ]);
  if (values.some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) return false;
  const sum = (key: 'debitBs' | 'creditBs' | 'debitUsd' | 'creditUsd') =>
    entry.items.reduce((total, item) => total + Number(item[key]), 0);
  if (Math.abs(cents(sum('debitBs')) - cents(sum('creditBs'))) > 0 ||
      Math.abs(Math.round(sum('debitUsd') * 1e6) - Math.round(sum('creditUsd') * 1e6)) > 0) return false;

  const expectedBanks = new Map<string, { bs: number; usd: number }>();
  for (const movement of movements) {
    const account = bankAccounts.find(item =>
      item.id === movement.bankAccountId && item.companyId === entry.companyId);
    if (!account || account.currency !== 'BS' || !account.accountCode) return false;
    const current = expectedBanks.get(account.accountCode) || { bs: 0, usd: 0 };
    const movementUsd = Number(movement.amountUsd);
    if (!Number.isFinite(movementUsd) || movementUsd <= 0) return false;
    expectedBanks.set(account.accountCode, {
      bs: cents(current.bs + Number(movement.amountBs)),
      usd: Math.round((current.usd + movementUsd) * 1e6) / 1e6
    });
  }
  const liabilityLines = entry.items.filter(item => item.accountCode === '2.1.2.03');
  if (liabilityLines.length !== 1) return false;
  const liability = liabilityLines[0];
  if (cents(Number(liability.debitBs)) !== cents(amountBs) ||
      cents(Number(liability.creditBs)) !== 0 ||
      Math.round(Number(liability.debitUsd) * 1e6) !== Math.round(expectedLiabilityUsd * 1e6) ||
      Number(liability.creditUsd) !== 0) return false;

  const bankCodes = new Set(expectedBanks.keys());
  for (const [code, expected] of expectedBanks) {
    const lines = entry.items.filter(item => item.accountCode === code);
    if (lines.length !== 1 || cents(Number(lines[0].creditBs)) !== expected.bs ||
        cents(Number(lines[0].debitBs)) !== 0 || Number(lines[0].debitUsd) !== 0 ||
        Math.round(Number(lines[0].creditUsd) * 1e6) !== Math.round(expected.usd * 1e6)) return false;
  }

  // In bolívares solo se admite débito al pasivo y créditos a los bancos enlazados.
  for (const item of entry.items) {
    const isLiability = item.accountCode === '2.1.2.03';
    const isBank = bankCodes.has(item.accountCode);
    if (!isLiability && !isBank &&
        (cents(Number(item.debitBs)) !== 0 || cents(Number(item.creditBs)) !== 0)) return false;
    if (isBank && item.accountCode === '2.1.2.03') return false;
  }

  // El diferencial cambiario solo puede reconocerse en las cuentas específicas.
  for (const item of entry.items) {
    if (item.accountCode === '4.2.1.01') {
      if (Number(item.debitUsd) !== 0 || Number(item.creditUsd) < 0) return false;
    } else if (item.accountCode === '6.1.1.08') {
      if (Number(item.creditUsd) !== 0 || Number(item.debitUsd) < 0) return false;
    } else if (item.accountCode !== '2.1.2.03' && !bankCodes.has(item.accountCode) &&
      (Number(item.debitUsd) !== 0 || Number(item.creditUsd) !== 0)) return false;
  }
  const fxGain = entry.items.filter(item => item.accountCode === '4.2.1.01')
    .reduce((total, item) => total + Number(item.creditUsd), 0);
  const fxLoss = entry.items.filter(item => item.accountCode === '6.1.1.08')
    .reduce((total, item) => total + Number(item.debitUsd), 0);
  if (fxGain > 0 && fxLoss > 0) return false;
  return true;
}

export function buildVatBankReconciliationSummary(
  declaration: VatWithholdingDeclaration,
  events: VatWithholdingDeclarationEvent[],
  bankMovements: BankStatementMovement[],
  bankAccounts: BankAccount[],
  journalEntries: JournalEntry[] = []
): {
  lines: VatBankReconciliationLine[];
  reconciledAmountBs: number;
  pendingAmountBs: number;
  reconciledCount: number;
  pendingCount: number;
} {
  const payments = events.filter(event =>
    event.declarationId === declaration.id && event.eventType === 'PAYMENT');
  const filed = events.find(event =>
    event.declarationId === declaration.id && event.eventType === 'FILED');
  const lines = payments.map(event => {
    const ids = event.bankStatementMovementIds || [];
    const paymentAmount = Number(event.amountBs);
    const validPaymentAmount = Number.isFinite(paymentAmount) && paymentAmount > 0 &&
      Number.isInteger(cents(paymentAmount));
    const validPaymentDate = Boolean(filed) &&
      isValidIsoDate(event.occurredAt.slice(0, 10)) &&
      event.occurredAt >= filed!.occurredAt;
    const linkedJournal = event.journalEntryId
      ? journalEntries.find(entry => entry.id === event.journalEntryId &&
          entry.companyId === declaration.companyId && entry.type === 'RETENCION_IVA' &&
          entry.referenceDoc === 'IVA-ENTERAMIENTO:' + declaration.id + ':' + event.paymentReference)
      : undefined;
    const movements = ids.map(id => bankMovements.find(item =>
      item.id === id && item.companyId === declaration.companyId)).filter(Boolean) as BankStatementMovement[];
    const validMovements = movements.filter(movement => {
      const account = bankAccounts.find(item =>
        item.id === movement.bankAccountId && item.companyId === declaration.companyId);
      const linkedToThisPayment = Boolean(linkedJournal && event.journalEntryId) &&
        movement.reconciledWithJournalEntryId === event.journalEntryId &&
        (movement.reconciledJournalEntryIds || []).includes(event.journalEntryId as string);
      const hasOtherReconciliation = Boolean(movement.isReconciled || movement.reconciledWithJournalEntryId ||
        (movement.reconciledJournalEntryIds || []).length > 0) && !linkedToThisPayment;
      return movement.companyId === declaration.companyId &&
        movement.type === 'DEBIT' && account?.currency === 'BS' &&
        !hasOtherReconciliation &&
        Number.isFinite(Number(movement.amountBs)) && Number(movement.amountBs) > 0 &&
        isValidIsoDate(movement.date) && validPaymentDate &&
        movement.date >= filed!.occurredAt.slice(0, 10) &&
        movement.date <= event.occurredAt.slice(0, 10);
    });
    const linkedTotalCents = validMovements.reduce((sum, movement) => sum + cents(Number(movement.amountBs)), 0);
    const priorPaidBs = payments.filter(item => item.id !== event.id && (
      item.occurredAt < event.occurredAt ||
      (item.occurredAt === event.occurredAt && item.recordedAt < event.recordedAt)
    )).reduce((total, item) => total + Number(item.amountBs || 0), 0);
    const cumulativePaidBs = cents(priorPaidBs + paymentAmount);
    // cumulativePaidBs está expresado en céntimos para evitar errores de suma.
    // Convertirlo de nuevo a bolívares antes de prorratear el pasivo histórico en USD.
    const cumulativePaidAmountBs = cumulativePaidBs / 100;
    const priorPaidAmountBs = cents(priorPaidBs) / 100;
    const expectedCumulativeUsd = Number.isFinite(Number(declaration.totalWithheldUsd)) &&
      Number(declaration.totalWithheldUsd) > 0 && Number(declaration.totalWithheldBs) > 0
      ? cumulativePaidBs === cents(Number(declaration.totalWithheldBs))
        ? Number(declaration.totalWithheldUsd)
        : Number(declaration.totalWithheldUsd) * cumulativePaidAmountBs / Number(declaration.totalWithheldBs)
      : Number.NaN;
    const expectedPriorUsd = Number.isFinite(Number(declaration.totalWithheldUsd)) &&
      Number(declaration.totalWithheldUsd) > 0 && Number(declaration.totalWithheldBs) > 0
      ? Number(declaration.totalWithheldUsd) * priorPaidAmountBs / Number(declaration.totalWithheldBs)
      : Number.NaN;
    const expectedLiabilityUsd = Math.round((expectedCumulativeUsd - expectedPriorUsd) * 1e6) / 1e6;
    const validJournal = Boolean(linkedJournal) && validPaymentAmount &&
      Number.isFinite(expectedLiabilityUsd) && expectedLiabilityUsd > 0 &&
      movements.length === ids.length && validMovements.length === ids.length &&
      hasValidVatPaymentJournal(linkedJournal as JournalEntry, paymentAmount, expectedLiabilityUsd, validMovements, bankAccounts);
    const complete = validPaymentAmount && validPaymentDate && validJournal && ids.length > 0 &&
      movements.length === ids.length && validMovements.length === ids.length &&
      linkedTotalCents === cents(paymentAmount);
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

/**
 * A payment journal linked to a fiscal declaration cannot be reversed through
 * the generic journal workflow until a dedicated fiscal correction event exists.
 * Keeping the original event and bank links is safer than silently orphaning them.
 */
export function getVatPaymentJournalReversalBlocker(
  events: VatWithholdingDeclarationEvent[],
  journalEntryId: string
): string | null {
  const linkedPayment = events.some(event =>
    event.eventType === 'PAYMENT' && event.journalEntryId === journalEntryId);
  return linkedPayment
    ? 'El asiento corresponde a un enteramiento de IVA vinculado a una declaración fiscal. La reversión requiere primero un procedimiento de corrección fiscal específico; no se puede usar la reversión contable genérica ni liberar sus movimientos bancarios.'
    : null;
}
