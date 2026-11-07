import type { InventoryProduct, SaleInventoryLine } from './accounting';

export type UniversalJsonCollection = {
  path: string;
  rows: Record<string, unknown>[];
  totalItems: number;
  invalidItems: number;
};

/**
 * Descubre colecciones de registros dentro de JSON de terceros sin asumir
 * nombres de software, claves de colección ni una estructura POSVEN concreta.
 * No recorre dentro de cada fila para evitar separar detalles hijos como
 * colecciones independientes sin conocer sus relaciones.
 */
export const extractUniversalJsonCollections = (value: unknown): UniversalJsonCollection[] => {
  const collections: UniversalJsonCollection[] = [];

  const addArray = (path: string, items: unknown[]) => {
    const rows = items.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)
    );
    // También se conservan arreglos escalares o mixtos para explicar
    // cuántos elementos no pueden tratarse como registros importables.
    collections.push({
      path,
      rows,
      totalItems: items.length,
      invalidItems: items.length - rows.length
    });
  };

  const visit = (node: unknown, path: string, depth: number) => {
    if (depth > 8 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      addArray(path || '$', node);
      return;
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = path ? path + '.' + key : key;
      if (Array.isArray(child)) addArray(childPath, child);
      else if (child && typeof child === 'object') visit(child, childPath, depth + 1);
    }
  };

  if (Array.isArray(value)) addArray('$', value);
  else visit(value, '', 0);

  return collections;
};


export type UniversalPartyKind = 'customer' | 'supplier';
export type UniversalPartyResolution = { name: string; rif: string; address?: string; email?: string; taxStatus?: string; source: 'inline' | 'related-record' };

/**
 * Resuelve la contraparte solo mediante una clave explícita dentro del mismo
 * archivo de origen. Nunca cruza archivos ni elige coincidencias ambiguas.
 */
export const resolveUniversalPartyReference = (
  rows: Array<Record<string, unknown>>,
  invoice: Record<string, unknown>,
  kind: UniversalPartyKind
): UniversalPartyResolution => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (record: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  };
  const customer = kind === 'customer';
  const nameKeys = customer
    ? ['customerName','clientName','cliente','nombreCliente','name','nombre','razonSocial','businessName']
    : ['supplierName','vendorName','proveedor','nombreProveedor','name','nombre','razonSocial','businessName'];
  const rifKeys = customer
    ? ['customerRif','clientRif','rifCliente','rif','taxId','identificacion']
    : ['supplierRif','vendorRif','rifProveedor','rif','taxId','identificacion'];
  const referenceKeys = customer
    ? ['customerId','clientId','clienteId','idCliente','customer_id','client_id','cliente_id','idcliente']
    : ['supplierId','vendorId','proveedorId','idProveedor','supplier_id','vendor_id','proveedor_id','idproveedor'];
  const addressKeys = customer
    ? ['customerAddress','clientAddress','direccionCliente','address','direccion']
    : ['supplierAddress','vendorAddress','direccionProveedor','address','direccion'];
  const emailKeys = customer
    ? ['customerEmail','clientEmail','correoCliente','email','correo']
    : ['supplierEmail','vendorEmail','correoProveedor','email','correo'];
  const taxStatusKeys = ['supplierTaxStatus','taxStatus','condicionFiscal','tipoContribuyente','supplierType'];
  const resolution = (record: Record<string, unknown>, source: 'inline' | 'related-record'): UniversalPartyResolution => {
    const address = pickValue(record, addressKeys);
    const email = customer ? undefined : pickValue(record, emailKeys);
    const taxStatus = customer ? undefined : pickValue(record, taxStatusKeys);
    return {
      name: String(pickValue(record, nameKeys)).trim(),
      rif: String(pickValue(record, rifKeys)).trim(),
      ...(address === undefined ? {} : { address: String(address).trim() }),
      ...(email === undefined ? {} : { email: String(email).trim() }),
      ...(taxStatus === undefined ? {} : { taxStatus: String(taxStatus).trim() }),
      source
    };
  };
  const inlineName = pickValue(invoice, nameKeys);
  const inlineRif = pickValue(invoice, rifKeys);
  if (inlineName && inlineRif) return resolution(invoice, 'inline');

  const reference = pickValue(invoice, referenceKeys);
  if (reference === undefined) {
    throw new Error('La factura no contiene nombre y RIF de la contraparte ni una referencia explícita para resolverla.');
  }
  const fileId = String(invoice.migrationfile ?? '');
  const candidateIdKeys = customer
    ? ['id','customerId','clientId','clienteId','idCliente','customer_id','client_id','cliente_id']
    : ['id','supplierId','vendorId','proveedorId','idProveedor','supplier_id','vendor_id','proveedor_id'];
  const matches = rows.filter(candidate => {
    if (String(candidate.migrationfile ?? '') !== fileId) return false;
    const candidateId = pickValue(candidate, candidateIdKeys);
    return candidateId !== undefined && normalize(candidateId) === normalize(reference) &&
      Boolean(pickValue(candidate, nameKeys)) && Boolean(pickValue(candidate, rifKeys));
  });
  if (matches.length === 0) throw new Error('No se pudo resolver la referencia '+String(reference)+' de '+(customer?'cliente':'proveedor')+' dentro del mismo archivo. No se importó la factura.');
  if (matches.length > 1) throw new Error('La referencia '+String(reference)+' de '+(customer?'cliente':'proveedor')+' coincide con varios registros del mismo archivo. Corrige la ambigüedad antes de importar.');
  return resolution(matches[0], 'related-record');
};


/**
 * Obtiene renglones de compra guardados en otra colección del mismo archivo.
 * Solo usa claves foráneas explícitas y un identificador inequívoco de factura.
 */
export const resolveUniversalPurchaseDetailRows = (
  rows: Array<Record<string, unknown>>,
  invoice: Record<string, unknown>
): Array<Record<string, unknown>> => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (record: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  };
  const invoiceIds = ['id','invoiceId','purchaseId','documentId','uuid','idFactura','idCompra']
    .map(key => pickValue(invoice, [key]))
    .filter(value => value !== undefined)
    .map(normalize);
  const uniqueIds = [...new Set(invoiceIds)];
  if (uniqueIds.length > 1) throw new Error('La factura contiene identificadores incompatibles; no se pueden enlazar sus renglones con seguridad.');
  if (!uniqueIds.length) return [];
  const fileId = String(invoice.migrationfile ?? '');
  const foreignKeys = ['invoiceId','purchaseId','documentId','facturaId','compraId','idFactura','idCompra','invoice_id','purchase_id','document_id','factura_id','compra_id'];
  const matches = rows.filter(candidate => {
    if (candidate === invoice || String(candidate.migrationfile ?? '') !== fileId) return false;
    const reference = pickValue(candidate, foreignKeys);
    if (reference === undefined || normalize(reference) !== uniqueIds[0]) return false;
    const productCode = pickValue(candidate, ['productCode','codigoProducto','productSku','sku','itemCode','codigo','code']);
    const quantity = pickValue(candidate, ['quantity','cantidad','qty']);
    const unitCost = pickValue(candidate, ['unitCostBs','costoUnitarioBs','unitCost','costoUnitario','costBs']);
    return productCode !== undefined || quantity !== undefined || unitCost !== undefined;
  });
  return matches;
};


export const prepareUniversalSaleInventoryLines = (
  rawLines: unknown[],
  products: Pick<InventoryProduct, 'id' | 'code' | 'name' | 'vatTreatment'>[],
  invoice: { taxRate: number; taxableBaseBs: number; exemptAmountBs: number; vatAmountBs: number; bcvRate?: number }
): SaleInventoryLine[] => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error('La factura no contiene renglones de mercancía importables.');
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (row: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    return Object.entries(row).find(([key, value]) => wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '')?.[1];
  };
  const parseNumber = (value: unknown): number => {
    if (typeof value === 'number') return value;
    const raw = String(value ?? '').trim().replace(/\s/g, '');
    if (!raw) return NaN;
    const normalized = raw.includes(',') && raw.includes('.')
      ? (raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
      : raw.replace(',', '.');
    return Number(normalized);
  };
  const rateForTreatment = (treatment: InventoryProduct['vatTreatment']): number => {
    if (treatment === 'GENERAL_16') return 16;
    if (treatment === 'REDUCIDA_8') return 8;
    if (treatment === 'EXENTO' || treatment === 'EXONERADO') return 0;
    throw new Error('El artículo no tiene un tratamiento IVA explícito compatible con la factura.');
  };
  const seen = new Set<string>();
  const result = rawLines.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Detalle '+(index+1)+': el renglón no es un objeto válido.');
    const row = raw as Record<string, unknown>;
    const code = String(pickValue(row, ['productCode','codigoProducto','sku','code','codigo','itemCode']) ?? '').trim();
    const product = products.find(item => item.code.trim().toLowerCase() === code.toLowerCase());
    const quantity = parseNumber(pickValue(row, ['quantity','cantidad','qty']));
    const explicitPriceBs = pickValue(row, ['unitPriceBs','precioUnitarioBs','priceBs','precioBs']);
    const explicitPriceUsd = pickValue(row, ['unitPriceUsd','precioUnitarioUsd','priceUsd','precioUsd']);
    const genericPrice = pickValue(row, ['unitPrice','precioUnitario','price','precio']);
    const currency = normalize(pickValue(row, ['currency','moneda','currencyCode']));
    const genericIsBs = ['bs','ves','bolivar','bolivares'].includes(currency);
    const genericIsUsd = ['usd','us','dolar','dolares'].includes(currency);
    const genericBsValue = genericIsBs ? genericPrice : undefined;
    const genericUsdValue = genericIsUsd ? genericPrice : undefined;
    const priceUsdRaw = explicitPriceUsd ?? genericUsdValue;
    const unitPriceUsd = priceUsdRaw === undefined ? undefined : parseNumber(priceUsdRaw);
    const bcvRate = Number(invoice.bcvRate);
    const unitPriceBs = explicitPriceBs !== undefined || genericBsValue !== undefined
      ? parseNumber(explicitPriceBs ?? genericBsValue)
      : unitPriceUsd !== undefined && Number.isFinite(bcvRate) && bcvRate > 0 ? unitPriceUsd * bcvRate : NaN;
    if (explicitPriceBs !== undefined && unitPriceUsd !== undefined &&
        Math.abs(parseNumber(explicitPriceBs) / bcvRate - unitPriceUsd) > 0.02) {
      throw new Error('Detalle '+(index+1)+': el precio unitario Bs/USD no concilia con la tasa BCV declarada.');
    }
    if (!product || !code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPriceBs) || unitPriceBs <= 0) {
      throw new Error('Detalle '+(index+1)+': identifique un artículo existente de la empresa destino por código/SKU y declare cantidad y precio unitario Bs positivos. No se asociará por descripción.');
    }
    if (seen.has(product.id)) throw new Error('Detalle '+(index+1)+': el mismo artículo aparece más de una vez. Consolide sus renglones antes de importar.');
    seen.add(product.id);
    const productRate = rateForTreatment(product.vatTreatment);
    const declaredRateRaw = pickValue(row, ['taxRate','alicuota','tasaIva','vatRate']);
    const declaredRate = declaredRateRaw === undefined ? productRate : parseNumber(declaredRateRaw);
    if (declaredRate !== productRate || (productRate !== 0 && productRate !== invoice.taxRate) || invoice.taxRate === 31) {
      throw new Error('Detalle '+(index+1)+': la alícuota del artículo no coincide con la factura o requiere tratamiento fiscal por línea no soportado. No se mezclan tasas ni se infiere impuesto suntuario.');
    }
    const netAmountBs = Math.round(quantity * unitPriceBs * 100) / 100;
    const declaredNet = pickValue(row, ['netAmountBs','lineTotalBs','subtotalBs','baseImponibleBs','totalLineaBs']);
    if (declaredNet !== undefined && Math.abs(parseNumber(declaredNet) - netAmountBs) > 0.02) {
      throw new Error('Detalle '+(index+1)+': el subtotal declarado no coincide con cantidad por precio unitario. Descuentos o cargos por línea requieren un adaptador explícito.');
    }
    const taxable = productRate === 0 ? 0 : netAmountBs;
    const exempt = productRate === 0 ? netAmountBs : 0;
    const vatAmountBs = Math.round(taxable * productRate) / 100;
    return { productId: product.id, productCode: product.code, productName: product.name, quantity, unitPriceBs, unitPriceUsd, netAmountBs, taxRate: productRate, vatAmountBs, exemptAmountBs: exempt, totalBs: netAmountBs + vatAmountBs };
  });
  const sum = (key: 'netAmountBs' | 'vatAmountBs' | 'exemptAmountBs') => Math.round(result.reduce((total, line) => total + line[key], 0) * 100) / 100;
  if (Math.abs(sum('netAmountBs') - (invoice.taxableBaseBs + invoice.exemptAmountBs)) > 0.02 ||
      Math.abs(sum('vatAmountBs') - invoice.vatAmountBs) > 0.02 ||
      Math.abs(sum('exemptAmountBs') - invoice.exemptAmountBs) > 0.02) {
    throw new Error('Los renglones de mercancía no concilian con base imponible, exento e IVA de la factura. No se importó ningún documento.');
  }
  return result;
};

export const prepareUniversalPurchaseInventoryLines = (
  rawLines: unknown[],
  products: Pick<InventoryProduct, 'id' | 'code'>[],
  invoice: { taxableBaseBs: number; exemptAmountBs: number; bcvRate: number }
): Array<{ productId: string; quantity: number; unitCostBs: number }> => {
  if (!Array.isArray(rawLines) || rawLines.length === 0) throw new Error('La factura no contiene renglones de mercancía importables.');
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (row: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    return Object.entries(row).find(([key, value]) => wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '')?.[1];
  };
  const parseNumber = (value: unknown): number => {
    if (typeof value === 'number') return value;
    const raw = String(value ?? '').trim().replace(/\\s/g, '');
    if (!raw) return NaN;
    const normalized = raw.includes(',') && raw.includes('.')
      ? (raw.lastIndexOf(',') > raw.lastIndexOf('.') ? raw.replace(/\\./g, '').replace(',', '.') : raw.replace(/,/g, ''))
      : raw.replace(',', '.');
    return Number(normalized);
  };
  const rate = Number(invoice.bcvRate);
  if (!Number.isFinite(rate) || rate <= 0) throw new Error('La compra requiere una tasa BCV positiva para valorar sus líneas de inventario.');
  const seen = new Set<string>();
  const result = rawLines.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Detalle '+(index+1)+': el renglón no es un objeto válido.');
    const row = raw as Record<string, unknown>;
    const code = String(pickValue(row, ['productCode','codigoProducto','sku','code','codigo','itemCode']) ?? '').trim();
    const product = products.find(item => item.code.trim().toLowerCase() === code.toLowerCase());
    const quantity = parseNumber(pickValue(row, ['quantity','cantidad','qty']));
    const explicitBs = pickValue(row, ['unitCostBs','costoUnitarioBs','costBs','costoBs']);
    const explicitUsd = pickValue(row, ['unitCostUsd','costoUnitarioUsd','costUsd','costoUsd']);
    const genericCost = pickValue(row, ['unitCost','costoUnitario','cost','costo','price','precio']);
    const currency = normalize(pickValue(row, ['currency','moneda','currencyCode']));
    const genericBs = ['bs','ves','bolivar','bolivares'].includes(currency) ? genericCost : undefined;
    const genericUsd = ['usd','us','dolar','dolares'].includes(currency) ? genericCost : undefined;
    const usdValue = explicitUsd ?? genericUsd;
    const unitCostUsd = usdValue === undefined ? undefined : parseNumber(usdValue);
    const bsValue = explicitBs ?? genericBs;
    const unitCostBs = bsValue !== undefined ? parseNumber(bsValue)
      : unitCostUsd !== undefined ? unitCostUsd * rate : NaN;
    if (bsValue !== undefined && unitCostUsd !== undefined && Math.abs(unitCostBs / rate - unitCostUsd) > 0.02) {
      throw new Error('Detalle '+(index+1)+': el costo unitario Bs/USD no concilia con la tasa BCV declarada.');
    }
    if (!product || !code || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCostBs) || unitCostBs <= 0) {
      throw new Error('Detalle '+(index+1)+': identifique un artículo existente de la empresa destino por código/SKU y declare cantidad y costo unitario Bs positivo, o costo USD con moneda/tasa BCV explícita. No se asociará por descripción.');
    }
    if (seen.has(product.id)) throw new Error('Detalle '+(index+1)+': el mismo artículo aparece más de una vez. Consolide sus renglones antes de importar.');
    seen.add(product.id);
    const declaredTotal = pickValue(row, ['lineTotalBs','subtotalBs','totalLineaBs','totalCostBs','importeBs']);
    if (declaredTotal !== undefined && Math.abs(parseNumber(declaredTotal) - quantity * unitCostBs) > 0.02) {
      throw new Error('Detalle '+(index+1)+': el total declarado no coincide con cantidad por costo unitario. Descuentos, fletes o cargos por línea requieren un adaptador explícito.');
    }
    return { productId: product.id, quantity, unitCostBs };
  });
  const expected = Number(invoice.taxableBaseBs) + Number(invoice.exemptAmountBs);
  const actual = result.reduce((sum, line) => sum + line.quantity * line.unitCostBs, 0);
  if (!Number.isFinite(expected) || expected < 0 || Math.abs(Math.round(actual * 100) / 100 - Math.round(expected * 100) / 100) > 0.02) {
    throw new Error('Los renglones de mercancía no concilian con la base imponible más el monto exento de la factura.');
  }
  return result;
};

export type UniversalInventoryMovementType = 'ENTRADA' | 'SALIDA' | 'AJUSTE';
export type UniversalInventoryMovementConcept = 'COMPRA' | 'INVENTARIO_INICIAL' | 'VENTA' | 'MERMA' | 'AUTOCONSUMO' | 'AJUSTE' | 'DEVOLUCION_CLIENTE' | 'DEVOLUCION_COMPRA';

const normalizeUniversalValue = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const mapUniversalInventoryMovementType = (value: unknown): UniversalInventoryMovementType | null => {
  const key = normalizeUniversalValue(value);
  const map: Record<string, UniversalInventoryMovementType> = {
    entrada: 'ENTRADA', in: 'ENTRADA', purchase: 'ENTRADA', compra: 'ENTRADA', opening: 'ENTRADA',
    salida: 'SALIDA', out: 'SALIDA', sale: 'SALIDA', venta: 'SALIDA',
    ajuste: 'AJUSTE', adjustment: 'AJUSTE'
  };
  return map[key] ?? null;
};

export const mapUniversalInventoryMovementConcept = (value: unknown): UniversalInventoryMovementConcept | null => {
  const key = normalizeUniversalValue(value);
  const map: Record<string, UniversalInventoryMovementConcept> = {
    compra: 'COMPRA', purchase: 'COMPRA',
    inventarioinicial: 'INVENTARIO_INICIAL', openinginventory: 'INVENTARIO_INICIAL',
    venta: 'VENTA', sale: 'VENTA',
    merma: 'MERMA', loss: 'MERMA',
    autoconsumo: 'AUTOCONSUMO', selfconsumption: 'AUTOCONSUMO',
    ajuste: 'AJUSTE', adjustment: 'AJUSTE',
    devolucioncliente: 'DEVOLUCION_CLIENTE', devoluciondecliente: 'DEVOLUCION_CLIENTE', customerreturn: 'DEVOLUCION_CLIENTE',
    devolucioncompra: 'DEVOLUCION_COMPRA', devoluciondecompra: 'DEVOLUCION_COMPRA', devolucionaproveedor: 'DEVOLUCION_COMPRA', supplierreturn: 'DEVOLUCION_COMPRA'
  };
  return map[key] ?? null;
};

export const hasUniversalNestedMerchandiseDetails = (invoice: Record<string, unknown>): boolean => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Set(['saleLines','inventoryLines','productLines','items','lines','details','detalles','detalle','articulos','productos'].map(normalize));
  const nestedCollections = Object.entries(invoice)
    .filter(([key, value]) => wanted.has(normalize(key)) && Array.isArray(value))
    .map(([, value]) => value as unknown[]);
  return nestedCollections.some(nested => nested.some((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const line = value as Record<string, unknown>;
    const lineKeys = new Set(Object.keys(line).map(normalize));
    const hasCode = ['productCode','codigoProducto','productSku','sku','itemCode','codigo','code'].some(key => lineKeys.has(normalize(key)));
    const hasQuantity = ['quantity','cantidad','qty'].some(key => lineKeys.has(normalize(key)));
    return hasCode && hasQuantity;
  }));
};

export type UniversalImportFormat = 'json' | 'csv' | 'tsv' | 'txt' | 'xlsx' | 'xlsm' | 'unsupported';

export const detectUniversalImportFormat = (fileName: string): UniversalImportFormat => {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  return ['json', 'csv', 'tsv', 'txt', 'xlsx', 'xlsm'].includes(extension)
    ? extension as UniversalImportFormat
    : 'unsupported';
};

export type ImportSourceSystem = {
  id: 'posven-pro' | 'unknown';
  label: string;
  confidence: 'explicit' | 'unknown';
};

/**
 * Identifica el software de origen solo cuando el propio contenido lo declara.
 * La extensión del archivo nunca se usa para inferir qué sistema lo generó.
 */
export const detectImportSourceSystem = (value: unknown): ImportSourceSystem => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { id: 'unknown', label: 'Sistema de origen no identificado', confidence: 'unknown' };
  }
  const record = value as Record<string, unknown>;
  const metadataCandidates = [record, record.metadata, record.meta]
    .filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate)) as Record<string, unknown>[];
  const declaredValues = metadataCandidates.flatMap(candidate =>
    Object.entries(candidate)
      .filter(([key]) => ['app','application','system','software','sourcesystem'].includes(key.toLowerCase().replace(/[^a-z]/g, '')))
      .map(([, declared]) => String(declared ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
  );
  if (declaredValues.some(declared => ['posvenpro','posven'].includes(declared))) {
    return { id: 'posven-pro', label: 'POSVEN-Pro', confidence: 'explicit' };
  }
  return { id: 'unknown', label: 'Sistema de origen no identificado', confidence: 'unknown' };
};
