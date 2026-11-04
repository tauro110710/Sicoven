'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,markCorrectionExecuted,observeCorrectionRequest,resubmitCorrectionRequest,withdrawCorrectionRequest,requireApprovedCorrectionCase,getCorrectionCase,listCorrectionCases,findLinkedCorrectionEvidence}=require('./accounting-correction-workflow.cjs');
function setup(){const db=new Database(':memory:');db.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime(\'now\')));');initializeCorrectionWorkflow(db);return db;}
const input={companyId:'co-1',entityType:'SALE',entityId:'sale-1',correctionType:'ANULACION',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001',reason:'Se detectó una duplicidad documental que debe corregirse.',workpaperNote:'Conciliación con libro de ventas, comprobante fiscal y asiento relacionado.'};
const admin=(id,username)=>({id,username,role:'admin'});
test('workflow enforces preparer-reviewer-executor segregation and append-only events',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'preparador'));
  assert.equal(requested.status,'PENDING_REVIEW');
  assert.throws(()=>db.prepare("UPDATE accounting_correction_cases SET status='APPROVED',workflow_stage='READY_FOR_EXECUTION',reviewed_by=1,reviewed_by_name='preparador' WHERE id=?").run(requested.id),/segregation/);
  assert.throws(()=>reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Revisión suficiente y documentada.'},admin(1,'preparador')),/no puede aprobar/);
  const approved=reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Soportes contrastados y efectos evaluados.'},admin(2,'revisor'));
  assert.equal(approved.status,'APPROVED');
  requireApprovedCorrectionCase(db,{companyId:'co-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},admin(3,'ejecutor'));
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se aplicó el documento correctivo.'},admin(2,'revisor')),/distinto del solicitante y del aprobador/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'FAC-001',reason:'Se intenta reutilizar la referencia original.'},admin(3,'ejecutor')),/misma del documento original/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-002',reason:'La referencia no coincide con el documento solicitado.'},admin(3,'ejecutor')),/no coincide con el documento correctivo/);
  const executed=markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se aplicó el documento correctivo.',evidenceRecordId:'credit-note-1',evidenceCollection:'sales'},admin(3,'ejecutor'));
  assert.equal(executed.status,'EXECUTED');
  assert.deepEqual(executed.events.map(e=>e.event_type),['REQUESTED','APPROVED','EXECUTION_STARTED','EXECUTED']);
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
  requireApprovedCorrectionCase(db,{companyId:'co-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},admin(3,'ejecutor'));
  db.exec("CREATE TRIGGER reject_execution_audit BEFORE INSERT ON audit_events WHEN NEW.event_type='accounting_correction_case_executed' BEGIN SELECT RAISE(ABORT,'execution audit failure'); END;");
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Ejecución documentada con soporte persistido.',evidenceRecordId:'credit-note-1',evidenceCollection:'sales'},admin(3,'ejecutor')),/execution audit failure/);
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
  {id:'linked-corrective',companyId:'co-1',invoiceNumber:'NC-001',documentType:'03',originalSaleId:'sale-source'},
  {id:'linked-debit',companyId:'co-1',invoiceNumber:'ND-001',documentType:'02',originalSaleId:'sale-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-900'),null);
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-901'),null);
 assert.equal(findLinkedCorrectionEvidence(state,item,'NC-001').id,'linked-corrective');
 assert.equal(findLinkedCorrectionEvidence(state,item,'ND-001').id,'linked-debit');
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
  assert.deepEqual(executed.events.map(e=>e.event_type),['REQUESTED','OBSERVED','RESUBMITTED','APPROVED','EXECUTION_STARTED','EXECUTED']);
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
test('retention vouchers are corrected through their source purchase or journal case, not standalone cases',()=>{
 const item={company_id:'co-1',entity_type:'VAT_VOUCHER',entity_id:'vat-voucher-1'};
 const state={vatVouchers:[{id:'vat-voucher-1',companyId:'co-1',correctionEntryId:'journal-correction-1'}],
  journalEntries:[{id:'journal-correction-1',companyId:'co-1',entryNumber:702}]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'702'),null);
});
test('journal adjustments may link through adjustmentForEntryId',()=>{
 const item={company_id:'co-1',entity_type:'JOURNAL_ENTRY',entity_id:'entry-source'};
 const state={journalEntries:[
  {id:'entry-source',companyId:'co-1',entryNumber:10},
  {id:'entry-adjustment',companyId:'co-1',entryNumber:11,adjustmentForEntryId:'entry-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'11').id,'entry-adjustment');
});

test('execution cannot be marked complete without exact evidence identity and collection',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Revisión completa con soportes suficientes.'},admin(2,'revisor'));
  requireApprovedCorrectionCase(db,{companyId:'co-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'},admin(3,'ejecutor'));
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Documento correctivo aplicado y conciliado.'},admin(3,'ejecutor')),/ID y la colección exacta/);
  assert.throws(()=>markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Documento correctivo aplicado y conciliado.',evidenceRecordId:'credit-note-1',evidenceCollection:'purchases'},admin(3,'ejecutor')),/ID y la colección exacta/);
  assert.equal(getCorrectionCase(db,requested.id).status,'APPROVED');
 }finally{db.close();}
});

test('inventory correction evidence requires correctionForMovementId and the exact reference',()=>{
 const item={company_id:'co-1',entity_type:'INVENTORY_MOVEMENT',entity_id:'movement-source'};
 const state={movements:[
  {id:'movement-source',companyId:'co-1',documentRef:'COMPRA-01'},
  {id:'movement-unrelated',companyId:'co-1',documentRef:'DEV-02'},
  {id:'movement-correction',companyId:'co-1',documentRef:'DEV-01',correctionForMovementId:'movement-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'DEV-01').id,'movement-correction');
 assert.equal(findLinkedCorrectionEvidence(state,item,'DEV-02'),null);
});

test('legacy correction cases migrate to workflow stages without changing their statuses',()=>{
 const db=new Database(':memory:');try{
  db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));");
  db.exec(`CREATE TABLE accounting_correction_cases (
    id TEXT PRIMARY KEY, company_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
    correction_type TEXT NOT NULL, source_ref TEXT NOT NULL, correction_ref TEXT NOT NULL, reason TEXT NOT NULL,
    workpaper TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('PENDING_REVIEW','APPROVED','REJECTED','EXECUTED')),
    requested_by INTEGER NOT NULL, requested_by_name TEXT NOT NULL, reviewed_by INTEGER, reviewed_by_name TEXT,
    review_reason TEXT, executed_by INTEGER, executed_by_name TEXT, execution_ref TEXT, created_at TEXT NOT NULL,
    reviewed_at TEXT, executed_at TEXT
  );`);
  const insert=db.prepare("INSERT INTO accounting_correction_cases(id,company_id,entity_type,entity_id,correction_type,source_ref,correction_ref,reason,workpaper,status,requested_by,requested_by_name,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for(const [id,status] of [['a','PENDING_REVIEW'],['b','APPROVED'],['c','REJECTED'],['d','EXECUTED']])
    insert.run(id,'co-1','SALE','sale-1','CORRECCION','FAC-1','NC-1','Motivo histórico de corrección.','Papel de trabajo histórico. ',status,1,'admin','2026-01-01T00:00:00.000Z');
  initializeCorrectionWorkflow(db);
  const rows=db.prepare('SELECT id,status,workflow_stage FROM accounting_correction_cases ORDER BY id').all();
  assert.deepEqual(rows.map(row=>[row.status,row.workflow_stage]),[
   ['PENDING_REVIEW','IN_REVIEW'],['APPROVED','READY_FOR_EXECUTION'],['REJECTED','CLOSED'],['EXECUTED','COMPLETED']
  ]);
 }finally{db.close();}
});

test('requester can withdraw an unexecuted case and withdrawal is terminal and auditable',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  assert.throws(()=>withdrawCorrectionRequest(db,{caseId:requested.id,reason:'Se decide retirar la solicitud por cambio de criterio.'},admin(2,'otro')),/solicitante original/);
  const withdrawn=withdrawCorrectionRequest(db,{caseId:requested.id,reason:'Se decide retirar la solicitud por cambio de criterio.'},admin(1,'solicitante'));
  assert.equal(withdrawn.workflow_stage,'WITHDRAWN');
  assert.equal(withdrawn.status,'PENDING_REVIEW');
  assert.equal(withdrawn.events.at(-1).event_type,'WITHDRAWN');
  assert.throws(()=>reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Se revisa la solicitud retirada por el usuario.'},admin(2,'revisor')),/ya fue revisado|no está en revisión/);
  assert.throws(()=>resubmitCorrectionRequest(db,{caseId:requested.id,reason:'Se desea volver a enviar la solicitud retirada.'},admin(1,'solicitante')),/no tiene observaciones pendientes/);
  assert.throws(()=>withdrawCorrectionRequest(db,{caseId:requested.id,reason:'Se intenta retirar una segunda vez.'},admin(1,'solicitante')),/cerrado, ejecutado o retirado/);
  const reopened=registerCorrectionRequest(db,input,admin(4,'solicitante-2'));
  assert.equal(reopened.status,'PENDING_REVIEW');
 }finally{db.close();}
});
test('requester may withdraw an approved case before any execution',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Se verificó la solicitud y sus documentos fuente.'},admin(2,'revisor'));
  const withdrawn=withdrawCorrectionRequest(db,{caseId:requested.id,reason:'La empresa decide no continuar con esta corrección.'},admin(1,'solicitante'));
  assert.equal(withdrawn.workflow_stage,'WITHDRAWN');
  assert.equal(withdrawn.status,'PENDING_REVIEW');
  assert.equal(withdrawn.events.map(e=>e.event_type).join(','),'REQUESTED,APPROVED,WITHDRAWN');
 }finally{db.close();}
});

test('existing observation ledger migrates to allow withdrawal without losing events',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  db.exec(`
   DROP TRIGGER IF EXISTS correction_case_workflow_events_no_update;
   DROP TRIGGER IF EXISTS correction_case_workflow_events_no_delete;
   DROP INDEX IF EXISTS idx_correction_case_workflow_events_case;
   DROP TABLE accounting_correction_case_workflow_events;
   CREATE TABLE accounting_correction_case_workflow_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, case_id TEXT NOT NULL REFERENCES accounting_correction_cases(id),
    event_type TEXT NOT NULL CHECK(event_type IN ('OBSERVED','RESUBMITTED')),
    actor_id INTEGER NOT NULL, actor_name TEXT NOT NULL, reason TEXT NOT NULL,
    metadata_json TEXT NOT NULL, created_at TEXT NOT NULL
   );
  `);
  db.prepare("INSERT INTO accounting_correction_case_workflow_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)")
   .run(requested.id,'OBSERVED',2,'revisor','Falta soporte verificable.','{}','2026-11-01T00:00:00.000Z');
  initializeCorrectionWorkflow(db);
  const preserved=db.prepare('SELECT event_type,actor_name FROM accounting_correction_case_workflow_events WHERE case_id=?').get(requested.id);
  assert.deepEqual(preserved,{event_type:'OBSERVED',actor_name:'revisor'});
  db.prepare("INSERT INTO accounting_correction_case_workflow_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)")
   .run(requested.id,'WITHDRAWN',1,'solicitante','Se retira formalmente la solicitud.','{}','2026-11-02T00:00:00.000Z');
  db.prepare("INSERT INTO accounting_correction_case_workflow_events(case_id,event_type,actor_id,actor_name,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?)")
   .run(requested.id,'EXECUTION_STARTED',3,'ejecutor','Inicio de ejecución autorizado.','{}','2026-11-03T00:00:00.000Z');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_correction_case_workflow_events WHERE event_type='WITHDRAWN'").get().n,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM accounting_correction_case_workflow_events WHERE event_type='EXECUTION_STARTED'").get().n,1);
 }finally{db.close();}
});

test('ISLR reversal events are governed by the purchase or journal correction case, not standalone cases',()=>{
 const item={company_id:'co-1',entity_type:'ISLR_EVENT',entity_id:'islr-source'};
 const state={islrFiscalEvents:[
  {id:'islr-source',companyId:'co-1',kind:'ACCOUNT_CREDIT'},
  {id:'islr-reversal',companyId:'co-1',kind:'REVERSAL',reversalOfEventId:'islr-source'}
 ]};
 assert.equal(findLinkedCorrectionEvidence(state,item,'islr-reversal'),null);
});

test('correction generators require one matching approved case and an independent executor',()=>{
 const db=setup();try{
  const requested=registerCorrectionRequest(db,input,admin(1,'solicitante'));
  const gateInput={companyId:'co-1',entityType:'SALE',entityId:'sale-1',sourceDocumentRef:'FAC-001',correctionDocumentRef:'NC-001'};
  assert.throws(()=>requireApprovedCorrectionCase(db,gateInput,admin(3,'ejecutor')),/No existe un expediente formal aprobado/);
  reviewCorrectionRequest(db,{caseId:requested.id,decision:'APPROVE',reason:'Se verificó la solicitud y los soportes.'},admin(2,'revisor'));
  assert.throws(()=>requireApprovedCorrectionCase(db,gateInput,admin(1,'solicitante')),/distinto del solicitante y del aprobador/);
  assert.throws(()=>requireApprovedCorrectionCase(db,gateInput,admin(2,'revisor')),/distinto del solicitante y del aprobador/);
  assert.throws(()=>requireApprovedCorrectionCase(db,{...gateInput,correctionDocumentRef:'NC-999'},admin(3,'ejecutor')),/No existe un expediente formal aprobado/);
  assert.deepEqual(requireApprovedCorrectionCase(db,gateInput,admin(3,'ejecutor')),{ok:true,caseId:requested.id,correctionType:'ANULACION',resumed:false});
  assert.deepEqual(requireApprovedCorrectionCase(db,gateInput,admin(3,'ejecutor')),{ok:true,caseId:requested.id,correctionType:'ANULACION',resumed:true});
  assert.throws(()=>registerCorrectionRequest(db,input,admin(4,'solicitante-2')),/Ya existe un expediente activo/);
 }finally{db.close();}
});
