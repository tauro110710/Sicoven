'use strict';

const crypto = require('node:crypto');


const CORRECTION_EVIDENCE_RULES = Object.freeze({
  SALE: { collection:'sales', links:['originalSaleId','correctedSaleId','correctionOfSaleId','affectedSaleId','originalDocumentId'] },
  PURCHASE: { collection:'purchases', links:['originalPurchaseId','correctedPurchaseId','correctionOfPurchaseId','affectedPurchaseId','originalDocumentId'] },
  JOURNAL_ENTRY: { collection:'journalEntries', links:['reversalOfEntryId','reversesEntryId','correctionOfEntryId','correctsEntryId'] },
  BANK_MOVEMENT: { collection:'bankStatementMovements', links:['reversalOfMovementId','correctionOfMovementId','correctsMovementId','originalMovementId'] },
  INVENTORY_MOVEMENT: { collection:'movements', links:['correctionForMovementId','reversalOfMovementId','correctsMovementId','originalMovementId'] },
  VAT_VOUCHER: { collection:'vatVouchers', links:['correctionOfVoucherId','originalVoucherId','reversalOfVoucherId','correctsVoucherId'] },
  ISLR_VOUCHER: { collection:'islrVouchers', links:['correctionOfVoucherId','originalVoucherId','reversalOfVoucherId','correctsVoucherId'] },
  VAT_DECLARATION: { collection:'vatWithholdingDeclarations', links:['correctionOfDeclarationId','originalDeclarationId','replacesDeclarationId','rectifiesDeclarationId'] },
  ISLR_EVENT: { collection:'islrFiscalEvents', links:['correctionOfEventId','originalEventId','reversesEventId','rectifiesEventId'] },
  INVENTORY_PRODUCT: { collection:'movements', links:['correctionOfProductId','adjustmentForProductId','productId'] },
  BCV_RATE: { collection:'companies', links:['correctionOfBcvRateId','originalBcvRateId','replacesBcvRateId'] }
});
function findLinkedCorrectionEvidence(state, item, reference) {
  const rule = CORRECTION_EVIDENCE_RULES[String(item.entity_type)];
  if (!rule) return null;
  const sourceCollection = item.entity_type === 'BCV_RATE' ? 'companies' :
    item.entity_type === 'INVENTORY_PRODUCT' ? 'products' : rule.collection;
  const source = Array.isArray(state[sourceCollection]) && state[sourceCollection].find(record =>
    String(record.id) === String(item.entity_id) && String(record.companyId || item.company_id) === String(item.company_id));
  if (!source) return null;
  const candidates = Array.isArray(state[rule.collection]) ? state[rule.collection] : [];
  const normalizedReference = String(reference || '').trim().toLocaleUpperCase();
  if (!normalizedReference) return null;
  const referenceFields = ['id','documentNumber','invoiceNumber','voucherNumber','declarationNumber','entryNumber',
    'opNumber','documentRef','number','reference','referenceDoc','controlNumber','creditNoteNumber','debitNoteNumber'];
  return candidates.find(candidate => {
    if (String(candidate.companyId || '') !== String(item.company_id) || String(candidate.id) === String(item.entity_id)) return false;
    const linked = rule.links.some(field => candidate[field] != null && String(candidate[field]) === String(item.entity_id));
    if (!linked) return false;
    return referenceFields.some(field => candidate[field] != null &&
      String(candidate[field]).trim().toLocaleUpperCase() === normalizedReference);
  }) || null;
}

function initializeCorrectionWorkflow(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_correction_cases (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, correction_type TEXT NOT NULL, source_ref TEXT NOT NULL,
      correction_ref TEXT NOT NULL, reason TEXT NOT NULL, workpaper TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','EXECUTED')),
      requested_by INTEGER NOT NULL, requested_by_name TEXT NOT NULL,
      reviewed_by INTEGER, reviewed_by_name TEXT, review_reason TEXT,
      executed_by INTEGER, executed_by_name TEXT, execution_ref TEXT,
      created_at TEXT NOT NULL, reviewed_at TEXT, executed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_correction_cases_company_status
      ON accounting_correction_cases(company_id,status,created_at);
    CREATE TRIGGER IF NOT EXISTS correction_cases_valid_transition BEFORE UPDATE ON accounting_correction_cases
      WHEN NOT (
        (OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED')) OR
        (OLD.status='APPROVED' AND NEW.status='EXECUTED')
      )
      BEGIN SELECT RAISE(ABORT, 'invalid correction case transition'); END;
    CREATE TRIGGER IF NOT EXISTS correction_cases_segregation BEFORE UPDATE ON accounting_correction_cases
      WHEN (OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.reviewed_by=OLD.requested_by)
        OR (OLD.status='APPROVED' AND NEW.status='EXECUTED' AND
          (NEW.executed_by=OLD.requested_by OR NEW.executed_by=OLD.reviewed_by))
      BEGIN SELECT RAISE(ABORT, 'correction case segregation of duties violated'); END;
    CREATE TRIGGER IF NOT EXISTS correction_cases_source_immutable BEFORE UPDATE ON accounting_correction_cases
      WHEN NEW.id<>OLD.id OR NEW.company_id<>OLD.company_id OR NEW.entity_type<>OLD.entity_type OR
        NEW.entity_id<>OLD.entity_id OR NEW.correction_type<>OLD.correction_type OR
        NEW.source_ref<>OLD.source_ref OR NEW.correction_ref<>OLD.correction_ref OR
        NEW.reason<>OLD.reason OR NEW.workpaper<>OLD.workpaper OR
        NEW.requested_by<>OLD.requested_by OR NEW.requested_by_name<>OLD.requested_by_name OR
        NEW.created_at<>OLD.created_at
      BEGIN SELECT RAISE(ABORT, 'correction case source is immutable'); END;
    CREATE TRIGGER IF NOT EXISTS correction_cases_no_delete BEFORE DELETE ON accounting_correction_cases
      BEGIN SELECT RAISE(ABORT, 'correction cases cannot be deleted'); END;
    CREATE TABLE IF NOT EXISTS accounting_correction_case_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('REQUESTED','APPROVED','REJECTED','EXECUTED')),
      actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL,
      metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS correction_case_events_no_update BEFORE UPDATE ON accounting_correction_case_events
      BEGIN SELECT RAISE(ABORT, 'correction case events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS correction_case_events_no_delete BEFORE DELETE ON accounting_correction_case_events
      BEGIN SELECT RAISE(ABORT, 'correction case events are append-only'); END;
  `);
}
function requireAdmin(actor) {
  if (!actor || actor.role !== 'admin' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 || !String(actor.username || '').trim()) {
    throw new Error('Se requiere una sesión administrativa autenticada con identidad válida.');
  }
}
function appendEvent(db, _tx, event) {
  db.prepare('INSERT INTO accounting_correction_case_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(event.id, event.type, Number(event.actor.id), String(event.actor.username || ''),
      event.reason, JSON.stringify(event.metadata || {}), event.at);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run('accounting_correction_case_' + event.type.toLowerCase(), JSON.stringify({ caseId:event.id, actorUserId:Number(event.actor.id), actorUsername:String(event.actor.username || ''), reason:event.reason, metadata:event.metadata || {}, occurredAt:event.at }));
}
function registerCorrectionRequest(db, input, actor) {
  requireAdmin(actor);
  const required = ['companyId','entityType','entityId','correctionType','sourceDocumentRef','reason','workpaperNote'];
  for (const key of required) if (!String(input?.[key] || '').trim()) throw new Error('Falta el campo obligatorio: '+key);
  if (String(input.reason).trim().length < 15 || String(input.workpaperNote).trim().length < 15) throw new Error('El motivo y el papel de trabajo deben tener al menos 15 caracteres.');
  const limits = { companyId:160, entityType:40, entityId:160, correctionType:80, sourceDocumentRef:160,
    correctionDocumentRef:160, reason:2000, workpaperNote:4000 };
  for (const [key,max] of Object.entries(limits)) if (String(input[key] || '').length > max) throw new Error('El campo '+key+' excede el máximo permitido.');
  const allowedEntities = new Set(['SALE','PURCHASE','JOURNAL_ENTRY','BANK_MOVEMENT','INVENTORY_MOVEMENT',
    'VAT_VOUCHER','ISLR_VOUCHER','VAT_DECLARATION','ISLR_EVENT','INVENTORY_PRODUCT','BCV_RATE']);
  if (!allowedEntities.has(String(input.entityType))) throw new Error('Tipo de registro origen no admitido.');

  const id = crypto.randomUUID(), at = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO accounting_correction_cases
      (id,company_id,entity_type,entity_id,correction_type,source_ref,correction_ref,reason,workpaper,status,requested_by,requested_by_name,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,'PENDING_REVIEW',?,?,?)`).run(id,String(input.companyId),String(input.entityType),String(input.entityId),
      String(input.correctionType),String(input.sourceDocumentRef),String(input.correctionDocumentRef || ''),String(input.reason),String(input.workpaperNote),
      Number(actor.id),String(actor.username || ''),at);
    appendEvent(db, tx, {id,type:'REQUESTED',actor,reason:String(input.reason),metadata:{companyId:String(input.companyId),entityType:String(input.entityType),entityId:String(input.entityId)},at});
  });
  tx();
  return getCorrectionCase(db,id);
}
function reviewCorrectionRequest(db, {caseId,decision,reason}, actor) {
  requireAdmin(actor);
  if (!['APPROVE','REJECT'].includes(decision)) throw new Error('Decisión de revisión inválida.');
  if (String(reason || '').trim().length < 15) throw new Error('La decisión requiere una justificación de al menos 15 caracteres.');
  const at = new Date().toISOString();
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if (!item) throw new Error('El expediente de corrección no existe.');
    if (item.status !== 'PENDING_REVIEW') throw new Error('El expediente ya fue revisado y no admite otra decisión.');
    if (Number(item.requested_by) === Number(actor.id)) throw new Error('El solicitante no puede aprobar ni rechazar su propio expediente. Se requiere otro administrador.');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    db.prepare('UPDATE accounting_correction_cases SET status=?,reviewed_by=?,reviewed_by_name=?,review_reason=?,reviewed_at=? WHERE id=? AND status=?')
      .run(status,Number(actor.id),String(actor.username || ''),String(reason).trim(),at,item.id,'PENDING_REVIEW');
    appendEvent(db, tx, {id:item.id,type:decision==='APPROVE'?'APPROVED':'REJECTED',actor,reason:String(reason).trim(),metadata:{requestedBy:Number(item.requested_by)},at});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function markCorrectionExecuted(db, {caseId,executionRef,reason}, actor) {
  requireAdmin(actor);
  if (String(reason || '').trim().length < 15) throw new Error('La ejecución requiere una justificación de al menos 15 caracteres.');
  const at = new Date().toISOString();
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if (!item) throw new Error('El expediente de corrección no existe.');
    if (item.status !== 'APPROVED') throw new Error('Solo se puede ejecutar un expediente aprobado.');
    if (Number(item.requested_by) === Number(actor.id) || Number(item.reviewed_by) === Number(actor.id)) {
      throw new Error('El ejecutor debe ser distinto del solicitante y del aprobador.');
    }
    const normalizedExecutionRef = String(executionRef || '').trim().toLocaleUpperCase();
    if (!normalizedExecutionRef || normalizedExecutionRef.length > 160) throw new Error('Indique una referencia correctiva válida de hasta 160 caracteres.');
    if (normalizedExecutionRef === String(item.source_ref || '').trim().toLocaleUpperCase()) {
      throw new Error('La referencia de ejecución no puede ser la misma del documento original.');
    }
    db.prepare("UPDATE accounting_correction_cases SET status='EXECUTED',executed_by=?,executed_by_name=?,execution_ref=?,executed_at=? WHERE id=? AND status='APPROVED'")
      .run(Number(actor.id),String(actor.username || ''),String(executionRef).trim(),at,item.id);
    appendEvent(db, tx, {id:item.id,type:'EXECUTED',actor,reason:String(reason).trim(),metadata:{executionRef:String(executionRef).trim()},at});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function getCorrectionCase(db,id) {
  const row=db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(id));
  if(!row)return null;
  const events=db.prepare('SELECT id,event_type,actor_id,actor_name,reason,metadata_json,created_at FROM accounting_correction_case_events WHERE case_id=? ORDER BY id').all(row.id)
    .map(e=>({...e,metadata:JSON.parse(e.metadata_json)}));
  return {...row,events};
}
function listCorrectionCases(db,companyId) {
  return db.prepare('SELECT id FROM accounting_correction_cases WHERE company_id=? ORDER BY created_at DESC').all(String(companyId))
    .map(row=>getCorrectionCase(db,row.id));
}
module.exports={initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,markCorrectionExecuted,getCorrectionCase,listCorrectionCases,findLinkedCorrectionEvidence};
