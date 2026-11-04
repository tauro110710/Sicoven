'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {initializeCorrectionWorkflow,registerCorrectionRequest,reviewCorrectionRequest,markCorrectionExecuted,getCorrectionCase,listCorrectionCases}=require('./accounting-correction-workflow.cjs');
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
  const executed=markCorrectionExecuted(db,{caseId:requested.id,executionRef:'NC-001',reason:'Se aplicó el documento correctivo.'},admin(3,'ejecutor'));
  assert.equal(executed.status,'EXECUTED');
  assert.deepEqual(executed.events.map(e=>e.event_type),['REQUESTED','APPROVED','EXECUTED']);
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
