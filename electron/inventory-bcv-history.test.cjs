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

function createDb() {
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
  return db;
}

test('inventory BCV daily history is append-only and audited atomically', () => {
  const db = createDb();
  try {
    const prior = emptyState();
    persistAccountingSnapshot(db, prior, { id: 9, username: 'contador', role: 'admin' });
    const rateEntry = {
      id: 'inventory-bcv-2026-11-06-automatic-20261106140000',
      rate: 890.25,
      effectiveDate: '2026-11-06',
      fetchedAt: '2026-11-06T14:00:00.000Z',
      source: 'https://bcv.today/api/rate.json',
      provider: 'bcv.today',
      mode: 'AUTOMATIC'
    };
    const next = {
      ...prior,
      companies: [{ ...prior.companies[0],
        inventoryBcvRate: 890.25,
        inventoryBcvRateEffectiveDate: '2026-11-06',
        inventoryBcvRateFetchedAt: rateEntry.fetchedAt,
        inventoryBcvRateHistory: [rateEntry]
      }]
    };
    assert.equal(persistAccountingSnapshot(db, next, { id: 9, username: 'contador', role: 'admin' }).ok, true);
    const event = db.prepare("SELECT details_json FROM audit_events WHERE event_type='inventory_bcv_rate_recorded'").get();
    assert.ok(event);
    const details = JSON.parse(event.details_json);
    assert.equal(details.rate, 890.25);
    assert.equal(details.effectiveDate, '2026-11-06');
    assert.equal(details.provider, 'bcv.today');
    assert.equal(details.actor.username, 'contador');

    const manualCorrection = {
      id: 'inventory-bcv-2026-11-06-manual-20261106150000',
      rate: 891.5,
      effectiveDate: '2026-11-06',
      fetchedAt: '2026-11-06T15:00:00.000Z',
      source: 'Registro manual en SICOVEN de escritorio',
      provider: 'manual',
      mode: 'MANUAL',
      note: 'Tasa verificada durante interrupción de internet',
      correctionOfId: rateEntry.id
    };
    const corrected = {
      ...next,
      companies: [{ ...next.companies[0],
        inventoryBcvRate: manualCorrection.rate,
        inventoryBcvRateFetchedAt: manualCorrection.fetchedAt,
        inventoryBcvRateHistory: [rateEntry, manualCorrection]
      }]
    };
    assert.equal(persistAccountingSnapshot(db, corrected, { id: 9, username: 'contador', role: 'admin' }).ok, true);
    const manualEvent = db.prepare("SELECT details_json FROM audit_events WHERE event_type='inventory_bcv_rate_recorded' ORDER BY id DESC LIMIT 1").get();
    const manualDetails = JSON.parse(manualEvent.details_json);
    assert.equal(manualDetails.mode, 'MANUAL');
    assert.equal(manualDetails.provider, 'manual');
    assert.equal(manualDetails.note, manualCorrection.note);
    assert.equal(manualDetails.correctionOfId, rateEntry.id);
    assert.equal(manualDetails.actor.username, 'contador');
    const persisted = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(persisted.companies[0].inventoryBcvRateHistory.length, 2);
    assert.equal(persisted.companies[0].inventoryBcvRate, 891.5);

    const before = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const tampered = { ...corrected, companies: [{ ...corrected.companies[0], inventoryBcvRateHistory: [{ ...rateEntry, rate: 999 }, manualCorrection] }] };
    assert.throws(() => persistAccountingSnapshot(db, tampered, { id: 9, username: 'contador', role: 'admin' }), /historial diario.*inmutable/i);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, before);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE event_type='inventory_bcv_rate_recorded'").get().n, 2);
  } finally { db.close(); }
});

test('inventory BCV history rejects duplicate automatic dates and malformed timestamps', () => {
  const db = createDb();
  try {
    const prior = emptyState();
    const baseEntry = {
      id: 'auto-1', rate: 890, effectiveDate: '2026-11-06',
      fetchedAt: '2026-11-06T14:00:00.000Z',
      source: 'https://bcv.today/api/rate.json', provider: 'bcv.today', mode: 'AUTOMATIC'
    };
    const saved = { ...prior, companies: [{ ...prior.companies[0], inventoryBcvRateHistory: [baseEntry] }] };
    persistAccountingSnapshot(db, saved, { id: 1, username: 'admin', role: 'admin' });
    const duplicate = { ...baseEntry, id: 'auto-2', fetchedAt: '2026-11-06T15:00:00.000Z' };
    assert.throws(() => persistAccountingSnapshot(db, {
      ...saved, companies: [{ ...saved.companies[0], inventoryBcvRateHistory: [baseEntry, duplicate] }]
    }, { id: 1, username: 'admin', role: 'admin' }), /dos registros automáticos para la misma fecha/i);
    const malformed = { ...baseEntry, id: 'auto-3', effectiveDate: '2026-11-07', fetchedAt: 'not-a-date' };
    assert.throws(() => persistAccountingSnapshot(db, {
      ...saved, companies: [{ ...saved.companies[0], inventoryBcvRateHistory: [baseEntry, malformed] }]
    }, { id: 1, username: 'admin', role: 'admin' }), /datos inválidos/i);
  } finally { db.close(); }
});
