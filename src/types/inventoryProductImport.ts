/**
 * Construcción del snapshot de importación de artículos.
 *
 * Extraído de `AccountingContext.importInventoryProducts` para poder probar el
 * flujo completo (producto, Kardex de apertura y asiento) sin React ni SQLite.
 * El contexto solo persiste el resultado; toda la validación contable vive aquí.
 */

import type { InventoryMovement, InventoryProduct, JournalEntry } from './accounting';
import { getDefaultInventoryAccountCode } from './inventoryAccounting';
import { todayLocalIso } from '../utils/localDate';

export type InventoryProductImportAccount = {
  code: string;
  name: string;
  type: string;
  isMovement: boolean;
};

export type InventoryProductImportInput = {
  companyId: string;
  rows: Array<Omit<InventoryProduct, 'id' | 'companyId'>>;
  accounts: InventoryProductImportAccount[];
  /** Códigos ya existentes de la empresa destino, en mayúsculas y sin espacios. */
  existingCodes: Iterable<string>;
  nextEntryNumber: number;
  today?: string;
};

export type InventoryProductImportResult = {
  products: InventoryProduct[];
  movements: InventoryMovement[];
  journalEntries: JournalEntry[];
  nextEntryNumber: number;
};

const normalizeCode = (value: string) => String(value || '').trim().toLocaleUpperCase();

export const buildInventoryProductImport = (input: InventoryProductImportInput): InventoryProductImportResult => {
  const { companyId, rows, accounts, nextEntryNumber: startingEntryNumber } = input;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('El archivo no contiene artículos para importar.');

  const existingCodes = new Set(Array.from(input.existingCodes, normalizeCode));
  const batchCodes = new Set<string>();
  const products: InventoryProduct[] = [];
  const movements: InventoryMovement[] = [];
  const journalEntries: JournalEntry[] = [];
  let nextEntryNumber = startingEntryNumber;
  const today = input.today ?? todayLocalIso();

  rows.forEach((row, index) => {
    const code = normalizeCode(row.code);
    const name = String(row.name || '').trim();
    if (!code || !name) throw new Error('Cada artículo debe incluir código y descripción.');
    if (existingCodes.has(code) || batchCodes.has(code)) throw new Error('Código duplicado en la empresa o archivo: ' + code + '.');
    batchCodes.add(code);

    const rate = Number(row.openingBcvRate ?? 0);
    const quantity = Number(row.currentStock || 0);
    const unitCostBs = Number(row.avgCostBs || 0);
    const date = row.openingDate || today;
    const parsedOpeningDate = new Date(date + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedOpeningDate.getTime()) || parsedOpeningDate.toISOString().slice(0, 10) !== date) {
      throw new Error('Fecha de apertura inválida para ' + code + '.');
    }
    if (!Number.isFinite(rate) || rate < 0 || ((quantity > 0 || unitCostBs > 0) && rate <= 0) ||
        !Number.isFinite(quantity) || quantity < 0 ||
        !Number.isFinite(unitCostBs) || unitCostBs < 0 || (quantity > 0 && unitCostBs <= 0)) {
      throw new Error('Tasa, cantidad o costo inválidos para ' + code + '.');
    }
    const lastCostBs = Number(row.lastCostBs ?? unitCostBs);
    const lastCostUsd = Number(row.lastCostUsd ?? (rate > 0 ? lastCostBs / rate : 0));
    if (!Number.isFinite(lastCostBs) || lastCostBs < 0 || !Number.isFinite(lastCostUsd) || lastCostUsd < 0 ||
        (quantity > 0 && (lastCostBs <= 0 || lastCostUsd <= 0))) {
      throw new Error('Último costo Bs/USD inválido para ' + code + '. Declare ambos valores cuando importe inventario universal.');
    }

    const product: InventoryProduct = {
      ...row,
      id: 'prod-import-' + Date.now() + '-' + index + '-' + Math.floor(Math.random() * 100000),
      companyId,
      code,
      name,
      priceCurrency: row.priceCurrency || 'BS',
      price1: Number(row.price1 ?? (row.priceCurrency === 'USD' ? row.salesPriceUsd : row.salesPriceBs) ?? 0),
      price2: row.price2 ?? null,
      price3: row.price3 ?? null,
      price4: row.price4 ?? null,
      currentStock: quantity,
      avgCostBs: unitCostBs,
      avgCostUsd: rate > 0 ? unitCostBs / rate : 0,
      lastCostBs,
      lastCostUsd,
      inventoryAccountCode: row.inventoryAccountCode || getDefaultInventoryAccountCode(row.itemType),
      costOfSalesAccountCode: row.costOfSalesAccountCode || '5.1.1.01',
      adjustmentAccountCode: row.adjustmentAccountCode || '5.1.2.01',
      openingBalanceAccountCode: row.openingBalanceAccountCode || '3.3.1.01',
      costingMethod: row.costingMethod || 'PROMEDIO_PONDERADO',
      vatTreatment: row.vatTreatment || 'GENERAL_16',
      itemType: row.itemType || 'MERCANCIA',
      openingDate: date,
      openingBcvRate: rate,
      vnrProvisionBs: Number(row.vnrProvisionBs || 0)
    };

    const inventoryAccount = accounts.find(a => a.code === product.inventoryAccountCode && a.isMovement && a.type === 'ACTIVO');
    const costAccount = accounts.find(a => a.code === product.costOfSalesAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
    const adjustmentAccount = accounts.find(a => a.code === product.adjustmentAccountCode && a.isMovement && (a.type === 'COSTOS' || a.type === 'GASTOS'));
    if (!inventoryAccount || !costAccount || !adjustmentAccount) throw new Error('Cuentas contables inválidas para el artículo ' + code + '.');
    if (product.itemType === 'PRODUCTO_EN_PROCESO' && product.inventoryAccountCode !== '1.1.4.04') {
      throw new Error('El artículo ' + code + ' es producto en proceso y debe usar la cuenta 1.1.4.04.');
    }

    if (quantity > 0) {
      const offsetAccount = accounts.find(a => a.code === product.openingBalanceAccountCode && a.isMovement);
      if (!offsetAccount) throw new Error('Cuenta de contrapartida de apertura inválida para el artículo ' + code + '.');
      const totalBs = Math.round(quantity * unitCostBs * 100) / 100;
      const totalUsd = rate > 0 ? Math.round(totalBs / rate * 1000000) / 1000000 : 0;
      const entry: JournalEntry = {
        id: 'entry-inventory-opening-' + product.id,
        companyId,
        entryNumber: nextEntryNumber++,
        date,
        description: 'Asiento de apertura de inventario · ' + code + ' · ' + name,
        type: 'APERTURA',
        bcvRate: rate,
        referenceDoc: 'APERTURA-' + code,
        items: [
          { accountCode: inventoryAccount.code, accountName: inventoryAccount.name, debitBs: totalBs, creditBs: 0, debitUsd: totalUsd, creditUsd: 0, description: 'Existencia inicial de ' + quantity + ' ' + product.unit },
          { accountCode: offsetAccount.code, accountName: offsetAccount.name, debitBs: 0, creditBs: totalBs, debitUsd: 0, creditUsd: totalUsd, description: 'Contrapartida de apertura de inventario ' + code }
        ],
        createdAt: new Date().toISOString()
      };
      journalEntries.push(entry);
      movements.push({
        id: 'mov-opening-' + product.id,
        companyId,
        productId: product.id,
        productName: name,
        productCode: code,
        date,
        type: 'ENTRADA',
        concept: 'INVENTARIO_INICIAL',
        documentRef: entry.referenceDoc || 'APERTURA-INVENTARIO',
        quantity,
        unitCostBs,
        unitCostUsd: rate > 0 ? unitCostBs / rate : 0,
        totalCostBs: totalBs,
        totalCostUsd: totalUsd,
        balanceQty: quantity,
        balanceTotalBs: totalBs,
        balanceTotalUsd: totalUsd,
        bcvRate: rate,
        costingMethod: product.costingMethod,
        journalEntryId: entry.id
      });
    }

    products.push(product);
  });

  return { products, movements, journalEntries, nextEntryNumber };
};
