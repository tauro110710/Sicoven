import React, { useEffect, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { Package, X, Check } from 'lucide-react';
import { formatBs, formatUsd } from '../../utils/formatters';
import type { InventoryProduct } from '../../types/accounting';
import { resolveInventoryBcvRate } from '../../types/inventoryBcvRate';
import { calculateInventoryPrices, DEFAULT_INVENTORY_PRICING } from '../../types/inventoryPricing';
import type { InventoryPricingConfiguration } from '../../types/accounting';

interface NewProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: InventoryProduct | null;
}

export const NewProductModal: React.FC<NewProductModalProps> = ({ isOpen, onClose, product = null }) => {
  const { currentCompany, addProduct, updateProduct, accounts, waitForPersistence } = useAccounting();
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Mercancías Generales');
  const [unit, setUnit] = useState('Unidad');
  const [minStockInput, setMinStockInput] = useState('10');
  const minStock = parseDecimalInput(minStockInput);
  const [currentStockInput, setCurrentStockInput] = useState('0');
  const currentStock = parseDecimalInput(currentStockInput);
  const [openingDate, setOpeningDate] = useState(new Date().toISOString().slice(0, 10));
  const [openingBcvRateInput, setOpeningBcvRateInput] = useState('');
  const [avgCostInput, setAvgCostInput] = useState('');
  const [priceCurrency, setPriceCurrency] = useState<'USD' | 'BS'>('USD');
  const [priceInputs, setPriceInputs] = useState(['', '', '', '']);
  const [pricingConfiguration, setPricingConfiguration] = useState<InventoryPricingConfiguration>(DEFAULT_INVENTORY_PRICING);
  const priceValues = priceInputs.map(parseDecimalInput);
  const priceLabels = [currentCompany.inventoryPriceLabels?.price1 || 'Precio 1', currentCompany.inventoryPriceLabels?.price2 || 'Precio 2', currentCompany.inventoryPriceLabels?.price3 || 'Precio 3', currentCompany.inventoryPriceLabels?.price4 || 'Precio 4'];
  const setPriceInput = (index: number, value: string) => setPriceInputs(previous => previous.map((item, i) => i === index ? value : item));
  const [inventoryAccountCode, setInventoryAccountCode] = useState('1.1.4.01');
  const [costOfSalesAccountCode, setCostOfSalesAccountCode] = useState('5.1.1.01');
  const [adjustmentAccountCode, setAdjustmentAccountCode] = useState('5.1.2.01');
  const [openingBalanceAccountCode, setOpeningBalanceAccountCode] = useState('3.3.1.01');
  const [costingMethod, setCostingMethod] = useState<'PROMEDIO_PONDERADO' | 'PEPS'>('PROMEDIO_PONDERADO');
  const [vatTreatment, setVatTreatment] = useState<'GENERAL_16' | 'REDUCIDA_8' | 'EXENTO' | 'EXONERADO'>('GENERAL_16');
  const [itemType, setItemType] = useState<'MERCANCIA' | 'MATERIA_PRIMA' | 'PRODUCTO_EN_PROCESO' | 'PRODUCTO_TERMINADO' | 'SUBPRODUCTO'>('MERCANCIA');
  const [error, setError] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionWorkpaper, setCorrectionWorkpaper] = useState('');

  function parseDecimalInput(value: string) { const raw = value.trim(); if (!raw) return 0; return Number(raw.includes(',') ? raw.split('.').join('').replace(',', '.') : raw); }

  function withoutInventoryExchangeRates(configuration: InventoryPricingConfiguration): InventoryPricingConfiguration {
    const clean = { ...configuration, applyExchangeGap: false };
    delete clean.exchangeRateCurrency;
    delete clean.referenceRate;
    delete clean.replacementRate;
    return clean;
  }

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setCorrectionReason('');
    setCorrectionWorkpaper('');
    if (product) {
      setCode(product.code || ''); setName(product.name || ''); setCategory(product.category || 'Mercancías Generales'); setUnit(product.unit || 'Unidad');
      setMinStockInput(String(product.minStock)); setCurrentStockInput(String(product.currentStock));
      setOpeningDate(product.openingDate || new Date().toISOString().slice(0, 10));
      setOpeningBcvRateInput(String(product.openingBcvRate || ''));
      setAvgCostInput(String(product.avgCostUsd));
      setPricingConfiguration(withoutInventoryExchangeRates(product.pricingConfiguration || DEFAULT_INVENTORY_PRICING));
      const legacyCurrency = product.priceCurrency || 'BS';
      setPriceCurrency(legacyCurrency);
      const legacyPrimary = Number(product.price1 ?? (legacyCurrency === 'USD' ? product.salesPriceUsd : product.salesPriceBs)) || 0;
      setPriceInputs([
        legacyPrimary ? String(legacyPrimary) : '',
        product.price2 == null ? '' : String(product.price2),
        product.price3 == null ? '' : String(product.price3),
        product.price4 == null ? '' : String(product.price4)
      ]);
      setInventoryAccountCode(product.inventoryAccountCode || '1.1.4.01'); setCostOfSalesAccountCode(product.costOfSalesAccountCode || '5.1.1.01');
      setAdjustmentAccountCode(product.adjustmentAccountCode || '5.1.2.01'); setOpeningBalanceAccountCode(product.openingBalanceAccountCode || '3.3.1.01');
      setCostingMethod(product.costingMethod || 'PROMEDIO_PONDERADO'); setVatTreatment(product.vatTreatment || 'GENERAL_16'); setItemType(product.itemType || 'MERCANCIA');
    } else {
      setCode(''); setName(''); setCategory('Mercancías Generales'); setUnit('Unidad');
      setMinStockInput('10'); setCurrentStockInput('0'); setOpeningDate(new Date().toISOString().slice(0, 10));
      setOpeningBcvRateInput(String(currentCompany.inventoryBcvRate || '')); setAvgCostInput(''); setPriceCurrency('USD'); setPriceInputs(['', '', '', '']);
      setPricingConfiguration(withoutInventoryExchangeRates(currentCompany.inventoryPricingDefaults || DEFAULT_INVENTORY_PRICING));
      setInventoryAccountCode('1.1.4.01'); setCostOfSalesAccountCode('5.1.1.01');
      setAdjustmentAccountCode('5.1.2.01'); setOpeningBalanceAccountCode('3.3.1.01');
      setCostingMethod('PROMEDIO_PONDERADO'); setVatTreatment('GENERAL_16'); setItemType('MERCANCIA');
    }
  }, [isOpen, product]);

  useEffect(() => {
    if (!isOpen || product) return;
    const historicalRate = resolveInventoryBcvRate(currentCompany.inventoryBcvRateHistory || [], openingDate);
    if (historicalRate) {
      setOpeningBcvRateInput(String(historicalRate.rate));
    } else if (openingDate === currentCompany.inventoryBcvRateEffectiveDate && currentCompany.inventoryBcvRate) {
      setOpeningBcvRateInput(String(currentCompany.inventoryBcvRate));
    } else {
      setOpeningBcvRateInput('');
    }
  }, [isOpen, product, openingDate, currentCompany.id, currentCompany.inventoryBcvRate, currentCompany.inventoryBcvRateEffectiveDate, currentCompany.inventoryBcvRateHistory]);

  if (!isOpen) return null;

  const bcvRate = parseDecimalInput(openingBcvRateInput);
  const effectivePricingConfiguration = withoutInventoryExchangeRates(pricingConfiguration);
  const avgCostUsd = parseDecimalInput(avgCostInput);
  const avgCostBs = bcvRate > 0 ? Number((avgCostUsd * bcvRate).toFixed(2)) : 0;
  const pricingCalculation = (() => {
    try {
      if (pricingConfiguration.mode === 'AUTOMATIC' && priceCurrency === 'BS') {
        throw new Error('La fijación automática se calcula en USD. Para fijar precios en bolívares, use el modo manual; la tasa BCV se registra en cada factura del Libro de Ventas.');
      }
      return calculateInventoryPrices({ baseCost: avgCostUsd, configuration: effectivePricingConfiguration });
    } catch (error) { return { prices: [0, 0, 0, 0] as [number, number, number, number], exchangeGapPercent: 0, exchangeFactor: 1, error: error instanceof Error ? error.message : 'Configuración de precios inválida.' }; }
  })();
  const effectivePriceValues = pricingConfiguration.mode === 'AUTOMATIC' ? pricingCalculation.prices : priceValues;
  const primaryPrice = effectivePriceValues[0];

  const movementAccounts = accounts.filter(account => account.isMovement);
  const inventoryAccounts = movementAccounts.filter(account => account.type === 'ACTIVO');
  const costAccounts = movementAccounts.filter(account => account.type === 'COSTOS' || account.type === 'GASTOS');
  const equityAccounts = movementAccounts.filter(account => account.type === 'PATRIMONIO');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) { setError('El código y la descripción son obligatorios.'); return; }
    if (pricingConfiguration.mode === 'AUTOMATIC' && (avgCostUsd <= 0 || pricingCalculation.error)) { setError(pricingCalculation.error || 'Ingrese un costo de inventario positivo y su tasa histórica antes de calcular precios automáticos.'); return; }
    if (!product && (currentStock > 0 || avgCostUsd > 0) && (!Number.isFinite(bcvRate) || bcvRate <= 0)) { setError('Ingrese la tasa BCV histórica aplicable al inventario inicial, por ejemplo 889,67.'); return; }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
    if (product) {
      if (correctionReason.trim().length < 10 || correctionWorkpaper.trim().length < 10) {
        throw new Error('La corrección requiere motivo y papel de trabajo de al menos 10 caracteres.');
      }
      await updateProduct({
        ...product,
        code: code.trim().toUpperCase(), name: name.trim().toUpperCase(),
        category: category.trim(), unit: unit.trim(), minStock: Number(minStock) || 0,
        price1: primaryPrice,
        price2: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[1].trim() ? effectivePriceValues[1] : null,
        price3: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[2].trim() ? effectivePriceValues[2] : null,
        price4: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[3].trim() ? effectivePriceValues[3] : null,
        priceCurrency,
        pricingConfiguration: effectivePricingConfiguration,
        salesPriceBs: 0,
        salesPriceUsd: 0,
        vatTreatment
      }, correctionReason, correctionWorkpaper);
    } else {
      addProduct({
        code: code.trim().toUpperCase(),
        name: name.trim().toUpperCase(),
        category: category.trim(),
        unit: unit.trim(),
        minStock: Number(minStock) || 0,
        currentStock: Number(currentStock) || 0,
        avgCostBs: Number(avgCostBs) || 0,
        avgCostUsd,
        lastCostBs: Number(avgCostBs) || 0,
        lastCostUsd: avgCostUsd,
        price1: primaryPrice,
        price2: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[1].trim() ? effectivePriceValues[1] : null,
        price3: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[2].trim() ? effectivePriceValues[2] : null,
        price4: pricingConfiguration.mode === 'AUTOMATIC' || priceInputs[3].trim() ? effectivePriceValues[3] : null,
        priceCurrency,
        pricingConfiguration: effectivePricingConfiguration,
        salesPriceBs: 0,
        salesPriceUsd: 0,
        inventoryAccountCode, costOfSalesAccountCode, adjustmentAccountCode, openingBalanceAccountCode,
        costingMethod, vatTreatment, itemType, openingDate, openingBcvRate: bcvRate
      });
      await waitForPersistence();
    }
    onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear el artículo.');
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
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">{product ? 'Corregir ficha de artículo' : 'Nuevo Artículo de Inventario'}</h3>
              <p className="text-xs text-slate-400">{product ? 'Corrección auditada de datos maestros · sin alterar Kardex ni costo histórico' : 'Control de existencias y costos bajo VEN-NIF NIC 2'}</p>
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Código / SKU *</label>
              <input
                type="text"
                required
                placeholder="ART-001"
                value={code}
                onChange={e => setCode(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg uppercase font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div className="col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Nombre del Producto *</label>
              <input
                type="text"
                required
                placeholder="Descripción completa del artículo..."
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tipo de artículo contable</label>
              <select value={itemType} disabled={Boolean(product)} onChange={e => { const value = e.target.value as typeof itemType; setItemType(value); setInventoryAccountCode(value === 'MATERIA_PRIMA' ? '1.1.4.02' : value === 'PRODUCTO_EN_PROCESO' ? '1.1.4.04' : '1.1.4.01'); }} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                <option value="MERCANCIA">Mercancía</option><option value="MATERIA_PRIMA">Materia prima</option><option value="PRODUCTO_EN_PROCESO">Producto en proceso</option><option value="PRODUCTO_TERMINADO">Producto terminado</option><option value="SUBPRODUCTO">Subproducto</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Método de costeo</label>
              <select value={costingMethod} disabled={Boolean(product)} onChange={e => setCostingMethod(e.target.value as typeof costingMethod)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                <option value="PROMEDIO_PONDERADO">Promedio ponderado</option><option value="PEPS">PEPS / FIFO</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tratamiento IVA</label>
              <select value={vatTreatment} onChange={e => setVatTreatment(e.target.value as typeof vatTreatment)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                <option value="GENERAL_16">General 16%</option><option value="REDUCIDA_8">Reducida 8%</option><option value="EXENTO">Exento</option><option value="EXONERADO">Exonerado</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Cuenta contable de inventario *</label>
              <select required value={inventoryAccountCode} disabled={Boolean(product)} onChange={e => setInventoryAccountCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                {inventoryAccounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Cuenta de costo de ventas/consumo *</label>
              <select required value={costOfSalesAccountCode} disabled={Boolean(product)} onChange={e => setCostOfSalesAccountCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                {costAccounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Cuenta de mermas y ajustes *</label>
              <select required value={adjustmentAccountCode} disabled={Boolean(product)} onChange={e => setAdjustmentAccountCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                {costAccounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>
            {Number(currentStock) > 0 && <div>
              <label className="block font-semibold text-slate-700 mb-1">Contrapartida de apertura *</label>
              <select required value={openingBalanceAccountCode} disabled={Boolean(product)} onChange={e => setOpeningBalanceAccountCode(e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg">
                {equityAccounts.map(a => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
              </select>
            </div>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Categoría</label>
              <input
                type="text"
                placeholder="Alimentos, Repuestos, Insumos..."
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Unidad de Medida</label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="Unidad">Unidad (Unid)</option>
                <option value="Caja">Caja</option>
                <option value="Bulto">Bulto</option>
                <option value="Kilogramo">Kilogramo (Kg)</option>
                <option value="Litro">Litro (Lt)</option>
                <option value="Metro">Metro (Mts)</option>
                <option value="Servicio">Servicio / Licencia</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Fecha del inventario inicial</label>
              <input type="date" required value={openingDate} onChange={e => setOpeningDate(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tasa BCV histórica (Bs./USD) *</label>
              <input type="text" inputMode="decimal" value={openingBcvRateInput} onChange={e => setOpeningBcvRateInput(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Existencia Inicial (Stock)</label>
              <input
                type="text"
                inputMode="decimal"
                value={currentStockInput}
                disabled={Boolean(product)}
                onChange={e => setCurrentStockInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Stock Mínimo de Alerta</label>
              <input
                type="text"
                inputMode="decimal"
                value={minStockInput}
                onChange={e => setMinStockInput(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Costo base unitario de adquisición (USD)</label>
              <input type="text" inputMode="decimal" value={avgCostInput} disabled={Boolean(product)} placeholder="0.00" onChange={e => setAvgCostInput(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none" />
              <span className="text-[11px] text-slate-500 font-mono">Costo histórico calculado en Bs.: {formatBs(avgCostBs)} · Tasa de adquisición: {bcvRate > 0 ? bcvRate.toLocaleString('es-VE') : 'Pendiente'}</span>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Moneda de referencia de los precios</label>
              <select value={priceCurrency} onChange={e => setPriceCurrency(e.target.value as 'USD' | 'BS')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-semibold">
                <option value="USD">USD — Dólares (predeterminado)</option>
                <option value="BS">Bs. — Bolívares</option>
              </select>
              <span className="text-[11px] text-slate-500">La misma moneda aplica a los cuatro niveles.</span>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div><strong className="text-slate-800">Estrategia de precios comerciales</strong><p className="text-[10px] text-slate-500">La regla puede ser distinta por empresa y sobrescribirse por artículo.</p></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label className="block font-semibold text-slate-700">Método de fijación
                <select value={pricingConfiguration.mode} onChange={e => setPricingConfiguration(previous => ({ ...previous, mode: e.target.value as InventoryPricingConfiguration['mode'] }))} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white">
                  <option value="MANUAL">Manual</option><option value="AUTOMATIC">Automático por porcentaje</option>
                </select>
              </label>
              <label className="block font-semibold text-slate-700">Base de cálculo
                <select value={pricingConfiguration.basis} disabled={pricingConfiguration.mode === 'MANUAL'} onChange={e => setPricingConfiguration(previous => ({ ...previous, basis: e.target.value as InventoryPricingConfiguration['basis'] }))} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100">
                  <option value="COST">Markup sobre costo</option><option value="SALE">Margen sobre venta</option>
                </select>
              </label>
            </div>
            {pricingConfiguration.mode === 'AUTOMATIC' && <div className="rounded-lg border border-slate-200 bg-white p-2 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {pricingConfiguration.margins.map((margin, index) => (
                  <label key={index} className="block text-[10px] font-semibold text-slate-700">{priceLabels[index]} · %
                    <input type="number" min="0" max="99.99" step="0.01" value={margin} onChange={e => setPricingConfiguration(previous => ({ ...previous, margins: previous.margins.map((value, i) => i === index ? Number(e.target.value) : value) as InventoryPricingConfiguration['margins'] }))} className="mt-1 w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono" />
                  </label>
                ))}
              </div>
              <p className="text-[10px] text-slate-500">La fijación automática usa el costo base en USD y los márgenes configurados. No se aplican tasas BCV/EUR ni factores de brecha dentro del Inventario.</p>
              {pricingCalculation.error && <p role="alert" className="text-[10px] text-rose-700">{pricingCalculation.error}</p>}
              <p className="text-[10px] text-slate-500">Costo base para el motor comercial: {formatUsd(avgCostUsd)}. El costo histórico y la tasa fiscal/contable no se modifican.</p>
            </div>}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {priceInputs.map((value, index) => {
                const shownValue = pricingConfiguration.mode === 'AUTOMATIC' ? effectivePriceValues[index] : priceValues[index];
                return <div key={index}>
                  <label className="block font-semibold text-slate-700 mb-1">{priceLabels[index]}{index === 0 ? ' *' : ''}</label>
                  <input type="text" inputMode="decimal" required={index === 0} disabled={pricingConfiguration.mode === 'AUTOMATIC'} value={pricingConfiguration.mode === 'AUTOMATIC' ? (shownValue ? shownValue.toFixed(2) : '') : value} placeholder={index === 0 ? '0.00' : 'Opcional'} onChange={e => setPriceInput(index, e.target.value)} className="w-full px-2 py-1.5 border border-slate-300 rounded-lg font-mono font-bold disabled:bg-slate-100" />
                  <span className="block text-[10px] text-slate-500 font-mono mt-1">{pricingConfiguration.mode === 'AUTOMATIC' ? (pricingCalculation.error ? 'No calculado' : 'Calculado en USD') : (value.trim() ? (priceCurrency === 'USD' ? 'USD' : 'Bs.') : 'Sin definir')}</span>
                </div>;
              })}
            </div>
            <p className="text-[10px] text-slate-500">Los cuatro niveles comparten la moneda seleccionada. En modo automático, los importes se calculan en USD; en modo manual se conservan los valores digitados. La tasa BCV de cada venta se registra manualmente en el Libro de Ventas y no depende de una tasa global del Inventario.</p>
          </div>

          {product && <div className="grid gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <label className="block font-semibold text-slate-700">Motivo de la corrección *
              <textarea required minLength={10} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-normal" placeholder="Explique qué dato de la ficha debe corregirse…" />
            </label>
            <label className="block font-semibold text-slate-700">Papel de trabajo / soporte *
              <textarea required minLength={10} value={correctionWorkpaper} onChange={e=>setCorrectionWorkpaper(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-normal" placeholder="Describa el documento, autorización o evidencia que respalda el cambio…" />
            </label>
          </div>}
          {error && <p role="alert" className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-700">{error}</p>}

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
              {saving ? "Confirmando SQLite..." : product ? "Confirmar corrección auditada" : "Crear Artículo"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
