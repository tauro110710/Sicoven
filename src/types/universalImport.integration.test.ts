import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractUniversalJsonCollections,
  classifyUniversalInvoiceRows,
  selectUniversalRowsByStableKeys,
  buildUniversalInvoiceIdentity,
  findUniversalInvoiceJournalCollision
} from './universalImport';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { persistAccountingSnapshot } = require('../../electron/accounting-persistence.cjs');

const emptyState = () => ({
  companies: [
    { id: 'company-1', name: 'Empresa origen', rif: 'J-11111111-1' },
    { id: 'company-2', name: 'Empresa destino', rif: 'J-22222222-2' }
  ],
  currentCompanyId: 'company-1',
  accounts: [
    { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
    { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', level: 4, isMovement: true }
  ],
  journalEntries: [],
  purchases: [],
  sales: [],
  products: [],
  movements: [],
  vatVouchers: [],
  vatWithholdingDeclarations: [],
  vatWithholdingDeclarationEvents: [],
  islrVouchers: [],
  bankAccounts: [],
  bankStatementMovements: [],
  creditSettlements: [],
  supplierAdvanceSettlements: [],
  supplierDirectAdvances: [],
  islrFiscalEvents: [],
  financialDisclosures: [],
  displayCurrency: 'DUAL'
});

const journalEntry = (id: string, companyId: string, entryNumber: number, referenceDoc: string) => ({
  id,
  companyId,
  entryNumber,
  date: '2026-11-07',
  description: 'Importación de prueba ' + referenceDoc,
  type: 'MANUAL',
  bcvRate: 100,
  referenceDoc,
  items: [
    { accountCode: '1.1.1.01', debitBs: 100, creditBs: 0, debitUsd: 1, creditUsd: 0 },
    { accountCode: '4.1.1.01', debitBs: 0, creditBs: 100, debitUsd: 0, creditUsd: 1 }
  ],
  createdAt: '2026-11-07T10:00:00.000Z'
});

test('integración: análisis JSON, selección individual, empresa destino, duplicados y rollback SQLite', () => {
  const directory = mkdtempSync(join(tmpdir(), 'sicoven-universal-import-'));
  const databasePath = join(directory, 'integration.sqlite');
  let db: any;
  try {
    db = new Database(databasePath);
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

    const initial = emptyState();
    initial.journalEntries.push(journalEntry('prior-company-1', 'company-1', 1, 'FAC-ANTERIOR'));
    assert.equal(persistAccountingSnapshot(db, initial, { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const sourceJson = {
      ventas: [
        { invoiceNumber: 'F-001', invoiceDate: '2026-11-06', totalAmountBs: 100, customerName: 'Cliente Uno', customerRif: 'J-33333333-3' },
        { invoiceNumber: 'F-002', invoiceDate: '2026-11-07', totalAmountBs: 100, customerName: 'Cliente Dos', customerRif: 'J-44444444-4' }
      ]
    };
    const collections = extractUniversalJsonCollections(sourceJson);
    assert.equal(collections.length, 1);
    const rows = collections.flatMap(collection => collection.rows.map((row, index) => ({
      ...row,
      migrationfile: 'origen.json',
      migrationcollection: collection.path,
      migrationrowid: 'origen.json|' + collection.path + '|' + index
    })));
    const classified = classifyUniversalInvoiceRows(rows);
    assert.equal(classified.sales.length, 2);
    const selected = selectUniversalRowsByStableKeys(classified.sales, ['origen.json|ventas|1']);
    assert.deepEqual(selected.map(row => row.invoiceNumber), ['F-002']);

    const selectedIdentity = buildUniversalInvoiceIdentity('sales', selected[0].invoiceNumber, selected[0].customerRif);
    const alreadyImported = new Set(initial.sales.map(row => buildUniversalInvoiceIdentity('sales', row.invoiceNumber, row.customerRif)));
    assert.equal(alreadyImported.has(selectedIdentity), false);
    assert.equal(
      findUniversalInvoiceJournalCollision('F-002', initial.journalEntries, 'VENTA'),
      undefined
    );
    assert.ok(findUniversalInvoiceJournalCollision('ANTERIOR', initial.journalEntries, 'VENTA'));

    const importedEntry = journalEntry('imported-company-2', 'company-2', 1, 'FAC-F-002');
    const imported = {
      ...initial,
      journalEntries: [...initial.journalEntries, importedEntry]
    };
    assert.equal(persistAccountingSnapshot(db, imported, { id: 1, username: 'admin', role: 'admin' }).ok, true);

    db.close();
    db = new Database(databasePath, { readonly: true });
    const saved = JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);
    assert.equal(saved.currentCompanyId, 'company-1', 'la importación no debe cambiar la empresa activa');
    assert.deepEqual(saved.journalEntries.map((entry: any) => [entry.id, entry.companyId]), [
      ['prior-company-1', 'company-1'],
      ['imported-company-2', 'company-2']
    ]);
    assert.equal(saved.journalEntries.filter((entry: any) => entry.companyId === 'company-1').length, 1);
    assert.equal(saved.journalEntries.filter((entry: any) => entry.companyId === 'company-2').length, 1);
    assert.equal(saved.journalEntries.some((entry: any) => entry.referenceDoc === 'FAC-F-001'), false);

    db.close();
    db = new Database(databasePath);
    const beforeFailure = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    const auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n;
    db.exec(`CREATE TRIGGER reject_import_midway BEFORE UPDATE ON app_state
      BEGIN SELECT RAISE(ABORT, 'injected end-to-end import failure'); END;`);
    const failedAttempt = {
      ...imported,
      journalEntries: [...imported.journalEntries, journalEntry('must-rollback', 'company-2', 2, 'FAC-F-003')]
    };
    assert.throws(
      () => persistAccountingSnapshot(db, failedAttempt, { id: 1, username: 'admin', role: 'admin' }),
      /injected end-to-end import failure/
    );
    assert.equal(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json, beforeFailure);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_events').get().n, auditCount);
  } finally {
    if (db?.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
