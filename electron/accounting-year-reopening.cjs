'use strict';

const crypto = require('node:crypto');

const isIsoDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const nextIsoDate = value => {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

function initializeAnnualReopeningSchema(db) {
  if (!db || typeof db.exec !== 'function') throw new TypeError('Se requiere SQLite para preparar la reapertura anual.');
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='accounting_exercise_links'").get();
  if (!table) {
    db.exec(`CREATE TABLE accounting_exercise_links (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, prior_period_start_date TEXT NOT NULL,
      prior_period_end_date TEXT NOT NULL, next_period_start_date TEXT NOT NULL,
      journal_entry_id TEXT NOT NULL UNIQUE, cycle_number INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  } else {
    const columns = db.prepare('PRAGMA table_info(accounting_exercise_links)').all();
    const hasCycle = columns.some(column => column.name === 'cycle_number');
    const hasLegacyUnique = /UNIQUE\s*\(\s*company_id\s*,\s*prior_period_start_date\s*,\s*prior_period_end_date\s*,\s*next_period_start_date\s*\)/i.test(table.sql || '');
    if (!hasCycle || hasLegacyUnique) {
      const migrate = db.transaction(() => {
        db.exec('DROP TRIGGER IF EXISTS accounting_exercise_links_no_update; DROP TRIGGER IF EXISTS accounting_exercise_links_no_delete;');
        db.exec('ALTER TABLE accounting_exercise_links RENAME TO accounting_exercise_links_legacy_reopen');
        db.exec(`CREATE TABLE accounting_exercise_links (
          id TEXT PRIMARY KEY, company_id TEXT NOT NULL, prior_period_start_date TEXT NOT NULL,
          prior_period_end_date TEXT NOT NULL, next_period_start_date TEXT NOT NULL,
          journal_entry_id TEXT NOT NULL UNIQUE, cycle_number INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )`);
        const legacyColumns = db.prepare('PRAGMA table_info(accounting_exercise_links_legacy_reopen)').all();
        const hasCreatedAt = legacyColumns.some(column => column.name === 'created_at');
        const hasLegacyCycle = legacyColumns.some(column => column.name === 'cycle_number');
        db.exec(`INSERT INTO accounting_exercise_links
          (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id,cycle_number,created_at)
          SELECT id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id,
            ${hasLegacyCycle ? 'cycle_number' : '1'}, ${hasCreatedAt ? 'created_at' : "datetime('now')"}
          FROM accounting_exercise_links_legacy_reopen`);
        db.exec('DROP TABLE accounting_exercise_links_legacy_reopen');
      });
      migrate();
    }
  }
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS accounting_exercise_links_no_update
      BEFORE UPDATE ON accounting_exercise_links
      BEGIN SELECT RAISE(ABORT, 'accounting_exercise_links is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_exercise_links_no_delete
      BEFORE DELETE ON accounting_exercise_links
      BEGIN SELECT RAISE(ABORT, 'accounting_exercise_links is append-only'); END;
    CREATE TABLE IF NOT EXISTS accounting_year_reopenings (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, closing_entry_id TEXT NOT NULL UNIQUE,
      opening_entry_id TEXT NOT NULL UNIQUE, cycle_number INTEGER NOT NULL,
      details_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TRIGGER IF NOT EXISTS accounting_year_reopenings_no_update
      BEFORE UPDATE ON accounting_year_reopenings
      BEGIN SELECT RAISE(ABORT, 'accounting_year_reopenings is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS accounting_year_reopenings_no_delete
      BEFORE DELETE ON accounting_year_reopenings
      BEGIN SELECT RAISE(ABORT, 'accounting_year_reopenings is append-only'); END;
  `);
}

function assertNoLaterActivity(state, companyId, closingDate, closingId, openingId) {
  const journal = Array.isArray(state.journalEntries) ? state.journalEntries : [];
  const laterEntry = journal.find(entry => String(entry.companyId) === companyId &&
    ![closingId, openingId].includes(String(entry.id)) && String(entry.date || '') > closingDate);
  if (laterEntry) throw new Error('No se puede reabrir: existen asientos posteriores al cierre anual. Revise primero sus dependencias.');
  const collections = [
    ['sales', ['invoiceDate', 'date']],
    ['purchases', ['invoiceDate', 'accountCreditDate', 'date']],
    ['movements', ['date']],
    ['bankStatementMovements', ['date']],
    ['creditSettlements', ['settlementDate', 'date']],
    ['supplierAdvanceSettlements', ['settlementDate', 'date']],
    ['supplierDirectAdvances', ['date', 'createdAt']],
    ['vatVouchers', ['date']],
    ['islrVouchers', ['date']],
    ['vatWithholdingDeclarations', ['periodEndDate', 'date']],
    ['vatWithholdingDeclarationEvents', ['date', 'createdAt']],
    ['islrFiscalEvents', ['date', 'createdAt']]
  ];
  for (const [collectionName, dateFields] of collections) {
    for (const item of (Array.isArray(state[collectionName]) ? state[collectionName] : [])) {
      if (String(item.companyId || '') !== companyId) continue;
      if (dateFields.some(field => isIsoDate(String(item[field] || '').slice(0, 10)) &&
          String(item[field]).slice(0, 10) > closingDate)) {
        throw new Error('No se puede reabrir: existen operaciones o dependencias posteriores al cierre en ' + collectionName + '.');
      }
    }
  }
}

function invertEntry(source, entryNumber, date, reason, cycleNumber) {
  if (!Array.isArray(source.items) || source.items.length < 2) {
    throw new Error('El asiento anual no contiene líneas suficientes para una reversión exacta.');
  }
  return {
    id: crypto.randomUUID(),
    companyId: source.companyId,
    entryNumber,
    date,
    description: 'Reversión formal de ' + (source.type === 'CIERRE' ? 'cierre' : 'apertura') +
      ' del ejercicio ' + cycleNumber,
    type: 'AJUSTE',
    bcvRate: Number(source.bcvRate),
    referenceDoc: 'REV-' + source.entryNumber,
    reversalOfEntryId: source.id,
    reversalReason: reason,
    workpaperNote: 'REAPERTURA_ANUAL_V1 | ciclo ' + cycleNumber + ' | reversión exacta de asiento anual.',
    priorPeriodAdjustment: false,
    items: source.items.map(item => ({
      ...item,
      debitBs: Number(item.creditBs || 0),
      creditBs: Number(item.debitBs || 0),
      debitUsd: Number(item.creditUsd || 0),
      creditUsd: Number(item.debitUsd || 0)
    }))
  };
}

function reopenAccountingYear(db, input, actor) {
  if (!db || typeof db.transaction !== 'function') throw new TypeError('Se requiere una conexión SQLite válida.');
  const companyId = String(input?.companyId || '').trim();
  const reason = String(input?.reason || '').trim();
  if (!companyId) throw new Error('Seleccione una empresa para reabrir el ejercicio.');
  if (reason.length < 10 || reason.length > 1000) throw new Error('El motivo debe tener entre 10 y 1000 caracteres.');
  initializeAnnualReopeningSchema(db);

  const execute = db.transaction(() => {
    const row = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get();
    if (!row) throw new Error('No existe un estado contable persistido para reabrir.');
    let state;
    try { state = JSON.parse(row.state_json); }
    catch { throw new Error('El estado SQLite es ilegible; se bloqueó la reapertura para proteger el historial.'); }
    if (!state || !Array.isArray(state.companies) || !Array.isArray(state.journalEntries)) {
      throw new Error('El estado contable no contiene empresas y asientos válidos.');
    }
    const company = state.companies.find(item => String(item.id) === companyId);
    if (!company) throw new Error('La empresa seleccionada no existe en SQLite.');
    const closingDate = String(company.closedThroughDate || '');
    if (!isIsoDate(closingDate)) throw new Error('La empresa no tiene un cierre anual vigente y verificable.');
    const closings = state.journalEntries.filter(entry => String(entry.companyId) === companyId &&
      entry.type === 'CIERRE' && entry.date === closingDate &&
      String(entry.referenceDoc || '') === 'CIERRE:' + companyId + ':' + closingDate);
    if (closings.length !== 1) throw new Error('No se encontró un único asiento de cierre anual vigente; no se modificó ningún dato.');
    const closing = closings[0];
    const evidence = closing.annualCloseState;
    if (!evidence || !Number.isInteger(Number(evidence.previousFiscalYear)) ||
        !Number.isInteger(Number(evidence.cycleNumber)) || Number(evidence.cycleNumber) < 1 ||
        !(evidence.previousClosedThroughDate === null || isIsoDate(evidence.previousClosedThroughDate))) {
      throw new Error('Este cierre antiguo no conserva evidencia del estado previo. No es seguro reabrirlo automáticamente.');
    }
    if (Number(company.fiscalYear) !== Number(evidence.previousFiscalYear) + 1 ||
        String(closing.date) !== String(evidence.previousFiscalYear) + '-12-31' ||
        (evidence.previousClosedThroughDate && evidence.previousClosedThroughDate >= closingDate)) {
      throw new Error('El estado actual de la empresa no coincide con la evidencia capturada al cerrar el ejercicio.');
    }
    if (closing.reversedByEntryId || closing.isAdjusted || closing.reversalOfEntryId) {
      throw new Error('El asiento de cierre ya fue revertido o ajustado.');
    }
    const openingDate = nextIsoDate(closingDate);
    const openings = state.journalEntries.filter(entry => String(entry.companyId) === companyId &&
      entry.type === 'APERTURA' && entry.date === openingDate &&
      entry.exerciseLink?.priorPeriodEndDate === closingDate &&
      entry.exerciseLink?.nextPeriodStartDate === openingDate);
    if (openings.length !== 1) throw new Error('No se encontró una única apertura enlazada al cierre anual.');
    const opening = openings[0];
    if (opening.reversedByEntryId || opening.isAdjusted || opening.reversalOfEntryId) {
      throw new Error('El asiento de apertura ya fue revertido o ajustado.');
    }
    const link = db.prepare('SELECT * FROM accounting_exercise_links WHERE journal_entry_id=? AND company_id=?')
      .get(String(opening.id), companyId);
    if (!link) throw new Error('El vínculo SQLite entre cierre y apertura no existe; se bloqueó la reapertura.');
    const existing = db.prepare('SELECT id FROM accounting_year_reopenings WHERE closing_entry_id=? OR opening_entry_id=?')
      .get(String(closing.id), String(opening.id));
    if (existing) throw new Error('Este ciclo anual ya tiene una reapertura formal registrada.');
    assertNoLaterActivity(state, companyId, closingDate, String(closing.id), String(opening.id));

    const maxEntryNumber = state.journalEntries.filter(entry => String(entry.companyId) === companyId)
      .reduce((max, entry) => Math.max(max, Number(entry.entryNumber) || 0), 0);
    const closingReversal = invertEntry(closing, maxEntryNumber + 1, openingDate, reason, evidence.cycleNumber);
    const openingReversal = invertEntry(opening, maxEntryNumber + 2, openingDate, reason, evidence.cycleNumber);
    const journalEntries = state.journalEntries.map(entry => {
      if (String(entry.id) === String(closing.id)) return { ...entry, isAdjusted: true, reversedByEntryId: closingReversal.id };
      if (String(entry.id) === String(opening.id)) return { ...entry, isAdjusted: true, reversedByEntryId: openingReversal.id };
      return entry;
    }).concat(closingReversal, openingReversal);
    const restoredCompany = {
      ...company,
      fiscalYear: Number(evidence.previousFiscalYear),
      ...(evidence.previousClosedThroughDate
        ? { closedThroughDate: evidence.previousClosedThroughDate }
        : { closedThroughDate: undefined })
    };
    const nextState = {
      ...state,
      companies: state.companies.map(item => String(item.id) === companyId ? restoredCompany : item),
      journalEntries
    };
    const details = {
      id: crypto.randomUUID(), companyId, companyName: String(company.name || ''),
      cycleNumber: Number(evidence.cycleNumber), closingEntryId: closing.id,
      openingEntryId: opening.id, closingReversalEntryId: closingReversal.id,
      openingReversalEntryId: openingReversal.id,
      closingDate, openingDate,
      previousFiscalYear: Number(evidence.previousFiscalYear),
      previousClosedThroughDate: evidence.previousClosedThroughDate || null,
      restoredFiscalYear: restoredCompany.fiscalYear,
      restoredClosedThroughDate: restoredCompany.closedThroughDate || null,
      reason, actor: actor ? { userId: actor.id ?? null, username: actor.username || null } : null
    };
    const json = JSON.stringify(nextState);
    if (json.length > 50 * 1024 * 1024) throw new Error('El estado contable supera el límite permitido.');
    db.prepare("UPDATE app_state SET state_json=?, updated_at=datetime('now') WHERE state_key='accounting'")
      .run(json);
    db.prepare(`INSERT INTO accounting_year_reopenings
      (id,company_id,closing_entry_id,opening_entry_id,cycle_number,details_json)
      VALUES(?,?,?,?,?,?)`).run(details.id, companyId, String(closing.id), String(opening.id),
      Number(evidence.cycleNumber), JSON.stringify(details));
    db.prepare('INSERT INTO audit_events(event_type,details_json) VALUES(?,?)')
      .run('accounting_year_reopened', JSON.stringify(details));
    return {
      ok: true, company: restoredCompany, reopening: details,
      reversalEntries: [closingReversal, openingReversal]
    };
  });
  return execute();
}

module.exports = { initializeAnnualReopeningSchema, reopenAccountingYear };
