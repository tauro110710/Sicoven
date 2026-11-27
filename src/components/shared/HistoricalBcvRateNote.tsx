import React from 'react';
import { formatDate } from '../../utils/formatters';
import { isBcvRateRequiredForDate } from '../../utils/bcvRatePolicy';
import { historicalBcvRateOriginLabel, type HistoricalBcvRate } from '../../utils/historicalBcvRate';

interface Props {
  /** Fecha contable del registro que se está creando. */
  date: string;
  suggestion?: HistoricalBcvRate;
  /** Tasa que ya tiene el campo; sirve para indicar si la histórica está aplicada. */
  appliedRate?: number;
  /** Si se omite, solo se informa la tasa histórica sin ofrecer aplicarla. */
  onApply?: (rate: number) => void;
  className?: string;
}

const formatRate = (rate: number) => rate.toLocaleString('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8
});

/**
 * Aviso compartido de tasa BCV histórica para los formularios que registran
 * asientos desde 2018. No muestra nada antes del 01/01/2018.
 */
export const HistoricalBcvRateNote: React.FC<Props> = ({ date, suggestion, appliedRate, onApply, className = '' }) => {
  if (!isBcvRateRequiredForDate(date)) return null;

  if (!suggestion) {
    const manualRateApplied = Number.isFinite(appliedRate) && Number(appliedRate) > 0;
    return (
      <p className={`text-[10px] leading-snug ${manualRateApplied ? 'text-slate-500' : 'text-amber-700'} ${className}`}>
        {manualRateApplied
          ? `Tasa ingresada manualmente: no hay una tasa BCV histórica vigente para el ${formatDate(date)}.`
          : `No hay tasa BCV histórica vigente para el ${formatDate(date)}. Ingrese la tasa manualmente o actualice el historial desde Inventario.`}
      </p>
    );
  }

  const applied = Number.isFinite(appliedRate) && Number(appliedRate) > 0 &&
    Math.abs(Number(appliedRate) - suggestion.rate) <= Math.abs(suggestion.rate) * 1e-6;

  return (
    <p className={`text-[10px] leading-snug text-slate-500 ${className}`}>
      Tasa histórica vigente al {formatDate(suggestion.effectiveDate)}: <strong className="font-mono text-slate-700">{formatRate(suggestion.rate)}</strong> Bs./USD
      <span className="text-slate-400"> · {historicalBcvRateOriginLabel(suggestion.origin)}</span>
      {applied
        ? <span className="font-semibold text-emerald-700"> · aplicada al registro</span>
        : onApply && (
          <button
            type="button"
            onClick={() => onApply(suggestion.rate)}
            className="ml-1 font-semibold text-emerald-700 underline hover:text-emerald-900"
          >
            Usar esta tasa
          </button>
        )}
    </p>
  );
};

export default HistoricalBcvRateNote;
