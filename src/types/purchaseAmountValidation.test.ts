import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePurchaseAmounts } from './purchaseAmountValidation';
import { registerPurchaseInternal, getInternalRegistrations, resetInternalRegistrations } from './purchaseRegistration';

// Tipos para inputs de prueba
type PurchaseTestInput = {
  totalAmountBs: number;
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs?: number;
  igtfAmountBs?: number;
  vatWithheldBs: number;
  islrWithheldBs?: number;
  retentionRate?: number;
  islrRate?: number;
  islrSubtrahendBs?: number;
  taxRate?: number;
  bcvRate?: number;
  totalAmountUsd?: number;
  taxableBaseUsd?: number;
  exemptAmountUsd?: number;
  vatAmountUsd?: number;
  additionalLuxuryTaxUsd?: number;
  vatWithheldUsd?: number;
  islrWithheldUsd?: number;
  igtfAmountUsd?: number;
  supplierRif: string;
  invoiceNumber: string;
  documentType: '01' | '02' | '03';
  invoiceDate: string;
  paymentTerm: 'CONTADO' | 'CREDITO';
  paymentAccountCode?: string;
  paymentReference?: string;
  igtfApplicable?: boolean;
  paymentMethod?: string;
  vatCreditTreatment?: 'TAXABLE' | 'EXEMPT' | 'COMMON';
  ivaRetentionDecision?: unknown;
  accountCreditDate?: string;
  fiscReviewNote?: string;
};

// Store de pruebas
const PURCHASE_STORE: {
  purchases: import('./accounting').PurchaseRecord[];
  journalEntries: Array<{ totalAmountBs: number }>;
} = {
  purchases: [],
  journalEntries: []
};

/** Helper: crea un objeto de compra con valores base, permitiendo overrides */
const makePurchase = (overrides: Partial<PurchaseTestInput> = {}): PurchaseTestInput => {
  // Construir explicitamente cada propiedad para evitar duplicados de TypeScript
  return {
    totalAmountBs: overrides.totalAmountBs ?? 1160,
    taxableBaseBs: overrides.taxableBaseBs ?? 1000,
    exemptAmountBs: overrides.exemptAmountBs ?? 0,
    vatAmountBs: overrides.vatAmountBs ?? 160,
    additionalLuxuryTaxBs: overrides.additionalLuxuryTaxBs,
    igtfAmountBs: overrides.igtfAmountBs,
    vatWithheldBs: overrides.vatWithheldBs ?? 120,
    islrWithheldBs: overrides.islrWithheldBs ?? 30,
    retentionRate: overrides.retentionRate ?? 75,
    islrRate: overrides.islrRate ?? 5,
    islrSubtrahendBs: overrides.islrSubtrahendBs,
    taxRate: overrides.taxRate ?? 16,
    bcvRate: overrides.bcvRate ?? 100,
    totalAmountUsd: overrides.totalAmountUsd ?? 11.6,
    taxableBaseUsd: overrides.taxableBaseUsd ?? 10,
    exemptAmountUsd: overrides.exemptAmountUsd ?? 0,
    vatAmountUsd: overrides.vatAmountUsd ?? 1.6,
    additionalLuxuryTaxUsd: overrides.additionalLuxuryTaxUsd,
    vatWithheldUsd: overrides.vatWithheldUsd ?? 1.2,
    islrWithheldUsd: overrides.islrWithheldUsd ?? 0.3,
    igtfAmountUsd: overrides.igtfAmountUsd,
    supplierRif: overrides.supplierRif ?? 'J-12345678-9',
    invoiceNumber: overrides.invoiceNumber ?? 'F-001',
    documentType: overrides.documentType ?? '01' as const,
    invoiceDate: overrides.invoiceDate ?? '2024-01-15',
    paymentTerm: overrides.paymentTerm ?? 'CONTADO',
    paymentAccountCode: overrides.paymentAccountCode,
    paymentReference: overrides.paymentReference,
    igtfApplicable: overrides.igtfApplicable,
    paymentMethod: overrides.paymentMethod,
    vatCreditTreatment: overrides.vatCreditTreatment,
    ivaRetentionDecision: overrides.ivaRetentionDecision,
    accountCreditDate: overrides.accountCreditDate,
    fiscReviewNote: overrides.fiscReviewNote
  };
};

// Tests run full validation + registration cycle
test('acepta una compra válida con IVA, ISLR y equivalencias USD', () => {
  assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase()));
});

test('acepta la tasa combinada 31 % con IVA y suntuario separados', () => {
  assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase({
    totalAmountBs: 1310,
    taxableBaseBs: 1000,
    vatAmountBs: 160,
    additionalLuxuryTaxBs: 150,
    vatWithheldBs: 0,
    islrWithheldBs: 0,
    retentionRate: 0,
    islrRate: 0,
    totalAmountUsd: 13.1,
    vatAmountUsd: 1.6,
    additionalLuxuryTaxUsd: 1.5,
    vatWithheldUsd: 0,
    islrWithheldUsd: 0
  })));
});

test('acepta una compra exenta al 0 %', () => {
  assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase({
    totalAmountBs: 500,
    taxableBaseBs: 0,
    exemptAmountBs: 500,
    vatAmountBs: 0,
    vatWithheldBs: 0,
    islrWithheldBs: 0,
    retentionRate: 0,
    totalAmountUsd: 5,
    taxableBaseUsd: 0,
    exemptAmountUsd: 5,
    vatAmountUsd: 0,
    vatWithheldUsd: 0,
    islrWithheldUsd: 0,
    additionalLuxuryTaxUsd: 0,
    igtfAmountUsd: 0
  })));
});

test('valida que la alícuota 8 % pasa la verificación de dominio', () => {
  assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase({ taxRate: 8 })));
});

test('acepta una compra con alícuota general 16 %', () => {
  assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase({
    totalAmountBs: 1160,
    taxableBaseBs: 1000,
    exemptAmountBs: 0,
    vatAmountBs: 160,
    additionalLuxuryTaxBs: 0,
    vatWithheldBs: 120,
    islrWithheldBs: 30,
    retentionRate: 75,
    islrRate: 5
  })));
});

test('solo acepta las alícuotas 0, 8, 16 y 31 y rechaza las demás', () => {
  for (const rate of [0, 8, 16, 31]) {
    assert.doesNotThrow(() => validatePurchaseAmounts(makePurchase({ taxRate: rate })), 'acepta ' + rate);
  }
  for (const rate of [1, 7, 12, 19, 27, 30, 32, 100]) {
    assert.throws(
      () => validatePurchaseAmounts(makePurchase({ taxRate: rate })),
      /no está admitida/,
      'rechaza ' + rate
    );
  }
});

test('no registra compras con datos inválidos (NaN, infinitas, negativas, fuera de límite)', () => {
  const invalidCases: Array<{label: string; input: PurchaseTestInput}> = [
    { label: 'totalAmountBs NaN', input: makePurchase({ totalAmountBs: Number.NaN }) },
    { label: 'totalAmountBs 0', input: makePurchase({ totalAmountBs: 0 }) },
    { label: 'totalAmountBs negativo', input: makePurchase({ totalAmountBs: -5 }) },
    { label: 'vatWithheldBs negativo', input: makePurchase({ vatWithheldBs: -1 }) },
    { label: 'vatWithheldBs NaN', input: makePurchase({ vatWithheldBs: Number.NaN }) },
    { label: 'islrWithheldBs Infinity', input: makePurchase({ islrWithheldBs: Number.POSITIVE_INFINITY }) },
    { label: 'vatWithheldBs 999 (excede total)', input: makePurchase({ vatWithheldBs: 999 }) },
    { label: 'taxableBaseUsd NaN', input: makePurchase({ taxableBaseUsd: Number.NaN }) },
    { label: 'totalAmountUsd 999 (fuera de límite)', input: makePurchase({ totalAmountUsd: 999 }) }
  ];

  for (const { label, input } of invalidCases) {
    resetInternalRegistrations();
    PURCHASE_STORE.purchases.length = 0;
    PURCHASE_STORE.journalEntries.length = 0;
    assert.throws(() => {
      validatePurchaseAmounts(input as any);
    }, 'error para ' + label);
    assert.equal(getInternalRegistrations().length, 0, label + ' no escribe compra');
    assert.equal(PURCHASE_STORE.purchases.length, 0, label + ' no agrega a store');
    assert.equal(PURCHASE_STORE.journalEntries.length, 0, label + ' no agrega journal');
  }
});

test('registra correctamente una compra válida en el store interno', () => {
  resetInternalRegistrations();
  PURCHASE_STORE.purchases.length = 0;
  PURCHASE_STORE.journalEntries.length = 0;
  validatePurchaseAmounts(makePurchase() as any);
  const purchased = registerPurchaseInternal({
    supplierRif: 'J-12345678-9',
    invoiceNumber: 'F-001',
    documentType: '01' as const,
    invoiceDate: '2024-01-15',
    paymentTerm: 'CONTADO',
    totalAmountBs: 1160,
    taxableBaseBs: 1000,
    exemptAmountBs: 0,
    vatAmountBs: 160,
    additionalLuxuryTaxBs: 0,
    igtfAmountBs: 0,
    vatWithheldBs: 120,
    islrWithheldBs: 30,
    retentionRate: 75,
    islrRate: 5,
    islrSubtrahendBs: 0,
    taxRate: 16,
    bcvRate: 100,
    totalAmountUsd: 11.6,
    taxableBaseUsd: 10,
    exemptAmountUsd: 0,
    vatAmountUsd: 1.6,
    additionalLuxuryTaxUsd: 0,
    vatWithheldUsd: 1.2,
    islrWithheldUsd: 0.3,
    igtfAmountUsd: 0
  } as any);
  const registered = getInternalRegistrations();
  assert.equal(registered.length, 1, 'registra compra');
  assert.equal(registered[0].totalAmountBs, 1160, 'total correcto');
  assert.equal(registered[0].taxRate, 16, 'tasa 16');

  assert.equal(purchased.totalAmountBs, 1160, 'compra devuelta con total correcto');
  assert.equal(purchased.invoiceNumber, 'F-001', 'compra devuelta con su número de factura');
});

test('rechaza equivalentes USD que no corresponden a la tasa BCV declarada', () => {
  assert.throws(
    () => validatePurchaseAmounts(makePurchase({ bcvRate: 0, totalAmountUsd: 11.6 })),
    /sin una tasa BCV válida/i
  );
  assert.throws(
    () => validatePurchaseAmounts(makePurchase({ vatAmountUsd: 2.6 })),
    /IVA en USD no corresponde/i
  );
});

test('rechaza equivalencias USD positivas sin tasa BCV', () => {
  assert.throws(
    () => validatePurchaseAmounts(makePurchase({ bcvRate: 0, totalAmountUsd: 11.6 })),
    /sin una tasa BCV válida/i
  );
});

test('registra compra con alícuota 8 % y verifica el store interno', () => {
  resetInternalRegistrations();
  PURCHASE_STORE.purchases.length = 0;
  PURCHASE_STORE.journalEntries.length = 0;
  validatePurchaseAmounts(makePurchase({ taxRate: 8 }) as any);
  const purchased = registerPurchaseInternal({
    supplierRif: 'J-12345678-9',
    invoiceNumber: 'F-001',
    documentType: '01' as const,
    invoiceDate: '2024-01-15',
    paymentTerm: 'CONTADO',
    totalAmountBs: 540,
    taxableBaseBs: 500,
    exemptAmountBs: 0,
    vatAmountBs: 40,
    additionalLuxuryTaxBs: 0,
    igtfAmountBs: 0,
    vatWithheldBs: 0,
    islrWithheldBs: 0,
    retentionRate: 0,
    islrRate: 0,
    islrSubtrahendBs: 0,
    taxRate: 8,
    bcvRate: 100,
    totalAmountUsd: 5.4,
    taxableBaseUsd: 5,
    exemptAmountUsd: 0,
    vatAmountUsd: 0.4,
    additionalLuxuryTaxUsd: 0,
    vatWithheldUsd: 0,
    islrWithheldUsd: 0
  } as any);
  const registered = getInternalRegistrations();
  assert.equal(registered.length, 1, 'compra con alícuota 8 % registrada');
  assert.equal(registered[0].taxRate, 8, 'tasa 8 %');
  assert.equal(purchased.taxRate, 8, 'compra devuelta con alícuota 8 %');
});
