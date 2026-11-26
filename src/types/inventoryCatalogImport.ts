import { todayLocalIso } from '../utils/localDate';
import { isValidIsoDate } from './inventoryImport';

/**
 * Importación de catálogo de productos con columnas seleccionables.
 *
 * El contador decide qué columnas del archivo realmente quiere cargar. Las
 * columnas no marcadas no se leen del archivo y el artículo se crea con el
 * valor por defecto indicado (normalmente 0). Esto permite subir primero el
 * catálogo "en limpio" —código, nombre, unidad— con existencias, costos y
 * precios en cero, y completar esos datos después con el Kardex o desde la
 * ficha de cada artículo.
 */

export type InventoryCatalogColumnKey =
  | 'currentStock'
  | 'avgCostBs'
  | 'price1'
  | 'priceCurrency'
  | 'salesPriceBs'
  | 'salesPriceUsd'
  | 'targetMarginPercent'
  | 'minStock'
  | 'category'
  | 'unit'
  | 'costingMethod'
  | 'vatTreatment'
  | 'itemType'
  | 'openingBcvRate'
  | 'openingDate';

export type InventoryCatalogColumns = Partial<Record<InventoryCatalogColumnKey, boolean>>;

export type InventoryCatalogDefaults = {
  currentStock?: number;
  avgCostBs?: number;
  price1?: number;
  priceCurrency?: 'USD' | 'BS';
  salesPriceBs?: number;
  salesPriceUsd?: number;
  targetMarginPercent?: number;
  minStock?: number;
  category?: string;
  unit?: string;
  costingMethod?: 'PROMEDIO_PONDERADO' | 'PEPS';
  vatTreatment?: 'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO';
  itemType?: 'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO';
  openingBcvRate?: number;
  openingDate?: string;
};

export type InventoryCatalogAccountCodes = {
  inventory: string;
  costOfSales: string;
  adjustment: string;
  openingBalance: string;
};

export type InventoryCatalogOptions = {
  columns: InventoryCatalogColumns;
  defaults?: InventoryCatalogDefaults;
  /** Códigos contables destino; si se omiten se usan los estándar de SICOVEN. */
  accounts?: Partial<InventoryCatalogAccountCodes>;
};

export type InventoryCatalogRow = {
  code: string;
  name: string;
  category: string;
  unit: string;
  minStock: number;
  currentStock: number;
  avgCostBs: number;
  avgCostUsd: number;
  lastCostBs: number;
  lastCostUsd: number;
  price1: number;
  price2: number | null;
  price3: number | null;
  price4: number | null;
  priceCurrency: 'USD' | 'BS';
  salesPriceBs: number;
  salesPriceUsd: number;
  targetMarginPercent?: number;
  inventoryAccountCode: string;
  costOfSalesAccountCode: string;
  adjustmentAccountCode: string;
  openingBalanceAccountCode: string;
  costingMethod: 'PROMEDIO_PONDERADO' | 'PEPS';
  vatTreatment: 'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO';
  itemType: 'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO';
  openingDate: string;
  openingBcvRate: number;
};

export const DEFAULT_CATALOG_ACCOUNTS: InventoryCatalogAccountCodes = {
  inventory: '1.1.4.01',
  costOfSales: '5.1.1.01',
  adjustment: '5.1.2.01',
  openingBalance: '3.3.1.01',
};

/** Columnas que puede elegir el contador, con la explicación que ve en pantalla. */
export const INVENTORY_CATALOG_COLUMNS: Array<{ key: InventoryCatalogColumnKey; label: string; whenOff: string }> = [
  { key: 'currentStock', label: 'Existencia', whenOff: 'Se carga en cero; el Kardex la mueve después.' },
  { key: 'avgCostBs', label: 'Costo promedio (Bs)', whenOff: 'Se carga en cero; se completa con las compras.' },
  { key: 'price1', label: 'Precio de venta', whenOff: 'Se carga en cero; el artículo queda sin precio.' },
  { key: 'targetMarginPercent', label: 'Margen de ganancia (%)', whenOff: 'Se deja vacío; no se sugiere precio.' },
  { key: 'minStock', label: 'Stock mínimo', whenOff: 'Se carga en cero; no se generan alertas.' },
  { key: 'category', label: 'Categoría', whenOff: 'Se usa la categoría General.' },
  { key: 'unit', label: 'Unidad de medida', whenOff: 'Se usa Unidad.' },
  { key: 'vatTreatment', label: 'Alícuota de IVA', whenOff: 'Se usa IVA general 16 %.' },
  { key: 'itemType', label: 'Tipo de artículo', whenOff: 'Se usa Mercancía.' },
  { key: 'costingMethod', label: 'Método de costeo', whenOff: 'Se usa promedio ponderado.' },
  { key: 'openingBcvRate', label: 'Tasa BCV de apertura', whenOff: 'Se usa la tasa de inventario de la empresa.' },
];

const normalizeHeader = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '').replace(/_/g, '');

const pick = (row: Record<string, string>, ...keys: string[]): string | undefined => {
  const entries = Object.entries(row);
  for (const key of keys) {
    const target = normalizeHeader(key);
    const found = entries.find(([name]) => normalizeHeader(name) === target);
    if (found && String(found[1] ?? '').trim() !== '') return String(found[1]).trim();
  }
  return undefined;
};

const CATALOG_FIELD_KEYS: Record<InventoryCatalogColumnKey, string[]> = {
  currentStock: ['currentStock', 'existencia', 'stock', 'cantidad'],
  avgCostBs: ['avgCostBs', 'costoPromedioBs', 'costo', 'costoUnitario'],
  price1: ['price1', 'precio1', 'precio_1', 'precioVenta', 'salesPrice'],
  priceCurrency: ['priceCurrency', 'monedaPrecio', 'moneda'],
  salesPriceBs: ['salesPriceBs', 'precioVentaBs'],
  salesPriceUsd: ['salesPriceUsd', 'precioVentaUsd'],
  targetMarginPercent: ['targetMarginPercent', 'margen', 'margenGanancia', 'porcentajeGanancia'],
  minStock: ['minStock', 'stockMinimo', 'minimo'],
  category: ['category', 'categoria', 'rubro'],
  unit: ['unit', 'unidad', 'unidadMedida'],
  costingMethod: ['costingMethod', 'metodoCosteo'],
  vatTreatment: ['vatTreatment', 'alicuotaIva', 'iva'],
  itemType: ['itemType', 'tipoArticulo'],
  openingBcvRate: ['openingBcvRate', 'bcvRate', 'tasaBcv'],
  openingDate: ['openingDate', 'fechaApertura', 'fecha'],
};

const fileProvidesCatalogField = (row: Record<string, string>, key: InventoryCatalogColumnKey) =>
  pick(row, ...CATALOG_FIELD_KEYS[key]) !== undefined;

const parseAmount = (raw: string, label: string, line: number): number => {
  const normalized = raw.replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value)) throw new Error('Fila ' + line + ': ' + label + ' no es un número válido ("' + raw + '").');
  if (value < 0) throw new Error('Fila ' + line + ': ' + label + ' no puede ser negativo.');
  return value;
};

const readAmount = (
  row: Record<string, string>,
  line: number,
  label: string,
  enabled: boolean,
  fallback: number,
  keys: string[],
  required: boolean
): number => {
  if (!enabled) return fallback;
  const raw = pick(row, ...keys);
  if (raw === undefined) {
    if (required) throw new Error('Fila ' + line + ': marcó la columna ' + label + ' pero el archivo no la trae o la celda está vacía.');
    return fallback;
  }
  return parseAmount(raw, label, line);
};

const yes = (columns: InventoryCatalogColumns, key: InventoryCatalogColumnKey) => columns[key] === true;

/**
 * Convierte una fila del maestro en un artículo listo para `importInventoryProducts`.
 * Solo exige código y descripción: todo lo demás depende de las columnas marcadas.
 */
export const validateCatalogInventoryRow = (
  row: Record<string, string>,
  line: number,
  options: InventoryCatalogOptions
): InventoryCatalogRow => {
  const prefix = 'Fila ' + line + ': ';
  const { columns, defaults = {} } = options;
  const code = pick(row, 'code', 'codigo', 'sku', 'productCode', 'codigoProducto');
  const name = pick(row, 'name', 'nombre', 'productName', 'producto', 'descripcion');
  if (!code) throw new Error(prefix + 'falta el código del artículo.');
  if (!name) throw new Error(prefix + 'falta la descripción del artículo.');

  const currentStock = readAmount(row, line, 'existencia', yes(columns, 'currentStock'), defaults.currentStock ?? 0,
    CATALOG_FIELD_KEYS.currentStock, true);
  const avgCostBs = readAmount(row, line, 'costo promedio', yes(columns, 'avgCostBs'), defaults.avgCostBs ?? 0,
    CATALOG_FIELD_KEYS.avgCostBs, true);
  if (currentStock > 0 && avgCostBs <= 0) {
    throw new Error(prefix + 'marcó existencia sin costo. Marque también la columna de costo o cargue el artículo sin existencia (catálogo en cero).');
  }

  const priceCurrencyRaw = (pick(row, ...CATALOG_FIELD_KEYS.priceCurrency) || defaults.priceCurrency || 'BS').toUpperCase();
  if (!['USD', 'BS', 'VES', 'BOLIVARES', 'BOLIVAR'].includes(priceCurrencyRaw)) {
    throw new Error(prefix + 'la moneda del precio debe ser USD o BS.');
  }
  const priceCurrency: 'USD' | 'BS' = priceCurrencyRaw === 'USD' ? 'USD' : 'BS';

  let price1 = readAmount(row, line, 'precio de venta', yes(columns, 'price1'), defaults.price1 ?? 0,
    CATALOG_FIELD_KEYS.price1, yes(columns, 'price1'));
  let salesPriceBs = defaults.salesPriceBs ?? 0;
  let salesPriceUsd = defaults.salesPriceUsd ?? 0;
  if (yes(columns, 'salesPriceBs')) salesPriceBs = readAmount(row, line, 'precio en Bs', true, 0, CATALOG_FIELD_KEYS.salesPriceBs, false);
  if (yes(columns, 'salesPriceUsd')) salesPriceUsd = readAmount(row, line, 'precio en USD', true, 0, CATALOG_FIELD_KEYS.salesPriceUsd, false);
  if (!yes(columns, 'price1')) {
    if (yes(columns, 'salesPriceBs')) price1 = salesPriceBs;
    else if (yes(columns, 'salesPriceUsd')) price1 = salesPriceUsd;
  }
  if (priceCurrency === 'USD' && salesPriceUsd === 0 && salesPriceBs === 0) salesPriceUsd = price1;
  if (priceCurrency === 'BS' && salesPriceBs === 0 && salesPriceUsd === 0) salesPriceBs = price1;

  const marginRaw = yes(columns, 'targetMarginPercent')
    ? pick(row, ...CATALOG_FIELD_KEYS.targetMarginPercent)
    : undefined;
  let targetMarginPercent = defaults.targetMarginPercent;
  if (yes(columns, 'targetMarginPercent')) {
    if (marginRaw === undefined) {
      if (targetMarginPercent !== undefined) {
        // Mantener el valor por defecto elegido en pantalla.
      } else {
        throw new Error(prefix + 'marcó el margen de ganancia pero el archivo no lo trae.');
      }
    } else {
      targetMarginPercent = parseAmount(marginRaw, 'margen de ganancia', line);
      if (targetMarginPercent > 1000) throw new Error(prefix + 'el margen de ganancia parece un monto y no un porcentaje.');
    }
  }

  const minStock = readAmount(row, line, 'stock mínimo', yes(columns, 'minStock'), defaults.minStock ?? 0,
    CATALOG_FIELD_KEYS.minStock, false);

  const openingBcvRate = readAmount(row, line, 'tasa BCV de apertura', yes(columns, 'openingBcvRate'),
    defaults.openingBcvRate ?? 0, CATALOG_FIELD_KEYS.openingBcvRate, false);
  if ((currentStock > 0 || avgCostBs > 0) && openingBcvRate <= 0) {
    throw new Error(prefix + 'hay existencia o costo distinto de cero y falta la tasa BCV histórica. Indíquela en pantalla o en el archivo.');
  }

  const openingDateRaw = yes(columns, 'openingDate')
    ? pick(row, ...CATALOG_FIELD_KEYS.openingDate)
    : undefined;
  const openingDate = openingDateRaw || defaults.openingDate || todayLocalIso();
  if (!isValidIsoDate(openingDate)) throw new Error(prefix + 'la fecha de apertura debe ser real, con formato AAAA-MM-DD.');

  const category = (yes(columns, 'category') ? pick(row, ...CATALOG_FIELD_KEYS.category) : undefined) || defaults.category || 'General';
  const unit = (yes(columns, 'unit') ? pick(row, ...CATALOG_FIELD_KEYS.unit) : undefined) || defaults.unit || 'Unidad';

  const costingMethodRaw = (yes(columns, 'costingMethod') ? pick(row, ...CATALOG_FIELD_KEYS.costingMethod) : undefined) || defaults.costingMethod || 'PROMEDIO_PONDERADO';
  const costingMethod = /^(peps|fifo)$/i.test(costingMethodRaw) ? 'PEPS' : 'PROMEDIO_PONDERADO';

  const vatRaw = (yes(columns, 'vatTreatment') ? pick(row, ...CATALOG_FIELD_KEYS.vatTreatment) : undefined) || defaults.vatTreatment || 'GENERAL_16';
  const vatTreatment = /^(8|8%|reducida)/i.test(vatRaw) ? 'REDUCIDA_8'
    : /^(exento|0|0%)/i.test(vatRaw) ? 'EXENTO'
      : /^(exonerado)/i.test(vatRaw) ? 'EXONERADO'
        : 'GENERAL_16';

  const itemTypeRaw = (yes(columns, 'itemType') ? pick(row, ...CATALOG_FIELD_KEYS.itemType) : undefined) || defaults.itemType || 'MERCANCIA';
  const itemType = /materia/i.test(itemTypeRaw) ? 'MATERIA_PRIMA'
    : /proceso/i.test(itemTypeRaw) ? 'PRODUCTO_EN_PROCESO'
      : /terminado/i.test(itemTypeRaw) ? 'PRODUCTO_TERMINADO'
        : /subproducto/i.test(itemTypeRaw) ? 'SUBPRODUCTO'
          : 'MERCANCIA';

  const accounts = { ...DEFAULT_CATALOG_ACCOUNTS, ...(options.accounts || {}) };
  const avgCostUsd = openingBcvRate > 0 ? avgCostBs / openingBcvRate : 0;

  return {
    code,
    name,
    category,
    unit,
    minStock,
    currentStock,
    avgCostBs,
    avgCostUsd,
    lastCostBs: avgCostBs,
    lastCostUsd: avgCostUsd,
    price1,
    price2: null,
    price3: null,
    price4: null,
    priceCurrency,
    salesPriceBs,
    salesPriceUsd,
    ...(targetMarginPercent !== undefined ? { targetMarginPercent } : {}),
    inventoryAccountCode: itemType === 'PRODUCTO_EN_PROCESO' ? '1.1.4.04' : accounts.inventory,
    costOfSalesAccountCode: accounts.costOfSales,
    adjustmentAccountCode: accounts.adjustment,
    openingBalanceAccountCode: accounts.openingBalance,
    costingMethod,
    vatTreatment,
    itemType,
    openingDate,
    openingBcvRate: openingBcvRate > 0 ? openingBcvRate : 0,
  };
};

export type InventoryCatalogPreviewField = {
  key: InventoryCatalogColumnKey;
  label: string;
  /** true si el valor final provino del archivo; false si es un estándar o valor por defecto de SICOVEN. */
  fromFile: boolean;
  /** Valor final legible que quedará en el artículo. */
  value: string;
  /** true si el artículo queda en cero o vacío en ese campo. */
  empty: boolean;
  /** Explica por qué queda así (columna sin tildar, celda vacía, valor por defecto). */
  note: string;
};

export type InventoryCatalogPreviewRow = {
  line: number;
  code: string;
  name: string;
  error: string | null;
  fields: InventoryCatalogPreviewField[];
  /** Etiquetas de los campos que quedan en cero o vacíos en este artículo. */
  emptyLabels: string[];
  /** La existencia cargada genera movimiento de apertura y asiento contable. */
  createsOpeningMovement: boolean;
};

export type InventoryCatalogPreview = {
  rows: InventoryCatalogPreviewRow[];
  total: number;
  errorCount: number;
  articlesWithEmptyValues: number;
  articlesWithOpeningMovement: number;
  offFields: Array<{ key: InventoryCatalogColumnKey; label: string; whenOff: string }>;
  /** Artículos ya validados, exactamente los que se escribirán al confirmar. */
  prepared: InventoryCatalogRow[];
  ready: boolean;
};

const VAT_LABELS: Record<InventoryCatalogRow['vatTreatment'], string> = {
  GENERAL_16: '16 % general',
  REDUCIDA_8: '8 % reducida',
  EXENTO: 'Exento',
  EXONERADO: 'Exonerado',
};

const COSTING_LABELS: Record<InventoryCatalogRow['costingMethod'], string> = {
  PROMEDIO_PONDERADO: 'Promedio ponderado',
  PEPS: 'PEPS',
};

const ITEM_TYPE_LABELS: Record<InventoryCatalogRow['itemType'], string> = {
  MERCANCIA: 'Mercancía',
  MATERIA_PRIMA: 'Materia prima',
  PRODUCTO_EN_PROCESO: 'Producto en proceso',
  PRODUCTO_TERMINADO: 'Producto terminado',
  SUBPRODUCTO: 'Subproducto',
};

const formatPreviewAmount = (value: number) =>
  value.toLocaleString('es-VE', { maximumFractionDigits: 6 });

const whenOffFor = (key: InventoryCatalogColumnKey) =>
  INVENTORY_CATALOG_COLUMNS.find(column => column.key === key)?.whenOff ?? 'Queda con el valor por defecto de SICOVEN.';

const numericPreviewField = (
  key: InventoryCatalogColumnKey,
  label: string,
  value: number | undefined,
  columns: InventoryCatalogColumns,
  fileProvided: boolean
): InventoryCatalogPreviewField => {
  const columnEnabled = yes(columns, key);
  const fromFile = columnEnabled && fileProvided;
  const empty = value === undefined || !Number.isFinite(value) || value === 0;
  let note: string;
  if (fromFile) {
    note = empty
      ? 'Leído del archivo y quedó en cero.'
      : 'Leído del archivo.';
  } else if (columnEnabled) {
    note = empty
      ? 'Columna tildada, pero la celda está vacía; quedó en cero por defecto.'
      : 'Columna tildada, pero la celda está vacía; se usó el valor por defecto de SICOVEN.';
  } else {
    note = empty
      ? 'Columna sin tildar: ' + whenOffFor(key)
      : 'Columna sin tildar; se usó el valor por defecto de SICOVEN.';
  }
  return {
    key,
    label,
    fromFile,
    value: value === undefined ? 'vacío' : formatPreviewAmount(value),
    empty,
    note,
  };
};

const textPreviewField = (
  key: InventoryCatalogColumnKey,
  label: string,
  value: string | undefined,
  columns: InventoryCatalogColumns,
  fileProvided: boolean
): InventoryCatalogPreviewField => {
  const columnEnabled = yes(columns, key);
  const fromFile = columnEnabled && fileProvided;
  const text = (value ?? '').trim();
  let note: string;
  if (fromFile) {
    note = text === '' ? 'Leído del archivo, pero la celda está vacía.' : 'Leído del archivo.';
  } else if (columnEnabled) {
    note = text === ''
      ? 'Columna tildada, pero la celda está vacía.'
      : 'Columna tildada, pero la celda está vacía; se usó el estándar de SICOVEN.';
  } else {
    note = text === ''
      ? 'Columna sin tildar: ' + whenOffFor(key)
      : 'Columna sin tildar; se usó el estándar de SICOVEN.';
  }
  return {
    key,
    label,
    fromFile,
    value: text || 'vacío',
    empty: text === '',
    note,
  };
};

const previewFieldsFor = (
  row: Record<string, string>,
  product: InventoryCatalogRow,
  columns: InventoryCatalogColumns
): InventoryCatalogPreviewField[] => [
  numericPreviewField('currentStock', 'Existencia', product.currentStock, columns, fileProvidesCatalogField(row, 'currentStock')),
  numericPreviewField('avgCostBs', 'Costo promedio (Bs)', product.avgCostBs, columns, fileProvidesCatalogField(row, 'avgCostBs')),
  numericPreviewField(
    'price1',
    'Precio de venta',
    product.price1,
    columns,
    fileProvidesCatalogField(row, 'price1')
      || (!yes(columns, 'price1') && (yes(columns, 'salesPriceBs') && fileProvidesCatalogField(row, 'salesPriceBs')))
      || (!yes(columns, 'price1') && !yes(columns, 'salesPriceBs') && yes(columns, 'salesPriceUsd') && fileProvidesCatalogField(row, 'salesPriceUsd'))
  ),
  numericPreviewField('targetMarginPercent', 'Margen de ganancia (%)', product.targetMarginPercent, columns, fileProvidesCatalogField(row, 'targetMarginPercent')),
  numericPreviewField('minStock', 'Stock mínimo', product.minStock, columns, fileProvidesCatalogField(row, 'minStock')),
  textPreviewField('category', 'Categoría', product.category, columns, fileProvidesCatalogField(row, 'category')),
  textPreviewField('unit', 'Unidad de medida', product.unit, columns, fileProvidesCatalogField(row, 'unit')),
  textPreviewField('vatTreatment', 'Alícuota de IVA', VAT_LABELS[product.vatTreatment], columns, fileProvidesCatalogField(row, 'vatTreatment')),
  textPreviewField('itemType', 'Tipo de artículo', ITEM_TYPE_LABELS[product.itemType], columns, fileProvidesCatalogField(row, 'itemType')),
  textPreviewField('costingMethod', 'Método de costeo', COSTING_LABELS[product.costingMethod], columns, fileProvidesCatalogField(row, 'costingMethod')),
  numericPreviewField('openingBcvRate', 'Tasa BCV de apertura', product.openingBcvRate, columns, fileProvidesCatalogField(row, 'openingBcvRate')),
];

/**
 * Arma la vista previa del catálogo antes de escribir en SQLite: por artículo
 * muestra el valor final de cada columna elegida y marca los que quedan en cero
 * o vacíos, con el motivo (columna sin tildar, celda vacía o valor por defecto).
 * No lanza por filas inválidas ni duplicadas: las informa para que el contador
 * corrija el archivo o las columnas sin que se escriba nada.
 */
export const buildCatalogImportPreview = (
  rows: Array<Record<string, string>>,
  options: InventoryCatalogOptions
): InventoryCatalogPreview => {
  const columns = options.columns || {};
  const seenCodes = new Map<string, number>();
  const previewRows: InventoryCatalogPreviewRow[] = [];
  const prepared: InventoryCatalogRow[] = [];

  rows.forEach((row, index) => {
    const line = index + 2;
    const rawCode = pick(row, 'code', 'codigo', 'sku', 'productCode', 'codigoProducto') || '';
    const rawName = pick(row, 'name', 'nombre', 'productName', 'producto', 'descripcion') || '';
    let product: InventoryCatalogRow | null = null;
    let error: string | null = null;
    // El código repetido se informa aunque otra validación de la fila falle:
    // el archivo sigue teniendo el duplicado y el contador debe verlo.
    const rawKey = rawCode.trim().toUpperCase();
    const previousLine = rawKey ? seenCodes.get(rawKey) : undefined;
    if (rawKey && previousLine === undefined) seenCodes.set(rawKey, line);
    try {
      product = validateCatalogInventoryRow(row, line, options);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Fila ' + line + ': no se pudo validar el artículo.';
    }
    if (!error && previousLine !== undefined) {
      error = 'Fila ' + line + ': el código ' + (product?.code || rawCode) + ' está repetido en el archivo (ya aparece en la fila ' + previousLine + ').';
    }

    const fields = product ? previewFieldsFor(row, product, columns) : [];
    if (product && !error) prepared.push(product);
    previewRows.push({
      line,
      code: product?.code || rawCode,
      name: product?.name || rawName,
      error,
      fields,
      emptyLabels: fields.filter(field => field.empty).map(field => field.label),
      createsOpeningMovement: Boolean(product && product.currentStock > 0),
    });
  });

  const errorCount = previewRows.filter(row => row.error).length;
  return {
    rows: previewRows,
    total: previewRows.length,
    errorCount,
    articlesWithEmptyValues: previewRows.filter(row => row.fields.some(field => field.empty)).length,
    articlesWithOpeningMovement: previewRows.filter(row => row.createsOpeningMovement).length,
    offFields: INVENTORY_CATALOG_COLUMNS.filter(column => columns[column.key] !== true),
    prepared,
    ready: previewRows.length > 0 && errorCount === 0,
  };
};

/** Valida el lote completo y rechaza códigos repetidos antes de escribir nada. */
export const validateCatalogInventoryBatch = (
  rows: Array<Record<string, string>>,
  options: InventoryCatalogOptions
): InventoryCatalogRow[] => {
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const product = validateCatalogInventoryRow(row, index + 2, options);
    const key = product.code.trim().toUpperCase();
    if (seen.has(key)) throw new Error('Fila ' + (index + 2) + ': el código ' + product.code + ' está repetido en el archivo.');
    seen.add(key);
    return product;
  });
};
