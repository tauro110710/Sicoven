import type { JournalEntry, JournalEntryItem, PurchaseRecord, SaleRecord } from './accounting';

export type VatOwnDeclarationStatus = 'DRAFT' | 'FILED';

export type VatOwnPurchaseCreditTreatment = 'TAXABLE' | 'EXEMPT' | 'COMMON';

export function resolveVatOwnPurchaseCreditTreatment(
  treatment?: VatOwnPurchaseCreditTreatment
): VatOwnPurchaseCreditTreatment {
  return treatment || 'COMMON';
}

export function getUnfiledVatOwnActivityPeriods(input: {
  companyId: string;
  targetPeriod: string;
  activityDates: readonly string[];
  declarations: readonly VatOwnDeclaration[];
}): string[] {
  if (!isValidVatOwnDeclarationPeriod(input.targetPeriod)) {
    throw new Error('El período objetivo de IVA no es válido.');
  }
  const isCalendarDate = (value: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  const filedPeriods = new Set(input.declarations
    .filter(item => item.companyId === input.companyId && item.status === 'FILED' && item.period < input.targetPeriod)
    .map(item => item.period));
  const knownPeriods = new Set<string>(input.declarations
    .filter(item => item.companyId === input.companyId && item.period < input.targetPeriod)
    .map(item => item.period));
  for (const dateValue of input.activityDates) {
    const date = String(dateValue || '');
    if (!isCalendarDate(date)) {
      throw new Error('Existe una fecha fiscal inválida que impide verificar la continuidad de las declaraciones de IVA.');
    }
    const period = date.slice(0, 7);
    if (period < input.targetPeriod) knownPeriods.add(period);
  }
  if (knownPeriods.size === 0) return [];
  let cursor = [...knownPeriods].sort()[0];
  const missing: string[] = [];
  while (cursor < input.targetPeriod) {
    if (!filedPeriods.has(cursor)) missing.push(cursor);
    const [year, month] = cursor.split('-').map(Number);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    cursor = String(nextYear).padStart(4, '0') + '-' + String(nextMonth).padStart(2, '0');
  }
  return missing;
}

export function getVatOwnFiledLaterPeriods(input: {
  companyId: string;
  targetPeriod: string;
  declarations: readonly VatOwnDeclaration[];
}): string[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.targetPeriod)) {
    throw new Error('El período objetivo de IVA no es válido.');
  }
  return [...new Set(input.declarations
    .filter(item => item.companyId === input.companyId && item.status === 'FILED' && item.period > input.targetPeriod)
    .map(item => item.period))].sort();
}

export function areVatOwnDeclarationSourcesCurrent(
  declarationSourceIds: readonly string[],
  currentSourceIds: readonly string[]
): boolean {
  if (declarationSourceIds.length !== currentSourceIds.length) return false;
  const saved = [...declarationSourceIds].sort();
  const current = [...currentSourceIds].sort();
  return saved.every((id, index) => id === current[index]);
}

export function areVatOwnSourceSnapshotsCurrent(
  saved: Record<string, string> | undefined,
  current: Record<string, string>
): boolean {
  if (!saved) return false;
  const savedIds = Object.keys(saved).sort();
  const currentIds = Object.keys(current).sort();
  if (savedIds.length !== currentIds.length || !savedIds.every((id, index) => id === currentIds[index])) return false;
  return savedIds.every(id => typeof saved[id] === 'string' && saved[id] === current[id]);
}

export function buildVatOwnSourceSnapshots(input: {
  companyId: string;
  sourceIds: readonly string[];
  sales: readonly SaleRecord[];
  purchases: readonly PurchaseRecord[];
  journalEntries: readonly JournalEntry[];
}): Record<string, string> {
  const snapshots: Record<string, string> = {};
  const journalSnapshot = (entry: JournalEntry | undefined) => entry ? {
    id: entry.id, entryNumber: entry.entryNumber, date: entry.date, referenceDoc: entry.referenceDoc, type: entry.type,
    bcvRate: entry.bcvRate, description: entry.description,
    reversalOfEntryId: entry.reversalOfEntryId || null, reversedByEntryId: entry.reversedByEntryId || null,
    items: entry.items.map(line => ({
      accountCode: line.accountCode, debitBs: line.debitBs, creditBs: line.creditBs,
      debitUsd: line.debitUsd, creditUsd: line.creditUsd, description: line.description
    }))
  } : null;
  for (const id of [...new Set(input.sourceIds)].sort()) {
    const sale = input.sales.find(item => item.id === id && item.companyId === input.companyId);
    if (sale) {
      snapshots[id] = JSON.stringify({
        kind: 'SALE', id: sale.id, invoiceDate: sale.invoiceDate, documentType: sale.documentType,
        invoiceNumber: sale.invoiceNumber, controlNumber: sale.controlNumber, customerRif: sale.customerRif, customerName: sale.customerName,
        totalAmountBs: sale.totalAmountBs, totalAmountUsd: sale.totalAmountUsd, taxableBaseBs: sale.taxableBaseBs, taxableBaseUsd: sale.taxableBaseUsd,
        exemptAmountBs: sale.exemptAmountBs, exemptAmountUsd: sale.exemptAmountUsd || 0, taxRate: sale.taxRate,
        vatAmountBs: sale.vatAmountBs, vatAmountUsd: sale.vatAmountUsd, additionalLuxuryTaxBs: sale.additionalLuxuryTaxBs || 0,
        additionalLuxuryTaxUsd: sale.additionalLuxuryTaxUsd || 0, igtfApplicable: Boolean(sale.igtfApplicable), igtfRate: sale.igtfRate || 0,
        igtfAmountBs: sale.igtfAmountBs || 0, igtfAmountUsd: sale.igtfAmountUsd || 0,
        vatWithheldBs: sale.vatWithheldBs, vatWithheldUsd: sale.vatWithheldUsd, retentionRate: sale.retentionRate || 0,
        retentionVoucherNumber: sale.retentionVoucherNumber || null, retentionVoucherDate: sale.retentionVoucherDate || null,
        bcvRate: sale.bcvRate, journalEntryId: sale.journalEntryId || null, originalSaleId: sale.originalSaleId || null,
        affectedInvoiceNumber: sale.affectedInvoiceNumber || null, affectedInvoiceDate: sale.affectedInvoiceDate || null,
        affectedInvoiceControlNumber: sale.affectedInvoiceControlNumber || null, isCancelled: Boolean(sale.isCancelled),
        journal: journalSnapshot(input.journalEntries.find(entry => entry.id === sale.journalEntryId && entry.companyId === input.companyId))
      });
      continue;
    }
    const purchase = input.purchases.find(item => item.id === id && item.companyId === input.companyId);
    if (purchase) {
      snapshots[id] = JSON.stringify({
        kind: 'PURCHASE', id: purchase.id, invoiceDate: purchase.invoiceDate, accountCreditDate: purchase.accountCreditDate || null,
        documentType: purchase.documentType, invoiceNumber: purchase.invoiceNumber, controlNumber: purchase.controlNumber,
        supplierRif: purchase.supplierRif, supplierName: purchase.supplierName, totalAmountBs: purchase.totalAmountBs, totalAmountUsd: purchase.totalAmountUsd,
        taxableBaseBs: purchase.taxableBaseBs, taxableBaseUsd: purchase.taxableBaseUsd, exemptAmountBs: purchase.exemptAmountBs,
        exemptAmountUsd: purchase.exemptAmountUsd || 0, taxRate: purchase.taxRate, vatAmountBs: purchase.vatAmountBs, vatAmountUsd: purchase.vatAmountUsd,
        additionalLuxuryTaxBs: purchase.additionalLuxuryTaxBs || 0, additionalLuxuryTaxUsd: purchase.additionalLuxuryTaxUsd || 0,
        igtfApplicable: Boolean(purchase.igtfApplicable), igtfRate: purchase.igtfRate || 0,
        igtfAmountBs: purchase.igtfAmountBs || 0, igtfAmountUsd: purchase.igtfAmountUsd || 0,
        vatCreditTreatment: purchase.vatCreditTreatment || 'COMMON',
        vatWithheldBs: purchase.vatWithheldBs, vatWithheldUsd: purchase.vatWithheldUsd, retentionRate: purchase.retentionRate || 0,
        voucherNumber: purchase.voucherNumber || null, bcvRate: purchase.bcvRate, journalEntryId: purchase.journalEntryId || null, originalPurchaseId: purchase.originalPurchaseId || null,
        affectedInvoiceNumber: purchase.affectedInvoiceNumber || null, affectedInvoiceDate: purchase.affectedInvoiceDate || null,
        affectedInvoiceControlNumber: purchase.affectedInvoiceControlNumber || null, isCancelled: Boolean(purchase.isCancelled),
        journal: journalSnapshot(input.journalEntries.find(entry => entry.id === purchase.journalEntryId && entry.companyId === input.companyId))
      });
      continue;
    }
    const zEntry = input.journalEntries.find(entry => entry.id === id && entry.companyId === input.companyId && Boolean(entry.fiscalZReport));
    snapshots[id] = zEntry ? JSON.stringify({
      kind: 'Z', id: zEntry.id, date: zEntry.date, referenceDoc: zEntry.referenceDoc,
      fiscalZReport: zEntry.fiscalZReport, journal: journalSnapshot(zEntry)
    }) : JSON.stringify({ kind: 'MISSING', id });
  }
  return snapshots;
}

export function findExistingVatOwnPaymentReversal<T extends {
  id: string;
  companyId: string;
  reversalOfEntryId?: string;
}>(
  journalEntries: readonly T[],
  companyId: string,
  originalJournalEntryId: string
): T | null {
  const matches = journalEntries.filter(entry =>
    entry.companyId === companyId && entry.reversalOfEntryId === originalJournalEntryId
  );
  if (matches.length > 1) throw new Error('La reversión del pago de IVA tiene más de un contra-asiento asociado. Requiere conciliación manual.');
  return matches[0] || null;
}

export function resolveVatOwnPaymentBcvRate(
  history: ReadonlyArray<{ rate: number; effectiveDate: string; recordedAt: string }>,
  paymentDate: string
): number | null {
  const isCalendarDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(value + 'T00:00:00.000Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!isCalendarDate(paymentDate)) return null;
  const eligible = history.filter(item =>
    isCalendarDate(item.effectiveDate) && item.effectiveDate <= paymentDate &&
    Number.isFinite(Number(item.rate)) && Number(item.rate) > 0 &&
    Number.isFinite(Date.parse(item.recordedAt))
  ).sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate) || b.recordedAt.localeCompare(a.recordedAt)
  );
  return eligible.length ? Number(eligible[0].rate) : null;
}

export function isValidVatOwnDeclarationPeriod(period: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

/**
 * Returns the monthly VAT proration for common purchases. A zero/invalid sales
 * denominator cannot justify a 100% credit when common purchase VAT exists.
 * When there are no common purchases, the rate is immaterial and defaults to 1.
 */
export function resolveVatOwnProrationRate(input: {
  taxableSalesBaseBs: number;
  exemptSalesBaseBs: number;
  hasCommonPurchases: boolean;
}): number | null {
  const taxable = Number(input.taxableSalesBaseBs);
  const exempt = Number(input.exemptSalesBaseBs);
  if (!Number.isFinite(taxable) || !Number.isFinite(exempt) || taxable < 0 || exempt < 0) return null;
  const denominator = taxable + exempt;
  if (denominator <= 0) return input.hasCommonPurchases ? null : 1;
  return taxable / denominator;
}

/**
 * Customer VAT withholdings are a separate fiscal event from the daily sales source.
 * Ordinary invoices use the received-voucher date; debit/credit notes adjust the
 * withholding in the period of the corrective document, never the original invoice's
 * inherited voucher date.
 */
export function getReceivedVatWithholdingSales<T extends {
  companyId: string;
  documentType?: '01' | '02' | '03';
  invoiceDate?: string;
  isCancelled?: boolean;
  retentionVoucherDate?: string;
  vatWithheldBs?: number;
}>(sales: readonly T[], companyId: string, period: string): T[] {
  if (!companyId.trim() || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return [];
  return sales.filter(item => {
    if (item.companyId !== companyId || item.isCancelled === true ||
        !Number.isFinite(Number(item.vatWithheldBs || 0)) || Number(item.vatWithheldBs || 0) <= 0) return false;
    // En notas de débito/crédito la retención se ajusta con el propio documento
    // correctivo; no debe heredarse la fecha del comprobante de la factura original.
    const effectiveDate = item.documentType === '02' || item.documentType === '03' ? item.invoiceDate : item.retentionVoucherDate;
    return typeof effectiveDate === 'string' && effectiveDate.startsWith(period);
  });
}


export interface VatOwnPositionInput {
  outputVatBs: number;
  outputVat16Bs?: number;
  outputVat8Bs?: number;
  purchaseCreditBs: number;
  purchaseCredit16Bs?: number;
  purchaseCredit8Bs?: number;
  purchaseCreditGrossBs?: number;
  purchaseCreditGross16Bs?: number;
  purchaseCreditGross8Bs?: number;
  purchaseCreditNonEligibleBs?: number;
  purchaseCreditReversalBs?: number;
  purchaseCreditReversal16Bs?: number;
  purchaseCreditReversal8Bs?: number;
  purchaseCreditReversalNonEligibleBs?: number;
  purchaseCreditReversalNonEligible16Bs?: number;
  purchaseCreditReversalNonEligible8Bs?: number;
  prorationRate?: number;
  taxableSalesBaseBs?: number;
  exemptSalesBaseBs?: number;
  receivedWithholdingsBs: number;
  priorCreditBs?: number;
  debitAdjustmentsBs?: number;
  creditAdjustmentsBs?: number;
  creditAdjustments16Bs?: number;
  creditAdjustments8Bs?: number;
}

export interface VatOwnPosition {
  outputVatBs: number;
  outputVat16Bs: number;
  outputVat8Bs: number;
  purchaseCreditBs: number;
  purchaseCredit16Bs: number;
  purchaseCredit8Bs: number;
  purchaseCreditGrossBs: number;
  purchaseCreditGross16Bs: number;
  purchaseCreditGross8Bs: number;
  purchaseCreditNonEligibleBs: number;
  purchaseCreditReversalBs: number;
  purchaseCreditReversal16Bs: number;
  purchaseCreditReversal8Bs: number;
  purchaseCreditReversalNonEligibleBs: number;
  purchaseCreditReversalNonEligible16Bs: number;
  purchaseCreditReversalNonEligible8Bs: number;
  prorationRate: number;
  taxableSalesBaseBs: number;
  exemptSalesBaseBs: number;
  receivedWithholdingsBs: number;
  priorCreditAppliedBs: number;
  debitAdjustmentsBs: number;
  creditAdjustmentsBs: number;
  creditAdjustments16Bs: number;
  creditAdjustments8Bs: number;
  netTaxBs: number;
  amountDueBs: number;
  creditCarryForwardBs: number;
}

export interface VatOwnDeclarationRevision {
  revision: number;
  revisedAt: string;
  reason: string;
  position: VatOwnPosition;
  sourceIds: string[];
  relatedSourceIds?: string[];
  bcvRate?: number;
  dailySourceChoices?: Record<string, 'Z' | 'INDIVIDUAL'>;
  purchaseVatReclassificationItems?: JournalEntryItem[];
  sourceSnapshots?: Record<string, string>;
  createdAt: string;
}

export interface VatOwnDeclaration {
  id: string;
  companyId: string;
  period: string;
  status: VatOwnDeclarationStatus;
  position: VatOwnPosition;
  sourceIds: string[];
  relatedSourceIds?: string[];
  bcvRate?: number;
  dailySourceChoices?: Record<string, 'Z' | 'INDIVIDUAL'>;
  declarationNumber?: string;
  filedAt?: string;
  createdAt: string;
  updatedAt?: string;
  revisions?: VatOwnDeclarationRevision[];
  purchaseVatReclassificationItems?: JournalEntryItem[];
  /** Fiscal identity and material fields of every source document at draft time. */
  sourceSnapshots?: Record<string, string>;
}

export interface VatOwnPurchaseCreditSummary {
  prorationRate: number;
  gross16Bs: number;
  gross8Bs: number;
  eligible16Bs: number;
  eligible8Bs: number;
  nonEligible16Bs: number;
  nonEligible8Bs: number;
  priorReversalEligible16Bs: number;
  priorReversalEligible8Bs: number;
  priorReversalNonEligible16Bs: number;
  priorReversalNonEligible8Bs: number;
  relatedPurchaseIds: string[];
  reclassifications: Array<{ purchaseId: string; basePurchaseId: string; taxRate: number; nonEligibleSignedBs: number }>;
}

export function calculateVatOwnPurchaseCreditSummary(input: {
  companyId: string;
  period: string;
  purchases: readonly PurchaseRecord[];
  allPurchases: readonly PurchaseRecord[];
  priorDeclarations: readonly VatOwnDeclaration[];
  taxableSalesBaseBs: number;
  exemptSalesBaseBs: number;
}): VatOwnPurchaseCreditSummary {
  const periodPurchases = input.purchases.filter(item =>
    item.companyId === input.companyId && item.invoiceDate.startsWith(input.period) && !item.isCancelled
  );
  const relatedPurchaseIds: string[] = [];
  const reclassifications: VatOwnPurchaseCreditSummary['reclassifications'] = [];
  const originalByNoteId = new Map<string, PurchaseRecord>();
  const priorNotes: Array<{ item: PurchaseRecord; original: PurchaseRecord; prior: VatOwnDeclaration; treatment: VatOwnPurchaseCreditTreatment }> = [];
  const getFiledPurchaseTreatment = (declaration: VatOwnDeclaration, original: PurchaseRecord): VatOwnPurchaseCreditTreatment => {
    const saved = declaration.sourceSnapshots?.[original.id];
    if (!saved) {
      throw new Error('La declaración anterior no conserva la huella fiscal de la factura original ' + original.invoiceNumber + '. No es seguro inferir su tratamiento IVA actual para revertir un período presentado.');
    }
    let snapshot: Record<string, unknown>;
    try { snapshot = JSON.parse(saved) as Record<string, unknown>; }
    catch { throw new Error('La huella fiscal de la factura original ' + original.invoiceNumber + ' no se puede leer para revertir su crédito IVA.'); }
    if (snapshot.kind !== 'PURCHASE' || snapshot.id !== original.id ||
        !['TAXABLE', 'EXEMPT', 'COMMON'].includes(String(snapshot.vatCreditTreatment))) {
      throw new Error('La declaración anterior no conserva el tratamiento fiscal de la factura original ' + original.invoiceNumber + '.');
    }
    return resolveVatOwnPurchaseCreditTreatment(snapshot.vatCreditTreatment as VatOwnPurchaseCreditTreatment);
  };
  const normalizeFiscalReference = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  for (const item of periodPurchases) {
    if (item.documentType !== '03') continue;
    const supplierRif = normalizeFiscalReference(item.supplierRif);
    if (!supplierRif) {
      throw new Error('La nota de crédito de compras ' + item.invoiceNumber + ' no conserva el RIF del proveedor para verificar su factura original.');
    }
    const candidates = input.allPurchases.filter(original =>
      original.companyId === input.companyId && original.documentType === '01' && !original.isCancelled &&
      normalizeFiscalReference(original.supplierRif) === supplierRif &&
      (item.originalPurchaseId
        ? original.id === item.originalPurchaseId
        : Boolean(item.affectedInvoiceNumber && normalizeFiscalReference(original.invoiceNumber) === normalizeFiscalReference(item.affectedInvoiceNumber) &&
            (!item.affectedInvoiceDate || original.invoiceDate === item.affectedInvoiceDate) &&
            (!item.affectedInvoiceControlNumber || normalizeFiscalReference(original.controlNumber) === normalizeFiscalReference(item.affectedInvoiceControlNumber))))
    );
    if (candidates.length !== 1) {
      throw new Error('La nota de crédito de compras ' + item.invoiceNumber + ' no tiene una factura original única y verificable. Vincule la factura antes de declarar.');
    }
    const original = candidates[0];
    if (item.taxRate !== original.taxRate) {
      throw new Error('La nota de crédito de compras ' + item.invoiceNumber + ' no conserva la alícuota de su factura original.');
    }
    originalByNoteId.set(item.id, original);
    relatedPurchaseIds.push(original.id);
    if (original.invoiceDate.slice(0, 7) >= input.period) {
      if (original.invoiceDate.slice(0, 7) !== input.period) {
        throw new Error('La nota de crédito de compras no puede corregir una factura de un período futuro.');
      }
      continue;
    }
    const matches = input.priorDeclarations.filter(declaration =>
      declaration.companyId === input.companyId && declaration.status === 'FILED' &&
      declaration.period === original.invoiceDate.slice(0, 7) && declaration.period < input.period &&
      declaration.sourceIds.includes(original.id)
    );
    if (matches.length !== 1) {
      throw new Error('La factura original de la nota de crédito no aparece en una única declaración IVA anterior presentada. Debe conciliarse o rectificarse el período original antes de declarar esta nota.');
    }
    priorNotes.push({ item, original, prior: matches[0], treatment: getFiledPurchaseTreatment(matches[0], original) });
  }
  const hasCommonCurrentPurchases = periodPurchases.some(item => {
    const original = originalByNoteId.get(item.id);
    if (original && original.invoiceDate.slice(0, 7) < input.period) return false;
    const treatment = original
      ? resolveVatOwnPurchaseCreditTreatment(original.vatCreditTreatment)
      : resolveVatOwnPurchaseCreditTreatment(item.vatCreditTreatment);
    return treatment === 'COMMON' && Number(item.vatAmountBs || 0) > 0;
  });
  const prorationRate = resolveVatOwnProrationRate({
    taxableSalesBaseBs: input.taxableSalesBaseBs,
    exemptSalesBaseBs: input.exemptSalesBaseBs,
    hasCommonPurchases: hasCommonCurrentPurchases
  });
  if (prorationRate === null) {
    throw new Error('No se puede determinar la prorrata del IVA de compras comunes: el período no tiene una base válida de ventas gravadas y exentas.');
  }

  let gross16Bs = 0, gross8Bs = 0, eligible16Bs = 0, eligible8Bs = 0;
  let nonEligible16Bs = 0, nonEligible8Bs = 0;
  let priorReversalEligible16Bs = 0, priorReversalEligible8Bs = 0;
  let priorReversalNonEligible16Bs = 0, priorReversalNonEligible8Bs = 0;
  for (const item of periodPurchases) {
    const amountBs = Number(item.vatAmountBs || 0);
    if (!Number.isFinite(amountBs) || amountBs < 0) throw new Error('Una compra del período contiene IVA bruto inválido.');
    if (amountBs > 0 && ![8, 16, 31].includes(item.taxRate)) {
      throw new Error('Una compra del período contiene IVA con una alícuota no reconocida.');
    }
    const isEight = item.taxRate === 8;
    const add = (bucket: 'gross' | 'eligible' | 'nonEligible', value: number) => {
      if (isEight) {
        if (bucket === 'gross') gross8Bs += value;
        else if (bucket === 'eligible') eligible8Bs += value;
        else nonEligible8Bs += value;
      } else {
        if (bucket === 'gross') gross16Bs += value;
        else if (bucket === 'eligible') eligible16Bs += value;
        else nonEligible16Bs += value;
      }
    };
    if (item.documentType === '03') {
      const priorNote = priorNotes.find(row => row.item.id === item.id);
      if (priorNote) {
        const treatment = priorNote.treatment;
        const priorRate = Number(priorNote.prior.position.prorationRate);
        const priorSalesBase = Number(priorNote.prior.position.taxableSalesBaseBs || 0) +
          Number(priorNote.prior.position.exemptSalesBaseBs || 0);
        if (treatment === 'COMMON' && (!Number.isFinite(priorRate) || priorRate < 0 || priorRate > 1 ||
            !Number.isFinite(priorSalesBase) || priorSalesBase <= 0)) {
          throw new Error('La declaración anterior no conserva una prorrata sustentada por una base válida de ventas para revertir el crédito de la factura original.');
        }
        const factor = treatment === 'TAXABLE' ? 1 : treatment === 'EXEMPT' ? 0 : priorRate;
        const eligible = amountBs * factor;
        const nonEligible = amountBs - eligible;
        reclassifications.push({
          purchaseId: item.id, basePurchaseId: priorNote.original.id,
          taxRate: item.taxRate, nonEligibleSignedBs: -nonEligible
        });
        if (isEight) {
          priorReversalEligible8Bs += eligible;
          priorReversalNonEligible8Bs += nonEligible;
        } else {
          priorReversalEligible16Bs += eligible;
          priorReversalNonEligible16Bs += nonEligible;
        }
        continue;
      }
    }
    const sign = item.documentType === '03' ? -1 : 1;
    const original = originalByNoteId.get(item.id);
    const treatment = original
      ? resolveVatOwnPurchaseCreditTreatment(original.vatCreditTreatment)
      : resolveVatOwnPurchaseCreditTreatment(item.vatCreditTreatment);
    const factor = treatment === 'TAXABLE' ? 1 : treatment === 'EXEMPT' ? 0 : prorationRate;
    add('gross', sign * amountBs);
    add('eligible', sign * amountBs * factor);
    add('nonEligible', sign * amountBs * (1 - factor));
    reclassifications.push({
      purchaseId: item.id, basePurchaseId: original?.id || item.id,
      taxRate: item.taxRate, nonEligibleSignedBs: sign * amountBs * (1 - factor)
    });
  }
  if ([gross16Bs, gross8Bs, eligible16Bs, eligible8Bs, nonEligible16Bs, nonEligible8Bs].some(value => value < -0.02)) {
    throw new Error('Las notas de crédito del mismo período exceden el crédito fiscal de compras. Revise los documentos vinculados antes de declarar.');
  }
  gross16Bs = Math.max(0, gross16Bs); gross8Bs = Math.max(0, gross8Bs);
  eligible16Bs = Math.max(0, eligible16Bs); eligible8Bs = Math.max(0, eligible8Bs);
  nonEligible16Bs = Math.max(0, nonEligible16Bs); nonEligible8Bs = Math.max(0, nonEligible8Bs);
  return {
    prorationRate, gross16Bs, gross8Bs, eligible16Bs, eligible8Bs, nonEligible16Bs, nonEligible8Bs,
    priorReversalEligible16Bs, priorReversalEligible8Bs,
    priorReversalNonEligible16Bs, priorReversalNonEligible8Bs,
    relatedPurchaseIds: [...new Set(relatedPurchaseIds)], reclassifications
  };
}

export function buildVatOwnPurchaseVatReclassificationItems(input: {
  companyId: string;
  period: string;
  bcvRate: number;
  allPurchases: readonly PurchaseRecord[];
  journalEntries: readonly JournalEntry[];
  summary: VatOwnPurchaseCreditSummary;
}): JournalEntryItem[] {
  const rate = Number(input.bcvRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('Se requiere una tasa BCV válida para reclassificar el IVA no acreditable.');
  const excludedDebitAccounts = new Set(['1.1.3.01', '1.1.3.02', '6.1.1.11', '6.1.1.13']);
  const result: JournalEntryItem[] = [];
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  for (const adjustment of input.summary.reclassifications) {
    const signedAmount = round(Number(adjustment.nonEligibleSignedBs));
    if (!Number.isFinite(signedAmount)) throw new Error('Una reclassificación de IVA no acreditable contiene un importe inválido.');
    const sourcePurchase = input.allPurchases.find(item =>
      item.id === adjustment.basePurchaseId && item.companyId === input.companyId
    );
    if (!sourcePurchase) {
      throw new Error('No se encontró la factura de compra original del documento ' + adjustment.purchaseId + '.');
    }
    const requiresPurchaseJournal = Math.abs(signedAmount) >= 0.01 || Number(sourcePurchase.vatAmountBs || 0) > 0;
    if (!requiresPurchaseJournal) continue;
    if (!sourcePurchase.journalEntryId) {
      throw new Error('No se puede conciliar el IVA del documento ' + adjustment.purchaseId + ': la factura original no conserva su asiento de compra.');
    }
    const sourceEntries = input.journalEntries.filter(entry =>
      entry.id === sourcePurchase.journalEntryId && entry.companyId === input.companyId
    );
    if (sourceEntries.length !== 1) {
      throw new Error('No se encontró un único asiento contable de origen para distribuir el IVA no acreditable de la factura ' + sourcePurchase.invoiceNumber + '.');
    }
    const sourceEntry = sourceEntries[0];
    if (sourceEntry.reversalOfEntryId || sourceEntry.reversedByEntryId ||
        input.journalEntries.some(entry => entry.companyId === input.companyId && entry.reversalOfEntryId === sourceEntry.id)) {
      throw new Error('No se puede conciliar el IVA de una factura cuyo asiento de compra fue revertido. Reconcilie primero el estado fiscal del documento.');
    }
    if (Math.abs(signedAmount) < 0.01) continue;
    const grouped = new Map<string, { accountName: string; amountBs: number }>();
    for (const item of sourceEntry.items) {
      if (Number(item.debitBs || 0) <= 0 || excludedDebitAccounts.has(item.accountCode)) continue;
      const current = grouped.get(item.accountCode) || { accountName: item.accountName, amountBs: 0 };
      current.amountBs += Number(item.debitBs || 0);
      grouped.set(item.accountCode, current);
    }
    const destinations = [...grouped.entries()].filter(([, value]) => value.amountBs > 0);
    const totalDestinationBase = destinations.reduce((sum, [, value]) => sum + value.amountBs, 0);
    const expectedBase = Number(sourcePurchase.taxableBaseBs || 0) + Number(sourcePurchase.exemptAmountBs || 0);
    if (!Number.isFinite(expectedBase) || expectedBase <= 0 || totalDestinationBase <= 0 ||
        Math.abs(totalDestinationBase - expectedBase) > 0.05) {
      throw new Error('El asiento de la factura ' + sourcePurchase.invoiceNumber + ' no permite distribuir de forma verificable el IVA no acreditable entre sus cuentas de costo, inventario o gasto.');
    }
    const absoluteAmount = Math.abs(signedAmount);
    const totalCents = Math.round(absoluteAmount * 100);
    let allocatedCents = 0;
    destinations.forEach(([accountCode, destination], index) => {
      const allocationCents = index === destinations.length - 1
        ? totalCents - allocatedCents
        : Math.floor(totalCents * destination.amountBs / totalDestinationBase);
      allocatedCents += allocationCents;
      const allocation = allocationCents / 100;
      if (allocation <= 0) return;
      const isDebit = signedAmount > 0;
      result.push({
        accountCode, accountName: destination.accountName,
        debitBs: isDebit ? allocation : 0, creditBs: isDebit ? 0 : allocation,
        debitUsd: isDebit ? allocation / rate : 0, creditUsd: isDebit ? 0 : allocation / rate,
        description: 'Reclasificación IVA no acreditable · ' + sourcePurchase.invoiceNumber + ' · ' + input.period
      });
    });
    const inputVatCode = adjustment.taxRate === 8 ? '1.1.3.02' : '1.1.3.01';
    const inputVatName = adjustment.taxRate === 8
      ? 'Crédito Fiscal IVA Compras (Alícuota Reducida 8%)'
      : 'Crédito Fiscal IVA Compras (Alícuota General 16%)';
    const inputVatDebit = signedAmount < 0;
    result.push({
      accountCode: inputVatCode, accountName: inputVatName,
      debitBs: inputVatDebit ? absoluteAmount : 0,
      creditBs: inputVatDebit ? 0 : absoluteAmount,
      debitUsd: inputVatDebit ? absoluteAmount / rate : 0,
      creditUsd: inputVatDebit ? 0 : absoluteAmount / rate,
      description: 'Reclasificación IVA no acreditable · Documento ' + adjustment.purchaseId + ' · ' + input.period
    });
  }
  const debitBs = result.reduce((sum, item) => sum + item.debitBs, 0);
  const creditBs = result.reduce((sum, item) => sum + item.creditBs, 0);
  if (Math.abs(debitBs - creditBs) > 0.02) {
    throw new Error('La reclassificación del IVA no acreditable no cuadra en Bs. No se preparó la declaración.');
  }
  return result;
}

export function snapshotVatOwnDeclarationRevision(
  declaration: VatOwnDeclaration,
  revisedAt: string,
  reason: string
): VatOwnDeclarationRevision {
  if (declaration.status !== 'DRAFT') throw new Error('Solo se puede versionar un borrador no presentado.');
  if (!revisedAt || Number.isNaN(Date.parse(revisedAt))) throw new Error('La fecha de revisión no es válida.');
  if (!reason.trim()) throw new Error('La revisión del borrador requiere un motivo.');
  return {
    revision: (declaration.revisions?.length || 0) + 1,
    revisedAt,
    reason: reason.trim(),
    position: { ...declaration.position },
    sourceIds: [...declaration.sourceIds],
    relatedSourceIds: [...(declaration.relatedSourceIds || [])],
    bcvRate: declaration.bcvRate,
    dailySourceChoices: { ...(declaration.dailySourceChoices || {}) },
    purchaseVatReclassificationItems: (declaration.purchaseVatReclassificationItems || []).map(item => ({ ...item })),
    sourceSnapshots: declaration.sourceSnapshots ? { ...declaration.sourceSnapshots } : undefined,
    createdAt: declaration.createdAt
  };
}

export interface VatOwnDeclarationEvent {
  id: string;
  declarationId: string;
  companyId: string;
  eventType: 'FILED' | 'PAYMENT' | 'REVERSAL';
  occurredAt: string;
  recordedAt: string;
  amountBs?: number;
  declarationNumber?: string;
  reference?: string;
  idempotencyKey: string;
  journalEntryId?: string;
  reversalOfEventId?: string;
  treasuryAccountCode?: string;
  bcvRate?: number;
  note?: string;
}

const amount = (value: number | undefined, field: string): number => {
  const normalized = value ?? 0;
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error(field + ' debe ser un importe finito no negativo.');
  }
  return normalized;
};

export function calculateVatOwnPosition(input: VatOwnPositionInput): VatOwnPosition {
  const outputVatBs = amount(input.outputVatBs, 'IVA débito');
  const outputVat16Bs = amount(input.outputVat16Bs ?? outputVatBs, 'IVA débito 16%');
  const outputVat8Bs = amount(input.outputVat8Bs, 'IVA débito 8%');
  if (Math.abs(outputVat16Bs + outputVat8Bs - outputVatBs) > 0.02) {
    throw new Error('El desglose de IVA 16% y 8% no concilia con el débito fiscal total.');
  }
  const purchaseCreditBs = amount(input.purchaseCreditBs, 'Crédito fiscal acreditable de compras');
  const purchaseCredit16Bs = amount(input.purchaseCredit16Bs ?? purchaseCreditBs, 'Crédito fiscal acreditable 16%');
  const purchaseCredit8Bs = amount(input.purchaseCredit8Bs, 'Crédito fiscal acreditable 8%');
  const purchaseCreditGrossBs = amount(input.purchaseCreditGrossBs ?? purchaseCreditBs, 'Crédito fiscal bruto de compras');
  const purchaseCreditGross16Bs = amount(input.purchaseCreditGross16Bs ?? purchaseCredit16Bs, 'Crédito fiscal bruto 16%');
  const purchaseCreditGross8Bs = amount(input.purchaseCreditGross8Bs ?? purchaseCredit8Bs, 'Crédito fiscal bruto 8%');
  const purchaseCreditNonEligibleBs = amount(input.purchaseCreditNonEligibleBs ?? Math.max(0, purchaseCreditGrossBs - purchaseCreditBs), 'IVA no acreditable por prorrata');
  const taxableSalesBaseBs = amount(input.taxableSalesBaseBs, 'Base de ventas gravadas');
  const exemptSalesBaseBs = amount(input.exemptSalesBaseBs, 'Ventas exentas');
  const computedProration = taxableSalesBaseBs + exemptSalesBaseBs > 0
    ? taxableSalesBaseBs / (taxableSalesBaseBs + exemptSalesBaseBs) : 1;
  const prorationRate = Number(input.prorationRate ?? computedProration);
  if (!Number.isFinite(prorationRate) || prorationRate < 0 || prorationRate > 1) throw new Error('El porcentaje de prorrata debe estar entre 0% y 100%.');
  if (Math.abs(purchaseCredit16Bs + purchaseCredit8Bs - purchaseCreditBs) > 0.02 ||
      Math.abs(purchaseCreditGross16Bs + purchaseCreditGross8Bs - purchaseCreditGrossBs) > 0.02 ||
      Math.abs(purchaseCreditGrossBs - purchaseCreditBs - purchaseCreditNonEligibleBs) > 0.02) {
    throw new Error('El desglose de crédito fiscal acreditable, bruto y no acreditable no concilia.');
  }
  const purchaseCreditReversalBs = amount(input.purchaseCreditReversalBs, 'Reversión de crédito fiscal de compras de períodos anteriores');
  const purchaseCreditReversal16Bs = amount(input.purchaseCreditReversal16Bs, 'Reversión de crédito fiscal de compras 16%');
  const purchaseCreditReversal8Bs = amount(input.purchaseCreditReversal8Bs, 'Reversión de crédito fiscal de compras 8%');
  const purchaseCreditReversalNonEligibleBs = amount(input.purchaseCreditReversalNonEligibleBs, 'Reversión de IVA no acreditable de períodos anteriores');
  const purchaseCreditReversalNonEligible16Bs = amount(input.purchaseCreditReversalNonEligible16Bs, 'Reversión de IVA no acreditable 16%');
  const purchaseCreditReversalNonEligible8Bs = amount(input.purchaseCreditReversalNonEligible8Bs, 'Reversión de IVA no acreditable 8%');
  if (Math.abs(purchaseCreditReversal16Bs + purchaseCreditReversal8Bs - purchaseCreditReversalBs) > 0.02 ||
      Math.abs(purchaseCreditReversalNonEligible16Bs + purchaseCreditReversalNonEligible8Bs - purchaseCreditReversalNonEligibleBs) > 0.02) {
    throw new Error('El desglose de reversión de crédito fiscal 16% y 8% no concilia.');
  }
  const receivedWithholdingsBs = amount(input.receivedWithholdingsBs, 'Retenciones de IVA recibidas');
  const priorCreditAvailableBs = amount(input.priorCreditBs, 'Crédito de períodos anteriores');
  const debitAdjustmentsBs = amount(input.debitAdjustmentsBs, 'Ajustes al débito');
  const creditAdjustmentsBs = amount(input.creditAdjustmentsBs, 'Ajustes al crédito');
  const creditAdjustments16Bs = amount(input.creditAdjustments16Bs ?? creditAdjustmentsBs, 'Ajustes al crédito IVA 16%');
  const creditAdjustments8Bs = amount(input.creditAdjustments8Bs, 'Ajustes al crédito IVA 8%');
  if (Math.abs(creditAdjustments16Bs + creditAdjustments8Bs - creditAdjustmentsBs) > 0.02) {
    throw new Error('El desglose de ajustes al crédito fiscal 16% y 8% no concilia.');
  }
  const balanceBeforePriorCredit = outputVatBs + debitAdjustmentsBs + purchaseCreditReversalBs - purchaseCreditBs -
    receivedWithholdingsBs - creditAdjustmentsBs;
  const priorCreditAppliedBs = Math.min(priorCreditAvailableBs, Math.max(0, balanceBeforePriorCredit));
  const unusedPriorCreditBs = priorCreditAvailableBs - priorCreditAppliedBs;
  const netTaxBs = balanceBeforePriorCredit - priorCreditAppliedBs;
  return {
    outputVatBs, outputVat16Bs, outputVat8Bs,
    purchaseCreditBs, purchaseCredit16Bs, purchaseCredit8Bs,
    purchaseCreditGrossBs, purchaseCreditGross16Bs, purchaseCreditGross8Bs,
    purchaseCreditNonEligibleBs, purchaseCreditReversalBs, purchaseCreditReversal16Bs, purchaseCreditReversal8Bs,
    purchaseCreditReversalNonEligibleBs, purchaseCreditReversalNonEligible16Bs, purchaseCreditReversalNonEligible8Bs,
    prorationRate, taxableSalesBaseBs, exemptSalesBaseBs, receivedWithholdingsBs,
    priorCreditAppliedBs, debitAdjustmentsBs, creditAdjustmentsBs, creditAdjustments16Bs, creditAdjustments8Bs,
    netTaxBs, amountDueBs: Math.max(0, netTaxBs),
    creditCarryForwardBs: Math.max(0, -netTaxBs) + unusedPriorCreditBs
  };
}

export function getVatOwnNewCreditCarryForward(input: {
  priorCreditAvailableBs: number;
  priorCreditAppliedBs: number;
  totalCreditCarryForwardBs: number;
}): number {
  const values = [input.priorCreditAvailableBs, input.priorCreditAppliedBs, input.totalCreditCarryForwardBs].map(Number);
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    throw new Error('El arrastre de crédito fiscal contiene importes inválidos.');
  }
  const [priorAvailable, priorApplied, totalCarryForward] = values;
  if (priorApplied - priorAvailable > 0.02) {
    throw new Error('El crédito fiscal aplicado supera el saldo anterior disponible.');
  }
  const unusedPriorCredit = Math.max(0, priorAvailable - priorApplied);
  const newlyGeneratedCredit = totalCarryForward - unusedPriorCredit;
  if (newlyGeneratedCredit < -0.02) {
    throw new Error('El saldo trasladable no concilia con el crédito fiscal anterior no utilizado.');
  }
  return Math.max(0, newlyGeneratedCredit);
}

export function validateVatOwnDeclarationDraft(input: {
  id: string;
  companyId: string;
  period: string;
  sourceIds: string[];
  relatedSourceIds?: string[];
  purchaseVatReclassificationItems?: JournalEntryItem[];
  createdAt: string;
}): void {
  if (!input.id.trim() || !input.companyId.trim()) throw new Error('La declaración requiere identificador y empresa.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error('El período debe tener formato YYYY-MM.');
  if (!input.createdAt || Number.isNaN(Date.parse(input.createdAt))) throw new Error('La fecha de creación no es válida.');
  if (new Set(input.sourceIds).size !== input.sourceIds.length) {
    throw new Error('Una misma fuente no puede incluirse dos veces en la declaración.');
  }
  if (input.sourceIds.some(id => !id.trim())) throw new Error('La declaración contiene una fuente sin identificador.');
  if (input.relatedSourceIds && (
    input.relatedSourceIds.some(id => !id.trim()) ||
    new Set(input.relatedSourceIds).size !== input.relatedSourceIds.length ||
    input.relatedSourceIds.some(id => input.sourceIds.includes(id))
  )) throw new Error('Las facturas relacionadas deben tener identificadores únicos, válidos y separados de las fuentes directas.');
  const reclassifications = input.purchaseVatReclassificationItems || [];
  if (reclassifications.some(item =>
    !item.accountCode?.trim() ||
    [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd].some(value => !Number.isFinite(Number(value)) || Number(value) < 0) ||
    (Number(item.debitBs) > 0 && Number(item.creditBs) > 0) ||
    (Number(item.debitUsd) > 0 && Number(item.creditUsd) > 0)
  )) throw new Error('Una línea de reclasificación de IVA contiene cuenta o importes inválidos.');
  const debitBs = reclassifications.reduce((sum, item) => sum + Number(item.debitBs || 0), 0);
  const creditBs = reclassifications.reduce((sum, item) => sum + Number(item.creditBs || 0), 0);
  const debitUsd = reclassifications.reduce((sum, item) => sum + Number(item.debitUsd || 0), 0);
  const creditUsd = reclassifications.reduce((sum, item) => sum + Number(item.creditUsd || 0), 0);
  if ([debitBs, creditBs, debitUsd, creditUsd].some(value => !Number.isFinite(value)) ||
      Math.abs(debitBs - creditBs) > 0.02 || Math.abs(debitUsd - creditUsd) > 0.000001) {
    throw new Error('Las reclasificaciones de IVA no acreditable del borrador no cuadran en Bs y USD.');
  }
}

export function getVatOwnOutstandingBalance(
  declaration: VatOwnDeclaration,
  events: VatOwnDeclarationEvent[]
): number {
  const declarationEvents = events.filter(event =>
    event.companyId === declaration.companyId && event.declarationId === declaration.id
  );
  const reversedPaymentIds = new Set(declarationEvents
    .filter(event => event.eventType === 'REVERSAL' && event.reversalOfEventId)
    .map(event => event.reversalOfEventId));
  const paid = declarationEvents.filter(event =>
    event.eventType === 'PAYMENT' && !reversedPaymentIds.has(event.id)
  ).reduce((sum, event) => sum + amount(event.amountBs, 'Pago registrado'), 0);
  return Math.max(0, declaration.position.amountDueBs - paid);
}

export function validateVatOwnEvent(input: {
  declaration: VatOwnDeclaration;
  events: VatOwnDeclarationEvent[];
  draft: Omit<VatOwnDeclarationEvent, 'id' | 'recordedAt'>;
  sameCompanyDeclarationNumbers?: string[];
}): void {
  const { declaration, events, draft } = input;
  if (draft.companyId !== declaration.companyId || draft.declarationId !== declaration.id) {
    throw new Error('El evento no pertenece a la declaración y empresa seleccionadas.');
  }
  if (!isValidVatOwnDeclarationPeriod(declaration.period)) throw new Error('El período de la declaración no es válido.');
  if (!draft.idempotencyKey.trim()) throw new Error('El evento requiere una clave de idempotencia.');
  if (events.some(event => event.idempotencyKey === draft.idempotencyKey)) {
    throw new Error('La operación ya fue registrada; no se admite un duplicado.');
  }
  const eventDatePart = String(draft.occurredAt || '').slice(0, 10);
  const parsedEventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDatePart)
    ? new Date(eventDatePart + 'T00:00:00.000Z') : null;
  const validEventTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(String(draft.occurredAt || ''));
  if (!validEventTimestamp || !parsedEventDate || !Number.isFinite(parsedEventDate.getTime()) ||
      parsedEventDate.toISOString().slice(0, 10) !== eventDatePart || Number.isNaN(Date.parse(draft.occurredAt))) {
    throw new Error('La fecha del evento no es válida.');
  }
  if (draft.eventType === 'FILED') {
    if (declaration.status !== 'DRAFT') throw new Error('La declaración ya fue presentada.');
    const [periodYear, periodMonth] = declaration.period.split('-').map(Number);
    const periodEndDate = new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10);
    if (eventDatePart <= periodEndDate) {
      throw new Error('No se puede presentar una declaración mensual antes de que finalice el período fiscal seleccionado (' + periodEndDate + ').');
    }
    if (!draft.declarationNumber?.trim()) throw new Error('Indique el número oficial de declaración.');
    if (input.sameCompanyDeclarationNumbers?.includes(draft.declarationNumber.trim())) {
      throw new Error('El número oficial ya está asociado a otra declaración de esta empresa.');
    }
    return;
  }
  if (draft.eventType === 'PAYMENT') {
    if (declaration.status !== 'FILED') throw new Error('Presente la declaración antes de registrar su pago.');
    const payment = amount(draft.amountBs, 'El pago');
    if (payment <= 0) throw new Error('El pago debe ser mayor que cero.');
    const now = new Date();
    const localToday = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    if (draft.occurredAt.slice(0, 10) > localToday) {
      throw new Error('La fecha del pago no puede ser futura.');
    }
    if (declaration.filedAt && draft.occurredAt.slice(0, 10) < declaration.filedAt.slice(0, 10)) {
      throw new Error('La fecha del pago no puede ser anterior al día de presentación de la declaración.');
    }
    if (!draft.reference?.trim()) throw new Error('El pago requiere referencia del comprobante o movimiento bancario.');
    if (events.some(event =>
      event.companyId === declaration.companyId &&
      event.eventType === 'PAYMENT' &&
      event.reference?.trim() === draft.reference?.trim()
    )) throw new Error('La referencia de pago ya fue utilizada en esta empresa.');
    if (payment > getVatOwnOutstandingBalance(declaration, events) + 0.000001) {
      throw new Error('El pago supera el saldo pendiente de la declaración.');
    }
    return;
  }
  if (draft.eventType === 'REVERSAL') {
    if (!draft.reversalOfEventId) throw new Error('La reversión debe identificar el evento original.');
    const original = events.find(event =>
      event.id === draft.reversalOfEventId &&
      event.companyId === declaration.companyId &&
      event.declarationId === declaration.id &&
      event.eventType === 'PAYMENT'
    );
    if (!original) throw new Error('El pago original que se intenta revertir no existe en esta declaración.');
    if (events.some(event => event.eventType === 'REVERSAL' && event.reversalOfEventId === original.id)) {
      throw new Error('El pago original ya fue revertido.');
    }
    return;
  }
}


export interface VatOwnDailySalesSource {
  date: string;
  source: 'Z' | 'INDIVIDUAL';
  sourceIds: string[];
  outputVatBs: number;
  outputVat16Bs: number;
  outputVat8Bs: number;
  taxableBase16Bs: number;
  taxableBase8Bs: number;
  taxableBase31Bs: number;
  exemptSalesBs: number;
}

export interface VatOwnDailySourceConflict {
  date: string;
  zSourceIds: string[];
  individualSourceIds: string[];
}

/**
 * Combina días registrados por Z con días registrados por factura individual.
 * Si ambas fuentes existen el mismo día, no elige una ni suma ambas: exige decisión
 * expresa del contador para evitar duplicar las mismas ventas.
 */
export function resolveVatOwnDailySalesSources(input: {
  zReports: Array<{
    id: string; date: string; taxableBase16Bs: number; vat16Bs: number;
    taxableBase8Bs: number; vat8Bs: number; taxableBase31Bs: number; vat31Bs: number;
    exemptSalesBs: number;
  }>;
  sales: Array<{
    id: string; date: string; documentType: '01' | '02' | '03';
    taxableBaseBs: number; taxRate: number; vatAmountBs: number; exemptAmountBs: number;
  }>;
  choices?: Record<string, 'Z' | 'INDIVIDUAL'>;
}): { days: VatOwnDailySalesSource[]; conflicts: VatOwnDailySourceConflict[]; unresolvedDates: string[] } {
  const byDate = new Map<string, { z: VatOwnDailySalesSource | null; individual: VatOwnDailySalesSource | null }>();
  const ensure = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('La fecha de origen del IVA no es válida.');
    if (!byDate.has(date)) byDate.set(date, { z: null, individual: null });
    return byDate.get(date)!;
  };
  for (const report of input.zReports) {
    const day = ensure(report.date);
    if (!day.z) day.z = { date: report.date, source: 'Z', sourceIds: [], outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0, taxableBase16Bs: 0, taxableBase8Bs: 0, taxableBase31Bs: 0, exemptSalesBs: 0 };
    const target = day.z;
    target.sourceIds.push(report.id);
    target.taxableBase16Bs += amount(report.taxableBase16Bs, 'Base 16% del Z');
    target.taxableBase8Bs += amount(report.taxableBase8Bs, 'Base 8% del Z');
    target.taxableBase31Bs += amount(report.taxableBase31Bs, 'Base 31% del Z');
    target.outputVat16Bs += amount(report.vat16Bs, 'IVA 16% del Z') + amount(report.vat31Bs, 'IVA 16% de base 31% del Z');
    target.outputVat8Bs += amount(report.vat8Bs, 'IVA 8% del Z');
    target.outputVatBs += amount(report.vat16Bs, 'IVA 16% del Z') + amount(report.vat8Bs, 'IVA 8% del Z') + amount(report.vat31Bs, 'IVA 16% de base 31% del Z');
    target.exemptSalesBs += amount(report.exemptSalesBs, 'Ventas exentas del Z');
  }
  for (const sale of input.sales) {
    const day = ensure(sale.date);
    if (!day.individual) day.individual = { date: sale.date, source: 'INDIVIDUAL', sourceIds: [], outputVatBs: 0, outputVat16Bs: 0, outputVat8Bs: 0, taxableBase16Bs: 0, taxableBase8Bs: 0, taxableBase31Bs: 0, exemptSalesBs: 0 };
    const target = day.individual;
    const sign = sale.documentType === '03' ? -1 : 1;
    target.sourceIds.push(sale.id);
    target.outputVatBs += sign * amount(sale.vatAmountBs, 'IVA de venta');
    if (sale.taxRate === 8) target.outputVat8Bs += sign * amount(sale.vatAmountBs, 'IVA 8% de venta');
    else target.outputVat16Bs += sign * amount(sale.vatAmountBs, 'IVA 16% de venta');
    target.exemptSalesBs += sign * (amount(sale.exemptAmountBs, 'Venta exenta') + (sale.taxRate === 0 ? amount(sale.taxableBaseBs, 'Venta a 0% exenta') : 0));
    if (sale.taxRate === 16) target.taxableBase16Bs += sign * amount(sale.taxableBaseBs, 'Base 16%');
    else if (sale.taxRate === 8) target.taxableBase8Bs += sign * amount(sale.taxableBaseBs, 'Base 8%');
    else if (sale.taxRate === 31) target.taxableBase31Bs += sign * amount(sale.taxableBaseBs, 'Base 31%');
  }
  const days: VatOwnDailySalesSource[] = [];
  const conflicts: VatOwnDailySourceConflict[] = [];
  const unresolvedDates: string[] = [];
  for (const [date, sources] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (sources.z && sources.individual) {
      conflicts.push({ date, zSourceIds: sources.z.sourceIds, individualSourceIds: sources.individual.sourceIds });
      const choice = input.choices?.[date];
      if (!choice) { unresolvedDates.push(date); continue; }
      days.push(choice === 'Z' ? sources.z : sources.individual);
    } else if (sources.z || sources.individual) {
      days.push((sources.z || sources.individual)!);
    }
  }
  return { days, conflicts, unresolvedDates };
}
