import React, { useState } from 'react';
import type { SaleRecord } from '../../types/accounting';
import type { SaleCorrectionNoteRequest } from '../../types/saleCorrectionNote';
import type { Account } from '../../types/accounting';

type Draft = Omit<SaleCorrectionNoteRequest, 'sourceSale' | 'priorCreditNotes' | 'closedThroughDate'> & { sourceSaleId: string };

interface Props {
  sourceSale: SaleRecord;
  kind: 'CREDIT' | 'DEBIT';
  bcvRate: number;
  treasuryAccounts: Account[];
  onClose: () => void;
  onSubmit: (draft: Draft) => Promise<unknown>;
}

export const SaleCorrectionNoteModal: React.FC<Props> = ({ sourceSale, kind, bcvRate, treasuryAccounts, onClose, onSubmit }) => {
  const today = new Date().toISOString().slice(0, 10);
  const [noteDate, setNoteDate] = useState(today);
  const [noteBcvRate, setNoteBcvRate] = useState(String(bcvRate || sourceSale.bcvRate || ''));
  const rateRequired = isBcvRateRequiredForDate(noteDate);
  const [fiscalEmissionMedium, setFiscalEmissionMedium] = useState<'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | ''>(sourceSale.fiscalEmissionMedium || '');
  const [sameMediumAsOriginal, setSameMediumAsOriginal] = useState(sourceSale.sameMediumAsOriginal === true);
  const [noteNumber, setNoteNumber] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  const [taxableBaseBs, setTaxableBaseBs] = useState('0');
  const [exemptAmountBs, setExemptAmountBs] = useState('0');
  const [reason, setReason] = useState('');
  const [workpaperNote, setWorkpaperNote] = useState('');
  const [treasuryAccountCode, setTreasuryAccountCode] = useState('');
  const [returnedInventoryQuantities, setReturnedInventoryQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries([...new Set((sourceSale.inventoryLines || []).map(line => line.productId))].map(id => [id, '0']))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const parseAmount = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); };
  const inventoryReturnOptions = Object.values((sourceSale.inventoryLines || []).reduce((groups, line) => {
    const current = groups[line.productId] || { productId: line.productId, productName: line.productName, quantity: 0, netAmountBs: 0, exemptAmountBs: 0 };
    current.quantity += Number(line.quantity || 0);
    current.netAmountBs += Number(line.netAmountBs || 0);
    current.exemptAmountBs += Number(line.exemptAmountBs || 0);
    groups[line.productId] = current;
    return groups;
  }, {} as Record<string, { productId: string; productName: string; quantity: number; netAmountBs: number; exemptAmountBs: number }>));
  const updateReturnedQuantity = (productId: string, value: string) => {
    const next = { ...returnedInventoryQuantities, [productId]: value };
    setReturnedInventoryQuantities(next);
    if (kind !== 'CREDIT' || inventoryReturnOptions.length === 0) return;
    let taxable = 0;
    let exempt = 0;
    for (const line of inventoryReturnOptions) {
      const returned = Math.min(line.quantity, Math.max(0, parseAmount(next[line.productId] || '0')));
      const ratio = line.quantity > 0 ? returned / line.quantity : 0;
      taxable += line.netAmountBs * ratio;
      exempt += line.exemptAmountBs * ratio;
    }
    setTaxableBaseBs(taxable.toFixed(2));
    setExemptAmountBs(exempt.toFixed(2));
  };


  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        kind, sourceSaleId: sourceSale.id, noteDate, noteNumber, controlNumber,
        taxableBaseBs: parseAmount(taxableBaseBs), exemptAmountBs: parseAmount(exemptAmountBs),
        bcvRate: parseAmount(noteBcvRate), reason, workpaperNote,
        fiscalEmissionMedium: fiscalEmissionMedium as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY', sameMediumAsOriginal,
        treasuryAccountCode: treasuryAccountCode || undefined,
        returnedInventoryQuantities: inventoryReturnOptions.length ? Object.fromEntries(Object.entries(returnedInventoryQuantities).map(([id, value]) => [id, parseAmount(value)])) : undefined
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
            <p className="mt-1 text-[11px] text-slate-500">Fecha original: {sourceSale.invoiceDate} · Control: {sourceSale.controlNumber} · Monto original: Bs. {sourceSale.totalAmountBs.toLocaleString('es-VE', {minimumFractionDigits:2, maximumFractionDigits:2})}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-3 py-1.5 text-xs">Cerrar</button>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
          La nota conserva el vínculo con la factura original. Las retenciones, el impuesto adicional del 15% y el IGTF se calculan por separado. En mercancía, indique las unidades realmente devueltas; SICOVEN las concilia con el Kardex y el costo histórico. Si el cliente ya pagó, puede registrarse el reembolso desde la cuenta de tesorería seleccionada.
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
          <label className="text-xs font-semibold text-slate-700">Tasa BCV vigente en la fecha de emisión {rateRequired ? '*' : '(opcional antes de 2018)' }
            <input required={rateRequired} type="text" inputMode="decimal" value={noteBcvRate} onChange={e=>setNoteBcvRate(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Base imponible (Bs.)
            <input required type="text" inputMode="decimal" value={taxableBaseBs} readOnly={kind === "CREDIT" && inventoryReturnOptions.length > 0} onChange={e=>setTaxableBaseBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal read-only:bg-slate-50" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Monto exento (Bs.)
            <input required type="text" inputMode="decimal" value={exemptAmountBs} readOnly={kind === "CREDIT" && inventoryReturnOptions.length > 0} onChange={e=>setExemptAmountBs(e.target.value)} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal read-only:bg-slate-50" />
          </label>
        </div>
        {kind === 'CREDIT' && inventoryReturnOptions.length > 0 && <section className="rounded-xl border border-slate-200 p-3">
          <h3 className="text-xs font-bold text-slate-800">Mercancía devuelta físicamente</h3>
          <p className="mt-1 text-[11px] text-slate-500">Indique la cantidad por artículo. La base y el exento se calculan automáticamente según las líneas originales.</p>
          <div className="mt-2 space-y-2">
            {inventoryReturnOptions.map(line => <label key={line.productId} className="grid grid-cols-[1fr_100px] items-center gap-3 text-xs">
              <span>{line.productName}<span className="ml-1 text-slate-500">({line.quantity} vendidas)</span></span>
              <input type="number" min="0" max={line.quantity} step="0.001" value={returnedInventoryQuantities[line.productId] || '0'} onChange={event=>updateReturnedQuantity(line.productId,event.target.value)} className="w-full rounded-lg border p-2 text-right" />
            </label>)}
          </div>
        </section>}
        <label className="block text-xs font-semibold text-slate-700">Cuenta de tesorería para cobro o reembolso (cuando aplique)
          <select value={treasuryAccountCode} onChange={event=>setTreasuryAccountCode(event.target.value)} required={sourceSale.paymentTerm === 'CONTADO'} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal">
            <option value="">Seleccione cuenta si aplica…</option>
            {treasuryAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
          </select>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Medio de emisión utilizado por la factura original
          <select required value={fiscalEmissionMedium} onChange={e=>setFiscalEmissionMedium(e.target.value as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | '')} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal">
            <option value="">Seleccione el medio original…</option><option value="DIGITAL">Digital / electrónico</option><option value="FISCAL_MACHINE">Máquina fiscal</option><option value="CONTINGENCY">Formato de contingencia autorizado</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={sameMediumAsOriginal} onChange={e=>setSameMediumAsOriginal(e.target.checked)} className="mt-0.5" />
          Confirmo que esta nota se emitió por el mismo medio utilizado para la factura original, conforme a la Providencia SNAT/2026/00093
        </label>
        <label className="block text-xs font-semibold text-slate-700">Motivo de la corrección
          <textarea required minLength={10} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
        </label>
        <label className="block text-xs font-semibold text-slate-700">Papel de trabajo y soporte revisado
          <textarea value={workpaperNote} onChange={e=>setWorkpaperNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border p-2.5 text-sm font-normal" />
        </label>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" disabled={submitting || !fiscalEmissionMedium || !sameMediumAsOriginal || (sourceSale.paymentTerm === 'CONTADO' && !treasuryAccountCode)} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{submitting ? 'Confirmando SQLite…' : 'Registrar y confirmar'}</button>
        </div>
      </form>
    </div>
  );
};
