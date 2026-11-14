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
    id: 'close-1', companyId: 'co-1', entryNumber: 20, date: '2025-12-31', createdAt: '2025-12-31T10:00:00.000Z',
    description: 'Cierre 2025', type: 'CIERRE', bcvRate: 50,
    referenceDoc: 'CIERRE:co-1:2025-12-31', workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    ...(withEvidence ? { annualCloseState: { previousFiscalYear: 2025, previousClosedThroughDate: '2024-12-31', cycleNumber: 1 } } : {}),
    items: [
      { accountCode: '4.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const opening = {
    id: 'open-1', companyId: 'co-1', entryNumber: 21, date: '2026-01-01', createdAt: '2025-12-31T10:00:00.000Z',
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
    id: 'close-2', companyId: 'co-1', entryNumber: 24, date: '2025-12-31', createdAt: '2026-01-05T10:00:00.000Z',
    description: 'Segundo cierre 2025', type: 'CIERRE', bcvRate: 50,
    referenceDoc: 'CIERRE:co-1:2025-12-31', workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    annualCloseState: { previousFiscalYear: 2025, previousClosedThroughDate: '2024-12-31', cycleNumber: 2 },
    items: [
      { accountCode: '4.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const secondOpening = {
    id: 'open-2', companyId: 'co-1', entryNumber: 25, date: '2026-01-01', createdAt: '2026-01-05T10:00:00.000Z',
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

  const thirdState = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
  const thirdClosing = {
    id: 'close-3', companyId: 'co-1', entryNumber: 26, date: '2025-12-31', createdAt: '2026-01-06T10:00:00.000Z',
    description: 'Tercer cierre 2025', type: 'CIERRE', bcvRate: 51,
    referenceDoc: 'CIERRE:co-1:2025-12-31', workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    annualCloseState: { previousFiscalYear: 2025, previousClosedThroughDate: '2024-12-31', cycleNumber: 3 },
    items: [
      { accountCode: '4.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  const thirdOpening = {
    id: 'open-3', companyId: 'co-1', entryNumber: 27, date: '2026-01-01', createdAt: '2026-01-06T10:00:00.000Z',
    description: 'Tercera apertura 2026', type: 'APERTURA', bcvRate: 51,
    referenceDoc: 'APERTURA:co-1:2026-01-01',
    exerciseLink: { priorPeriodStartDate: '2025-01-01', priorPeriodEndDate: '2025-12-31', nextPeriodStartDate: '2026-01-01', cycleNumber: 3 },
    items: [
      { accountCode: '1.1', debitBs: 100, creditBs: 0, debitUsd: 2, creditUsd: 0 },
      { accountCode: '3.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 2 }
    ]
  };
  thirdState.companies[0].fiscalYear = 2026;
  thirdState.companies[0].closedThroughDate = '2025-12-31';
  thirdState.journalEntries.push(thirdClosing, thirdOpening);
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(thirdState));
  db.prepare(`INSERT INTO accounting_exercise_links
    (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id,cycle_number)
    VALUES(?,?,?,?,?,?,?)`).run('link-3', 'co-1', '2025-01-01', '2025-12-31', '2026-01-01', 'open-3', 3);
  const third = reopenAccountingYear(db, { companyId: 'co-1', reason: 'Tercera reapertura anual formal.' }, null);
  assert.equal(third.reopening.cycleNumber, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 3);
  const afterThird = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
  assert.throws(() => reopenAccountingYear(db, { companyId: 'co-1', reason: 'Reintento de reapertura anual.' }, null), /cierre anual vigente/i);
  assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, afterThird);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 3);
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

test('bloquea documentos retroactivos creados después del asiento de cierre', () => {
  const { db, state } = fixture();
  state.sales.push({
    id: 'sale-backdated', companyId: 'co-1',
    invoiceDate: '2025-12-20', createdAt: '2026-01-03T10:00:00.000Z'
  });
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Corrección del cierre anual.'
  }, null), /operaciones o dependencias posteriores/i);
  db.close();
});

test('bloquea activos fijos registrados después del cierre aunque no tengan asiento nuevo', () => {
  const { db, state } = fixture();
  state.fixedAssets = [{
    id: 'asset-after-close', companyId: 'co-1',
    acquisitionDate: '2025-12-10', createdAt: '2026-01-03T10:00:00.000Z',
    depreciationEvents: []
  }];
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Corrección del cierre anual.'
  }, null), /activos fijos o depreciaciones/i);
  db.close();
});

test('bloquea presentación o pago de IVA propio posterior al cierre', () => {
  const { db, state } = fixture();
  state.vatOwnDeclarations = [{
    id: 'vat-own-1', companyId: 'co-1', period: '2025-12',
    status: 'FILED', createdAt: '2025-12-31T09:00:00.000Z',
    filedAt: '2026-01-04T10:00:00.000Z'
  }];
  state.vatOwnDeclarationEvents = [{
    id: 'vat-own-event-1', declarationId: 'vat-own-1', companyId: 'co-1',
    eventType: 'PAYMENT', occurredAt: '2026-01-05T10:00:00.000Z',
    recordedAt: '2026-01-05T10:01:00.000Z'
  }];
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Corrección del cierre anual.'
  }, null), /declaración de IVA propio presentada/i);
  db.close();
});

test('bloquea eventos de pago de IVA propio posteriores aunque la presentación sea anterior al cierre', () => {
  const { db, state } = fixture();
  state.vatOwnDeclarations = [{
    id: 'vat-own-2', companyId: 'co-1', period: '2025-12',
    status: 'FILED', createdAt: '2025-12-30T09:00:00.000Z',
    filedAt: '2025-12-31T09:00:00.000Z'
  }];
  state.vatOwnDeclarationEvents = [{
    id: 'vat-own-event-2', declarationId: 'vat-own-2', companyId: 'co-1',
    eventType: 'PAYMENT', occurredAt: '2026-01-05T10:00:00.000Z',
    recordedAt: '2026-01-05T10:01:00.000Z'
  }];
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Corrección del cierre anual.'
  }, null), /eventos de presentación, pago o reversión de IVA propio/i);
  db.close();
});



test('bloquea notas financieras del ejercicio modificadas después del cierre', () => {
  const { db, state } = fixture();
  state.financialDisclosures = [{
    id: 'disclosure-1', companyId: 'co-1', fiscalYear: 2025,
    createdAt: '2025-12-30T10:00:00.000Z',
    updatedAt: '2026-01-04T10:00:00.000Z'
  }];
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify(state));
  assert.throws(() => reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Corrección del cierre anual.'
  }, null), /notas a los estados financieros/i);
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
  initializeAnnualReopeningSchema(db);
  const columns = db.prepare('PRAGMA table_info(accounting_exercise_links)').all();
  assert.ok(columns.some(column => column.name === 'cycle_number'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 1);
  assert.equal(db.prepare('SELECT cycle_number FROM accounting_exercise_links WHERE id=?').get('link-1').cycle_number, 1);
  assert.throws(() => db.prepare('UPDATE accounting_exercise_links SET cycle_number=2 WHERE id=?').run('link-1'), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM accounting_exercise_links WHERE id=?').run('link-1'), /append-only/);
  db.close();
});

test('no bloquea la reapertura por actividad de otra empresa ni por borradores de IVA propio', () => {
  const { db, state } = fixture();
  state.companies.push({
    id: 'co-2', name: 'Empresa distinta', fiscalYear: 2026,
    closedThroughDate: '2025-12-31'
  });
  state.sales.push({
    id: 'sale-other-company', companyId: 'co-2',
    invoiceDate: '2026-01-10', createdAt: '2026-01-10T10:00:00.000Z'
  });
  state.vatOwnDeclarations = [{
    id: 'vat-own-draft', companyId: 'co-1', period: '2025-12',
    status: 'DRAFT', createdAt: '2026-01-10T10:00:00.000Z'
  }];
  db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'")
    .run(JSON.stringify(state));

  const result = reopenAccountingYear(db, {
    companyId: 'co-1', reason: 'Reapertura por corrección profesional.'
  }, null);

  assert.equal(result.ok, true);
  assert.equal(result.company.fiscalYear, 2025);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounting_year_reopenings').get().count, 1);
  db.close();
});
