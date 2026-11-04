import React, { useState } from 'react';
import type { SaleRecord } from '../../types/accounting';
import type { SaleCorrectionNoteRequest } from '../../types/saleCorrectionNote';

type Draft = Omit<SaleCorrectionNoteRequest, 'sourceSale' | 'priorCreditNotes' | 'closedThroughDate'> & { sourceSaleId: string };

interface Props {
  sourceSale: SaleRecord;
  kind: 'CREDIT' | 'DEBIT';
  bcvRate: number;
  onClose: () => void;
  onSubmit: (draft: Draft) => Promise<unknown>;
}

export const SaleCorrectionNoteModal: React.FC<Props> = ({ sourceSale, kind, bcvRate, onClose, onSubmit }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [noteDate, setNoteDate] = useState(today);
  const [noteBcvRate, setNoteBcvRate] = useState(String(bcvRate));
  const [noteNumber, setNoteNumber] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  const [taxableBaseBs, setTaxableBaseBs] = useState('0');
  const [exemptAmountBs, setExemptAmountBs] = useState('0');
  const [reason, setReason] = useState('');
  const [workpaperNote, setWorkpaperNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        kind, sourceSaleId: sourceSale.id, noteDate, noteNumber, controlNumber,
        taxableBaseBs: Number(taxableBaseBs), exemptAmountBs: Number(exemptAmountBs),
        bcvRate: Number(noteBcvRate), reason, workpaperNote
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar la nota en SQLite.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] overflow-y-auto bg-slate-950/60 p-3" role="dialog" aria-modal="true" aria-label={kind === 'CREDIT' ? 'Nota de crédito de venta' : 'Nota de débito de venta'}>
      <form onSubmit={submit} className="mx-auto my-6 max-w-2xl space-y-4 rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{kind === 'CREDIT' ? 'Nueva nota de crédito de venta' : 'Nueva nota de débito de venta'}</h2>
            <p className="mt-1 text-xs text-slate-500">Factura afectada: {sourceSale.invoiceNumber} · {sourceSale.customerName}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-3 py-1.5 text-xs">Cerrar</button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          Solo se habilita para facturas a crédito sin retención IVA, IGTF ni movimientos de inventario vinculados. Los cobros previos limitan el monto de la NC al saldo exigible. Los casos excluidos permanecen bloqueados hasta contar con su circuito de reembolso, Kardex y rectificación fiscal.
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Fecha de emisión
            <input required type="date" min={sourceSale.invoiceDate} value={noteDate} onChange={e=>setNoteDate(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Número de nota
            <input required value={noteNumber} onChange={e=>setNoteNumber(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Número de control
            <input required value={controlNumber} onChange={e=>setControlNumber(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Tasa BCV vigente en la fecha de emisión
            <input required type="number" min="0.000001" step="0.000001" value={noteBcvRate} onChange={e=>setNoteBcvRate(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Base imponible (Bs.)
            <input required type="number" min="0" step="0.01" value={taxableBaseBs} onChange={e=>setTaxableBaseBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Monto exento (Bs.)
            <input required type="number" min="0" step="0.01" value={exemptAmountBs} onChange={e=>setExemptAmountBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Motivo de la corrección
          <textarea required minLength={10} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Papel de trabajo y soporte revisado
          <textarea required minLength={10} value={workpaperNote} onChange={e=>setWorkpaperNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
        </label>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={submitting} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Confirmando SQLite…' : 'Registrar y confirmar'}</button>
        </div>
      </form>
    </div>
  );
};
