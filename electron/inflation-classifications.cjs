const crypto = require('node:crypto');
const { hasFullSystemAccess } = require('./auth-roles.cjs');
const CLASSIFICATIONS = new Set(['MONETARY','NON_MONETARY','MIXED','NOT_APPLICABLE']);
const BASES = new Set(['CASH_OR_FIXED_CURRENCY','INDEX_LINKED','GOODS_OR_SERVICES','HISTORICAL_COST','FAIR_VALUE','NET_REALIZABLE_VALUE','REVALUED','MIXED','FLOW']);
const BALANCE_TYPES = new Set(['ACTIVO','PASIVO','PATRIMONIO']);
const FLOW_TYPES = new Set(['INGRESOS','COSTOS','GASTOS']);

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}
function amountText(value) {
  if (value === undefined || value === null || value === '') return null;
  const result = String(value).trim();
  if (!/^\d{1,18}(?:\.\d{1,10})?$/.test(result) || !Number.isFinite(Number(result))) throw new Error('El importe histórico debe ser decimal no negativo sin notación científica.');
  return result;
}
function treatmentFor(c,b,m,r) {
  if (c==='MONETARY') {
    if (b==='INDEX_LINKED') return 'ADJUST_PER_CONTRACT';
    if (b==='CASH_OR_FIXED_CURRENCY') return 'NOT_RESTATE_MONETARY';
    throw new Error('La partida monetaria requiere efectivo/moneda fija o indexación contractual.');
  }
  if (c==='NON_MONETARY') {
    if (['HISTORICAL_COST','GOODS_OR_SERVICES'].includes(b)) return 'RESTATE_FROM_ORIGIN';
    if (['FAIR_VALUE','NET_REALIZABLE_VALUE','REVALUED'].includes(b)) {
      if (!validDate(m)||!validDate(r)) throw new Error('La medición corriente requiere fechas válidas de medición y reporte.');
      if (m>r) throw new Error('La fecha de medición no puede ser posterior a la fecha de reporte.');
      return m===r?'NOT_RESTATE_CURRENT_MEASURE':'RESTATE_FROM_MEASUREMENT_DATE';
    }
    throw new Error('Base de medición no válida para partida no monetaria.');
  }
  if (c==='MIXED') { if(b!=='MIXED') throw new Error('Una cuenta mixta debe declarar base MIXED.'); return 'REQUIRES_COMPONENT_SPLIT'; }
  if (c==='NOT_APPLICABLE') { if(b!=='FLOW') throw new Error('Los flujos del período deben utilizar base FLOW.'); return 'NOT_APPLICABLE'; }
  throw new Error('Clasificación no reconocida.');
}
function initializeInflationClassificationSchema(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS inflation_classification_decisions (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, fiscal_year INTEGER NOT NULL CHECK(fiscal_year BETWEEN 1900 AND 2200), account_code TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN (\'ACCOUNT_DEFAULT\',\'BALANCE_COMPONENT\')), component_ref TEXT NOT NULL DEFAULT \'\', version INTEGER NOT NULL CHECK(version>=1), supersedes_decision_id TEXT REFERENCES inflation_classification_decisions(id), classification TEXT NOT NULL CHECK(classification IN (\'MONETARY\',\'NON_MONETARY\',\'MIXED\',\'NOT_APPLICABLE\')), measurement_basis TEXT NOT NULL CHECK(measurement_basis IN (\'CASH_OR_FIXED_CURRENCY\',\'INDEX_LINKED\',\'GOODS_OR_SERVICES\',\'HISTORICAL_COST\',\'FAIR_VALUE\',\'NET_REALIZABLE_VALUE\',\'REVALUED\',\'MIXED\',\'FLOW\')), treatment TEXT NOT NULL, rationale TEXT NOT NULL, normative_reference TEXT NOT NULL, origin_date TEXT, measurement_date TEXT, reporting_date TEXT, carrying_amount_bs TEXT, carrying_amount_usd TEXT, currency TEXT CHECK(currency IS NULL OR currency IN (\'BS\',\'USD\',\'DUAL\')), contract_reference TEXT, created_by_user_id INTEGER NOT NULL, created_by_username TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(company_id,fiscal_year,account_code,scope,component_ref,version), UNIQUE(supersedes_decision_id))',
    'CREATE INDEX IF NOT EXISTS idx_inflation_classification_company_year ON inflation_classification_decisions(company_id,fiscal_year,account_code)',
    'CREATE TABLE IF NOT EXISTS inflation_classification_reviews (id TEXT PRIMARY KEY, decision_id TEXT NOT NULL UNIQUE REFERENCES inflation_classification_decisions(id), decision TEXT NOT NULL CHECK(decision IN (\'APPROVED\',\'REJECTED\')), reason TEXT NOT NULL, actor_user_id INTEGER NOT NULL, actor_username TEXT NOT NULL, reviewed_at TEXT NOT NULL, created_at TEXT NOT NULL)',
    'CREATE TRIGGER IF NOT EXISTS inflation_classification_decisions_no_update BEFORE UPDATE ON inflation_classification_decisions BEGIN SELECT RAISE(ABORT, \'inflation_classification_decisions is append-only\'); END',
    'CREATE TRIGGER IF NOT EXISTS inflation_classification_decisions_no_delete BEFORE DELETE ON inflation_classification_decisions BEGIN SELECT RAISE(ABORT, \'inflation_classification_decisions is append-only\'); END',
    'CREATE TRIGGER IF NOT EXISTS inflation_classification_reviews_no_update BEFORE UPDATE ON inflation_classification_reviews BEGIN SELECT RAISE(ABORT, \'inflation_classification_reviews is append-only\'); END',
    'CREATE TRIGGER IF NOT EXISTS inflation_classification_reviews_no_delete BEFORE DELETE ON inflation_classification_reviews BEGIN SELECT RAISE(ABORT, \'inflation_classification_reviews is append-only\'); END',
    'CREATE TRIGGER IF NOT EXISTS inflation_classification_version_chain BEFORE INSERT ON inflation_classification_decisions BEGIN SELECT CASE WHEN NEW.version=1 AND (NEW.supersedes_decision_id IS NOT NULL OR EXISTS(SELECT 1 FROM inflation_classification_decisions d WHERE d.company_id=NEW.company_id AND d.fiscal_year=NEW.fiscal_year AND d.account_code=NEW.account_code AND d.scope=NEW.scope AND d.component_ref=NEW.component_ref)) THEN RAISE(ABORT, \'first classification version must be 1\') WHEN NEW.version>1 AND NOT EXISTS(SELECT 1 FROM inflation_classification_decisions p JOIN inflation_classification_reviews r ON r.decision_id=p.id WHERE p.id=NEW.supersedes_decision_id AND p.company_id=NEW.company_id AND p.fiscal_year=NEW.fiscal_year AND p.account_code=NEW.account_code AND p.scope=NEW.scope AND p.component_ref=NEW.component_ref AND p.version=NEW.version-1) THEN RAISE(ABORT, \'classification version must supersede reviewed prior version\') END; END'
  ].join(';'));
}
function readState(db) {
  const row=db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  if(!row) throw new Error('No existe estado contable persistido para validar empresa y cuentas.');
  let state; try { state=JSON.parse(row.state_json); } catch { throw new Error('El estado contable SQLite es ilegible; se bloqueó la clasificación.'); }
  if(!state||!Array.isArray(state.companies)||!Array.isArray(state.accounts)) throw new Error('Estado contable sin empresas o cuentas válidas.');
  return state;
}
function validateDecision(db,input) {
  if(!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Solicitud de clasificación inválida.');
  const id=String(input.id||'').trim(), companyId=String(input.companyId||'').trim(), accountCode=String(input.accountCode||'').trim();
  const fiscalYear=Number(input.fiscalYear),version=Number(input.version),scope=String(input.scope||''),classification=String(input.classification||''),basis=String(input.measurementBasis||'');
  if(!id||id.length>120||!companyId||!accountCode) throw new Error('Identificador, empresa y cuenta son obligatorios.');
  if(!Number.isInteger(fiscalYear)||fiscalYear<1900||fiscalYear>2200||!Number.isInteger(version)||version<1) throw new Error('Ejercicio o versión inválidos.');
  if(!['ACCOUNT_DEFAULT','BALANCE_COMPONENT'].includes(scope)||!CLASSIFICATIONS.has(classification)||!BASES.has(basis)) throw new Error('Alcance, clasificación o base inválidos.');
  if(input.status!=='PENDING_REVIEW') throw new Error('La decisión se registra pendiente; aprobación/rechazo usa el flujo de revisión.');
  const state=readState(db);
  if(!state.companies.some(c=>String(c.id)===companyId)) throw new Error('La empresa seleccionada no existe en SQLite.');
  const account=state.accounts.find(a=>String(a.code)===accountCode);
  if(!account||!account.isMovement) throw new Error('La clasificación debe vincularse a una cuenta imputable existente.');
  if(BALANCE_TYPES.has(account.type)) { if(classification==='NOT_APPLICABLE'||basis==='FLOW') throw new Error('Activo, pasivo y patrimonio requieren evaluación monetaria/no monetaria.'); }
  else if(FLOW_TYPES.has(account.type)) { if(classification!=='NOT_APPLICABLE'||basis!=='FLOW') throw new Error('Ingresos, costos y gastos se tratan como flujos del período.'); }
  else throw new Error('Tipo de cuenta no contemplado en la matriz.');
  const componentRef=scope==='BALANCE_COMPONENT'?String(input.componentRef||'').trim():'';
  if(scope==='BALANCE_COMPONENT'&&(!componentRef||componentRef.length>160)) throw new Error('El componente requiere referencia única válida.');
  if(scope==='ACCOUNT_DEFAULT'&&(input.componentRef||input.originDate||input.measurementDate||input.reportingDate||input.carryingAmountBs!==undefined||input.carryingAmountUsd!==undefined||input.currency||input.contractReference)) throw new Error('La clasificación general no debe almacenar datos propios de un componente.');
  if(classification==='MIXED'&&scope!=='ACCOUNT_DEFAULT') throw new Error('MIXED solo puede definir la cuenta; cada componente se clasifica individualmente.');
  const rationale=String(input.rationale||'').trim(), normativeReference=String(input.normativeReference||'').trim();
  if(rationale.length<10||rationale.length>2000) throw new Error('La justificación debe contener entre 10 y 2.000 caracteres.');
  if(!normativeReference||normativeReference.length>500) throw new Error('Indique referencia normativa o documental.');
  const originDate=input.originDate?String(input.originDate):null,measurementDate=input.measurementDate?String(input.measurementDate):null,reportingDate=input.reportingDate?String(input.reportingDate):null;
  const carryingAmountBs=amountText(input.carryingAmountBs),carryingAmountUsd=amountText(input.carryingAmountUsd),currency=input.currency?String(input.currency):null,contractReference=input.contractReference?String(input.contractReference).trim():null;
  const treatment=treatmentFor(classification,basis,measurementDate,reportingDate);
  if(scope==='BALANCE_COMPONENT') {
    if(!currency||!['BS','USD','DUAL'].includes(currency)) throw new Error('Indique moneda del importe histórico.');
    if((currency==='BS'&&carryingAmountBs===null)||(currency==='USD'&&carryingAmountUsd===null)||(currency==='DUAL'&&(carryingAmountBs===null||carryingAmountUsd===null))) throw new Error('Los importes históricos deben corresponder con la moneda; DUAL exige Bs. y USD.');
    if(basis==='INDEX_LINKED'&&(!contractReference||contractReference.length>500)) throw new Error('La partida indexada requiere referencia contractual.');
    if(classification==='NON_MONETARY'&&['HISTORICAL_COST','GOODS_OR_SERVICES'].includes(basis)&&!validDate(originDate)) throw new Error('La partida no monetaria requiere fecha de origen verificable.');
    if(['FAIR_VALUE','NET_REALIZABLE_VALUE','REVALUED'].includes(basis)&&(!validDate(measurementDate)||!validDate(reportingDate)||measurementDate>reportingDate)) throw new Error('La medición corriente requiere fechas válidas y no puede ser posterior al reporte.');
  }
  return {id,companyId,fiscalYear,accountCode,scope,componentRef,version,supersedesDecisionId:input.supersedesDecisionId?String(input.supersedesDecisionId):null,classification,measurementBasis:basis,treatment,rationale,normativeReference,originDate,measurementDate,reportingDate,carryingAmountBs,carryingAmountUsd,currency,contractReference};
}
function requireAdmin(licenseView,getActiveSession,token) {
  if(!licenseView().authorized) throw new Error('Licencia no autorizada.');
  const actor=getActiveSession(token);
  if(!actor) throw new Error('Sesión no válida. Inicie sesión para gestionar clasificaciones.');
  if(!hasFullSystemAccess(actor)) throw new Error('Permiso insuficiente: un rol contable autenticado puede gestionar clasificaciones.');
  return actor;
}
function saveInflationClassification(db,input,actor) {
  if(!actor||!hasFullSystemAccess(actor)||!actor.username||!Number.isInteger(Number(actor.id))) throw new Error('Se requiere una sesión autenticada de admin o contador para registrar clasificaciones.');
  const x=validateDecision(db,input);
  const latest=db.prepare('SELECT d.id,d.version,r.decision AS reviewDecision FROM inflation_classification_decisions d LEFT JOIN inflation_classification_reviews r ON r.decision_id=d.id WHERE d.company_id=? AND d.fiscal_year=? AND d.account_code=? AND d.scope=? AND d.component_ref=? ORDER BY d.version DESC LIMIT 1').get(x.companyId,x.fiscalYear,x.accountCode,x.scope,x.componentRef);
  if(!latest) { if(x.version!==1||x.supersedesDecisionId) throw new Error('La primera clasificación debe iniciar en versión 1.'); }
  else if(!latest.reviewDecision||x.supersedesDecisionId!==latest.id||x.version!==Number(latest.version)+1) throw new Error('La nueva versión debe enlazar la última decisión revisada y aumentar la versión en uno.');
  const now=new Date().toISOString();
  db.transaction(()=>{
    db.prepare('INSERT INTO inflation_classification_decisions (id,company_id,fiscal_year,account_code,scope,component_ref,version,supersedes_decision_id,classification,measurement_basis,treatment,rationale,normative_reference,origin_date,measurement_date,reporting_date,carrying_amount_bs,carrying_amount_usd,currency,contract_reference,created_by_user_id,created_by_username,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      x.id,x.companyId,x.fiscalYear,x.accountCode,x.scope,x.componentRef,x.version,x.supersedesDecisionId,x.classification,x.measurementBasis,x.treatment,x.rationale,x.normativeReference,x.originDate,x.measurementDate,x.reportingDate,x.carryingAmountBs,x.carryingAmountUsd,x.currency,x.contractReference,Number(actor.id),String(actor.username),now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_classification_created',JSON.stringify({decisionId:x.id,companyId:x.companyId,fiscalYear:x.fiscalYear,accountCode:x.accountCode,scope:x.scope,componentRef:x.componentRef,version:x.version,supersedesDecisionId:x.supersedesDecisionId,classification:x.classification,measurementBasis:x.measurementBasis,createdBy:actor.username}));
  })();
  return {ok:true,decisionId:x.id,version:x.version,status:'PENDING_REVIEW',treatment:x.treatment};
}
function reviewInflationClassification(db,input,actor) {
  if(!actor||!hasFullSystemAccess(actor)||!actor.username||!Number.isInteger(Number(actor.id))) throw new Error('Se requiere una sesión autenticada de admin o contador para revisar clasificaciones.');
  const decisionId=String(input?.decisionId||'').trim(),decision=String(input?.decision||''),reason=String(input?.reason||'').trim();
  if(!decisionId||!['APPROVED','REJECTED'].includes(decision)) throw new Error('Identificador o decisión de revisión inválidos.');
  if(reason.length<10||reason.length>1000) throw new Error('La justificación de revisión debe tener entre 10 y 1000 caracteres.');
  const row=db.prepare('SELECT id,company_id,fiscal_year,account_code,scope,component_ref,version FROM inflation_classification_decisions WHERE id=?').get(decisionId);
  if(!row) throw new Error('La decisión de clasificación no existe.');
  if(db.prepare('SELECT id FROM inflation_classification_reviews WHERE decision_id=?').get(decisionId)) throw new Error('La decisión ya fue revisada; cree una nueva versión para corregirla.');
  const id=crypto.randomUUID(),now=new Date().toISOString();
  db.transaction(()=>{
    db.prepare('INSERT INTO inflation_classification_reviews (id,decision_id,decision,reason,actor_user_id,actor_username,reviewed_at,created_at) VALUES (?,?,?,?,?,?,?,?)').run(id,decisionId,decision,reason,Number(actor.id),String(actor.username),now,now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_classification_reviewed',JSON.stringify({reviewId:id,decisionId,decision,reason,companyId:row.company_id,fiscalYear:row.fiscal_year,accountCode:row.account_code,scope:row.scope,componentRef:row.component_ref,version:row.version,actor:actor.username}));
  })();
  return {ok:true,reviewId:id,decisionId,decision};
}
function listInflationClassifications(db,filters={}) {
  const where=[],params=[];
  if(filters.companyId){where.push('d.company_id=?');params.push(String(filters.companyId));}
  if(filters.fiscalYear){where.push('d.fiscal_year=?');params.push(Number(filters.fiscalYear));}
  const rows=db.prepare('SELECT d.id,d.company_id AS companyId,d.fiscal_year AS fiscalYear,d.account_code AS accountCode,d.scope,d.component_ref AS componentRef,d.version,d.supersedes_decision_id AS supersedesDecisionId,d.classification,d.measurement_basis AS measurementBasis,d.treatment,d.rationale,d.normative_reference AS normativeReference,d.origin_date AS originDate,d.measurement_date AS measurementDate,d.reporting_date AS reportingDate,d.carrying_amount_bs AS carryingAmountBs,d.carrying_amount_usd AS carryingAmountUsd,d.currency,d.contract_reference AS contractReference,d.created_by_user_id AS createdByUserId,d.created_by_username AS createdByUsername,d.created_at AS createdAt,r.decision AS reviewDecision,r.reason AS reviewReason,r.actor_username AS reviewer,r.reviewed_at AS reviewedAt FROM inflation_classification_decisions d LEFT JOIN inflation_classification_reviews r ON r.decision_id=d.id '+(where.length?'WHERE '+where.join(' AND '):'')+' ORDER BY d.company_id,d.fiscal_year,d.account_code,d.scope,d.component_ref,d.version').all(...params);
  return rows.map(row=>({...row,status:row.reviewDecision||'PENDING_REVIEW',reviewDecision:row.reviewDecision||null,reviewReason:row.reviewReason||null}));
}
function registerInflationClassificationIpc({ipcMain,db,licenseView,getActiveSession}) {
  if(!ipcMain||typeof ipcMain.handle!=='function'||typeof licenseView!=='function'||typeof getActiveSession!=='function') throw new Error('No se pudo registrar el puente de clasificaciones de inflación.');
  initializeInflationClassificationSchema(db);
  ipcMain.handle('sicoven:inflation-classification-list',(_event,token,filters)=>{
    const actor=getActiveSession(token);if(!licenseView().authorized||!actor) throw new Error('Sesión no válida o licencia no autorizada.');
    const state=readState(db);if(filters?.companyId&&!state.companies.some(c=>String(c.id)===String(filters.companyId))) throw new Error('La empresa solicitada no existe.');
    return listInflationClassifications(db,filters||{});
  });
  ipcMain.handle('sicoven:inflation-classification-save',(_event,token,input)=>saveInflationClassification(db,input,requireAdmin(licenseView,getActiveSession,token)));
  ipcMain.handle('sicoven:inflation-classification-review',(_event,token,input)=>reviewInflationClassification(db,input,requireAdmin(licenseView,getActiveSession,token)));
}
module.exports={initializeInflationClassificationSchema,validateDecision,saveInflationClassification,reviewInflationClassification,listInflationClassifications,registerInflationClassificationIpc};
