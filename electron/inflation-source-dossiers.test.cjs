const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const {
  initializeInflationSourceDossierSchema,
  createInflationSourceDossier,
  reviewInflationSourceDossier,
  listInflationSourceDossiers,
  getInflationSourceDossierEvidence,
  registerInflationSourceDossierIpc
} = require('./inflation-source-dossiers.cjs');
const { initializeInflationIndexSchema, importInflationIndexSeries } = require('./inflation-indexes.cjs');
const { initializeOperationReceiptSchema } = require('./operation-receipts.cjs');

const admin = { username: 'admin-a', role: 'admin' };
const accountant = { username: 'contador-a', role: 'contador' };
const reviewer = { username: 'reviewer-b', role: 'admin' };
function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec("CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.exec("CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')))");
  db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)').run('accounting', JSON.stringify({ companies: [{ id: 'company-001', name: 'Empresa de prueba' }] }));
  initializeInflationIndexSchema(db);
  initializeInflationSourceDossierSchema(db);
  initializeOperationReceiptSchema(db);
  return db;
}
function makeSeries(db, code = 'ESTIMACION_EXPERTO') {
  const input = {
    seriesCode: code, metricType: 'INDEX_LEVEL', basePeriod: '2025-01',
    sourceTitle: 'Estudio sintético de prueba', issuer: 'Profesional de prueba',
    sourceReference: 'Fixture sintético; no representa índice real',
    sourcePublishedAt: '2025-02-01', fileName: 'fixture.csv',
    sourceText: 'period;value;status\n2025-01;100;ESTIMATED\n2025-02;101;ESTIMATED'
  };
  return importInflationIndexSeries(db, input, admin);
}
function evidence(evidenceType, description = 'Documento de evidencia sintético usado exclusivamente en pruebas.') {
  const bytes = Buffer.from('SICOVEN TEST FIXTURE ' + evidenceType);
  return { evidenceType, title: evidenceType, description, fileName: evidenceType + '.txt',
    mimeType: 'text/plain', obtainedAt: '2025-02-02', contentBase64: bytes.toString('base64'),
    sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
function dossierInput(seriesId, overrides = {}) {
  const evidenceTypes = [
    'EXPERT_IDENTITY','EXPERT_CREDENTIALS','SIGNED_STUDY','METHODOLOGY','COVERAGE',
    'MONTHLY_SUPPORT','BIAS_DECLARATION'
  ];
  return {
    seriesId, companyId: 'company-001', fiscalYear: 2025, periodFrom: '2025-01', periodTo: '2025-02',
    accountingFramework: 'VEN_NIF_PYMES', purpose: 'REME_FINANCIAL_STATEMENTS',
    normativeRationale: 'Se evalúa la fuente bajo el supuesto normativo documentado correspondiente.',
    professional: { name: 'Profesional de prueba', role: 'Contador responsable del estudio',
      credential: 'Credencial profesional documentada', credentialEvidence: 'Referencia de verificación documental.' },
    methodologyVersion: '1.0', methodologyDescription: 'Metodología mensual explícita y reproducible.',
    coverageDescription: 'Cobertura amplia de bienes y servicios y universo geográfico declarado.',
    periodicity: 'Mensual', limitations: 'Limitaciones documentadas del estudio.',
    biasDeclaration: 'El responsable declara los procedimientos usados para identificar y mitigar sesgos.',
    evidence: evidenceTypes.map(code => evidence(code)), ...overrides
  };
}
test('creates a source dossier with immutable evidence and exact entity/year/period scope', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    const result = createInflationSourceDossier(db, dossierInput(series.seriesId), accountant);
    assert.equal(result.status, 'DRAFT');
    assert.equal(result.eligibleForReview, true);
    const rows = listInflationSourceDossiers(db, { companyId: 'company-001', fiscalYear: 2025 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].evidence.length, 7);
    assert.equal(rows[0].company_id, 'company-001');
    assert.throws(() => db.prepare('UPDATE inflation_source_dossiers SET company_id=?').run('other'), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM inflation_source_dossier_evidence').run(), /append-only/);
  } finally { db.close(); }
});
test('expert dossier cannot be created without all paragraph-17 evidence and professional credentials', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    const input = dossierInput(series.seriesId, { evidence: [evidence('SIGNED_STUDY')] });
    const incomplete = createInflationSourceDossier(db, input, admin);
    assert.equal(incomplete.eligibleForReview, false);
    assert.ok(incomplete.missingEvidence.includes('EXPERT_CREDENTIALS'));
    const valid = dossierInput(series.seriesId, { professional: { name: 'Experto', role: 'Investigador',
      credential: 'Registro acreditado', credentialEvidence: 'Documento de credencial verificado' },
      evidence: [evidence('SIGNED_STUDY')] });
    const result = createInflationSourceDossier(db, valid, admin);
    assert.equal(result.eligibleForReview, false);
    assert.ok(result.missingEvidence.includes('EXPERT_CREDENTIALS'));
  } finally { db.close(); }
});
test('FCCPV paragraph-18 dossier requires explicit FCCPV indication evidence', () => {
  const db = database();
  try {
    const series = makeSeries(db, 'ESTUDIO_FCCPV');
    const input = dossierInput(series.seriesId, { evidence: [
      evidence('SIGNED_STUDY'), evidence('METHODOLOGY'), evidence('COVERAGE')
    ] });
    const result = createInflationSourceDossier(db, input, admin);
    assert.ok(result.missingEvidence.includes('FCCPV_INDICATION'));
    assert.equal(result.eligibleForReview, false);
  } finally { db.close(); }
});
test('paragraph-19 exceptional estimate requires both disproportionate-cost and FCCPV-absence evidence', () => {
  const db = database();
  try {
    const series = makeSeries(db, 'ESTIMACION_PROPIA_EXCEPCIONAL');
    const codes = ['DISPROPORTIONATE_COST_ANALYSIS','FCCPV_ABSENCE_SEARCH','EXTERNAL_MACRO_SOURCES',
      'METHODOLOGY','CALCULATION_WORKPAPERS','PROFESSIONAL_APPROVAL'];
    const input = dossierInput(series.seriesId, { evidence: codes.map(code => evidence(code,
      code === 'DISPROPORTIONATE_COST_ANALYSIS'
        ? 'El análisis cuantifica 120 horas y USD 250 de costo estimado, con procedimientos, circunstancias y soporte de cálculo.'
        : code === 'FCCPV_ABSENCE_SEARCH'
          ? 'El 2025-02-03 se consultaron y revisaron las publicaciones oficiales disponibles; resultado: no se halló estudio indicado aplicable.'
          : 'Documento sintético de soporte metodológico y técnico.')) });
    const result = createInflationSourceDossier(db, input, admin);
    assert.equal(result.eligibleForReview, true);
  } finally { db.close(); }
});
test('approval requires independent reviewer, complete evidence, and exact approval scope', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    const created = createInflationSourceDossier(db, dossierInput(series.seriesId), admin);
    const base = { dossierId: created.dossierId, decision: 'APPROVED_FOR_DOCUMENTED_USE',
      reason: 'Se verificó la documentación, el alcance y la metodología para el uso indicado.',
      reviewerProfessionalName: 'Contador revisor', reviewerCredential: 'Credencial profesional verificada',
      approvedCompanyId: 'company-001', approvedFiscalYear: 2025, approvedPeriodFrom: '2025-01',
      approvedPeriodTo: '2025-02', approvedFramework: 'VEN_NIF_PYMES', approvedPurpose: 'REME_FINANCIAL_STATEMENTS' };
    assert.throws(() => reviewInflationSourceDossier(db, base, admin), /importador no puede revisar/);
    const result = reviewInflationSourceDossier(db, base, accountant);
    assert.equal(result.decision, 'APPROVED_FOR_DOCUMENTED_USE');
    assert.throws(() => reviewInflationSourceDossier(db, base, reviewer), /ya tiene una decisión/);
    assert.equal(listInflationSourceDossiers(db)[0].status, 'APPROVED_FOR_DOCUMENTED_USE');
    const reviewed = listInflationSourceDossiers(db)[0];
    assert.equal(reviewed.reviewerProfessionalName, 'Contador revisor');
    assert.equal(reviewed.reviewerCredential, 'Credencial profesional verificada');
    assert.equal(reviewed.sourceTitle, 'Estudio sintético de prueba');
    assert.equal(reviewed.sourceIssuer, 'Profesional de prueba');
    assert.throws(() => db.prepare('UPDATE inflation_source_dossier_reviews SET reason=?').run('alterado'), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM inflation_source_dossier_reviews').run(), /append-only/);
  } finally { db.close(); }
});
test('projected observations cannot receive documented-use approval', () => {
  const db = database();
  try {
    const series = importInflationIndexSeries(db, {
      seriesCode: 'ESTUDIO_FCCPV', metricType: 'INDEX_LEVEL', basePeriod: '2025-01',
      sourceTitle: 'Estudio sintético', issuer: 'Organismo de prueba', sourceReference: 'Fixture',
      sourcePublishedAt: '2025-02-01', sourceText: 'period;value;status\n2025-01;100;ESTIMATED\n2025-02;101;PROJECTED'
    }, admin);
    const codes = ['FCCPV_INDICATION','SIGNED_STUDY','METHODOLOGY','COVERAGE'];
    const created = createInflationSourceDossier(db, dossierInput(series.seriesId, {
      evidence: codes.map(code => evidence(code))
    }), admin);
    const input = { dossierId: created.dossierId, decision: 'APPROVED_FOR_DOCUMENTED_USE',
      reason: 'La revisión confirma el alcance y los documentos del estudio indicado por FCCPV.',
      reviewerProfessionalName: 'Revisor', reviewerCredential: 'Credencial revisada',
      approvedCompanyId: 'company-001', approvedFiscalYear: 2025, approvedPeriodFrom: '2025-01',
      approvedPeriodTo: '2025-02', approvedFramework: 'VEN_NIF_PYMES', approvedPurpose: 'REME_FINANCIAL_STATEMENTS' };
    assert.throws(() => reviewInflationSourceDossier(db, input, reviewer), /PROJECTED/);
  } finally { db.close(); }
});
test('evidence hash must match the preserved attachment bytes', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    const input = dossierInput(series.seriesId);
    input.evidence[0].sha256 = '0'.repeat(64);
    assert.throws(() => createInflationSourceDossier(db, input, admin), /SHA-256 declarado no coincide/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inflation_source_dossiers').get().n, 0);
  } finally { db.close(); }
});

test('reviewer can retrieve original evidence only through audited administrator access', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    const created = createInflationSourceDossier(db, dossierInput(series.seriesId), admin);
    const dossier = listInflationSourceDossiers(db, { companyId: 'company-001' })[0];
    const item = getInflationSourceDossierEvidence(db, dossier.evidence[0].id, accountant);
    assert.equal(item.dossierId, created.dossierId);
    assert.ok(item.contentBase64);
    assert.equal(item.sha256, dossier.evidence[0].sha256);
    const audit = db.prepare("SELECT event_type,details_json FROM audit_events WHERE event_type='inflation_source_dossier_evidence_accessed'").get();
    assert.equal(audit.event_type, 'inflation_source_dossier_evidence_accessed');
    assert.equal(JSON.parse(audit.details_json).actor, accountant.username);
    assert.throws(() => getInflationSourceDossierEvidence(db, item.id, { username: 'viewer', role: 'user' }), /rol contable/);
  } finally { db.close(); }
});
test('dossier cannot be bound to a company absent from local SQLite accounting state', () => {
  const db = database();
  try {
    const series = makeSeries(db);
    assert.throws(() => createInflationSourceDossier(db, dossierInput(series.seriesId, { companyId: 'nonexistent-company' }), admin), /empresa.*existir/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inflation_source_dossiers').get().n, 0);
  } finally { db.close(); }
});


test('inflation source dossier IPC is bound to the selected company database', async () => {
  const controlDb = database();
  const tenantDb = database();
  const handlers = new Map();
  try {
    const series = makeSeries(tenantDb);
    createInflationSourceDossier(tenantDb, dossierInput(series.seriesId), accountant);
    registerInflationSourceDossierIpc({
      ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
      db: controlDb,
      licenseView: () => ({ authorized: true }),
      getActiveSession: token => token === 'tenant-token' ? accountant : token === 'reviewer-token' ? reviewer : null,
      withDatabase: async (token, operation) => {
        assert.ok(['tenant-token', 'reviewer-token'].includes(token));
        return operation(tenantDb, 'company-001');
      }
    });
    const createInput = { ...dossierInput(series.seriesId), operationId: 'source-dossier-create-001' };
    const created = await handlers.get('sicoven:inflation-source-dossier-create')({}, 'tenant-token', createInput);
    const createRetry = await handlers.get('sicoven:inflation-source-dossier-create')({}, 'tenant-token', createInput);
    assert.equal(created.dossierId, createRetry.dossierId);
    assert.equal(createRetry.replayed, true);

    const reviewInput = {
      operationId: 'source-dossier-review-001',
      dossierId: created.dossierId,
      decision: 'NEEDS_EVIDENCE',
      reason: 'Se requiere completar evidencia antes de la aprobación formal.',
      reviewerProfessionalName: 'Profesional revisor independiente',
      reviewerCredential: 'Credencial profesional de revisión verificable'
    };
    const reviewed = await handlers.get('sicoven:inflation-source-dossier-review')({}, 'reviewer-token', reviewInput);
    const reviewRetry = await handlers.get('sicoven:inflation-source-dossier-review')({}, 'reviewer-token', reviewInput);
    assert.equal(reviewed.reviewId, reviewRetry.reviewId);
    assert.equal(reviewRetry.replayed, true);

    const rows = await handlers.get('sicoven:inflation-source-dossier-list')({}, 'tenant-token', { companyId: 'company-001' });
    assert.equal(rows.length, 2);
    assert.equal(controlDb.prepare('SELECT COUNT(*) AS n FROM inflation_source_dossiers').get().n, 0);
    assert.equal(tenantDb.prepare('SELECT COUNT(*) AS n FROM inflation_source_dossiers').get().n, 2);
    assert.equal(tenantDb.prepare('SELECT COUNT(*) AS n FROM inflation_source_dossier_reviews').get().n, 1);
    assert.equal(tenantDb.prepare('SELECT COUNT(*) AS n FROM operation_receipts').get().n, 2);
  } finally {
    controlDb.close();
    tenantDb.close();
  }
});
