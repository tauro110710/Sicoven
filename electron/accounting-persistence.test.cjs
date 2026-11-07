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


test('bank statement import batch persists together and leaves no imported rows after SQLite rollback', () => {
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
    prior.bankAccounts = [{
      id: 'bank-1', companyId: 'company-1', bankName: 'Banco de prueba',
      accountNumber: '00000000000000000001', currency: 'BS', accountCode: '1.1.1.01'
    }];
    persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' });
    const importedRows = [
      { id: 'stmt-1', companyId: 'company-1', bankAccountId: 'bank-1', date: '2026-11-05', reference: 'EXT-001', description: 'Depósito', type: 'CREDIT', amountBs: 100, amountUsd: 10, bcvRate: 10, bcvRateEffectiveDate: '2026-11-05', isReconciled: false },
      { id: 'stmt-2', companyId: 'company-1', bankAccountId: 'bank-1', date: '2026-11-05', reference: 'EXT-002', description: 'Comisión', type: 'DEBIT', amountBs: 5, amountUsd: 0.5, bcvRate: 10, bcvRateEffectiveDate: '2026-11-05', isReconciled: false }
    ];
    const next = { ...prior, bankStatementMovements: importedRows };
    assert.equal(persistAccountingSnapshot(db, next, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    let saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.deepEqual(saved.bankStatementMovements.map(row => row.id), ['stmt-1', 'stmt-2']);
    const importEvents = db.prepare("SELECT details_json FROM audit_events WHERE event_type='bank_statement_imported' ORDER BY id").all();
    assert.equal(importEvents.length, 2);
    assert.deepEqual(importEvents.map(event => JSON.parse(event.details_json).statementMovementId), ['stmt-1', 'stmt-2']);
    assert.equal(JSON.parse(importEvents[0].details_json).actor.username, 'admin');

    const beforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    db.exec(`CREATE TRIGGER reject_bank_import_update BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected bank import failure'); END;`);
    const attempted = { ...next, bankStatementMovements: [...importedRows,
      { ...importedRows[0], id: 'stmt-3', reference: 'EXT-003' }] };
    assert.throws(() => persistAccountingSnapshot(db, attempted, { id: 1, username: 'admin', role: 'admin' }), /injected bank import failure/);
    saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeFailure);
    assert.deepEqual(saved.bankStatementMovements.map(row => row.id), ['stmt-1', 'stmt-2']);
    assert.equal(saved.bankStatementMovements.some(row => row.id === 'stmt-3'), false);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type='bank_statement_imported'").get().count, 2);
  } finally {
    db.close();
  }
});


test('POSVEN-style inventory opening persists product, Kardex and balanced opening entry atomically', () => {
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
    prior.accounts.push(
      { code: '1.1.4.01', name: 'Inventario de mercancías', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '5.1.1.01', name: 'Costo de ventas', type: 'COSTOS', level: 4, isMovement: true },
      { code: '5.1.2.01', name: 'Ajustes de inventario', type: 'GASTOS', level: 4, isMovement: true },
      { code: '3.3.1.01', name: 'Aportes de apertura', type: 'PATRIMONIO', level: 4, isMovement: true }
    );
    persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' });

    const product = {
      id: 'prod-import-1', companyId: 'company-1', code: 'SKU-1', name: 'Artículo de prueba',
      currentStock: 2, avgCostBs: 100, avgCostUsd: 10, lastCostBs: 100, lastCostUsd: 10,
      inventoryAccountCode: '1.1.4.01', costOfSalesAccountCode: '5.1.1.01',
      adjustmentAccountCode: '5.1.2.01', openingBalanceAccountCode: '3.3.1.01',
      costingMethod: 'PROMEDIO_PONDERADO', vatTreatment: 'GENERAL_16',
      itemType: 'MERCANCIA', unit: 'Unidad', openingDate: '2026-11-04', openingBcvRate: 10
    };
    const entry = {
      id: 'entry-inventory-opening-1', companyId: 'company-1', entryNumber: 1,
      date: '2026-11-04', description: 'Asiento de apertura de inventario · SKU-1',
      type: 'APERTURA', bcvRate: 10, referenceDoc: 'APERTURA-SKU-1',
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario de mercancías', debitBs: 200, creditBs: 0, debitUsd: 20, creditUsd: 0 },
        { accountCode: '3.3.1.01', accountName: 'Aportes de apertura', debitBs: 0, creditBs: 200, debitUsd: 0, creditUsd: 20 }
      ],
      createdAt: '2026-11-04T10:00:00.000Z'
    };
    const movement = {
      id: 'mov-opening-1', companyId: 'company-1', productId: product.id,
      productName: product.name, productCode: product.code, date: '2026-11-04',
      type: 'ENTRADA', concept: 'INVENTARIO_INICIAL', documentRef: 'APERTURA-SKU-1',
      quantity: 2, unitCostBs: 100, unitCostUsd: 10, totalCostBs: 200, totalCostUsd: 20,
      balanceQty: 2, balanceTotalBs: 200, balanceTotalUsd: 20,
      bcvRate: 10, costingMethod: 'PROMEDIO_PONDERADO', journalEntryId: entry.id
    };
    const imported = {
      ...prior, products: [product], movements: [movement], journalEntries: [entry]
    };
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const readState = () => JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    let saved = readState();
    assert.deepEqual(saved.products.map(row => row.code), ['SKU-1']);
    assert.deepEqual(saved.movements.map(row => row.id), ['mov-opening-1']);
    assert.deepEqual(saved.journalEntries.map(row => row.id), ['entry-inventory-opening-1']);
    const auditTypes = db.prepare('SELECT event_type FROM audit_events ORDER BY id').all().map(row => row.event_type);
    assert.ok(auditTypes.includes('inventory_movement_posted'));
    assert.ok(auditTypes.includes('journal_entry_posted'));
    assert.ok(auditTypes.includes('accounting_year_opening_posted'));

    const beforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const beforeAuditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    db.exec(`CREATE TRIGGER reject_inventory_opening BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected inventory opening failure'); END;`);
    const secondProduct = { ...product, id: 'prod-import-2', code: 'SKU-2' };
    const secondEntry = {
      ...entry, id: 'entry-inventory-opening-2', entryNumber: 2,
      description: 'Asiento de apertura de inventario · SKU-2', referenceDoc: 'APERTURA-SKU-2'
    };
    const secondMovement = {
      ...movement, id: 'mov-opening-2', productId: secondProduct.id, productCode: secondProduct.code,
      journalEntryId: secondEntry.id, documentRef: secondEntry.referenceDoc
    };
    const attempted = {
      ...imported,
      products: [...imported.products, secondProduct],
      movements: [...imported.movements, secondMovement],
      journalEntries: [...imported.journalEntries, secondEntry]
    };
    assert.throws(() => persistAccountingSnapshot(db, attempted, { id: 1, username: 'admin', role: 'admin' }), /injected inventory opening failure/);
    saved = readState();
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeFailure);
    assert.deepEqual(saved.products.map(row => row.code), ['SKU-1']);
    assert.deepEqual(saved.movements.map(row => row.id), ['mov-opening-1']);
    assert.deepEqual(saved.journalEntries.map(row => row.id), ['entry-inventory-opening-1']);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, beforeAuditCount);
  } finally {
    db.close();
  }
});
