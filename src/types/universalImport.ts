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

export const resolveUniversalInvoiceSettlementRows = (
  rows: Array<Record<string, unknown>>,
  invoice: Record<string, unknown>
): Array<Record<string, unknown>> => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (record: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  };
  const ids = ['id','invoiceId','saleId','purchaseId','documentId','uuid','idFactura','idVenta','idCompra']
    .map(key => pickValue(invoice, [key])).filter(value => value !== undefined).map(normalize);
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 1) throw new Error('La factura contiene identificadores incompatibles; no se pueden enlazar sus cobros/pagos con seguridad.');
  if (!uniqueIds.length) return [];
  const fileId = String(invoice.migrationfile ?? '');
  const foreignKeys = ['invoiceId','saleId','purchaseId','documentId','facturaId','ventaId','compraId','idFactura','idVenta','idCompra','invoice_id','sale_id','purchase_id','document_id'];
  const dateKeys = ['settlementDate','paymentDate','collectionDate','fechaPago','fechaCobro','date','fecha'];
  const amountKeys = ['settlementAmountBs','paymentAmountBs','collectionAmountBs','amountBs','amountUsd','amount','importe','monto','montoBs','montoUsd'];
  const evidenceKeys = ['method','paymentMethod','settlementMethod','collectionMethod','medioPago','formaPago','reference','paymentReference','collectionReference','referenceNumber','comprobante','bankAccountId','transactionId'];
  return rows.filter(candidate => {
    if (candidate === invoice || String(candidate.migrationfile ?? '') !== fileId) return false;
    const reference = pickValue(candidate, foreignKeys);
    if (reference === undefined || normalize(reference) !== uniqueIds[0]) return false;
    const productCode = pickValue(candidate, ['productCode','codigoProducto','productSku','sku','itemCode','codigo','code']);
    const quantity = pickValue(candidate, ['quantity','cantidad','qty']);
    if (productCode !== undefined && quantity !== undefined) return false;
    return pickValue(candidate, dateKeys) !== undefined &&
      pickValue(candidate, amountKeys) !== undefined &&
      pickValue(candidate, evidenceKeys) !== undefined;
  });
};

export const hasUniversalInlineSettlementAmount = (invoice: Record<string, unknown>): boolean => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys = new Set([
    'paidAmountBs','amountPaidBs','collectedAmountBs','amountCollectedBs','settledAmountBs','amountSettledBs',
    'totalPaidBs','totalCollectedBs','paymentsTotalBs','montoPagadoBs','montoCobradoBs','abonosBs',
    'paidAmountUsd','amountPaidUsd','collectedAmountUsd','amountCollectedUsd','settledAmountUsd','amountSettledUsd'
  ].map(normalize));
  for (const [key, value] of Object.entries(invoice)) {
    if (!keys.has(normalize(key)) || value === undefined || value === null || String(value).trim() === '') continue;
    let raw = String(value).trim().replace(/[^0-9,.-]/g, '');
    if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\\./g, '').replace(',', '.');
    else raw = raw.replace(',', '.');
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount > 0.000001) return true;
  }
  return false;
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
