import React, { useMemo, useState } from 'react';
import { FileUp, X, CheckCircle2, AlertTriangle, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import ExcelJS from 'exceljs';
import { isValidIsoDate, parseDelimitedRecords, parseMigrationNumber, validateUniqueMigrationHeaders } from '../../types/migrationParsing';
import { detectImportSourceSystem, detectUniversalImportFormat, extractUniversalJsonCollections, resolveUniversalPartyReference, resolveUniversalPurchaseDetailRows, prepareUniversalSaleInventoryLines, prepareUniversalPurchaseInventoryLines, classifyUniversalInvoiceRows, groupUniversalJournalRows, isUniversalMovementTypeConceptValid, normalizeUniversalDocumentReference, findUniversalInvoiceJournalCollision, buildUniversalInvoiceIdentity, mapUniversalInventoryMovementType, mapUniversalInventoryMovementConcept, mapUniversalInventoryCostingMethod, mapUniversalInventoryVatTreatment, planUniversalInvoiceSettlements, validateUniversalSettlementDestination, mapUniversalInvoiceSettlementDrafts, selectUniversalRowsByStableKeys, selectUniversalInvoiceSettlements, mapUniversalInventoryItemType } from '../../types/universalImport';
import { useAccounting } from '../../context/AccountingContext';
import { filterEntriesByCompany } from '../../types/accountingReportIntegrity';

type Row = Record<string, unknown>;
type ModuleId = 'inventory' | 'customers' | 'receivables' | 'payables' | 'sales' | 'purchases' | 'accounts' | 'journal' | 'movements';
type ModuleInfo = { id: ModuleId; name: string; aliases: string[]; fields: string[]; transactional: boolean };
const POSVEN_COLLECTION_LABELS: Array<{label:string; match:RegExp}> = [
 {label:'Ventas y facturación',match:/sale|venta|invoice|factura/i},
 {label:'Compras y proveedores',match:/purchase|compra|supplier|proveedor/i},
 {label:'Inventario y productos',match:/product|inventory|inventario|stock|kardex/i},
 {label:'Clientes y cuentas por cobrar',match:/customer|client|receivable|cxc/i},
 {label:'Cuentas por pagar',match:/payable|cxp/i},
 {label:'Caja, movimientos de caja y cierres',match:/cash|caja|register|shift|corte|report.?z|movimiento.*caja|cash.*movement/i},
 {label:'Contabilidad y libro diario',match:/journal|ledger|account|asiento|diario|accounting/i},
 {label:'Impuestos y retenciones',match:/tax|vat|iva|retention|retencion|islr/i}
];
const MODULES: ModuleInfo[] = [
 { id:'inventory', name:'Inventario / productos', aliases:['code','codigo','sku','name','nombre','product','producto','currentstock','existencia'], fields:['code','name'], transactional:false },
 { id:'customers', name:'Clientes', aliases:['customername','clientename','customer','cliente','customerRif','rifcliente'], fields:['name','rif'], transactional:false },
 { id:'receivables', name:'Cuentas por cobrar (CxC)', aliases:['customername','invoiceNumber','factura','saldo','dueDate','vencimiento'], fields:['invoiceNumber','totalAmountBs'], transactional:true },
 { id:'payables', name:'Cuentas por pagar (CxP)', aliases:['supplierName','proveedor','supplierRif','invoiceNumber','saldo'], fields:['invoiceNumber','totalAmountBs'], transactional:true },
 { id:'sales', name:'Ventas / facturas', aliases:['invoiceDate','invoiceNumber','customerRif','customerName','vatAmountBs'], fields:['invoiceDate','invoiceNumber','totalAmountBs'], transactional:true },
 { id:'purchases', name:'Compras / facturas', aliases:['invoiceDate','invoiceNumber','supplierRif','supplierName','vatAmountBs'], fields:['invoiceDate','invoiceNumber','totalAmountBs'], transactional:true },
 { id:'accounts', name:'Plan de cuentas', aliases:['accountCode','accountName','accountType','codigo cuenta','nombre cuenta'], fields:['code','name','type'], transactional:false },
 { id:'journal', name:'Asientos contables', aliases:['entryNumber','accountCode','debitBs','creditBs','fecha','debe','haber'], fields:['date','items'], transactional:true },
 { id:'movements', name:'Movimientos históricos de inventario', aliases:['productCode','movementType','date','quantity','documentRef'], fields:['productCode','date','type','quantity','unitCostBs'], transactional:true }
];
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const parseCsv = (text: string): Row[] => parseDelimitedRecords(text);
const scalar = (v: unknown): unknown => {
 if (v && typeof v === 'object' && 'text' in v) return (v as {text:unknown}).text;
 if (v && typeof v === 'object' && 'result' in v) return (v as {result:unknown}).result;
 if (v instanceof Date) return v.toISOString().slice(0,10);
 return v;
};
const toRows = (matrix: unknown[][]): Row[] => {
 if(matrix.length<2) return [];
 const headers=validateUniqueMigrationHeaders(matrix[0].map(v=>scalar(v)), 'hoja de Excel');
 return matrix.slice(1).filter(r=>r.some(v=>String(scalar(v)??'').trim())).map(r=>{
  const obj:Row={}; headers.forEach((h,i)=>{if(h)obj[h]=scalar(r[i]);}); return obj;
 });
};
const pick = (row:Row, ...keys:string[]) => {
 for(const key of keys){ const value=row[norm(key)]; if(value!==undefined&&value!==null&&String(value).trim()!=='') return value; }
 return undefined;
};

export const IntelligentMigrationWizard: React.FC<{onClose:()=>void}> = ({onClose}) => {
 const { companies, products: allProducts, getCompanyInventoryProducts, getCompanyInventoryMovements, importInventoryProducts, importInventoryMovements, accounts, bankAccounts, addAccount, addJournalEntry, addSale, addPurchase, addImportedCreditSettlements, runAtomicInvoiceImportAndWait, sales: allSales, purchases: allPurchases, journalEntries: allJournalEntries, currentCompany } = useAccounting();
 const [targetCompanyId, setTargetCompanyId] = useState('');
 const targetCompany = companies.find(company => company.id === targetCompanyId) || null;
 const companyProducts = targetCompany ? getCompanyInventoryProducts(targetCompany.id) : [];
 const companyMovements = targetCompany ? getCompanyInventoryMovements(targetCompany.id) : [];
 const companySales = targetCompany ? filterEntriesByCompany(allSales, targetCompany.id) : [];
 const companyPurchases = targetCompany ? filterEntriesByCompany(allPurchases, targetCompany.id) : [];
 const companyJournalEntries = targetCompany ? filterEntriesByCompany(allJournalEntries, targetCompany.id) : [];
 const [files,setFiles]=useState<File[]>([]);
 const [rows,setRows]=useState<Row[]>([]);
 const [headers,setHeaders]=useState<string[]>([]);
 const [jsonCollectionDiagnostics,setJsonCollectionDiagnostics]=useState<Array<{source:string;path:string;totalItems:number;validRecords:number;invalidItems:number}>>([]);
 const [selected,setSelected]=useState<ModuleId[]>([]);
 const [selectedInventoryRowKeys,setSelectedInventoryRowKeys]=useState<string[]>([]);
 const [selectedModuleRowKeys,setSelectedModuleRowKeys]=useState<Record<string,string[]>>({sales:[],purchases:[],journal:[],movements:[]});
 const [inventoryFilter,setInventoryFilter]=useState('');
 const [moduleFilter,setModuleFilter]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [settlementPreview,setSettlementPreview]=useState<Array<{
  invoiceRowId:string;sourceRowId:string;settlementDate:string;bcvRate:number;amountUsd:number;amountBs:number;
  method:string;reference?:string;destinationError:string|null;
 }>>([]);
 const [selectedSettlementSourceRowIds,setSelectedSettlementSourceRowIds]=useState<string[]>([]);
 const [confirmed,setConfirmed]=useState(false);
 const [backupPayload,setBackupPayload]=useState<string|null>(null);
 const [backupCounts,setBackupCounts]=useState<Record<string,number>|null>(null);
 const [posvenBackup,setPosvenBackup]=useState(false);
 const [posvenQuality,setPosvenQuality]=useState({collections:0,objectRows:0,invalidRows:0,emptyCollections:0,eligibleProducts:0,inactiveProducts:0,kitProducts:0,inactiveKits:0});
 const [selectedPosvenCollections,setSelectedPosvenCollections]=useState<string[]>([]);
 const [posvenBcvRate,setPosvenBcvRate]=useState('');
 const [posvenOpeningDate,setPosvenOpeningDate]=useState('');
 const [posvenVatTreatment,setPosvenVatTreatment]=useState('');
 const [posvenProducts,setPosvenProducts]=useState<Row[]>([]);
 const [posvenExcludedProducts,setPosvenExcludedProducts]=useState<Row[]>([]);
 const [selectedPosvenProductCodes,setSelectedPosvenProductCodes]=useState<string[]>([]);
 const [posvenProductFilter,setPosvenProductFilter]=useState('');
 const inventoryCandidateRows=useMemo(()=>rows.filter(row=>
  (!posvenBackup||norm(String(row.migrationcollection??''))==='productos')&&Boolean(pick(row,'code','codigo','sku','productCode'))&&Boolean(pick(row,'name','nombre','productName','producto'))
 ),[rows,posvenBackup]);
 const filteredInventoryRows=useMemo(()=>{
  const q=norm(inventoryFilter);
  return inventoryCandidateRows.filter(row=>!q||norm([
   pick(row,'code','codigo','sku','productCode'),pick(row,'name','nombre','productName','producto'),
   pick(row,'category','categoria'),row.migrationsource
  ].map(value=>String(value??'')).join(' ')).includes(q));
 },[inventoryCandidateRows,inventoryFilter]);
 const moduleRecordCandidates=useMemo(()=>{
  const result:Record<string,Row[]>={sales:[],purchases:[],journal:[],movements:[]};
  const candidateRows=posvenBackup&&selectedPosvenCollections.length?rows.filter(row=>selectedPosvenCollections.some(collection=>norm(String(row.migrationcollection??''))===norm(collection))):rows;
  const classified=classifyUniversalInvoiceRows(candidateRows);
  result.sales.push(...classified.sales as Row[]);
  result.purchases.push(...classified.purchases as Row[]);
  candidateRows.forEach(row=>{
   const hasAccount=['accountCode','codigoCuenta','cuenta'].some(key=>pick(row,key)!==undefined);
   const hasDate=['date','fecha'].some(key=>pick(row,key)!==undefined);
   const hasReference=['entryNumber','numeroAsiento','asiento','referenceDoc','referencia','documento'].some(key=>pick(row,key)!==undefined);
   if(hasAccount&&hasDate&&hasReference)result.journal.push(row);
   const hasProduct=['productCode','codigoProducto','sku','code','codigo'].some(key=>pick(row,key)!==undefined);
   const hasMovementType=['type','movementType','tipoMovimiento','tipo'].some(key=>pick(row,key)!==undefined);
   const hasMovementReference=['documentRef','referencia','documento','invoiceNumber','numeroDocumento'].some(key=>pick(row,key)!==undefined);
   if(hasProduct&&hasDate&&hasMovementType&&hasMovementReference)result.movements.push(row);
  });
  return result;
 },[rows,posvenBackup,selectedPosvenCollections]);
 const ambiguousInvoiceRows=useMemo(()=>{
  const candidateRows=posvenBackup&&selectedPosvenCollections.length
   ? rows.filter(row=>selectedPosvenCollections.some(collection=>norm(String(row.migrationcollection??''))===norm(collection)))
   : rows;
  return classifyUniversalInvoiceRows(candidateRows).ambiguous;
 },[rows,posvenBackup,selectedPosvenCollections]);
 const filteredPosvenProducts=useMemo(()=>{const q=norm(posvenProductFilter);return posvenProducts.filter(row=>!q||norm([row.codigo,row.nombre,row.categoria,row.departamento].map(value=>String(value??'')).join(' ')).includes(q));},[posvenProducts,posvenProductFilter]);
 const posvenPreview = useMemo(()=>{
  if(!posvenBackup||!backupPayload)return [] as Array<{name:string;count:number;objects:number;invalid:number;fields:string[];identityField:string;missingIdentity:number;duplicateIdentity:number;numericSummaries:Array<{field:string;count:number;sum:number}>;referenceFields:string[];relationshipHints:Array<{field:string;targetCollection:string}>;target:string;mode:string;reason:string;canImport:boolean}>;
  try{
   const root=JSON.parse(backupPayload) as {data?:Record<string,unknown>};
   return Object.entries(root.data??{}).filter(([,value])=>Array.isArray(value)).map(([name,value])=>{
    const list=value as unknown[];const objects=list.filter(row=>!!row&&typeof row==='object'&&!Array.isArray(row)) as Row[];
    const fields=Array.from(new Set(objects.slice(0,5).flatMap(row=>Object.keys(row)))).slice(0,12);
    // Diagnóstico preventivo: la clave candidata no se considera validada.
    const observedKeys=new Set(objects.flatMap(row=>Object.keys(row).map(norm)));
    const key=norm(name);
    const identityCandidates=/venta|sale|factura|invoice|compra|purchase|cxc|cxp|receivable|payable|diario|journal|asiento|reportez|zreport/i.test(key)
     ? ['id','uuid','invoicenumber','numerofactura','numero','documentnumber','referencia','codigo']
     : /producto|product|inventario|inventory|cliente|customer|proveedor|supplier|cuenta|account/i.test(key)
      ? ['id','uuid','sku','codigo','code','rif','taxid','accountcode','codigocuenta']
      : ['id','uuid','codigo','code','number','numero'];
    const identityKey=identityCandidates.find(candidate=>observedKeys.has(candidate))??'';
    const identityField=identityKey?(objects.flatMap(row=>Object.keys(row)).find(field=>norm(field)===identityKey)??identityKey):'';
    const identityValues=identityKey?objects.map(row=>String(row[Object.keys(row).find(field=>norm(field)===identityKey)??'']??'').trim()).filter(Boolean):[];
    const missingIdentity=identityKey?objects.length-identityValues.length:0;
    const identityCounts=new Map<string,number>();
    identityValues.forEach(value=>{const normalized=value.toLocaleLowerCase();identityCounts.set(normalized,(identityCounts.get(normalized)??0)+1);});
    const duplicateIdentity=identityKey?[...identityCounts.values()].reduce((sum,count)=>sum+(count>1?count-1:0),0):0;
    const allFieldNames=Array.from(new Set(objects.flatMap(row=>Object.keys(row))));
    const numericSummaries=allFieldNames.filter(field=>/(total|subtotal|amount|monto|importe|saldo|balance|debit|credit|debe|haber|iva|tax|cost|costo|price|precio|quantity|cantidad|stock|existencia)/i.test(norm(field))).map(field=>{
     const values=objects.map(row=>row[field]).filter(value=>value!==null&&value!==undefined&&String(value).trim()!=='');
     const numbers=values.map(value=>typeof value==='number'?value:typeof value==='string'?parseMigrationNumber(value):NaN);
     const valid=numbers.filter(Number.isFinite);
     return {field,count:valid.length,sum:valid.reduce((total,value)=>total+value,0)};
    }).filter(item=>item.count>0).slice(0,8);
    const referenceFields=allFieldNames.filter(field=>/(id|codigo|code|rif|referencia|documento|factura)/i.test(norm(field))&&/(cliente|customer|proveedor|supplier|producto|product|cuenta|account|venta|sale|compra|purchase|factura|invoice|asiento|journal)/i.test(norm(field))).slice(0,12);
    // Sugerencias nominales solamente: no se comparan valores ni se afirma integridad referencial.
    const relationshipHints=allFieldNames.flatMap(field=>{
     const fieldKey=norm(field);
     const targetPattern =
      /cliente|customer|clienterif|customerrif/.test(fieldKey)?/cliente|customer|clients?/i:
      /proveedor|supplier|vendor/.test(fieldKey)?/proveedor|supplier|vendors?/i:
      /producto|product|sku|itemcode/.test(fieldKey)?/producto|product|inventory|inventario/i:
      /cuenta|accountcode|codigocuenta/.test(fieldKey)?/cuenta|account|plan/i:
      /factura|invoice|ventaid|saleid|documento/.test(fieldKey)?/venta|sale|factura|invoice|compra|purchase/i:
      /asiento|journal|entrynumber/.test(fieldKey)?/diario|journal|asiento/i:null;
     if(!targetPattern)return [];
     const candidates=Object.keys(root.data??{}).filter(candidate=>candidate!==name&&targetPattern.test(candidate));
     return candidates.slice(0,2).map(targetCollection=>({field,targetCollection}));
    }).slice(0,10);
    let target='Sin destino identificado';let mode='No importar automáticamente';let reason='La colección requiere revisión de esquema y significado antes de asignar datos contables.';let canImport=false;
    if(/^(productos|products|inventory|inventario)$/.test(key)){target='Inventario / productos';mode='Adaptador disponible';canImport=true;reason='Importa únicamente artículos activos que no sean kits. El costo Bs se calcula con costoUSD × tasa BCV indicada; exige tratamiento IVA explícito y fecha de corte.';}
    else if(/^(ventas|sales|facturas|invoices)$/.test(key)){
     target='Ventas / facturas';
     const ready=classifyUniversalInvoiceRows(objects).sales.length>0;
     mode=ready?'Adaptador universal disponible':'Revisión de encabezados';
     reason=ready?'Las facturas candidatas se importan una por una mediante el adaptador universal, que valida cliente/RIF, fechas, control, moneda, impuestos, pagos y detalles.':'No se encontraron filas de factura con fecha, total y referencia explícita de cliente. No se importará por semejanza de nombres.';
     canImport=ready;
    }
    else if(/^(compras|purchases)$/.test(key)){
     target='Compras / facturas';
     const ready=classifyUniversalInvoiceRows(objects).purchases.length>0;
     mode=ready?'Adaptador universal disponible':'Revisión de encabezados';
     reason=ready?'Las facturas candidatas se importan una por una mediante el adaptador universal, que valida proveedor/RIF, fecha de abono en cuenta, pago, impuestos, detalle y Kardex.':'No se encontraron filas de factura con fecha, total y referencia explícita de proveedor. No se importará por semejanza de nombres.';
     canImport=ready;
    }
    else if(/^(clientes|customers|clients)$/.test(key)){target='Referencias de clientes';mode='Solo referencia';reason='Cruzar contra facturas; SICOVEN no ofrece importación independiente de este maestro en este flujo.';}
    else if(/^(proveedores|suppliers|vendors)$/.test(key)){target='Referencias de proveedores';mode='Solo referencia';reason='Cruzar contra compras; SICOVEN no ofrece importación independiente de este maestro en este flujo.';}
    else if(/^(cxc|receivables|cuentasporcobrar)$/.test(key)){target='Cuentas por cobrar';mode='Solo conciliación';reason='No contabilizar por separado sin conciliar facturas y pagos; SICOVEN deriva saldos desde ventas a crédito.';}
    else if(/^(cxp|payables|cuentasporpagar)$/.test(key)){target='Cuentas por pagar';mode='Solo conciliación';reason='No contabilizar por separado sin conciliar compras y pagos; SICOVEN deriva saldos desde compras a crédito.';}
    else if(/^(librodiario|journalentries|journal|asientos)$/.test(key)){
     target='Libro diario';
     const has=(keys:string[])=>objects.some(row=>Object.entries(row).some(([field,value])=>keys.includes(norm(field))&&value!==undefined&&value!==null&&String(value).trim()!==''));
     const ready=has(['accountcode','codigocuenta','cuenta'])&&has(['date','fecha'])&&has(['entrynumber','numeroasiento','asiento','referencedoc','referencia','documento'])&&has(['debitbs','debe','debito'])&&has(['creditbs','haber','credito'])&&has(['bcvrate','tasabcv']);
     mode=ready?'Adaptador universal disponible':'Solo conciliación';
     reason=ready?'Las líneas se agrupan por archivo, fecha y referencia; se validan cuentas de movimiento, tasa BCV y cuadre en Bs/USD.':'El libro diario debe entregar líneas con cuenta, fecha, referencia, debe, haber y BCV; no se importa un resumen ni un asiento incompleto.';
     canImport=ready;
    }
    else if(/^(movimientos|movements|stockmovements|inventorymovements)$/.test(key)){
     target='Movimientos de inventario';
     const has=(keys:string[])=>objects.some(row=>Object.entries(row).some(([field,value])=>keys.includes(norm(field))&&value!==undefined&&value!==null&&String(value).trim()!==''));
     const ready=has(['productcode','codigoproducto','sku','codigo','code'])&&has(['date','fecha','movementdate'])&&has(['type','movementtype','tipomovimiento','tipo'])&&has(['concept','concepto','movementconcept'])&&has(['documentref','referencia','documento','invoicenumber'])&&has(['unitcostbs','costobs','costounitario','unitcost'])&&has(['bcvrate','tasabcv'])&&has(['quantity','cantidad','qty']);
     mode=ready?'Adaptador universal disponible':'Revisión de esquema';
     reason=ready?'Solo se importarán movimientos con artículo existente, tipo/concepto compatibles, documento enlazado y fecha/costo/BCV válidos. Saldos iniciales, compras aisladas y devoluciones quedan bloqueados.':'El Kardex requiere código de producto, fecha, tipo, concepto, documento, cantidad, costo Bs y BCV explícitos.';
     canImport=ready;
    }
    else if(/^(devoluciones|returns|anulaciones|voids|cancelaciones)$/.test(key)){target='Devoluciones / anulaciones';mode='Solo conciliación';reason='Requiere enlazar la operación original y validar reversos de inventario, caja, impuestos y contabilidad.';}
    else if(/^(reportesz|zreports|cierresz|cierres)$/.test(key)){target='Reportes Z / cierres';mode='Evidencia de auditoría';reason='No son facturas importables; usar para conciliar totales de ventas, impuestos, medios de pago y caja.';}
    else if(/^(terminales|terminals|cajas|registers)$/.test(key)){target='Configuración operativa';mode='No importar';reason='Requiere una política explícita de equivalencia con las cajas/terminales de SICOVEN.';}
    return {name,count:list.length,objects:objects.length,invalid:list.length-objects.length,fields,identityField,missingIdentity,duplicateIdentity,numericSummaries,referenceFields,relationshipHints,target,mode,reason,canImport};
   });
  }catch{return [] as Array<{name:string;count:number;objects:number;invalid:number;fields:string[];identityField:string;missingIdentity:number;duplicateIdentity:number;numericSummaries:Array<{field:string;count:number;sum:number}>;referenceFields:string[];relationshipHints:Array<{field:string;targetCollection:string}>;target:string;mode:string;reason:string;canImport:boolean}>;}
 },[posvenBackup,backupPayload]);
 const analysis = useMemo(()=>{
  const sources = new Map<string, Row[]>();
  rows.forEach(row=>{
   const source=String(row.migrationsource??'archivo sin nombre');
   const group=sources.get(source)??[];
   group.push(row); sources.set(source,group);
  });
  const detected: Array<ModuleInfo & {source:string; matched:string[]; missing:string[]; detected:boolean; ready:boolean}> = [];
  for(const [source, sourceRows] of sources){
   const keys=new Set(sourceRows.flatMap(row=>Object.keys(row).filter(key=>key!=='migrationsource').map(norm)));
   for(const m of MODULES){
    const matched=m.aliases.filter(a=>keys.has(norm(a)));
    const groupsByModule:Partial<Record<ModuleId,string[][]>>={
     inventory:[['code','codigo','sku','productcode'],['name','nombre','productname','producto']],
     customers:[['customername','clientename','customer','cliente','customerrif','rifcliente'],['rif','taxid','identificacion']],
     receivables:[['customername','cliente','clienterif','rifcliente'],['invoicenumber','invoice','factura','documento'],['saldo','saldoactual','monto','importe','balance','amount']],
     payables:[['suppliername','proveedor','proveedorrif','rifproveedor'],['invoicenumber','invoice','factura','documento'],['saldo','saldoactual','monto','importe','balance','amount']],
     sales:[['invoiceDate','fecha','date'],['invoiceNumber','factura','documento'],['totalAmountBs','total','totalbs','monto']],
     purchases:[['invoiceDate','fecha','date'],['invoiceNumber','factura','documento'],['totalAmountBs','total','totalbs','monto']],
     accounts:[['accountCode','codigo','code','cuenta'],['accountName','nombre','descripcion','name']],
     journal:[['fecha','date'],['accountCode','cuenta','codigocuenta'],['debitBs','debito','debe','debit'],['creditBs','credito','haber','credit']],
     movements:[['productCode','codigoProducto','sku','code','codigo'],['date','fecha','movementDate'],['type','movementType','tipoMovimiento','tipo'],['documentRef','referencia','documento'],['quantity','cantidad','qty','balanceQty','existenciaFinal'],['unitCostBs','costoUnitarioBs','unitCost','costoUnitario']]
    };
    const groups=groupsByModule[m.id]??[m.fields];
    const matchedGroups=groups.filter(group=>group.some(key=>keys.has(norm(key)))).length;
    const specificSignals:Partial<Record<ModuleId,string[]>>={
     inventory:['sku','productcode','itemcode','existencia','currentstock'],
     customers:['customerid','customerrif','rifcliente','taxid','identificacion'],
     receivables:['customername','clienterif','rifcliente'],
     payables:['suppliername','supplierid','supplierrif','rifproveedor'],
     sales:['invoicenumber','numerofactura','customerrif'],
     purchases:['invoicenumber','numerofactura','supplierrif'],
     accounts:['accountcode','accountname','clasificacion'],
     journal:['accountcode','codigocuenta','debitbs','creditbs','debe','haber'],
     movements:['productcode','codigoproducto','sku','documentref','movementtype','tipomovimiento']
    };
    const hasSpecific=(specificSignals[m.id]??[]).some(key=>keys.has(norm(key)));
    if(matchedGroups<2&&!hasSpecific) continue;
    const missing=m.fields.filter(field=>!keys.has(norm(field)));
    const ready=m.id==='inventory'&&groups[0].some(k=>keys.has(norm(k)))&&groups[1].some(k=>keys.has(norm(k)))&&
     ['currentstock','existencia','stock','quantity','cantidad'].some(k=>keys.has(norm(k)))&&
     ['avgcostbs','costopromediobs','costbs','costobs','costo','costounitario','unitcost'].some(k=>keys.has(norm(k)))&&
     ['salespricebs','precioventabs','pricebs','precioventa'].some(k=>keys.has(norm(k)));
    const accountReady=m.id==='accounts'&&['code','accountcode','codigo','codigocuenta'].some(k=>keys.has(norm(k)))&&['name','accountname','nombre','nombrecuenta'].some(k=>keys.has(norm(k)))&&['type','accounttype','tipo','tipocuenta','clasificacion'].some(k=>keys.has(norm(k)));
    const journalReady=m.id==='journal'&&['date','fecha'].some(k=>keys.has(norm(k)))&&['accountcode','codigocuenta','cuenta'].some(k=>keys.has(norm(k)))&&['debitbs','debe','debito'].some(k=>keys.has(norm(k)))&&['creditbs','haber','credito'].some(k=>keys.has(norm(k)));
    const salesReady=m.id==='sales'&&classifyUniversalInvoiceRows(sourceRows).sales.length>0;
    const purchasesReady=m.id==='purchases'&&classifyUniversalInvoiceRows(sourceRows).purchases.length>0;
    const movementsReady=m.id==='movements'&&['productcode','codigoproducto','sku','code','codigo'].some(k=>keys.has(norm(k)))&&['date','fecha','movementdate'].some(k=>keys.has(norm(k)))&&['type','movementtype','tipomovimiento','tipo'].some(k=>keys.has(norm(k)))&&['concept','concepto','movementconcept'].some(k=>keys.has(norm(k)))&&['documentref','referencia','documento','invoicenumber'].some(k=>keys.has(norm(k)))&&['unitcostbs','costobs','costounitario','unitcost'].some(k=>keys.has(norm(k)))&&['bcvrate','tasabcv'].some(k=>keys.has(norm(k)))&&(['quantity','cantidad','qty'].some(k=>keys.has(norm(k)))||['balanceqty','existenciafinal','stockfinal'].some(k=>keys.has(norm(k))));
    const readyFinal=ready||accountReady||journalReady||salesReady||purchasesReady||movementsReady;
    detected.push({...m,source,matched,missing,detected:true,ready:readyFinal});
   }
  }
  return detected;
 },[rows]);
 const readFiles=async(list:File[])=>{
  setError('');setNotice('');setRows([]);setHeaders([]);setJsonCollectionDiagnostics([]);setSelected([]);setSelectedInventoryRowKeys([]);setSelectedModuleRowKeys({sales:[],purchases:[],journal:[],movements:[]});setInventoryFilter('');setConfirmed(false);setBackupPayload(null);setBackupCounts(null);setPosvenBackup(false);setPosvenQuality({collections:0,objectRows:0,invalidRows:0,emptyCollections:0,eligibleProducts:0,inactiveProducts:0,kitProducts:0,inactiveKits:0});setSelectedPosvenCollections([]);setPosvenBcvRate('');setPosvenOpeningDate('');setPosvenVatTreatment('');setPosvenProducts([]);setPosvenExcludedProducts([]);setSelectedPosvenProductCodes([]);setPosvenProductFilter('');setFiles(list);
  if(!list.length)return;
  try{
   if(list.length===1 && list[0].name.toLowerCase().endsWith('.json')){
    const raw=await list[0].text();
    const data=JSON.parse(raw);
    // Detectar respaldos POSVEN versionados cuyo contenido vive dentro de data.
    // No se deben tratar como respaldo nativo de SICOVEN ni restaurar a ciegas.
    if(detectImportSourceSystem(data).id==='posven-pro' && (data as Record<string,unknown>).data && typeof (data as Record<string,unknown>).data==='object' && !Array.isArray((data as Record<string,unknown>).data)){
     const payload=(data as {data:Record<string,unknown>}).data;
     const arrayCollections=Object.entries(payload).filter(([,value])=>Array.isArray(value));
     const counts=Object.fromEntries(arrayCollections.map(([key,value])=>[key,(value as unknown[]).length]));
     const allRows=arrayCollections.flatMap(([,value])=>value as unknown[]);
     const objectRows=allRows.filter(value=>!!value&&typeof value==='object'&&!Array.isArray(value)).length;
     const productRows=Array.isArray(payload.productos)?payload.productos.filter((row):row is Record<string,unknown>=>!!row&&typeof row==='object'&&!Array.isArray(row)):[];
     const eligibleProductRows=productRows.filter(row=>row.activo===true&&row.isKit!==true);
     setPosvenProducts(eligibleProductRows as Row[]);setPosvenExcludedProducts(productRows.filter(row=>row.activo!==true||row.isKit===true) as Row[]);setSelectedPosvenProductCodes([]);
     const universalRows:Row[]=arrayCollections.flatMap(([collection,value])=>(value as unknown[]).flatMap((item,index)=>{
      if(!item||typeof item!=='object'||Array.isArray(item))return [];
      const normalized:Row={};for(const [key,cell] of Object.entries(item as Row)){const normalizedKey=norm(key);if(normalizedKey)normalized[normalizedKey]=scalar(cell);}
      return [{...normalized,migrationsource:'POSVEN-Pro · colección: '+collection,migrationfile:list[0].name,migrationcollection:collection,migrationrowid:'POSVEN|'+collection+'|'+index}];
     }));
     setRows(universalRows);setHeaders(Array.from(new Set(universalRows.flatMap(row=>Object.keys(row)))));
     setJsonCollectionDiagnostics(arrayCollections.map(([path,value])=>({source:'Archivo 1 · '+list[0].name,path:String(path),totalItems:(value as unknown[]).length,validRecords:(value as unknown[]).filter(item=>!!item&&typeof item==='object'&&!Array.isArray(item)).length,invalidItems:(value as unknown[]).filter(item=>!item||typeof item!=='object'||Array.isArray(item)).length})));
     setPosvenQuality({collections:arrayCollections.length,objectRows,invalidRows:allRows.length-objectRows,emptyCollections:arrayCollections.filter(([,value])=>(value as unknown[]).length===0).length,eligibleProducts:productRows.filter(row=>row.activo===true&&row.isKit!==true).length,inactiveProducts:productRows.filter(row=>row.activo!==true).length,kitProducts:productRows.filter(row=>row.isKit===true).length,inactiveKits:productRows.filter(row=>row.activo!==true&&row.isKit===true).length});
     setBackupPayload(raw);setBackupCounts(counts);setPosvenBcvRate(String(payload.tasa??''));setPosvenOpeningDate(String((data as Record<string,unknown>).createdAt??'').slice(0,10));setPosvenVatTreatment('');setSelectedPosvenCollections([]);setPosvenBackup(true);
     return;
    }

   }
   const combined:Row[]=[]; const allHeaders = new Set<string>(); const jsonDiagnostics:Array<{source:string;path:string;totalItems:number;validRecords:number;invalidItems:number}>=[];
   for(const [fileIndex,file] of list.entries()){
    const ext=detectUniversalImportFormat(file.name);
    let parsed:Row[]=[];
    if(ext==='json'){
     const data=JSON.parse(await file.text());
     const collections=extractUniversalJsonCollections(data);
     if(!collections.length){
      throw new Error(file.name+': no se encontraron arreglos/colecciones JSON para analizar.');
     }
     jsonDiagnostics.push(...collections.map(collection=>({
      source:'Archivo '+(fileIndex+1)+' · '+file.name,
      path:collection.path,
      totalItems:collection.totalItems,
      validRecords:collection.rows.length,
      invalidItems:collection.invalidItems
     })));
     // Los elementos que no son objetos se contabilizan y explican; no se
     // convierten en registros ni provocan que se descarte el resto del archivo.
     parsed=collections.flatMap(collection=>collection.rows.map(row=>({...row,__sicovenImportSource:'Archivo '+(fileIndex+1)+' · '+file.name+' — colección: '+collection.path})));
    }else if(ext==='csv'||ext==='tsv'||ext==='txt'){
     parsed=parseCsv(await file.text());
    }else if(ext==='xlsx'||ext==='xlsm'){
     const wb=new ExcelJS.Workbook(); await wb.xlsx.load(await file.arrayBuffer());
     if(!wb.worksheets.length)throw new Error(file.name+': no contiene hojas.');
     const sheetRows: Row[] = [];
     for(const sheet of wb.worksheets){
      const matrix:unknown[][]=[];
      sheet.eachRow({includeEmpty:false},row=>{const vals:unknown[]=[];for(let c=1;c<=row.cellCount;c++)vals.push(scalar(row.getCell(c).value));matrix.push(vals);});
      const parsedSheet=toRows(matrix).map(row => ({ ...row, __sicovenImportSource: 'Archivo ' + (fileIndex+1) + ' · ' + file.name + ' — hoja: ' + sheet.name }));
      if(parsedSheet.length) sheetRows.push(...parsedSheet);
     }
     parsed=sheetRows;
    }else throw new Error(file.name+': formato no admitido. Use JSON, CSV, TSV, TXT o Excel XLSX/XLSM.');
    parsed=parsed.map((row,rowIndex)=>{const normalized:Row={};const seenKeys=new Set<string>();let sourceLabel='Archivo '+(fileIndex+1)+' · '+file.name;for(const [key,value] of Object.entries(row)){if(norm(key)==='sicovenimportsource'){if(norm(key)==='sicovenimportsource'&&String(value??'').trim())sourceLabel=String(value);continue;}const normalizedKey=norm(key);if(!normalizedKey)continue;if(seenKeys.has(normalizedKey))throw new Error(file.name+', registro '+(rowIndex+1)+': hay claves duplicadas tras normalizar acentos, mayúsculas o signos ('+key+').');seenKeys.add(normalizedKey);normalized[normalizedKey]=scalar(value);}const sourceParts=sourceLabel.split(' — ');const collectionPart=sourceParts.slice(1).join(' — ');return {...normalized,migrationsource:sourceLabel,migrationfile:sourceParts[0],migrationcollection:collectionPart.replace(/^(colección|hoja): /i,''),migrationrowid:sourceLabel+'|'+rowIndex};});
    if(!parsed.length&&ext!=='json')throw new Error(file.name+': no se detectaron filas de datos.');
    for (const row of parsed) for (const key of Object.keys(row)) allHeaders.add(norm(key));
    combined.push(...parsed);
   }
   setRows(combined);setHeaders(Array.from(allHeaders));setJsonCollectionDiagnostics(jsonDiagnostics);
   const keySet=new Set(Array.from(allHeaders));
   const detected=MODULES.filter(m=>m.aliases.filter(a=>keySet.has(norm(a))).length>=Math.min(2,m.aliases.length)).map(m=>m.id);
   const inventorySources = new Map<string, Row[]>();
   combined.forEach(row => { const source = String(row.migrationsource ?? 'archivo sin nombre'); const group = inventorySources.get(source) ?? []; group.push(row); inventorySources.set(source, group); });
   const inventoryReadyInOneSource = [...inventorySources.values()].some(sourceRows => {
    const sourceKeys = new Set(sourceRows.flatMap(row => Object.keys(row).filter(key => key !== 'migrationsource').map(norm)));
    return [['code','codigo','sku','productCode'],['name','nombre','productName','producto'],['currentStock','existencia','stock','quantity','cantidad'],['avgCostBs','costoPromedioBs','costBs','costoBs','costObs','costo','costoUnitario','unitCost'],['salesPriceBs','precioVentaBs','priceBs','salesPrice','precioVenta']].every(group => group.some(key => sourceKeys.has(norm(key))));
   });
   setSelected(inventoryReadyInOneSource && detected.includes('inventory') ? ['inventory'] : []);
  }catch(e){setError(e instanceof Error?e.message:'No se pudieron leer los archivos.');}
 };
 const runPosvenImport=async()=>{
  setError('');setNotice('');
  if(!targetCompany){setError('Selecciona una empresa destino válida antes de importar.');return;}
  if(!backupPayload||!selectedPosvenCollections.includes('productos')){setError('Selecciona la colección Productos para importar.');return;}
  if(selectedPosvenCollections.length!==1){setError('Este adaptador solo permite importar Productos en esta etapa. Las demás colecciones quedan visibles para revisión y conciliación.');return;}
  if(!confirmed){setError('Confirma la importación de los artículos seleccionados.');return;}
  if(!['GENERAL_16','REDUCIDA_8','EXENTO','EXONERADO'].includes(posvenVatTreatment)){setError('Selecciona expresamente el tratamiento de IVA que corresponde a estos artículos. El campo aplicaIVA=false de POSVEN no distingue por sí solo entre exento, exonerado o no sujeto.');return;}
  const rate=parseMigrationNumber(posvenBcvRate);
  if(!Number.isFinite(rate)||rate<=0){setError('Indica una tasa BCV positiva para valorar el inventario a la fecha de apertura.');return;}
  if(!isValidIsoDate(posvenOpeningDate)){setError('Indica una fecha de corte válida para la apertura del inventario.');return;}
  setBusy(true);
  try{
   const root=JSON.parse(backupPayload) as {data?:Record<string,unknown>};
   const source=root.data?.productos;
   if(!Array.isArray(source))throw new Error('El respaldo no contiene la colección productos.');
   const eligible=source.filter((row):row is Row=>!!row&&typeof row==='object'&&!Array.isArray(row)&&(row as Row).activo===true&&(row as Row).isKit!==true);
   const selectedRows=eligible.filter(row=>selectedPosvenProductCodes.includes(String(row.codigo??'').trim()));
   if(!selectedRows.length)throw new Error('Selecciona al menos un artículo de la lista para importar.');
   const seen=new Set<string>();
   const existing=new Set(companyProducts.map(product=>product.code.trim().toLocaleUpperCase()));
   const prepared=selectedRows.map((row,index)=>{
    const code=String(row.codigo??'').trim();
    const name=String(row.nombre??'').trim();
    if(!code||!name)throw new Error('Producto '+(index+1)+': código y nombre son obligatorios.');
    const normalizedCode=code.toLocaleUpperCase();
    if(seen.has(normalizedCode))throw new Error('El respaldo contiene códigos duplicados: '+code+'. No se importó ningún artículo.');
    seen.add(normalizedCode);
    const numeric=(field:string,required=true)=>{
     const raw=row[field];
     if(raw===undefined||raw===null||String(raw).trim()===''){if(required)throw new Error('Producto '+code+': falta el campo '+field+'.');return 0;}
     const value=parseMigrationNumber(raw);
     if(!Number.isFinite(value)||value<0)throw new Error('Producto '+code+': el campo '+field+' no contiene un número válido no negativo.');
     return value;
    };
    const stock=numeric('stock');
    const costUsd=numeric('costoUSD');
    if(stock>0&&costUsd<=0)throw new Error('Producto '+code+': tiene existencia pero no tiene costo USD positivo.');
    const priceUsd=numeric('precioUSD');
    const priceBs=numeric('precioBS');
    const minStock=numeric('stockMinimo',false);
    const costBs=costUsd*rate;
    if(!Number.isFinite(costBs))throw new Error('Producto '+code+': el costo convertido a Bs no es válido.');
    return {code,name,category:String(row.categoria??row.departamento??'General').trim()||'General',unit:String(row.cantidad??'Unidad').trim()||'Unidad',minStock,currentStock:stock,avgCostBs:costBs,avgCostUsd:costUsd,lastCostBs:costBs,lastCostUsd:costUsd,salesPriceBs:priceBs,salesPriceUsd:priceUsd,costingMethod:'PROMEDIO_PONDERADO' as const,vatTreatment:posvenVatTreatment as 'GENERAL_16'|'REDUCIDA_8'|'EXENTO'|'EXONERADO',itemType:'MERCANCIA' as const,openingDate:posvenOpeningDate,openingBcvRate:rate};
   });
   const duplicates=prepared.filter(product=>existing.has(product.code.toLocaleUpperCase()));
   const toImport=prepared.filter(product=>!existing.has(product.code.toLocaleUpperCase()));
   if(!toImport.length)throw new Error('Todos los códigos de productos activos no-kit ya existen en SICOVEN. No se sobrescribió ningún artículo.');
   const imported=await importInventoryProducts(toImport,targetCompany.id);
   setNotice('Inventario POSVEN importado en '+targetCompany.name+' (RIF '+targetCompany.rif+'): '+imported+' artículos nuevos. De los '+eligible.length+' activos no-kit se seleccionaron '+selectedRows.length+'; quedaron sin seleccionar '+(eligible.length-selectedRows.length)+'. Excluidos automáticamente: '+posvenQuality.inactiveProducts+' inactivos y '+posvenQuality.kitProducts+' kits ('+posvenQuality.inactiveKits+' pertenecen a ambas categorías). Se omitieron '+duplicates.length+' códigos que ya existían en SICOVEN. Se creó la apertura con fecha '+posvenOpeningDate+' y tasa BCV '+rate.toLocaleString('es-VE')+'. No se importaron ventas, movimientos ni saldos CxC/CxP en esta operación.');
   setSelectedPosvenCollections([]);setConfirmed(false);
  }catch(e){setError(e instanceof Error?e.message:'No se pudo adaptar el inventario POSVEN.');}
  finally{setBusy(false);}
 };
 const runBackupImport=async()=>{
  setError('');
  setNotice('');
  setError('El Importador Inteligente Universal no restaura respaldos completos ni reemplaza los datos actuales. Los archivos se deben analizar por colecciones y cada módulo debe importarse mediante su adaptador con la empresa destino explícita. No se modificó ningún dato.');
 };
 const runMigration=async()=>{
  setError('');setNotice('');setSettlementPreview([]);
  if(!confirmed){setError('Marca la confirmación final antes de ejecutar la migración.');return;}
  if(!targetCompany){setError('Selecciona una empresa destino válida.');return;}
  if(selected.includes('accounts')){setError('El plan de cuentas de SICOVEN es actualmente un catálogo compartido por todas las empresas, no un catálogo separado por empresa. Para evitar mezclar planes contables, esta colección queda en análisis y conciliación; no se importará hasta que SICOVEN disponga de planes de cuentas por empresa.');return;}
  const available = new Set(headers.map(norm));
  const requiredInventoryFields = [['code','codigo','sku','productCode'],['name','nombre','productName','producto'],['currentStock','existencia','stock','quantity','cantidad'],['avgCostBs','costoPromedioBs','costBs','costoBs','costObs','costo','costoUnitario','unitCost'],['salesPriceBs','precioVentaBs','priceBs','salesPrice','precioVenta']];
  if(selected.includes('inventory')){
   const missingInventoryFields = requiredInventoryFields.filter(group => !group.some(key => available.has(norm(key)))).map(group => group[0]);
   if (missingInventoryFields.length) { setError('No se puede migrar Inventario: faltan campos esenciales '+missingInventoryFields.join(', ')+'. No se supondrán existencias, costos ni precios en cero.'); return; }
  }
  if(selected.length<1 || !['inventory','journal','sales','purchases','movements'].includes(selected[0])){setError('Selecciona al menos un módulo con importador disponible: Inventario, Asientos, Ventas o Compras.');return;}
  setBusy(true);
  try{
   if(selected[0]==='sales'||selected[0]==='purchases'){
    const kind=selected[0];
    const classified=classifyUniversalInvoiceRows(rows);
    const classifiedRows=(kind==='sales'?classified.sales:classified.purchases) as Row[];
    const sourceRows=selectUniversalRowsByStableKeys(classifiedRows,selectedModuleRowKeys[kind]??[]);
    if(!(selectedModuleRowKeys[kind]??[]).length)throw new Error('Selecciona individualmente las facturas que deseas importar. No se importó ningún documento.');
    if(sourceRows.length===0)throw new Error('No se identificaron archivos con encabezados de '+(kind==='sales'?'ventas y cliente':'compras y proveedor')+'. Verifica número de factura y datos de la contraparte.');
    const settlementPlans=planUniversalInvoiceSettlements(sourceRows,rows,kind);
    const settlementPlanByInvoice=new Map(settlementPlans.map(plan=>[plan.invoiceRowId,plan]));
    const linkedSettlementPreview=settlementPlans.flatMap(plan=>plan.settlements.map(settlement=>({
     invoiceRowId:plan.invoiceRowId,
     sourceRowId:settlement.sourceRowId,
     settlementDate:settlement.settlementDate,
     bcvRate:settlement.bcvRate,
     amountUsd:settlement.amountUsd,
     amountBs:settlement.amountBs,
     method:settlement.method,
     reference:settlement.reference,
     destinationError:validateUniversalSettlementDestination(settlement,targetCompany.id,bankAccounts,accounts)
    })));
    if(linkedSettlementPreview.length){
     setSettlementPreview(linkedSettlementPreview);
     setSelectedSettlementSourceRowIds(linkedSettlementPreview.map(item=>item.sourceRowId));
     const unresolved=linkedSettlementPreview.filter(item=>item.destinationError).length;
     if(unresolved){
      setNotice('Se detectaron '+linkedSettlementPreview.length+' liquidaciones vinculadas. '+unresolved+' requieren corregir o asignar su cuenta destino. No se importó ningún documento ni se alteraron saldos.');
      setBusy(false);
      return;
     }
    }
    const dateValue=(r:Row,i:number)=>{const value=String(pick(r,'invoiceDate','fechaFactura','fecha de factura','fechaEmision','fecha')??'').slice(0,10);if(!isValidIsoDate(value))throw new Error('Fila '+(i+1)+': fecha de factura inválida; use AAAA-MM-DD.');return value;};
    const num=(r:Row,i:number,required:boolean,...keys:string[])=>{const raw=pick(r,...keys);if((raw===undefined||raw==='')&&required)throw new Error('Fila '+(i+1)+': falta el campo obligatorio '+keys[0]+'.');const value=raw===undefined||raw===''?0:parseMigrationNumber(raw);if(!Number.isFinite(value)||value<0)throw new Error('Fila '+(i+1)+': importe inválido en '+keys[0]+'.');return value;};
    const documentKey=(invoiceNumber:string,partyRif:string)=>buildUniversalInvoiceIdentity(kind,invoiceNumber,partyRif);
    const controlKey=(controlNumber:string,partyRif:string)=>norm(controlNumber)+'|'+norm(partyRif);
    const seen=new Set<string>();
    const seenControls=new Set<string>();
    const existingDocs=new Set((kind==='sales'?companySales.map(d=>documentKey(d.invoiceNumber||'',d.customerRif||'')):companyPurchases.map(d=>documentKey(d.invoiceNumber||'',d.supplierRif||''))));
    const existingControls=new Set((kind==='sales'?companySales.map(d=>controlKey(d.controlNumber||'',d.customerRif||'')):companyPurchases.map(d=>controlKey(d.controlNumber||'',d.supplierRif||''))).filter(key=>!key.startsWith('|')));
    const prepared=sourceRows.map((r,i)=>{
     const invoiceNumber=String(pick(r,'invoiceNumber','numeroFactura','numero de factura','factura','documento','numeroDocumento','nroFactura','numFactura','numero')??'').trim();
     const resolvedParty=resolveUniversalPartyReference(rows,r,kind==='sales'?'customer':'supplier');
     const partyName=resolvedParty.name;
     const partyRif=resolvedParty.rif;
     const incomingControl=String(pick(r,'controlNumber','numeroControl','numero de control','nroControl','control')??'').trim();
     const key=documentKey(invoiceNumber,partyRif);
     if(!invoiceNumber||!partyName||!partyRif)throw new Error('Fila '+(i+1)+': número de factura, nombre y RIF de cliente/proveedor son obligatorios.');
     const existingLedgerEntry=kind==='sales'?findUniversalInvoiceJournalCollision(invoiceNumber,companyJournalEntries,'VENTA'):undefined;
     if(existingLedgerEntry)throw new Error('Fila '+(i+1)+': ya existe un asiento contable con la referencia '+String(existingLedgerEntry.referenceDoc??invoiceNumber)+'. No se importará la factura para evitar duplicar su contabilización. Importe el documento desde Ventas o Compras, no desde el Libro Diario.');

     if(seen.has(key)||existingDocs.has(key))throw new Error('Factura duplicada para el mismo cliente/proveedor o ya existente: '+invoiceNumber+' ('+partyRif+'). No se sobrescribieron documentos.');seen.add(key);
     if(!incomingControl)throw new Error('Fila '+(i+1)+': número de control obligatorio.');
     const controlIdentity=controlKey(incomingControl,partyRif);
     if(seenControls.has(controlIdentity)||existingControls.has(controlIdentity))throw new Error('Número de control duplicado para el mismo cliente/proveedor o ya existente: '+incomingControl+' ('+partyRif+'). No se importó ningún documento.');
     seenControls.add(controlIdentity);
     const invoiceDate=dateValue(r,i);
     const totalAmountBs=num(r,i,true,'totalAmountBs','totalBs','total','montoTotal','importeTotal','monto','importe');
     const exemptAmountBs=num(r,i,true,'exemptAmountBs','montoExentoBs','exentoBs');
     const taxableBaseBs=num(r,i,true,'taxableBaseBs','baseImponibleBs','baseBs');
     const taxRate=num(r,i,true,'taxRate','alicuota','tasaIva');
     const vatAmountBs=num(r,i,true,'vatAmountBs','ivaBs','montoIvaBs');
     const vatWithheldBs=num(r,i,true,'vatWithheldBs','ivaRetenidoBs','retencionIvaBs');
     const bcvRate=num(r,i,true,'bcvRate','tasaBcv','tasaBcvHistorica');
     const totalAmountUsd=num(r,i,true,'totalAmountUsd','totalUsd');
     const taxableBaseUsd=num(r,i,true,'taxableBaseUsd','baseImponibleUsd','baseUsd');
     const exemptAmountUsd=num(r,i,true,'exemptAmountUsd','montoExentoUsd','exentoUsd');
     const vatAmountUsd=num(r,i,true,'vatAmountUsd','ivaUsd');
     const vatWithheldUsd=num(r,i,true,'vatWithheldUsd','ivaRetenidoUsd');
     const paymentTermRaw=norm(String(pick(r,'paymentTerm','condicionPago','condicion','tipoPago','formaPago')??''));
     if(!['contado','credito','cash','credit'].includes(paymentTermRaw))throw new Error('Fila '+(i+1)+': indique expresamente paymentTerm CONTADO o CREDITO; no se supondrá la condición de pago.');
     const paymentTerm=(paymentTermRaw==='contado'||paymentTermRaw==='cash'?'CONTADO':'CREDITO') as 'CONTADO'|'CREDITO';
     if(kind==='sales'&&paymentTerm==='CONTADO'){
      throw new Error('Fila '+(i+1)+': esta etapa no importa ventas de contado porque el archivo debe identificar y contabilizar la tesorería receptora. No se registrará como CxC ficticia.');
     }
     const creditDays=paymentTerm==='CREDITO'?num(r,i,true,'creditDays','diasCredito'):0;
     const dueDate=paymentTerm==='CREDITO'?String(pick(r,'dueDate','fechaVencimiento','vencimiento')??'').slice(0,10):undefined;
     if(paymentTerm==='CREDITO'&&(!Number.isInteger(creditDays)||creditDays<1||!isValidIsoDate(dueDate)))throw new Error('Fila '+(i+1)+': las facturas a crédito requieren días de crédito y vencimiento válidos.');
     const rate=bcvRate;
     if(rate<=0)throw new Error('Fila '+(i+1)+': declare la tasa BCV histórica de la factura. No se utilizará la tasa actual de la empresa destino para valorar documentos antiguos.');
     const expectedBs=taxableBaseBs+exemptAmountBs+vatAmountBs;
     const expectedUsd=taxableBaseUsd+exemptAmountUsd+vatAmountUsd;
     if(Math.abs(expectedBs-totalAmountBs)>0.02||Math.abs(expectedUsd-totalAmountUsd)>0.02)throw new Error('Fila '+(i+1)+': el total no cuadra con base imponible, exento e IVA en Bs/USD.');
     if(Math.abs(totalAmountBs/rate-totalAmountUsd)>0.02||Math.abs(taxableBaseBs/rate-taxableBaseUsd)>0.02||Math.abs(exemptAmountBs/rate-exemptAmountUsd)>0.02||Math.abs(vatAmountBs/rate-vatAmountUsd)>0.02||Math.abs(vatWithheldBs/rate-vatWithheldUsd)>0.02)throw new Error('Fila '+(i+1)+': los importes en USD no corresponden a los importes en Bs divididos por la tasa BCV histórica declarada. Corrija los datos antes de importar.');
     if(vatWithheldBs>totalAmountBs||vatWithheldUsd>totalAmountUsd)throw new Error('Fila '+(i+1)+': la retención supera el total de la factura.');
     const documentTypeValue=pick(r,'documentType','tipoDocumento','codigoTipoDocumento');
     if(documentTypeValue===undefined||String(documentTypeValue).trim()==='')throw new Error('Fila '+(i+1)+': declare expresamente el tipo de documento. No se supondrá que una fila sin clasificación es una factura (01).');
     const documentTypeRaw=String(documentTypeValue).trim();
     if(!['01','02','03'].includes(documentTypeRaw))throw new Error('Fila '+(i+1)+': tipo de documento inválido; use 01, 02 o 03.');
     if(documentTypeRaw!=='01')throw new Error('Fila '+(i+1)+': las notas de débito/crédito requieren flujos de corrección fiscal y contable enlazados a su factura original. Este adaptador solo importa facturas (01).');
     const common={sourceRowId:String(r.migrationrowid??'').trim(),invoiceDate,invoiceNumber,controlNumber:String(pick(r,'controlNumber','numeroControl','numero de control')??'').trim(),documentType:documentTypeRaw as '01'|'02'|'03',totalAmountBs,exemptAmountBs,exemptAmountUsd,taxableBaseBs,taxRate,vatAmountBs,vatWithheldBs,bcvRate:rate,totalAmountUsd,taxableBaseUsd,vatAmountUsd,vatWithheldUsd,notes:String(pick(r,'notes','observaciones')??''),paymentTerm,creditDays,dueDate,currencyPricingMode:'REVISION_MANUAL' as const,fiscalAdjustmentMode:'REVISION_CONTADOR' as const};
     if(!common.controlNumber)throw new Error('Fila '+(i+1)+': número de control obligatorio.');
     if(kind==='sales'){
      const nestedSaleLines=pick(r,'inventoryLines','saleLines','productLines','items','lines','details','detalles','detalle','articulos','productos');
      const relatedSaleDetails=resolveUniversalPurchaseDetailRows(rows,r);
      const rawSaleLines=Array.isArray(nestedSaleLines)&&nestedSaleLines.length?nestedSaleLines:relatedSaleDetails;
      const inventoryLines=rawSaleLines.length?prepareUniversalSaleInventoryLines(rawSaleLines,companyProducts,{taxRate,taxableBaseBs,exemptAmountBs,vatAmountBs,bcvRate:rate}):undefined;
      const outstandingRaw=pick(r,'outstandingBalanceBs','balanceDueBs','saldoPendienteBs','saldoActualBs','saldoPendiente','saldo');
      const outstandingUsdRaw=pick(r,'outstandingBalanceUsd','balanceDueUsd','saldoPendienteUsd');
      if(paymentTerm==='CREDITO'&&(outstandingRaw!==undefined||outstandingUsdRaw!==undefined)){
       const settledUsd=(settlementPlanByInvoice.get(String(r.migrationrowid))?.settlements||[]).reduce((sum,item)=>sum+Math.round((item.amountUsd+Number.EPSILON)*100)/100,0);
       const expectedOutstandingBs=Math.max(0,totalAmountBs-vatWithheldBs-settledUsd*rate);
       const expectedOutstandingUsd=Math.max(0,totalAmountUsd-vatWithheldUsd-settledUsd);
       if(outstandingRaw!==undefined&&(!Number.isFinite(parseMigrationNumber(outstandingRaw))||parseMigrationNumber(outstandingRaw)<0||Math.abs(parseMigrationNumber(outstandingRaw)-expectedOutstandingBs)>0.02))throw new Error('Fila '+(i+1)+': el saldo pendiente en Bs no coincide con CxC neta después de retenciones y liquidaciones detalladas.');
       if(outstandingUsdRaw!==undefined&&(!Number.isFinite(parseMigrationNumber(outstandingUsdRaw))||parseMigrationNumber(outstandingUsdRaw)<0||Math.abs(parseMigrationNumber(outstandingUsdRaw)-expectedOutstandingUsd)>0.02))throw new Error('Fila '+(i+1)+': el saldo pendiente en USD no coincide con CxC neta después de retenciones y liquidaciones detalladas.');
      }
      return {...common,customerRif:partyRif,customerName:partyName,customerAddress:String(pick(r,'customerAddress','direccionCliente')??resolvedParty.address??''),retentionRate:num(r,i,false,'retentionRate','tasaRetencion'),retentionVoucherNumber:String(pick(r,'retentionVoucherNumber','comprobanteRetencion')??'')||undefined,inventoryLines};
     }
     const accountCreditDate=String(pick(r,'accountCreditDate','fechaAbonoCuenta','fechaReconocimiento','fechaPago')??'').slice(0,10);
     if(!isValidIsoDate(accountCreditDate))throw new Error('Fila '+(i+1)+': las compras requieren la fecha efectiva de abono en cuenta/pago (accountCreditDate). No se inferirá desde la fecha de factura.');
     const paymentAccountCode=String(pick(r,'paymentAccountCode','cuentaPago','codigoCuentaPago')??'').trim();
     const paymentReference=String(pick(r,'paymentReference','referenciaPago','comprobantePago')??'').trim();
     if(paymentTerm==='CONTADO'&&(!paymentAccountCode||!paymentReference))throw new Error('Fila '+(i+1)+': la compra de contado requiere cuenta contable de pago y referencia del desembolso.');
     const purchaseDebitAccountCode=String(pick(r,'purchaseDebitAccountCode','debitAccountCode','cuentaDebitoCompra','cuentaGasto','codigoCuentaGasto')??'').trim();
     const nestedInventoryLines=pick(r,'inventoryLines','items','lines','detalles','detalle');
     const rawInventoryLines=Array.isArray(nestedInventoryLines)&&nestedInventoryLines.length?nestedInventoryLines:resolveUniversalPurchaseDetailRows(rows,r);
     let inventoryLines: Array<{productId:string;quantity:number;unitCostBs:number}>|undefined;
     if(rawInventoryLines.length){
      inventoryLines=prepareUniversalPurchaseInventoryLines(rawInventoryLines,companyProducts,{taxableBaseBs,exemptAmountBs,bcvRate:rate});
     }else if(!purchaseDebitAccountCode)throw new Error('Fila '+(i+1)+': compra sin detalle de mercancía requiere una cuenta de débito explícita (purchaseDebitAccountCode). No se asignará una cuenta predeterminada.');
     const retentionRate=num(r,i,true,'retentionRate','tasaRetencion');
     const islrWithheldBs=num(r,i,true,'islrWithheldBs','islrRetenidoBs');
     const islrWithheldUsd=num(r,i,true,'islrWithheldUsd','islrRetenidoUsd');
     if(Math.abs(islrWithheldBs/rate-islrWithheldUsd)>0.02)throw new Error('Fila '+(i+1)+': la retención ISLR en USD no corresponde al importe en Bs dividido por la tasa BCV.');
     if(vatWithheldBs>0&&!pick(r,'ivaRetentionDecision','retentionDecisionSnapshot'))throw new Error('Fila '+(i+1)+': la retención IVA requiere su evaluación fiscal completa y trazable (ivaRetentionDecision). No se recreará a partir de un porcentaje.');
     if(islrWithheldBs>0&&!['islrConceptCode','islrRate','islrBeneficiaryType','islrResidency','islrBasePercentage','islrUnitTaxValueBs','islrFormulaFactor'].every(key=>pick(r,key)!==undefined))throw new Error('Fila '+(i+1)+': la retención ISLR requiere concepto, condición del beneficiario, residencia, porcentaje de base, UT y factor de cálculo. La importación se detuvo para no emitir un comprobante incompleto.');
     const netPayableBs=totalAmountBs-vatWithheldBs-islrWithheldBs;
     const netPayableUsd=totalAmountUsd-vatWithheldUsd-islrWithheldUsd;
     if(vatWithheldBs+islrWithheldBs>totalAmountBs+0.02||vatWithheldUsd+islrWithheldUsd>totalAmountUsd+0.02||netPayableBs < -0.02||netPayableUsd < -0.02)throw new Error('Fila '+(i+1)+': la suma de las retenciones IVA e ISLR supera el total de la factura.');
     const outstandingRaw=pick(r,'outstandingBalanceBs','balanceDueBs','saldoPendienteBs','saldoActualBs','saldoPendiente','saldo');
     const outstandingUsdRaw=pick(r,'outstandingBalanceUsd','balanceDueUsd','saldoPendienteUsd');
     if(paymentTerm==='CREDITO'&&(outstandingRaw!==undefined||outstandingUsdRaw!==undefined)){
      const settledUsd=(settlementPlanByInvoice.get(String(r.migrationrowid))?.settlements||[]).reduce((sum,item)=>sum+Math.round((item.amountUsd+Number.EPSILON)*100)/100,0);
      const expectedOutstandingBs=Math.max(0,netPayableBs-settledUsd*rate);
      const expectedOutstandingUsd=Math.max(0,netPayableUsd-settledUsd);
      if(outstandingRaw!==undefined&&(!Number.isFinite(parseMigrationNumber(outstandingRaw))||parseMigrationNumber(outstandingRaw)<0||Math.abs(parseMigrationNumber(outstandingRaw)-expectedOutstandingBs)>0.02))throw new Error('Fila '+(i+1)+': el saldo pendiente en Bs no coincide con CxP neta después de retenciones y liquidaciones detalladas.');
      if(outstandingUsdRaw!==undefined&&(!Number.isFinite(parseMigrationNumber(outstandingUsdRaw))||parseMigrationNumber(outstandingUsdRaw)<0||Math.abs(parseMigrationNumber(outstandingUsdRaw)-expectedOutstandingUsd)>0.02))throw new Error('Fila '+(i+1)+': el saldo pendiente en USD no coincide con CxP neta después de retenciones y liquidaciones detalladas.');
     }
     const rawSupplierTaxStatus=norm(String(pick(r,'supplierTaxStatus','condicionFiscalProveedor')??resolvedParty.taxStatus??''));const supplierTaxStatus=({'ordinary':'ORDINARY','ordinario':'ORDINARY','contribuyenteordinario':'ORDINARY','formal':'FORMAL','contribuyenteformal':'FORMAL','special':'SPECIAL','especial':'SPECIAL','contribuyenteespecial':'SPECIAL','nonregistered':'NON_REGISTERED','notregistered':'NON_REGISTERED','noregistrado':'NON_REGISTERED','nocontribuyente':'NON_REGISTERED','unknown':'UNKNOWN','desconocido':'UNKNOWN'} as Record<string,string>)[rawSupplierTaxStatus];if(resolvedParty.taxStatus&&!supplierTaxStatus)throw new Error('Fila '+(i+1)+': la condición fiscal del proveedor no se reconoce; debe revisarse antes de importar retenciones.');return {...common,accountCreditDate,paymentAccountCode:paymentAccountCode||undefined,paymentReference:paymentReference||undefined,purchaseDebitAccountCode:purchaseDebitAccountCode||undefined,inventoryLines,supplierRif:partyRif,supplierName:partyName,supplierAddress:String(pick(r,'supplierAddress','direccionProveedor')??resolvedParty.address??''),supplierEmail:String(pick(r,'supplierEmail','correoProveedor')??resolvedParty.email??'')||undefined,supplierTaxStatus:supplierTaxStatus as any,ivaRetentionDecision:pick(r,'ivaRetentionDecision','retentionDecisionSnapshot') as any,islrConceptCode:islrWithheldBs>0?String(pick(r,'islrConceptCode')??''):undefined,islrConceptName:islrWithheldBs>0?String(pick(r,'islrConceptName')??''):undefined,islrRate:islrWithheldBs>0?num(r,i,true,'islrRate'):undefined,islrSubtrahendBs:islrWithheldBs>0?num(r,i,false,'islrSubtrahendBs'):undefined,islrBeneficiaryType:islrWithheldBs>0?pick(r,'islrBeneficiaryType') as any:undefined,islrResidency:islrWithheldBs>0?pick(r,'islrResidency') as any:undefined,islrBasePercentage:islrWithheldBs>0?num(r,i,true,'islrBasePercentage'):undefined,islrUnitTaxValueBs:islrWithheldBs>0?num(r,i,true,'islrUnitTaxValueBs'):undefined,islrFormulaFactor:islrWithheldBs>0?num(r,i,true,'islrFormulaFactor'):undefined,islrWithheldBs,islrWithheldUsd,retentionRate,voucherNumber:String(pick(r,'voucherNumber','comprobanteRetencion')??'')||undefined,vatWithheldBs,vatWithheldUsd};
    });
    let importedSettlementCount=0;
    const createdDocuments: Array<ReturnType<typeof addSale> | ReturnType<typeof addPurchase>>=[];
    const createdDocumentIds: Record<string,string>={};
    await runAtomicInvoiceImportAndWait(()=>{
     if(kind==='sales'){
      const movementRows: Parameters<typeof importInventoryMovements>[0]=[];
      prepared.forEach(s=>{
       const {sourceRowId,...saleData}=s;
       if(!sourceRowId)throw new Error('Una factura de venta no conserva su clave estable de origen.');
       const sale=saleData as Parameters<typeof addSale>[0];
       const created=addSale(sale,targetCompany.id);
       createdDocuments.push(created);
       createdDocumentIds[sourceRowId]=created.id;
       if(sale.inventoryLines?.length){
        const unanchoredLine=sale.inventoryLines.find(line=>{
         const product=companyProducts.find(item=>item.id===line.productId);
         return Boolean(product&&Number(product.currentStock)>0&&!companyMovements.some(movement=>movement.productId===product.id));
        });
        if(unanchoredLine)throw new Error('La factura '+sale.invoiceNumber+' no se puede descargar del inventario porque '+unanchoredLine.productCode+' tiene existencia actual sin historial de apertura/Kardex verificable. Importe primero el saldo inicial y su historial cronológico; no se descontará dos veces una existencia que podría ser un saldo final.');
        movementRows.push(...sale.inventoryLines.map(line=>({
         productId:line.productId,date:sale.invoiceDate,type:'SALIDA' as const,concept:'VENTA',
         documentRef:'FAC-'+sale.invoiceNumber,quantity:line.quantity,
         unitCostBs:companyProducts.find(product=>product.id===line.productId)?.avgCostBs??0,
         bcvRate:sale.bcvRate,counterpartyRif:sale.customerRif,counterpartyName:sale.customerName
        })));
       }
      });
      // Una sola llamada mantiene un Kardex virtual secuencial para todas las
      // facturas del lote: saldo, promedio ponderado/PEPS y validación de stock.
      if(movementRows.length)importInventoryMovements(movementRows,targetCompany.id);
     }else{
      const movementRows: Array<Record<string,unknown>>=[];
      prepared.forEach(p=>{
       const {sourceRowId,...purchaseData}=p;
       if(!sourceRowId)throw new Error('Una factura de compra no conserva su clave estable de origen.');
       const purchase=purchaseData as Parameters<typeof addPurchase>[0];
       const created=addPurchase({...purchase,documentType:purchase.documentType,retentionRate:purchase.retentionRate,vatWithheldBs:purchase.vatWithheldBs,vatWithheldUsd:purchase.vatWithheldUsd},targetCompany.id);
       createdDocuments.push(created);
       createdDocumentIds[sourceRowId]=created.id;
       if(purchase.inventoryLines?.length){
        movementRows.push(...purchase.inventoryLines.map(line=>({
         productId:line.productId,date:purchase.invoiceDate,type:'ENTRADA' as const,concept:'COMPRA',
         documentRef:'FAC-'+purchase.invoiceNumber,quantity:line.quantity,
         unitCostBs:line.unitCostBs,bcvRate:purchase.bcvRate,
         counterpartyRif:purchase.supplierRif,counterpartyName:purchase.supplierName
        })));
       }
      });
      if(movementRows.length)importInventoryMovements(movementRows as Parameters<typeof importInventoryMovements>[0],targetCompany.id);
     }
     const selectedSettlementPlans=selectUniversalInvoiceSettlements(settlementPlans,selectedSettlementSourceRowIds);
     const settlementDrafts=mapUniversalInvoiceSettlementDrafts(selectedSettlementPlans,createdDocumentIds);
     importedSettlementCount=addImportedCreditSettlements(settlementDrafts,createdDocuments,targetCompany.id).length;
    });
    setSettlementPreview([]);setSelectedSettlementSourceRowIds([]);
    setNotice((kind==='sales'?'Ventas':'Compras')+' importadas: '+prepared.length+' facturas. Liquidaciones históricas contabilizadas: '+importedSettlementCount+'. SICOVEN generó los asientos, actualizó CxC/CxP y SQLite confirmó el lote completo en una sola transacción.');
    setSelected(old=>old.filter(id=>id!==kind));setConfirmed(false);
     setBusy(false);return;
   }
   if(selected[0]==='accounts'){
    const sourceRows=rows.filter(r=>['code','accountcode','codigo','codigocuenta'].some(k=>pick(r,k)!==undefined)&&['name','accountname','nombre','nombrecuenta'].some(k=>pick(r,k)!==undefined));
    if(!sourceRows.length)throw new Error('No hay filas de plan de cuentas con código y nombre.');
    const typeMap:Record<string,string>={activo:'ACTIVO',pasivo:'PASIVO',patrimonio:'PATRIMONIO',ingresos:'INGRESOS',costos:'COSTOS',costo:'COSTOS',gastos:'GASTOS',asset:'ACTIVO',liability:'PASIVO',equity:'PATRIMONIO',income:'INGRESOS',cost:'COSTOS',expense:'GASTOS'};
    const seen=new Set<string>();const existing=new Set(accounts.map(a=>a.code.trim().toLowerCase()));
    const prepared=sourceRows.map((r,i)=>{
     const code=String(pick(r,'code','accountCode','codigo','codigoCuenta')??'').trim();
     const name=String(pick(r,'name','accountName','nombre','nombreCuenta','descripcion')??'').trim();
     const rawType=norm(String(pick(r,'type','accountType','tipo','tipoCuenta','clasificacion')??''));
     const type=typeMap[rawType];
     if(!code||!name)throw new Error('Fila '+(i+1)+': código y nombre son obligatorios.');
     if(!type)throw new Error('Fila '+(i+1)+': tipo de cuenta no reconocido. Use Activo, Pasivo, Patrimonio, Ingresos, Costos o Gastos.');
     const key=code.toLowerCase();if(seen.has(key)||existing.has(key))throw new Error('Código de cuenta duplicado o ya existente: '+code+'. No se sobrescribieron cuentas.');seen.add(key);
     const rawLevel=pick(r,'level','nivel');const level=rawLevel===undefined?code.split('.').length:parseMigrationNumber(rawLevel);
     if(!Number.isInteger(level)||level<1||level>5)throw new Error('Fila '+(i+1)+': nivel inválido para '+code+'.');
     const movementRaw=pick(r,'isMovement','cuentaMovimiento','movimiento','aceptaMovimientos');
     if(movementRaw===undefined)throw new Error('Fila '+(i+1)+': indique explícitamente si la cuenta admite movimientos (isMovement/aceptaMovimientos). No se inferirá por el nivel.');
     const movement=norm(String(movementRaw));
     if(!['true','false','si','no','yes','0','1','movimiento','detail','titulo','encabezado'].includes(movement))throw new Error('Fila '+(i+1)+': indicador de cuenta de movimiento inválido.');
     const isMovement=['true','si','yes','1','movimiento','detail'].includes(movement);
     const parentCode=String(pick(r,'parentCode','codigoPadre','cuentaPadre')??'').trim();
     return {code,name,type:type as 'ACTIVO'|'PASIVO'|'PATRIMONIO'|'INGRESOS'|'COSTOS'|'GASTOS',level,isMovement,parentCode:parentCode||undefined};
    });
    const allCodes=new Set([...existing,...seen]);
    for(const a of prepared){if(a.parentCode&&!allCodes.has(a.parentCode.toLowerCase()))throw new Error('La cuenta '+a.code+' referencia una cuenta padre inexistente: '+a.parentCode+'.');}
    prepared.forEach(a=>addAccount(a));
    setNotice('Plan de cuentas importado: '+prepared.length+' cuentas nuevas. Se validaron tipos, niveles, códigos duplicados y referencias de cuenta padre; confirma por separado el siguiente módulo.');
    setSelected(old=>old.filter(id=>id!=='accounts'));setConfirmed(false);
     setBusy(false);return;
   }
   if(selected[0]==='movements'){
    const selectedKeys=selectedModuleRowKeys.movements??[];
    if(!selectedKeys.length)throw new Error('Selecciona individualmente los movimientos históricos que deseas importar.');
    const sourceRows=rows.filter(row=>selectedKeys.includes(String(row.migrationrowid??'')));
    if(!sourceRows.length)throw new Error('No se encontraron movimientos seleccionados.');
    const prepared=sourceRows.map((row,index)=>{
     const code=String(pick(row,'productCode','codigoProducto','sku','code','codigo')??'').trim();
     const product=companyProducts.find(item=>item.code.trim().toLowerCase()===code.toLowerCase());
     if(!product)throw new Error('Fila '+(index+1)+': el artículo '+(code||'(sin código)')+' no existe en la empresa destino. Importa primero el maestro de inventario; no se crearán productos automáticamente.');
     const date=String(pick(row,'date','fecha','movementDate','fechaMovimiento')??'').slice(0,10);
     if(!isValidIsoDate(date))throw new Error('Fila '+(index+1)+': fecha de movimiento inválida.');
     const type=mapUniversalInventoryMovementType(pick(row,'type','movementType','tipoMovimiento','tipo'));
     if(!type)throw new Error('Fila '+(index+1)+': tipo de movimiento no reconocido. Usa ENTRADA, SALIDA o AJUSTE.');
     const concept=mapUniversalInventoryMovementConcept(pick(row,'concept','concepto','movementConcept'));
     if(!concept)throw new Error('Fila '+(index+1)+': concepto de movimiento no reconocido. No se inferirá por el tipo de movimiento.');
     if(!isUniversalMovementTypeConceptValid(type,concept))throw new Error('Fila '+(index+1)+': el tipo de movimiento y su concepto no son compatibles. Revise la clasificación antes de importar.');
     if(concept==='DEVOLUCION_COMPRA'||concept==='DEVOLUCION_CLIENTE')throw new Error('Fila '+(index+1)+': las devoluciones requieren el flujo de nota de crédito enlazado a factura y Kardex; no se importan como movimientos aislados.');
     if(type==='ENTRADA'&&concept==='INVENTARIO_INICIAL')throw new Error('Fila '+(index+1)+': el saldo inicial se importa con el módulo Inventario, que genera el Kardex y su asiento de apertura. No lo duplique como movimiento histórico.');
     if(type==='ENTRADA'&&concept==='COMPRA')throw new Error('Fila '+(index+1)+': las entradas por compra se generan desde la factura importada en Compras, que debe conservar detalle de mercancía, asiento y Kardex. No se importan entradas de compra aisladas.');
     let documentRef=String(pick(row,'documentRef','referencia','documento','invoiceNumber','numeroDocumento')??'').trim();
     if(!documentRef)throw new Error('Fila '+(index+1)+': referencia documental obligatoria.');
     if(type==='SALIDA'&&concept==='VENTA'){
      const linkedSale=companySales.find(sale=>normalizeUniversalDocumentReference(sale.invoiceNumber)===normalizeUniversalDocumentReference(documentRef));
      if(!linkedSale)throw new Error('Fila '+(index+1)+': la salida por venta debe enlazarse a una factura de venta ya importada en la empresa destino.');
      documentRef='FAC-'+linkedSale.invoiceNumber;
     }
     const bcvRaw=pick(row,'bcvRate','tasaBcv');
     const bcvRate=bcvRaw===undefined?NaN:parseMigrationNumber(bcvRaw);
     if(!Number.isFinite(bcvRate)||bcvRate<=0)throw new Error('Fila '+(index+1)+': tasa BCV positiva obligatoria.');
     const costRaw=pick(row,'unitCostBs','costoUnitarioBs','unitCost','costoUnitario','costBs');
     const unitCostBs=costRaw===undefined?NaN:parseMigrationNumber(costRaw);
     if(!Number.isFinite(unitCostBs)||unitCostBs<=0)throw new Error('Fila '+(index+1)+': costo unitario Bs positivo obligatorio para recalcular el Kardex.');
     const quantityRaw=pick(row,'quantity','cantidad','qty');
     const quantity=quantityRaw===undefined?0:parseMigrationNumber(quantityRaw);
     const balanceRaw=pick(row,'balanceQty','existenciaFinal','stockFinal','saldoCantidad');
     const balanceQty=balanceRaw===undefined?NaN:parseMigrationNumber(balanceRaw);
     if(type==='AJUSTE'&&(!Number.isFinite(balanceQty)||balanceQty<0))throw new Error('Fila '+(index+1)+': los ajustes requieren existencia final explícita.');
     if(type!=='AJUSTE'&&(!Number.isFinite(quantity)||quantity<=0))throw new Error('Fila '+(index+1)+': cantidad positiva obligatoria.');
     const additionalLandedCostsBs=pick(row,'additionalLandedCostsBs','fleteBs','gastosImportacionBs')===undefined?0:parseMigrationNumber(pick(row,'additionalLandedCostsBs','fleteBs','gastosImportacionBs'));
     if(!Number.isFinite(additionalLandedCostsBs)||additionalLandedCostsBs<0)throw new Error('Fila '+(index+1)+': fletes/gastos no pueden ser negativos.');
     return {productId:product.id,date,type,concept,documentRef,quantity,unitCostBs,bcvRate,balanceQty:Number.isFinite(balanceQty)?balanceQty:product.currentStock,additionalLandedCostsBs,counterpartyRif:String(pick(row,'counterpartyRif','rifContraparte')??'')||undefined,counterpartyName:String(pick(row,'counterpartyName','nombreContraparte')??'')||undefined};
    }).sort((a,b)=>a.date.localeCompare(b.date));
    const count=importInventoryMovements(prepared,targetCompany.id);
    setNotice('Movimientos históricos importados en '+targetCompany.name+': '+count+' registros. SICOVEN recalculó existencias y costos según el método de cada artículo y generó los asientos de costo/ajuste aplicables. Esta carga no crea facturas, CxC/CxP, pagos ni retenciones; importa esos documentos por sus módulos correspondientes. Revisa el Kardex antes de continuar.');
    setSelected(old=>old.filter(id=>id!=='movements'));setSelectedModuleRowKeys(old=>({...old,movements:[]}));setConfirmed(false);setBusy(false);return;
   }
   if(selected[0]==='journal'){
    const sourceRows=rows.filter(r=>['accountCode','codigoCuenta','cuenta'].some(k=>pick(r,k)!==undefined)&&(selectedModuleRowKeys.journal??[]).includes(String(r.migrationrowid??'')));
    if(!(selectedModuleRowKeys.journal??[]).length)throw new Error('Selecciona individualmente las líneas de asientos que deseas importar. No se importó ningún asiento.');
    if(!sourceRows.length)throw new Error('No hay líneas de asientos con código de cuenta.');
    sourceRows.forEach((row,index)=>{
     const date=String(pick(row,'date','fecha')??'').slice(0,10);
     const reference=String(pick(row,'entryNumber','numeroAsiento','asiento','referenceDoc','referencia','documento')??'').trim();
     if(!isValidIsoDate(date)||!reference)throw new Error('Fila '+(index+1)+': cada línea de asiento seleccionada requiere fecha válida y referencia documental. No se descartarán líneas incompletas.');
    });
    const accountMap=new Map(accounts.map(a=>[a.code.toLowerCase(),a]));
    const groups=groupUniversalJournalRows(sourceRows);
    const seenJournalIdentities=new Set<string>();
    const prepared=groups.map(({date,reference:ref,rows:items})=>{
     if(!isValidIsoDate(date))throw new Error('Asiento '+ref+': fecha obligatoria en formato AAAA-MM-DD.');
     const normalizedReference=normalizeUniversalDocumentReference(ref);
     const identity=date+'|'+normalizedReference;
     if(seenJournalIdentities.has(identity))throw new Error('Hay asientos con la misma fecha y referencia en más de un archivo. Separe o concilie las fuentes; no se mezclarán líneas de archivos distintos.');
     seenJournalIdentities.add(identity);
     const existingEntry=companyJournalEntries.some(entry=>entry.date===date&&normalizeUniversalDocumentReference(entry.referenceDoc)===normalizedReference);
     if(existingEntry)throw new Error('Ya existe un asiento con fecha '+date+' y referencia '+ref+'. No se importaron los asientos de este archivo para evitar duplicar contabilidad.');
     const linkedSale=companySales.find(sale=>normalizeUniversalDocumentReference(sale.invoiceNumber)===normalizedReference);
     const linkedPurchase=companyPurchases.find(purchase=>normalizeUniversalDocumentReference(purchase.invoiceNumber)===normalizedReference);
     if(linkedSale||linkedPurchase)throw new Error('El asiento '+ref+' corresponde a una factura ya importada de '+(linkedSale?'Ventas':'Compras')+'. SICOVEN ya generó su contabilización automática; no se importarán líneas duplicadas desde el Libro Diario.');
     const lines=items.map(r=>{
      const code=String(pick(r,'accountCode','codigoCuenta','cuenta')??'').trim();
      const account=accountMap.get(code.toLowerCase());
      if(!account)throw new Error('Asiento '+ref+': cuenta inexistente '+code+'.');
      if(!account.isMovement)throw new Error('Asiento '+ref+': la cuenta '+code+' no admite movimientos.');
      const amount=(...keys:string[])=>{const raw=pick(r,...keys);const n=raw===undefined||raw===''?0:parseMigrationNumber(raw);if(!Number.isFinite(n)||n<0)throw new Error('Asiento '+ref+': importe inválido en '+keys[0]+'.');return n;};
      const debitBs=amount('debitBs','debe','debito');const creditBs=amount('creditBs','haber','credito');
      const debitUsd=amount('debitUsd','debeUsd','debitoUsd');const creditUsd=amount('creditUsd','haberUsd','creditoUsd');
      if((debitBs>0&&creditBs>0)||(debitUsd>0&&creditUsd>0)||(!debitBs&&!creditBs&&!debitUsd&&!creditUsd))throw new Error('Asiento '+ref+': cada línea debe registrar debe o haber, nunca ambos en la misma moneda.');
      return {accountCode:code,accountName:account.name,debitBs,creditBs,debitUsd,creditUsd,description:String(pick(r,'lineDescription','descripcionLinea','description','descripcion')??'')};
     });
     const sum=(field:'debitBs'|'creditBs'|'debitUsd'|'creditUsd')=>lines.reduce((s,l)=>s+l[field],0);
     if(lines.length<2||Math.abs(sum('debitBs')-sum('creditBs'))>=0.01||Math.abs(sum('debitUsd')-sum('creditUsd'))>=0.01||sum('debitBs')<=0||sum('debitUsd')<=0)throw new Error('Asiento '+ref+': debe tener al menos dos líneas y cuadrar con importes positivos en Bs y USD.');
     const rateRaw=pick(items[0],'bcvRate','tasaBcv');const bcvRate=rateRaw===undefined?0:parseMigrationNumber(rateRaw);
     if(!Number.isFinite(bcvRate)||bcvRate<=0)throw new Error('Asiento '+ref+': tasa BCV positiva obligatoria.');
     const parsedEntryNumber=/^\d+$/.test(ref)&&Number.isSafeInteger(Number(ref))&&Number(ref)>0?Number(ref):0;
     return {entryNumber:parsedEntryNumber,date,description:String(pick(items[0],'description','descripcion','concepto')??('Importación '+ref)),type:'MANUAL' as const,bcvRate,items:lines,referenceDoc:ref};
    });
    prepared.forEach(entry=>addJournalEntry(entry,accounts,targetCompany.id));
    setNotice('Asientos importados: '+prepared.length+'. Se validaron cuentas de movimiento, fechas, tasa BCV, líneas y cuadre en Bs y USD.');
    setSelected(old=>old.filter(id=>id!=='journal'));setConfirmed(false);
     setBusy(false);return;
   }
   const groupedBySource = new Map<string, Row[]>();
   rows.forEach(row => {
    const source = String(row.migrationsource ?? 'archivo sin nombre');
    const group = groupedBySource.get(source) ?? [];
    group.push(row);
    groupedBySource.set(source, group);
   });
   const inventoryRows = [...groupedBySource.entries()].filter(([, sourceRows]) => {
    const sourceKeys = new Set(sourceRows.flatMap(row => Object.keys(row).filter(key => key !== 'migrationsource')));
    return [
     ['code','codigo','sku','productcode'],
     ['name','nombre','productname','producto']
    ].every(group => group.some(key => sourceKeys.has(norm(key))));
   }).flatMap(([, sourceRows]) => sourceRows).filter(row=>selectedInventoryRowKeys.includes(String(row.migrationrowid??'')));
   if (!selectedInventoryRowKeys.length) throw new Error('Selecciona individualmente los artículos que deseas importar. No se importó ningún registro.');
   if (!inventoryRows.length) throw new Error('No se identificaron archivos u hojas con encabezados de inventario (código y nombre). No se importó ningún registro.');
   const normalized=inventoryRows.map((r,i)=>({r,i}));
   const seen=new Set<string>();const existing=new Set(companyProducts.map(p=>p.code.trim().toLowerCase()));
   const prepared=normalized.map(({r,i})=>{
    const code=String(pick(r,'code','codigo','sku','productCode')??'').trim();
    const name=String(pick(r,'name','nombre','productName','producto')??'').trim();
    if(!code||!name)throw new Error('Registro '+(i+1)+': faltan código/SKU o nombre. No se importó ningún artículo.');
    const k=code.toLowerCase();
    if(seen.has(k))throw new Error('Código duplicado dentro de los archivos: '+code+'. No se importó ningún artículo.');
    if(existing.has(k))throw new Error('El código '+code+' ya existe en SICOVEN. No se sobrescriben registros automáticamente.');
    seen.add(k);
    const number=(...keys:string[])=>{
     const raw=pick(r,...keys);
     if(raw===undefined||raw==='')throw new Error('Registro '+(i+1)+': falta el campo obligatorio '+keys[0]+'. No se asumirá cero ni se importará parcialmente.');
     const n=parseMigrationNumber(raw);
     if(!Number.isFinite(n)||n<0)throw new Error('Registro '+(i+1)+': valor numérico inválido en '+keys[0]+'.');
     return n;
    };
    const category=String(pick(r,'category','categoria')??'').trim();
    const unit=String(pick(r,'unit','unidad')??'').trim();
    if(!category||!unit)throw new Error('Registro '+(i+1)+': categoría y unidad deben venir declaradas en el archivo.');
    const costingMethod=mapUniversalInventoryCostingMethod(pick(r,'costingMethod','metodoCosteo','metodoValuacion','metodoValoracion'));
    const vatTreatment=mapUniversalInventoryVatTreatment(pick(r,'vatTreatment','tratamientoIva','alicuotaIva','iva'));
    const itemType=mapUniversalInventoryItemType(pick(r,'itemType','tipoArticulo','tipoItem','clasificacion'));
    if(!costingMethod)throw new Error('Registro '+(i+1)+': método de costeo ausente o no reconocido. Declare PROMEDIO_PONDERADO o PEPS; no se asignará uno automáticamente.');
    if(!vatTreatment)throw new Error('Registro '+(i+1)+': tratamiento IVA ausente o no reconocido. Declare 16%, 8%, exento o exonerado; no se supondrá IVA general.');
    if(!itemType)throw new Error('Registro '+(i+1)+': tipo de artículo ausente o no reconocido. Declare mercancía, materia prima, producto en proceso, producto terminado o subproducto.');
    const inventoryAccountCode=String(pick(r,'inventoryAccountCode','cuentaInventario','codigoCuentaInventario')??'').trim();
    const costOfSalesAccountCode=String(pick(r,'costOfSalesAccountCode','cuentaCostoVentas','cuentaConsumo','codigoCuentaCosto')??'').trim();
    const adjustmentAccountCode=String(pick(r,'adjustmentAccountCode','cuentaAjuste','cuentaMerma','codigoCuentaAjuste')??'').trim();
    const openingBalanceAccountCode=String(pick(r,'openingBalanceAccountCode','cuentaContrapartidaApertura','cuentaApertura','codigoCuentaApertura')??'').trim();
    if(!inventoryAccountCode||!costOfSalesAccountCode||!adjustmentAccountCode||!openingBalanceAccountCode)throw new Error('Registro '+(i+1)+': indique los cuatro códigos contables destino (inventario, costo/consumo, ajustes y contrapartida de apertura). No se asignarán cuentas por defecto ni por similitud de nombres.');
    const stock=number('currentStock','existencia','stock','quantity','cantidad');
    const cost=number('avgCostBs','costoPromedioBs','costBs','costoBs','costObs','costo','costoUnitario','unitCost');
    const priceBs=number('salesPriceBs','precioVentaBs','priceBs','salesPrice','precioVenta');
    const priceUsd=number('salesPriceUsd','precioVentaUsd','priceUsd');
    const openingBcvRate=number('openingBcvRate','bcvRate','tasaBcvApertura');
    const openingDate=String(pick(r,'openingDate','fechaApertura')??'').slice(0,10);
    if(!isValidIsoDate(openingDate))throw new Error('Registro '+(i+1)+': declare una fecha de apertura válida AAAA-MM-DD; no se usará la fecha actual.');
    if((stock>0||cost>0)&&openingBcvRate<=0)throw new Error('Registro '+(i+1)+': la existencia o costo inicial requiere una tasa BCV histórica positiva declarada en el archivo.');
    const avgCostUsdRaw=pick(r,'avgCostUsd','costoPromedioUsd');
    if(avgCostUsdRaw!==undefined){const value=parseMigrationNumber(avgCostUsdRaw);if(!Number.isFinite(value)||value<0||openingBcvRate<=0||Math.abs(value-cost/openingBcvRate)>0.0001)throw new Error('Registro '+(i+1)+': el costo promedio USD es inválido o no concilia con costo Bs y tasa BCV de apertura.');}
    const lastCostBs=number('lastCostBs','ultimoCostoBs');
    const lastCostUsd=number('lastCostUsd','ultimoCostoUsd');
    const minStock=number('minStock','stockMinimo');
    if(stock>0&&(lastCostBs<=0||lastCostUsd<=0))throw new Error('Registro '+(i+1)+': una existencia positiva requiere último costo Bs y USD positivos.');
    const optionalAmount=(...keys:string[])=>{const raw=pick(r,...keys);if(raw===undefined)return undefined;const value=parseMigrationNumber(raw);if(!Number.isFinite(value)||value<0)throw new Error('Registro '+(i+1)+': importe inválido en '+keys[0]+'.');return value;};
    const bomComponents=pick(r,'bomComponents','componentes','receta','listaMateriales');
    if(Array.isArray(bomComponents)&&bomComponents.length)throw new Error('Registro '+(i+1)+': la receta/BOM del artículo requiere un adaptador de producción con referencias de componentes de la empresa destino. No se descartará ni se importará incompleta.');
    if(bomComponents!==undefined&&String(bomComponents).trim()!=='')throw new Error('Registro '+(i+1)+': la receta/BOM debe importarse con un adaptador de producción; este módulo no interpreta texto libre de componentes.');
    const vnrProvisionBs=optionalAmount('vnrProvisionBs','provisionVnrBs','provisionValorNetoRealizableBs');
    const vnrEstimatedSellingPriceBs=optionalAmount('vnrEstimatedSellingPriceBs','precioVentaEstimadoVnrBs');
    const vnrCompletionCostBs=optionalAmount('vnrCompletionCostBs','costoTerminacionVnrBs');
    const vnrSellingCostBs=optionalAmount('vnrSellingCostBs','costoVentaVnrBs');
    const vnrLastTestDate=String(pick(r,'vnrLastTestDate','fechaPruebaVnr')??'').slice(0,10)||undefined;
    if(vnrLastTestDate&&!isValidIsoDate(vnrLastTestDate))throw new Error('Registro '+(i+1)+': fecha de prueba VNR inválida.');
    return {code,name,category,unit,minStock,currentStock:stock,avgCostBs:cost,avgCostUsd:openingBcvRate>0?cost/openingBcvRate:0,lastCostBs,lastCostUsd,salesPriceBs:priceBs,salesPriceUsd:priceUsd,costingMethod,vatTreatment,itemType,inventoryAccountCode,costOfSalesAccountCode,adjustmentAccountCode,openingBalanceAccountCode,openingDate,openingBcvRate,vnrProvisionBs,vnrEstimatedSellingPriceBs,vnrCompletionCostBs,vnrSellingCostBs,vnrLastTestDate};
   });
   const count=await importInventoryProducts(prepared,targetCompany.id);
   setNotice('Inventario importado en '+targetCompany.name+' (RIF '+targetCompany.rif+'): '+count+' artículos incorporados. SICOVEN no sobrescribió códigos existentes. Revisa el Kardex y la valoración inicial antes de continuar.');
   setSelected(old=>old.filter(id=>id!=='inventory'));setSelectedInventoryRowKeys([]);setConfirmed(false);
    setBusy(false);
  }catch(e){setError(e instanceof Error?e.message:'La validación falló. No se completó la migración.');setBusy(false);}
 };
 return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="migration-title">
  <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
   <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-900 px-5 py-4 text-white"><div><h2 id="migration-title" className="text-lg font-bold">Importador Inteligente Universal de SICOVEN</h2><p className="mt-1 text-sm text-slate-300">Múltiples formatos y sistemas de origen · selección de módulos · validación antes de escribir</p></div><button onClick={onClose} aria-label="Cerrar" className="rounded-lg p-2 hover:bg-slate-700"><X size={20}/></button></header>
   <div className="space-y-5 overflow-y-auto p-5">
    <section className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-4 space-y-2"><label htmlFor="migration-target-company" className="flex items-center gap-2 text-sm font-semibold text-slate-900">Empresa destino de esta migración <span className="text-rose-600">*</span></label><select id="migration-target-company" value={targetCompanyId} onChange={event=>{setTargetCompanyId(event.target.value);setConfirmed(false);setError('');setNotice('');}} disabled={busy} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">Seleccionar empresa…</option>{companies.map(company=><option key={company.id} value={company.id}>{company.name} · {company.rif}{company.id===currentCompany.id?' · actualmente seleccionada':''}</option>)}</select>{targetCompany?<p className="text-xs text-slate-600">Destino fijado: <strong>{targetCompany.name}</strong> · RIF {targetCompany.rif}. La empresa activa no cambiará.</p>:<p className="text-xs text-rose-700">Debe seleccionar una empresa antes de importar.</p>}<p className="text-xs text-slate-600">La importación de inventario, ventas, compras y asientos utiliza este destino explícito. La empresa activa no cambia. El plan de cuentas compartido, los maestros independientes de clientes/proveedores y las cargas aisladas de CxC/CxP no se importan porque el modelo actual no los separa de forma segura.</p></section>
    <label className="flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-emerald-500"><FileUp size={30} className="mb-2 text-emerald-700"/><strong>Selecciona uno o varios archivos de cualquier sistema</strong><span className="mt-1 text-sm text-slate-500">JSON, CSV, TSV, TXT, Excel XLSX o XLSM · análisis local del contenido y sus colecciones</span><input className="mt-3 block max-w-full text-sm" type="file" multiple accept=".json,.csv,.tsv,.txt,.xlsx,.xlsm" onChange={e=>void readFiles(Array.from(e.target.files||[]))}/></label>
    {files.length>0&&<p className="text-sm text-slate-600">{files.length} archivo(s) · {posvenBackup?'respaldo POSVEN detectado':backupPayload?'adaptador POSVEN detectado':rows.length+' registros detectados'}</p>}
    {backupPayload&&<section className={'rounded-xl border p-4 text-sm '+(posvenBackup?'border-sky-300 bg-sky-50 text-sky-950':'border-amber-300 bg-amber-50 text-amber-950')}><h3 className="font-bold">{posvenBackup?'Respaldo POSVEN detectado · versión '+String((()=>{try{return JSON.parse(backupPayload).version??'desconocida'}catch{return 'desconocida'}})()):'Respaldo completo de SICOVEN'}</h3><p className="mt-1">{posvenBackup?'Se reconoció la estructura versionada y se analizaron las colecciones dentro de data. Este archivo no es un respaldo nativo de SICOVEN: no se restaurará ni contabilizará directamente. El siguiente paso es mapear cada módulo al modelo contable de la empresa y validar saldos, relaciones y duplicados. No se ha escrito ningún dato.':'Se detectó un respaldo estructurado. Al confirmarlo, se reemplazarán los datos actuales por los del archivo, tras validar referencias y estructura.'}</p>{posvenBackup&&<div className="mt-3 rounded-lg border border-sky-200 bg-white/70 p-3"><strong>{Object.values(backupCounts??{}).reduce((sum,count)=>sum+count,0).toLocaleString('es-VE')} registros en arreglos detectados</strong><div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4"><div className="rounded-md bg-sky-50 p-2"><span className="block text-xs">Colecciones</span><strong>{posvenQuality.collections}</strong></div><div className="rounded-md bg-sky-50 p-2"><span className="block text-xs">Filas objeto</span><strong>{posvenQuality.objectRows.toLocaleString('es-VE')}</strong></div><div className="rounded-md bg-sky-50 p-2"><span className="block text-xs">Elementos no objeto</span><strong>{posvenQuality.invalidRows.toLocaleString('es-VE')}</strong></div><div className="rounded-md bg-sky-50 p-2"><span className="block text-xs">Colecciones vacías</span><strong>{posvenQuality.emptyCollections}</strong></div></div><p className="mt-2 text-xs">Diagnóstico estructural solamente; estas cifras no implican que los registros estén validados contablemente ni que se hayan importado.</p></div>}<div className="mt-3 grid gap-3 md:grid-cols-2">{POSVEN_COLLECTION_LABELS.map(group=>{const entries=Object.entries(backupCounts??{}).filter(([name])=>group.match.test(name));if(!entries.length)return null;return <div key={group.label} className="rounded-lg border border-sky-200 bg-white/70 p-3"><h4 className="font-semibold">{group.label}</h4><ul className="mt-1 space-y-1">{entries.map(([name,count])=><li key={name} className="flex justify-between gap-3"><span className="break-all">{name}</span><strong className="shrink-0">{count.toLocaleString('es-VE')}</strong></li>)}</ul></div>})}</div><details className="mt-3"><summary className="cursor-pointer font-semibold">Ver todas las colecciones detectadas</summary><ul className="mt-2 grid grid-cols-2 gap-1 md:grid-cols-3">{Object.entries(backupCounts??{}).map(([name,count])=><li key={name}>{name}: <strong>{count.toLocaleString('es-VE')}</strong></li>)}</ul></details></section>}
    {posvenBackup&&posvenPreview.length>0&&<section className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-4"><h3 className="font-bold text-slate-900">Colecciones detectadas: selección de importación</h3><p className="mt-1 text-sm text-slate-600">Puedes revisar todas las colecciones y elegir qué cargar. Inventario usa el adaptador POSVEN especializado; ventas, compras, libro diario y Kardex pueden pasar por los adaptadores universales cuando los campos observados son suficientes. Las demás colecciones permanecen en conciliación o excluidas con su motivo.</p><div className="mt-3 space-y-2">{posvenPreview.map(item=><div key={item.name} className="rounded-lg border border-slate-200 bg-white p-3"><label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={selectedPosvenCollections.includes(item.name)} disabled={!item.canImport||busy} onChange={event=>{
     const chosen=event.target.checked?[item.name]:[];
     setSelectedPosvenCollections(chosen);setConfirmed(false);
     const key=norm(item.name);
     const moduleId:ModuleId|null=/^(ventas|sales|facturas|invoices)$/.test(key)?'sales':/^(compras|purchases)$/.test(key)?'purchases':/^(librodiario|journalentries|journal|asientos)$/.test(key)?'journal':/^(movimientos|movements|stockmovements|inventorymovements)$/.test(key)?'movements':null;
     setSelected(moduleId?[moduleId]:[]);
     setSelectedModuleRowKeys({sales:[],purchases:[],journal:[],movements:[]});
    }} /><span className="min-w-0"><span className="font-semibold">{item.name}</span><span className="ml-2 text-sm text-slate-500">{item.count.toLocaleString('es-VE')} filas</span><span className="mt-1 block text-sm">{item.target} · <strong>{item.mode}</strong></span>{!item.canImport&&<span className="block text-xs text-amber-800">No importable todavía: requiere un adaptador y conciliación específicos.</span>}</span></label><details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-indigo-800">Revisar esquema y motivo</summary><div className="mt-3 grid gap-2 text-sm md:grid-cols-2"><p>Objetos válidos estructuralmente: <strong>{item.objects.toLocaleString('es-VE')}</strong></p><p>Elementos no objeto (tipo de dato): <strong>{item.invalid.toLocaleString('es-VE')}</strong></p><p>Clave candidata: <strong>{item.identityField||'No detectada'}</strong></p><p>Clave candidata vacía: <strong>{item.identityField?item.missingIdentity.toLocaleString('es-VE'):'No evaluable'}</strong></p><p>Posibles duplicados de esa clave: <strong>{item.identityField?item.duplicateIdentity.toLocaleString('es-VE'):'No evaluable'}</strong></p><p className="md:col-span-2 text-xs text-amber-800">La clave se infiere por nombre de colección y campos; duplicados/vacíos son señales de revisión, no prueba definitiva de registros duplicados.</p>{item.referenceFields.length>0&&<div className="md:col-span-2"><span className="font-semibold">Campos que podrían contener referencias:</span><p className="break-words text-xs text-slate-600">{item.referenceFields.join(', ')}</p><p className="text-xs text-amber-800">Se identifican por nombre; aún no se afirma que las referencias existan en las otras colecciones.</p></div>}{item.relationshipHints.length>0&&<div className="md:col-span-2 rounded-md border border-indigo-100 bg-indigo-50/60 p-2"><span className="font-semibold">Posibles vínculos entre colecciones (heurística por nombre):</span><ul className="mt-1 space-y-1">{item.relationshipHints.map((hint,index)=><li key={hint.field+'-'+hint.targetCollection+'-'+index} className="break-words text-xs text-slate-700"><strong>{hint.field}</strong> → {hint.targetCollection}</li>)}</ul><p className="mt-1 text-xs text-amber-800">No se compararon identificadores ni se comprobó que los registros relacionados existan. Estos vínculos no autorizan importar ni contabilizar datos.</p></div>}{item.numericSummaries.length>0&&<div className="md:col-span-2"><span className="font-semibold">Sumas exploratorias de campos numéricos:</span><div className="mt-1 grid gap-1 sm:grid-cols-2">{item.numericSummaries.map(summary=><p key={summary.field} className="break-all text-xs text-slate-600">{summary.field}: {summary.count.toLocaleString('es-VE')} valores numéricos · suma {summary.sum.toLocaleString('es-VE',{maximumFractionDigits:4})}</p>)}</div><p className="text-xs text-amber-800">No se infiere moneda ni significado contable; los valores no numéricos se excluyen. Usar únicamente como pista de conciliación.</p></div>}<p className="md:col-span-2">{item.reason}</p><div className="md:col-span-2"><span className="font-semibold">Campos observados en las primeras 5 filas:</span><p className="mt-1 break-words text-xs text-slate-600">{item.fields.length?item.fields.join(', '):'No hay campos de objeto para inspeccionar.'}</p></div></div></details></div>)}</div>{selectedPosvenCollections.includes('productos')&&<div className="mt-4 grid gap-3 rounded-lg border border-indigo-200 bg-white p-3 md:grid-cols-3"><label className="text-sm font-medium">Fecha de corte / apertura<input type="date" value={posvenOpeningDate} onChange={event=>setPosvenOpeningDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm font-medium">Tasa BCV de apertura (Bs/USD)<input type="number" min="0.000001" step="0.000001" value={posvenBcvRate} onChange={event=>setPosvenBcvRate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label><label className="text-sm font-medium">Tratamiento de IVA para los artículos<select value={posvenVatTreatment} onChange={event=>setPosvenVatTreatment(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"><option value="">Seleccionar tratamiento…</option><option value="GENERAL_16">General 16%</option><option value="REDUCIDA_8">Reducida 8%</option><option value="EXENTO">Exento</option><option value="EXONERADO">Exonerado</option></select></label><p className="md:col-span-3 text-xs text-amber-800">El respaldo registra aplicaIVA=false, pero ese indicador no permite distinguir exento, exonerado o no sujeto. Debes elegir el tratamiento aplicable. El costo Bs se calcula como costoUSD × tasa BCV indicada; los precios USD y Bs se conservan tal como aparecen en POSVEN.</p></div>}<p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">En este archivo: {posvenQuality.eligibleProducts} productos activos no-kit aptos para revisión; {posvenQuality.inactiveProducts} inactivos; {posvenQuality.kitProducts} kits, con {posvenQuality.inactiveKits} en ambas categorías. Los registros excluidos se conservan en el archivo original y no se importan.</p>{selectedPosvenCollections.includes('productos')&&<div className="mt-4 rounded-lg border border-indigo-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="font-semibold text-slate-900">Artículos del inventario</h4><p className="text-xs text-slate-600">Marca individualmente qué productos deseas cargar. Puedes filtrar por código, nombre o categoría.</p></div><strong className="text-sm text-indigo-800">{selectedPosvenProductCodes.length} / {posvenProducts.length} seleccionados</strong></div><input value={posvenProductFilter} onChange={event=>setPosvenProductFilter(event.target.value)} placeholder="Buscar por código, nombre o categoría…" className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedPosvenProductCodes(old=>Array.from(new Set([...old,...filteredPosvenProducts.map(row=>String(row.codigo??'').trim()).filter(Boolean)])))} className="rounded-md border px-3 py-1 text-xs">Seleccionar visibles</button><button type="button" onClick={()=>setSelectedPosvenProductCodes(old=>old.filter(code=>!filteredPosvenProducts.some(row=>String(row.codigo??'').trim()===code)))} className="rounded-md border px-3 py-1 text-xs">Desmarcar visibles</button><button type="button" onClick={()=>setSelectedPosvenProductCodes(posvenProducts.map(row=>String(row.codigo??'').trim()).filter(Boolean))} className="rounded-md border px-3 py-1 text-xs">Seleccionar todos</button><button type="button" onClick={()=>setSelectedPosvenProductCodes([])} className="rounded-md border px-3 py-1 text-xs">Limpiar selección</button></div><div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Importar</th><th className="p-2">Código</th><th className="p-2">Producto</th><th className="p-2">Categoría</th><th className="p-2 text-right">Existencia</th><th className="p-2 text-right">Costo USD</th><th className="p-2 text-right">Precio USD</th><th className="p-2 text-right">Precio Bs</th></tr></thead><tbody>{filteredPosvenProducts.map((row,index)=>{const code=String(row.codigo??'').trim();return <tr key={code||index} className="border-t border-slate-100"><td className="p-2"><input type="checkbox" checked={selectedPosvenProductCodes.includes(code)} onChange={event=>setSelectedPosvenProductCodes(old=>event.target.checked?[...old,code]:old.filter(item=>item!==code))}/></td><td className="whitespace-nowrap p-2 font-mono">{code}</td><td className="min-w-48 p-2">{String(row.nombre??'')}</td><td className="p-2">{String(row.categoria??row.departamento??'')}</td><td className="p-2 text-right tabular-nums">{String(row.stock??'')}</td><td className="p-2 text-right tabular-nums">{String(row.costoUSD??'')}</td><td className="p-2 text-right tabular-nums">{String(row.precioUSD??'')}</td><td className="p-2 text-right tabular-nums">{String(row.precioBS??'')}</td></tr>})}</tbody></table>{filteredPosvenProducts.length===0&&<p className="p-4 text-sm text-slate-500">No hay productos que coincidan con el filtro.</p>}</div>{posvenExcludedProducts.length>0&&<details className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3"><summary className="cursor-pointer text-sm font-semibold text-amber-900">Ver {posvenExcludedProducts.length} artículos excluidos y el motivo</summary><div className="mt-2 max-h-52 overflow-auto"><ul className="space-y-1 text-xs text-amber-950">{posvenExcludedProducts.map((row,index)=>{const reason=[row.activo!==true?'Inactivo':'',row.isKit===true?'Kit':''].filter(Boolean).join(' y ');return <li key={String(row.codigo??index)} className="border-b border-amber-200 py-1"><strong>{String(row.codigo??'Sin código')} · {String(row.nombre??'Sin nombre')}</strong><span className="ml-2">— Excluido: {reason}</span></li>})}</ul></div></details>}</div>}</section>}
    {jsonCollectionDiagnostics.length>0&&<section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4"><h3 className="font-bold text-slate-900">Análisis de colecciones JSON</h3><p className="mt-1 text-sm text-slate-600">Se muestra cada arreglo encontrado, incluso cuando contiene valores que no son registros. Los elementos incompatibles se contabilizan y quedan excluidos de la selección de importación; no se convierten ni se eliminan del archivo original.</p><div className="mt-3 max-h-72 overflow-auto rounded-lg border border-sky-100 bg-white"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Archivo / colección</th><th className="p-2 text-right">Elementos</th><th className="p-2 text-right">Registros objeto</th><th className="p-2 text-right">No importables</th></tr></thead><tbody>{jsonCollectionDiagnostics.map((item,index)=><tr key={item.source+'|'+item.path} className="border-t border-slate-100"><td className="max-w-64 break-all p-2">{item.source} · {item.path}</td><td className="p-2 text-right tabular-nums">{item.totalItems.toLocaleString('es-VE')}</td><td className="p-2 text-right tabular-nums">{item.validRecords.toLocaleString('es-VE')}</td><td className="p-2 text-right tabular-nums">{item.invalidItems.toLocaleString('es-VE')}</td></tr>)}</tbody></table></div><p className="mt-2 text-xs text-amber-800">Los elementos no importables requieren revisión según el contenido y el módulo. Si una colección no contiene registros objeto, se informa aquí y no se ofrece como lista de registros.</p></section>}
    {!posvenBackup&&inventoryCandidateRows.length>0&&<section className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
     <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Registros de inventario encontrados</h3><p className="text-sm text-slate-600">Revisa y marca uno por uno los artículos que deseas importar. Ningún registro genérico se selecciona automáticamente. Para importar, cada fila debe declarar método de costeo, tratamiento IVA, tipo de artículo, fecha y tasa BCV de apertura, categoría, unidad, stock mínimo, costo promedio y último costo Bs/USD, precios Bs/USD y los cuatro códigos contables destino. Las recetas/BOM requieren un adaptador de producción separado. SICOVEN no inventará clasificación ni cuentas.</p></div><strong className="text-sm text-indigo-800">{selectedInventoryRowKeys.length} / {inventoryCandidateRows.length} seleccionados</strong></div>
     <input value={inventoryFilter} onChange={event=>setInventoryFilter(event.target.value)} placeholder="Buscar por código, nombre, categoría o archivo…" className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"/>
     <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedInventoryRowKeys(old=>Array.from(new Set([...old,...filteredInventoryRows.map(row=>String(row.migrationrowid??'' )).filter(Boolean)])))} className="rounded-md border bg-white px-3 py-1 text-xs">Seleccionar visibles</button><button type="button" onClick={()=>setSelectedInventoryRowKeys(old=>old.filter(key=>!filteredInventoryRows.some(row=>String(row.migrationrowid??'')===key)))} className="rounded-md border bg-white px-3 py-1 text-xs">Desmarcar visibles</button><button type="button" onClick={()=>setSelectedInventoryRowKeys(inventoryCandidateRows.map(row=>String(row.migrationrowid??'')).filter(Boolean))} className="rounded-md border bg-white px-3 py-1 text-xs">Seleccionar todos</button><button type="button" onClick={()=>setSelectedInventoryRowKeys([])} className="rounded-md border bg-white px-3 py-1 text-xs">Limpiar selección</button></div>
     <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Importar</th><th className="p-2">Origen / colección</th><th className="p-2">Código</th><th className="p-2">Descripción</th><th className="p-2 text-right">Existencia</th><th className="p-2 text-right">Costo Bs</th><th className="p-2 text-right">Precio Bs</th></tr></thead><tbody>{filteredInventoryRows.map((row,index)=>{const key=String(row.migrationrowid??'');return <tr key={key||index} className="border-t border-slate-100"><td className="p-2"><input type="checkbox" checked={selectedInventoryRowKeys.includes(key)} onChange={event=>setSelectedInventoryRowKeys(old=>event.target.checked?[...old,key]:old.filter(item=>item!==key))}/></td><td className="max-w-48 p-2 text-slate-500">{String(row.migrationsource??'')}</td><td className="whitespace-nowrap p-2 font-mono">{String(pick(row,'code','codigo','sku','productCode')??'')}</td><td className="min-w-48 p-2"><div>{String(pick(row,'name','nombre','productName','producto')??'')}</div><div className="mt-1 text-[10px] leading-4 text-slate-500">IVA: {String(pick(row,'vatTreatment','tratamientoIva','alicuotaIva','iva')??'no declarado')} · Costeo: {String(pick(row,'costingMethod','metodoCosteo','metodoValuacion','metodoValoracion')??'no declarado')} · Tipo: {String(pick(row,'itemType','tipoArticulo','tipoItem','clasificacion')??'no declarado')}</div><div className="text-[10px] leading-4 text-slate-500">Cuentas: {String(pick(row,'inventoryAccountCode','cuentaInventario','codigoCuentaInventario')??'—')} / {String(pick(row,'costOfSalesAccountCode','cuentaCostoVentas','cuentaConsumo','codigoCuentaCosto')??'—')} / {String(pick(row,'adjustmentAccountCode','cuentaAjuste','cuentaMerma','codigoCuentaAjuste')??'—')} / {String(pick(row,'openingBalanceAccountCode','cuentaContrapartidaApertura','cuentaApertura','codigoCuentaApertura')??'—')}</div></td><td className="p-2 text-right tabular-nums">{String(pick(row,'currentStock','existencia','stock','quantity','cantidad')??'—')}</td><td className="p-2 text-right tabular-nums">{String(pick(row,'avgCostBs','costoPromedioBs','costBs','costoBs','costObs','costo','costoUnitario','unitCost')??'—')}</td><td className="p-2 text-right tabular-nums">{String(pick(row,'salesPriceBs','precioVentaBs','priceBs','salesPrice','precioVenta')??'—')}</td></tr>})}</tbody></table>{filteredInventoryRows.length===0&&<p className="p-4 text-sm text-slate-500">No hay artículos que coincidan con la búsqueda.</p>}</div>
    </section>}
    {ambiguousInvoiceRows.length>0&&<section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Facturas excluidas por contraparte ambigua ({ambiguousInvoiceRows.length})</h3><p className="mt-1 text-sm text-amber-900">Estas filas declaran simultáneamente datos de cliente y proveedor. SICOVEN no decidirá si son ventas o compras por el nombre de la colección; corrige el archivo o elige un adaptador específico antes de importarlas.</p><ul className="mt-2 max-h-40 space-y-1 overflow-auto text-xs text-amber-950">{ambiguousInvoiceRows.map((row,index)=><li key={String(row.migrationrowid??index)} className="border-t border-amber-200 pt-1">{String(row.migrationsource??'Archivo sin identificar')} · Documento {String(pick(row,'invoiceNumber','numeroFactura','factura','documento','numero')??'sin número')} · {String(pick(row,'invoiceDate','fechaFactura','fecha')??'sin fecha')}</li>)}</ul></section>}
    {(['sales','purchases','journal','movements'] as const).map(moduleId=>{const candidates=moduleRecordCandidates[moduleId];if(!candidates.length)return null;const selectedKeys=selectedModuleRowKeys[moduleId]??[];const title=moduleId==='sales'?'Facturas de venta':moduleId==='purchases'?'Facturas de compra':moduleId==='journal'?'Líneas de asientos':'Movimientos de inventario';return <section key={moduleId} className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">{title} encontrados</h3><p className="text-sm text-slate-600">Selecciona individualmente los registros que deseas importar. No se selecciona ninguno automáticamente.</p></div><strong className="text-sm text-indigo-800">{selectedKeys.length} / {candidates.length} seleccionados</strong></div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>setSelectedModuleRowKeys(old=>({...old,[moduleId]:Array.from(new Set([...(old[moduleId]??[]),...candidates.map(row=>String(row.migrationrowid??'')).filter(Boolean)]))}))} className="rounded-md border bg-white px-3 py-1 text-xs">Seleccionar todos</button><button type="button" onClick={()=>setSelectedModuleRowKeys(old=>({...old,[moduleId]:[]}))} className="rounded-md border bg-white px-3 py-1 text-xs">Limpiar selección</button></div><div className="mt-3 max-h-72 overflow-auto rounded-lg border border-slate-200 bg-white"><table className="min-w-full text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2">Importar</th><th className="p-2">Archivo / colección</th><th className="p-2">Documento / referencia</th><th className="p-2">Fecha</th><th className="p-2">Cliente / proveedor / cuenta</th><th className="p-2 text-right">Total / debe</th></tr></thead><tbody>{candidates.map((row,index)=>{const key=String(row.migrationrowid??'');const ref=pick(row,'invoiceNumber','numeroFactura','numero de factura','factura','documento','entryNumber','numeroAsiento','asiento','referenceDoc','referencia','documentRef');const date=pick(row,'invoiceDate','fechaFactura','fecha','date','movementDate');const directParty=pick(row,'customerName','cliente','nombreCliente','supplierName','proveedor','nombreProveedor','accountCode','codigoCuenta','cuenta','productCode','codigoProducto','sku','code','codigo');const partyReference=pick(row,'customerId','clientId','clienteId','idCliente','supplierId','vendorId','proveedorId','idProveedor');const party=directParty??(moduleId==='journal'?undefined:(()=>{try{return resolveUniversalPartyReference(rows,row,moduleId==='sales'?'customer':'supplier').name;}catch{return partyReference;}})());const amount=pick(row,'totalAmountBs','totalBs','total','debitBs','debe','debito','quantity','cantidad');return <tr key={key||index} className="border-t border-slate-100"><td className="p-2"><input type="checkbox" checked={selectedKeys.includes(key)} onChange={event=>setSelectedModuleRowKeys(old=>({...old,[moduleId]:event.target.checked?[...(old[moduleId]??[]),key]:(old[moduleId]??[]).filter(item=>item!==key)}))}/></td><td className="max-w-40 break-all p-2 text-slate-500">{String(row.migrationsource??'')}</td><td className="p-2 font-mono">{String(ref??'—')}</td><td className="p-2">{String(date??'—')}</td><td className="p-2">{String(party??'—')}</td><td className="p-2 text-right tabular-nums">{String(amount??'—')}</td></tr>})}</tbody></table></div></section>;})}
    {analysis.length>0&&<section><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-800">Módulos detectados automáticamente</h3><span className="text-xs text-slate-500">{analysis.filter(m=>m.ready).length} listos · {analysis.filter(m=>!m.ready).length} requieren revisión</span></div><label className="mb-3 block"><span className="mb-1 block text-xs font-semibold text-slate-600">Filtrar resultados por módulo o estado</span><input value={moduleFilter} onChange={e=>setModuleFilter(e.target.value)} placeholder="Ej.: inventario, CxC, ventas, requiere revisión…" className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/></label><div className="mb-3 flex flex-wrap gap-2"><button type="button" onClick={()=>setModuleFilter('')} className="rounded-full border px-3 py-1 text-xs">Ver todos ({analysis.length})</button><button type="button" onClick={()=>setModuleFilter('listos')} className="rounded-full border px-3 py-1 text-xs">Solo listos</button><button type="button" onClick={()=>setModuleFilter('revisión')} className="rounded-full border px-3 py-1 text-xs">Requieren revisión</button><button type="button" onClick={()=>setSelected([])} className="rounded-full border px-3 py-1 text-xs">Limpiar selección</button></div><div className="grid gap-2 md:grid-cols-2">{analysis.filter(m=>{const q=norm(moduleFilter);if(!q)return true;if(q==='listos')return m.ready;if(q==='revision'||q==='revisión')return !m.ready;return norm(m.name+' '+m.id+' '+m.source+' '+m.missing.join(' ')).includes(q);}).map(m=><label key={m.id+'-'+m.source} className={'flex items-start gap-3 rounded-xl border p-3 '+(m.ready?'border-emerald-200 bg-emerald-50':'border-amber-200 bg-amber-50')}><input type="checkbox" className="mt-1" checked={selected.includes(m.id)} disabled={!m.ready||!['inventory','journal','sales','purchases','movements'].includes(m.id)||(posvenBackup&&m.id==='inventory')} onChange={e=>setSelected(old=>e.target.checked?[...old.filter(id=>id!==m.id),m.id]:old.filter(id=>id!==m.id))}/><span className="min-w-0"><span className="block font-semibold text-slate-800">{m.name}</span><span className="block text-xs text-slate-500">Origen: {m.source}</span><span className="block text-xs text-slate-600">{m.ready?'Detectado · importador disponible':m.id==='accounts'?'El plan de cuentas es compartido por todas las empresas; requiere un catálogo separado antes de importar.':m.id==='customers'?'Los clientes se conservan en sus facturas; no existe maestro independiente.':m.id==='receivables'?'La CxC se calcula desde facturas de venta marcadas a crédito.':m.id==='payables'?'La CxP se calcula desde facturas de compra marcadas a crédito.':'Detectado parcialmente · faltan campos o validaciones'}</span>{m.missing.length>0&&<span className="block text-xs text-amber-800">Campos no detectados: {m.missing.join(', ')}</span>}</span></label>)}</div><p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">Puedes seleccionar varios módulos: se procesarán en cola, uno por ejecución, con confirmación independiente para cada uno. No es una transacción atómica conjunta; los módulos completados no se revierten si uno posterior falla. CxC se deriva de las ventas a crédito y CxP de las compras a crédito; no las selecciones como una carga independiente para evitar duplicar saldos.</p></section>}
    {rows.length>0&&<section className="rounded-xl border border-slate-200 p-3"><div className="mb-2 flex items-center gap-2 font-semibold"><FileSpreadsheet size={17}/> Vista previa (primeros 5 registros)</div><div className="overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{headers.slice(0,8).map(h=><th key={h} className="border-b p-2">{h}</th>)}</tr></thead><tbody>{rows.slice(0,5).map((r,i)=><tr key={i}>{headers.slice(0,8).map(h=><td key={h} className="max-w-40 truncate border-b p-2">{String(r[h]??'')}</td>)}</tr>)}</tbody></table></div></section>}
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700"><div className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck size={17}/> Controles de seguridad</div>Se rechazan códigos duplicados y campos numéricos inválidos; no se sobrescriben artículos existentes. Ventas, compras, asientos y movimientos históricos de inventario disponen de importadores con validaciones específicas. El plan de cuentas compartido no se modifica desde este flujo. CxC y CxP se derivan de facturas de crédito; clientes y proveedores no se importan como maestros separados porque el modelo actual los conserva dentro de sus documentos. Revisa la vista previa y confirma antes de importar.</div>
    {error&&<div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mr-2 inline" size={17}/>{error}</div>}
    {notice&&<div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline" size={17}/>{notice}</div>}
    {settlementPreview.length>0&&<section className="rounded-lg border border-amber-200 bg-amber-50 p-3">
     <h3 className="text-sm font-semibold text-amber-900">Liquidaciones históricas vinculadas</h3>
     <p className="mt-1 text-xs text-amber-900">Marca los cobros y pagos que deseas contabilizar junto con las facturas seleccionadas. Los registros desmarcados no se importarán ni modificarán sus saldos.</p>
     <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
      <button type="button" className="font-medium underline" onClick={()=>setSelectedSettlementSourceRowIds(settlementPreview.map(item=>item.sourceRowId))}>Seleccionar todas</button>
      <button type="button" className="font-medium underline" onClick={()=>setSelectedSettlementSourceRowIds([])}>Desmarcar todas</button>
      <span>{selectedSettlementSourceRowIds.length} de {settlementPreview.length} liquidaciones seleccionadas</span>
     </div>
     <div className="mt-3 max-h-64 overflow-auto">
      <table className="min-w-full text-xs">
       <thead><tr className="border-b border-amber-200 text-left"><th className="px-2 py-2">Importar</th><th className="px-2 py-2">Factura origen</th><th className="px-2 py-2">Liquidación</th><th className="px-2 py-2">Fecha</th><th className="px-2 py-2">Medio</th><th className="px-2 py-2 text-right">Tasa BCV</th><th className="px-2 py-2 text-right">USD</th><th className="px-2 py-2 text-right">Bs</th><th className="px-2 py-2">Referencia</th><th className="px-2 py-2">Destino</th></tr></thead>
       <tbody>{settlementPreview.map(item=><tr key={item.sourceRowId} className="border-b border-amber-100 align-top">
        <td className="px-2 py-2"><input type="checkbox" checked={selectedSettlementSourceRowIds.includes(item.sourceRowId)} onChange={event=>setSelectedSettlementSourceRowIds(current=>event.target.checked?[...current,item.sourceRowId]:current.filter(id=>id!==item.sourceRowId))} aria-label={'Importar liquidación '+item.sourceRowId}/></td>
        <td className="px-2 py-2 font-mono">{item.invoiceRowId}</td><td className="px-2 py-2 font-mono">{item.sourceRowId}</td>
        <td className="px-2 py-2">{item.settlementDate}</td><td className="px-2 py-2">{item.method==='CASH_BS'?'Efectivo Bs':item.method==='CASH_USD'?'Efectivo USD':item.method==='BANK_TRANSFER_BS'?'Transferencia Bs':'Transferencia USD'}</td>
        <td className="px-2 py-2 text-right tabular-nums">{item.bcvRate.toFixed(4)}</td>
        <td className="px-2 py-2 text-right tabular-nums">{item.amountUsd.toFixed(2)}</td><td className="px-2 py-2 text-right tabular-nums">{item.amountBs.toFixed(2)}</td>
        <td className="px-2 py-2">{item.reference||'—'}</td>
        <td className="px-2 py-2">{item.destinationError?<span className="font-medium text-rose-700">{item.destinationError}</span>:<span className="font-medium text-emerald-700">Verificado</span>}</td>
       </tr>)}</tbody>
      </table>
     </div>
    </section>}
    {(rows.length>0||(posvenBackup&&selectedPosvenCollections.includes('productos')))&&<label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)} className="mt-1"/><span>{posvenBackup&&selectedPosvenCollections.includes('productos')?'Confirmo la importación de los productos activos no-kit seleccionados. Entiendo que no se sobrescribirán códigos existentes, que el costo Bs se calculará con la tasa BCV indicada y que el tratamiento IVA elegido se aplicará a los artículos importados.':'Confirmo que revisé las colecciones y los registros seleccionados. Autorizo únicamente el módulo y las filas marcadas, con la empresa destino indicada; no autorizo restaurar respaldos completos ni reemplazar datos existentes.'}</span></label>}
   </div>
   <footer className="flex flex-wrap justify-between gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4"><button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cerrar</button><button disabled={posvenBackup?(busy||selectedPosvenCollections.length!==1||!confirmed||(selectedPosvenCollections.includes('productos')?(selectedPosvenProductCodes.length===0||!posvenVatTreatment||!posvenOpeningDate||!posvenBcvRate.trim()):(!selected.length||!['sales','purchases','journal','movements'].includes(selected[0])||!(selectedModuleRowKeys[selected[0]]??[]).length))):(busy||(!backupPayload&&(!rows.length||!confirmed||selected.length<1||!['inventory','journal','sales','purchases','movements'].includes(selected[0])))||!!backupPayload)} onClick={posvenBackup?(selectedPosvenCollections.includes('productos')?runPosvenImport:runMigration):backupPayload?runBackupImport:runMigration} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy?'Validando e importando…':posvenBackup?(selectedPosvenCollections.includes('productos')?'Importar productos POSVEN':'Importar módulo POSVEN seleccionado'):backupPayload?'Respaldo completo no importable':'Importar siguiente módulo'}</button></footer>
  </div>
 </div>;
};
