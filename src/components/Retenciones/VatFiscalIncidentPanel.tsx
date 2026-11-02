import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ClipboardList, RefreshCw } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import { VatFiscalIncident, VatFiscalIncidentEventInput } from '../../types/vatFiscalIncidents';

export const VatFiscalIncidentPanel: React.FC = () => {
  const { currentCompany, purchases, vatVouchers, listVatFiscalIncidents, createVatFiscalIncident, recordVatFiscalIncidentEvent } = useAccounting();
  const [incidents, setIncidents] = useState<VatFiscalIncident[]>([]);
  const [selectedPurchaseId, setSelectedPurchaseId] = useState('');
  const [reason, setReason] = useState('');
  const [eventDrafts, setEventDrafts] = useState<Record<string, { eventType: 'REVIEW_RECORDED' | 'ACTION_RECORDED'; decisionText: string; externalReference: string }>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try { setIncidents(await listVatFiscalIncidents()); }
    catch (e) { setError(e instanceof Error ? e.message : 'No fue posible consultar el expediente SQLite.'); }
    finally { setLoading(false); }
  }, [listVatFiscalIncidents]);

  useEffect(() => { void refresh(); }, [refresh, currentCompany.id]);

  const eligiblePurchases = purchases.filter(p => p.companyId === currentCompany.id && ['02', '03'].includes(String(p.documentType || '')));
  const registerIncident = async () => {
    if (!selectedPurchaseId || reason.trim().length < 15) {
      setError('Seleccione una nota de débito/crédito y explique el motivo con al menos 15 caracteres.');
      return;
    }
    const purchase = purchases.find(p => p.id === selectedPurchaseId);
    if (!purchase) return;
    const originalId = purchase.documentType === '01' ? purchase.id : purchase.originalPurchaseId;
    const voucher = vatVouchers.find(v => v.companyId === currentCompany.id && v.purchaseRecordId === originalId);
    setSaving(true); setError(''); setNotice('');
    try {
      const created = await createVatFiscalIncident({
        purchaseId: purchase.id,
        ...(voucher ? { vatVoucherId: voucher.id } : {}),
        reason: reason.trim(),
        detectedAt: new Date().toISOString().slice(0, 10)
      });
      setIncidents(previous => [created, ...previous.filter(item => item.id !== created.id)]);
      setSelectedPurchaseId(''); setReason('');
      setNotice('Incidencia registrada en SQLite. El comprobante original permanece bloqueado para exportación.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No fue posible registrar la incidencia.'); }
    finally { setSaving(false); }
  };

  const recordEvent = async (incident: VatFiscalIncident) => {
    const draft = eventDrafts[incident.id];
    if (!draft || draft.decisionText.trim().length < 20) {
      setError('La revisión o actuación debe describirse con al menos 20 caracteres.');
      return;
    }
    setSaving(true); setError(''); setNotice('');
    try {
      const input: VatFiscalIncidentEventInput = {
        incidentId: incident.id,
        eventType: draft.eventType,
        decisionText: draft.decisionText.trim(),
        ...(draft.externalReference.trim() ? { externalReference: draft.externalReference.trim() } : {})
      };
      const updated = await recordVatFiscalIncidentEvent(input);
      setIncidents(previous => previous.map(item => item.id === updated.id ? updated : item));
      setEventDrafts(previous => ({ ...previous, [incident.id]: { ...draft, decisionText: '', externalReference: '' } }));
      setNotice('Evento incorporado al historial inmutable. La incidencia sigue abierta y el TXT no se desbloquea por este registro.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No fue posible registrar el evento.'); }
    finally { setSaving(false); }
  };

  return <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-700" /><h3 className="font-bold text-slate-900">Expediente de rectificación IVA</h3></div>
      <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw className="h-3.5 w-3.5" /> Actualizar</button>
    </div>
    <p className="text-xs text-slate-700">Registre incidencias vinculadas a notas de débito/crédito y documente revisiones o actuaciones. Todo se guarda en SQLite; estos eventos no resuelven automáticamente la obligación fiscal ni liberan el TXT.</p>
    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]">
      <select value={selectedPurchaseId} onChange={e => setSelectedPurchaseId(e.target.value)} className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs">
        <option value="">Seleccione nota ND/NC…</option>
        {eligiblePurchases.map(p => <option key={p.id} value={p.id}>{p.documentType === '02' ? 'ND' : 'NC'} · {p.creditNoteNumber || p.debitNoteNumber || p.invoiceNumber || p.id} · {p.supplierName}</option>)}
      </select>
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Motivo de la incidencia (mínimo 15 caracteres)" className="min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs" />
      <button type="button" onClick={() => void registerIncident()} disabled={saving || !selectedPurchaseId || reason.trim().length < 15} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Registrar incidencia</button>
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-100 p-2 text-xs text-rose-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-100 p-2 text-xs text-emerald-800">{notice}</p>}
    {loading ? <p className="text-xs text-slate-600">Consultando SQLite…</p> : incidents.length === 0 ? <p className="text-xs text-slate-600">No hay incidencias registradas para esta empresa.</p> :
      <div className="space-y-3">{incidents.map(incident => {
        const draft = eventDrafts[incident.id] || { eventType: 'REVIEW_RECORDED' as const, decisionText: '', externalReference: '' };
        return <article key={incident.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div><p className="text-xs font-bold text-slate-900">{incident.documentType === '03' ? 'Nota de crédito' : 'Nota de débito'} · {incident.documentNumber}</p><p className="text-[11px] text-slate-500">Factura original: {incident.affectedInvoiceNumber || incident.originalPurchaseId} · Detectada: {incident.detectedAt}</p><p className="mt-1 text-xs text-slate-700">{incident.reason}</p></div>
            <span className="rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800">{incident.status.replaceAll('_', ' ')}</span>
          </div>
          <div className="rounded-md bg-slate-50 p-2 text-[11px] text-slate-600"><ClipboardList className="mr-1 inline h-3.5 w-3.5" /> {incident.events.length} eventos · {incident.vatVoucherId ? 'Comprobante IVA vinculado' : 'Sin comprobante IVA vinculado'} · Incidencia abierta</div>
          {incident.events.map(event => <div key={event.id} className="border-l-2 border-slate-300 pl-2 text-[11px]"><strong>{event.eventType.replaceAll('_', ' ')}</strong> · {event.createdAt} · {event.actorUsername}<p>{event.decisionText}</p>{event.externalReference && <p className="text-slate-500">Referencia: {event.externalReference}</p>}</div>)}
          <div className="grid gap-2 md:grid-cols-[150px_minmax(0,2fr)_minmax(0,1fr)_auto]">
            <select value={draft.eventType} onChange={e => setEventDrafts(p => ({ ...p, [incident.id]: { ...draft, eventType: e.target.value as typeof draft.eventType } }))} className="rounded border border-slate-300 px-2 py-2 text-xs"><option value="REVIEW_RECORDED">Registrar revisión</option><option value="ACTION_RECORDED">Registrar actuación</option></select>
            <input value={draft.decisionText} onChange={e => setEventDrafts(p => ({ ...p, [incident.id]: { ...draft, decisionText: e.target.value } }))} placeholder="Fundamento y resultado documentado (mín. 20 caracteres)" className="min-w-0 rounded border border-slate-300 px-2 py-2 text-xs" />
            <input value={draft.externalReference} onChange={e => setEventDrafts(p => ({ ...p, [incident.id]: { ...draft, externalReference: e.target.value } }))} placeholder="Referencia (opcional)" className="min-w-0 rounded border border-slate-300 px-2 py-2 text-xs" />
            <button type="button" onClick={() => void recordEvent(incident)} disabled={saving || draft.decisionText.trim().length < 20} className="rounded bg-slate-800 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Guardar evento</button>
          </div>
        </article>;
      })}</div>}
    <p className="text-[11px] font-semibold text-amber-900">Control de seguridad: esta pantalla no ofrece botón de “resolver”. La incidencia y el bloqueo del comprobante solo podrán cerrarse cuando exista una política de conciliación fiscal verificable.</p>
  </section>;
};
