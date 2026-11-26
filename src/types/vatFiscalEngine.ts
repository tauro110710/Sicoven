/**
 * Motor fiscal único de IVA y del impuesto adicional al consumo suntuario.
 *
 * Toda compra, venta, nota de crédito, nota de débito, corrección, validación
 * contable, declaración y reporte debe obtener sus importes fiscales de este
 * módulo. Ningún componente puede recalcular alícuotas por su cuenta ni
 * contabilizar la tasa combinada del 31 % como si fuera IVA.
 *
 * Reglas:
 * - IVA reducido: 8 %. IVA general: 16 %.
 * - La tasa combinada 31 % equivale a 16 % de IVA más 15 % de impuesto
 *   adicional al consumo suntuario. Siempre se separan los dos componentes.
 * - Las bases imponibles, importes exentos, IVA, impuesto suntuario, IGTF y
 *   totales se redondean a dos decimales de bolívar con un único criterio.
 * - El módulo calcula y valida documentos nuevos; nunca reescribe documentos
 *   históricos. Para mostrarlos se usan sus importes guardados.
 */

export const VAT_REDUCED_RATE = 8;
export const VAT_STANDARD_RATE = 16;
export const LUXURY_CONSUMPTION_RATE = 15;
export const LUXURY_COMBINED_RATE = 31;

/** Alícuotas admitidas en SICOVEN: exento, reducida, general y combinada. */
export const SUPPORTED_FISCAL_RATES = [0, VAT_REDUCED_RATE, VAT_STANDARD_RATE, LUXURY_COMBINED_RATE] as const;

export const VAT_INPUT_ACCOUNT_BY_RATE = Object.freeze({
  [VAT_REDUCED_RATE]: '1.1.3.02',
  [VAT_STANDARD_RATE]: '1.1.3.01'
});
export const VAT_OUTPUT_ACCOUNT_BY_RATE = Object.freeze({
  [VAT_REDUCED_RATE]: '2.1.2.02',
  [VAT_STANDARD_RATE]: '2.1.2.01'
});
export const LUXURY_TAX_PAYABLE_ACCOUNT = '2.1.2.08';
export const LUXURY_TAX_EXPENSE_ACCOUNT = '6.1.1.13';

export interface FiscalRateBreakdown {
  /** Alícuota declarada en el documento: 0, 8, 16 o 31. */
  declaredRate: number;
  /** Componente de IVA: 8, 16 o la alícuota declarada cuando no es combinada. */
  vatRate: number;
  /** Componente suntuario: 15 solo en la tasa combinada 31 %; 0 en el resto. */
  luxuryRate: number;
  /** true solo para la tasa combinada 31 %. */
  combined: boolean;
}

const numericRate = (value: unknown): number => {
  if (typeof value === 'string') return value.trim() === '' ? Number.NaN : Number(value);
  if (typeof value !== 'number') return Number.NaN;
  return value;
};

/** Única compuerta de alícuotas fiscales admitidas en SICOVEN. */
export function isSupportedFiscalRate(taxRate: number | string): boolean {
  const rate = numericRate(taxRate);
  return Number.isFinite(rate) && (SUPPORTED_FISCAL_RATES as readonly number[]).includes(rate);
}

/** Separa una alícuota declarada en su componente IVA y su componente suntuario. */
export function resolveFiscalRates(taxRate: number | string): FiscalRateBreakdown {
  const declaredRate = numericRate(taxRate);
  if (!Number.isFinite(declaredRate) || declaredRate < 0 || declaredRate > 100) {
    throw new Error('La alícuota fiscal debe ser un porcentaje numérico entre 0 y 100.');
  }
  // No basta con que el desglose matemático sea posible: la alícuota debe ser
  // una de las admitidas por SICOVEN. Esta es la compuerta central que usan
  // compras, ventas, notas, declaraciones, reportes e importaciones.
  if (!isSupportedFiscalRate(declaredRate)) {
    throw new Error('La alícuota fiscal ' + declaredRate + ' % no está admitida. SICOVEN solo acepta 0 %, 8 %, 16 % y 31 % (16 % IVA + 15 % impuesto suntuario).');
  }
  if (declaredRate === LUXURY_COMBINED_RATE) {
    return { declaredRate, vatRate: VAT_STANDARD_RATE, luxuryRate: LUXURY_CONSUMPTION_RATE, combined: true };
  }
  return { declaredRate, vatRate: declaredRate, luxuryRate: 0, combined: false };
}

/** Único criterio de redondeo monetario en bolívares de todo el motor fiscal. */
export function roundFiscalBs(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('El importe fiscal en bolívares no es un número válido.');
  const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/** Único criterio de redondeo de equivalencias USD guardadas en el documento. */
export function roundFiscalUsd(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new Error('El importe fiscal en dólares no es un número válido.');
  const rounded = Math.round((amount + Number.EPSILON) * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export interface FiscalBreakdownInput {
  taxableBaseBs: number;
  exemptAmountBs?: number;
  taxRate: number;
  /** Tasa de IGTF en porcentaje (normalmente 3). */
  igtfRatePercent?: number;
  /** Importe de IGTF ya determinado externamente; tiene prioridad sobre la tasa. */
  igtfAmountBs?: number;
}

export interface FiscalBreakdown {
  declaredTaxRate: number;
  vatRate: number;
  luxuryRate: number;
  combined: boolean;
  taxableBaseBs: number;
  exemptAmountBs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  igtfAmountBs: number;
  /** Base + exento + IVA + suntuario, antes de IGTF. */
  subtotalBs: number;
  /** Subtotal + IGTF: total del documento. */
  totalAmountBs: number;
}

/** Calcula el desglose fiscal completo de una operación. */
export function calculateFiscalBreakdown(input: FiscalBreakdownInput): FiscalBreakdown {
  const rates = resolveFiscalRates(input.taxRate);
  const taxableBaseBs = roundFiscalBs(input.taxableBaseBs);
  const exemptAmountBs = roundFiscalBs(input.exemptAmountBs ?? 0);
  if (taxableBaseBs < 0 || exemptAmountBs < 0) {
    throw new Error('La base imponible y el importe exento deben ser importes no negativos.');
  }
  const vatAmountBs = roundFiscalBs(taxableBaseBs * rates.vatRate / 100);
  const additionalLuxuryTaxBs = roundFiscalBs(taxableBaseBs * rates.luxuryRate / 100);
  const subtotalBs = roundFiscalBs(taxableBaseBs + exemptAmountBs + vatAmountBs + additionalLuxuryTaxBs);
  let igtfAmountBs = 0;
  if (input.igtfAmountBs !== undefined) {
    igtfAmountBs = roundFiscalBs(input.igtfAmountBs);
    if (igtfAmountBs < 0) throw new Error('El IGTF debe ser un importe no negativo.');
  } else {
    const igtfRate = Number(input.igtfRatePercent ?? 0);
    if (!Number.isFinite(igtfRate) || igtfRate < 0 || igtfRate > 100) {
      throw new Error('La tasa de IGTF debe ser un porcentaje entre 0 y 100.');
    }
    igtfAmountBs = roundFiscalBs(subtotalBs * igtfRate / 100);
  }
  return {
    declaredTaxRate: rates.declaredRate,
    vatRate: rates.vatRate,
    luxuryRate: rates.luxuryRate,
    combined: rates.combined,
    taxableBaseBs,
    exemptAmountBs,
    vatAmountBs,
    additionalLuxuryTaxBs,
    igtfAmountBs,
    subtotalBs,
    totalAmountBs: roundFiscalBs(subtotalBs + igtfAmountBs)
  };
}

/**
 * Desglose cuando la factura no discrimina el IVA: el importe bruto incluye
 * IVA y, si la alícuota es combinada, también el suntuario.
 */
export function calculateFiscalBreakdownFromGross(input: {
  grossAmountBs: number;
  taxRate: number;
  igtfRatePercent?: number;
}): FiscalBreakdown {
  const rates = resolveFiscalRates(input.taxRate);
  const gross = roundFiscalBs(input.grossAmountBs);
  if (gross < 0) throw new Error('El importe bruto no puede ser negativo.');
  const taxableBaseBs = rates.declaredRate > 0
    ? roundFiscalBs(gross / (1 + rates.declaredRate / 100))
    : gross;
  return calculateFiscalBreakdown({
    taxableBaseBs,
    taxRate: rates.declaredRate,
    igtfRatePercent: input.igtfRatePercent
  });
}

export interface FiscalValidationInput {
  taxRate: number;
  taxableBaseBs: number;
  exemptAmountBs?: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs?: number;
  igtfAmountBs?: number;
  totalAmountBs?: number;
}

export interface FiscalValidationOptions {
  /** Tolerancia de redondeo del documento en Bs. */
  toleranceBs?: number;
  /** Exige que el total informado incluya la base exenta y el IGTF. */
  requireTotal?: boolean;
}

/**
 * Valida que los importes declarados de un documento correspondan al desglose
 * fiscal del motor. Devuelve la lista de inconsistencias; vacía si concilia.
 */
export function validateFiscalBreakdown(
  input: FiscalValidationInput,
  options: FiscalValidationOptions = {}
): string[] {
  const tolerance = Number(options.toleranceBs ?? 0.02);
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error('La tolerancia fiscal no es válida.');
  const issues: string[] = [];
  const declared = [input.taxableBaseBs, input.exemptAmountBs ?? 0, input.vatAmountBs,
    input.additionalLuxuryTaxBs ?? 0, input.igtfAmountBs ?? 0].map(Number);
  if (declared.some(value => !Number.isFinite(value) || value < 0)) {
    return ['El documento contiene bases o impuestos fiscales no numéricos o negativos.'];
  }
  let expected: FiscalBreakdown;
  try {
    expected = calculateFiscalBreakdown({
      taxableBaseBs: Number(input.taxableBaseBs),
      exemptAmountBs: Number(input.exemptAmountBs ?? 0),
      taxRate: Number(input.taxRate),
      igtfAmountBs: Number(input.igtfAmountBs ?? 0)
    });
  } catch (error) {
    return [error instanceof Error ? error.message : 'La alícuota fiscal del documento no es válida.'];
  }
  if (Math.abs(expected.vatAmountBs - Number(input.vatAmountBs)) > tolerance) {
    issues.push('El IVA no coincide con la base imponible y la alícuota declarada; en la tasa combinada 31 % el IVA debe ser 16 % y el 15 % restante es impuesto suntuario.');
  }
  if (Math.abs(expected.additionalLuxuryTaxBs - Number(input.additionalLuxuryTaxBs ?? 0)) > tolerance) {
    issues.push('El impuesto adicional al consumo suntuario no coincide con la alícuota combinada declarada.');
  }
  if (options.requireTotal && input.totalAmountBs !== undefined) {
    const total = Number(input.totalAmountBs);
    if (!Number.isFinite(total) || Math.abs(expected.totalAmountBs - total) > tolerance) {
      issues.push('El total del documento no coincide con base imponible, exento, IVA, impuesto suntuario e IGTF.');
    }
  }
  return issues;
}

/** Valida y falla con el primer conjunto de inconsistencias fiscales. */
export function assertFiscalBreakdown(
  input: FiscalValidationInput,
  options: FiscalValidationOptions = {}
): FiscalBreakdown {
  const issues = validateFiscalBreakdown(input, options);
  if (issues.length) throw new Error(issues[0]);
  return calculateFiscalBreakdown({
    taxableBaseBs: Number(input.taxableBaseBs),
    exemptAmountBs: Number(input.exemptAmountBs ?? 0),
    taxRate: Number(input.taxRate),
    igtfAmountBs: Number(input.igtfAmountBs ?? 0)
  });
}

/** Cuenta de crédito fiscal IVA según la alícuota del documento. */
export function getInputVatAccountCode(taxRate: number | string): string {
  return Number(taxRate) === VAT_REDUCED_RATE ? VAT_INPUT_ACCOUNT_BY_RATE[VAT_REDUCED_RATE] : VAT_INPUT_ACCOUNT_BY_RATE[VAT_STANDARD_RATE];
}

/** Cuenta de débito fiscal IVA según la alícuota del documento. */
export function getOutputVatAccountCode(taxRate: number | string): string {
  return Number(taxRate) === VAT_REDUCED_RATE ? VAT_OUTPUT_ACCOUNT_BY_RATE[VAT_REDUCED_RATE] : VAT_OUTPUT_ACCOUNT_BY_RATE[VAT_STANDARD_RATE];
}

/**
 * Importe suntuario de un documento ya registrado. Conserva el importe
 * histórico cuando existe y solo deriva el 15 % para documentos anteriores al
 * campo, sin modificar el documento.
 */
export function getDocumentLuxuryTax(document: {
  taxRate: number;
  taxableBaseBs: number;
  additionalLuxuryTaxBs?: number;
}): number {
  const stored = Number(document.additionalLuxuryTaxBs);
  if (document.additionalLuxuryTaxBs != null && Number.isFinite(stored) && stored >= 0) return stored;
  if (Number(document.taxRate) !== LUXURY_COMBINED_RATE) return 0;
  return roundFiscalBs(Number(document.taxableBaseBs) * LUXURY_CONSUMPTION_RATE / 100);
}

export interface FiscalAggregateInput {
  taxRate: number;
  taxableBaseBs: number;
  exemptAmountBs?: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs?: number;
  igtfAmountBs?: number;
}

export interface FiscalAggregate {
  taxableBase16Bs: number;
  taxableBase8Bs: number;
  taxableBase31Bs: number;
  taxableBaseOtherBs: number;
  exemptAmountBs: number;
  vat16Bs: number;
  vat8Bs: number;
  vat31Bs: number;
  vatAmountBs: number;
  additionalLuxuryTaxBs: number;
  igtfAmountBs: number;
  totalBs: number;
}

const emptyAggregate = (): FiscalAggregate => ({
  taxableBase16Bs: 0, taxableBase8Bs: 0, taxableBase31Bs: 0, taxableBaseOtherBs: 0,
  exemptAmountBs: 0, vat16Bs: 0, vat8Bs: 0, vat31Bs: 0, vatAmountBs: 0,
  additionalLuxuryTaxBs: 0, igtfAmountBs: 0, totalBs: 0
});

/**
 * Agrega documentos para libros, cierres Z y declaraciones, clasificando por
 * alícuota declarada y manteniendo el IVA separado del impuesto suntuario.
 */
export function aggregateFiscalDocuments(documents: ReadonlyArray<FiscalAggregateInput>): FiscalAggregate {
  const totals = emptyAggregate();
  for (const document of documents) {
    const rates = resolveFiscalRates(document.taxRate);
    const base = Number(document.taxableBaseBs) || 0;
    const exempt = Number(document.exemptAmountBs) || 0;
    const vat = Number(document.vatAmountBs) || 0;
    const luxury = getDocumentLuxuryTax(document);
    const igtf = Number(document.igtfAmountBs) || 0;
    if (rates.declaredRate === VAT_STANDARD_RATE) { totals.taxableBase16Bs += base; totals.vat16Bs += vat; }
    else if (rates.declaredRate === VAT_REDUCED_RATE) { totals.taxableBase8Bs += base; totals.vat8Bs += vat; }
    else if (rates.combined) { totals.taxableBase31Bs += base; totals.vat31Bs += vat; }
    else totals.taxableBaseOtherBs += base;
    totals.exemptAmountBs += exempt;
    totals.additionalLuxuryTaxBs += luxury;
    totals.igtfAmountBs += igtf;
  }
  for (const key of ['taxableBase16Bs', 'taxableBase8Bs', 'taxableBase31Bs', 'taxableBaseOtherBs',
    'exemptAmountBs', 'vat16Bs', 'vat8Bs', 'vat31Bs', 'additionalLuxuryTaxBs', 'igtfAmountBs'] as const) {
    totals[key] = roundFiscalBs(totals[key]);
  }
  totals.vatAmountBs = roundFiscalBs(totals.vat16Bs + totals.vat8Bs + totals.vat31Bs);
  totals.totalBs = roundFiscalBs(
    totals.taxableBase16Bs + totals.taxableBase8Bs + totals.taxableBase31Bs + totals.taxableBaseOtherBs +
    totals.exemptAmountBs + totals.vatAmountBs + totals.additionalLuxuryTaxBs + totals.igtfAmountBs
  );
  return totals;
}

/** IVA de una línea de detalle; no admite la tasa combinada por línea. */
export function calculateLineVat(input: {
  quantity: number;
  unitPriceBs: number;
  taxRate: number;
}): { netAmountBs: number; vatRate: number; vatAmountBs: number } {
  const quantity = Number(input.quantity);
  const unitPrice = Number(input.unitPriceBs);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
    throw new Error('La cantidad y el precio unitario de la línea fiscal no son válidos.');
  }
  const rates = resolveFiscalRates(input.taxRate);
  if (rates.combined) {
    throw new Error('La tasa combinada 31 % no se aplica por línea: el IVA y el suntuario deben desglosarse a nivel de documento.');
  }
  const netAmountBs = roundFiscalBs(quantity * unitPrice);
  return {
    netAmountBs,
    vatRate: rates.vatRate,
    vatAmountBs: roundFiscalBs(netAmountBs * rates.vatRate / 100)
  };
}
