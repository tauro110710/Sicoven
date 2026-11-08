import type { InventoryProduct, SaleInventoryLine } from './accounting';
import type { SupplierDirectAdvanceDraft } from './supplierDirectAdvance';
import type { SupplierAdvanceSettlementDraft } from './supplierAdvanceSettlement';

export type UniversalSupplierDirectAdvanceDraft = { sourceRowId: string; draft: SupplierDirectAdvanceDraft };
export type UniversalSupplierAdvanceSettlementDraft = { sourceRowId: string; draft: SupplierAdvanceSettlementDraft };

export const isUniversalProductCollectionPath = (path: string): boolean =>
  /(^|\.)(productos|products|inventory|inventario)$/i.test(path.trim());

export const getUniversalJsonValueAtPath = (root: unknown, path: string): unknown =>
  path.split('.').filter(Boolean).reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    return (current as Record<string, unknown>)[key];
  }, root);

export type PosvenBackupMappingAnalysis = {
  salesInvoices: number; salesCollectionReceipts: number; salesDetailLines: number;
  salesProductLines: number; unresolvedSalesProductLines: number; salesWithLinkedReceivable: number;
  salesMissingFiscalControl: number; salesMissingCustomerRif: number; salesMissingTaxRate: number;
  purchases: number; purchasesWithUniqueSupplier: number; purchasesWithoutSupplierMatch: number;
  purchasesMissingBcvRate: number; purchasesMissingFiscalControl: number; purchasesMissingTaxBreakdown: number;
  receivables: number; receivablesLinkedToSales: number; receivablesWithoutSaleLink: number; receivablePaymentEvents: number;
  payables: number; payablesWithUniquePurchaseMatch: number; payablesWithAmbiguousPurchaseMatch: number; payablesWithoutPurchaseMatch: number; payablePaymentEvents: number;
  movements: number; movementsWithProductResolved: number; movementSaleRows: number; movementPurchaseRows: number;
  movementOpeningRows: number; movementAdjustmentRows: number; movementOtherRows: number; movementsMissingCostAndBcv: number;
  cashbookRows: number; cashbookRowsWithDoubleEntryAccounts: number; cashbookRowsWithDebitCredit: number;
  cashSessions: number; terminals: number; zReports: number; returns: number; returnsLinkedToSales: number;
  voids: number; voidsLinkedToSales: number; hasBankAccounts: boolean; hasRetentionVouchers: boolean;
  hasFixedAssets: boolean; hasChartOfAccounts: boolean; users: number;
};

export const analyzePosvenBackupMapping = (root: unknown): PosvenBackupMappingAnalysis => {
  const data = root && typeof root === 'object' && !Array.isArray(root)
    ? (root as Record<string, unknown>).data : undefined;
  const source = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown> : {};
  const list = (key: string): Array<Record<string, unknown>> => {
    const value = source[key];
    return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
  };
  const norm = (value: unknown) => String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (row: Record<string, unknown>, ...keys: string[]) => {
    for (const key of keys) {
      const value = Object.entries(row).find(([field, cell]) => norm(field) === norm(key) &&
        cell !== undefined && cell !== null && String(cell).trim() !== '')?.[1];
      if (value !== undefined) return value;
    }
    return undefined;
  };
  const products = list('productos');
  const productIds = new Set(products.map(row => String(row.id ?? '')).filter(Boolean));
  const sales = list('ventas');
  const receivables = list('cxc');
  const saleIds = new Set(sales.map(row => String(row.id ?? '')).filter(Boolean));
  const receiptRows = sales.filter(row => /^C\d+-CXC-/i.test(String(row.id ?? '')) ||
    (Array.isArray(row.items) && row.items.some(item => item && typeof item === 'object' &&
      norm((item as Record<string, unknown>).productoId) === 'abono')));
  const invoiceRows = sales.filter(row => !receiptRows.includes(row));
  const receivableSaleIds = new Set(receivables.flatMap(row =>
    [row.ventaId, row.facturaId].filter(Boolean).map(String)));
  const saleLines = invoiceRows.flatMap(row => Array.isArray(row.items) ? row.items : [])
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item));
  const productSaleLines = saleLines.filter(item => norm(item.productoId) !== 'abono' && Boolean(item.productoId));
  const unresolvedSalesProductLines = productSaleLines.filter(item => !productIds.has(String(item.productoId))).length;
  const suppliersByName = new Map<string, number>();
  list('proveedores').forEach(row => {
    const name = norm(row.nombre ?? row.name);
    if (name) suppliersByName.set(name, (suppliersByName.get(name) ?? 0) + 1);
  });
  const purchases = list('compras');
  const payables = list('cxp');
  const purchasesForPayable = (payable: Record<string, unknown>) => {
    const invoiceNo = norm(payable.numeroFactura ?? String(payable.concepto ?? '').split('#').pop());
    const supplier = norm(payable.proveedor);
    return purchases.filter(purchase => norm(purchase.numeroFactura) === invoiceNo &&
      norm(purchase.proveedor) === supplier);
  };
  const payableMatches = payables.map(purchasesForPayable);
  const movements = list('movimientos');
  const movementTypeCounts = new Map<string, number>();
  movements.forEach(row => {
    const type = norm(row.tipo);
    movementTypeCounts.set(type, (movementTypeCounts.get(type) ?? 0) + 1);
  });
  const journal = list('libroDiario');
  const cashSessions = list('terminales').reduce((sum, terminal) =>
    sum + (Array.isArray(terminal.cashHistory) ? terminal.cashHistory.length : 0), 0);
  const returns = list('devoluciones');
  const voids = list('anulaciones');
  const hasFields = (row: Record<string, unknown>, keys: string[]) =>
    keys.some(key => pick(row, key) !== undefined);
  return {
    salesInvoices: invoiceRows.length,
    salesCollectionReceipts: receiptRows.length,
    salesDetailLines: saleLines.length,
    salesProductLines: productSaleLines.length,
    unresolvedSalesProductLines,
    salesWithLinkedReceivable: invoiceRows.filter(row => receivableSaleIds.has(String(row.id ?? ''))).length,
    salesMissingFiscalControl: invoiceRows.filter(row => !hasFields(row, ['controlNumber','numeroControl','nroControl'])).length,
    salesMissingCustomerRif: invoiceRows.filter(row => !hasFields(row, ['customerRif','rifCliente','rif','taxId'])).length,
    salesMissingTaxRate: invoiceRows.filter(row => !hasFields(row, ['taxRate','alicuota','tasaIva'])).length,
    purchases: purchases.length,
    purchasesWithUniqueSupplier: purchases.filter(row => suppliersByName.get(norm(row.proveedor)) === 1).length,
    purchasesWithoutSupplierMatch: purchases.filter(row => suppliersByName.get(norm(row.proveedor)) !== 1).length,
    purchasesMissingBcvRate: purchases.filter(row => !hasFields(row, ['bcvRate','tasaBcv','tasa'])).length,
    purchasesMissingFiscalControl: purchases.filter(row => !hasFields(row, ['controlNumber','numeroControl','nroControl'])).length,
    purchasesMissingTaxBreakdown: purchases.filter(row => !hasFields(row, ['taxableBaseBs','baseImponibleBs']) ||
      !hasFields(row, ['vatAmountBs','ivaBs']) || !hasFields(row, ['exemptAmountBs','exentoBs'])).length,
    receivables: receivables.length,
    receivablesLinkedToSales: receivables.filter(row => [row.ventaId,row.facturaId].some(id => id && saleIds.has(String(id)))).length,
    receivablesWithoutSaleLink: receivables.filter(row => ![row.ventaId,row.facturaId].some(id => id && saleIds.has(String(id)))).length,
    receivablePaymentEvents: receivables.reduce((sum,row) => sum + (Array.isArray(row.historialPagos) ? row.historialPagos.length : 0),0),
    payables: payables.length,
    payablesWithUniquePurchaseMatch: payableMatches.filter(matches => matches.length === 1).length,
    payablesWithAmbiguousPurchaseMatch: payableMatches.filter(matches => matches.length > 1).length,
    payablesWithoutPurchaseMatch: payableMatches.filter(matches => matches.length === 0).length,
    payablePaymentEvents: payables.reduce((sum,row) => sum + (Array.isArray(row.historialPagos) ? row.historialPagos.length : 0),0),
    movements: movements.length,
    movementsWithProductResolved: movements.filter(row => productIds.has(String(row.productoId ?? ''))).length,
    movementSaleRows: movementTypeCounts.get('venta') ?? 0,
    movementPurchaseRows: movementTypeCounts.get('compra') ?? 0,
    movementOpeningRows: movementTypeCounts.get('inicial') ?? 0,
    movementAdjustmentRows: (movementTypeCounts.get('ajusteentrada') ?? 0) + (movementTypeCounts.get('ajustesalida') ?? 0),
    movementOtherRows: movements.length - (movementTypeCounts.get('venta') ?? 0) - (movementTypeCounts.get('compra') ?? 0) -
      (movementTypeCounts.get('inicial') ?? 0) - (movementTypeCounts.get('ajusteentrada') ?? 0) - (movementTypeCounts.get('ajustesalida') ?? 0),
    movementsMissingCostAndBcv: movements.filter(row => !hasFields(row, ['unitCostBs','costoUnitarioBs','costBs']) ||
      !hasFields(row, ['bcvRate','tasaBcv'])).length,
    cashbookRows: journal.length,
    cashbookRowsWithDoubleEntryAccounts: journal.filter(row => hasFields(row, ['accountCode','codigoCuenta','cuenta'])).length,
    cashbookRowsWithDebitCredit: journal.filter(row => hasFields(row, ['debitBs','debe','debito']) && hasFields(row, ['creditBs','haber','credito'])).length,
    cashSessions,
    terminals: list('terminales').length,
    zReports: list('reportesZ').length,
    returns: returns.length,
    returnsLinkedToSales: returns.filter(row => saleIds.has(String(row.ventaId ?? ''))).length,
    voids: voids.length,
    voidsLinkedToSales: voids.filter(row => saleIds.has(String(row.ventaId ?? ''))).length,
    hasBankAccounts: ['bancos','bankAccounts','cuentasBancarias'].some(key => list(key).length > 0),
    hasRetentionVouchers: ['retenciones','retencionesIVA','retencionesISLR','withholdings'].some(key => list(key).length > 0),
    hasFixedAssets: ['activos','activosFijos','fixedAssets'].some(key => list(key).length > 0),
    hasChartOfAccounts: ['planCuentas','catalogoCuentas','chartOfAccounts'].some(key => list(key).length > 0),
    users: list('users').length
  };
};

const parseUniversalAdvanceNumber = (value: unknown): number => {
  let raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
  if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
  else raw = raw.replace(',', '.');
  return Number(raw);
};
const pickUniversalAdvanceValue = (row: Record<string, unknown>, keys: string[]): unknown => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const wanted = new Set(keys.map(normalize));
  return Object.entries(row).find(([key, value]) => wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '')?.[1];
};
const requireUniversalAdvanceDate = (value: unknown): string => {
  const date = String(value ?? '').trim().slice(0, 10);
  const parts = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)?.slice(1).map(Number);
  const parsed = parts ? new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])) : null;
  if (!parts || !parsed || parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== parts[1] - 1 || parsed.getUTCDate() !== parts[2]) {
    throw new Error('La operación de anticipo requiere una fecha histórica válida en formato AAAA-MM-DD.');
  }
  return date;
};

export const mapUniversalSupplierDirectAdvanceDraft = (
  row: Record<string, unknown>, allSourceRows: Array<Record<string, unknown>>
): UniversalSupplierDirectAdvanceDraft => {
  const operation = String(pickUniversalAdvanceValue(row, ['settlementKind','operationType','transactionType','tipoOperacion','tipoMovimiento','concept','concepto','kind','tipo']) ?? '')
    .trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const directTokens = ['supplierdirectadvance','directsupplieradvance','anticodirectoproveedor','anticipodirectoproveedor','anticipoproveedor','anticipodirecto','desembolsoanticipoproveedor'];
  if (!directTokens.includes(operation)) throw new Error('La fila no identifica expresamente un desembolso directo de anticipo a proveedor.');
  const sourceRowId = String(row.migrationrowid ?? '').trim();
  if (!sourceRowId) throw new Error('El anticipo directo no conserva su identificador estable de fila de origen.');
  const party = resolveUniversalPartyReference(allSourceRows, row, 'supplier');
  const date = requireUniversalAdvanceDate(pickUniversalAdvanceValue(row, ['date','fecha','advanceDate','fechaAnticipo','disbursementDate']));
  const bcvRate = parseUniversalAdvanceNumber(pickUniversalAdvanceValue(row, ['bcvRate','tasaBcv','exchangeRate','tasaHistorica']));
  const amountUsdRaw = pickUniversalAdvanceValue(row, ['amountUsd','advanceAmountUsd','montoUsd','importeUsd','anticipoUsd']);
  const amountBsRaw = pickUniversalAdvanceValue(row, ['amountBs','advanceAmountBs','montoBs','importeBs','anticipoBs']);
  const amountUsd = amountUsdRaw === undefined ? parseUniversalAdvanceNumber(amountBsRaw) / bcvRate : parseUniversalAdvanceNumber(amountUsdRaw);
  const treasuryAccountCode = String(pickUniversalAdvanceValue(row, ['treasuryAccountCode','accountCode','codigoCuenta','cuentaTesoreria','codigoCuentaTesoreria']) ?? '').trim();
  const currencyRaw = String(pickUniversalAdvanceValue(row, ['paymentCurrency','currency','moneda','currencyCode']) ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const paymentCurrency = ['bs','ves','bolivar','bolivares'].includes(currencyRaw) ? 'BS' : ['usd','us','dolar','dolares'].includes(currencyRaw) ? 'USD' : null;
  const paidAmountRaw = pickUniversalAdvanceValue(row, ['paidAmount','disbursedAmount','amountPaid','importeDesembolsado','montoDesembolsado']);
  const paidAmountSpecific = paymentCurrency === 'USD'
    ? pickUniversalAdvanceValue(row, ['paidAmountUsd','disbursedAmountUsd','montoDesembolsadoUsd'])
    : pickUniversalAdvanceValue(row, ['paidAmountBs','disbursedAmountBs','montoDesembolsadoBs']);
  const paidAmount = parseUniversalAdvanceNumber(paidAmountSpecific ?? paidAmountRaw);
  const reference = String(pickUniversalAdvanceValue(row, ['reference','paymentReference','disbursementReference','referencia','comprobante']) ?? '').trim();
  const support = String(pickUniversalAdvanceValue(row, ['support','supportDocument','documentSupport','soporte','comprobanteSoporte','documentoSoporte']) ?? '').trim();
  if (!Number.isFinite(bcvRate) || bcvRate <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0 || !treasuryAccountCode ||
      !paymentCurrency || !Number.isFinite(paidAmount) || paidAmount <= 0 || !reference || !support) {
    throw new Error('El anticipo ' + sourceRowId + ' requiere importe, tasa BCV, cuenta de tesorería, moneda, desembolso real, referencia y soporte explícitos.');
  }
  return { sourceRowId, draft: { supplierRif: party.rif, supplierName: party.name, date, amountUsd, bcvRate, treasuryAccountCode, paymentCurrency, paidAmount, reference, support } };
};

export const mapUniversalSupplierAdvanceSettlementDraft = (
  row: Record<string, unknown>, allSourceRows: Array<Record<string, unknown>>, targetPurchaseId?: string
): UniversalSupplierAdvanceSettlementDraft => {
  const sourceRowId = String(row.migrationrowid ?? '').trim();
  if (!sourceRowId) throw new Error('La liquidación de anticipo no conserva su identificador estable de fila de origen.');
  const party = resolveUniversalPartyReference(allSourceRows, row, 'supplier');
  const operation = String(pickUniversalAdvanceValue(row, ['settlementKind','operationType','transactionType','tipoOperacion','kind','tipo','concept','concepto']) ?? '')
    .trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const refundTokens = ['refundreceived','supplieradvancerefund','refundsupplieradvance','reembolsoanticipo','reembolsoanticipoproveedor'];
  const applicationTokens = ['appliedtopurchase','supplieradvanceapplication','advanceapplication','aplicacionanticipo','aplicacionanticipoproveedor','anticipoaplicadocompra'];
  const kind = refundTokens.includes(operation) ? 'REFUND_RECEIVED' : applicationTokens.includes(operation) ? 'APPLIED_TO_PURCHASE' : null;
  if (!kind) throw new Error('La fila no identifica expresamente un reembolso o una aplicación de anticipo a compra.');
  const date = requireUniversalAdvanceDate(pickUniversalAdvanceValue(row, ['date','fecha','settlementDate','fechaLiquidacion','refundDate','fechaReembolso']));
  const bcvRate = parseUniversalAdvanceNumber(pickUniversalAdvanceValue(row, ['bcvRate','settlementBcvRate','tasaBcv','exchangeRate','tasaHistorica']));
  const amountUsdRaw = pickUniversalAdvanceValue(row, ['amountUsd','settlementAmountUsd','montoUsd','importeUsd','amountAppliedUsd']);
  const amountBsRaw = pickUniversalAdvanceValue(row, ['amountBs','settlementAmountBs','montoBs','importeBs','amountAppliedBs']);
  const cashRaw = pickUniversalAdvanceValue(row, ['cashReceivedBs','refundReceivedBs','montoReembolsadoBs','importeRecibidoBs']);
  if (kind === 'REFUND_RECEIVED' && amountBsRaw === undefined && cashRaw === undefined) {
    throw new Error('El reembolso ' + sourceRowId + ' requiere el importe real recibido en Bs; no se inferirá desde la tasa BCV.');
  }
  const amountUsd = amountUsdRaw === undefined ? parseUniversalAdvanceNumber(amountBsRaw ?? cashRaw) / bcvRate : parseUniversalAdvanceNumber(amountUsdRaw);
  const amountBs = amountBsRaw === undefined
    ? (kind === 'REFUND_RECEIVED' ? parseUniversalAdvanceNumber(cashRaw) : amountUsd * bcvRate)
    : parseUniversalAdvanceNumber(amountBsRaw);
  const reference = String(pickUniversalAdvanceValue(row, ['reference','settlementReference','paymentReference','referencia','comprobante']) ?? '').trim();
  const treasuryAccountCode = String(pickUniversalAdvanceValue(row, ['treasuryAccountCode','accountCode','codigoCuenta','cuentaTesoreria','codigoCuentaTesoreria']) ?? '').trim();
  if (!Number.isFinite(bcvRate) || bcvRate <= 0 || !Number.isFinite(amountUsd) || amountUsd <= 0 || !Number.isFinite(amountBs) || amountBs <= 0) {
    throw new Error('La liquidación ' + sourceRowId + ' requiere importes Bs/USD positivos y su tasa BCV histórica.');
  }
  if (kind === 'REFUND_RECEIVED' && !treasuryAccountCode) throw new Error('El reembolso ' + sourceRowId + ' requiere la cuenta real de caja/banco receptora.');
  if (kind === 'APPLIED_TO_PURCHASE' && !String(targetPurchaseId || '').trim()) throw new Error('La aplicación ' + sourceRowId + ' no se pudo vincular a una compra del mismo proveedor.');
  const cashReceivedBs = kind === 'REFUND_RECEIVED' ? (cashRaw === undefined ? amountBs : parseUniversalAdvanceNumber(cashRaw)) : undefined;
  if (kind === 'REFUND_RECEIVED' && (!Number.isFinite(cashReceivedBs) || Number(cashReceivedBs) <= 0)) {
    throw new Error('El reembolso ' + sourceRowId + ' requiere el importe realmente recibido en Bs.');
  }
  return { sourceRowId, draft: {
    supplierRif: party.rif, kind, date, amountUsd, amountBs, cashReceivedBs, bcvRate,
    treasuryAccountCode: kind === 'REFUND_RECEIVED' ? treasuryAccountCode : undefined,
    targetPurchaseId: kind === 'APPLIED_TO_PURCHASE' ? targetPurchaseId : undefined,
    reference: reference || undefined
  }};
};


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
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pickValue = (record: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== '') return value;
    }
    return undefined;
  };
  const invoiceIds = ['id','invoiceId','saleId','purchaseId','documentId','uuid','idFactura','idVenta','idCompra','ventaId','sale_id','venta_id']
    .map(key => pickValue(invoice, [key]))
    .filter(value => value !== undefined)
    .map(normalize);
  const uniqueIds = [...new Set(invoiceIds)];
  if (uniqueIds.length > 1) throw new Error('La factura contiene identificadores incompatibles; no se pueden enlazar sus renglones con seguridad.');
  if (!uniqueIds.length) return [];
  const fileId = String(invoice.migrationfile ?? '');
  const foreignKeys = ['invoiceId','saleId','purchaseId','documentId','facturaId','ventaId','compraId','idFactura','idVenta','idCompra','invoice_id','sale_id','purchase_id','document_id','factura_id','venta_id','compra_id'];
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
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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

export type UniversalInvoiceClassification = {
  sales: Record<string, unknown>[];
  purchases: Record<string, unknown>[];
  ambiguous: Record<string, unknown>[];
};

/** Clasifica cada factura por las señales de su propia fila, nunca por campos de otra factura del archivo. */
export const classifyUniversalInvoiceRows = (rows: Record<string, unknown>[]): UniversalInvoiceClassification => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const has = (row: Record<string, unknown>, keys: string[]) => {
    const normalizedKeys = new Set(keys.map(normalize));
    return Object.entries(row).some(([key, value]) =>
      normalizedKeys.has(normalize(key)) && value !== undefined && value !== null && String(value).trim() !== ''
    );
  };
  const invoiceRows = rows.filter(row =>
    has(row, ['invoicenumber','numerofactura','numerofactura','factura','documento','documentnumber','numero','nrofactura','numfactura']) &&
    has(row, ['invoicedate','fechafactura','fechadefactura','fechaemision','fecha','date']) &&
    has(row, ['totalamountbs','totalbs','total','montototal','importetotal','monto','importe','vatamountbs','iva'])
  );
  const sales: Record<string, unknown>[] = [];
  const purchases: Record<string, unknown>[] = [];
  const ambiguous: Record<string, unknown>[] = [];
  const customerKeys = ['customername','clientname','cliente','nombrecliente','customerrif','clienterif','rifcliente','customerid','clientid','clienteid','idcliente','customer_id','client_id','cliente_id','idcliente'];
  const supplierKeys = ['suppliername','vendorname','proveedor','nombreproveedor','supplierrif','vendorrif','rifproveedor','supplierid','vendorid','proveedorid','idproveedor','supplier_id','vendor_id','proveedor_id','idproveedor'];
  for (const row of invoiceRows) {
    const customer = has(row, customerKeys);
    const supplier = has(row, supplierKeys);
    if (customer && supplier) ambiguous.push(row);
    else if (customer) sales.push(row);
    else if (supplier) purchases.push(row);
  }
  return { sales, purchases, ambiguous };
};

export type UniversalJournalGroup = {
  sourceFile: string;
  date: string;
  reference: string;
  rows: Record<string, unknown>[];
};

/** Agrupa líneas por archivo + fecha + referencia para no mezclar asientos de archivos distintos. */
export const groupUniversalJournalRows = (rows: Record<string, unknown>[]): UniversalJournalGroup[] => {
  const normalize = (value: unknown) => String(value ?? '').trim();
  const normalizedKey = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (row: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalizedKey));
    return Object.entries(row).find(([key, value]) => wanted.has(normalizedKey(key)) && value !== undefined && value !== null && String(value).trim() !== '')?.[1];
  };
  const groups = new Map<string, UniversalJournalGroup>();
  for (const row of rows) {
    const sourceFile = normalize(pick(row, ['migrationfile','migrationsource']) ?? 'archivo sin nombre');
    const date = normalize(pick(row, ['date','fecha']));
    const reference = normalize(pick(row, ['entryNumber','numeroAsiento','asiento','referenceDoc','referencia','documento']));
    if (!date || !reference) continue;
    const key = JSON.stringify([sourceFile, date, reference]);
    const group = groups.get(key) ?? { sourceFile, date, reference, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
};

export type UniversalInventoryMovementType = 'ENTRADA' | 'SALIDA' | 'AJUSTE';
export type UniversalInventoryMovementConcept = 'COMPRA' | 'INVENTARIO_INICIAL' | 'VENTA' | 'MERMA' | 'AUTOCONSUMO' | 'AJUSTE' | 'DEVOLUCION_CLIENTE' | 'DEVOLUCION_COMPRA';

export const isUniversalMovementTypeConceptValid = (
  type: UniversalInventoryMovementType,
  concept: UniversalInventoryMovementConcept
): boolean => {
  const valid: Record<UniversalInventoryMovementType, UniversalInventoryMovementConcept[]> = {
    ENTRADA: ['COMPRA','INVENTARIO_INICIAL','DEVOLUCION_CLIENTE'],
    SALIDA: ['VENTA','MERMA','AUTOCONSUMO','DEVOLUCION_COMPRA'],
    AJUSTE: ['AJUSTE']
  };
  return valid[type]?.includes(concept) ?? false;
};

export const normalizeUniversalDocumentReference = (value: unknown): string => {
  const normalized = String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const withoutPrefix = normalized.replace(/^(?:(?:FACTURA|FAC))+/, '');
  return withoutPrefix || normalized;
};

export const buildUniversalInvoiceIdentity = (
  kind: 'sales' | 'purchases',
  invoiceNumber: unknown,
  partyRif: unknown
): string => {
  const invoice = normalizeUniversalDocumentReference(invoiceNumber);
  const rif = String(partyRif ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return kind === 'sales' ? invoice : invoice + '|' + rif;
};

export const findUniversalInvoiceJournalCollision = (
  invoiceNumber: unknown,
  entries: Array<{ referenceDoc?: string | null; type?: string }>,
  expectedType?: 'VENTA' | 'COMPRA'
): { referenceDoc?: string | null; type?: string } | undefined => {
  const normalizedInvoice = normalizeUniversalDocumentReference(invoiceNumber);
  if (!normalizedInvoice) return undefined;
  return entries.find(entry =>
    (!expectedType || entry.type === expectedType || entry.type === 'MANUAL' || !entry.type) &&
    normalizeUniversalDocumentReference(entry.referenceDoc) === normalizedInvoice
  );
};

const normalizeUniversalValue = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

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
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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



/**
 * Detecta liquidaciones relacionadas con una factura dentro del mismo archivo.
 * Nunca enlaza por similitud ni cruza colecciones de archivos diferentes.
 */
export const resolveUniversalInvoiceSettlementRows = (
  rows: Array<Record<string, unknown>>,
  invoice: Record<string, unknown>
): Array<Record<string, unknown>> => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
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
  const invoiceNumber = pickValue(invoice, ['invoiceNumber','numeroFactura','factura','documento','documentNumber']);
  const partyRif = pickValue(invoice, ['customerRif','clientRif','supplierRif','vendorRif','rifCliente','rifProveedor','rif']);
  if (!uniqueIds.length && (invoiceNumber === undefined || partyRif === undefined)) return [];
  const fileId = String(invoice.migrationfile ?? '');
  const foreignKeys = ['invoiceId','saleId','purchaseId','documentId','facturaId','ventaId','compraId','idFactura','idVenta','idCompra','invoice_id','sale_id','purchase_id','document_id'];
  const invoiceNumberKeys = ['invoiceNumber','numeroFactura','factura','documentNumber','referencedInvoiceNumber','affectedInvoiceNumber','facturaAfectada'];
  const partyRifKeys = ['customerRif','clientRif','supplierRif','vendorRif','rifCliente','rifProveedor','partyRif','rif'];
  const dateKeys = ['settlementDate','paymentDate','collectionDate','fechaPago','fechaCobro','date','fecha'];
  const amountKeys = ['settlementAmountBs','paymentAmountBs','collectionAmountBs','amountBs','amountUsd','amount','importe','monto','montoBs','montoUsd','paidAmount','amountPaid','collectedAmount','amountCollected','paymentAmount','collectionAmount'];
  const evidenceKeys = ['method','paymentMethod','settlementMethod','collectionMethod','medioPago','formaPago','reference','paymentReference','collectionReference','referenceNumber','comprobante','bankAccountId','transactionId','transactionType','type','tipoMovimiento','tipoOperacion'];
  return rows.filter(candidate => {
    if (candidate === invoice || String(candidate.migrationfile ?? '') !== fileId) return false;
    const reference = pickValue(candidate, foreignKeys);
    const idMatch = uniqueIds.length === 1 && reference !== undefined && normalize(reference) === uniqueIds[0];
    const numberMatch = reference === undefined && invoiceNumber !== undefined && partyRif !== undefined &&
      pickValue(candidate, invoiceNumberKeys) !== undefined &&
      normalize(pickValue(candidate, invoiceNumberKeys)) === normalize(invoiceNumber) &&
      pickValue(candidate, partyRifKeys) !== undefined &&
      normalize(pickValue(candidate, partyRifKeys)) === normalize(partyRif);
    if (!idMatch && !numberMatch) return false;
    const productCode = pickValue(candidate, ['productCode','codigoProducto','productSku','sku','itemCode','codigo','code']);
    const quantity = pickValue(candidate, ['quantity','cantidad','qty']);
    if (productCode !== undefined && quantity !== undefined) return false;
    const hasDate = pickValue(candidate, dateKeys) !== undefined;
    const hasAmount = pickValue(candidate, amountKeys) !== undefined;
    const hasEvidence = pickValue(candidate, evidenceKeys) !== undefined;
    return hasDate && hasAmount && (idMatch || hasEvidence);
  });
};

/** Detecta pagos/cobros embebidos sin confundir importes de IVA o retenciones. */
export const hasUniversalInlineSettlementAmount = (invoice: Record<string, unknown>): boolean => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const keys = new Set([
    'paidAmountBs','amountPaidBs','collectedAmountBs','amountCollectedBs','settledAmountBs','amountSettledBs',
    'totalPaidBs','totalCollectedBs','paymentsTotalBs','montoPagadoBs','montoCobradoBs','abonosBs',
    'paidAmountUsd','amountPaidUsd','collectedAmountUsd','amountCollectedUsd','settledAmountUsd','amountSettledUsd',
    'paidAmount','amountPaid','collectedAmount','amountCollected','settledAmount','amountSettled',
    'totalPaid','totalCollected','montoPagado','montoCobrado','abono'
  ].map(normalize));
  for (const [key, value] of Object.entries(invoice)) {
    if (!keys.has(normalize(key)) || value === undefined || value === null || String(value).trim() === '') continue;
    let raw = String(value).trim().replace(/[^0-9,.-]/g, '');
    if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
    else raw = raw.replace(',', '.');
    const amount = Number(raw);
    if (!Number.isFinite(amount) || amount > 0.000001) return true;
  }
  return false;
};



/**
 * Aplica la selección explícita del asistente mediante claves estables de fila.
 * Rechaza claves ausentes o ambiguas para impedir importaciones parciales distintas
 * de las que el usuario marcó en la vista previa.
 */
export const selectUniversalRowsByStableKeys = (
  rows: Array<Record<string, unknown>>,
  selectedKeys: string[]
): Array<Record<string, unknown>> => {
  const keys = selectedKeys.map(key => String(key ?? '').trim());
  if (keys.some(key => !key)) throw new Error('La selección contiene una clave de registro vacía.');
  if (new Set(keys).size !== keys.length) throw new Error('La selección contiene claves de registro duplicadas.');
  const selected = new Set(keys);
  const matches = rows.filter(row => selected.has(String(row.migrationrowid ?? '').trim()));
  for (const key of keys) {
    const count = matches.filter(row => String(row.migrationrowid ?? '').trim() === key).length;
    if (count === 0) throw new Error('El registro seleccionado ya no está disponible: ' + key + '. Vuelve a analizar el archivo.');
    if (count > 1) throw new Error('La clave del registro seleccionado no es única: ' + key + '. No se importó ningún registro.');
  }
  return matches;
};



export type UniversalSettlementPreview = {
  settlementDate: string; bcvRate: number; amountUsd: number; amountBs: number;
  method: 'CASH_BS' | 'CASH_USD' | 'BANK_TRANSFER_BS' | 'BANK_TRANSFER_USD';
  bankAccountId?: string; reference?: string; sourceRowId: string;
};

/** Normaliza liquidaciones sin crear asientos ni inferir cuentas de tesorería. */
export const mapUniversalSettlementPreview = (row: Record<string, unknown>): UniversalSettlementPreview => {
  const normalize=(value:unknown)=>String(value??'').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const pick=(keys:string[])=>{const wanted=new Set(keys.map(normalize));return Object.entries(row).find(([key,value])=>wanted.has(normalize(key))&&value!==undefined&&value!==null&&String(value).trim()!=='')?.[1];};
  const number=(value:unknown)=>{let raw=String(value??'').trim().replace(/[^0-9,.-]/g,'');if(raw.includes(',')&&raw.includes('.'))raw=raw.replace(/\./g,'').replace(',','.');else raw=raw.replace(',','.');return Number(raw);};
  const date=String(pick(['settlementDate','paymentDate','collectionDate','fechaPago','fechaCobro','date','fecha'])??'').slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('La liquidación no declara una fecha válida.');
  const [y,m,d]=date.split('-').map(Number),parsed=new Date(Date.UTC(y,m-1,d));
  if(parsed.getUTCFullYear()!==y||parsed.getUTCMonth()!==m-1||parsed.getUTCDate()!==d)throw new Error('La liquidación no declara una fecha válida.');
  const bcvRate=number(pick(['settlementBcvRate','bcvRate','tasaBcv','tasaBcvHistorica','exchangeRate']));
  if(!Number.isFinite(bcvRate)||bcvRate<=0)throw new Error('La liquidación requiere su propia tasa BCV histórica.');
  const bsRaw=pick(['settlementAmountBs','paymentAmountBs','collectionAmountBs','amountBs','montoBs','importeBs','monto']);
  const usdRaw=pick(['settlementAmountUsd','paymentAmountUsd','collectionAmountUsd','amountUsd','montoUsd','importeUsd']);
  const amountBs=bsRaw===undefined?NaN:number(bsRaw),amountUsd=usdRaw===undefined?amountBs/bcvRate:number(usdRaw);
  if(!Number.isFinite(amountBs)||amountBs<=0||!Number.isFinite(amountUsd)||amountUsd<=0)throw new Error('La liquidación requiere importes positivos en Bs y USD; USD solo puede calcularse desde Bs usando la tasa histórica declarada.');
  if(Math.abs(amountBs/bcvRate-amountUsd)>0.02)throw new Error('Los importes Bs/USD de la liquidación no concilian con su tasa BCV histórica.');
  const raw=normalize(pick(['method','paymentMethod','settlementMethod','collectionMethod','medioPago','formaPago']));
  const methods:Record<string,UniversalSettlementPreview['method']>={efectivo:'CASH_BS',cash:'CASH_BS',efectivobs:'CASH_BS',cashbs:'CASH_BS',efectivousd:'CASH_USD',cashusd:'CASH_USD',divisas:'CASH_USD',transferenciabs:'BANK_TRANSFER_BS',transferencia:'BANK_TRANSFER_BS',transfer:'BANK_TRANSFER_BS',banktransfer:'BANK_TRANSFER_BS',transferenciausd:'BANK_TRANSFER_USD',transferenciusd:'BANK_TRANSFER_USD',transferusd:'BANK_TRANSFER_USD',banktransferusd:'BANK_TRANSFER_USD'};
  const method=methods[raw];if(!method)throw new Error('El medio de liquidación no está identificado de forma compatible; requiere revisión manual.');
  const bankAccountId=String(pick(['bankAccountId','bankId','cuentaBancariaId','idCuentaBancaria'])??'').trim();
  if(method.startsWith('BANK_TRANSFER')&&!bankAccountId)throw new Error('La transferencia requiere el ID de una cuenta bancaria real de la empresa destino.');
  const reference=String(pick(['reference','paymentReference','collectionReference','referenceNumber','comprobante','referencia'])??'').trim();
  if(method.startsWith('BANK_TRANSFER')&&!reference)throw new Error('La transferencia requiere su referencia o comprobante.');
  const sourceRowId=String(row.migrationrowid??'').trim();if(!sourceRowId)throw new Error('La liquidación no tiene identificador estable de fila de origen.');
  return {settlementDate:date,bcvRate,amountUsd,amountBs,method,...(bankAccountId?{bankAccountId}:{}),...(reference?{reference}:{}),sourceRowId};
};


export type UniversalSettlementBankDestination = {
  id: string;
  companyId: string;
  accountCode: string;
  currency?: 'BS' | 'USD';
};

export type UniversalSettlementLedgerAccount = {
  code: string;
  type: string;
  isMovement: boolean;
};

/**
 * Validates the real destination before a historical settlement can be posted.
 * Bank transfers must match an existing bank account in the target company and
 * its declared currency; cash methods must resolve to the corresponding cash auxiliary.
 */
export const validateUniversalSettlementDestination = (
  settlement: UniversalSettlementPreview,
  companyId: string,
  bankAccounts: UniversalSettlementBankDestination[],
  accounts: UniversalSettlementLedgerAccount[]
): string | null => {
  if (!companyId.trim()) return 'Debe seleccionar la empresa destino de la liquidación.';
  if (settlement.method === 'BANK_TRANSFER_BS' || settlement.method === 'BANK_TRANSFER_USD') {
    const bank = bankAccounts.find(item => item.id === settlement.bankAccountId && item.companyId === companyId);
    if (!bank) return 'La liquidación referencia una cuenta bancaria inexistente o perteneciente a otra empresa.';
    const expectedCurrency = settlement.method === 'BANK_TRANSFER_USD' ? 'USD' : 'BS';
    if ((bank.currency || 'BS') !== expectedCurrency) {
      return 'La moneda de la transferencia no coincide con la moneda de la cuenta bancaria destino.';
    }
    const auxiliary = accounts.find(item => item.code === bank.accountCode);
    if (!auxiliary || auxiliary.type !== 'ACTIVO' || auxiliary.isMovement !== true) {
      return 'La cuenta bancaria destino no tiene un auxiliar contable de activo válido para movimientos.';
    }
    return null;
  }
  if (settlement.bankAccountId) {
    return 'Una liquidación en efectivo no puede identificar una cuenta bancaria de destino.';
  }
  const cashCode = settlement.method === 'CASH_USD' ? '1.1.1.02' : '1.1.1.01';
  const cash = accounts.find(item => item.code === cashCode);
  if (!cash || cash.type !== 'ACTIVO' || cash.isMovement !== true) {
    return 'No existe el auxiliar de caja correspondiente a la moneda de la liquidación.';
  }
  return null;
};


export type UniversalCreditSettlementDraft = {
  invoiceRowId: string;
  sourceRowId: string;
  documentId: string;
  kind: 'SALE_COLLECTION' | 'PURCHASE_PAYMENT';
  settlementDate: string;
  bcvRate: number;
  amountUsd: number;
  amountBs: number;
  method: UniversalSettlementPreview['method'];
  bankAccountId?: string;
  reference?: string;
};

/**
 * Resolves source invoice row keys to the newly created SICOVEN document IDs.
 * This is only a mapping step; it never creates journal entries or persists data.
 */
export const mapUniversalInvoiceSettlementDrafts = (
  plans: UniversalInvoiceSettlementPlan[],
  targetDocumentIds: Record<string, string>
): UniversalCreditSettlementDraft[] => {
  const seenSourceRows = new Set<string>();
  return plans.flatMap(plan => {
    const documentId = String(targetDocumentIds[plan.invoiceRowId] ?? '').trim();
    if (plan.settlements.length && !documentId) {
      throw new Error('La factura de origen ' + plan.invoiceRowId + ' no tiene un documento SICOVEN destino enlazado.');
    }
    return plan.settlements.map(settlement => {
      if (!settlement.sourceRowId || seenSourceRows.has(settlement.sourceRowId)) {
        throw new Error('Una liquidación de origen está vacía o se intentó aplicar más de una vez.');
      }
      seenSourceRows.add(settlement.sourceRowId);
      return {
        invoiceRowId: plan.invoiceRowId,
        sourceRowId: settlement.sourceRowId,
        documentId,
        kind: plan.invoiceKind === 'sales' ? 'SALE_COLLECTION' as const : 'PURCHASE_PAYMENT' as const,
        settlementDate: settlement.settlementDate,
        bcvRate: settlement.bcvRate,
        amountUsd: settlement.amountUsd,
        amountBs: settlement.amountBs,
        method: settlement.method,
        ...(settlement.bankAccountId ? { bankAccountId: settlement.bankAccountId } : {}),
        ...(settlement.reference ? { reference: settlement.reference } : {})
      };
    });
  });
};

/** Filters the detected settlement plan to individually selected stable source-row keys. */
export const selectUniversalInvoiceSettlements = (
  plans: UniversalInvoiceSettlementPlan[], selectedSourceRowIds: string[]
): UniversalInvoiceSettlementPlan[] => {
  const selected = new Set(selectedSourceRowIds.map(value => String(value || '').trim()));
  if (selected.size !== selectedSourceRowIds.length || selected.has('')) {
    throw new Error('La selección de liquidaciones contiene claves vacías o duplicadas.');
  }
  const available = new Set<string>();
  for (const plan of plans) for (const settlement of plan.settlements) {
    if (!settlement.sourceRowId || available.has(settlement.sourceRowId)) {
      throw new Error('El plan contiene una clave de liquidación vacía o duplicada.');
    }
    available.add(settlement.sourceRowId);
  }
  for (const key of selected) if (!available.has(key)) {
    throw new Error('La liquidación seleccionada ya no está disponible: ' + key + '.');
  }
  return plans.map(plan => ({ ...plan, settlements: plan.settlements.filter(item => selected.has(item.sourceRowId)) }));
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


const normalizeUniversalInventoryToken = (value: unknown): string =>
  String(value ?? '').trim().normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');

export const mapUniversalInventoryCostingMethod = (value: unknown): 'PROMEDIO_PONDERADO' | 'PEPS' | null => {
  const token = normalizeUniversalInventoryToken(value);
  if (['promedioponderado', 'promedio', 'averageweighted', 'weightedaverage', 'movingaverage'].includes(token)) return 'PROMEDIO_PONDERADO';
  if (['peps', 'fifo', 'firstinfirstout'].includes(token)) return 'PEPS';
  return null;
};

export const mapUniversalInventoryVatTreatment = (value: unknown): 'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO' | null => {
  const token = normalizeUniversalInventoryToken(value);
  if (['general16', '16', '16porciento', 'iva16'].includes(token)) return 'GENERAL_16';
  if (['reducida8', '8', '8porciento', 'iva8', 'reducido'].includes(token)) return 'REDUCIDA_8';
  if (['exento', 'exempt'].includes(token)) return 'EXENTO';
  if (['exonerado', 'exonerated'].includes(token)) return 'EXONERADO';
  return null;
};

export const mapUniversalInventoryItemType = (value: unknown): 'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO' | null => {
  const token = normalizeUniversalInventoryToken(value);
  if (['mercancia', 'merchandise', 'goods'].includes(token)) return 'MERCANCIA';
  if (['materiaprima', 'rawmaterial', 'rawmaterials'].includes(token)) return 'MATERIA_PRIMA';
  if (['productoenproceso', 'workinprocess', 'wip'].includes(token)) return 'PRODUCTO_EN_PROCESO';
  if (['productoterminado', 'finishedproduct', 'finishedgoods'].includes(token)) return 'PRODUCTO_TERMINADO';
  if (['subproducto', 'byproduct'].includes(token)) return 'SUBPRODUCTO';
  return null;
};


export type UniversalInvoiceSettlementPlan = {
  invoiceRowId: string;
  invoiceKind: 'sales' | 'purchases';
  settlements: UniversalSettlementPreview[];
};

/**
 * Construye el lote de liquidaciones únicamente para las facturas seleccionadas.
 * Las relaciones deben venir de una FK explícita o del par número+RIF dentro
 * del mismo archivo. No asigna pagos a documentos por orden ni por similitud.
 */
export const planUniversalInvoiceSettlements = (
  invoices: Array<Record<string, unknown>>,
  allSourceRows: Array<Record<string, unknown>>,
  invoiceKind: 'sales' | 'purchases'
): UniversalInvoiceSettlementPlan[] => {
  const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const pick = (row: Record<string, unknown>, keys: string[]) => {
    const wanted = new Set(keys.map(normalize));
    return Object.entries(row).find(([key, value]) => wanted.has(normalize(key)) &&
      value !== undefined && value !== null && String(value).trim() !== '')?.[1];
  };
  const seenInvoices = new Set<string>();
  const seenSettlements = new Set<string>();
  const seenBankReferences = new Set<string>();
  return invoices.map(invoice => {
    const invoiceRowId = String(invoice.migrationrowid ?? '').trim();
    if (!invoiceRowId || seenInvoices.has(invoiceRowId)) {
      throw new Error('La selección de facturas contiene una clave de origen vacía o duplicada.');
    }
    seenInvoices.add(invoiceRowId);
    const matches = resolveUniversalInvoiceSettlementRows(allSourceRows, invoice);
    // Los importes agregados dentro de la factura no identifican fechas, medios ni
    // referencias individuales. No se pueden convertir en liquidaciones inventadas.
    if (hasUniversalInlineSettlementAmount(invoice)) {
      throw new Error('La factura ' + invoiceRowId + ' declara un importe liquidado dentro de la propia fila. Debe desglosarse en registros de cobro/pago individuales antes de importarla.');
    }
    const settlements = matches.map(row => {
      const preview = mapUniversalSettlementPreview(row);
      if (seenSettlements.has(preview.sourceRowId)) {
        throw new Error('La liquidación ' + preview.sourceRowId + ' está vinculada más de una vez. No se importó el lote.');
      }
      seenSettlements.add(preview.sourceRowId);
      if (preview.method.startsWith('BANK_TRANSFER')) {
        // Las referencias bancarias se comparan sin distinguir mayúsculas ni espacios,
        // pero se conserva la puntuación porque puede formar parte del identificador.
        const normalizeBankToken = (value: string) => value.trim().replace(/\s+/g, '').toUpperCase();
        const bankReferenceKey = normalizeBankToken(String(preview.bankAccountId || '')) + '|' +
          normalizeBankToken(String(preview.reference || ''));
        if (seenBankReferences.has(bankReferenceKey)) {
          throw new Error('La referencia bancaria ' + preview.reference + ' está repetida en la misma cuenta dentro del lote. Revise el archivo antes de importar.');
        }
        seenBankReferences.add(bankReferenceKey);
      }
      const declaredKind = normalize(pick(row, ['transactionType','tipoOperacion','documentType','tipoDocumento']));
      if (declaredKind) {
        const salesTokens = ['sale','sales','venta','cobro','collection','receivable','cxc'];
        const purchaseTokens = ['purchase','purchases','compra','pago','payment','payable','cxp'];
        const allowed = invoiceKind === 'sales' ? salesTokens : purchaseTokens;
        const opposite = invoiceKind === 'sales' ? purchaseTokens : salesTokens;
        if (!allowed.includes(declaredKind)) {
          throw new Error(opposite.includes(declaredKind)
            ? 'La liquidación ' + preview.sourceRowId + ' declara un tipo incompatible con la factura seleccionada.'
            : 'La liquidación ' + preview.sourceRowId + ' declara un tipo de operación no reconocido; requiere clasificación manual.');
        }
      }
      return preview;
    });
    const totalUsdRaw = pick(invoice, ['totalAmountUsd','totalUsd','montoTotalUsd','importeTotalUsd']);
    const totalBsRaw = pick(invoice, ['totalAmountBs','totalBs','montoTotalBs','importeTotalBs','total','montoTotal']);
    const invoiceRateRaw = pick(invoice, ['bcvRate','tasaBcv','exchangeRate']);
    const parseAmount = (value: unknown) => {
      let raw = String(value ?? '').trim().replace(/[^0-9,.-]/g, '');
      if (raw.includes(',') && raw.includes('.')) raw = raw.replace(/\./g, '').replace(',', '.');
      else raw = raw.replace(',', '.');
      return Number(raw);
    };
    const invoiceRate = invoiceRateRaw !== undefined ? parseAmount(invoiceRateRaw) : NaN;
    const grossTotalUsd = totalUsdRaw !== undefined ? parseAmount(totalUsdRaw)
      : totalBsRaw !== undefined && Number.isFinite(invoiceRate) && invoiceRate > 0
        ? parseAmount(totalBsRaw) / invoiceRate : NaN;
    if (settlements.length && (!Number.isFinite(grossTotalUsd) || grossTotalUsd <= 0)) {
      throw new Error('La factura ' + invoiceRowId + ' tiene liquidaciones relacionadas, pero no declara un total y una tasa que permitan verificar su saldo exigible.');
    }
    const optionalAmount = (keys: string[]): number => {
      const raw = pick(invoice, keys);
      if (raw === undefined) return 0;
      const value = parseAmount(raw);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error('La factura ' + invoiceRowId + ' contiene una retención inválida que impide calcular su saldo exigible.');
      }
      return value;
    };
    const vatWithheldUsdRaw = pick(invoice, ['vatWithheldUsd','ivaRetenidoUsd','retencionIvaUsd']);
    const vatWithheldBsRaw = pick(invoice, ['vatWithheldBs','ivaRetenidoBs','retencionIvaBs']);
    const islrWithheldUsdRaw = invoiceKind === 'purchases'
      ? pick(invoice, ['islrWithheldUsd','islrRetenidoUsd','withheldIslrUsd']) : undefined;
    const islrWithheldBsRaw = invoiceKind === 'purchases'
      ? pick(invoice, ['islrWithheldBs','islrRetenidoBs','withheldIslrBs']) : undefined;
    const vatWithheldUsd = vatWithheldUsdRaw !== undefined
      ? optionalAmount(['vatWithheldUsd','ivaRetenidoUsd','retencionIvaUsd'])
      : vatWithheldBsRaw !== undefined && Number.isFinite(invoiceRate) && invoiceRate > 0
        ? optionalAmount(['vatWithheldBs','ivaRetenidoBs','retencionIvaBs']) / invoiceRate : 0;
    const vatWithheldBs = optionalAmount(['vatWithheldBs','ivaRetenidoBs','retencionIvaBs']);
    const islrWithheldUsd = islrWithheldUsdRaw !== undefined
      ? optionalAmount(['islrWithheldUsd','islrRetenidoUsd','withheldIslrUsd'])
      : islrWithheldBsRaw !== undefined && Number.isFinite(invoiceRate) && invoiceRate > 0
        ? optionalAmount(['islrWithheldBs','islrRetenidoBs','withheldIslrBs']) / invoiceRate : 0;
    const islrWithheldBs = invoiceKind === 'purchases'
      ? optionalAmount(['islrWithheldBs','islrRetenidoBs','withheldIslrBs']) : 0;
    if (settlements.length && ((vatWithheldBsRaw !== undefined && vatWithheldUsdRaw === undefined && !(invoiceRate > 0)) ||
        (islrWithheldBsRaw !== undefined && islrWithheldUsdRaw === undefined && !(invoiceRate > 0)))) {
      throw new Error('La factura ' + invoiceRowId + ' declara retenciones en Bs sin tasa histórica para convertirlas a USD y calcular CxC/CxP.');
    }
    if (Number.isFinite(invoiceRate) && invoiceRate > 0 &&
        ((vatWithheldUsdRaw !== undefined && vatWithheldBsRaw !== undefined && Math.abs(vatWithheldBs / invoiceRate - vatWithheldUsd) > 0.02) ||
         (islrWithheldUsdRaw !== undefined && islrWithheldBsRaw !== undefined && Math.abs(islrWithheldBs / invoiceRate - islrWithheldUsd) > 0.02))) {
      throw new Error('Las retenciones de la factura ' + invoiceRowId + ' no concilian entre Bs y USD a su tasa BCV histórica.');
    }
    const totalWithheldUsd = vatWithheldUsd + islrWithheldUsd;
    if (totalWithheldUsd > grossTotalUsd + 0.00001) {
      throw new Error('Las retenciones de la factura ' + invoiceRowId + ' superan el total del documento.');
    }
    const netTotalUsd = Math.max(0, grossTotalUsd - totalWithheldUsd);
    const settledUsd = settlements.reduce((sum, item) => sum + item.amountUsd, 0);
    if (settlements.length && netTotalUsd <= 0) {
      throw new Error('La factura ' + invoiceRowId + ' no tiene saldo exigible positivo después de retenciones.');
    }
    if (settledUsd - netTotalUsd > 0.00001) {
      throw new Error('Las liquidaciones vinculadas a la factura ' + invoiceRowId + ' superan su saldo neto exigible después de retenciones. No se importó el lote.');
    }
    return { invoiceRowId, invoiceKind, settlements };
  });
};
