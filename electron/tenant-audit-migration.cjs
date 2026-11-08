'use strict';

function normalizeCompanyIds(companyIds) {
  if (!Array.isArray(companyIds) || companyIds.length === 0) {
    throw new TypeError('Se requiere la lista de empresas para separar la auditoría.');
  }
  const ids = new Set();
  for (const value of companyIds) {
    const id = String(value || '').trim();
    if (!id || ids.has(id)) throw new Error('La lista de empresas contiene identificadores vacíos o duplicados.');
    ids.add(id);
  }
  return ids;
}

function partitionAuditEvents(rows, companyIds) {
  if (!Array.isArray(rows)) throw new TypeError('Los eventos de auditoría deben recibirse como una lista.');
  const knownCompanies = normalizeCompanyIds(companyIds);
  const byCompany = new Map([...knownCompanies].map(id => [id, []]));
  const controlEvents = [];
  const unresolvedEvents = [];
  const seenIds = new Set();

  for (const row of rows) {
    const id = Number(row?.id);
    if (!Number.isSafeInteger(id) || id < 1 || seenIds.has(id)) {
      throw new Error('La auditoría contiene un ID inválido o duplicado; se canceló la partición.');
    }
    seenIds.add(id);
    if (typeof row.event_type !== 'string' || !row.event_type.trim() ||
        typeof row.details_json !== 'string' || typeof row.created_at !== 'string') {
      throw new Error('Un evento de auditoría no contiene todos sus campos originales.');
    }

    let details;
    try {
      details = JSON.parse(row.details_json);
    } catch {
      controlEvents.push(row);
      unresolvedEvents.push({ id, reason: 'INVALID_DETAILS_JSON' });
      continue;
    }

    const companyId = details && typeof details === 'object' && !Array.isArray(details)
      ? String(details.companyId || '').trim()
      : '';
    if (!companyId) {
      controlEvents.push(row);
      continue;
    }
    if (!knownCompanies.has(companyId)) {
      controlEvents.push(row);
      unresolvedEvents.push({ id, reason: 'UNKNOWN_COMPANY', companyId });
      continue;
    }
    byCompany.get(companyId).push(row);
  }

  return {
    byCompany,
    controlEvents,
    unresolvedEvents,
    counts: {
      total: rows.length,
      assigned: [...byCompany.values()].reduce((sum, events) => sum + events.length, 0),
      retainedInControl: controlEvents.length,
      unresolved: unresolvedEvents.length
    }
  };
}

function copyAuditEvents(db, rows) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw new TypeError('Se requiere una base SQLite destino para copiar la auditoría.');
  }
  if (!Array.isArray(rows)) throw new TypeError('Los eventos de auditoría deben recibirse como una lista.');
  const insert = db.prepare(
    'INSERT INTO audit_events(id,event_type,details_json,created_at) VALUES(?,?,?,?)'
  );
  const copy = db.transaction(() => {
    for (const row of rows) {
      const id = Number(row?.id);
      if (!Number.isSafeInteger(id) || id < 1 ||
          typeof row.event_type !== 'string' || !row.event_type.trim() ||
          typeof row.details_json !== 'string' || typeof row.created_at !== 'string') {
        throw new Error('Un evento de auditoría no conserva un ID, tipo, detalle JSON y fecha válidos.');
      }
      insert.run(id, row.event_type, row.details_json, row.created_at);
    }
  });
  copy();
  return rows.length;
}

module.exports = { partitionAuditEvents, copyAuditEvents };
