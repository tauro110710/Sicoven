import React, { useMemo } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import { formatBs } from '../../utils/formatters';
import { todayLocalIso } from '../../utils/localDate';
import { buildHistoricalVat31Diagnostic } from '../../types/historicalVat31Diagnostic';

const sourceLabel: Record<string, string> = {
  PURCHASE: 'Compra',
  SALE: 'Venta',
  JOURNAL_ENTRY: 'Asiento contable',
};

const sideLabel: Record<string, string> = {
  INPUT: 'Crédito fiscal (compras)',
  OUTPUT: 'Débito fiscal (ventas)',
};

const effectLabel: Record<string, string> = {
  INCREASE: 'Aumentó IVA indebidamente',
  DECREASE: 'Redujo IVA en exceso',
};

const luxuryLabel: Record<string, string> = {
  NON_RECOVERABLE_EXPENSE: 'Gasto suntuario no recuperable',
  TAX_PAYABLE: 'Impuesto suntuario por pagar',
};

export const HistoricalVat31DiagnosticView: React.FC = () => {
  const { currentCompany, purchases, sales, journalEntries } = useAccounting();

  const diagnostic = useMemo(() => {
    try {
      return {
        result: buildHistoricalVat31Diagnostic({
          companyId: currentCompany.id,
          purchases,
          sales,
          journalEntries,
          closedThroughDate: currentCompany.closedThroughDate,
          today: todayLocalIso(),
        }),
        error: null as string | null,
      };
    } catch (error) {
      return {
        result: null,
        error: error instanceof Error ? error.message : 'No se pudo ejecutar el diagnóstico IVA 31 %.',
      };
    }
  }, [currentCompany.id, currentCompany.closedThroughDate, purchases, sales, journalEntries]);

  const result = diagnostic.result;
  const totals = result?.totals;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Diagnóstico IVA 31 % (solo lectura)</h2>
            <p className="mt-1 text-sm text-slate-600">
              Revisa compras, ventas, notas y asientos con tasa combinada 31 % (16 % IVA + 15 % impuesto adicional al consumo suntuario)
              donde el 31 % completo pudo quedar registrado como IVA. Este diagnóstico no modifica documentos, asientos ni períodos históricos.
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
            <Info className="h-3.5 w-3.5" /> Solo lectura
          </span>
        </div>
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <strong>Criterio fiscal:</strong> en la tasa combinada 31 %, solo el 16 % es IVA crédito/débito fiscal.
          El 15 % es impuesto adicional al consumo suntuario y no debe inflar el IVA. Cualquier corrección se propone como asiento nuevo
          en un período abierto; los documentos históricos no se reescriben.
        </div>
      </div>

      {diagnostic.error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> No se pudo calcular el diagnóstico</div>
          <p className="mt-1">{diagnostic.error}</p>
        </div>
      )}

      {result && totals && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Hallazgos</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">{totals.findingCount}</div>
              <div className="mt-1 text-xs text-slate-500">{totals.documentCount} documento(s) · {totals.journalEntryCount} asiento(s) manual(es)</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">IVA registrado / correcto</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">{formatBs(totals.recordedVatBs)} / {formatBs(totals.correctVatBs)}</div>
              <div className="mt-1 text-xs text-slate-500">Base 31 % diagnosticada: {formatBs(totals.taxableBase31Bs)}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">IVA inflado</div>
              <div className="mt-1 text-sm font-semibold text-amber-950">Crédito compras: {formatBs(totals.inflatedInputVatCreditBs)}</div>
              <div className="text-sm font-semibold text-amber-950">Débito ventas: {formatBs(totals.inflatedOutputVatDebitBs)}</div>
              <div className="mt-1 text-xs text-amber-800">Reversión pendiente en notas crédito: {formatBs(totals.pendingVatReversalBs)}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suntuario 15 %</div>
              <div className="mt-1 text-sm font-semibold text-slate-900">Gasto no recuperable: {formatBs(totals.nonRecoverableLuxuryTaxBs)}</div>
              <div className="text-sm font-semibold text-slate-900">Por pagar: {formatBs(totals.luxuryTaxPayableBs)}</div>
              <div className="mt-1 text-xs text-slate-500">Neto, según hallazgos detectados.</div>
            </div>
          </div>

          {totals.findingCount === 0 ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
              <div className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> No se detectaron documentos o asientos 31 % con IVA inflado</div>
              <p className="mt-1 text-sm text-emerald-900">La revisión no encontró compras, ventas, notas ni asientos manuales donde el 31 % completo esté registrado como IVA sin separar el 15 % suntuario.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h3 className="font-semibold text-slate-900">Hallazgos detectados</h3>
                  <p className="text-xs text-slate-500">Cada fila muestra el IVA registrado, el IVA correcto al 16 % y el exceso que corresponde al suntuario 15 %.</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2">Fecha</th>
                        <th className="px-3 py-2">Origen</th>
                        <th className="px-3 py-2">Documento / Referencia</th>
                        <th className="px-3 py-2">Tercero / Descripción</th>
                        <th className="px-3 py-2 text-right">Base 31 %</th>
                        <th className="px-3 py-2 text-right">IVA registrado</th>
                        <th className="px-3 py-2 text-right">IVA correcto 16 %</th>
                        <th className="px-3 py-2 text-right">Exceso 15 %</th>
                        <th className="px-3 py-2">Tratamiento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.findings.map((finding) => (
                        <tr key={finding.id} className="border-t border-slate-100 align-top">
                          <td className="px-3 py-2 whitespace-nowrap text-slate-700">{finding.date}</td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-medium">{sourceLabel[finding.source] || finding.source}</div>
                            <div className="text-[11px] text-slate-500">{sideLabel[finding.side] || finding.side}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">
                            <div className="font-medium">{finding.documentLabel}</div>
                            <div className="text-[11px] text-slate-500">{finding.reference}{finding.journalEntryNumber ? ` · Asiento #${finding.journalEntryNumber}` : ''}</div>
                          </td>
                          <td className="px-3 py-2 text-slate-700">{finding.partyName || '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatBs(finding.taxableBaseBs)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-rose-700">{formatBs(finding.recordedVatBs)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{formatBs(finding.correctVatBs)}</td>
                          <td className="px-3 py-2 text-right tabular-nums font-semibold text-amber-800">{formatBs(finding.overstatedVatBs)}</td>
                          <td className="px-3 py-2 text-slate-700">
                            <div>{effectLabel[finding.vatEffect] || finding.vatEffect}</div>
                            <div className="text-[11px] text-slate-500">{luxuryLabel[finding.luxuryTaxTreatment] || finding.luxuryTaxTreatment}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-200 px-4 py-3">
                  <h3 className="font-semibold text-slate-900">Propuesta de ajuste contable (no registrada)</h3>
                  <p className="text-xs text-slate-500">
                    El ajuste se propone como asiento nuevo en período abierto. No se aplica desde esta vista y no modifica históricos.
                  </p>
                </div>
                <div className="space-y-3 p-4 text-sm text-slate-700">
                  {result.blockedReason ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-950">
                      <div className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4" /> No se puede proponer fecha de ajuste</div>
                      <p className="mt-1 text-xs">{result.blockedReason}</p>
                    </div>
                  ) : result.adjustment ? (
                    <>
                      <div className="grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Fecha propuesta</div><div className="font-semibold text-slate-900">{result.adjustment.date}</div></div>
                        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Total debe</div><div className="font-semibold text-slate-900">{formatBs(totals.totalAdjustmentDebitBs)}</div></div>
                        <div className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">Total haber</div><div className="font-semibold text-slate-900">{formatBs(totals.totalAdjustmentCreditBs)}</div></div>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
                        <strong>Motivo:</strong> {result.adjustment.reason}
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 text-slate-600">
                            <tr>
                              <th className="px-3 py-2">Cuenta</th>
                              <th className="px-3 py-2">Descripción</th>
                              <th className="px-3 py-2 text-right">Debe</th>
                              <th className="px-3 py-2 text-right">Haber</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.adjustment.lines.map((line, index) => (
                              <tr key={line.accountCode + '-' + index} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-slate-700"><span className="font-mono">{line.accountCode}</span> <span className="text-slate-500">{line.accountName}</span></td>
                                <td className="px-3 py-2 text-slate-700">{line.description}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{line.debitBs > 0 ? formatBs(line.debitBs) : '—'}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{line.creditBs > 0 ? formatBs(line.creditBs) : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
