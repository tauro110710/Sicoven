import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { JournalEntry } from '../../types/accounting';

interface JournalReversalModalProps {
  source: JournalEntry | null;
  onClose: () => void;
}

export const JournalReversalModal: React.FC<JournalReversalModalProps> = ({ source, onClose }) => {
  const { currentCompany, accounts, reverseJournalEntry } = useAccounting();
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [workpaperNote, setWorkpaperNote] = useState('');
  const [retainedEarningsAccountCode, setRetainedEarningsAccountCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceInClosedPeriod = Boolean(source && currentCompany.closedThroughDate && source.date <= currentCompany.closedThroughDate);
  const retainedAccounts = useMemo(() => accounts.filter(account => account.isMovement && account.type === 'PATRIMONIO'), [accounts]);

  if (!source) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await reverseJournalEntry(
        source.id,
        effectiveDate,
        reason,
        workpaperNote,
        sourceInClosedPeriod,
        sourceInClosedPeriod ? retainedEarningsAccountCode : undefined
      );
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible registrar la reversión.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="journal-reversal-title">
      <div className="mx-auto mt-6 max-w-2xl rounded-2xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 p-4">
          <h2 id="journal-reversal-title" className="text-base font-bold text-slate-900">Reversar asiento contable</h2>
          <p className="mt-1 text-xs text-slate-600">Asiento #{source.entryNumber} · {source.date} · {source.description}</p>
          <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">El asiento original se conservará. Se generará un contra-asiento enlazado; los efectos fiscales y auxiliares relacionados quedarán sujetos a sus controles específicos.</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Fecha efectiva del contra-asiento *</label>
            <input type="date" required min={source.date} value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {currentCompany.closedThroughDate && <p className="mt-1 text-[11px] text-slate-500">Período cerrado hasta: {currentCompany.closedThroughDate}. La reversión debe registrarse en un período abierto.</p>}
          </div>
          {sourceInClosedPeriod && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Cuenta de resultados acumulados para AIA *</label>
              <select required value={retainedEarningsAccountCode} onChange={event => setRetainedEarningsAccountCode(event.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
                <option value="">Seleccione cuenta patrimonial</option>
                {retainedAccounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-amber-700">El asiento pertenece a un período cerrado: se tratará como Ajuste de Ejercicio Anterior (AIA). Verifique que la cuenta seleccionada corresponda a resultados acumulados.</p>
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Motivo y causa de la reversión * (mínimo 10 caracteres)</label>
            <textarea required minLength={10} value={reason} onChange={event => setReason(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explique el error, hecho u operación que origina la reversión." />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700">Papel de trabajo / soporte de la decisión * (mínimo 10 caracteres)</label>
            <textarea required minLength={10} value={workpaperNote} onChange={event => setWorkpaperNote(event.target.value)} rows={3} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Indique soportes, conciliaciones, autorizaciones y análisis contable efectuado." />
          </div>
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>}
          <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">Cancelar</button>
            <button type="submit" disabled={submitting || reason.trim().length < 10 || workpaperNote.trim().length < 10 || (sourceInClosedPeriod && !retainedEarningsAccountCode)} className="rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Registrando y confirmando SQLite…' : 'Confirmar reversión'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
