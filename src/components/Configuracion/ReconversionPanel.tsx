import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { Scale, ArrowRight, CheckCircle2, AlertCircle, Info } from 'lucide-react';
import {
  buildReconversionCarryForward,
  formatCarryForwardAmount,
  type ReconversionCarryForward
} from '../../types/reconversionCarryForward';
import {
  RECONVERSION_BOUNDARIES,
  getReglaMonetariaPorFecha,
  getReconversionBoundariesInRange
} from '../../utils/monetaryPolicy';
import { getLocalISODate } from '../../utils/isoDateValidation';

/**
 * Cierre informativo y arrastre de saldos entre tramos de reconversión.
 *
 * El tramo anterior no se reescribe: se muestra su saldo neto en la escala
 * original y su reexpresión a la escala del tramo siguiente. El contador usa
 * esta conciliación como saldo de apertura informativo y conserva el histórico
 * intacto para auditoría.
 */
export const ReconversionPanel: React.FC = () => {
  const { currentCompany, journalEntries } = useAccounting();
  const today = getLocalISODate();

  const availableBoundaries = useMemo(() => {
    const from = currentCompany.accountingStartDate || '1900-01-01';
    return getReconversionBoundariesInRange(from, today);
  }, [currentCompany.accountingStartDate, today]);

  const [selectedBoundary, setSelectedBoundary] = useState<string>(
    availableBoundaries[0]?.date || RECONVERSION_BOUNDARIES[0].date
  );
  const [result, setResult] = useState<ReconversionCarryForward | null>(null);
  const [error, setError] = useState('');

  const handleCalculate = () => {
    setError('');
    try {
      const computed = buildReconversionCarryForward({
        companyId: currentCompany.id,
        boundaryDate: selectedBoundary,
        entries: journalEntries
      });
      setResult(computed);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : 'No se pudo calcular el arrastre de reconversión.');
    }
  };

  const boundaryRule = getReglaMonetariaPorFecha(selectedBoundary);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-2">
          <Scale className="w-5 h-5 text-indigo-700" />
        </div>
        <div>
          <h3 className="font-bold text-base text-slate-900">Reconversión monetaria y arrastre de saldos</h3>
          <p className="mt-1 max-w-4xl text-xs text-slate-600">
            Cada operación se registra en la escala vigente a su fecha contable. Al cerrar un tramo, su histórico
            queda intacto y de lectura para auditoría; este panel reexpresa el saldo neto de cada cuenta a la escala
            del tramo siguiente para que sirva de saldo de apertura informativo, sin duplicar asientos ni alterar
            montos originales.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-semibold text-slate-700 mb-1">Frontera de reconversión a reexpresar</label>
          <select
            value={selectedBoundary}
            onChange={event => { setSelectedBoundary(event.target.value); setResult(null); setError(''); }}
            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white"
          >
            {RECONVERSION_BOUNDARIES.map(boundary => {
              const isInCompanyRange = availableBoundaries.some(item => item.date === boundary.date);
              return (
                <option key={boundary.date} value={boundary.date}>
                  {boundary.date} · {boundary.label}
                  {isInCompanyRange ? '' : ' · fuera del rango registrado'}
                </option>
              );
            })}
          </select>
          <p className="mt-1 text-[11px] text-slate-500">
            Origen: {boundaryRule.eraLabel}. Se eliminan {RECONVERSION_BOUNDARIES.find(item => item.date === selectedBoundary)?.removedDecimalExponent} ceros decimales al pasar al tramo siguiente.
          </p>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={handleCalculate}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-600"
          >
            <ArrowRight className="w-4 h-4" />
            Arrastre expresado al tramo siguiente
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
        </p>
      )}

      {result && (
        <div className="space-y-3">
          <div className={`flex flex-wrap items-center gap-2 rounded-lg border p-3 text-xs ${result.isBalanced ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
            {result.isBalanced ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span className="font-semibold">
              {result.fromEraLabel} ({result.sourceFromDate} → {result.sourceThroughDate}) <ArrowRight className="inline w-3 h-3 mx-1" /> {result.toEraLabel} ({result.boundaryDate})
            </span>
            <span>· {result.lines.length} cuentas con saldo · Débitos reexpresados {formatCarryForwardAmount(result.totalDebitBs)} / Créditos {formatCarryForwardAmount(result.totalCreditBs)}</span>
          </div>

          {result.warnings.map(warning => (
            <p key={warning} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <Info className="w-4 h-4 shrink-0 mt-0.5" /> {warning}
            </p>
          ))}

          <div className="overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-3 py-2">Cuenta</th>
                  <th className="px-3 py-2 text-right">Saldo original ({boundaryRule.currencyLabel})</th>
                  <th className="px-3 py-2 text-right">Saldo reexpresado</th>
                  <th className="px-3 py-2 text-right">Debe</th>
                  <th className="px-3 py-2 text-right">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.lines.map(line => (
                  <tr key={line.accountCode}>
                    <td className="px-3 py-2 font-mono text-slate-700">{line.accountCode}<span className="block font-sans text-[11px] text-slate-500">{line.accountName}</span></td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">{formatCarryForwardAmount(line.originalNetBs)}</td>
                    <td className="px-3 py-2 text-right font-mono font-semibold text-slate-800">{formatCarryForwardAmount(line.reexpressedNetBs)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-700">{line.debitBs === '0' ? '-' : formatCarryForwardAmount(line.debitBs)}</td>
                    <td className="px-3 py-2 text-right font-mono text-rose-700">{line.creditBs === '0' ? '-' : formatCarryForwardAmount(line.creditBs)}</td>
                  </tr>
                ))}
                {result.lines.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-500">No hay saldos anteriores a esta frontera.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            Documento informativo de conciliación. No crea un asiento duplicado ni modifica el histórico: el tramo
            anterior se conserva en su escala original y solo de lectura para auditoría.
          </p>
        </div>
      )}
    </section>
  );
};
