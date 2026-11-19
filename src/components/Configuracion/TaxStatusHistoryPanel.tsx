import React, { useMemo, useState } from 'react';
import { CalendarClock, Plus, Save, ShieldCheck } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { CompanyTaxStatusPeriod, IvaTaxStatus, SpecialTaxpayerStatus, IvaRetentionAgentBasis } from '../../types/accounting';

const newDraft = (company: ReturnType<typeof useAccounting>['currentCompany']) => ({
  effectiveFrom: '', effectiveTo: '',
  ivaTaxStatus: 'ORDINARIO' as IvaTaxStatus,
  specialTaxpayerStatus: (company.taxpayerType === 'ESPECIAL' ? 'ESPECIAL' : 'NO_ESPECIAL') as SpecialTaxpayerStatus,
  ivaRetentionAgentBasis: (company.ivaRetentionAgentBasis || 'UNCONFIRMED') as IvaRetentionAgentBasis,
  defaultIvaRetentionRate: (company.defaultIvaRetentionRate === 100 ? 100 : company.defaultIvaRetentionRate === 75 ? 75 : 0) as 0 | 75 | 100,
  isIgtfPerceptionAgent: company.isIgtfPerceptionAgent === true,
  isPersonalFirm: company.isPersonalFirm === true,
  notificationReference: company.specialTaxpayerNotificationReference || '',
  notificationDate: company.specialTaxpayerNotificationDate || '',
  supportingDocumentReference: '', notes: ''
});

export const TaxStatusHistoryPanel: React.FC = () => {
  const { currentCompany, updateCompany, waitForPersistence, isStorageReady } = useAccounting();
  const [draft, setDraft] = useState(() => newDraft(currentCompany));
  const [periods, setPeriods] = useState<CompanyTaxStatusPeriod[]>(currentCompany.taxStatusHistory || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  React.useEffect(() => {
    setPeriods(currentCompany.taxStatusHistory || []);
    setDraft(newDraft(currentCompany));
    setError(''); setSuccess(false);
  }, [currentCompany.id]);
  const ordered = useMemo(() => [...periods].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom)), [periods]);
  const setField = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft(previous => ({ ...previous, [key]: value }));
  const updateEnd = (id: string, effectiveTo: string) => setPeriods(previous => previous.map(item => item.id === id ? { ...item, effectiveTo: effectiveTo || undefined } : item));
  const addPeriod = () => {
    setError(''); setSuccess(false);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.effectiveFrom)) { setError('Indique una fecha inicial de vigencia válida.'); return; }
    if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom) { setError('La fecha final no puede ser anterior a la fecha inicial.'); return; }
    if (draft.specialTaxpayerStatus === 'ESPECIAL' && (!draft.notificationReference.trim() || !draft.notificationDate)) { setError('La condición de Sujeto Pasivo Especial requiere referencia y fecha de notificación.'); return; }
    if (['ARTICLE_1_SPECIAL_DESIGNATED', 'ARTICLE_1_AND_2'].includes(draft.ivaRetentionAgentBasis) && draft.specialTaxpayerStatus !== 'ESPECIAL') { setError('La designación del artículo 1 requiere que el tramo esté calificado como Sujeto Pasivo Especial.'); return; }
    if (draft.specialTaxpayerStatus === 'NO_ESPECIAL' && !draft.supportingDocumentReference.trim() && !draft.notificationReference.trim()) { setError('Para registrar la pérdida o revocación de la condición especial, indique la referencia del acto o documento que la respalda. No se presume por un cambio normativo.'); return; }
    const candidate: CompanyTaxStatusPeriod = { ...draft, id: 'tax-period-' + crypto.randomUUID(), effectiveTo: draft.effectiveTo || undefined, notificationReference: draft.notificationReference.trim() || undefined, supportingDocumentReference: draft.supportingDocumentReference.trim() || undefined, notes: draft.notes.trim() || undefined, recordedAt: new Date().toISOString() };
    const all = [...periods, candidate].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    for (let i=0;i<all.length-1;i++) {
      const end = all[i].effectiveTo || '9999-12-31';
      if (end >= all[i+1].effectiveFrom) { setError('Hay períodos superpuestos. Cierre el tramo anterior el día previo al inicio del nuevo período.'); return; }
    }
    setPeriods(all);
    setDraft({ ...newDraft(currentCompany), effectiveFrom: '', effectiveTo: '' });
  };
  const save = async () => {
    setBusy(true); setError(''); setSuccess(false);
    try {
      const all = [...periods].sort((a,b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
      for (let i=0;i<all.length;i++) {
        if (!all[i].effectiveFrom || (all[i].effectiveTo && all[i].effectiveTo < all[i].effectiveFrom)) throw new Error('Revise las fechas de vigencia de los períodos.');
        if (i < all.length-1 && (!all[i].effectiveTo || all[i].effectiveTo >= all[i+1].effectiveFrom)) throw new Error('Los períodos deben estar cerrados y no superponerse.');
      }
      await updateCompany({ ...currentCompany, taxStatusHistory: all });
      await waitForPersistence();
      setSuccess(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el historial tributario en SQLite.'); }
    finally { setBusy(false); }
  };
  const labelIva = (value: IvaTaxStatus) => ({ORDINARIO:'Contribuyente ordinario',FORMAL:'Contribuyente formal',NO_SUJETO:'No sujeto',EXENTO:'Exento',EXONERADO:'Exonerado',PENDIENTE:'Pendiente de confirmar'}[value]);
  return <section className="rounded-2xl border border-violet-200 bg-white p-5 shadow-sm space-y-4">
    <div className="flex items-start gap-3"><div className="rounded-xl bg-violet-50 p-2 text-violet-700"><CalendarClock className="h-5 w-5"/></div><div><h3 className="font-bold text-sm text-slate-900">Historial de condición tributaria por vigencia</h3><p className="mt-1 text-xs text-slate-600">Registra cada tramo de esta empresa. Puedes manejar varios cambios durante un ejercicio y fechas distintas en cada empresa.</p></div></div>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-900">Este historial documenta condiciones y sus fechas; no recalifica automáticamente a la empresa ni modifica facturas, retenciones, declaraciones o asientos anteriores. La pérdida de la calificación especial debe respaldarse con el acto o notificación individual aplicable.</div>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="text-xs font-semibold text-slate-700">Vigente desde<input type="date" value={draft.effectiveFrom} onChange={e=>setField('effectiveFrom',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="text-xs font-semibold text-slate-700">Vigente hasta (opcional)<input type="date" value={draft.effectiveTo} min={draft.effectiveFrom || undefined} onChange={e=>setField('effectiveTo',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="text-xs font-semibold text-slate-700">Condición frente al IVA<select value={draft.ivaTaxStatus} onChange={e=>setField('ivaTaxStatus',e.target.value as IvaTaxStatus)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="ORDINARIO">Contribuyente ordinario</option><option value="FORMAL">Contribuyente formal</option><option value="NO_SUJETO">No sujeto</option><option value="EXENTO">Exento</option><option value="EXONERADO">Exonerado</option><option value="PENDIENTE">Pendiente de confirmar</option></select></label>
      <label className="text-xs font-semibold text-slate-700">Calificación como Sujeto Pasivo Especial<select value={draft.specialTaxpayerStatus} onChange={e=>setField('specialTaxpayerStatus',e.target.value as SpecialTaxpayerStatus)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="ESPECIAL">Sujeto Pasivo Especial</option><option value="NO_ESPECIAL">No calificado / revocado con respaldo</option><option value="PENDIENTE">Pendiente de confirmar</option></select></label>
      <label className="text-xs font-semibold text-slate-700">Agente de retención IVA<select value={draft.ivaRetentionAgentBasis} onChange={e=>setField('ivaRetentionAgentBasis',e.target.value as IvaRetentionAgentBasis)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="UNCONFIRMED">Pendiente de confirmar</option><option value="ARTICLE_1_SPECIAL_DESIGNATED">Artículo 1 — Sujeto especial designado</option><option value="ARTICLE_2_METALS">Artículo 2 — Metales / piedras preciosas</option><option value="ARTICLE_1_AND_2">Artículos 1 y 2</option><option value="NOT_AGENT">No es agente</option></select></label>
      <label className="text-xs font-semibold text-slate-700">Porcentaje predeterminado de retención IVA<select value={draft.defaultIvaRetentionRate} onChange={e=>setField('defaultIvaRetentionRate',Number(e.target.value) as 0|75|100)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value={0}>0%</option><option value={75}>75%</option><option value={100}>100%</option></select></label>
      <label className="text-xs font-semibold text-slate-700">Referencia de notificación / acto<input value={draft.notificationReference} onChange={e=>setField('notificationReference',e.target.value)} placeholder="Número de oficio o resolución" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="text-xs font-semibold text-slate-700">Fecha de notificación<input type="date" value={draft.notificationDate} onChange={e=>setField('notificationDate',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Documento soporte / ubicación de expediente<input value={draft.supportingDocumentReference} onChange={e=>setField('supportingDocumentReference',e.target.value)} placeholder="Nombre del archivo, número de expediente o referencia" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Observaciones profesionales<textarea rows={2} value={draft.notes} onChange={e=>setField('notes',e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"/></label>
      <label className="flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={draft.isPersonalFirm} onChange={e=>setField('isPersonalFirm',e.target.checked)}/> Persona natural constituida como firma personal durante este período</label><label className="flex items-center gap-2 text-xs font-medium text-slate-700"><input type="checkbox" checked={draft.isIgtfPerceptionAgent} onChange={e=>setField('isIgtfPerceptionAgent',e.target.checked)}/> Designada agente de percepción IGTF durante este período</label>
    </div>
    <div className="flex justify-end"><button type="button" onClick={addPeriod} className="inline-flex items-center gap-2 rounded-lg bg-violet-700 px-4 py-2 text-xs font-bold text-white hover:bg-violet-800"><Plus className="h-4 w-4"/>Agregar período al borrador</button></div>
    <div className="space-y-2"><h4 className="text-xs font-bold text-slate-800">Períodos registrados / pendientes de guardar ({ordered.length})</h4>
      {ordered.length===0 && <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500">Todavía no hay períodos históricos. Registra el primer tramo con su fecha real de inicio; no se asigna una fecha automáticamente.</p>}
      {ordered.map((item,index)=><div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-xs text-slate-800">Período {index+1}: {item.effectiveFrom} → {item.effectiveTo || 'Sin fecha final'}</strong><span className="text-[10px] font-semibold text-violet-800">{item.specialTaxpayerStatus==='ESPECIAL'?'Sujeto especial':item.specialTaxpayerStatus==='NO_ESPECIAL'?'No especial':'Condición pendiente'}</span></div><p className="text-[11px] text-slate-600">IVA: {labelIva(item.ivaTaxStatus)} · Agente IVA: {item.ivaRetentionAgentBasis} · Retención: {item.defaultIvaRetentionRate}% · Firma personal: {item.isPersonalFirm?'Sí':'No'} · IGTF: {item.isIgtfPerceptionAgent?'Sí':'No'}</p><label className="block text-[11px] font-semibold text-slate-700">Fecha final del período (edítela para cerrar el tramo antes de agregar el siguiente)<input type="date" value={item.effectiveTo || ''} min={item.effectiveFrom} onChange={e=>updateEnd(item.id,e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/></label>{item.notificationReference && <p className="text-[10px] text-slate-500">Acto: {item.notificationReference} · Notificado: {item.notificationDate || 'sin fecha'}</p>}{item.notes && <p className="text-[10px] text-slate-500">{item.notes}</p>}</div>)}
    </div>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}{success && <p className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">Historial tributario guardado y confirmado en SQLite.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><p className="flex items-center gap-1 text-[10px] text-slate-500"><ShieldCheck className="h-3.5 w-3.5"/> Datos aislados por empresa</p><button type="button" onClick={save} disabled={busy || !isStorageReady} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-50"><Save className="h-4 w-4"/>{busy?'Guardando SQLite…':'Guardar historial tributario'}</button></div>
  </section>;
};
