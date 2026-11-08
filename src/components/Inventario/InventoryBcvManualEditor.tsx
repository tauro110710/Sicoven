import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { appendDailyInventoryBcvRate, resolveInventoryBcvRate } from '../../types/inventoryBcvRate';

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  return new Date(now.getTime() - offset * 60_000).toISOString().slice(0, 10);
}

export const InventoryBcvManualEditor: React.FC = () => {
  const { currentCompany, updateCompany, waitForPersistence, isStorageReady } = useAccounting();
  const [open, setOpen] = useState(false);
  const [rateInput, setRateInput] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(localIsoDate());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const history = currentCompany.inventoryBcvRateHistory || [];
  const sameDayEntry = useMemo(
    () => resolveInventoryBcvRate(history, effectiveDate),
    [history, effectiveDate]
  );

  const saveManualRate = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    const rate = Number(rateInput.replace(',', '.'));
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1_000_000_000) {
      setError('Introduzca una tasa numérica mayor que cero.');
      return;
    }
    const parsedEffectiveDate = new Date(effectiveDate + 'T00:00:00.000Z');
    if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(effectiveDate) ||
        !Number.isFinite(parsedEffectiveDate.getTime()) ||
        parsedEffectiveDate.toISOString().slice(0, 10) !== effectiveDate) {
      setError('Seleccione una fecha válida.');
      return;
    }
    if (effectiveDate > localIsoDate()) {
      setError('La fecha de vigencia no puede ser futura.');
      return;
    }
    if (sameDayEntry && note.trim().length < 5) {
      setError('Para corregir una tasa ya registrada, indique el motivo de la corrección (mínimo 5 caracteres).');
      return;
    }
    if (!isStorageReady || !window.sicovenStore?.save) {
      setError('La base SQLite local no está disponible. No se guardó ningún cambio.');
      return;
    }
    setSaving(true);
    try {
      const fetchedAt = new Date().toISOString();
      const nextHistory = appendDailyInventoryBcvRate(history, {
        rate: Math.round(rate * 10_000) / 10_000,
        effectiveDate,
        fetchedAt,
        source: 'Registro manual en SICOVEN de escritorio',
        provider: 'manual',
        mode: 'MANUAL',
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(sameDayEntry ? { correctionOfId: sameDayEntry.id } : {})
      });
      const latestForDate = resolveInventoryBcvRate(nextHistory, effectiveDate);
      const shouldUpdateCurrent = !currentCompany.inventoryBcvRateEffectiveDate ||
        effectiveDate >= currentCompany.inventoryBcvRateEffectiveDate;
      updateCompany({
        ...currentCompany,
        inventoryBcvRateHistory: nextHistory,
        ...(shouldUpdateCurrent && latestForDate ? {
          inventoryBcvRate: latestForDate.rate,
          inventoryBcvRateEffectiveDate: latestForDate.effectiveDate,
          inventoryBcvRateFetchedAt: latestForDate.fetchedAt
        } : {})
      });
      await waitForPersistence();
      setRateInput('');
      setNote('');
      setOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No se pudo guardar la tasa en SQLite.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3">
      <button type="button" onClick={() => { setOpen(value => !value); setError(''); }}
        className="rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100">
        {open ? 'Cancelar tasa manual' : 'Ingresar / corregir tasa manual'}
      </button>
      {open && (
        <form onSubmit={saveManualRate} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-sky-200 bg-white p-3">
          <label className="text-xs font-semibold text-slate-700">
            Tasa BCV (Bs. por USD)
            <input type="text" inputMode="decimal" value={rateInput} onChange={event => setRateInput(event.target.value)}
              placeholder="Ej. 892,4500" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm" required />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Fecha de vigencia
            <input type="date" value={effectiveDate} max={localIsoDate()} onChange={event => setEffectiveDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" required />
          </label>
          {sameDayEntry && (
            <div className="sm:col-span-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900">
              Ya existe una tasa para esta fecha ({sameDayEntry.rate.toLocaleString('es-VE')} Bs/USD, {sameDayEntry.mode === 'MANUAL' ? 'manual' : 'automática'}). La nueva tasa se guardará como corrección; el registro anterior se conservará.
            </div>
          )}
          <label className="sm:col-span-2 text-xs font-semibold text-slate-700">
            Motivo / observación {sameDayEntry ? '(obligatorio para corregir)' : '(opcional)'}
            <input type="text" value={note} onChange={event => setNote(event.target.value)}
              placeholder="Ej. Tasa verificada en publicación oficial del BCV"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          {error && <p className="sm:col-span-2 text-xs font-medium text-red-700">{error}</p>}
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={saving || !isStorageReady}
              className="rounded-lg bg-sky-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
              {saving ? 'Guardando en SQLite…' : 'Guardar tasa manual'}
            </button>
          </div>
          <p className="sm:col-span-2 text-[11px] text-slate-500">
            Se guarda localmente en SQLite. La tasa manual prevalece para esa fecha y no será reemplazada por la consulta automática.
          </p>
        </form>
      )}
    </div>
  );
};
