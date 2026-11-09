'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBackup, verifyBackupDirectory } = require('./backup-restore.cjs');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const { createRestoreStaging } = require('./restore-staging.cjs');
const { createJournal, readJournal, transitionJournal } = require('./restore-journal.cjs');
const { appendRestoreOutcome, reconcileRestoreAudit } = require('./restore-audit-ledger.cjs');

const DB = 'sicoven.sqlite';
const DOCS = 'supporting-documents';
const COMPANIES = 'companies';
const JOURNAL = 'restore-journal.json';
const OP_ROOT = 'restore-operations';

function exists(p) { try { fs.lstatSync(p); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } }
function realDir(p, label) { const s=fs.lstatSync(p); if(!s.isDirectory()||s.isSymbolicLink()) throw new Error(label+' no es un directorio real.'); }
function realFile(p, label) { const s=fs.lstatSync(p); if(!s.isFile()||s.isSymbolicLink()) throw new Error(label+' no es un archivo regular.'); }
function hashFile(file) { const h=crypto.createHash('sha256'); h.update(fs.readFileSync(file)); return h.digest('hex'); }
function clearSqliteSidecars(userDataDir) {
  for (const suffix of ['-wal','-shm']) {
    const file=path.join(userDataDir,DB+suffix);
    if(!exists(file)) continue;
    realFile(file,'Archivo auxiliar SQLite');
    fs.rmSync(file);
  }
}
function copyFileVerified(from,to) { realFile(from,'Origen de copia'); fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL); if(hashFile(from)!==hashFile(to)) throw new Error('La copia de la base de datos no coincide.'); }
function verifyCompanyTree(directory, manifest) {
  const root = path.resolve(directory);
  const expected = manifest.companyDatabases || [];
  if (!exists(root)) {
    if (expected.length) throw new Error('Faltan las bases locales de empresas en el respaldo.');
    return true;
  }
  realDir(root, 'Directorio de bases por empresa');
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name));
  if (entries.length !== expected.length) throw new Error('La cantidad de bases de empresa no coincide con el manifiesto.');
  for (let index=0; index<entries.length; index+=1) {
    const entry=entries[index], item=expected[index];
    if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name !== item.companyId) throw new Error('La identidad o estructura de una base de empresa no coincide.');
    const file=path.join(root,entry.name,'accounting.sqlite');
    realFile(file,'Base SQLite de empresa');
    if (fs.statSync(file).size !== item.size || hashFile(file) !== item.sha256) throw new Error('La base SQLite de ' + item.companyId + ' no coincide con el respaldo.');
    const Database=require('better-sqlite3');
    const db=new Database(file,{readonly:true,fileMustExist:true});
    try {
      const meta=db.prepare("SELECT meta_value FROM sicoven_database_meta WHERE meta_key='company_id'").get();
      if(String(meta?.meta_value||'')!==item.companyId) throw new Error('La identidad interna de la base de empresa no coincide.');
    } finally { db.close(); }
    const companyDirectory = path.join(root, entry.name);
    const names = fs.readdirSync(companyDirectory);
    if (names.some(name => !['accounting.sqlite', 'supporting-documents'].includes(name))) {
      throw new Error('Una carpeta de empresa contiene archivos inesperados.');
    }
    const documentsDirectory = path.join(companyDirectory, 'supporting-documents');
    const actualDocuments = [];
    function collectCompanyDocuments(directory, relative = '') {
      if (!exists(directory)) return;
      realDir(directory, 'Documentos de empresa');
      for (const child of fs.readdirSync(directory, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
        const absolute = path.join(directory, child.name);
        const childRelative = relative ? relative + '/' + child.name : child.name;
        if (child.isSymbolicLink()) throw new Error('Los documentos de empresa no admiten enlaces simbólicos.');
        if (child.isDirectory()) collectCompanyDocuments(absolute, childRelative);
        else if (child.isFile()) {
          realFile(absolute, 'Documento de empresa');
          actualDocuments.push({
            path: 'supporting-documents/' + childRelative,
            size: fs.statSync(absolute).size,
            sha256: hashFile(absolute)
          });
        } else throw new Error('La carpeta de documentos de empresa contiene un elemento no admitido.');
      }
    }
    collectCompanyDocuments(documentsDirectory);
    const expectedDocuments = (item.documents || []).slice().sort((a,b)=>a.path.localeCompare(b.path));
    if (JSON.stringify(actualDocuments) !== JSON.stringify(expectedDocuments)) {
      throw new Error('Los documentos de la empresa ' + item.companyId + ' no coinciden con el manifiesto global.');
    }
  }
  return true;
}
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
  const activeDb=path.join(userDataDir,DB), activeDocs=path.join(userDataDir,DOCS), activeCompanies=path.join(userDataDir,COMPANIES);
  const nextDb=path.join(operationDir,'next.sqlite');
  const nextDocs=path.join(operationDir,'next-documents');
  const nextCompanies=path.join(operationDir,'next-companies');
  copyFileVerified(path.join(backupDir,DB),nextDb);
  if(exists(path.join(backupDir,DOCS))) copyTree(path.join(backupDir,DOCS),nextDocs);
  else fs.mkdirSync(nextDocs);
  if(exists(path.join(backupDir,COMPANIES))) copyTree(path.join(backupDir,COMPANIES),nextCompanies); else fs.mkdirSync(nextCompanies);
  // El destino anterior se conserva hasta verificar el reemplazo. Los renames
  // ocurren dentro del mismo volumen de userData para evitar copias parciales.
  const oldDb=path.join(operationDir,'displaced.sqlite');
  const oldDocs=path.join(operationDir,'displaced-documents');
  const oldCompanies=path.join(operationDir,'displaced-companies');
  if(exists(activeDb)) fs.renameSync(activeDb,oldDb);
  try {
    fs.renameSync(nextDb,activeDb);
    if(exists(activeDocs)) fs.renameSync(activeDocs,oldDocs);
    fs.renameSync(nextDocs,activeDocs);
    if(exists(activeCompanies)) fs.renameSync(activeCompanies,oldCompanies);
    fs.renameSync(nextCompanies,activeCompanies);
    verifyCompanyTree(activeCompanies, JSON.parse(fs.readFileSync(path.join(backupDir,'manifest.json'),'utf8')));
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
  // Verificar el snapshot completo antes de tocar WAL/SHM o la base activa.
  // Si el respaldo está corrupto, la recuperación debe fallar sin alterar datos.
  const verified=verifyBackupDirectory(rollbackDir);
  clearSqliteSidecars(userDataDir);
  const dbPath=path.join(userDataDir,DB), docsPath=path.join(userDataDir,DOCS), companiesPath=path.join(userDataDir,COMPANIES);
  const tmpDb=path.join(operationDir,'rollback.sqlite');
  const tmpDocs=path.join(operationDir,'rollback-documents');
  const tmpCompanies=path.join(operationDir,'rollback-companies');
  if(exists(tmpDb)) fs.rmSync(tmpDb,{force:true});
  if(exists(tmpDocs)) fs.rmSync(tmpDocs,{recursive:true,force:true});
  if(exists(tmpCompanies)) fs.rmSync(tmpCompanies,{recursive:true,force:true});
  copyFileVerified(path.join(rollbackDir,DB),tmpDb);
  if(exists(path.join(rollbackDir,DOCS))) copyTree(path.join(rollbackDir,DOCS),tmpDocs); else fs.mkdirSync(tmpDocs);
  if(exists(path.join(rollbackDir,COMPANIES))) copyTree(path.join(rollbackDir,COMPANIES),tmpCompanies); else fs.mkdirSync(tmpCompanies);
  const displacedDb=path.join(operationDir,'failed.sqlite');
  const displacedDocs=path.join(operationDir,'failed-documents');
  const displacedCompanies=path.join(operationDir,'failed-companies');
  if(exists(dbPath)) { if(exists(displacedDb)) fs.rmSync(displacedDb,{force:true}); fs.renameSync(dbPath,displacedDb); }
  fs.renameSync(tmpDb,dbPath);
  if(exists(docsPath)) { if(exists(displacedDocs)) fs.rmSync(displacedDocs,{recursive:true,force:true}); fs.renameSync(docsPath,displacedDocs); }
  fs.renameSync(tmpDocs,docsPath);
  if(exists(companiesPath)) { if(exists(displacedCompanies)) fs.rmSync(displacedCompanies,{recursive:true,force:true}); fs.renameSync(companiesPath,displacedCompanies); }
  fs.renameSync(tmpCompanies,companiesPath);
  // Verificar tanto SQLite como el conjunto íntegro de documentos tras el swap.
  const restored = verifyActiveMatchesBackup(rollbackDir,userDataDir);
  if(restored.databaseSha256!==verified.databaseSha256 || restored.documentCount!==verified.documentCount) {
    throw new Error('Rollback: la base o los documentos restaurados no coinciden con el snapshot.');
  }
  return restored;
}
function archiveCommittedRollback(userDataDir,operationId) {
  const operationDir=path.join(userDataDir,OP_ROOT,operationId);
  const rollbackDir=path.join(operationDir,'rollback');
  const historyRoot=path.join(userDataDir,'restore-history');
  if(!exists(historyRoot)) fs.mkdirSync(historyRoot);
  realDir(historyRoot,'Historial de restauraciones');
  const destination=path.join(historyRoot,operationId);
  if(exists(destination)) { verifyBackupDirectory(destination); return; }
  if(!exists(rollbackDir)) throw new Error('No existe el snapshot de retorno de la restauración confirmada.');
  realDir(rollbackDir,'Snapshot de retorno');
  verifyBackupDirectory(rollbackDir);
  fs.renameSync(rollbackDir,destination);
}
function cleanupOperation(userDataDir,operationId) {
  const journal=path.join(userDataDir,JOURNAL);
  if(exists(journal)) {
    const pending=readJournal(journal);
    if(pending.operationId!==operationId) throw new Error('El journal pertenece a otra operación; no se permite limpiar evidencias.');
  }
  const root=path.join(userDataDir,OP_ROOT);
  const dir=path.join(root,operationId);
  const stagingRoot=path.join(userDataDir,'restore-staging');
  const staging=path.join(stagingRoot,operationId);
  // Preflight every path before deleting the journal. An unsafe staging or
  // operation path must never erase the only durable recovery evidence.
  if(exists(root)) realDir(root,'Operaciones de restauración');
  if(exists(dir)) realDir(dir,'Directorio de operación');
  if(exists(stagingRoot)) realDir(stagingRoot,'Carpeta de staging de restauración');
  if(exists(staging)) realDir(staging,'Staging de restauración');
  if(exists(journal)) fs.rmSync(journal);
  if(exists(dir)) fs.rmSync(dir,{recursive:true,force:true});
  if(exists(staging)) fs.rmSync(staging,{recursive:true,force:true});
}
function verifyActiveMatchesBackup(backupDir, userDataDir) {
  const verified = verifyBackupDirectory(backupDir);
  const activeDb = path.join(userDataDir, DB);
  realFile(activeDb, 'Base SQLite activa');
  if (hashFile(activeDb) !== verified.databaseSha256) {
    throw new Error('El journal indica restauración confirmada, pero la base activa no coincide con el staging. SICOVEN se mantiene bloqueado.');
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  verifyCompanyTree(path.join(userDataDir,COMPANIES),manifest);
  const activeDocs = path.join(userDataDir, DOCS);
  const actual = [];
  function walk(root, relative = '') {
    if (!exists(root)) return;
    realDir(root, 'Carpeta documental activa');
    for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a,b)=>a.name.localeCompare(b.name))) {
      const absolute = path.join(root, entry.name);
      const rel = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error('La carpeta documental activa contiene enlaces. SICOVEN se mantiene bloqueado.');
      if (entry.isDirectory()) walk(absolute, rel);
      else if (entry.isFile()) {
        realFile(absolute, 'Documento activo');
        actual.push({ path: rel, size: fs.statSync(absolute).size, sha256: hashFile(absolute) });
      } else throw new Error('La carpeta documental activa contiene elementos especiales.');
    }
  }
  walk(activeDocs);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.documents)) {
    throw new Error('Los documentos activos no coinciden con el staging confirmado. SICOVEN se mantiene bloqueado.');
  }
  return verified;
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
    const stagedDirectory = path.join(root,'restore-staging',journal.operationId);
    const staged = verifyActiveMatchesBackup(stagedDirectory, root);
    if (staged.databaseSha256 !== journal.hashes.stagedDatabase ||
        hashFile(path.join(stagedDirectory, 'manifest.json')) !== journal.hashes.stagedManifest) {
      throw new Error('El staging confirmado no coincide con las huellas del journal. SICOVEN se mantiene bloqueado.');
    }
    appendRestoreOutcome({ userDataDir: root, operationId: journal.operationId, actor: journal.actor, outcome: 'RESTORE_COMMITTED', databaseSha256: staged.databaseSha256, documentCount: staged.documentCount });
    archiveCommittedRollback(root,journal.operationId);
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'kept_committed_restore'};
  }
  if(journal.state==='rolled_back') {
    // A journal transition is not proof that the physical rollback survived.
    // Bind the return package to the journal, then verify active SQLite and
    // every supporting document before recording success or deleting evidence.
    const rollback = verifyActiveMatchesBackup(rollbackDir, root);
    if (rollback.databaseSha256 !== journal.hashes.rollbackDatabase ||
        hashFile(path.join(rollbackDir, 'manifest.json')) !== journal.hashes.rollbackManifest) {
      throw new Error('El snapshot de retorno no coincide con las huellas del journal. SICOVEN se mantiene bloqueado.');
    }
    appendRestoreOutcome({ userDataDir: root, operationId: journal.operationId, actor: journal.actor, outcome: 'RESTORE_ROLLED_BACK', databaseSha256: rollback.databaseSha256, documentCount: rollback.documentCount });
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'finalized_rollback_cleanup'};
  }
  if(journal.state==='prepared') {
    cleanupOperation(root,journal.operationId);
    return {ok:true,recovered:true,action:'discarded_unstarted_restore'};
  }
  const verified=verifyBackupDirectory(rollbackDir);
  if(verified.databaseSha256!==journal.hashes.rollbackDatabase || hashFile(path.join(rollbackDir,'manifest.json'))!==journal.hashes.rollbackManifest) throw new Error('El respaldo de retorno no coincide con el journal. SICOVEN se mantiene bloqueado.');
  const stagedDir=path.join(root,'restore-staging',journal.operationId);
  const stagedVerified=verifyBackupDirectory(stagedDir);
  if(stagedVerified.databaseSha256!==journal.hashes.stagedDatabase || hashFile(path.join(stagedDir,'manifest.json'))!==journal.hashes.stagedManifest) throw new Error('El staging no coincide con el journal. SICOVEN se mantiene bloqueado.');
  if(journal.state!=='rolling_back') transitionJournal({journalPath,expectedState:journal.state,nextState:'rolling_back',lastStep:'startup_recovery_rollback'});
  restoreRollback(rollbackDir,root,operationDir);
  transitionJournal({journalPath,expectedState:'rolling_back',nextState:'rolled_back',lastStep:'startup_rollback_verified'});
  const rollbackResult = verifyBackupDirectory(rollbackDir);
  appendRestoreOutcome({ userDataDir: root, operationId: journal.operationId, actor: journal.actor, outcome: 'RESTORE_ROLLED_BACK', databaseSha256: rollbackResult.databaseSha256, documentCount: rollbackResult.documentCount });
  cleanupOperation(root,journal.operationId);
  return {ok:true,recovered:true,action:'rolled_back_incomplete_restore'};
}
async function executeRestoreUnlocked({backupDirectory,userDataDir,db,getDb,closeDatabase,reopenDatabase,actor}) {
  if(!db?.open) throw new Error('La base de datos debe estar abierta para preparar la restauración.');
  const root=path.resolve(userDataDir), source=path.resolve(backupDirectory);
  realDir(root,'Datos de SICOVEN');
  if(source===root || source.startsWith(root+path.sep)) throw new Error('El respaldo no puede estar dentro de los datos activos.');
  const sourceInfo=verifyBackupDirectory(source);
  const activeCompanies = path.join(root, COMPANIES);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
  if (sourceManifest.companyDatabases === undefined && exists(activeCompanies) && fs.readdirSync(activeCompanies).length > 0) {
    throw new Error('Este respaldo global antiguo no contiene las bases individuales de las empresas. Se bloqueó la restauración para evitar perder información multiempresa.');
  }
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
    createJournal({journalPath,sourceDatabaseSha256:hashFile(path.join(root,DB)),stagedDatabaseSha256:staged.databaseSha256,sourceManifestSha256:hashFile(path.join(source,'manifest.json')),stagedManifestSha256:hashFile(path.join(stagedBackup,'manifest.json')),operationId,actor});
    await createBackup({db,userDataDir:root,destination:rollbackDir,allowInternalDestination:true});
    const rollbackInfo=verifyBackupDirectory(rollbackDir);
    transitionJournal({journalPath,expectedState:'prepared',nextState:'rollback_ready',lastStep:'rollback_snapshot_verified',rollbackDatabaseSha256:rollbackInfo.databaseSha256,rollbackManifestSha256:hashFile(path.join(rollbackDir,'manifest.json'))});
    await closeDatabase();
    clearSqliteSidecars(root);
    transitionJournal({journalPath,expectedState:'rollback_ready',nextState:'installing',lastStep:'physical_swap_started'});
    replaceFromBackup(stagedBackup,root,operationDir);
    transitionJournal({journalPath,expectedState:'installing',nextState:'installed',lastStep:'database_and_documents_verified'});
    await reopenDatabase();
    transitionJournal({journalPath,expectedState:'installed',nextState:'committed',lastStep:'restore_committed'});
    appendRestoreOutcome({ userDataDir: root, operationId, actor, outcome: 'RESTORE_COMMITTED', databaseSha256: sourceInfo.databaseSha256, documentCount: sourceInfo.documentCount });
    reconcileRestoreAudit({ db: getDb(), userDataDir: root });
    archiveCommittedRollback(root,operationId);
    cleanupOperation(root,operationId);
    return {ok:true,operationId,databaseSha256:sourceInfo.databaseSha256,documentCount:sourceInfo.documentCount};
  } catch(error) {
    try {
      const current=readJournal(journalPath);
      if(current && current.state!=='prepared' && current.state!=='committed') {
        await closeDatabase();
        recoverPendingRestore({userDataDir:root});
        await reopenDatabase();
        reconcileRestoreAudit({ db: getDb(), userDataDir: root });
      } else if(current?.state==='prepared') cleanupOperation(root,operationId);
    } catch(recoveryError) {
      throw new Error('La restauración falló y el rollback automático requiere intervención. No abrir SICOVEN ni modificar sus archivos. Causa: '+error.message+'; recuperación: '+recoveryError.message);
    }
    throw error;
  }
}

let restoreInProgress = false;
async function executeRestore(args) {
  if (restoreInProgress) throw new Error('Ya existe una restauración en curso. Espere a que termine antes de iniciar otra.');
  restoreInProgress = true;
  try { return await executeRestoreUnlocked(args); }
  finally { restoreInProgress = false; }
}

function registerRestoreIpc({
  ipcMain, app, dialog, licenseView, getActiveSession, getDb,
  closeDatabase, reopenDatabase, getWindow, operationContext = null, runtime = null
}) {
  if (operationContext && typeof operationContext.acquireMaintenanceLock !== 'function') {
    throw new TypeError('La restauración global requiere un bloqueo de mantenimiento válido.');
  }
  if (runtime && typeof runtime.rebindControlDatabase !== 'function') {
    throw new TypeError('La restauración global requiere un runtime capaz de reabrir el registro de empresas.');
  }
  ipcMain.handle('sicoven:restore-execute', async (_event, token) => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!hasFullSystemAccess(actor)) throw new Error('Se requiere una sesión autenticada con rol contable (admin o contador) para restaurar respaldos.');
    const parent = getWindow?.();
    const selection = parent
      ? await dialog.showOpenDialog(parent, { title: 'Seleccionar respaldo verificado de SICOVEN', properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ title: 'Seleccionar respaldo verificado de SICOVEN', properties: ['openDirectory'] });
    if (selection.canceled || !selection.filePaths?.[0]) return { ok: false, canceled: true };
    const check = verifyBackupDirectory(selection.filePaths[0]);
    const confirm = parent
      ? await dialog.showMessageBox(parent, {
          type: 'warning', buttons: ['Cancelar', 'Restaurar respaldo'], defaultId: 0, cancelId: 0,
          title: 'Confirmar restauración contable',
          message: 'Esta operación reemplazará la base de control, todas las bases de empresas y los documentos actuales.',
          detail: 'Respaldo: ' + path.basename(selection.filePaths[0]) + '\nDocumentos: ' + check.documentCount +
            '\nHuella SQLite: ' + check.databaseSha256 + '\nSe creará un snapshot de retorno antes del cambio.'
        })
      : await dialog.showMessageBox({
          type: 'warning', buttons: ['Cancelar', 'Restaurar respaldo'], defaultId: 0, cancelId: 0,
          title: 'Confirmar restauración contable',
          message: 'Esta operación reemplazará la base de control, todas las bases de empresas y los documentos actuales.',
          detail: 'Respaldo: ' + path.basename(selection.filePaths[0]) + '\nDocumentos: ' + check.documentCount +
            '\nHuella SQLite: ' + check.databaseSha256 + '\nSe creará un snapshot de retorno antes del cambio.'
        });
    if (confirm.response !== 1) return { ok: false, canceled: true };

    const release = operationContext ? await operationContext.acquireMaintenanceLock() : () => {};
    try {
      runtime?.closeAll?.();
      const result = await executeRestore({
        backupDirectory: selection.filePaths[0],
        userDataDir: app.getPath('userData'),
        db: getDb(), getDb, closeDatabase, reopenDatabase,
        actor: actor.username
      });
      reconcileRestoreAudit({ db: getDb(), userDataDir: app.getPath('userData') });
      return result;
    } finally {
      try {
        if (runtime && getDb()?.open) runtime.rebindControlDatabase(getDb());
      } finally {
        release();
      }
    }
  });
}
module.exports={executeRestore,recoverPendingRestore,registerRestoreIpc,restoreRollback};

