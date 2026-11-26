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

import { calculateFiscalBreakdown, roundFiscalBs } from './vatFiscalEngine';

/**
 * La tasa combinada 31% de SICOVEN representa 16% de IVA más 15%
 * de impuesto adicional al consumo suntuario. Nunca se registra el 31%
 * completo como débito fiscal IVA. Todo el desglose proviene del motor fiscal.
 */
export function calculateFiscalZTaxBreakdown(input: FiscalZTaxInput): FiscalZTaxBreakdown {
  const standard = calculateFiscalBreakdown({ taxableBaseBs: input.taxableBase16Bs, taxRate: 16 });
  const reduced = calculateFiscalBreakdown({ taxableBaseBs: input.taxableBase8Bs, taxRate: 8 });
  const combined = calculateFiscalBreakdown({ taxableBaseBs: input.taxableBase31Bs, taxRate: 31 });
  const totalSalesBs = roundFiscalBs(
    standard.totalAmountBs + reduced.totalAmountBs + combined.totalAmountBs +
    input.exemptSalesBs + input.igtfBs
  );
  return {
    vat16Bs: standard.vatAmountBs,
    vat8Bs: reduced.vatAmountBs,
    vat31Bs: combined.vatAmountBs,
    additionalLuxuryTaxBs: combined.additionalLuxuryTaxBs,
    totalSalesBs
  };
}


export type FiscalZSourceType = 'FISCAL_MACHINE' | 'POS' | 'DIGITAL';

/** Identificador idempotente por origen: no mezcla seriales fiscales con cajas o plataformas POS. */
export function buildFiscalZReferenceDoc(input: {
  sourceType: FiscalZSourceType;
  zNumber: string;
  machineSerial?: string;
  sourceSystemName?: string;
  sourceTerminalId?: string;
}): string {
  const identity = input.sourceType === 'FISCAL_MACHINE'
    ? (input.machineSerial || '').trim()
    : [input.sourceSystemName, input.sourceTerminalId].filter(Boolean).join(':').trim();
  return 'CIERRE-VENTAS:' + input.sourceType + ':' + identity.toUpperCase() + ':' + input.zNumber.trim().toUpperCase();
}
