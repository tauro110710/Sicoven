'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBackup, verifyBackupDirectory } = require('./backup-restore.cjs');
const { createRestoreStaging } = require('./restore-staging.cjs');
const { createJournal, readJournal, transitionJournal } = require('./restore-journal.cjs');

const DB = 'sicoven.sqlite';
const DOCS = 'supporting-documents';
const JOURNAL = 'restore-journal.json';
const OP_ROOT = 'restore-operations';

function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function realDir(p, label) { const s=fs.lstatSync(p); if(!s.isDirectory()||s.isSymbolicLink()) throw new Error(label+' no es un directorio real.'); }
function realFile(p, label) { const s=fs.lstatSync(p); if(!s.isFile()||s.isSymbolicLink()) throw new Error(label+' no es un archivo regular.'); }
function hashFile(file) { const h=crypto.createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex'); }
function copyFileVerified(from,to) { realFile(from,'Origen de copia'); fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL); if(hashFile(from)!==hashFile(to)) throw new Error('La copia de la base de datos no coincide.'); }
function copyTree(source,destination) {
  realDir(source,'Carpeta documental de respaldo'); fs.mkdirSync(destination,{recursive:false});
  for(const e of fs.readdirSync(source,{withFileTypes:true})) {
    const a=path.join(source,e.name), b=path.join(destination,e.name);
    if(e.isSymbolicLink()) throw new Error('No se permiten enlaces en documentos.');
    if(e.isDirectory()) copyTree(a,b);
    else if(e.isFile()) { fs.copyFileSync(a,b,fs.constants.COPYFILE_EXCL); if(hashFile(a)!==hashFile(b)) throw new Error('Documento no coincide: '+e.name); }
    else throw new Error('Elemento especial en documentos.');
  }
}
function replaceFromBackup(backupDir,userDataDir,operationDir) {
  const verified=verifyBackupDirectory(backupDir);
  const activeDb=path.join(userDataDir,DB), activeDocs=path.join(userDataDir,DOCS);
  const nextDb=path.join(operationDir,'next.sqlite');
  const nextDocs=path.join(operationDir,'next-documents');
  copyFileVerified(path.join(backupDir,DB),nextDb);
  if(exists(path.join(backupDir,DOCS))) copyTree(path.join(backupDir,DOCS),nextDocs);
  else fs.mkdirSync(nextDocs);
  // El destino anterior se conserva hasta verificar el reemplazo. Los renames
  // ocurren dentro del mismo volumen de userData para evitar copias parciales.
  const oldDb=path.join(operationDir,'displaced.sqlite');
  const oldDocs=path.join(operationDir,'displaced-documents');
  if(exists(activeDb)) fs.renameSync(activeDb,oldDb);
  try {
    fs.renameSync(nextDb,activeDb);
    if(exists(activeDocs)) fs.renameSync(activeDocs,oldDocs);
    fs.renameSync(nextDocs,activeDocs);
    const activeHash=hashFile(activeDb);
    if(activeHash!==verified.databaseSha256) throw new Error('La base instalada no coincide con el respaldo.');
    const check=verifyBackupDirectory(backupDir);
    if(check.databaseSha256!==activeHash || check.documentCount!==verified.documentCount) throw new Error('La verificación posterior a la instalación falló.');
  } catch(error) {
    // El journal hará rollback en la recuperación previa al siguiente arranque.
    throw error;
  }
}
function restoreRollback(rollbackDir,userDataDir,operationDir) {
  const verified=verifyBackupDirectory(rollbackDir);
  const dbPath=path.join(userDataDir,DB), docsPath=path.join(userDataDir,DOCS);
  const tmpDb=path.join(operationDir,'rollback.sqlite');
  const tmpDocs=path.join(operationDir,'rollback-documents');
  if(exists(tmpDb)) fs.rmSync(tmpDb,{force:true});
  if(exists(tmpDocs)) fs.rmSync(tmpDocs,{recursive:true,force:true});
  copyFileVerified(path.join(rollbackDir,DB),tmpDb);
  if(exists(path.join(rollbackDir,DOCS))) copyTree(path.join(rollbackDir,DOCS),tmpDocs); else fs.mkdirSync(tmpDocs);
  const displacedDb=path.join(operationDir,'failed.sqlite');
  const displacedDocs=path.join(operationDir,'failed-documents');
  if(exists(dbPath)) { if(exists(displacedDb)) fs.rmSync(displacedDb,{force:true}); fs.renameSync(dbPath,displacedDb); }
  fs.renameSync(tmpDb,dbPath);
  if(exists(docsPath)) { if(exists(displacedDocs)) fs.rmSync(displacedDocs,{recursive:true,force:true}); fs.renameSync(docsPath,displacedDocs); }
  fs.renameSync(tmpDocs,docsPath);
  if(hashFile(dbPath)!==verified.databaseSha256) throw new Error('Rollback: la base restaurada no coincide.');
  return verified;
}
function archiveCommittedRollback(userDataDir,operationId) {
  const operationDir=path.join(userDataDir,OP_ROOT,operationId);
  const rollbackDir=path.join(operationDir,'rollback');
  if(!exists(rollbackDir)) throw new Error('No existe el snapshot de retorno de la restauración confirmada.');
  realDir(rollbackDir,'Snapshot de retorno');
  const historyRoot=path.join(userDataDir,'restore-history');
  if(!exists(historyRoot)) fs.mkdirSync(historyRoot);
  realDir(historyRoot,'Historial de restauraciones');
  const destination=path.join(historyRoot,operationId);
  if(exists(destination)) throw new Error('Ya existe el snapshot histórico de esta restauración.');
  fs.renameSync(rollbackDir,destination);
}
function cleanupOperation(userDataDir,operationId) {
  const root=path.join(userDataDir,OP_ROOT);
  const dir=path.join(root,operationId);
  if(exists(dir)) { realDir(dir,'Directorio de operación'); fs.rmSync(dir,{recursive:true,force:true}); }
  const staging=path.join(userDataDir,'restore-staging',operationId);
  if(exists(staging)) { realDir(staging,'Staging de restauración'); fs.rmSync(staging,{recursive:true,force:true}); }
  const journal=path.join(userDataDir,JOURNAL);
  if(exists(journal)) fs.rmSync(journal);
}
function recoverPendingRestore({userDataDir}) {
  const root=path.resolve(userDataDir); realDir(root,'Datos de SICOVEN');
  const journalPath=path.join(root,JOURNAL);
  if(!exists(journalPath)) return {ok:true,recovered:false};
  const journal=readJournal(journalPath);
  const operationDir=path.join(root,OP_ROOT,journal.operationId);
  realDir(path.dirname(operationDir),'Operaciones de restauración');
  realDir(operationDir,'Operación de restauración');
  const rollbackDir=path.join(operationDir,'rollback');
  if(journal.state==='committed') {
    archiveCommittedRollback(root,journal.operationId);
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'kept_committed_restore'};
  }
  if(journal.state==='rolled_back') {
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'kept_committed_restore'};
  }
  if(journal.state==='prepared') {
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'discarded_unstarted_restore'};
  }
  const verified=verifyBackupDirectory(rollbackDir);
  if(verified.databaseSha256!==journal.hashes.rollbackDatabase) throw new Error('El respaldo de retorno no coincide con el journal. SICOVEN se mantiene bloqueado.');
  if(journal.state!=='rolling_back') transitionJournal({journalPath,expectedState:journal.state,nextState:'rolling_back',lastStep:'startup_recovery_rollback'});
  restoreRollback(rollbackDir,root,operationDir);
  transitionJournal({journalPath,expectedState:'rolling_back',nextState:'rolled_back',lastStep:'startup_rollback_verified'});
  cleanupOperation(root,journal.operationId);
  return {ok:true,recovered:true,action:'rolled_back_incomplete_restore'};
}
async function executeRestore({backupDirectory,userDataDir,db,closeDatabase,reopenDatabase}) {
  if(!db?.open) throw new Error('La base de datos debe estar abierta para preparar la restauración.');
  const root=path.resolve(userDataDir), source=path.resolve(backupDirectory);
  realDir(root,'Datos de SICOVEN');
  if(source===root || source.startsWith(root+path.sep)) throw new Error('El respaldo no puede estar dentro de los datos activos.');
  const sourceInfo=verifyBackupDirectory(source);
  const operationId=crypto.randomUUID();
  const operationRoot=path.join(root,OP_ROOT);
  if(!exists(operationRoot)) fs.mkdirSync(operationRoot);
  realDir(operationRoot,'Operaciones de restauración');
  const operationDir=path.join(operationRoot,operationId);
  fs.mkdirSync(operationDir);
  const rollbackDir=path.join(operationDir,'rollback');
  const journalPath=path.join(root,JOURNAL);
  try {
    const staged=createRestoreStaging({backupDirectory:source,userDataDir:root,operationId});
    const stagedBackup=staged.stagingDirectory;
    createJournal({journalPath,sourceDatabaseSha256:hashFile(path.join(root,DB)),stagedDatabaseSha256:staged.databaseSha256});
    await createBackup({db,userDataDir:root,destination:rollbackDir,allowInternalDestination:true});
    const rollbackInfo=verifyBackupDirectory(rollbackDir);
    transitionJournal({journalPath,expectedState:'prepared',nextState:'rollback_ready',lastStep:'rollback_snapshot_verified',rollbackDatabaseSha256:rollbackInfo.databaseSha256});
    await closeDatabase();
    transitionJournal({journalPath,expectedState:'rollback_ready',nextState:'installing',lastStep:'physical_swap_started'});
    replaceFromBackup(stagedBackup,root,operationDir);
    transitionJournal({journalPath,expectedState:'installing',nextState:'installed',lastStep:'database_and_documents_verified'});
    await reopenDatabase();
    transitionJournal({journalPath,expectedState:'installed',nextState:'committed',lastStep:'restore_committed'});
    archiveCommittedRollback(root,operationId);
    cleanupOperation(root,operationId);
    return {ok:true,operationId,databaseSha256:sourceInfo.databaseSha256,documentCount:sourceInfo.documentCount};
  } catch(error) {
    try {
      const current=readJournal(journalPath);
      if(current && current.state!=='prepared' && current.state!=='committed') {
        if(db?.open) await closeDatabase();
        recoverPendingRestore({userDataDir:root});
        await reopenDatabase();
      } else if(current?.state==='prepared') cleanupOperation(root,operationId);
    } catch(recoveryError) {
      throw new Error('La restauración falló y el rollback automático requiere intervención. No abrir SICOVEN ni modificar sus archivos. Causa: '+error.message+'; recuperación: '+recoveryError.message);
    }
    throw error;
  }
}

function registerRestoreIpc({ipcMain,app,dialog,licenseView,getActiveSession,getDb,closeDatabase,reopenDatabase,getWindow}) {
  ipcMain.handle('sicoven:restore-execute',async(_event,token)=>{
    const licensing=licenseView();
    if(!licensing.authorized) throw new Error(licensing.message||'Licencia no autorizada.');
    const actor=getActiveSession(token);
    if(!actor||String(actor.role||'').toLowerCase()!=='admin') throw new Error('Solo un administrador autenticado puede restaurar respaldos.');
    const parent=getWindow?.();
    const selection=parent
      ? await dialog.showOpenDialog(parent,{title:'Seleccionar respaldo verificado de SICOVEN',properties:['openDirectory']})
      : await dialog.showOpenDialog({title:'Seleccionar respaldo verificado de SICOVEN',properties:['openDirectory']});
    if(selection.canceled||!selection.filePaths?.[0]) return {ok:false,canceled:true};
    const check=verifyBackupDirectory(selection.filePaths[0]);
    const confirm=parent
      ? await dialog.showMessageBox(parent,{type:'warning',buttons:['Cancelar','Restaurar respaldo'],defaultId:0,cancelId:0,title:'Confirmar restauración contable',message:'Esta operación reemplazará la base contable y los documentos actuales.',detail:'Respaldo: '+path.basename(selection.filePaths[0])+'\\nDocumentos: '+check.documentCount+'\\nHuella SQLite: '+check.databaseSha256+'\\nSe creará un snapshot de retorno antes del cambio.'})
      : await dialog.showMessageBox({type:'warning',buttons:['Cancelar','Restaurar respaldo'],defaultId:0,cancelId:0,title:'Confirmar restauración contable',message:'Esta operación reemplazará la base contable y los documentos actuales.',detail:'Respaldo: '+path.basename(selection.filePaths[0])+'\\nDocumentos: '+check.documentCount+'\\nHuella SQLite: '+check.databaseSha256+'\\nSe creará un snapshot de retorno antes del cambio.'});
    if(confirm.response!==1) return {ok:false,canceled:true};
    const result=await executeRestore({backupDirectory:selection.filePaths[0],userDataDir:app.getPath('userData'),db:getDb(),closeDatabase,reopenDatabase});
    const active=getDb();
    active.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('accounting_backup_restored',JSON.stringify({actor:actor.username,databaseSha256:result.databaseSha256,documentCount:result.documentCount,operationId:result.operationId}));
    return result;
  });
}
module.exports={executeRestore,recoverPendingRestore,registerRestoreIpc};

