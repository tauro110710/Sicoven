'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,markCorrectionExecuted,observeCorrectionRequest,resubmitCorrectionRequest,getCorrectionCase,listCorrectionCases,findLinkedCorrectionEvidence}=require('./accounting-correction-workflow.cjs');
function setup(){const db=new Database(':memory:');db.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime(\'now\')));');initializeCorrectionWorkflow(db);return db;}
const input={companyId:'co-1',entityType:'SALE',entityId:'sale-1',correctionType:'ANULACION',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001',reason:'Se detectó una duplicidad documental que debe corregirse.',workpaperNote:'Conciliación con libro de ventas, comprobante fiscal y asiento relacionado.'};
const admin=(id,username)=>({id,username,role:'admin'});
test('workflow enforces preparer-reviewer-executor segregation and append-only events',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'preparador'));
  assert.equal(requested.status,'PENDING_REVIEW');
  assert.throws(()=>db.prepare("UPDATE accounting_correction_cases SET status='APPROVED',reviewed_by=1,reviewed_by_name='preparador' WHERE id=?").run(requested.id),/segregation/);
  assert.throws(()=>reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Revisión suficiente y documentada.'},admin(1,'preparador')),/no puede aprobar/);
  const approved=reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Soportes contrastados y efectos evaluados.'},admin(2,'revisor'));
  assert.equal(approved.status,'APPROVED');
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se aplicó el documento correctivo.'},admin(2,'revisor')),/distinto del solicitante y del aprobador/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'FAC-001',reason:'Se intenta reutilizar la referencia original.'},admin(3,'ejecutor')),/misma del documento original/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-002',reason:'La referencia no coincide con el documento solicitado.'},admin(3,'ejecutor')),/no coincide con el documento correctivo/);
  const executed=markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se aplicó el documento correctivo.',evidenceRecordId:'credit-note-1',evidenceCollection:'sales'},admin(3,'ejecutor'));
  assert.equal(executed.status,'EXECUTED');
  assert.deepEqual(executed.events.map(e=>e.event_type),['REQUESTED','APPROVED','EXECUTED']);
  assert.equal(executed.events[2].metadata.evidenceRecordId,'credit-note-1');
  assert.equal(executed.events[2].metadata.evidenceCollection,'sales');
  assert.equal(listCorrectionCases(db,'co-1').length,1);
  assert.throws(()=>db.prepare('UPDATE accounting_correction_case_events SET reason=? WHERE id=1').run('alterado'),/append-only/);
  assert.throws(()=>db.prepare('DELETE FROM accounting_correction_case_events WHERE id=1').run(),/append-only/);
  assert.throws(()=>db.prepare('UPDATE accounting_correction_cases SET reason=? WHERE id=?').run('texto alterado',requested.id),/immutable|transition/);
  assert.throws(()=>db.prepare('DELETE FROM accounting_correction_cases WHERE id=?').run(requested.id),/cannot be deleted/);
 }finally{db.close();}
});
test('reject is terminal and cannot be approved or executed later',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'a'));
  const rejected=reviewCorrectionRequest(db,{caseId:requested.id,decision:'REJECT',reason:'La evidencia no demuestra el error alegado.'},admin(2,'b'));
  assert.equal(rejected.status,'REJECTED');
  assert.throws(()=>reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Nueva revisión con documentos suficientes.'},admin(3,'c')),/ya fue revisado/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se ejecuta la corrección documentada.'},admin(3,'c')),/Solo se puede ejecutar/);
 }finally{db.close();}
});
test('invalid actors and insufficient workpaper are rejected without records',()=>{
 const db=setup();try{
  assert.throws(()=>registerCorrectionRequest(db,{...input,workpaperNote:'corto'},admin(1,'a')),/al menos 15/);
  assert.throws(()=>registerCorrectionRequest(db,input,{id:1,username:'x',role:'cashier'}),/sesión administrativa/);
  assert.throws(()=>registerCorrectionRequest(db,input,{id:0,username:'a',role:'admin'}),/identidad válida/);
  assert.throws(()=>registerCorrectionRequest(db,input,{id:1,username:'  ',role:'admin'}),/identidad válida/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_correction_cases').get().n,0);
 }finally{db.close();}
});

test('request row rolls back when its audit event cannot be appended',()=>{
 const db=setup();try{
  db.exec("CREATE TRIGGER reject_case_event BEFORE INSERT ON accounting_correction_case_events BEGIN SELECT RAISE(ABORT,'injected event failure'); END;");
  assert.throws(()=>registerCorrectionRequest(db,input,admin(1,'a')),/injected event failure/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM accounting_correction_cases').get().n,0);
 }finally{db.close();}
});

test('review transition rolls back when the general audit ledger rejects the event',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  db.exec("CREATE TRIGGER reject_review_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_approved' BEGIN SELECT RAISE(ABORT,'review audit failure'); END;");
  assert.throws(()=>reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Revisión completa con soportes suficientes.'},admin(2,'revisor')),/review audit failure/);
  const current=getCorrectionCase(db,requested.id);
  assert.equal(current.status,'PENDING_REVIEW');
  assert.deepEqual(current.events.map(e=>e.event_type),['REQUESTED']);
 }finally{db.close();}
});

test('execution transition rolls back when the general audit ledger rejects the event',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Revisión completa con soportes suficientes.'},admin(2,'revisor'));
  db.exec("CREATE TRIGGER reject_execution_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_executed' BEGIN SELECT RAISE(ABORT,'execution audit failure'); END;");
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Ejecución documentada con soporte persistido.'},admin(3,'ejecutor')),/execution audit failure/);
  const current=getCorrectionCase(db,requested.id);
  assert.equal(current.status,'APPROVED');
  assert.deepEqual(current.events.map(e=>e.event_type),['REQUESTED','APPROVED']);
 }finally{db.close();}
});

test('execution evidence must be a correction document explicitly linked to the source record',()=>{
 const item={company_id:'co-1',entity_type:'SALE',entity_id:'sale-source'};
 const state={sales:[
  {id:'sale-source',companyId:'co-1',invoiceNumber:'FAC-001',documentType:'01'},
  {id:'unrelated',companyId:'co-1',invoiceNumber:'NC-900',documentType:'03'},
  {id:'wrong-company',companyId:'co-2',invoiceNumber:'NC-901',documentType:'03',originalSaleId:'sale-source'},
  {id:'linked-corrective',companyId:'co-1',invoiceNumber:'NC-001',documentType:'03',originalSaleId:'sale-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-900'),null);
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-901'),null);
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-001').id,'linked-corrective');
 assert.equal(findLinkedCorrectionEvidence(state,item,'FAC-001'),null);
});

test('journal reversal evidence requires reversalOfEntryId and exact reference',()=>{
 const item={company_id:'co-1',entity_type:'JOURNAL_ENTRY',entity_id:'entry-source'};
 const state={journalEntries:[
  {id:'entry-source',companyId:'co-1',entryNumber:'ASI-001'},
  {id:'entry-unrelated',companyId:'co-1',entryNumber:'ASI-REV-001'},
  {id:'entry-reversal',companyId:'co-1',entryNumber:'ASI-REV-001',reversalOfEntryId:'entry-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'ASI-REV-001').id,'entry-reversal');
 assert.equal(findLinkedCorrectionEvidence(state,item,'ASI-001'),null);
});

test('observation returns the case to its requester and resubmission restarts independent review',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  const observed=observeCorrectionRequest(db,{caseId:requested.id,reason:'Falta el soporte fiscal legible y la conciliación del asiento.'},admin(2,'revisor-1'));
  assert.equal(observed.status,'PENDING_REVIEW');
  assert.equal(observed.workflow_stage,'OBSERVATION_REQUIRED');
  assert.equal(observed.reviewed_by,2);
  assert.throws(()=>resubmitCorrectionRequest(db,{caseId:requested.id,reason:'Se completó la documentación requerida y se adjunta el soporte.'},admin(3,'otro-admin')),/solicitante original/);
  const resubmitted=resubmitCorrectionRequest(db,{caseId:requested.id,reason:'Se completó la documentación requerida y se adjunta el soporte.'},admin(1,'solicitante'));
  assert.equal(resubmitted.workflow_stage,'IN_REVIEW');
  assert.equal(resubmitted.reviewed_by,null);
  assert.deepEqual(resubmitted.events.map(e=>e.event_type),['REQUESTED','OBSERVED','RESUBMITTED']);
  const approved=reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Se verificaron los soportes nuevos y la conciliación.'},admin(3,'revisor-2'));
  assert.equal(approved.workflow_stage,'READY_FOR_EXECUTION');
  const executed=markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Documento correctivo aplicado y conciliado.',evidenceRecordId:'credit-note-1',evidenceCollection:'sales'},admin(4,'ejecutor'));
  assert.equal(executed.workflow_stage,'COMPLETED');
  assert.deepEqual(executed.events.map(e=>e.event_type),['REQUESTED','OBSERVED','RESUBMITTED','APPROVED','EXECUTED']);
 }finally{db.close();}
});
test('observation and resubmission are append-only and roll back with audit failures',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  db.exec("CREATE TRIGGER reject_observation_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_observed' BEGIN SELECT RAISE(ABORT,'observation audit failure'); END;");
  assert.throws(()=>observeCorrectionRequest(db,{caseId:requested.id,reason:'Falta evidencia legible y conciliación del asiento.'},admin(2,'revisor')),/observation audit failure/);
  assert.equal(getCorrectionCase(db,requested.id).workflow_stage,'IN_REVIEW');
  db.exec('DROP TRIGGER reject_observation_audit');
  observeCorrectionRequest(db,{caseId:requested.id,reason:'Falta evidencia legible y conciliación del asiento.'},admin(2,'revisor'));
  db.exec("CREATE TRIGGER reject_resubmission_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_resubmitted' BEGIN SELECT RAISE(ABORT,'resubmission audit failure'); END;");
  assert.throws(()=>resubmitCorrectionRequest(db,{caseId:requested.id,reason:'Se incorpora soporte adicional y conciliación completa.'},admin(1,'solicitante')),/resubmission audit failure/);
  assert.equal(getCorrectionCase(db,requested.id).workflow_stage,'OBSERVATION_REQUIRED');
  assert.throws(()=>db.prepare('UPDATE accounting_correction_case_workflow_events SET reason=? WHERE id=1').run('alterado'),/append-only/);
  assert.throws(()=>db.prepare('DELETE FROM accounting_correction_case_workflow_events WHERE id=1').run(),/append-only/);
 }finally{db.close();}
});

test('purchase credit and debit notes must link the original purchase explicitly',()=>{
 const item={company_id:'co-1',entity_type:'PURCHASE',entity_id:'purchase-source'};
 const state={purchases:[
  {id:'purchase-source',companyId:'co-1',invoiceNumber:'FAC-P-01',documentType:'01'},
  {id:'purchase-nc',companyId:'co-1',invoiceNumber:'NC-P-01',creditNoteNumber:'NC-P-01',documentType:'03',originalPurchaseId:'purchase-source'},
  {id:'purchase-nd',companyId:'co-1',invoiceNumber:'ND-P-01',debitNoteNumber:'ND-P-01',documentType:'02',originalPurchaseId:'purchase-source'},
  {id:'purchase-unlinked',companyId:'co-1',invoiceNumber:'NC-P-02',documentType:'03'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-P-01').id,'purchase-nc');
 assert.equal(findLinkedCorrectionEvidence(state,item,'ND-P-01').id,'purchase-nd');
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-P-02'),null);
});
test('retention voucher correction evidence is its persisted corrective journal entry',()=>{
 const item={company_id:'co-1',entity_type:'VAT_VOUCHER',entity_id:'vat-voucher-1'};
 const state={
  vatVouchers:[{id:'vat-voucher-1',companyId:'co-1',correctionEntryId:'journal-correction-1',correctionEntryIds:['journal-correction-1']}],
  journalEntries:[
   {id:'journal-unrelated',companyId:'co-1',entryNumber:701},
   {id:'journal-correction-1',companyId:'co-1',entryNumber:702}
  ]
 };
 const evidence=findLinkedCorrectionEvidence(state,item,'702');
 assert.equal(evidence.id,'journal-correction-1');
 assert.equal(evidence.__evidenceCollection,'journalEntries');
 assert.equal(findLinkedCorrectionEvidence(state,item,'701'),null);
});
test('journal adjustments may link through adjustmentForEntryId',()=>{
 const item={company_id:'co-1',entity_type:'JOURNAL_ENTRY',entity_id:'entry-source'};
 const state={journalEntries:[
  {id:'entry-source',companyId:'co-1',entryNumber:10},
  {id:'entry-adjustment',companyId:'co-1',entryNumber:11,adjustmentForEntryId:'entry-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'11').id,'entry-adjustment');
});
