import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
  Company,
  Account,
  CashFlowActivity,
  CashFlowIndirectTreatment,
  JournalEntry,
  PurchaseRecord,
  getPurchaseAccountCreditDate,
  SaleRecord,
  InventoryProduct,
  InventoryMovement,
  InventoryMovementImportDraft,
  VatRetentionVoucher,
  VatWithholdingDeclaration,
  VatWithholdingDeclarationEvent,
  VatDeclarationWindow,
  IslrRetentionVoucher,
  JournalEntryItem,
  BankAccount,
  BankStatementMovement
} from '../types/accounting';
import { DEFAULT_CHART_OF_ACCOUNTS } from '../data/defaultChartOfAccounts';
import { prepareAccountForCatalog } from '../types/chartOfAccounts';
import { validateJournalEntryAccounts, isJournalEntryBalanced } from '../types/journalEntryValidation';
import { matchesBankStatementDualCurrency, validateBankMovementFxSnapshot, isDuplicateBankStatementMovement } from '../types/bankStatementMatching';
import { buildOpeningEntryItems } from '../types/accountingYearOpening';
import { ISLR_CONCEPTS, calculateMonthlyIslrRetention, getIslrUnitTaxValueForPeriod, ISLR_FORMULA_FACTOR } from '../data/islrConcepts';
import {
  INITIAL_COMPANIES,
  INITIAL_JOURNAL_ENTRIES,
  INITIAL_PURCHASES,
  INITIAL_SALES,
  INITIAL_INVENTORY_PRODUCTS,
  INITIAL_INVENTORY_MOVEMENTS,
  INITIAL_VAT_VOUCHERS,
  INITIAL_ISLR_VOUCHERS,
  INITIAL_BANK_ACCOUNTS,
  INITIAL_STATEMENT_MOVEMENTS
} from '../data/initialData';
import { formatVoucherNumber, validateVenezuelanRif } from '../utils/formatters';
import { formatIslrVoucherNumber, getMaxIslrVoucherSequence } from '../utils/islrVoucherNumber';
import { evaluateIvaRetentionEligibility, resolveIvaBuyerAgentStatus } from '../types/ivaRetentionEligibility';
import { CreditSettlement, CreditBalance, CreditSettlementDraft, calculateCreditBalance, summarizeCreditDocumentAdjustments, validateCreditSettlement } from '../types/creditSettlement';
import { buildCreditSettlementJournalItems } from '../types/creditSettlementAccounting';
import type { UniversalCreditSettlementDraft } from '../types/universalImport';
import { buildSupplierAdvanceSettlementJournalItems } from '../types/supplierAdvanceSettlementAccounting';
import { FinancialDisclosure, validateFinancialDisclosure } from '../types/financialDisclosures';
import { buildVatWithholdingDeclaration, validateVatDeclarationEventDraft } from '../types/vatWithholdingDeclaration';
import { getVatPaymentJournalReversalBlocker, validateVatPaymentBankLinks } from '../types/vatBankReconciliation';
import { buildVatPaymentAccountingPlan } from '../types/vatPaymentAccounting';
import { IslrFiscalEvent, allocateIslrFiscalReversal, resolvePurchaseIslrFiscalTrigger, validateIslrFiscalEventLedger } from '../types/islrFiscalEvent';
import { calculateFxFiscalAdjustment } from '../types/fxFiscalAdjustment';
import { buildReversalItems, assessJournalReversal, validateBankStatementReversal, validatePurchaseInventoryReconciliation, validateSaleInventoryReturnReconciliation } from '../types/journalReversal';
import { calculateFifoIssue, calculateWeightedAverageCost, calculateWeightedAverageCostDual, validateInventoryMovement, normalizeProductionRecipe, getDefaultInventoryAccountCode, reconstructFifoLayers } from '../types/inventoryAccounting';
import { isValidIsoDate } from '../types/migrationParsing';
import { buildBankAuxiliaryAccounts } from '../types/bankAccountAccounting';
import { calculateBankAvailableBalance, validateBankOutgoingAvailability } from '../types/bankAccountAvailability';
import { createBankOutgoingLock } from '../types/bankOutgoingLock';
import { removeUnusedLegacyDefaultBanks } from '../types/legacyBankAccountCleanup';
import { resolvePurchaseVatFiscalEvent } from '../types/vatFiscalEvent';
import { hasConsistentFiscalDocumentAmounts } from '../types/fiscalDocumentAmounts';
import { calculatePurchaseCreditNote, type PurchaseCreditNoteRequest } from '../types/purchaseCreditNote';
import { validatePurchaseSettlementMode, validatePurchasePaymentDate } from '../types/purchaseSettlement';
import { validateSaleSettlementMode } from '../types/saleSettlement';
import { allocateSupplierCredit } from '../types/supplierCreditAllocation';
import { calculateOutstandingSupplierAdvance, type SupplierAdvanceBalance } from '../types/supplierAdvance';
import { calculateSupplierAdvanceFxSettlement } from '../types/supplierAdvanceFx';
import { allocateDirectSupplierAdvance, validateSupplierDirectAdvanceDraft, type SupplierDirectAdvance, type SupplierDirectAdvanceDraft } from '../types/supplierDirectAdvance';
import { allocateSupplierAdvanceCreditNotes, validateSupplierAdvanceCreditNoteAllocations, validateSupplierAdvanceSettlementDraft, type SupplierAdvanceSettlement, type SupplierAdvanceSettlementDraft } from '../types/supplierAdvanceSettlement';
import type { VatFiscalIncident, VatFiscalIncidentCreateInput, VatFiscalIncidentEventInput } from '../types/vatFiscalIncidents';
import { buildSupplierDebitNoteAccountingPlan, type SupplierDebitNoteAccountingDraft } from '../types/supplierDebitNoteAccounting';
import { calculatePurchaseServiceCreditNote, type PurchaseServiceCreditNoteRequest } from '../types/purchaseServiceCreditNote';
import { calculateSaleCorrectionNote, type SaleCorrectionNoteRequest } from '../types/saleCorrectionNote';
import { resolveNonInventoryPurchaseDebitAccount, resolveTreasuryAccountCurrency } from '../types/purchaseAccounting';

export interface AccountingAuditEvent {
  id: number;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export type CorrectionCase = { id: string; company_id: string; entity_type: string; entity_id: string; correction_type: string; source_ref: string; correction_ref: string; reason: string; workpaper: string; status: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'EXECUTED'; workflow_stage: 'IN_REVIEW' | 'OBSERVATION_REQUIRED' | 'READY_FOR_EXECUTION' | 'CLOSED' | 'COMPLETED' | 'WITHDRAWN'; requested_by: number; requested_by_name: string; reviewed_by?: number; reviewed_by_name?: string; review_reason?: string; executed_by?: number; executed_by_name?: string; execution_ref?: string; created_at: string; reviewed_at?: string; executed_at?: string; execution_started_by?: number; execution_started_at?: string; execution_started_ref?: string; events: Array<{ id: number | string; event_type: string; actor_id: number; actor_name: string; reason: string; created_at: string; metadata: Record<string, unknown> }> };
type SupportingDocumentEntityType = 'PURCHASE' | 'SALE' | 'JOURNAL_ENTRY' | 'VAT_VOUCHER' | 'ISLR_VOUCHER' | 'INVENTORY_MOVEMENT' | 'BANK_STATEMENT_MOVEMENT' | 'CORRECTION_CASE';
type SupportingDocument = { id: string; companyId: string; entityType: string; entityId: string; documentType: string; title: string; description?: string | null; fileName: string; mimeType: string; sha256: string; byteSize: number; uploadedBy: string; createdAt: string; status: string };
type SupportingDocumentDraft = { entityType: SupportingDocumentEntityType; entityId: string; documentType: string; title: string; description?: string; replacesDocumentId?: string };

interface AccountingContextType {
  getAuditEvents: (limit?: number) => Promise<AccountingAuditEvent[]>;
  requestAccountingCorrection: (input: { entityType: 'SALE' | 'PURCHASE' | 'JOURNAL_ENTRY' | 'BANK_MOVEMENT' | 'INVENTORY_MOVEMENT' | 'VAT_VOUCHER' | 'ISLR_VOUCHER' | 'VAT_DECLARATION' | 'ISLR_EVENT' | 'INVENTORY_PRODUCT'; entityId: string; correctionType: string; sourceDocumentRef: string; correctionDocumentRef: string; reason?: string; workpaperNote?: string }) => Promise<void>;
  createCorrectionCase: (input: { entityType: 'SALE' | 'PURCHASE' | 'JOURNAL_ENTRY' | 'INVENTORY_MOVEMENT'; entityId: string; correctionType: string; sourceDocumentRef: string; correctionDocumentRef: string; reason?: string; workpaperNote?: string }) => Promise<CorrectionCase>;
  authorizeCorrectionCase: (input: { entityType: string; entityId: string; sourceDocumentRef: string; correctionDocumentRef: string }) => Promise<string>;
  listCorrectionCases: () => Promise<CorrectionCase[]>;
  reviewCorrectionCase: (input: { caseId: string; decision: 'APPROVE' | 'REJECT'; reason: string }) => Promise<CorrectionCase>;
  observeCorrectionCase: (input: { caseId: string; reason: string }) => Promise<CorrectionCase>;
  resubmitCorrectionCase: (input: { caseId: string; reason: string }) => Promise<CorrectionCase>;
  withdrawCorrectionCase: (input: { caseId: string; reason: string }) => Promise<CorrectionCase>;
  executeCorrectionCase: (input: { caseId: string; executionRef: string; reason: string }) => Promise<CorrectionCase>;
  listSupportingDocuments: (filters: { entityType?: SupportingDocumentEntityType; entityId?: string }) => Promise<SupportingDocument[]>;
  attachSupportingDocument: (input: SupportingDocumentDraft) => Promise<{ ok: boolean; canceled?: boolean; document?: Pick<SupportingDocument, 'id' | 'companyId' | 'entityType' | 'entityId' | 'documentType' | 'title' | 'fileName' | 'mimeType' | 'sha256' | 'byteSize' | 'status' | 'createdAt'> }>;
  reviewSupportingDocument: (input: { documentId: string; decision: 'VERIFIED' | 'OBSERVATION_REQUIRED'; reason: string }) => Promise<{ ok: boolean; documentId: string; status: string }>;
  openSupportingDocument: (documentId: string) => Promise<{ ok: boolean }>;
  listVatFiscalIncidents: () => Promise<VatFiscalIncident[]>;
  createVatFiscalIncident: (input: VatFiscalIncidentCreateInput) => Promise<VatFiscalIncident>;
  recordVatFiscalIncidentEvent: (input: VatFiscalIncidentEventInput) => Promise<VatFiscalIncident>;
  waitForPersistence: () => Promise<void>;
  companies: Company[];
  isStorageReady: boolean;
  storageError: string | null;
  currentCompany: Company;
  setCurrentCompanyId: (id: string) => void;
  addCompany: (comp: Omit<Company, 'id'>) => Company;
  updateCompany: (comp: Company) => void;
  updateBcvRate: (newRate: number, effectiveDate?: string) => void;
  correctBcvRate: (input: { newRate: number; effectiveDate: string; reason: string; workpaperNote?: string }) => Promise<void>;

  // Cuentas
  accounts: Account[];
  addAccount: (account: Account) => void;
  setAccountCashFlowActivity: (accountCode: string, activity: CashFlowActivity) => void;
  setAccountCashFlowIndirectTreatment: (accountCode: string, treatment: CashFlowIndirectTreatment) => void;

  // Asientos
  journalEntries: JournalEntry[];
  addJournalEntry: (entry: Omit<JournalEntry, 'id' | 'companyId' | 'createdAt'>, accountCatalog?: Account[], targetCompanyId?: string) => JournalEntry;
  deleteJournalEntry: (id: string) => void;
  reverseJournalEntry: (id: string, effectiveDate: string, reason: string, workpaperNote?: string, priorPeriodAdjustment?: boolean, retainedEarningsAccountCode?: string) => Promise<JournalEntry>;
  closeAccountingPeriod: (closedThroughDate: string) => Promise<void>;
  reopenAccountingPeriod: (reopenedThroughDate: string | null, reason: string) => Promise<void>;
  createAccountingYearOpening: (input: { periodStartDate: string; periodEndDate: string; openingDate: string; bcvRate: number; retainedEarningsAccountCode?: string }) => Promise<JournalEntry>;

  // Liquidaciones de crédito
  creditSettlements: CreditSettlement[];
  getCreditBalance: (documentId: string, kind: 'SALE_COLLECTION' | 'PURCHASE_PAYMENT') => CreditBalance;
  addCreditSettlement: (draft: CreditSettlementDraft) => Promise<CreditSettlement>;
  getSupplierAdvanceBalance: (supplierRif: string) => SupplierAdvanceBalance;
  supplierAdvanceSettlements: SupplierAdvanceSettlement[];
  addSupplierAdvanceSettlement: (draft: SupplierAdvanceSettlementDraft) => Promise<SupplierAdvanceSettlement>;
  supplierDirectAdvances: SupplierDirectAdvance[];
  addSupplierDirectAdvance: (draft: SupplierDirectAdvanceDraft) => Promise<SupplierDirectAdvance>;

  // Compras
  purchases: PurchaseRecord[];
  addPurchase: (purchase: Omit<PurchaseRecord, 'id' | 'companyId' | 'opNumber'>, targetCompanyId?: string) => PurchaseRecord;
  addPurchaseCreditNote: (request: PurchaseCreditNoteRequest) => Promise<PurchaseRecord>;
  addPurchaseServiceCreditNote: (draft: Omit<PurchaseServiceCreditNoteRequest, 'purchase' | 'priorCreditNotes' | 'closedThroughDate'> & { purchaseId: string }) => Promise<PurchaseRecord>;
  addSupplierDebitNote: (draft: Omit<SupplierDebitNoteAccountingDraft, 'companyId' | 'closedThroughDate'>) => Promise<PurchaseRecord>;
  deletePurchase: (id: string) => void;

  // Ventas
  sales: SaleRecord[];
  addSale: (sale: Omit<SaleRecord, 'id' | 'companyId' | 'opNumber'>, targetCompanyId?: string) => SaleRecord;
  addSaleCorrectionNote: (draft: Omit<SaleCorrectionNoteRequest, 'sourceSale' | 'priorCreditNotes' | 'closedThroughDate'> & { sourceSaleId: string }) => Promise<SaleRecord>;
  deleteSale: (id: string) => void;
  runAtomicInvoiceImport: <T>(operation: () => T) => T;
  runAtomicInvoiceImportAndWait: <T>(operation: () => T) => Promise<T>;
  addImportedCreditSettlements: (drafts: UniversalCreditSettlementDraft[], documents: Array<SaleRecord | PurchaseRecord>, targetCompanyId?: string) => CreditSettlement[];

  // Inventario
  products: InventoryProduct[];
  addProduct: (product: Omit<InventoryProduct, 'id' | 'companyId'>) => InventoryProduct;
  getCompanyInventoryProducts: (companyId: string) => InventoryProduct[];
  getCompanyInventoryMovements: (companyId: string) => InventoryMovement[];
  importInventoryProducts: (products: Omit<InventoryProduct, 'id' | 'companyId'>[], targetCompanyId?: string) => Promise<number>;
  importInventoryMovements: (movements: InventoryMovementImportDraft[], targetCompanyId?: string) => number;
  executeProduction: (finishedProductId: string, outputQuantity: number, date: string, bcvRate: number, documentRef: string) => Promise<InventoryMovement[]>;
  updateProduct: (product: InventoryProduct, reason: string, workpaperNote: string) => Promise<void>;
  movements: InventoryMovement[];
  addMovement: (movement: Omit<InventoryMovement, 'id' | 'companyId'>) => InventoryMovement;

  // Notas y revelaciones de estados financieros
  financialDisclosures: FinancialDisclosure[];
  saveFinancialDisclosure: (draft: Omit<FinancialDisclosure, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>) => Promise<FinancialDisclosure>;

  // Retenciones
  vatVouchers: VatRetentionVoucher[];
  vatWithholdingDeclarations: VatWithholdingDeclaration[];
  vatWithholdingDeclarationEvents: VatWithholdingDeclarationEvent[];
  createVatWithholdingDeclaration: (input: { year: number; month: number; window: VatDeclarationWindow; zeroOperations?: boolean; legacyFiscalDates?: Record<string, { fiscalDate: string; note: string }> }) => Promise<VatWithholdingDeclaration>;
  recordVatWithholdingDeclarationEvent: (declarationId: string, draft: Omit<VatWithholdingDeclarationEvent, 'id' | 'declarationId' | 'recordedAt'>) => Promise<VatWithholdingDeclarationEvent>;
  islrVouchers: IslrRetentionVoucher[];
  islrFiscalEvents: IslrFiscalEvent[];
  deleteVatVoucher: (id: string) => void;
  recordVatVoucherDelivery: (id: string, draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }) => Promise<VatRetentionVoucher>;
  recordIslrVoucherDelivery: (id: string, draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }) => Promise<IslrRetentionVoucher>;
  deleteIslrVoucher: (id: string) => void;

  // Conciliación Bancaria
  bankAccounts: BankAccount[];
  bankStatementMovements: BankStatementMovement[];
  addBankAccount: (bank: Omit<BankAccount, 'id' | 'companyId' | 'accountCode'> & { bcvRate?: number }) => BankAccount;
  registerTreasuryMovement: (draft: { bankAccountId: string; date: string; reference: string; description: string; type: 'INCOME' | 'EXPENSE' | 'TRANSFER'; amount: number; bcvRate: number; counterpartAccountCode?: string; destinationBankAccountId?: string }) => JournalEntry;
  addBankStatementMovement: (movement: Omit<BankStatementMovement, 'id' | 'companyId'>) => BankStatementMovement;
  addBankStatementMovements: (movements: Array<{ bankAccountId: string; date: string; reference: string; description: string; type: 'DEBIT' | 'CREDIT'; amountBs: number; amountUsd: number; bcvRate: number; bcvRateEffectiveDate: string }>) => Promise<BankStatementMovement[]>;
  deleteBankStatementMovement: (id: string) => void;
  reconcileMovementManual: (statementMovementId: string, journalEntryId: string) => void;
  unreconcileMovement: (statementMovementId: string) => void;
  runAutoReconciliation: (bankAccountId: string) => { matchedCount: number; matchedRefs: string[] };
  unreconcileAll: (bankAccountId: string) => void;
  createAdjustingEntryForBankMovement: (statementMovement: BankStatementMovement, expenseOrIncomeAccountCode: string) => JournalEntry;

  // Moneda activa de visualización
  displayCurrency: 'BS' | 'USD' | 'DUAL';
  setDisplayCurrency: (curr: 'BS' | 'USD' | 'DUAL') => void;

  // Respaldo
  resetToSampleData: () => Promise<void>;
  resetFactoryData: () => Promise<void>;
  exportBackupJson: () => string;
  restoreBackupJson: (jsonData: string) => Promise<boolean>;
}

const AccountingContext = createContext<AccountingContextType | undefined>(undefined);

const STORAGE_KEY = 'sicoven_accounting_data_v1';
// En escritorio, SQLite es la única fuente operativa; localStorage se reserva
// para la vista web de desarrollo y nunca inicializa datos del instalador.
const readBrowserStorage = (key: string): string | null => {
  if (typeof window !== 'undefined' && window.sicovenStore) return null;
  try { return localStorage.getItem(key); } catch { return null; }
};

export const AccountingProvider: React.FC<{ children: React.ReactNode; token: string }> = ({ children, token }) => {
  // Cargar estado inicial desde localStorage o valores por defecto
  const [companies, setCompanies] = useState<Company[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_companies`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [currentCompanyId, setCurrentCompanyId] = useState<string>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_currentCompanyId`);
      return saved && companies.some(c => c.id === saved) ? saved : companies[0]?.id || '';
    } catch {
      return 'comp-1';
    }
  });

  const [accounts, setAccounts] = useState<Account[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_accounts`);
      if (!saved) return DEFAULT_CHART_OF_ACCOUNTS;
      const existing: Account[] = JSON.parse(saved);
      // Migración aditiva segura: incorpora cuentas base nuevas sin borrar cuentas personalizadas.
      const existingCodes = new Set(existing.map(account => account.code));
      const missingDefaults = DEFAULT_CHART_OF_ACCOUNTS.filter(account => !existingCodes.has(account.code));
      return [...existing, ...missingDefaults];
    } catch {
      return DEFAULT_CHART_OF_ACCOUNTS;
    }
  });

  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_journal`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [purchases, setPurchases] = useState<PurchaseRecord[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_purchases`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [sales, setSales] = useState<SaleRecord[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_sales`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [products, setProducts] = useState<InventoryProduct[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_products`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [movements, setMovements] = useState<InventoryMovement[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_movements`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [vatVouchers, setVatVouchers] = useState<VatRetentionVoucher[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_vatVouchers`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [vatWithholdingDeclarations, setVatWithholdingDeclarations] = useState<VatWithholdingDeclaration[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_vatWithholdingDeclarations`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [vatWithholdingDeclarationEvents, setVatWithholdingDeclarationEvents] = useState<VatWithholdingDeclarationEvent[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_vatWithholdingDeclarationEvents`);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });

  const [islrVouchers, setIslrVouchers] = useState<IslrRetentionVoucher[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_islrVouchers`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_bankAccounts`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [bankStatementMovements, setBankStatementMovements] = useState<BankStatementMovement[]>(() => {
    try {
      const saved = readBrowserStorage(`${STORAGE_KEY}_statementMovements`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [creditSettlements, setCreditSettlements] = useState<CreditSettlement[]>([]);
  const [islrFiscalEvents, setIslrFiscalEvents] = useState<IslrFiscalEvent[]>([]);
  const [financialDisclosures, setFinancialDisclosures] = useState<FinancialDisclosure[]>([]);
  const [supplierAdvanceSettlements, setSupplierAdvanceSettlements] = useState<SupplierAdvanceSettlement[]>([]);
  const [supplierDirectAdvances, setSupplierDirectAdvances] = useState<SupplierDirectAdvance[]>([]);
  const bankStatementImportInFlightRef = useRef(false);
  type PendingBankOutgoingReservation = { release: () => void; waiter: { resolve: () => void; reject: (error: Error) => void } };
  type ActiveAccountingImportBatch = { journalEntries: JournalEntry[]; sales: SaleRecord[]; purchases: PurchaseRecord[]; reservedBankLockKeys: Set<string> };
  const bankOutgoingReservationsRef = useRef<PendingBankOutgoingReservation[]>([]);
  const activeImportBatchRef = useRef<ActiveAccountingImportBatch | null>(null);
  const settlementInFlightRef = useRef<Set<string>>(new Set());
  const supplierAdvanceSettlementInFlightRef = useRef<Set<string>>(new Set());
  const supplierDirectAdvanceInFlightRef = useRef<Set<string>>(new Set());
  // Evita dos enteramientos simultáneos sobre la misma declaración usando el mismo snapshot React.
  const vatPaymentInFlightRef = useRef<Set<string>>(new Set());
  const vatDeclarationCreationInFlightRef = useRef<Set<string>>(new Set());
  // Los importadores pueden registrar varias facturas en el mismo ciclo de React;
  // estos contadores evitan reutilizar correlativos e identificadores por estado obsoleto.
  const runAtomicInvoiceImport = <T,>(operation: () => T): T => {
    const reservationsBefore = new Set(bankOutgoingReservationsRef.current);
    // React setters are queued synchronously; capture the complete persisted
    // snapshot so a synchronous import failure cannot leak partial state.
    const before = {
      companies, currentCompanyId, displayCurrency,
      accounts, bankAccounts, bankStatementMovements, creditSettlements,
      financialDisclosures, islrFiscalEvents, islrVouchers, journalEntries,
      purchases, sales, products, movements, supplierAdvanceSettlements,
      supplierDirectAdvances, vatVouchers, vatWithholdingDeclarations,
      vatWithholdingDeclarationEvents,
      saleSequence: { ...saleSequenceRef.current },
      purchaseSequence: { ...purchaseSequenceRef.current },
      journalSequence: { ...journalSequenceRef.current },
      vatSequence: { ...vatVoucherSequenceRef.current },
      islrSequence: { ...islrVoucherSequenceRef.current },
      islrEventSequence: { ...islrEventSequenceRef.current }
    };
    const rollback = (error: unknown): never => {
      // If the batch is rolled back before its state reaches the persistence effect,
      // release only reservations created by this batch and remove their waiters.
      bankOutgoingReservationsRef.current
        .filter(reservation => !reservationsBefore.has(reservation))
        .forEach(reservation => {
          persistenceWaitersRef.current = persistenceWaitersRef.current.filter(waiter => waiter !== reservation.waiter);
          reservation.release();
        });
      setCompanies(before.companies);
      setCurrentCompanyId(before.currentCompanyId);
      setDisplayCurrency(before.displayCurrency);
      setAccounts(before.accounts);
      setBankAccounts(before.bankAccounts);
      setBankStatementMovements(before.bankStatementMovements);
      setCreditSettlements(before.creditSettlements);
      setFinancialDisclosures(before.financialDisclosures);
      setIslrFiscalEvents(before.islrFiscalEvents);
      setIslrVouchers(before.islrVouchers);
      setJournalEntries(before.journalEntries);
      setPurchases(before.purchases);
      setSales(before.sales);
      setProducts(before.products);
      setMovements(before.movements);
      setSupplierAdvanceSettlements(before.supplierAdvanceSettlements);
      setSupplierDirectAdvances(before.supplierDirectAdvances);
      setVatVouchers(before.vatVouchers);
      setVatWithholdingDeclarations(before.vatWithholdingDeclarations);
      setVatWithholdingDeclarationEvents(before.vatWithholdingDeclarationEvents);
      saleSequenceRef.current = before.saleSequence;
      purchaseSequenceRef.current = before.purchaseSequence;
      journalSequenceRef.current = before.journalSequence;
      vatVoucherSequenceRef.current = before.vatSequence;
      islrVoucherSequenceRef.current = before.islrSequence;
      islrEventSequenceRef.current = before.islrEventSequence;
      throw error;
    };
    if (activeImportBatchRef.current) {
      throw new Error('No se permiten importaciones contables anidadas.');
    }
    const previousBatch = activeImportBatchRef.current;
    activeImportBatchRef.current = { journalEntries: [], sales: [], purchases: [], reservedBankLockKeys: new Set<string>() };
    try {
      const result = operation();
      activeImportBatchRef.current = previousBatch;
      if (result && typeof (result as any).then === 'function') {
        // Async operations may publish functional React updates while the shared
        // SQLite snapshot queue is pending. If persistence rejects, the provider
        // fails closed and requires a restart to reload the last committed database.
        // Never restore whole snapshots or sequence maps here: concurrent operations
        // may have been applied while SQLite was pending. A harmless sequence gap is
        // preferable to erasing another operation or reusing a document number.
        return result;
      }
      return result;
    } catch (error) {
      activeImportBatchRef.current = previousBatch;
      return rollback(error);
    }
  };

  const saleSequenceRef = useRef<Record<string, number>>({});
  const purchaseSequenceRef = useRef<Record<string, number>>({});
  const journalSequenceRef = useRef<Record<string, number>>({});
  const vatVoucherSequenceRef = useRef<Record<string, number>>({});
  const islrVoucherSequenceRef = useRef<Record<string, number>>({});
  const islrEventSequenceRef = useRef<Record<string, number>>({});
  const [displayCurrency, setDisplayCurrency] = useState<'BS' | 'USD' | 'DUAL'>('DUAL');
  // El acceso de prueba se controla por la licencia de 24 horas, nunca por cantidad de acciones.
  // Se conserva este punto de compatibilidad para las operaciones existentes sin bloquearlas.

  const currentCompany: Company = companies.find(c => c.id === currentCompanyId) || companies[0] || {
    id: '', rif: '', name: 'Registre una empresa para comenzar', address: '', phone: '', email: '',
    taxpayerType: 'ORDINARIO', defaultIvaRetentionRate: 0, fiscalYear: new Date().getFullYear(), bcvRate: 0
  };

  const assertSQLitePersistenceReady = (operation: string): void => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error(operation + ' requiere SQLite local de escritorio disponible y confirmada. No se modificaron los datos.');
    }
  };

  const updateCompany = (updated: Company) => {
    assertSQLitePersistenceReady('Actualizar la empresa');
    setCompanies(prev => prev.map(c => (c.id === updated.id ? updated : c)));
  };

  const waitForPersistence = (): Promise<void> => {
    if (persistenceFaultRef.current) return Promise.reject(new Error('La persistencia SQLite falló. SICOVEN bloqueó las operaciones; cierre y vuelva a abrir la aplicación.'));
    if (window.sicovenStore && !storageReady) return Promise.reject(new Error('SQLite todavía no está lista.'));
    return new Promise<void>((resolve, reject) => persistenceWaitersRef.current.push({ resolve, reject }));
  };

  const runAtomicInvoiceImportAndWait = async <T,>(operation: () => T): Promise<T> => {
    const result = runAtomicInvoiceImport(operation);
    if (result && typeof (result as any).then === 'function') {
      throw new Error('El lote de importación debe ser síncrono; las operaciones asíncronas no pueden compartir una confirmación atómica.');
    }
    await waitForPersistence();
    return result;
  };

  // Reserva las cuentas bancarias acreditadas por el asiento hasta que el snapshot
  // completo reciba confirmación (o rechazo) de SQLite. La reserva es síncrona:
  // evita que dos eventos del renderer validen el mismo saldo desactualizado.
  const reserveBankOutgoingAccounts = (companyId: string, items: JournalEntryItem[]): void => {
    const creditedAccountCodes = new Set(items
      .filter(item => Number(item.creditBs || 0) > 0 || Number(item.creditUsd || 0) > 0)
      .map(item => item.accountCode));
    const lockKeys = [...new Set(bankAccounts
      .filter(bank => bank.companyId === companyId && creditedAccountCodes.has(bank.accountCode))
      .map(bank => `${companyId}:${bank.id}`))];
    if (!lockKeys.length) return;
    const activeBatch = activeImportBatchRef.current;
    const lockKeysToAcquire = lockKeys.filter(key => !activeBatch?.reservedBankLockKeys.has(key));
    if (!lockKeysToAcquire.length) return;

    const releases: Array<() => void> = [];
    try {
      for (const key of lockKeysToAcquire) releases.push(bankOutgoingLockRef.current.acquire(key));
    } catch (error) {
      releases.forEach(release => release());
      throw error;
    }
    if (activeBatch) lockKeysToAcquire.forEach(key => activeBatch.reservedBankLockKeys.add(key));

    let released = false;
    let reservation: PendingBankOutgoingReservation;
    const releaseAll = (): void => {
      if (released) return;
      released = true;
      releases.forEach(release => release());
      bankOutgoingReservationsRef.current = bankOutgoingReservationsRef.current.filter(item => item !== reservation);
    };
    const waiter = { resolve: releaseAll, reject: releaseAll };
    reservation = { release: releaseAll, waiter };
    bankOutgoingReservationsRef.current.push(reservation);
    // El efecto de persistencia resuelve o rechaza este waiter solo después de
    // finalizar la transacción SQLite del snapshot que contiene el movimiento.
    persistenceWaitersRef.current.push(waiter);
  };

  type CorrectionAuditInput = {
    eventType: 'accounting_correction_requested' | 'accounting_correction_executed';
    entityType: 'SALE' | 'PURCHASE' | 'JOURNAL_ENTRY' | 'BANK_MOVEMENT' | 'INVENTORY_MOVEMENT' | 'VAT_VOUCHER' | 'ISLR_VOUCHER' | 'VAT_DECLARATION' | 'ISLR_EVENT' | 'BCV_RATE' | 'INVENTORY_PRODUCT';
    companyId: string; entityId: string; correctionType: string; sourceDocumentRef: string;
    correctionDocumentRef: string; reason?: string; workpaperNote?: string; journalEntryId?: string;
    fiscalEmissionMedium?: 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY'; sameMediumAsOriginal?: boolean;
  };
  const recordCorrectionAudit = async (input: CorrectionAuditInput): Promise<void> => {
    const store = window.sicovenStore as typeof window.sicovenStore & {
      recordAuditCorrection?: (sessionToken: string, event: CorrectionAuditInput) => Promise<{ ok: boolean; message?: string; id?: number }>;
    };
    if (!store?.recordAuditCorrection) throw new Error('La auditoría local de correcciones no está disponible. No se ejecutó la operación.');
    const result = await store.recordAuditCorrection(token, {...input,reason:String(input.reason || 'Corrección contable'),workpaperNote:String(input.workpaperNote || '')});
    if (!result?.ok) throw new Error(result?.message || 'SQLite no pudo registrar la autorización de la corrección.');
  };

  const requireApprovedCorrectionCase = async (
    entityType: string, entityId: string, sourceDocumentRef: string, correctionDocumentRef: string
  ): Promise<string> => {
    const store = window.sicovenStore as typeof window.sicovenStore & {
      authorizeCorrectionCase?: (sessionToken:string,payload:Record<string,string>)=>Promise<{ok:boolean;caseId?:string;message?:string}>
    };
    if (!store?.authorizeCorrectionCase) throw new Error('La validación de integridad de la corrección no está disponible. No se ejecutó la operación.');
    const result = await store.authorizeCorrectionCase(token,{
      companyId:currentCompany.id,entityType,entityId,sourceDocumentRef,correctionDocumentRef
    });
    if (!result?.ok || !result.caseId) throw new Error(result?.message || 'No existe una corrección directa habilitada para este registro.');
    if (entityType === 'INVENTORY_MOVEMENT') {
      inventoryCorrectionAuthorizationRef.current = String(entityId) + '|' + String(correctionDocumentRef).trim();
    }
    if (entityType === 'JOURNAL_ENTRY') {
      journalCorrectionAuthorizationRef.current = String(entityId) + '|' + String(correctionDocumentRef).trim();
    }
    return String(result.caseId);
  };
  const authorizeCorrectionCase = async (input: {entityType:string;entityId:string;sourceDocumentRef:string;correctionDocumentRef:string}): Promise<string> => {
    return requireApprovedCorrectionCase(input.entityType,input.entityId,input.sourceDocumentRef,input.correctionDocumentRef);
  };
  const createCorrectionCase = async (input: {entityType:string;entityId:string;correctionType:string;sourceDocumentRef:string;correctionDocumentRef:string;reason?:string;workpaperNote?:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { createCorrectionCase?: (sessionToken:string,payload:Record<string,string>)=>Promise<CorrectionCase> };
    if (!store?.createCorrectionCase) throw new Error('El registro formal de expedientes requiere la edición de escritorio.');
    return store.createCorrectionCase(token,{entityType:input.entityType,entityId:input.entityId,correctionType:input.correctionType,sourceDocumentRef:input.sourceDocumentRef,correctionDocumentRef:input.correctionDocumentRef,reason:String(input.reason || ''),workpaperNote:String(input.workpaperNote || ''),companyId:currentCompany.id});
  };
  const listCorrectionCases = useCallback(async (): Promise<CorrectionCase[]> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { listCorrectionCases?: (sessionToken: string, companyId: string) => Promise<CorrectionCase[]> };
    if (!store?.listCorrectionCases) throw new Error('El expediente de correcciones requiere la edición de escritorio.');
    return store.listCorrectionCases(token,currentCompany.id);
  },[token,currentCompany.id]);
  const reviewCorrectionCase = async (input: {caseId:string;decision:'APPROVE'|'REJECT';reason:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { reviewCorrectionCase?: (sessionToken:string,payload:typeof input)=>Promise<CorrectionCase> };
    if (!store?.reviewCorrectionCase) throw new Error('La revisión de expedientes no está disponible.');
    return store.reviewCorrectionCase(token,input);
  };
  const observeCorrectionCase = async (input: {caseId:string;reason:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { observeCorrectionCase?: (sessionToken:string,payload:typeof input)=>Promise<CorrectionCase> };
    if (!store?.observeCorrectionCase) throw new Error('La observación formal de expedientes no está disponible.');
    return store.observeCorrectionCase(token,input);
  };
  const resubmitCorrectionCase = async (input: {caseId:string;reason:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { resubmitCorrectionCase?: (sessionToken:string,payload:typeof input)=>Promise<CorrectionCase> };
    if (!store?.resubmitCorrectionCase) throw new Error('La subsanación y reenvío de expedientes no está disponible.');
    return store.resubmitCorrectionCase(token,input);
  };
  const withdrawCorrectionCase = async (input: {caseId:string;reason:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { withdrawCorrectionCase?: (sessionToken:string,payload:typeof input)=>Promise<CorrectionCase> };
    if (!store?.withdrawCorrectionCase) throw new Error('El retiro controlado de expedientes no está disponible.');
    return store.withdrawCorrectionCase(token,input);
  };
  const executeCorrectionCase = async (input: {caseId:string;executionRef:string;reason:string}): Promise<CorrectionCase> => {
    const store = window.sicovenStore as typeof window.sicovenStore & { executeCorrectionCase?: (sessionToken:string,payload:typeof input)=>Promise<CorrectionCase> };
    if (!store?.executeCorrectionCase) throw new Error('La ejecución de expedientes no está disponible.');
    return store.executeCorrectionCase(token,input);
  };

  const requestAccountingCorrection = async (input: Omit<CorrectionAuditInput, 'eventType' | 'companyId'>): Promise<void> => {
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de solicitar una corrección.');
    if (!input.entityId.trim() || !input.correctionType.trim() || String(input.reason || '').length > 2000 || String(input.workpaperNote || '').length > 4000) {
      throw new Error('La corrección contiene datos inválidos o excede los límites permitidos.');
    }
    if (!window.sicovenStore || !storageReady || persistenceFaultRef.current) {
      throw new Error('SQLite no está disponible. No se registró la solicitud de corrección.');
    }
    await recordCorrectionAudit({
      ...input, eventType: 'accounting_correction_requested', companyId: currentCompany.id
    });
  };

  const getAuditEvents = useCallback(async (limit = 100): Promise<AccountingAuditEvent[]> => {
    const localStore = window.sicovenStore;
    if (!localStore?.listAuditEvents) {
      throw new Error('El historial de auditoría está disponible en la edición de escritorio con SQLite local.');
    }
    const result = await localStore.listAuditEvents(token, limit);
    if (!result.ok) throw new Error(result.message || 'No se pudo consultar el historial de auditoría local.');
    return result.events || [];
  }, [token]);

  const listSupportingDocuments = useCallback(async (filters: { entityType?: SupportingDocumentEntityType; entityId?: string }): Promise<SupportingDocument[]> => {
    if (!currentCompany.id) throw new Error('Seleccione una empresa para consultar sus soportes.');
    const store = window.sicovenStore;
    if (!store?.listSupportingDocuments) throw new Error('El archivo documental requiere la edición de escritorio con SQLite local.');
    return store.listSupportingDocuments(token, { companyId: currentCompany.id, ...filters });
  }, [token, currentCompany.id]);

  const attachSupportingDocument = useCallback(async (input: SupportingDocumentDraft) => {
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de adjuntar un soporte.');
    const store = window.sicovenStore;
    if (!store?.attachSupportingDocument) throw new Error('El archivo documental requiere la edición de escritorio con SQLite local.');
    return store.attachSupportingDocument(token, { ...input, companyId: currentCompany.id });
  }, [token, currentCompany.id]);

  const reviewSupportingDocument = useCallback(async (input: { documentId: string; decision: 'VERIFIED' | 'OBSERVATION_REQUIRED'; reason: string }) => {
    const store = window.sicovenStore;
    if (!store?.reviewSupportingDocument) throw new Error('La revisión documental requiere la edición de escritorio con SQLite local.');
    return store.reviewSupportingDocument(token, input);
  }, [token]);

  const openSupportingDocument = useCallback(async (documentId: string) => {
    const store = window.sicovenStore;
    if (!store?.openSupportingDocument) throw new Error('La apertura documental requiere la edición de escritorio con SQLite local.');
    return store.openSupportingDocument(token, documentId);
  }, [token]);

  const listVatFiscalIncidents = useCallback(async (): Promise<VatFiscalIncident[]> => {
    if (!currentCompany.id) throw new Error('Seleccione una empresa para consultar incidencias fiscales.');
    const store = window.sicovenStore;
    if (!store?.listVatFiscalIncidents) throw new Error('El expediente fiscal requiere la edición de escritorio con SQLite local.');
    return store.listVatFiscalIncidents(token, { companyId: currentCompany.id });
  }, [token, currentCompany.id]);

  const createVatFiscalIncident = useCallback(async (input: VatFiscalIncidentCreateInput): Promise<VatFiscalIncident> => {
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de registrar la incidencia.');
    const store = window.sicovenStore;
    if (!store?.createVatFiscalIncident) throw new Error('El expediente fiscal requiere la edición de escritorio con SQLite local.');
    return store.createVatFiscalIncident(token, { ...input, companyId: currentCompany.id });
  }, [token, currentCompany.id]);

  const recordVatFiscalIncidentEvent = useCallback(async (input: VatFiscalIncidentEventInput): Promise<VatFiscalIncident> => {
    const store = window.sicovenStore;
    if (!store?.recordVatFiscalIncidentEvent) throw new Error('El expediente fiscal requiere la edición de escritorio con SQLite local.');
    return store.recordVatFiscalIncidentEvent(token, input);
  }, [token]);

  const createAccountingYearOpening = async (input: {
    periodStartDate: string;
    periodEndDate: string;
    openingDate: string;
    bcvRate: number;
    retainedEarningsAccountCode?: string;
  }): Promise<JournalEntry> => {
    assertSQLitePersistenceReady('Crear asiento de apertura');
    if (yearOpeningInFlightRef.current) throw new Error('Ya hay un asiento de apertura en proceso.');
    if (persistenceFaultRef.current) throw new Error('La persistencia SQLite falló. Reinicie SICOVEN antes de continuar.');
    if (!window.sicovenStore || !storageReady) throw new Error('La apertura contable solo puede registrarse cuando SQLite de escritorio esté disponible.');
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de preparar la apertura.');
    if (!Number.isFinite(Number(input.bcvRate)) || Number(input.bcvRate) <= 0) throw new Error('Ingrese la tasa BCV aplicable al asiento de apertura.');
    if (!currentCompany.closedThroughDate || currentCompany.closedThroughDate !== input.periodEndDate) {
      throw new Error('El ejercicio debe estar cerrado exactamente hasta la fecha final indicada antes de registrar su apertura.');
    }
    const nextDay = new Date(input.periodEndDate + 'T00:00:00.000Z');
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const expectedOpeningDate = nextDay.toISOString().slice(0, 10);
    if (input.openingDate !== expectedOpeningDate) {
      throw new Error('La fecha del asiento de apertura debe ser el día inmediatamente posterior al cierre.');
    }
    yearOpeningInFlightRef.current = true;
    try {
      const items = buildOpeningEntryItems({
        companyId: currentCompany.id,
        periodStartDate: input.periodStartDate,
        periodEndDate: input.periodEndDate,
        openingDate: input.openingDate,
        accounts,
        journalEntries,
        retainedEarningsAccountCode: input.retainedEarningsAccountCode
      });
      const referenceDoc = 'APERTURA:' + currentCompany.id + ':' + input.openingDate;
      if (journalEntries.some(entry => entry.companyId === currentCompany.id &&
          (entry.type === 'APERTURA' && entry.date === input.openingDate || entry.referenceDoc === referenceDoc))) {
        throw new Error('Ya existe un asiento de apertura para esta empresa y fecha.');
      }
      const created = addJournalEntry({
        entryNumber: 0,
        date: input.openingDate,
        description: 'Asiento de apertura del ejercicio iniciado el ' + input.openingDate,
        type: 'APERTURA',
        bcvRate: Number(input.bcvRate),
        items,
        referenceDoc,
        exerciseLink: {
          priorPeriodStartDate: input.periodStartDate,
          priorPeriodEndDate: input.periodEndDate,
          nextPeriodStartDate: input.openingDate
        }
      });
      // El waiter se registra inmediatamente después del setState y antes del siguiente
      // ciclo de efectos; solo se confirma al terminar el guardado transaccional SQLite.
      await waitForPersistence();
      return created;
    } finally {
      yearOpeningInFlightRef.current = false;
    }
  };

  const closeAccountingPeriod = async (closedThroughDate: string): Promise<void> => {
    assertSQLitePersistenceReady('Cerrar el período contable');
    if (periodClosureInFlightRef.current) throw new Error('Ya hay un cierre contable en proceso.');
    if (!isValidIsoDate(closedThroughDate)) throw new Error('Indique una fecha de cierre válida.');
    const now = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (closedThroughDate > today) throw new Error('No se puede cerrar un período con fecha futura.');
    if (currentCompany.closedThroughDate && closedThroughDate < currentCompany.closedThroughDate) {
      throw new Error('El cierre es irreversible desde esta pantalla: la fecha nueva no puede retroceder. Solicite reapertura formal al administrador contable.');
    }
    const entriesToClose = journalEntries.filter(entry => entry.companyId === currentCompany.id && entry.date <= closedThroughDate);
    for (const entry of entriesToClose) {
      const debitBs = entry.items.reduce((sum, item) => sum + Number(item.debitBs || 0), 0);
      const creditBs = entry.items.reduce((sum, item) => sum + Number(item.creditBs || 0), 0);
      const debitUsd = entry.items.reduce((sum, item) => sum + Number(item.debitUsd || 0), 0);
      const creditUsd = entry.items.reduce((sum, item) => sum + Number(item.creditUsd || 0), 0);
      if (!isJournalEntryBalanced({ debitBs, creditBs, debitUsd, creditUsd })) {
        throw new Error('No se puede cerrar el período: el asiento #' + entry.entryNumber + ' no cuadra en Bs. y USD.');
      }
    }
    if (sales.some(sale => sale.companyId === currentCompany.id && sale.invoiceDate <= closedThroughDate && !sale.journalEntryId) ||
        purchases.some(purchase => purchase.companyId === currentCompany.id && purchase.invoiceDate <= closedThroughDate && !purchase.journalEntryId)) {
      throw new Error('No se puede cerrar el período: hay facturas sin asiento contable vinculado. Regularice la integridad documental primero.');
    }
    periodClosureInFlightRef.current = true;
    try {
      // Registrar el waiter antes de publicar el estado evita perder la confirmación
      // cuando React programa el efecto de persistencia en el siguiente ciclo.
      const persistenceConfirmation = waitForPersistence();
      setCompanies(prev => prev.map(company => company.id === currentCompany.id
        ? { ...company, closedThroughDate }
        : company));
      await persistenceConfirmation;
    } finally {
      periodClosureInFlightRef.current = false;
    }
  };

  const reopenAccountingPeriod = async (reopenedThroughDate: string | null, reason: string): Promise<void> => {
    assertSQLitePersistenceReady('Reabrir el período contable');
    if (periodReopeningInFlightRef.current) throw new Error('Ya hay una reapertura contable en proceso.');
    const store = window.sicovenStore;
    if (persistenceFaultRef.current || !store || !storageReady) {
      throw new Error('La reapertura formal requiere SQLite de escritorio disponible y sin errores.');
    }
    if (!currentCompany.id || !currentCompany.closedThroughDate) {
      throw new Error('La empresa seleccionada no tiene un cierre vigente para reabrir.');
    }
    const normalizedReason = String(reason || '').trim();
    if (normalizedReason.length < 10 || normalizedReason.length > 1000) {
      throw new Error('Explique el motivo de la reapertura (entre 10 y 1000 caracteres).');
    }
    if (reopenedThroughDate !== null && (!isValidIsoDate(reopenedThroughDate) ||
        reopenedThroughDate >= currentCompany.closedThroughDate)) {
      throw new Error('La nueva fecha de cierre debe ser válida y anterior al cierre vigente.');
    }
    periodReopeningInFlightRef.current = true;
    try {
      await saveQueueRef.current;
      const result = await store.reopenAccountingPeriod(token, {
        companyId: currentCompany.id,
        reopenedThroughDate,
        reason: normalizedReason
      });
      if (result?.ok !== true || !result.company) {
        throw new Error('SQLite no confirmó la reapertura contable.');
      }
      const reopenedCompany = result.company;
      const persistenceConfirmation = waitForPersistence();
      setCompanies(prev => prev.map(company => company.id === currentCompany.id
        ? { ...company, ...(reopenedCompany.closedThroughDate ? { closedThroughDate: reopenedCompany.closedThroughDate } : { closedThroughDate: undefined }) }
        : company));
      await persistenceConfirmation;
    } finally {
      periodReopeningInFlightRef.current = false;
    }
  };

  const reverseJournalEntry = async (
    id: string,
    effectiveDate: string,
    reason: string,
    workpaperNote = '',
    priorPeriodAdjustment = false,
    retainedEarningsAccountCode?: string
  ): Promise<JournalEntry> => {
    if (journalReversalInFlightRef.current || correctionWorkflowInFlightRef.current) throw new Error('Ya hay una corrección o reversión contable en proceso. Espere a que SQLite confirme su resultado.');
    journalReversalInFlightRef.current = true;
    correctionWorkflowInFlightRef.current = true;
    try {
    if (persistenceFaultRef.current) throw new Error('La persistencia SQLite falló. Reinicie SICOVEN antes de continuar.');
    if (!window.sicovenStore?.save || !storageReady) throw new Error('La reversión requiere SQLite local disponible y confirmada. No se permite registrar contra-asientos usando únicamente caché del navegador.');
    const source = journalEntries.find(entry => entry.id === id && entry.companyId === currentCompany.id);
    if (!source) throw new Error('No se encontró el asiento original en la empresa activa.');
    if (!Number.isFinite(Number(source.bcvRate)) || Number(source.bcvRate) <= 0) throw new Error('El asiento original no conserva una tasa BCV histórica válida. Corrija primero la tasa del documento antes de reversarlo.');
    const vatPaymentReversalBlocker = getVatPaymentJournalReversalBlocker(
      vatWithholdingDeclarationEvents, source.id
    );
    if (vatPaymentReversalBlocker) throw new Error(vatPaymentReversalBlocker);
    const directAdvanceSource = supplierDirectAdvances.find(item =>
      item.companyId === currentCompany.id && item.journalEntryId === source.id);
    if (directAdvanceSource && supplierAdvanceSettlements.some(item =>
      item.companyId === currentCompany.id && !item.isReversed &&
      (item.sourceDirectAdvanceIds || []).includes(directAdvanceSource.id))) {
      throw new Error('No se puede revertir el desembolso original mientras exista una aplicación o reembolso activo. Revierta primero las liquidaciones vinculadas.');
    }
    if (source.reversalOfEntryId) throw new Error('No se permite reversar un asiento que ya es un contra-asiento.');
    if (source.reversedByEntryId || journalEntries.some(entry => entry.companyId === currentCompany.id && entry.reversalOfEntryId === id)) {
      throw new Error('Este asiento ya tiene una reversión registrada.');
    }
    if (!isValidIsoDate(effectiveDate)) throw new Error('La fecha efectiva de reversión no es válida.');
    if (effectiveDate < source.date) throw new Error('La reversión no puede tener fecha anterior al asiento original.');
    if (currentCompany.closedThroughDate && effectiveDate <= currentCompany.closedThroughDate) {
      throw new Error('La reversión debe registrarse después del último día cerrado (' + currentCompany.closedThroughDate + ').');
    }
    const correctionReason = String(reason || '').trim() || 'Corrección contable';
    if (correctionReason.length > 2000 || workpaperNote.trim().length > 4000) throw new Error('El motivo o la nota exceden el máximo permitido.');
    const assessment = assessJournalReversal({
      companyId: currentCompany.id, source, accounts, sales, purchases, movements, products,
      journalEntries, bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements,
      priorPeriodAdjustment, retainedEarningsAccountCode
    });
    if (!assessment.ready) {
      throw new Error('Reversión bloqueada por el análisis integral: ' + assessment.blockers.join(' '));
    }
    const linkedSale = assessment.linkedSale;
    const linkedPurchase = assessment.linkedPurchase;
    const sourceInClosedPeriod = Boolean(currentCompany.closedThroughDate && source.date <= currentCompany.closedThroughDate);
    if (sourceInClosedPeriod && !priorPeriodAdjustment) {
      throw new Error('El asiento pertenece a un período cerrado. Debe usar Ajuste de Ejercicio Anterior (AIA).');
    }
    if (priorPeriodAdjustment && !sourceInClosedPeriod) {
      throw new Error('AIA solo se permite para asientos de un período ya cerrado.');
    }
    const reversedItems = buildReversalItems(source, accounts, priorPeriodAdjustment, retainedEarningsAccountCode);
    const totalDebitBs = reversedItems.reduce((sum, item) => sum + item.debitBs, 0);
    const totalCreditBs = reversedItems.reduce((sum, item) => sum + item.creditBs, 0);
    const totalDebitUsd = reversedItems.reduce((sum, item) => sum + item.debitUsd, 0);
    const totalCreditUsd = reversedItems.reduce((sum, item) => sum + item.creditUsd, 0);
    if (!isJournalEntryBalanced({ debitBs: totalDebitBs, creditBs: totalCreditBs, debitUsd: totalDebitUsd, creditUsd: totalCreditUsd })) {
      throw new Error('La vista previa de reversión no cuadra en Bs. y USD; no se registró ningún cambio.');
    }
    const bankReadiness = validateBankStatementReversal({
      companyId: currentCompany.id,
      source,
      reversalItems: reversedItems,
      bankAccounts,
      statementMovements: bankStatementMovements
    });
    if (!bankReadiness.ready) {
      throw new Error('Reversión bancaria bloqueada: ' + (bankReadiness.reason || 'no existe una contrapartida bancaria verificable.') +
        ' No se registró ningún contra-asiento.');
    }
    const correctionCaseId = await authorizeCorrectionCase({entityType:'JOURNAL_ENTRY',entityId:source.id,sourceDocumentRef:source.referenceDoc || String(source.entryNumber),correctionDocumentRef:'REV-' + source.entryNumber});
    await recordCorrectionAudit({
      eventType: 'accounting_correction_requested', entityType: 'JOURNAL_ENTRY', companyId: currentCompany.id,
      entityId: source.id, correctionType: priorPeriodAdjustment ? 'PRIOR_PERIOD_ADJUSTMENT_REVERSAL' : 'JOURNAL_REVERSAL',
      sourceDocumentRef: source.referenceDoc || String(source.entryNumber),
      correctionDocumentRef: 'REV-' + source.entryNumber, reason: correctionReason, workpaperNote: workpaperNote.trim()
    });
    let resolvePersistence!: () => void;
    let rejectPersistence!: (error: Error) => void;
    const persistenceConfirmation = new Promise<void>((resolve, reject) => {
      resolvePersistence = resolve;
      rejectPersistence = reject;
    });
    const persistenceWaiter = { resolve: resolvePersistence, reject: rejectPersistence };
    persistenceWaitersRef.current.push(persistenceWaiter);
    let reversal: JournalEntry;
    try {
      reversal = addJournalEntry({
      entryNumber: 0, // addJournalEntry asigna el siguiente correlativo inmutable.
      date: effectiveDate,
      description: (priorPeriodAdjustment ? 'AIA / ' : 'REVERSIÓN / ') + source.description + ' · ' + correctionReason,
      type: 'AJUSTE',
      bcvRate: Number(source.bcvRate),
      items: reversedItems,
      referenceDoc: 'REV-' + source.entryNumber,
      reversalOfEntryId: source.id,
      reversalReason: correctionReason,
      workpaperNote: workpaperNote.trim(),
      priorPeriodAdjustment
      });
    } catch (error) {
      persistenceWaitersRef.current = persistenceWaitersRef.current.filter(waiter => waiter !== persistenceWaiter);
      throw error;
    }
    // El asiento fuente no se modifica: el vínculo se deriva del contra-asiento
    // mediante reversalOfEntryId, preservando el registro original.
    setSales(prev => prev.map(sale => sale.companyId === currentCompany.id && (sale.journalEntryId === source.id || (source.type === 'VENTA' && source.referenceDoc === 'FAC-' + sale.invoiceNumber))
      ? { ...sale, journalEntryId: sale.journalEntryId || source.id, isCancelled: true, cancelledByJournalEntryId: reversal.id, cancellationReason: correctionReason, cancellationNote: workpaperNote.trim() }
      : sale));
    setPurchases(prev => prev.map(purchase => purchase.companyId === currentCompany.id && (purchase.journalEntryId === source.id || (source.type === 'COMPRA' && source.referenceDoc === 'FAC-' + purchase.invoiceNumber))
      ? { ...purchase, journalEntryId: purchase.journalEntryId || source.id, isCancelled: true, cancelledByJournalEntryId: reversal.id, cancellationReason: correctionReason, cancellationNote: workpaperNote.trim() }
      : purchase));
    if (linkedPurchase) {
      setVatVouchers(prev => prev.map(voucher => voucher.purchaseRecordId === linkedPurchase.id
        ? { ...voucher, requiresFiscalCorrection: true, correctionEntryId: reversal.id,
          correctionEntryIds: [...new Set([...(voucher.correctionEntryIds || (voucher.correctionEntryId ? [voucher.correctionEntryId] : [])), reversal.id])],
          correctionNote: [voucher.correctionNote, correctionReason].filter(Boolean).join(' | ') }
        : voucher));
      setIslrVouchers(prev => prev.map(voucher => voucher.id === 'vouch-islr-' + linkedPurchase.id
        ? { ...voucher, requiresFiscalCorrection: true, correctionEntryId: reversal.id,
          correctionEntryIds: [...new Set([...(voucher.correctionEntryIds || (voucher.correctionEntryId ? [voucher.correctionEntryId] : [])), reversal.id])],
          correctionNote: [voucher.correctionNote, correctionReason].filter(Boolean).join(' | ') }
        : voucher));
    }
    setCreditSettlements(prev => prev.map(settlement => settlement.companyId === currentCompany.id && settlement.journalEntryId === source.id
      ? { ...settlement, isReversed: true, reversedByJournalEntryId: reversal.id }
      : settlement));
    setSupplierAdvanceSettlements(prev => prev.map(settlement => settlement.companyId === currentCompany.id && settlement.journalEntryId === source.id
      ? { ...settlement, isReversed: true, reversedByJournalEntryId: reversal.id }
      : settlement));
    setSupplierDirectAdvances(prev => prev.map(advance => advance.companyId === currentCompany.id && advance.journalEntryId === source.id
      ? { ...advance, isReversed: true, reversedByJournalEntryId: reversal.id }
      : advance));
    if (bankReadiness.pairs.length > 0) {
      const reconciledAt = new Date().toISOString();
      const pairByOriginal = new Map(bankReadiness.pairs.map(pair => [pair.originalStatementId, pair]));
      const pairByReversal = new Map(bankReadiness.pairs.map(pair => [pair.reversalStatementId, pair]));
      setBankStatementMovements(prev => prev.map(statement => {
        if (pairByOriginal.has(statement.id)) {
          return {
            ...statement, isReconciled: true, reconciledWithJournalEntryId: source.id,
            reconciledJournalEntryIds: [...new Set([...(statement.reconciledJournalEntryIds || []), source.id])],
            matchedBy: statement.matchedBy || 'MANUAL', reconciledAt: statement.reconciledAt || reconciledAt
          };
        }
        if (pairByReversal.has(statement.id)) {
          return {
            ...statement, isReconciled: true, reconciledWithJournalEntryId: reversal.id,
            reconciledJournalEntryIds: [...new Set([...(statement.reconciledJournalEntryIds || []), reversal.id])],
            matchedBy: 'MANUAL', reconciledAt
          };
        }
        return statement;
      }));
    }
    await persistenceConfirmation;
    try {
      await recordCorrectionAudit({
        eventType: 'accounting_correction_executed', entityType: 'JOURNAL_ENTRY', companyId: currentCompany.id,
        entityId: source.id, correctionType: priorPeriodAdjustment ? 'PRIOR_PERIOD_ADJUSTMENT_REVERSAL' : 'JOURNAL_REVERSAL',
        sourceDocumentRef: source.referenceDoc || String(source.entryNumber),
        correctionDocumentRef: 'REV-' + source.entryNumber, reason: correctionReason,
        workpaperNote: workpaperNote.trim(), journalEntryId: reversal.id
      });
    } catch (auditError) {
      throw new Error('El contra-asiento quedó guardado en SQLite, pero falta el evento final de auditoría. No repita la reversión. Asiento: ' + reversal.entryNumber + '. ' + (auditError instanceof Error ? auditError.message : 'Error de auditoría.'));
    }
    try {
      await executeCorrectionCase({caseId:correctionCaseId,executionRef:'REV-' + source.entryNumber,reason:correctionReason});
    } catch (caseError) {
      throw new Error('El contra-asiento ' + reversal.entryNumber + ' quedó guardado y auditado, pero SICOVEN no pudo cerrar el historial de la corrección. No repita la reversión; actualice el Centro de Correcciones. ' + (caseError instanceof Error ? caseError.message : 'Error al cerrar el historial.'));
    }
    return reversal;
    } finally {
      journalReversalInFlightRef.current = false;
      correctionWorkflowInFlightRef.current = false;
    }
  };

  // SQLite local es la persistencia operativa en la versión de escritorio.
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  // Serializa las escrituras completas de app_state: varias actualizaciones rápidas
  // no deben competir y permitir que una instantánea antigua sobrescriba una nueva.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const persistenceFaultRef = useRef(false);
  const lastPersistedSnapshotRef = useRef<any>(null);
  const journalReversalInFlightRef = useRef(false);
  // Serializa correcciones documentales que pueden afectar simultáneamente factura,
  // asiento, auxiliares, Kardex, retenciones y conciliaciones.
  const correctionWorkflowInFlightRef = useRef(false);
  const productionInFlightRef = useRef(false);
  const periodClosureInFlightRef = useRef(false);
  const periodReopeningInFlightRef = useRef(false);
  const yearOpeningInFlightRef = useRef(false);
  const persistenceWaitersRef = useRef<Array<{ resolve: () => void; reject: (error: Error) => void }>>([]);
  // Una cuenta bancaria solo puede tener un egreso pendiente de confirmación SQLite.
  const bankOutgoingLockRef = useRef(createBankOutgoingLock());
  const stateSnapshot = {
    companies, currentCompanyId, accounts, journalEntries, purchases, sales, products, movements,
    vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents, islrVouchers, bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements, supplierDirectAdvances, islrFiscalEvents, financialDisclosures, displayCurrency
  };

  useEffect(() => {
    let cancelled = false;
    let initialized = false;
    const hydrate = async () => {
      try {
        if (window.sicovenStore) {
          let saved = await window.sicovenStore.load(token);
          if (cancelled) return;
          // La hidratación nunca elimina empresas ni movimientos históricos por identificadores o nombres.
          if (saved && typeof saved === 'object') {
            lastPersistedSnapshotRef.current = saved;
            if (Array.isArray(saved.companies)) setCompanies(saved.companies as Company[]);
            if (typeof saved.currentCompanyId === 'string') setCurrentCompanyId(saved.currentCompanyId);
            if (Array.isArray(saved.accounts)) {
              const savedAccounts = saved.accounts as Account[];
              const savedCodes = new Set(savedAccounts.map(account => account.code));
              // Migración compatible: incorpora cuentas nuevas de inventario sin sobrescribir el plan personalizado.
              setAccounts(removeUnusedLegacyDefaultBanks(
                [...savedAccounts, ...DEFAULT_CHART_OF_ACCOUNTS.filter(account => !savedCodes.has(account.code))],
                Array.isArray(saved.journalEntries) ? saved.journalEntries as JournalEntry[] : [],
                Array.isArray(saved.bankAccounts) ? saved.bankAccounts as BankAccount[] : []
              ).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
            }
            if (Array.isArray(saved.journalEntries)) setJournalEntries(saved.journalEntries as JournalEntry[]);
            if (Array.isArray(saved.purchases)) setPurchases(saved.purchases as PurchaseRecord[]);
            if (Array.isArray(saved.sales)) setSales(saved.sales as SaleRecord[]);
            if (Array.isArray(saved.products)) setProducts(saved.products as InventoryProduct[]);
            if (Array.isArray(saved.movements)) setMovements(saved.movements as InventoryMovement[]);
            if (Array.isArray(saved.vatVouchers)) setVatVouchers(saved.vatVouchers as VatRetentionVoucher[]);
            if (Array.isArray(saved.vatWithholdingDeclarations)) setVatWithholdingDeclarations(saved.vatWithholdingDeclarations as VatWithholdingDeclaration[]);
            if (Array.isArray(saved.vatWithholdingDeclarationEvents)) setVatWithholdingDeclarationEvents(saved.vatWithholdingDeclarationEvents as VatWithholdingDeclarationEvent[]);
            if (Array.isArray(saved.islrVouchers)) setIslrVouchers(saved.islrVouchers as IslrRetentionVoucher[]);
            if (Array.isArray(saved.bankAccounts)) setBankAccounts(saved.bankAccounts as BankAccount[]);
            if (Array.isArray(saved.bankStatementMovements)) setBankStatementMovements(saved.bankStatementMovements as BankStatementMovement[]);
            if (Array.isArray(saved.creditSettlements)) setCreditSettlements(saved.creditSettlements as CreditSettlement[]);
            if (Array.isArray(saved.supplierAdvanceSettlements)) setSupplierAdvanceSettlements(saved.supplierAdvanceSettlements as SupplierAdvanceSettlement[]);
            if (Array.isArray(saved.supplierDirectAdvances)) setSupplierDirectAdvances(saved.supplierDirectAdvances as SupplierDirectAdvance[]);
            if (Array.isArray(saved.islrFiscalEvents)) setIslrFiscalEvents(saved.islrFiscalEvents as IslrFiscalEvent[]);
            if (Array.isArray(saved.financialDisclosures)) setFinancialDisclosures(saved.financialDisclosures as FinancialDisclosure[]);
            if (saved.displayCurrency === 'BS' || saved.displayCurrency === 'USD' || saved.displayCurrency === 'DUAL') setDisplayCurrency(saved.displayCurrency);
          } else {
            // Arranque limpio sin datos ficticios para ambas ediciones (completa y DEMO)
            setCompanies([]);
            setCurrentCompanyId('');
            setAccounts(DEFAULT_CHART_OF_ACCOUNTS);
            setJournalEntries([]);
            setPurchases([]);
            setSales([]);
            setProducts([]);
            setMovements([]);
            setVatVouchers([]);
            setVatWithholdingDeclarations([]);
            setVatWithholdingDeclarationEvents([]);
            setIslrVouchers([]);
            setBankAccounts([]);
            setBankStatementMovements([]);
            setCreditSettlements([]);
            setSupplierAdvanceSettlements([]);
            setSupplierDirectAdvances([]);
            setIslrFiscalEvents([]);
            // No reutilizar stateSnapshot aquí: fue capturada antes de que React
            // aplicara los setState de limpieza y podría reintroducir datos antiguos
            // del navegador en una SQLite recién creada.
            const emptyAccountingState = {
              companies: [],
              currentCompanyId: '',
              accounts: DEFAULT_CHART_OF_ACCOUNTS,
              journalEntries: [],
              purchases: [],
              sales: [],
              products: [],
              movements: [],
              vatVouchers: [],
              vatWithholdingDeclarations: [],
              vatWithholdingDeclarationEvents: [],
              islrVouchers: [],
              bankAccounts: [],
              bankStatementMovements: [],
              creditSettlements: [],
              supplierAdvanceSettlements: [],
              supplierDirectAdvances: [],
              islrFiscalEvents: [],
              financialDisclosures: [],
              displayCurrency: 'DUAL' as const
            };
            const initialSave = await window.sicovenStore.save(token, emptyAccountingState);
            if (initialSave?.ok !== true) {
              throw new Error('SQLite no confirmó la inicialización del estado contable vacío.');
            }
            lastPersistedSnapshotRef.current = emptyAccountingState;
          }
        }
        initialized = true;
      } catch (error) {
        console.error('No se pudo inicializar la persistencia SQLite de SICOVEN:', error);
        setStorageError(error instanceof Error ? error.message : 'Error desconocido al abrir la base de datos local.');
      } finally {
        // Fail closed: si SQLite no se pudo leer/escribir, no habilitar
        // operaciones que puedan sobrescribir datos contables existentes.
        if (!cancelled && initialized) setStorageReady(true);
      }
    };
    void hydrate();
    return () => { cancelled = true; };
  // La hidratación se ejecuta una sola vez; stateSnapshot representa el legado disponible al inicio.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    const waitersForSnapshot = persistenceWaitersRef.current.splice(0);
    if (window.sicovenStore) {
      const snapshotToSave = stateSnapshot;
      const saveTask = saveQueueRef.current.then(async () => {
        if (persistenceFaultRef.current) throw new Error('La persistencia SQLite quedó bloqueada tras un fallo anterior.');
        const result = await window.sicovenStore!.save(token, snapshotToSave);
        if (result?.ok !== true) throw new Error('SQLite no confirmó el guardado del estado contable.');
        lastPersistedSnapshotRef.current = snapshotToSave;
        setStorageError(null);
      });
      saveQueueRef.current = saveTask.then(() => undefined, () => undefined);
      saveTask.then(
        () => waitersForSnapshot.forEach(waiter => waiter.resolve()),
        error => {
          const normalized = error instanceof Error ? error : new Error('Error desconocido al guardar en SQLite.');
          console.error('Error guardando los datos contables en SQLite:', normalized);
          persistenceFaultRef.current = true;
          const confirmed = lastPersistedSnapshotRef.current;
          if (confirmed) {
            // La transacción SQLite falló: regresar la interfaz al último snapshot
            // confirmado evita mostrar operaciones que nunca llegaron a la base local.
            setCompanies(confirmed.companies || []);
            setCurrentCompanyId(confirmed.currentCompanyId || confirmed.companies?.[0]?.id || '');
            const confirmedAccounts = Array.isArray(confirmed.accounts) ? confirmed.accounts : DEFAULT_CHART_OF_ACCOUNTS;
            const confirmedCodes = new Set(confirmedAccounts.map((account: Account) => account.code));
            setAccounts(removeUnusedLegacyDefaultBanks(
              [...confirmedAccounts, ...DEFAULT_CHART_OF_ACCOUNTS.filter(account => !confirmedCodes.has(account.code))],
              confirmed.journalEntries || [],
              confirmed.bankAccounts || []
            ));
            setJournalEntries(confirmed.journalEntries || []);
            setPurchases(confirmed.purchases || []);
            setSales(confirmed.sales || []);
            setProducts(confirmed.products || []);
            setMovements(confirmed.movements || []);
            setVatVouchers(confirmed.vatVouchers || []);
            setVatWithholdingDeclarations(confirmed.vatWithholdingDeclarations || []);
            setVatWithholdingDeclarationEvents(confirmed.vatWithholdingDeclarationEvents || []);
            setIslrVouchers(confirmed.islrVouchers || []);
            setBankAccounts(confirmed.bankAccounts || []);
            setBankStatementMovements(confirmed.bankStatementMovements || []);
            setCreditSettlements(confirmed.creditSettlements || []);
            setSupplierAdvanceSettlements(confirmed.supplierAdvanceSettlements || []);
            setSupplierDirectAdvances(confirmed.supplierDirectAdvances || []);
            setIslrFiscalEvents(confirmed.islrFiscalEvents || []);
            setFinancialDisclosures(confirmed.financialDisclosures || []);
            setDisplayCurrency(confirmed.displayCurrency || 'DUAL');
          }
          setStorageError(normalized.message);
          setStorageReady(false);
          waitersForSnapshot.forEach(waiter => waiter.reject(normalized));
        }
      );
      return;
    }
    // Solo para vista de desarrollo web; el ejecutable de escritorio usa SQLite.
    try {
      localStorage.setItem(`${STORAGE_KEY}_companies`, JSON.stringify(companies));
      localStorage.setItem(`${STORAGE_KEY}_currentCompanyId`, currentCompanyId);
      localStorage.setItem(`${STORAGE_KEY}_accounts`, JSON.stringify(accounts));
      localStorage.setItem(`${STORAGE_KEY}_journal`, JSON.stringify(journalEntries));
      localStorage.setItem(`${STORAGE_KEY}_purchases`, JSON.stringify(purchases));
      localStorage.setItem(`${STORAGE_KEY}_sales`, JSON.stringify(sales));
      localStorage.setItem(`${STORAGE_KEY}_products`, JSON.stringify(products));
      localStorage.setItem(`${STORAGE_KEY}_movements`, JSON.stringify(movements));
      localStorage.setItem(`${STORAGE_KEY}_vatVouchers`, JSON.stringify(vatVouchers));
      localStorage.setItem(`${STORAGE_KEY}_vatWithholdingDeclarations`, JSON.stringify(vatWithholdingDeclarations));
      localStorage.setItem(`${STORAGE_KEY}_vatWithholdingDeclarationEvents`, JSON.stringify(vatWithholdingDeclarationEvents));
      localStorage.setItem(`${STORAGE_KEY}_islrVouchers`, JSON.stringify(islrVouchers));
      localStorage.setItem(`${STORAGE_KEY}_bankAccounts`, JSON.stringify(bankAccounts));
      localStorage.setItem(`${STORAGE_KEY}_statementMovements`, JSON.stringify(bankStatementMovements));
      waitersForSnapshot.forEach(waiter => waiter.resolve());
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error('Error guardando datos locales de desarrollo.');
      console.error('Error guardando datos locales de desarrollo:', normalized);
      waitersForSnapshot.forEach(waiter => waiter.reject(normalized));
    }
  }, [storageReady, companies, currentCompanyId, accounts, journalEntries, purchases, sales, products, movements, vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents, islrVouchers, bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements, supplierDirectAdvances, islrFiscalEvents, financialDisclosures, displayCurrency]);

  const addCompany = (comp: Omit<Company, 'id'>): Company => {
    assertSQLitePersistenceReady('Registrar la empresa');
    const newComp: Company = {
      ...comp,
      id: `comp-${Date.now()}`
    };
    setCompanies(prev => [...prev, newComp]);
    setCurrentCompanyId(newComp.id);
    return newComp;
  };

  const updateBcvRate = (newRate: number, effectiveDate?: string) => {
    assertSQLitePersistenceReady('Actualizar la tasa BCV');
    // Validación de dominio: no permitir que llamadas distintas al modal
    // sobrescriban una tasa válida con NaN, infinito, cero o fecha inválida.
    if (!currentCompany || !Number.isFinite(newRate) || newRate <= 0) return;

    const today = effectiveDate || new Date().toISOString().slice(0, 10);
    const dateMatch = /^\d{4}-\d{2}-\d{2}$/.test(today);
    const parsedDate = dateMatch ? new Date(`${today}T00:00:00.000Z`) : null;
    const validDate = Boolean(
      parsedDate &&
      Number.isFinite(parsedDate.getTime()) &&
      parsedDate.toISOString().slice(0, 10) === today
    );
    if (!validDate) return;

    updateCompany({
      ...currentCompany,
      bcvRate: newRate,
      lastRateUpdate: today
    });
  };

  const correctBcvRate = async (input: {
    newRate: number; effectiveDate: string; reason: string; workpaperNote?: string;
  }): Promise<void> => {
    assertSQLitePersistenceReady('Corregir la tasa BCV');
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de corregir la tasa BCV.');
    const rate = Number(input.newRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('La nueva tasa BCV debe ser un número positivo.');
    if (!isValidIsoDate(input.effectiveDate)) throw new Error('La fecha de vigencia de la tasa BCV no es válida.');
    if (currentCompany.closedThroughDate && input.effectiveDate <= currentCompany.closedThroughDate) {
      throw new Error('La tasa no puede corregirse dentro de un período cerrado. Reabra formalmente el período o tramite el ajuste del período anterior.');
    }
    const reason = String(input.reason || '').trim() || 'Corrección de tasa BCV';
    const workpaperNote = String(input.workpaperNote || '').trim();
    if (reason.length > 2000 || workpaperNote.length > 4000) throw new Error('El motivo o la nota exceden el máximo permitido.');
    if (rate === Number(currentCompany.bcvRate) && input.effectiveDate === currentCompany.lastRateUpdate) return;
    const auditInput: CorrectionAuditInput = {
      eventType: 'accounting_correction_requested', entityType: 'BCV_RATE',
      companyId: currentCompany.id, entityId: currentCompany.id,
      correctionType: 'BCV_RATE_CORRECTION',
      sourceDocumentRef: String(currentCompany.bcvRate) + ' Bs/USD',
      correctionDocumentRef: String(rate) + ' Bs/USD · ' + input.effectiveDate,
      reason, workpaperNote
    };
    await recordCorrectionAudit(auditInput);
    updateCompany({ ...currentCompany, bcvRate: rate, lastRateUpdate: input.effectiveDate });
    try {
      await waitForPersistence();
    } catch (error) {
      throw new Error('SQLite no confirmó la corrección BCV. La interfaz volvió al último estado confirmado; el evento de solicitud permanece en auditoría. ' +
        (error instanceof Error ? error.message : 'Error de persistencia.'));
    }
    try {
      await recordCorrectionAudit({ ...auditInput, eventType: 'accounting_correction_executed' });
    } catch (error) {
      throw new Error('La nueva tasa BCV quedó guardada en SQLite, pero falta registrar el evento final de auditoría. No repita la corrección. ' +
        (error instanceof Error ? error.message : 'Error de auditoría.'));
    }
  };

  const addAccount = (account: Account) => {
    assertSQLitePersistenceReady('Registrar la cuenta contable');
    const validatedAccount = prepareAccountForCatalog(account, accounts);
    setAccounts(prev => [...prev, validatedAccount].sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })));
  };

  const setAccountCashFlowActivity = (accountCode: string, activity: CashFlowActivity) => {
    assertSQLitePersistenceReady('Clasificar cuenta para flujo de efectivo');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se guardó la clasificación.');
    }
    const account = accounts.find(item => item.code === accountCode);
    if (!account || !account.isMovement) throw new Error('Seleccione una cuenta contable imputable existente.');
    if (!['EFECTIVO_EQUIVALENTE', 'OPERACION', 'INVERSION', 'FINANCIACION', 'NO_MONETARIO', 'SIN_CLASIFICAR'].includes(activity)) {
      throw new Error('La clasificación del flujo de efectivo no es válida.');
    }
    setAccounts(prev => prev.map(item => item.code === accountCode
      ? { ...item, cashFlowActivity: activity }
      : item
    ));
  };

  const setAccountCashFlowIndirectTreatment = (accountCode: string, treatment: CashFlowIndirectTreatment) => {
    assertSQLitePersistenceReady('Clasificar tratamiento indirecto del flujo de efectivo');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se guardó el tratamiento indirecto.');
    }
    const account = accounts.find(item => item.code === accountCode);
    if (!account || !account.isMovement) throw new Error('Seleccione una cuenta contable imputable existente.');
    if (!['NON_CASH_EXPENSE_ADD_BACK', 'NON_CASH_INCOME_DEDUCT', 'OPERATING_ASSET_INCREASE_DEDUCT', 'OPERATING_LIABILITY_INCREASE_ADD', 'EXCLUDE'].includes(treatment)) {
      throw new Error('El tratamiento del método indirecto no es válido.');
    }
    if (treatment === 'NON_CASH_EXPENSE_ADD_BACK' && !['COSTOS', 'GASTOS'].includes(account.type)) {
      throw new Error('Solo una cuenta de costos o gastos puede clasificarse como ajuste no monetario de gasto.');
    }
    if (treatment === 'NON_CASH_INCOME_DEDUCT' && account.type !== 'INGRESOS') {
      throw new Error('Solo una cuenta de ingresos puede clasificarse como ingreso no monetario.');
    }
    if (treatment === 'OPERATING_ASSET_INCREASE_DEDUCT' && account.type !== 'ACTIVO') {
      throw new Error('La variación de capital de trabajo como activo requiere una cuenta de activo.');
    }
    if (treatment === 'OPERATING_LIABILITY_INCREASE_ADD' && account.type !== 'PASIVO') {
      throw new Error('La variación de capital de trabajo como pasivo requiere una cuenta de pasivo.');
    }
    setAccounts(prev => prev.map(item => item.code === accountCode
      ? { ...item, cashFlowIndirectTreatment: treatment }
      : item
    ));
  };

  const addJournalEntry = (entry: Omit<JournalEntry, 'id' | 'companyId' | 'createdAt'>, accountCatalog: Account[] = accounts, targetCompanyId: string = currentCompany.id): JournalEntry => {
    const targetCompany = companies.find(company => company.id === targetCompanyId);
    if (!targetCompany) throw new Error('La empresa destino del asiento no existe en SICOVEN.');
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('El asiento requiere SQLite local de escritorio disponible y lista. No se registró.');
    }
    if (!isValidIsoDate(entry.date)) throw new Error('El asiento requiere una fecha válida.');
    if (targetCompany.closedThroughDate && entry.date <= targetCompany.closedThroughDate) {
      throw new Error('No se pueden registrar asientos en un período cerrado hasta ' + targetCompany.closedThroughDate + '.');
    }
    if (!Array.isArray(entry.items)) throw new Error('El asiento debe contener líneas contables válidas.');
    validateJournalEntryAccounts(entry.items, accountCatalog);
    // Verificación de Asientos: Validación estricta de Partida Doble (Débito = Crédito)
    const totalDebitBs = entry.items.reduce((sum, item) => sum + (Number(item.debitBs) || 0), 0);
    const totalCreditBs = entry.items.reduce((sum, item) => sum + (Number(item.creditBs) || 0), 0);
    const totalDebitUsd = entry.items.reduce((sum, item) => sum + (Number(item.debitUsd) || 0), 0);
    const totalCreditUsd = entry.items.reduce((sum, item) => sum + (Number(item.creditUsd) || 0), 0);
    const diff = Math.abs(totalDebitBs - totalCreditBs);
    const diffUsd = Math.abs(totalDebitUsd - totalCreditUsd);
    const invalidLines = entry.items.some(item =>
      !item.accountCode?.trim() ||
      [item.debitBs, item.creditBs, item.debitUsd, item.creditUsd].some(value => !Number.isFinite(Number(value)) || Number(value) < 0) ||
      (Number(item.debitBs) > 0 && Number(item.creditBs) > 0) ||
      (Number(item.debitUsd) > 0 && Number(item.creditUsd) > 0)
    );

    if (entry.items.length < 2 || invalidLines ||
        !isJournalEntryBalanced({ debitBs: totalDebitBs, creditBs: totalCreditBs, debitUsd: totalDebitUsd, creditUsd: totalCreditUsd }) ||
        totalDebitBs <= 0 || totalDebitUsd <= 0) {
      throw new Error(
        `Verificación de asiento fallida. Bs: Debe ${totalDebitBs.toFixed(2)} / Haber ${totalCreditBs.toFixed(2)} (dif. ${diff.toFixed(2)}); USD: Debe ${totalDebitUsd.toFixed(2)} / Haber ${totalCreditUsd.toFixed(2)} (dif. ${diffUsd.toFixed(2)}). Revise líneas, importes y cuentas.`
      );
    }
    if (entry.reversalOfEntryId || entry.adjustmentForEntryId) {
      const sourceEntryId=String(entry.reversalOfEntryId || entry.adjustmentForEntryId);
      const correctionReference=String(entry.referenceDoc || entry.entryNumber || '').trim();
      const authorizationKey=sourceEntryId+'|'+correctionReference;
      if(journalCorrectionAuthorizationRef.current!==authorizationKey) {
        throw new Error('Un reverso o ajuste de asiento requiere autorización formal aprobada para el asiento fuente y la referencia correctiva.');
      }
      journalCorrectionAuthorizationRef.current=null;
    }
    // Domain-level backstop: every newly posted credit to a bank auxiliary is
    // an outgoing movement and must fit the available balance at its effective date.
    // Reconciliation adjustments are excluded because they record bank facts that
    // have already occurred, not new payment instructions.
    if (!entry.isAdjusted) {
      const creditedBankAccounts = bankAccounts.filter(bank =>
        bank.companyId === targetCompany.id &&
        entry.items.some(item => item.accountCode === bank.accountCode &&
          (Number(item.creditBs || 0) > 0 || Number(item.creditUsd || 0) > 0))
      );
      for (const bank of creditedBankAccounts) {
        const requestedAmount = entry.items
          .filter(item => item.accountCode === bank.accountCode)
          .reduce((sum, item) => sum + Number(bank.currency === 'USD' ? item.creditUsd || 0 : item.creditBs || 0), 0);
        const balanceEntries = activeImportBatchRef.current
          ? [...journalEntries, ...activeImportBatchRef.current.journalEntries]
          : journalEntries;
        const availableBalance = calculateBankAvailableBalance({
          bankAccount: bank, companyId: targetCompany.id, asOfDate: entry.date, journalEntries: balanceEntries
        });
        validateBankOutgoingAvailability({
          availableBalance, requestedAmount, currency: bank.currency
        });
      }
    }

    const companyEntries = journalEntries.filter(e => e.companyId === targetCompany.id);
    const maxEntryNum = companyEntries.reduce((max, e) => (e.entryNumber > max ? e.entryNumber : max), 0);
    const sequenceKey = targetCompany.id;
    const currentSequence = Math.max(maxEntryNum, journalSequenceRef.current[sequenceKey] || 0);
    const nextEntryNum = entry.entryNumber && entry.entryNumber > currentSequence ? entry.entryNumber : currentSequence + 1;
    journalSequenceRef.current[sequenceKey] = Math.max(journalSequenceRef.current[sequenceKey] || 0, nextEntryNum);
    const newEntry: JournalEntry = {
      ...entry,
      id: `entry-${sequenceKey}-${nextEntryNum}-${Date.now()}`,
      companyId: targetCompany.id,
      entryNumber: nextEntryNum,
      createdAt: new Date().toISOString()
    };
    reserveBankOutgoingAccounts(newEntry.companyId, newEntry.items);
    activeImportBatchRef.current?.journalEntries.push(newEntry);
    setJournalEntries(prev => [...prev, newEntry]);
    return newEntry;
  };

  const getCreditPrincipal = (document: SaleRecord | PurchaseRecord, kind: 'SALE_COLLECTION' | 'PURCHASE_PAYMENT') => {
    // Las cuentas por cobrar/pagar se reconocen por el neto realmente pendiente:
    // en ventas se resta la retención de IVA del cliente; en compras, las
    // retenciones de IVA e ISLR enterables. El asiento original ya usa estos netos.
    const withheldBs = kind === 'SALE_COLLECTION'
      ? Number((document as SaleRecord).vatWithheldBs || 0)
      : Number((document as PurchaseRecord).vatWithheldBs || 0) + Number((document as PurchaseRecord).islrWithheldBs || 0);
    const withheldUsd = kind === 'SALE_COLLECTION'
      ? Number((document as SaleRecord).vatWithheldUsd || 0)
      : Number((document as PurchaseRecord).vatWithheldUsd || 0) + Number((document as PurchaseRecord).islrWithheldUsd || 0);
    const originalAmountBs = Math.max(0, Number(document.totalAmountBs || 0) - withheldBs);
    const invoiceRate = Number(document.bcvRate) > 0
      ? Number(document.bcvRate)
      : (Number(document.totalAmountUsd) > 0 ? Number(document.totalAmountBs) / Number(document.totalAmountUsd) : 0);
    const originalAmountUsd = withheldUsd > 0
      ? Math.max(0, Number(document.totalAmountUsd || 0) - withheldUsd)
      : (withheldBs > 0 && invoiceRate > 0
        ? Math.round((originalAmountBs / invoiceRate + Number.EPSILON) * 100) / 100
        : Math.max(0, Number(document.totalAmountUsd || 0)));
    return { originalAmountUsd, originalAmountBs };
  };


  const addImportedCreditSettlements = (
    drafts: UniversalCreditSettlementDraft[],
    documents: Array<SaleRecord | PurchaseRecord>,
    targetCompanyId: string = currentCompany.id
  ): CreditSettlement[] => {
    if (!drafts.length) return [];
    const batch = activeImportBatchRef.current;
    if (!batch) throw new Error('Las liquidaciones históricas solo pueden registrarse dentro del lote contable atómico.');
    const targetCompany = companies.find(company => company.id === targetCompanyId);
    if (!targetCompany) throw new Error('La empresa destino de las liquidaciones no existe.');
    const documentById = new Map(documents.map(document => [document.id, document]));
    const remainingByDocument = new Map<string, number>();
    const created: CreditSettlement[] = [];
    const normalizedReference = (value?: string) => String(value || '').trim().replace(/\s+/g, '').toUpperCase();

    for (const [index, draft] of drafts.entries()) {
      const kind = draft.kind;
      const document = documentById.get(draft.documentId);
      if (!document || document.companyId !== targetCompanyId || document.isCancelled || document.paymentTerm !== 'CREDITO') {
        throw new Error('La liquidación ' + draft.sourceRowId + ' no tiene una factura de crédito válida dentro del lote.');
      }
      if (!isValidIsoDate(draft.settlementDate) || draft.settlementDate < String(document.invoiceDate || '')) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' tiene una fecha anterior a su factura o una fecha inválida.');
      }
      if (kind === 'PURCHASE_PAYMENT') {
        const dateError = validatePurchasePaymentDate(draft.settlementDate, getPurchaseAccountCreditDate(document as PurchaseRecord));
        if (dateError) throw new Error('Liquidación ' + draft.sourceRowId + ': ' + dateError);
      }

      const amountUsd = Math.round((Number(draft.amountUsd) + Number.EPSILON) * 100) / 100;
      const amountBs = Math.round((Number(draft.amountBs) + Number.EPSILON) * 100) / 100;
      const settlementRate = Number(draft.bcvRate);
      const invoiceRate = Number(document.bcvRate) > 0
        ? Number(document.bcvRate)
        : (Number(document.totalAmountUsd) > 0 ? Number(document.totalAmountBs) / Number(document.totalAmountUsd) : 0);
      if (!Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(amountBs) || amountBs <= 0 ||
          !Number.isFinite(settlementRate) || settlementRate <= 0 || !Number.isFinite(invoiceRate) || invoiceRate <= 0 ||
          Math.abs(amountBs - amountUsd * settlementRate) > 0.02) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' no concilia sus importes Bs/USD con la tasa BCV declarada.');
      }

      const principal = getCreditPrincipal(document, kind).originalAmountUsd;
      const remainingUsd = remainingByDocument.has(document.id) ? remainingByDocument.get(document.id)! : principal;
      const validation = validateCreditSettlement({
        documentId: document.id, kind, settlementDate: draft.settlementDate,
        amountUsd, amountBs, method: draft.method,
        bankAccountId: draft.bankAccountId, reference: draft.reference, bcvRate: settlementRate
      }, remainingUsd);
      if (validation) throw new Error('Liquidación ' + draft.sourceRowId + ': ' + validation);

      const bankTransfer = draft.method === 'BANK_TRANSFER_BS' || draft.method === 'BANK_TRANSFER_USD';
      const bank = bankTransfer
        ? bankAccounts.find(item => item.id === draft.bankAccountId && item.companyId === targetCompanyId)
        : undefined;
      const expectedCurrency = draft.method === 'BANK_TRANSFER_USD' ? 'USD' : 'BS';
      if (bankTransfer && (!bank || bank.currency !== expectedCurrency || !String(draft.reference || '').trim())) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' requiere una cuenta bancaria destino de la moneda correcta y una referencia.');
      }
      if (!bankTransfer && draft.bankAccountId) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' asigna una cuenta bancaria a un medio de efectivo.');
      }

      const referenceKey = normalizedReference(draft.reference);
      const duplicateBankReference = bankTransfer && referenceKey && [
        ...creditSettlements, ...created
      ].some(item => item.companyId === targetCompanyId && item.bankAccountId === bank!.id &&
        !item.isReversed && normalizedReference(item.reference) === referenceKey);
      const duplicateWithoutReference = !referenceKey && [
        ...creditSettlements, ...created
      ].some(item => item.companyId === targetCompanyId && item.documentId === document.id &&
        item.kind === kind && !item.isReversed && !String(item.reference || '').trim() &&
        item.settlementDate === draft.settlementDate &&
        Math.round(Number(item.amountUsd) * 100) === Math.round(amountUsd * 100) &&
        item.method === draft.method && item.bankAccountId === draft.bankAccountId &&
        Math.round(Number(item.bcvRate) * 1000000) === Math.round(settlementRate * 1000000));
      if (duplicateBankReference || duplicateWithoutReference) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' reutiliza una referencia bancaria o una operación ya registrada.');
      }

      const sourceEntry = batch.journalEntries.find(entry =>
        entry.id === document.journalEntryId && entry.companyId === targetCompanyId
      );
      const expectedSourceType = kind === 'SALE_COLLECTION' ? 'VENTA' : 'COMPRA';
      const controlLines = (sourceEntry?.items || []).filter(item =>
        kind === 'SALE_COLLECTION'
          ? item.accountCode === '1.1.2.01' && Number(item.debitBs || 0) > 0
          : item.accountCode.startsWith('2.1.1.') && Number(item.creditBs || 0) > 0
      );
      if (!sourceEntry || sourceEntry.type !== expectedSourceType || controlLines.length !== 1) {
        throw new Error('La factura de la liquidación ' + draft.sourceRowId + ' no generó un asiento original con una única cuenta de control verificable.');
      }
      const controlAccount = accounts.find(account => account.code === controlLines[0].accountCode && account.isMovement);
      const cashCode = bank?.accountCode || (draft.method === 'CASH_USD' ? '1.1.1.02' : '1.1.1.01');
      const cashAccount = accounts.find(account => account.code === cashCode && account.isMovement);
      const fxGain = accounts.find(account => account.code === '4.2.1.01' && account.isMovement);
      const fxLoss = accounts.find(account => account.code === '6.1.1.08' && account.isMovement);
      if (!controlAccount || !cashAccount ||
          (kind === 'SALE_COLLECTION' && controlAccount.type !== 'ACTIVO') ||
          (kind === 'PURCHASE_PAYMENT' && controlAccount.type !== 'PASIVO')) {
        throw new Error('La liquidación ' + draft.sourceRowId + ' no tiene auxiliares contables de CxC/CxP y tesorería válidos.');
      }

      const fxDifferenceBs = Math.round((amountBs - amountUsd * invoiceRate) * 100) / 100;
      const items = buildCreditSettlementJournalItems({
        kind, method: draft.method, amountBs, amountUsd, invoiceRate,
        settlementRate, cashAccount, controlAccount, fxGainAccount: fxGain, fxLossAccount: fxLoss
      });
      const entry = addJournalEntry({
        entryNumber: 0,
        date: draft.settlementDate,
        description: (kind === 'SALE_COLLECTION' ? 'Cobro de cuenta por cobrar' : 'Pago de cuenta por pagar') +
          ' - ' + document.invoiceNumber + (Math.abs(fxDifferenceBs) >= 0.01 ? ' (incluye diferencia cambiaria)' : ''),
        type: 'AJUSTE',
        bcvRate: settlementRate,
        referenceDoc: document.invoiceNumber,
        items
      }, accounts, targetCompanyId);
      const fxFiscalAdjustmentProposal = calculateFxFiscalAdjustment({
        companyId: targetCompanyId,
        documentId: document.id,
        sourceDocumentRef: document.invoiceNumber,
        documentDate: document.invoiceDate,
        settlementDate: draft.settlementDate,
        originalRate: invoiceRate,
        settlementRate,
        originalAmountUsd: amountUsd,
        originalAmountBs: amountUsd * invoiceRate,
        settlementAmountBs: amountBs,
        sourceKind: kind === 'SALE_COLLECTION' ? 'SALE_RECEIVABLE' : 'PURCHASE_PAYABLE'
      });
      const settlement: CreditSettlement = {
        id: 'credit-settlement-' + targetCompanyId + '-' + Date.now() + '-' + index,
        companyId: targetCompanyId,
        documentId: document.id,
        kind,
        settlementDate: draft.settlementDate,
        amountBs,
        amountUsd,
        method: draft.method,
        bankAccountId: bank?.id,
        reference: draft.reference?.trim() || undefined,
        bcvRate: settlementRate,
        journalEntryId: entry.id,
        fxFiscalAdjustmentProposal,
        createdAt: new Date().toISOString()
      };
      created.push(settlement);
      remainingByDocument.set(document.id, Math.max(0, remainingUsd - amountUsd));
    }

    setCreditSettlements(previous => [...previous, ...created]);
    return created;
  };



  const getCreditBalance = (documentId: string, kind: 'SALE_COLLECTION' | 'PURCHASE_PAYMENT'): CreditBalance => {
    const document = kind === 'SALE_COLLECTION'
      ? sales.find(item => item.id === documentId && item.companyId === currentCompany.id)
      : purchases.find(item => item.id === documentId && item.companyId === currentCompany.id);
    if (!document) throw new Error('No se encontró la factura en la empresa activa.');
    if (document.isCancelled) throw new Error('La factura fue reversada y ya no tiene saldo exigible en este auxiliar.');
    const principal = getCreditPrincipal(document, kind);
    const balance = calculateCreditBalance(
      documentId,
      principal.originalAmountUsd,
      principal.originalAmountBs,
      creditSettlements.filter(item => item.companyId === currentCompany.id && item.kind === kind && !item.isReversed)
    );
    const creditNotes = kind === 'PURCHASE_PAYMENT'
      ? purchases.filter(item => item.companyId === currentCompany.id && item.originalPurchaseId === documentId && item.documentType === '03' && !item.isCancelled)
      : sales.filter(item => item.companyId === currentCompany.id && item.originalSaleId === documentId && item.documentType === '03' && !item.isCancelled);
    const debitNotes = kind === 'PURCHASE_PAYMENT'
      ? purchases.filter(item => item.companyId === currentCompany.id && item.originalPurchaseId === documentId && item.documentType === '02' && !item.isCancelled)
      : sales.filter(item => item.companyId === currentCompany.id && item.originalSaleId === documentId && item.documentType === '02' && !item.isCancelled);
    const {creditedByNotesUsd,creditedByNotesBs,debitedByNotesUsd,debitedByNotesBs} =
      summarizeCreditDocumentAdjustments(kind,creditNotes,debitNotes);
    const advanceApplications = kind === 'PURCHASE_PAYMENT'
      ? supplierAdvanceSettlements.filter(item => item.companyId === currentCompany.id &&
          !item.isReversed && item.kind === 'APPLIED_TO_PURCHASE' && item.targetPurchaseId === documentId)
      : [];
    const creditedBySupplierAdvancesUsd = advanceApplications.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const creditedBySupplierAdvancesBs = advanceApplications.reduce((sum, item) => sum + Number(item.advanceBookValueBs ?? item.amountBs ?? 0), 0);
    const outstandingUsd = Math.max(0, Math.round((balance.outstandingUsd - creditedByNotesUsd - creditedBySupplierAdvancesUsd + debitedByNotesUsd) * 1000000) / 1000000);
    return {
      ...balance,
      creditedByNotesUsd,
      creditedByNotesBs,
      debitedByNotesUsd,
      debitedByNotesBs,
      creditedBySupplierAdvancesUsd,
      creditedBySupplierAdvancesBs,
      outstandingUsd,
      outstandingBsAtInvoiceRate: Math.round(outstandingUsd * (principal.originalAmountUsd > 0
        ? principal.originalAmountBs / principal.originalAmountUsd : 0) * 100) / 100
    };
  };

  const getSupplierAdvanceBalance = (supplierRif: string): SupplierAdvanceBalance =>
    calculateOutstandingSupplierAdvance(supplierRif, purchases, supplierAdvanceSettlements, currentCompany.id, supplierDirectAdvances);

  const addSupplierDirectAdvance = async (draft: SupplierDirectAdvanceDraft): Promise<SupplierDirectAdvance> => {
    assertSQLitePersistenceReady('Registrar anticipo directo a proveedor');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible. No se registró el anticipo.');
    }
    const validation = validateSupplierDirectAdvanceDraft(draft, currentCompany.id, accounts);
    if (validation) throw new Error(validation);
    const rif = String(draft.supplierRif).trim().toUpperCase();
    if (!validateVenezuelanRif(rif).isValid) throw new Error('El RIF del proveedor no tiene una estructura venezolana válida.');
    if (currentCompany.closedThroughDate && draft.date <= currentCompany.closedThroughDate) {
      throw new Error('El período está cerrado hasta ' + currentCompany.closedThroughDate + '. El anticipo no se registró.');
    }
    const bank = bankAccounts.find(item => item.companyId === currentCompany.id && item.accountCode === draft.treasuryAccountCode);
    const accountCurrency = resolveTreasuryAccountCurrency(draft.treasuryAccountCode, bank?.currency);
    if (accountCurrency !== draft.paymentCurrency) {
      throw new Error('La moneda del desembolso no coincide con la moneda configurada para la cuenta de Caja/Banco.');
    }
    if (bank) {
      const availableBalance = calculateBankAvailableBalance({
        bankAccount: bank, companyId: currentCompany.id, asOfDate: draft.date, journalEntries
      });
      validateBankOutgoingAvailability({
        availableBalance, requestedAmount: draft.paidAmount, currency: bank.currency
      });
    }
    const operationKey = [currentCompany.id, rif, draft.date, draft.treasuryAccountCode,
      draft.paymentCurrency, draft.paidAmount, draft.reference.trim().toUpperCase()].join('|');
    if (supplierDirectAdvanceInFlightRef.current.has(operationKey)) {
      throw new Error('Este anticipo ya se está registrando. Espere la confirmación de SQLite.');
    }
    const duplicate = supplierDirectAdvances.some(item => item.companyId === currentCompany.id &&
      !item.isReversed && item.treasuryAccountCode === draft.treasuryAccountCode &&
      item.date === draft.date && item.reference.trim().toUpperCase() === draft.reference.trim().toUpperCase());
    if (duplicate) throw new Error('La referencia ya fue utilizada en un anticipo de esta cuenta.');
    supplierDirectAdvanceInFlightRef.current.add(operationKey);
    try {
      const advanceAccount = accounts.find(item => item.code === '1.1.2.03' && item.isMovement && item.type === 'ACTIVO');
      const treasuryAccount = accounts.find(item => item.code === draft.treasuryAccountCode && item.isMovement && item.type === 'ACTIVO');
      if (!advanceAccount || !treasuryAccount) {
        throw new Error('El plan de cuentas no tiene un auxiliar activo válido para anticipos y la cuenta real de Caja/Banco.');
      }
      const amountUsd = Math.round(draft.amountUsd * 1000000) / 1000000;
      const bookValueBs = Math.round(amountUsd * draft.bcvRate * 100) / 100;
      const entry = addJournalEntry({
        entryNumber: 0, date: draft.date,
        description: 'Anticipo directo a proveedor ' + rif + ' · ' + draft.supplierName.trim(),
        type: 'ANTICIPO_PROVEEDOR', bcvRate: draft.bcvRate, referenceDoc: draft.reference.trim(),
        items: [
          { accountCode: advanceAccount.code, accountName: advanceAccount.name, debitBs: bookValueBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0, description: 'Reconocimiento de anticipo directo a proveedor' },
          { accountCode: treasuryAccount.code, accountName: treasuryAccount.name, debitBs: 0, creditBs: bookValueBs, debitUsd: 0, creditUsd: amountUsd, description: 'Desembolso documentado desde Caja/Banco' }
        ]
      });
      const record: SupplierDirectAdvance = {
        ...draft, supplierRif: rif, supplierName: draft.supplierName.trim(),
        id: 'supplier-direct-advance-' + currentCompany.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
        companyId: currentCompany.id, amountUsd, bookValueBs,
        reference: draft.reference.trim(), support: draft.support!.trim(),
        journalEntryId: entry.id, createdAt: new Date().toISOString()
      };
      setSupplierDirectAdvances(prev => [...prev, record]);
      await waitForPersistence();
      return record;
    } finally {
      supplierDirectAdvanceInFlightRef.current.delete(operationKey);
    }
  };

  const addSupplierAdvanceSettlement = async (draft: SupplierAdvanceSettlementDraft): Promise<SupplierAdvanceSettlement> => {
    assertSQLitePersistenceReady('Liquidar anticipo a proveedor');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) throw new Error('SQLite no está disponible. No se registró la liquidación.');
    const rif = String(draft.supplierRif || '').trim().toUpperCase();
    const operationKey = [
      currentCompany.id, rif, draft.kind, draft.date, Math.round(Number(draft.amountUsd) * 1000000),
      Math.round(Number(draft.amountBs) * 100), draft.treasuryAccountCode || '',
      draft.targetPurchaseId || '', String(draft.reference || '').trim().toUpperCase()
    ].join('|');
    if (supplierAdvanceSettlementInFlightRef.current.has(operationKey)) {
      throw new Error('Esta liquidación ya está en proceso. Espere antes de volver a intentarlo.');
    }
    const duplicate = supplierAdvanceSettlements.some(item =>
      item.companyId === currentCompany.id && !item.isReversed &&
      String(item.supplierRif || '').trim().toUpperCase() === rif &&
      item.kind === draft.kind && item.date === draft.date &&
      Math.round(Number(item.amountUsd) * 1000000) === Math.round(Number(draft.amountUsd) * 1000000) &&
      (draft.reference?.trim()
        ? String(item.reference || '').trim().toUpperCase() === draft.reference.trim().toUpperCase()
        : !item.reference?.trim() && Math.round(Number(item.amountBs) * 100) === Math.round(Number(draft.amountBs) * 100) &&
          (item.targetPurchaseId || '') === (draft.targetPurchaseId || '') &&
          (item.treasuryAccountCode || '') === (draft.treasuryAccountCode || ''))
    );
    if (duplicate) throw new Error('Posible liquidación duplicada. Revise el historial del proveedor antes de registrar nuevamente.');
    supplierAdvanceSettlementInFlightRef.current.add(operationKey);
    try {

    const sourceNotes = purchases.filter(item => item.companyId === currentCompany.id && item.documentType === '03' &&
      !item.isCancelled && String(item.supplierRif || '').trim().toUpperCase() === rif &&
      Number(item.supplierAdvanceUsd || 0) > 0).sort((a, b) =>
        String(a.invoiceDate || '').localeCompare(String(b.invoiceDate || '')) || String(a.id).localeCompare(String(b.id)));
    const sourceDirectAdvances = supplierDirectAdvances.filter(item => item.companyId === currentCompany.id &&
      !item.isReversed && String(item.supplierRif || '').trim().toUpperCase() === rif)
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const target = draft.kind === 'APPLIED_TO_PURCHASE'
      ? purchases.find(item => item.id === draft.targetPurchaseId && item.companyId === currentCompany.id && ['01', '02'].includes(item.documentType) && item.paymentTerm === 'CREDITO' && !item.isCancelled)
      : undefined;
    if (draft.kind === 'APPLIED_TO_PURCHASE' && !target) throw new Error('El documento destino no existe, no es una factura/ND de crédito o está reversado.');
    if (currentCompany.closedThroughDate && draft.date <= currentCompany.closedThroughDate) {
      throw new Error('El período está cerrado hasta ' + currentCompany.closedThroughDate + '. La liquidación no se registró.');
    }
    if (target) {
      const paymentDateError = validatePurchasePaymentDate(draft.date, getPurchaseAccountCreditDate(target));
      if (paymentDateError) throw new Error(paymentDateError);
    }
    const balance = getSupplierAdvanceBalance(rif);
    // El formulario captura el importe efectivamente recibido en Bs.; por tanto,
    // no debe permitir seleccionar una cuenta bancaria denominada en USD.
    const treasuryCodes = [...new Set([...bankAccounts.filter(item => item.companyId === currentCompany.id && (!item.currency || item.currency === 'BS')).map(item => item.accountCode), ...accounts.filter(item => item.type === 'ACTIVO' && item.isMovement && item.code === '1.1.1.01').map(item => item.code)])];
    const validation = validateSupplierAdvanceSettlementDraft(draft, balance.outstandingUsd, target?.supplierRif, treasuryCodes);
    if (validation) throw new Error(validation);
    if (draft.kind === 'APPLIED_TO_PURCHASE') {
      const payable = getCreditBalance(target!.id, 'PURCHASE_PAYMENT');
      if (draft.amountUsd > payable.outstandingUsd + 0.000005) throw new Error('La aplicación supera el saldo pendiente de la factura destino.');
    }

    // La descarga del anticipo se mide a su valor histórico en libros, no a la tasa del día.
    const amountUsd = Math.round((draft.amountUsd + Number.EPSILON) * 1000000) / 1000000;

    const advance = accounts.find(item => item.code === '1.1.2.03' && item.isMovement);
    let counterpartCode = draft.treasuryAccountCode!;
    if (draft.kind === 'APPLIED_TO_PURCHASE') {
      const originalPurchaseEntry = target?.journalEntryId
        ? journalEntries.find(item => item.id === target.journalEntryId && item.companyId === currentCompany.id)
        : undefined;
      if (!originalPurchaseEntry || originalPurchaseEntry.type !== (target?.documentType === '02' ? 'AJUSTE' : 'COMPRA')) {
        throw new Error('El documento destino no tiene un asiento verificable de factura o ND; no se aplicó el anticipo.');
      }
      const payableCandidates = originalPurchaseEntry.items.filter(line => {
        const account = accounts.find(item => item.code === line.accountCode && item.isMovement);
        const label = `${account?.name || ''} ${line.description || ''}`.toLocaleLowerCase();
        return Boolean(account && Number(line.creditBs) > 0 &&
          account.code.startsWith('2.1.1.') &&
          /(proveedor|cuentas por pagar|neto a pagar)/i.test(label));
      });
      const payableCodes = [...new Set(payableCandidates.map(line => line.accountCode))];
      if (payableCodes.length !== 1) {
        throw new Error('No se pudo identificar una única cuenta auxiliar de CxP en el asiento original. Concíliela antes de aplicar el anticipo.');
      }
      counterpartCode = payableCodes[0];
    }
    const counterpart = accounts.find(item => item.code === counterpartCode && item.isMovement);
    if (!advance || !counterpart) throw new Error('Falta una cuenta de movimiento válida para contabilizar la operación.');

    const settlementValueBs = draft.kind === 'REFUND_RECEIVED'
      ? Math.round((draft.cashReceivedBs ?? draft.amountBs) * 100) / 100
      : (() => {
          const payable = getCreditBalance(target!.id, 'PURCHASE_PAYMENT');
          return Math.round((payable.outstandingUsd > 0
            ? payable.outstandingBsAtInvoiceRate * amountUsd / payable.outstandingUsd
            : 0) * 100) / 100;
        })();
    // Consumir primero los saldos originados en notas de crédito y luego
    // los desembolsos directos, cada origen con su valor histórico FIFO.
    const activeSettlements = supplierAdvanceSettlements.filter(item => item.companyId === currentCompany.id &&
      !item.isReversed && String(item.supplierRif || '').trim().toUpperCase() === rif);
    const noteConsumedUsd = activeSettlements.flatMap(item => item.sourceCreditNoteAllocations || [])
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const directConsumedUsd = activeSettlements.flatMap(item => item.sourceDirectAdvanceAllocations || [])
      .reduce((sum, item) => sum + Number(item.amountUsd || 0), 0);
    const noteAvailableUsd = Math.max(0, sourceNotes.reduce((sum, item) => sum + Number(item.supplierAdvanceUsd || 0), 0) - noteConsumedUsd);
    const directAvailableUsd = Math.max(0, sourceDirectAdvances.reduce((sum, item) => sum + Number(item.amountUsd || 0), 0) - directConsumedUsd);
    if (amountUsd > noteAvailableUsd + directAvailableUsd + 0.000005) {
      throw new Error('La liquidación supera los anticipos disponibles de notas de crédito y desembolsos directos.');
    }
    const noteRequestedUsd = Math.min(amountUsd, noteAvailableUsd);
    const directRequestedUsd = Math.max(0, amountUsd - noteRequestedUsd);
    const sourceCreditNoteAllocations = noteRequestedUsd > 0.000005
      ? allocateSupplierAdvanceCreditNotes(
          sourceNotes.map(note => ({
            id: note.id,
            amountUsd: Number(note.supplierAdvanceUsd || 0),
            bookValueBs: Number(note.supplierAdvanceBs || 0)
          })),
          supplierAdvanceSettlements, currentCompany.id, rif, noteRequestedUsd
        )
      : [];
    const sourceCreditNoteIds = sourceCreditNoteAllocations.map(item => item.creditNoteId);
    const sourceDirectAdvanceAllocations = directRequestedUsd > 0.000005
      ? allocateDirectSupplierAdvance(
          sourceDirectAdvances,
          activeSettlements.map(item => ({
            companyId: item.companyId, supplierRif: item.supplierRif,
            allocations: item.sourceDirectAdvanceAllocations || [], isReversed: item.isReversed
          })),
          currentCompany.id, rif, directRequestedUsd
        )
      : [];
    const sourceDirectAdvanceIds = sourceDirectAdvanceAllocations.map(item => item.directAdvanceId);
    const advanceBookValueBs = Math.round((
      sourceCreditNoteAllocations.reduce((sum, allocation) => sum + allocation.bookValueBs, 0) +
      sourceDirectAdvanceAllocations.reduce((sum, allocation) => sum + allocation.bookValueBs, 0)
    ) * 100) / 100;
    if (sourceCreditNoteAllocations.length) {
      const allocationError = validateSupplierAdvanceCreditNoteAllocations(
        sourceCreditNoteAllocations, sourceCreditNoteIds, noteRequestedUsd,
        sourceCreditNoteAllocations.reduce((sum, allocation) => sum + allocation.bookValueBs, 0)
      );
      if (allocationError) throw new Error(allocationError);
    }
    if (sourceDirectAdvanceAllocations.reduce((sum, item) => sum + item.amountUsd, 0) + 0.000005 < directRequestedUsd) {
      throw new Error('No se pudo distribuir el importe completo entre los desembolsos directos disponibles.');
    }

    // Se reutiliza el cálculo FX con el valor histórico exacto de la asignación FIFO.
    const fxAmounts = calculateSupplierAdvanceFxSettlement(
      amountUsd, advanceBookValueBs, amountUsd, settlementValueBs
    );
    const differenceBs = fxAmounts.exchangeDifferenceBs;
    const gain = accounts.find(item => item.code === '4.2.1.01' && item.isMovement);
    const loss = accounts.find(item => item.code === '6.1.1.08' && item.isMovement);
    if (differenceBs >= 0.01 && !gain) {
      throw new Error('Falta la cuenta de ganancia por diferencial cambiario. No se registró la liquidación.');
    }
    if (differenceBs <= -0.01 && !loss) {
      throw new Error('Falta la cuenta de pérdida por diferencial cambiario. No se registró la liquidación.');
    }

    const settlementJournalItems = buildSupplierAdvanceSettlementJournalItems({
      kind: draft.kind,
      amountUsd,
      settlementValueBs,
      advanceBookValueBs,
      exchangeDifferenceBs: differenceBs,
      counterpartAccount: counterpart,
      advanceAccount: advance,
      fxGainAccount: gain,
      fxLossAccount: loss
    });
    let resolvePersistence!: () => void;
    let rejectPersistence!: (error: Error) => void;
    const persistenceConfirmation = new Promise<void>((resolve, reject) => {
      resolvePersistence = resolve;
      rejectPersistence = reject;
    });
    const persistenceWaiter = { resolve: resolvePersistence, reject: rejectPersistence };
    if (window.sicovenStore) persistenceWaitersRef.current.push(persistenceWaiter);
    let entry: JournalEntry;
    try {
      entry = addJournalEntry({
        entryNumber: 0, date: draft.date,
        description: draft.kind === 'REFUND_RECEIVED' ? `Reembolso de anticipo de proveedor ${rif}` : `Aplicación de anticipo a factura ${target!.invoiceNumber}`,
        type: 'ANTICIPO_PROVEEDOR', bcvRate: draft.bcvRate,
        referenceDoc: draft.reference?.trim() || target?.invoiceNumber,
        items: settlementJournalItems
      });
    } catch (cause) {
      persistenceWaitersRef.current = persistenceWaitersRef.current.filter(waiter => waiter !== persistenceWaiter);
      throw cause;
    }
    const settlement: SupplierAdvanceSettlement = {
      ...draft, supplierRif: rif, supplierName: sourceNotes[0]?.supplierName || sourceDirectAdvances[0]?.supplierName || target?.supplierName || '',
      sourceCreditNoteIds, sourceCreditNoteAllocations, sourceDirectAdvanceIds, sourceDirectAdvanceAllocations,
      id: `supplier-advance-${currentCompany.id}-${Date.now()}`,
      companyId: currentCompany.id, amountUsd, amountBs: advanceBookValueBs, advanceBookValueBs,
      cashReceivedBs: draft.kind === 'REFUND_RECEIVED' ? settlementValueBs : undefined,
      exchangeDifferenceBs: differenceBs, journalEntryId: entry.id, createdAt: new Date().toISOString()
    };
    setSupplierAdvanceSettlements(prev => [...prev, settlement]);
    if (window.sicovenStore) await persistenceConfirmation;
    return settlement;
    } finally {
      supplierAdvanceSettlementInFlightRef.current.delete(operationKey);
    }
  };

  const addCreditSettlement = async (draft: CreditSettlementDraft): Promise<CreditSettlement> => {
    assertSQLitePersistenceReady('Registrar cobro o pago de factura');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('La persistencia SQLite no está disponible o todavía no está lista. No se registró el cobro/pago.');
    }
    const kind = draft.kind;
    const document = kind === 'SALE_COLLECTION'
      ? sales.find(item => item.id === draft.documentId && item.companyId === currentCompany.id)
      : purchases.find(item => item.id === draft.documentId && item.companyId === currentCompany.id);
    if (!document) throw new Error('La factura no existe en la empresa activa.');
    if (document.isCancelled) throw new Error('No se puede liquidar una factura reversada.');
    if (document.paymentTerm !== 'CREDITO') throw new Error('Solo se pueden liquidar facturas identificadas como crédito.');
    if (kind === 'PURCHASE_PAYMENT') {
      const purchase = document as PurchaseRecord;
      const paymentDateError = validatePurchasePaymentDate(draft.settlementDate, getPurchaseAccountCreditDate(purchase));
      if (paymentDateError) throw new Error(paymentDateError);
    }
    const balance = getCreditBalance(draft.documentId, kind);
    const error = validateCreditSettlement(draft, balance.outstandingUsd);
    if (error) throw new Error(error);
    const isBankTransfer = draft.method === 'BANK_TRANSFER_BS' || draft.method === 'BANK_TRANSFER_USD';
    const settlementBank = isBankTransfer
      ? bankAccounts.find(bank => bank.id === draft.bankAccountId && bank.companyId === currentCompany.id)
      : undefined;
    if (isBankTransfer) {
      if (!settlementBank) throw new Error('La cuenta bancaria seleccionada no pertenece a la empresa activa.');
      const expectedCurrency = draft.method === 'BANK_TRANSFER_USD' ? 'USD' : 'BS';
      if (settlementBank.currency !== expectedCurrency) throw new Error('La moneda de la transferencia no coincide con la moneda de la cuenta bancaria seleccionada.');
      if (!draft.reference?.trim()) throw new Error('La referencia o comprobante de la transferencia es obligatorio.');
      const linkedAux = accounts.find(account => account.code === settlementBank.accountCode && account.isMovement);
      if (!linkedAux) throw new Error('El auxiliar contable de la cuenta bancaria no existe o no admite movimientos.');
      if (kind === 'PURCHASE_PAYMENT') {
        const availableBalance = calculateBankAvailableBalance({
          bankAccount: settlementBank, companyId: currentCompany.id,
          asOfDate: draft.settlementDate, journalEntries
        });
        validateBankOutgoingAvailability({
          availableBalance,
          requestedAmount: settlementBank.currency === 'USD' ? draft.amountUsd : draft.amountBs,
          currency: settlementBank.currency
        });
      }
    }
    const normalizedReference = draft.reference?.trim().toLocaleLowerCase();
    const prior = creditSettlements.filter(item => item.companyId === currentCompany.id &&
      item.documentId === draft.documentId && item.kind === kind && !item.isReversed);
    const duplicate = prior.some(item => {
      const sameDate = item.settlementDate === draft.settlementDate;
      const sameAmount = Math.round(item.amountUsd * 100) === Math.round(draft.amountUsd * 100);
      const sameMethod = item.method === draft.method && item.bankAccountId === draft.bankAccountId;
      const sameRate = Math.round(item.bcvRate * 1000000) === Math.round(draft.bcvRate * 1000000);
      const sameReference = Boolean(normalizedReference && item.reference?.trim().toLocaleLowerCase() === normalizedReference);
      // La referencia bancaria/transferencia identifica la operación: no se
      // puede reutilizar para la misma factura aunque cambien fecha o importe.
      // Sin referencia, usar firma estable para bloquear doble envío idéntico.
      return sameReference ||
        (!normalizedReference && !item.reference?.trim() && sameDate && sameAmount && sameMethod && sameRate);
    });
    const duplicateBankReference = Boolean(settlementBank && normalizedReference && creditSettlements.some(item =>
      item.companyId === currentCompany.id &&
      item.bankAccountId === settlementBank.id &&
      !item.isReversed &&
      item.reference?.trim().toLocaleLowerCase() === normalizedReference
    ));
    if (duplicate || duplicateBankReference) {
      throw new Error('Posible liquidación duplicada: revise la referencia, fecha, importe, medio, cuenta bancaria y tasa antes de registrar nuevamente.');
    }
    // La deuda en USD conserva el principal de la factura. En Bs, la cuenta
    // por cobrar/pagar se cancela al valor contable de la tasa de emisión y la
    // diferencia se reconoce como ganancia o pérdida cambiaria en la fecha del pago.
    const invoiceRate = Number(document.bcvRate) > 0
      ? Number(document.bcvRate)
      : (Number(document.totalAmountUsd) > 0 ? Number(document.totalAmountBs) / Number(document.totalAmountUsd) : 0);
    if (!Number.isFinite(invoiceRate) || invoiceRate <= 0) {
      throw new Error('La factura no tiene una tasa de emisión válida. Corrija la tasa original antes de registrar el pago.');
    }
    const amountAtInvoiceRate = Math.round(draft.amountUsd * invoiceRate * 100) / 100;
    const amountAtSettlementRate = Math.round(draft.amountUsd * draft.bcvRate * 100) / 100;
    const actualAmountBs = Math.round(draft.amountBs * 100) / 100;
    if (Math.abs(actualAmountBs - amountAtSettlementRate) >= 0.01) {
      throw new Error('El importe en Bs no coincide con el equivalente a la tasa de liquidación. Revise la tasa o el importe.');
    }
    const fxDifferenceBs = Math.round((actualAmountBs - amountAtInvoiceRate) * 100) / 100;
    const fiscalMode = document.fiscalAdjustmentMode || 'REVISION_CONTADOR';
    // La propuesta fiscal es informativa: nunca debe impedir ni dejar a medias
    // el registro contable válido de una liquidación histórica.
    let fxFiscalAdjustmentProposal: CreditSettlement['fxFiscalAdjustmentProposal'];
    try {
      fxFiscalAdjustmentProposal = calculateFxFiscalAdjustment({
        totalAmountUsd: Number(document.totalAmountUsd || 0),
        taxableBaseUsd: Number(document.taxableBaseUsd || 0),
        vatAmountUsd: Number(document.vatAmountUsd || 0),
        exemptAmountUsd: Math.max(0, Number(document.totalAmountUsd || 0) - Number(document.taxableBaseUsd || 0) - Number(document.vatAmountUsd || 0) - Number(document.igtfAmountUsd || 0)),
        invoiceRate,
        settlementRate: draft.bcvRate,
        settledAmountUsd: Math.round(draft.amountUsd * 100) / 100,
        mode: fiscalMode
      });
    } catch {
      fxFiscalAdjustmentProposal = {
        direction: 'REVIEW_REQUIRED', deltaBaseBs: 0, deltaVatBs: 0,
        deltaExemptBs: 0, deltaTotalBs: 0,
        explanation: 'No se pudo calcular la propuesta con los datos fiscales disponibles; requiere revisión manual.'
      };
    }
    const operationKey = [
      currentCompany.id, draft.documentId, kind, draft.settlementDate,
      Math.round(draft.amountUsd * 100), Math.round(draft.amountBs * 100),
      Math.round(draft.bcvRate * 1000000), draft.method, draft.bankAccountId || '',
      (draft.reference || '').trim().toLocaleLowerCase()
    ].join('|');
    if (settlementInFlightRef.current.has(operationKey)) {
      throw new Error('Esta liquidación ya se está registrando o fue registrada en esta sesión. Verifique el saldo antes de reintentar.');
    }
    settlementInFlightRef.current.add(operationKey);
    const cashCode = settlementBank?.accountCode || (draft.method === 'CASH_USD' ? '1.1.1.02' : '1.1.1.01');
    const cashAccount = accounts.find(account => account.code === cashCode && account.isMovement);
    let controlCode = '1.1.2.01';
    if (kind === 'PURCHASE_PAYMENT') {
      const purchaseDocument = document as PurchaseRecord;
      const sourceEntry = purchaseDocument.journalEntryId
        ? journalEntries.find(entry => entry.id === purchaseDocument.journalEntryId && entry.companyId === currentCompany.id)
        : undefined;
      const expectedType = purchaseDocument.documentType === '02' ? 'AJUSTE' : 'COMPRA';
      const payableCodes = [...new Set((sourceEntry?.items || [])
        .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
        .map(item => String(item.accountCode)))];
      if (!sourceEntry || sourceEntry.type !== expectedType || payableCodes.length !== 1) {
        settlementInFlightRef.current.delete(operationKey);
        throw new Error('El documento no conserva un asiento verificable con una única cuenta auxiliar de CxP. No se registró el pago.');
      }
      controlCode = payableCodes[0];
    }
    const controlAccount = accounts.find(account => account.code === controlCode &&
      account.isMovement && (kind === 'SALE_COLLECTION' ? account.type === 'ACTIVO' : account.type === 'PASIVO'));
    if (!cashAccount || !controlAccount) {
      settlementInFlightRef.current.delete(operationKey);
      throw new Error('No se encontraron las cuentas contables necesarias para liquidar la factura.');
    }
    const amountBs = actualAmountBs;
    const amountUsd = Math.round(draft.amountUsd * 100) / 100;
    const fxGain = accounts.find(account => account.code === '4.2.1.01' && account.isMovement);
    const fxLoss = accounts.find(account => account.code === '6.1.1.08' && account.isMovement);
    let entry: JournalEntry;
    try {
      entry = addJournalEntry({
        entryNumber: 0,
        date: draft.settlementDate,
        description: (kind === 'SALE_COLLECTION' ? 'Cobro de cuenta por cobrar' : 'Pago de cuenta por pagar') + ' - ' + document.invoiceNumber + (Math.abs(fxDifferenceBs) >= 0.01 ? ' (incluye diferencia cambiaria)' : ''),
        type: 'AJUSTE',
        bcvRate: draft.bcvRate,
        referenceDoc: document.invoiceNumber,
        items: buildCreditSettlementJournalItems({
          kind, method: draft.method, amountBs, amountUsd, invoiceRate,
          settlementRate: draft.bcvRate,
          cashAccount, controlAccount, fxGainAccount: fxGain, fxLossAccount: fxLoss
        })

      });
    } catch (error) {
      settlementInFlightRef.current.delete(operationKey);
      throw error;
    }
    const settlement: CreditSettlement = {
      ...draft,
      id: `settlement-${currentCompany.id}-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      companyId: currentCompany.id,
      amountBs,
      amountUsd,
      bankAccountId: settlementBank?.id,
      fxFiscalAdjustmentProposal,
      journalEntryId: entry.id,
      createdAt: new Date().toISOString()
    };
    setCreditSettlements(prev => [...prev, settlement]);
    try {
      // El asiento y la liquidación forman una sola confirmación funcional:
      // el llamador no recibe éxito hasta que el snapshot completo esté guardado.
      await waitForPersistence();
      return settlement;
    } finally {
      settlementInFlightRef.current.delete(operationKey);
    }
  };

  const deleteJournalEntry = (id: string) => {
    const entry = journalEntries.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!entry) return;
    // Inmutabilidad estricta: todo asiento contabilizado forma parte del Libro
    // Diario, incluso los manuales y los contra-asientos. La corrección se hace
    // exclusivamente con un nuevo asiento enlazado, nunca borrando el original.
    if (typeof window !== 'undefined') {
      window.alert('El Libro Diario es inmutable: ningún asiento contabilizado puede eliminarse físicamente. Registre un asiento de reversión o ajuste con su justificación y papel de trabajo.');
    }
  };

  // Registrar compra y generar asiento automático y comprobantes de retención
  const addPurchase = (purchaseData: Omit<PurchaseRecord, 'id' | 'companyId' | 'opNumber'>, targetCompanyId: string = currentCompany.id): PurchaseRecord => {
    const targetCompany = companies.find(company => company.id === targetCompanyId);
    if (!targetCompany) throw new Error('La empresa destino de la compra no existe en SICOVEN.');
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La edición de escritorio requiere SQLite local disponible y lista. No se registró la compra.');
    }
    const settlementModeError = validatePurchaseSettlementMode(
      purchaseData.paymentTerm, purchaseData.paymentAccountCode, accounts, purchaseData.paymentReference
    );
    if (settlementModeError) throw new Error(settlementModeError);
    // Defensa de dominio: las compras nunca deben crear asientos con tasa o importes inválidos.
    if (!targetCompany) throw new Error('Selecciona una empresa antes de registrar la compra.');
    const rate = Number(purchaseData.bcvRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('La tasa BCV manual debe ser mayor que cero.');
    const amounts = [
      purchaseData.totalAmountBs, purchaseData.taxableBaseBs, purchaseData.exemptAmountBs,
      purchaseData.vatAmountBs, purchaseData.vatWithheldBs, purchaseData.islrWithheldBs || 0,
      purchaseData.igtfAmountBs || 0
    ];
    if (amounts.some(value => !Number.isFinite(value) || value < 0) || purchaseData.totalAmountBs <= 0) {
      throw new Error('La compra contiene importes inválidos; revisa la factura antes de guardarla.');
    }
    if (purchaseData.inventoryLines !== undefined) {
      if (!Array.isArray(purchaseData.inventoryLines)) {
        throw new Error('Las líneas de inventario de la compra no tienen un formato válido.');
      }
      if (purchaseData.inventoryLines.length > 0) {
        const seenProducts = new Set<string>();
        let inventoryLineTotal = 0;
        for (const line of purchaseData.inventoryLines) {
          const quantity = Number(line.quantity);
          const unitCost = Number(line.unitCostBs);
          const product = products.find(item => item.id === line.productId && item.companyId === targetCompany.id);
          if (!product || seenProducts.has(String(line.productId)) ||
              !Number.isFinite(quantity) || quantity <= 0 ||
              !Number.isFinite(unitCost) || unitCost <= 0) {
            throw new Error('Las líneas de inventario requieren artículos existentes, sin duplicados, y cantidades/costos positivos.');
          }
          seenProducts.add(String(line.productId));
          inventoryLineTotal += quantity * unitCost;
          const latestMovementDate = movements
            .filter(movement => movement.companyId === targetCompany.id && movement.productId === product.id)
            .reduce((latest, movement) => movement.date > latest ? movement.date : latest, '');
          if (latestMovementDate && purchaseData.invoiceDate < latestMovementDate) {
            throw new Error('La fecha de compra es anterior al último movimiento del Kardex de ' + product.code + '. Registre las operaciones en orden cronológico.');
          }
        }
        const expectedInventoryTotal = Number(purchaseData.taxableBaseBs) + Number(purchaseData.exemptAmountBs);
        if (Math.abs(Math.round(inventoryLineTotal * 100) / 100 - Math.round(expectedInventoryTotal * 100) / 100) > 0.02) {
          throw new Error('Las líneas de inventario no concilian con la base imponible más el monto exento de la factura.');
        }
      }
    }
    // Validación de documento en la capa de dominio: no confiar solo en required del formulario.
    if (targetCompany.closedThroughDate && (purchaseData.invoiceDate <= targetCompany.closedThroughDate || purchaseData.accountCreditDate! <= targetCompany.closedThroughDate)) {
      throw new Error('El período está cerrado hasta ' + targetCompany.closedThroughDate + '. Registre el documento en el período abierto o solicite una corrección formal.');
    }
    if (!isValidIsoDate(purchaseData.invoiceDate) || !isValidIsoDate(purchaseData.accountCreditDate || '') ||
        !String(purchaseData.invoiceNumber || '').trim() ||
        !String(purchaseData.controlNumber || '').trim()) {
      throw new Error('La compra requiere fecha de emisión y fecha de abono en cuenta válidas, número de factura y número de control.');
    }
    if (!String(purchaseData.supplierName || '').trim() || !validateVenezuelanRif(purchaseData.supplierRif).isValid) {
      throw new Error('La compra requiere razón social y un RIF venezolano con estructura válida.');
    }
    // No generar asientos de compra positivos para notas que requieren reversión contable/fiscal.
    // Hasta completar el flujo de notas de débito/crédito, se rechazan para evitar alterar saldos incorrectamente.
    if (purchaseData.documentType !== '01') {
      throw new Error('Las notas de débito/crédito de proveedores requieren un flujo de reversión fiscal y contable que aún no está habilitado. Registra solo facturas (01) en este módulo.');
    }
    if (!Number.isFinite(purchaseData.taxRate) || purchaseData.taxRate < 0 || purchaseData.taxRate > 100 ||
        !Number.isFinite(purchaseData.retentionRate) || purchaseData.retentionRate < 0 || purchaseData.retentionRate > 100) {
      throw new Error('La alícuota de IVA o la tasa de retención no es válida.');
    }
    const expectedVat = Math.round(purchaseData.taxableBaseBs * purchaseData.taxRate) / 100;
    if (Math.abs(expectedVat - purchaseData.vatAmountBs) > 0.01) {
      throw new Error('El IVA no coincide con la base imponible y la alícuota declarada.');
    }
    if (purchaseData.vatWithheldBs > 0 && !purchaseData.ivaRetentionDecision) {
      throw new Error('No se puede emitir un comprobante de retención sin una decisión fiscal calculada y conservada por SICOVEN.');
    }
    if (purchaseData.ivaRetentionDecision) {
      const snapshot = purchaseData.ivaRetentionDecision;
      const expectedBuyerAgentStatus = resolveIvaBuyerAgentStatus({ agentBasis: targetCompany.ivaRetentionAgentBasis, taxpayerType: targetCompany.taxpayerType, rif: targetCompany.rif, isPersonalFirm: targetCompany.isPersonalFirm });
      if (snapshot.buyerAgentStatus !== expectedBuyerAgentStatus) throw new Error('La condición de agente de retención de la empresa cambió o no coincide. Actualice la evaluación antes de registrar.');
      const expectedOperationAmountBs = Math.round((Number(purchaseData.taxableBaseBs) + Number(purchaseData.exemptAmountBs) + Number(purchaseData.vatAmountBs) + Number.EPSILON) * 100) / 100;
      const fiscalPeriodStart = getPurchaseAccountCreditDate(purchaseData).slice(0, 7);
      const expectedUnitTaxValueBs = getIslrUnitTaxValueForPeriod(fiscalPeriodStart) ?? undefined;
      if (snapshot.operationAmountBs != null && Math.abs(snapshot.operationAmountBs - expectedOperationAmountBs) > 0.01) {
        throw new Error('El importe usado para validar la exclusión de 20 UT no coincide con los importes reales de la compra.');
      }
      const has20UtExclusion = snapshot.article3Exclusions.some(item => item === 'REIMBURSABLE_UP_TO_20_UT' || item === 'PETTY_CASH_UP_TO_20_UT');
      if (has20UtExclusion && snapshot.operationAmountBs == null) {
        throw new Error('La compra debe conservar el importe de la operación utilizado para evaluar el límite de 20 UT.');
      }
      if (has20UtExclusion && expectedUnitTaxValueBs != null && snapshot.unitTaxValueBs == null) {
        throw new Error('La compra debe conservar el valor de UT utilizado para evaluar el límite de 20 UT.');
      }
      if (snapshot.unitTaxValueBs != null && (expectedUnitTaxValueBs == null || Math.abs(snapshot.unitTaxValueBs - expectedUnitTaxValueBs) > 0.01)) {
        throw new Error('La UT usada para evaluar la exclusión fiscal no coincide con el parámetro vigente para la fecha de la operación.');
      }
      const evaluated = evaluateIvaRetentionEligibility({ buyerAgentStatus: snapshot.buyerAgentStatus, supplierTaxStatus: snapshot.supplierTaxStatus, article2Transaction: snapshot.article2Transaction, article3Exclusions: snapshot.article3Exclusions as any, portalArticle3ExclusionConfirmed: snapshot.portalArticle3ExclusionConfirmed, supplierImportPerceptionConfirmed: snapshot.supplierImportPerceptionConfirmed, operationAmountBs: expectedOperationAmountBs, unitTaxValueBs: expectedUnitTaxValueBs, vatAmount: purchaseData.vatAmountBs, ...(snapshot.vatNotDiscriminated ? { vatNotDiscriminated: true, taxableAmountIncludingVat: snapshot.taxableAmountIncludingVatBs } : {}), taxRate: purchaseData.taxRate, invoiceFormalDefect: snapshot.invoiceFormalDefect, portalRetentionRate: snapshot.portalRetentionRate ?? null });
      if (evaluated.status !== snapshot.decisionStatus || evaluated.retentionRate !== purchaseData.retentionRate || Math.abs(evaluated.withheldAmount - purchaseData.vatWithheldBs) > 0.01 || evaluated.reason !== snapshot.decisionReason || purchaseData.supplierTaxStatus !== snapshot.supplierTaxStatus) throw new Error('La evaluación fiscal de retención IVA no coincide con los datos de la compra. Revise la clasificación y vuelva a calcular.');
    }
    if (purchaseData.vatWithheldBs > purchaseData.vatAmountBs + 0.01) {
      throw new Error('La retención de IVA no puede superar el IVA causado en la factura.');
    }
    const normalizeDocument = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');
    const normalizeRif = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const duplicateInvoice = [...purchases, ...(activeImportBatchRef.current?.purchases || [])].some(existing =>
      existing.companyId === targetCompany.id &&
      existing.documentType === purchaseData.documentType &&
      normalizeDocument(existing.invoiceNumber) === normalizeDocument(purchaseData.invoiceNumber) &&
      normalizeRif(existing.supplierRif) === normalizeRif(purchaseData.supplierRif)
    );
    if (duplicateInvoice) {
      throw new Error('Ya existe una compra registrada con ese tipo de documento, proveedor y número de factura.');
    }
    const igtfAmount = Number(purchaseData.igtfAmountBs || 0);
    if (igtfAmount > 0 && purchaseData.paymentTerm === 'CREDITO') {
      throw new Error('No se puede reconocer IGTF al registrar una compra totalmente a crédito. La obligación se evalúa cuando se debite la cuenta o se cancele la deuda.');
    }
    const eligibleIgtfMethods = ['FOREIGN_CASH', 'ZELLE', 'INTERNATIONAL_TRANSFER', 'CRYPTO'];
    if (igtfAmount > 0 && (!purchaseData.igtfApplicable || !eligibleIgtfMethods.includes(purchaseData.paymentMethod || ''))) {
      throw new Error('El IGTF requiere un medio de pago elegible y confirmación expresa.');
    }
    if (purchaseData.igtfApplicable) {
      if (!eligibleIgtfMethods.includes(purchaseData.paymentMethod || '')) {
        throw new Error('El medio de pago seleccionado no corresponde a los medios configurados para IGTF.');
      }
      const expectedIgtf = Math.round((purchaseData.taxableBaseBs + purchaseData.exemptAmountBs + purchaseData.vatAmountBs) * 0.03 * 100) / 100;
      if (Math.abs(igtfAmount - expectedIgtf) > 0.01 || Number(purchaseData.igtfRate || 0) !== 3) {
        throw new Error('El importe o la tasa del IGTF no coincide con el cálculo confirmado del 3%.');
      }
    } else if (igtfAmount !== 0) {
      throw new Error('No se permite registrar un importe IGTF sin confirmación expresa.');
    }

    const expectedTotal = Math.round((
      purchaseData.taxableBaseBs + purchaseData.exemptAmountBs +
      purchaseData.vatAmountBs + igtfAmount
    ) * 100) / 100;
    if (Math.abs(expectedTotal - purchaseData.totalAmountBs) > 0.01) {
      throw new Error('El total de la compra no coincide con base imponible, exento, IVA e IGTF.');
    }
    if ((purchaseData.vatWithheldBs || 0) + (purchaseData.islrWithheldBs || 0) > purchaseData.totalAmountBs + 0.005) {
      throw new Error('Las retenciones no pueden superar el total de la factura.');
    }
    if (purchaseData.islrConceptCode || Number(purchaseData.islrWithheldBs || 0) > 0) {
      const concept = ISLR_CONCEPTS.find(item => item.code === purchaseData.islrConceptCode);
      if (!concept || purchaseData.islrBeneficiaryType !== concept.category ||
          purchaseData.islrResidency !== (concept.category === 'PN'
            ? (concept.isResident ? 'RESIDENT' : 'NON_RESIDENT')
            : (concept.isResident ? 'DOMICILED' : 'NON_DOMICILED'))) {
        throw new Error('La retención ISLR requiere un concepto vigente y la clasificación fiscal explícita del beneficiario.');
      }
      const supplierKey = String(purchaseData.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const monthKey = String(purchaseData.accountCreditDate || '').slice(0, 7);
      const expectedUnitTaxValueBs = getIslrUnitTaxValueForPeriod(monthKey);
      if (expectedUnitTaxValueBs == null || purchaseData.islrUnitTaxValueBs !== expectedUnitTaxValueBs ||
          purchaseData.islrFormulaFactor !== ISLR_FORMULA_FACTOR ||
          purchaseData.islrBasePercentage !== concept.basePercentage) {
        throw new Error('Los parámetros históricos de cálculo ISLR no coinciden con el concepto fiscal seleccionado.');
      }
      const matchingMonthlyOperations = [...purchases, ...(activeImportBatchRef.current?.purchases || [])].filter(item =>
        item.companyId === targetCompany.id &&
        item.documentType === '01' &&
        String(item.supplierRif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === supplierKey &&
        item.islrConceptCode === concept.code &&
        getPurchaseAccountCreditDate(item).slice(0, 7) === monthKey
      );
      if (matchingMonthlyOperations.some(item => item.isCancelled)) {
        throw new Error('Existe una operación ISLR del mismo proveedor, concepto y mes que fue anulada y requiere rectificación fiscal. No se puede recalcular el acumulado hasta resolver esa corrección.');
      }
      const priorMonthlyOperations = matchingMonthlyOperations;
      if (priorMonthlyOperations.some(item =>
        item.islrUnitTaxValueBs !== purchaseData.islrUnitTaxValueBs ||
        item.islrFormulaFactor !== purchaseData.islrFormulaFactor ||
        item.islrBasePercentage !== purchaseData.islrBasePercentage ||
        !Number.isFinite(Number(item.taxableBaseBs)) || Number(item.taxableBaseBs) < 0 ||
        !Number.isFinite(Number(item.islrWithheldBs)) ||
        !Number.isFinite(Number(item.islrSubtrahendBs))
      )) {
        throw new Error('El historial ISLR mensual contiene parámetros incompletos o distintos. Se requiere conciliación fiscal antes de acumular.');
      }
      const expectedIslr = calculateMonthlyIslrRetention(
        purchaseData.taxableBaseBs,
        priorMonthlyOperations.map(item => ({
          baseAmountBs: item.taxableBaseBs,
          withheldAmountBs: item.islrWithheldBs,
          subtrahendBs: item.islrSubtrahendBs
        })),
        concept,
        expectedUnitTaxValueBs
      );
      if (Math.abs(expectedIslr.withheldAmountBs - Number(purchaseData.islrWithheldBs)) > 0.01 ||
          Math.abs(expectedIslr.subtrahendBs - Number(purchaseData.islrSubtrahendBs || 0)) > 0.01 ||
          Math.abs(expectedIslr.rate - Number(purchaseData.islrRate || 0)) > 0.001) {
        throw new Error('El importe ISLR no coincide con la fórmula, base, tasa y sustraendo del concepto seleccionado.');
      }
    }

    const companyPurchases = purchases.filter(p => p.companyId === targetCompany.id);
    const companyKey = targetCompany.id;
    const nextOp = Math.max(companyPurchases.reduce((max, p) => Math.max(max, p.opNumber || 0), 0), purchaseSequenceRef.current[companyKey] || 0) + 1;
    purchaseSequenceRef.current[companyKey] = nextOp;
    const purchaseId = `pur-${companyKey}-${nextOp}-${Date.now()}`;

    // El comprobante IVA se asigna al primer disparador fiscal: pago efectivo
    // para contado o abono en cuenta para crédito. invoiceDate sigue siendo
    // exclusivamente la fecha documental de la factura.
    const vatFiscalEvent = purchaseData.vatWithheldBs > 0
      ? resolvePurchaseVatFiscalEvent(purchaseData.paymentTerm, purchaseData.accountCreditDate!)
      : undefined;
    let voucherNum = purchaseData.voucherNumber;
    const vatPeriod = vatFiscalEvent?.period || '';
    const islrPeriod = purchaseData.accountCreditDate!.slice(0, 7).replace('-', '');
    if (purchaseData.vatWithheldBs > 0 && !voucherNum && vatFiscalEvent) {
      const year = Number(vatFiscalEvent.fiscalDate.slice(0, 4));
      const month = Number(vatFiscalEvent.fiscalDate.slice(5, 7));
      const voucherKey = `${companyKey}:${vatPeriod}`;
      const companyVouchersCount = vatVouchers.filter(v => v.companyId === targetCompany.id && v.period === vatPeriod).length;
      const voucherSequence = Math.max(companyVouchersCount, vatVoucherSequenceRef.current[voucherKey] || 0) + 1;
      vatVoucherSequenceRef.current[voucherKey] = voucherSequence;
      voucherNum = formatVoucherNumber(year, month, voucherSequence);
    }
    if (purchaseData.vatWithheldBs > 0 && voucherNum &&
        (!/^\d{14}$/.test(voucherNum) || voucherNum.slice(0, 6) !== vatPeriod)) {
      throw new Error('El comprobante IVA debe corresponder al período del primer pago o abono en cuenta (AAAAMM + correlativo de ocho dígitos).');
    }

    // 1. Generar Asiento Contable Automático en Libro Diario
    const items: JournalEntryItem[] = [];

    // Debe: distribuir el costo de inventario por la cuenta auxiliar real de cada artículo.
    // Si no hay líneas de inventario, se exige una cuenta de débito explícita y validada.
    const hasInventoryLines = Array.isArray(purchaseData.inventoryLines) && purchaseData.inventoryLines.length > 0;
    if (hasInventoryLines) {
      const inventoryByAccount = new Map<string, { name: string; amountBs: number; productCodes: string[] }>();
      for (const purchaseLine of purchaseData.inventoryLines || []) {
        const product = products.find(item => item.id === purchaseLine.productId && item.companyId === targetCompany.id);
        if (!product) throw new Error('No se puede contabilizar una línea de compra sin artículo válido.');
        const accountCode = product.inventoryAccountCode || '1.1.4.01';
        const account = accounts.find(item => item.code === accountCode && item.isMovement);
        if (!account) throw new Error('La cuenta de inventario ' + accountCode + ' del artículo ' + product.code + ' no existe o no admite movimientos.');
        const current = inventoryByAccount.get(accountCode) || { name: account.name, amountBs: 0, productCodes: [] };
        current.amountBs += Number(purchaseLine.quantity) * Number(purchaseLine.unitCostBs);
        current.productCodes.push(product.code);
        inventoryByAccount.set(accountCode, current);
      }
      for (const [accountCode, group] of inventoryByAccount) {
        const amountBs = Math.round(group.amountBs * 100) / 100;
        if (amountBs <= 0) continue;
        items.push({
          accountCode, accountName: group.name,
          debitBs: amountBs, creditBs: 0,
          debitUsd: amountBs / rate, creditUsd: 0,
          description: `Inventario compra Fac. ${purchaseData.invoiceNumber} · ${group.productCodes.join(', ')}`
        });
      }
    } else {
      const baseBs = Number(purchaseData.taxableBaseBs) + Number(purchaseData.exemptAmountBs);
      const debitAccount = resolveNonInventoryPurchaseDebitAccount(accounts, purchaseData.purchaseDebitAccountCode, baseBs);
      if (baseBs > 0 && debitAccount) items.push({
        accountCode: debitAccount.code,
        accountName: debitAccount.name,
        debitBs: baseBs, creditBs: 0, debitUsd: baseBs / rate, creditUsd: 0,
        description: `Compra ${debitAccount.type === 'GASTOS' ? 'no inventariable' : debitAccount.type === 'COSTOS' ? 'de costo de servicio' : 'de activo'} Fac. ${purchaseData.invoiceNumber} - ${purchaseData.supplierName}`
      });
    }

    // Debe: Crédito Fiscal IVA si aplica
    if (purchaseData.vatAmountBs > 0) {
      items.push({
        accountCode: '1.1.3.01',
        accountName: `Crédito Fiscal IVA Compras (${purchaseData.taxRate}%)`,
        debitBs: purchaseData.vatAmountBs,
        creditBs: 0,
        debitUsd: purchaseData.vatAmountBs / rate,
        creditUsd: 0,
        description: `IVA ${purchaseData.taxRate}% Fac. ${purchaseData.invoiceNumber}`
      });
    }

    // Debe: IGTF de compra explícitamente confirmado por el usuario.
    if (Number(purchaseData.igtfAmountBs || 0) > 0) {
      items.push({ accountCode: '6.1.1.11', accountName: 'Gasto por IGTF en compras', debitBs: Number(purchaseData.igtfAmountBs), creditBs: 0, debitUsd: Number(purchaseData.igtfAmountUsd || (Number(purchaseData.igtfAmountBs) / rate)), creditUsd: 0, description: `IGTF ${purchaseData.igtfRate || 3}% compra Fac. ${purchaseData.invoiceNumber}` });
    }

    // Haber: Retención IVA por enterar al SENIAT (si la empresa retuvo)
    if (purchaseData.vatWithheldBs > 0) {
      items.push({
        accountCode: '2.1.2.03',
        accountName: 'Retenciones de IVA por Enterar (Agente Especial)',
        debitBs: 0,
        creditBs: purchaseData.vatWithheldBs,
        debitUsd: 0,
        creditUsd: purchaseData.vatWithheldBs / rate,
        description: `Retención IVA ${purchaseData.retentionRate}% s/Fac. ${purchaseData.invoiceNumber}`
      });
    }

    // Haber: Retención ISLR por enterar al SENIAT si aplica
    if (purchaseData.islrWithheldBs && purchaseData.islrWithheldBs > 0) {
      items.push({
        accountCode: '2.1.2.04',
        accountName: 'Retenciones de ISLR por Enterar (Decreto 1808)',
        debitBs: 0,
        creditBs: purchaseData.islrWithheldBs,
        debitUsd: 0,
        creditUsd: purchaseData.islrWithheldBs / rate,
        description: `Retención ISLR ${purchaseData.islrRate}% s/Fac. ${purchaseData.invoiceNumber}`
      });
    }

    // Haber: crédito reconoce CxP; contado acredita directamente la cuenta
    // de Caja/Banco seleccionada por el contador.
    const netPayableBs = purchaseData.totalAmountBs - (purchaseData.vatWithheldBs || 0) - (purchaseData.islrWithheldBs || 0);
    const cashPurchase = purchaseData.paymentTerm === 'CONTADO';
    const paymentAccount = cashPurchase
      ? accounts.find(account => account.code === purchaseData.paymentAccountCode && account.isMovement)
      : undefined;
    if (cashPurchase && !paymentAccount) throw new Error('La cuenta contable de pago de contado ya no está disponible en el Plan de Cuentas.');
    const bankPaymentAccount = cashPurchase
      ? bankAccounts.find(bank => bank.companyId === targetCompany.id && bank.accountCode === paymentAccount!.code)
      : undefined;
    if (bankPaymentAccount) {
      const balanceEntries = activeImportBatchRef.current
        ? [...journalEntries, ...activeImportBatchRef.current.journalEntries]
        : journalEntries;
      const availableBalance = calculateBankAvailableBalance({
        bankAccount: bankPaymentAccount, companyId: targetCompany.id,
        asOfDate: purchaseData.accountCreditDate!, journalEntries: balanceEntries
      });
      validateBankOutgoingAvailability({
        availableBalance,
        requestedAmount: bankPaymentAccount.currency === 'USD' ? netPayableBs / rate : netPayableBs,
        currency: bankPaymentAccount.currency
      });
    }
    items.push({
      accountCode: cashPurchase ? paymentAccount!.code : '2.1.1.01',
      accountName: cashPurchase ? paymentAccount!.name : 'Cuentas por Pagar Proveedores Nacionales',
      debitBs: 0, creditBs: netPayableBs, debitUsd: 0, creditUsd: netPayableBs / rate,
      description: cashPurchase
        ? `Pago contado Fac. ${purchaseData.invoiceNumber} · Soporte ${purchaseData.paymentReference}`
        : `Neto a pagar Fac. ${purchaseData.invoiceNumber}`
    });

    const debitBs = items.reduce((sum, item) => sum + (Number(item.debitBs) || 0), 0);
    const creditBs = items.reduce((sum, item) => sum + (Number(item.creditBs) || 0), 0);
    const debitUsd = items.reduce((sum, item) => sum + (Number(item.debitUsd) || 0), 0);
    const creditUsd = items.reduce((sum, item) => sum + (Number(item.creditUsd) || 0), 0);
    if (!isJournalEntryBalanced({ debitBs, creditBs, debitUsd, creditUsd })) {
      throw new Error('El asiento automático de la compra no cuadra en Bs. y USD; la operación no se guardó.');
    }

    const companyEntries = journalEntries.filter(e => e.companyId === targetCompany.id);
    const nextEntryNum = Math.max(companyEntries.reduce((max, entry) => Math.max(max, entry.entryNumber || 0), 0), journalSequenceRef.current[companyKey] || 0) + 1;
    journalSequenceRef.current[companyKey] = nextEntryNum;

    const createdJournalEntry: JournalEntry = {
      id: `entry-pur-${companyKey}-${nextEntryNum}-${Date.now()}`,
      companyId: targetCompany.id,
      entryNumber: nextEntryNum,
      date: purchaseData.accountCreditDate!,
      description: `Registro Factura de Compra N° ${purchaseData.invoiceNumber} - ${purchaseData.supplierName}`,
      type: 'COMPRA',
      bcvRate: rate,
      referenceDoc: `FAC-${purchaseData.invoiceNumber}`,
      items,
      createdAt: new Date().toISOString()
    };

    reserveBankOutgoingAccounts(createdJournalEntry.companyId, createdJournalEntry.items);
    activeImportBatchRef.current?.journalEntries.push(createdJournalEntry);
    setJournalEntries(prev => [...prev, createdJournalEntry]);

    const finalPurchase: PurchaseRecord = {
      ...purchaseData,
      // Persistir la tasa explícita y validada usada en el asiento.
      bcvRate: rate,
      totalAmountUsd: purchaseData.totalAmountBs / rate,
      taxableBaseUsd: purchaseData.taxableBaseBs / rate,
      vatAmountUsd: purchaseData.vatAmountBs / rate,
      vatWithheldUsd: purchaseData.vatWithheldBs / rate,
      islrWithheldUsd: (purchaseData.islrWithheldBs || 0) / rate,
      igtfAmountUsd: igtfAmount / rate,
      id: purchaseId,
      companyId: targetCompany.id,
      opNumber: nextOp,
      voucherNumber: voucherNum,
      journalEntryId: createdJournalEntry.id
    };

    activeImportBatchRef.current?.purchases.push(finalPurchase);
    setPurchases(prev => [...prev, finalPurchase]);

    // 2. Si retuvo IVA, crear el comprobante oficial de retención de IVA
    if (purchaseData.vatWithheldBs > 0 && voucherNum) {
      const vatVoucher: VatRetentionVoucher = {
        id: `vouch-iva-${purchaseId}`,
        companyId: targetCompany.id,
        voucherNumber: voucherNum,
        date: new Date().toISOString().slice(0, 10),
        period: vatFiscalEvent!.period,
        fiscalTrigger: vatFiscalEvent!.trigger,
        fiscalDate: vatFiscalEvent!.fiscalDate,
        paymentReference: vatFiscalEvent!.trigger === 'PAYMENT' ? purchaseData.paymentReference : undefined,
        agentNameSnapshot: targetCompany.name,
        agentRifSnapshot: targetCompany.rif,
        agentAddressSnapshot: targetCompany.address,
        supplierRif: purchaseData.supplierRif,
        supplierName: purchaseData.supplierName,
        supplierAddress: purchaseData.supplierAddress || 'Venezuela',
        supplierEmailSnapshot: purchaseData.supplierEmail?.trim() || undefined,
        purchaseRecordId: purchaseId,
        invoiceDate: purchaseData.invoiceDate,
        invoiceNumber: purchaseData.invoiceNumber,
        controlNumber: purchaseData.controlNumber,
        totalAmountBs: purchaseData.totalAmountBs,
        exemptAmountBs: purchaseData.exemptAmountBs,
        taxableBaseBs: purchaseData.taxableBaseBs,
        taxRate: purchaseData.taxRate,
        vatAmountBs: purchaseData.vatAmountBs,
        retentionRate: purchaseData.retentionRate,
        vatWithheldBs: purchaseData.vatWithheldBs,
        bcvRate: rate,
        totalAmountUsd: purchaseData.totalAmountUsd,
        vatWithheldUsd: purchaseData.vatWithheldUsd
      };
      setVatVouchers(prev => [...prev, vatVoucher]);
    }

    // 3. Emitir comprobante cuando exista importe retenido.
    let createdIslrVoucher: IslrRetentionVoucher | undefined;
    if (purchaseData.islrWithheldBs && purchaseData.islrWithheldBs > 0) {
      const islrVoucher: IslrRetentionVoucher = {
        id: `vouch-islr-${purchaseId}`,
        companyId: targetCompany.id,
        voucherNumber: (() => {
          const voucherKey = `${companyKey}:${islrPeriod}`;
          const existingSequence = getMaxIslrVoucherSequence(
            islrPeriod,
            islrVouchers.filter(v => v.companyId === targetCompany.id && v.period === islrPeriod).map(v => v.voucherNumber)
          );
          const sequence = Math.max(existingSequence, islrVoucherSequenceRef.current[voucherKey] || 0) + 1;
          const number = formatIslrVoucherNumber(islrPeriod, sequence, purchaseData.accountCreditDate!);
          islrVoucherSequenceRef.current[voucherKey] = sequence;
          return number;
        })(),
        date: purchaseData.accountCreditDate!,
        period: islrPeriod,
        supplierRif: purchaseData.supplierRif,
        supplierName: purchaseData.supplierName,
        supplierAddress: purchaseData.supplierAddress || 'Venezuela',
        supplierEmailSnapshot: purchaseData.supplierEmail?.trim() || undefined,
        agentNameSnapshot: targetCompany.name,
        agentRifSnapshot: targetCompany.rif,
        agentAddressSnapshot: targetCompany.address,
        isPersonNatural: purchaseData.islrBeneficiaryType === 'PN',
        isResident: purchaseData.islrResidency === 'RESIDENT' || purchaseData.islrResidency === 'DOMICILED',
        conceptCode: purchaseData.islrConceptCode as string,
        conceptDescription: purchaseData.islrConceptName as string,
        invoiceNumber: purchaseData.invoiceNumber,
        controlNumber: purchaseData.controlNumber,
        invoiceDate: purchaseData.invoiceDate,
        baseAmountBs: purchaseData.taxableBaseBs,
        retentionRate: purchaseData.islrRate as number,
        subtrahendBs: purchaseData.islrSubtrahendBs || 0,
        withheldAmountBs: purchaseData.islrWithheldBs,
        bcvRate: rate,
        baseAmountUsd: purchaseData.taxableBaseUsd,
        withheldAmountUsd: purchaseData.islrWithheldUsd || (purchaseData.islrWithheldBs / rate),
        unitTaxValueBs: purchaseData.islrUnitTaxValueBs,
        formulaFactor: purchaseData.islrFormulaFactor,
        basePercentage: purchaseData.islrBasePercentage
      };
      createdIslrVoucher = islrVoucher;
      setIslrVouchers(prev => [...prev, islrVoucher]);
    }

    // El hecho fiscal sigue el primer disparador registrado: contado = pago efectivo;
    // crédito = abono en cuenta. En ambos casos se usa la fecha efectiva capturada arriba.
    if (purchaseData.islrConceptCode && Number(purchaseData.taxableBaseBs) > 0) {
      const fiscalDate = purchaseData.accountCreditDate!;
      const eventKey = `${companyKey}:${fiscalDate}`;
      const existingDayEvents = islrFiscalEvents.filter(event =>
        event.companyId === targetCompany.id && event.fiscalDate === fiscalDate
      );
      const nextEventSequence = Math.max(
        existingDayEvents.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0),
        islrEventSequenceRef.current[eventKey] || 0
      ) + 1;
      islrEventSequenceRef.current[eventKey] = nextEventSequence;
      const fiscalEvent: IslrFiscalEvent = {
        id: `islr-event-${targetCompany.id}-${purchaseId}`,
        companyId: targetCompany.id,
        supplierRif: purchaseData.supplierRif,
        conceptCode: purchaseData.islrConceptCode,
        fiscalDate,
        sequence: nextEventSequence,
        kind: resolvePurchaseIslrFiscalTrigger(purchaseData.paymentTerm),
        allocations: [{ purchaseId, baseAmountBs: Number(purchaseData.taxableBaseBs) }],
        basePercentage: Number(purchaseData.islrBasePercentage),
        unitTaxValueBs: Number(purchaseData.islrUnitTaxValueBs),
        withheldAmountBs: Number(purchaseData.islrWithheldBs || 0),
        journalEntryId: createdJournalEntry.id,
        voucherId: createdIslrVoucher?.id,
        createdAt: new Date().toISOString()
      };
      setIslrFiscalEvents(prev => [...prev, fiscalEvent]);
    }

    return finalPurchase;
  };

  const purchaseCreditNoteInFlightRef = useRef(false);
  const supplierDebitNoteInFlightRef = useRef<Set<string>>(new Set());
  const addPurchaseCreditNote = async (request: PurchaseCreditNoteRequest): Promise<PurchaseRecord> => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La devolución requiere SQLite local de escritorio disponible y lista. No se registró.');
    }
    if (purchaseCreditNoteInFlightRef.current || correctionWorkflowInFlightRef.current) throw new Error('Ya hay una corrección o reversión documental en proceso. Espere a que SQLite confirme antes de intentar otra.');
    purchaseCreditNoteInFlightRef.current = true;
    correctionWorkflowInFlightRef.current = true;
    try {
      return await runAtomicInvoiceImport(async () => {
    if (!currentCompany) throw new Error('Selecciona una empresa antes de registrar la nota de crédito.');
    const purchase = purchases.find(item => item.id === request.purchaseId && item.companyId === currentCompany.id);
    if (!purchase || purchase.documentType !== '01' || purchase.isCancelled) {
      throw new Error('La factura original no existe, no pertenece a la empresa activa o está reversada.');
    }
    if (purchases.some(item => item.companyId === currentCompany.id &&
      item.documentType === '03' &&
      String(item.creditNoteNumber || item.invoiceNumber).trim().toUpperCase() === request.creditNoteNumber.trim().toUpperCase())) {
      throw new Error('El número de nota de crédito ya está registrado en esta empresa.');
    }
    const readiness = validatePurchaseInventoryReconciliation({
      companyId: currentCompany.id, purchase, movements, journalEntries, products
    });
    if (!readiness.ready) throw new Error('La factura original no está conciliada: ' + (readiness.reason || 'revise factura, Kardex y asiento.'));
    if (!Array.isArray(request.lines) || request.lines.length === 0) {
      throw new Error('Agregue al menos un artículo a la nota de crédito.');
    }
    const sourceMovementIds = request.lines.map(line => String(line.originalMovementId || ''));
    if (sourceMovementIds.some(id => !id) || new Set(sourceMovementIds).size !== sourceMovementIds.length) {
      throw new Error('Cada línea de devolución debe identificar una única entrada original de Kardex. Consolide las cantidades repetidas de una misma entrada.');
    }
    const draftLines = request.lines.map(line => {
      const product = products.find(item => item.id === line.productId && item.companyId === currentCompany.id);
      const originalMovement = movements.find(item => item.id === line.originalMovementId && item.companyId === currentCompany.id);
      if (!product || !originalMovement) throw new Error('No se encontró uno de los artículos o movimientos originales de Kardex.');
      const priorReturnedQuantity = movements
        .filter(item => item.companyId === currentCompany.id && item.correctionForMovementId === originalMovement.id &&
          item.type === 'SALIDA' && item.concept === 'DEVOLUCION_COMPRA')
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const latestMovementDate = movements.filter(item => item.companyId === currentCompany.id && item.productId === product.id)
        .reduce((latest, item) => item.date > latest ? item.date : latest, '');
      if (latestMovementDate && request.returnDate < latestMovementDate) {
        throw new Error('La devolución del artículo ' + product.code + ' debe registrarse después del último movimiento de Kardex (' + latestMovementDate + ').');
      }
      const requestedQuantity = Number(line.quantity);
      let fifoLayerAvailableQuantity: number | undefined;
      let fifoBalanceAfterReturnBs: number | undefined;
      let fifoBalanceAfterReturnUsd: number | undefined;
      if (product.costingMethod === 'PEPS') {
        const productHistory = movements
          .filter(item => item.companyId === currentCompany.id && item.productId === product.id)
          .map(item => ({
            type: item.type, quantity: item.quantity, unitCostBs: item.unitCostBs,
            unitCostUsd: item.unitCostUsd, date: item.date, documentRef: item.documentRef,
            balanceQty: item.balanceQty, id: item.id, concept: item.concept,
            correctionForMovementId: item.correctionForMovementId
          }));
        const fifoLayers = reconstructFifoLayers(productHistory, product.currentStock);
        const normalizeRef = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
        const originalLayer = fifoLayers.find(layer =>
          layer.sourceMovementId === originalMovement.id && layer.date === originalMovement.date &&
          normalizeRef(layer.documentRef) === normalizeRef(originalMovement.documentRef) &&
          Math.abs(Number(layer.unitCostBs) - Number(originalMovement.unitCostBs)) <= 0.01 &&
          Math.abs(Number(layer.unitCostUsd) - Number(originalMovement.unitCostUsd)) <= 0.0001
        );
        fifoLayerAvailableQuantity = Number(originalLayer?.quantity || 0);
        if (!originalLayer || fifoLayerAvailableQuantity + 0.000001 < requestedQuantity) {
          throw new Error('La capa PEPS de la factura ' + purchase.invoiceNumber + ' ya fue consumida total o parcialmente; solo puede devolverse la cantidad que permanezca en esa capa original.');
        }
        const remainingLayers = fifoLayers.map(layer => ({ ...layer }));
        const targetLayer = remainingLayers.find(layer =>
          layer.sourceMovementId === originalMovement.id && layer.date === originalLayer.date && layer.documentRef === originalLayer.documentRef &&
          Math.abs(layer.unitCostBs - originalLayer.unitCostBs) <= 0.000001
        )!;
        targetLayer.quantity -= requestedQuantity;
        fifoBalanceAfterReturnBs = Math.round(remainingLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0) * 100) / 100;
        fifoBalanceAfterReturnUsd = Math.round(remainingLayers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostUsd, 0) * 1000000) / 1000000;
      }
      return {
        product, originalMovement, quantity: requestedQuantity, previouslyReturnedQuantity: priorReturnedQuantity,
        currentStock: product.currentStock, currentAverageCostBs: product.avgCostBs,
        fifoLayerAvailableQuantity, fifoBalanceAfterReturnBs, fifoBalanceAfterReturnUsd
      };
    });
    const valuation = calculatePurchaseCreditNote({
      purchase, products: products.filter(item => item.companyId === currentCompany.id),
      lines: draftLines, returnDate: request.returnDate,
      creditNoteNumber: request.creditNoteNumber, controlNumber: request.controlNumber,
      reason: request.reason, fiscalEmissionMedium: request.fiscalEmissionMedium,
      sameMediumAsOriginal: request.sameMediumAsOriginal, closedThroughDate: currentCompany.closedThroughDate
    });
    const sourcePurchaseEntry = journalEntries.find(entry =>
      entry.companyId === currentCompany.id && entry.id === purchase.journalEntryId);
    const payableAccountCodes = [...new Set((sourcePurchaseEntry?.items || [])
      .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
      .map(item => String(item.accountCode)))];
    const cashPurchase = purchase.paymentTerm === 'CONTADO';
    if ((!cashPurchase && payableAccountCodes.length !== 1) || (cashPurchase && payableAccountCodes.length !== 0)) {
      throw new Error('La factura original no concilia con su modalidad de pago: se esperaba una única CxP para crédito o ninguna para contado.');
    }
    const payableAccountCode = payableAccountCodes[0];
    const balance = cashPurchase ? undefined : getCreditBalance(purchase.id, 'PURCHASE_PAYMENT');
    // Una factura pagada al contado no tiene deuda exigible: toda la nota queda
    // como saldo a favor del proveedor, nunca como reducción de una CxP inexistente.
    const supplierCredit = allocateSupplierCredit(
      valuation.netPayableReductionUsd, valuation.netPayableReductionBs,
      balance?.outstandingUsd ?? 0, valuation.bcvRate
    );
    const inventoryAccountCodes = [...new Set(draftLines.map(line => line.product.inventoryAccountCode || '1.1.4.01'))];
    const requiredAccounts = [...(cashPurchase ? [] : [payableAccountCode]), ...inventoryAccountCodes];
    if (supplierCredit.supplierAdvanceBs > 0.02) requiredAccounts.push('1.1.2.03');
    if (valuation.vatAmountBs > 0) requiredAccounts.push('1.1.3.01');
    if (valuation.vatWithheldBs > 0) requiredAccounts.push('2.1.2.03');
    if (valuation.islrWithheldBs > 0) requiredAccounts.push('2.1.2.04');
    if (valuation.igtfAmountBs > 0) requiredAccounts.push('6.1.1.11');
    for (const code of requiredAccounts) {
      if (!accounts.some(account => account.code === code && account.isMovement)) {
        throw new Error('Falta la cuenta contable de movimiento ' + code + '. No se registró la nota.');
      }
    }
    const rate = valuation.bcvRate;
    const toUsd = (value: number) => Math.round((value / rate + Number.EPSILON) * 1000000) / 1000000;
    const items: JournalEntryItem[] = [];
    const line = (code: string, debitBs: number, creditBs: number, description: string): JournalEntryItem => ({
      accountCode: code, accountName: accounts.find(account => account.code === code)?.name || code,
      debitBs, creditBs, debitUsd: toUsd(debitBs), creditUsd: toUsd(creditBs), description
    });
    if (supplierCredit.appliedToPayableBs > 0.02) {
      if (!payableAccountCode) throw new Error('La nota de crédito de contado no puede reducir una CxP inexistente.');
      items.push(line(payableAccountCode, supplierCredit.appliedToPayableBs, 0, 'Disminución de CxP por nota de crédito ' + request.creditNoteNumber));
    }
    if (supplierCredit.supplierAdvanceBs > 0.02) {
      items.push(line('1.1.2.03', supplierCredit.supplierAdvanceBs, 0, 'Excedente de nota de crédito · anticipo a favor en proveedor ' + purchase.supplierName));
    }
    if (valuation.vatWithheldBs > 0) items.push(line('2.1.2.03', valuation.vatWithheldBs, 0, 'Reversión proporcional de retención IVA'));
    if (valuation.islrWithheldBs > 0) items.push(line('2.1.2.04', valuation.islrWithheldBs, 0, 'Reversión proporcional de retención ISLR'));
    for (const returnedLine of valuation.lines) {
      const product = products.find(item => item.id === returnedLine.productId && item.companyId === currentCompany.id)!;
      const code = product.inventoryAccountCode || '1.1.4.01';
      items.push(line(code, 0, returnedLine.inventoryCostBs, 'Salida de inventario · ' + product.code + ' · devolución al proveedor'));
    }
    if (valuation.vatAmountBs > 0) items.push(line('1.1.3.01', 0, valuation.vatAmountBs, 'Reversión de crédito fiscal IVA'));
    if (valuation.igtfAmountBs > 0) items.push(line('6.1.1.11', 0, valuation.igtfAmountBs, 'Reversión de gasto IGTF'));
    const debitBs = items.reduce((sum, item) => sum + item.debitBs, 0);
    const creditBs = items.reduce((sum, item) => sum + item.creditBs, 0);
    const debitUsd = items.reduce((sum, item) => sum + item.debitUsd, 0);
    const creditUsd = items.reduce((sum, item) => sum + item.creditUsd, 0);
    if (!isJournalEntryBalanced({ debitBs, creditBs, debitUsd, creditUsd })) {
      throw new Error('El asiento de la nota de crédito no cuadra en Bs. y USD. No se registró ningún cambio.');
    }
    const companyEntries = journalEntries.filter(entry => entry.companyId === currentCompany.id);
    const nextEntry = Math.max(companyEntries.reduce((max, entry) => Math.max(max, entry.entryNumber || 0), 0), journalSequenceRef.current[currentCompany.id] || 0) + 1;
    journalSequenceRef.current[currentCompany.id] = nextEntry;
    const stamp = Date.now();
    const journalId = 'entry-purchase-credit-' + currentCompany.id + '-' + nextEntry + '-' + stamp;
    const reference = 'NC-PROV-' + request.creditNoteNumber.trim();
    const journal: JournalEntry = {
      id: journalId, companyId: currentCompany.id, entryNumber: nextEntry,
      date: request.returnDate, description: 'Nota de crédito proveedor ' + request.creditNoteNumber + ' afecta factura ' + purchase.invoiceNumber,
      type: 'AJUSTE', bcvRate: rate, referenceDoc: reference, items, createdAt: new Date().toISOString()
    };
    const fifoReturnBalances = new Map<string, { bs: number; usd: number }>();
    for (const product of draftLines.filter(item => item.product.costingMethod === 'PEPS').map(item => item.product)
      .filter((item, index, all) => all.findIndex(candidate => candidate.id === item.id) === index)) {
      const history = movements
        .filter(item => item.companyId === currentCompany.id && item.productId === product.id)
        .map(item => ({
          type: item.type, quantity: item.quantity, unitCostBs: item.unitCostBs,
          unitCostUsd: item.unitCostUsd, date: item.date, documentRef: item.documentRef,
          balanceQty: item.balanceQty, id: item.id, concept: item.concept,
          correctionForMovementId: item.correctionForMovementId
        }));
      const layers = reconstructFifoLayers(history, product.currentStock).map(layer => ({ ...layer }));
      for (const returnedLine of valuation.lines.filter(item => item.productId === product.id)) {
        const layer = layers.find(item => item.sourceMovementId === returnedLine.originalMovementId);
        if (!layer || Number(layer.quantity) + 0.000001 < Number(returnedLine.quantity)) {
          throw new Error('La devolución excede la capa PEPS disponible del artículo ' + product.code + '.');
        }
        layer.quantity -= Number(returnedLine.quantity);
      }
      fifoReturnBalances.set(product.id, {
        bs: Math.round(layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0) * 100) / 100,
        usd: Math.round(layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostUsd, 0) * 1000000) / 1000000
      });
    }
    const stampMovements = valuation.lines.map((returnedLine, index) => {
      const source = draftLines.find(item =>
        item.product.id === returnedLine.productId &&
        item.originalMovement.id === returnedLine.originalMovementId
      ); 
      if (!source) throw new Error('No se encontró la entrada original para una línea de devolución.');
      const product = source.product;
      const productReturnQuantity = valuation.lines
        .filter(item => item.productId === product.id)
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const newStock = Number(product.currentStock) - productReturnQuantity;
      if (!Number.isFinite(newStock) || newStock < -0.000001) {
        throw new Error('La devolución supera la existencia disponible del artículo ' + product.code + '.');
      }
      const movementId = 'mov-purchase-credit-' + stamp + '-' + index + '-' + Math.floor(Math.random() * 10000);
      return {
        product, movementId, newStock,
        movement: {
          id: movementId, companyId: currentCompany.id, productId: product.id,
          productName: product.name, productCode: product.code, date: request.returnDate,
          type: 'SALIDA' as const, concept: 'DEVOLUCION_COMPRA', documentRef: reference,
          quantity: returnedLine.quantity, unitCostBs: returnedLine.unitCostBs,
          unitCostUsd: toUsd(returnedLine.unitCostBs),
          totalCostBs: returnedLine.inventoryCostBs, totalCostUsd: toUsd(returnedLine.inventoryCostBs),
          balanceQty: newStock,
          balanceTotalBs: product.costingMethod === 'PEPS' ? Number(fifoReturnBalances.get(product.id)?.bs) : Math.round(newStock * product.avgCostBs * 100) / 100,
          balanceTotalUsd: product.costingMethod === 'PEPS' ? Number(fifoReturnBalances.get(product.id)?.usd) : Math.round(newStock * product.avgCostUsd * 1000000) / 1000000,
          journalEntryId: journalId, correctionForMovementId: returnedLine.originalMovementId,
          bcvRate: rate, documentType: 'Nota de crédito proveedor',
          counterpartyRif: purchase.supplierRif, counterpartyName: purchase.supplierName,
          costingMethod: product.costingMethod || 'PROMEDIO_PONDERADO'
        } as InventoryMovement
      };
    });
    const nextPurchaseOp = Math.max(purchases.filter(item => item.companyId === currentCompany.id)
      .reduce((max, item) => Math.max(max, item.opNumber || 0), 0), purchaseSequenceRef.current[currentCompany.id] || 0) + 1;
    const note: PurchaseRecord = {
      id: 'pur-credit-' + currentCompany.id + '-' + stamp, companyId: currentCompany.id, opNumber: nextPurchaseOp,
      invoiceDate: request.returnDate, supplierRif: purchase.supplierRif,
      supplierName: purchase.supplierName, supplierAddress: purchase.supplierAddress,
      invoiceNumber: request.creditNoteNumber.trim(), controlNumber: request.controlNumber.trim(),
      creditNoteNumber: request.creditNoteNumber.trim(), affectedInvoiceNumber: purchase.invoiceNumber,
      affectedInvoiceDate: purchase.invoiceDate, affectedInvoiceControlNumber: purchase.controlNumber,
      affectedInvoiceTotalAmountBs: purchase.totalAmountBs, affectedInvoiceTotalAmountUsd: purchase.totalAmountUsd,
      fiscalEmissionMedium: request.fiscalEmissionMedium, sameMediumAsOriginal: request.sameMediumAsOriginal,
      documentType: '03', totalAmountBs: valuation.totalAmountBs,
      exemptAmountBs: valuation.exemptAmountBs, taxableBaseBs: valuation.taxableBaseBs,
      taxRate: purchase.taxRate, vatAmountBs: valuation.vatAmountBs,
      retentionRate: purchase.retentionRate, vatWithheldBs: valuation.vatWithheldBs,
      islrConceptCode: purchase.islrConceptCode, islrConceptName: purchase.islrConceptName,
      islrRate: purchase.islrRate, islrSubtrahendBs: 0, islrWithheldBs: valuation.islrWithheldBs,
      bcvRate: rate, totalAmountUsd: valuation.totalAmountUsd,
      taxableBaseUsd: valuation.taxableBaseUsd, vatAmountUsd: valuation.vatAmountUsd,
      vatWithheldUsd: valuation.vatWithheldUsd, islrWithheldUsd: valuation.islrWithheldUsd,
      igtfApplicable: valuation.igtfAmountBs > 0, igtfRate: purchase.igtfRate,
      igtfAmountBs: valuation.igtfAmountBs, igtfAmountUsd: valuation.igtfAmountUsd,
      paymentTerm: 'CREDITO', paymentMethod: purchase.paymentMethod,
      journalEntryId: journalId, originalPurchaseId: purchase.id,
      // Solo la porción aplicada reduce la CxP; el excedente permanece como activo recuperable.
      netPayableReductionBs: supplierCredit.appliedToPayableBs,
      netPayableReductionUsd: supplierCredit.appliedToPayableUsd,
      supplierAdvanceBs: supplierCredit.supplierAdvanceBs,
      supplierAdvanceUsd: supplierCredit.supplierAdvanceUsd,
      creditNoteLines: valuation.lines.map((returnedLine, index) => ({
        productId: returnedLine.productId,
        originalMovementId: returnedLine.originalMovementId,
        movementId: stampMovements[index].movementId,
        quantity: returnedLine.quantity, unitCostBs: returnedLine.unitCostBs,
        inventoryCostBs: returnedLine.inventoryCostBs
      })),
      notes: request.reason.trim()
    };
    purchaseSequenceRef.current[currentCompany.id] = nextPurchaseOp;
    const originalIslrEvents = islrFiscalEvents.filter(event =>
      event.companyId === currentCompany.id && event.kind !== 'REVERSAL' &&
      event.allocations.some(allocation => allocation.purchaseId === purchase.id)
    );
    const fiscalReversalEvents: IslrFiscalEvent[] = [];
    if (originalIslrEvents.length > 0 && valuation.taxableBaseBs > 0.01) {
      const reversalAllocations = allocateIslrFiscalReversal(
        islrFiscalEvents, purchase.id, Number(valuation.taxableBaseBs), currentCompany.id
      );
      const totalReversalWithheld = Math.round(reversalAllocations.reduce(
        (sum, allocation) => sum + allocation.withheldAmountBs, 0
      ) * 100) / 100;
      if (Math.abs(totalReversalWithheld - Number(valuation.islrWithheldBs || 0)) > 0.02) {
        throw new Error('La retención ISLR de la nota no concilia con la suma de los eventos fiscales originales pendientes.');
      }
      const reversalUt = getIslrUnitTaxValueForPeriod(request.returnDate.slice(0, 7));
      if (reversalUt == null || !Number.isFinite(Number(reversalUt)) || Number(reversalUt) <= 0) {
        throw new Error('No existe una Unidad Tributaria histórica verificada para la fecha de la nota de crédito.');
      }
      const eventKey = currentCompany.id + ':' + request.returnDate;
      const existingDayEvents = islrFiscalEvents.filter(event =>
        event.companyId === currentCompany.id && event.fiscalDate === request.returnDate
      );
      let nextEventSequence = Math.max(
        existingDayEvents.reduce((max, event) => Math.max(max, Number(event.sequence) || 0), 0),
        islrEventSequenceRef.current[eventKey] || 0
      );
      for (const allocation of reversalAllocations) {
        nextEventSequence += 1;
        fiscalReversalEvents.push({
          id: 'islr-reversal-' + note.id + '-' + nextEventSequence,
          companyId: currentCompany.id,
          supplierRif: allocation.originalEvent.supplierRif,
          conceptCode: allocation.originalEvent.conceptCode,
          fiscalDate: request.returnDate,
          sequence: nextEventSequence,
          kind: 'REVERSAL',
          allocations: [{ purchaseId: purchase.id, baseAmountBs: allocation.baseAmountBs }],
          basePercentage: allocation.originalEvent.basePercentage,
          unitTaxValueBs: Number(reversalUt),
          withheldAmountBs: allocation.withheldAmountBs,
          journalEntryId: journalId,
          voucherId: allocation.originalEvent.voucherId,
          reversalOfEventId: allocation.originalEvent.id,
          reversalReason: request.reason.trim(),
          createdAt: new Date().toISOString()
        });
      }
      islrEventSequenceRef.current[eventKey] = nextEventSequence;
    }
    const fiscalCorrectionNote = 'La nota de crédito ' + note.creditNoteNumber + ' afecta la retención de la factura ' + purchase.invoiceNumber + '. Verifique el tratamiento del comprobante original y la rectificación que corresponda antes de declarar.';
    const correctionCaseId = await requireApprovedCorrectionCase('PURCHASE',purchase.id,purchase.invoiceNumber,request.creditNoteNumber);
    await recordCorrectionAudit({
      eventType: 'accounting_correction_requested', entityType: 'PURCHASE', companyId: currentCompany.id,
      entityId: purchase.id, correctionType: 'PURCHASE_INVENTORY_CREDIT_NOTE',
      sourceDocumentRef: purchase.invoiceNumber, correctionDocumentRef: request.creditNoteNumber,
      reason: request.reason, workpaperNote: '',
      fiscalEmissionMedium: request.fiscalEmissionMedium, sameMediumAsOriginal: request.sameMediumAsOriginal
    });
    if (!window.sicovenStore?.save) {
      throw new Error('No se puede confirmar la devolución: SQLite local no está disponible. No se modificó el estado contable.');
    }
    let resolvePersistence!: () => void;
    let rejectPersistence!: (error: Error) => void;
    const persistenceConfirmation = new Promise<void>((resolve, reject) => {
      resolvePersistence = resolve;
      rejectPersistence = reject;
    });
    persistenceWaitersRef.current.push({ resolve: resolvePersistence, reject: rejectPersistence });
    // Publica mutaciones funcionales para combinar la nota con cualquier otra
    // operación que se procese en el mismo ciclo; el efecto serializado guarda
    // el snapshot completo y SQLite valida todo dentro de una sola transacción.
    reserveBankOutgoingAccounts(journal.companyId, journal.items);
    setJournalEntries(prev => [...prev, journal]);
    setMovements(prev => [...prev, ...stampMovements.map(item => item.movement)]);
    setProducts(prev => prev.map(item => {
      if (item.companyId !== currentCompany.id) return item;
      const returnedQuantity = stampMovements
        .filter(entry => entry.product.id === item.id)
        .reduce((sum, entry) => sum + Number(entry.movement.quantity || 0), 0);
      if (returnedQuantity <= 0) return item;
      const newStock = Number(item.currentStock) - returnedQuantity;
      return { ...item, currentStock: newStock,
        avgCostBs: newStock > 0 ? item.avgCostBs : 0,
        avgCostUsd: newStock > 0 ? item.avgCostUsd : 0 };
    }));
    setPurchases(prev => [...prev, note]);
    setVatVouchers(prev => prev.map(voucher =>
      voucher.companyId === currentCompany.id && voucher.purchaseRecordId === purchase.id
        ? { ...voucher, requiresFiscalCorrection: true, correctionEntryId: journalId,
          correctionEntryIds: [...new Set([...(voucher.correctionEntryIds || (voucher.correctionEntryId ? [voucher.correctionEntryId] : [])), journalId])],
          correctionNote: [voucher.correctionNote, fiscalCorrectionNote].filter(Boolean).join(' | ') }
        : voucher
    ));
    setIslrVouchers(prev => prev.map(voucher =>
      voucher.companyId === currentCompany.id && voucher.invoiceNumber === purchase.invoiceNumber &&
      voucher.supplierRif === purchase.supplierRif
        ? { ...voucher, requiresFiscalCorrection: true, correctionEntryId: journalId,
          correctionEntryIds: [...new Set([...(voucher.correctionEntryIds || (voucher.correctionEntryId ? [voucher.correctionEntryId] : [])), journalId])],
          correctionNote: [voucher.correctionNote, fiscalCorrectionNote].filter(Boolean).join(' | ') }
        : voucher
    ));
    if (fiscalReversalEvents.length > 0) setIslrFiscalEvents(prev => [...prev, ...fiscalReversalEvents]);
    await persistenceConfirmation;
    const affectedVatVoucher = vatVouchers.find(voucher =>
      voucher.companyId === currentCompany.id && voucher.purchaseRecordId === purchase.id);
    let fiscalIncidentError: unknown = null;
    if (affectedVatVoucher) {
      const affectedDeclaration = vatWithholdingDeclarations.find(declaration =>
        declaration.companyId === currentCompany.id && declaration.voucherIds.includes(affectedVatVoucher.id));
      const declarationEventIds = affectedDeclaration
        ? vatWithholdingDeclarationEvents.filter(event => event.declarationId === affectedDeclaration.id).map(event => event.id)
        : [];
      try {
        await createVatFiscalIncident({
          purchaseId: note.id, vatVoucherId: affectedVatVoucher.id,
          declarationId: affectedDeclaration?.id, declarationEventIds,
          reason: 'NC de devolución vinculada a factura con comprobante de retención IVA. Revisar el comprobante y la declaración del período antes de declarar o cerrar el expediente.',
          detectedAt: request.returnDate
        });
      } catch (incidentError) {
        fiscalIncidentError = incidentError;
      }
    }
    try {
      await recordCorrectionAudit({
        eventType: 'accounting_correction_executed', entityType: 'PURCHASE', companyId: currentCompany.id,
        entityId: purchase.id, correctionType: 'PURCHASE_INVENTORY_CREDIT_NOTE',
        sourceDocumentRef: purchase.invoiceNumber, correctionDocumentRef: request.creditNoteNumber,
        reason: request.reason, workpaperNote: '',
        fiscalEmissionMedium: request.fiscalEmissionMedium, sameMediumAsOriginal: request.sameMediumAsOriginal,
        journalEntryId: journal.id
      });
    } catch (auditError) {
      throw new Error('La devolución y NC quedaron guardadas en SQLite, pero falta el evento final de auditoría. No repita la operación. Asiento: ' + journal.entryNumber + '. ' + (auditError instanceof Error ? auditError.message : 'Error de auditoría.'));
    }
    try {
      await executeCorrectionCase({caseId:correctionCaseId,executionRef:request.creditNoteNumber,reason:'Nota de crédito, devolución física, Kardex y asiento correctivo persistidos y conciliados.'});
    } catch (caseError) {
      throw new Error('La NC y sus efectos quedaron guardados y auditados en SQLite, pero falta cerrar su trazabilidad interna. No repita la operación. ' + (caseError instanceof Error ? caseError.message : 'Error al cerrar la corrección.'));
    }
    if (fiscalIncidentError) {
      throw new Error('La NC, su Kardex, el asiento y la auditoría de ejecución quedaron confirmados en SQLite, pero no se pudo abrir la incidencia fiscal automática. No repita la NC. ' + (fiscalIncidentError instanceof Error ? fiscalIncidentError.message : 'Error de incidencia fiscal.'));
    }
    return note;
      });
    } finally {
      purchaseCreditNoteInFlightRef.current = false;
      correctionWorkflowInFlightRef.current = false;
    }
  };

  const addPurchaseServiceCreditNote = async (
    draft: Omit<PurchaseServiceCreditNoteRequest, 'purchase' | 'priorCreditNotes' | 'closedThroughDate'> & { purchaseId: string }
  ): Promise<PurchaseRecord> => {
    assertSQLitePersistenceReady('Registrar NC de compra de servicios');
    if (correctionWorkflowInFlightRef.current || purchaseCreditNoteInFlightRef.current) {
      throw new Error('Ya existe una corrección documental en proceso. Espere la confirmación de SQLite.');
    }
    const source = purchases.find(item => item.id === draft.purchaseId && item.companyId === currentCompany.id);
    if (!source) throw new Error('No se encontró la factura original en la empresa activa.');
    const sourceEntry = source.journalEntryId
      ? journalEntries.find(item => item.id === source.journalEntryId && item.companyId === currentCompany.id)
      : undefined;
    if (!sourceEntry || sourceEntry.type !== 'COMPRA' ||
        sourceEntry.date !== (source.accountCreditDate || source.invoiceDate) ||
        sourceEntry.referenceDoc !== 'FAC-' + source.invoiceNumber) {
      throw new Error('La factura de servicios no conserva un asiento de compra verificable.');
    }
    const linkedMovements = movements.filter(item => item.companyId === currentCompany.id &&
      (item.journalEntryId === sourceEntry.id ||
       item.documentRef.trim().toUpperCase().replace(/\\s+/g, '') ===
       ('FAC-' + source.invoiceNumber).trim().toUpperCase().replace(/\\s+/g, '')));
    const hasLinkedInventoryJournal = journalEntries.some(entry =>
      entry.companyId === currentCompany.id && entry.id !== sourceEntry.id && entry.type === 'INVENTARIO' &&
      (String(entry.referenceDoc || '').trim().toUpperCase() === ('FAC-' + source.invoiceNumber).trim().toUpperCase() ||
       String(entry.referenceDoc || '').trim().toUpperCase() === source.invoiceNumber.trim().toUpperCase())
    );
    const hasInventoryAccountingFootprint = hasLinkedInventoryJournal || sourceEntry.items.some(item =>
      String(item.accountCode || '').startsWith('1.1.4.')
    );
    if (linkedMovements.length || source.inventoryLines?.length || hasInventoryAccountingFootprint) {
      throw new Error('La factura tiene inventario/Kardex o una imputación contable de inventario. Debe utilizarse la NC de devolución física por líneas; si faltan movimientos de Kardex, primero debe reconstruirse y conciliarse el vínculo sin alterar el original.');
    }
    if (source.vatWithheldBs > 0 || Number(source.islrWithheldBs || 0) > 0 ||
        Number(source.igtfAmountBs || 0) > 0 || source.igtfApplicable ||
        vatVouchers.some(item => item.companyId === currentCompany.id && item.purchaseRecordId === source.id) ||
        islrVouchers.some(item => item.companyId === currentCompany.id && item.invoiceNumber === source.invoiceNumber && item.supplierRif === source.supplierRif)) {
      throw new Error('La factura tiene retenciones/IGTF o comprobantes asociados. La NC requiere rectificación fiscal específica y no se registró.');
    }
    if (Math.abs(Number(draft.bcvRate) - Number(source.bcvRate)) > 0.000001) {
      throw new Error('La tasa de la NC debe coincidir con la tasa contable original. El diferencial cambiario requiere el circuito NIC 21/ajuste de CxP, aún no automatizado para esta operación.');
    }
    const priorCreditNotes = purchases.filter(item => item.companyId === currentCompany.id &&
      item.originalPurchaseId === source.id && item.documentType === '03' &&
      !item.isCancelled && !(item.creditNoteLines?.length));
    const amounts = calculatePurchaseServiceCreditNote({
      ...draft, purchase: source, priorCreditNotes,
      closedThroughDate: currentCompany.closedThroughDate || undefined
    });
    const duplicateNumber = purchases.some(item => item.companyId === currentCompany.id &&
      item.documentType === '03' &&
      String(item.creditNoteNumber || item.invoiceNumber).trim().toUpperCase() === String(draft.creditNoteNumber).trim().toUpperCase());
    if (duplicateNumber) throw new Error('El número de nota de crédito ya está registrado en esta empresa.');
    const sourcePayableCodes = [...new Set(sourceEntry.items
      .filter(item => String(item.accountCode || '').startsWith('2.1.1.') && Number(item.creditBs || 0) > 0)
      .map(item => String(item.accountCode)))];
    const cashPurchase = source.paymentTerm === 'CONTADO';
    if ((!cashPurchase && sourcePayableCodes.length !== 1) || (cashPurchase && sourcePayableCodes.length !== 0)) {
      throw new Error('La modalidad de la factura original no concilia con sus cuentas CxP/tesorería.');
    }
    const payableCode = sourcePayableCodes[0];
    const expenseLines = sourceEntry.items.filter(line => {
      const account = accounts.find(item => item.code === line.accountCode);
      return Number(line.debitBs || 0) > 0 && account?.isMovement &&
        (account.type === 'COSTOS' || account.type === 'GASTOS');
    });
    const sourceBaseBs = Number(source.taxableBaseBs) + Number(source.exemptAmountBs);
    const expenseBaseBs = expenseLines.reduce((sum, line) => sum + Number(line.debitBs || 0), 0);
    const expenseBaseUsd = expenseLines.reduce((sum, line) => sum + Number(line.debitUsd || 0), 0);
    if (!expenseLines.length || Math.abs(expenseBaseBs - sourceBaseBs) > 0.02 ||
        Math.abs(expenseBaseUsd - sourceBaseBs / Number(source.bcvRate)) > 0.0001) {
      throw new Error('El asiento original no permite aislar gastos/servicios sin inventario ni concilia su base en Bs. y USD.');
    }
    const vatLines = sourceEntry.items.filter(line =>
      String(line.accountCode || '').startsWith('1.1.3.') && Number(line.debitBs || 0) > 0);
    if ((Number(source.vatAmountBs || 0) > 0 && (vatLines.length !== 1 ||
        Math.abs(Number(vatLines[0].debitBs) - Number(source.vatAmountBs)) > 0.02 ||
        Math.abs(Number(vatLines[0].debitUsd) - Number(source.vatAmountBs) / Number(source.bcvRate)) > 0.0001)) ||
        (Number(source.vatAmountBs || 0) === 0 && vatLines.length > 0)) {
      throw new Error('El IVA crédito fiscal del asiento original no concilia; no se puede emitir una NC automática.');
    }
    const balance = cashPurchase ? undefined : getCreditBalance(source.id, 'PURCHASE_PAYMENT');
    const allocation = allocateSupplierCredit(
      amounts.netPayableReductionUsd, amounts.netPayableReductionBs,
      balance?.outstandingUsd ?? 0, Number(source.bcvRate)
    );
    const advanceAccount = allocation.supplierAdvanceBs > 0.02
      ? accounts.find(item => item.code === '1.1.2.03' && item.type === 'ACTIVO' && item.isMovement)
      : undefined;
    if (allocation.supplierAdvanceBs > 0.02 && !advanceAccount) {
      throw new Error('No existe la cuenta de movimiento de anticipos a proveedores para registrar el excedente de la NC.');
    }
    const expenseBaseNoteBs = amounts.taxableBaseBs + amounts.exemptAmountBs;
    const expenseBaseNoteUsd = amounts.taxableBaseUsd + amounts.exemptAmountUsd;
    const items: JournalEntryItem[] = [];
    if (allocation.appliedToPayableBs > 0.02 && payableCode) {
      const payable = accounts.find(item => item.code === payableCode && item.type === 'PASIVO' && item.isMovement);
      if (!payable) throw new Error('La cuenta CxP original ya no está disponible como cuenta de movimiento.');
      items.push({ accountCode: payable.code, accountName: payable.name,
        debitBs: allocation.appliedToPayableBs, creditBs: 0,
        debitUsd: allocation.appliedToPayableUsd, creditUsd: 0,
        description: 'Disminución de CxP por NC ' + draft.creditNoteNumber });
    }
    if (allocation.supplierAdvanceBs > 0.02 && advanceAccount) {
      items.push({ accountCode: advanceAccount.code, accountName: advanceAccount.name,
        debitBs: allocation.supplierAdvanceBs, creditBs: 0,
        debitUsd: allocation.supplierAdvanceUsd, creditUsd: 0,
        description: 'Saldo a favor del proveedor por NC ' + draft.creditNoteNumber });
    }
    let allocatedBs = 0, allocatedUsd = 0;
    expenseLines.forEach((line, index) => {
      const last = index === expenseLines.length - 1;
      const share = Number(line.debitBs) / expenseBaseBs;
      const creditBs = last ? Math.round((expenseBaseNoteBs - allocatedBs) * 100) / 100
        : Math.round(expenseBaseNoteBs * share * 100) / 100;
      const creditUsd = last ? Math.round((expenseBaseNoteUsd - allocatedUsd) * 1000000) / 1000000
        : Math.round(expenseBaseNoteUsd * share * 1000000) / 1000000;
      allocatedBs += creditBs; allocatedUsd += creditUsd;
      const account = accounts.find(item => item.code === line.accountCode)!;
      items.push({ accountCode: account.code, accountName: account.name,
        debitBs: 0, creditBs, debitUsd: 0, creditUsd,
        description: 'Reversión parcial del gasto de la factura ' + source.invoiceNumber });
    });
    if (amounts.vatAmountBs > 0 && vatLines[0]) {
      const vatAccount = accounts.find(item => item.code === vatLines[0].accountCode && item.isMovement);
      if (!vatAccount) throw new Error('La cuenta de IVA crédito fiscal original no está disponible.');
      items.push({ accountCode: vatAccount.code, accountName: vatAccount.name,
        debitBs: 0, creditBs: amounts.vatAmountBs, debitUsd: 0, creditUsd: amounts.vatAmountUsd,
        description: 'Disminución del IVA crédito fiscal por NC ' + draft.creditNoteNumber });
    }
    const debitBs = items.reduce((sum, line) => sum + line.debitBs, 0);
    const creditBs = items.reduce((sum, line) => sum + line.creditBs, 0);
    const debitUsd = items.reduce((sum, line) => sum + line.debitUsd, 0);
    const creditUsd = items.reduce((sum, line) => sum + line.creditUsd, 0);
    if (Math.abs(debitBs - creditBs) > 0.02 || Math.abs(debitUsd - creditUsd) > 0.0001 || items.length < 2) {
      throw new Error('El asiento de NC de servicios no cuadra en Bs. y USD. No se registró.');
    }
    const correctionCaseId = await requireApprovedCorrectionCase('PURCHASE',source.id,source.invoiceNumber,draft.creditNoteNumber);
    correctionWorkflowInFlightRef.current = true;
    purchaseCreditNoteInFlightRef.current = true;
    try { await recordCorrectionAudit({
      eventType: 'accounting_correction_requested', entityType: 'PURCHASE', companyId: currentCompany.id, entityId: source.id,
      correctionType: 'PURCHASE_SERVICE_CREDIT_NOTE',
      sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: String(draft.creditNoteNumber).trim(),
      reason: String(draft.reason).trim(), workpaperNote: '',
      fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal
    }); } catch (auditError) { correctionWorkflowInFlightRef.current = false; purchaseCreditNoteInFlightRef.current = false; throw auditError; }
    try {
      return await runAtomicInvoiceImport(async () => {
        const journal = addJournalEntry({
          entryNumber: 0, date: draft.noteDate,
          description: 'Nota de crédito de servicios ' + draft.creditNoteNumber + ' afecta ' + source.invoiceNumber,
          type: 'AJUSTE', bcvRate: Number(source.bcvRate),
          referenceDoc: 'NC-PROV-' + draft.creditNoteNumber, items
        });
        const nextOp = Math.max(
          purchases.filter(item => item.companyId === currentCompany.id).reduce((max, item) => Math.max(max, item.opNumber || 0), 0),
          purchaseSequenceRef.current[currentCompany.id] || 0
        ) + 1;
        purchaseSequenceRef.current[currentCompany.id] = nextOp;
        const note: PurchaseRecord = {
          ...source, id: 'pur-service-credit-' + currentCompany.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
          companyId: currentCompany.id, opNumber: nextOp, invoiceDate: draft.noteDate,
          accountCreditDate: draft.noteDate, invoiceNumber: String(draft.creditNoteNumber).trim(),
          creditNoteNumber: String(draft.creditNoteNumber).trim(), controlNumber: String(draft.controlNumber).trim(),
          affectedInvoiceNumber: source.invoiceNumber,
          affectedInvoiceDate: source.invoiceDate,
          affectedInvoiceControlNumber: source.controlNumber,
          affectedInvoiceTotalAmountBs: source.totalAmountBs,
          affectedInvoiceTotalAmountUsd: source.totalAmountUsd,
          fiscalEmissionMedium: draft.fiscalEmissionMedium,
          sameMediumAsOriginal: draft.sameMediumAsOriginal,
          documentType: '03', originalPurchaseId: source.id,
          creditNoteLines: [], inventoryLines: undefined,
          taxableBaseBs: amounts.taxableBaseBs, exemptAmountBs: amounts.exemptAmountBs,
          vatAmountBs: amounts.vatAmountBs, totalAmountBs: amounts.totalAmountBs,
          taxableBaseUsd: amounts.taxableBaseUsd, exemptAmountUsd: amounts.exemptAmountUsd,
          vatAmountUsd: amounts.vatAmountUsd, totalAmountUsd: amounts.totalAmountUsd,
          vatWithheldBs: 0, vatWithheldUsd: 0, islrWithheldBs: 0, islrWithheldUsd: 0,
          igtfApplicable: false, igtfAmountBs: 0, igtfAmountUsd: 0,
          netPayableReductionBs: amounts.netPayableReductionBs,
          netPayableReductionUsd: amounts.netPayableReductionUsd,
          supplierAdvanceBs: allocation.supplierAdvanceBs,
          supplierAdvanceUsd: allocation.supplierAdvanceUsd,
          bcvRate: Number(source.bcvRate), journalEntryId: journal.id,
          notes: 'NC de servicio vinculada a ' + source.invoiceNumber + '. Motivo: ' + draft.reason.trim()
        };
        setPurchases(prev => [...prev, note]);
        await waitForPersistence();
        try {
          await recordCorrectionAudit({
            eventType: 'accounting_correction_executed', entityType: 'PURCHASE', companyId: currentCompany.id, entityId: source.id,
            correctionType: 'PURCHASE_SERVICE_CREDIT_NOTE',
            sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: String(draft.creditNoteNumber).trim(),
            reason: String(draft.reason).trim(), workpaperNote: '',
            fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal,
            journalEntryId: journal.id
          });
        } catch (auditError) {
          throw new Error('La NC quedó guardada y confirmada en SQLite, pero falta registrar el evento final de auditoría. No repita el documento. Asiento: ' + journal.entryNumber + '. ' + (auditError instanceof Error ? auditError.message : 'Error de auditoría.'));
        }
        try {
          await executeCorrectionCase({caseId:correctionCaseId,executionRef:String(draft.creditNoteNumber).trim(),reason:'Nota de crédito de servicios, asiento correctivo y auxiliar CxP persistidos.'});
        } catch (caseError) {
          throw new Error('La NC de servicios quedó guardada y auditada en SQLite, pero falta cerrar su trazabilidad interna. No repita el documento. ' + (caseError instanceof Error ? caseError.message : 'Error al cerrar la corrección.'));
        }
        return note;
      });
    } finally {
      correctionWorkflowInFlightRef.current = false;
      purchaseCreditNoteInFlightRef.current = false;
    }
  };

  const addSupplierDebitNote = async (
    draft: Omit<SupplierDebitNoteAccountingDraft, 'companyId' | 'closedThroughDate'>
  ): Promise<PurchaseRecord> => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La nota de débito requiere SQLite local de escritorio disponible y lista. No se registró.');
    }
    if (!currentCompany) throw new Error('Selecciona una empresa antes de registrar la ND.');
    const sourceForApproval = purchases.find(item=>item.id===draft.sourcePurchaseId && item.companyId===currentCompany.id);
    if (!sourceForApproval) throw new Error('No se encontró la factura original en la empresa activa.');
    const operationKey = [
      currentCompany.id, draft.sourcePurchaseId, String(draft.debitNoteNumber || '').trim().toUpperCase()
    ].join('|');
    if (supplierDebitNoteInFlightRef.current.has(operationKey) || correctionWorkflowInFlightRef.current) {
      throw new Error('Ya hay una corrección o reversión documental en proceso. Espera la confirmación de SQLite antes de reintentar.');
    }
    supplierDebitNoteInFlightRef.current.add(operationKey);
    correctionWorkflowInFlightRef.current = true;
    try {
      return await runAtomicInvoiceImport(async () => {
        const source = purchases.find(item =>
          item.id === draft.sourcePurchaseId && item.companyId === currentCompany.id
        );
        if (!source) throw new Error('No se encontró la factura original en la empresa activa.');
        const sourceJournalEntry = source.journalEntryId
          ? journalEntries.find(entry => entry.id === source.journalEntryId && entry.companyId === currentCompany.id)
          : undefined;
        const plan = buildSupplierDebitNoteAccountingPlan({
          draft: { ...draft, companyId: currentCompany.id, closedThroughDate: currentCompany.closedThroughDate || undefined },
          purchases, accounts, sourceJournalEntry
        });
        const correctionCaseId = await requireApprovedCorrectionCase('PURCHASE',source.id,source.invoiceNumber,draft.debitNoteNumber);
        await recordCorrectionAudit({
          eventType: 'accounting_correction_requested', entityType: 'PURCHASE', companyId: currentCompany.id,
          entityId: source.id, correctionType: 'PURCHASE_DEBIT_NOTE',
          sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: draft.debitNoteNumber,
          reason: draft.reason, workpaperNote: '',
          fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal
        });
        if (!window.sicovenStore?.save) {
          throw new Error('No se puede confirmar la ND: SQLite local no está disponible. No se modificó el estado contable.');
        }
        const stamp = Date.now();
        const nextPurchaseOp = Math.max(
          purchases.filter(item => item.companyId === currentCompany.id)
            .reduce((max, item) => Math.max(max, item.opNumber || 0), 0),
          purchaseSequenceRef.current[currentCompany.id] || 0
        ) + 1;
        const journal = addJournalEntry({
          entryNumber: 0,
          date: plan.document.accountCreditDate || plan.document.invoiceDate,
          description: 'Nota de débito proveedor ' + draft.debitNoteNumber.trim() +
            ' afecta factura ' + source.invoiceNumber,
          type: 'AJUSTE',
          bcvRate: plan.document.bcvRate,
          referenceDoc: 'ND-PROV-' + draft.debitNoteNumber.trim(),
          items: plan.items
        });
        const note: PurchaseRecord = {
          ...plan.document,
          id: 'pur-debit-' + currentCompany.id + '-' + stamp + '-' + Math.floor(Math.random() * 100000),
          companyId: currentCompany.id,
          opNumber: nextPurchaseOp,
          journalEntryId: journal.id
        };
        purchaseSequenceRef.current[currentCompany.id] = nextPurchaseOp;
        const persistenceConfirmation = new Promise<void>((resolve, reject) => {
          persistenceWaitersRef.current.push({ resolve, reject });
        });
        setPurchases(prev => [...prev, note]);
        await persistenceConfirmation;
        try {
          await recordCorrectionAudit({
            eventType: 'accounting_correction_executed', entityType: 'PURCHASE', companyId: currentCompany.id,
            entityId: source.id, correctionType: 'PURCHASE_DEBIT_NOTE',
            sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: draft.debitNoteNumber,
            reason: draft.reason, workpaperNote: '',
            fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal,
            journalEntryId: journal.id
          });
        } catch (auditError) {
          throw new Error('La ND quedó guardada en SQLite, pero falta el evento final de auditoría. No repita el documento. Asiento: ' + journal.entryNumber + '. ' + (auditError instanceof Error ? auditError.message : 'Error de auditoría.'));
        }
        try {
          await executeCorrectionCase({caseId:correctionCaseId,executionRef:String(draft.debitNoteNumber).trim(),reason:'Nota de débito, asiento correctivo y auxiliar CxP persistidos.'});
        } catch (caseError) {
          throw new Error('La ND quedó guardada y auditada en SQLite, pero falta cerrar su trazabilidad interna. No repita el documento. ' + (caseError instanceof Error ? caseError.message : 'Error al cerrar la corrección.'));
        }
        return note;
      });
    } finally {
      supplierDebitNoteInFlightRef.current.delete(operationKey);
      correctionWorkflowInFlightRef.current = false;
    }
  };

  const deletePurchase = (id: string) => {
    const purchase = purchases.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!purchase) return;
    if (typeof window !== 'undefined') {
      window.alert('Las facturas de compra registradas son documentos históricos inmutables. No se eliminan físicamente; cualquier corrección requiere nota fiscal válida y reversión contable coordinada.');
    }
  };

  // Registrar venta y generar asiento contable
  const addSale = (saleData: Omit<SaleRecord, 'id' | 'companyId' | 'opNumber'>, targetCompanyId: string = currentCompany.id): SaleRecord => {
    const targetCompany = companies.find(company => company.id === targetCompanyId);
    if (!targetCompany) throw new Error('La empresa destino de la venta no existe en SICOVEN.');
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La edición de escritorio requiere SQLite local disponible y lista. No se registró la venta.');
    }
    const settlementModeError = validateSaleSettlementMode(saleData.paymentTerm);
    if (settlementModeError) throw new Error(settlementModeError);
    if (!targetCompany) throw new Error('Selecciona una empresa antes de registrar la venta.');
    const rate = Number(saleData.bcvRate);
    const saleAmounts = [
      saleData.totalAmountBs, saleData.taxableBaseBs, saleData.exemptAmountBs,
      saleData.vatAmountBs, saleData.additionalLuxuryTaxBs || 0, saleData.vatWithheldBs || 0, saleData.igtfAmountBs || 0
    ];
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('La venta requiere una tasa BCV válida mayor que cero.');
    if (saleAmounts.some(value => !Number.isFinite(value) || value < 0) || saleData.totalAmountBs <= 0) {
      throw new Error('La venta contiene importes inválidos o negativos.');
    }
    if (targetCompany.closedThroughDate && saleData.invoiceDate <= targetCompany.closedThroughDate) {
      throw new Error('El período está cerrado hasta ' + targetCompany.closedThroughDate + '. Registre el documento en el período abierto o solicite una corrección formal.');
    }
    if (!isValidIsoDate(saleData.invoiceDate) || !String(saleData.invoiceNumber || '').trim() ||
        !String(saleData.customerName || '').trim()) {
      throw new Error('La venta requiere fecha válida, número de factura y nombre del cliente.');
    }
    if (saleData.documentType !== '01') {
      throw new Error('Las notas de débito/crédito de clientes requieren un flujo de reversión fiscal y contable que aún no está habilitado. Registra solo facturas (01) en este módulo.');
    }
    if (!Number.isFinite(saleData.taxRate) || saleData.taxRate < 0 || saleData.taxRate > 100) {
      throw new Error('La alícuota de IVA de la venta no es válida.');
    }
    const expectedVatRate = saleData.taxRate === 31 ? 16 : saleData.taxRate;
    const expectedVat = Math.round(saleData.taxableBaseBs * expectedVatRate) / 100;
    const expectedLuxuryTax = saleData.taxRate === 31 ? Math.round(saleData.taxableBaseBs * 15) / 100 : 0;
    if (Math.abs(expectedLuxuryTax - Number(saleData.additionalLuxuryTaxBs || 0)) > 0.01) {
      throw new Error('El impuesto adicional al consumo suntuario no coincide con la alícuota combinada declarada.');
    }
    if (Math.abs(expectedVat - saleData.vatAmountBs) > 0.01) {
      throw new Error('El IVA de la venta no coincide con la base imponible y la alícuota declarada.');
    }
    if ((saleData.vatWithheldBs || 0) > saleData.vatAmountBs + 0.01) {
      throw new Error('La retención de IVA del cliente no puede superar el IVA causado.');
    }
    const saleIgtf = Number(saleData.igtfAmountBs || 0);
    if (saleIgtf > 0 && !saleData.igtfApplicable) {
      throw new Error('No se permite registrar IGTF en una venta sin confirmación expresa.');
    }
    if (saleData.igtfApplicable) {
      const eligibleSaleIgtf = targetCompany.isIgtfPerceptionAgent === true &&
        saleData.paymentTerm === 'CONTADO' &&
        (saleData.paymentCurrency === 'FOREIGN_CASH' || saleData.paymentCurrency === 'CRYPTO');
      if (!eligibleSaleIgtf) {
        throw new Error('El IGTF en ventas requiere agente de percepción configurado y cobro de contado en un medio elegible.');
      }
      const expectedIgtf = Math.round((saleData.taxableBaseBs + saleData.exemptAmountBs + saleData.vatAmountBs + Number(saleData.additionalLuxuryTaxBs || 0)) * 3) / 100;
      if (Math.abs(saleIgtf - expectedIgtf) > 0.01 || Number(saleData.igtfRate || 0) !== 3) {
        throw new Error('El importe o la tasa del IGTF no coincide con el cálculo confirmado del 3%.');
      }
    } else if (saleIgtf !== 0) {
      throw new Error('No se permite registrar IGTF sin confirmación expresa.');
    }
    const expectedSaleTotal = Math.round((saleData.taxableBaseBs + saleData.exemptAmountBs + saleData.vatAmountBs + Number(saleData.additionalLuxuryTaxBs || 0) + saleIgtf) * 100) / 100;
    if (Math.abs(expectedSaleTotal - saleData.totalAmountBs) > 0.01) {
      throw new Error('El total de la venta no coincide con base imponible, exento, IVA e IGTF.');
    }
    const normalizeSaleDocument = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '');
    const duplicateSale = [...sales, ...(activeImportBatchRef.current?.sales || [])].some(existing =>
      existing.companyId === targetCompany.id &&
      existing.documentType === saleData.documentType &&
      normalizeSaleDocument(existing.invoiceNumber) === normalizeSaleDocument(saleData.invoiceNumber)
    );
    if (duplicateSale) throw new Error('Ya existe una venta registrada con ese tipo de documento y número de factura.');

    const companySales = sales.filter(s => s.companyId === targetCompany.id);
    const companyKey = targetCompany.id;
    const nextOp = Math.max(companySales.reduce((max, sale) => Math.max(max, sale.opNumber || 0), 0), saleSequenceRef.current[companyKey] || 0) + 1;
    saleSequenceRef.current[companyKey] = nextOp;
    const saleId = `sale-${companyKey}-${nextOp}-${Date.now()}`;
    // Asiento contable
    const items: JournalEntryItem[] = [];

    // Debe: Retención de IVA por compensar si el cliente nos retuvo
    if (saleData.vatWithheldBs && saleData.vatWithheldBs > 0) {
      items.push({
        accountCode: '1.1.3.03',
        accountName: 'Retenciones de IVA Acumuladas por Descontar',
        debitBs: saleData.vatWithheldBs,
        creditBs: 0,
        debitUsd: saleData.vatWithheldBs / rate,
        creditUsd: 0,
        description: `Comprobante Retención IVA Cliente ${saleData.customerName}`
      });
    }

    // Debe: Cuentas por Cobrar Clientes (Total - Retención)
    const receivableBs = saleData.totalAmountBs - (saleData.vatWithheldBs || 0);
    items.push({
      accountCode: '1.1.2.01',
      accountName: 'Cuentas por Cobrar Clientes Comerciales',
      debitBs: receivableBs,
      creditBs: 0,
      debitUsd: receivableBs / rate,
      creditUsd: 0,
      description: `Por cobrar Fac. Venta ${saleData.invoiceNumber}`
    });

    // Haber: IGTF percibido por cuenta del Fisco, cuando la venta lo incluye.
    if (saleData.igtfApplicable && (saleData.igtfAmountBs || 0) > 0) {
      const igtfBs = saleData.igtfAmountBs || 0;
      items.push({
        accountCode: '2.1.2.06',
        accountName: 'Impuesto a las Grandes Transacciones Financieras (IGTF)',
        debitBs: 0,
        creditBs: igtfBs,
        debitUsd: 0,
        creditUsd: igtfBs / rate,
        description: `IGTF percibido 3% Fac. ${saleData.invoiceNumber}`
      });
    }

    // Haber: Ventas de Mercancías (Base imponible)
    items.push({
      accountCode: '4.1.1.01',
      accountName: 'Ventas de Mercancías',
      debitBs: 0,
      creditBs: saleData.taxableBaseBs,
      debitUsd: 0,
      creditUsd: saleData.taxableBaseBs / rate,
      description: `Ingreso por venta Fac. ${saleData.invoiceNumber}`
    });

    // Haber: ingresos exentos. Sin esta línea, una venta con monto exento
    // deja el asiento automático descuadrado frente a CxC y retenciones.
    if (saleData.exemptAmountBs > 0) {
      items.push({
        accountCode: '4.1.1.01',
        accountName: 'Ingresos por ventas exentas',
        debitBs: 0,
        creditBs: saleData.exemptAmountBs,
        debitUsd: 0,
        creditUsd: saleData.exemptAmountBs / rate,
        description: `Ingreso exento por venta Fac. ${saleData.invoiceNumber}`
      });
    }

    // Haber: impuesto adicional al consumo suntuario (15%) separado del IVA.
    if (Number(saleData.additionalLuxuryTaxBs || 0) > 0) {
      const luxuryTaxBs = Number(saleData.additionalLuxuryTaxBs || 0);
      const luxuryTaxAccount = accounts.find(account => account.code === '2.1.2.08' && account.isMovement && account.type === 'PASIVO');
      if (!luxuryTaxAccount) throw new Error('El plan de cuentas no contiene la cuenta de impuesto adicional al consumo suntuario.');
      items.push({ accountCode: luxuryTaxAccount.code, accountName: luxuryTaxAccount.name, debitBs: 0, creditBs: luxuryTaxBs, debitUsd: 0, creditUsd: luxuryTaxBs / rate, description: `Impuesto adicional al consumo suntuario 15% Fac. ${saleData.invoiceNumber}` });
    }

    // Haber: Débito Fiscal IVA Ventas
    if (saleData.vatAmountBs > 0) {
      items.push({
        accountCode: '2.1.2.01',
        accountName: `Débito Fiscal IVA Ventas (${saleData.taxRate}%)`,
        debitBs: 0,
        creditBs: saleData.vatAmountBs,
        debitUsd: 0,
        creditUsd: saleData.vatAmountBs / rate,
        description: `Débito fiscal ${saleData.taxRate}% Fac. ${saleData.invoiceNumber}`
      });
    }

    const saleDebitBs = items.reduce((sum, item) => sum + (Number(item.debitBs) || 0), 0);
    const saleCreditBs = items.reduce((sum, item) => sum + (Number(item.creditBs) || 0), 0);
    const saleDebitUsd = items.reduce((sum, item) => sum + (Number(item.debitUsd) || 0), 0);
    const saleCreditUsd = items.reduce((sum, item) => sum + (Number(item.creditUsd) || 0), 0);
    if (!isJournalEntryBalanced({ debitBs: saleDebitBs, creditBs: saleCreditBs, debitUsd: saleDebitUsd, creditUsd: saleCreditUsd })) {
      throw new Error('El asiento automático de la venta no cuadra en Bs. y USD; la operación no se guardó.');
    }

    const companyEntries = journalEntries.filter(e => e.companyId === targetCompany.id);
    const nextEntryNum = Math.max(companyEntries.reduce((max, entry) => Math.max(max, entry.entryNumber || 0), 0), journalSequenceRef.current[companyKey] || 0) + 1;
    journalSequenceRef.current[companyKey] = nextEntryNum;

    const createdJournalEntry: JournalEntry = {
      id: `entry-sale-${companyKey}-${nextEntryNum}-${Date.now()}`,
      companyId: targetCompany.id,
      entryNumber: nextEntryNum,
      date: saleData.invoiceDate,
      description: `Factura de Venta N° ${saleData.invoiceNumber} - ${saleData.customerName}`,
      type: 'VENTA',
      bcvRate: rate,
      referenceDoc: `FAC-${saleData.invoiceNumber}`,
      items,
      createdAt: new Date().toISOString()
    };

    reserveBankOutgoingAccounts(createdJournalEntry.companyId, createdJournalEntry.items);
    activeImportBatchRef.current?.journalEntries.push(createdJournalEntry);
    setJournalEntries(prev => [...prev, createdJournalEntry]);

    const finalSale: SaleRecord = {
      ...saleData,
      // El registro conserva la tasa efectiva usada en su asiento y equivalentes
      // USD coherentes con los importes nominales de la factura.
      bcvRate: rate,
      totalAmountUsd: saleData.totalAmountBs / rate,
      taxableBaseUsd: saleData.taxableBaseBs / rate,
      vatAmountUsd: saleData.vatAmountBs / rate,
      additionalLuxuryTaxBs: Number(saleData.additionalLuxuryTaxBs || 0),
      additionalLuxuryTaxUsd: Number(saleData.additionalLuxuryTaxBs || 0) / rate,
      vatWithheldUsd: (saleData.vatWithheldBs || 0) / rate,
      igtfAmountUsd: saleIgtf / rate,
      id: saleId,
      companyId: targetCompany.id,
      opNumber: nextOp,
      journalEntryId: createdJournalEntry.id
    };

    activeImportBatchRef.current?.sales.push(finalSale);
    setSales(prev => [...prev, finalSale]);
    return finalSale;
  };

  const addSaleCorrectionNote = async (
    draft: Omit<SaleCorrectionNoteRequest, 'sourceSale' | 'priorCreditNotes' | 'closedThroughDate'> & { sourceSaleId: string }
  ): Promise<SaleRecord> => {
    assertSQLitePersistenceReady('Registrar nota de crédito/débito de venta');
    if (correctionWorkflowInFlightRef.current) {
      throw new Error('Ya existe una corrección documental en proceso. Espere la confirmación de SQLite.');
    }
    const source = sales.find(item => item.id === draft.sourceSaleId && item.companyId === currentCompany.id);
    if (!source) throw new Error('No se encontró la factura original de venta en la empresa activa.');
    if (source.documentType !== '01' || source.isCancelled) throw new Error('Solo se pueden corregir facturas de venta vigentes tipo 01.');
    const sourceEntry = journalEntries.find(item => item.id === source.journalEntryId && item.companyId === currentCompany.id);
    const hasLinkedInventoryJournal = journalEntries.some(entry =>
      entry.companyId === currentCompany.id && entry.id !== source.journalEntryId && entry.type === 'INVENTARIO' &&
      (String(entry.referenceDoc || '').trim().toUpperCase() === ('FAC-' + source.invoiceNumber).trim().toUpperCase() ||
       String(entry.referenceDoc || '').trim().toUpperCase() === source.invoiceNumber.trim().toUpperCase())
    );
    const hasInventoryAccountingFootprint = hasLinkedInventoryJournal || Boolean(sourceEntry?.items.some(item =>
      String(item.accountCode || '').startsWith('1.1.4.') ||
      accounts.some(account => account.code === item.accountCode && account.type === 'COSTOS')
    ));
    const linkedInventory = hasInventoryAccountingFootprint || movements.some(item => item.companyId === currentCompany.id &&
      (item.journalEntryId === source.journalEntryId ||
       item.documentRef.trim().toUpperCase().replace(/\\s+/g, '') ===
       ('FAC-' + source.invoiceNumber).trim().toUpperCase().replace(/\\s+/g, '')));
    if (linkedInventory && draft.kind === 'CREDIT') {
      if (!sourceEntry) throw new Error('La factura con inventario no conserva su asiento original verificable.');
      const returnReadiness = validateSaleInventoryReturnReconciliation({
        companyId: currentCompany.id, invoiceNumber: source.invoiceNumber,
        source: sourceEntry, movements, products, journalEntries
      });
      if (!returnReadiness.ready) {
        throw new Error('La NC de mercancía exige devolución física total y conciliada en Kardex, con su asiento de costo por artículo. ' +
          (returnReadiness.reason || 'No se registró la nota.'));
      }
      const originalNetBs = Number(source.taxableBaseBs || 0) + Number(source.exemptAmountBs || 0) + Number(source.vatAmountBs || 0);
      if (Math.abs(Number(draft.taxableBaseBs) + Number(draft.exemptAmountBs) + 
          (Number(draft.taxableBaseBs) * Number(source.taxRate || 0) / 100) - originalNetBs) > 0.02) {
        throw new Error('La devolución de mercancía solo admite NC total mientras no exista distribución fiscal por líneas de devolución parcial. La factura original permanece intacta.');
      }
    }
    const number = String(draft.noteNumber || '').trim();
    const normalizedNumber = number.toUpperCase().replace(/\\s+/g, '');
    if (sales.some(item => item.companyId === currentCompany.id &&
      String(item.invoiceNumber || '').trim().toUpperCase().replace(/\\s+/g, '') === normalizedNumber)) {
      throw new Error('El número fiscal de la nota ya está registrado en esta empresa.');
    }
    const priorCreditNotes = sales.filter(item => item.companyId === currentCompany.id &&
      item.originalSaleId === source.id && item.documentType === '03' && !item.isCancelled);
    const amounts = calculateSaleCorrectionNote({
      ...draft, sourceSale: source, priorCreditNotes,
      closedThroughDate: currentCompany.closedThroughDate || undefined
    });
    if (draft.kind === 'CREDIT') {
      const balance = getCreditBalance(source.id, 'SALE_COLLECTION');
      if (amounts.netReceivableAdjustmentUsd > balance.outstandingUsd + 0.005) {
        throw new Error('La nota de crédito supera el saldo de CxC todavía exigible. Si ya hubo cobros, debe tramitarse primero el circuito de devolución/reembolso y su conciliación bancaria.');
      }
    }
    const revenue = accounts.find(item => item.code === '4.1.1.01' && item.isMovement && item.type === 'INGRESOS');
    const receivable = accounts.find(item => item.code === '1.1.2.01' && item.isMovement && item.type === 'ACTIVO');
    const vat = accounts.find(item => item.code === '2.1.2.01' && item.isMovement && item.type === 'PASIVO');
    if (!revenue || !receivable || (amounts.vatAmountBs > 0 && !vat)) {
      throw new Error('Faltan cuentas de movimiento para ventas, CxC o débito fiscal IVA. No se registró la nota.');
    }
    const isCredit = draft.kind === 'CREDIT';
    const items: JournalEntryItem[] = [];
    const baseBs = amounts.taxableBaseBs + amounts.exemptAmountBs;
    const baseUsd = amounts.taxableBaseUsd + amounts.exemptAmountUsd;
    if (isCredit) {
      items.push({ accountCode: revenue.code, accountName: revenue.name, debitBs: baseBs, creditBs: 0,
        debitUsd: baseUsd, creditUsd: 0, description: 'Reversión parcial de ingresos · ' + source.invoiceNumber });
      if (amounts.vatAmountBs > 0 && vat) items.push({ accountCode: vat.code, accountName: vat.name,
        debitBs: amounts.vatAmountBs, creditBs: 0, debitUsd: amounts.vatAmountUsd, creditUsd: 0,
        description: 'Disminución de débito fiscal IVA · ' + source.invoiceNumber });
      items.push({ accountCode: receivable.code, accountName: receivable.name,
        debitBs: 0, creditBs: amounts.totalAmountBs, debitUsd: 0, creditUsd: amounts.totalAmountUsd,
        description: 'Disminución de CxC por NC ' + number });
    } else {
      items.push({ accountCode: receivable.code, accountName: receivable.name,
        debitBs: amounts.totalAmountBs, creditBs: 0, debitUsd: amounts.totalAmountUsd, creditUsd: 0,
        description: 'Incremento de CxC por ND ' + number });
      items.push({ accountCode: revenue.code, accountName: revenue.name,
        debitBs: 0, creditBs: baseBs, debitUsd: 0, creditUsd: baseUsd,
        description: 'Ingreso adicional por ND · ' + source.invoiceNumber });
      if (amounts.vatAmountBs > 0 && vat) items.push({ accountCode: vat.code, accountName: vat.name,
        debitBs: 0, creditBs: amounts.vatAmountBs, debitUsd: 0, creditUsd: amounts.vatAmountUsd,
        description: 'Incremento de débito fiscal IVA · ' + source.invoiceNumber });
    }
    const correctionCaseId = await requireApprovedCorrectionCase('SALE',source.id,source.invoiceNumber,draft.noteNumber);
    correctionWorkflowInFlightRef.current = true;
    try { await recordCorrectionAudit({
      eventType: 'accounting_correction_requested', entityType: 'SALE', companyId: currentCompany.id, entityId: source.id,
      correctionType: isCredit ? 'SALES_CREDIT_NOTE' : 'SALES_DEBIT_NOTE',
      sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: number,
      reason: String(draft.reason).trim(), workpaperNote: '',
      fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal
    }); } catch (auditError) { correctionWorkflowInFlightRef.current = false; throw auditError; }
    try {
      return await runAtomicInvoiceImport(async () => {
        const journal = addJournalEntry({
          entryNumber: 0, date: draft.noteDate,
          description: (isCredit ? 'Nota de crédito' : 'Nota de débito') + ' de cliente ' + number + ' afecta ' + source.invoiceNumber,
          type: 'AJUSTE', bcvRate: draft.bcvRate,
          referenceDoc: (isCredit ? 'NC-CLI-' : 'ND-CLI-') + number,
          items
        });
        const nextOp = Math.max(
          sales.filter(item => item.companyId === currentCompany.id).reduce((max, item) => Math.max(max, item.opNumber || 0), 0),
          saleSequenceRef.current[currentCompany.id] || 0
        ) + 1;
        saleSequenceRef.current[currentCompany.id] = nextOp;
        const note: SaleRecord = {
          ...source, id: 'sale-correction-' + currentCompany.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 100000),
          companyId: currentCompany.id, opNumber: nextOp, invoiceDate: draft.noteDate,
          invoiceNumber: number, controlNumber: String(draft.controlNumber).trim(),
          documentType: isCredit ? '03' : '02',
          creditNoteNumber: isCredit ? number : undefined,
          debitNoteNumber: isCredit ? undefined : number,
          affectedInvoiceNumber: source.invoiceNumber, originalSaleId: source.id,
      affectedInvoiceDate: source.invoiceDate, affectedInvoiceControlNumber: source.controlNumber,
      affectedInvoiceTotalAmountBs: source.totalAmountBs, affectedInvoiceTotalAmountUsd: source.totalAmountUsd,
      fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal,
          taxableBaseBs: amounts.taxableBaseBs, exemptAmountBs: amounts.exemptAmountBs,
          vatAmountBs: amounts.vatAmountBs, totalAmountBs: amounts.totalAmountBs,
          bcvRate: draft.bcvRate, taxableBaseUsd: amounts.taxableBaseUsd,
          exemptAmountUsd: amounts.exemptAmountUsd, vatAmountUsd: amounts.vatAmountUsd,
          totalAmountUsd: amounts.totalAmountUsd, vatWithheldBs: 0, vatWithheldUsd: 0,
          igtfApplicable: false, igtfAmountBs: 0, igtfAmountUsd: 0,
          paymentTerm: 'CREDITO', journalEntryId: journal.id,
          netReceivableAdjustmentBs: amounts.netReceivableAdjustmentBs,
          netReceivableAdjustmentUsd: amounts.netReceivableAdjustmentUsd,
          correctionReason: String(draft.reason).trim(),
          correctionWorkpaper: '',
          notes: 'Documento correctivo vinculado a ' + source.invoiceNumber + '. Motivo: ' + String(draft.reason).trim()
        };
        setSales(prev => [...prev, note]);
        await waitForPersistence();
        try {
          await recordCorrectionAudit({
            eventType: 'accounting_correction_executed', entityType: 'SALE', companyId: currentCompany.id, entityId: source.id,
            correctionType: isCredit ? 'SALES_CREDIT_NOTE' : 'SALES_DEBIT_NOTE',
            sourceDocumentRef: source.invoiceNumber, correctionDocumentRef: number,
            reason: String(draft.reason).trim(), workpaperNote: '',
            fiscalEmissionMedium: draft.fiscalEmissionMedium, sameMediumAsOriginal: draft.sameMediumAsOriginal,
            journalEntryId: journal.id
          });
        } catch (auditError) {
          throw new Error('La nota quedó guardada y confirmada en SQLite, pero falta registrar el evento final de auditoría. No repita el documento. Asiento: ' + journal.entryNumber + '. ' + (auditError instanceof Error ? auditError.message : 'Error de auditoría.'));
        }
        try {
          await executeCorrectionCase({caseId:correctionCaseId,executionRef:number,reason:'Nota correctiva de venta, asiento y auxiliar CxC persistidos.'});
        } catch (caseError) {
          throw new Error('La nota de venta quedó guardada y auditada en SQLite, pero falta cerrar su trazabilidad interna. No repita el documento. ' + (caseError instanceof Error ? caseError.message : 'Error al cerrar la corrección.'));
        }
        return note;
      });
    } finally {
      correctionWorkflowInFlightRef.current = false;
    }
  };

  const deleteSale = (id: string) => {
    const sale = sales.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!sale) return;
    if (typeof window !== 'undefined') {
      window.alert('Las facturas de venta registradas son documentos históricos inmutables. No se eliminan físicamente; cualquier corrección requiere soporte fiscal válido y reversión contable coordinada.');
    }
  };

  // Inventario contable: cada movimiento valida existencias y conserva la tasa histórica.
  const addProduct = (prodData: Omit<InventoryProduct, 'id' | 'companyId'>): InventoryProduct => {
    assertSQLitePersistenceReady('Registrar el artículo de inventario');
    const code = String(prodData.code || '').trim().toLocaleUpperCase();
    if (!code || !String(prodData.name || '').trim()) throw new Error('El código y la descripción del artículo son obligatorios.');
    if (products.some(p => p.companyId === currentCompany.id && p.code.trim().toLocaleUpperCase() === code)) {
      throw new Error(`Ya existe un artículo con el código ${code} en la empresa activa.`);
    }
    const rate = Number(prodData.openingBcvRate ?? 0);
    const initialQuantity = Number(prodData.currentStock || 0);
    const initialCostBs = Number(prodData.avgCostBs || 0);
    if (!Number.isFinite(rate) || rate < 0 || ((initialQuantity > 0 || initialCostBs > 0) && rate <= 0)) throw new Error('Ingrese la tasa BCV histórica aplicable a la valoración inicial del artículo.');
    const openingDateValue = prodData.openingDate || new Date().toISOString().slice(0, 10);
    const openingDateParsed = new Date(openingDateValue + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(openingDateValue) || !Number.isFinite(openingDateParsed.getTime()) || openingDateParsed.toISOString().slice(0,10) !== openingDateValue) throw new Error('La fecha del inventario inicial no es válida.');
    if (!Number.isFinite(initialQuantity) || initialQuantity < 0 || !Number.isFinite(initialCostBs) || initialCostBs < 0) {
      throw new Error('La existencia y el costo inicial no pueden ser negativos.');
    }
    if (initialQuantity > 0 && initialCostBs <= 0) throw new Error('El inventario inicial debe tener un costo unitario mayor que cero.');
    const newProd: InventoryProduct = {
      ...prodData,
      code,
      currentStock: initialQuantity,
      avgCostBs: initialCostBs,
      avgCostUsd: rate > 0 ? initialCostBs / rate : 0,
      lastCostBs: initialCostBs,
      lastCostUsd: rate > 0 ? initialCostBs / rate : 0,
      inventoryAccountCode: prodData.inventoryAccountCode || getDefaultInventoryAccountCode(prodData.itemType),
      costOfSalesAccountCode: prodData.costOfSalesAccountCode || '5.1.1.01',
      adjustmentAccountCode: prodData.adjustmentAccountCode || '5.1.2.01',
      openingBalanceAccountCode: prodData.openingBalanceAccountCode || '3.3.1.01',
      costingMethod: prodData.costingMethod || 'PROMEDIO_PONDERADO',
      vatTreatment: prodData.vatTreatment || 'GENERAL_16',
      itemType: prodData.itemType || 'MERCANCIA',
      openingDate: openingDateValue,
      openingBcvRate: rate,
      vnrProvisionBs: Number(prodData.vnrProvisionBs || 0),
      id: `prod-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      companyId: currentCompany.id
    };
    const inventoryAccount = accounts.find(a => a.code === newProd.inventoryAccountCode && a.isMovement && a.type === 'ACTIVO');
    const costAccount = accounts.find(a => a.code === newProd.costOfSalesAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
    const adjustmentAccount = accounts.find(a => a.code === newProd.adjustmentAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
    if (!inventoryAccount) throw new Error(`La cuenta de inventario ${newProd.inventoryAccountCode} no existe o no es una cuenta de activo de movimiento.`);
    if (newProd.itemType === 'PRODUCTO_EN_PROCESO' && newProd.inventoryAccountCode !== '1.1.4.04') throw new Error('Los productos en proceso deben asociarse a la cuenta 1.1.4.04.');
    if (!costAccount) throw new Error(`La cuenta de costo de ventas ${newProd.costOfSalesAccountCode} no existe o no admite movimientos.`);
    if (!adjustmentAccount) throw new Error(`La cuenta de mermas/ajustes ${newProd.adjustmentAccountCode} no existe o no admite movimientos.`);
    let opening: InventoryMovement | null = null;
    let openingEntry: JournalEntry | null = null;
    if (initialQuantity > 0) {
      const offsetAccount = accounts.find(a => a.code === newProd.openingBalanceAccountCode && a.isMovement);
      if (!offsetAccount) throw new Error(`La cuenta contrapartida de apertura ${newProd.openingBalanceAccountCode} no existe o no admite movimientos.`);
      const openingValueBs = Math.round(initialQuantity * initialCostBs * 100) / 100;
      const openingValueUsd = Math.round(openingValueBs / rate * 1000000) / 1000000;
      const entryNumber = journalEntries.filter(e => e.companyId === currentCompany.id).reduce((max,e) => Math.max(max,e.entryNumber),0) + 1;
      openingEntry = {
        id: `entry-inventory-opening-${newProd.id}`, companyId: currentCompany.id, entryNumber,
        date: openingDateValue, description: `Asiento de apertura de inventario · ${newProd.code} · ${newProd.name}`,
        type: 'APERTURA', bcvRate: rate, referenceDoc: `APERTURA-${newProd.code}`,
        items: [
          { accountCode: inventoryAccount.code, accountName: inventoryAccount.name, debitBs: openingValueBs, creditBs: 0, debitUsd: openingValueUsd, creditUsd: 0, description: `Existencia inicial de ${initialQuantity} ${newProd.unit}` },
          { accountCode: offsetAccount.code, accountName: offsetAccount.name, debitBs: 0, creditBs: openingValueBs, debitUsd: 0, creditUsd: openingValueUsd, description: `Contrapartida de apertura de inventario ${newProd.code}` }
        ], createdAt: new Date().toISOString()
      };
      opening = {
        id: `mov-opening-${newProd.id}`, companyId: currentCompany.id,
        productId: newProd.id, productName: newProd.name, productCode: newProd.code,
        date: openingEntry.date, type: 'ENTRADA', concept: 'INVENTARIO_INICIAL',
        documentRef: openingEntry.referenceDoc || 'APERTURA-INVENTARIO', quantity: initialQuantity, unitCostBs: initialCostBs,
        unitCostUsd: initialCostBs / rate, totalCostBs: openingValueBs,
        totalCostUsd: openingValueUsd, balanceQty: initialQuantity,
        balanceTotalBs: openingValueBs, balanceTotalUsd: openingValueUsd,
        bcvRate: rate, costingMethod: newProd.costingMethod, journalEntryId: openingEntry.id
      };
    }
    setProducts(prev => [...prev, newProd]);
    if (opening) setMovements(prev => [...prev, opening!]);
    if (openingEntry) {
      reserveBankOutgoingAccounts(openingEntry.companyId, openingEntry.items);
      setJournalEntries(prev => [...prev, openingEntry!]);
    }
    return newProd;
  };


  const getCompanyInventoryProducts = (companyId: string): InventoryProduct[] => {
    if (!companies.some(company => company.id === companyId)) throw new Error('La empresa destino no existe en SICOVEN.');
    return products.filter(product => product.companyId === companyId);
  };

  const getCompanyInventoryMovements = (companyId: string): InventoryMovement[] => {
    if (!companies.some(company => company.id === companyId)) throw new Error('La empresa destino no existe en SICOVEN.');
    return movements.filter(movement => movement.companyId === companyId);
  };

  const importInventoryProducts = async (rows: Omit<InventoryProduct, 'id' | 'companyId'>[], targetCompanyId: string = currentCompany.id): Promise<number> => {
    assertSQLitePersistenceReady('Importar inventario');
    if (!companies.some(company => company.id === targetCompanyId)) throw new Error('La empresa destino no existe en SICOVEN.');
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('El archivo no contiene artículos para importar.');
    const existingCodes = new Set(products.filter(p => p.companyId === targetCompanyId).map(p => p.code.trim().toLocaleUpperCase()));
    const batchCodes = new Set<string>();
    const prepared: InventoryProduct[] = [];
    const openingMovements: InventoryMovement[] = [];
    const openingEntries: JournalEntry[] = [];
    let nextEntryNumber = journalEntries.filter(e => e.companyId === targetCompanyId).reduce((max,e) => Math.max(max,e.entryNumber),0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    for (const row of rows) {
      const code = String(row.code || '').trim().toLocaleUpperCase();
      const name = String(row.name || '').trim();
      if (!code || !name) throw new Error('Cada artículo debe incluir código y descripción.');
      if (existingCodes.has(code) || batchCodes.has(code)) throw new Error('Código duplicado en la empresa o archivo: ' + code + '.');
      batchCodes.add(code);
      const rate = Number(row.openingBcvRate ?? 0);
      const quantity = Number(row.currentStock || 0);
      const unitCostBs = Number(row.avgCostBs || 0);
      const date = row.openingDate || today;
      const parsedOpeningDate = new Date(date + 'T00:00:00Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedOpeningDate.getTime()) || parsedOpeningDate.toISOString().slice(0,10) !== date) throw new Error('Fecha de apertura inválida para ' + code + '.');
      if (!Number.isFinite(rate) || rate < 0 || ((quantity > 0 || unitCostBs > 0) && rate <= 0) || !Number.isFinite(quantity) || quantity < 0 ||
          !Number.isFinite(unitCostBs) || unitCostBs < 0 || (quantity > 0 && unitCostBs <= 0)) throw new Error('Tasa, cantidad o costo inválidos para ' + code + '.');
      const lastCostBs = Number(row.lastCostBs ?? unitCostBs);
      const lastCostUsd = Number(row.lastCostUsd ?? (rate > 0 ? lastCostBs / rate : 0));
      if (!Number.isFinite(lastCostBs) || lastCostBs < 0 || !Number.isFinite(lastCostUsd) || lastCostUsd < 0 ||
          (quantity > 0 && (lastCostBs <= 0 || lastCostUsd <= 0))) {
        throw new Error('Último costo Bs/USD inválido para ' + code + '. Declare ambos valores cuando importe inventario universal.');
      }
      const product: InventoryProduct = {
        ...row, id: 'prod-import-' + Date.now() + '-' + prepared.length + '-' + Math.floor(Math.random() * 100000),
        companyId: targetCompanyId, code, name, currentStock: quantity, avgCostBs: unitCostBs,
        avgCostUsd: rate > 0 ? unitCostBs / rate : 0, lastCostBs, lastCostUsd,
        inventoryAccountCode: row.inventoryAccountCode || getDefaultInventoryAccountCode(row.itemType),
        costOfSalesAccountCode: row.costOfSalesAccountCode || '5.1.1.01',
        adjustmentAccountCode: row.adjustmentAccountCode || '5.1.2.01',
        openingBalanceAccountCode: row.openingBalanceAccountCode || '3.3.1.01',
        costingMethod: row.costingMethod || 'PROMEDIO_PONDERADO',
        vatTreatment: row.vatTreatment || 'GENERAL_16', itemType: row.itemType || 'MERCANCIA',
        openingDate: date, openingBcvRate: rate, vnrProvisionBs: Number(row.vnrProvisionBs || 0)
      };
      const inventoryAccount = accounts.find(a => a.code === product.inventoryAccountCode && a.isMovement && a.type === 'ACTIVO');
      const costAccount = accounts.find(a => a.code === product.costOfSalesAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
      const adjustmentAccount = accounts.find(a => a.code === product.adjustmentAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
      if (!inventoryAccount || !costAccount || !adjustmentAccount) throw new Error('Cuentas contables inválidas para el artículo ' + code + '.');
      if (product.itemType === 'PRODUCTO_EN_PROCESO' && product.inventoryAccountCode !== '1.1.4.04') throw new Error('El artículo ' + code + ' es producto en proceso y debe usar la cuenta 1.1.4.04.');
      if (quantity > 0) {
        const offsetAccount = accounts.find(a => a.code === product.openingBalanceAccountCode && a.isMovement);
        if (!offsetAccount) throw new Error('Cuenta de contrapartida de apertura inválida para el artículo ' + code + '.');
        const totalBs = Math.round(quantity * unitCostBs * 100) / 100;
        const totalUsd = Math.round(totalBs / rate * 1000000) / 1000000;
        const entry: JournalEntry = {
          id: 'entry-inventory-opening-' + product.id, companyId: targetCompanyId, entryNumber: nextEntryNumber++,
          date, description: 'Asiento de apertura de inventario · ' + code + ' · ' + name, type: 'APERTURA',
          bcvRate: rate, referenceDoc: 'APERTURA-' + code,
          items: [
            { accountCode: inventoryAccount.code, accountName: inventoryAccount.name, debitBs: totalBs, creditBs: 0, debitUsd: totalUsd, creditUsd: 0, description: 'Existencia inicial de ' + quantity + ' ' + product.unit },
            { accountCode: offsetAccount.code, accountName: offsetAccount.name, debitBs: 0, creditBs: totalBs, debitUsd: 0, creditUsd: totalUsd, description: 'Contrapartida de apertura de inventario ' + code }
          ], createdAt: new Date().toISOString()
        };
        openingEntries.push(entry);
        openingMovements.push({
          id: 'mov-opening-' + product.id, companyId: targetCompanyId, productId: product.id,
          productName: name, productCode: code, date, type: 'ENTRADA', concept: 'INVENTARIO_INICIAL',
          documentRef: entry.referenceDoc || 'APERTURA-INVENTARIO', quantity, unitCostBs,
          unitCostUsd: unitCostBs / rate, totalCostBs: totalBs, totalCostUsd: totalUsd,
          balanceQty: quantity, balanceTotalBs: totalBs, balanceTotalUsd: totalUsd,
          bcvRate: rate, costingMethod: product.costingMethod, journalEntryId: entry.id
        });
      }
      prepared.push(product);
    }
    openingEntries.forEach(entry => reserveBankOutgoingAccounts(entry.companyId, entry.items));
    // Confirmar la escritura del snapshot completo (productos, Kardex y asientos)
    // en SQLite antes de informar éxito al asistente de importación.
    const persistenceConfirmation = waitForPersistence();
    setProducts(prev => [...prev, ...prepared]);
    if (openingMovements.length) setMovements(prev => [...prev, ...openingMovements]);
    if (openingEntries.length) setJournalEntries(prev => [...prev, ...openingEntries]);
    await persistenceConfirmation;
    return prepared.length;
  };


  const importInventoryMovements = (rows: InventoryMovementImportDraft[], targetCompanyId: string = currentCompany.id): number => {
    const targetCompany = companies.find(company => company.id === targetCompanyId);
    if (!targetCompany) throw new Error('La empresa destino de los movimientos no existe en SICOVEN.');
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('El archivo no contiene movimientos para importar.');
    const virtualProducts = new Map(products.filter(p => p.companyId === targetCompany.id).map(p => [p.id, p]));
    const virtualMovements = movements.filter(m => m.companyId === targetCompany.id).slice();
    const importedMovements: InventoryMovement[] = [];
    const importedEntries: JournalEntry[] = [];
    const keys = new Set<string>();
    let nextEntryNumber = journalEntries.filter(e => e.companyId === targetCompany.id).reduce((max,e) => Math.max(max,e.entryNumber),0) + 1;
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      if (row.type === 'SALIDA' && row.concept === 'DEVOLUCION_COMPRA') {
        throw new Error('Importación bloqueada en fila ' + (index + 2) + ': las devoluciones a proveedor requieren una nota de crédito conciliada con factura, Kardex, CxP e impuestos. No se importó ningún movimiento.');
      }
      if (targetCompany.closedThroughDate && row.date <= targetCompany.closedThroughDate) throw new Error('Fila ' + (index + 2) + ': la fecha está dentro del período cerrado hasta ' + targetCompany.closedThroughDate + '.');
      const product = virtualProducts.get(row.productId);
      if (!product) throw new Error('Fila ' + (index + 2) + ': artículo no encontrado en la empresa destino.');
      if (!row.documentRef || !String(row.documentRef).trim()) throw new Error('Fila ' + (index + 2) + ': la referencia documental es obligatoria.');
      const key = [row.productId,row.date,row.type,String(row.documentRef).trim().toLowerCase()].join('|');
      if (keys.has(key) || virtualMovements.some(m => m.productId === row.productId && m.date === row.date && m.type === row.type && m.documentRef.trim().toLowerCase() === String(row.documentRef).trim().toLowerCase())) {
        throw new Error('Movimiento duplicado en la fila ' + (index + 2) + ': ' + row.documentRef + '.');
      }
      keys.add(key);
      const priorProductMovements = virtualMovements.filter(m => m.productId === product.id).slice().sort((a,b) => a.date.localeCompare(b.date));
      if (priorProductMovements.length && row.date < priorProductMovements[priorProductMovements.length - 1].date) throw new Error('Fila ' + (index + 2) + ': importe los períodos históricos en orden cronológico; esta fecha es anterior al último movimiento de ' + product.code + '.');
      const rate = Number(row.bcvRate ?? 0);
      const requestedCost = Number(row.unitCostBs);
      const landedCostsBs = Number(row.additionalLandedCostsBs || 0);
      if (!Number.isFinite(landedCostsBs) || landedCostsBs < 0) throw new Error('Fila ' + (index + 2) + ': los fletes/gastos asociados no pueden ser negativos.');
      const effectiveUnitCost = row.type === 'ENTRADA' ? requestedCost + landedCostsBs / Math.max(Number(row.quantity), 1e-8) : requestedCost;
      const isAdjustment = row.type === 'AJUSTE';
      const targetStock = Number(row.balanceQty);
      const quantity = isAdjustment ? Math.abs(targetStock - product.currentStock) : Number(row.quantity);
      const validation = validateInventoryMovement({
        date: row.date, quantity: isAdjustment ? Math.max(quantity,0.00000001) : Number(row.quantity),
        bcvRate: rate, unitCostBs: effectiveUnitCost, availableQuantity: product.currentStock,
        type: isAdjustment ? 'AJUSTE' : row.type
      });
      if (validation) throw new Error('Fila ' + (index + 2) + ': ' + validation);
      if (isAdjustment && (!Number.isFinite(targetStock) || targetStock < 0 || quantity < 0.00000001)) {
        throw new Error('Fila ' + (index + 2) + ': indique una existencia final de ajuste distinta de la actual.');
      }
      let unitCostBs = requestedCost;
      let totalCostBs = 0;
      let newStock = product.currentStock;
      let newAverageBs = product.avgCostBs;
      let movementQuantity = Number(row.quantity);
      if (row.type === 'ENTRADA') {
        unitCostBs = effectiveUnitCost;
        const weighted = calculateWeightedAverageCost(product.currentStock, product.avgCostBs, Number(row.quantity), effectiveUnitCost, rate);
        newStock = weighted.quantity; newAverageBs = weighted.unitCostBs;
        totalCostBs = Math.round(Number(row.quantity) * effectiveUnitCost * 100) / 100;
      } else if (row.type === 'SALIDA') {
        if (product.costingMethod === 'PEPS') {
          const history = virtualMovements.filter(m => m.companyId === targetCompany.id && m.productId === product.id);
          const layers = reconstructFifoLayers(history, product.currentStock);
          const fifoLayerValue = layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0);
          totalCostBs = calculateFifoIssue(layers, Number(row.quantity)).totalCostBs;
          newStock = Math.max(0, product.currentStock - Number(row.quantity));
          newAverageBs = newStock > 0 ? Math.max(0, fifoLayerValue - totalCostBs) / newStock : 0;
        } else totalCostBs = Math.round(Number(row.quantity) * product.avgCostBs * 100) / 100;
        unitCostBs = totalCostBs / Number(row.quantity);
        newStock = Math.max(0, product.currentStock - Number(row.quantity));
      } else {
        movementQuantity = quantity;
        newStock = targetStock;
        if (targetStock > product.currentStock) {
          const weighted = calculateWeightedAverageCost(product.currentStock, product.avgCostBs, targetStock - product.currentStock, requestedCost, rate);
          newAverageBs = weighted.unitCostBs;
        }
        totalCostBs = Math.round(quantity * (targetStock < product.currentStock ? product.avgCostBs : requestedCost) * 100) / 100;
        unitCostBs = quantity > 0 ? totalCostBs / quantity : 0;
      }
      const totalCostUsd = Math.round(totalCostBs / rate * 1000000) / 1000000;
      const newAverageUsd = newAverageBs / rate;
      const movement: InventoryMovement = {
        ...row, id: 'mov-import-' + Date.now() + '-' + index + '-' + Math.floor(Math.random()*100000),
        companyId: targetCompany.id, productName: product.name, productCode: product.code, quantity: movementQuantity, unitCostBs, unitCostUsd: unitCostBs / rate, additionalLandedCostsBs: landedCostsBs,
        totalCostBs, totalCostUsd, balanceQty: newStock,
        balanceTotalBs: Math.round(newStock * newAverageBs * 100) / 100,
        balanceTotalUsd: Math.round(newStock * newAverageUsd * 1000000) / 1000000,
        bcvRate: rate, costingMethod: product.costingMethod || 'PROMEDIO_PONDERADO'
      };
      const inventoryCode = product.inventoryAccountCode || getDefaultInventoryAccountCode(product.itemType);
      const costCode = product.costOfSalesAccountCode || '5.1.1.01';
      const adjustmentCode = product.adjustmentAccountCode || '5.1.2.01';
      const inventoryAccount = accounts.find(a => a.code === inventoryCode && a.isMovement);
      const costAccount = accounts.find(a => a.code === costCode && a.isMovement);
      const adjustmentAccount = accounts.find(a => a.code === adjustmentCode && a.isMovement);
      const isSale = row.type === 'SALIDA' && row.concept === 'VENTA';
      const isLoss = row.type === 'SALIDA' && ['MERMA','AUTOCONSUMO'].includes(row.concept);
      const isCustomerReturn = row.type === 'ENTRADA' && row.concept === 'DEVOLUCION_CLIENTE';
      const isSupplierReturn = row.type === 'SALIDA' && row.concept === 'DEVOLUCION_COMPRA';
      const positiveAdjustment = row.type === 'AJUSTE' && targetStock > product.currentStock;
      if (isSale || isLoss || isCustomerReturn || isSupplierReturn || isAdjustment) {
        if (!inventoryAccount) throw new Error('Cuenta de inventario inválida para ' + product.code + '.');
        const payableAccount = accounts.find(a => a.code === '2.1.1.01' && a.isMovement);
        if ((isSale || isCustomerReturn) && !costAccount) throw new Error('Cuenta de costo de ventas inválida para ' + product.code + '.');
        if ((isLoss || isAdjustment) && !adjustmentAccount) throw new Error('Cuenta de mermas/ajustes inválida para ' + product.code + '.');
        if (isSupplierReturn && !payableAccount) throw new Error('Falta la cuenta de control CxP 2.1.1.01 para la devolución al proveedor.');
        const debitCode = isSale ? costCode : isSupplierReturn ? '2.1.1.01' : adjustmentCode;
        const amountUsd = totalCostUsd;
        const makeLine = (code:string, debitBs:number, creditBs:number, debitUsd:number, creditUsd:number, description:string): JournalEntryItem => ({
          accountCode: code, accountName: accounts.find(a => a.code === code)?.name || code,
          debitBs, creditBs, debitUsd, creditUsd, description
        });
        const lines: JournalEntryItem[] = positiveAdjustment
          ? [makeLine(inventoryCode,totalCostBs,0,amountUsd,0,'Entrada por sobrante de inventario'),makeLine(adjustmentCode,0,totalCostBs,0,amountUsd,'Contrapartida por sobrante de inventario')]
          : isCustomerReturn
            ? [makeLine(inventoryCode,totalCostBs,0,amountUsd,0,'Entrada por devolución de cliente'),makeLine(costCode,0,totalCostBs,0,amountUsd,'Reversión del costo de ventas por devolución')]
            : isSupplierReturn
              ? [makeLine('2.1.1.01',totalCostBs,0,amountUsd,0,'Devolución de mercancía al proveedor'),makeLine(inventoryCode,0,totalCostBs,0,amountUsd,'Salida por devolución de compra')]
              : [makeLine(debitCode,totalCostBs,0,amountUsd,0,isSale?'Costo de ventas por movimiento importado':'Merma/ajuste de inventario importado'),makeLine(inventoryCode,0,totalCostBs,0,amountUsd,'Descargo de inventario importado')];
        const entry: JournalEntry = {
          id: 'entry-inventory-import-' + Date.now() + '-' + index, companyId: targetCompany.id, entryNumber: nextEntryNumber++,
          date: row.date, description: (isSale?'Costo de venta':isCustomerReturn?'Devolución de cliente':isSupplierReturn?'Devolución a proveedor':positiveAdjustment?'Sobrante':'Merma/ajuste') + ' importado · ' + product.code + ' · ' + row.documentRef,
          type: 'INVENTARIO', bcvRate: rate, referenceDoc: row.documentRef, items: lines, createdAt: new Date().toISOString()
        };
        movement.journalEntryId = entry.id;
        importedEntries.push(entry);
      }
      importedMovements.push(movement);
      virtualMovements.push(movement);
      virtualProducts.set(product.id, {
        ...product, currentStock: newStock, avgCostBs: newAverageBs, avgCostUsd: newAverageUsd,
        lastCostBs: row.type === 'ENTRADA' ? effectiveUnitCost : product.lastCostBs,
        lastCostUsd: row.type === 'ENTRADA' ? effectiveUnitCost / rate : product.lastCostUsd
      });
    }
    importedEntries.forEach(entry => reserveBankOutgoingAccounts(entry.companyId, entry.items));
    setProducts(prev => prev.map(product => virtualProducts.get(product.id) || product));
    setMovements(prev => [...prev, ...importedMovements]);
    if (importedEntries.length) setJournalEntries(prev => [...prev, ...importedEntries]);
    return importedMovements.length;
  };

  const updateProduct = async (updated: InventoryProduct, reason: string, workpaperNote: string): Promise<void> => {
    assertSQLitePersistenceReady('Corregir los datos maestros del artículo');
    const original = products.find(p => p.id === updated.id && p.companyId === currentCompany.id);
    if (!original) throw new Error('El artículo no pertenece a la empresa activa.');
    if (!updated.code.trim() || !updated.name.trim() || !updated.category.trim() || !updated.unit.trim()) {
      throw new Error('Código, descripción, categoría y unidad son obligatorios.');
    }
    if (![updated.minStock, updated.salesPriceBs, updated.salesPriceUsd].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) {
      throw new Error('Stock mínimo y precios deben ser importes numéricos no negativos.');
    }
    if (!['GENERAL_16', 'REDUCIDA_8', 'EXENTO', 'EXONERADO'].includes(updated.vatTreatment || 'GENERAL_16')) {
      throw new Error('El tratamiento IVA del artículo no es válido.');
    }
    if (products.some(p => p.id !== updated.id && p.companyId === currentCompany.id && p.code.trim().toLocaleUpperCase() === updated.code.trim().toLocaleUpperCase())) {
      throw new Error('Ya existe otro artículo con ese código en la empresa activa.');
    }
    const immutableInventoryFields: Array<keyof InventoryProduct> = [
      'currentStock', 'avgCostBs', 'avgCostUsd', 'lastCostBs', 'lastCostUsd',
      'vnrProvisionBs', 'inventoryAccountCode', 'costOfSalesAccountCode',
      'adjustmentAccountCode', 'openingBalanceAccountCode', 'costingMethod', 'itemType',
      'openingDate', 'openingBcvRate'
    ];
    if (immutableInventoryFields.some(field => Number.isFinite(Number(original[field])) && Number.isFinite(Number(updated[field]))
      ? Number(original[field]) !== Number(updated[field])
      : original[field] !== updated[field])) {
      throw new Error('No se pueden corregir existencias, costos históricos, método de costeo ni cuentas de inventario editando la ficha. Use movimientos y ajustes de Kardex con asiento correctivo.');
    }
    const normalizedReason = String(reason || '').trim() || 'Corrección de datos maestros del artículo';
    const normalizedWorkpaper = String(workpaperNote || '').trim();
    if (normalizedReason.length > 2000 || normalizedWorkpaper.length > 4000) {
      throw new Error('El motivo o la nota exceden el máximo permitido.');
    }
    await recordCorrectionAudit({
      eventType: 'accounting_correction_requested', entityType: 'INVENTORY_PRODUCT',
      companyId: currentCompany.id, entityId: original.id, correctionType: 'PRODUCT_MASTER_DATA_CORRECTION',
      sourceDocumentRef: original.code + ' · ' + original.name,
      correctionDocumentRef: updated.code + ' · ' + updated.name,
      reason: normalizedReason, workpaperNote: normalizedWorkpaper
    });
    setProducts(prev => prev.map(p => (p.id === updated.id && p.companyId === currentCompany.id ? updated : p)));
    try {
      await waitForPersistence();
    } catch (error) {
      throw new Error('SQLite no confirmó la corrección del artículo. La ficha volvió al último estado confirmado; la solicitud permanece en auditoría. ' +
        (error instanceof Error ? error.message : 'Error de persistencia.'));
    }
    try {
      await recordCorrectionAudit({
        eventType: 'accounting_correction_executed', entityType: 'INVENTORY_PRODUCT',
        companyId: currentCompany.id, entityId: original.id, correctionType: 'PRODUCT_MASTER_DATA_CORRECTION',
        sourceDocumentRef: original.code + ' · ' + original.name,
        correctionDocumentRef: updated.code + ' · ' + updated.name,
        reason: normalizedReason, workpaperNote: normalizedWorkpaper
      });
    } catch (error) {
      throw new Error('La corrección de ficha quedó guardada en SQLite, pero falta el evento final de auditoría. No repita la corrección. ' +
        (error instanceof Error ? error.message : 'Error de auditoría.'));
    }
  };

  const inventoryCorrectionAuthorizationRef = useRef<string | null>(null);
  const journalCorrectionAuthorizationRef = useRef<string | null>(null);
  const addMovement = (movData: Omit<InventoryMovement, 'id' | 'companyId'>): InventoryMovement => {
    if (movData.correctionForMovementId) {
      const authorizationKey = String(movData.correctionForMovementId) + '|' + String(movData.documentRef || '').trim();
      if (inventoryCorrectionAuthorizationRef.current !== authorizationKey) {
        throw new Error('El movimiento correctivo requiere autorización formal aprobada para el movimiento fuente y su referencia documental.');
      }
      inventoryCorrectionAuthorizationRef.current = null;
    }
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('El movimiento de inventario requiere SQLite local de escritorio disponible y lista.');
    }
    const prod = products.find(p => p.id === movData.productId && p.companyId === currentCompany.id);
    if (!prod) throw new Error('El artículo no existe en la empresa activa.');
    if (!isValidIsoDate(movData.date)) throw new Error('La fecha del movimiento no es válida.');
    if (currentCompany.closedThroughDate && movData.date <= currentCompany.closedThroughDate) {
      throw new Error('No se permiten movimientos ni devoluciones en un período cerrado hasta ' + currentCompany.closedThroughDate + '.');
    }
    const supplierReturn = movData.type === 'SALIDA' && movData.concept === 'DEVOLUCION_COMPRA';
    if (supplierReturn) {
      // Fail closed: addMovement can post inventory/AP but cannot atomically create
      // the supplier credit note, reverse the proportional tax/withholdings/IGTF,
      // and reduce the linked PURCHASE_PAYMENT balance. Do not allow a partial posting.
      throw new Error('Devolución a proveedor aún no habilitada: falta el flujo atómico de nota de crédito que ajuste Kardex, CxP, IVA, retenciones e IGTF y vincule todos los documentos. No se registró ningún movimiento ni asiento.');
    }
    if (supplierReturn && !movData.correctionForMovementId) {
      throw new Error('La devolución a proveedor debe vincularse obligatoriamente con la entrada original de compra.');
    }
    if (supplierReturn && movements.some(m => m.companyId === currentCompany.id && m.concept === 'DEVOLUCION_COMPRA' &&
      m.documentRef.trim().toUpperCase() === String(movData.documentRef || '').trim().toUpperCase())) {
      throw new Error('El documento de devolución ya fue utilizado; no se permite contabilizarlo dos veces.');
    }
    if (movData.correctionForMovementId) {
      const original = movements.find(m => m.id === movData.correctionForMovementId && m.companyId === currentCompany.id);
      if (!original || original.correctionForMovementId) {
        throw new Error('El movimiento original de la corrección no existe o ya es una corrección.');
      }
      if (original.productId !== movData.productId) {
        throw new Error('La corrección debe afectar el mismo artículo del movimiento original.');
      }
      const isCustomerReturn = original.type === 'SALIDA' && original.concept === 'VENTA' &&
        movData.type === 'ENTRADA' && movData.concept === 'DEVOLUCION_CLIENTE';
      const isSupplierReturn = original.type === 'ENTRADA' && original.concept === 'COMPRA' &&
        movData.type === 'SALIDA' && movData.concept === 'DEVOLUCION_COMPRA';
      if (isSupplierReturn && movData.date < original.date) {
        throw new Error('La devolución no puede tener fecha anterior a la entrada original de compra.');
      }
      if (isSupplierReturn && (movData.documentType !== 'Nota de crédito proveedor' ||
          String(movData.documentRef || '').trim().length < 4)) {
        throw new Error('La devolución requiere el número y tipo de una nota de crédito real del proveedor.');
      }
      if (!isCustomerReturn && !isSupplierReturn) {
        throw new Error('La corrección debe ser una devolución de cliente sobre una salida por venta o una devolución a proveedor sobre una entrada por compra.');
      }
      const correctedQuantity = movements
        .filter(m => m.companyId === currentCompany.id && m.correctionForMovementId === original.id)
        .reduce((sum, m) => sum + Number(m.quantity || 0), 0);
      const requestedQuantity = Number(movData.quantity);
      if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 ||
          correctedQuantity + requestedQuantity > Number(original.quantity) + 1e-8) {
        throw new Error('La cantidad de correcciones supera la cantidad del movimiento original. Disponible para corregir: ' +
          Math.max(0, Number(original.quantity) - correctedQuantity) + '.');
      }
      if (isSupplierReturn && prod.costingMethod === 'PEPS') {
        throw new Error('La devolución a proveedor con costeo PEPS requiere identificación del lote de origen. No se registró el movimiento para evitar descargar un lote incorrecto.');
      }
      if (isSupplierReturn) {
        const purchase = purchases.find(p => p.companyId === currentCompany.id &&
          ('FAC-' + p.invoiceNumber).trim().toUpperCase() === original.documentRef.trim().toUpperCase());
        if (!purchase || purchase.isCancelled || !purchase.inventoryLines?.length) {
          throw new Error('Devolución bloqueada: la entrada no tiene una factura vigente con líneas de mercancía estructuradas.');
        }
        const lines = purchase.inventoryLines;
        const linkedLine = lines.find(line => line.productId === prod.id &&
          Math.abs(Number(line.quantity) - Number(original.quantity)) <= 1e-8 &&
          Math.abs(Number(line.unitCostBs) - Number(original.unitCostBs)) <= 0.02);
        const invoiceMovements = movements.filter(m => m.companyId === currentCompany.id &&
          m.type === 'ENTRADA' && m.concept === 'COMPRA' &&
          m.documentRef.trim().toUpperCase() === original.documentRef.trim().toUpperCase() &&
          !m.correctionForMovementId);
        const lineTotal = lines.reduce((sum,line) => sum + Number(line.quantity || 0) * Number(line.unitCostBs || 0), 0);
        const expectedInventory = Number(purchase.taxableBaseBs || 0) + Number(purchase.exemptAmountBs || 0);
        const allLinesMatch = invoiceMovements.length === lines.length &&
          lines.every(line => {
            const matches = invoiceMovements.filter(m => m.productId === line.productId);
            return matches.length === 1 &&
              Math.abs(Number(matches[0].quantity) - Number(line.quantity)) <= 1e-8 &&
              Math.abs(Number(matches[0].totalCostBs) - Number(line.quantity) * Number(line.unitCostBs)) <= 0.02;
          }) &&
          Math.abs(lineTotal - expectedInventory) <= 0.02 &&
          Math.abs(invoiceMovements.reduce((sum,m) => sum + Number(m.totalCostBs || 0),0) - lineTotal) <= 0.02;
        const originalJournal = purchase.journalEntryId
          ? journalEntries.find(entry => entry.id === purchase.journalEntryId && entry.companyId === currentCompany.id)
          : undefined;
        const expectedInventoryByAccount = new Map<string, number>();
        for (const line of lines) {
          const lineProduct = products.find(item => item.id === line.productId && item.companyId === currentCompany.id);
          if (!lineProduct) throw new Error('Devolución bloqueada: una línea de la factura no tiene artículo contable asociado.');
          const accountCode = lineProduct.inventoryAccountCode || '1.1.4.01';
          expectedInventoryByAccount.set(accountCode,
            Math.round(((expectedInventoryByAccount.get(accountCode) || 0) +
              Number(line.quantity) * Number(line.unitCostBs)) * 100) / 100);
        }
        const journalInventoryMatches = Boolean(originalJournal) && [...expectedInventoryByAccount.entries()].every(([accountCode, expected]) => {
          const actual = originalJournal!.items
            .filter(item => item.accountCode === accountCode)
            .reduce((sum,item) => sum + Number(item.debitBs || 0) - Number(item.creditBs || 0), 0);
          return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.02;
        }) && originalJournal!.items
          .filter(item => item.accountCode.startsWith('1.1.4.') && !expectedInventoryByAccount.has(item.accountCode))
          .every(item => Math.abs(Number(item.debitBs || 0) - Number(item.creditBs || 0)) <= 0.02);
        if (!linkedLine || !allLinesMatch || !originalJournal || !journalInventoryMatches ||
            Math.abs(lineTotal - expectedInventory) > 0.02) {
          throw new Error('Devolución bloqueada: no coincide la factura original con todas sus líneas, entradas de Kardex y débitos por cuenta auxiliar de inventario del asiento.');
        }
        if (Number(purchase.vatAmountBs || 0) > 0 || Number(purchase.vatWithheldBs || 0) > 0 ||
            Number(purchase.islrWithheldBs || 0) > 0 || Number(purchase.igtfAmountBs || 0) > 0) {
          throw new Error('Devolución bloqueada: falta emitir y vincular la nota de crédito con el ajuste completo de IVA, retenciones e IGTF. No se generó asiento parcial.');
        }
        if (Math.abs(Number(prod.avgCostBs || 0) - Number(original.unitCostBs || 0)) > 0.01) {
          throw new Error('Devolución bloqueada: el costo promedio actual difiere del costo de la entrada original.');
        }
        if (purchase.paymentTerm !== 'CREDITO') {
          throw new Error('Devolución bloqueada: la factura no tiene un saldo de CxP de crédito conciliable. Debe implementarse primero el tratamiento de anticipos o saldos a favor del proveedor.');
        }
        const payableBalance = getCreditBalance(purchase.id, 'PURCHASE_PAYMENT');
        const returnValueUsd = Number(movData.quantity) * Number(original.unitCostBs) / Number(purchase.bcvRate);
        if (!Number.isFinite(returnValueUsd) || returnValueUsd > payableBalance.outstandingUsd + 0.005) {
          throw new Error('Devolución bloqueada: el valor de la mercancía supera el saldo pendiente de CxP de la factura. Requiere tratamiento de saldo a favor del proveedor.');
        }
      }
    } else if (supplierReturn) {
      throw new Error('La devolución a proveedor debe conservar el vínculo con su entrada original.');
    }
    const rate = Number(movData.bcvRate ?? 0);
    const isAdjustment = movData.type === 'AJUSTE';
    const actualQuantity = isAdjustment ? Math.abs(Number(movData.balanceQty) - prod.currentStock) : Number(movData.quantity);
    const requestedCost = Number(movData.unitCostBs);
    const landedCostsBs = Number(movData.additionalLandedCostsBs || 0);
    if (!Number.isFinite(landedCostsBs) || landedCostsBs < 0) throw new Error('Los fletes y gastos asociados no pueden ser negativos.');
    const effectiveUnitCost = movData.type === 'ENTRADA' ? requestedCost + landedCostsBs / Math.max(Number(movData.quantity), 1e-8) : requestedCost;
    const validation = validateInventoryMovement({
      date: movData.date, quantity: isAdjustment ? Math.max(actualQuantity, 0.00000001) : Number(movData.quantity),
      bcvRate: rate, unitCostBs: effectiveUnitCost, availableQuantity: prod.currentStock, type: isAdjustment ? 'AJUSTE' : movData.type
    });
    if (validation) throw new Error(validation);
    if (isAdjustment && actualQuantity < 0.00000001) throw new Error('El ajuste no cambia la existencia; no hay movimiento que registrar.');

    const prior = movements.filter(m => m.companyId === currentCompany.id && m.productId === prod.id)
      .slice().sort((a, b) => a.date.localeCompare(b.date));
    if (prior.length && movData.date < prior[prior.length - 1].date) throw new Error('El movimiento está fechado antes del último registro del Kardex. Importe primero los períodos históricos en orden cronológico para evitar saldos y costos incorrectos.');
    let unitCostBs = requestedCost;
    let unitCostUsd = requestedCost / rate;
    let totalCostBs = 0;
    let totalCostUsd = 0;
    let newStock = prod.currentStock;
    let newAverageBs = prod.avgCostBs;
    let newAverageUsd = prod.avgCostBs / rate;
    let movementQuantity = Number(movData.quantity);

    if (movData.type === 'ENTRADA') {
      unitCostBs = effectiveUnitCost;
      unitCostUsd = unitCostBs / rate;
      const weighted = calculateWeightedAverageCost(prod.currentStock, prod.avgCostBs, Number(movData.quantity), effectiveUnitCost, rate);
      newStock = weighted.quantity;
      newAverageBs = weighted.unitCostBs;
      newAverageUsd = weighted.unitCostUsd;
      totalCostBs = Math.round(Number(movData.quantity) * effectiveUnitCost * 100) / 100;
      totalCostUsd = Math.round(totalCostBs / rate * 1000000) / 1000000;
    } else if (movData.type === 'SALIDA') {
      if (prod.costingMethod === 'PEPS') {
        const layers = reconstructFifoLayers(prior, prod.currentStock);
        const fifoLayerValue = layers.reduce((sum, layer) => sum + layer.quantity * layer.unitCostBs, 0);
        const fifo = calculateFifoIssue(layers, Number(movData.quantity));
        totalCostBs = fifo.totalCostBs;
        totalCostUsd = Math.round(totalCostBs / rate * 1000000) / 1000000;
        unitCostBs = fifo.unitCostBs;
        unitCostUsd = unitCostBs / rate;
        newStock = Math.max(0, prod.currentStock - Number(movData.quantity));
        newAverageBs = newStock > 0 ? Math.max(0, fifoLayerValue - totalCostBs) / newStock : 0;
        newAverageUsd = newAverageBs / rate;
      } else {
        unitCostBs = prod.avgCostBs;
        unitCostUsd = unitCostBs / rate;
        totalCostBs = Math.round(Number(movData.quantity) * unitCostBs * 100) / 100;
        totalCostUsd = Math.round(totalCostBs / rate * 1000000) / 1000000;
        newStock = prod.currentStock - Number(movData.quantity);
      }
    } else {
      movementQuantity = actualQuantity;
      const targetStock = Number(movData.balanceQty);
      if (!Number.isFinite(targetStock) || targetStock < 0) throw new Error('La existencia final del ajuste no es válida.');
      newStock = targetStock;
      if (targetStock > prod.currentStock) {
        const weighted = calculateWeightedAverageCost(prod.currentStock, prod.avgCostBs, targetStock - prod.currentStock, requestedCost, rate);
        newAverageBs = weighted.unitCostBs;
        newAverageUsd = weighted.unitCostUsd;
      }
      totalCostBs = Math.round(actualQuantity * (targetStock < prod.currentStock ? prod.avgCostBs : requestedCost) * 100) / 100;
      totalCostUsd = Math.round(totalCostBs / rate * 1000000) / 1000000;
      unitCostBs = actualQuantity > 0 ? totalCostBs / actualQuantity : 0;
      unitCostUsd = unitCostBs / rate;
    }

    const newMov: InventoryMovement = {
      ...movData,
      id: `mov-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      companyId: currentCompany.id,
      quantity: movementQuantity,
      unitCostBs, unitCostUsd, totalCostBs, totalCostUsd,
      balanceQty: newStock,
      balanceTotalBs: Math.round(newStock * newAverageBs * 100) / 100,
      balanceTotalUsd: Math.round(newStock * newAverageUsd * 1000000) / 1000000,
      bcvRate: rate, additionalLandedCostsBs: landedCostsBs,
      costingMethod: prod.costingMethod || 'PROMEDIO_PONDERADO'
    };

    const generatedEntries: JournalEntry[] = [];
    const inventoryAccountCode = prod.inventoryAccountCode || getDefaultInventoryAccountCode(prod.itemType);
    const costAccountCode = prod.costOfSalesAccountCode || '5.1.1.01';
    const adjustmentAccountCode = prod.adjustmentAccountCode || '5.1.2.01';
    const inventoryAccount = accounts.find(a => a.code === inventoryAccountCode);
    const costAccount = accounts.find(a => a.code === costAccountCode);
    const adjustmentAccount = accounts.find(a => a.code === adjustmentAccountCode);
    const makeLine = (code: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number, description: string): JournalEntryItem => ({
      accountCode: code, accountName: accounts.find(a => a.code === code)?.name || code,
      debitBs, creditBs, debitUsd, creditUsd, description
    });
    const isSale = movData.type === 'SALIDA' && movData.concept === 'VENTA';
    const isLoss = movData.type === 'SALIDA' && (movData.concept === 'MERMA' || movData.concept === 'AUTOCONSUMO');
    const isCustomerReturn = movData.type === 'ENTRADA' && movData.concept === 'DEVOLUCION_CLIENTE';
    const isSupplierReturn = movData.type === 'SALIDA' && movData.concept === 'DEVOLUCION_COMPRA';
    const adjustmentDelta = Number(movData.balanceQty) - prod.currentStock;
    const isPositiveAdjustment = movData.type === 'AJUSTE' && adjustmentDelta > 0;
    const shouldPost = isSale || isLoss || isCustomerReturn || isSupplierReturn || movData.type === 'AJUSTE';
    if (shouldPost) {
      if (!inventoryAccount || !inventoryAccount.isMovement) throw new Error(`La cuenta de inventario ${inventoryAccountCode} no existe o no admite movimientos.`);
      const payableAccount = accounts.find(a => a.code === '2.1.1.01' && a.isMovement);
      const debitCode = isSale ? costAccountCode : isSupplierReturn ? '2.1.1.01' : adjustmentAccountCode;
      const debitAccount = isSale || isCustomerReturn ? costAccount : isSupplierReturn ? payableAccount : adjustmentAccount;
      if ((isSale || isCustomerReturn) && (!costAccount || !costAccount.isMovement)) throw new Error(`La cuenta de costo de ventas ${costAccountCode} no existe o no admite movimientos.`);
      if (isSupplierReturn && (!payableAccount || !payableAccount.isMovement)) throw new Error('Falta la cuenta de control de Cuentas por Pagar 2.1.1.01 para registrar la devolución al proveedor.');
      if (!isPositiveAdjustment && !isCustomerReturn && (!debitAccount || !debitAccount.isMovement)) throw new Error(`La cuenta de costo/ajuste ${debitCode} no existe o no admite movimientos.`);
      if (isPositiveAdjustment && (!adjustmentAccount || !adjustmentAccount.isMovement)) throw new Error(`La cuenta de contrapartida de ajuste ${adjustmentAccountCode} no existe o no admite movimientos.`);
      const amountBs = totalCostBs;
      const amountUsd = totalCostUsd;
      const items: JournalEntryItem[] = isPositiveAdjustment
        ? [makeLine(inventoryAccountCode, amountBs, 0, amountUsd, 0, 'Entrada por sobrante de inventario'), makeLine(adjustmentAccountCode, 0, amountBs, 0, amountUsd, 'Contrapartida por sobrante de inventario')]
        : isCustomerReturn
          ? [makeLine(inventoryAccountCode, amountBs, 0, amountUsd, 0, 'Entrada por devolución de cliente'), makeLine(costAccountCode, 0, amountBs, 0, amountUsd, 'Reversión del costo de ventas por devolución')]
          : isSupplierReturn
            ? [makeLine('2.1.1.01', amountBs, 0, amountUsd, 0, 'Devolución de mercancía al proveedor'), makeLine(inventoryAccountCode, 0, amountBs, 0, amountUsd, 'Salida por devolución de compra')]
            : [makeLine(debitCode, amountBs, 0, amountUsd, 0, isSale ? 'Costo de ventas según método de costeo' : 'Merma, faltante o ajuste de inventario'), makeLine(inventoryAccountCode, 0, amountBs, 0, amountUsd, 'Descargo de inventario')];
      const companyEntries = journalEntries.filter(e => e.companyId === currentCompany.id);
      generatedEntries.push({
        id: `entry-inventory-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
        companyId: currentCompany.id, entryNumber: companyEntries.reduce((max,e) => Math.max(max,e.entryNumber),0) + generatedEntries.length + 1,
        date: movData.date, description: `${isSale ? 'Costo de venta' : isCustomerReturn ? 'Devolución de cliente' : isSupplierReturn ? 'Devolución a proveedor' : isPositiveAdjustment ? 'Sobrante de inventario' : 'Ajuste/merma de inventario'}: ${prod.name} · ${movData.documentRef}`,
        type: 'INVENTARIO', bcvRate: rate, referenceDoc: movData.documentRef,
        items, createdAt: new Date().toISOString()
      });
    }
    if (generatedEntries.length > 0) newMov.journalEntryId = generatedEntries[0].id;
    generatedEntries.forEach(entry => reserveBankOutgoingAccounts(entry.companyId, entry.items));
    setMovements(prev => [...prev, newMov]);
    setProducts(prev => prev.map(p => p.id === prod.id ? {
      ...p, currentStock: newStock, avgCostBs: newAverageBs, avgCostUsd: newAverageUsd,
      lastCostBs: movData.type === 'ENTRADA' ? effectiveUnitCost : p.lastCostBs,
      lastCostUsd: movData.type === 'ENTRADA' ? effectiveUnitCost / rate : p.lastCostUsd
    } : p));
    if (generatedEntries.length > 0) setJournalEntries(prev => [...prev, ...generatedEntries]);
    return newMov;
  };


  const executeProduction = async (finishedProductId: string, outputQuantity: number, date: string, bcvRateInput: number, documentRef: string): Promise<InventoryMovement[]> => {
    if (productionInFlightRef.current) throw new Error('Ya hay una orden de producción en proceso. Espere a que SQLite confirme el resultado.');
    productionInFlightRef.current = true;
    try {
    if (persistenceFaultRef.current) throw new Error('La persistencia SQLite falló. SICOVEN bloqueó las operaciones; cierre y vuelva a abrir la aplicación.');
    if (window.sicovenStore && !storageReady) throw new Error('SQLite todavía no está lista.');
    const finished = products.find(p => p.id === finishedProductId && p.companyId === currentCompany.id);
    if (!finished || (finished.itemType !== 'PRODUCTO_TERMINADO' && finished.itemType !== 'PRODUCTO_EN_PROCESO')) throw new Error('Seleccione un producto terminado o en proceso válido.');
    if (![finished.currentStock, finished.avgCostBs, finished.avgCostUsd].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) {
      throw new Error('La existencia o el costo promedio del producto terminado no son válidos.');
    }
    if (!Number.isFinite(outputQuantity) || outputQuantity <= 0) throw new Error('La cantidad producida debe ser mayor que cero.');
    if (!Number.isFinite(bcvRateInput) || bcvRateInput <= 0) throw new Error('La tasa BCV histórica debe ser mayor que cero.');
    const parsedProductionDate = new Date(date + 'T00:00:00Z');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedProductionDate.getTime()) || parsedProductionDate.toISOString().slice(0,10) !== date) throw new Error('La fecha de producción no es válida.');
    const recipe = normalizeProductionRecipe(finished.bomComponents || [], finishedProductId);
    const productionReference = String(documentRef || '').trim();
    if (!productionReference) throw new Error('La orden de producción requiere una referencia única.');
    if (journalEntries.some(entry => entry.companyId === currentCompany.id &&
        entry.type === 'INVENTARIO' && String(entry.referenceDoc || '').trim().toUpperCase() === productionReference.toUpperCase()) ||
        movements.some(movement => movement.companyId === currentCompany.id &&
          movement.concept === 'PRODUCCION' && String(movement.documentRef || '').trim().toUpperCase() === productionReference.toUpperCase())) {
      throw new Error('La referencia de la orden de producción ya fue registrada.');
    }
    for (const productId of [finishedProductId, ...recipe.map(line => line.productId)]) {
      const latestMovementDate = movements.filter(movement =>
        movement.companyId === currentCompany.id && movement.productId === productId)
        .reduce((latest, movement) => movement.date > latest ? movement.date : latest, '');
      if (latestMovementDate && date < latestMovementDate) {
        throw new Error('La fecha de producción es anterior al último movimiento de Kardex del artículo ' + productId + '. Importe los períodos históricos en orden cronológico.');
      }
    }
    const rate = bcvRateInput;
    const wipAccount = accounts.find(a => a.code === '1.1.4.04' && a.isMovement);
    if (!wipAccount) throw new Error('Falta la cuenta contable de productos en proceso 1.1.4.04.');
    const movementsToAdd: InventoryMovement[] = [];
    const journalItems: JournalEntryItem[] = [];
    const productUpdates = new Map<string, InventoryProduct>();
    let totalProductionCostBs = 0;
    for (const line of recipe) {
      const component = products.find(p => p.id === line.productId && p.companyId === currentCompany.id);
      if (!component) throw new Error('Un componente de la matriz ya no existe en la empresa activa.');
      if (![component.currentStock, component.avgCostBs, component.avgCostUsd].every(value => Number.isFinite(Number(value)) && Number(value) >= 0)) {
        throw new Error('La existencia o el costo promedio del componente ' + component.code + ' no son válidos.');
      }
      if (component.itemType !== 'MATERIA_PRIMA' && component.itemType !== 'PRODUCTO_EN_PROCESO') {
        throw new Error('Los componentes de producción deben clasificarse como materia prima o producto en proceso: ' + component.code + '.');
      }
      if (component.itemType === 'PRODUCTO_EN_PROCESO' && component.inventoryAccountCode !== '1.1.4.04') throw new Error('El componente en proceso ' + component.code + ' debe estar asociado a la cuenta 1.1.4.04.');
      const requiredQuantity = Math.round(line.quantityPerUnit * outputQuantity * 1000000) / 1000000;
      if (!Number.isFinite(requiredQuantity) || requiredQuantity <= 0) throw new Error('La cantidad requerida para ' + component.code + ' no es válida.');
      if (requiredQuantity > component.currentStock + 1e-8) throw new Error('Existencia insuficiente de ' + component.code + ': disponibles ' + component.currentStock + ', requeridas ' + requiredQuantity + '.');
      let totalBs = 0;
      let componentNewAverageBs = component.avgCostBs;
      let componentNewAverageUsd = component.avgCostUsd;
      if (component.costingMethod === 'PEPS') {
        const history = movements.filter(m => m.companyId === currentCompany.id && m.productId === component.id);
        const layers = reconstructFifoLayers(history, component.currentStock);
        const availableLayers = layers.reduce((sum, layer) => sum + layer.quantity, 0);
        if (availableLayers < requiredQuantity - 1e-8) throw new Error('El Kardex PEPS no cubre la existencia disponible de ' + component.code + '.');
        const fifoLayerValue = layers.reduce((sum, layer) => sum + Math.max(0, layer.quantity) * layer.unitCostBs, 0);
        totalBs = calculateFifoIssue(layers, requiredQuantity).totalCostBs;
        const remainingQuantity = Math.max(0, component.currentStock - requiredQuantity);
        componentNewAverageBs = remainingQuantity > 0 ? Math.max(0, fifoLayerValue - totalBs) / remainingQuantity : 0;
        componentNewAverageUsd = componentNewAverageBs / rate;
      } else {
        totalBs = Math.round(requiredQuantity * component.avgCostBs * 100) / 100;
      }
      const unitCostBs = totalBs / requiredQuantity;
      totalProductionCostBs += totalBs;
      const inventoryCode = component.inventoryAccountCode || getDefaultInventoryAccountCode(component.itemType);
      const inventoryAccount = accounts.find(a => a.code === inventoryCode && a.isMovement);
      if (!inventoryAccount) throw new Error('La cuenta de inventario del componente ' + component.code + ' no es válida.');
      const movementId = 'mov-prod-consume-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
      const outMovement: InventoryMovement = {
        id: movementId, companyId: currentCompany.id, productId: component.id, productName: component.name, productCode: component.code,
        date, type: 'SALIDA', concept: 'PRODUCCION', documentRef: documentRef || ('PROD-' + Date.now()), documentType: 'Orden de producción',
        quantity: requiredQuantity, unitCostBs, unitCostUsd: unitCostBs / rate, totalCostBs: totalBs, totalCostUsd: totalBs / rate,
        balanceQty: Math.max(0, component.currentStock - requiredQuantity),
        balanceTotalBs: Math.round(Math.max(0, component.currentStock - requiredQuantity) * componentNewAverageBs * 100) / 100,
        balanceTotalUsd: Math.round(Math.max(0, component.currentStock - requiredQuantity) * componentNewAverageUsd * 1000000) / 1000000,
        bcvRate: rate, costingMethod: component.costingMethod
      };
      movementsToAdd.push(outMovement);
      journalItems.push(
        { accountCode: wipAccount.code, accountName: wipAccount.name, debitBs: totalBs, creditBs: 0, debitUsd: totalBs / rate, creditUsd: 0, description: 'Consumo en producción: ' + component.code },
        { accountCode: inventoryAccount.code, accountName: inventoryAccount.name, debitBs: 0, creditBs: totalBs, debitUsd: 0, creditUsd: totalBs / rate, description: 'Salida de materia prima: ' + component.code }
      );
      productUpdates.set(component.id, { ...component, currentStock: Math.max(0, component.currentStock - requiredQuantity), avgCostBs: componentNewAverageBs, avgCostUsd: componentNewAverageUsd });
    }
    totalProductionCostBs = Math.round(totalProductionCostBs * 100) / 100;
    const productionUnitCostBs = totalProductionCostBs / outputQuantity;
    const weightedFinished = calculateWeightedAverageCost(finished.currentStock, finished.avgCostBs, outputQuantity, productionUnitCostBs, rate);
    const finishedInventoryCode = finished.inventoryAccountCode || getDefaultInventoryAccountCode(finished.itemType);
    const finishedInventoryAccount = accounts.find(a => a.code === finishedInventoryCode && a.isMovement);
    if (!finishedInventoryAccount) throw new Error('La cuenta de inventario del producto terminado no es válida.');
    if (finished.itemType === 'PRODUCTO_EN_PROCESO' && finishedInventoryCode !== '1.1.4.04') throw new Error('El producto en proceso debe estar asociado a la cuenta 1.1.4.04.');
    const totalFinishedBs = Math.round(outputQuantity * productionUnitCostBs * 100) / 100;
    if (finished.itemType !== 'PRODUCTO_EN_PROCESO') {
      journalItems.push(
        { accountCode: finishedInventoryAccount.code, accountName: finishedInventoryAccount.name, debitBs: totalFinishedBs, creditBs: 0, debitUsd: totalFinishedBs / rate, creditUsd: 0, description: 'Entrada de producto terminado: ' + finished.code },
        { accountCode: wipAccount.code, accountName: wipAccount.name, debitBs: 0, creditBs: totalFinishedBs, debitUsd: 0, creditUsd: totalFinishedBs / rate, description: 'Transferencia de producción terminada: ' + finished.code }
      );
    }
    const entry = addJournalEntry({
      entryNumber: 0, date, description: 'Orden de producción ' + (documentRef || '') + ' · ' + finished.code,
      type: 'INVENTARIO', bcvRate: rate, referenceDoc: documentRef || ('PROD-' + Date.now()), items: journalItems
    });
    for (const movement of movementsToAdd) movement.journalEntryId = entry.id;
    const finishedMovement: InventoryMovement = {
      id: 'mov-prod-finished-' + Date.now(), companyId: currentCompany.id, productId: finished.id, productName: finished.name, productCode: finished.code,
      date, type: 'ENTRADA', concept: 'PRODUCCION', documentRef: entry.referenceDoc || '', documentType: 'Orden de producción',
      quantity: outputQuantity, unitCostBs: productionUnitCostBs, unitCostUsd: productionUnitCostBs / rate,
      totalCostBs: totalFinishedBs, totalCostUsd: totalFinishedBs / rate, balanceQty: weightedFinished.quantity,
      balanceTotalBs: weightedFinished.totalCostBs, balanceTotalUsd: weightedFinished.totalCostUsd,
      bcvRate: rate, costingMethod: finished.costingMethod, journalEntryId: entry.id
    };
    movementsToAdd.push(finishedMovement);
    productUpdates.set(finished.id, {
      ...finished, currentStock: weightedFinished.quantity, avgCostBs: weightedFinished.unitCostBs,
      avgCostUsd: weightedFinished.unitCostUsd, lastCostBs: productionUnitCostBs, lastCostUsd: productionUnitCostBs / rate
    });
    const persistenceConfirmation = waitForPersistence();
    setProducts(prev => prev.map(product => productUpdates.get(product.id) || product));
    setMovements(prev => [...prev, ...movementsToAdd]);
    await persistenceConfirmation;
    return movementsToAdd;
    } finally {
      productionInFlightRef.current = false;
    }
  };

  const createVatWithholdingDeclaration = async (input: {
    year: number; month: number; window: VatDeclarationWindow; zeroOperations?: boolean;
    legacyFiscalDates?: Record<string, { fiscalDate: string; note: string }>;
  }): Promise<VatWithholdingDeclaration> => {
    assertSQLitePersistenceReady('Crear declaración de retenciones IVA');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se creó la declaración.');
    }
    if (!currentCompany.id) throw new Error('Seleccione una empresa antes de preparar la declaración.');
    const creationKey = [currentCompany.id, input.year, input.month, input.window].join(':');
    if (vatDeclarationCreationInFlightRef.current.has(creationKey)) {
      throw new Error('Ya se está preparando una declaración para esa empresa y quincena. Espere la confirmación de SQLite.');
    }
    vatDeclarationCreationInFlightRef.current.add(creationKey);
    try {
      const declaration = buildVatWithholdingDeclaration({
        id: 'vat-decl-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
        companyId: currentCompany.id,
        year: input.year, month: input.month, window: input.window,
        vouchers: vatVouchers.filter(item => item.companyId === currentCompany.id),
        existingDeclarations: vatWithholdingDeclarations,
        createdAt: new Date().toISOString(),
        zeroOperations: input.zeroOperations,
        legacyFiscalDates: input.legacyFiscalDates
      });
      const confirmation = waitForPersistence();
      setVatWithholdingDeclarations(prev => [...prev, declaration]);
      await confirmation;
      return declaration;
    } finally {
      vatDeclarationCreationInFlightRef.current.delete(creationKey);
    }
  };

  const recordVatWithholdingDeclarationEvent = async (
    declarationId: string,
    draft: Omit<VatWithholdingDeclarationEvent, 'id' | 'declarationId' | 'recordedAt'>
  ): Promise<VatWithholdingDeclarationEvent> => {
    assertSQLitePersistenceReady('Registrar evento de declaración IVA');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se registró el evento fiscal.');
    }
    const declaration = vatWithholdingDeclarations.find(item =>
      item.id === declarationId && item.companyId === currentCompany.id);
    if (!declaration) throw new Error('No se encontró la declaración de la empresa activa.');
    const history = vatWithholdingDeclarationEvents.filter(item => item.declarationId === declarationId);
    if (draft.eventType === 'REVIEWED' && declaration.voucherIds.some(id =>
      vatVouchers.some(voucher => voucher.id === id && voucher.requiresFiscalCorrection))) {
      throw new Error('No se puede revisar: uno o más comprobantes incluidos tienen una corrección fiscal pendiente.');
    }
    if (draft.eventType === 'FILED' && vatWithholdingDeclarationEvents.some(event =>
      event.eventType === 'FILED' && event.declarationNumber === draft.declarationNumber &&
      vatWithholdingDeclarations.some(item => item.id === event.declarationId && item.companyId === currentCompany.id))) {
      throw new Error('Ese número de declaración ya fue registrado para la empresa activa.');
    }
    validateVatDeclarationEventDraft(declaration, history, draft);
    validateVatPaymentBankLinks({ companyId: currentCompany.id, declaration, draft, events: vatWithholdingDeclarationEvents, bankAccounts, bankMovements: bankStatementMovements });
    // Serializa todos los eventos de una declaración hasta confirmar SQLite.
    // Así REVIEWED/FILED/PAYMENT no pueden competir usando el mismo historial React.
    // Los débitos también se bloquean globalmente para impedir su reutilización
    // simultánea entre declaraciones distintas.
    const paymentLockKeys = [
      'declaration-event:' + declarationId,
      ...(draft.eventType === 'PAYMENT'
        ? (draft.bankStatementMovementIds || []).map(id => 'bank-movement:' + id)
        : [])
    ];
    if (paymentLockKeys.some(key => vatPaymentInFlightRef.current.has(key))) {
      throw new Error('Ya hay un evento fiscal en proceso para esta declaración o uno de los débitos bancarios seleccionados. Espere la confirmación de SQLite.');
    }
    paymentLockKeys.forEach(key => vatPaymentInFlightRef.current.add(key));
    let resolvePersistence!: () => void;
    let rejectPersistence!: (error: Error) => void;
    const confirmation = new Promise<void>((resolve, reject) => {
      resolvePersistence = resolve;
      rejectPersistence = reject;
    });
    const persistenceWaiter = { resolve: resolvePersistence, reject: rejectPersistence };
    persistenceWaitersRef.current.push(persistenceWaiter);
    let journalEntry: JournalEntry | undefined;
    let paymentMovements: BankStatementMovement[] = [];
    try {
    if (draft.eventType === 'PAYMENT') {
      paymentMovements = (draft.bankStatementMovementIds || []).map(id =>
        bankStatementMovements.find(item => item.id === id)!).filter(Boolean);
      const priorPayments = history.filter(event => event.eventType === 'PAYMENT');
      const priorPaidBs = priorPayments.reduce((sum, event) => sum + Number(event.amountBs || 0), 0);
      const plan = buildVatPaymentAccountingPlan({
        occurredAt: draft.occurredAt,
        amountBs: Number(draft.amountBs),
        priorPaidBs,
        declaration,
        movements: paymentMovements,
        bankAccounts: bankAccounts.filter(item => item.companyId === currentCompany.id),
        accounts
      });
      const referenceDoc = 'IVA-ENTERAMIENTO:' + declaration.id + ':' + String(draft.paymentReference || '').trim();
      if (journalEntries.some(entry => entry.companyId === currentCompany.id && entry.referenceDoc === referenceDoc)) {
        throw new Error('Ya existe un asiento contable para esta referencia de enteramiento IVA.');
      }
      journalEntry = addJournalEntry({
        entryNumber: 0,
        date: plan.date,
        description: 'Enteramiento de retenciones de IVA · Declaración ' + declaration.period,
        type: 'RETENCION_IVA',
        bcvRate: plan.bcvRate,
        referenceDoc,
        items: plan.items
      });
    }
    const event: VatWithholdingDeclarationEvent = {
      ...draft,
      ...(journalEntry ? { journalEntryId: journalEntry.id } : {}),
      id: 'vat-decl-event-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
      declarationId,
      recordedAt: new Date().toISOString()
    };
    // One SQLite snapshot persists the journal, fiscal event and bank movement links together.
    setVatWithholdingDeclarationEvents(prev => [...prev, event]);
    if (journalEntry) {
      const linkedIds = new Set(paymentMovements.map(item => item.id));
      setBankStatementMovements(prev => prev.map(movement =>
        linkedIds.has(movement.id) && movement.companyId === currentCompany.id
          ? {
              ...movement,
              isReconciled: true,
              matchedBy: 'MANUAL',
              reconciledWithJournalEntryId: journalEntry!.id,
              reconciledJournalEntryIds: [...new Set([...(movement.reconciledJournalEntryIds || []), journalEntry!.id])],
              reconciledAt: new Date().toISOString()
            }
          : movement
      ));
    }
    await confirmation;
    return event;
    } catch (error) {
      persistenceWaitersRef.current = persistenceWaitersRef.current.filter(waiter => waiter !== persistenceWaiter);
      throw error;
    } finally {
      paymentLockKeys.forEach(key => vatPaymentInFlightRef.current.delete(key));
    }
  };

  const recordVatVoucherDelivery = async (
    id: string,
    draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }
  ): Promise<VatRetentionVoucher> => {
    assertSQLitePersistenceReady('Registrar entrega de comprobante IVA');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se registró la entrega.');
    }
    const voucher = vatVouchers.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!voucher) throw new Error('No se encontró el comprobante de la empresa activa.');
    if (voucher.deliveryDate || voucher.deliveryMethod) {
      throw new Error('La entrega de este comprobante ya fue registrada y no puede sobrescribirse.');
    }
    if (!isValidIsoDate(draft.deliveryDate) || draft.deliveryDate < voucher.date) {
      throw new Error('La fecha de entrega debe ser válida y no puede ser anterior a la emisión del comprobante.');
    }
    if (draft.deliveryMethod !== 'PHYSICAL' && draft.deliveryMethod !== 'ELECTRONIC') {
      throw new Error('Seleccione un medio de entrega válido.');
    }
    if (draft.deliveryMethod === 'ELECTRONIC' && draft.electronicDeliveryAgreed !== true) {
      throw new Error('La entrega electrónica requiere acuerdo previo con el proveedor.');
    }
    const updated: VatRetentionVoucher = {
      ...voucher,
      deliveryDate: draft.deliveryDate,
      deliveryMethod: draft.deliveryMethod,
      ...(draft.deliveryMethod === 'ELECTRONIC' ? { electronicDeliveryAgreed: true } : {})
    };
    const confirmation = waitForPersistence();
    setVatVouchers(prev => prev.map(item => item.id === id ? updated : item));
    await confirmation;
    return updated;
  };

  const deleteVatVoucher = (id: string) => {
    const voucher = vatVouchers.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!voucher) return;
    if (typeof window !== 'undefined') window.alert('El comprobante de retención de IVA es un soporte fiscal histórico y no puede eliminarse. Registre la corrección mediante el procedimiento fiscal correspondiente.');
  };

  const recordIslrVoucherDelivery = async (
    id: string,
    draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }
  ): Promise<IslrRetentionVoucher> => {
    assertSQLitePersistenceReady('Registrar entrega de comprobante ISLR');
    if (persistenceFaultRef.current || (window.sicovenStore && !storageReady)) {
      throw new Error('SQLite no está disponible o todavía no está lista. No se registró la entrega.');
    }
    const voucher = islrVouchers.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!voucher) throw new Error('No se encontró el comprobante ISLR de la empresa activa.');
    if (voucher.deliveryDate || voucher.deliveryMethod) {
      throw new Error('La entrega de este comprobante ya fue registrada y no puede sobrescribirse.');
    }
    if (!isValidIsoDate(draft.deliveryDate) || draft.deliveryDate < voucher.date) {
      throw new Error('La fecha de entrega debe ser válida y no puede ser anterior a la emisión del comprobante.');
    }
    if (draft.deliveryMethod !== 'PHYSICAL' && draft.deliveryMethod !== 'ELECTRONIC') {
      throw new Error('Seleccione un medio de entrega válido.');
    }
    if (draft.deliveryMethod === 'ELECTRONIC' && draft.electronicDeliveryAgreed !== true) {
      throw new Error('La entrega electrónica requiere acuerdo previo con el proveedor.');
    }
    const updated: IslrRetentionVoucher = {
      ...voucher,
      deliveryDate: draft.deliveryDate,
      deliveryMethod: draft.deliveryMethod,
      ...(draft.deliveryMethod === 'ELECTRONIC' ? { electronicDeliveryAgreed: true } : {})
    };
    const confirmation = waitForPersistence();
    setIslrVouchers(prev => prev.map(item => item.id === id ? updated : item));
    await confirmation;
    return updated;
  };

  const deleteIslrVoucher = (id: string) => {
    const voucher = islrVouchers.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!voucher) return;
    if (typeof window !== 'undefined') window.alert('El comprobante de retención de ISLR es un soporte fiscal histórico y no puede eliminarse. Registre la corrección mediante el procedimiento fiscal correspondiente.');
  };

  // Tesorería: alta bancaria y creación automática del auxiliar contable.
  const addBankAccount = (bankData: Omit<BankAccount, 'id' | 'companyId' | 'accountCode'> & { bcvRate?: number }): BankAccount => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('Registrar una cuenta bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    if (!currentCompany.id) throw new Error('Registre o seleccione una empresa antes de crear cuentas bancarias.');
    const digits = String(bankData.accountNumber || '').replace(/\D/g, '');
    if (digits.length !== 20) throw new Error('El número de cuenta bancaria debe contener exactamente 20 dígitos.');
    if (!bankData.bankName?.trim()) throw new Error('Indique el nombre del banco.');
    if (bankData.currency !== 'BS' && bankData.currency !== 'USD') throw new Error('La moneda bancaria debe ser Bs. o USD.');
    const accountType = bankData.accountType ?? 'CORRIENTE';
    if (accountType !== 'CORRIENTE' && accountType !== 'AHORRO') throw new Error('Seleccione un tipo de cuenta bancaria válido.');
    if (bankAccounts.some(b => b.companyId === currentCompany.id && b.accountNumber.replace(/\D/g, '') === digits)) {
      throw new Error('Ya existe una cuenta bancaria con ese número en la empresa activa.');
    }

    const rawBs = Number(bankData.initialBalanceBs ?? 0);
    const rawUsd = Number(bankData.initialBalanceUsd ?? 0);
    if (!Number.isFinite(rawBs) || !Number.isFinite(rawUsd) || rawBs < 0 || rawUsd < 0) {
      throw new Error('El saldo inicial debe ser un importe numérico, finito y no negativo.');
    }
    const hasOpeningBalance = bankData.currency === 'USD' ? rawUsd > 0 : rawBs > 0;
    const rate = Number(bankData.bcvRate);
    if (hasOpeningBalance && (!Number.isFinite(rate) || rate <= 0)) throw new Error('Ingrese la tasa BCV aplicable al saldo inicial de esta cuenta.');

    // El importe introducido en la moneda de la cuenta es la autoridad; la otra
    // moneda se calcula con la tasa BCV para evitar saldos de apertura incoherentes.
    const bs = bankData.currency === 'USD'
      ? Math.round(rawUsd * rate * 100) / 100
      : Math.round(rawBs * 100) / 100;
    const usd = bankData.currency === 'USD'
      ? Math.round(rawUsd * 1000000) / 1000000
      : (rate > 0 ? Math.round((bs / rate) * 1000000) / 1000000 : 0);

    const { parent, auxiliary: newAux, accounts: accountsWithAux } = buildBankAuxiliaryAccounts(
      accounts, bankData.currency, bankData.bankName.trim(), accountType
    );
    const accountCode = newAux.code;
    const auxName = newAux.name;
    const equity = hasOpeningBalance ? accounts.find(a => a.code === '3.3.1.01' && a.isMovement) : undefined;
    if (hasOpeningBalance && !equity) throw new Error('No existe la cuenta de contrapartida de apertura 3.3.1.01.');

    const { bcvRate: _openingBcvRate, ...bankFields } = bankData;
    const newBank: BankAccount = { ...bankFields, accountType, accountCode, accountNumber: digits, initialBalanceBs: bs, initialBalanceUsd: usd, id: `bank-acc-${Date.now()}-${Math.floor(Math.random()*100000)}`, companyId: currentCompany.id };
    // La validación del asiento debe reconocer el auxiliar recién generado.
    // Se valida contra el catálogo proyectado y luego se guardan ambos estados juntos.
    if (hasOpeningBalance && equity) {
      addJournalEntry({
        entryNumber: 0, date: (() => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); })(),
        description: `Apertura de cuenta bancaria: ${auxName}`, type: 'APERTURA', bcvRate: rate,
        referenceDoc: `APERTURA-${digits}`,
        items: [
          { accountCode, accountName: auxName, debitBs: bs, creditBs: 0, debitUsd: usd, creditUsd: 0, description: 'Saldo inicial de tesorería' },
          { accountCode: equity.code, accountName: equity.name, debitBs: 0, creditBs: bs, debitUsd: 0, creditUsd: usd, description: 'Contrapartida saldo inicial de tesorería' }
        ]
      }, accountsWithAux);
    }
    setAccounts(prev => [...prev.filter(a => a.code !== parent.code && a.code !== newAux.code), parent, newAux].sort((a,b)=>a.code.localeCompare(b.code,undefined,{numeric:true})));
    setBankAccounts(prev => [...prev, newBank]);
    return newBank;
  };

  const registerTreasuryMovement = (draft: { bankAccountId: string; date: string; reference: string; description: string; type: 'INCOME' | 'EXPENSE' | 'TRANSFER'; amount: number; bcvRate: number; counterpartAccountCode?: string; destinationBankAccountId?: string }): JournalEntry => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    const source = bankAccounts.find(b => b.id === draft.bankAccountId && b.companyId === currentCompany.id);
    if (!source) throw new Error('Seleccione una cuenta bancaria de la empresa activa.');
    const parsedDate = new Date(draft.date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== draft.date) throw new Error('La fecha del movimiento no es válida.');
    if (!draft.reference?.trim() || !draft.description?.trim()) throw new Error('La referencia y el concepto son obligatorios.');
    if (!['INCOME', 'EXPENSE', 'TRANSFER'].includes(draft.type)) throw new Error('El tipo de movimiento no es válido.');
    if (!Number.isFinite(draft.amount) || draft.amount <= 0) throw new Error('El importe debe ser mayor que cero.');
    const normalizedReference = draft.reference.trim().toLocaleLowerCase();
    const destinationForTransfer = draft.type === 'TRANSFER'
      ? bankAccounts.find(b => b.id === draft.destinationBankAccountId && b.companyId === currentCompany.id)
      : undefined;
    const duplicatedReference = journalEntries.some(entry =>
      entry.companyId === currentCompany.id &&
      entry.referenceDoc?.trim().toLocaleLowerCase() === normalizedReference &&
      entry.items.some(item =>
        item.accountCode === source.accountCode ||
        (destinationForTransfer !== undefined && item.accountCode === destinationForTransfer.accountCode)
      )
    );
    if (duplicatedReference) throw new Error('Ya existe un movimiento contabilizado con esa referencia para una de las cuentas bancarias involucradas.');
    const rate = Number(draft.bcvRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Ingrese la tasa BCV aplicable a este movimiento bancario.');
    const amountBs = source.currency === 'USD' ? Math.round(draft.amount * rate * 100) / 100 : Math.round(draft.amount * 100) / 100;
    const amountUsd = source.currency === 'USD' ? Math.round(draft.amount * 1000000) / 1000000 : Math.round(amountBs / rate * 1000000) / 1000000;
    if (amountBs <= 0 || amountUsd <= 0) throw new Error('El importe es demasiado pequeño para contabilizarse en ambas monedas.');
    const bankAccount = accounts.find(a => a.code === source.accountCode && a.isMovement);
    if (!bankAccount) throw new Error('La cuenta auxiliar del banco no existe o no admite movimientos.');
    if (draft.type === 'EXPENSE' || draft.type === 'TRANSFER') {
      const availableBalance = calculateBankAvailableBalance({
        bankAccount: source,
        companyId: currentCompany.id,
        asOfDate: draft.date,
        journalEntries
      });
      const requestedAmount = source.currency === 'USD'
        ? Math.round(draft.amount * 1000000) / 1000000
        : Math.round(draft.amount * 100) / 100;
      validateBankOutgoingAvailability({
        availableBalance,
        requestedAmount,
        currency: source.currency
      });
    }
    let items: JournalEntryItem[];
    if (draft.type === 'TRANSFER') {
      const destination = destinationForTransfer;
      if (!destination || destination.id === source.id) throw new Error('Seleccione otra cuenta bancaria propia como destino.');
      if (destination.currency !== source.currency) {
        throw new Error('La transferencia directa entre cuentas de monedas distintas está bloqueada para evitar asientos descuadrados. Registre la operación cambiaria con su tasa y diferencia cambiaria documentadas antes de transferir entre monedas.');
      }
      const destAccount = accounts.find(a => a.code === destination.accountCode && a.isMovement);
      if (!destAccount) throw new Error('La cuenta auxiliar bancaria de destino no es válida.');
      const destBs = destination.currency === 'USD' ? Math.round(amountUsd * rate * 100) / 100 : amountBs;
      const destUsd = destination.currency === 'USD' ? amountUsd : Math.round(destBs / rate * 1000000) / 1000000;
      items = [
        { accountCode: destAccount.code, accountName: destAccount.name, debitBs: destBs, creditBs: 0, debitUsd: destUsd, creditUsd: 0, description: 'Entrada por transferencia entre cuentas propias' },
        { accountCode: bankAccount.code, accountName: bankAccount.name, debitBs: 0, creditBs: amountBs, debitUsd: 0, creditUsd: amountUsd, description: 'Salida por transferencia entre cuentas propias' }
      ];
    } else {
      const bankAccountCodes = new Set(bankAccounts.map(bank => bank.accountCode));
      const counterpart = accounts.find(a => a.code === draft.counterpartAccountCode && a.isMovement && a.code !== bankAccount.code && !bankAccountCodes.has(a.code));
      if (!counterpart) throw new Error('Seleccione una cuenta contable de movimiento válida que no sea una cuenta bancaria. Para mover fondos entre bancos, use Transferencia.');
      items = draft.type === 'INCOME'
        ? [
            { accountCode: bankAccount.code, accountName: bankAccount.name, debitBs: amountBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0, description: draft.description.trim() },
            { accountCode: counterpart.code, accountName: counterpart.name, debitBs: 0, creditBs: amountBs, debitUsd: 0, creditUsd: amountUsd, description: draft.description.trim() }
          ]
        : [
            { accountCode: counterpart.code, accountName: counterpart.name, debitBs: amountBs, creditBs: 0, debitUsd: amountUsd, creditUsd: 0, description: draft.description.trim() },
            { accountCode: bankAccount.code, accountName: bankAccount.name, debitBs: 0, creditBs: amountBs, debitUsd: 0, creditUsd: amountUsd, description: draft.description.trim() }
          ];
    }
    const entry = addJournalEntry({
      entryNumber: 0, date: draft.date, description: draft.description.trim(), type: 'MANUAL', bcvRate: rate,
      referenceDoc: draft.reference.trim(), items
    });
    return entry;
  };

  const addBankStatementMovement = (movData: Omit<BankStatementMovement, 'id' | 'companyId'>): BankStatementMovement => {
    if (bankStatementImportInFlightRef.current) {
      throw new Error('Hay otra operación de extracto bancario pendiente de confirmación SQLite. Espere antes de agregar otro movimiento.');
    }
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('Registrar movimientos de extracto requiere SQLite local de escritorio disponible y lista.');
    }
    bankStatementImportInFlightRef.current = true;
    try {
    const bank = bankAccounts.find(item =>
      item.id === movData.bankAccountId && item.companyId === currentCompany.id
    );
    if (!bank) throw new Error('Seleccione una cuenta bancaria de la empresa activa.');
    const parsedDate = new Date(movData.date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(movData.date) ||
        !Number.isFinite(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== movData.date) {
      throw new Error('La fecha del movimiento bancario no es válida.');
    }
    if (movData.type !== 'DEBIT' && movData.type !== 'CREDIT') {
      throw new Error('La naturaleza del movimiento bancario debe ser débito o crédito.');
    }
    if (!movData.reference?.trim() || !movData.description?.trim()) {
      throw new Error('La referencia y la descripción del movimiento bancario son obligatorias.');
    }
    const amountBs = Number(movData.amountBs);
    const amountUsd = Number(movData.amountUsd);
    // La contabilidad de SICOVEN valida cada asiento en Bs y USD. Guardar
    // cero en la moneda equivalente permite importar el movimiento, pero luego
    // impide generar un ajuste de conciliación válido en partida doble.
    validateBankMovementFxSnapshot({
      date: movData.date,
      amountBs,
      amountUsd,
      bcvRate: Number(movData.bcvRate),
      bcvRateEffectiveDate: movData.bcvRateEffectiveDate
    });
    if (isDuplicateBankStatementMovement({
      existing: bankStatementMovements.filter(item =>
        item.companyId === currentCompany.id && item.bankAccountId === bank.id
      ),
      candidate: {
        bankAccountId: bank.id,
        date: movData.date,
        reference: movData.reference,
        type: movData.type,
        amountBs,
        amountUsd
      }
    })) {
      throw new Error('Este movimiento ya existe en el extracto de esta cuenta (misma fecha, referencia, naturaleza e importes). No se agregó otra fila.');
    }
    const newMov: BankStatementMovement = {
      ...movData,
      bcvRate: Number(movData.bcvRate),
      bcvRateEffectiveDate: String(movData.bcvRateEffectiveDate || ''),
      amountBs: Math.round(amountBs * 100) / 100,
      amountUsd: Math.round(amountUsd * 1000000) / 1000000,
      id: `stmt-${Date.now()}-${Math.floor(Math.random() * 1000000)}`,
      companyId: currentCompany.id,
      isReconciled: false,
      matchedBy: undefined,
      reconciledWithJournalEntryId: undefined,
      reconciledAt: undefined
    };
    const releaseStatementMutation = (): void => { bankStatementImportInFlightRef.current = false; };
    persistenceWaitersRef.current.push({ resolve: releaseStatementMutation, reject: releaseStatementMutation });
    setBankStatementMovements(prev => [...prev, newMov]);
    return newMov;
    } catch (error) {
      bankStatementImportInFlightRef.current = false;
      throw error;
    }
  };

  const addBankStatementMovements = async (movements: Array<{ bankAccountId: string; date: string; reference: string; description: string; type: 'DEBIT' | 'CREDIT'; amountBs: number; amountUsd: number; bcvRate: number; bcvRateEffectiveDate: string }>): Promise<BankStatementMovement[]> => {
    if (bankStatementImportInFlightRef.current) throw new Error('Ya hay una importación bancaria en curso. Espere su confirmación SQLite.');
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('Importar movimientos requiere SQLite local de escritorio disponible y lista.');
    }
    if (!Array.isArray(movements) || movements.length === 0) throw new Error('No hay movimientos válidos para importar.');
    bankStatementImportInFlightRef.current = true;
    try {
    const bankAccountId = movements[0].bankAccountId;
    const bank = bankAccounts.find(item => item.id === bankAccountId && item.companyId === currentCompany.id);
    if (!bank || movements.some(item => item.bankAccountId !== bankAccountId)) {
      throw new Error('La importación debe pertenecer a una sola cuenta bancaria de la empresa activa.');
    }
    const staged: BankStatementMovement[] = [];
    for (const item of movements) {
      if (!isValidIsoDate(item.date) || !['DEBIT', 'CREDIT'].includes(item.type) ||
          !item.reference?.trim() || !item.description?.trim()) {
        throw new Error('La importación contiene fecha, naturaleza, referencia o descripción inválida.');
      }
      const amountBs = Number(item.amountBs), amountUsd = Number(item.amountUsd), bcvRate = Number(item.bcvRate);
      validateBankMovementFxSnapshot({
        date: item.date, amountBs, amountUsd, bcvRate,
        bcvRateEffectiveDate: item.bcvRateEffectiveDate
      });
      const candidate = {
        bankAccountId: bank.id, date: item.date, reference: item.reference,
        type: item.type, amountBs, amountUsd
      };
      if (isDuplicateBankStatementMovement({
        existing: [
          ...bankStatementMovements.filter(row => row.companyId === currentCompany.id && row.bankAccountId === bank.id),
          ...staged
        ],
        candidate
      })) {
        throw new Error(`La fila ${item.reference} está duplicada en el extracto existente o en el archivo. No se importó ninguna fila.`);
      }
      staged.push({
        ...item,
        bcvRate,
        amountBs: Math.round(amountBs * 100) / 100,
        amountUsd: Math.round(amountUsd * 1_000_000) / 1_000_000,
        id: `stmt-import-${Date.now()}-${staged.length}-${Math.floor(Math.random() * 1000000)}`,
        companyId: currentCompany.id,
        isReconciled: false,
        matchedBy: undefined,
        reconciledWithJournalEntryId: undefined,
        reconciledAt: undefined
      });
    }
    setBankStatementMovements(previous => [...previous, ...staged]);
    await waitForPersistence();
    return staged;
    } finally {
      bankStatementImportInFlightRef.current = false;
    }
  };

  const deleteBankStatementMovement = (id: string) => {
    const movement = bankStatementMovements.find(item => item.id === id && item.companyId === currentCompany.id);
    if (!movement) return;
    if (typeof window !== 'undefined') {
      window.alert('Los movimientos importados del extracto bancario se conservan como soporte histórico. Si existe un error, documente la incidencia y mantenga la fila como soporte histórico; no se permite borrarla.');
    }
  };

  const reconcileMovementManual = (statementMovementId: string, journalEntryId: string) => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    
    if (!journalEntryId?.trim()) throw new Error('Seleccione un asiento del Libro Diario antes de marcar el movimiento como conciliado.');
    const statement = bankStatementMovements.find(m =>
      m.id === statementMovementId && m.companyId === currentCompany.id
    );
    if (!statement) throw new Error('El movimiento bancario no pertenece a la empresa activa o ya no existe.');
    if (statement.isReconciled) throw new Error('El movimiento ya está conciliado. Desconcílielo antes de vincularlo nuevamente.');

    {
      const statementBank = bankAccounts.find(bank =>
        bank.id === statement.bankAccountId && bank.companyId === currentCompany.id
      );
      if (!statementBank) throw new Error('La cuenta bancaria del movimiento ya no existe en la empresa activa.');

      const linkedEntry = journalEntries.find(entry =>
        entry.id === journalEntryId && entry.companyId === currentCompany.id
      );
      if (!linkedEntry) throw new Error('El asiento seleccionado no pertenece a la empresa activa.');

      const alreadyUsed = bankStatementMovements.some(m =>
        m.id !== statement.id &&
        m.companyId === currentCompany.id &&
        m.bankAccountId === statement.bankAccountId &&
        m.isReconciled &&
        m.reconciledWithJournalEntryId === journalEntryId
      );
      if (alreadyUsed) throw new Error('Ese asiento ya está vinculado a otro movimiento conciliado de esta cuenta bancaria.');

      if (linkedEntry.date !== statement.date) {
        throw new Error('El asiento seleccionado debe tener la misma fecha del movimiento del extracto bancario.');
      }
      const hasExactBankLine = linkedEntry.items.some(item =>
        item.accountCode === statementBank.accountCode && matchesBankStatementDualCurrency({
          movementType: statement.type,
          amountBs: Number(statement.amountBs),
          amountUsd: Number(statement.amountUsd),
          debitBs: Number(item.debitBs),
          creditBs: Number(item.creditBs),
          debitUsd: Number(item.debitUsd),
          creditUsd: Number(item.creditUsd)
        })
      );
      if (!hasExactBankLine) {
        throw new Error('El asiento no coincide con la cuenta, el importe y la naturaleza débito/crédito del movimiento bancario.');
      }
    }

    setBankStatementMovements(prev =>
      prev.map(m =>
        m.id === statementMovementId && m.companyId === currentCompany.id
          ? {
              ...m,
              isReconciled: true,
              matchedBy: 'MANUAL',
              reconciledWithJournalEntryId: journalEntryId,
              reconciledJournalEntryIds: [...new Set([...(m.reconciledJournalEntryIds || []), journalEntryId])],
              reconciledAt: new Date().toISOString()
            }
          : m
      )
    );
  };

  const unreconcileMovement = (statementMovementId: string) => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    
    setBankStatementMovements(prev =>
      prev.map(m =>
        m.id === statementMovementId && m.companyId === currentCompany.id
          ? {
              ...m,
              isReconciled: false,
              matchedBy: undefined,
              reconciledJournalEntryIds: m.reconciledWithJournalEntryId
                ? [...new Set([...(m.reconciledJournalEntryIds || []), m.reconciledWithJournalEntryId])]
                : m.reconciledJournalEntryIds,
              reconciledWithJournalEntryId: undefined,
              reconciledAt: undefined
            }
          : m
      )
    );
  };

  const unreconcileAll = (bankAccountId: string) => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    
    setBankStatementMovements(prev =>
      prev.map(m =>
        m.companyId === currentCompany.id && m.bankAccountId === bankAccountId
          ? {
              ...m,
              isReconciled: false,
              matchedBy: undefined,
              reconciledJournalEntryIds: m.reconciledWithJournalEntryId
                ? [...new Set([...(m.reconciledJournalEntryIds || []), m.reconciledWithJournalEntryId])]
                : m.reconciledJournalEntryIds,
              reconciledWithJournalEntryId: undefined,
              reconciledAt: undefined
            }
          : m
      )
    );
  };

  const runAutoReconciliation = (bankAccountId: string): { matchedCount: number; matchedRefs: string[] } => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    const targetAccount = bankAccounts.find(b => b.id === bankAccountId && b.companyId === currentCompany.id);
    if (!targetAccount) return { matchedCount: 0, matchedRefs: [] };

    const bankCode = targetAccount.accountCode;
    const companyEntries = journalEntries.filter(e => e.companyId === currentCompany.id);
    const statementRows = bankStatementMovements.filter(
      m => m.companyId === currentCompany.id && m.bankAccountId === bankAccountId
    );
    const usedEntryIds = new Set<string>();
    statementRows.forEach(m => {
      if (m.isReconciled && m.reconciledWithJournalEntryId) usedEntryIds.add(m.reconciledWithJournalEntryId);
    });

    const updates = new Map<string, BankStatementMovement>();
    const matchedRefs: string[] = [];
    const now = new Date().toISOString();
    const matchesAmountAndNature = (stmt: BankStatementMovement, entry: JournalEntry) =>
      entry.date === stmt.date && entry.items.some(item =>
        item.accountCode === bankCode && matchesBankStatementDualCurrency({
          movementType: stmt.type,
          amountBs: Number(stmt.amountBs),
          amountUsd: Number(stmt.amountUsd),
          debitBs: Number(item.debitBs),
          creditBs: Number(item.creditBs),
          debitUsd: Number(item.debitUsd),
          creditUsd: Number(item.creditUsd)
        })
      );

    for (const stmt of statementRows) {
      if (stmt.isReconciled) continue;
      let matchedEntry: JournalEntry | undefined;
      let matchedBy: 'AUTO_REF' | 'AUTO_AMOUNT' = 'AUTO_AMOUNT';

      if (stmt.reference && stmt.reference !== '0') {
        const cleanRef = stmt.reference.trim().toLowerCase();
        const referenceCandidates = companyEntries.filter(entry => {
          if (usedEntryIds.has(entry.id) || !matchesAmountAndNature(stmt, entry)) return false;
          const entryRef = (entry.referenceDoc || '').trim().toLowerCase();
          const entryDesc = (entry.description || '').trim().toLowerCase();
          return Boolean((entryRef && (entryRef.includes(cleanRef) || cleanRef.includes(entryRef))) ||
            (entryDesc && entryDesc.includes(cleanRef)));
        });
        // Nunca decidir automáticamente entre dos asientos posibles.
        if (referenceCandidates.length === 1) {
          matchedEntry = referenceCandidates[0];
          matchedBy = 'AUTO_REF';
        } else if (referenceCandidates.length > 1) {
          continue;
        }
      }

      if (!matchedEntry) {
        const amountCandidates = companyEntries.filter(entry =>
          !usedEntryIds.has(entry.id) && matchesAmountAndNature(stmt, entry)
        );
        // Importe/fecha/naturaleza no bastan si hay más de un asiento candidato.
        if (amountCandidates.length !== 1) continue;
        matchedEntry = amountCandidates[0];
        matchedBy = 'AUTO_AMOUNT';
      }

      if (!matchedEntry) continue;
      usedEntryIds.add(matchedEntry.id);
      matchedRefs.push(stmt.reference || `Bs. ${stmt.amountBs}`);
      updates.set(stmt.id, {
        ...stmt,
        isReconciled: true,
        matchedBy,
        reconciledWithJournalEntryId: matchedEntry.id,
        reconciledJournalEntryIds: [...new Set([...(stmt.reconciledJournalEntryIds || []), matchedEntry.id])],
        reconciledAt: now
      });
    }

    if (updates.size > 0) {
      setBankStatementMovements(prev => prev.map(m => updates.get(m.id) || m));
    }
    return { matchedCount: updates.size, matchedRefs };
  };

  const createAdjustingEntryForBankMovement = (
    statementMovement: BankStatementMovement,
    contraAccountCode: string
  ): JournalEntry => {
    if (typeof window === 'undefined' || !window.sicovenStore?.save || !storageReady || persistenceFaultRef.current) {
      throw new Error('La operación bancaria requiere SQLite local de escritorio disponible y lista.');
    }
    
    if (statementMovement.companyId !== currentCompany.id) {
      throw new Error('El movimiento bancario no pertenece a la empresa activa.');
    }
    if (statementMovement.isReconciled) {
      throw new Error('El movimiento ya está conciliado y no puede generar otro asiento de ajuste.');
    }
    const targetBank = bankAccounts.find(b =>
      b.id === statementMovement.bankAccountId && b.companyId === currentCompany.id
    );
    if (!targetBank) {
      throw new Error('La cuenta bancaria no pertenece a la empresa activa.');
    }
    const bankAccountCode = targetBank.accountCode;
    const bankAccountName = targetBank.bankName;
    const contraAccount = accounts.find(a => a.code === contraAccountCode);
    const allBankAccountCodes = new Set(bankAccounts.map(bank => bank.accountCode));
    if (!contraAccount || !contraAccount.isMovement || allBankAccountCodes.has(contraAccount.code)) {
      throw new Error('Seleccione una cuenta contable de movimiento válida que no sea una cuenta bancaria.');
    }
    const contraAccountName = contraAccount.name;

    const rate = Number(statementMovement.bcvRate);
    const amountBs = Number(statementMovement.amountBs);
    const amountUsd = Number(statementMovement.amountUsd);
    validateBankMovementFxSnapshot({
      date: statementMovement.date,
      amountBs,
      amountUsd,
      bcvRate: rate,
      bcvRateEffectiveDate: statementMovement.bcvRateEffectiveDate
    });

    const items: JournalEntryItem[] = [];

    if (statementMovement.type === 'DEBIT') {
      items.push({
        accountCode: contraAccountCode,
        accountName: contraAccountName,
        debitBs: amountBs,
        creditBs: 0,
        debitUsd: amountUsd,
        creditUsd: 0,
        description: statementMovement.description
      });
      items.push({
        accountCode: bankAccountCode,
        accountName: bankAccountName,
        debitBs: 0,
        creditBs: amountBs,
        debitUsd: 0,
        creditUsd: amountUsd,
        description: `Nota de Débito Bancaria Ref: ${statementMovement.reference}`
      });
    } else {
      items.push({
        accountCode: bankAccountCode,
        accountName: bankAccountName,
        debitBs: amountBs,
        creditBs: 0,
        debitUsd: amountUsd,
        creditUsd: 0,
        description: `Nota de Crédito Bancaria Ref: ${statementMovement.reference}`
      });
      items.push({
        accountCode: contraAccountCode,
        accountName: contraAccountName,
        debitBs: 0,
        creditBs: amountBs,
        debitUsd: 0,
        creditUsd: amountUsd,
        description: statementMovement.description
      });
    }

    const adjustingEntry = addJournalEntry({
      entryNumber: 0,
      date: statementMovement.date,
      description: `Ajuste Conciliación Bancaria: ${statementMovement.description}`,
      type: 'AJUSTE',
      bcvRate: rate,
      referenceDoc: statementMovement.reference,
      items,
      isAdjusted: true
    });

    // The new entry is not yet present in the current render's journalEntries
    // snapshot, so reconcile directly after validating the statement and bank.
    setBankStatementMovements(prev =>
      prev.map(m =>
        m.id === statementMovement.id && m.companyId === currentCompany.id && m.bankAccountId === targetBank.id
          ? {
              ...m,
              isReconciled: true,
              matchedBy: 'MANUAL',
              reconciledWithJournalEntryId: adjustingEntry.id,
              reconciledJournalEntryIds: [...new Set([...(m.reconciledJournalEntryIds || []), adjustingEntry.id])],
              reconciledAt: new Date().toISOString()
            }
          : m
      )
    );

    return adjustingEntry;
  };

  const saveFinancialDisclosure = async (draft: Omit<FinancialDisclosure, 'id' | 'companyId' | 'createdAt' | 'updatedAt'>): Promise<FinancialDisclosure> => {
    const now = new Date().toISOString();
    const record: FinancialDisclosure = {
      ...draft, id: crypto.randomUUID(), companyId: currentCompany.id, createdAt: now, updatedAt: now
    };
    const error = validateFinancialDisclosure(record, new Set(companies.map(company => company.id)));
    if (error) throw new Error(error);
    setFinancialDisclosures(previous => {
      const existing = previous.find(item => item.id === record.id);
      return existing ? previous.map(item => item.id === record.id ? record : item) : [...previous, record];
    });
    await waitForPersistence();
    return record;
  };

  const resetToSampleData = async (): Promise<void> => {
    assertSQLitePersistenceReady('Restablecer datos de muestra');
    // El ledger protege los asientos históricos contra borrado por snapshots normales.
    // El reinicio debe pasar por la transacción autorizada de Electron que limpia app_state
    // y conserva usuarios, sesiones, licencia e historial de auditoría.
    const reset = await window.sicovenStore!.resetAccounting(token);
    if (!reset?.ok || !reset.cleared || reset.verified !== true) {
      throw new Error('SQLite no confirmó y verificó el restablecimiento de datos de muestra.');
    }
    setCompanies([]);
    setCurrentCompanyId('');
    setAccounts(DEFAULT_CHART_OF_ACCOUNTS);
    setJournalEntries([]);
    setPurchases([]);
    setSales([]);
    setProducts([]);
    setMovements([]);
    setVatVouchers([]);
    setVatWithholdingDeclarations([]);
    setVatWithholdingDeclarationEvents([]);
    setIslrVouchers([]);
    setBankAccounts([]);
    setBankStatementMovements([]);
    setCreditSettlements([]);
    setSupplierAdvanceSettlements([]);
    setSupplierDirectAdvances([]);
    setIslrFiscalEvents([]);
    setFinancialDisclosures([]);
    setDisplayCurrency('DUAL');
    await waitForPersistence();
  };

  const resetFactoryData = async () => {
    assertSQLitePersistenceReady('Restablecer SICOVEN de fábrica');
    // En escritorio, borrar primero el estado persistido en SQLite de forma atómica.
    // No se muestra éxito hasta que la base de datos confirma la operación.
    if (window.sicovenStore) {
      if (!storageReady) throw new Error('La base de datos todavía se está inicializando. Intente nuevamente.');
      const result = await window.sicovenStore.resetAccounting(token);
      if (!result?.ok || !result.cleared || result.verified !== true) throw new Error('SQLite no confirmó y verificó el reinicio de fábrica.');
    }
    setCompanies([]);
    setCurrentCompanyId('');
    setAccounts(DEFAULT_CHART_OF_ACCOUNTS);
    setJournalEntries([]);
    setPurchases([]);
    setSales([]);
    setProducts([]);
    setMovements([]);
    setVatVouchers([]);
    setVatWithholdingDeclarations([]);
    setVatWithholdingDeclarationEvents([]);
    setIslrVouchers([]);
    setBankAccounts([]);
    setBankStatementMovements([]);
    setCreditSettlements([]);
    setSupplierAdvanceSettlements([]);
    setSupplierDirectAdvances([]);
    setIslrFiscalEvents([]);
    setFinancialDisclosures([]);
    setDisplayCurrency('DUAL');
    // No informar que terminó hasta que el nuevo estado vacío también quede
    // confirmado por la cola de persistencia SQLite.
    if (window.sicovenStore) await waitForPersistence();
  };

  const exportBackupJson = (): string => {
    const backup = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      companies,
      accounts,
      journalEntries,
      purchases,
      sales,
      products,
      movements,
      vatVouchers,
      vatWithholdingDeclarations,
      vatWithholdingDeclarationEvents,
      islrVouchers,
      bankAccounts,
      bankStatementMovements,
      creditSettlements,
      supplierAdvanceSettlements,
      supplierDirectAdvances,
      islrFiscalEvents,
      financialDisclosures
    };
    return JSON.stringify(backup, null, 2);
  };

  const restoreBackupJson = async (jsonData: string): Promise<boolean> => {
    assertSQLitePersistenceReady('Restaurar respaldo');
    // La importación JSON no puede retroceder un ledger append-only ni borrar
    // documentos que ya tienen asientos, Kardex o referencias fiscales. Para
    // volver físicamente a un punto anterior se usa el restaurador SQLite verificado.
    const incoming = JSON.parse(jsonData);
    const protectedCollections: Array<[string, string, Array<{ id?: string }>]> = [
      ['empresas', 'companies', companies], ['asientos', 'journalEntries', journalEntries], ['compras', 'purchases', purchases],
      ['ventas', 'sales', sales], ['artículos', 'products', products],
      ['movimientos de inventario', 'movements', movements], ['comprobantes IVA', 'vatVouchers', vatVouchers],
      ['declaraciones IVA', 'vatWithholdingDeclarations', vatWithholdingDeclarations],
      ['eventos de declaraciones IVA', 'vatWithholdingDeclarationEvents', vatWithholdingDeclarationEvents],
      ['comprobantes ISLR', 'islrVouchers', islrVouchers], ['cuentas bancarias', 'bankAccounts', bankAccounts],
      ['movimientos bancarios', 'bankStatementMovements', bankStatementMovements],
      ['cobros y pagos', 'creditSettlements', creditSettlements],
      ['liquidaciones de anticipos', 'supplierAdvanceSettlements', supplierAdvanceSettlements],
      ['anticipos directos', 'supplierDirectAdvances', supplierDirectAdvances],
      ['eventos fiscales ISLR', 'islrFiscalEvents', islrFiscalEvents],
      ['revelaciones financieras', 'financialDisclosures', financialDisclosures]
    ];
    for (const [label, collectionKey, currentRows] of protectedCollections) {
      const incomingRows = incoming?.[collectionKey];
      if (currentRows.length > 0 && !Array.isArray(incomingRows)) {
        throw new Error('El respaldo JSON no contiene la colección ' + label + '. No se modificó ningún dato.');
      }
      const incomingIds = new Set((Array.isArray(incomingRows) ? incomingRows : [])
        .map(row => String(row?.id || '')).filter(Boolean));
      const missing = currentRows.filter(row => row.id && !incomingIds.has(String(row.id)));
      if (missing.length > 0) {
        throw new Error('Restauración JSON bloqueada: el respaldo no contiene ' + missing.length +
          ' registro(s) histórico(s) actual(es) de ' + label +
          '. Para restaurar un punto anterior sin mezclar ni destruir el ledger, utilice el restaurador SQLite completo y verificado. No se modificó ningún dato.');
      }
    }
    // La capa de persistencia revierte la interfaz al último snapshot confirmado
    // cuando la transacción SQLite falla; no se vuelve a aplicar un JSON en paralelo.
    if (!applyBackupJson(jsonData)) return false;
    try {
      await waitForPersistence();
      return true;
    } catch (persistenceError) {
      throw new Error('SQLite rechazó el respaldo. SICOVEN restauró la última instantánea confirmada y bloqueó nuevas escrituras; cierre y vuelva a abrir la aplicación antes de intentar otra restauración. ' +
        (persistenceError instanceof Error ? persistenceError.message : 'Error de persistencia.'));
    }
  };

  const applyBackupJson = (jsonData: string): boolean => {
    try {
      const data = JSON.parse(jsonData);
      // Los respaldos anteriores a la incorporación del libro fiscal siguen siendo legibles.
      // Los respaldos nuevos deben transportar íntegro el historial ISLR.
      const islrFiscalEvents: IslrFiscalEvent[] = data?.islrFiscalEvents === undefined
        ? []
        : data.islrFiscalEvents;
      if (!Array.isArray(islrFiscalEvents) || islrFiscalEvents.some((event: any) =>
        !event || typeof event.id !== 'string' || !event.id.trim() ||
        typeof event.companyId !== 'string' || !event.companyId.trim() ||
        typeof event.supplierRif !== 'string' || !event.supplierRif.trim() ||
        typeof event.journalEntryId !== 'string' || !event.journalEntryId.trim()
      )) {
        throw new Error('El respaldo contiene eventos fiscales ISLR incompletos o inválidos.');
      }
      const requiredCollections = [
        'companies', 'accounts', 'journalEntries', 'purchases', 'sales', 'products',
        'movements', 'vatVouchers', 'islrVouchers', 'bankAccounts', 'bankStatementMovements'
      ] as const;
      if (!data || typeof data !== 'object' || requiredCollections.some(key => !Array.isArray(data[key]))) {
        throw new Error('El respaldo está incompleto o no contiene todas las colecciones requeridas.');
      }
      const companyIds = new Set<string>();
      if (data.companies.length === 0 || data.companies.some((c: any) => {
        if (!c || typeof c.id !== 'string' || !c.id.trim() || typeof c.rif !== 'string' || typeof c.name !== 'string' ||
            companyIds.has(c.id)) return true;
        companyIds.add(c.id);
        return false;
      })) throw new Error('El respaldo contiene empresas inválidas o IDs de empresa duplicados.');
      const vatWithholdingDeclarations: VatWithholdingDeclaration[] = data?.vatWithholdingDeclarations === undefined ? [] : data.vatWithholdingDeclarations;
      const vatWithholdingDeclarationEvents: VatWithholdingDeclarationEvent[] = data?.vatWithholdingDeclarationEvents === undefined ? [] : data.vatWithholdingDeclarationEvents;
      if (!Array.isArray(vatWithholdingDeclarations) || !Array.isArray(vatWithholdingDeclarationEvents)) {
        throw new Error('El respaldo contiene declaraciones quincenales IVA o eventos fiscales inválidos.');
      }
      const financialDisclosures: FinancialDisclosure[] = data?.financialDisclosures === undefined ? [] : data.financialDisclosures;
      if (!Array.isArray(financialDisclosures) || financialDisclosures.some(item => validateFinancialDisclosure(item, companyIds) !== null)) {
        throw new Error('El respaldo contiene notas o revelaciones financieras inválidas o vinculadas a otra empresa.');
      }
      const journalIds = new Set<string>();
      const journalNumbers = new Set<string>();
      if (data.journalEntries.some((entry: any) => {
        if (!entry || typeof entry.id !== 'string' || !entry.id.trim() || journalIds.has(entry.id) ||
            !companyIds.has(entry.companyId) || !Number.isInteger(entry.entryNumber) || entry.entryNumber <= 0 ||
            !Array.isArray(entry.items)) return true;
        const sequenceKey = entry.companyId + '|' + entry.entryNumber;
        if (journalNumbers.has(sequenceKey)) return true;
        journalIds.add(entry.id);
        journalNumbers.add(sequenceKey);
        return false;
      })) {
        throw new Error('Hay asientos con IDs/correlativos duplicados, empresas inexistentes o líneas inválidas.');
      }
      const accountByCode = new Map<string, Account>();
      for (const account of data.accounts as Account[]) {
        if (!account || typeof account.code !== 'string' || !account.code.trim() ||
            typeof account.name !== 'string' || !account.name.trim() ||
            !['ACTIVO','PASIVO','PATRIMONIO','INGRESOS','COSTOS','GASTOS'].includes(account.type) ||
            !Number.isInteger(account.level) || account.level < 1 || account.level > 5 ||
            typeof account.isMovement !== 'boolean' || accountByCode.has(account.code.toLowerCase())) {
          throw new Error('El plan de cuentas contiene códigos duplicados o cuentas con campos inválidos.');
        }
        accountByCode.set(account.code.toLowerCase(), account);
      }
      for (const account of data.accounts as Account[]) {
        if (account.parentCode && !accountByCode.has(account.parentCode.toLowerCase())) {
          throw new Error('La cuenta ' + account.code + ' referencia una cuenta padre inexistente.');
        }
      }
      const disclosureNumbers = new Set<string>();
      for (const note of financialDisclosures) {
        const numberKey = note.companyId + '|' + note.fiscalYear + '|' + note.noteNumber;
        if (disclosureNumbers.has(numberKey)) throw new Error('El respaldo contiene números de nota duplicados dentro de una empresa y ejercicio.');
        disclosureNumbers.add(numberKey);
        if (note.sourceAccountCodes.some(code => !accountByCode.has(code.toLowerCase()))) {
          throw new Error('Una nota financiera referencia cuentas inexistentes.');
        }
        if (note.sourceEntryIds.some(id => {
          const entry = (data.journalEntries as JournalEntry[]).find(item => item.id === id);
          return !entry || entry.companyId !== note.companyId || !entry.date.startsWith(String(note.fiscalYear)) || entry.type === 'CIERRE';
        })) throw new Error('Una nota financiera referencia asientos inexistentes, de otra empresa o de otro ejercicio.');
      }
      for (const entry of data.journalEntries as JournalEntry[]) {
        if (!entry || !companyIds.has(entry.companyId) || !Array.isArray(entry.items) ||
            !isValidIsoDate(entry.date) ||
            !Number.isFinite(entry.bcvRate) || entry.bcvRate <= 0 || entry.items.length < 2) {
          throw new Error('Hay asientos con empresa, fecha, tasa BCV o líneas inválidas.');
        }
        let debitBs = 0, creditBs = 0, debitUsd = 0, creditUsd = 0;
        for (const line of entry.items as JournalEntryItem[]) {
          const account = accountByCode.get(String(line.accountCode || '').toLowerCase());
          const amounts = [line.debitBs, line.creditBs, line.debitUsd, line.creditUsd].map(Number);
          if (!account || !account.isMovement || amounts.some(value => !Number.isFinite(value) || value < 0) ||
              (Number(line.debitBs) > 0 && Number(line.creditBs) > 0) ||
              (Number(line.debitUsd) > 0 && Number(line.creditUsd) > 0)) {
            throw new Error('El asiento ' + entry.entryNumber + ' contiene una cuenta o línea contable inválida.');
          }
          debitBs += Number(line.debitBs); creditBs += Number(line.creditBs);
          debitUsd += Number(line.debitUsd); creditUsd += Number(line.creditUsd);
        }
        if (!isJournalEntryBalanced({ debitBs, creditBs, debitUsd, creditUsd }) || debitBs <= 0 || debitUsd <= 0) {
          throw new Error('El asiento ' + entry.entryNumber + ' no cuadra en ambas monedas. No se restauró el respaldo.');
        }
      }
      for (const key of requiredCollections) {
        if (key === 'accounts' || key === 'journalEntries') continue;
        const rows = data[key] as any[];
        const rowIds = new Set<string>();
        if (rows.some(row => {
          if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id.trim() ||
              typeof row.companyId !== 'string' || !companyIds.has(row.companyId) || rowIds.has(row.id)) return true;
          rowIds.add(row.id);
          return false;
        })) {
          throw new Error(`La colección ${key} contiene IDs ausentes/duplicados, registros sin empresa o vinculados a empresas inexistentes.`);
        }
      }
      for (const [collectionName, documents] of [['ventas', data.sales], ['compras', data.purchases]] as const) {
        const documentKeys = new Set<string>();
        for (const document of documents as Array<SaleRecord | PurchaseRecord>) {
          const key = String(document.companyId) + '|' + String(document.invoiceNumber || '').trim().toLowerCase();
          if (!document.invoiceNumber?.trim() || documentKeys.has(key) ||
              !isValidIsoDate(document.invoiceDate) ||
              !hasConsistentFiscalDocumentAmounts(document) ||
              (document.paymentTerm !== undefined && !['CONTADO','CREDITO'].includes(document.paymentTerm)) ||
              (document.paymentTerm === 'CREDITO' && (!Number.isInteger(document.creditDays) || Number(document.creditDays) < 1 || !isValidIsoDate(document.dueDate)))) {
            throw new Error('La colección de ' + collectionName + ' contiene facturas duplicadas, fechas, importes, tasa BCV o condiciones de crédito inválidas.');
          }
          documentKeys.add(key);
        }
      }
      // Validar todas las liquidaciones antes de tocar cualquier estado: la importación
      // debe ser todo-o-nada desde la perspectiva de la interfaz.
      const settlements = Array.isArray(data.creditSettlements) ? data.creditSettlements : [];
      const advanceSettlements = Array.isArray(data.supplierAdvanceSettlements) ? data.supplierAdvanceSettlements : [];
      const directAdvances = data.supplierDirectAdvances === undefined ? [] : data.supplierDirectAdvances;
      if (!Array.isArray(directAdvances) || directAdvances.some((item: any) => {
        const account = data.accounts.find((candidate: Account) => candidate.code === item?.treasuryAccountCode);
        const journal = data.journalEntries.find((candidate: JournalEntry) => candidate.id === item?.journalEntryId);
        return !item || typeof item.id !== 'string' || !item.id.trim() ||
          !companyIds.has(item.companyId) || typeof item.supplierRif !== 'string' || !item.supplierRif.trim() ||
          !isValidIsoDate(item.date) || !Number.isFinite(item.amountUsd) || item.amountUsd <= 0 ||
          !Number.isFinite(item.bookValueBs) || item.bookValueBs <= 0 ||
          !Number.isFinite(item.bcvRate) || item.bcvRate <= 0 ||
          !['BS', 'USD'].includes(item.paymentCurrency) || !Number.isFinite(item.paidAmount) || item.paidAmount <= 0 ||
          !String(item.reference || '').trim() || !String(item.support || '').trim() || !account || account.type !== 'ACTIVO' || !account.isMovement ||
          !account.code.startsWith('1.1.1.') || !journal || journal.companyId !== item.companyId ||
          journal.type !== 'ANTICIPO_PROVEEDOR' || journal.date !== item.date;
      })) throw new Error('El respaldo contiene anticipos directos de proveedor inválidos o sin asiento contable.');
      const directAdvanceIds = new Set<string>();
      if (directAdvances.some((item: any) => directAdvanceIds.has(item.id) || (directAdvanceIds.add(item.id), false))) {
        throw new Error('El respaldo contiene IDs duplicados de anticipos directos.');
      }
      const advanceIds = new Set<string>();
      if (advanceSettlements.some((item: any) => {
        if (!item || typeof item.id !== 'string' || !item.id.trim() || advanceIds.has(item.id) ||
            !companyIds.has(item.companyId) || !['REFUND_RECEIVED','APPLIED_TO_PURCHASE'].includes(item.kind) ||
            !Number.isFinite(item.amountBs) || item.amountBs <= 0 || !Number.isFinite(item.amountUsd) || item.amountUsd <= 0 ||
            !Number.isFinite(item.bcvRate) || item.bcvRate <= 0 || !Array.isArray(item.sourceCreditNoteIds) ||
            !data.journalEntries.some((j: any) => j.id === item.journalEntryId && j.companyId === item.companyId)) return true;
        advanceIds.add(item.id);
        if (item.kind === 'APPLIED_TO_PURCHASE') {
          const target = data.purchases.find((p: any) => p.id === item.targetPurchaseId && p.companyId === item.companyId && p.documentType === '01' && p.paymentTerm === 'CREDITO');
          return !target || String(target.supplierRif).trim().toUpperCase() !== String(item.supplierRif).trim().toUpperCase();
        }
        const bank = data.bankAccounts.some((b: any) => b.companyId === item.companyId &&
          b.accountCode === item.treasuryAccountCode && b.currency === 'BS');
        const cashAccount = accountByCode.get(String(item.treasuryAccountCode || '').toLowerCase());
        const validCash = item.treasuryAccountCode === '1.1.1.01' &&
          cashAccount?.type === 'ACTIVO' && cashAccount.isMovement === true;
        return !bank && !validCash;
      })) throw new Error('El respaldo contiene liquidaciones de anticipos duplicadas, inválidas o sin documento/asiento/tesorería verificable.');
      const advanceConsumedByNote = new Map<string, { usd: number; bs: number }>();
      const advanceConsumedByDirect = new Map<string, { usd: number; bs: number }>();
      const directById = new Map((directAdvances as SupplierDirectAdvance[]).map(item => [item.id, item]));
      for (const settlement of advanceSettlements as SupplierAdvanceSettlement[]) {
        const noteAllocations = settlement.sourceCreditNoteAllocations || [];
        const directAllocations = settlement.sourceDirectAdvanceAllocations || [];
        const noteIds = settlement.sourceCreditNoteIds || [];
        const directIds = settlement.sourceDirectAdvanceIds || [];
        if (!noteAllocations.length && !directAllocations.length) {
          if (settlement.isReversed) continue;
          throw new Error('El respaldo contiene una liquidación sin asignación a sus orígenes de anticipo.');
        }
        if (noteAllocations.length) {
          const allocationError = validateSupplierAdvanceCreditNoteAllocations(
            noteAllocations, noteIds,
            noteAllocations.reduce((sum, item) => sum + Number(item.amountUsd), 0),
            noteAllocations.reduce((sum, item) => sum + Number(item.bookValueBs), 0)
          );
          if (allocationError) throw new Error('El respaldo contiene una asignación de nota de crédito inválida: ' + allocationError);
        } else if (noteIds.length) {
          throw new Error('El respaldo contiene IDs de notas de crédito sin distribución individual.');
        }
        if (directAllocations.length !== directIds.length ||
            new Set(directIds).size !== directIds.length ||
            directAllocations.some(item => !item || !directIds.includes(item.directAdvanceId) ||
              !Number.isFinite(item.amountUsd) || item.amountUsd <= 0 ||
              !Number.isFinite(item.bookValueBs) || item.bookValueBs < 0) ||
            new Set(directAllocations.map(item => item.directAdvanceId)).size !== directAllocations.length) {
          throw new Error('El respaldo contiene una asignación individual de anticipos directos inválida.');
        }
        const allocatedUsd = [...noteAllocations, ...directAllocations].reduce((sum, item) => sum + Number(item.amountUsd), 0);
        const allocatedBs = [...noteAllocations, ...directAllocations].reduce((sum, item) => sum + Number(item.bookValueBs), 0);
        if (Math.abs(allocatedUsd - Number(settlement.amountUsd)) > 0.01 ||
            Math.abs(allocatedBs - Number(settlement.advanceBookValueBs ?? settlement.amountBs)) > 0.02) {
          throw new Error('La asignación total del anticipo no concilia con el importe liquidado y su valor histórico.');
        }
        const sourceNotes = (data.purchases as PurchaseRecord[]).filter(note =>
          note.companyId === settlement.companyId && note.documentType === '03' && !note.isCancelled &&
          String(note.supplierRif || '').trim().toUpperCase() === String(settlement.supplierRif || '').trim().toUpperCase() &&
          Number(note.supplierAdvanceUsd || 0) > 0);
        const sourceById = new Map(sourceNotes.map(note => [note.id, note]));
        for (const allocation of noteAllocations) {
          const source = sourceById.get(allocation.creditNoteId);
          if (!source) throw new Error('Una liquidación de anticipo referencia una nota de crédito inexistente o de otro proveedor.');
          if (!settlement.isReversed) {
            const used = advanceConsumedByNote.get(source.id) || { usd: 0, bs: 0 };
            used.usd = Math.round((used.usd + allocation.amountUsd) * 100) / 100;
            used.bs = Math.round((used.bs + allocation.bookValueBs) * 100) / 100;
            advanceConsumedByNote.set(source.id, used);
          }
        }
        for (const allocation of directAllocations) {
          const source = directById.get(allocation.directAdvanceId);
          if (!source || source.companyId !== settlement.companyId || (source.isReversed && !settlement.isReversed) ||
              String(source.supplierRif || '').trim().toUpperCase() !== String(settlement.supplierRif || '').trim().toUpperCase()) {
            throw new Error('Una liquidación de anticipo referencia un desembolso directo inexistente, reversado o de otro proveedor/empresa.');
          }
          if (!settlement.isReversed) {
            const used = advanceConsumedByDirect.get(source.id) || { usd: 0, bs: 0 };
            used.usd = Math.round((used.usd + allocation.amountUsd) * 100) / 100;
            used.bs = Math.round((used.bs + allocation.bookValueBs) * 100) / 100;
            advanceConsumedByDirect.set(source.id, used);
          }
        }
      }
      for (const [noteId, used] of advanceConsumedByNote) {
        const source = (data.purchases as PurchaseRecord[]).find(note => note.id === noteId)!;
        if (used.usd > Number(source.supplierAdvanceUsd || 0) + 0.01 ||
            used.bs > Number(source.supplierAdvanceBs || 0) + 0.02) {
          throw new Error('El respaldo consume más anticipo del disponible en una nota de crédito de proveedor.');
        }
      }
      for (const [directId, used] of advanceConsumedByDirect) {
        const source = directById.get(directId)!;
        if (used.usd > Number(source.amountUsd || 0) + 0.005 ||
            used.bs > Number(source.bookValueBs || 0) + 0.02) {
          throw new Error('El respaldo consume más anticipo del disponible en un desembolso directo.');
        }
      }
      const settlementIds = new Set<string>();
      const salesById = new Map<string, any>(data.sales.map((row: any) => [row.id, row]));
      const purchasesById = new Map<string, any>(data.purchases.map((row: any) => [row.id, row]));
      if (settlements.some((s: any) => {
        if (!s || typeof s.id !== 'string' || !s.id.trim() || settlementIds.has(s.id) ||
            !companyIds.has(s.companyId) ||
            !['SALE_COLLECTION', 'PURCHASE_PAYMENT'].includes(s.kind) ||
            !Number.isFinite(s.amountUsd) || s.amountUsd <= 0 ||
            !Number.isFinite(s.amountBs) || s.amountBs <= 0 ||
            !Number.isFinite(s.bcvRate) || s.bcvRate <= 0 ||
            !data.journalEntries.some((j: any) => j.id === s.journalEntryId && j.companyId === s.companyId)) return true;
        settlementIds.add(s.id);
        const source = s.kind === 'SALE_COLLECTION' ? salesById.get(s.documentId) : purchasesById.get(s.documentId);
        return !source || source.companyId !== s.companyId;
      })) throw new Error('El respaldo contiene liquidaciones duplicadas, inválidas o sin factura/asiento contable válido.');
      // Validar el libro ISLR contra facturas, asientos y UT histórica antes
      // de aplicar cualquier cambio de estado durante la restauración.
      const eligibleBaseByPurchase: Record<string, number> = {};
      for (const purchase of data.purchases as PurchaseRecord[]) {
        if (purchase.documentType === '01' && !purchase.isCancelled) {
          eligibleBaseByPurchase[`${purchase.companyId}|${purchase.id}`] = Number(purchase.taxableBaseBs) + Number(purchase.exemptAmountBs);
        }
      }
      validateIslrFiscalEventLedger([], islrFiscalEvents, eligibleBaseByPurchase);
      for (const event of islrFiscalEvents) {
        const sourcePurchases = event.allocations.map(allocation => purchasesById.get(allocation.purchaseId));
        if (sourcePurchases.some((purchase: any) => !purchase ||
            purchase.documentType !== '01' || purchase.isCancelled ||
            purchase.companyId !== event.companyId ||
            String(purchase.supplierRif || '').trim().toUpperCase() !== event.supplierRif.trim().toUpperCase())) {
          throw new Error('Un evento fiscal ISLR referencia una factura inexistente, anulada o de otro proveedor/empresa.');
        }
        const journal = data.journalEntries.find((entry: any) =>
          entry.id === event.journalEntryId && entry.companyId === event.companyId);
        if (!journal || journal.date !== event.fiscalDate) {
          throw new Error('El evento fiscal ISLR no coincide con la fecha y empresa de su asiento contable.');
        }
      }
      setCompanies(data.companies);
      // Migración aditiva del plan contable: incorpora cuentas nuevas sin alterar códigos ni saldos existentes.
      const loadedAccountCodes = new Set(data.accounts.map((account: Account) => account.code));
      setAccounts(removeUnusedLegacyDefaultBanks(
        [...data.accounts, ...DEFAULT_CHART_OF_ACCOUNTS.filter(account => !loadedAccountCodes.has(account.code))],
        data.journalEntries,
        data.bankAccounts
      ));
      setJournalEntries(data.journalEntries);
      setPurchases(data.purchases);
      setSales(data.sales);
      setProducts(data.products);
      setMovements(data.movements);
      setVatVouchers(data.vatVouchers);
      setVatWithholdingDeclarations(vatWithholdingDeclarations);
      setVatWithholdingDeclarationEvents(vatWithholdingDeclarationEvents);
      setIslrVouchers(data.islrVouchers);
      setBankAccounts(data.bankAccounts);
      setBankStatementMovements(data.bankStatementMovements);
      setCreditSettlements(settlements);
      setSupplierAdvanceSettlements(advanceSettlements);
      setSupplierDirectAdvances(directAdvances);
      setIslrFiscalEvents(islrFiscalEvents);
      setFinancialDisclosures(financialDisclosures);
      setCurrentCompanyId(data.companies[0].id);
      return true;
    } catch (e) {
      console.error('Error importing backup:', e);
      return false;
    }
  };

  return (
    <AccountingContext.Provider
      value={{
        companies,
        getAuditEvents,
        requestAccountingCorrection,
        createCorrectionCase,
        authorizeCorrectionCase,
        listCorrectionCases,
        reviewCorrectionCase,
        observeCorrectionCase,
        resubmitCorrectionCase,
        withdrawCorrectionCase,
        executeCorrectionCase,
        listSupportingDocuments,
        attachSupportingDocument,
        reviewSupportingDocument,
        openSupportingDocument,
        listVatFiscalIncidents,
        createVatFiscalIncident,
        recordVatFiscalIncidentEvent,
        waitForPersistence,
        isStorageReady: storageReady,
        storageError,
        currentCompany,
        setCurrentCompanyId,
        addCompany,
        updateCompany,
        updateBcvRate,
        correctBcvRate,
        accounts,
        addAccount,
        setAccountCashFlowActivity,
        setAccountCashFlowIndirectTreatment,
        journalEntries: journalEntries.filter(e => e.companyId === currentCompany.id),
        addJournalEntry,
        deleteJournalEntry,
        reverseJournalEntry,
        closeAccountingPeriod,
        reopenAccountingPeriod,
        createAccountingYearOpening,
        creditSettlements: creditSettlements.filter(s => s.companyId === currentCompany.id),
        getCreditBalance,
        addCreditSettlement,
        getSupplierAdvanceBalance,
        supplierAdvanceSettlements: supplierAdvanceSettlements.filter(item => item.companyId === currentCompany.id),
        addSupplierAdvanceSettlement,
        supplierDirectAdvances: supplierDirectAdvances.filter(item => item.companyId === currentCompany.id),
        addSupplierDirectAdvance,
        purchases: purchases.filter(p => p.companyId === currentCompany.id),
        addPurchase,
        addPurchaseCreditNote,
        addPurchaseServiceCreditNote,
        addSupplierDebitNote,
        deletePurchase,
        sales: sales.filter(s => s.companyId === currentCompany.id),
        addSale,
        addSaleCorrectionNote,
        deleteSale,
        runAtomicInvoiceImport,
        runAtomicInvoiceImportAndWait,
        addImportedCreditSettlements,
        products: products.filter(p => p.companyId === currentCompany.id),
        addProduct,
        getCompanyInventoryProducts,
        getCompanyInventoryMovements,
        importInventoryProducts,
        importInventoryMovements,
        executeProduction,
        updateProduct,
        movements: movements.filter(m => m.companyId === currentCompany.id),
        addMovement,
        vatVouchers: vatVouchers.filter(v => v.companyId === currentCompany.id),
        vatWithholdingDeclarations: vatWithholdingDeclarations.filter(item => item.companyId === currentCompany.id),
        vatWithholdingDeclarationEvents: vatWithholdingDeclarationEvents.filter(event =>
          vatWithholdingDeclarations.some(item => item.id === event.declarationId && item.companyId === currentCompany.id)),
        createVatWithholdingDeclaration,
        recordVatWithholdingDeclarationEvent,
        islrVouchers: islrVouchers.filter(v => v.companyId === currentCompany.id),
        islrFiscalEvents: islrFiscalEvents.filter(event => event.companyId === currentCompany.id),
        financialDisclosures: financialDisclosures.filter(item => item.companyId === currentCompany.id),
        saveFinancialDisclosure,
        deleteVatVoucher,
        recordVatVoucherDelivery,
        recordIslrVoucherDelivery,
        deleteIslrVoucher,
        bankAccounts: bankAccounts.filter(b => b.companyId === currentCompany.id),
        bankStatementMovements: bankStatementMovements.filter(m => m.companyId === currentCompany.id),
        addBankAccount,
        registerTreasuryMovement,
        addBankStatementMovement,
        addBankStatementMovements,
        deleteBankStatementMovement,
        reconcileMovementManual,
        unreconcileMovement,
        runAutoReconciliation,
        unreconcileAll,
        createAdjustingEntryForBankMovement,
        displayCurrency,
        setDisplayCurrency,
        resetToSampleData,
        resetFactoryData,
        exportBackupJson,
        restoreBackupJson
      }}
    >
      {children}
    </AccountingContext.Provider>
  );
};

export const useAccounting = () => {
  const context = useContext(AccountingContext);
  if (!context) {
    throw new Error('useAccounting must be used within an AccountingProvider');
  }
  return context;
};
