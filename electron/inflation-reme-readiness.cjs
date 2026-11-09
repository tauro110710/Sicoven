const SERIES_BY_PERIOD = [
  { code: 'IPC_AMC', from: '1900-01', to: '2007-12' },
  { code: 'INPC_BCV', from: '2008-01', to: '2200-12' }
];

function validMonth(value) {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
  const [year, month] = value.split('-').map(Number);
  return year >= 1900 && year <= 2200 && month >= 1 && month <= 12;
}
function nextMonth(value) {
  const [year, month] = value.split('-').map(Number);
  return month === 12
    ? String(year + 1).padStart(4, '0') + '-01'
    : String(year).padStart(4, '0') + '-' + String(month + 1).padStart(2, '0');
}
function monthRange(from, to) {
  const result = [];
  for (let period = from; period <= to; period = nextMonth(period)) result.push(period);
  return result;
}
function normalizeRequiredRanges(ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) throw new Error('Indique al menos un tramo mensual requerido.');
  return ranges.map(range => {
    const from = String(range?.from || '');
    const to = String(range?.to || '');
    if (!validMonth(from) || !validMonth(to) || from > to) throw new Error('Tramo mensual inválido; use YYYY-MM y un período inicial no posterior al final.');
    return { from, to };
  });
}
function assessInflationIndexReadiness(db, requiredRanges) {
  const ranges = normalizeRequiredRanges(requiredRanges);
  const blockers = [];
  const selected = [];
  for (const range of ranges) {
    let cursor = range.from;
    while (cursor <= range.to) {
      const family = SERIES_BY_PERIOD.find(item => cursor >= item.from && cursor <= item.to);
      if (!family) {
        blockers.push({ code: 'UNSUPPORTED_PERIOD', period: cursor, message: 'No existe una serie normativa configurada para ' + cursor + '.' });
        break;
      }
      const segmentEnd = range.to < family.to ? range.to : family.to;
      const segment = { seriesCode: family.code, from: cursor, to: segmentEnd };
      const series = db.prepare(`
        SELECT s.id,s.series_code AS seriesCode,s.metric_type AS metricType,s.base_period AS basePeriod,
          s.first_period AS firstPeriod,s.last_period AS lastPeriod,s.missing_months_json AS missingMonthsJson,
          src.issuer,src.source_title AS sourceTitle,src.source_reference AS sourceReference,
          src.source_url AS sourceUrl,src.source_sha256 AS sourceSha256,src.source_published_at AS sourcePublishedAt,
          (SELECT a.decision FROM inflation_index_approvals a WHERE a.series_id=s.id ORDER BY a.created_at DESC,a.rowid DESC LIMIT 1) AS approvalStatus
        FROM inflation_index_series s
        JOIN inflation_index_sources src ON src.id=s.source_id
        WHERE s.series_code=? AND s.metric_type='INDEX_LEVEL'
        ORDER BY s.series_version DESC,s.created_at DESC,s.rowid DESC
        LIMIT 1
      `).get(segment.seriesCode);
      if (!series) {
        blockers.push({ code: 'SERIES_MISSING', seriesCode: segment.seriesCode, from: segment.from, to: segment.to, message: 'No existe una serie de niveles ' + segment.seriesCode + ' importada.' });
        cursor = nextMonth(segmentEnd);
        continue;
      }
      if (series.approvalStatus !== 'APPROVED') {
        blockers.push({ code: 'SERIES_NOT_APPROVED', seriesId: series.id, seriesCode: segment.seriesCode, message: 'La serie ' + segment.seriesCode + ' no tiene aprobación documental.' });
      }
      if (String(series.issuer || '').trim().toLowerCase() !== 'banco central de venezuela') {
        blockers.push({ code: 'ISSUER_NOT_BCV', seriesId: series.id, seriesCode: segment.seriesCode, message: 'El emisor de ' + segment.seriesCode + ' no está identificado como BCV.' });
      }
      let officialUrl = false;
      try {
        const url = new URL(String(series.sourceUrl || ''));
        officialUrl = url.protocol === 'https:' && url.hostname.toLowerCase() === 'www.bcv.org.ve';
      } catch { officialUrl = false; }
      if (!officialUrl) blockers.push({ code: 'SOURCE_URL_NOT_OFFICIAL', seriesId: series.id, seriesCode: segment.seriesCode, message: 'La referencia debe apuntar a una URL HTTPS del dominio oficial www.bcv.org.ve.' });
      if (!/^[a-f0-9]{64}$/i.test(String(series.sourceSha256 || ''))) {
        blockers.push({ code: 'SOURCE_HASH_INVALID', seriesId: series.id, seriesCode: segment.seriesCode, message: 'La evidencia original no tiene huella SHA-256 válida.' });
      }
      if (!series.sourcePublishedAt || !series.sourceReference) {
        blockers.push({ code: 'SOURCE_METADATA_INCOMPLETE', seriesId: series.id, seriesCode: segment.seriesCode, message: 'Faltan fecha de publicación o referencia documental.' });
      }
      if (series.firstPeriod > segment.from || series.lastPeriod < segment.to) {
        blockers.push({ code: 'PERIOD_OUT_OF_COVERAGE', seriesId: series.id, seriesCode: segment.seriesCode, from: segment.from, to: segment.to, message: 'La serie no cubre todo el tramo requerido.' });
      }
      const observations = db.prepare(`
        SELECT period,normalized_value AS value,observation_status AS observationStatus
        FROM inflation_index_observations
        WHERE series_id=? AND period BETWEEN ? AND ?
        ORDER BY period
      `).all(series.id, segment.from, segment.to);
      const byPeriod = new Map(observations.map(row => [row.period, row]));
      for (const period of monthRange(segment.from, segment.to)) {
        const observation = byPeriod.get(period);
        if (!observation) blockers.push({ code: 'MONTH_MISSING', seriesId: series.id, seriesCode: segment.seriesCode, period, message: 'Falta la observación mensual ' + period + '; no se permite interpolar ni completar automáticamente.' });
        else if (observation.observationStatus !== 'OBSERVED') blockers.push({ code: 'OBSERVATION_NOT_OBSERVED', seriesId: series.id, seriesCode: segment.seriesCode, period, status: observation.observationStatus, message: 'La observación ' + period + ' no es un dato observado.' });
        else if (!Number.isFinite(Number(observation.value)) || Number(observation.value) <= 0) blockers.push({ code: 'OBSERVATION_INVALID', seriesId: series.id, seriesCode: segment.seriesCode, period, message: 'El nivel de índice ' + period + ' no es válido.' });
      }
      selected.push({ seriesId: series.id, seriesCode: segment.seriesCode, from: segment.from, to: segment.to, version: Number(db.prepare('SELECT series_version AS version FROM inflation_index_series WHERE id=?').get(series.id).version) });
      cursor = nextMonth(segmentEnd);
    }
  }
  return {
    ready: blockers.length === 0,
    calculationEnabled: false,
    requiredRanges: ranges,
    selectedSeries: selected,
    blockers,
    message: blockers.length === 0
      ? 'La evidencia de índices supera los controles técnicos preliminares. El cálculo REME sigue deshabilitado hasta completar clasificación, metodología y aprobación profesional.'
      : 'REME permanece bloqueado: corrija todos los requisitos de evidencia indicados.'
  };
}
function registerInflationRemeReadinessIpc({ ipcMain, db, licenseView, getActiveSession, withDatabase = null }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' ||
      typeof licenseView !== 'function' || typeof getActiveSession !== 'function' ||
      (withDatabase !== null && typeof withDatabase !== 'function')) {
    throw new Error('No se pudo registrar el control de preparación REME.');
  }
  const runWithDatabase = (token, operation) => withDatabase
    ? withDatabase(token, (activeDb, companyId) => operation(activeDb, companyId))
    : operation(db, null);
  ipcMain.handle('sicoven:inflation-reme-readiness', (_event, token, ranges) => {
    const licensing = licenseView();
    const actor = getActiveSession(token);
    if (!licensing.authorized || !actor) throw new Error('Sesión no válida o licencia no autorizada.');
    return runWithDatabase(token, activeDb => assessInflationIndexReadiness(activeDb, ranges));
  });
}
module.exports = { validMonth, nextMonth, monthRange, normalizeRequiredRanges, assessInflationIndexReadiness, registerInflationRemeReadinessIpc };
