import React, { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { PurchaseRecord } from '../../types/accounting';
import { GuidedErrorNotice } from '../shared/GuidedErrorNotice';
import { GUIDED_ENTRY_TITLES } from '../../types/guidedEntryErrors';

interface Props { purchase: PurchaseRecord; onClose: () => void; }

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const PurchaseServiceCreditNoteModal: React.FC<Props> = ({ purchase, onClose }) => {
  const { addPurchaseServiceCreditNote, isStorageReady, storageError } = useAccounting();
  const [noteDate, setNoteDate] = useState(today);
  const [creditNoteNumber, setCreditNoteNumber] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  const [taxableBaseBs, setTaxableBaseBs] = useState('0');
  const [exemptAmountBs, setExemptAmountBs] = useState('0');
  const [reason, setReason] = useState('');
  const [workpaperNote, setWorkpaperNote] = useState('');
  const [fiscalEmissionMedium, setFiscalEmissionMedium] = useState<'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | ''>('');
  const [sameMediumAsOriginal, setSameMediumAsOriginal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const sqliteAvailable = typeof window !== 'undefined' && Boolean(window.sicovenStore?.save);
  const eligible = purchase.documentType === '01' && !purchase.isCancelled &&
    !purchase.inventoryLines?.length && ['CREDITO', 'CONTADO'].includes(purchase.paymentTerm || '') &&
    Number(purchase.vatWithheldBs || 0) === 0 && Number(purchase.islrWithheldBs || 0) === 0 &&
    Number(purchase.igtfAmountBs || 0) === 0 && !purchase.igtfApplicable;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    if (!sqliteAvailable || !isStorageReady) {
      setError(storageError || 'SQLite local no está disponible. No se puede registrar la NC.');
      return;
    }
    if (!eligible) {
      setError('Esta factura no es elegible para la NC de servicios. Revise inventario, retenciones, IGTF y modalidad de pago.');
      return;
    }
    setSubmitting(true);
    try {
      await addPurchaseServiceCreditNote({
        purchaseId: purchase.id, noteDate, creditNoteNumber, controlNumber,
        taxableBaseBs: Number(taxableBaseBs), exemptAmountBs: Number(exemptAmountBs),
        bcvRate: Number(purchase.bcvRate), reason, workpaperNote,
        fiscalEmissionMedium: fiscalEmissionMedium as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY', sameMediumAsOriginal
      });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la NC de servicios en SQLite.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[76] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Nota de crédito de servicios">
      <form onSubmit={submit} className="max-h-[95vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-900">NC de compra de servicios</h2><p className="mt-1 text-xs text-slate-500">Factura {purchase.invoiceNumber} · {purchase.supplierName}</p>
            <p className="mt-1 text-[11px] text-slate-500">Fecha original: {purchase.invoiceDate} · Control: {purchase.controlNumber} · Monto original: Bs. {purchase.totalAmountBs.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}</p></div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><p>Solo para servicios imputados a cuentas de costos/gastos, sin inventario, retenciones ni IGTF. Para evitar diferencias cambiarias no conciliadas, se conserva la tasa contable de la factura. El excedente del crédito sobre la CxP se registra como anticipo a proveedor.</p></div>
        </div>
        {!eligible && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">Esta factura no cumple los requisitos del flujo de NC de servicios.</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Fecha de la NC<input required type="date" min={purchase.invoiceDate} value={noteDate} onChange={e=>setNoteDate(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Número de NC<input required value={creditNoteNumber} onChange={e=>setCreditNoteNumber(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Número de control<input required value={controlNumber} onChange={e=>setControlNumber(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Tasa BCV original<input readOnly value={purchase.bcvRate} className="mt-1 w-full rounded-lg border bg-slate-50 p-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Base imponible a disminuir (Bs.)<input required type="number" min="0" step="0.01" value={taxableBaseBs} onChange={e=>setTaxableBaseBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
          <label className="text-xs font-semibold text-slate-700">Monto exento a disminuir (Bs.)<input required type="number" min="0" step="0.01" value={exemptAmountBs} onChange={e=>setExemptAmountBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
        </div>
        <label className="block text-xs font-semibold text-slate-700">Medio de emisión utilizado por la factura original
          <select required value={fiscalEmissionMedium} onChange={e=>setFiscalEmissionMedium(e.target.value as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | '')} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal">
            <option value="">Seleccione el medio original…</option><option value="DIGITAL">Digital / electrónico</option><option value="FISCAL_MACHINE">Máquina fiscal</option><option value="CONTINGENCY">Formato de contingencia autorizado</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={sameMediumAsOriginal} onChange={e=>setSameMediumAsOriginal(e.target.checked)} className="mt-0.5" />
          Confirmo que la NC se emitió por el mismo medio utilizado para la factura original, conforme a la Providencia SNAT/2026/00093
        </label>
        <label className="block text-xs font-semibold text-slate-700">Motivo de la NC<textarea required minLength={10} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
        <label className="block text-xs font-semibold text-slate-700">Papel de trabajo y soporte revisado<textarea required minLength={10} value={workpaperNote} onChange={e=>setWorkpaperNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" /></label>
        {error && <GuidedErrorNotice title={GUIDED_ENTRY_TITLES.purchaseServiceCreditNote} message={error} onDismiss={() => setError('')} />}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={submitting || !eligible || !sqliteAvailable || !isStorageReady || !fiscalEmissionMedium || !sameMediumAsOriginal} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Confirmando SQLite…' : 'Registrar NC'}</button></div>
      </form>
    </div>
  );
};
