import React, { useEffect, useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { formatBs, formatDate } from '../../utils/formatters';
import { allowsUsdForOperationDate, formatUsdForDate } from '../../utils/monetaryPolicy';
import { isBcvRateRequiredForDate } from '../../utils/bcvRatePolicy';
import { getNextFixedAssetDepreciationPeriod, type FixedAssetRegistrationDraft, type FixedAssetDepreciationMethod } from '../../types/fixedAssets';

const parseAmount = (value: string): number => {
  const raw = value.trim();
  if (!raw) return 0;
  const comma = raw.lastIndexOf(',');
  const dot = raw.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    return Number(comma > dot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
  }
  return Number(comma >= 0 ? raw.replace(',', '.') : raw);
};

export const FixedAssetsView: React.FC = () => {
  const {
    accounts, journalEntries, fixedAssets, registerFixedAsset
  } = useAccounting();
  const [sourceKey, setSourceKey] = useState('');
  const [assetCode, setAssetCode] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('Mobiliario y equipos');
  const [depreciationMethod, setDepreciationMethod] = useState<FixedAssetDepreciationMethod>('STRAIGHT_LINE');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [serviceDate, setServiceDate] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('60');
  const [residualBs, setResidualBs] = useState('0');
  const [residualUsd, setResidualUsd] = useState('0');
  const [accumulatedAccountCode, setAccumulatedAccountCode] = useState('1.2.1.05');
  const [expenseAccountCode, setExpenseAccountCode] = useState('6.1.1.06');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const reversedSourceIds = useMemo(
    () => new Set(journalEntries.filter(entry => entry.reversalOfEntryId).map(entry => String(entry.reversalOfEntryId))),
    [journalEntries]
  );
  const sourceOptions = useMemo(() => journalEntries.flatMap(entry => {
    if (entry.reversalOfEntryId || entry.reversedByEntryId || reversedSourceIds.has(entry.id)) return [];
    return entry.items.flatMap((line, index) => {
      const account = accounts.find(item => item.code === line.accountCode);
      const alreadyRegistered = fixedAssets.some(asset =>
        asset.sourceJournalEntryId === entry.id && asset.sourceJournalLineIndex === index
      );
      if (!account || account.type !== 'ACTIVO' || !account.isMovement ||
          !account.code.startsWith('1.2.') || /DEPRECIACI[ÓO]N ACUMULADA/i.test(account.name) ||
          Number(line.debitBs) <= 0 || Number(line.debitUsd) < 0 || (isBcvRateRequiredForDate(entry.date) && Number(line.debitUsd) <= 0 || Number(line.debitBs) <= 0) ||
          Number(line.creditBs || 0) > 0 || Number(line.creditUsd || 0) > 0 || alreadyRegistered) return [];
      return [{ key: entry.id + '|' + index, entry, line, index, account }];
    });
  }), [journalEntries, accounts, fixedAssets, reversedSourceIds]);

  const selectedSource = sourceOptions.find(option => option.key === sourceKey) || sourceOptions[0];
  // Solo un activo adquirido desde 2018 tiene costos y depreciación en USD.
  const selectedSourceUsdEnabled = selectedSource ? allowsUsdForOperationDate(selectedSource.entry.date) : false;
  const accumulatedAccounts = accounts.filter(account =>
    account.type === 'ACTIVO' && account.isMovement && account.code.startsWith('1.2.') &&
    /DEPRECIACI[ÓO]N ACUMULADA/i.test(account.name)
  );
  const expenseAccounts = accounts.filter(account =>
    account.type === 'GASTOS' && account.isMovement && /DEPRECIACI[ÓO]N/i.test(account.name)
  );
  const assetSummary = useMemo(() => fixedAssets.reduce((summary, asset) => {
    const events = asset.depreciationEvents.filter(event => !event.reversedByJournalEntryId);
    const accumulatedBs = events.reduce((sum, event) => sum + Number(event.amountBs), 0);
    const accumulatedUsd = events.reduce((sum, event) => sum + Number(event.amountUsd), 0);
    return {
      count: summary.count + 1,
      costBs: summary.costBs + Number(asset.acquisitionCostBs),
      costUsd: summary.costUsd + Number(asset.acquisitionCostUsd),
      depreciationBs: summary.depreciationBs + accumulatedBs,
      depreciationUsd: summary.depreciationUsd + accumulatedUsd,
      netBs: summary.netBs + Math.max(Number(asset.residualValueBs), Number(asset.acquisitionCostBs) - accumulatedBs),
      netUsd: summary.netUsd + Math.max(Number(asset.residualValueUsd), Number(asset.acquisitionCostUsd) - accumulatedUsd)
    };
  }, { count:0,costBs:0,costUsd:0,depreciationBs:0,depreciationUsd:0,netBs:0,netUsd:0 }), [fixedAssets]);
  // Fecha contable que decide si el resumen agregado puede expresarse en USD.
  const usdSummaryDate = useMemo(() => fixedAssets.reduce(
    (latest, asset) => allowsUsdForOperationDate(asset.acquisitionDate) && asset.acquisitionDate > latest
      ? asset.acquisitionDate
      : latest,
    ''
  ), [fixedAssets]);

  const suggestedAssetCode = useMemo(() => {
    const max = fixedAssets.reduce((value, asset) => {
      const match = /^AF-(\d+)$/.exec(asset.assetCode);
      return match ? Math.max(value, Number(match[1])) : value;
    }, 0);
    return 'AF-' + String(max + 1).padStart(5, '0');
  }, [fixedAssets]);

  useEffect(() => {
    if (!sourceOptions.some(option => option.key === sourceKey)) setSourceKey(sourceOptions[0]?.key || '');
  }, [sourceOptions, sourceKey]);

  useEffect(() => {
    if (selectedSource) {
      setAcquisitionDate(selectedSource.entry.date);
      setServiceDate(selectedSource.entry.date);
      setAssetCode(current => current.trim() ? current : suggestedAssetCode);
    }
  }, [selectedSource?.key, suggestedAssetCode]);

  useEffect(() => {
    if (!selectedSource) return;
    const defaults: Record<string, string> = {
      '1.2.1.01': '1.2.1.05',
      '1.2.1.02': '1.2.1.07',
      '1.2.1.03': '1.2.1.06',
        '1.2.1.04': '1.2.1.08'
    };
    if (defaults[selectedSource.line.accountCode]) setAccumulatedAccountCode(defaults[selectedSource.line.accountCode]);
  }, [selectedSource?.key]);

  const submitAsset = async () => {
    setError('');
    setMessage('');
    if (!selectedSource) {
      setError('No hay una línea de adquisición capitalizada disponible para vincular.');
      return;
    }
    if (depreciationMethod === 'STRAIGHT_LINE' && !accumulatedAccounts.some(account => account.code === accumulatedAccountCode)) {
      setError('Falta crear o seleccionar la cuenta correctora de depreciación acumulada correspondiente en el Catálogo de Cuentas.');
      return;
    }
    if (depreciationMethod === 'STRAIGHT_LINE' && !expenseAccounts.some(account => account.code === expenseAccountCode)) {
      setError('Falta seleccionar una cuenta válida de gasto de depreciación en el Catálogo de Cuentas.');
      return;
    }
    const parsedResidualBs = parseAmount(residualBs);
    const parsedResidualUsd = parseAmount(residualUsd);
    const life = Number(usefulLifeMonths);
    if (depreciationMethod === 'STRAIGHT_LINE' &&
        (!Number.isFinite(parsedResidualBs) || (selectedSourceUsdEnabled && !Number.isFinite(parsedResidualUsd)) ||
         !Number.isInteger(life) || life <= 0)) {
      setError('Revise el valor residual y la vida útil en meses.');
      return;
    }
    const draft: FixedAssetRegistrationDraft = {
      assetCode, description, category, acquisitionDate, serviceDate,
      residualValueBs: depreciationMethod === 'NON_DEPRECIABLE' ? Number(selectedSource.line.debitBs) : parsedResidualBs,
      residualValueUsd: depreciationMethod === 'NON_DEPRECIABLE'
        ? Number(selectedSource.line.debitUsd)
        : selectedSourceUsdEnabled ? parsedResidualUsd : 0,
      usefulLifeMonths: depreciationMethod === 'NON_DEPRECIABLE' ? 0 : life,
      depreciationMethod,
      assetAccountCode: selectedSource.line.accountCode,
      accumulatedDepreciationAccountCode: depreciationMethod === 'NON_DEPRECIABLE' ? '' : accumulatedAccountCode,
      depreciationExpenseAccountCode: depreciationMethod === 'NON_DEPRECIABLE' ? '' : expenseAccountCode,
      sourceJournalEntryId: selectedSource.entry.id,
      sourceJournalLineIndex: selectedSource.index
    };
    setSaving(true);
    try {
      const created = await registerFixedAsset(draft);
      setMessage('Activo ' + created.assetCode + ' registrado y vinculado al asiento ' + created.sourceJournalEntryId + '. No se generó un segundo asiento de adquisición.');
      setDescription('');
      setCategory('Mobiliario y equipos');
       setDepreciationMethod('STRAIGHT_LINE');
      const maxAssetSequence = [created, ...fixedAssets].reduce((max, asset) => {
        const match = /^AF-(\d+)$/.exec(asset.assetCode);
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0);
      setAssetCode('AF-' + String(maxAssetSequence + 1).padStart(5, '0'));
      setResidualBs('0');
      setResidualUsd('0');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar el activo fijo.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-bold text-slate-900">Activos fijos</h1>
        <p className="mt-1 text-sm text-slate-600">Registro vinculado al Libro Diario, con depreciación lineal automática y control de bienes no depreciables.</p>
      </header>

      <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <strong>Integridad de adquisición:</strong> solo se registran líneas ya contabilizadas en Propiedades, Planta y Equipo (1.2), sin duplicar el asiento original. Los bienes depreciables usan línea recta; los terrenos y otros bienes no depreciables conservan su costo sin generar depreciación.
      </div>

      {(error || message) && (
        <div role={error ? 'alert' : 'status'} className={`rounded-lg border p-3 text-sm ${error ? 'border-rose-300 bg-rose-50 text-rose-800' : 'border-emerald-300 bg-emerald-50 text-emerald-800'}`}>
          {error || message}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Activos registrados</p><p className="mt-1 text-2xl font-bold text-slate-900">{assetSummary.count}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Costo histórico · Bs.</p><p className="mt-1 text-lg font-bold text-slate-900">{formatBs(assetSummary.costBs)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Costo histórico · USD</p><p className="mt-1 text-lg font-bold text-slate-900">{formatUsdForDate(assetSummary.costUsd, usdSummaryDate)}</p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Depreciación acumulada</p><p className="mt-1 text-lg font-bold text-slate-900">{formatBs(assetSummary.depreciationBs)} <span className="text-sm font-medium text-slate-500">/ {formatUsdForDate(assetSummary.depreciationUsd, usdSummaryDate)}</span></p></div>
        <div className="rounded-xl border bg-white p-4"><p className="text-xs text-slate-500">Valor neto contable</p><p className="mt-1 text-lg font-bold text-slate-900">{formatBs(assetSummary.netBs)} <span className="text-sm font-medium text-slate-500">/ {formatUsdForDate(assetSummary.netUsd, usdSummaryDate)}</span></p></div>
      </section>
      <section className="rounded-xl border bg-white p-4 shadow-sm">
        <h2 className="font-semibold text-slate-900">Registrar activo existente</h2>
        <p className="mt-1 text-xs text-slate-500">Seleccione la línea de adquisición ya contabilizada. El costo en Bs. y, cuando exista, USD se toma directamente de ese asiento.</p>
        {sourceOptions.length === 0 ? (
          <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            No hay líneas de adquisición pendientes en cuentas 1.2. Registre primero la capitalización contable correcta en el Libro Diario.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-xs font-medium text-slate-700 md:col-span-2">
              Línea de adquisición
              <select value={selectedSource?.key || ''} onChange={event => setSourceKey(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                {sourceOptions.map(option => (
                  <option key={option.key} value={option.key}>
                    {formatDate(option.entry.date)} · {option.entry.referenceDoc || option.entry.entryNumber} · {option.account.name} · {formatBs(option.line.debitBs)} / {formatUsdForDate(option.line.debitUsd, option.entry.date)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">Código del activo
              <input value={assetCode} onChange={event => setAssetCode(event.target.value.toUpperCase())} placeholder={suggestedAssetCode} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">Descripción
              <input value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Identificación del activo" />
            </label>
            <label className="text-xs font-medium text-slate-700">Categoría
              <input value={category} onChange={event => setCategory(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Mobiliario, vehículo, equipo..." />
            </label>
            <label className="text-xs font-medium text-slate-700">Fecha de adquisición
              <input type="date" value={acquisitionDate} onChange={event => setAcquisitionDate(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">Disponible para uso desde
              <input type="date" value={serviceDate} onChange={event => setServiceDate(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-medium text-slate-700">Tratamiento del activo
              <select value={depreciationMethod} onChange={event => setDepreciationMethod(event.target.value as FixedAssetDepreciationMethod)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                <option value="STRAIGHT_LINE">Depreciable · Línea recta</option>
                <option value="NON_DEPRECIABLE">No depreciable · Conserva costo</option>
              </select>
            </label>
            {depreciationMethod === 'STRAIGHT_LINE' ? <>
              <label className="text-xs font-medium text-slate-700">Vida útil (meses)
                <input type="number" min="1" step="1" value={usefulLifeMonths} onChange={event => setUsefulLifeMonths(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              <label className="text-xs font-medium text-slate-700">Valor residual Bs.
                <input value={residualBs} onChange={event => setResidualBs(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </label>
              {selectedSourceUsdEnabled && <label className="text-xs font-medium text-slate-700">Valor residual USD
                <input value={residualUsd} onChange={event => setResidualUsd(event.target.value)} inputMode="decimal" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" />
              </label>}
              <label className="text-xs font-medium text-slate-700">Cuenta de depreciación acumulada
              <select value={accumulatedAccountCode} onChange={event => setAccumulatedAccountCode(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                {accumulatedAccounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
              </select>
              {!accumulatedAccounts.some(account => account.code === accumulatedAccountCode) && <span className="mt-1 block text-amber-700">La cuenta correctora requerida no está creada en esta empresa. Créela en el Catálogo de Cuentas antes de registrar el activo.</span>}
              </label>
              <label className="text-xs font-medium text-slate-700">Cuenta de gasto de depreciación
                <select value={expenseAccountCode} onChange={event => setExpenseAccountCode(event.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm">
                  {expenseAccounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
                </select>
              </label>
            </> : <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:col-span-2">Este bien no se depreciará. Su valor residual será igual al costo histórico de adquisición.</div>}
            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:col-span-2">
              Costo de origen: <strong>{selectedSource ? formatBs(selectedSource.line.debitBs) + ' / ' + formatUsdForDate(selectedSource.line.debitUsd, selectedSource.entry.date) : '—'}</strong>
              <span className="ml-2">Tasa histórica: <strong>{selectedSource?.entry.bcvRate || '—'}</strong></span>
            </div>
            <div className="md:col-span-2">
              <button type="button" disabled={saving || !selectedSource || (depreciationMethod === 'STRAIGHT_LINE' && (!accumulatedAccounts.some(account => account.code === accumulatedAccountCode) || !expenseAccounts.some(account => account.code === expenseAccountCode)))} onClick={submitAsset} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {saving ? 'Registrando…' : 'Registrar activo'}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950">
        <strong>Depreciación automática por empresa.</strong>
        <p className="mt-1">Al cerrar cada período contable, SICOVEN calcula los meses pendientes de cada activo de esta empresa, genera los asientos duales en Bs. y USD y los confirma en SQLite antes de completar el cierre. Los períodos ya contabilizados no se duplican; si hay depreciación pendiente dentro de un período cerrado, el sistema exige su reapertura formal.</p>
      </section>

      <section className="overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="border-b p-4">
          <h2 className="font-semibold text-slate-900">Registro de activos de la empresa</h2>
          <p className="mt-1 text-xs text-slate-500">{fixedAssets.length} activo(s) registrados. Los eventos de depreciación conservan el vínculo con su asiento.</p>
        </div>
        {fixedAssets.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Todavía no hay activos fijos registrados para esta empresa.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-3">Activo</th><th className="p-3">Origen</th><th className="p-3 text-right">Costo Bs.</th><th className="p-3 text-right">Costo USD</th><th className="p-3 text-right">Deprec. Bs.</th><th className="p-3 text-right">Deprec. USD</th><th className="p-3 text-right">Neto Bs.</th><th className="p-3 text-right">Neto USD</th><th className="p-3">Próximo período</th><th className="p-3">Proceso</th></tr>
              </thead>
              <tbody>
                {fixedAssets.map(asset => {
                  const events = asset.depreciationEvents.filter(event => !event.reversedByJournalEntryId);
                  const accumulatedBs = events.reduce((sum, event) => sum + event.amountBs, 0);
                  const accumulatedUsd = events.reduce((sum, event) => sum + event.amountUsd, 0);
                  const netBs = Math.max(asset.residualValueBs, asset.acquisitionCostBs - accumulatedBs);
                  const netUsd = Math.max(asset.residualValueUsd, asset.acquisitionCostUsd - accumulatedUsd);
                  let nextPeriod: string | null = null;
                  let historyError = false;
                  try { nextPeriod = getNextFixedAssetDepreciationPeriod(asset); } catch { historyError = true; }
                  return (
                    <tr key={asset.id} className="border-t">
                      <td className="p-3">
                        <strong>{asset.assetCode} · {asset.description}</strong>
                        <span className="block text-slate-500">{asset.category} · {asset.usefulLifeMonths} meses</span>
                        <details className="mt-2 max-w-xs">
                          <summary className="cursor-pointer text-sky-700">Historial ({asset.depreciationEvents.length})</summary>
                          <div className="mt-2 space-y-2">
                            {asset.depreciationEvents.slice().sort((a,b) => a.period.localeCompare(b.period)).map(event => (
                              <div key={event.id} className="rounded-md bg-slate-50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <strong>{event.period}</strong>
                                  <span className={event.reversedByJournalEntryId ? 'text-rose-700' : 'text-emerald-700'}>{event.reversedByJournalEntryId ? 'Reversada' : 'Vigente'}</span>
                                </div>
                                <span className="block text-slate-500">{formatDate(event.date)} · {event.days} días</span>
                                <span className="block">{formatBs(event.amountBs)} / {formatUsdForDate(event.amountUsd, event.date)}</span>
                                <span className="block break-all text-slate-500">Asiento: {event.journalEntryId}{event.reversedByJournalEntryId ? ' · Reversión: ' + event.reversedByJournalEntryId : ''}</span>
                              </div>
                            ))}
                          </div>
                        </details>
                      </td>
                      <td className="p-3">{asset.sourceJournalEntryId}<span className="block text-slate-500">{formatDate(asset.acquisitionDate)} · {asset.assetAccountCode}</span></td>
                      <td className="p-3 text-right">{formatBs(asset.acquisitionCostBs)}</td>
                      <td className="p-3 text-right">{formatUsdForDate(asset.acquisitionCostUsd, asset.acquisitionDate)}</td>
                      <td className="p-3 text-right">{formatBs(accumulatedBs)}</td>
                      <td className="p-3 text-right">{formatUsdForDate(accumulatedUsd, asset.acquisitionDate)}</td>
                      <td className="p-3 text-right font-semibold">{formatBs(netBs)}</td>
                      <td className="p-3 text-right font-semibold">{formatUsdForDate(netUsd, asset.acquisitionDate)}</td>
                      <td className="p-3">{historyError ? 'Revisar historial' : asset.depreciationMethod === 'NON_DEPRECIABLE' ? 'No depreciable' : nextPeriod || 'Depreciación completada'}</td>
                      <td className="p-3">
                        {historyError
                          ? <span className="font-semibold text-amber-700">Revisar</span>
                          : nextPeriod
                            ? <span className="font-semibold text-sky-700">Cierre mensual</span>
                            : <span className="text-slate-500">Completada</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
