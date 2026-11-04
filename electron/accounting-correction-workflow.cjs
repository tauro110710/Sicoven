'use strict';

const crypto = require('node:crypto');


const CORRECTION_EVIDENCE_RULES = Object.freeze({
  SALE: { collection:'sales', links:['originalSaleId','correctedSaleId','correctionOfSaleId','affectedSaleId','originalDocumentId'] },
  PURCHASE: { collection:'purchases', links:['originalPurchaseId','correctedPurchaseId','correctionOfPurchaseId','affectedPurchaseId','originalDocumentId'] },
  JOURNAL_ENTRY: { collection:'journalEntries', links:['reversalOfEntryId','adjustmentForEntryId','reversesEntryId','correctionOfEntryId','correctsEntryId'] },
  INVENTORY_MOVEMENT: { collection:'movements', links:['correctionForMovementId','reversalOfMovementId','correctsMovementId','originalMovementId'] },
  VAT_VOUCHER: { collection:'journalEntries', links:[] },
  ISLR_VOUCHER: { collection:'journalEntries', links:[] },
});
function findLinkedCorrectionEvidence(state, item, reference) {
  const rule = CORRECTION_EVIDENCE_RULES[String(item.entity_type)];
  if (!rule) return null;
  const sourceCollection = item.entity_type === 'VAT_VOUCHER' ? 'vatVouchers' :
    item.entity_type === 'ISLR_VOUCHER' ? 'islrVouchers' :
    item.entity_type === 'INVENTORY_MOVEMENT' ? 'movements' :
    item.entity_type === 'JOURNAL_ENTRY' ? 'journalEntries' : rule.collection;
  const source = Array.isArray(state[sourceCollection]) && state[sourceCollection].find(record =>
    String(record.id) === String(item.entity_id) && String(record.companyId) === String(item.company_id));
  if (!source) return null;
  const candidates = Array.isArray(state[rule.collection]) ? state[rule.collection] : [];
  const voucherCorrectionIds = ['VAT_VOUCHER','ISLR_VOUCHER'].includes(String(item.entity_type))
    ? [...new Set([...(source?.correctionEntryIds || []),source?.correctionEntryId].filter(Boolean).map(String))] : [];
  const normalizedReference = String(reference || '').trim().toLocaleUpperCase();
  if (!normalizedReference) return null;
  const referenceFields = ['id','documentNumber','invoiceNumber','voucherNumber','declarationNumber','entryNumber',
    'opNumber','documentRef','number','reference','referenceDoc','controlNumber','creditNoteNumber','debitNoteNumber'];
  const evidence = candidates.find(candidate => {
    if (String(candidate.companyId || '') !== String(item.company_id) || String(candidate.id) === String(item.entity_id)) return false;
    const linked = voucherCorrectionIds.length
      ? voucherCorrectionIds.includes(String(candidate.id))
      : rule.links.some(field => candidate[field] != null && String(candidate[field]) === String(item.entity_id));
    if (!linked) return false;
    if (['SALE','PURCHASE'].includes(String(item.entity_type)) &&
        !['02','03'].includes(String(candidate.documentType || ''))) return false;
    return referenceFields.some(field => candidate[field] != null &&
      String(candidate[field]).trim().toLocaleUpperCase() === normalizedReference);
  });
  return evidence ? {...evidence,__evidenceCollection:rule.collection} : null;
}

function initializeCorrectionWorkflow(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_correction_cases (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, correction_type TEXT NOT NULL, source_ref TEXT NOT NULL,
      correction_ref TEXT NOT NULL, reason TEXT NOT NULL, workpaper TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','EXECUTED')),
      workflow_stage TEXT NOT NULL DEFAULT 'IN_REVIEW',
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
  const caseColumns = new Set(db.prepare('PRAGMA table_info(accounting_correction_cases)').all().map(column => String(column.name)));
  if (!caseColumns.has('workflow_stage')) {
    db.exec("ALTER TABLE accounting_correction_cases ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'IN_REVIEW'");
  }
  db.exec(`
    DROP TRIGGER IF EXISTS correction_cases_valid_transition;
    DROP TRIGGER IF EXISTS correction_cases_segregation;
    UPDATE accounting_correction_cases SET workflow_stage=CASE status
      WHEN 'APPROVED' THEN 'READY_FOR_EXECUTION' WHEN 'REJECTED' THEN 'CLOSED'
      WHEN 'EXECUTED' THEN 'COMPLETED' ELSE 'IN_REVIEW' END
      WHERE workflow_stage='IN_REVIEW' AND status IN ('APPROVED','REJECTED','EXECUTED');
    CREATE TRIGGER correction_cases_valid_transition BEFORE UPDATE ON accounting_correction_cases
      WHEN NOT (
        (OLD.status='PENDING_REVIEW' AND NEW.status='APPROVED' AND NEW.workflow_stage='READY_FOR_EXECUTION') OR
        (OLD.status='PENDING_REVIEW' AND NEW.status='REJECTED' AND NEW.workflow_stage='CLOSED') OR
        (OLD.status='APPROVED' AND NEW.status='EXECUTED' AND NEW.workflow_stage='COMPLETED') OR
        (OLD.status IN ('PENDING_REVIEW','APPROVED') AND NEW.status='PENDING_REVIEW' AND NEW.workflow_stage='OBSERVATION_REQUIRED') OR
        (OLD.status IN ('PENDING_REVIEW','APPROVED') AND NEW.status='PENDING_REVIEW' AND NEW.workflow_stage='WITHDRAWN') OR
        (OLD.status='PENDING_REVIEW' AND NEW.status='PENDING_REVIEW' AND OLD.workflow_stage='OBSERVATION_REQUIRED' AND NEW.workflow_stage='IN_REVIEW')
      )
      BEGIN SELECT RAISE(ABORT, 'invalid correction case transition'); END;
    CREATE TRIGGER correction_cases_segregation BEFORE UPDATE ON accounting_correction_cases
      WHEN (OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED') AND NEW.reviewed_by=OLD.requested_by)
        OR (NEW.workflow_stage='OBSERVATION_REQUIRED' AND NEW.reviewed_by=OLD.requested_by)
        OR (OLD.status='APPROVED' AND NEW.status='EXECUTED' AND
          (NEW.executed_by=OLD.requested_by OR NEW.executed_by=OLD.reviewed_by))
      BEGIN SELECT RAISE(ABORT, 'correction case segregation of duties violated'); END;
    CREATE TABLE IF NOT EXISTS accounting_correction_case_workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('OBSERVED','RESUBMITTED','WITHDRAWN')),
      actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL,
      metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_correction_case_workflow_events_case
      ON accounting_correction_case_workflow_events(case_id,id);
    CREATE TRIGGER IF NOT EXISTS correction_case_workflow_events_no_update BEFORE UPDATE ON accounting_correction_case_workflow_events
      BEGIN SELECT RAISE(ABORT, 'correction workflow events are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS correction_case_workflow_events_no_delete BEFORE DELETE ON accounting_correction_case_workflow_events
      BEGIN SELECT RAISE(ABORT, 'correction workflow events are append-only'); END;
  `);
  const workflowEventSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_correction_case_workflow_events'").get();
  if (workflowEventSchema && !String(workflowEventSchema.sql || '').includes("'WITHDRAWN'")) {
    db.exec(`
      DROP TRIGGER IF EXISTS correction_case_workflow_events_no_update;
      DROP TRIGGER IF EXISTS correction_case_workflow_events_no_delete;
      DROP INDEX IF EXISTS idx_correction_case_workflow_events_case;
      ALTER TABLE accounting_correction_case_workflow_events RENAME TO accounting_correction_case_workflow_events_legacy;
      CREATE TABLE accounting_correction_case_workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
        event_type TEXT NOT NULL CHECK(event_type IN ('OBSERVED','RESUBMITTED','WITHDRAWN')),
        actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL,
        metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
      );
      INSERT INTO accounting_correction_case_workflow_events
        (id,case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at)
      SELECT id,case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at
        FROM accounting_correction_case_workflow_events_legacy;
      DROP TABLE accounting_correction_case_workflow_events_legacy;
      CREATE INDEX idx_correction_case_workflow_events_case
        ON accounting_correction_case_workflow_events(case_id,id);
      CREATE TRIGGER correction_case_workflow_events_no_update BEFORE UPDATE ON accounting_correction_case_workflow_events
        BEGIN SELECT RAISE(ABORT, 'correction workflow events are append-only'); END;
      CREATE TRIGGER correction_case_workflow_events_no_delete BEFORE DELETE ON accounting_correction_case_workflow_events
        BEGIN SELECT RAISE(ABORT, 'correction workflow events are append-only'); END;
    `);
  }
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
  const allowedEntities = new Set(['SALE','PURCHASE','JOURNAL_ENTRY','INVENTORY_MOVEMENT','VAT_VOUCHER','ISLR_VOUCHER']);
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
    if (item.status !== 'PENDING_REVIEW' || item.workflow_stage !== 'IN_REVIEW') throw new Error('El expediente ya fue revisado o no está en revisión; atienda primero las observaciones o el estado actual.');
    if (Number(item.requested_by) === Number(actor.id)) throw new Error('El solicitante no puede aprobar ni rechazar su propio expediente. Se requiere otro administrador.');
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    db.prepare('UPDATE accounting_correction_cases SET status=?,workflow_stage=?,reviewed_by=?,reviewed_by_name=?,review_reason=?,reviewed_at=? WHERE id=? AND status=?')
      .run(status,decision === 'APPROVE' ? 'READY_FOR_EXECUTION' : 'CLOSED',Number(actor.id),String(actor.username || ''),String(reason).trim(),at,item.id,'PENDING_REVIEW');
    appendEvent(db, tx, {id:item.id,type:decision==='APPROVE'?'APPROVED':'REJECTED',actor,reason:String(reason).trim(),metadata:{requestedBy:Number(item.requested_by)},at});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function markCorrectionExecuted(db, {caseId,executionRef,reason,evidenceRecordId,evidenceCollection}, actor) {
  requireAdmin(actor);
  if (String(reason || '').trim().length < 15) throw new Error('La ejecución requiere una justificación de al menos 15 caracteres.');
  const at = new Date().toISOString();
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if (!item) throw new Error('El expediente de corrección no existe.');
    if (item.status !== 'APPROVED' || item.workflow_stage !== 'READY_FOR_EXECUTION') throw new Error('Solo se puede ejecutar un expediente aprobado y sin observaciones pendientes.');
    if (Number(item.requested_by) === Number(actor.id) || Number(item.reviewed_by) === Number(actor.id)) {
      throw new Error('El ejecutor debe ser distinto del solicitante y del aprobador.');
    }
    const normalizedExecutionRef = String(executionRef || '').trim().toLocaleUpperCase();
    if (!normalizedExecutionRef || normalizedExecutionRef.length > 160) throw new Error('Indique una referencia correctiva válida de hasta 160 caracteres.');
    if (normalizedExecutionRef === String(item.source_ref || '').trim().toLocaleUpperCase()) {
      throw new Error('La referencia de ejecución no puede ser la misma del documento original.');
    }
    const expectedCorrectionRef = String(item.correction_ref || '').trim();
    if (expectedCorrectionRef && expectedCorrectionRef !== 'PENDIENTE DE DOCUMENTO CORRECTIVO' &&
        normalizedExecutionRef !== expectedCorrectionRef.toLocaleUpperCase()) {
      throw new Error('La referencia ejecutada no coincide con el documento correctivo indicado en la solicitud.');
    }
    const linkedEvidenceId = String(evidenceRecordId || '').trim();
    const linkedEvidenceCollection = String(evidenceCollection || '').trim();
    const expectedEvidenceCollection = ({SALE:'sales',PURCHASE:'purchases',JOURNAL_ENTRY:'journalEntries',
      INVENTORY_MOVEMENT:'movements',VAT_VOUCHER:'journalEntries',ISLR_VOUCHER:'journalEntries'})[item.entity_type];
    if (!linkedEvidenceId || !expectedEvidenceCollection || linkedEvidenceCollection !== expectedEvidenceCollection) {
      throw new Error('La ejecución requiere el ID y la colección exacta de la evidencia correctiva verificada.');
    }
    db.prepare("UPDATE accounting_correction_cases SET status='EXECUTED',workflow_stage='COMPLETED',executed_by=?,executed_by_name=?,execution_ref=?,executed_at=? WHERE id=? AND status='APPROVED'")
      .run(Number(actor.id),String(actor.username || ''),String(executionRef).trim(),at,item.id);
    appendEvent(db, tx, {id:item.id,type:'EXECUTED',actor,reason:String(reason).trim(),metadata:{
      executionRef:String(executionRef).trim(),
      ...(linkedEvidenceId ? {evidenceRecordId:linkedEvidenceId,evidenceCollection:linkedEvidenceCollection} : {})
    },at});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function appendWorkflowEvent(db, item, type, actor, reason, metadata = {}) {
  const at = new Date().toISOString();
  db.prepare('INSERT INTO accounting_correction_case_workflow_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(item.id,type,Number(actor.id),String(actor.username || ''),String(reason).trim(),JSON.stringify(metadata),at);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run('accounting_correction_case_' + type.toLowerCase(),JSON.stringify({
      caseId:item.id,actorUserId:Number(actor.id),actorUsername:String(actor.username || ''),
      reason:String(reason).trim(),metadata,occurredAt:at
    }));
}
function observeCorrectionRequest(db, {caseId,reason}, actor) {
  requireAdmin(actor);
  const note=String(reason || '').trim();
  if(note.length<15) throw new Error('La observación debe explicar qué falta o debe corregirse (mínimo 15 caracteres).');
  const at=new Date().toISOString();
  const tx=db.transaction(()=>{
    const item=db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if(!item) throw new Error('El expediente de corrección no existe.');
    if(!['PENDING_REVIEW','APPROVED'].includes(item.status) || !['IN_REVIEW','READY_FOR_EXECUTION'].includes(item.workflow_stage))
      throw new Error('El expediente no admite observaciones en su estado actual.');
    if(Number(item.requested_by)===Number(actor.id)) throw new Error('El solicitante no puede observar su propio expediente.');
    db.prepare("UPDATE accounting_correction_cases SET status='PENDING_REVIEW',workflow_stage='OBSERVATION_REQUIRED',reviewed_by=?,reviewed_by_name=?,review_reason=?,reviewed_at=? WHERE id=?")
      .run(Number(actor.id),String(actor.username || ''),note,at,item.id);
    appendWorkflowEvent(db,item,'OBSERVED',actor,note,{previousStatus:item.status,previousStage:item.workflow_stage});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function resubmitCorrectionRequest(db, {caseId,reason}, actor) {
  requireAdmin(actor);
  const note=String(reason || '').trim();
  if(note.length<15) throw new Error('La subsanación debe describir los cambios y soportes aportados (mínimo 15 caracteres).');
  const at=new Date().toISOString();
  const tx=db.transaction(()=>{
    const item=db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if(!item) throw new Error('El expediente de corrección no existe.');
    if(item.status!=='PENDING_REVIEW' || item.workflow_stage!=='OBSERVATION_REQUIRED')
      throw new Error('El expediente no tiene observaciones pendientes de subsanación.');
    if(Number(item.requested_by)!==Number(actor.id))
      throw new Error('Solo el solicitante original puede subsanar y reenviar este expediente.');
    db.prepare("UPDATE accounting_correction_cases SET workflow_stage='IN_REVIEW',reviewed_by=NULL,reviewed_by_name=NULL,review_reason=NULL,reviewed_at=NULL WHERE id=? AND status='PENDING_REVIEW'")
      .run(item.id);
    appendWorkflowEvent(db,item,'RESUBMITTED',actor,note,{previousReviewerId:item.reviewed_by || null});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function withdrawCorrectionRequest(db, {caseId,reason}, actor) {
  requireAdmin(actor);
  const note=String(reason || '').trim();
  if(note.length<15) throw new Error('El retiro requiere una justificación de al menos 15 caracteres.');
  const tx=db.transaction(()=>{
    const item=db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if(!item) throw new Error('El expediente de corrección no existe.');
    if(!['PENDING_REVIEW','APPROVED'].includes(item.status) ||
       !['IN_REVIEW','OBSERVATION_REQUIRED','READY_FOR_EXECUTION'].includes(item.workflow_stage))
      throw new Error('El expediente ya está cerrado, ejecutado o retirado; no admite retiro.');
    if(Number(item.requested_by)!==Number(actor.id))
      throw new Error('Solo el solicitante original puede retirar el expediente.');
    db.prepare("UPDATE accounting_correction_cases SET status='PENDING_REVIEW',workflow_stage='WITHDRAWN' WHERE id=?")
      .run(item.id);
    appendWorkflowEvent(db,item,'WITHDRAWN',actor,note,{previousStatus:item.status,previousStage:item.workflow_stage});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function getCorrectionCase(db,id) {
  const row=db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(id));
  if(!row)return null;
  const events=db.prepare('SELECT id,event_type,actor_id,actor_name,reason,metadata_json,created_at FROM accounting_correction_case_events WHERE case_id=? ORDER BY id').all(row.id)
    .map(e=>({...e,metadata:JSON.parse(e.metadata_json)}));
  const workflowEvents=db.prepare('SELECT id,event_type,actor_id,actor_name,reason,metadata_json,created_at FROM accounting_correction_case_workflow_events WHERE case_id=? ORDER BY id').all(row.id)
    .map(e=>({...e,id:'W'+e.id,metadata:JSON.parse(e.metadata_json)}));
  return {...row,events:[...events,...workflowEvents].sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))};
}
function listCorrectionCases(db,companyId) {
  return db.prepare('SELECT id FROM accounting_correction_cases WHERE company_id=? ORDER BY created_at DESC').all(String(companyId))
    .map(row=>getCorrectionCase(db,row.id));
}
module.exports={initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,observeCorrectionRequest,resubmitCorrectionRequest,withdrawCorrectionRequest,markCorrectionExecuted,getCorrectionCase,listCorrectionCases,findLinkedCorrectionEvidence};
