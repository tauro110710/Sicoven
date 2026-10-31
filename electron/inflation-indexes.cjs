const crypto = require('node:crypto');

const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const MAX_OBSERVATIONS = 600;
const SERIES_CODES = new Set(['IPC_AMC','INPC_BCV','ESTIMACION_EXPERTO','ESTUDIO_FCCPV','ESTIMACION_PROPIA_EXCEPCIONAL']);
const METRIC_TYPES = new Set(['INDEX_LEVEL', 'MONTHLY_VARIATION_PCT']);

function validDate(value) {\n  if (typeof value !== 'string' || !/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;\n  const parsed = new Date(value + 'T00:00:00.000Z');\n  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;\n}\nfunction validMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}
function splitCsvLine(line, delimiter) {
  const cells = []; let current = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') { current += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(current.trim()); current = ''; }
    else current += char;
  }
  if (quoted) throw new Error('El CSV contiene una comilla sin cerrar.');
  cells.push(current.trim()); return cells;
}
function normalizeDecimal(raw, metricType) {
  const value = String(raw ?? '').trim();
  if (!/^-?\d{1,12}(?:[.,]\d{1,10})?$/.test(value)) throw new Error('Importe inválido: use un decimal sin separadores de miles ni notación científica.');
  const normalized = value.replace(',', '.'); const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) throw new Error('El valor del índice no es numérico.');
  if (metricType === 'INDEX_LEVEL' && numeric <= 0) throw new Error('Los niveles de índice deben ser mayores que cero.');
  if (metricType === 'MONTHLY_VARIATION_PCT' && numeric <= -100) throw new Error('La variación porcentual mensual debe ser mayor que -100%.');
  return normalized;
}
function parseInflationIndexCsv(sourceText, metricType) {
  if (typeof sourceText !== 'string' || !sourceText.trim()) throw new Error('El archivo de índices está vacío.');
  const bytes = Buffer.byteLength(sourceText, 'utf8');
  if (bytes > MAX_SOURCE_BYTES) throw new Error('El archivo supera el límite de 5 MB.');
  if (!METRIC_TYPES.has(metricType)) throw new Error('Tipo de medición de índice no permitido.');
  const text = sourceText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('El CSV debe incluir encabezado y al menos una observación.');
  const headerLine = lines[0]; const delimiter = headerLine.includes(';') ? ';' : headerLine.includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(headerLine, delimiter).map(item => item.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9_]/g, ''));
  const periodIndex = headers.findIndex(item => ['period','periodo','mes'].includes(item));
  const valueIndex = headers.findIndex(item => ['value','valor','indice','variacion','variacionmensual','variacion_mensual','inflacionmensual','inflacion_mensual'].includes(item));
  if (periodIndex < 0 || valueIndex < 0 || periodIndex === valueIndex) throw new Error('El CSV debe contener columnas de período (YYYY-MM) y valor.');
  const observations = []; const seen = new Set();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index], delimiter); const period = cells[periodIndex];
    if (!validMonth(period)) throw new Error('Período inválido en la línea ' + (index + 1) + ': use YYYY-MM.');
    if (seen.has(period)) throw new Error('El período ' + period + ' está duplicado en el archivo.');
    if (valueIndex >= cells.length || !cells[valueIndex]) throw new Error('Falta el valor del período ' + period + '.');
    observations.push({ period, sourceValue: cells[valueIndex], value: normalizeDecimal(cells[valueIndex], metricType) });
    seen.add(period);
    if (observations.length > MAX_OBSERVATIONS) throw new Error('El archivo supera el máximo de 600 observaciones.');
  }
  observations.sort((a, b) => a.period.localeCompare(b.period));
  if (!observations.length) throw new Error('No se encontraron observaciones válidas.');
  const missingMonths = []; const first = observations[0].period; const last = observations[observations.length - 1].period;
  let year = Number(first.slice(0, 4)); let month = Number(first.slice(5, 7));
  const endYear = Number(last.slice(0, 4)); const endMonth = Number(last.slice(5, 7));
  while (year < endYear || (year === endYear && month < endMonth)) {
    month += 1; if (month > 12) { month = 1; year += 1; }
    const period = String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0');
    if (!seen.has(period)) missingMonths.push(period);
  }
  return { observations, firstPeriod: first, lastPeriod: last, missingMonths,
    observationCount: observations.length,
    sourceSha256: crypto.createHash('sha256').update(sourceText, 'utf8').digest('hex'), sourceBytes: bytes };
}
function initializeInflationIndexSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS inflation_index_sources (
      id TEXT PRIMARY KEY, file_name TEXT NOT NULL, source_title TEXT NOT NULL, issuer TEXT NOT NULL,
      source_reference TEXT NOT NULL, source_url TEXT, source_published_at TEXT,
      imported_at TEXT NOT NULL, source_sha256 TEXT NOT NULL, source_bytes INTEGER NOT NULL, source_text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inflation_index_series (
      id TEXT PRIMARY KEY,
      series_code TEXT NOT NULL CHECK(series_code IN ('IPC_AMC','INPC_BCV','ESTIMACION_EXPERTO','ESTUDIO_FCCPV','ESTIMACION_PROPIA_EXCEPCIONAL')),
      metric_type TEXT NOT NULL CHECK(metric_type IN ('INDEX_LEVEL','MONTHLY_VARIATION_PCT')),
      base_period TEXT, source_id TEXT NOT NULL REFERENCES inflation_index_sources(id),
      first_period TEXT NOT NULL, last_period TEXT NOT NULL, observation_count INTEGER NOT NULL,
      imported_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS inflation_index_observations (
      id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES inflation_index_series(id),
      period TEXT NOT NULL, source_value TEXT NOT NULL, normalized_value TEXT NOT NULL,
      created_at TEXT NOT NULL, UNIQUE(series_id, period)
    );
    CREATE TABLE IF NOT EXISTS inflation_index_approvals (
      id TEXT PRIMARY KEY, series_id TEXT NOT NULL REFERENCES inflation_index_series(id),
      decision TEXT NOT NULL CHECK(decision IN ('APPROVED','REJECTED')),
      reason TEXT NOT NULL, actor_username TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_inflation_observations_period ON inflation_index_observations(period);
    CREATE INDEX IF NOT EXISTS idx_inflation_series_code ON inflation_index_series(series_code, metric_type, created_at);
    CREATE TRIGGER IF NOT EXISTS inflation_sources_no_update BEFORE UPDATE ON inflation_index_sources
      BEGIN SELECT RAISE(ABORT, 'inflation_index_sources is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_sources_no_delete BEFORE DELETE ON inflation_index_sources
      BEGIN SELECT RAISE(ABORT, 'inflation_index_sources is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_series_no_update BEFORE UPDATE ON inflation_index_series
      BEGIN SELECT RAISE(ABORT, 'inflation_index_series is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_series_no_delete BEFORE DELETE ON inflation_index_series
      BEGIN SELECT RAISE(ABORT, 'inflation_index_series is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_observations_no_update BEFORE UPDATE ON inflation_index_observations
      BEGIN SELECT RAISE(ABORT, 'inflation_index_observations is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_observations_no_delete BEFORE DELETE ON inflation_index_observations
      BEGIN SELECT RAISE(ABORT, 'inflation_index_observations is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_approvals_no_update BEFORE UPDATE ON inflation_index_approvals
      BEGIN SELECT RAISE(ABORT, 'inflation_index_approvals is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS inflation_approvals_no_delete BEFORE DELETE ON inflation_index_approvals
      BEGIN SELECT RAISE(ABORT, 'inflation_index_approvals is append-only'); END;
  `);
}
function validateImportInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Solicitud de importación inválida.');
  const seriesCode = String(input.seriesCode || ''); const metricType = String(input.metricType || '');
  if (!SERIES_CODES.has(seriesCode)) throw new Error('Fuente o tipo de serie no permitido.');
  if (!METRIC_TYPES.has(metricType)) throw new Error('Tipo de medición no permitido.');
  const parsed = parseInflationIndexCsv(input.sourceText, metricType);
  const sourceTitle = String(input.sourceTitle || '').trim(); const issuer = String(input.issuer || '').trim();
  const sourceReference = String(input.sourceReference || '').trim(); const fileName = String(input.fileName || 'indices.csv').trim();
  const basePeriod = input.basePeriod ? String(input.basePeriod) : null;
  if (!sourceTitle || sourceTitle.length > 240) throw new Error('Identifique el documento fuente (máximo 240 caracteres).');
  if (!issuer || issuer.length > 180) throw new Error('Identifique el emisor de la fuente (máximo 180 caracteres).');
  if (!sourceReference || sourceReference.length > 500) throw new Error('Indique la referencia documental de la fuente.');
  if (fileName.length > 180) throw new Error('Nombre de archivo demasiado largo.');
  if (metricType === 'INDEX_LEVEL' && !validMonth(basePeriod)) throw new Error('Una serie de niveles de índice requiere período base YYYY-MM.');
  if (basePeriod && !validMonth(basePeriod)) throw new Error('Período base inválido.');
  const sourceUrl = input.sourceUrl ? String(input.sourceUrl).trim() : null;
  if (sourceUrl && !/^https?:\/\/\S+$/i.test(sourceUrl)) throw new Error('La referencia web debe ser una URL HTTP/HTTPS válida.');
  const sourcePublishedAt = input.sourcePublishedAt ? String(input.sourcePublishedAt) : null;
  if (sourcePublishedAt && !/^\d{4}-\d{2}-\d{2}$/.test(sourcePublishedAt)) throw new Error('La fecha de publicación debe usar YYYY-MM-DD.');
  return { ...parsed, seriesCode, metricType, sourceText: input.sourceText, sourceTitle, issuer, sourceReference, fileName, basePeriod, sourceUrl, sourcePublishedAt };
}
function importInflationIndexSeries(db, input, actor) {
  if (!actor || !actor.username) throw new Error('Sesión de usuario requerida.');
  if (actor.role !== 'admin') throw new Error('Solo un administrador puede importar series de índices.');
  const data = validateImportInput(input); const sourceId = crypto.randomUUID(); const seriesId = crypto.randomUUID();
  const now = new Date().toISOString();
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO inflation_index_sources
      (id,file_name,source_title,issuer,source_reference,source_url,source_published_at,imported_at,source_sha256,source_bytes,source_text)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(sourceId, data.fileName, data.sourceTitle, data.issuer, data.sourceReference,
      data.sourceUrl, data.sourcePublishedAt, now, data.sourceSha256, data.sourceBytes, data.sourceText);
    db.prepare(`INSERT INTO inflation_index_series
      (id,series_code,metric_type,base_period,source_id,first_period,last_period,observation_count,imported_by,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(seriesId, data.seriesCode, data.metricType, data.basePeriod, sourceId,
      data.firstPeriod, data.lastPeriod, data.observationCount, actor.username, now);
    const insert = db.prepare(`INSERT INTO inflation_index_observations
      (id,series_id,period,source_value,normalized_value,created_at) VALUES(?,?,?,?,?,?)`);
    for (const row of data.observations) insert.run(crypto.randomUUID(), seriesId, row.period, row.sourceValue, row.value, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_index_series_imported', JSON.stringify({
      seriesId, sourceId, seriesCode: data.seriesCode, metricType: data.metricType,
      firstPeriod: data.firstPeriod, lastPeriod: data.lastPeriod, observationCount: data.observationCount,
      missingMonths: data.missingMonths, sourceSha256: data.sourceSha256, importedBy: actor.username
    }));
  });
  save();
  return { ok: true, seriesId, sourceId, seriesCode: data.seriesCode, metricType: data.metricType,
    firstPeriod: data.firstPeriod, lastPeriod: data.lastPeriod, observationCount: data.observationCount,
    missingMonths: data.missingMonths, sourceSha256: data.sourceSha256, approvalStatus: 'PENDING_REVIEW' };
}
function approveInflationIndexSeries(db, seriesId, decision, reason, actor) {
  if (!actor || actor.role !== 'admin' || !actor.username) throw new Error('Solo un administrador puede revisar una serie de índices.');
  const id = String(seriesId || '').trim(); const choice = String(decision || ''); const note = String(reason || '').trim();
  if (!id) throw new Error('Identificador de serie requerido.');
  if (!['APPROVED','REJECTED'].includes(choice)) throw new Error('Decisión de revisión inválida.');
  if (note.length < 10 || note.length > 1000) throw new Error('La justificación debe tener entre 10 y 1000 caracteres.');
  if (!db.prepare('SELECT id FROM inflation_index_series WHERE id=?').get(id)) throw new Error('La serie de índices no existe.');
  const current = db.prepare('SELECT decision FROM inflation_index_approvals WHERE series_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id);
  if (current?.decision === 'APPROVED') throw new Error('La serie ya fue aprobada; importe una nueva versión para corregirla.');
  const approvalId = crypto.randomUUID(); const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare('INSERT INTO inflation_index_approvals (id,series_id,decision,reason,actor_username,created_at) VALUES(?,?,?,?,?,?)')
      .run(approvalId, id, choice, note, actor.username, now);
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)').run('inflation_index_series_reviewed',
      JSON.stringify({ approvalId, seriesId: id, decision: choice, reason: note, actor: actor.username }));
  })();
  return { ok: true, approvalId, seriesId: id, decision: choice };
}
function getInflationIndexCatalog(db) {
  const rows = db.prepare(`
    SELECT s.id,s.series_code AS seriesCode,s.metric_type AS metricType,s.base_period AS basePeriod,
      s.first_period AS firstPeriod,s.last_period AS lastPeriod,s.observation_count AS observationCount,\n      s.series_version AS seriesVersion,s.missing_months_json AS missingMonthsJson,
      s.imported_by AS importedBy,s.created_at AS createdAt,src.file_name AS fileName,
      src.source_title AS sourceTitle,src.issuer,src.source_reference AS sourceReference,
      src.source_url AS sourceUrl,src.source_published_at AS sourcePublishedAt,src.imported_at AS importedAt,
      src.source_sha256 AS sourceSha256,
      (SELECT decision FROM inflation_index_approvals a WHERE a.series_id=s.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1) AS approvalStatus,
      (SELECT reason FROM inflation_index_approvals a WHERE a.series_id=s.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1) AS approvalReason
    FROM inflation_index_series s JOIN inflation_index_sources src ON src.id=s.source_id
    ORDER BY s.created_at DESC,s.rowid DESC
  `).all();
  return rows.map(item => ({ ...item, approvalStatus: item.approvalStatus || 'PENDING_REVIEW',
    observations: db.prepare('SELECT period,source_value AS sourceValue,normalized_value AS value FROM inflation_index_observations WHERE series_id=? ORDER BY period').all(item.id) }));
}
function registerInflationIndexIpc({ ipcMain, db, licenseView, getActiveSession }) {
  initializeInflationIndexSchema(db);
  const authenticate = token => {
    const licensing = licenseView();
    if (!licensing.authorized) throw new Error(licensing.message || 'Licencia no autorizada.');
    const actor = getActiveSession(token);
    if (!actor) throw new Error('Sesión no válida. Inicie sesión para consultar los índices.');
    return actor;
  };
  ipcMain.handle('sicoven:inflation-index-list', (_event, token) => { authenticate(token); return getInflationIndexCatalog(db); });
  ipcMain.handle('sicoven:inflation-index-preview', (_event, token, input) => {
    authenticate(token); const data = validateImportInput(input);
    return { ok: true, seriesCode: data.seriesCode, metricType: data.metricType, basePeriod: data.basePeriod,
      firstPeriod: data.firstPeriod, lastPeriod: data.lastPeriod, observationCount: data.observationCount,
      missingMonths: data.missingMonths, sourceSha256: data.sourceSha256, sourceBytes: data.sourceBytes };
  });
  ipcMain.handle('sicoven:inflation-index-import', (_event, token, input) => {
    const actor = authenticate(token); return importInflationIndexSeries(db, input, actor);
  });
  ipcMain.handle('sicoven:inflation-index-review', (_event, token, input) => {
    const actor = authenticate(token); return approveInflationIndexSeries(db, input?.seriesId, input?.decision, input?.reason, actor);
  });
}
module.exports = { parseInflationIndexCsv, initializeInflationIndexSchema, validateImportInput,
  importInflationIndexSeries, approveInflationIndexSeries, getInflationIndexCatalog, registerInflationIndexIpc };
