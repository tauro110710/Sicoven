'use strict';

const crypto = require('node:crypto');

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
  if (!actor || actor.role !== 'admin' || !Number.isInteger(Number(actor.id))) throw new Error('Se requiere una sesión administrativa autenticada.');
}
function appendEvent(db, tx, event) {
  tx.insertEvent.run(event.id, event.type, Number(event.actor.id), String(event.actor.username || ''),
    event.reason, JSON.stringify(event.metadata || {}), event.at);
}
function registerCorrectionRequest(db, input, actor) {
  requireAdmin(actor);
  const required = ['companyId','entityType','entityId','correctionType','sourceDocumentRef','reason','workpaperNote'];
  for (const key of required) if (!String(input?.[key] || '').trim()) throw new Error('Falta el campo obligatorio: '+key);
  if (String(input.reason).trim().length < 15 || String(input.workpaperNote).trim().length < 15) throw new Error('El motivo y el papel de trabajo deben tener al menos 15 caracteres.');
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
    if (!String(executionRef || '').trim()) throw new Error('Indique la referencia del documento o asiento correctivo generado.');
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
module.exports={initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,markCorrectionExecuted,getCorrectionCase,listCorrectionCases};
