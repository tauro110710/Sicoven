import React, { useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { HistoricalAccountingReplayPlan } from '../../types/historicalAccountingReplayPlan';

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? value + 'T00:00:00' : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-VE');
};

export const HistoricalAccountingReplayPanel: React.FC = () => {
  const { currentCompany, prepareHistoricalAccountingReplayPlan, isStorageReady } = useAccounting();
  const [startDate, setStartDate] = useState('2026-01-01');
  const [throughDate, setThroughDate] = useState('');
  const [plan, setPlan] = useState<HistoricalAccountingReplayPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setPlan(null);
    setError('');
  }, [currentCompany.id]);

  const reviewPlan = () => {
    setBusy(true);
    setError('');
    try {
      const result = prepareHistoricalAccountingReplayPlan(startDate, throughDate || undefined);
      setPlan(result);
    } catch (cause) {
      setPlan(null);
      setError(cause instanceof Error ? cause.message : 'No se pudo preparar el plan de revisión histórica.');
    } finally {
      setBusy(false);
    }
  };

  const blockers = plan?.blockers || [];
  const warnings = plan?.warnings || [];
  const sourceEvents = plan?.sourceEvents || [];

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5 shadow-sm space-y-4">
      <div className="flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-violet-700" />
        <h2 className="font-bold text-slate-900">Revisión de reconstrucción contable histórica</h2>
      </div>
      <p className="text-sm text-slate-700">
        Examina las operaciones y dependencias reales de la empresa seleccionada, ordenadas por fecha efectiva.
        Este análisis es de solo lectura: no modifica documentos, asientos, impuestos, inventario, cierres ni SQLite.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium text-slate-700">
          Desde
          <input type="date" value={startDate} onChange={event => setStartDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
        </label>
        <label className="text-sm font-medium text-slate-700">
          Hasta (opcional)
          <input type="date" value={throughDate} min={startDate || undefined}
            onChange={event => setThroughDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
          <span className="mt-1 block text-xs font-normal text-slate-500">Si se deja vacío, el motor toma como límite el último asiento contable registrado.</span>
        </label>
      </div>
      <button type="button" onClick={reviewPlan} disabled={!isStorageReady || busy || !startDate || Boolean(throughDate && throughDate < startDate)}
        className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">
        {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
        {busy ? 'Analizando registros…' : 'Generar plan de revisión'}
      </button>
      {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
      {plan && <>
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Empresa analizada</p>
              <p className="font-bold text-slate-900">{currentCompany.name}</p>
              <p className="text-xs text-slate-500">{formatDate(plan.startDate)} — {formatDate(plan.throughDate)}</p>
            </div>
            <span className={'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold ' + (blockers.length ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800')}>
              {blockers.length ? <AlertTriangle className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              {blockers.length ? 'Revisión bloqueada' : 'Sin bloqueos detectados'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Operaciones fuente</span><strong className="block text-xl text-slate-900">{sourceEvents.length}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Asientos derivados</span><strong className="block text-xl text-slate-900">{plan.derivedJournalEntryIds.length}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Ejercicios afectados</span><strong className="block text-xl text-slate-900">{plan.affectedExercises.length}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="text-xs text-slate-500">Dependencias externas</span><strong className="block text-xl text-slate-900">{plan.externalDependencies.length}</strong></div>
          </div>
          <p className="text-xs text-slate-600">Resultado técnico: {plan.mode}. {plan.canProceedToTransactionalReplay && blockers.length === 0
            ? 'El plan no encontró bloqueos conocidos para continuar con una etapa posterior de diseño y validación.'
            : 'No debe avanzarse a una ejecución transaccional hasta resolver los bloqueos y validar las dependencias.'}
            {' '}Este resultado no ejecuta ni autoriza por sí solo una reconstrucción.</p>
        </div>

        {blockers.length > 0 && <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <h3 className="font-bold text-rose-900">Bloqueos que requieren corrección ({blockers.length})</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-800">{blockers.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
        {warnings.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="font-bold text-amber-900">Advertencias ({warnings.length})</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{warnings.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
        {plan.affectedExercises.length > 0 && <div className="space-y-2">
          <h3 className="font-bold text-slate-900">Ejercicios contables afectados</h3>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-100 text-xs uppercase text-slate-600"><tr><th className="px-3 py-2">Ejercicio</th><th className="px-3 py-2">Inicio</th><th className="px-3 py-2">Cierre</th><th className="px-3 py-2">Cierre anual</th><th className="px-3 py-2">Apertura siguiente</th></tr></thead>
              <tbody>{plan.affectedExercises.map(exercise => <tr key={exercise.fiscalYear} className="border-t border-slate-100">
                <td className="px-3 py-2 font-semibold">{exercise.fiscalYear}</td><td className="px-3 py-2">{formatDate(exercise.startDate)}</td><td className="px-3 py-2">{formatDate(exercise.endDate)}</td><td className="px-3 py-2">{exercise.includesYearEndClose ? 'Sí' : 'No'}</td><td className="px-3 py-2">{exercise.includesNextYearOpening ? 'Sí' : 'No'}</td>
              </tr>)}</tbody>
            </table>
          </div>
        </div>}
        <div className="space-y-2">
          <h3 className="font-bold text-slate-900">Cronología de operaciones ({sourceEvents.length})</h3>
          {sourceEvents.length === 0 ? <p className="rounded-lg bg-white p-3 text-sm text-slate-600">No se encontraron operaciones fuente dentro del rango seleccionado.</p> : <div className="max-h-[520px] overflow-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="px-3 py-2">Fecha efectiva</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Colección / ID</th><th className="px-3 py-2">Referencia</th><th className="px-3 py-2">Registrado</th><th className="px-3 py-2">Asiento efectivo</th><th className="px-3 py-2">Otros asientos relacionados</th></tr></thead>
              <tbody>{sourceEvents.map(event => <tr key={event.key} className="border-t border-slate-100 align-top">
                <td className="whitespace-nowrap px-3 py-2">{formatDate(event.effectiveDate)}</td><td className="whitespace-nowrap px-3 py-2 font-semibold">{event.kind}</td><td className="px-3 py-2">{event.collection}<span className="block text-slate-500">{event.sourceId}</span></td><td className="px-3 py-2">{event.reference || '—'}</td><td className="whitespace-nowrap px-3 py-2">{formatDate(event.recordedAt)}</td><td className="px-3 py-2">{event.linkedJournalEntryId || '—'}</td><td className="px-3 py-2">{(event.relatedJournalEntryIds || []).filter(id => id !== event.linkedJournalEntryId).join(', ') || '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </div>
        {plan.derivedJournalEntryIds.length > 0 && <div className="space-y-2">
          <h3 className="font-bold text-slate-900">Asientos contables derivados identificados</h3>
          <div className="flex flex-wrap gap-2">{plan.derivedJournalEntryIds.map(id => <span key={id} className="rounded-md bg-white px-2 py-1 font-mono text-xs text-slate-700 border border-slate-200">{id}</span>)}</div>
        </div>}
        {plan.externalDependencies.length > 0 && <div className="space-y-2">
          <h3 className="font-bold text-slate-900">Dependencias externas que deben respetarse</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{plan.externalDependencies.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>}
      </>}
    </section>
  );
};
