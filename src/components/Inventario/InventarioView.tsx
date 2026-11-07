import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import {
  Package,
  Plus,
  ArrowLeftRight,
  Printer,
  Search,
  AlertTriangle,
  CheckCircle2,
  Boxes,
  FileSpreadsheet,
  ArrowUpRight,
  ArrowDownRight,
  Pencil
} from 'lucide-react';
import { formatBs, formatUsd, formatDate } from '../../utils/formatters';
import type { InventoryProduct } from '../../types/accounting';
import { NewProductModal } from './NewProductModal';
import { NewMovementModal } from './NewMovementModal';
import { CompanyLogoHeader } from '../CompanyLogoHeader';
import { filterEntriesByCompany } from '../../types/accountingReportIntegrity';
import { InventarioContableTools } from './InventarioContableTools';
import { IntelligentMigrationWizard } from '../Migracion/IntelligentMigrationWizard';
import { fetchInventoryBcvRate } from '../../services/inventoryBcvService';
import { appendDailyInventoryBcvRate } from '../../types/inventoryBcvRate';

export const InventarioView: React.FC = () => {
  const { currentCompany, products: allProducts, movements: allMovements, updateCompany, waitForPersistence, isStorageReady } = useAccounting();
  const [bcvSyncStatus, setBcvSyncStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [bcvSyncMessage, setBcvSyncMessage] = useState('Consultando tasa BCV para Inventario…');
  const [showBcvHistory, setShowBcvHistory] = useState(false);
  const currentCompanyRef = useRef(currentCompany);
  const updateCompanyRef = useRef(updateCompany);
  const waitForPersistenceRef = useRef(waitForPersistence);
  useEffect(() => { currentCompanyRef.current = currentCompany; updateCompanyRef.current = updateCompany; waitForPersistenceRef.current = waitForPersistence; }, [currentCompany, updateCompany, waitForPersistence]);
  const bcvHistory = useMemo(() => [...(currentCompany.inventoryBcvRateHistory || [])].sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate)), [currentCompany.inventoryBcvRateHistory]);

  useEffect(() => {
    if (!isStorageReady) return;
    let active = true;
    let running = false;
    const syncInventoryRate = async () => {
      if (running) return;
      running = true;
      try {
        const result = await fetchInventoryBcvRate();
        if (!active) return;
        const company = currentCompanyRef.current;
        const history = company.inventoryBcvRateHistory || [];
        const latestSavedDate = history.reduce((latest, entry) => entry.effectiveDate > latest ? entry.effectiveDate : latest, company.inventoryBcvRateEffectiveDate || '');
        if (latestSavedDate && result.effectiveDate < latestSavedDate) {
          throw new Error('La fuente BCV devolvió una fecha anterior a la última tasa guardada. Se conserva el valor vigente y no se altera el historial.');
        }
        const savedForDate = history.find(entry => entry.effectiveDate === result.effectiveDate);
        const nextHistory = savedForDate ? history : appendDailyInventoryBcvRate(history, {
          rate: result.rate,
          effectiveDate: result.effectiveDate,
          fetchedAt: result.updatedAt,
          source: result.sourceUrl,
          provider: result.provider,
          mode: 'AUTOMATIC'
        });
        const effectiveRate = savedForDate?.rate ?? result.rate;
        const effectiveFetchedAt = savedForDate?.fetchedAt ?? result.updatedAt;
        const needsSave = company.inventoryBcvRate !== effectiveRate ||
          company.inventoryBcvRateEffectiveDate !== result.effectiveDate ||
          !savedForDate;
        if (needsSave) {
          if (!window.sicovenStore?.save) throw new Error('La actualización automática requiere SICOVEN de escritorio con SQLite disponible.');
          updateCompanyRef.current({
            ...company,
            inventoryBcvRate: effectiveRate,
            inventoryBcvRateEffectiveDate: result.effectiveDate,
            inventoryBcvRateFetchedAt: effectiveFetchedAt,
            inventoryBcvRateHistory: nextHistory
          });
          await waitForPersistenceRef.current();
        }
        if (active) {
          setBcvSyncStatus('ready');
          setBcvSyncMessage(savedForDate
            ? 'Tasa diaria ya registrada; se conserva el historial.'
            : 'Tasa consultada y guardada en el historial de Inventario.');
        }
      } catch (error) {
        if (active) {
          setBcvSyncStatus('error');
          setBcvSyncMessage(error instanceof Error ? error.message : 'No se pudo actualizar la tasa BCV.');
        }
      } finally { running = false; }
    };
    void syncInventoryRate();
    const interval = window.setInterval(() => { void syncInventoryRate(); }, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [currentCompany.id, isStorageReady]);
  const companyProducts = filterEntriesByCompany(allProducts, currentCompany.id);
  const companyMovements = filterEntriesByCompany(allMovements, currentCompany.id);

  const [activeTab, setActiveTab] = useState<'EXISTENCIAS' | 'KARDEX' | 'CONTABILIDAD'>('EXISTENCIAS');
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productToEdit, setProductToEdit] = useState<InventoryProduct | null>(null);
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [isMigrationWizardOpen, setIsMigrationWizardOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('ALL');
  const effectiveSelectedProductId = companyProducts.some(product => product.id === selectedProductId) ? selectedProductId : 'ALL';

  // Filter companyProducts
  const filteredProducts = companyProducts.filter(p => {
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      return (
        p.code.toLowerCase().includes(term) ||
        p.name.toLowerCase().includes(term) ||
        p.category.toLowerCase().includes(term)
      );
    }
    return true;
  });

  // Filter companyMovements
  const filteredMovements = companyMovements
    .filter(m => {
      if (effectiveSelectedProductId !== 'ALL' && m.productId !== effectiveSelectedProductId) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        return (
          m.productName.toLowerCase().includes(term) ||
          m.productCode.toLowerCase().includes(term) ||
          m.documentRef.toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  // Valuations
  const totalInventoryValueBs = companyProducts.reduce(
    (sum, p) => sum + Math.max(0, p.currentStock * p.avgCostBs - Number(p.vnrProvisionBs || 0)),
    0
  );
  const inventoryBcvRate = Number(currentCompany.inventoryBcvRate || 0);
  const totalInventoryValueUsd = inventoryBcvRate > 0 ? companyProducts.reduce(
    (sum, p) => sum + Math.max(0, p.currentStock * p.avgCostUsd - Number(p.vnrProvisionBs || 0) / inventoryBcvRate),
    0
  ) : null;
  const lowStockCount = companyProducts.filter(p => p.currentStock <= p.minStock).length;

  return (
    <div className="space-y-6">
      {/* Official Header with Company Logo */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 print:border-none print:shadow-none print:p-0">
        <CompanyLogoHeader
          company={currentCompany}
          reportTitle="Control de Inventarios y Kardex Valorado"
          subtitle="Valuación por Método de Costo Promedio Ponderado bajo Normas VEN-NIF NIC 2"
          periodText={`Al ${new Date().toLocaleDateString('es-VE')}`}
        />

        {/* Action buttons (hidden on print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 no-print border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Artículos: <strong className="text-slate-900">{companyProducts.length}</strong></span>
            <span>•</span>
            <span className="text-emerald-700 font-medium">Kardex Perpetuo Activo</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button onClick={() => setIsMigrationWizardOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-100"><FileSpreadsheet className="h-3.5 w-3.5" />Migración inteligente</button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer border border-slate-300"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir
            </button>
            <button
              onClick={() => setIsMovementModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-xl transition cursor-pointer border border-emerald-200"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
              Nuevo Movimiento
            </button>
            <button
              onClick={() => { setProductToEdit(null); setIsProductModalOpen(true); }}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition shadow cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Crear Artículo
            </button>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/70 p-4 no-print">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wide text-sky-900">Tasa BCV de Inventario</div>
              <div className="mt-1 text-xl font-bold font-mono text-slate-900">
                {currentCompany.inventoryBcvRate ? formatBs(currentCompany.inventoryBcvRate) : 'Sin tasa registrada'}
                <span className="ml-2 text-xs font-semibold text-slate-500">por USD</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-600">
                Vigencia: {currentCompany.inventoryBcvRateEffectiveDate || 'Pendiente'} · Fuente: bcv.today
              </div>
              <div className={`mt-1 text-[11px] ${bcvSyncStatus === 'error' ? 'text-amber-800' : 'text-sky-800'}`}>
                {bcvSyncMessage}
              </div>
            </div>
            <button type="button" onClick={() => setShowBcvHistory(value => !value)} className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100">
              {showBcvHistory ? 'Ocultar historial' : `Historial diario (${bcvHistory.length})`}
            </button>
          </div>
          {showBcvHistory && (
            <div className="mt-3 overflow-x-auto rounded-lg border border-sky-100 bg-white">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="p-2">Fecha valor</th><th className="p-2 text-right">Bs./USD</th><th className="p-2">Tipo</th><th className="p-2">Consultada</th></tr></thead>
                <tbody>{bcvHistory.map(entry => <tr key={entry.id} className="border-t border-slate-100"><td className="p-2">{entry.effectiveDate}</td><td className="p-2 text-right font-mono">{entry.rate.toLocaleString('es-VE',{minimumFractionDigits:4,maximumFractionDigits:4})}</td><td className="p-2">{entry.mode === 'AUTOMATIC' ? 'Automática' : 'Manual'}</td><td className="p-2">{new Date(entry.fetchedAt).toLocaleString('es-VE')}</td></tr>)}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Inventory Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
              Valoración Total del Inventario
            </span>
            <div className="text-lg font-bold font-mono text-emerald-700 mt-1">
              {formatBs(totalInventoryValueBs)}
            </div>
            <div className="text-xs font-mono text-slate-500">
              {totalInventoryValueUsd === null ? 'Equivalente USD no disponible: falta tasa de Inventario' : formatUsd(totalInventoryValueUsd)}
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
              Artículos en Catálogo
            </span>
            <div className="text-lg font-bold text-slate-900 mt-1">
              {companyProducts.length} productos
            </div>
            <div className="text-xs text-slate-500">
              {companyMovements.length} movimientos registrados en Kardex
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
              Alertas de Stock
            </span>
            <div className={`text-lg font-bold mt-1 flex items-center gap-1.5 ${
              lowStockCount > 0 ? 'text-amber-600' : 'text-emerald-600'
            }`}>
              {lowStockCount > 0 ? (
                <>
                  <AlertTriangle className="w-4 h-4" />
                  {lowStockCount} artículos bajo mínimo
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Stock óptimo en todos los artículos
                </>
              )}
            </div>
            <div className="text-xs text-slate-500">
              Supervisión de reposición
            </div>
          </div>
        </div>

        {/* View Switcher & Search (no-print) */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-6 border-t border-slate-200 mt-6 no-print">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setActiveTab('EXISTENCIAS')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'EXISTENCIAS'
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Catálogo de Existencias ({companyProducts.length})
            </button>
            <button
              onClick={() => setActiveTab('KARDEX')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                activeTab === 'KARDEX'
                  ? 'bg-slate-900 text-white shadow'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              Kardex de Movimientos ({companyMovements.length})
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Buscar artículo o código..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>

            <button onClick={() => setActiveTab('CONTABILIDAD')} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 hover:bg-indigo-100">Herramientas contables</button>

            {activeTab === 'KARDEX' && (
              <select
                value={effectiveSelectedProductId}
                onChange={e => setSelectedProductId(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="ALL">Todos los Artículos</option>
                {companyProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.code} - {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {activeTab === 'CONTABILIDAD' && <InventarioContableTools />}

      {/* 1. Existencias Table */}
      {activeTab === 'EXISTENCIAS' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold whitespace-nowrap">
                  <th className="py-2.5 px-4 w-28">Código SKU</th>
                  <th className="py-2.5 px-4">Descripción del Artículo</th>
                  <th className="py-2.5 px-4 w-32">Categoría</th>
                  <th className="py-2.5 px-3 w-20 text-center">Unidad</th>
                  <th className="py-2.5 px-4 text-right w-24">Existencia</th>
                  <th className="py-2.5 px-4 text-right w-32">Costo Promedio (Bs. / USD)</th>
                  <th className="py-2.5 px-4 text-right w-32">Precio Venta (Bs. / USD)</th>
                  <th className="py-2.5 px-4 text-right w-36">Valoración Total (Bs. / USD)</th>
                  <th className="py-2.5 px-3 text-center w-28">Estado Stock</th>
                  <th className="py-2.5 px-3 text-center w-24">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      No hay artículos de inventario registrados.
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map(prod => {
                    const totalValBs = Math.max(0, prod.currentStock * prod.avgCostBs - Number(prod.vnrProvisionBs || 0));
                    const totalValUsd = Math.max(0, prod.currentStock * prod.avgCostUsd - Number(prod.vnrProvisionBs || 0) / Math.max(Number(currentCompany.bcvRate || 0), 0.000001));
                    const isLow = prod.currentStock <= prod.minStock;

                    return (
                      <tr key={prod.id} className="hover:bg-slate-50 transition">
                        <td className="py-2.5 px-4 font-mono font-bold text-slate-800">
                          {prod.code}
                        </td>
                        <td className="py-2.5 px-4 font-medium text-slate-900">
                          {prod.name}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">
                          {prod.category}
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-600 font-medium">
                          {prod.unit}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-bold text-slate-900">
                          {prod.currentStock}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-slate-800">
                          {formatBs(prod.avgCostBs)}
                          {true && (
                            <span className="block text-[10px] text-slate-400">{formatUsd(prod.avgCostUsd)}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-semibold text-emerald-700">
                          {formatBs(prod.salesPriceBs)}
                          {true && (
                            <span className="block text-[10px] text-emerald-600/70">{formatUsd(prod.salesPriceUsd)}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono font-black text-slate-900 bg-slate-50/50">
                          {formatBs(totalValBs)}
                          {true && (
                            <span className="block text-[10px] text-slate-400 font-normal">{formatUsd(totalValUsd)}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {isLow ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                              <AlertTriangle className="w-3 h-3" />
                              Bajo Mínimo ({prod.minStock})
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-300">
                              Normal
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <button type="button" onClick={() => { setProductToEdit(prod); setIsProductModalOpen(true); }}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-100">
                            <Pencil className="h-3 w-3" /> Corregir
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. Kardex Table */}
      {activeTab === 'KARDEX' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold whitespace-nowrap">
                  <th className="py-2.5 px-4 w-24">Fecha</th>
                  <th className="py-2.5 px-4 w-28">Código</th>
                  <th className="py-2.5 px-4">Artículo</th>
                  <th className="py-2.5 px-3 w-28 text-center">Tipo</th>
                  <th className="py-2.5 px-3 w-28">Concepto</th>
                  <th className="py-2.5 px-3 w-28">Documento Ref.</th>
                  <th className="py-2.5 px-4 text-right w-24">Cantidad</th>
                  <th className="py-2.5 px-4 text-right w-28">Costo Unit. (Bs.)</th>
                  <th className="py-2.5 px-4 text-right w-32">Total Movimiento</th>
                  <th className="py-2.5 px-4 text-right w-28 font-bold">Saldo Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMovements.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      No hay movimientos de kardex registrados.
                    </td>
                  </tr>
                ) : (
                  filteredMovements.map(mov => {
                    const isEntrada = mov.type === 'ENTRADA';
                    const isSalida = mov.type === 'SALIDA';

                    return (
                      <tr key={mov.id} className="hover:bg-slate-50 transition">
                        <td className="py-2 px-4 font-mono text-slate-600 whitespace-nowrap">
                          {formatDate(mov.date)}
                        </td>
                        <td className="py-2 px-4 font-mono font-medium text-slate-700">
                          {mov.productCode}
                        </td>
                        <td className="py-2 px-4 font-medium text-slate-900 truncate max-w-xs">
                          {mov.productName}
                        </td>
                        <td className="py-2 px-3 text-center">
                          {isEntrada ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                              <ArrowDownRight className="w-3 h-3" />
                              Entrada
                            </span>
                          ) : isSalida ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                              <ArrowUpRight className="w-3 h-3" />
                              Salida
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800">
                              Ajuste
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-slate-700 font-medium">
                          {mov.concept}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-600">
                          {mov.documentRef}
                        </td>
                        <td className={`py-2 px-4 text-right font-mono font-bold ${
                          isEntrada ? 'text-emerald-700' : isSalida ? 'text-rose-700' : 'text-slate-800'
                        }`}>
                          {isEntrada ? `+${mov.quantity}` : isSalida ? `-${mov.quantity}` : mov.quantity}
                        </td>
                        <td className="py-2 px-4 text-right font-mono text-slate-700">
                          {formatBs(mov.unitCostBs)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-slate-900">
                          {formatBs(mov.totalCostBs)}
                        </td>
                        <td className="py-2 px-4 text-right font-mono font-bold text-slate-900 bg-slate-50/50">
                          {mov.balanceQty}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modals */}
      <NewProductModal isOpen={isProductModalOpen} product={productToEdit} onClose={() => { setIsProductModalOpen(false); setProductToEdit(null); }} />
      <NewMovementModal isOpen={isMovementModalOpen} onClose={() => setIsMovementModalOpen(false)} />
      {isMigrationWizardOpen && <IntelligentMigrationWizard onClose={() => setIsMigrationWizardOpen(false)} />}
    </div>
  );
};
