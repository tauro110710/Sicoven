import type { JournalEntryItem } from './accounting';

export type SettlementJournalKind = 'SALE_COLLECTION' | 'PURCHASE_PAYMENT';
export interface SettlementLedgerAccount { code: string; name: string; }
export interface CreditSettlementJournalPlanInput {
  kind: SettlementJournalKind;
  method: string;
  amountBs: number;
  amountUsd: number;
  invoiceRate: number;
  settlementRate: number;
  cashAccount: SettlementLedgerAccount;
  controlAccount: SettlementLedgerAccount;
  fxGainAccount?: SettlementLedgerAccount;
  fxLossAccount?: SettlementLedgerAccount;
}

/**
 * Pure accounting-line planner for a credit invoice collection/payment.
 * It does not mutate context, allocate entry numbers, persist data or infer accounts.
 */
export function buildCreditSettlementJournalItems(input: CreditSettlementJournalPlanInput): JournalEntryItem[] {
  const { kind, method, cashAccount, controlAccount } = input;
  const values = [input.amountBs, input.amountUsd, input.invoiceRate, input.settlementRate];
  if (!['SALE_COLLECTION', 'PURCHASE_PAYMENT'].includes(kind) ||
      values.some(value => !Number.isFinite(value) || value < 0) ||
      input.amountBs <= 0 || input.amountUsd < 0 ||
      (input.amountUsd > 0 && input.invoiceRate <= 0)) {
    throw new Error('Los importes deben ser válidos; las tasas no pueden ser negativas y se requieren cuando hay equivalencia USD.');
  }
  if (!cashAccount?.code || !cashAccount.name || !controlAccount?.code || !controlAccount.name) {
    throw new Error('La liquidación requiere cuentas contables de tesorería y control verificables.');
  }
  const amountAtInvoiceRate = input.amountUsd > 0 ? Math.round(input.amountUsd * input.invoiceRate * 100) / 100 : actualAmountBs;
  const amountAtSettlementRate = input.settlementRate > 0 ? Math.round(input.amountUsd * input.settlementRate * 100) / 100 : actualAmountBs;
  const actualAmountBs = Math.round(input.amountBs * 100) / 100;
  if (input.amountUsd > 0 && input.settlementRate > 0 && Math.abs(actualAmountBs - amountAtSettlementRate) >= 0.01) {
    throw new Error('El importe en Bs no coincide con el equivalente a la tasa de liquidación.');
  }
  const fxDifferenceBs = input.amountUsd > 0 ? Math.round((actualAmountBs - amountAtInvoiceRate) * 100) / 100 : 0;
  const isTransfer = method === 'BANK_TRANSFER_BS' || method === 'BANK_TRANSFER_USD';
  const baseItems: JournalEntryItem[] = kind === 'SALE_COLLECTION' ? [
    { accountCode: cashAccount.code, accountName: cashAccount.name, debitBs: actualAmountBs, creditBs: 0, debitUsd: input.amountUsd, creditUsd: 0, description: isTransfer ? 'Cobro de factura de crédito por transferencia bancaria' : 'Cobro de factura de crédito' },
    { accountCode: controlAccount.code, accountName: controlAccount.name, debitBs: 0, creditBs: amountAtInvoiceRate, debitUsd: 0, creditUsd: input.amountUsd, description: 'Cancelación parcial de cuenta por cobrar al valor contable original' }
  ] : [
    { accountCode: controlAccount.code, accountName: controlAccount.name, debitBs: amountAtInvoiceRate, creditBs: 0, debitUsd: input.amountUsd, creditUsd: 0, description: 'Cancelación parcial de cuenta por pagar al valor contable original' },
    { accountCode: cashAccount.code, accountName: cashAccount.name, debitBs: 0, creditBs: actualAmountBs, debitUsd: 0, creditUsd: input.amountUsd, description: isTransfer ? 'Pago de factura de crédito por transferencia bancaria' : 'Pago de factura de crédito' }
  ];
  if (Math.abs(fxDifferenceBs) < 0.01) return baseItems;
  const addFxLine = (account: SettlementLedgerAccount | undefined, debitBs: number, creditBs: number, description: string) => {
    if (!account?.code || !account.name) throw new Error('Falta la cuenta contable requerida para reconocer la diferencia cambiaria.');
    baseItems.push({ accountCode: account.code, accountName: account.name, debitBs, creditBs, debitUsd: 0, creditUsd: 0, description });
  };
  if (kind === 'SALE_COLLECTION') {
    if (fxDifferenceBs > 0) addFxLine(input.fxGainAccount, 0, fxDifferenceBs, 'Ganancia cambiaria por cobro a tasa posterior');
    else addFxLine(input.fxLossAccount, Math.abs(fxDifferenceBs), 0, 'Pérdida cambiaria por cobro a tasa posterior');
  } else if (fxDifferenceBs > 0) {
    addFxLine(input.fxLossAccount, fxDifferenceBs, 0, 'Pérdida cambiaria por pago a tasa posterior');
  } else {
    addFxLine(input.fxGainAccount, 0, Math.abs(fxDifferenceBs), 'Ganancia cambiaria por pago a tasa posterior');
  }
  return baseItems;
}

/** Resolves the immutable source journal type for imported credit settlements. */
export function getCreditSettlementSourceJournalType(
  kind: SettlementJournalKind,
  documentType: string
): 'VENTA' | 'COMPRA' | 'AJUSTE' {
  if (documentType === '02') return 'AJUSTE';
  return kind === 'SALE_COLLECTION' ? 'VENTA' : 'COMPRA';
}
