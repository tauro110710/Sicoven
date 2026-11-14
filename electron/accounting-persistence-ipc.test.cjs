const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { persistAccountingSnapshot, registerAccountingPersistenceHandler } = require('./accounting-persistence.cjs');
const { initializeTenantDatabase } = require('./tenant-schema.cjs');
const { createEmptyAccountingSnapshot } = require('./tenant-snapshot.cjs');

const emptyState = () => ({
  companies: [], currentCompanyId: '', accounts: [],
  journalEntries: [], purchases: [], sales: [], products: [], movements: [],
  vatVouchers: [], islrVouchers: [], bankAccounts: [], bankStatementMovements: [],
  creditSettlements: [], displayCurrency: 'DUAL'
});

function createHarness({ authorized = true, validSession = true, role = 'admin', dbPath = ':memory:' } = {}) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE app_state (
      state_key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const calls = { license: 0, session: [] };
  registerAccountingPersistenceHandler({
    ipcMain, db,
    licenseView: () => {
      calls.license += 1;
      return { authorized, message: authorized ? '' : 'Licencia no autorizada.' };
    },
    getActiveSession: token => {
      calls.session.push(token);
      return validSession && token === 'valid-session' ? { id: 1, username: 'auditor', role } : null;
    }
  });
  return { db, handler: handlers.get('sicoven:save-state'), reopenHandler: handlers.get('sicoven:reopen-accounting-period'), reopenYearHandler: handlers.get('sicoven:reopen-accounting-year'), calls };
}

test('Electron IPC rejects persistence without an authorized license', () => {
  const harness = createHarness({ authorized: false });
  try {
    assert.throws(() => harness.handler({}, 'valid-session', emptyState()), /Licencia no autorizada/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
    assert.deepEqual(harness.calls.session, []);
  } finally {
    harness.db.close();
  }
});

test('Electron IPC rejects persistence without a valid active session', () => {
  const harness = createHarness({ validSession: false });
  try {
    assert.throws(() => harness.handler({}, 'expired-session', emptyState()), /Sesión no válida/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
    assert.deepEqual(harness.calls.session, ['expired-session']);
  } finally {
    harness.db.close();
  }
});

test('Electron IPC rejects malformed state before writing SQLite', () => {
  const harness = createHarness();
  try {
    assert.throws(() => harness.handler({}, 'valid-session', []), /Estado contable inválido/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
  } finally {
    harness.db.close();
  }
});

test('Electron IPC persists an authorized accounting snapshot through the production SQLite transaction', () => {
  const harness = createHarness();
  try {
    const result = harness.handler({}, 'valid-session', emptyState());
    assert.equal(result.ok, true);
    const saved = JSON.parse(harness.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.deepEqual(saved.companies, []);
    assert.deepEqual(saved.purchases, []);
    const audit = harness.db.prepare("SELECT event_type FROM audit_events ORDER BY id").all().map(row => row.event_type);
    assert.deepEqual(audit, ['state_saved']);
  } finally {
    harness.db.close();
  }
});

test('SQLite audit records direct supplier advance posting and its linked reversal', () => {
  const harness = createHarness();
  try {
    const accounts = [
      { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', isMovement: true },
      { code: '1.1.1.01', name: 'Caja principal', type: 'ACTIVO', isMovement: true }
    ];
    const original = {
      id: 'direct-advance-entry', companyId: 'company-1', entryNumber: 1,
      date: '2026-10-10', description: 'Anticipo directo proveedor',
      type: 'ANTICIPO_PROVEEDOR', bcvRate: 100, referenceDoc: 'ADV-AUDIT-1',
      items: [
        { accountCode: '1.1.2.03', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 },
        { accountCode: '1.1.1.01', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 }
      ], createdAt: '2026-10-10T10:00:00.000Z'
    };
    const advance = {
      id: 'direct-advance-1', companyId: 'company-1', supplierRif: 'J-12345678-9',
      supplierName: 'Proveedor', date: '2026-10-10', amountUsd: 100,
      bookValueBs: 10000, bcvRate: 100, treasuryAccountCode: '1.1.1.01',
      paymentCurrency: 'BS', paidAmount: 10000, reference: 'ADV-AUDIT-1',
      support: 'REC-AUDIT-1', journalEntryId: original.id,
      createdAt: '2026-10-10T10:00:00.000Z'
    };
    const first = {
      ...emptyState(), accounts, journalEntries: [original],
      supplierDirectAdvances: [advance], supplierAdvanceSettlements: []
    };
    persistAccountingSnapshot(harness.db, first);
    const posted = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='supplier_direct_advance_posted'").get();
    assert.ok(posted);
    const postedDetails = JSON.parse(posted.details_json);
    assert.equal(postedDetails.directAdvanceId, advance.id);
    assert.equal(postedDetails.journalEntryId, original.id);
    assert.equal(postedDetails.support, 'REC-AUDIT-1');

    const reversal = {
      id: 'direct-advance-reversal', companyId: 'company-1', entryNumber: 2,
      date: '2026-10-11', description: 'Reversión documentada del anticipo',
      type: 'AJUSTE', bcvRate: 100, referenceDoc: 'REV-1',
      reversalOfEntryId: original.id, reversalReason: 'Desembolso duplicado verificado.',
      workpaperNote: 'Se verificó el comprobante original antes de revertir.',
      items: [
        { accountCode: '1.1.2.03', debitBs: 0, creditBs: 10000, debitUsd: 0, creditUsd: 100 },
        { accountCode: '1.1.1.01', debitBs: 10000, creditBs: 0, debitUsd: 100, creditUsd: 0 }
      ], createdAt: '2026-10-11T10:00:00.000Z'
    };
    const reversed = {
      ...first,
      journalEntries: [
        { ...original, reversedByEntryId: reversal.id, isAdjusted: true },
        reversal
      ],
      supplierDirectAdvances: [{
        ...advance, isReversed: true, reversedByJournalEntryId: reversal.id
      }]
    };
    persistAccountingSnapshot(harness.db, reversed);
    const reversalAudit = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='supplier_direct_advance_reversed'").get();
    assert.ok(reversalAudit);
    assert.equal(JSON.parse(reversalAudit.details_json).reversedByJournalEntryId, reversal.id);
  } finally {
    harness.db.close();
  }
});

test('SQLite audit records an accounting year opening as a dedicated event in the same snapshot transaction', () => {
  const harness = createHarness();
  try {
    const opening = {
      id: 'opening-entry-1', companyId: 'company-1', entryNumber: 1,
      date: '2027-01-01', description: 'Asiento de apertura del ejercicio',
      type: 'APERTURA', bcvRate: 100, referenceDoc: 'APERTURA:company-1:2027-01-01',
      exerciseLink: { priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31', nextPeriodStartDate: '2027-01-01' },
      items: [
        { accountCode: '1.1.1', accountName: 'Banco', debitBs: 1000, creditBs: 0, debitUsd: 10, creditUsd: 0 },
        { accountCode: '3.1.1', accountName: 'Patrimonio', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 10 }
      ],
      createdAt: '2027-01-01T08:00:00.000Z'
    };
    const snapshot = {
      ...emptyState(),
      companies: [{ id: 'company-1', name: 'Empresa de prueba', closedThroughDate: '2026-12-31' }],
      accounts: [
        { code: '1.1.1', name: 'Banco', type: 'ACTIVO', isMovement: true },
        { code: '3.1.1', name: 'Patrimonio', type: 'PATRIMONIO', isMovement: true }
      ],
      journalEntries: [opening]
    };
    const saved = harness.handler({}, 'valid-session', snapshot);
    assert.equal(saved.ok, true);
    const event = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='accounting_year_opening_posted'").get();
    assert.ok(event);
    const details = JSON.parse(event.details_json);
    assert.equal(details.entryId, opening.id);
    assert.equal(details.companyId, opening.companyId);
    assert.equal(details.openingDate, opening.date);
    assert.equal(details.referenceDoc, opening.referenceDoc);
    assert.deepEqual(details.actor, { userId: 1, username: 'auditor' });
    const types = harness.db.prepare("SELECT event_type FROM audit_events ORDER BY id").all().map(row => row.event_type);
    assert.deepEqual(types, ['accounting_exercise_opening_linked', 'journal_entry_posted', 'accounting_year_opening_posted', 'accounting_period_closed', 'state_saved']);
    const link = harness.db.prepare('SELECT * FROM accounting_exercise_links').get();
    assert.equal(link.company_id, 'company-1');
    assert.equal(link.prior_period_start_date, '2026-01-01');
    assert.equal(link.prior_period_end_date, '2026-12-31');
    assert.equal(link.next_period_start_date, '2027-01-01');
    assert.equal(link.journal_entry_id, opening.id);
    assert.throws(() => harness.db.prepare("UPDATE accounting_exercise_links SET prior_period_end_date='2026-11-30'").run(), /append-only/);
    assert.throws(() => harness.db.prepare('DELETE FROM accounting_exercise_links').run(), /append-only/);
  } finally {
    harness.db.close();
  }
});


function closedCompanyState() {
  return {
    ...emptyState(),
    companies: [
      { id: 'company-1', name: 'Empresa Uno', closedThroughDate: '2026-12-31' },
      { id: 'company-2', name: 'Empresa Dos', closedThroughDate: '2026-06-30' }
    ],
    journalEntries: [{
      id: 'historical-entry', companyId: 'company-1', entryNumber: 1,
      date: '2026-05-15', description: 'Asiento histórico preservado',
      type: 'AJUSTE', items: [
        { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ]
    }]
  };
}

function persistClosedCompanyFixture(db) {
  const state = closedCompanyState();
  const openState = {
    ...state,
    companies: state.companies.map(({ closedThroughDate, ...company }) => company)
  };
  persistAccountingSnapshot(db, openState);
  persistAccountingSnapshot(db, state);
}

test('annual reopening IPC requires authorization and executes the complete SQLite cycle', () => {
  const deniedLicense = createHarness({ authorized: false });
  try {
    assert.throws(() => deniedLicense.reopenYearHandler({}, 'valid-session', {
      companyId: 'company-1', reason: 'Reapertura formal del ejercicio.'
    }), /Licencia no autorizada/);
  } finally { deniedLicense.db.close(); }

  const expired = createHarness({ validSession: false });
  try {
    assert.throws(() => expired.reopenYearHandler({}, 'expired-session', {
      companyId: 'company-1', reason: 'Reapertura formal del ejercicio.'
    }), /Sesión no válida/);
  } finally { expired.db.close(); }

  const operator = createHarness({ role: 'operator' });
  try {
    assert.throws(() => operator.reopenYearHandler({}, 'valid-session', {
      companyId: 'company-1', reason: 'Reapertura formal del ejercicio.'
    }), /Permiso insuficiente/);
  } finally { operator.db.close(); }

  const harness = createHarness();
  try {
    const state = {
      ...emptyState(),
      companies: [{ id: 'company-1', name: 'Empresa anual', fiscalYear: 2027, closedThroughDate: '2026-12-31' }],
      journalEntries: [
        {
          id: 'year-close-ipc', companyId: 'company-1', entryNumber: 10,
          date: '2026-12-31', createdAt: '2026-12-31T10:00:00.000Z',
          description: 'Cierre anual 2026', type: 'CIERRE', bcvRate: 100,
          referenceDoc: 'CIERRE:company-1:2026-12-31',
          workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
          annualCloseState: { previousFiscalYear: 2026, previousClosedThroughDate: '2025-12-31', cycleNumber: 1 },
          items: [
            { accountCode: '4.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
            { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
          ]
        },
        {
          id: 'year-open-ipc', companyId: 'company-1', entryNumber: 11,
          date: '2027-01-01', createdAt: '2026-12-31T10:00:00.000Z',
          description: 'Apertura 2027', type: 'APERTURA', bcvRate: 100,
          referenceDoc: 'APERTURA:company-1:2027-01-01',
          exerciseLink: {
            priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31',
            nextPeriodStartDate: '2027-01-01', cycleNumber: 1
          },
          items: [
            { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
            { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
          ]
        }
      ]
    };
    harness.db.prepare('INSERT INTO app_state(state_key,state_json) VALUES(?,?)')
      .run('accounting', JSON.stringify(state));
    harness.db.prepare(`INSERT INTO accounting_exercise_links
      (id,company_id,prior_period_start_date,prior_period_end_date,next_period_start_date,journal_entry_id,cycle_number)
      VALUES(?,?,?,?,?,?,?)`).run('year-link-ipc', 'company-1', '2026-01-01', '2026-12-31',
      '2027-01-01', 'year-open-ipc', 1);
    const result = harness.reopenYearHandler({}, 'valid-session', {
      companyId: 'company-1', reason: 'Reapertura formal para corregir el ejercicio.'
    });
    assert.equal(result.ok, true);
    assert.equal(result.reversalEntries.length, 2);
    assert.equal(result.company.fiscalYear, 2026);
    assert.equal(result.company.closedThroughDate, '2025-12-31');
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_year_reopened'").get().count, 1);
  } finally { harness.db.close(); }
});

test('period reopening IPC permits both full-access roles and rejects unknown roles', () => {
  const unauthorized = createHarness({ validSession: false });
  try {
    persistClosedCompanyFixture(unauthorized.db);
    assert.throws(() => unauthorized.reopenHandler({}, 'expired-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-09-30', reason: 'Corrección documentada del período.'
    }), /Sesión no válida/);
    assert.equal(JSON.parse(unauthorized.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json)
      .companies[0].closedThroughDate, '2026-12-31');
  } finally { unauthorized.db.close(); }

  const nonAdminDb = new Database(':memory:');
  nonAdminDb.exec(`
    CREATE TABLE app_state (state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE audit_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT (datetime('now')));
  `);
  const handlers = new Map();
  let actor = { id: 3, username: 'operator', role: 'operator' };
  registerAccountingPersistenceHandler({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: nonAdminDb, licenseView: () => ({ authorized: true }),
    getActiveSession: () => actor
  });
  try {
    persistClosedCompanyFixture(nonAdminDb);
    const request = { companyId: 'company-1', reopenedThroughDate: '2026-09-30', reason: 'Corrección documentada del período.' };
    assert.throws(() => handlers.get('sicoven:reopen-accounting-period')({}, 'valid', request), /rol contable/);
    actor = { id: 4, username: 'contador', role: 'contador' };
    const result = handlers.get('sicoven:reopen-accounting-period')({}, 'valid', request);
    assert.equal(result.ok, true);
    assert.equal(JSON.parse(nonAdminDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json)
      .companies[0].closedThroughDate, '2026-09-30');
  } finally { nonAdminDb.close(); }
});

test('period reopening requires a reason and an effective earlier date', () => {
  const harness = createHarness();
  try {
    persistClosedCompanyFixture(harness.db);
    assert.throws(() => harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-12-31', reason: 'Reapertura válida por ajuste.'
    }), /anterior al cierre vigente/);
    assert.throws(() => harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-09-30', reason: 'corto'
    }), /motivo de reapertura es obligatorio/);
    assert.throws(() => harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-02-30', reason: 'Corrección documentada del período.'
    }), /no existe en el calendario/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM period_reopenings').get().count, 0);
  } finally { harness.db.close(); }
});

test('period reopening is transactional, company-scoped, audited and preserves closure and accounting history', () => {
  const harness = createHarness();
  try {
    persistClosedCompanyFixture(harness.db);
    const result = harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-09-30',
      reason: 'Se detectó un documento omitido; soporte de auditoría REF-2026-09.'
    });
    assert.equal(result.ok, true);
    assert.equal(result.company.closedThroughDate, '2026-09-30');
    const saved = JSON.parse(harness.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.companies.find(item => item.id === 'company-1').closedThroughDate, '2026-09-30');
    assert.equal(saved.companies.find(item => item.id === 'company-2').closedThroughDate, '2026-06-30');
    assert.equal(saved.journalEntries[0].id, 'historical-entry');
    const closureHistory = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='accounting_period_closed'").get();
    assert.ok(closureHistory);
    assert.equal(JSON.parse(closureHistory.details_json).closedThroughDate, '2026-12-31');
    const reopening = harness.db.prepare('SELECT * FROM period_reopenings').get();
    assert.equal(reopening.company_id, 'company-1');
    assert.equal(reopening.previous_closed_through_date, '2026-12-31');
    assert.equal(reopening.reopened_through_date, '2026-09-30');
    assert.equal(reopening.actor_user_id, 1);
    assert.equal(reopening.actor_username, 'auditor');
    const event = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='accounting_period_reopened'").get();
    assert.ok(event);
    assert.equal(JSON.parse(event.details_json).reason, 'Se detectó un documento omitido; soporte de auditoría REF-2026-09.');
    assert.throws(() => harness.db.prepare("UPDATE period_reopenings SET reason='alterado' WHERE id=?").run(reopening.id), /append-only/);
    assert.throws(() => harness.db.prepare("DELETE FROM period_reopenings WHERE id=?").run(reopening.id), /append-only/);
    assert.throws(() => harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: '2026-09-30',
      reason: 'Segundo intento duplicado que no debe producir otro evento.'
    }), /anterior al cierre vigente/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM period_reopenings').get().count, 1);
  } finally { harness.db.close(); }
});

test('full period reopening clears only the active boundary and retains its immutable closure record', () => {
  const harness = createHarness();
  try {
    persistClosedCompanyFixture(harness.db);
    const result = harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: null,
      reason: 'Reapertura integral autorizada para corregir el ejercicio completo.'
    });
    assert.equal(result.ok, true);
    assert.equal(result.company.closedThroughDate, undefined);
    const saved = JSON.parse(harness.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.companies.find(item => item.id === 'company-1').closedThroughDate, undefined);
    assert.equal(saved.companies.find(item => item.id === 'company-2').closedThroughDate, '2026-06-30');
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM period_reopenings').get().count, 1);
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_period_closed'").get().count, 2);
  } finally { harness.db.close(); }
});

test('SQLite rejects a linked opening whose prior exercise is not closed through the exact end date', () => {
  const harness = createHarness();
  try {
    const opening = {
      id: 'opening-invalid', companyId: 'company-1', entryNumber: 1,
      date: '2027-01-01', description: 'Apertura no vinculable',
      type: 'APERTURA', bcvRate: 100, referenceDoc: 'APERTURA:company-1:2027-01-01',
      exerciseLink: { priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31', nextPeriodStartDate: '2027-01-01' },
      items: [
        { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ]
    };
    const snapshot = { ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa Uno', closedThroughDate: '2026-11-30' }], journalEntries: [opening] };
    assert.throws(() => harness.handler({}, 'valid-session', snapshot), /debe permanecer cerrado hasta su fecha final/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 0);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 0);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
  } finally { harness.db.close(); }
});

test('SQLite rejects duplicate exercise openings atomically but allows the same dates for another company', () => {
  const harness = createHarness();
  try {
    const opening = {
      id: 'opening-company-1', companyId: 'company-1', entryNumber: 1,
      date: '2027-01-01', description: 'Apertura ejercicio 2027',
      type: 'APERTURA', bcvRate: 100, referenceDoc: 'APERTURA:company-1:2027-01-01',
      exerciseLink: { priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31', nextPeriodStartDate: '2027-01-01' },
      items: [
        { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ]
    };
    const base = {
      ...emptyState(),
      companies: [
        { id: 'company-1', name: 'Empresa Uno', closedThroughDate: '2026-12-31' },
        { id: 'company-2', name: 'Empresa Dos', closedThroughDate: '2026-12-31' }
      ],
      journalEntries: [opening]
    };
    harness.handler({}, 'valid-session', base);
    const duplicate = { ...opening, id: 'opening-company-1-duplicate', entryNumber: 2 };
    assert.throws(() => harness.handler({}, 'valid-session', { ...base, journalEntries: [opening, duplicate] }), /duplicarla/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 1);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM audit_events WHERE event_type=\'accounting_exercise_opening_linked\'').get().count, 1);
    const otherCompany = {
      ...opening, id: 'opening-company-2', companyId: 'company-2',
      referenceDoc: 'APERTURA:company-2:2027-01-01'
    };
    harness.handler({}, 'valid-session', { ...base, journalEntries: [opening, otherCompany] });
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 2);
  } finally { harness.db.close(); }
});

test('a reopened and reclosed exercise can be opened once with a durable link to its prior period', () => {
  const harness = createHarness();
  try {
    persistClosedCompanyFixture(harness.db);
    harness.reopenHandler({}, 'valid-session', {
      companyId: 'company-1', reopenedThroughDate: null,
      reason: 'Reapertura integral autorizada para corregir el ejercicio completo.'
    });
    let state = JSON.parse(harness.db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    state = {
      ...state,
      companies: state.companies.map(company => company.id === 'company-1'
        ? { ...company, closedThroughDate: '2026-12-31' } : company)
    };
    harness.handler({}, 'valid-session', state);
    const opening = {
      id: 'opening-after-reclose', companyId: 'company-1', entryNumber: 2,
      date: '2027-01-01', description: 'Apertura posterior a reapertura autorizada',
      type: 'APERTURA', bcvRate: 100, referenceDoc: 'APERTURA:company-1:2027-01-01',
      exerciseLink: { priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31', nextPeriodStartDate: '2027-01-01' },
      items: [
        { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ]
    };
    state = {
      ...state,
      accounts: [
        { code: '1.1.1', name: 'Banco', type: 'ACTIVO', isMovement: true },
        { code: '3.1.1', name: 'Patrimonio', type: 'PATRIMONIO', isMovement: true }
      ],
      journalEntries: [...state.journalEntries, opening]
    };
    harness.handler({}, 'valid-session', state);
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_period_closed'").get().count, 3);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM period_reopenings').get().count, 1);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 1);
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_exercise_opening_linked'").get().count, 1);
  } finally { harness.db.close(); }
});

test('SQLite does not duplicate an opening that predates the exercise-link migration', () => {
  const harness = createHarness();
  try {
    const legacy = {
      id: 'legacy-opening', companyId: 'company-1', entryNumber: 1,
      date: '2027-01-01', description: 'Apertura histórica anterior al vínculo',
      type: 'APERTURA', bcvRate: 100, referenceDoc: 'APERTURA-LEGACY',
      items: [
        { accountCode: '1.1.1', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '3.1.1', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ]
    };
    const base = {
      ...emptyState(),
      companies: [{ id: 'company-1', name: 'Empresa Uno', closedThroughDate: '2026-12-31' }],
      journalEntries: [legacy]
    };
    harness.handler({}, 'valid-session', base);
    const linked = {
      ...legacy, id: 'linked-opening', entryNumber: 2,
      referenceDoc: 'APERTURA:company-1:2027-01-01',
      exerciseLink: { priorPeriodStartDate: '2026-01-01', priorPeriodEndDate: '2026-12-31', nextPeriodStartDate: '2027-01-01' }
    };
    assert.throws(() => harness.handler({}, 'valid-session', { ...base, journalEntries: [legacy, linked] }), /duplicarla/);
    assert.equal(harness.db.prepare('SELECT COUNT(*) AS count FROM accounting_exercise_links').get().count, 0);
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_exercise_opening_linked'").get().count, 0);
  } finally { harness.db.close(); }
});


test('SQLite restores a paid IVA declaration, journal and reconciled bank evidence after database restart', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-iva-restart-'));
  const dbPath = path.join(tempDir, 'sicoven.sqlite');
  const harness = createHarness({ dbPath });
  try {
    const voucher = {
      id: 'vat-audit-1', companyId: 'company-1', voucherNumber: '20261000000001',
      date: '2026-10-03', period: '202610', fiscalDate: '2026-10-03',
      supplierRif: 'J-12345678-9', supplierName: 'Proveedor Uno',
      taxableBaseBs: 1000, vatAmountBs: 160, vatWithheldBs: 120,
      requiresFiscalCorrection: false
    };
    const declaration = {
      id: 'vat-decl-audit-1', companyId: 'company-1', period: '202610',
      window: 'FIRST_HALF', startDate: '2026-10-01', endDate: '2026-10-15',
      zeroOperations: false, voucherIds: [voucher.id],
      voucherSnapshots: [{
        voucherId: voucher.id, voucherNumber: voucher.voucherNumber,
        supplierRif: voucher.supplierRif, supplierName: voucher.supplierName,
        fiscalDate: voucher.fiscalDate, dateBasis: 'FISCAL_EVENT',
        taxableBaseBs: 1000, vatAmountBs: 160, vatWithheldBs: 120,
        requiresFiscalCorrection: false
      }],
      totalTaxableBaseBs: 1000, totalVatAmountBs: 160, totalWithheldBs: 120,
      createdAt: '2026-10-16T10:00:00.000Z'
    };
    const initial = {
      ...emptyState(),
      companies: [{ id: 'company-1', name: 'Empresa Uno' }],
      vatVouchers: [voucher],
      vatWithholdingDeclarations: [declaration],
      vatWithholdingDeclarationEvents: []
    };
    persistAccountingSnapshot(harness.db, initial, { id: 1, username: 'auditor' });
    let types = harness.db.prepare("SELECT event_type FROM audit_events ORDER BY id").all().map(row => row.event_type);
    assert.deepEqual(types, ['vat_retention_voucher_issued', 'vat_withholding_declaration_prepared', 'state_saved']);

    const reviewed = {
      id: 'vat-event-audit-1', declarationId: declaration.id, eventType: 'REVIEWED',
      occurredAt: '2026-10-16', recordedAt: '2026-10-16T11:00:00.000Z',
      actor: 'auditor'
    };
    persistAccountingSnapshot(harness.db, {
      ...initial, vatWithholdingDeclarationEvents: [reviewed]
    }, { id: 1, username: 'auditor' });
    types = harness.db.prepare("SELECT event_type FROM audit_events ORDER BY id").all().map(row => row.event_type);
    assert.deepEqual(types, [
      'vat_retention_voucher_issued', 'vat_withholding_declaration_prepared', 'state_saved',
      'vat_withholding_declaration_event', 'state_saved'
    ]);
    const eventAudit = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='vat_withholding_declaration_event'").get();
    const details = JSON.parse(eventAudit.details_json);
    assert.equal(details.declarationId, declaration.id);
    assert.equal(details.eventType, 'REVIEWED');
    assert.deepEqual(details.actor, { userId: 1, username: 'auditor' });

    const filed = {
      id: 'vat-event-audit-filed', declarationId: declaration.id, eventType: 'FILED',
      occurredAt: '2026-10-17', recordedAt: '2026-10-17T11:00:00.000Z',
      declarationNumber: 'DECL-IVA-1', receiptReference: 'ACK-IVA-1'
    };
    const payment = {
      id: 'vat-event-audit-payment', declarationId: declaration.id, eventType: 'PAYMENT',
      occurredAt: '2026-10-18', recordedAt: '2026-10-18T12:00:00.000Z',
      amountBs: 120, amountUsd: 1.2, paymentReference: 'SENIAT-REF-1',
      bankStatementMovementIds: ['bank-debit-1'], journalEntryId: 'vat-payment-journal-1'
    };
    const paymentJournal = {
      id: 'vat-payment-journal-1', companyId: 'company-1', entryNumber: 2,
      date: '2026-10-18', description: 'Enteramiento IVA', type: 'RETENCION_IVA',
      bcvRate: 100, referenceDoc: 'IVA-ENTERAMIENTO:' + declaration.id + ':SENIAT-REF-1',
      items: [
        { accountCode: '2.1.2.03', accountName: 'Retenciones IVA por enterar', debitBs: 120, creditBs: 0, debitUsd: 1.2, creditUsd: 0 },
        { accountCode: '1.1.1.03', accountName: 'Banco Bs.', debitBs: 0, creditBs: 120, debitUsd: 0, creditUsd: 1.2 }
      ], createdAt: '2026-10-18T12:00:00.000Z'
    };
    const bankAccount = {
      id: 'bank-account-1', companyId: 'company-1', accountCode: '1.1.1.03',
      bankName: 'Banco Uno', accountNumber: '001', currency: 'BS',
      initialBalanceBs: 0, initialBalanceUsd: 0
    };
    const bankMovement = {
      id: 'bank-debit-1', companyId: 'company-1', bankAccountId: bankAccount.id,
      date: '2026-10-18', reference: 'SENIAT-REF-1', description: 'Enteramiento IVA',
      type: 'DEBIT', amountBs: 120, amountUsd: 1.2, isReconciled: true,
      reconciledWithJournalEntryId: paymentJournal.id,
      reconciledJournalEntryIds: [paymentJournal.id]
    };
    persistAccountingSnapshot(harness.db, {
      ...initial,
      accounts: [
        { code: '2.1.2.03', name: 'Retenciones IVA por enterar', type: 'PASIVO', level: 4, isMovement: true },
        { code: '1.1.1.03', name: 'Banco Bs.', type: 'ACTIVO', level: 4, isMovement: true }
      ],
      journalEntries: [paymentJournal],
      bankAccounts: [bankAccount],
      bankStatementMovements: [bankMovement],
      vatWithholdingDeclarationEvents: [reviewed, filed, payment]
    }, { id: 1, username: 'auditor' });
    const paymentAudit = harness.db.prepare(
      "SELECT details_json FROM audit_events WHERE event_type='vat_withholding_declaration_event' ORDER BY id DESC LIMIT 1"
    ).get();
    const paymentDetails = JSON.parse(paymentAudit.details_json);
    assert.equal(paymentDetails.journalEntryId, 'vat-payment-journal-1');
    assert.equal(paymentDetails.amountBs, 120);
    assert.equal(paymentDetails.amountUsd, 1.2);
    assert.deepEqual(paymentDetails.bankStatementMovementIds, ['bank-debit-1']);

    // Simulate closing SICOVEN and opening the same on-disk SQLite database again.
    harness.db.close();
    const reopenedDb = new Database(dbPath);
    try {
      const restored = JSON.parse(reopenedDb.prepare(
        "SELECT state_json FROM app_state WHERE state_key='accounting'"
      ).get().state_json);
      assert.equal(restored.vatWithholdingDeclarationEvents.find(event => event.id === payment.id).journalEntryId, paymentJournal.id);
      assert.equal(restored.journalEntries.find(entry => entry.id === paymentJournal.id).type, 'RETENCION_IVA');
      const restoredMovement = restored.bankStatementMovements.find(item => item.id === 'bank-debit-1');
      assert.equal(restoredMovement.isReconciled, true);
      assert.equal(restoredMovement.reconciledWithJournalEntryId, paymentJournal.id);
      assert.deepEqual(restoredMovement.reconciledJournalEntryIds, [paymentJournal.id]);
      const restoredAudit = reopenedDb.prepare(
        "SELECT details_json FROM audit_events WHERE event_type='vat_withholding_declaration_event' ORDER BY id DESC LIMIT 1"
      ).get();
      const restoredDetails = JSON.parse(restoredAudit.details_json);
      assert.equal(restoredDetails.journalEntryId, paymentJournal.id);
      assert.equal(restoredDetails.amountUsd, 1.2);
      assert.deepEqual(restoredDetails.bankStatementMovementIds, ['bank-debit-1']);
    } finally {
      reopenedDb.close();
    }
  } finally {
    try { harness.db.close(); } catch {}
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});


test('SQLite audit records the VAT retention decision and the later voucher delivery automatically', () => {
  const harness = createHarness();
  try {
    const actor = { id: 1, username: 'auditor', role: 'admin' };
    const purchase = {
      id: 'purchase-iva-audit', companyId: 'company-1', documentType: '01', journalEntryId: 'purchase-journal',
      invoiceNumber: 'FAC-IVA-1', supplierRif: 'J-12345678-9', supplierName: 'Proveedor Uno',
      invoiceDate: '2026-10-03', accountCreditDate: '2026-10-03',
      controlNumber: '00-IVA-1', taxableBaseBs: 1000, exemptAmountBs: 0, taxRate: 16,
      vatAmountBs: 160, vatWithheldBs: 120, retentionRate: 75, islrWithheldBs: 0,
      igtfAmountBs: 0, totalAmountBs: 1160, bcvRate: 1,
      totalAmountUsd: 1160, taxableBaseUsd: 1000, vatAmountUsd: 160,
      vatWithheldUsd: 120, islrWithheldUsd: 0, igtfAmountUsd: 0,
      paymentTerm: 'CREDITO',
      ivaRetentionDecision: {
        buyerAgentStatus: 'SPECIAL_DESIGNATED', supplierTaxStatus: 'ORDINARY',
        article2Transaction: false, article3Exclusions: [],
        decisionStatus: 'WITHHOLD', decisionReason: 'Regla general del 75%.',
        legalBasis: 'Providencia SNAT/2025/000054, artículo 4',
        operationAmountBs: 1160, unitTaxValueBs: 43,
        evaluatedAt: '2026-10-03T10:00:00.000Z'
      }
    };
    const voucher = {
      id: 'vat-iva-audit', companyId: 'company-1', purchaseRecordId: purchase.id,
      voucherNumber: '20261000000001', date: '2026-10-03', period: '202610',
      fiscalDate: '2026-10-03', agentNameSnapshot: 'Empresa al emitir',
      agentRifSnapshot: 'J-12345678-9', agentAddressSnapshot: 'Caracas', supplierRif: purchase.supplierRif,
      supplierName: purchase.supplierName, taxableBaseBs: 1000,
      vatAmountBs: 160, vatWithheldBs: 120, requiresFiscalCorrection: false
    };
    const originalJournal = {
      id: 'purchase-journal', companyId: 'company-1', entryNumber: 1,
      date: '2026-10-03', description: 'Compra original', type: 'COMPRA',
      bcvRate: 1, referenceDoc: 'FAC-FAC-IVA-1',
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 1000, creditBs: 0, debitUsd: 1000, creditUsd: 0 },
        { accountCode: '1.1.3.01', accountName: 'IVA Crédito Fiscal', debitBs: 160, creditBs: 0, debitUsd: 160, creditUsd: 0 },
        { accountCode: '2.1.2.03', accountName: 'Retención IVA por enterar', debitBs: 0, creditBs: 120, debitUsd: 0, creditUsd: 120 },
        { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 0, creditBs: 1040, debitUsd: 0, creditUsd: 1040 }
      ], createdAt: '2026-10-03T10:00:00.000Z'
    };
    const initial = {
      ...emptyState(), companies: [{ id: 'company-1', name: 'Empresa Uno' }],
      journalEntries: [originalJournal], purchases: [purchase], vatVouchers: [voucher]
    };
    persistAccountingSnapshot(harness.db, initial, actor);
    const issued = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='vat_retention_voucher_issued'").get();
    assert.ok(issued);
    const issuedDetails = JSON.parse(issued.details_json);
    assert.equal(issuedDetails.purchaseRecordId, purchase.id);
    assert.equal(issuedDetails.voucherNumber, voucher.voucherNumber);
    assert.equal(issuedDetails.agentName, 'Empresa al emitir');
    assert.equal(issuedDetails.agentRif, 'J-12345678-9');
    const decision = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='purchase_iva_retention_decision_recorded'").get();
    assert.ok(decision);
    const decisionDetails = JSON.parse(decision.details_json);
    assert.equal(decisionDetails.purchaseId, purchase.id);
    assert.equal(decisionDetails.decisionStatus, 'WITHHOLD');
    assert.equal(decisionDetails.unitTaxValueBs, 43);
    assert.deepEqual(decisionDetails.actor, { userId: 1, username: 'auditor' });

    const delivered = {
      ...initial,
      vatVouchers: [{ ...voucher, deliveryDate: '2026-10-04', deliveryMethod: 'PHYSICAL' }]
    };
    persistAccountingSnapshot(harness.db, delivered, actor);
    const delivery = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='vat_retention_voucher_delivered'").get();
    assert.ok(delivery);
    const deliveryDetails = JSON.parse(delivery.details_json);
    assert.equal(deliveryDetails.voucherId, voucher.id);
    assert.equal(deliveryDetails.deliveryDate, '2026-10-04');
    assert.equal(deliveryDetails.deliveryMethod, 'PHYSICAL');
    assert.deepEqual(deliveryDetails.actor, { userId: 1, username: 'auditor' });
    assert.equal(harness.db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='vat_retention_voucher_delivered'").get().count, 1);

    const reversal = {
      id: 'journal-credit-note-1', companyId: 'company-1', entryNumber: 2,
      date: '2026-10-04', description: 'Contra-asiento por corrección fiscal',
      type: 'AJUSTE', bcvRate: 1, referenceDoc: 'REV-1',
      reversalOfEntryId: 'purchase-journal',
      reversalReason: 'Factura original anulada por error documentado.',
      workpaperNote: 'Se revisó la factura y el soporte de la reversión.',
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario', debitBs: 0, creditBs: 1000, debitUsd: 0, creditUsd: 1000 },
        { accountCode: '1.1.3.01', accountName: 'IVA Crédito Fiscal', debitBs: 0, creditBs: 160, debitUsd: 0, creditUsd: 160 },
        { accountCode: '2.1.2.03', accountName: 'Retención IVA por enterar', debitBs: 120, creditBs: 0, debitUsd: 120, creditUsd: 0 },
        { accountCode: '2.1.1.01', accountName: 'CxP', debitBs: 1040, creditBs: 0, debitUsd: 1040, creditUsd: 0 }
      ], createdAt: '2026-10-04T10:00:00.000Z'
    };
    const corrected = {
      ...delivered,
      journalEntries: [{ ...originalJournal, reversedByEntryId: reversal.id, isAdjusted: true }, reversal],
      purchases: [{ ...purchase, isCancelled: true, cancelledByJournalEntryId: reversal.id,
        cancellationReason: 'Factura original anulada por error documentado.',
        cancellationNote: 'Se verificó el documento y se emitió el contra-asiento.' }],
      vatVouchers: [{ ...delivered.vatVouchers[0], requiresFiscalCorrection: true,
        correctionEntryIds: [reversal.id], correctionEntryId: reversal.id,
        correctionNote: 'Reversión de factura requiere conciliación fiscal.' }]
    };
    persistAccountingSnapshot(harness.db, corrected, actor);
    const correction = harness.db.prepare("SELECT details_json FROM audit_events WHERE event_type='vat_retention_voucher_correction_required'").get();
    assert.ok(correction);
    const correctionDetails = JSON.parse(correction.details_json);
    assert.equal(correctionDetails.voucherId, voucher.id);
    assert.deepEqual(correctionDetails.correctionEntryIds, ['journal-credit-note-1']);
    assert.equal(correctionDetails.correctionNote, 'Reversión de factura requiere conciliación fiscal.');
    assert.deepEqual(correctionDetails.actor, { userId: 1, username: 'auditor' });
  } finally {
    harness.db.close();
  }
});

test('SQLite rolls back all audit and state writes when an IVA event fails integrity validation', () => {
  const harness = createHarness();
  try {
    const baseline = emptyState();
    persistAccountingSnapshot(harness.db, baseline, { id: 1, username: 'auditor' });
    const beforeState = harness.db.prepare(
      "SELECT state_json FROM app_state WHERE state_key='accounting'"
    ).get().state_json;
    const beforeAudit = harness.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;

    const invalidSnapshot = {
      ...baseline,
      vatVouchers: [{
        id: 'voucher-atomicity-invalid', companyId: 'company-1',
        voucherNumber: '20261100000001', date: '2026-11-02',
        period: '202611', fiscalDate: '2026-11-02',
        supplierRif: 'J-12345678-9', supplierName: 'Proveedor de prueba',
        taxableBaseBs: 1000, vatAmountBs: 160, vatWithheldBs: 120
      }],
      vatWithholdingDeclarationEvents: [{
        id: 'orphan-review-event', declarationId: 'declaration-does-not-exist',
        eventType: 'REVIEWED', occurredAt: '2026-11-02',
        recordedAt: '2026-11-02T12:00:00.000Z'
      }]
    };

    assert.throws(
      () => persistAccountingSnapshot(harness.db, invalidSnapshot, { id: 1, username: 'auditor' }),
      /declaración|declaracion|SQLite rechazó/i
    );
    const afterState = harness.db.prepare(
      "SELECT state_json FROM app_state WHERE state_key='accounting'"
    ).get().state_json;
    const afterAudit = harness.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count;
    assert.equal(afterState, beforeState, 'SQLite debe conservar íntegro el último estado válido.');
    assert.equal(afterAudit, beforeAudit, 'No debe quedar ningún evento de auditoría parcial.');
    const persisted = JSON.parse(afterState);
    assert.equal((persisted.vatVouchers || []).some(item => item.id === 'voucher-atomicity-invalid'), false);
  } finally {
    harness.db.close();
  }
});


test('tenant-routed persistence writes only to the selected company database', async () => {
  const controlDb = new Database(':memory:');
  const tenantDb = new Database(':memory:');
  initializeTenantDatabase(tenantDb);
  const handlers = new Map();
  registerAccountingPersistenceHandler({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: controlDb,
    licenseView: () => ({ authorized: true }),
    getActiveSession: () => ({ id: 1, username: 'contador', role: 'contador' }),
    withDatabase: async (token, operation) => {
      assert.equal(token, 'valid-session');
      return operation(tenantDb, 'company-a');
    }
  });
  try {
    const state = createEmptyAccountingSnapshot();
    state.companies = [{ id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' }];
    state.currentCompanyId = 'company-a';
    const result = await handlers.get('sicoven:save-state')({}, 'valid-session', state);
    assert.equal(result.ok, true);
    const saved = JSON.parse(tenantDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.companies[0].id, 'company-a');
    assert.equal(controlDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='app_state'").get().count, 0);
  } finally {
    tenantDb.close();
    controlDb.close();
  }
});

test('tenant-routed persistence rejects snapshots containing more than the selected company', async () => {
  const controlDb = new Database(':memory:');
  const tenantDb = new Database(':memory:');
  initializeTenantDatabase(tenantDb);
  const handlers = new Map();
  registerAccountingPersistenceHandler({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    db: controlDb,
    licenseView: () => ({ authorized: true }),
    getActiveSession: () => ({ id: 1, username: 'contador', role: 'contador' }),
    withDatabase: async (_token, operation) => operation(tenantDb, 'company-a')
  });
  try {
    const state = createEmptyAccountingSnapshot();
    state.companies = [
      { id: 'company-a', name: 'Empresa A', rif: 'J-12345678-9' },
      { id: 'company-b', name: 'Empresa B', rif: 'J-98765432-1' }
    ];
    state.currentCompanyId = 'company-a';
    await assert.rejects(
      handlers.get('sicoven:save-state')({}, 'valid-session', state),
      /no pertenece exclusivamente a la empresa activa/
    );
    assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM app_state').get().count, 0);
  } finally {
    tenantDb.close();
    controlDb.close();
  }
});
