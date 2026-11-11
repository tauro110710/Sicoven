'use strict';
const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');

function requiredText(value, label, max = 2000, min = 1) {
  const result = String(value ?? '').trim();
  if (result.length < min || result.length > max) throw new Error(label + ' debe contener entre ' + min + ' y ' + max + ' caracteres.');
  return result;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function uniqueIds(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(label + ' debe ser una lista.');
  const ids = value.map(item => requiredText(item, label, 120));
  if (new Set(ids).size !== ids.length) throw new Error(label + ' contiene identificadores duplicados.');
  return ids;
}
function readAccountingState(db) {
  const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if (!row) throw new Error('No existe un estado contable local para validar las referencias fiscales.');
  try {
    const state = JSON.parse(row.state_json);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('invalid');
    return state;
  } catch {
    throw new Error('El estado contable SQLite es ilegible; se bloqueó el expediente para proteger los datos.');
  }
}
function byId(items, id) {
  return (Array.isArray(items) ? items : []).find(item => String(item?.id || '') === String(id));
}
function resolveOriginalPurchase(state, purchase) {
  if (purchase.documentType === '01') return purchase;
  const linkedById = purchase.originalPurchaseId
    ? byId(state.purchases, purchase.originalPurchaseId)
    : null;
  const linked = linkedById && linkedById.documentType === '01' &&
    String(linkedById.companyId) === String(purchase.companyId)
    ? linkedById
    : (Array.isArray(state.purchases) ? state.purchases.find(item =>
      String(item.companyId) === String(purchase.companyId) && item.documentType === '01' &&
      String(item.invoiceNumber || '').trim().toUpperCase() ===
        String(purchase.affectedInvoiceNumber || '').trim().toUpperCase()) : null);
  if (!linked || linked.documentType !== '01' || String(linked.companyId) !== String(purchase.companyId)) {
    throw new Error('La nota debe enlazarse con su factura original de la misma empresa antes de abrir la incidencia.');
  }
  if (purchase.affectedInvoiceNumber &&
      String(purchase.affectedInvoiceNumber).trim().toUpperCase() !== String(linked.invoiceNumber || '').trim().toUpperCase()) {
    throw new Error('La factura enlazada no coincide con el número de documento afectado por la nota.');
  }
  return linked;
}
function validateReferences(state, input, companyId, expectedDeclarationId = null) {
  const voucherId = input.vatVoucherId ? requiredText(input.vatVoucherId, 'Comprobante IVA', 120) : null;
  const declarationId = input.declarationId ? requiredText(input.declarationId, 'Declaración IVA', 120) : null;
  const declarationEventIds = uniqueIds(input.declarationEventIds, 'Eventos de declaración');
  const bankMovementIds = uniqueIds(input.bankMovementIds, 'Movimientos bancarios');
  const journalEntryId = input.journalEntryId ? requiredText(input.journalEntryId, 'Asiento correctivo', 120) : null;
  const voucher = voucherId ? byId(state.vatVouchers, voucherId) : null;
  if (voucherId && (!voucher || String(voucher.companyId) !== companyId)) throw new Error('El comprobante IVA no existe o pertenece a otra empresa.');
  const declaration = declarationId ? byId(state.vatWithholdingDeclarations, declarationId) : null;
  if (declarationId && (!declaration || String(declaration.companyId) !== companyId)) throw new Error('La declaración IVA no existe o pertenece a otra empresa.');
  if (expectedDeclarationId && declarationId !== expectedDeclarationId) throw new Error('Los eventos deben conservar la declaración original del expediente.');
  if (declaration && voucherId && !(Array.isArray(declaration.voucherIds) && declaration.voucherIds.map(String).includes(voucherId))) {
    throw new Error('El comprobante indicado no forma parte de la declaración seleccionada.');
  }
  if (declarationEventIds.length && !declaration) throw new Error('Los eventos de declaración requieren una declaración vinculada.');
  const events = declarationEventIds.map(id => {
    const event = (Array.isArray(state.vatWithholdingDeclarationEvents) ? state.vatWithholdingDeclarationEvents : [])
      .find(item => String(item.id) === id);
    if (!event || String(event.declarationId) !== String(declarationId)) throw new Error('Un evento fiscal no existe o no pertenece a la declaración vinculada.');
    return event;
  });
  if (bankMovementIds.length && !events.some(event => event.eventType === 'PAYMENT')) {
    throw new Error('Los movimientos bancarios solo pueden vincularse mediante eventos PAYMENT existentes.');
  }
  for (const movementId of bankMovementIds) {
    const movement = byId(state.bankStatementMovements, movementId);
    const linked = events.some(event => event.eventType === 'PAYMENT' &&
      Array.isArray(event.bankStatementMovementIds) && event.bankStatementMovementIds.map(String).includes(movementId));
    if (!movement || String(movement.companyId) !== companyId || !linked) {
      throw new Error('El movimiento bancario debe existir en la misma empresa y estar enlazado a uno de los pagos seleccionados.');
    }
  }
  if (journalEntryId) {
    const journal = byId(state.journalEntries, journalEntryId);
    if (!journal || String(journal.companyId) !== companyId) throw new Error('El asiento correctivo no existe o pertenece a otra empresa.');
  }
  return { voucherId, declarationId, declarationEventIds, bankMovementIds, journalEntryId };
}
function initializeVatFiscalIncidentSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vat_fiscal_incidents (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, purchase_id TEXT NOT NULL,
      original_purchase_id TEXT NOT NULL, document_type TEXT NOT NULL CHECK(document_type IN ('01','02','03')),
      document_number TEXT NOT NULL, affected_invoice_number TEXT, vat_voucher_id TEXT,
      declaration_id TEXT, declaration_event_ids_json TEXT NOT NULL, bank_movement_ids_json TEXT NOT NULL,
      reason TEXT NOT NULL, detected_at TEXT NOT NULL, created_by_user_id INTEGER,
      created_by_username TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(company_id,purchase_id)
    );
    CREATE TABLE IF NOT EXISTS vat_fiscal_incident_events (
      id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES vat_fiscal_incidents(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('INCIDENT_RECORDED','REVIEW_RECORDED','ACTION_RECORDED')),
      decision_text TEXT NOT NULL, external_reference TEXT, journal_entry_id TEXT,
      declaration_event_ids_json TEXT NOT NULL, bank_movement_ids_json TEXT NOT NULL,
      actor_user_id INTEGER, actor_username TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS vat_fiscal_incident_references (
      company_id TEXT NOT NULL,
      reference_type TEXT NOT NULL CHECK(reference_type IN ('VAT_VOUCHER','DECLARATION_EVENT','BANK_MOVEMENT')),
      reference_id TEXT NOT NULL,
      incident_id TEXT NOT NULL REFERENCES vat_fiscal_incidents(id),
      PRIMARY KEY(company_id,reference_type,reference_id)
    );
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incident_references_no_update BEFORE UPDATE ON vat_fiscal_incident_references
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incident_references is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incident_references_no_delete BEFORE DELETE ON vat_fiscal_incident_references
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incident_references is append-only'); END;
    CREATE INDEX IF NOT EXISTS idx_vat_fiscal_incidents_company_date ON vat_fiscal_incidents(company_id,detected_at,created_at);
    CREATE INDEX IF NOT EXISTS idx_vat_fiscal_incident_events_incident ON vat_fiscal_incident_events(incident_id,created_at);
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incidents_no_update BEFORE UPDATE ON vat_fiscal_incidents
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incidents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incidents_no_delete BEFORE DELETE ON vat_fiscal_incidents
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incidents is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incident_events_no_update BEFORE UPDATE ON vat_fiscal_incident_events
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incident_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS vat_fiscal_incident_events_no_delete BEFORE DELETE ON vat_fiscal_incident_events
      BEGIN SELECT RAISE(ABORT, 'vat_fiscal_incident_events is append-only'); END;
  `);
}
function requireAdmin(actor) {
  if (!actor?.username || !hasFullSystemAccess(actor)) throw new Error('Se requiere una sesión autenticada con rol contable (admin o contador) para gestionar incidencias fiscales.');
}
function mapIncident(row) {
  return {
    id: row.id, companyId: row.company_id, purchaseId: row.purchase_id,
    originalPurchaseId: row.original_purchase_id, documentType: row.document_type,
    documentNumber: row.document_number, affectedInvoiceNumber: row.affected_invoice_number,
    vatVoucherId: row.vat_voucher_id, declarationId: row.declaration_id,
    declarationEventIds: JSON.parse(row.declaration_event_ids_json),
    bankMovementIds: JSON.parse(row.bank_movement_ids_json), reason: row.reason,
    detectedAt: row.detected_at, createdByUserId: row.created_by_user_id,
    createdByUsername: row.created_by_username, createdAt: row.created_at
  };
}
function getVatFiscalIncident(db, incidentId) {
  const row = db.prepare('SELECT * FROM vat_fiscal_incidents WHERE id=?').get(String(incidentId));
  if (!row) return null;
  const events = db.prepare('SELECT * FROM vat_fiscal_incident_events WHERE incident_id=? ORDER BY created_at,id').all(row.id)
    .map(item => ({
      id: item.id, eventType: item.event_type, decisionText: item.decision_text,
      externalReference: item.external_reference, journalEntryId: item.journal_entry_id,
      declarationEventIds: JSON.parse(item.declaration_event_ids_json),
      bankMovementIds: JSON.parse(item.bank_movement_ids_json),
      actorUserId: item.actor_user_id, actorUsername: item.actor_username, createdAt: item.created_at
    }));
  const status = events.some(item => item.eventType === 'ACTION_RECORDED') ? 'ACTION_DOCUMENTED'
    : events.some(item => item.eventType === 'REVIEW_RECORDED') ? 'REVIEW_DOCUMENTED' : 'OPEN';
  return { ...mapIncident(row), events, status, resolved: false };
}
function createVatFiscalIncident(db, input, actor) {
  requireAdmin(actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('La solicitud de incidencia fiscal es inválida.');
  const state = readAccountingState(db);
  const companyId = requiredText(input.companyId, 'Empresa', 120);
  if (!byId(state.companies, companyId)) throw new Error('La empresa seleccionada no existe en SQLite.');
  const purchaseId = requiredText(input.purchaseId, 'Documento fuente', 120);
  const purchase = byId(state.purchases, purchaseId);
  if (!purchase || String(purchase.companyId) !== companyId || !['01','02','03'].includes(String(purchase.documentType))) {
    throw new Error('El documento fuente debe ser una factura, nota de débito o nota de crédito de compras de la misma empresa.');
  }
  const original = resolveOriginalPurchase(state, purchase);
  const references = validateReferences(state, input, companyId);
  if (references.voucherId && String(byId(state.vatVouchers, references.voucherId).purchaseRecordId) !== String(original.id)) {
    throw new Error('El comprobante IVA debe corresponder a la factura original vinculada al documento fuente.');
  }
  const reason = requiredText(input.reason, 'Motivo de la incidencia', 2000, 15);
  const detectedAt = String(input.detectedAt || '');
  if (!validDate(detectedAt)) throw new Error('La fecha de detección debe tener formato YYYY-MM-DD y ser válida.');
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const initialText = 'Incidencia fiscal registrada. No implica rectificación, aceptación del SENIAT ni resolución tributaria.';
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO vat_fiscal_incidents
      (id,company_id,purchase_id,original_purchase_id,document_type,document_number,affected_invoice_number,
       vat_voucher_id,declaration_id,declaration_event_ids_json,bank_movement_ids_json,reason,detected_at,
       created_by_user_id,created_by_username,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, companyId, purchaseId, String(original.id), String(purchase.documentType),
        String(purchase.creditNoteNumber || purchase.debitNoteNumber || purchase.invoiceNumber || ''),
        purchase.affectedInvoiceNumber || null, references.voucherId, references.declarationId,
        JSON.stringify(references.declarationEventIds), JSON.stringify(references.bankMovementIds),
        reason, detectedAt, actor.id ?? null, actor.username, now);
    db.prepare(`INSERT INTO vat_fiscal_incident_events
      (id,incident_id,event_type,decision_text,external_reference,journal_entry_id,
       declaration_event_ids_json,bank_movement_ids_json,actor_user_id,actor_username,created_at)
      VALUES(?,?,'INCIDENT_RECORDED',?,NULL,NULL,'[]','[]',?,?,?)`)
      .run(crypto.randomUUID(), id, initialText, actor.id ?? null, actor.username, now);
    const insertReference = db.prepare('INSERT INTO vat_fiscal_incident_references(company_id,reference_type,reference_id,incident_id) VALUES(?,?,?,?)');
    if (references.voucherId) insertReference.run(companyId, 'VAT_VOUCHER', references.voucherId, id);
    for (const referenceId of references.declarationEventIds) insertReference.run(companyId, 'DECLARATION_EVENT', referenceId, id);
    for (const referenceId of references.bankMovementIds) insertReference.run(companyId, 'BANK_MOVEMENT', referenceId, id);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('vat_fiscal_incident_created', JSON.stringify({ incidentId: id, companyId, purchaseId, originalPurchaseId: original.id, actor: actor.username }));
  });
  save();
  return getVatFiscalIncident(db, id);
}
function recordVatFiscalIncidentEvent(db, input, actor) {
  requireAdmin(actor);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('El evento de incidencia es inválido.');
  const incidentId = requiredText(input.incidentId, 'Incidencia', 120);
  const incident = db.prepare('SELECT * FROM vat_fiscal_incidents WHERE id=?').get(incidentId);
  if (!incident) throw new Error('La incidencia fiscal no existe.');
  const eventType = String(input.eventType || '');
  if (!['REVIEW_RECORDED','ACTION_RECORDED'].includes(eventType)) throw new Error('Tipo de evento de incidencia no admitido.');
  const decisionText = requiredText(input.decisionText, 'Decisión o actuación documentada', 3000, 20);
  if (String(input.declarationId || '') !== String(incident.declaration_id || '')) {
    throw new Error('La declaración del expediente es inmutable; no se puede incorporar ni sustituir después de registrar la incidencia.');
  }
  const state = readAccountingState(db);
  const references = validateReferences(state, input, String(incident.company_id), incident.declaration_id);
  if (references.voucherId && references.voucherId !== incident.vat_voucher_id) throw new Error('No se puede sustituir el comprobante original del expediente.');
  if (references.journalEntryId) {
    const voucher = incident.vat_voucher_id ? byId(state.vatVouchers, incident.vat_voucher_id) : null;
    const linkedCorrectionIds = voucher
      ? [...new Set([voucher.correctionEntryId, ...(Array.isArray(voucher.correctionEntryIds) ? voucher.correctionEntryIds : [])].filter(Boolean).map(String))]
      : [];
    if (!linkedCorrectionIds.includes(references.journalEntryId)) {
      throw new Error('El asiento correctivo debe estar enlazado previamente al comprobante IVA original; no se aceptan asientos de la misma empresa sin vínculo fiscal.');
    }
  }
  const priorEvents = JSON.parse(incident.declaration_event_ids_json);
  const priorMovements = JSON.parse(incident.bank_movement_ids_json);
  if (references.declarationEventIds.some(id => !priorEvents.includes(id))) throw new Error('El evento no puede incorporar referencias fiscales ajenas al expediente original.');
  if (references.bankMovementIds.some(id => !priorMovements.includes(id))) throw new Error('El evento no puede incorporar movimientos bancarios ajenos al expediente original.');
  const externalReference = input.externalReference ? requiredText(input.externalReference, 'Referencia externa', 500, 4) : null;
  if (eventType === 'ACTION_RECORDED' && !externalReference &&
      !references.journalEntryId && references.declarationEventIds.length === 0 &&
      references.bankMovementIds.length === 0) {
    throw new Error('Una actuación fiscal requiere al menos una referencia externa, asiento correctivo, evento de declaración o movimiento bancario verificable.');
  }
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO vat_fiscal_incident_events
      (id,incident_id,event_type,decision_text,external_reference,journal_entry_id,
       declaration_event_ids_json,bank_movement_ids_json,actor_user_id,actor_username,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id, incidentId, eventType, decisionText, externalReference, references.journalEntryId,
        JSON.stringify(references.declarationEventIds), JSON.stringify(references.bankMovementIds),
        actor.id ?? null, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('vat_fiscal_incident_event_recorded', JSON.stringify({ incidentId, eventId: id, eventType, journalEntryId: references.journalEntryId, actor: actor.username }));
  });
  save();
  return getVatFiscalIncident(db, incidentId);
}
function listVatFiscalIncidents(db, filters = {}) {
  const companyId = filters.companyId ? requiredText(filters.companyId, 'Empresa', 120) : null;
  const rows = companyId
    ? db.prepare('SELECT * FROM vat_fiscal_incidents WHERE company_id=? ORDER BY detected_at DESC,created_at DESC').all(companyId)
    : db.prepare('SELECT * FROM vat_fiscal_incidents ORDER BY detected_at DESC,created_at DESC').all();
  return rows.map(row => getVatFiscalIncident(db, row.id));
}
function registerVatFiscalIncidentIpc({ ipcMain, db, licenseView, getActiveSession, withDatabase = null }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      (withDatabase !== null && typeof withDatabase !== 'function')) {
    throw new Error('No se pudo registrar el puente de incidencias fiscales IVA.');
  }
  if (!withDatabase) initializeVatFiscalIncidentSchema(db);
  const runWithDatabase = (token, operation) => withDatabase
    ? withDatabase(token, (activeDb, companyId) => operation(activeDb, companyId))
    : operation(db, null);
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    requireAdmin(actor);
    return actor;
  };
  ipcMain.handle('sicoven:vat-fiscal-incident-create', (_event, token, input) => {
    const actor = authenticate(token);
    return runWithDatabase(token, (activeDb, companyId) => {
      if (companyId && String(input?.companyId || '') !== companyId) throw new Error('La incidencia no pertenece a la empresa activa.');
      return createVatFiscalIncident(activeDb, input, actor);
    });
  });
  ipcMain.handle('sicoven:vat-fiscal-incident-list', (_event, token, filters) => {
    authenticate(token);
    return runWithDatabase(token, (activeDb, companyId) => {
      if (companyId && filters?.companyId && String(filters.companyId) !== companyId) throw new Error('La consulta no pertenece a la empresa activa.');
      const state = readAccountingState(activeDb);
      const requestedCompanyId = companyId || filters?.companyId;
      if (requestedCompanyId && !byId(state.companies, requestedCompanyId)) throw new Error('La empresa solicitada no existe.');
      return listVatFiscalIncidents(activeDb, { ...(filters || {}), ...(companyId ? { companyId } : {}) });
    });
  });
  ipcMain.handle('sicoven:vat-fiscal-incident-event', (_event, token, input) => {
    const actor = authenticate(token);
    return runWithDatabase(token, (activeDb, companyId) => {
      const incident = activeDb.prepare('SELECT company_id AS companyId FROM vat_fiscal_incidents WHERE id=?').get(String(input?.incidentId || ''));
      if (!incident || (companyId && String(incident.companyId) !== companyId)) throw new Error('La incidencia no pertenece a la empresa activa.');
      return recordVatFiscalIncidentEvent(activeDb, input, actor);
    });
  });
}
module.exports = {
  initializeVatFiscalIncidentSchema, createVatFiscalIncident,
  recordVatFiscalIncidentEvent, getVatFiscalIncident, listVatFiscalIncidents,
  registerVatFiscalIncidentIpc
};
