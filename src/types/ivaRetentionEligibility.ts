/**
 * Motor puro de elegibilidad de retenciones IVA — Providencia SNAT/2025/000054.
 * No consulta servicios externos ni persiste datos. Las verificaciones del Portal
 * Fiscal se reciben como resultado explícito; nunca se presumen.
 */
export type IvaBuyerAgentStatus = 'SPECIAL_DESIGNATED' | 'ARTICLE_2_BUYER' | 'NOT_AGENT' | 'UNKNOWN';
export type IvaSupplierTaxStatus = 'ORDINARY' | 'FORMAL' | 'SPECIAL' | 'NON_REGISTERED' | 'UNKNOWN';
export type IvaArticle3Exclusion =
  | 'NOT_SUBJECT_EXEMPT_EXONERATED' | 'FORMAL_SUPPLIER'
  | 'PERCEPTION_AGENT_SPECIFIC_GOODS' | 'IMPORT_PERCEPTION_CREDIT'
  | 'EMPLOYEE_TRAVEL_EXPENSE' | 'REIMBURSABLE_UP_TO_20_UT'
  | 'PETTY_CASH_UP_TO_20_UT' | 'DOMICILIARY_UTILITIES'
  | 'EXPORTER_RECOVERY_REGISTER' | 'SUPPLIER_EXEMPT_SALES_OVER_50'
  | 'SPECIAL_PUBLIC_PURCHASER' | 'SPECIAL_NONBUSINESS_PUBLIC_ENTITY'
  | 'COT_ARTICLE_146';

export interface IvaRetentionEligibilityInput {
  buyerAgentStatus: IvaBuyerAgentStatus;
  supplierTaxStatus: IvaSupplierTaxStatus;
  article2Transaction?: boolean;
  article3Exclusions?: IvaArticle3Exclusion[];
  vatAmount?: number;
  /** Importe gravado con IVA incluido, para reconstruir el impuesto. */
  taxableAmountIncludingVat?: number;
  taxRate?: number;
  vatNotDiscriminated?: boolean;
  invoiceFormalDefect?: boolean;
  /** Resultado expreso de consulta del Portal Fiscal. */
  portalRetentionRate?: 0 | 75 | 100 | null;
}
export type IvaRetentionDecisionStatus = 'NOT_APPLICABLE' | 'EXCLUDED' | 'REVIEW' | 'NO_VAT' | 'WITHHOLD';
export interface IvaRetentionEligibilityResult {
  status: IvaRetentionDecisionStatus;
  retentionRate: 0 | 75 | 100;
  vatAmount: number | null;
  withheldAmount: number;
  reason: string;
  legalBasis?: string;
}
const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
function decision(status: IvaRetentionDecisionStatus, rate: 0 | 75 | 100, vat: number | null, reason: string, legalBasis?: string): IvaRetentionEligibilityResult {
  return { status, retentionRate: rate, vatAmount: vat, withheldAmount: vat == null ? 0 : roundMoney(vat * rate / 100), reason, ...(legalBasis ? { legalBasis } : {}) };
}
function resolveVat(input: IvaRetentionEligibilityInput): number | null {
  if (!input.vatNotDiscriminated && input.vatAmount != null) {
    const amount = Number(input.vatAmount);
    return Number.isFinite(amount) && amount >= 0 ? roundMoney(amount) : null;
  }
  const gross = Number(input.taxableAmountIncludingVat);
  const rate = Number(input.taxRate);
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(rate) || rate <= 0 || rate > 100) return null;
  return roundMoney(gross - gross / (1 + rate / 100));
}
export function evaluateIvaRetentionEligibility(input: IvaRetentionEligibilityInput): IvaRetentionEligibilityResult {
  if (input.buyerAgentStatus === 'UNKNOWN') return decision('REVIEW', 0, null, 'Confirma la condición del comprador como agente de retención.');
  if (input.buyerAgentStatus === 'NOT_AGENT') return decision('NOT_APPLICABLE', 0, null, 'El comprador no está identificado como agente de retención para este régimen.');
  const article2Applies = input.buyerAgentStatus === 'ARTICLE_2_BUYER' && input.article2Transaction === true;
  if (input.buyerAgentStatus === 'ARTICLE_2_BUYER' && !article2Applies) return decision('NOT_APPLICABLE', 0, null, 'La operación no corresponde a la actividad de adquisición prevista en el artículo 2.');
  if (input.buyerAgentStatus === 'SPECIAL_DESIGNATED' && input.supplierTaxStatus === 'SPECIAL') return decision('NOT_APPLICABLE', 0, null, 'El artículo 1 contempla retenciones a proveedores contribuyentes ordinarios.');
  if ((input.article3Exclusions || []).length > 0 || input.supplierTaxStatus === 'FORMAL') {
    return decision('EXCLUDED', 0, null, input.supplierTaxStatus === 'FORMAL' ? 'El proveedor está clasificado como contribuyente formal.' : 'La operación está comprendida en una exclusión del artículo 3.', 'Providencia SNAT/2025/000054, artículo 3');
  }
  if (!article2Applies && input.supplierTaxStatus === 'UNKNOWN') return decision('REVIEW', 0, null, 'Confirma la clasificación fiscal del proveedor para determinar si corresponde retener.');
  if (!article2Applies && input.supplierTaxStatus === 'SPECIAL') return decision('NOT_APPLICABLE', 0, null, 'El proveedor no reúne el supuesto de proveedor ordinario previsto en el artículo 1.');
  if (!article2Applies && input.supplierTaxStatus === 'NON_REGISTERED' && input.portalRetentionRate !== 100) return decision('REVIEW', 0, null, 'Verifica en el Portal Fiscal si corresponde la retención del 100%.');
  const vat = resolveVat(input);
  if (vat == null) return decision('REVIEW', 0, null, 'No hay información suficiente para determinar el IVA causado de la operación.');
  if (vat === 0) return decision('NO_VAT', 0, 0, 'La operación no presenta IVA causado sujeto a retención.');
  if (input.vatNotDiscriminated || input.invoiceFormalDefect) {
    const noVatSeparated = Boolean(input.vatNotDiscriminated);
    return decision('WITHHOLD', 100, vat,
      noVatSeparated ? 'La factura no discrimina el IVA y se determina la retención del 100%.' : 'La factura o nota de débito incumple las formalidades exigidas y se determina la retención del 100%.',
      noVatSeparated ? 'Providencia SNAT/2025/000054, artículo 5, numeral 1' : 'Providencia SNAT/2025/000054, artículo 5, numeral 2');
  }
  if (article2Applies) return decision('WITHHOLD', 100, vat, 'Adquisición comprendida en el supuesto especial del artículo 2.', 'Providencia SNAT/2025/000054, artículos 2 y 5');
  if (input.portalRetentionRate === 100) return decision('WITHHOLD', 100, vat, 'La consulta del Portal Fiscal determina retención del 100%.', 'Providencia SNAT/2025/000054, artículo 5, numeral 3');
  if (input.supplierTaxStatus === 'NON_REGISTERED') return decision('WITHHOLD', 100, vat, 'El Portal Fiscal confirmó que el proveedor no está inscrito en el RIF.', 'Providencia SNAT/2025/000054, artículo 5, numeral 3');
  return decision('WITHHOLD', 75, vat, 'Se aplica la regla general de retención del 75%.', 'Providencia SNAT/2025/000054, artículo 4');
}
