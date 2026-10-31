export {};
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
      previewInflationIndexImport: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesCode: string; metricType: string; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; sourceSha256: string; sourceBytes: number }>;
      importInflationIndexSeries: (token: string, input: InflationIndexImportInput) => Promise<{ ok: boolean; seriesId: string; sourceId: string; firstPeriod: string; lastPeriod: string; observationCount: number; missingMonths: string[]; sourceSha256: string; approvalStatus: string }>;
      reviewInflationIndexSeries: (token: string, input: { seriesId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }) => Promise<{ ok: boolean; approvalId: string; seriesId: string; decision: string }>;
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
