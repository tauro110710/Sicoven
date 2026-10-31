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
      listAdmins: (token: string) => Promise<{ ok: boolean; message?: string; admins?: Array<{ id: number; username: string; isSeed: boolean; createdAt: string }> }>;
      createAdmin: (token: string, input: { username: string; password: string }) => Promise<{ ok: boolean; message?: string }>;
      deleteSeedAdmin: (token: string) => Promise<{ ok: boolean; message?: string }>;
      load: (token: string) => Promise<Record<string, unknown> | null>;
      listAuditEvents: (token: string, limit?: number) => Promise<{ ok: boolean; message?: string; events?: Array<{ id: number; eventType: string; details: Record<string, unknown>; createdAt: string }> }>;
      save: (token: string, state: Record<string, unknown>) => Promise<{ ok: boolean; savedAt: string }>;
      reopenAccountingPeriod: (token: string, input: { companyId: string; reopenedThroughDate: string | null; reason: string }) => Promise<{ ok: boolean; reopeningId: string; company?: { id: string; name: string; closedThroughDate?: string } }>;
      resetAccounting: (token: string) => Promise<{ ok: boolean; cleared: boolean; verified: boolean }>;
      listInflationIndexSeries: (token: string) => Promise<Array<Record<string, unknown>>>;
      previewInflationIndexImport: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesCode: InflationIndexImportInput['seriesCode']; metricType: InflationIndexImportInput['metricType']; basePeriod?: string | null; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; statusCounts: Record<string, number>; sourceSha256: string; sourceBytes: number }>;
      importInflationIndexSeries: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesId: string; sourceId: string; seriesVersion: number; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; statusCounts: Record<string, number>; sourceSha256: string; approvalStatus: string }>;
      reviewInflationIndexSeries: (token: string, input: { seriesId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) => Promise<{ ok: boolean; approvalId: string; seriesId: string; decision: string }>;
      listInflationClassifications: (token: string, filters?: { companyId?: string; fiscalYear?: number }) => Promise<Array<InflationClassificationInput & { createdAt: string; status: string; reviewDecision: string | null; reviewer?: string | null; reviewedAt?: string | null }>>;
      saveInflationClassification: (token: string, input: InflationClassificationInput) => Promise<{ ok: boolean; decisionId: string; version: number; status: string; treatment: string }>;
      reviewInflationClassification: (token: string, input: { decisionId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) => Promise<{ ok: boolean; reviewId: string; decisionId: string; decision: string }>; 
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
