import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateCatalogInventoryBatch, type InventoryCatalogColumns } from './inventoryCatalogImport';
import { buildInventoryProductImport, type InventoryProductImportAccount } from './inventoryProductImport';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');
const { persistAccountingSnapshot } = require('../../electron/accounting-persistence.cjs');

const ACCOUNTS: InventoryProductImportAccount[] = [
  { code: '1.1.4.01', name: 'Inventario de mercancía', type: 'ACTIVO', isMovement: true },
  { code: '1.1.4.04', name: 'Productos en proceso', type: 'ACTIVO', isMovement: true },
  { code: '5.1.1.01', name: 'Costo de ventas', type: 'COSTOS', isMovement: true },
  { code: '5.1.2.01', name: 'Ajustes de inventario', type: 'GASTOS', isMovement: true },
  { code: '3.3.1.01', name: 'Contrapartida de apertura', type: 'PATRIMONIO', isMovement: true }
];

const emptyState = (products: any[] = [], movements: any[] = [], journalEntries: any[] = []) => ({
  companies: [{ id: 'company-1', name: 'Comercio de prueba', rif: 'J-11111111-1' }],
  currentCompanyId: 'company-1',
  accounts: ACCOUNTS.map(account => ({ ...account, level: 4 })),
  journalEntries,
  purchases: [],
  sales: [],
  products,
  movements,
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

const createDatabase = (path: string) => {
  const db = new Database(path);
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
};

/** Escribe un maestro real en XLSX y lo vuelve a leer como lo hace la app. */
const writeAndReadWorkbook = async (path: string, rows: string[][]) => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Datos');
  rows.forEach(row => sheet.addRow(row));
  await workbook.xlsx.writeFile(path);

  const reloaded = new ExcelJS.Workbook();
  await reloaded.xlsx.readFile(path);
  const firstSheet = reloaded.worksheets[0];
  assert.ok(firstSheet, 'el XLSX debe conservar la hoja Datos');

  const matrix: string[][] = [];
  firstSheet.eachRow({ includeEmpty: false }, (row: any) => {
    const values: string[] = [];
    for (let column = 1; column <= row.cellCount; column += 1) {
      const cellValue: unknown = row.getCell(column).value;
      values.push(cellValue === null || cellValue === undefined
        ? ''
        : cellValue instanceof Date
          ? cellValue.toISOString().slice(0, 10)
          : typeof cellValue === 'object' && 'result' in (cellValue as object)
            ? String((cellValue as { result: unknown }).result ?? '').trim()
            : String(cellValue).trim());
    }
    matrix.push(values);
  });

  const headers = matrix[0].map(header => header.trim().toLowerCase());
  return matrix.slice(1).map(cells => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => { record[header] = cells[index] ?? ''; });
    return record;
  });
};

const readStoredState = (db: any) =>
  JSON.parse(db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json);

test('integración: catálogo XLSX sin columnas marcadas se carga en cero sin Kardex ni asientos', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sicoven-catalog-zero-'));
  const databasePath = join(directory, 'zero.sqlite');
  const workbookPath = join(directory, 'catalogo.xlsx');
  let db: any;
  try {
    db = createDatabase(databasePath);
    assert.equal(persistAccountingSnapshot(db, emptyState(), { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const records = await writeAndReadWorkbook(workbookPath, [
      ['code', 'name', 'existencia', 'costo', 'precio', 'margen'],
      ['A-001', 'Harina de maíz', '50', '12,50', '20,00', '30'],
      ['A-002', 'Aceite vegetal', '0', '0', '0', '0']
    ]);
    assert.equal(records.length, 2);

    // El contador no marcó ninguna columna: solo código y descripción.
    const columns: InventoryCatalogColumns = {};
    const prepared = validateCatalogInventoryBatch(records, {
      columns,
      defaults: { openingDate: '2026-11-01', category: 'General', unit: 'Unidad' }
    });
    assert.deepEqual(prepared.map(row => row.code), ['A-001', 'A-002']);
    assert.deepEqual(prepared.map(row => row.currentStock), [0, 0]);
    assert.deepEqual(prepared.map(row => row.avgCostBs), [0, 0]);
    assert.deepEqual(prepared.map(row => row.price1), [0, 0]);
    assert.equal(prepared[0].targetMarginPercent, undefined);
    assert.equal(prepared[0].vatTreatment, 'GENERAL_16');

    const result = buildInventoryProductImport({
      companyId: 'company-1', rows: prepared, accounts: ACCOUNTS, existingCodes: [], nextEntryNumber: 1
    });
    assert.equal(result.products.length, 2);
    assert.equal(result.movements.length, 0, 'sin existencia no se crea movimiento de apertura');
    assert.equal(result.journalEntries.length, 0, 'sin existencia no se crea asiento de apertura');

    assert.equal(persistAccountingSnapshot(db, emptyState(result.products, result.movements, result.journalEntries),
      { id: 1, username: 'admin', role: 'admin' }).ok, true);

    db.close();
    db = new Database(databasePath);
    const stored = readStoredState(db);
    assert.equal(stored.products.length, 2);
    assert.equal(stored.products[0].currentStock, 0);
    assert.equal(stored.products[0].avgCostBs, 0);
    assert.equal(stored.products[0].price1, 0);
    assert.equal(stored.products[0].unit, 'Unidad');
    assert.equal(stored.movements.length, 0);
    assert.equal(stored.journalEntries.length, 0);
  } finally {
    try { db?.close(); } catch { /* ya cerrada */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('integración: columnas marcadas generan producto, Kardex de apertura y asiento conciliado en SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sicoven-catalog-open-'));
  const databasePath = join(directory, 'opening.sqlite');
  const workbookPath = join(directory, 'catalogo-apertura.xlsx');
  let db: any;
  try {
    db = createDatabase(databasePath);
    assert.equal(persistAccountingSnapshot(db, emptyState(), { id: 1, username: 'admin', role: 'admin' }).ok, true);

    const records = await writeAndReadWorkbook(workbookPath, [
      ['Code', 'Name', 'CurrentStock', 'AvgCostBs', 'Price1'],
      ['B-100', 'Café molido 500 g', '10', '5', '12'],
      ['B-200', 'Taza de cerámica', '0', '0', '0']
    ]);

    const prepared = validateCatalogInventoryBatch(records, {
      columns: { currentStock: true, avgCostBs: true, price1: true },
      defaults: { openingBcvRate: 100, openingDate: '2026-11-01', category: 'General', unit: 'Unidad' }
    });
    assert.equal(prepared[0].avgCostUsd, 0.05);
    assert.equal(prepared[0].price1, 12);

    const result = buildInventoryProductImport({
      companyId: 'company-1', rows: prepared, accounts: ACCOUNTS, existingCodes: [], nextEntryNumber: 7
    });
    assert.equal(result.products.length, 2);
    assert.equal(result.movements.length, 1, 'solo el artículo con existencia genera Kardex');
    assert.equal(result.journalEntries.length, 1, 'solo el artículo con existencia genera asiento');

    const [entry] = result.journalEntries;
    assert.equal(entry.type, 'APERTURA');
    assert.equal(entry.entryNumber, 7);
    assert.equal(entry.referenceDoc, 'APERTURA-B-100');
    const debitBs = entry.items.reduce((sum, item) => sum + item.debitBs, 0);
    const creditBs = entry.items.reduce((sum, item) => sum + item.creditBs, 0);
    const debitUsd = entry.items.reduce((sum, item) => sum + item.debitUsd, 0);
    assert.equal(debitBs, 50);
    assert.equal(creditBs, 50);
    assert.equal(debitUsd, 0.5);
    assert.equal(entry.items[0].accountCode, '1.1.4.01');
    assert.equal(entry.items[1].accountCode, '3.3.1.01');

    const [movement] = result.movements;
    assert.equal(movement.concept, 'INVENTARIO_INICIAL');
    assert.equal(movement.quantity, 10);
    assert.equal(movement.balanceQty, 10);
    assert.equal(movement.journalEntryId, entry.id);

    assert.equal(persistAccountingSnapshot(db, emptyState(result.products, result.movements, result.journalEntries),
      { id: 1, username: 'admin', role: 'admin' }).ok, true);

    db.close();
    db = new Database(databasePath);
    const stored = readStoredState(db);
    assert.equal(stored.products.length, 2);
    assert.equal(stored.movements.length, 1);
    assert.equal(stored.journalEntries.length, 1);
    assert.equal(stored.movements[0].productCode, 'B-100');
    assert.equal(stored.journalEntries[0].items.reduce((sum: number, item: any) => sum + item.debitBs, 0), 50);
  } finally {
    try { db?.close(); } catch { /* ya cerrada */ }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('integración: existencia sin tasa y códigos duplicados se rechazan antes de escribir en SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sicoven-catalog-reject-'));
  const databasePath = join(directory, 'reject.sqlite');
  const workbookPath = join(directory, 'catalogo-invalido.xlsx');
  let db: any;
  try {
    db = createDatabase(databasePath);
    assert.equal(persistAccountingSnapshot(db, emptyState(), { id: 1, username: 'admin', role: 'admin' }).ok, true);
    const before = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;

    const records = await writeAndReadWorkbook(workbookPath, [
      ['code', 'name', 'existencia', 'costo'],
      ['C-001', 'Artículo con stock y sin tasa', '5', '10']
    ]);
    assert.throws(
      () => validateCatalogInventoryBatch(records, { columns: { currentStock: true, avgCostBs: true } }),
      /falta la tasa BCV histórica/
    );

    const duplicated = await writeAndReadWorkbook(workbookPath, [
      ['code', 'name'],
      ['D-001', 'Primero'],
      ['d-001', 'Segundo']
    ]);
    assert.throws(
      () => validateCatalogInventoryBatch(duplicated, { columns: {} }),
      /está repetido en el archivo/
    );

    // Un código que ya existe en la empresa tampoco puede duplicarse al importar.
    assert.throws(
      () => buildInventoryProductImport({
        companyId: 'company-1',
        rows: validateCatalogInventoryBatch([{ code: 'E-001', name: 'Existente' }], { columns: {} }),
        accounts: ACCOUNTS,
        existingCodes: ['E-001'],
        nextEntryNumber: 1
      }),
      /Código duplicado en la empresa o archivo/
    );

    const after = db.prepare("SELECT state_json FROM app_state WHERE state_key='accounting'").get().state_json;
    assert.equal(after, before, 'un lote rechazado no puede modificar el snapshot contable');
    assert.equal(readStoredState(db).products.length, 0);
  } finally {
    try { db?.close(); } catch { /* ya cerrada */ }
    rmSync(directory, { recursive: true, force: true });
  }
});
