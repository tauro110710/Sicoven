'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { reopenAccountingYear, initializeAnnualReopeningSchema } = require('./accounting-year-reopening.cjs');

function fixture({ withEvidence = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state (state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL, updated_at TEXT);
    CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL, details_json TEXT NOT NULL);
    CREATE TABLE accounting_exercise_links (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL, prior_period_start_date TEXT NOT NULL,
      prior_period_end_date TEXT NOT NULL, next_period_start_date TEXT NOT NULL,
      journal_entry_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_id, prior_period_start_date, prior_period_end_date, next_period_start_date)
    );
    CREATE TRIGGER accounting_exercise_links_no_update BEFORE UPDATE ON accounting_exercise_links
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
    CREATE TRIGGER accounting_exercise_links_no_delete BEFORE DELETE ON accounting_exercise_links
      BEGIN SELECT RAISE(ABORT, 'append-only'); END;
  `);
  const company = { id: 'co-1', name: 'Empresa de prueba', fiscalYear: 2026, closedThroughDate: '2025-12-31' };
  const closing = {
    id: 'close-1', companyId: 'co-1', entryNumber: 20, date: '2025-12-31',
    description: 'Cierre 2025', type: 'CIERRE', bcvRate: 50,
    referenceDoc: 'CIERRE:co-1:2025-12-31', workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    ...(withEvidence ? { annualCloseState: { previousFiscalYear: 2025, previousClosedThroughDate: '2024-12-31', cycleNumber: 1 } } : {}),
    items: [
      { accountCode: '4.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const opening = {
    id: 'open-1', companyId: 'co-1', entryNumber: 21, date: '2026-01-01',
    description: 'Apertura 2026', type: 'APERTURA', bcvRate: 50,
    referenceDoc: 'APERTURA:co-1:2026-01-01',
    exerciseLink: { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01' },
    items: [
      { accountCode: '1.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const state = { companies: [company], journalEntries: [closing, opening], sales: [], purchases: [], movements: [] };
  db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)').run('accounting', JSON.stringify(state));
  db.prepare(`INSERT INTO accounting_exercise_links
    (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id)
    VALUES(?,?,?,?,?,?)`).run('link-1', 'co-1', '2025-01-01', '2025-12-31', '2026-01-01', 'open-1');
  return { db, state, closing, opening };
}

test('reabre el ciclo con dos contra-asientos exactos y restaura el estado previo', () => {
  const { db, closing, opening } = fixture();
  const result = reopenAccountingYear(db, { companyId: 'co-1', reason: 'Corrección integral del cierre anual.' }, { id: 7, username: 'contador' });
  assert.equal(result.ok, true);
  assert.equal(result.company.fiscalYear, 2025);
  assert.equal(result.company.closedThroughDate, '2024-12-31');
  assert.equal(result.reversalEntries.length, 2);
  assert.equal(result.reversalEntries.find(entry => entry.reversalOfEntryId === closing.id).date, '2025-12-31');
  assert.equal(result.reversalEntries.find(entry => entry.reversalOfEntryId === opening.id).date, '2026-01-01');
  const state = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
  const originalClosing = state.journalEntries.find(entry => entry.id === closing.id);
  const originalOpening = state.journalEntries.find(entry => entry.id === opening.id);
  assert.equal(originalClosing.isAdjusted, true);
  assert.equal(originalOpening.isAdjusted, true);
  for (const reversal of result.reversalEntries) {
    const source = reversal.reversalOfEntryId === closing.id ? closing : opening;
    assert.equal(reversal.type, 'AJUSTE');
    assert.equal(reversal.bcvRate, source.bcvRate);
    assert.deepEqual(reversal.items.map(item => item.accountCode), source.items.map(item => item.accountCode));
    for (let i = 0; i < source.items.length; i++) {
      assert.equal(reversal.items[i].debitBs, source.items[i].creditBs);
      assert.equal(reversal.items[i].creditBs, source.items[i].debitBs);
      assert.equal(reversal.items[i].debitUsd, source.items[i].creditUsd);
      assert.equal(reversal.items[i].creditUsd, source.items[i].debitUsd);
    }
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_year_reopened'").get().count, 1);
  db.close();
});

test('permite reabrir un segundo ciclo sin perder la reapertura anterior', () => {
  const { db, state } = fixture();
  const first = reopenAccountingYear(db, { companyId: 'co-1', reason: 'Primera reapertura anual formal.' }, null);
  const nextState = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
  const secondClosing = {
    id: 'close-2', companyId: 'co-1', entryNumber: 24, date: '2025-12-31',
    description: 'Segundo cierre 2025', type: 'CIERRE', bcvRate: 50,
    referenceDoc: 'CIERRE:co-1:2025-12-31', workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    annualCloseState: { previousFiscalYear: 2025, previousClosedThroughDate: '2024-12-31', cycleNumber: 2 },
    items: [
      { accountCode: '4.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const secondOpening = {
    id: 'open-2', companyId: 'co-1', entryNumber: 25, date: '2026-01-01',
    description: 'Segunda apertura 2026', type: 'APERTURA', bcvRate: 50,
    referenceDoc: 'APERTURA:co-1:2026-01-01',
    exerciseLink: { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01', cycleNumber: 2 },
    items: [
      { accountCode: '1.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  nextState.companies[0].fiscalYear = 2026;
  nextState.companies[0].closedThroughDate = '2025-12-31';
  nextState.journalEntries.push(secondClosing, secondOpening);
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(nextState));
  db.prepare(`INSERT INTO accounting_exercise_links
    (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id,cycle_number)
    VALUES(?,?,?,?,?,?,?)`).run('link-2', 'co-1', '2025-01-01', '2025-12-31', '2026-01-01', 'open-2', 2);
  const second = reopenAccountingYear(db, { companyId: 'co-1', reason: 'Segunda reapertura anual formal.' }, null);
  assert.equal(first.reversalEntries.length, 2);
  assert.equal(second.reversalEntries.length, 2);
  assert.equal(second.reopening.cycleNumber, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 2);
  db.close();
});

test('bloquea cierres antiguos sin evidencia previa', () => {
  const { db } = fixture({ withEvidence: false });
  const before = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
  assert.throws(() => reopenAccountingYear(db, { companyId: 'co-1', reason: 'Corrección del cierre anual.' }, null), /no conserva evidencia/i);
  assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, before);
  db.close();
});

test('bloquea movimientos posteriores al cierre anual', () => {
  const { db, state } = fixture();
  state.sales.push({ id: 'sale-1', companyId: 'co-1', invoiceDate: '2026-01-03' });
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, { companyId: 'co-1', reason: 'Corrección del cierre anual.' }, null), /operaciones o dependencias posteriores/i);
  db.close();
});

test('revierte toda la operación si falla la auditoría final', () => {
  const { db } = fixture();
  const before = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
  db.exec(`CREATE TRIGGER fail_annual_reopening_audit BEFORE INSERT ON audit_events
    WHEN NEW.event_type='accounting_year_reopened'
    BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;`);
  assert.throws(() => reopenAccountingYear(db, { companyId: 'co-1', reason: 'Corrección integral del cierre anual.' }, null), /audit unavailable/);
  assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, before);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 0);
  db.close();
});

test('migra vínculos antiguos y conserva su historial append-only', () => {
  const { db } = fixture();
  initializeAnnualReopeningSchema(db);
  const columns = db.prepare('PRAGMA table_info(accounting_exercise_links)').all();
  assert.ok(columns.some(column => column.name === 'cycle_number'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 1);
  assert.throws(() => db.prepare('UPDATE accounting_exercise_links SET cycle_number=2 WHERE id=?').run('link-1'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM accounting_exercise_links WHERE id=?').run('link-1'), /append-only/);
  db.close();
});
