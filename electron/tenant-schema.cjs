'use strict';

const { initializeAccountingPersistenceSchema } = require('./accounting-persistence.cjs');
const { initializeOperationReceiptSchema } = require('./operation-receipts.cjs');
const { initializeCorrectionWorkflow } = require('./accounting-correction-workflow.cjs');
const { initializeInflationIndexSchema } = require('./inflation-indexes.cjs');
const { initializeInflationClassificationSchema } = require('./inflation-classifications.cjs');
const { initializeInflationSourceDossierSchema } = require('./inflation-source-dossiers.cjs');
const { initializeDocumentVaultSchema } = require('./supporting-documents.cjs');
const { initializeVatFiscalIncidentSchema } = require('./vat-fiscal-incidents.cjs');
const { initializePayrollSchema } = require('./payroll-schema.cjs');

function initializeTenantDatabase(db) {
  if (!db || typeof db.exec !== 'function') {
    throw new TypeError('Se requiere una conexión SQLite local para inicializar la empresa.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER IF NOT EXISTS audit_events_no_update
      BEFORE UPDATE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS audit_events_no_delete
      BEFORE DELETE ON audit_events
      BEGIN SELECT RAISE(ABORT, 'audit_events is append-only'); END;
  `);

  initializeAccountingPersistenceSchema(db);
  initializeCorrectionWorkflow(db);
  initializeInflationIndexSchema(db);
  initializeInflationClassificationSchema(db);
  initializeInflationSourceDossierSchema(db);
  initializeDocumentVaultSchema(db);
  initializeVatFiscalIncidentSchema(db);
  const payroll = initializePayrollSchema(db);

  return Object.freeze({
    operationalTables: [
      'app_state', 'audit_events', 'operation_receipts', 'operation_intents', 'operation_intent_completions', 'accounting_exercise_links', 'accounting_year_reopenings', 'party_masters',
      'period_reopenings', 'accounting_correction_cases', 'accounting_correction_case_events',
      'accounting_correction_case_workflow_events', 'inflation_index_sources',
      'inflation_index_series', 'inflation_index_observations', 'inflation_index_approvals',
      'inflation_classification_decisions', 'inflation_classification_reviews',
      'inflation_source_dossiers', 'inflation_source_dossier_evidence',
      'inflation_source_dossier_reviews', 'supporting_documents',
      'supporting_document_events', 'vat_fiscal_incidents',
      'vat_fiscal_incident_events', 'vat_fiscal_incident_references',
      ...payroll.tables
    ]
  });
}

function migrateTenantDatabase(db, { fromVersion, toVersion } = {}) {
  if ((fromVersion === 1 && (toVersion === 2 || toVersion === 3)) ||
      (fromVersion === 2 && toVersion === 3)) {
    // Additive and idempotent: schema v3 adds durable operation intents and
    // completions to databases that already contain operation receipts.
    initializeOperationReceiptSchema(db);
    return;
  }
  throw new Error('No existe una migración SICOVEN registrada de esquema ' + fromVersion + ' a ' + toVersion + '.');
}

module.exports = { initializeTenantDatabase, migrateTenantDatabase };
