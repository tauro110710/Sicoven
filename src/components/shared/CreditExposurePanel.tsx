import React, { useEffect, useMemo, useState } from 'react';
import { calculateCreditFxExposure } from '../../types/creditSettlement';
import { formatBs, formatUsd } from '../../utils/formatters';

export interface CreditExposureDocument {
  id: string;
  partyName: string;
  partyRif: string;
  documentNumber: string;
  dueDate?: string;
  outstandingUsd: number;
  bookValueBs: number;
}

interface Props {
  documents: CreditExposureDocument[];
  defaultRate: number;
  title: string;
  partyLabel: string;
}

const parseRate = (value: string): number => {
  const raw = value.trim();
  if (!raw) return Number.NaN;
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
};

/**
 * Read-only sensitivity analysis. It never changes the auxiliar, creates
 * accounting entries, or assumes that the supplied rate is an official close.
 */
export const CreditExposurePanel: React.FC<Props> = ({ documents, defaultRate, title, partyLabel }) => {
  const [rateInput, setRateInput] = useState(String(defaultRate || ''));

  useEffect(() => {
    setRateInput(String(defaultRate || ''));
  }, [defaultRate]);

  const valuationRate = parseRate(rateInput);
  const validRate = Number.isFinite(valuationRate) && valuationRate > 0;
  const rows = useMemo(() => {
    if (!validRate) return [];
    return documents.map(document => ({
      ...document,
      ...calculateCreditFxExposure(document.outstandingUsd, document.bookValueBs, valuationRate)
    })).sort((a, b) => a.partyName.localeCompare(b.partyName) || a.documentNumber.localeCompare(b.documentNumber));
  }, [documents, validRate, valuationRate]);

  const totals = useMemo(() => rows.reduce((sum, row) => ({
    outstandingUsd: sum.outstandingUsd + row.outstandingUsd,
    bookValueBs: sum.bookValueBs + row.bookValueBs,
    valuationBs: sum.valuationBs + row.valuationBs,
    differenceBs: sum.differenceBs + row.differenceBs
  }), { outstandingUsd: 0, bookValueBs: 0, valuationBs: 0, differenceBs: 0 }), [rows]);

  return (
    <section className="overflow-hidden rounded-xl border border-sky-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-sky-100 bg-sky-50/60 p-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-xs text-slate-600">Análisis por documento y {partyLabel.toLowerCase()}; compara el valor en libros a tasa original con un escenario de valuación.</p>
        </div>
        <label className="w-full text-xs font-semibold text-slate-700 sm:max-w-xs">
          Tasa de escenario (Bs. por USD)
          <input
            type="text"
            inputMode="decimal"
            value={rateInput}
            onChange={event => setRateInput(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Ingrese tasa de valuación"
          />
        </label>
      </div>
      <p className="px-4 pt-3 text-[11px] text-slate-500">
        Solo análisis informativo. La tasa introducida no se valida como tasa oficial ni genera revaluación, diferencia cambiaria, asiento o modificación del auxiliar.
      </p>
      {!validRate ? (
        <p className="p-4 text-sm text-amber-700">Ingrese una tasa numérica mayor que cero para calcular la exposición.</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-sm text-slate-500">No hay documentos pendientes para analizar.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-4">
            <article className="rounded-lg border p-3"><p className="text-[11px] text-slate-500">Saldo USD</p><p className="mt-1 font-bold">{formatUsd(totals.outstandingUsd)}</p></article>
            <article className="rounded-lg border p-3"><p className="text-[11px] text-slate-500">Valor en libros Bs.</p><p className="mt-1 font-bold">{formatBs(totals.bookValueBs)}</p></article>
            <article className="rounded-lg border p-3"><p className="text-[11px] text-slate-500">Escenario Bs.</p><p className="mt-1 font-bold">{formatBs(totals.valuationBs)}</p></article>
            <article className="rounded-lg border p-3"><p className="text-[11px] text-slate-500">Diferencia estimada</p><p className={`mt-1 font-bold ${totals.differenceBs > 0 ? 'text-amber-700' : totals.differenceBs < 0 ? 'text-sky-700' : 'text-slate-900'}`}>{formatBs(totals.differenceBs)}</p></article>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-500">
                <tr><th className="p-3">{partyLabel}</th><th className="p-3">Documento</th><th className="p-3">Vencimiento</th><th className="p-3 text-right">Saldo USD</th><th className="p-3 text-right">Libro Bs.</th><th className="p-3 text-right">Escenario Bs.</th><th className="p-3 text-right">Diferencia Bs.</th></tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id} className="border-t">
                    <td className="p-3"><strong>{row.partyName}</strong><span className="block text-slate-500">{row.partyRif}</span></td>
                    <td className="p-3">{row.documentNumber || '—'}</td>
                    <td className="p-3">{row.dueDate || '—'}</td>
                    <td className="p-3 text-right">{formatUsd(row.outstandingUsd)}</td>
                    <td className="p-3 text-right">{formatBs(row.bookValueBs)}</td>
                    <td className="p-3 text-right">{formatBs(row.valuationBs)}</td>
                    <td className="p-3 text-right font-semibold">{formatBs(row.differenceBs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
};
