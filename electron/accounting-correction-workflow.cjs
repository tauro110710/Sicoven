'use strict';

const crypto = require('node:crypto');


const CORRECTION_EVIDENCE_RULES = Object.freeze({
  SALE: { collection:'sales', links:['originalSaleId','correctedSaleId','correctionOfSaleId','affectedSaleId','originalDocumentId'] },
  PURCHASE: { collection:'purchases', links:['originalPurchaseId','correctedPurchaseId','correctionOfPurchaseId','affectedPurchaseId','originalDocumentId'] },
  JOURNAL_ENTRY: { collection:'journalEntries', links:['reversalOfEntryId','adjustmentForEntryId','reversesEntryId','correctionOfEntryId','correctsEntryId'] },
  INVENTORY_MOVEMENT: { collection:'movements', links:['correctionForMovementId','reversalOfMovementId','correctsMovementId','originalMovementId'] },
});
function findLinkedCorrectionEvidence(state, item, reference) {
  const rule = CORRECTION_EVIDENCE_RULES[String(item.entity_type)];
  if (!rule) return null;
  const sourceCollection = rule.collection;
  const source = Array.isArray(state[sourceCollection]) && state[sourceCollection].find(record =>
    String(record.id) === String(item.entity_id) && String(record.companyId) === String(item.company_id));
  if (!source) return null;
  const candidates = Array.isArray(state[rule.collection]) ? state[rule.collection] : [];
  const normalizedReference = String(reference || '').trim().toLocaleUpperCase();
  if (!normalizedReference) return null;
  const referenceFields = ['id','documentNumber','invoiceNumber','voucherNumber','declarationNumber','entryNumber',
    'opNumber','sequence','journalEntryId','voucherId','documentRef','number','reference','referenceDoc','controlNumber','creditNoteNumber','debitNoteNumber'];
  const evidence = candidates.find(candidate => {
    if (String(candidate.companyId || '') !== String(item.company_id) || String(candidate.id) === String(item.entity_id)) return false;
    const linked = rule.links.some(field => candidate[field] != null && String(candidate[field]) === String(item.entity_id));
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
    DROP TRIGGER IF EXISTS correction_cases_segregation;
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
  const migrateCorrectionCaseSchema = db.transaction(() => {
  const caseColumns = new Set(db.prepare('PRAGMA table_info(accounting_correction_cases)').all().map(column => String(column.name)));
  if (!caseColumns.has('workflow_stage')) db.exec("ALTER TABLE accounting_correction_cases ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT 'IN_REVIEW'");
  if (!caseColumns.has('execution_started_by')) db.exec('ALTER TABLE accounting_correction_cases ADD COLUMN execution_started_by INTEGER');
  if (!caseColumns.has('execution_started_at')) db.exec('ALTER TABLE accounting_correction_cases ADD COLUMN execution_started_at TEXT');
  if (!caseColumns.has('execution_started_ref')) db.exec('ALTER TABLE accounting_correction_cases ADD COLUMN execution_started_ref TEXT');
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
        (OLD.status='APPROVED' AND NEW.status='APPROVED' AND OLD.workflow_stage='READY_FOR_EXECUTION' AND NEW.workflow_stage='READY_FOR_EXECUTION' AND OLD.execution_started_at IS NULL AND NEW.execution_started_at IS NOT NULL AND NEW.execution_started_by IS NOT NULL AND UPPER(TRIM(NEW.execution_started_ref))=UPPER(TRIM(NEW.correction_ref))) OR
        (OLD.status IN ('PENDING_REVIEW','APPROVED') AND NEW.status='PENDING_REVIEW' AND NEW.workflow_stage='OBSERVATION_REQUIRED') OR
        (OLD.status IN ('PENDING_REVIEW','APPROVED') AND NEW.status='PENDING_REVIEW' AND NEW.workflow_stage='WITHDRAWN') OR
        (OLD.status='PENDING_REVIEW' AND NEW.status='PENDING_REVIEW' AND OLD.workflow_stage='OBSERVATION_REQUIRED' AND NEW.workflow_stage='IN_REVIEW')
      )
      BEGIN SELECT RAISE(ABORT, 'invalid correction case transition'); END;
    DROP TRIGGER IF EXISTS correction_cases_segregation;
    CREATE TABLE IF NOT EXISTS accounting_correction_case_workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
      event_type TEXT NOT NULL CHECK(event_type IN ('OBSERVED','RESUBMITTED','WITHDRAWN','EXECUTION_STARTED')),
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
  });
  migrateCorrectionCaseSchema();
  const migrateOpenCasesToDirectExecution = db.transaction(() => {
    const legacyCases = db.prepare(`
      SELECT id,requested_by,requested_by_name FROM accounting_correction_cases
      WHERE status='PENDING_REVIEW' AND workflow_stage IN ('IN_REVIEW','OBSERVATION_REQUIRED')
    `).all();
    for (const item of legacyCases) {
      const at = nextCorrectionEventAt(db,item.id);
      db.prepare(`
        UPDATE accounting_correction_cases
        SET status='APPROVED',workflow_stage='READY_FOR_EXECUTION',
            reviewed_by=requested_by,reviewed_by_name=requested_by_name,
            review_reason='Migración al flujo de ejecución directa del contador.',
            reviewed_at=?
        WHERE id=? AND status='PENDING_REVIEW'
      `).run(at,item.id);
      appendEvent(db,null,{id:item.id,type:'APPROVED',
        actor:{id:item.requested_by,username:item.requested_by_name},
        reason:'Caso heredado habilitado para ejecución directa; no requiere aprobación.',
        metadata:{automatic:true,legacyWorkflowMigrated:true},at});
    }
  });
  migrateOpenCasesToDirectExecution();
  const workflowEventSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_correction_case_workflow_events'").get();
  if (workflowEventSchema && (!String(workflowEventSchema.sql || '').includes("'WITHDRAWN'") || !String(workflowEventSchema.sql || '').includes("'EXECUTION_STARTED'"))) {
    const migrateWorkflowEventSchema = db.transaction(() => db.exec(`
      DROP TRIGGER IF EXISTS correction_case_workflow_events_no_update;
      DROP TRIGGER IF EXISTS correction_case_workflow_events_no_delete;
      DROP INDEX IF EXISTS idx_correction_case_workflow_events_case;
      ALTER TABLE accounting_correction_case_workflow_events RENAME TO accounting_correction_case_workflow_events_legacy;
      CREATE TABLE accounting_correction_case_workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
        event_type TEXT NOT NULL CHECK(event_type IN ('OBSERVED','RESUBMITTED','WITHDRAWN','EXECUTION_STARTED')),
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
    `));
    migrateWorkflowEventSchema();
  }
}
function requireAdmin(actor) {
  if (!actor || actor.role !== 'admin' || !Number.isSafeInteger(Number(actor.id)) || Number(actor.id) <= 0 || !String(actor.username || '').trim()) {
    throw new Error('Se requiere una sesión administrativa autenticada con identidad válida.');
  }
}
function nextCorrectionEventAt(db, caseId) {
  const latest=db.prepare(`
    SELECT MAX(created_at) AS latest FROM (
      SELECT created_at FROM accounting_correction_case_events WHERE case_id=?
      UNION ALL
      SELECT created_at FROM accounting_correction_case_workflow_events WHERE case_id=?
    )
  `).get(String(caseId),String(caseId)).latest;
  const now=Date.now();
  const previous=latest ? Date.parse(latest) : NaN;
  return new Date(Number.isFinite(previous) && previous>=now ? previous+1 : now).toISOString();
}
function appendEvent(db, _tx, event) {
  event.at=nextCorrectionEventAt(db,event.id);
  db.prepare('INSERT INTO accounting_correction_case_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(event.id, event.type, Number(event.actor.id), String(event.actor.username || ''),
      event.reason, JSON.stringify(event.metadata || {}), event.at);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run('accounting_correction_case_' + event.type.toLowerCase(), JSON.stringify({ caseId:event.id, actorUserId:Number(event.actor.id), actorUsername:String(event.actor.username || ''), reason:event.reason, metadata:event.metadata || {}, occurredAt:event.at }));
}
function registerCorrectionRequest(db, input, actor) {
  requireAdmin(actor);
  const required = ['companyId','entityType','entityId','correctionType','sourceDocumentRef','correctionDocumentRef'];
  for (const key of required) if (!String(input?.[key] || '').trim()) throw new Error('Falta el campo obligatorio: '+key);
  const reason = String(input.reason || '').trim();
  const workpaperNote = String(input.workpaperNote || '').trim();
  const limits = { companyId:160, entityType:40, entityId:160, correctionType:80, sourceDocumentRef:160,
    correctionDocumentRef:160, reason:2000, workpaperNote:4000 };
  for (const [key,max] of Object.entries(limits)) if (String(input[key] || '').length > max) throw new Error('El campo '+key+' excede el máximo permitido.');
  const allowedEntities = new Set(['SALE','PURCHASE','JOURNAL_ENTRY','INVENTORY_MOVEMENT']);
  if (!allowedEntities.has(String(input.entityType))) throw new Error('Tipo de registro origen no admitido.');
  const duplicate = db.prepare(`
    SELECT id FROM accounting_correction_cases
    WHERE company_id=? AND entity_type=? AND entity_id=?
      AND UPPER(TRIM(source_ref))=UPPER(TRIM(?))
      AND UPPER(TRIM(correction_ref))=UPPER(TRIM(?))
      AND status IN ('PENDING_REVIEW','APPROVED','EXECUTED') AND workflow_stage<>'WITHDRAWN'
    LIMIT 1
  `).get(String(input.companyId),String(input.entityType),String(input.entityId),
    String(input.sourceDocumentRef),String(input.correctionDocumentRef));
  if (duplicate) throw new Error('Ya existe un expediente activo para la misma referencia fuente y documento correctivo. Consulte su historial en lugar de duplicarlo.');

  const id = crypto.randomUUID(), at = new Date().toISOString();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO accounting_correction_cases
      (id,company_id,entity_type,entity_id,correction_type,source_ref,correction_ref,reason,workpaper,status,requested_by,requested_by_name,reviewed_by,reviewed_by_name,review_reason,created_at,reviewed_at)
      VALUES(?,?,?,?,?,?,?,?,?,'APPROVED',?,?,?,?,?,?,?)`).run(id,String(input.companyId),String(input.entityType),String(input.entityId),
      String(input.correctionType),String(input.sourceDocumentRef),String(input.correctionDocumentRef || ''),reason,workpaperNote,
      Number(actor.id),String(actor.username || ''),Number(actor.id),String(actor.username || ''),
      'Habilitada para ejecución directa por el contador.',at,at);
    appendEvent(db, tx, {id,type:'REQUESTED',actor,reason,metadata:{companyId:String(input.companyId),entityType:String(input.entityType),entityId:String(input.entityId)},at});
    appendEvent(db, tx, {id,type:'APPROVED',actor,reason:'Habilitada automáticamente para ejecución directa; no requiere revisión ni aprobación.',metadata:{automatic:true,directExecution:true},at});
  });
  tx();
  return getCorrectionCase(db,id);
}
function reviewCorrectionRequest(_db, _input, actor) {
  requireAdmin(actor);
  throw new Error('La revisión y aprobación previa fueron retiradas. La corrección se habilita directamente al contador.');
}
function requireApprovedCorrectionCase(db, input, actor) {
  requireAdmin(actor);
  const required=['companyId','entityType','entityId','sourceDocumentRef','correctionDocumentRef'];
  for(const key of required) if(!String(input?.[key] || '').trim())
    throw new Error('La ejecución correctiva requiere el dato obligatorio: '+key+'.');
  const sourceRef=String(input.sourceDocumentRef).trim();
  const correctionRef=String(input.correctionDocumentRef).trim();
  const at=new Date().toISOString();
  const tx=db.transaction(()=>{
    const rows=db.prepare(`
      SELECT id,requested_by,reviewed_by,correction_type,execution_started_by,execution_started_ref,execution_started_at
      FROM accounting_correction_cases
      WHERE company_id=? AND entity_type=? AND entity_id=?
        AND UPPER(TRIM(source_ref))=UPPER(TRIM(?))
        AND UPPER(TRIM(correction_ref))=UPPER(TRIM(?))
        AND status='APPROVED' AND workflow_stage='READY_FOR_EXECUTION'
      ORDER BY created_at DESC
    `).all(String(input.companyId),String(input.entityType),String(input.entityId),sourceRef,correctionRef);
    if(rows.length===0)
      throw new Error('No existe un expediente formal aprobado para esta empresa, registro origen y referencia correctiva. La operación no se ejecutó.');
    if(rows.length!==1)
      throw new Error('Hay más de un expediente aprobado para la misma corrección. Debe resolverse la duplicidad antes de ejecutar.');
    const item=rows[0];
    if(item.execution_started_at) {
      if(Number(item.execution_started_by)!==Number(actor.id) ||
         String(item.execution_started_ref || '').trim().toLocaleUpperCase()!==correctionRef.toLocaleUpperCase())
        throw new Error('La ejecución de este expediente ya fue iniciada por otro operador o con otra referencia.');
      return {ok:true,caseId:item.id,correctionType:item.correction_type,resumed:true};
    }
    db.prepare(`UPDATE accounting_correction_cases
      SET execution_started_by=?,execution_started_at=?,execution_started_ref=? WHERE id=?`)
      .run(Number(actor.id),at,correctionRef,item.id);
    appendWorkflowEvent(db,item,'EXECUTION_STARTED',actor,'Inicio de ejecución autorizado para '+correctionRef,{correctionDocumentRef:correctionRef});
    return {ok:true,caseId:item.id,correctionType:item.correction_type,resumed:false};
  });
  return tx();
}
function markCorrectionExecuted(db, {caseId,executionRef,reason,evidenceRecordId,evidenceCollection}, actor) {
  requireAdmin(actor);
  const executionReason = String(reason || '').trim() || 'Correctivo persistido y vínculo de origen verificado automáticamente.';
  const at = new Date().toISOString();
  const tx = db.transaction(() => {
    const item = db.prepare('SELECT * FROM accounting_correction_cases WHERE id=?').get(String(caseId));
    if (!item) throw new Error('El expediente de corrección no existe.');
    const normalizedExecutionRef = String(executionRef || '').trim().toLocaleUpperCase();
    if (item.status === 'EXECUTED') {
      if (String(item.execution_ref || '').trim().toLocaleUpperCase() === normalizedExecutionRef && Number(item.executed_by) === Number(actor.id)) return;
      throw new Error('La corrección ya fue ejecutada con otra referencia o identidad. No se repetirá la operación.');
    }
    if (item.status !== 'APPROVED' || item.workflow_stage !== 'READY_FOR_EXECUTION') throw new Error('La corrección no está habilitada para ejecución directa.');
    if (!item.execution_started_at || Number(item.execution_started_by)!==Number(actor.id)) {
      throw new Error('La ejecución debe haber sido iniciada y autorizada previamente por el contador autenticado.');
    }
    if (!normalizedExecutionRef || normalizedExecutionRef.length > 160) throw new Error('Indique una referencia correctiva válida de hasta 160 caracteres.');
    if (normalizedExecutionRef === String(item.source_ref || '').trim().toLocaleUpperCase()) {
      throw new Error('La referencia de ejecución no puede ser la misma del documento original.');
    }
    const expectedCorrectionRef = String(item.correction_ref || '').trim();
    if (expectedCorrectionRef && normalizedExecutionRef !== expectedCorrectionRef.toLocaleUpperCase()) {
      throw new Error('La referencia ejecutada no coincide con el documento correctivo indicado en la solicitud.');
    }
    const linkedEvidenceId = String(evidenceRecordId || '').trim();
    const linkedEvidenceCollection = String(evidenceCollection || '').trim();
    const expectedEvidenceCollection = ({SALE:'sales',PURCHASE:'purchases',JOURNAL_ENTRY:'journalEntries',
      INVENTORY_MOVEMENT:'movements'})[item.entity_type];
    if (String(item.execution_started_ref || '').trim().toLocaleUpperCase() !== String(executionRef || '').trim().toLocaleUpperCase()) {
      throw new Error('La referencia ejecutada no coincide con la referencia autorizada al iniciar la operación.');
    }
    if (!linkedEvidenceId || !expectedEvidenceCollection || linkedEvidenceCollection !== expectedEvidenceCollection) {
      throw new Error('La ejecución requiere el ID y la colección exacta de la evidencia correctiva verificada.');
    }
    db.prepare("UPDATE accounting_correction_cases SET status='EXECUTED',workflow_stage='COMPLETED',executed_by=?,executed_by_name=?,execution_ref=?,executed_at=? WHERE id=? AND status='APPROVED'")
      .run(Number(actor.id),String(actor.username || ''),String(executionRef).trim(),at,item.id);
    appendEvent(db, tx, {id:item.id,type:'EXECUTED',actor,reason:executionReason,metadata:{
      executionRef:String(executionRef).trim(),
      ...(linkedEvidenceId ? {evidenceRecordId:linkedEvidenceId,evidenceCollection:linkedEvidenceCollection} : {})
    },at});
  });
  tx();
  return getCorrectionCase(db,String(caseId));
}
function appendWorkflowEvent(db, item, type, actor, reason, metadata = {}) {
  const at = nextCorrectionEventAt(db,item.id);
  db.prepare('INSERT INTO accounting_correction_case_workflow_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)')
    .run(item.id,type,Number(actor.id),String(actor.username || ''),String(reason).trim(),JSON.stringify(metadata),at);
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
    .run('accounting_correction_case_' + type.toLowerCase(),JSON.stringify({
      caseId:item.id,actorUserId:Number(actor.id),actorUsername:String(actor.username || ''),
      reason:String(reason).trim(),metadata,occurredAt:at
    }));
}
function observeCorrectionRequest(_db, _input, actor) {
  requireAdmin(actor);
  throw new Error('Las observaciones y subsanaciones administrativas fueron retiradas del Centro de Correcciones.');
}
function resubmitCorrectionRequest(_db, _input, actor) {
  requireAdmin(actor);
  throw new Error('El reenvío a revisión fue retirado. El contador ejecuta directamente la corrección.');
}
function withdrawCorrectionRequest(_db, _input, actor) {
  requireAdmin(actor);
  throw new Error('El retiro administrativo fue retirado del flujo operativo.');
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
module.exports={initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,observeCorrectionRequest,resubmitCorrectionRequest,withdrawCorrectionRequest,requireApprovedCorrectionCase,markCorrectionExecuted,getCorrectionCase,listCorrectionCases,findLinkedCorrectionEvidence};
