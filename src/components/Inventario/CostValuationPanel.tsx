import React from 'react';
import { formatBs } from '../../utils/formatters';
import type { MonetaryRule } from '../../utils/monetaryPolicy';

interface CostValuationPanelProps {
  rule: MonetaryRule;
  /** Costo unitario en USD (solo desde 2018). */
  usdCostInput: string;
  onUsdCostChange: (value: string) => void;
  /** Costo nominal en bolívares de la fecha contable (solo antes de 2018). */
  historicalBsCostInput: string;
  onHistoricalBsCostChange: (value: string) => void;
  /** Costo histórico en Bs. ya resuelto para mostrar al contador. */
  historicalCostBs: number;
  bcvRate: number;
  priceCurrency: 'USD' | 'BS';
  onPriceCurrencyChange: (value: 'USD' | 'BS') => void;
  disabled?: boolean;
}

/**
 * Bloque separado de valoración del inventario. Concentra la lógica monetaria
 * del costo: antes de 2018 el costo es nominal en bolívares y no se muestra ni
 * se calcula ningún equivalente en dólares; desde 2018 se parte del costo USD y
 * su tasa BCV histórica.
 */
export const CostValuationPanel: React.FC<CostValuationPanelProps> = ({
  rule,
  usdCostInput,
  onUsdCostChange,
  historicalBsCostInput,
  onHistoricalBsCostChange,
  historicalCostBs,
  bcvRate,
  priceCurrency,
  onPriceCurrencyChange,
  disabled = false
}) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <strong className="text-slate-800">Valoración del costo</strong>
        <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">{rule.currencyLabel}</span>
      </div>
      {rule.allowsUsd ? (
        <>
          <label className="block font-semibold text-slate-700 mb-1">Costo base unitario de adquisición (USD)</label>
          <input type="text" inputMode="decimal" value={usdCostInput} disabled={disabled} placeholder="0.00" onChange={e => onUsdCostChange(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white disabled:bg-slate-100" />
          <span className="mt-1 block text-[11px] text-slate-500 font-mono">Costo histórico en Bs.: {formatBs(historicalCostBs)} · Tasa de adquisición: {bcvRate > 0 ? bcvRate.toLocaleString('es-VE') : 'Pendiente'}</span>
        </>
      ) : (
        <>
          <label className="block font-semibold text-slate-700 mb-1">Costo histórico unitario de adquisición (Bs.)</label>
          <input type="text" inputMode="decimal" value={historicalBsCostInput} disabled={disabled} placeholder="0,00" onChange={e => onHistoricalBsCostChange(e.target.value)} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none bg-white disabled:bg-slate-100" />
          <span className="mt-1 block text-[11px] text-slate-500">Valoración nominal en {rule.currencyLabel}; no se calcula equivalente USD antes de 2018.</span>
        </>
      )}
    </div>
    <div>
      <label className="block font-semibold text-slate-700 mb-1">Moneda de referencia de los precios</label>
      <select value={priceCurrency} onChange={e => onPriceCurrencyChange(e.target.value as 'USD' | 'BS')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-semibold bg-white">
        {rule.allowsUsd && <option value="USD">USD — Dólares (predeterminado)</option>}
        <option value="BS">Bs. — Bolívares</option>
      </select>
      <span className="text-[11px] text-slate-500">La misma moneda aplica a los cuatro niveles.</span>
    </div>
  </div>
);
