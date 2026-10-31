const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeInflationIndexSchema, importInflationIndexSeries, approveInflationIndexSeries } = require('./inflation-indexes.cjs');
const { assessInflationIndexReadiness, normalizeRequiredRanges, registerInflationRemeReadinessIpc } = require('./inflation-reme-readiness.cjs');

function database() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
  initializeInflationIndexSchema(db);
  return db;
}
const admin = { id: 1, username: 'admin', role: 'admin' };
function sourceInput(overrides = {}) {
  return {
    seriesCode: 'INPC_BCV', metricType: 'INDEX_LEVEL', basePeriod: '2008-01',
    fileName: 'inpc-oficial.csv', sourceTitle: 'Serie mensual INPC BCV',
    issuer: 'Banco Central de Venezuela', sourceReference: 'Archivo oficial BCV 4_5_7',
    sourceUrl: 'https://www.bcv.org.ve/excel/4_5_7.xls?id=410', sourcePublishedAt: '2026-09-04',
    sourceText: 'period,value\n2026-07,100.0\n2026-08,108.9\n2026-09,118.6',
    ...overrides
  };
}
test('normalizes and validates requested monthly ranges', () => {
  assert.deepEqual(normalizeRequiredRanges([{ from: '2026-07', to: '2026-09' }]), [{ from: '2026-07', to: '2026-09' }]);
  assert.throws(() => normalizeRequiredRanges([]), /al menos un tramo/);
  assert.throws(() => normalizeRequiredRanges([{ from: '2026-13', to: '2026-14' }]), /Tramo mensual inválido/);
});
test('blocks when no approved official BCV series exists', () => {
  const db = database();
  try {
    const result = assessInflationIndexReadiness(db, [{ from: '2026-07', to: '2026-09' }]);
    assert.equal(result.ready, false);
    assert.equal(result.calculationEnabled, false);
    assert.ok(result.blockers.some(item => item.code === 'SERIES_MISSING'));
  } finally { db.close(); }
});
test('requires approval, official issuer, official HTTPS URL and complete observed coverage', () => {
  const db = database();
  try {
    const imported = importInflationIndexSeries(db, sourceInput(), admin);
    let result = assessInflationIndexReadiness(db, [{ from: '2026-07', to: '2026-09' }]);
    assert.ok(result.blockers.some(item => item.code === 'SERIES_NOT_APPROVED'));
    approveInflationIndexSeries(db, imported.seriesId, 'APPROVED', 'Se contrastó el documento oficial BCV.', admin);
    result = assessInflationIndexReadiness(db, [{ from: '2026-07', to: '2026-09' }]);
    assert.equal(result.ready, true);
    assert.equal(result.calculationEnabled, false);
    assert.equal(result.selectedSeries.length, 1);
  } finally { db.close(); }
});
test('rejects missing months and estimated or projected observations without interpolation', () => {
  const db = database();
  try {
    const imported = importInflationIndexSeries(db, sourceInput({ sourceText: 'period,value\n2026-07,100.0\n2026-09,118.6' }), admin);
    approveInflationIndexSeries(db, imported.seriesId, 'APPROVED', 'Fuente oficial revisada y aprobada.', admin);
    const result = assessInflationIndexReadiness(db, [{ from: '2026-07', to: '2026-09' }]);
    assert.ok(result.blockers.some(item => item.code === 'MONTH_MISSING' && item.period === '2026-08'));
  } finally { db.close(); }
});
test('rejects a non-BCV issuer or a non-official source URL', () => {
  const db = database();
  try {
    const imported = importInflationIndexSeries(db, sourceInput({ issuer: 'Proveedor privado', sourceUrl: 'https://example.com/inpc.csv' }), admin);
    approveInflationIndexSeries(db, imported.seriesId, 'APPROVED', 'Documento revisado para prueba negativa.', admin);
    const result = assessInflationIndexReadiness(db, [{ from: '2026-07', to: '2026-09' }]);
    assert.ok(result.blockers.some(item => item.code === 'ISSUER_NOT_BCV'));
    assert.ok(result.blockers.some(item => item.code === 'SOURCE_URL_NOT_OFFICIAL'));
  } finally { db.close(); }
});
test('requires IPC AMC before 2008 and INPC BCV from January 2008', () => {
  const db = database();
  try {
    const result = assessInflationIndexReadiness(db, [{ from: '2007-11', to: '2008-02' }]);
    assert.deepEqual(result.blockers.filter(item => item.code === 'SERIES_MISSING').map(item => item.seriesCode), ['IPC_AMC', 'INPC_BCV']);
  } finally { db.close(); }
});
test('IPC requires a valid licensed session and never enables calculations', () => {
  const db = database(), handlers = new Map();
  registerInflationRemeReadinessIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, db,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'admin' ? admin : null
  });
  try {
    assert.throws(() => handlers.get('sicoven:inflation-reme-readiness')({}, 'bad', [{ from: '2026-07', to: '2026-09' }]), /Sesión no válida/);
    const result = handlers.get('sicoven:inflation-reme-readiness')({}, 'admin', [{ from: '2026-07', to: '2026-09' }]);
    assert.equal(result.calculationEnabled, false);
  } finally { db.close(); }
});
