const { contextBridge, ipcRenderer } = require('electron');

async function invokeRecoverableOperation(channel, token, input) {
  const operationId = String(input?.operationId || globalThis.crypto.randomUUID());
  const request = { ...input };
  delete request.operationId;
  // The durable intent is committed to the selected tenant SQLite database
  // before the business handler is invoked. It survives renderer/app restarts.
  if (channel !== 'sicoven:company-create') {
    await ipcRenderer.invoke('sicoven:operation-intent-prepare', token, {
      operationId, channel, request, requestMode: 'object'
    });
  }
  const requestWithId = { ...request, operationId };
  try {
    return await ipcRenderer.invoke(channel, token, requestWithId);
  } catch (firstError) {
    try {
      return await ipcRenderer.invoke(channel, token, requestWithId);
    } catch {
      throw firstError;
    }
  }
}

async function invokeRecoverableOperationArgs(channel, token, args) {
  const operationId = globalThis.crypto.randomUUID();
  const request = { runId: args[0], journalEntryId: args[1] };
  await ipcRenderer.invoke('sicoven:operation-intent-prepare', token, {
    operationId, channel, request, requestMode: 'payroll-run-confirm'
  });
  const requestArgs = [...args, operationId];
  try {
    return await ipcRenderer.invoke(channel, token, ...requestArgs);
  } catch (firstError) {
    try {
      return await ipcRenderer.invoke(channel, token, ...requestArgs);
    } catch {
      throw firstError;
    }
  }
}

async function invokeRecoverableDocumentAttachment(token, input) {
  const operationId = String(input?.operationId || globalThis.crypto.randomUUID());
  const request = { ...input, operationId };
  try {
    return await ipcRenderer.invoke('sicoven:document-attach', token, request);
  } catch (firstError) {
    try {
      return await ipcRenderer.invoke('sicoven:document-attach', token, request);
    } catch {
      throw firstError;
    }
  }
}

async function invokeRecoverableCompanyMetadata(token, input) {
  const operationId = String(input?.operationId || globalThis.crypto.randomUUID());
  const request = { ...input, operationId };
  try {
    return await ipcRenderer.invoke('sicoven:company-update-metadata', token, request);
  } catch (firstError) {
    try {
      return await ipcRenderer.invoke('sicoven:company-update-metadata', token, request);
    } catch {
      throw firstError;
    }
  }
}

async function recoverPendingOperationIntents(token, confirmed = false) {
  const pending = await ipcRenderer.invoke('sicoven:operation-intent-list', token);
  if (!confirmed) {
    return (pending || []).map(intent => ({
      operationId: intent.operationId, channel: intent.channel, status: 'PENDING'
    }));
  }
  const results = [];
  for (const intent of pending || []) {
    try {
      let result;
      if (intent.requestMode === 'payroll-run-confirm') {
        result = await ipcRenderer.invoke(intent.channel, token,
          intent.request.runId, intent.request.journalEntryId, intent.operationId);
      } else if (intent.requestMode === 'object') {
        result = await ipcRenderer.invoke(intent.channel, token,
          { ...intent.request, operationId: intent.operationId });
      } else {
        throw new Error('El formato de una operación pendiente no está reconocido.');
      }
      if (result && typeof result === 'object' && result.ok === false) {
        throw new Error(String(result.message || 'La operación pendiente no pudo completarse.'));
      }
      results.push({ operationId: intent.operationId, channel: intent.channel, status: 'RECOVERED' });
    } catch (error) {
      results.push({
        operationId: intent.operationId,
        channel: intent.channel,
        status: 'PENDING',
        message: error instanceof Error ? error.message : 'No se pudo recuperar la operación pendiente.'
      });
    }
  }
  return results;
}
contextBridge.exposeInMainWorld('sicovenStore', Object.freeze({
  getLicenseStatus: () => ipcRenderer.invoke('sicoven:license-status'),
  getImprovementConsent: () => ipcRenderer.invoke('sicoven:improvement-consent:get'),
  setImprovementConsent: (decision) => ipcRenderer.invoke('sicoven:improvement-consent:set', decision),
  activateLicense: (key) => ipcRenderer.invoke('sicoven:license-activate', key),
  revalidateLicense: () => ipcRenderer.invoke('sicoven:license-revalidate'),
  onLicenseStatusChanged: (callback) => { const listener = (_event, status) => callback(status); ipcRenderer.on('sicoven:license-status-changed', listener); return () => ipcRenderer.removeListener('sicoven:license-status-changed', listener); },
  getAuthSetupStatus: () => ipcRenderer.invoke('sicoven:auth-setup-status'),
  initializeAdmin: (input) => ipcRenderer.invoke('sicoven:auth-initialize', input),
  login: (credentials) => ipcRenderer.invoke('sicoven:auth-login', credentials),
  restoreSession: (token) => ipcRenderer.invoke('sicoven:auth-restore', token),
  logout: (token) => ipcRenderer.invoke('sicoven:auth-logout', token),
  listAdmins: (token) => ipcRenderer.invoke('sicoven:auth-list-admins', token),
  createAdmin: (token, input) => ipcRenderer.invoke('sicoven:auth-create-admin', token, input),
  deleteSeedAdmin: (token) => ipcRenderer.invoke('sicoven:auth-delete-seed', token),
  load: (token) => ipcRenderer.invoke('sicoven:load-state', token),
  flushPersistence: (token) => ipcRenderer.invoke('sicoven:persistence-flush', token),
  onPersistenceFlushRequest: (callback) => { const listener = (_event, request) => callback(request); ipcRenderer.on('sicoven:persistence-flush-request', listener); return () => ipcRenderer.removeListener('sicoven:persistence-flush-request', listener); },
  ackPersistenceFlush: (requestId, message) => ipcRenderer.send('sicoven:persistence-flush-ack', { requestId, ok: !message, ...(message ? { message: String(message) } : {}) }),
  inspectTenantMigrationPreflight: (token) => ipcRenderer.invoke('sicoven:tenant-migration-preflight', token),
  executeTenantMigration: (token) => ipcRenderer.invoke('sicoven:tenant-migration-execute', token),
  listAccessibleCompanies: (token) => ipcRenderer.invoke('sicoven:company-list-accessible', token),
  getTenantRegistryStatus: (token) => ipcRenderer.invoke('sicoven:company-registry-status', token),
  selectActiveCompany: (token, companyId) => ipcRenderer.invoke('sicoven:company-select-active', token, { companyId }),
  createCompany: (token, input) => invokeRecoverableOperation('sicoven:company-create', token, input),
  getActiveCompany: (token) => ipcRenderer.invoke('sicoven:company-get-active', token),
  updateCompanyMetadata: (token, input) => invokeRecoverableCompanyMetadata(token, input),
  listAuditEvents: (token, limit) => ipcRenderer.invoke('sicoven:audit-list', token, limit),
  recordAuditCorrection: (token, input) => invokeRecoverableOperation('sicoven:audit-record-correction', token, input),
  createCorrectionCase: (token, input) => invokeRecoverableOperation('sicoven:correction-case-create', token, input),
  reviewCorrectionCase: (token, input) => ipcRenderer.invoke('sicoven:correction-case-review', token, input),
  authorizeCorrectionCase: (token, input) => invokeRecoverableOperation('sicoven:correction-case-authorize', token, input),
  observeCorrectionCase: (token, input) => ipcRenderer.invoke('sicoven:correction-case-observe', token, input),
  resubmitCorrectionCase: (token, input) => ipcRenderer.invoke('sicoven:correction-case-resubmit', token, input),
  withdrawCorrectionCase: (token, input) => ipcRenderer.invoke('sicoven:correction-case-withdraw', token, input),
  executeCorrectionCase: (token, input) => invokeRecoverableOperation('sicoven:correction-case-execute', token, input),
  listCorrectionCases: (token, companyId) => ipcRenderer.invoke('sicoven:correction-case-list', token, companyId),
  save: (token, state, operationId) => ipcRenderer.invoke('sicoven:save-state', token, state, operationId),
  resolveSave: (token, state, operationId) => ipcRenderer.invoke('sicoven:save-state-result', token, state, operationId),
  reopenAccountingPeriod: (token, input) => invokeRecoverableOperation('sicoven:reopen-accounting-period', token, input),
  reopenAccountingYear: (token, input) => invokeRecoverableOperation('sicoven:reopen-accounting-year', token, input),
  resetAccounting: (token, options) => ipcRenderer.invoke('sicoven:reset-accounting', token, options),
  listInflationIndexSeries: (token) => ipcRenderer.invoke('sicoven:inflation-index-list', token),
  previewInflationIndexImport: (token, input) => ipcRenderer.invoke('sicoven:inflation-index-preview', token, input),
  importInflationIndexSeries: (token, input) => invokeRecoverableOperation('sicoven:inflation-index-import', token, input),
  reviewInflationIndexSeries: (token, input) => invokeRecoverableOperation('sicoven:inflation-index-review', token, input),
  listInflationClassifications: (token, filters) => ipcRenderer.invoke('sicoven:inflation-classification-list', token, filters),
  saveInflationClassification: (token, input) => invokeRecoverableOperation('sicoven:inflation-classification-save', token, input),
  reviewInflationClassification: (token, input) => invokeRecoverableOperation('sicoven:inflation-classification-review', token, input),
  assessInflationRemeReadiness: (token, ranges) => ipcRenderer.invoke('sicoven:inflation-reme-readiness', token, ranges),
  getInflationSourceDossierEvidence: (token, evidenceId) => ipcRenderer.invoke('sicoven:inflation-source-dossier-evidence', token, evidenceId),
  listInflationSourceDossiers: (token, filters) => ipcRenderer.invoke('sicoven:inflation-source-dossier-list', token, filters),
  createInflationSourceDossier: (token, input) => invokeRecoverableOperation('sicoven:inflation-source-dossier-create', token, input),
  reviewInflationSourceDossier: (token, input) => invokeRecoverableOperation('sicoven:inflation-source-dossier-review', token, input),
  attachSupportingDocument: (token, input) => invokeRecoverableDocumentAttachment(token, input),
  listSupportingDocuments: (token, filters) => ipcRenderer.invoke('sicoven:document-list', token, filters),
  reviewSupportingDocument: (token, input) => invokeRecoverableOperation('sicoven:document-review', token, input),
  openSupportingDocument: (token, documentId) => ipcRenderer.invoke('sicoven:document-open', token, documentId),
  listPayrollEmployees: (token) => ipcRenderer.invoke('sicoven:payroll-employees-list', token),
  listPayrollSalaryHistory: (token, employeeId) => ipcRenderer.invoke('sicoven:payroll-salary-history-list', token, employeeId),
  listConfirmedPayrollSalaryEntries: (token, employeeId, fromDate, toDate) => ipcRenderer.invoke('sicoven:payroll-salary-entries-list', token, employeeId, fromDate, toDate),
  getPayrollSalaryForDate: (token, employeeId, effectiveDate) => ipcRenderer.invoke('sicoven:payroll-salary-for-date', token, employeeId, effectiveDate),
  savePayrollEmployee: (token, input) => invokeRecoverableOperation('sicoven:payroll-employee-save', token, input),
  listPayrollRuns: (token) => ipcRenderer.invoke('sicoven:payroll-runs-list', token),
  getPayrollRun: (token, runId) => ipcRenderer.invoke('sicoven:payroll-run-get', token, runId),
  listPayrollSeveranceHistory: (token, employeeId) => ipcRenderer.invoke('sicoven:payroll-severance-history-list', token, employeeId),
  savePayrollSeveranceDeposit: (token, input) => invokeRecoverableOperation('sicoven:payroll-severance-deposit-save', token, input),
  savePayrollSeveranceInterestMonth: (token, input) => invokeRecoverableOperation('sicoven:payroll-severance-interest-save', token, input),
  calculatePayrollSeverance: (token, input) => ipcRenderer.invoke('sicoven:payroll-severance-calculate', token, input),
  calculatePayrollSeveranceInterest: (token, input) => ipcRenderer.invoke('sicoven:payroll-severance-interest-calculate', token, input),
  listPayrollLiquidations: (token, employeeId) => ipcRenderer.invoke('sicoven:payroll-liquidations-list', token, employeeId),
  createPayrollLiquidation: (token, input) => invokeRecoverableOperation('sicoven:payroll-liquidation-create', token, input),
  calculatePayrollAnnualRights: (token, input) => ipcRenderer.invoke('sicoven:payroll-annual-rights-calculate', token, input),
  calculatePayrollProfitSharing: (token, input) => ipcRenderer.invoke('sicoven:payroll-profit-sharing-calculate', token, input),
  createPayrollRun: (token, input) => invokeRecoverableOperation('sicoven:payroll-run-create', token, input),
  confirmPayrollRun: (token, runId, journalEntryId) => invokeRecoverableOperationArgs('sicoven:payroll-run-confirm', token, [runId, journalEntryId]),
  listPayrollLegalRules: (token) => ipcRenderer.invoke('sicoven:payroll-rules-list', token),
  savePayrollLegalRule: (token, input) => invokeRecoverableOperation('sicoven:payroll-rule-save', token, input),
  createVatFiscalIncident: (token, input) => invokeRecoverableOperation('sicoven:vat-fiscal-incident-create', token, input),
  listVatFiscalIncidents: (token, filters) => ipcRenderer.invoke('sicoven:vat-fiscal-incident-list', token, filters),
  recordVatFiscalIncidentEvent: (token, input) => invokeRecoverableOperation('sicoven:vat-fiscal-incident-event', token, input),
  savePdf: (input) => ipcRenderer.invoke('sicoven:pdf-save', input),
  saveTextFile: (input) => ipcRenderer.invoke('sicoven:text-save', input),
  recoverPendingOperationIntents: (token, confirmed) => recoverPendingOperationIntents(token, confirmed),
  createBackup: (token) => ipcRenderer.invoke('sicoven:backup-create', token),
  restoreBackup: (token) => ipcRenderer.invoke('sicoven:restore-execute', token),
  exportCompanyData: (token, input) => ipcRenderer.invoke('sicoven:company-export-data', token, input)
}));
