import React, { useEffect, useMemo, useState } from 'react';

type SeriesCode = 'IPC_AMC' | 'INPC_BCV' | 'ESTIMACION_EXPERTO' | 'ESTUDIO_FCCPV' | 'ESTIMACION_PROPIA_EXCEPCIONAL';
type MetricType = 'INDEX_LEVEL' | 'MONTHLY_VARIATION_PCT';
type ImportForm = {
  seriesCode: SeriesCode;
  metricType: MetricType;
  basePeriod: string;
  fileName: string;
  sourceTitle: string;
  issuer: string;
  sourceReference: string;
  sourceUrl: string;
  sourcePublishedAt: string;
  sourceText: string;
};
type Observation = { period: string; sourceValue: string; value: string; observationStatus: string };
type SeriesRecord = {
  id: string;
  seriesCode: SeriesCode;
  metricType: MetricType;
  basePeriod?: string | null;
  firstPeriod: string;
  lastPeriod: string;
  observationCount: number;
  seriesVersion: number;
  missingMonths: string[];
  importedBy: string;
  createdAt: string;
  fileName: string;
  sourceTitle: string;
  issuer: string;
  sourceReference: string;
  sourceUrl?: string | null;
  sourcePublishedAt: string;
  importedAt: string;
  sourceSha256: string;
  approvalStatus: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
  approvalReason?: string;
  observations: Observation[];
};
type PreviewResult = {
  ok: boolean;
  seriesCode: SeriesCode;
  metricType: MetricType;
  basePeriod?: string | null;
  firstPeriod: string;
  lastPeriod: string;
  observationCount: number;
  missingMonths: string[];
  statusCounts: Record<string, number>;
  sourceSha256: string;
  sourceBytes: number;
};

const initialForm = (): ImportForm => ({
  seriesCode: 'INPC_BCV',
  metricType: 'INDEX_LEVEL',
  basePeriod: '',
  fileName: '',
  sourceTitle: '',
  issuer: '',
  sourceReference: '',
  sourceUrl: '',
  sourcePublishedAt: new Date().toISOString().slice(0, 10),
  sourceText: ''
});

const SERIES_LABELS: Record<SeriesCode, string> = {
  IPC_AMC: 'IPC Área Metropolitana de Caracas',
  INPC_BCV: 'INPC — BCV',
  ESTIMACION_EXPERTO: 'Estimación de experto',
  ESTUDIO_FCCPV: 'Estudio FCCPV',
  ESTIMACION_PROPIA_EXCEPCIONAL: 'Estimación propia excepcional'
};

const statusLabel = (status: string) => ({
  PENDING_REVIEW: 'Pendiente de revisión',
  APPROVED: 'Fuente aprobada',
  REJECTED: 'Fuente rechazada'
}[status] || status);

const formatBytes = (bytes: number) => bytes < 1024 * 1024
  ? `${(bytes / 1024).toFixed(1)} KB`
  : `${(bytes / (1024 * 1024)).toFixed(2)} MB`;

export const InflationIndexView: React.FC<{ token: string }> = ({ token }) => {
  const [series, setSeries] = useState<SeriesRecord[]>([]);
  const [form, setForm] = useState<ImportForm>(initialForm);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selectedReview, setSelectedReview] = useState<string | null>(null);
  const [reviewReason, setReviewReason] = useState('');
  const [reviewDecision, setReviewDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const pendingCount = useMemo(() => series.filter(item => item.approvalStatus === 'PENDING_REVIEW').length, [series]);

  const refreshSeries = async () => {
    if (!window.sicovenStore) throw new Error('Esta función requiere SICOVEN de escritorio con SQLite local.');
    const rows = await window.sicovenStore.listInflationIndexSeries(token);
    setSeries(rows as SeriesRecord[]);
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        if (!window.sicovenStore) throw new Error('La administración de índices está disponible en SICOVEN Desktop.');
        const rows = await window.sicovenStore.listInflationIndexSeries(token);
        if (active) setSeries(rows as SeriesRecord[]);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'No se pudo consultar el catálogo local.');
      }
    };
    void load();
    return () => { active = false; };
  }, [token]);

  const updateForm = <K extends keyof ImportForm>(key: K, value: ImportForm[K]) => {
    setForm(previous => ({ ...previous, [key]: value }));
    setPreview(null);
    setNotice('');
  };

  const handleFile = async (file?: File) => {
    setError('');
    setPreview(null);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError('El archivo supera el límite de 5 MB.');
      return;
    }
    try {
      const sourceText = await file.text();
      if (!sourceText.trim()) throw new Error('El archivo seleccionado está vacío.');
      setForm(previous => ({ ...previous, fileName: file.name, sourceText }));
      setNotice(`Archivo cargado: ${file.name} (${formatBytes(file.size)}). Aún no se ha guardado en SQLite.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo leer el archivo seleccionado.');
    }
  };

  const buildInput = () => ({
    seriesCode: form.seriesCode,
    metricType: form.metricType,
    ...(form.metricType === 'INDEX_LEVEL' ? { basePeriod: form.basePeriod } : {}),
    fileName: form.fileName,
    sourceTitle: form.sourceTitle,
    issuer: form.issuer,
    sourceReference: form.sourceReference,
    ...(form.sourceUrl.trim() ? { sourceUrl: form.sourceUrl.trim() } : {}),
    sourcePublishedAt: form.sourcePublishedAt,
    sourceText: form.sourceText
  });

  const runPreview = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!window.sicovenStore) throw new Error('La importación solo está disponible en SICOVEN Desktop.');
      const result = await window.sicovenStore.previewInflationIndexImport(token, buildInput());
      if (!result.ok) throw new Error('La validación del archivo no fue satisfactoria.');
      setPreview(result);
      setNotice('Validación preliminar correcta. Revise los períodos faltantes y los datos de la fuente antes de guardar.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo validar el archivo.');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const saveImport = async () => {
    if (!preview) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!window.sicovenStore) throw new Error('La importación solo está disponible en SICOVEN Desktop.');
      const result = await window.sicovenStore.importInflationIndexSeries(token, buildInput());
      if (!result.ok) throw new Error('SQLite no confirmó la importación.');
      await refreshSeries();
      setForm(initialForm());
      setPreview(null);
      setNotice(`Serie guardada en SQLite como versión ${result.seriesVersion ?? 'nueva'} y pendiente de revisión. No se ha utilizado para cálculos contables.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la serie.');
    } finally {
      setBusy(false);
    }
  };

  const submitReview = async (seriesId: string) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!window.sicovenStore) throw new Error('La revisión solo está disponible en SICOVEN Desktop.');
      await window.sicovenStore.reviewInflationIndexSeries(token, {
        seriesId,
        decision: reviewDecision,
        reason: reviewReason
      });
      await refreshSeries();
      setSelectedReview(null);
      setReviewReason('');
      setNotice(reviewDecision === 'APPROVED'
        ? 'La evidencia documental fue aprobada. La serie todavía no habilita cálculos de reexpresión.'
        : 'La serie fue rechazada y permanece conservada como evidencia histórica.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar la revisión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Bloque 3 · Ajuste por inflación y REME</p>
            <h1 className="mt-1 text-2xl font-bold text-slate-900">Índices y fuentes documentales</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Administre series de índices desde archivos documentales. Los archivos se validan y se conservan en SQLite local; no se descargan datos automáticamente ni se inventan observaciones.
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong>{pendingCount}</strong> serie(s) pendiente(s) de revisión
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Series registradas</p><p className="mt-1 text-xl font-bold text-slate-900">{series.length}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Aprobadas documentalmente</p><p className="mt-1 text-xl font-bold text-slate-900">{series.filter(item => item.approvalStatus === 'APPROVED').length}</p></div>
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Rechazadas</p><p className="mt-1 text-xl font-bold text-slate-900">{series.filter(item => item.approvalStatus === 'REJECTED').length}</p></div>
        </div>
      </section>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5">
          <h2 className="text-lg font-bold text-slate-900">Importar una serie documental</h2>
          <p className="mt-1 text-sm text-slate-500">Primero valide el CSV; después guárdelo como una nueva versión inmutable y pendiente de revisión.</p>
        </div>
        <form onSubmit={event => { event.preventDefault(); void runPreview(); }} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block text-sm font-medium text-slate-700">Fuente / serie
              <select value={form.seriesCode} onChange={event => updateForm('seriesCode', event.target.value as SeriesCode)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
                {Object.entries(SERIES_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-slate-700">Magnitud
              <select value={form.metricType} onChange={event => updateForm('metricType', event.target.value as MetricType)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm">
                <option value="INDEX_LEVEL">Nivel del índice</option>
                <option value="MONTHLY_VARIATION_PCT">Variación porcentual mensual</option>
              </select>
            </label>
            {form.metricType === 'INDEX_LEVEL' && (
              <label className="block text-sm font-medium text-slate-700">Período base (YYYY-MM)
                <input required value={form.basePeriod} onChange={event => updateForm('basePeriod', event.target.value)} placeholder="Ej. 2007-12" pattern="\d{4}-(0[1-9]|1[0-2])" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
              </label>
            )}
            <label className="block text-sm font-medium text-slate-700">Fecha de publicación del documento
              <input required type="date" value={form.sourcePublishedAt} onChange={event => updateForm('sourcePublishedAt', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">Documento CSV (UTF-8, máximo 5 MB)
              <input required type="file" accept=".csv,text/csv" onChange={event => { void handleFile(event.target.files?.[0]); }} className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-1.5 file:font-semibold file:text-emerald-800" />
              <span className="mt-1 block text-xs text-slate-500">Columnas requeridas: period;value. Para series FCCPV agregue status con ESTIMATED o PROJECTED.</span>
            </label>
            <label className="block text-sm font-medium text-slate-700">Título del documento
              <input required maxLength={240} value={form.sourceTitle} onChange={event => updateForm('sourceTitle', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700">Emisor
              <input required maxLength={180} value={form.issuer} onChange={event => updateForm('issuer', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">Referencia documental (publicación, circular, resolución, URL impresa, etc.)
              <input required maxLength={500} value={form.sourceReference} onChange={event => updateForm('sourceReference', event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
            <label className="block text-sm font-medium text-slate-700 md:col-span-2">URL de consulta (opcional; no se consulta automáticamente)
              <input type="url" value={form.sourceUrl} onChange={event => updateForm('sourceUrl', event.target.value)} placeholder="https://" className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm" />
            </label>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">{form.fileName || 'Ningún archivo seleccionado'}{form.sourceText ? ` · ${formatBytes(new TextEncoder().encode(form.sourceText).length)}` : ''}</p>
            <button type="submit" disabled={busy || !form.sourceText} className="rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Validando…' : 'Validar archivo'}</button>
          </div>
        </form>

        {preview && (
          <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
            <h3 className="font-bold text-emerald-950">Resultado de validación preliminar</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div><p className="text-xs text-emerald-800">Primer período</p><p className="font-semibold text-slate-900">{preview.firstPeriod}</p></div>
              <div><p className="text-xs text-emerald-800">Último período</p><p className="font-semibold text-slate-900">{preview.lastPeriod}</p></div>
              <div><p className="text-xs text-emerald-800">Observaciones</p><p className="font-semibold text-slate-900">{preview.observationCount}</p></div>
              <div><p className="text-xs text-emerald-800">Tamaño</p><p className="font-semibold text-slate-900">{formatBytes(preview.sourceBytes)}</p></div>
            </div>
            <p className="mt-3 break-all text-xs text-slate-600">SHA-256: {preview.sourceSha256}</p>
            {preview.missingMonths.length > 0
              ? <p className="mt-2 text-sm text-amber-800">Meses faltantes ({preview.missingMonths.length}): {preview.missingMonths.join(', ')}</p>
              : <p className="mt-2 text-sm text-emerald-800">No se detectaron meses faltantes dentro del rango.</p>}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={busy} onClick={() => setPreview(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancelar</button>
              <button type="button" disabled={busy} onClick={() => void saveImport()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">Guardar versión en SQLite</button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-lg font-bold text-slate-900">Catálogo local de series</h2><p className="text-sm text-slate-500">Evidencia documental, versiones y observaciones conservadas en SQLite.</p></div>
          <button type="button" disabled={busy} onClick={() => { setError(''); void refreshSeries().catch(err => setError(err instanceof Error ? err.message : 'No se pudo actualizar el catálogo.')); }} className="self-start rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Actualizar listado</button>
        </div>
        {series.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">Todavía no hay series importadas. No se han cargado índices ficticios ni datos de demostración.</div>
        ) : (
          <div className="space-y-3">
            {series.map(item => (
              <article key={item.id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{SERIES_LABELS[item.seriesCode] || item.seriesCode}</h3><span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${item.approvalStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : item.approvalStatus === 'REJECTED' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}>{statusLabel(item.approvalStatus)}</span><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] text-slate-700">Versión {item.seriesVersion}</span></div>
                    <p className="mt-1 text-sm text-slate-600">{item.sourceTitle} · {item.issuer}</p>
                    <p className="mt-1 text-xs text-slate-500">{item.metricType === 'INDEX_LEVEL' ? `Nivel de índice · Base ${item.basePeriod || 'no indicada'}` : 'Variación porcentual mensual'} · {item.firstPeriod} a {item.lastPeriod} · {item.observationCount} observaciones</p>
                    <p className="mt-1 text-xs text-slate-500">Documento: {item.fileName} · Publicado: {item.sourcePublishedAt} · Importado: {new Date(item.importedAt).toLocaleString('es-VE')}</p>
                    <p className="mt-1 break-all text-[11px] text-slate-400">SHA-256: {item.sourceSha256}</p>
                    {item.missingMonths?.length > 0 && <p className="mt-2 text-xs text-amber-800">Meses faltantes: {item.missingMonths.join(', ')}</p>}
                    {item.approvalReason && <p className="mt-2 text-xs text-slate-600">Revisión: {item.approvalReason}</p>}
                  </div>
                  {item.approvalStatus === 'PENDING_REVIEW' && (
                    <button type="button" disabled={busy} onClick={() => { setSelectedReview(selectedReview === item.id ? null : item.id); setReviewReason(''); }} className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Revisar evidencia</button>
                  )}
                </div>
                {selectedReview === item.id && (
                  <div className="mt-4 rounded-lg bg-slate-50 p-3">
                    <p className="text-sm font-semibold text-slate-800">Decisión documental</p>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm">
                      <label className="flex items-center gap-2"><input type="radio" checked={reviewDecision === 'APPROVED'} onChange={() => setReviewDecision('APPROVED')} /> Aprobar evidencia</label>
                      <label className="flex items-center gap-2"><input type="radio" checked={reviewDecision === 'REJECTED'} onChange={() => setReviewDecision('REJECTED')} /> Rechazar evidencia</label>
                    </div>
                    <label className="mt-3 block text-xs font-semibold text-slate-700">Justificación obligatoria (10–1000 caracteres)
                      <textarea value={reviewReason} onChange={event => setReviewReason(event.target.value)} rows={3} maxLength={1000} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-sm" />
                    </label>
                    <div className="mt-3 flex justify-end">
                      <button type="button" disabled={busy || reviewReason.trim().length < 10} onClick={() => void submitReview(item.id)} className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Registrar decisión'}</button>
                    </div>
                  </div>
                )}
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-emerald-800">Ver observaciones importadas ({item.observations.length})</summary>
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="px-3 py-2">Período</th><th className="px-3 py-2">Valor original</th><th className="px-3 py-2">Valor normalizado</th><th className="px-3 py-2">Naturaleza</th></tr></thead>
                      <tbody>{item.observations.map(row => <tr key={row.period} className="border-t border-slate-100"><td className="px-3 py-2">{row.period}</td><td className="px-3 py-2">{row.sourceValue}</td><td className="px-3 py-2">{row.value}</td><td className="px-3 py-2">{row.observationStatus}</td></tr>)}</tbody>
                    </table>
                  </div>
                </details>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-950">
        <strong>Control contable:</strong> este módulo administra evidencia y revisión de fuentes. La aprobación documental no certifica por sí sola el marco normativo, no ejecuta factores de reexpresión y no genera asientos. El motor REME permanecerá deshabilitado hasta completar los subbloques técnicos y la validación profesional.
      </div>
    </div>
  );
};
