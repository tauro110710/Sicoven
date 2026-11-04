'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeCorrectionWorkflow, registerCorrectionRequest, reviewCorrectionRequest,
  markCorrectionExecuted, requireApprovedCorrectionCase, getCorrectionCase,
  listCorrectionCases, findLinkedCorrectionEvidence } = require('./accounting-correction-workflow.cjs');
function setup() {
  const db = new Database(':memory:');
  db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));");
  initializeCorrectionWorkflow(db);
  return db;
}
const actor={id:7,username:'contador',role:'contador'};
const input={companyId:'company-1',entityType:'SALE',entityId:'sale-1',correctionType:'ANULACION',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001',reason:'Error en la factura original.',workpaperNote:''};
test('a correction is immediately available without approval or workpaper',()=>{
  const db=setup();try{
    const item=registerCorrectionRequest(db,input,actor);
    assert.equal(item.status,'APPROVED');assert.equal(item.workflow_stage,'READY_FOR_EXECUTION');
    assert.equal(item.requested_by,actor.id);assert.equal(item.reviewed_by,null);assert.equal(item.reviewed_at,null);assert.equal(item.workpaper,'');
    assert.deepEqual(item.events.map(e=>e.event_type),['REQUESTED','APPROVED']);
    assert.equal(item.events[1].metadata.directExecution,true);
    assert.throws(()=>reviewCorrectionRequest(db,{caseId:item.id,decision:'APPROVE'},actor),/retiradas/);
    assert.equal(listCorrectionCases(db,'company-1').length,1);
  }finally{db.close();}
});
test('direct authorization binds the accountant and exact correcting reference',()=>{
  const db=setup();try{
    const item=registerCorrectionRequest(db,input,actor);
    const auth=requireApprovedCorrectionCase(db,{companyId:'company-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},actor);
    assert.equal(auth.ok,true);assert.equal(auth.resumed,false);
    assert.throws(()=>markCorrectionExecuted(db,{caseId:item.id,executionRef:'FAC-001',evidenceRecordId:'nc-1',evidenceCollection:'sales'},actor),/misma del documento original/);
    assert.throws(()=>markCorrectionExecuted(db,{caseId:item.id,executionRef:'NC-002',evidenceRecordId:'nc-1',evidenceCollection:'sales'},actor),/no coincide con el documento correctivo/);
    const done=markCorrectionExecuted(db,{caseId:item.id,executionRef:'NC-001',evidenceRecordId:'nc-1',evidenceCollection:'sales'},actor);
    assert.equal(done.status,'EXECUTED');
    assert.deepEqual(done.events.map(e=>e.event_type),['REQUESTED','APPROVED','EXECUTION_STARTED','EXECUTED']);
  }finally{db.close();}
});
test('execution retries are idempotent for the same actor and reference',()=>{
  const db=setup();try{
    const item=registerCorrectionRequest(db,input,actor);
    requireApprovedCorrectionCase(db,{companyId:'company-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},actor);
    const payload={caseId:item.id,executionRef:'NC-001',reason:'',evidenceRecordId:'nc-1',evidenceCollection:'sales'};
    assert.equal(markCorrectionExecuted(db,payload,actor).status,'EXECUTED');
    assert.equal(markCorrectionExecuted(db,payload,actor).status,'EXECUTED');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_correction_case_events WHERE event_type='EXECUTED'").get().n,1);
  }finally{db.close();}
});
test('duplicate corrections are rejected and failed audit writes roll back',()=>{
  const db=setup();try{
    registerCorrectionRequest(db,input,actor);assert.throws(()=>registerCorrectionRequest(db,input,actor),/Ya existe/);
    const isolated=setup();try{
      isolated.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_approved' BEGIN SELECT RAISE(ABORT,'injected audit failure'); END;");
      assert.throws(()=>registerCorrectionRequest(isolated,input,actor),/injected audit failure/);
      assert.equal(isolated.prepare('SELECT COUNT(*) n FROM accounting_correction_cases').get().n,0);
      assert.equal(isolated.prepare('SELECT COUNT(*) n FROM accounting_correction_case_events').get().n,0);
    }finally{isolated.close();}
  }finally{db.close();}
});
test('execution audit failure rolls back completion',()=>{
  const db=setup();try{
    const item=registerCorrectionRequest(db,input,actor);
    requireApprovedCorrectionCase(db,{companyId:'company-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},actor);
    db.exec("CREATE TRIGGER reject_execution BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_executed' BEGIN SELECT RAISE(ABORT,'execution audit failure'); END;");
    assert.throws(()=>markCorrectionExecuted(db,{caseId:item.id,executionRef:'NC-001',evidenceRecordId:'nc-1',evidenceCollection:'sales'},actor),/execution audit failure/);
    const current=getCorrectionCase(db,item.id);assert.equal(current.status,'APPROVED');
    assert.equal(current.events.some(e=>e.event_type==='EXECUTED'),false);
  }finally{db.close();}
});
test('legacy open cases migrate to direct execution without deleting history',()=>{
  const db=setup();try{
    db.prepare(`INSERT INTO accounting_correction_cases
      (id,company_id,entity_type,entity_id,correction_type,source_ref,correction_ref,reason,workpaper,status,workflow_stage,requested_by,requested_by_name,created_at)
      VALUES('legacy-1','company-1','SALE','sale-1','ANULACION','FAC-001','NC-001','motivo','', 'PENDING_REVIEW','IN_REVIEW',7,'contador','2026-11-04T10:00:00.000Z')`).run();
    db.prepare(`INSERT INTO accounting_correction_case_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at)
      VALUES('legacy-1','REQUESTED',7,'contador','motivo','{}','2026-11-04T10:00:00.000Z')`).run();
    initializeCorrectionWorkflow(db);const migrated=getCorrectionCase(db,'legacy-1');
    assert.equal(migrated.status,'APPROVED');assert.equal(migrated.workflow_stage,'READY_FOR_EXECUTION');
    assert.deepEqual(migrated.events.map(e=>e.event_type),['REQUESTED','APPROVED']);
    initializeCorrectionWorkflow(db);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_correction_case_events WHERE case_id='legacy-1' AND event_type='APPROVED'").get().n,1);
  }finally{db.close();}
});
test('corrective evidence requires exact source linkage and company',()=>{
  const db=setup();try{
    const item=registerCorrectionRequest(db,input,actor);
    const state={sales:[
      {id:'sale-1',companyId:'company-1',invoiceNumber:'FAC-001',documentType:'01'},
      {id:'nc-1',companyId:'company-1',invoiceNumber:'NC-001',documentType:'03',originalSaleId:'sale-1'},
      {id:'nc-2',companyId:'company-2',invoiceNumber:'NC-001',documentType:'03',originalSaleId:'sale-1'}
    ]};
    assert.equal(findLinkedCorrectionEvidence(state,item,'NC-001').id,'nc-1');
    assert.equal(findLinkedCorrectionEvidence(state,item,'NC-OTHER'),null);
  }finally{db.close();}
});

test('the administrator role cannot enter or execute correction cases',()=>{
  const db=setup();
  const administrator={id:8,username:'admin',role:'admin'};
  try {
    assert.throws(()=>registerCorrectionRequest(db,input,administrator),/requiere una sesión autenticada del contador/);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_correction_cases').get().n,0);
  } finally { db.close(); }
});
