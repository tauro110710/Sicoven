import {
  validatePaymentMethodSelection,
  type PaymentCounterpartAccount
} from './paymentMethods';

export interface SaleSettlementInput {
  paymentTerm?: 'CONTADO' | 'CREDITO';
  /** Medio de cobro del catálogo compartido. */
  paymentMethod?: string;
  /** Cuenta de Caja/Banco que recibió el dinero. */
  paymentAccountCode?: string;
  /** Referencia del comprobante de cobro. */
  paymentReference?: string;
  accounts?: PaymentCounterpartAccount[];
}

/**
 * Una venta de contado debe identificar el medio de cobro y la cuenta real de
 * Caja/Banco que recibió el dinero; nunca se registra como CxC ficticia.
 */
export function validateSaleSettlementMode(input: SaleSettlementInput): string | null {
  if (input.paymentTerm !== 'CONTADO') return null;
  return validatePaymentMethodSelection({
    method: input.paymentMethod,
    accountCode: input.paymentAccountCode,
    reference: input.paymentReference,
    accounts: input.accounts || [],
    movementLabel: 'cobro'
  });
}
