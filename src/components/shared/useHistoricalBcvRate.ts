import { useEffect, useMemo, useRef } from 'react';
import { getReglaMonetariaPorFecha } from '../../utils/monetaryPolicy';
import {
  resolveHistoricalBcvRate,
  type HistoricalBcvRate,
  type HistoricalBcvRateCompany
} from '../../utils/historicalBcvRate';

export interface HistoricalBcvRateFieldInput {
  /** Fecha contable a la que debe corresponder la tasa. */
  date: string;
  /** Fecha usada en la evaluación anterior; null en el primer render. */
  previousDate: string | null;
  /** Valor actual del campo. */
  value: string;
  /** Si la operación admite tasa BCV (desde 2018). */
  usdEnabled: boolean;
  suggestion?: HistoricalBcvRate;
  /** Si es true, no se pisa una tasa escrita manualmente al cambiar el historial. */
  preserveManualEdit: boolean;
  /** Respaldo cuando no existe tasa histórica. */
  fallbackRate?: number;
  /** Formato del valor escrito en el campo; por defecto, punto decimal. */
  format?: (rate: number) => string;
}

/**
 * Decide el próximo valor del campo de tasa. Devuelve null cuando no hay nada
 * que cambiar. Es una función pura para poder probar la regla sin montar React.
 *
 * Al cambiar la fecha siempre se vuelve a sugerir. Si solo cambia el historial,
 * una tasa escrita manualmente se conserva (`preserveManualEdit`).
 */
export function nextHistoricalBcvRateFieldValue({
  date,
  previousDate,
  value,
  usdEnabled,
  suggestion,
  preserveManualEdit,
  fallbackRate,
  format
}: HistoricalBcvRateFieldInput): string | null {
  if (!usdEnabled) return value.trim() ? '' : null;

  const dateChanged = previousDate !== date;
  if (preserveManualEdit && !dateChanged && value.trim()) return null;

  const nextRate = suggestion?.rate ?? fallbackRate;
  const nextValue = Number.isFinite(nextRate) && Number(nextRate) > 0
    ? (format ? format(Number(nextRate)) : String(nextRate))
    : '';

  return nextValue === value ? null : nextValue;
}

interface Options {
  /** Empresa con los historiales contable y de Inventario. */
  company: (HistoricalBcvRateCompany & { id?: string }) | null | undefined;
  /** Fecha contable a la que debe corresponder la tasa. */
  date: string;
  /** Valor actual del campo controlado por el formulario. */
  value: string;
  /** Setter del campo de tasa. */
  onValueChange: (value: string) => void;
  /**
   * Fuerza el modo de la operación. Si se omite, la regla monetaria de la
   * fecha decide si se admite tasa BCV (desde 2018).
   */
  enabled?: boolean;
  /**
   * Si es true (por defecto), una actualización del historial no pisa una tasa
   * escrita manualmente. Al cambiar la fecha siempre se vuelve a sugerir.
   */
  preserveManualEdit?: boolean;
  /** Respaldo cuando no existe tasa histórica (p. ej. la tasa de la factura original). */
  fallbackRate?: number;
  /** Formato del valor escrito en el campo; por defecto, punto decimal. */
  format?: (rate: number) => string;
}

/**
 * Autocompleta la tasa BCV histórica de un formulario contable.
 *
 * Reglas:
 * - Solo sugiere desde el 01/01/2018; antes limpia el campo.
 * - Al cambiar la fecha (o al montar) aplica la tasa vigente más reciente.
 * - Si no hay tasa registrada, deja el campo vacío; nunca inventa un valor.
 * - No sobrescribe una tasa manual cuando solo cambia el historial.
 *
 * Devuelve la sugerencia histórica para que el formulario muestre su origen
 * y su fecha de vigencia.
 */
export function useHistoricalBcvRate({
  company,
  date,
  value,
  onValueChange,
  enabled,
  preserveManualEdit = true,
  fallbackRate,
  format
}: Options): HistoricalBcvRate | undefined {
  const usdEnabled = enabled ?? getReglaMonetariaPorFecha(date).allowsUsd;

  const suggestion = useMemo(
    () => (usdEnabled ? resolveHistoricalBcvRate(company, date) : undefined),
    [usdEnabled, company?.id, company?.accountingBcvRateHistory, company?.inventoryBcvRateHistory, date]
  );

  // Los refs evitan que el efecto se vuelva a ejecutar por cambios de valor,
  // de identidad del setter o del formateador.
  const valueRef = useRef(value);
  valueRef.current = value;
  const onValueChangeRef = useRef(onValueChange);
  onValueChangeRef.current = onValueChange;
  const formatRef = useRef(format);
  formatRef.current = format;
  const fallbackRateRef = useRef(fallbackRate);
  fallbackRateRef.current = fallbackRate;
  const lastDateRef = useRef<string | null>(null);

  useEffect(() => {
    const nextValue = nextHistoricalBcvRateFieldValue({
      date,
      previousDate: lastDateRef.current,
      value: valueRef.current,
      usdEnabled,
      suggestion,
      preserveManualEdit,
      fallbackRate: fallbackRateRef.current,
      format: formatRef.current
    });
    lastDateRef.current = date;
    if (nextValue !== null) onValueChangeRef.current(nextValue);
  }, [date, usdEnabled, preserveManualEdit, suggestion, fallbackRate]);

  return suggestion;
}
