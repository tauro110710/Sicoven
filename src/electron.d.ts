export {};
interface InflationClassificationInput {
  id: string; version: number; supersedesDecisionId?: string; companyId: string; fiscalYear: number; accountCode: string;
  scope: 'ACCOUNT_DEFAULT' | 'BALANCE_COMPONENT'; componentRef?: string;
  classification: 'MONETARY' | 'NON_MONETARY' | 'MIXED' | 'NOT_APPLICABLE';
  measurementBasis: 'CASH_OR_FIXED_CURRENCY' | 'INDEX_LINKED' | 'GOODS_OR_SERVICES' | 'HISTORICAL_COST' | 'FAIR_VALUE' | 'NET_REALIZABLE_VALUE' | 'REVALUED' | 'MIXED' | 'FLOW';
  treatment: string; rationale: string; normativeReference: string; status: 'PENDING_REVIEW';
  originDate?: string; measurementDate?: string; reportingDate?: string;
  carryingAmountBs?: number | string; carryingAmountUsd?: number | string; currency?: 'BS' | 'USD' | 'DUAL'; contractReference?: string;
}
interface InflationIndexImportInput {
  seriesCode: 'IPC_AMC' | 'INPC_BCV' | 'ESTIMACION_EXPERTO' | 'ESTUDIO_FCCPV' | 'ESTIMACION_PROPIA_EXCEPCIONAL';
  metricType: 'INDEX_LEVEL' | 'MONTHLY_VARIATION_PCT';
  basePeriod?: string;
  fileName: string;
  sourceTitle: string;
  issuer: string;
  sourceReference: string;
  sourceUrl?: string;
  sourcePublishedAt?: string;
  sourceText: string;
}
declare global {
  interface Window {
    sicovenStore?: {
      getLicenseStatus: () => Promise<{ authorized: boolean; needsActivation: boolean; status: string; customer?: string; product?: string; offlineUntil?: string | null; lastCheckedAt?: string | null; message?: string }>;
      activateLicense: (key: string) => Promise<{ ok: boolean; message?: string; license?: { authorized: boolean; needsActivation: boolean; status: string; message?: string; customer?: string; product?: string; offlineUntil?: string | null; lastCheckedAt?: string | null } }>;
      revalidateLicense: () => Promise<{ authorized: boolean; needsActivation: boolean; status: string; message?: string; customer?: string; product?: string }>;
      onLicenseStatusChanged: (callback: (status: { authorized: boolean; status: string; message?: string }) => void) => () => void;
      getAuthSetupStatus: () => Promise<{ required: boolean }>;
      initializeAdmin: (input: { username: string; password: string }) => Promise<{ ok: boolean; message?: string }>;
      login: (credentials: { username: string; password: string }) => Promise<{ ok: boolean; message?: string; token?: string; user?: { username: string; role: string; isSeed: boolean } }>;
      restoreSession: (token: string) => Promise<{ ok: boolean; message?: string; token?: string; user?: { username: string; role: string; isSeed: boolean } }>;
      logout: (token: string) => Promise<{ ok: boolean }>;
      listAdmins: (token: string) => Promise<{ ok: boolean; message?: string; admins?: Array<{ id: number; username: string; role: string; isSeed: boolean; createdAt: string }> }>;
      createAdmin: (token: string, input: { username: string; password: string; role?: 'admin' | 'contador' }) => Promise<{ ok: boolean; message?: string }>;
      deleteSeedAdmin: (token: string) => Promise<{ ok: boolean; message?: string }>;
      load: (token: string) => Promise<Record<string, unknown> | null>;
      flushPersistence: (token: string) => Promise<{ ok: true }>;
      onPersistenceFlushRequest: (callback: (request: { requestId: string }) => void) => () => void;
      ackPersistenceFlush: (requestId: string, message?: string | null) => void;
      inspectTenantMigrationPreflight: (token: string) => Promise<{ ok: boolean; readOnly: true; migrationStarted: false; sourceDatabase: 'sicoven.sqlite'; tables: Array<{ name: string; category: string }>; unknownTables: string[]; missingRequired: string[]; companyCount: number; companyIds: string[]; errors: string[] }>;
      executeTenantMigration: (token: string) => Promise<{ ok: boolean; phase?: string; companies?: Array<{ companyId: string }>; actor: string; sourceDatabase: 'sicoven.sqlite'; sourcePreserved: true; globalBackupRestoreRetained: true }>;
      listAccessibleCompanies: (token: string) => Promise<Array<{ id: string; name: string; rif: string }>>;
      getTenantRegistryStatus: (token: string) => Promise<{ registeredCount: number; activeCount: number; companies: Array<{ id: string; name: string; rif: string; status: string }> }>;
      selectActiveCompany: (token: string, companyId: string) => Promise<{ ok: boolean; changed: boolean; companyId: string; previousCompanyId?: string | null }>;
      createCompany: (token: string, input: Record<string, unknown>) => Promise<{ ok: boolean; company: { id: string; name: string; rif: string }; selection: { ok: boolean; changed: boolean; companyId: string } }>;
      getActiveCompany: (token: string) => Promise<{ companyId: string }>;
      updateCompanyMetadata: (token: string, input: { companyId: string; name: string; rif: string }) => Promise<{ ok: boolean; company: { id: string; name: string; rif: string } }>;
      listAuditEvents: (token: string, limit?: number) => Promise<{ ok: boolean; message?: string; events?: Array<{ id: number; eventType: string; details: Record<string, unknown>; createdAt: string }> }>;
      save: (token: string, state: Record<string, unknown>) => Promise<{ ok: boolean; savedAt: string }>;
      reopenAccountingPeriod: (token: string, input: { companyId: string; reopenedThroughDate: string | null; reason: string }) => Promise<{ ok: boolean; reopeningId: string; company?: { id: string; name: string; closedThroughDate?: string } }>;
      resetAccounting: (token: string) => Promise<{ ok: boolean; cleared?: boolean; verified?: boolean; canceled?: boolean; removedCompanies?: number; backupDestination?: string }>;
      listInflationIndexSeries: (token: string) => Promise<Array<Record<string, unknown>>>;
      previewInflationIndexImport: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesCode: InflationIndexImportInput['seriesCode']; metricType: InflationIndexImportInput['metricType']; basePeriod?: string | null; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; statusCounts: Record<string, number>; sourceSha256: string; sourceBytes: number }>;
      importInflationIndexSeries: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesId: string; sourceId: string; seriesVersion: number; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; statusCounts: Record<string, number>; sourceSha256: string; approvalStatus: string }>;
      reviewInflationIndexSeries: (token: string, input: { seriesId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) => Promise<{ ok: boolean; approvalId: string; seriesId: string; decision: string }>;
      listInflationClassifications: (token: string, filters?: { companyId?: string; fiscalYear?: number }) => Promise<Array<InflationClassificationInput & { createdAt: string; status: string; reviewDecision: string | null; reviewer?: string | null; reviewedAt?: string | null }>>;
      saveInflationClassification: (token: string, input: InflationClassificationInput) => Promise<{ ok: boolean; decisionId: string; version: number; status: string; treatment: string }>;
      reviewInflationClassification: (token: string, input: { decisionId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) => Promise<{ ok: boolean; reviewId: string; decisionId: string; decision: string }>; 
      getInflationSourceDossierEvidence: (token: string, evidenceId: string) => Promise<{ id: string; dossierId: string; title: string; fileName: string; mimeType: string; sourceUrl?: string | null; sha256: string; bytes: number; contentBase64?: string | null }>;
      listInflationSourceDossiers: (token: string, filters?: { companyId?: string; fiscalYear?: number; seriesId?: string }) => Promise<Array<Record<string, unknown>>>;
      createInflationSourceDossier: (token: string, input: Record<string, unknown>) => Promise<{ ok: boolean; dossierId: string; dossierVersion: number; sourceCode: string; missingEvidence: string[]; status: string; eligibleForReview: boolean }>;
      reviewInflationSourceDossier: (token: string, input: Record<string, unknown>) => Promise<{ ok: boolean; reviewId: string; dossierId: string; decision: string }>;
      attachSupportingDocument: (token: string, input: { companyId: string; entityType: 'PURCHASE' | 'SALE' | 'JOURNAL_ENTRY' | 'VAT_VOUCHER' | 'ISLR_VOUCHER' | 'INVENTORY_MOVEMENT' | 'BANK_STATEMENT_MOVEMENT' | 'CORRECTION_CASE'; entityId: string; documentType: string; title: string; description?: string; replacesDocumentId?: string }) => Promise<{ ok: boolean; canceled?: boolean; document?: { id: string; companyId: string; entityType: string; entityId: string; documentType: string; title: string; fileName: string; mimeType: string; sha256: string; byteSize: number; status: string; createdAt: string } }>;
      listSupportingDocuments: (token: string, filters: { companyId: string; entityType?: string; entityId?: string }) => Promise<Array<{ id: string; companyId: string; entityType: string; entityId: string; documentType: string; title: string; description?: string | null; fileName: string; mimeType: string; sha256: string; byteSize: number; uploadedBy: string; createdAt: string; status: 'ATTACHED_UNREVIEWED' | 'VERIFIED' | 'OBSERVATION_REQUIRED' | 'REPLACED' }>>;
      reviewSupportingDocument: (token: string, input: { documentId: string; decision: 'VERIFIED' | 'OBSERVATION_REQUIRED'; reason: string }) => Promise<{ ok: boolean; documentId: string; status: string }>;
      openSupportingDocument: (token: string, documentId: string) => Promise<{ ok: boolean }>;
      getPayrollSalaryForDate: (token: string, employeeId: string, effectiveDate: string) => Promise<{ id: string; companyId: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null; baseSalary: number; source: 'INITIAL' | 'SALARY_CHANGE' | 'LEGACY_MIGRATION' }>;
      listPayrollSalaryHistory: (token: string, employeeId: string) => Promise<Array<{ id: string; companyId: string; employeeId: string; effectiveFrom: string; effectiveTo: string | null; baseSalary: number; source: 'INITIAL' | 'SALARY_CHANGE' | 'LEGACY_MIGRATION'; createdAt: string }>>;
      listConfirmedPayrollSalaryEntries: (token: string, employeeId: string, fromDate: string, toDate: string) => Promise<Array<{ runId: string; lineId: string; frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; code: string; description: string; amount: number }>>;
      listPayrollEmployees: (token: string) => Promise<Array<{ id: string; companyId: string; fiscalId: string; fullName: string; hireDate: string; position: string; costCenter: string | null; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: number; active: boolean }>>;
      savePayrollEmployee: (token: string, input: { id?: string; fiscalId: string; fullName: string; hireDate: string; position?: string; costCenter?: string; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: number; salaryEffectiveFrom?: string; active?: boolean }) => Promise<{ id: string; companyId: string; fiscalId: string; fullName: string; hireDate: string; position: string; costCenter: string | null; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: number; active: boolean }>;
      listPayrollRuns: (token: string) => Promise<Array<{ id: string; companyId: string; frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; status: 'DRAFT' | 'CONFIRMED' | 'VOIDED'; totals: Record<string, number>; createdAt: string; confirmedAt: string | null; journalEntryId: string | null }>>;
      getPayrollRun: (token: string, runId: string) => Promise<{ id: string; companyId: string; frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; status: 'DRAFT' | 'CONFIRMED' | 'VOIDED'; snapshot: { version: number; companyId: string; frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; createdAt: string; companySnapshot: { name: string; rif: string; address: string; phone: string }; employees: Array<{ employeeId: string; fiscalId: string; fullName: string; salaryRecord: { baseSalary: number; effectiveFrom: string }; earnings: Array<{ code: string; description: string; amount: number; isSalary: boolean }>; deductions: Array<{ code: string; description: string; amount: number }>; bases: { normalSalary: number; integralSalary: number; grossSalary: number }; contributions: Array<{ code: string; description: string; base: number; workerAmount: number; employerAmount: number; sourceReference: string; verifiedAt: string }>; grossEarnings: number; salaryEarnings: number; workerLegalDeductions: number; employerContributions: number; otherDeductions: number; netPay: number; totalEmployerCost: number }> }; totals: Record<string, number>; createdAt: string; confirmedAt: string | null; journalEntryId: string | null }>;
      listPayrollSeveranceHistory: (token: string, employeeId: string) => Promise<{ deposits: Array<{ id: string; depositDate: string; kind: 'QUARTERLY'|'SENIORITY'|'ADVANCE'; days: number; dailyIntegralSalary: number; amount: number; sourceReference: string; verifiedAt: string; note: string; supersedesId: string|null; createdAt: string }>; interests: Array<{ id: string; month: string; mode: 'TRUST_OR_FUND'|'AUTHORIZED_BOOK_CREDIT'|'UNDEPOSITED'; capital: number; monthlyRate: number; interest: number; sourceReference: string; verifiedAt: string; note: string; supersedesId: string|null; createdAt: string }> }>;
      savePayrollSeveranceDeposit: (token: string, input: { employeeId: string; depositDate: string; kind: 'QUARTERLY'|'SENIORITY'|'ADVANCE'; days: number; dailyIntegralSalary: number; sourceReference: string; verifiedAt: string; note?: string; supersedesId?: string }) => Promise<{ id: string; amount: number; supersedesId: string|null }>;
      savePayrollSeveranceInterestMonth: (token: string, input: { employeeId: string; month: string; mode: 'TRUST_OR_FUND'|'AUTHORIZED_BOOK_CREDIT'|'UNDEPOSITED'; capital: number; monthlyRate: number; sourceReference: string; verifiedAt: string; note?: string; supersedesId?: string }) => Promise<{ id: string; interest: number; supersedesId: string|null }>;
      calculatePayrollSeverance: (token: string, input: { employeeId: string; asOfDate: string; dailyIntegralSalary: number }) => Promise<Record<string, unknown>>;
      calculatePayrollSeveranceInterest: (token: string, input: { employeeId: string; mode: 'TRUST_OR_FUND'|'AUTHORIZED_BOOK_CREDIT'|'UNDEPOSITED' }) => Promise<Record<string, unknown>>;
      calculatePayrollAnnualRights: (token: string, input: { employeeId: string; asOfDate: string; salaryType: 'FIXED' | 'VARIABLE'; lastMonthNormalSalary?: number; previousThreeMonthsNormalSalary?: number[]; fiscalYearStart?: string }) => Promise<{ employeeId: string; fullName: string; asOfDate: string; salaryBasis: { monthlySalary: number; dailySalary: number; monthsAveraged: number; legalBasis: string }; completedYears: number; vacationDays: number; vacationPay: number; vacationBonusDays: number; vacationBonus: number; profitSharingMinimumDays: number; profitSharingMinimum: number; profitSharingMaximumDays: number; profitSharingMaximum: number; monthsInFiscalYear: number; sources: string[] }>;
      calculatePayrollProfitSharing: (token: string, input: { fiscalYearStart: string; fiscalYearEnd: string; netProfits: number; sourceReference: string; verifiedAt: string; employees: Array<{ employeeId: string; monthlyNormalSalary: number; monthsWorked: number }> }) => Promise<{ fiscalYearStart: string; fiscalYearEnd: string; netProfits: number; statutoryRate: number; distributableFund: number; totalWagesEarned: number; totalMinimum: number; totalMaximum: number; totalPayable: number; employerShortfall: number; undistributedRemainder: number; sourceReference: string; verifiedAt: string; salaryEvidence: string; employees: Array<{ employeeId: string; fullName: string; wagesEarned: number; monthlyNormalSalary: number; monthsWorked: number; minimumDays: number; maximumDays: number; minimumAmount: number; maximumAmount: number; proportionalShare: number; amount: number }> }>
      createPayrollRun: (token: string, input: { frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; employees: Array<{ employeeId: string; earnings: Array<{ code: string; description: string; amount: number; isSalary?: boolean }>; deductions?: Array<{ code: string; description: string; amount: number }>; bases: { normalSalary: number; integralSalary: number; grossSalary: number } }> }) => Promise<{ id: string; companyId: string; frequency: 'WEEKLY' | 'BIWEEKLY'; periodStart: string; periodEnd: string; status: 'DRAFT'; employeeCount: number; totals: Record<string, number>; snapshot: unknown }>;
      confirmPayrollRun: (token: string, runId: string, journalEntryId: string) => Promise<{ id: string; companyId: string; status: 'CONFIRMED'; journalEntryId: string; periodStart: string; periodEnd: string; totals: Record<string, number>; confirmedAt: string | null; alreadyConfirmed: boolean }>;
      listPayrollLegalRules: (token: string) => Promise<Array<{ id: string; companyId: string; code: string; description: string; base: 'normalSalary' | 'integralSalary' | 'grossSalary'; frequencyScope: 'ALL' | 'WEEKLY' | 'BIWEEKLY'; workerRate: number; employerRate: number; baseCap: number | null; effectiveFrom: string; effectiveTo: string | null; sourceReference: string; verifiedAt: string; applicability: Record<string, unknown>; active: boolean }>>;
      savePayrollLegalRule: (token: string, input: { id?: string; code: string; description: string; base: 'normalSalary' | 'integralSalary' | 'grossSalary'; frequencyScope?: 'ALL' | 'WEEKLY' | 'BIWEEKLY'; workerRate: number; employerRate: number; baseCap?: number | null; effectiveFrom: string; effectiveTo?: string | null; sourceReference: string; verifiedAt: string; applicability?: Record<string, unknown>; active?: boolean }) => Promise<{ id: string; companyId: string; code: string; description: string; base: 'normalSalary' | 'integralSalary' | 'grossSalary'; frequencyScope: 'ALL' | 'WEEKLY' | 'BIWEEKLY'; workerRate: number; employerRate: number; baseCap: number | null; effectiveFrom: string; effectiveTo: string | null; sourceReference: string; verifiedAt: string; applicability: Record<string, unknown>; active: boolean }>;
      createVatFiscalIncident: (token: string, input: { companyId: string; purchaseId: string; vatVoucherId?: string; declarationId?: string; declarationEventIds?: string[]; bankMovementIds?: string[]; reason: string; detectedAt: string }) => Promise<import('./types/vatFiscalIncidents').VatFiscalIncident>;
      listVatFiscalIncidents: (token: string, filters: { companyId: string }) => Promise<import('./types/vatFiscalIncidents').VatFiscalIncident[]>;
      recordVatFiscalIncidentEvent: (token: string, input: import('./types/vatFiscalIncidents').VatFiscalIncidentEventInput) => Promise<import('./types/vatFiscalIncidents').VatFiscalIncident>;
      savePdf: (input: { fileName: string; base64: string }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; bytes?: number }>;
      saveTextFile: (input: { fileName: string; content: string; contentType?: string; encoding?: 'utf-8' | 'iso-8859-1' }) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; bytes?: number }>;
      createBackup: (token: string) => Promise<{ ok: boolean; canceled?: boolean; destination?: string; documentCount?: number; databaseSha256?: string; createdAt?: string }>;
      restoreBackup: (token: string) => Promise<{ ok: boolean; canceled?: boolean; reloadRequired?: boolean; restoredAt?: string }>;
      exportCompanyData: (token: string, input: { format: 'sqlite' | 'json' }) => Promise<{ ok: boolean; canceled?: boolean; format?: 'sqlite' | 'json'; destination?: string; documentCount?: number; databaseSha256?: string; bytes?: number; companyId?: string }>;
      getDemoUsage: () => Record<string, number>;
      consumeDemoAction: (moduleKey: string) => {
        ok: boolean;
        used?: number;
        usage?: Record<string, number>;
        error?: string;
      };
    };
  }
}
