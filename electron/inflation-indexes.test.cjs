const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const {
  parseInflationIndexCsv,
  initializeInflationIndexSchema,
  importInflationIndexSeries,
  approveInflationIndexSeries,
  getInflationIndexCatalog,
  registerInflationIndexIpc
} = require('./inflation-indexes.cjs');

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  initializeInflationIndexSchema(db);
  return db;
}
const admin = { id: 1, username: 'admin', role: 'admin' };
const importerInput = (overrides = {}) => ({
  seriesCode: 'INPC_BCV',
  metricType: 'INDEX_LEVEL',
  basePeriod: '2024-12',
  fileName: 'inpc.csv',
  sourceTitle: 'Serie oficial INPC',
  issuer: 'Banco Central de Venezuela',
  sourceReference: 'Boletín estadístico oficial, tabla INPC general',
  sourceUrl: 'https://www.bcv.org.ve/',
  sourcePublishedAt: '2025-02-10',
  sourceText: 'period;value\n2025-01;100,5\n2025-03;103,2',
  ...overrides
});

test('CSV parser preserves decimal source text and reports missing months', () => {
  const result = parseInflationIndexCsv('period;value\n2025-01;100,5\n2025-03;103,2', 'INDEX_LEVEL');
  assert.equal(result.observationCount, 2);
  assert.equal(result.observations[0].sourceValue, '100,5');
  assert.equal(result.observations[0].value, '100.5');
  assert.deepEqual(result.missingMonths, ['2025-02']);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
});

test('CSV parser rejects duplicate months, invalid dates and non-positive index levels', () => {
  assert.throws(() => parseInflationIndexCsv('period,value\n2025-01,100\n2025-01,101', 'INDEX_LEVEL'), /duplicado/);
  assert.throws(() => parseInflationIndexCsv('period,value\n2025-13,100', 'INDEX_LEVEL'), /Período inválido/);
  assert.throws(() => parseInflationIndexCsv('period,value\n2025-01,0', 'INDEX_LEVEL'), /mayores que cero/);
});

test('monthly percentage series accepts negative changes only above -100 percent', () => {
  const parsed = parseInflationIndexCsv('period,value\n2025-01,-0.5\n2025-02,2.25', 'MONTHLY_VARIATION_PCT');
  assert.deepEqual(parsed.observations.map(item => item.value), ['-0.5', '2.25']);
  assert.throws(() => parseInflationIndexCsv('period,value\n2025-01,-100', 'MONTHLY_VARIATION_PCT'), /mayor que -100%/);
});


test('FCCPV study series must distinguish estimated months from projections', () => {
  assert.throws(() => parseInflationIndexCsv('period;value\n2026-03;4.2', 'MONTHLY_VARIATION_PCT', 'ESTUDIO_FCCPV'), /identificar cada mes/);
  const parsed = parseInflationIndexCsv(
    'period;value;status\n2026-03;4.2;ESTIMATED\n2026-04;4.8;PROJECTED',
    'MONTHLY_VARIATION_PCT',
    'ESTUDIO_FCCPV'
  );
  assert.deepEqual(parsed.statusCounts, { ESTIMATED: 1, PROJECTED: 1 });
  assert.equal(parsed.observations[1].observationStatus, 'PROJECTED');
  assert.throws(() => parseInflationIndexCsv(
    'period;value;status\n2026-03;4.2;OBSERVED',
    'MONTHLY_VARIATION_PCT',
    'ESTUDIO_FCCPV'
  ), /Estado de observación no permitido/);
});

test('index import stores source evidence, observations and audit event in one transaction', () => {
  const db = database();
  try {
    const result = importInflationIndexSeries(db, importerInput(), admin);
    assert.equal(result.ok, true);
    assert.equal(result.approvalStatus, 'PENDING_REVIEW');
    assert.deepEqual(result.missingMonths, ['2025-02']);
    const catalog = getInflationIndexCatalog(db);
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0].sourceSha256, result.sourceSha256);
    assert.equal(catalog[0].approvalStatus, 'PENDING_REVIEW');
    assert.equal(catalog[0].seriesVersion, 1);
    assert.deepEqual(catalog[0].missingMonths, ['2025-02']);
    assert.equal(catalog[0].observations.length, 2);
    assert.equal(catalog[0].observations[0].observationStatus, 'OBSERVED');
    const secondVersion = importInflationIndexSeries(db, importerInput({ sourceTitle: 'Serie oficial INPC revisada' }), admin);
    assert.equal(secondVersion.seriesVersion, 2);
    assert.equal(db.prepare('SELECT source_text FROM inflation_index_sources').get().source_text, importerInput().sourceText);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='inflation_index_series_imported'").get().n, 2);
  } finally { db.close(); }
});

test('index import rejects non-admin actors and unsupported source URLs without writing', () => {
  const db = database();
  try {
    assert.throws(() => importInflationIndexSeries(db, importerInput(), { username: 'operator', role: 'user' }), /Solo un administrador/);
    assert.throws(() => importInflationIndexSeries(db, importerInput({ sourceUrl: 'javascript:alert(1)' }), admin), /URL HTTP\/HTTPS/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inflation_index_series').get().n, 0);
  } finally { db.close(); }
});

test('source, series, observations and review decisions are append-only', () => {
  const db = database();
  try {
    const result = importInflationIndexSeries(db, importerInput(), admin);
    assert.throws(() => db.prepare('UPDATE inflation_index_observations SET normalized_value=?').run('999'), /append-only/);
    assert.throws(() => db.prepare('DELETE FROM inflation_index_sources').run(), /append-only/);
    const approved = approveInflationIndexSeries(db, result.seriesId, 'APPROVED', 'Fuente revisada contra el documento oficial.', admin);
    assert.equal(approved.decision, 'APPROVED');
    assert.throws(() => approveInflationIndexSeries(db, result.seriesId, 'REJECTED', 'Cambio posterior no permitido.', admin), /ya fue revisada/);
    assert.equal(getInflationIndexCatalog(db)[0].approvalStatus, 'APPROVED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inflation_index_approvals').get().n, 1);
  } finally { db.close(); }
});

test('a rejected series cannot be re-approved without importing a new evidence version', () => {
  const db = database();
  try {
    const rejected = importInflationIndexSeries(db, importerInput(), admin);
    approveInflationIndexSeries(db, rejected.seriesId, 'REJECTED', 'Documento sin evidencia de publicación.', admin);
    assert.throws(() => approveInflationIndexSeries(db, rejected.seriesId, 'APPROVED', 'Se aportó evidencia oficial adicional.', admin), /importe una nueva versión/);
    const replacement = importInflationIndexSeries(db, importerInput({ sourceTitle: 'Serie oficial con evidencia adicional' }), admin);
    approveInflationIndexSeries(db, replacement.seriesId, 'APPROVED', 'Se verificó la nueva evidencia oficial.', admin);
    assert.equal(getInflationIndexCatalog(db)[0].approvalStatus, 'APPROVED');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inflation_index_approvals').get().n, 2);
  } finally { db.close(); }
});

test('IPC requires a valid session and uses administrator-only import and review', () => {
  const db = database();
  const handlers = new Map();
  registerInflationIndexIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'admin-token' ? admin : null
  });
  try {
    assert.throws(() => handlers.get('sicoven:inflation-index-list')({}, 'bad-token'), /Sesión no válida/);
    const preview = handlers.get('sicoven:inflation-index-preview')({}, 'admin-token', importerInput());
    assert.equal(preview.observationCount, 2);
    const imported = handlers.get('sicoven:inflation-index-import')({}, 'admin-token', importerInput());
    assert.equal(imported.ok, true);
    const reviewed = handlers.get('sicoven:inflation-index-review')({}, 'admin-token', {
      seriesId: imported.seriesId, decision: 'APPROVED', reason: 'Verificado por administración.'
    });
    assert.equal(reviewed.ok, true);
  } finally { db.close(); }
});
