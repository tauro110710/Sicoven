const crypto = require('node:crypto');

const SOURCE_REQUIREMENTS = Object.freeze({
  ESTIMACION_EXPERTO: [
    'EXPERT_IDENTITY', 'EXPERT_CREDENTIALS', 'SIGNED_STUDY',
    'METHODOLOGY', 'COVERAGE', 'MONTHLY_SUPPORT', 'BIAS_DECLARATION'
  ],
  ESTUDIO_FCCPV: [
    'FCCPV_INDICATION', 'SIGNED_STUDY', 'METHODOLOGY', 'COVERAGE'
  ],
  ESTIMACION_PROPIA_EXCEPCIONAL: [
    'DISPROPORTIONATE_COST_ANALYSIS', 'FCCPV_ABSENCE_SEARCH',
    'EXTERNAL_MACRO_SOURCES', 'METHODOLOGY',
    'CALCULATION_WORKPAPERS', 'PROFESSIONAL_APPROVAL'
  ]
});
const SOURCE_CODES = new Set(Object.keys(SOURCE_REQUIREMENTS));
const FRAMEWORKS = new Set(['VEN_NIF_FULL', 'VEN_NIF_PYMES', 'OTHER_DOCUMENTED']);
const PURPOSES = new Set(['REME_FINANCIAL_STATEMENTS', 'REME_SUPPORTING_ANALYSIS']);
const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_EVIDENCE_BYTES = 20 * 1024 * 1024;

function requiredText(value, label, max = 500) {
  const result = String(value ?? '').trim();
  if (!result || result.length > max) throw new Error(label + ' es obligatorio y no puede exceder ' + max + ' caracteres.');
  return result;
}
function validMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  return year >= 1900 && year <= 2200;
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function normalizeEvidence(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Elemento de evidencia inválido.');
  const evidenceType = requiredText(item.evidenceType, 'Tipo de evidencia', 80).toUpperCase();
  const title = requiredText(item.title, 'Título de evidencia', 240);
  const description = requiredText(item.description, 'Descripción de evidencia', 2000);
  const fileName = requiredText(item.fileName, 'Nombre del documento', 180);
  const mimeType = requiredText(item.mimeType, 'Formato del documento', 120);
  const obtainedAt = String(item.obtainedAt || '');
  if (!validDate(obtainedAt)) throw new Error('La fecha de obtención de cada evidencia debe ser YYYY-MM-DD.');
  const base64 = String(item.contentBase64 || '');
  const sourceUrl = String(item.sourceUrl || '').trim();
  let bytes = 0;
  let sha256 = '';
  if (base64) {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new Error('El contenido adjunto no es Base64 válido.');
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > MAX_EVIDENCE_BYTES) throw new Error('Cada evidencia adjunta debe tener entre 1 byte y 5 MB.');
    if (buffer.toString('base64') !== base64) throw new Error('El contenido Base64 no tiene una codificación canónica.');
    bytes = buffer.length;
    sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (item.sha256 && String(item.sha256).toLowerCase() !== sha256) throw new Error('El SHA-256 declarado no coincide con el archivo adjunto.');
  } else if (sourceUrl) {
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { throw new Error('La URL de evidencia no es válida.'); }
    if (parsed.protocol !== 'https:') throw new Error('Las referencias web de evidencia deben usar HTTPS.');
    sha256 = String(item.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Una evidencia web requiere SHA-256 del documento consultado.');
  } else {
    throw new Error('Cada evidencia debe conservar el documento adjunto o una referencia HTTPS verificable con SHA-256.');
  }
  return { evidenceType, title, description, fileName, mimeType, obtainedAt, sourceUrl: sourceUrl || null,
    contentBase64: base64 || null, sha256, bytes };
}
function validateDossierInput(input, series) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expediente inválido.');
  if (!series || !SOURCE_CODES.has(series.series_code)) throw new Error('La serie no corresponde a una fuente alternativa admitida por este expediente.');
  const companyId = requiredText(input.companyId, 'Empresa', 120);
  const fiscalYear = Number(input.fiscalYear);
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2200) throw new Error('Ejercicio contable inválido.');
  const periodFrom = String(input.periodFrom || '');
  const periodTo = String(input.periodTo || '');
  if (!validMonth(periodFrom) || !validMonth(periodTo) || periodFrom > periodTo) throw new Error('El alcance mensual debe ser válido y ordenado (YYYY-MM).');
  if (Number(periodFrom.slice(0, 4)) !== fiscalYear || Number(periodTo.slice(0, 4)) !== fiscalYear) throw new Error('Los períodos aprobables deben pertenecer al ejercicio contable indicado.');
  if (periodFrom < series.first_period || periodTo > series.last_period) throw new Error('El alcance solicitado excede la cobertura de la serie importada.');
  const framework = String(input.accountingFramework || '');
  if (!FRAMEWORKS.has(framework)) throw new Error('Seleccione el marco contable aplicable.');
  const frameworkDetail = framework === 'OTHER_DOCUMENTED'
    ? requiredText(input.accountingFrameworkDetail, 'Identificación del marco contable', 500) : null;
  const purpose = String(input.purpose || '');
  if (!PURPOSES.has(purpose)) throw new Error('Finalidad de uso documental no admitida.');
  const rationale = requiredText(input.normativeRationale, 'Justificación normativa', 2000);
  const evidence = Array.isArray(input.evidence) ? input.evidence.map(normalizeEvidence) : [];
  const totalBytes = evidence.reduce((sum, item) => sum + item.bytes, 0);
  if (totalBytes > MAX_TOTAL_EVIDENCE_BYTES) throw new Error('El expediente supera el límite total de 20 MB de adjuntos.');
  const supplied = new Set(evidence.map(item => item.evidenceType));
  const duplicates = evidence.filter((item, index) => evidence.findIndex(other => other.evidenceType === item.evidenceType) !== index);
  if (duplicates.length) throw new Error('No repita el mismo tipo de evidencia; consolide los documentos en un elemento.');
  const missingEvidence = SOURCE_REQUIREMENTS[series.series_code].filter(code => !supplied.has(code));
  if (series.series_code === 'ESTIMACION_PROPIA_EXCEPCIONAL') {
    const cost = evidence.find(item => item.evidenceType === 'DISPROPORTIONATE_COST_ANALYSIS');
    const absence = evidence.find(item => item.evidenceType === 'FCCPV_ABSENCE_SEARCH');
    if (cost && (cost.description.length < 80 || !/\d/.test(cost.description))) throw new Error('El análisis de costo/esfuerzo desproporcionado debe explicar circunstancias y aportar una cuantificación verificable.');
    if (absence && (absence.description.length < 80 || !/\d{4}-\d{2}-\d{2}/.test(absence.description) || !/consult|revis/i.test(absence.description) || !/result|hallaz/i.test(absence.description))) throw new Error('La búsqueda FCCPV debe documentar fuentes consultadas, fecha, procedimiento y resultados.');
  }
  const professional = input.professional || {};
  const professionalName = requiredText(professional.name, 'Nombre del profesional revisor', 180);
  const professionalRole = requiredText(professional.role, 'Responsabilidad profesional', 180);
  const professionalCredential = requiredText(professional.credential, 'Credencial o registro profesional', 240);
  const professionalCredentialEvidence = requiredText(professional.credentialEvidence, 'Referencia de verificación de credenciales', 1000);
  const methodologyVersion = requiredText(input.methodologyVersion, 'Versión de metodología', 120);
  const methodologyDescription = requiredText(input.methodologyDescription, 'Descripción metodológica', 3000);
  const coverageDescription = requiredText(input.coverageDescription, 'Cobertura geográfica y de bienes/servicios', 2000);
  const periodicity = requiredText(input.periodicity, 'Periodicidad', 120);
  if (!/mensual/i.test(periodicity)) throw new Error('La serie alternativa debe documentar periodicidad mensual.');
  const limitations = requiredText(input.limitations, 'Limitaciones conocidas', 2000);
  const biasDeclaration = requiredText(input.biasDeclaration, 'Declaración sobre sesgo y limitaciones', 2000);
  return {
    companyId, fiscalYear, periodFrom, periodTo, framework, frameworkDetail, purpose, rationale,
    professionalName, professionalRole, professionalCredential, professionalCredentialEvidence,
    methodologyVersion, methodologyDescription, coverageDescription, periodicity, limitations, biasDeclaration,
    evidence, missingEvidence, sourceCode: series.series_code
  };
}
function initializeInflationSourceDossierSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inflation_source_dossiers (
      id TEXT PRIMARY KEY,
      series_id TEXT NOT NULL REFERENCES inflation_index_series(id),
      source_code TEXT NOT NULL CHECK(source_code IN ('ESTIMACION_EXPERTO','ESTUDIO_FCCPV','ESTIMACION_PROPIA_EXCEPCIONAL')),
      dossier_version INTEGER NOT NULL,
      company_id TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      period_from TEXT NOT NULL,
      period_to TEXT NOT NULL,
      accounting_framework TEXT NOT NULL,
      accounting_framework_detail TEXT,
      purpose TEXT NOT NULL,
      normative_rationale TEXT NOT NULL,
      professional_name TEXT NOT NULL,
      professional_role TEXT NOT NULL,
      professional_credential TEXT NOT NULL,
      professional_credential_evidence TEXT NOT NULL,
      methodology_version TEXT NOT NULL,
      methodology_description TEXT NOT NULL,
      coverage_description TEXT NOT NULL,
      periodicity TEXT NOT NULL,
      limitations TEXT NOT NULL,
      bias_declaration TEXT NOT NULL,
      evidence_manifest_json TEXT NOT NULL,
      evidence_bytes INTEGER NOT NULL,
      imported_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(series_id, dossier_version)
    );
    CREATE TABLE IF NOT EXISTS inflation_source_dossier_evidence (
      id TEXT PRIMARY KEY,
      dossier_id TEXT NOT NULL REFERENCES inflation_source_dossiers(id),
      evidence_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      obtained_at TEXT NOT NULL,
      source_url TEXT,
      content_base64 TEXT,
      sha256 TEXT NOT NULL,
      bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inflation_source_dossier_reviews (
      id TEXT PRIMARY KEY,
      dossier_id TEXT NOT NULL REFERENCES inflation_source_dossiers(id),
      decision TEXT NOT NULL CHECK(decision IN ('APPROVED_FOR_DOCUMENTED_USE','NEEDS_EVIDENCE','REJECTED')),
      reason TEXT NOT NULL,
      reviewer_username TEXT NOT NULL,
      reviewer_professional_name TEXT NOT NULL,
      reviewer_credential TEXT NOT NULL,
      approved_company_id TEXT,
      approved_fiscal_year INTEGER,
      approved_period_from TEXT,
      approved_period_to TEXT,
      approved_framework TEXT,
      approved_purpose TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inflation_dossiers_company_period ON inflation_source_dossiers(company_id,fiscal_year,period_from,period_to);
    CREATE INDEX IF NOT EXISTS idx_inflation_dossier_reviews ON inflation_source_dossier_reviews(dossier_id,created_at);
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_reviews_no_update BEFORE UPDATE ON inflation_source_dossier_reviews
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_reviews is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_reviews_no_delete BEFORE DELETE ON inflation_source_dossier_reviews
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_reviews is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossiers_no_update BEFORE UPDATE ON inflation_source_dossiers
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossiers is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossiers_no_delete BEFORE DELETE ON inflation_source_dossiers
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossiers is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_evidence_no_update BEFORE UPDATE ON inflation_source_dossier_evidence
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_evidence_no_delete BEFORE DELETE ON inflation_source_dossier_evidence
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_evidence is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_reviews_no_update BEFORE UPDATE ON inflation_source_dossier_reviews
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_reviews is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_dossier_reviews_no_delete BEFORE DELETE ON inflation_source_dossier_reviews
      BEGIN SELECT RAISE(ABORT, 'inflation_source_dossier_reviews is append-only'); END;
  `);
}
function createInflationSourceDossier(db, input, actor) {
  if (!actor?.username || actor.role !== 'admin') throw new Error('Solo un administrador autenticado puede registrar expedientes.');
  const seriesId = requiredText(input?.seriesId, 'Serie vinculada', 80);
  const series = db.prepare(`SELECT s.id,s.series_code,s.first_period,s.last_period,s.imported_by,
    src.source_sha256 FROM inflation_index_series s JOIN inflation_index_sources src ON src.id=s.source_id WHERE s.id=?`).get(seriesId);
  if (!series) throw new Error('La serie vinculada no existe.');
  const stateRow = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
  let accountingState = null;
  try { accountingState = stateRow ? JSON.parse(stateRow.state_json) : null; } catch { accountingState = null; }
  if (!Array.isArray(accountingState?.companies) || !accountingState.companies.some(company => String(company?.id || '') === String(input.companyId || ''))) {
    throw new Error('La empresa del expediente debe existir en la contabilidad local de SICOVEN.');
  }
  const data = validateDossierInput(input, series);
  const version = Number(db.prepare('SELECT COALESCE(MAX(dossier_version),0)+1 AS n FROM inflation_source_dossiers WHERE series_id=?').get(seriesId).n);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const manifest = data.evidence.map(({ contentBase64, ...item }) => item);
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO inflation_source_dossiers
      (id,series_id,source_code,dossier_version,company_id,fiscal_year,period_from,period_to,accounting_framework,
       accounting_framework_detail,purpose,normative_rationale,professional_name,professional_role,professional_credential,
       professional_credential_evidence,methodology_version,methodology_description,coverage_description,periodicity,
       limitations,bias_declaration,evidence_manifest_json,evidence_bytes,imported_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, seriesId, series.series_code, version, data.companyId, data.fiscalYear, data.periodFrom, data.periodTo,
      data.framework, data.frameworkDetail, data.purpose, data.rationale, data.professionalName, data.professionalRole,
      data.professionalCredential, data.professionalCredentialEvidence, data.methodologyVersion, data.methodologyDescription,
      data.coverageDescription, data.periodicity, data.limitations, data.biasDeclaration, JSON.stringify(manifest),
      data.evidence.reduce((sum, item) => sum + item.bytes, 0), actor.username, now);
    const insertEvidence = db.prepare(`INSERT INTO inflation_source_dossier_evidence
      (id,dossier_id,evidence_type,title,description,file_name,mime_type,obtained_at,source_url,content_base64,sha256,bytes,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const item of data.evidence) insertEvidence.run(crypto.randomUUID(), id, item.evidenceType, item.title,
      item.description, item.fileName, item.mimeType, item.obtainedAt, item.sourceUrl, item.contentBase64, item.sha256, item.bytes, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_source_dossier_created',
      JSON.stringify({ dossierId: id, seriesId, sourceCode: series.series_code, version, companyId: data.companyId,
        fiscalYear: data.fiscalYear, periodFrom: data.periodFrom, periodTo: data.periodTo,
        missingEvidence: data.missingEvidence, importedBy: actor.username }));
  });
  save();
  return { ok: true, dossierId: id, dossierVersion: version, sourceCode: series.series_code,
    missingEvidence: data.missingEvidence, status: 'DRAFT', eligibleForReview: data.missingEvidence.length === 0 };
}
function reviewInflationSourceDossier(db, input, actor) {
  if (!actor?.username || actor.role !== 'admin') throw new Error('Solo un administrador autenticado puede revisar expedientes.');
  const dossierId = requiredText(input?.dossierId, 'Expediente', 80);
  const dossier = db.prepare('SELECT * FROM inflation_source_dossiers WHERE id=?').get(dossierId);
  if (!dossier) throw new Error('El expediente no existe.');
  const prior = db.prepare('SELECT id FROM inflation_source_dossier_reviews WHERE dossier_id=?').get(dossierId);
  if (prior) throw new Error('El expediente ya tiene una decisión; cree una nueva versión del expediente para una nueva revisión.');
  if (String(dossier.imported_by) === String(actor.username)) throw new Error('El importador no puede revisar su propio expediente; se requiere revisión independiente.');
  const decision = String(input?.decision || '');
  if (!['APPROVED_FOR_DOCUMENTED_USE','NEEDS_EVIDENCE','REJECTED'].includes(decision)) throw new Error('Decisión profesional no válida.');
  const reason = requiredText(input?.reason, 'Justificación de revisión', 2000);
  if (reason.length < 30) throw new Error('La justificación profesional debe contener al menos 30 caracteres.');
  const reviewerName = requiredText(input?.reviewerProfessionalName, 'Identidad del profesional revisor', 180);
  const reviewerCredential = requiredText(input?.reviewerCredential, 'Credencial del profesional revisor', 240);
  if (reviewerName.toLocaleLowerCase() === String(dossier.professional_name).toLocaleLowerCase()) {
    throw new Error('El profesional responsable del estudio no puede aprobar su propio trabajo.');
  }
  if (decision === 'APPROVED_FOR_DOCUMENTED_USE') {
    const manifest = JSON.parse(dossier.evidence_manifest_json || '[]');
    const present = new Set(manifest.map(item => item.evidenceType));
    const missing = SOURCE_REQUIREMENTS[dossier.source_code].filter(code => !present.has(code));
    if (missing.length) throw new Error('No puede aprobarse: falta evidencia obligatoria (' + missing.join(', ') + ').');
    if (!dossier.professional_name || !dossier.professional_credential || !dossier.professional_credential_evidence) {
      throw new Error('No está acreditada la identidad y calificación del profesional responsable de la fuente.');
    }
    const observations = db.prepare(`SELECT period,observation_status FROM inflation_index_observations
      WHERE series_id=? AND period BETWEEN ? AND ? ORDER BY period`).all(dossier.series_id, dossier.period_from, dossier.period_to);
    const byPeriod = new Map(observations.map(row => [row.period, row]));
    for (let cursor = dossier.period_from; cursor <= dossier.period_to; cursor = nextMonth(cursor)) {
      const row = byPeriod.get(cursor);
      if (!row) throw new Error('No puede aprobarse: falta observación para ' + cursor + '.');
      if (row.observation_status === 'PROJECTED') throw new Error('Una observación PROJECTED nunca puede aprobarse como dato observado o estimado admisible.');
      if (row.observation_status !== 'ESTIMATED') throw new Error('La fuente alternativa debe conservar observaciones ESTIMATED; no se admite convertir OBSERVED.');
    }
    if (decision === 'APPROVED_FOR_DOCUMENTED_USE' &&
      (input.approvedCompanyId !== dossier.company_id || Number(input.approvedFiscalYear) !== Number(dossier.fiscal_year) ||
       input.approvedPeriodFrom !== dossier.period_from || input.approvedPeriodTo !== dossier.period_to ||
       input.approvedFramework !== dossier.accounting_framework || input.approvedPurpose !== dossier.purpose)) {
      throw new Error('La aprobación debe coincidir exactamente con empresa, ejercicio, período, marco y finalidad del expediente.');
    }
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(`INSERT INTO inflation_source_dossier_reviews
      (id,dossier_id,decision,reason,reviewer_username,reviewer_professional_name,reviewer_credential,
       approved_company_id,approved_fiscal_year,approved_period_from,approved_period_to,approved_framework,approved_purpose,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, dossierId, decision, reason, actor.username, reviewerName,
      reviewerCredential, decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.company_id : null,
      decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.fiscal_year : null,
      decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.period_from : null,
      decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.period_to : null,
      decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.accounting_framework : null,
      decision === 'APPROVED_FOR_DOCUMENTED_USE' ? dossier.purpose : null, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_source_dossier_reviewed',
      JSON.stringify({ reviewId: id, dossierId, decision, reviewer: actor.username, reviewerProfessionalName: reviewerName }));
  })();
  return { ok: true, reviewId: id, dossierId, decision };
}
function listInflationSourceDossiers(db, filters = {}) {
  const clauses = []; const values = [];
  if (filters.companyId) { clauses.push('d.company_id=?'); values.push(String(filters.companyId)); }
  if (filters.fiscalYear) { clauses.push('d.fiscal_year=?'); values.push(Number(filters.fiscalYear)); }
  if (filters.seriesId) { clauses.push('d.series_id=?'); values.push(String(filters.seriesId)); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  const rows = db.prepare(`SELECT d.*,s.series_version AS seriesVersion,src.source_sha256 AS sourceSha256,src.source_title AS sourceTitle,
    src.issuer AS sourceIssuer,src.source_reference AS sourceReference,src.source_url AS sourceUrl,
    src.source_published_at AS sourcePublishedAt,src.file_name AS sourceFileName,
    (SELECT r.decision FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS decision,
    (SELECT r.reason FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS reviewReason,
    (SELECT r.reviewer_username FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS reviewerUsername,
    (SELECT r.reviewer_professional_name FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS reviewerProfessionalName,
    (SELECT r.reviewer_credential FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS reviewerCredential,
    (SELECT r.created_at FROM inflation_source_dossier_reviews r WHERE r.dossier_id=d.id ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1) AS reviewedAt
    FROM inflation_source_dossiers d JOIN inflation_index_series s ON s.id=d.series_id
    JOIN inflation_index_sources src ON src.id=s.source_id ${where}
    ORDER BY d.created_at DESC,d.rowid DESC`).all(...values);
  return rows.map(row => ({ ...row, evidence: db.prepare(`SELECT id,evidence_type AS evidenceType,title,description,file_name AS fileName,
    mime_type AS mimeType,obtained_at AS obtainedAt,source_url AS sourceUrl,sha256,bytes
    FROM inflation_source_dossier_evidence WHERE dossier_id=? ORDER BY created_at,rowid`).all(row.id),
    status: row.decision || 'DRAFT', evidenceManifest: JSON.parse(row.evidence_manifest_json || '[]') }));
}
function getInflationSourceDossierEvidence(db, evidenceId, actor) {
  if (!actor?.username || actor.role !== 'admin') throw new Error('Solo un administrador autenticado puede consultar evidencia de expedientes.');
  const id = requiredText(evidenceId, 'Evidencia', 80);
  const row = db.prepare(`SELECT e.id,e.dossier_id AS dossierId,e.title,e.file_name AS fileName,e.mime_type AS mimeType,
    e.source_url AS sourceUrl,e.sha256,e.bytes,e.content_base64 AS contentBase64
    FROM inflation_source_dossier_evidence e WHERE e.id=?`).get(id);
  if (!row) throw new Error('La evidencia solicitada no existe.');
  db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_source_dossier_evidence_accessed',
    JSON.stringify({ evidenceId: id, dossierId: row.dossierId, actor: actor.username }));
  return row;
}
function nextMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return month === 12 ? String(year + 1).padStart(4, '0') + '-01' : String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0');
}
function registerInflationSourceDossierIpc({ ipcMain, db, licenseView, getActiveSession }) {
  initializeInflationSourceDossierSchema(db);
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida.');
    return actor;
  };
  ipcMain.handle('sicoven:inflation-source-dossier-evidence', (_event, token, evidenceId) => {
    const actor = authenticate(token); return getInflationSourceDossierEvidence(db, evidenceId, actor);
  });
  ipcMain.handle('sicoven:inflation-source-dossier-list', (_event, token, filters) => {
    authenticate(token); return listInflationSourceDossiers(db, filters || {});
  });
  ipcMain.handle('sicoven:inflation-source-dossier-create', (_event, token, input) => {
    const actor = authenticate(token); return createInflationSourceDossier(db, input, actor);
  });
  ipcMain.handle('sicoven:inflation-source-dossier-review', (_event, token, input) => {
    const actor = authenticate(token); return reviewInflationSourceDossier(db, input, actor);
  });
}
module.exports = { SOURCE_REQUIREMENTS, validateDossierInput, initializeInflationSourceDossierSchema,
  createInflationSourceDossier, reviewInflationSourceDossier, listInflationSourceDossiers, getInflationSourceDossierEvidence, registerInflationSourceDossierIpc };
