'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { persistAccountingSnapshot } = require('./accounting-persistence.cjs');

function emptyState() {
  return {
    companies: [{ id: 'company-1', name: 'Empresa de prueba', rif: 'J-12345678-9', tradeName: 'Comercial anterior', address: 'Dirección anterior', phone: '0212-0000000', email: 'anterior@example.com' }],
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

test('company profile corrections preserve before/after values and authenticated actor in append-only audit', () => {
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
    persistAccountingSnapshot(db, prior, { id: 9, username: 'contador', role: 'contador' });
    const next = {
      ...prior,
      companies: [{
        ...prior.companies[0],
        name: 'Empresa Corregida',
        rif: 'J-98765432-1',
        tradeName: 'Comercial Corregido',
        address: 'Dirección nueva',
        phone: '0212-1111111',
        email: 'nuevo@example.com'
      }]
    };
    assert.equal(persistAccountingSnapshot(db, next, { id: 9, username: 'contador', role: 'contador' }).ok, true);
    const row = db.prepare("SELECT details_json FROM audit_events WHERE event_type='company_profile_updated'").get();
    assert.ok(row);
    const details = JSON.parse(row.details_json);
    assert.equal(details.companyId, 'company-1');
    assert.equal(details.actor.username, 'contador');
    assert.equal(details.actor.role, 'contador');
    assert.equal(details.reason, 'Rectificación de datos maestros desde Configuración');
    assert.deepEqual(details.changedFields.find(field => field.field === 'rif'), {
      field: 'rif', previousValue: 'J-12345678-9', newValue: 'J-98765432-1'
    });
    assert.ok(details.changedFields.some(field => field.field === 'name' && field.previousValue === 'Empresa de prueba' && field.newValue === 'Empresa Corregida'));
    assert.ok(details.changedFields.some(field => field.field === 'tradeName' && field.previousValue === 'Comercial anterior' && field.newValue === 'Comercial Corregido'));
    assert.ok(details.occurredAt);

    persistAccountingSnapshot(db, next, { id: 9, username: 'contador', role: 'contador' });
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='company_profile_updated'").get().count, 1);

    const savedBeforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    db.exec(`CREATE TRIGGER reject_company_profile_update BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected company profile failure'); END;`);
    const attemptedCorrection = { ...next, companies: [{ ...next.companies[0], rif: 'J-11111111-1' }] };
    assert.throws(() => persistAccountingSnapshot(db, attemptedCorrection, { id: 9, username: 'contador', role: 'contador' }), /injected company profile failure/);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, savedBeforeFailure);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='company_profile_updated'").get().count, 1);
  } finally {
    db.close();
  }
});
