'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { inspectLegacyDatabase } = require('./tenant-migration-preflight.cjs');

function createLegacyDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE audit_events(id INTEGER PRIMARY KEY,event_type TEXT NOT NULL,details_json TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,username TEXT NOT NULL);
    CREATE TABLE auth_sessions(token_hash TEXT PRIMARY KEY,user_id INTEGER);
    CREATE TABLE license_state(id INTEGER PRIMARY KEY,status TEXT);
    CREATE TABLE company_database_registry(company_id TEXT PRIMARY KEY);
    CREATE TABLE operation_receipts(operation_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, operation_type TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL);
  `);
  const { REQUIRED_RELATIONAL_TABLES } = require('./tenant-migration-preflight.cjs');
  for (const table of REQUIRED_RELATIONAL_TABLES) db.exec("CREATE TABLE \"" + table + "\" (id TEXT PRIMARY KEY)");
  db.prepare('INSERT INTO app_state VALUES(?,?,?)').run('accounting', JSON.stringify({
    companies: [
      { id: 'company-a', rif: 'J-12345678-9', name: 'Empresa A' },
      { id: 'company-b', rif: 'J-98765432-1', name: 'Empresa B' }
    ]
  }), '2026-11-08');
  return db;
}

test('accepts a fully classified legacy database and returns exact company IDs', () => {
  const db = createLegacyDb();
  try {
    const result = inspectLegacyDatabase(db);
    assert.equal(result.ok, true);
    assert.deepEqual(result.companyIds, ['company-a', 'company-b']);
    assert.deepEqual(result.unknownTables, []);
    assert.deepEqual(result.errors, []);
  } finally { db.close(); }
});

test('blocks migration when any persistent table is not explicitly classified', () => {
  const db = createLegacyDb();
  try {
    db.exec('CREATE TABLE unexpected_finance_cache(id TEXT PRIMARY KEY)');
    const result = inspectLegacyDatabase(db);
    assert.equal(result.ok, false);
    assert.deepEqual(result.unknownTables, ['unexpected_finance_cache']);
    assert.match(result.errors.join(' '), /sin clasificación explícita/);
  } finally { db.close(); }
});


test('blocks migration when a required relational table is missing', () => {
  const db = createLegacyDb();
  try {
    db.exec('DROP TABLE vat_fiscal_incident_events');
    const result = inspectLegacyDatabase(db);
    assert.equal(result.ok, false);
    assert.ok(result.missingRequired.includes('vat_fiscal_incident_events'));
    assert.match(result.errors.join(' '), /Faltan tablas esperadas/);
  } finally { db.close(); }
});

test('blocks malformed, missing, or ambiguous accounting snapshots', () => {
  const db = createLegacyDb();
  try {
    db.prepare("UPDATE app_state SET state_json='{' WHERE state_key='accounting'").run();
    assert.equal(inspectLegacyDatabase(db).ok, false);
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify({ companies: [] }));
    assert.match(inspectLegacyDatabase(db).errors.join(' '), /No hay empresas/);
    db.prepare("DELETE FROM app_state WHERE state_key='accounting'").run();
    assert.match(inspectLegacyDatabase(db).errors.join(' '), /exactamente un snapshot/);
  } finally { db.close(); }
});

test('rejects duplicate company IDs and duplicate RIF values before staging', () => {
  const db = createLegacyDb();
  try {
    db.prepare("UPDATE app_state SET state_json=? WHERE state_key='accounting'").run(JSON.stringify({
      companies: [
        { id: 'company-a', rif: 'J-12345678-9' },
        { id: 'company-a', rif: 'J-12345678-9' }
      ]
    }));
    const result = inspectLegacyDatabase(db);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /identificadores.*duplicados/);
    assert.match(result.errors.join(' '), /RIF.*duplicados/);
  } finally { db.close(); }
});


test('accepts a valid legacy database created before optional idempotency receipts existed', () => {
  const db = createLegacyDb();
  try {
    db.exec('DROP TABLE operation_receipts');
    const result = inspectLegacyDatabase(db);
    assert.equal(result.ok, true);
    assert.deepEqual(result.unknownTables, []);
    assert.deepEqual(result.errors, []);
  } finally { db.close(); }
});
