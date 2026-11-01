'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Database=require('better-sqlite3');
const {createBackup,verifyBackupDirectory}=require('./backup-restore.cjs');
const {executeRestore,recoverPendingRestore}=require('./restore-engine.cjs');
const {createJournal,transitionJournal}=require('./restore-journal.cjs');
const {sha256File}=require('./sqlite-integrity.cjs');

function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sicoven-restore-engine-'));
 const userDataDir=path.join(root,'userData'); fs.mkdirSync(userDataDir);
 fs.mkdirSync(path.join(userDataDir,'supporting-documents'));
 let db=new Database(path.join(userDataDir,'sicoven.sqlite'));
 db.exec('CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)');
 const put=(value)=>db.prepare("INSERT OR REPLACE INTO app_state VALUES('accounting',?)").run(JSON.stringify({companies:[{id:value}],journalEntries:[]}));
 put('original');
 fs.writeFileSync(path.join(userDataDir,'supporting-documents','source.pdf'),'original document');
 const backupDirectory=path.join(root,'backup');
 const makeBackup=async(dest=backupDirectory)=>createBackup({db,userDataDir,destination:dest});
 const close=()=>{try{if(db?.open)db.close();}catch{} fs.rmSync(root,{recursive:true,force:true});};
 return {root,userDataDir,backupDirectory,get db(){return db;},put,
  async makeBackup(dest){return makeBackup(dest);},
  closeDb(){if(db?.open)db.close();},
  reopen(){db=new Database(path.join(userDataDir,'sicoven.sqlite'));},
  close};
}
test('physical restore replaces SQLite and supporting documents after verified rollback snapshot',async()=>{
 const h=fixture();
 try{
  await h.makeBackup();
  const target=path.join(h.root,'target');
  const other=new Database(target);
  other.exec('CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL)');
  other.prepare("INSERT INTO app_state VALUES('accounting',?)").run(JSON.stringify({companies:[{id:'restored'}],journalEntries:[]}));
  other.close();
  const replacement=path.join(h.root,'replacement'); fs.mkdirSync(replacement);
  fs.copyFileSync(target,path.join(replacement,'sicoven.sqlite'));
  fs.mkdirSync(path.join(replacement,'supporting-documents'));
  fs.writeFileSync(path.join(replacement,'supporting-documents','new.pdf'),'new document');
  const db2=new Database(path.join(replacement,'sicoven.sqlite'));
  await createBackup({db:db2,userDataDir:replacement,destination:path.join(h.root,'restore-source')}); db2.close();
  const result=await executeRestore({backupDirectory:path.join(h.root,'restore-source'),userDataDir:h.userDataDir,db:h.db,closeDatabase:async()=>h.closeDb(),reopenDatabase:async()=>h.reopen()});
  assert.equal(result.ok,true);
  assert.equal(h.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json.includes('restored'),true);
  assert.equal(fs.readFileSync(path.join(h.userDataDir,'supporting-documents','new.pdf'),'utf8'),'new document');
  assert.equal(fs.existsSync(path.join(h.userDataDir,'restore-journal.json')),false);
 }finally{h.close();}
});
test('startup recovery rolls back an interrupted physical swap before database open',async()=>{
 const h=fixture();
 try{
  const rollback=path.join(h.userDataDir,'rollback-test');
  await createBackup({db:h.db,userDataDir:h.userDataDir,destination:rollback,allowInternalDestination:true});
  const operationId='123e4567-e89b-42d3-a456-426614174000';
  const opRoot=path.join(h.userDataDir,'restore-operations');fs.mkdirSync(opRoot);
  const op=path.join(opRoot,operationId);fs.mkdirSync(op);
  const journalPath=path.join(h.userDataDir,'restore-journal.json');
  const hash=sha256File(path.join(h.userDataDir,'sicoven.sqlite'));
  const j=createJournal({journalPath,sourceDatabaseSha256:hash,stagedDatabaseSha256:'b'.repeat(64)});
  transitionJournal({journalPath,expectedState:'prepared',nextState:'rollback_ready',lastStep:'rollback_ready',rollbackDatabaseSha256:hash});
  transitionJournal({journalPath,expectedState:'rollback_ready',nextState:'installing',lastStep:'swap_started'});
  h.closeDb();
  fs.writeFileSync(path.join(h.userDataDir,'sicoven.sqlite'),'corrupt partial replacement');
  fs.rmSync(path.join(h.userDataDir,'supporting-documents'),{recursive:true,force:true});
  const result=recoverPendingRestore({userDataDir:h.userDataDir});
  assert.equal(result.action,'rolled_back_incomplete_restore');
  h.reopen();
  assert.equal(h.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json.includes('original'),true);
  assert.equal(fs.readFileSync(path.join(h.userDataDir,'supporting-documents','source.pdf'),'utf8'),'original document');
  assert.equal(fs.existsSync(journalPath),false);
 }finally{h.close();}
});
