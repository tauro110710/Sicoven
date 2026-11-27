/**
 * Catálogo único de medios de pago y cobro.
 *
 * Cada medio declara su moneda, si exige referencia documental y la cuenta de
 * tesorería sugerida como contrapartida. El catálogo se usa tanto en ventas
 * (cobro) como en compras (pago): el asiento nunca queda sin la cuenta real de
 * Caja/Banco que recibió o entregó el dinero.
 */

export type PaymentMethodCode =
  | 'CASH_BS'
  | 'CASH_USD'
  | 'TRANSFER_BS'
  | 'TRANSFER_USD'
  | 'MOBILE_PAYMENT'
  | 'DEBIT_CARD'
  | 'POS'
  | 'BIOPAGO'
  | 'ZELLE'
  | 'INTERNATIONAL_TRANSFER'
  | 'CRYPTO'
  | 'CHECK'
  | 'OTHER';

/** Códigos heredados que deben seguir leyéndose en documentos históricos. */
export type LegacyPaymentMethodCode = 'BS' | 'FOREIGN_CASH';
export type StoredPaymentMethodCode = PaymentMethodCode | LegacyPaymentMethodCode;

export type PaymentMethodFamily = 'EFECTIVO' | 'BANCO' | 'TARJETA' | 'DIGITAL' | 'OTRO';

export interface PaymentMethodDefinition {
  code: PaymentMethodCode;
  /** Texto completo para el selector. */
  label: string;
  /** Texto corto para tablas y resúmenes. */
  shortLabel: string;
  currency: 'BS' | 'USD';
  family: PaymentMethodFamily;
  /** Medios electrónicos: el comprobante es indispensable para auditar el cobro/pago. */
  requiresReference: boolean;
  /** Cuenta de tesorería sugerida; se resuelve contra el plan de cuentas real. */
  suggestedAccountCode: string;
  hint: string;
}

export const PAYMENT_METHODS: readonly PaymentMethodDefinition[] = [
  {
    code: 'CASH_BS', label: 'Efectivo en bolívares (Bs.)', shortLabel: 'Efectivo Bs.',
    currency: 'BS', family: 'EFECTIVO', requiresReference: false, suggestedAccountCode: '1.1.1.01',
    hint: 'Caja principal en moneda nacional.'
  },
  {
    code: 'CASH_USD', label: 'Efectivo en divisas (USD)', shortLabel: 'Efectivo USD',
    currency: 'USD', family: 'EFECTIVO', requiresReference: false, suggestedAccountCode: '1.1.1.02',
    hint: 'Caja en moneda extranjera; conserva además la tasa BCV de la operación.'
  },
  {
    code: 'TRANSFER_BS', label: 'Transferencia bancaria Bs.', shortLabel: 'Transferencia Bs.',
    currency: 'BS', family: 'BANCO', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Abono o débito en cuenta bancaria nacional en bolívares.'
  },
  {
    code: 'TRANSFER_USD', label: 'Transferencia bancaria USD', shortLabel: 'Transferencia USD',
    currency: 'USD', family: 'BANCO', requiresReference: true, suggestedAccountCode: '1.1.1.04',
    hint: 'Cuenta bancaria en moneda extranjera de la empresa.'
  },
  {
    code: 'MOBILE_PAYMENT', label: 'Pago móvil interbancario', shortLabel: 'Pago móvil',
    currency: 'BS', family: 'BANCO', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Abono en cuenta por Pago Móvil; registra el número de referencia.'
  },
  {
    code: 'DEBIT_CARD', label: 'Tarjeta de débito / crédito', shortLabel: 'Tarjeta',
    currency: 'BS', family: 'TARJETA', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Cobro o pago con tarjeta; usa la cuenta de liquidación bancaria o transitoria.'
  },
  {
    code: 'POS', label: 'Punto de pago (POS)', shortLabel: 'Punto de pago',
    currency: 'BS', family: 'TARJETA', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Voucher del punto de venta; la liquidación puede abonarse días después.'
  },
  {
    code: 'BIOPAGO', label: 'Biopago', shortLabel: 'Biopago',
    currency: 'BS', family: 'TARJETA', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Cobro con Biopago; conserva el número de operación del terminal.'
  },
  {
    code: 'ZELLE', label: 'Zelle', shortLabel: 'Zelle',
    currency: 'USD', family: 'DIGITAL', requiresReference: true, suggestedAccountCode: '1.1.1.04',
    hint: 'Transferencia en divisas; registra la confirmación del banco emisor.'
  },
  {
    code: 'INTERNATIONAL_TRANSFER', label: 'Transferencia internacional', shortLabel: 'Transferencia intl.',
    currency: 'USD', family: 'BANCO', requiresReference: true, suggestedAccountCode: '1.1.1.04',
    hint: 'Swift, ACH u otro abono internacional en divisas.'
  },
  {
    code: 'CRYPTO', label: 'Criptoactivos', shortLabel: 'Cripto',
    currency: 'USD', family: 'DIGITAL', requiresReference: true, suggestedAccountCode: '1.1.1.02',
    hint: 'Cobro o pago en criptoactivos; registra el hash o identificador de la operación.'
  },
  {
    code: 'CHECK', label: 'Cheque', shortLabel: 'Cheque',
    currency: 'BS', family: 'BANCO', requiresReference: true, suggestedAccountCode: '1.1.1.03',
    hint: 'Número de cheque y banco emisor.'
  },
  {
    code: 'OTHER', label: 'Otro medio de pago / cobro', shortLabel: 'Otro',
    currency: 'BS', family: 'OTRO', requiresReference: true, suggestedAccountCode: '1.1.1.01',
    hint: 'Medio no listado; describe el soporte en la referencia.'
  }
];

const LEGACY_METHOD_LABELS: Record<string, string> = {
  BS: 'Bolívares / medios nacionales',
  FOREIGN_CASH: 'Divisas en efectivo',
  FOREIGN_TRANSFER: 'Transferencia en divisas'
};

const LEGACY_METHOD_SHORT_LABELS: Record<string, string> = {
  BS: 'Bs. / nacional',
  FOREIGN_CASH: 'Divisas efectivo',
  FOREIGN_TRANSFER: 'Transferencia USD'
};

export function getPaymentMethod(code?: string | null): PaymentMethodDefinition | undefined {
  if (!code) return undefined;
  return PAYMENT_METHODS.find(method => method.code === code);
}

export function paymentMethodLabel(code?: string | null): string {
  if (!code) return 'Sin definir';
  return getPaymentMethod(code)?.label || LEGACY_METHOD_LABELS[code] || code;
}

export function paymentMethodShortLabel(code?: string | null): string {
  if (!code) return 'Sin definir';
  return getPaymentMethod(code)?.shortLabel || LEGACY_METHOD_SHORT_LABELS[code] || code;
}

export function paymentMethodRequiresReference(code?: string | null): boolean {
  return getPaymentMethod(code)?.requiresReference ?? true;
}

/**
 * Medios sujetos a IGTF por operar en moneda extranjera. El medio habilita la
 * evaluación, pero no determina por sí solo la obligación fiscal.
 */
export function isIgtfEligiblePaymentMethod(code?: string | null): boolean {
  const method = getPaymentMethod(code);
  if (method) return method.currency === 'USD';
  return code === 'FOREIGN_CASH' || code === 'ZELLE' ||
    code === 'INTERNATIONAL_TRANSFER' || code === 'CRYPTO';
}

/** Categoría heredada de moneda/medio usada por la venta y su control de IGTF. */
export function salePaymentCurrencyForMethod(
  code?: string | null
): 'BS' | 'FOREIGN_CASH' | 'FOREIGN_TRANSFER' | 'CRYPTO' {
  if (code === 'CASH_USD' || code === 'FOREIGN_CASH') return 'FOREIGN_CASH';
  if (code === 'CRYPTO') return 'CRYPTO';
  if (code === 'TRANSFER_USD' || code === 'ZELLE' || code === 'INTERNATIONAL_TRANSFER') return 'FOREIGN_TRANSFER';
  return 'BS';
}

export interface PaymentCounterpartAccount {
  code: string;
  name: string;
  type: string;
  isMovement: boolean;
  /** Las cuentas inactivas conservan historial pero no admiten nuevos movimientos. */
  isActive?: boolean;
}

export interface CompanyTreasuryAccountRef {
  companyId: string;
  accountCode: string;
  currency?: 'BS' | 'USD';
}

/** Solo cajas y auxiliares bancarios de movimiento pueden recibir/entregar dinero. */
export function isTreasuryCounterpartAccount(account?: PaymentCounterpartAccount | null): boolean {
  if (!account || account.type !== 'ACTIVO' || account.isMovement !== true) return false;
  const name = String(account.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return /\b(CAJA|BANCO|BANCOS|EFECTIVO|EQUIVALENTES DE EFECTIVO)\b/.test(name) ||
    /^1\.1\.1(?:\.|$)/.test(String(account.code || ''));
}

/**
 * Cuentas de tesorería disponibles para la empresa activa. Las cuentas
 * agrupadoras de bancos (1.1.1.03+) solo se ofrecen si la empresa tiene una
 * cuenta bancaria registrada sobre ese código; las cajas 1.1.1.01/02 son libres.
 */
export function listPaymentCounterpartAccounts(
  accounts: PaymentCounterpartAccount[],
  bankAccounts: CompanyTreasuryAccountRef[],
  companyId: string
): PaymentCounterpartAccount[] {
  const ownedBankCodes = new Set(
    bankAccounts.filter(bank => bank.companyId === companyId).map(bank => bank.accountCode)
  );
  return accounts.filter(account => isTreasuryCounterpartAccount(account) && account.isActive !== false && (
    !/^1\.1\.1\.0[3-9](?:\.|$)/.test(account.code) || ownedBankCodes.has(account.code)
  ));
}

/**
 * Cuenta contable sugerida para el medio elegido. Nunca inventa una cuenta:
 * devuelve '' si el plan de cuentas de la empresa no tiene una contrapartida.
 */
export function suggestPaymentAccountCode(
  methodCode: string | undefined,
  counterpartAccounts: PaymentCounterpartAccount[]
): string {
  if (!methodCode || counterpartAccounts.length === 0) return '';
  const method = getPaymentMethod(methodCode);
  if (!method) return counterpartAccounts[0].code;

  const sorted = [...counterpartAccounts].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const exact = sorted.find(account => account.code === method.suggestedAccountCode);
  if (exact) return exact.code;

  // El efectivo va a su caja; nunca se sugiere un banco para un cobro en efectivo.
  if (method.family === 'EFECTIVO') {
    const cashCode = method.currency === 'USD' ? '1.1.1.02' : '1.1.1.01';
    return sorted.find(account => account.code === cashCode)?.code || '';
  }

  const bankPrefix = method.currency === 'USD' ? '1.1.1.04' : '1.1.1.03';
  const bankChild = sorted.find(account => account.code.startsWith(bankPrefix + '.'));
  if (bankChild) return bankChild.code;

  // Sin banco propio para un medio electrónico no se sugiere una caja:
  // el contador debe elegir explícitamente la cuenta de tesorería correcta.
  return '';
}

export interface PaymentMethodSelectionInput {
  method?: string;
  accountCode?: string;
  reference?: string;
  accounts: PaymentCounterpartAccount[];
  /** 'cobro' para ventas, 'pago' para compras. */
  movementLabel?: 'cobro' | 'pago';
  /**
   * Exige referencia aunque el medio sea efectivo. Las compras de contado
   * siempre requieren soporte del desembolso para poder auditar el egreso.
   */
  requireReference?: boolean;
}

/**
 * Verifica que el medio seleccionado tenga una contrapartida de Caja/Banco y
 * la referencia/comprobante cuando el medio es electrónico o cuando la regla
 * del documento la exige (p. ej. compras de contado).
 */
export function validatePaymentMethodSelection(input: PaymentMethodSelectionInput): string | null {
  const label = input.movementLabel || 'pago';
  const account = input.accounts.find(item => item.code === input.accountCode);
  if (!isTreasuryCounterpartAccount(account)) {
    return 'Selecciona la cuenta contable de Caja o Banco (contrapartida) que recibió o entregó el dinero del ' + label + '.';
  }
  const needsReference = input.requireReference || paymentMethodRequiresReference(input.method);
  if (needsReference && !String(input.reference || '').trim()) {
    const methodDetail = input.method ? ' (' + paymentMethodLabel(input.method) + ')' : '';
    return 'Indica el número de referencia o comprobante del ' + label + methodDetail + '.';
  }
  return null;
}
