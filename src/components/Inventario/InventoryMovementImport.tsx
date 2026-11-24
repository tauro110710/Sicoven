import React, { useMemo, useState } from 'react';
import { FileUp, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { InventoryMovementImportDraft } from '../../types/accounting';
import { isValidIsoDate, parseDelimitedRecords, parseMigrationNumber, validateUniqueMigrationHeaders } from '../../types/migrationParsing';

type SourceRow = Record<string, unknown>;
type PreparedRow = InventoryMovementImportDraft & { sourceRow: number; productLabel: string };

const normalize = (value: unknown) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const valueAt = (row: SourceRow, ...names: string[]) => {
  const entries = Object.entries(row);
  for (const name of names) {
    const match = entries.find(([key, value]) => normalize(key) === normalize(name) && value !== undefined && value !== null && String(value).trim() !== '');
    if (match) return match[1];
  }
  return undefined;
};
export const dateValue = (value: unknown): string => {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-](\d{2}):?(\d{2}))?)?$/);
  if ( iso ) {
    const [, date, hour, minute, second, , zone, zoneHour, zoneMinute] = iso;
    if (!isValidIsoDate(date)) return raw;
    if (hour !== undefined) {
      if (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 59) return raw;
      if (zone && zone !== 'Z' && (Number(zoneHour) > 14 || Number(zoneMinute) > 59 || (Number(zoneHour) === 14 && Number(zoneMinute) !== 0))) return raw;
      if (!Number.isFinite(Date.parse(raw))) return raw;
    }
    return date;
  }
  const match = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (match) {
    const date = match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
    return isValidIsoDate(date) ? date : raw;
  }
  return raw;
};
export const resolveMovementProduct = <T extends { id: string; code: string; name: string }>(
  products: T[],
  sourceProductId: string,
  code: string,
  name: string,
  rowNumber: number
): T => {
  const byCode = code ? products.filter(product => normalize(product.code) === normalize(code)) : [];
  const byName = name ? products.filter(product => normalize(product.name) === normalize(name)) : [];
  const byId = sourceProductId ? products.find(product => product.id === sourceProductId) : undefined;
  if (code && byCode.length === 0) throw new Error('Fila ' + rowNumber + ': el código de artículo no coincide con ningún producto registrado.');
  if (byCode.length > 1) throw new Error('Fila ' + rowNumber + ': el código coincide con varios artículos. Corrija el archivo para usar un código único.');
  if (!code && name && byName.length === 0) throw new Error('Fila ' + rowNumber + ': el nombre de artículo no coincide con ningún producto registrado.');
  if (!code && byName.length > 1) throw new Error('Fila ' + rowNumber + ': el nombre coincide con varios artículos. Corrija el archivo para usar un código único.');
  if (sourceProductId && !byId) throw new Error('Fila ' + rowNumber + ': el identificador de producto no existe en la empresa destino.');
  const product = byCode[0] ?? byName[0] ?? byId;
  if (!product) throw new Error('Fila ' + rowNumber + ': no se encontró un artículo único por código, nombre o ID.');
  if (byId && byId.id !== product.id) throw new Error('Fila ' + rowNumber + ': el ID de producto no coincide con el código o nombre indicado.');
  if (code && name && normalize(product.name) !== normalize(name)) throw new Error('Fila ' + rowNumber + ': el código y nombre identifican productos distintos.');
  return product;
};

const rowsFromFile = async (file: File): Promise<SourceRow[]> => {
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'json') {
    const parsed = JSON.parse(await file.text()) as unknown;
    const root = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const data = root.data && typeof root.data === 'object' ? root.data as Record<string, unknown> : root;
    const candidates = [data.movimientos, data.movements, data.inventoryMovements, data.kardex];
    const rows = candidates.find(Array.isArray);
    if (!rows) throw new Error('El JSON no contiene una colección reconocible de movimientos de inventario.');
    const products = [data.productos, data.products, data.inventario].find(Array.isArray) as SourceRow[] | undefined;
    const productCodes = new Map((products ?? []).map(product => [String(product.id ?? product.productId ?? ''), String(product.codigo ?? product.code ?? product.sku ?? '')]));
    return rows.filter((row): row is SourceRow => Boolean(row) && typeof row === 'object' && !Array.isArray(row)).map(row => {
      if (valueAt(row, 'productCode', 'codigoProducto', 'codigo', 'sku', 'code')) return row;
      const productId = String(valueAt(row, 'productId', 'productoId', 'idProducto') ?? '');
      const productCode = productCodes.get(productId);
      return productCode ? { ...row, productCode } : row;
    });
  }
  if (['xlsx', 'xlsm'].includes(extension || '')) {
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error('El Excel no contiene hojas.');
    const matrix: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, row => {
      const values: unknown[] = [];
      row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
        const value = cell.value;
        values[columnNumber - 1] = value && typeof value === 'object' && 'text' in value
          ? (value as { text: string }).text
          : value && typeof value === 'object' && 'result' in value
            ? (value as { result: unknown }).result
            : value;
      });
      matrix.push(values);
    });
    if (matrix.length < 2) throw new Error('La primera hoja no contiene filas de movimientos.');
    const headers = validateUniqueMigrationHeaders(matrix[0], 'hoja de movimientos');
    return matrix.slice(1).filter(row => row.some(cell => String(cell ?? '').trim())).map(row => {
      const item: SourceRow = {};
      headers.forEach((header, index) => { if (header) item[header] = row[index]; });
      return item;
    });
  }
  if (['csv', 'tsv', 'txt'].includes(extension || '')) return parseDelimitedRecords(await file.text()) as SourceRow[];
  throw new Error('Formato no compatible. Use JSON, CSV, TSV, TXT, XLSX o XLSM.');
};

export const InventoryMovementImport: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { currentCompany, products: allProducts, importInventoryMovements, waitForPersistence } = useAccounting();
  const products = useMemo(() => allProducts.filter(product => product.companyId === currentCompany.id), [allProducts, currentCompany.id]);
  const [fileName, setFileName] = useState('');
  const [prepared, setPrepared] = useState<PreparedRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  const reset = () => { setFileName(''); setPrepared([]); setError(''); setNotice(''); };
  const analyze = async (file?: File) => {
    if (!file) return;
    setBusy(true); setError(''); setNotice(''); setPrepared([]); setFileName(file.name);
    try {
      const sourceRows = await rowsFromFile(file);
      if (!sourceRows.length) throw new Error('No se encontraron filas de movimientos.');
      const byCode = new Map<string, typeof products>();
      const byName = new Map<string, typeof products>();
      products.forEach(product => {
        byCode.set(normalize(product.code), [...(byCode.get(normalize(product.code)) ?? []), product]);
        byName.set(normalize(product.name), [...(byName.get(normalize(product.name)) ?? []), product]);
      });
      const result = sourceRows.map((row, index): PreparedRow => {
        const sourceProductId = String(valueAt(row, 'productId', 'productoId', 'idProducto') ?? '').trim();
        const code = String(valueAt(row, 'productCode', 'codigoProducto', 'codigo', 'sku', 'code') ?? '').trim();
        const name = String(valueAt(row, 'productName', 'nombreProducto', 'producto', 'nombre', 'descripcion') ?? '').trim();
        const product = resolveMovementProduct(products, sourceProductId, code, name, index + 2);
        const rawType = normalize(valueAt(row, 'type', 'movementType', 'tipo', 'tipoMovimiento'));
        const rawConcept = normalize(valueAt(row, 'concept', 'concepto', 'operacion', 'operation'));
        let type: 'ENTRADA' | 'SALIDA' | 'AJUSTE';
        let concept: string;
        if (rawType.includes('ajuste') || rawConcept.includes('ajuste')) { type = 'AJUSTE'; concept = 'AJUSTE'; }
        else if (rawType.includes('venta') || rawType.includes('salida') || ['venta', 'merma', 'autoconsumo'].includes(rawConcept)) {
          type = 'SALIDA'; concept = rawConcept.includes('merma') ? 'MERMA' : rawConcept.includes('autoconsumo') ? 'AUTOCONSUMO' : 'VENTA';
        } else if (rawType.includes('compra') || rawType.includes('entrada') || ['compra', 'devolucioncliente', 'inventarioinicial'].includes(rawConcept)) {
          type = 'ENTRADA'; concept = rawConcept === 'devolucioncliente' ? 'DEVOLUCION_CLIENTE' : rawConcept === 'inventarioinicial' ? 'INVENTARIO_INICIAL' : 'COMPRA';
        } else throw new Error('Fila ' + (index + 2) + ': tipo/concepto no reconocido. Indique ENTRADA, SALIDA o AJUSTE y un concepto compatible.');
        const date = dateValue(valueAt(row, 'date', 'fecha', 'fechaMovimiento'));
        if (!isValidIsoDate(date)) throw new Error('Fila ' + (index + 2) + ': fecha inválida; use AAAA-MM-DD o DD/MM/AAAA.');
        const sourceReference = String(valueAt(row, 'documentRef', 'referencia', 'documento', 'numeroDocumento', 'documentNumber') ?? '').trim();
        const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 48);
        const documentRef = sourceReference || 'IMPORT-KARDEX-' + safeFileName + '-F' + (index + 2);
        if (['DEVOLUCION_COMPRA', 'DEVOLUCION_CLIENTE', 'INVENTARIO_INICIAL'].includes(concept)) throw new Error('Fila ' + (index + 2) + ': devoluciones y saldos iniciales requieren sus flujos vinculados; no se importan como movimientos aislados.');
        const quantityRaw = valueAt(row, 'quantity', 'cantidad', 'qty');
        const quantity = quantityRaw === undefined ? 0 : parseMigrationNumber(quantityRaw);
        const balanceRaw = valueAt(row, 'balanceQty', 'existenciaFinal', 'stockFinal', 'saldoCantidad');
        const balanceQty = balanceRaw === undefined ? NaN : parseMigrationNumber(balanceRaw);
        if (type === 'AJUSTE' && (!Number.isFinite(balanceQty) || balanceQty < 0)) throw new Error('Fila ' + (index + 2) + ': los ajustes requieren existencia final explícita.');
        if (type !== 'AJUSTE' && (!Number.isFinite(quantity) || quantity <= 0)) throw new Error('Fila ' + (index + 2) + ': cantidad positiva obligatoria.');
        const rateRaw = valueAt(row, 'bcvRate', 'tasaBcv', 'tasa');
        const bcvRate = rateRaw === undefined ? 0 : parseMigrationNumber(rateRaw);
        if (!Number.isFinite(bcvRate) || bcvRate <= 0) throw new Error('Fila ' + (index + 2) + ': falta una tasa BCV histórica positiva; no se utilizará la tasa actual para reconstruir el pasado.');
        const costRaw = valueAt(row, 'unitCostBs', 'costoUnitarioBs', 'costoBs', 'unitCost');
        const unitCostBs = costRaw === undefined && (type === 'SALIDA' || type === 'AJUSTE') ? product.avgCostBs : costRaw === undefined ? NaN : parseMigrationNumber(costRaw);
        if (!Number.isFinite(unitCostBs) || unitCostBs < 0 || (type === 'ENTRADA' && unitCostBs <= 0)) throw new Error('Fila ' + (index + 2) + ': costo unitario Bs. no válido; las entradas requieren costo positivo.');
        const additionalLandedCostsBs = parseMigrationNumber(valueAt(row, 'additionalLandedCostsBs', 'fleteBs', 'gastosImportacionBs') ?? 0);
        if (!Number.isFinite(additionalLandedCostsBs) || additionalLandedCostsBs < 0) throw new Error('Fila ' + (index + 2) + ': fletes/gastos no pueden ser negativos.');
        if (concept === 'DEVOLUCION_CLIENTE' && type !== 'ENTRADA') throw new Error('Fila ' + (index + 2) + ': devolución de cliente debe ser una entrada.');
        return {
          productId: product.id, date, type, concept, documentRef, quantity: type === 'AJUSTE' ? Math.abs(balanceQty - product.currentStock) : quantity,
          unitCostBs, bcvRate, balanceQty: Number.isFinite(balanceQty) ? balanceQty : undefined, expectedBalanceQty: Number.isFinite(balanceQty) && type !== 'AJUSTE' ? balanceQty : undefined,
          additionalLandedCostsBs, counterpartyRif: String(valueAt(row, 'counterpartyRif', 'rifContraparte') ?? '') || undefined,
          counterpartyName: String(valueAt(row, 'counterpartyName', 'nombreContraparte') ?? '') || undefined,
          sourceRow: index + 2, productLabel: product.code + ' · ' + product.name
        };
      }).sort((a, b) => a.date.localeCompare(b.date) || a.sourceRow - b.sourceRow);
      setPrepared(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo analizar el archivo.');
    } finally { setBusy(false); }
  };
  const confirm = async () => {
    if (!prepared.length || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const drafts = prepared.map(({ sourceRow: _row, productLabel: _label, ...draft }) => draft);
      const count = importInventoryMovements(drafts, currentCompany.id, { accountingMode: 'kardex-only' });
      await waitForPersistence();
      setNotice('Se actualizaron ' + count + ' movimientos del Kardex. Este registro logístico queda independiente: no crea, modifica ni enlaza asientos contables, facturas o ventas. La contabilidad diaria conserva su propio proceso y sus propios comprobantes.');
      setPrepared([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron registrar los movimientos.');
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/60 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div><h2 className="text-base font-bold text-slate-900">Importar movimientos al Kardex</h2><p className="text-xs text-slate-500">Registro logístico independiente de ventas y asientos contables. No se enlaza al Reporte Z.</p></div>
          <button type="button" onClick={() => { reset(); onClose(); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto p-5">
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900">
            Empresa destino: <strong>{currentCompany.name}</strong>. Este proceso actualiza exclusivamente el Kardex. No participa en la contabilización del Reporte Z ni genera vínculos con asientos contables. Los movimientos se identifican por código único de artículo. La tasa BCV histórica y los costos requeridos deben venir en el archivo; si no existe folio, SICOVEN genera una referencia técnica explícita con el nombre del archivo y la fila de origen.
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-slate-300 p-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <FileUp className="h-5 w-5" /> Seleccionar archivo de movimientos
            <input className="hidden" type="file" accept=".json,.csv,.tsv,.txt,.xlsx,.xlsm" onChange={event => { void analyze(event.target.files?.[0]); event.currentTarget.value = ''; }} />
          </label>
          {fileName && <p className="text-xs text-slate-500">Archivo: {fileName} · {prepared.length} movimientos validados</p>}
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}
          {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}</div>}
          {prepared.length > 0 && <div className="overflow-x-auto rounded-xl border border-slate-200"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr><th className="p-2">Fila</th><th className="p-2">Artículo</th><th className="p-2">Fecha</th><th className="p-2">Tipo / concepto</th><th className="p-2">Referencia</th><th className="p-2 text-right">Cantidad</th></tr></thead><tbody>{prepared.slice(0, 30).map(row => <tr key={row.sourceRow} className="border-t border-slate-100"><td className="p-2">{row.sourceRow}</td><td className="p-2">{row.productLabel}</td><td className="p-2">{row.date}</td><td className="p-2">{row.type} / {row.concept}</td><td className="p-2">{row.documentRef}</td><td className="p-2 text-right">{row.quantity}</td></tr>)}</tbody></table>{prepared.length > 30 && <p className="p-2 text-xs text-slate-500">Se muestran 30 de {prepared.length} filas.</p>}</div>}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4">
          <button type="button" onClick={() => { reset(); onClose(); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cerrar</button>
          <button type="button" onClick={() => void confirm()} disabled={!prepared.length || busy} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Procesando…' : 'Confirmar actualización del Kardex'}</button>
        </div>
      </div>
    </div>
  );
};
