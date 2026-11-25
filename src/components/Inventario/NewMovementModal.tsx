import React, { useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { ArrowLeftRight, X, Check } from 'lucide-react';
import { formatBs, formatUsd } from '../../utils/formatters';
import { filterEntriesByCompany } from '../../types/accountingReportIntegrity';
import { resolveInventoryBcvRate } from '../../types/inventoryBcvRate';
import { resolveBcvRateForDate } from '../../utils/resolveBcvRateForDate';
import { getReglaMonetariaPorFecha } from '../../utils/monetaryPolicy';
import { calculateFifoIssue, reconstructFifoLayers } from '../../types/inventoryAccounting';

interface NewMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultProductId?: string;
}

export const NewMovementModal: React.FC<NewMovementModalProps> = ({
  isOpen,
  onClose,
  defaultProductId
}) => {
  const { currentCompany, products: allProducts, movements: allMovements, purchases: allPurchases, journalEntries: allJournalEntries, addMovement, waitForPersistence } = useAccounting();
  const formatLocalIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const companyProducts = filterEntriesByCompany(allProducts, currentCompany.id);
  const companyMovements = filterEntriesByCompany(allMovements, currentCompany.id);
  const companyPurchases = filterEntriesByCompany(allPurchases, currentCompany.id);
  const companyJournalEntries = filterEntriesByCompany(allJournalEntries, currentCompany.id);
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [productId, setProductId] = useState<string>(
    defaultProductId || companyProducts[0]?.id || ''
  );
  const [date, setDate] = useState<string>(() => {
    // Iniciar en la fecha de inicio contable si existe y es anterior a hoy,
    // para que el contador parta automáticamente del período histórico correcto.
    const start = currentCompany?.accountingStartDate;
    if (start && /^\d{4}-\d{2}-\d{2}$/.test(start)) {
      const today = formatLocalIsoDate(new Date());
      if (start < today) return start;
    }
    return formatLocalIsoDate(new Date());
  });
  const [type, setType] = useState<'ENTRADA' | 'SALIDA' | 'AJUSTE'>('ENTRADA');
  const [concept, setConcept] = useState<'COMPRA' | 'VENTA' | 'MERMA' | 'AJUSTE' | 'DEVOLUCION_COMPRA' | 'DEVOLUCION_CLIENTE' | 'AUTOCONSUMO' | 'INVENTARIO_INICIAL'>('COMPRA');
  const [correctionMovementId, setCorrectionMovementId] = useState('');
  const [documentRef, setDocumentRef] = useState<string>('');
  const [quantityInput, setQuantityInput] = useState('1');
  const [unitCostInput, setUnitCostInput] = useState('0');
  const [additionalLandedCostsInput, setAdditionalLandedCostsInput] = useState('0');
  const [bcvRateInput, setBcvRateInput] = useState('');
  const [documentType, setDocumentType] = useState('Factura de compra');
  const [counterpartyRif, setCounterpartyRif] = useState('');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [error, setError] = useState('');

  React.useEffect(() => {
    const validCurrent = companyProducts.some(product => product.id === productId);
    const validDefault = defaultProductId ? companyProducts.some(product => product.id === defaultProductId) : false;
    if (!validCurrent) setProductId(validDefault ? defaultProductId! : (companyProducts[0]?.id || ''));
    setCorrectionMovementId('');
    const start = currentCompany?.accountingStartDate;
    const today = formatLocalIsoDate(new Date());
    setDate((start && /^\d{4}-\d{2}-\d{2}$/.test(start) && start < today) ? start : today);
  }, [currentCompany.id]);

  const selectedProduct = companyProducts.find(p => p.id === productId) || companyProducts[0];
  const supplierReturnSources = companyMovements.filter(m => m.companyId === currentCompany.id && m.productId === productId && m.type === 'ENTRADA' && m.concept === 'COMPRA' && !m.correctionForMovementId).map(m => ({...m, remaining: m.quantity - companyMovements.filter(x => x.companyId === currentCompany.id && x.correctionForMovementId === m.id).reduce((sum,x)=>sum+Number(x.quantity||0),0)})).filter(m=>m.remaining>1e-8);
  const selectedReturnSource = supplierReturnSources.find(m=>m.id===correctionMovementId);

  // Auto-set cost when product changes
  React.useEffect(() => {
    if (selectedProduct) {
      setUnitCostInput(String(selectedProduct.avgCostBs || 0));
    }
  }, [productId, selectedProduct]);

  React.useEffect(() => {
    // Antes de 2018 el Kardex se lleva solo en bolívares: se limpia cualquier tasa.
    if (!getReglaMonetariaPorFecha(date).allowsUsd) {
      setBcvRateInput('');
      return;
    }
    // Prioridad 1: historial BCV específico de inventario.
    const inventoryRate = resolveInventoryBcvRate(currentCompany.inventoryBcvRateHistory || [], date);
    if (inventoryRate) {
      setBcvRateInput(String(inventoryRate.rate));
      return;
    }
    // Prioridad 2: tasa BCV puntual del módulo de inventario (campo simple).
    if (date === currentCompany.inventoryBcvRateEffectiveDate && currentCompany.inventoryBcvRate) {
      setBcvRateInput(String(currentCompany.inventoryBcvRate));
      return;
    }
    // Prioridad 3: historial BCV general de la empresa (Configuración → BCV).
    // Útil para períodos históricos donde el contador registró tasas en ese módulo.
    const generalRate = resolveBcvRateForDate(currentCompany.accountingBcvRateHistory, date);
    if (generalRate) {
      setBcvRateInput(String(generalRate));
      return;
    }
    setBcvRateInput('');
  }, [date, currentCompany.id, currentCompany.inventoryBcvRate, currentCompany.inventoryBcvRateEffectiveDate, currentCompany.inventoryBcvRateHistory, currentCompany.accountingBcvRateHistory]);

  if (!isOpen || !selectedProduct) return null;

  const parseDecimalInput = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.split('.').join('').replace(',', '.') : raw); };
  const quantity = parseDecimalInput(quantityInput);
  const unitCostBs = parseDecimalInput(unitCostInput);
  const additionalLandedCostsBs = parseDecimalInput(additionalLandedCostsInput);
  const bcvRate = parseDecimalInput(bcvRateInput);
  // Regla monetaria única por fecha contable: antes de 2018 no hay tasa BCV ni USD.
  const monetaryRule = getReglaMonetariaPorFecha(date);
  const usdEnabled = monetaryRule.allowsUsd;
  const effectiveBcvRate = usdEnabled ? bcvRate : 0;
  const rateRequired = monetaryRule.requiresBcvRate && type !== 'SALIDA' && unitCostBs > 0;
  const unitCostUsd = effectiveBcvRate > 0 ? unitCostBs / effectiveBcvRate : 0;
  const fifoPreview = React.useMemo(() => {
    if (type !== 'SALIDA' || selectedProduct.costingMethod !== 'PEPS') return undefined;
    try {
      const prior = companyMovements.filter(m => m.productId === selectedProduct.id && m.date <= date);
      const priorOrdered = [...prior].sort((x, y) => x.date.localeCompare(y.date));
      const stockAtDate = priorOrdered.length ? Number(priorOrdered[priorOrdered.length - 1].balanceQty) : 0;
      const layers = reconstructFifoLayers(prior, stockAtDate);
      return calculateFifoIssue(layers, quantity);
    } catch {
      return undefined;
    }
  }, [type, selectedProduct.id, selectedProduct.costingMethod, selectedProduct.currentStock, companyMovements, date, quantity]);
  const totalCostBs = type === 'ENTRADA'
    ? quantity * unitCostBs + additionalLandedCostsBs
    : type === 'SALIDA'
      ? (fifoPreview?.totalCostBs ?? quantity * selectedProduct.avgCostBs)
      : Math.abs(quantity - selectedProduct.currentStock) * (quantity < selectedProduct.currentStock ? selectedProduct.avgCostBs : unitCostBs);
  const totalCostUsd = !usdEnabled
    ? 0
    : type === 'SALIDA' && selectedProduct.costingMethod === 'PEPS' && fifoPreview
      ? fifoPreview.totalCostUsd
      : type === 'SALIDA' && selectedProduct.costingMethod !== 'PEPS'
        ? quantity * Number(selectedProduct.avgCostUsd || 0)
        : bcvRate > 0 ? totalCostBs / bcvRate : 0;

  // Compute prospective balance
  let balanceQty = selectedProduct.currentStock;
  if (type === 'ENTRADA') balanceQty += quantity;
  else if (type === 'SALIDA') balanceQty = Math.max(0, balanceQty - quantity);
  else balanceQty = quantity;

  const balanceTotalBs = balanceQty * unitCostBs;
  const balanceTotalUsd = effectiveBcvRate > 0 ? balanceTotalBs / effectiveBcvRate : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!Number.isFinite(quantity) || !Number.isFinite(unitCostBs) || !Number.isFinite(additionalLandedCostsBs) || quantity < 0 || (type !== 'AJUSTE' && quantity <= 0) || unitCostBs < 0 || additionalLandedCostsBs < 0) { setError('Verifique que la cantidad y los costos sean válidos.'); return; }
    // Para entradas y ajustes desde 2018 se requiere equivalencia USD; antes de 2018 queda pendiente.
    if (rateRequired && (!Number.isFinite(bcvRate) || bcvRate <= 0)) { setError('La tasa BCV es obligatoria para entradas y ajustes de inventario desde 2018. Antes de 2018 puede dejarla pendiente.'); return; }
    if (bcvRateInput.trim().length > 0 && (!Number.isFinite(bcvRate) || bcvRate <= 0)) { setError('La tasa BCV ingresada no es válida. Corríjala o bórrela para dejarla como pendiente.'); return; }

    if (type === 'SALIDA' && concept === 'DEVOLUCION_COMPRA') {
      if (!selectedReturnSource) { setError('Seleccione la entrada original de Kardex que se devuelve.'); return; }
      if (quantity > selectedReturnSource.remaining + 1e-8) { setError('La cantidad supera las unidades recibidas menos devoluciones previas (' + selectedReturnSource.remaining + ').'); return; }
      if (documentRef.trim().length < 4) { setError('Indique el número real de nota de crédito del proveedor o soporte autorizado (mínimo 4 caracteres).'); return; }
      if (selectedProduct.costingMethod === 'PEPS') { setError('La devolución con PEPS requiere identificar el lote de origen; permanece bloqueada hasta disponer de ese dato.'); return; }
      if (selectedProduct.currentStock + 1e-8 < quantity) { setError('No hay existencia suficiente para descargar la devolución física al proveedor.'); return; }
      if (Math.abs(Number(selectedProduct.avgCostBs || 0) - Number(selectedReturnSource.unitCostBs || 0)) > 0.01) { setError('El costo promedio actual difiere del costo de la entrada original. No se registró la devolución porque la contrapartida CxP podría no coincidir con la nota de crédito; requiere conciliación contable manual.'); return; }
      const linkedPurchase = companyPurchases.find(p => p.companyId === currentCompany.id &&
        ('FAC-' + p.invoiceNumber).trim().toUpperCase() === selectedReturnSource.documentRef.trim().toUpperCase());
      const purchaseLines = linkedPurchase?.inventoryLines || [];
      const purchaseLine = purchaseLines.find(line => line.productId === selectedProduct.id &&
        Math.abs(Number(line.quantity)-Number(selectedReturnSource.quantity)) <= 1e-8 &&
        Math.abs(Number(line.unitCostBs)-Number(selectedReturnSource.unitCostBs)) <= 0.02);
      const purchaseJournal = linkedPurchase?.journalEntryId
        ? companyJournalEntries.find(entry => entry.id === linkedPurchase.journalEntryId) : undefined;
      const journalInventoryDebit = purchaseJournal?.items.filter(item=>item.accountCode==='1.1.4.01')
        .reduce((sum,item)=>sum+Number(item.debitBs||0)-Number(item.creditBs||0),0);
      const expectedInventoryDebit = linkedPurchase
        ? Number(linkedPurchase.taxableBaseBs||0)+Number(linkedPurchase.exemptAmountBs||0) : 0;
      const lineTotal = purchaseLines.reduce((sum,line)=>sum+Number(line.quantity||0)*Number(line.unitCostBs||0),0);
      const invoiceMovements = linkedPurchase ? companyMovements.filter(m=>m.companyId===currentCompany.id &&
        m.type==='ENTRADA' && m.concept==='COMPRA' &&
        m.documentRef.trim().toUpperCase()===('FAC-'+linkedPurchase.invoiceNumber).trim().toUpperCase() &&
        !m.correctionForMovementId) : [];
      const allLinesMatchKardex = purchaseLines.length>0 && invoiceMovements.length===purchaseLines.length &&
        purchaseLines.every(line => {
          const matches=invoiceMovements.filter(m=>m.productId===line.productId);
          return matches.length===1 && Math.abs(Number(matches[0].quantity)-Number(line.quantity))<=1e-8 &&
            Math.abs(Number(matches[0].totalCostBs)-Number(line.quantity)*Number(line.unitCostBs))<=0.02;
        }) && Math.abs(lineTotal-expectedInventoryDebit)<=0.02 &&
        Math.abs(invoiceMovements.reduce((sum,m)=>sum+Number(m.totalCostBs||0),0)-lineTotal)<=0.02;
      if (!linkedPurchase || !purchaseLine || !purchaseJournal || !allLinesMatchKardex ||
          !Number.isFinite(journalInventoryDebit) || Math.abs(Number(journalInventoryDebit)-expectedInventoryDebit)>0.02) {
        setError('Devolución bloqueada: no hay conciliación verificable entre la línea de compra, la entrada de Kardex y el débito de inventario del asiento original. Las facturas históricas sin líneas vinculadas requieren conciliación manual documentada.');
        return;
      }
      if (Number(linkedPurchase.vatAmountBs||0)>0 || Number(linkedPurchase.vatWithheldBs||0)>0 ||
          Number(linkedPurchase.islrWithheldBs||0)>0 || Number(linkedPurchase.igtfAmountBs||0)>0) {
        setError('Devolución bloqueada para esta factura: el flujo actual no calcula de forma completa la nota de crédito fiscal ni sus efectos en IVA, retenciones o IGTF. No se generó movimiento ni asiento parcial; requiere el flujo fiscal completo.');
        return;
      }
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
    addMovement({
      productId: selectedProduct.id,
      productName: selectedProduct.name,
      productCode: selectedProduct.code,
      date,
      type,
      concept,
      documentRef: documentRef.trim() || `MOV-${Date.now().toString().slice(-6)}`,
      documentType, counterpartyRif: counterpartyRif.trim(), counterpartyName: counterpartyName.trim(), bcvRate: effectiveBcvRate,
      additionalLandedCostsBs: type === 'ENTRADA' ? additionalLandedCostsBs : 0,
      correctionForMovementId: type === 'SALIDA' && concept === 'DEVOLUCION_COMPRA' ? selectedReturnSource?.id : undefined,
      quantity,
      unitCostBs,
      unitCostUsd: Number(unitCostUsd.toFixed(2)),
      totalCostBs,
      totalCostUsd: Number(totalCostUsd.toFixed(2)),
      balanceQty,
      balanceTotalBs,
      balanceTotalUsd: Number(balanceTotalUsd.toFixed(2))
    });
    await waitForPersistence();
    onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el movimiento.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <ArrowLeftRight className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Registrar Movimiento en Kardex</h3>
              <p className="text-xs text-slate-400">Control de Entradas y Salidas de Inventario</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Producto / Artículo *</label>
            <select
              value={selectedProduct?.id || ''}
              onChange={e => { setProductId(e.target.value); setCorrectionMovementId(''); }}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            >
              {companyProducts.map(p => (
                <option key={p.id} value={p.id}>
                  {p.code} - {p.name} (Stock: {p.currentStock} {p.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tipo de Movimiento</label>
              <select
                value={type}
                onChange={e => {
                  const val = e.target.value as any;
                  setType(val);
                  setCorrectionMovementId('');
                  if (val === 'ENTRADA') setConcept('COMPRA');
                  else if (val === 'SALIDA') setConcept('VENTA');
                  else setConcept('AJUSTE');
                }}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="ENTRADA">Entrada (Aumento Stock)</option>
                <option value="SALIDA">Salida (Descargo / Venta)</option>
                <option value="AJUSTE">Ajuste de Inventario Físico</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Concepto</label>
              <select
                value={concept}
                onChange={e => setConcept(e.target.value as any)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                {type === 'ENTRADA' && (
                  <>
                    <option value="COMPRA">Compra Nacional</option>
                    <option value="DEVOLUCION_CLIENTE">Devolución de cliente</option>
                    <option value="INVENTARIO_INICIAL">Inventario Inicial</option>
                  </>
                )}
                {type === 'SALIDA' && (
                  <>
                    <option value="VENTA">Venta de Mercancía</option>
                    <option value="DEVOLUCION_COMPRA">Devolución a proveedor</option>
                    <option value="AUTOCONSUMO">Autoconsumo</option>
                    <option value="MERMA">Merma / Deterioro</option>
                  </>
                )}
                {type === 'AJUSTE' && (
                  <>
                    <option value="AJUSTE">Ajuste Físico</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {type === 'SALIDA' && concept === 'DEVOLUCION_COMPRA' && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-3">
            <div className="font-bold text-amber-950">Conciliación obligatoria de devolución a proveedor</div>
            <p className="text-amber-900">Seleccione la entrada original del Kardex y registre la referencia de la nota de crédito del proveedor. La cantidad se limita a las unidades recibidas menos devoluciones previas; el asiento de salida afecta CxP e inventario. Esto no sustituye el documento fiscal válido.</p>
            <div><label className="block font-semibold text-slate-700 mb-1">Entrada original de compra *</label><select required value={correctionMovementId} onChange={e=>{setCorrectionMovementId(e.target.value);const source=supplierReturnSources.find(m=>m.id===e.target.value);if(source){setUnitCostInput(String(source.unitCostBs));setCounterpartyRif(source.counterpartyRif||'');setCounterpartyName(source.counterpartyName||'');setDocumentType('Nota de crédito proveedor');}}} className="w-full rounded-lg border border-slate-300 p-2"><option value="">Seleccionar factura / entrada de Kardex…</option>{supplierReturnSources.map(m=><option key={m.id} value={m.id}>{m.date} · {m.documentRef} · {m.productCode} · recibidas {m.quantity} · pendientes {m.remaining}</option>)}</select></div>
            {selectedReturnSource && <p className="text-xs text-slate-700">Pendiente máximo: <strong>{selectedReturnSource.remaining}</strong> unidades · costo original: <strong>{formatBs(selectedReturnSource.unitCostBs)}</strong> por unidad.</p>}
            <div><label className="block font-semibold text-slate-700 mb-1">N.º nota de crédito / soporte autorizado *</label><input required minLength={4} value={documentRef} onChange={e=>setDocumentRef(e.target.value)} placeholder="NC proveedor / documento real" className="w-full rounded-lg border border-slate-300 p-2"/></div>
            {selectedProduct.costingMethod === 'PEPS' && <p className="text-rose-700 font-semibold">PEPS: bloqueado hasta identificar el lote de origen.</p>}
          </div>}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tipo y número de documento</label>
              <select value={documentType} onChange={e => setDocumentType(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg">
                <option>Factura de compra</option><option>Factura de venta</option><option>Nota de débito</option><option>Nota de crédito</option><option>Nota de crédito proveedor</option><option>Guía de despacho</option><option>Acta de ajuste</option><option>Inventario inicial</option>
              </select>
            </div>
            <div>
              {usdEnabled ? (
                <>
                  <label className="block font-semibold text-slate-700 mb-1">Tasa BCV histórica (Bs./USD) {rateRequired ? '*' : ''}</label>
                  <input type="text" inputMode="decimal" placeholder={rateRequired ? 'Ej.: 889,67 (obligatoria desde 2018)' : 'Opcional'} value={bcvRateInput} onChange={e => setBcvRateInput(e.target.value)} required={rateRequired} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono" />
                </>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5">
                  <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Moneda del Kardex</span>
                  <span className="block text-xs font-bold text-slate-800">{monetaryRule.currencyLabel} · sin tasa BCV antes de 2018</span>
                </div>
              )}
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">RIF proveedor / cliente</label>
              <input value={counterpartyRif} onChange={e => setCounterpartyRif(e.target.value)} maxLength={20} placeholder="J-12345678-9" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Proveedor / cliente</label>
              <input value={counterpartyName} onChange={e => setCounterpartyName(e.target.value)} maxLength={180} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Fecha</label>
              <input
                type="date"
                required
                value={date}
                onChange={e => setDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">N° Documento Ref.</label>
              <input
                type="text"
                placeholder="FAC-00012, DESP-004"
                value={documentRef}
                onChange={e => setDocumentRef(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Cantidad ({selectedProduct.unit}) *
              </label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={quantity}
                onChange={e => setQuantityInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Costo Unitario (Bs.)</label>
              <input
                type="text"
                inputMode="decimal"
                required
                value={unitCostBs || ''}
                onChange={e => setUnitCostInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          {type === 'ENTRADA' && <div>
            <label className="block font-semibold text-slate-700 mb-1">Fletes y gastos de nacionalización asignados a esta entrada (Bs.)</label>
            <input type="text" inputMode="decimal" value={additionalLandedCostsInput} onChange={e => setAdditionalLandedCostsInput(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono" />
            <p className="mt-1 text-[11px] text-slate-500">Estos costos se distribuyen sobre la cantidad recibida y se capitalizan en el costo unitario del artículo.</p>
          </div>}

          {/* Movement summary pill */}
          <div className="p-3 bg-slate-900 text-white rounded-xl flex items-center justify-between">
            <div>
              <span className="text-[11px] text-slate-400 block">Total estimado del movimiento:</span>
              <span className="font-mono font-bold text-emerald-400 text-sm">
                {formatBs(totalCostBs)}
              </span>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-slate-400 block">Stock Resultante:</span>
              <span className="font-mono font-bold text-white text-sm">
                {balanceQty} {selectedProduct.unit}
              </span>
            </div>
          </div>

          {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</p>}

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition cursor-pointer disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {saving ? "Confirmando SQLite..." : "Procesar Movimiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
