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
    vatOwnDeclarations: [], vatOwnDeclarationEvents: [],
    islrVouchers: [], bankAccounts: [], bankStatementMovements: [],
    creditSettlements: [], supplierAdvanceSettlements: [], supplierDirectAdvances: [],
    islrFiscalEvents: [], financialDisclosures: [], displayCurrency: 'DUAL'
  };
}


test('SQLite persists IVA own-account filing atomically and refuses later mutation of its filed history', () => {
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
    prior.companies[0].bcvRate = 874;
    prior.companies[0].accountingBcvRateHistory = [
      { id: 'bcv-oct', rate: 874, effectiveDate: '2026-10-01', recordedAt: '2026-10-01T08:00:00.000Z' },
      { id: 'bcv-nov', rate: 874, effectiveDate: '2026-11-01', recordedAt: '2026-11-01T08:00:00.000Z' }
    ];
    prior.accounts.push(
      { code: '2.1.2.01', name: 'IVA débito', type: 'PASIVO', level: 4, isMovement: true },
      { code: '2.1.2.09', name: 'IVA por enterar', type: 'PASIVO', level: 4, isMovement: true }
    );
    persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' });
    const position = {
      outputVatBs: 100, outputVat16Bs: 100, outputVat8Bs: 0,
      purchaseCreditBs: 0, purchaseCredit16Bs: 0, purchaseCredit8Bs: 0,
      purchaseCreditGrossBs: 0, purchaseCreditGross16Bs: 0, purchaseCreditGross8Bs: 0,
      purchaseCreditNonEligibleBs: 0, purchaseCreditReversalBs: 0,
      purchaseCreditReversal16Bs: 0, purchaseCreditReversal8Bs: 0,
      purchaseCreditReversalNonEligibleBs: 0, purchaseCreditReversalNonEligible16Bs: 0,
      purchaseCreditReversalNonEligible8Bs: 0, prorationRate: 1,
      taxableSalesBaseBs: 625, exemptSalesBaseBs: 0, receivedWithholdingsBs: 0,
      priorCreditAppliedBs: 0, debitAdjustmentsBs: 0, creditAdjustmentsBs: 0,
      creditAdjustments16Bs: 0, creditAdjustments8Bs: 0,
      netTaxBs: 100, amountDueBs: 100, creditCarryForwardBs: 0
    };
    const draft = {
      id: 'vat-own-atomic', companyId: 'company-1', period: '2026-10', status: 'DRAFT',
      position, sourceIds: [], relatedSourceIds: [], sourceSnapshots: {}, bcvRate: 874,
      dailySourceChoices: {}, purchaseVatReclassificationItems: [],
      createdAt: '2026-11-11T10:00:00.000Z'
    };
    const withDraft = { ...prior, vatOwnDeclarations: [draft] };
    persistAccountingSnapshot(db, withDraft, { id: 1, username: 'admin', role: 'admin' });

    const journal = {
      id: 'entry-iva-atomic', companyId: 'company-1', entryNumber: 1,
      date: '2026-11-11', description: 'Determinación mensual del IVA',
      type: 'AJUSTE', bcvRate: 874, referenceDoc: 'IVA-MENSUAL:2026-10',
      items: [
        { accountCode: '2.1.2.01', accountName: 'IVA débito', debitBs: 100, creditBs: 0, debitUsd: 100 / 874, creditUsd: 0 },
        { accountCode: '2.1.2.09', accountName: 'IVA por enterar', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 100 / 874 }
      ], createdAt: '2026-11-11T16:00:00.000Z'
    };
    const filedAt = '2026-11-11T12:00:00.000-04:00';
    const filed = {
      ...draft, status: 'FILED', declarationNumber: 'IVA-2026-001', filedAt
    };
    const event = {
      id: 'vat-own-event-atomic', declarationId: draft.id, companyId: draft.companyId,
      eventType: 'FILED', occurredAt: filedAt, recordedAt: '2026-11-11T16:00:00.000Z',
      declarationNumber: filed.declarationNumber, idempotencyKey: 'FILED:' + draft.id,
      journalEntryId: journal.id
    };
    const finalState = {
      ...withDraft, vatOwnDeclarations: [filed],
      vatOwnDeclarationEvents: [event], journalEntries: [journal]
    };
    assert.equal(persistAccountingSnapshot(db, finalState, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    const committed = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    assert.equal(JSON.parse(committed).vatOwnDeclarations[0].status, 'FILED');
    assert.equal(JSON.parse(committed).vatOwnDeclarationEvents.length, 1);

    assert.throws(() => persistAccountingSnapshot(db, {
      ...finalState,
      vatOwnDeclarations: [{ ...filed, declarationNumber: 'ALTERADA' }]
    }, { id: 1, username: 'admin', role: 'admin' }), /declaración IVA ya presentada/);
    assert.throws(() => persistAccountingSnapshot(db, {
      ...finalState, vatOwnDeclarationEvents: []
    }, { id: 1, username: 'admin', role: 'admin' }), /eliminación del registro histórico en vatOwnDeclarationEvents/);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, committed);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, auditCount);
  } finally {
    db.close();
  }
});

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


test('una compra universal con líneas concilia factura, asiento y entradas de Kardex en una sola transacción SQLite', () => {
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
      { code: '1.1.3.01', name: 'Crédito Fiscal IVA', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '2.1.1.01', name: 'Cuentas por pagar proveedores', type: 'PASIVO', level: 4, isMovement: true }
    );
    persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' });

    const product = {
      id: 'prod-purchase-import-1', companyId: 'company-1', code: 'SKU-PUR-1',
      name: 'Mercancía de prueba', currentStock: 1, avgCostBs: 100, avgCostUsd: 10,
      lastCostBs: 100, lastCostUsd: 10, inventoryAccountCode: '1.1.4.01',
      costOfSalesAccountCode: '5.1.1.01', adjustmentAccountCode: '5.1.2.01',
      costingMethod: 'PROMEDIO_PONDERADO', vatTreatment: 'GENERAL_16',
      itemType: 'MERCANCIA', unit: 'Unidad'
    };
    const purchase = {
      id: 'purchase-import-1', companyId: 'company-1', opNumber: 1,
      documentType: '01', invoiceNumber: 'INV-IMPORT-001', controlNumber: 'CTRL-001',
      invoiceDate: '2026-11-05', accountCreditDate: '2026-11-05',
      supplierRif: 'J-12345678-9', supplierName: 'Proveedor de prueba',
      paymentTerm: 'CREDITO', bcvRate: 10,
      totalAmountBs: 116, taxableBaseBs: 100, exemptAmountBs: 0,
      taxRate: 16, vatAmountBs: 16, vatWithheldBs: 0, islrWithheldBs: 0,
      igtfAmountBs: 0, totalAmountUsd: 11.6, taxableBaseUsd: 10,
      vatAmountUsd: 1.6, vatWithheldUsd: 0, islrWithheldUsd: 0,
      igtfAmountUsd: 0, inventoryLines: [
        { productId: product.id, quantity: 1, unitCostBs: 100 }
      ], journalEntryId: 'entry-purchase-import-1'
    };
    const entry = {
      id: purchase.journalEntryId, companyId: 'company-1', entryNumber: 1,
      date: purchase.accountCreditDate,
      description: 'Compra universal INV-IMPORT-001', type: 'COMPRA',
      bcvRate: 10, referenceDoc: 'FAC-INV-IMPORT-001',
      items: [
        { accountCode: '1.1.4.01', accountName: 'Inventario de mercancías', debitBs: 100, creditBs: 0, debitUsd: 10, creditUsd: 0 },
        { accountCode: '1.1.3.01', accountName: 'Crédito Fiscal IVA', debitBs: 16, creditBs: 0, debitUsd: 1.6, creditUsd: 0 },
        { accountCode: '2.1.1.01', accountName: 'Cuentas por pagar proveedores', debitBs: 0, creditBs: 116, debitUsd: 0, creditUsd: 11.6 }
      ], createdAt: '2026-11-05T10:00:00.000Z'
    };
    const movement = {
      id: 'movement-purchase-import-1', companyId: 'company-1',
      productId: product.id, productName: product.name, productCode: product.code,
      date: purchase.invoiceDate, type: 'ENTRADA', concept: 'COMPRA',
      documentRef: 'FAC-INV-IMPORT-001', quantity: 1, unitCostBs: 100,
      unitCostUsd: 10, totalCostBs: 100, totalCostUsd: 10,
      balanceQty: 1, balanceTotalBs: 100, balanceTotalUsd: 10,
      bcvRate: 10, costingMethod: 'PROMEDIO_PONDERADO',
      counterpartyRif: purchase.supplierRif, counterpartyName: purchase.supplierName
    };
    const imported = {
      ...prior, purchases: [purchase], products: [product],
      movements: [movement], journalEntries: [entry]
    };
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.purchases[0].invoiceNumber, 'INV-IMPORT-001');
    assert.equal(saved.products[0].currentStock, 1);
    assert.equal(saved.movements[0].documentRef, 'FAC-INV-IMPORT-001');
    assert.equal(saved.journalEntries[0].type, 'COMPRA');
    const totals = saved.journalEntries[0].items.reduce((sum, item) => ({
      debitBs: sum.debitBs + item.debitBs, creditBs: sum.creditBs + item.creditBs,
      debitUsd: sum.debitUsd + item.debitUsd, creditUsd: sum.creditUsd + item.creditUsd
    }), { debitBs: 0, creditBs: 0, debitUsd: 0, creditUsd: 0 });
    assert.equal(totals.debitBs, totals.creditBs);
    assert.equal(totals.debitUsd, totals.creditUsd);

    const beforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const beforeAudit = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    db.exec(`CREATE TRIGGER reject_purchase_import BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected purchase import failure'); END;`);
    assert.throws(() => persistAccountingSnapshot(db, {
      ...imported, displayCurrency: 'USD'
    }, { id: 1, username: 'admin', role: 'admin' }), /injected purchase import failure/);
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeFailure);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, beforeAudit);
  } finally {
    db.close();
  }
});


test('una venta universal con líneas requiere salidas de Kardex y asientos de costo vinculados en SQLite', () => {
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
      { code: '1.1.2.01', name: 'Cuentas por cobrar clientes', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '1.1.4.01', name: 'Inventario de mercancías', type: 'ACTIVO', level: 4, isMovement: true },
      { code: '2.1.2.01', name: 'IVA débito fiscal', type: 'PASIVO', level: 4, isMovement: true },
      { code: '5.1.1.01', name: 'Costo de ventas', type: 'COSTOS', level: 4, isMovement: true }
    );
    const product = {
      id: 'prod-sale-import-1', companyId: 'company-1', code: 'SKU-SALE-1',
      name: 'Mercancía vendida', currentStock: 5, avgCostBs: 50, avgCostUsd: 5,
      lastCostBs: 50, lastCostUsd: 5, inventoryAccountCode: '1.1.4.01',
      costOfSalesAccountCode: '5.1.1.01', costingMethod: 'PROMEDIO_PONDERADO',
      vatTreatment: 'GENERAL_16', itemType: 'MERCANCIA', unit: 'Unidad'
    };
    prior.products = [product];
    persistAccountingSnapshot(db, prior, { id: 1, username: 'admin', role: 'admin' });

    const sale = {
      id: 'sale-import-1', companyId: 'company-1', opNumber: 1,
      documentType: '01', invoiceNumber: 'SALE-IMPORT-001', controlNumber: 'CTRL-SALE-001',
      invoiceDate: '2026-11-06', customerRif: 'J-12345678-9',
      customerName: 'Cliente de prueba', paymentTerm: 'CREDITO',
      bcvRate: 10, totalAmountBs: 116, taxableBaseBs: 100,
      exemptAmountBs: 0, taxRate: 16, vatAmountBs: 16, vatWithheldBs: 0,
      igtfAmountBs: 0, totalAmountUsd: 11.6, taxableBaseUsd: 10,
      vatAmountUsd: 1.6, vatWithheldUsd: 0, igtfAmountUsd: 0,
      journalEntryId: 'entry-sale-invoice-1',
      inventoryLines: [{
        productId: product.id, productCode: product.code, productName: product.name,
        quantity: 1, unitPriceBs: 100, unitPriceUsd: 10,
        netAmountBs: 100, taxRate: 16, vatAmountBs: 16,
        exemptAmountBs: 0, totalBs: 116
      }]
    };
    const saleEntry = {
      id: sale.journalEntryId, companyId: 'company-1', entryNumber: 1,
      date: sale.invoiceDate, description: 'Venta universal SALE-IMPORT-001',
      type: 'VENTA', bcvRate: 10, referenceDoc: 'FAC-SALE-IMPORT-001',
      items: [
        { accountCode: '1.1.2.01', debitBs: 116, creditBs: 0, debitUsd: 11.6, creditUsd: 0 },
        { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 10 },
        { accountCode: '2.1.2.01', debitBs: 0, creditBs: 16, debitUsd: 0, creditUsd: 1.6 }
      ], createdAt: '2026-11-06T10:00:00.000Z'
    };
    const costEntry = {
      id: 'entry-sale-cost-1', companyId: 'company-1', entryNumber: 2,
      date: sale.invoiceDate, description: 'Costo de venta SKU-SALE-1',
      type: 'INVENTARIO', bcvRate: 10, referenceDoc: 'FAC-SALE-IMPORT-001',
      items: [
        { accountCode: '5.1.1.01', debitBs: 50, creditBs: 0, debitUsd: 5, creditUsd: 0 },
        { accountCode: '1.1.4.01', debitBs: 0, creditBs: 50, debitUsd: 0, creditUsd: 5 }
      ], createdAt: '2026-11-06T10:00:01.000Z'
    };
    const movement = {
      id: 'movement-sale-import-1', companyId: 'company-1',
      productId: product.id, productName: product.name, productCode: product.code,
      date: sale.invoiceDate, type: 'SALIDA', concept: 'VENTA',
      documentRef: 'FAC-SALE-IMPORT-001', quantity: 1,
      unitCostBs: 50, unitCostUsd: 5, totalCostBs: 50, totalCostUsd: 5,
      balanceQty: 4, balanceTotalBs: 200, balanceTotalUsd: 20,
      bcvRate: 10, costingMethod: 'PROMEDIO_PONDERADO',
      counterpartyRif: sale.customerRif, counterpartyName: sale.customerName,
      journalEntryId: costEntry.id
    };
    const nextProduct = { ...product, currentStock: 4 };
    const imported = {
      ...prior, sales: [sale], products: [nextProduct], movements: [movement],
      journalEntries: [saleEntry, costEntry]
    };
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);
    const saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.sales[0].invoiceNumber, 'SALE-IMPORT-001');
    assert.equal(saved.movements[0].concept, 'VENTA');
    assert.equal(saved.journalEntries.length, 2);
    assert.equal(saved.products[0].currentStock, 4);

    const rejectedDb = new Database(':memory:');
    rejectedDb.exec(`
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
      persistAccountingSnapshot(rejectedDb, prior, { id: 1, username: 'admin', role: 'admin' });
      const invalid = {
        ...prior, sales: [sale], products: [nextProduct],
        movements: [], journalEntries: [saleEntry]
      };
      assert.throws(() => persistAccountingSnapshot(rejectedDb, invalid, { id: 1, username: 'admin', role: 'admin' }),
        /salidas de Kardex y los asientos de costo de ventas vinculados/);
      const afterRejectedWrite = JSON.parse(rejectedDb.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
      assert.equal(afterRejectedWrite.sales.length, 0);
      assert.equal(afterRejectedWrite.movements.length, 0);
      assert.equal(afterRejectedWrite.journalEntries.length, 0);
    } finally {
      rejectedDb.close();
    }
  } finally {
    db.close();
  }
});

test('party master rows persist, update, remove and roll back atomically with the accounting snapshot', () => {
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
    CREATE TABLE party_masters (
      id TEXT PRIMARY KEY, company_id TEXT NOT NULL,
      party_type TEXT NOT NULL CHECK(party_type IN ('CUSTOMER','SUPPLIER')),
      name TEXT NOT NULL, fiscal_id TEXT, fiscal_id_type TEXT,
      normalized_fiscal_id TEXT, address TEXT, phone TEXT, email TEXT,
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(company_id, party_type, normalized_fiscal_id)
    );
  `);
  try {
    const initial = {
      ...emptyState(),
      customers: [{
        id: 'customer-1', companyId: 'company-1', name: 'Cliente Uno',
        fiscalIdType: 'RIF', fiscalId: 'J-12345678-9', active: true
      }],
      suppliers: [{
        id: 'supplier-1', companyId: 'company-1', name: 'Proveedor Uno',
        fiscalIdType: 'RIF', fiscalId: 'J-12345678-9', active: true
      }]
    };
    assert.equal(persistAccountingSnapshot(db, initial).ok, true);
    let rows = db.prepare('SELECT id, party_type, normalized_fiscal_id, active FROM party_masters ORDER BY id').all();
    assert.deepEqual(rows, [
      { id: 'customer-1', party_type: 'CUSTOMER', normalized_fiscal_id: 'J123456789', active: 1 },
      { id: 'supplier-1', party_type: 'SUPPLIER', normalized_fiscal_id: 'J123456789', active: 1 }
    ]);

    const updated = {
      ...initial,
      customers: [{ ...initial.customers[0], name: 'Cliente Actualizado' }],
      suppliers: [{ ...initial.suppliers[0], active: false }]
    };
    assert.equal(persistAccountingSnapshot(db, updated).ok, true);
    assert.equal(db.prepare("SELECT name FROM party_masters WHERE id='customer-1'").get().name, 'Cliente Actualizado');
    assert.equal(db.prepare("SELECT active FROM party_masters WHERE id='supplier-1'").get().active, 0);

    const invalid = {
      ...updated,
      customers: [
        updated.customers[0],
        { id: 'customer-2', companyId: 'company-1', name: 'Cliente Duplicado', fiscalIdType: 'RIF', fiscalId: 'J 12345678-9' }
      ]
    };
    assert.throws(() => persistAccountingSnapshot(db, invalid), /identificadores fiscales duplicados/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM party_masters').get().n, 2);
    const saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.customers.length, 1);
    assert.equal(saved.customers[0].name, 'Cliente Actualizado');

    const removed = { ...updated, customers: [] };
    assert.equal(persistAccountingSnapshot(db, removed).ok, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM party_masters WHERE party_type='CUSTOMER'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM party_masters WHERE party_type='SUPPLIER'").get().n, 1);
  } finally {
    db.close();
  }
});

