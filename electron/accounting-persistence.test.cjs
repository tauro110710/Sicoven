'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');

function emptyState() {
  return {
    companies: [{ id: 'company-1', name: 'Empresa de prueba', rif: 'J-12345678-9' }],
    currentCompanyId: 'company-1',
    accounts: [
      { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', level: 4, isMovement: true }
    ],
    journalEntries: [], purchases: [], sales: [], products: [], movements: [],
    vatVouchers: [], vatWithholdingDeclarations: [], vatWithholdingDeclarationEvents: [],
    islrVouchers: [], bankAccounts: [], bankStatementMovements: [],
    creditSettlements: [], supplierAdvanceSettlements: [], supplierDirectAdvances: [],
    islrFiscalEvents: [], financialDisclosures: [], displayCurrency: 'DUAL'
  };
}

test('accounting snapshot and its audit events commit or roll back as one SQLite transaction', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state (
      state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      details_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    const prior = emptyState();
    assert.equal(persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    const beforeState = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const beforeAuditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    db.exec(`CREATE TRIGGER reject_snapshot_update BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected snapshot failure'); END;`);
    const entry = {
      id: 'entry-1', companyId: 'company-1', entryNumber: 1,
      date: '2026-10-01', description: 'Asiento de prueba', type: 'MANUAL',
      bcvRate: 100, referenceDoc: 'TEST-1',
      items: [
        { accountCode: '1.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
        { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
      ],
      createdAt: '2026-10-01T10:00:00.000Z'
    };
    assert.throws(() => persistAccountingSnapshot(db, {
      ...prior, journalEntries: [entry]
    }, { id: 1, username: 'admin', role: 'admin' }), /injected snapshot failure/);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeState);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, beforeAuditCount);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='journal_entry_posted'").get().n, 0);
  } finally {
    db.close();
  }
});

test('BCV rate corrections retain prior/new rate, effective date and authenticated actor', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state (
      state_key TEXT PRIMARY KEY, state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      details_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    const prior = emptyState();
    prior.companies[0].bcvRate = 100;
    prior.companies[0].lastRateUpdate = '2026-10-01';
    persistAccountingSnapshot(db, prior, { id: 7, username: 'contador', role: 'admin' });
    const next = {
      ...prior,
      companies: [{ ...prior.companies[0], bcvRate: 110, lastRateUpdate: '2026-10-02' }]
    };
    persistAccountingSnapshot(db, next, { id: 7, username: 'contador', role: 'admin' });
    const event = db.prepare("SELECT details_json FROM audit_events WHERE event_type='company_bcv_rate_updated'").get();
    assert.ok(event);
    const details = JSON.parse(event.details_json);
    assert.equal(details.previousRate, 100);
    assert.equal(details.newRate, 110);
    assert.equal(details.effectiveDate, '2026-10-02');
    assert.equal(details.actor.username, 'contador');
  } finally {
    db.close();
  }
});
