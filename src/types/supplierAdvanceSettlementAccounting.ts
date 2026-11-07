import type { JournalEntryItem } from './accounting';

export type SupplierAdvanceJournalKind = 'REFUND_RECEIVED' | 'APPLIED_TO_PURCHASE';

export interface SupplierAdvanceJournalAccount {
  code: string;
  name: string;
}

export interface SupplierAdvanceJournalPlanInput {
  kind: SupplierAdvanceJournalKind;
  amountUsd: number;
  settlementValueBs: number;
  advanceBookValueBs: number;
  exchangeDifferenceBs: number;
  counterpartAccount: SupplierAdvanceJournalAccount;
  advanceAccount: SupplierAdvanceJournalAccount;
  fxGainAccount?: SupplierAdvanceJournalAccount;
  fxLossAccount?: SupplierAdvanceJournalAccount;
}

/** Pure planner: builds the balanced accounting lines without mutating or persisting context. */
export function buildSupplierAdvanceSettlementJournalItems(
  input: SupplierAdvanceJournalPlanInput
): JournalEntryItem[] {
  const { kind, amountUsd, settlementValueBs, advanceBookValueBs, exchangeDifferenceBs } = input;
  if (!['REFUND_RECEIVED', 'APPLIED_TO_PURCHASE'].includes(kind) ||
      ![amountUsd, settlementValueBs, advanceBookValueBs, exchangeDifferenceBs].every(Number.isFinite) ||
      amountUsd <= 0 || settlementValueBs <= 0 || advanceBookValueBs < 0) {
    throw new Error('Los importes de la liquidación del anticipo no son válidos.');
  }
  const validAccount = (account?: SupplierAdvanceJournalAccount) =>
    Boolean(account?.code?.trim() && account.name?.trim());
  if (!validAccount(input.counterpartAccount) || !validAccount(input.advanceAccount)) {
    throw new Error('La liquidación requiere cuentas contables de contrapartida y anticipo verificables.');
  }
  const expectedDifference = Math.round((settlementValueBs - advanceBookValueBs) * 100) / 100;
  if (Math.abs(expectedDifference - Math.round(exchangeDifferenceBs * 100) / 100) > 0.02) {
    throw new Error('La diferencia cambiaria no coincide con los valores de liquidación y costo histórico.');
  }

  const items: JournalEntryItem[] = [
    {
      accountCode: input.counterpartAccount.code,
      accountName: input.counterpartAccount.name,
      debitBs: settlementValueBs,
      creditBs: 0,
      debitUsd: amountUsd,
      creditUsd: 0,
      description: kind === 'REFUND_RECEIVED'
        ? 'Reembolso de anticipo de proveedor'
        : 'Aplicación de anticipo a cuenta por pagar'
    },
    {
      accountCode: input.advanceAccount.code,
      accountName: input.advanceAccount.name,
      debitBs: 0,
      creditBs: advanceBookValueBs,
      debitUsd: 0,
      creditUsd: amountUsd,
      description: 'Descarga del anticipo a su valor histórico FIFO'
    }
  ];

  if (Math.abs(expectedDifference) >= 0.01) {
    if (!validAccount(input.fxGainAccount) || !validAccount(input.fxLossAccount)) {
      throw new Error('Faltan las cuentas de ganancia/pérdida por diferencial cambiario.');
    }
    if (expectedDifference > 0) {
      items.push({
        accountCode: input.fxGainAccount!.code,
        accountName: input.fxGainAccount!.name,
        debitBs: 0,
        creditBs: expectedDifference,
        debitUsd: 0,
        creditUsd: 0,
        description: 'Ganancia por diferencial cambiario en liquidación de anticipo'
      });
    } else {
      items.push({
        accountCode: input.fxLossAccount!.code,
        accountName: input.fxLossAccount!.name,
        debitBs: Math.abs(expectedDifference),
        creditBs: 0,
        debitUsd: 0,
        creditUsd: 0,
        description: 'Pérdida por diferencial cambiario en liquidación de anticipo'
      });
    }
  }
  return items;
}
