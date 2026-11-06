export interface FiscalZTaxInput {
  taxableBase16Bs: number;
  taxableBase8Bs: number;
  taxableBase31Bs: number;
  exemptSalesBs: number;
  igtfBs: number;
}

export interface FiscalZTaxBreakdown {
  vat16Bs: number;
  vat8Bs: number;
  vat31Bs: number;
  additionalLuxuryTaxBs: number;
  totalSalesBs: number;
}

const roundBs = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/**
 * La tasa combinada 31% de SICOVEN representa 16% de IVA más 15%
 * de impuesto adicional al consumo suntuario. Nunca se registra el 31%
 * completo como débito fiscal IVA.
 */
export function calculateFiscalZTaxBreakdown(input: FiscalZTaxInput): FiscalZTaxBreakdown {
  const vat16Bs = roundBs(input.taxableBase16Bs * 0.16);
  const vat8Bs = roundBs(input.taxableBase8Bs * 0.08);
  const vat31Bs = roundBs(input.taxableBase31Bs * 0.16);
  const additionalLuxuryTaxBs = roundBs(input.taxableBase31Bs * 0.15);
  const totalSalesBs = roundBs(
    input.taxableBase16Bs + input.taxableBase8Bs + input.taxableBase31Bs +
    input.exemptSalesBs + vat16Bs + vat8Bs + vat31Bs + additionalLuxuryTaxBs + input.igtfBs
  );
  return { vat16Bs, vat8Bs, vat31Bs, additionalLuxuryTaxBs, totalSalesBs };
}
