export type TaxpayerType = 'ESPECIAL' | 'ORDINARIO';
export type AccountingFramework = 'VEN_NIF_GE' | 'VEN_NIF_PYME';
export type IvaRetentionAgentBasis = 'ARTICLE_1_SPECIAL_DESIGNATED' | 'ARTICLE_2_METALS' | 'ARTICLE_1_AND_2' | 'NOT_AGENT' | 'UNCONFIRMED';

export type AccountingCurrencyCode = 'VES' | 'USD' | 'EUR' | 'OTHER';

/**
 * Expediente de juicio profesional NIC 21. No se infiere por la tasa BCV,
 * por la moneda de caja ni por el volumen de operaciones.
 */
export interface FunctionalCurrencyAssessment {
  id: string;
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED';
  functionalCurrency: AccountingCurrencyCode;
  functionalCurrencyOther?: string;
  presentationCurrency: AccountingCurrencyCode;
  presentationCurrencyOther?: string;
  assessmentDate: string;
  effectiveDate: string;
  preparedBy: string;
  approvedBy?: string;
  approvedAt?: string;
  primaryEconomicEnvironment: string;
  salesPriceFactors: string;
  costFactors: string;
  financingFactors: string;
  operatingReceiptsFactors: string;
  professionalConclusion: string;
  evidenceReferences: string[];
}

/**
 * Evaluación de convertibilidad para una fecha y propósito concretos.
 * La evidencia y el juicio aprobado preceden cualquier conversión contable.
 */
export interface ExchangeabilityAssessment {
  id: string;
  measurementDate: string;
  purpose: string;
  currency: AccountingCurrencyCode;
  currencyOther?: string;
  amountRequired: number;
  legalMechanism: string;
  legallyAccessible: boolean;
  actuallyAccessible: boolean;
  expectedDelayDays?: number;
  amountAvailable?: number;
  accessibleSpotRate?: number;
  evidenceReferences: string[];
  conclusion: 'CONVERTIBLE' | 'NOT_CONVERTIBLE';
  estimatedSpotRate?: number;
  estimationMethod?: string;
  estimationEvidence?: string;
  preparedBy: string;
  approvedBy: string;
  approvedAt: string;
}

export type InventoryPricingMode = 'MANUAL' | 'AUTOMATIC';
export type InventoryPricingBasis = 'COST' | 'SALE';
export interface InventoryPricingConfiguration {
  mode: InventoryPricingMode;
  basis: InventoryPricingBasis;
  margins: [number, number, number, number];
  applyExchangeGap: boolean;
  exchangeRateCurrency?: 'USD' | 'EUR';
  /** Tasas en Bs. por unidad de la misma divisa (USD o EUR). */
  referenceRate?: number;
  replacementRate?: number;
}

export interface InventoryPriceLabels {
  price1: string;
  price2: string;
  price3: string;
  price4: string;
}

export interface Customer {
  id: string;
  companyId: string;
  name: string;
  fiscalId?: string;
  fiscalIdType?: 'RIF' | 'CEDULA' | 'PASSPORT' | 'OTHER';
  address?: string;
  phone?: string;
  email?: string;
  active: boolean;
}

export interface Supplier {
  id: string;
  companyId: string;
  name: string;
  fiscalId?: string;
  fiscalIdType?: 'RIF' | 'CEDULA' | 'PASSPORT' | 'OTHER';
  address?: string;
  phone?: string;
  email?: string;
  active: boolean;
}

import type { InventoryBcvHistoryEntry } from './inventoryBcvRate';

export interface AccountingBcvRateHistoryEntry {
  id: string;
  rate: number;
  effectiveDate: string;
  recordedAt: string;
  source: 'MANUAL' | 'CORRECTION' | 'LEGACY';
  note?: string;
  correctionOfId?: string;
}

export interface Company {
  id: string;
  rif: string; // e.g., "J-40892182-3"
  name: string; // Razón Social
  tradeName?: string; // Nombre Comercial
  address: string;
  phone: string;
  email: string;
  taxpayerType: TaxpayerType;
  /** Referencia y fecha de la notificación expresa del SENIAT que acredita la calificación de sujeto pasivo especial. */
  specialTaxpayerNotificationReference?: string;
  specialTaxpayerNotificationDate?: string;
  /** Marco contable expresamente adoptado; ausente en empresas históricas hasta documentar su adopción. */
  accountingFramework?: AccountingFramework;
  /** Identificador de la versión normativa realmente aplicada, no se infiere ni se autocompleta. */
  accountingFrameworkVersion?: string;
  /** Fecha documentada de adopción del marco, YYYY-MM-DD. */
  accountingFrameworkAdoptionDate?: string;
  defaultIvaRetentionRate: number; // 75 or 100
  /** Supuesto expreso de designación como agente bajo Providencia SNAT/2025/000054. Ausente = pendiente de confirmar. */
  ivaRetentionAgentBasis?: IvaRetentionAgentBasis;
  /** Para persona natural calificada como especial: debe estar constituida como firma personal (art. 1). */
  isPersonalFirm?: boolean;
  /** Configuración expresa de designación como agente de percepción IGTF. */
  isIgtfPerceptionAgent?: boolean;
  fiscalYear: number; // e.g. 2026
  bcvRate: number; // Tasa oficial BCV Bs/$
  lastRateUpdate?: string;
  /** Historial contable append-only de tasas BCV; independiente del historial del módulo Inventario. */
  accountingBcvRateHistory?: AccountingBcvRateHistoryEntry[];
  /** Tasa BCV propia del módulo Inventario; no modifica la tasa contable. */
  inventoryBcvRate?: number;
  /** Tasa EUR publicada por la misma fuente BCV; informativa para Inventario. */
  inventoryBcvEurRate?: number;
  inventoryBcvRateEffectiveDate?: string;
  inventoryBcvRateFetchedAt?: string;
  inventoryBcvRateHistory?: InventoryBcvHistoryEntry[];
  /** Último día incluido en un período contable bloqueado. */
  closedThroughDate?: string;
  /** Historial de evaluaciones NIC 21; ausencia = pendiente, nunca se asigna moneda por defecto. */
  functionalCurrencyAssessments?: FunctionalCurrencyAssessment[];
  /** Evaluaciones de convertibilidad fechadas y ligadas a un propósito concreto. */
  exchangeabilityAssessments?: ExchangeabilityAssessment[];
  /** Etiquetas comerciales configurables; los identificadores internos Precio_1..4 permanecen fijos. */
  inventoryPriceLabels?: InventoryPriceLabels;
  /** Estrategia comercial predeterminada de esta empresa; cada producto puede sobrescribirla. */
  inventoryPricingDefaults?: InventoryPricingConfiguration;
  logoUrl?: string; // URL o base64 del logo de la empresa
}

export type AccountType = 'ACTIVO' | 'PASIVO' | 'PATRIMONIO' | 'INGRESOS' | 'COSTOS' | 'GASTOS';

export type CashFlowActivity = 'EFECTIVO_EQUIVALENTE' | 'OPERACION' | 'INVERSION' | 'FINANCIACION' | 'NO_MONETARIO' | 'SIN_CLASIFICAR';
export type CashFlowIndirectTreatment =
  | 'NON_CASH_EXPENSE_ADD_BACK'
  | 'NON_CASH_INCOME_DEDUCT'
  | 'OPERATING_ASSET_INCREASE_DEDUCT'
  | 'OPERATING_LIABILITY_INCREASE_ADD'
  | 'EXCLUDE';

export interface Account {
  code: string; // e.g. "1.1.1.01"
  name: string;
  type: AccountType;
  level: number; // 1 to 5
  isMovement: boolean; // Solo las cuentas de movimiento aceptan asientos
  parentCode?: string;
  /** Las cuentas inactivas conservan el historial, pero no admiten nuevos asientos. */
  isActive?: boolean;
  /** Clasificación explícita usada por el Estado de Flujos de Efectivo; opcional para compatibilidad histórica. */
  cashFlowActivity?: CashFlowActivity;
  /** Tratamiento explícito para el método indirecto; nunca se infiere por el nombre de la cuenta. */
  cashFlowIndirectTreatment?: CashFlowIndirectTreatment;
}

export interface JournalEntryItem {
  accountCode: string;
  accountName: string;
  debitBs: number;
  creditBs: number;
  debitUsd: number;
  creditUsd: number;
  description?: string;
  /** Tasa histórica usada por esta línea cuando forma parte de una reclasificación multimoneda. */
  bcvRate?: number;
}

export type EntryType =
  | 'MANUAL'
  | 'APERTURA'
  | 'COMPRA'
  | 'VENTA'
  | 'RETENCION_IVA'
  | 'RETENCION_ISLR'
  | 'INVENTARIO'
  | 'AJUSTE'
  | 'CIERRE'
  | 'ANTICIPO_PROVEEDOR';

export interface FiscalZReportMetadata {
  date: string;
  zNumber: string;
  /** Origen del resumen; ausente en cierres históricos, interpretados como máquina fiscal. */
  sourceType?: 'FISCAL_MACHINE' | 'POS' | 'DIGITAL';
  sourceSystemName?: string;
  sourceTerminalId?: string;
  machineBrand?: string;
  machineModel?: string;
  machineSerial: string;
  invoiceStart: string;
  invoiceEnd: string;
  controlStart?: string;
  controlEnd?: string;
  taxableBase16Bs: number;
  vat16Bs: number;
  taxableBase8Bs: number;
  vat8Bs: number;
  taxableBase31Bs: number;
  vat31Bs: number;
  additionalLuxuryTaxBs: number;
  exemptSalesBs: number;
  igtfBs: number;
  totalSalesBs: number;
  payments: Array<{ method: string; amountBs: number; accountCode: string }>;
  observations?: string;
  supportRequired: false;
}

export interface JournalEntry {
  id: string;
  companyId: string;
  entryNumber: number;
  date: string; // YYYY-MM-DD
  description: string;
  type: EntryType;
  bcvRate: number;
  items: JournalEntryItem[];
  isAdjusted?: boolean;
  referenceDoc?: string;
  createdAt: string;
  /** Enlace de auditoría para contra-asientos inmutables. */
  reversalOfEntryId?: string;
  reversedByEntryId?: string;
  reversalReason?: string;
  workpaperNote?: string;
  priorPeriodAdjustment?: boolean;
  /** Estado de la empresa inmediatamente anterior al cierre anual; evidencia para reapertura formal. */
  annualCloseState?: {
    previousFiscalYear: number;
    previousClosedThroughDate: string | null;
    cycleNumber: number;
  };
  /** Asiento origen de un ajuste manual; no modifica el asiento fuente. */
  adjustmentForEntryId?: string;
  adjustmentReason?: string;
  /** Vínculo inmutable entre el ejercicio cerrado y el ejercicio que inicia con esta apertura. */
  fiscalZReport?: FiscalZReportMetadata;
  exerciseLink?: {
    priorPeriodStartDate: string;
    priorPeriodEndDate: string;
    nextPeriodStartDate: string;
  };
}

export interface PurchaseInventoryLine {
  productId: string;
  quantity: number;
  unitCostBs: number;
}

export interface PurchaseCreditNoteLine {
  productId: string;
  originalMovementId: string;
  movementId: string;
  quantity: number;
  unitCostBs: number;
  inventoryCostBs: number;
}

export interface PurchaseIvaRetentionSnapshot { portalArticle3ExclusionConfirmed?: boolean; supplierImportPerceptionConfirmed?: boolean; operationAmountBs?: number; unitTaxValueBs?: number; vatNotDiscriminated?: boolean; taxableAmountIncludingVatBs?: number; buyerAgentStatus: 'SPECIAL_DESIGNATED' | 'ARTICLE_2_BUYER' | 'SPECIAL_DESIGNATED_AND_ARTICLE_2' | 'NOT_AGENT' | 'UNKNOWN'; supplierTaxStatus: 'ORDINARY' | 'FORMAL' | 'SPECIAL' | 'NON_REGISTERED' | 'UNKNOWN'; article2Transaction: boolean; article3Exclusions: string[]; invoiceFormalDefect: boolean; portalRetentionRate?: 0 | 75 | 100; decisionStatus: 'NOT_APPLICABLE' | 'EXCLUDED' | 'REVIEW' | 'NO_VAT' | 'WITHHOLD'; decisionReason: string; legalBasis?: string; evaluatedAt: string; }

export interface SupplierDebitNoteReview {
  economicCause: 'PRICE_DIFFERENCE' | 'ADDITIONAL_EXPENSE' | 'FINANCING_CHARGE' | 'ADDITIONAL_GOODS_RECEIVED' | 'INVENTORY_COST_ADJUSTMENT' | 'OTHER';
  reason: string;
  classificationNote?: string;
  debitAccountCode: string;
  payableAccountCode: string;
  vatAccountCode?: string;
  vatBreakdownReviewed: boolean;
  withholdingNotApplicableConfirmed: boolean;
  igtfNotApplicableConfirmed: boolean;
  fiscalReviewNote: string;
}

export interface PurchaseRecord {
  /** Líneas de mercancía vinculadas al Kardex; ausente en facturas históricas sin detalle. */
  inventoryLines?: PurchaseInventoryLine[];
  /** Cuenta explícita de débito para compras no inventariables; nunca se infiere por defecto. */
  purchaseDebitAccountCode?: string;
  /** Revisión profesional inmutable y trazable que autoriza el plan contable preliminar de una ND. */
  supplierDebitNoteReview?: SupplierDebitNoteReview;
  /** Enlace inmutable de una nota de crédito de proveedor a su factura y movimientos físicos. */
  originalPurchaseId?: string;
  affectedInvoiceDate?: string;
  affectedInvoiceControlNumber?: string;
  affectedInvoiceTotalAmountBs?: number;
  affectedInvoiceTotalAmountUsd?: number;
  fiscalEmissionMedium?: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal?: boolean;
  creditNoteLines?: PurchaseCreditNoteLine[];
  netPayableReductionBs?: number;
  netPayableReductionUsd?: number;
  /** Excedente de nota de crédito contabilizado como anticipo/saldo a favor del proveedor. */
  supplierAdvanceBs?: number;
  supplierAdvanceUsd?: number;
  id: string;
  companyId: string;
  opNumber: number;
  invoiceDate: string; // YYYY-MM-DD, fecha original del documento
  /** Fecha efectiva en que se reconoce/abona en cuenta el pasivo; ausente solo en históricos legacy. */
  accountCreditDate?: string; // YYYY-MM-DD
  supplierRif: string; // e.g. "J-12345678-9"
  supplierName: string;
  supplierAddress?: string;
  /** Correo declarado del proveedor; opcional para compatibilidad con compras históricas. */
  supplierEmail?: string;
  supplierTaxStatus?: 'ORDINARY' | 'FORMAL' | 'SPECIAL' | 'NON_REGISTERED' | 'UNKNOWN';
  ivaRetentionDecision?: PurchaseIvaRetentionSnapshot;
  invoiceNumber: string;
  controlNumber: string;
  debitNoteNumber?: string;
  creditNoteNumber?: string;
  affectedInvoiceNumber?: string; // Para NC o ND
  documentType: '01' | '02' | '03'; // 01=Factura, 02=Nota Debito, 03=Nota Credito
  totalAmountBs: number;
  exemptAmountBs: number;
  taxableBaseBs: number;
  taxRate: number; // e.g., 16, 8, 31, 0
  vatAmountBs: number;
  /** Impuesto adicional al consumo suntuario 15%; no integra el crédito fiscal IVA. */
  additionalLuxuryTaxBs?: number;
  additionalLuxuryTaxUsd?: number;
  /** Destino del crédito fiscal: gravado, exento o común sujeto a prorrata. */
  vatCreditTreatment?: 'TAXABLE' | 'EXEMPT' | 'COMMON';
  retentionRate: number; // 0, 75, 100
  vatWithheldBs: number;
  // ISLR opcional
  islrConceptCode?: string;
  islrConceptName?: string;
  islrRate?: number;
  islrSubtrahendBs?: number;
  islrWithheldBs?: number;
  /** Clasificación fiscal declarada/seleccionada; no inferirla del prefijo RIF. */
  islrBeneficiaryType?: 'PN' | 'PJ';
  islrResidency?: 'RESIDENT' | 'NON_RESIDENT' | 'DOMICILED' | 'NON_DOMICILED';
  islrBasePercentage?: number;
  islrUnitTaxValueBs?: number;
  islrFormulaFactor?: number;
  // Moneda extranjera
  bcvRate: number;
  totalAmountUsd: number;
  taxableBaseUsd: number;
  /** Equivalente USD histórico del monto exento, cuando el documento lo conserva. */
  exemptAmountUsd?: number;
  vatAmountUsd: number;
  vatWithheldUsd: number;
  islrWithheldUsd?: number;
  journalEntryId?: string;
  voucherNumber?: string; // Formato SENIAT: AAAAMMDDDDDDDD (14 caracteres)
  notes?: string;
  /** Cuenta contable de origen utilizada en compras pagadas al contado. */
  paymentAccountCode?: string;
  /** Referencia del comprobante/soporte del desembolso de contado. */
  paymentReference?: string;
  /** Medio declarado de pago; se conserva para auditoría de IGTF. */
  paymentMethod?: 'BS' | 'FOREIGN_CASH' | 'ZELLE' | 'INTERNATIONAL_TRANSFER' | 'CRYPTO';
  igtfApplicable?: boolean;
  igtfRate?: number;
  igtfAmountBs?: number;
  igtfAmountUsd?: number;
  // Condiciones comerciales y fiscales del crédito (se preservan por documento)
  paymentTerm?: 'CONTADO' | 'CREDITO';
  creditDays?: number;
  dueDate?: string; // YYYY-MM-DD
  currencyPricingMode?: 'USD_FIJO' | 'BS_AJUSTABLE' | 'REVISION_MANUAL';
  fiscalAdjustmentMode?: 'IVA_ORIGINAL_DIF_CAMBIARIA' | 'AJUSTE_BASE_IVA' | 'REVISION_CONTADOR';
  isCancelled?: boolean;
  cancelledByJournalEntryId?: string;
  cancellationReason?: string;
  cancellationNote?: string;
}

export interface SaleInventoryLine {
  productId: string;
  productCode: string;
  productName: string;
  quantity: number;
  unitPriceBs: number;
  unitPriceUsd?: number;
  /** Nivel comercial elegido en el documento, cuando se origina desde catálogo. */
  priceLevel?: 1 | 2 | 3 | 4;
  priceCurrency?: 'USD' | 'BS';
  priceValue?: number;
  /** Tasa de referencia conservada al fijar el precio del renglón. */
  priceBcvRate?: number;
  netAmountBs: number;
  taxRate: number;
  vatAmountBs: number;
  exemptAmountBs: number;
  totalBs: number;
}

export interface SaleRecord {
  /** Detalle comercial histórico importado; sus salidas de Kardex se conservan como movimientos enlazados por factura. */
  inventoryLines?: SaleInventoryLine[];
  id: string;
  companyId: string;
  opNumber: number;
  invoiceDate: string; // YYYY-MM-DD
  customerRif: string;
  customerName: string;
  customerAddress?: string;
  invoiceNumber: string;
  controlNumber: string;
  debitNoteNumber?: string;
  creditNoteNumber?: string;
  affectedInvoiceNumber?: string;
  documentType: '01' | '02' | '03';
  totalAmountBs: number;
  exemptAmountBs: number;
  taxableBaseBs: number;
  taxRate: number; // 16, 8, 31, 0
  vatAmountBs: number;
  /** Componente adicional del 15% al consumo suntuario cuando la tasa combinada es 31%; no es IVA. */
  additionalLuxuryTaxBs?: number;
  additionalLuxuryTaxUsd?: number;
  vatWithheldBs: number; // Retenido por cliente si es contribuyente especial
  retentionRate?: number;
  retentionVoucherNumber?: string;
  retentionVoucherDate?: string; // Fecha del comprobante de retención recibido
  igtfApplicable?: boolean;
  igtfRate?: number;
  igtfAmountBs?: number;
  igtfAmountUsd?: number;
  paymentCurrency?: 'BS' | 'FOREIGN_CASH' | 'FOREIGN_TRANSFER' | 'CRYPTO';
  bcvRate: number;
  totalAmountUsd: number;
  taxableBaseUsd: number;
  vatAmountUsd: number;
  vatWithheldUsd: number;
  journalEntryId?: string;
  /** Vínculo append-only de NC/ND de cliente con la factura que corrige. */
  originalSaleId?: string;
  /** Cantidades acumulables de devolución física por producto en cada NC. */
  returnedInventoryQuantities?: Record<string, number>;
  affectedInvoiceDate?: string;
  affectedInvoiceControlNumber?: string;
  affectedInvoiceTotalAmountBs?: number;
  affectedInvoiceTotalAmountUsd?: number;
  fiscalEmissionMedium?: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY';
  sameMediumAsOriginal?: boolean;
  netReceivableAdjustmentBs?: number;
  netReceivableAdjustmentUsd?: number;
  exemptAmountUsd?: number;
  correctionReason?: string;
  correctionWorkpaper?: string;
  notes?: string;
  // Condiciones comerciales y fiscales del crédito (se preservan por documento)
  paymentTerm?: 'CONTADO' | 'CREDITO';
  creditDays?: number;
  dueDate?: string; // YYYY-MM-DD
  currencyPricingMode?: 'USD_FIJO' | 'BS_AJUSTABLE' | 'REVISION_MANUAL';
  fiscalAdjustmentMode?: 'IVA_ORIGINAL_DIF_CAMBIARIA' | 'AJUSTE_BASE_IVA' | 'REVISION_CONTADOR';
  isCancelled?: boolean;
  cancelledByJournalEntryId?: string;
  cancellationReason?: string;
  cancellationNote?: string;
}

export type InventoryCostingMethod = 'PROMEDIO_PONDERADO' | 'PEPS';
export type InventoryVatTreatment = 'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO';
export type InventoryItemType = 'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO';

export interface InventoryBomComponent {
  productId: string;
  quantityPerUnit: number;
}

export interface InventoryProduct {
  id: string;
  companyId: string;
  code: string;
  name: string;
  category: string;
  unit: string; // Unid, Kg, Mts, Caja, etc.
  minStock: number;
  currentStock: number;
  avgCostBs: number;
  avgCostUsd: number;
  lastCostBs: number;
  lastCostUsd: number;
  /** Niveles comerciales normalizados; los niveles no usados permanecen null. */
  price1?: number;
  price2?: number | null;
  price3?: number | null;
  price4?: number | null;
  /** Moneda única de referencia para los cuatro niveles comerciales. */
  priceCurrency?: 'USD' | 'BS';
  /** Regla comercial propia del artículo; si falta, hereda la configuración de la empresa. */
  pricingConfiguration?: InventoryPricingConfiguration;
  /** Campos de compatibilidad histórica; no son la fuente maestra de los niveles. */
  salesPriceBs: number;
  salesPriceUsd: number;
  /** Margen bruto objetivo utilizado para sugerir el precio; no altera el costo contable. */
  targetMarginPercent?: number;
  /** Cuenta de movimiento asociada al valor del inventario. */
  inventoryAccountCode?: string;
  /** Cuenta de costo de ventas o consumo asociada al artículo. */
  costOfSalesAccountCode?: string;
  /** Cuenta para mermas, faltantes, sobrantes y ajustes. */
  adjustmentAccountCode?: string;
  openingBalanceAccountCode?: string;
  costingMethod?: InventoryCostingMethod;
  vatTreatment?: InventoryVatTreatment;
  itemType?: InventoryItemType;
  openingDate?: string;
  openingBcvRate?: number;
  vnrProvisionBs?: number;
  vnrEstimatedSellingPriceBs?: number;
  vnrCompletionCostBs?: number;
  vnrSellingCostBs?: number;
  vnrLastTestDate?: string;
  bomComponents?: InventoryBomComponent[];
}

export type InventoryMovementImportDraft =
  Pick<InventoryMovement, 'productId' | 'date' | 'type' | 'concept' | 'documentRef' | 'quantity' | 'unitCostBs'> &
  { expectedBalanceQty?: number } &
  Partial<Omit<InventoryMovement, 'id' | 'companyId' | 'productId' | 'date' | 'type' | 'concept' | 'documentRef' | 'quantity' | 'unitCostBs'>>;

export interface InventoryMovement {
  id: string;
  companyId: string;
  productId: string;
  productName: string;
  productCode: string;
  date: string;
  type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
  concept: string; // 'COMPRA' | 'VENTA' | 'INVENTARIO_INICIAL' | 'MERMA' | 'AJUSTE'
  documentRef: string;
  quantity: number;
  unitCostBs: number;
  unitCostUsd: number;
  totalCostBs: number;
  totalCostUsd: number;
  balanceQty: number;
  balanceTotalBs: number;
  balanceTotalUsd: number;
  journalEntryId?: string;
  /** Enlace explícito entre una corrección/devolución y el movimiento original del Kardex. */
  correctionForMovementId?: string;
  /** Tasa BCV aplicable a la fecha del movimiento, conservada como dato histórico. */
  bcvRate?: number;
  documentType?: string;
  counterpartyRif?: string;
  counterpartyName?: string;
  warehouseId?: string;
  /** Costo unitario aplicado por el método del artículo, distinto del costo digitado. */
  costingMethod?: InventoryCostingMethod;
  /** Fletes y gastos de importación asignados a esta entrada, en Bs. */
  additionalLandedCostsBs?: number;
}

export interface VatRetentionVoucher {
  id: string;
  companyId: string;
  voucherNumber: string; // 14 dígitos: YYYYMM + 8 dígitos correlativo
  date: string; // Fecha de emisión del comprobante
  deliveryDate?: string; // Fecha efectiva de entrega al proveedor
  deliveryMethod?: 'PHYSICAL' | 'ELECTRONIC';
  electronicDeliveryAgreed?: boolean;
  period: string; // YYYYMM del evento fiscal de retención
  /** Disparador fiscal inmutable: pago efectivo o abono en cuenta. Ausente en comprobantes históricos. */
  fiscalTrigger?: 'PAYMENT' | 'ACCOUNT_CREDIT';
  /** Fecha efectiva del evento fiscal; ausente en comprobantes históricos legacy. */
  fiscalDate?: string;
  /** Referencia del pago cuando el disparador fue PAYMENT. */
  paymentReference?: string;
  /** Identidad del agente al emitir el comprobante; evita que una reimpresión cambie con el perfil actual. */
  agentNameSnapshot?: string;
  agentRifSnapshot?: string;
  agentAddressSnapshot?: string;
  supplierEmailSnapshot?: string;
  supplierRif: string;
  supplierName: string;
  supplierAddress: string;
  purchaseRecordId: string;
  invoiceDate: string;
  invoiceNumber: string;
  controlNumber: string;
  totalAmountBs: number;
  exemptAmountBs: number;
  taxableBaseBs: number;
  taxRate: number;
  vatAmountBs: number;
  retentionRate: number; // 75 or 100
  vatWithheldBs: number;
  bcvRate: number;
  totalAmountUsd: number;
  vatWithheldUsd: number;
  /** No borrar el comprobante: requiere conciliación/rectificación fiscal posterior a una reversión. */
  requiresFiscalCorrection?: boolean;
  correctionEntryId?: string;
  /** Todos los asientos correctivos asociados al comprobante; correctionEntryId conserva el último para compatibilidad. */
  correctionEntryIds?: string[];
  correctionNote?: string;
}


export type VatDeclarationWindow = 'FIRST_HALF' | 'SECOND_HALF';

export interface VatDeclarationVoucherSnapshot {
  voucherId: string;
  voucherNumber: string;
  supplierRif: string;
  supplierName: string;
  fiscalDate: string;
  dateBasis: 'FISCAL_EVENT' | 'MANUALLY_VERIFIED_LEGACY_DATE' | 'LEGACY_DOCUMENT_DATE';
  dateVerificationNote?: string;
  taxableBaseBs: number;
  vatAmountBs: number;
  vatWithheldBs: number;
  /** Equivalente USD histórico del pasivo retenido al emitir el comprobante. */
  vatWithheldUsd?: number;
  /** Tasa BCV histórica del comprobante. */
  bcvRate?: number;
  requiresFiscalCorrection: boolean;
}

export interface VatLegacyFiscalDateAssignment {
  voucherId: string;
  confirmedFiscalDate: string;
  note: string;
}

export interface VatWithholdingDeclaration {
  id: string;
  companyId: string;
  period: string; // YYYYMM
  window: VatDeclarationWindow;
  startDate: string;
  endDate: string;
  zeroOperations: boolean;
  voucherIds: string[];
  voucherSnapshots: VatDeclarationVoucherSnapshot[];
  legacyDateAssignments: VatLegacyFiscalDateAssignment[];
  totalTaxableBaseBs: number;
  totalVatAmountBs: number;
  totalWithheldBs: number;
  /** Base USD histórica; ausente en declaraciones antiguas no reconstruibles. */
  totalWithheldUsd?: number;
  createdAt: string;
  createdBy?: string;
}

export type VatWithholdingDeclarationEventType = 'REVIEWED' | 'FILED' | 'PAYMENT' | 'DUE_DATE_SET';

export interface VatWithholdingDeclarationEvent {
  id: string;
  declarationId: string;
  eventType: VatWithholdingDeclarationEventType;
  occurredAt: string;
  recordedAt: string;
  actor?: string;
  note?: string;
  acknowledgedLegacyDates?: boolean;
  declarationNumber?: string;
  receiptReference?: string;
  amountBs?: number;
  paymentReference?: string;
  /** Movimientos bancarios reales que respaldan este enteramiento; ausente en pagos históricos. */
  bankStatementMovementIds?: string[];
  /** Asiento que cancela este pago fiscal; ausente en pagos históricos. */
  journalEntryId?: string;
  evidenceReference?: string;
  dueDate?: string;
  officialSourceTitle?: string;
  officialSourceUrl?: string;
  officialReference?: string;
}

export interface IslrConcept {
  code: string; // e.g. "001", "002"
  description: string;
  category: 'PN' | 'PJ';
  isResident: boolean;
  rate: number; // porcentaje ej 3% o 5%
  appliesSubtrahend: boolean;
  /** Porcentaje de la base de la operación sujeto a retención. */
  basePercentage: number;
  minBaseUt?: number;
}

export interface IslrRetentionVoucher {
  id: string;
  companyId: string;
  voucherNumber: string; // Formato oficial
  date: string;
  period: string; // YYYYMM
  supplierRif: string;
  supplierName: string;
  supplierAddress: string;
  isPersonNatural: boolean;
  isResident: boolean;
  conceptCode: string;
  conceptDescription: string;
  invoiceNumber: string;
  controlNumber: string;
  invoiceDate: string;
  baseAmountBs: number;
  retentionRate: number;
  subtrahendBs: number;
  withheldAmountBs: number;
  bcvRate: number;
  baseAmountUsd: number;
  withheldAmountUsd: number;
  /** Parámetros históricos de cálculo usados al emitir el comprobante. */
  unitTaxValueBs?: number;
  formulaFactor?: number;
  basePercentage?: number;
  requiresFiscalCorrection?: boolean;
  correctionEntryId?: string;
  /** Todos los asientos correctivos asociados al comprobante; correctionEntryId conserva el último para compatibilidad. */
  correctionEntryIds?: string[];
  correctionNote?: string;
  /** Instantánea fiscal del emisor y del proveedor al emitir; ausente en comprobantes históricos. */
  agentNameSnapshot?: string;
  agentRifSnapshot?: string;
  agentAddressSnapshot?: string;
  supplierEmailSnapshot?: string;
  /** Registro de entrega inmutable; ausente en comprobantes históricos. */
  deliveryDate?: string;
  deliveryMethod?: 'PHYSICAL' | 'ELECTRONIC';
  electronicDeliveryAgreed?: boolean;
}

export interface BankAccount {
  id: string;
  companyId: string;
  accountCode: string; // e.g. "1.1.1.03"
  bankName: string; // e.g. "Banco Nacional de Crédito (BNC)"
  accountNumber: string; // 20 dígitos estándar venezolano
  currency: 'BS' | 'USD';
  initialBalanceBs: number;
  initialBalanceUsd: number;
  accountType?: 'CORRIENTE' | 'AHORRO';
  checkbookNumber?: string;
  accountHolderName?: string;
  accountHolderRif?: string;
}

export type BankMovementType = 'DEBIT' | 'CREDIT';

export interface BankStatementMovement {
  id: string;
  companyId: string;
  bankAccountId: string;
  date: string; // YYYY-MM-DD
  reference: string; // Número de transferencia, cheque, débito
  description: string;
  type: BankMovementType; // DEBIT: cargo/salida en banco; CREDIT: abono/depósito en banco
  amountBs: number;
  amountUsd: number;
  /** Tasa BCV histórica utilizada para convertir este movimiento. */
  bcvRate?: number;
  bcvRateEffectiveDate?: string;
  isReconciled: boolean;
  reconciledWithJournalEntryId?: string;
  /** IDs de asientos que alguna vez se vincularon a esta línea; historial no removible. */
  reconciledJournalEntryIds?: string[];
  matchedBy?: 'AUTO_REF' | 'AUTO_AMOUNT' | 'MANUAL';
  reconciledAt?: string;
  notes?: string;
}

export interface BankReconciliationRecord {
  id: string;
  companyId: string;
  bankAccountId: string;
  cutoffDate: string;
  bankStatementBalanceBs: number;
  bankStatementBalanceUsd: number;
  bookBalanceBs: number;
  bookBalanceUsd: number;
  depositsInTransitBs: number;
  checksInTransitBs: number;
  bankDebitsNotInBooksBs: number;
  bankCreditsNotInBooksBs: number;
  adjustedBankBalanceBs: number;
  adjustedBookBalanceBs: number;
  differenceBs: number;
  isBalanced: boolean;
  notes?: string;
  createdAt: string;
}


/** Fecha fiscal/contable del abono en cuenta; los registros históricos conservan invoiceDate como fallback. */
export function getPurchaseAccountCreditDate(purchase: Pick<PurchaseRecord, 'invoiceDate' | 'accountCreditDate'>): string {
  return purchase.accountCreditDate || purchase.invoiceDate;
}
