import React, { useMemo, useState } from 'react';
import { CalendarClock, FileText, PlusCircle, ShieldCheck } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { Company, IvaRetentionAgentBasis, TaxpayerType } from '../../types/accounting';
import {
  resolveCompanyFiscalProfileAtDate,
  validateCompanyFiscalStatusHistory,
  type CompanyFiscalStatusDimension,
  type CompanyFiscalStatusEvent,
  type CompanyFiscalStatusValue
} from '../../types/companyFiscalStatus';

const DIMENSIONS: Array<{ value: CompanyFiscalStatusDimension; label: string }> = [
  { value: 'SENIAT_SPECIAL_TAXPAYER', label: 'Calificación SENIAT como Sujeto Pasivo Especial' },
  { value: 'IVA_TAX_STATUS', label: 'Condición del contribuyente frente al IVA' },
  { value: 'IVA_RETENTION_AGENT', label: 'Designación como agente de retención de IVA' },
  { value: 'IVA_PERSONAL_FIRM', label: 'Condición de firma personal (cuando aplique)' },
  { value: 'IGTF_PERCEPTION_AGENT', label: 'Designación como agente de percepción IGTF' }
];

const OPTIONS: Record<CompanyFiscalStatusDimension, Array<{ value: CompanyFiscalStatusValue; label: string }>> = {
  SENIAT_SPECIAL_TAXPAYER: [
    { value: 'ESPECIAL', label: 'Sujeto Pasivo Especial (con notificación)' },
    { value: 'ORDINARIO', label: 'No calificado como Sujeto Pasivo Especial' }
  ],
  IVA_TAX_STATUS: [
    { value: 'ORDINARY', label: 'Contribuyente ordinario' },
    { value: 'FORMAL', label: 'Contribuyente formal' },
    { value: 'EXEMPT', label: 'Exento' },
    { value: 'EXONERATED', label: 'Exonerado' },
    { value: 'NON_SUBJECT', label: 'No sujeto' },
    { value: 'UNKNOWN', label: 'Pendiente de confirmar' }
  ],
  IVA_RETENTION_AGENT: [
    { value: 'ARTICLE_1_SPECIAL_DESIGNATED', label: 'Agente designado — artículo 1' },
    { value: 'ARTICLE_2_METALS', label: 'Comprador habitual — artículo 2' },
    { value: 'ARTICLE_1_AND_2', label: 'Supuestos de los artículos 1 y 2' },
    { value: 'NOT_AGENT', label: 'No es agente de retención' },
    { value: 'UNCONFIRMED', label: 'Pendiente de confirmar' }
  ],
  IVA_PERSONAL_FIRM: [
    { value: 'FIRM', label: 'Constituida como firma personal' },
    { value: 'NOT_FIRM', label: 'No constituida como firma personal' }
  ],
  IGTF_PERCEPTION_AGENT: [
    { value: 'AGENT', label: 'Designada agente de percepción' },
    { value: 'NOT_AGENT', label: 'No es agente de percepción' }
  ]
};

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const statusLabel = (dimension: CompanyFiscalStatusDimension, status: string) =>
  OPTIONS[dimension].find(option => option.value === status)?.label || status;

export const CompanyFiscalStatusHistoryPanel: React.FC<{ company: Company }> = ({ company }) => {
  const { updateCompany, waitForPersistence } = useAccounting();
  const [dimension, setDimension] = useState<CompanyFiscalStatusDimension>('SENIAT_SPECIAL_TAXPAYER');
  const [status, setStatus] = useState<CompanyFiscalStatusValue>('ESPECIAL');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [authorityReference, setAuthorityReference] = useState('');
  const [authorityDate, setAuthorityDate] = useState('');
  const [supportingDocumentRef, setSupportingDocumentRef] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const history = company.fiscalStatusHistory || [];
  const current = useMemo(() => resolveCompanyFiscalProfileAtDate(company, today()), [company]);
  const ordered = useMemo(() => [...history].sort((a, b) =>
    b.effectiveDate.localeCompare(a.effectiveDate) || b.recordedAt.localeCompare(a.recordedAt)
  ), [history]);

  const changeDimension = (next: CompanyFiscalStatusDimension) => {
    setDimension(next);
    setStatus(OPTIONS[next][0].value);
    setError('');
    setMessage('');
  };

  const save = async () => {
    if (busy) return;
    const newEvent: CompanyFiscalStatusEvent = {
      id: crypto.randomUUID(),
      dimension,
      status,
      effectiveDate,
      ...(authorityReference.trim() ? { authorityReference: authorityReference.trim() } : {}),
      ...(authorityDate ? { authorityDate } : {}),
      ...(supportingDocumentRef.trim() ? { supportingDocumentRef: supportingDocumentRef.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      recordedAt: new Date().toISOString()
    };
    const nextHistory = [...history, newEvent];
    try {
      validateCompanyFiscalStatusHistory(history, nextHistory);
      setBusy(true);
      setError('');
      setMessage('');
      const profile = resolveCompanyFiscalProfileAtDate({ ...company, fiscalStatusHistory: nextHistory }, today());
      await updateCompany({
        ...company,
        fiscalStatusHistory: nextHistory,
        taxpayerType: profile.taxpayerType as TaxpayerType,
        ivaTaxStatus: profile.ivaTaxStatus,
        ivaRetentionAgentBasis: profile.ivaRetentionAgentBasis as IvaRetentionAgentBasis,
        isPersonalFirm: profile.isPersonalFirm,
        isIgtfPerceptionAgent: profile.isIgtfPerceptionAgent
      });
      await waitForPersistence();
      setAuthorityReference('');
      setAuthorityDate('');
      setSupportingDocumentRef('');
      setNotes('');
      setMessage('Cambio fiscal guardado y confirmado en SQLite. El historial anterior se conservó.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'No se pudo guardar el cambio fiscal.');
    } finally {
      setBusy(false);
    }
  };

  const priorSeniatStatus = [...history]
    .filter(item => item.dimension === 'SENIAT_SPECIAL_TAXPAYER')
    .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    .at(-1)?.status || company.taxpayerType;
  const specialNoticeRequired = dimension === 'SENIAT_SPECIAL_TAXPAYER' &&
    (status === 'ESPECIAL' || priorSeniatStatus === 'ESPECIAL');

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-800"><CalendarClock className="h-5 w-5" /></div>
        <div>
          <h3 className="text-sm font-bold text-slate-900">Historial de condiciones fiscales por fecha</h3>
          <p className="mt-1 text-xs text-slate-600">Registre cada cambio con su fecha efectiva y en orden cronológico. Las condiciones se mantienen separadas; SICOVEN aplica por fecha las que intervienen en validaciones habilitadas. La categoría IVA queda documentada sin recalcular automáticamente alícuotas ni declaraciones.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg bg-white border border-slate-200 p-3"><span className="block text-slate-500">Sujeto Pasivo Especial hoy</span><strong>{current.taxpayerType === 'ESPECIAL' ? 'Sí, con calificación especial' : 'No calificado como especial'}</strong></div>
        <div className="rounded-lg bg-white border border-slate-200 p-3"><span className="block text-slate-500">Condición frente al IVA hoy</span><strong>{statusLabel('IVA_TAX_STATUS', current.ivaTaxStatus)}</strong></div>
        <div className="rounded-lg bg-white border border-slate-200 p-3"><span className="block text-slate-500">Agente de retención IVA hoy</span><strong>{statusLabel('IVA_RETENTION_AGENT', current.ivaRetentionAgentBasis)}</strong></div>
        <div className="rounded-lg bg-white border border-slate-200 p-3"><span className="block text-slate-500">Firma personal hoy</span><strong>{current.isPersonalFirm ? 'Sí' : 'No'}</strong></div>
        <div className="rounded-lg bg-white border border-slate-200 p-3"><span className="block text-slate-500">Agente de percepción IGTF hoy</span><strong>{current.isIgtfPerceptionAgent ? 'Sí' : 'No'}</strong></div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800"><PlusCircle className="h-4 w-4 text-emerald-600" /> Registrar nuevo cambio fiscal</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-700">Condición que cambia
            <select value={dimension} onChange={event => changeDimension(event.target.value as CompanyFiscalStatusDimension)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
              {DIMENSIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Nueva condición
            <select value={status} onChange={event => setStatus(event.target.value as CompanyFiscalStatusValue)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
              {OPTIONS[dimension].map(item => <option key={String(item.value)} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Fecha desde la que aplica
            <input type="date" required value={effectiveDate} onChange={event => setEffectiveDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700">Fecha del acto o documento
            <input type="date" value={authorityDate} onChange={event => setAuthorityDate(event.target.value)} required={specialNoticeRequired} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Referencia del acto / notificación
            <input value={authorityReference} onChange={event => setAuthorityReference(event.target.value)} required={specialNoticeRequired} maxLength={240} placeholder="Número de providencia, oficio, notificación o acto administrativo" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Soporte documental (referencia o nombre del archivo)
            <input value={supportingDocumentRef} onChange={event => setSupportingDocumentRef(event.target.value)} maxLength={500} placeholder="Ej. Notificación SENIAT.pdf" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Observaciones
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={2} maxLength={2000} placeholder="Contexto del cambio y cualquier precisión profesional" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
          </label>
        </div>
        {specialNoticeRequired && <p className="text-[11px] text-amber-800">La calificación como Sujeto Pasivo Especial y su eventual revocación requieren el acto/notificación individual correspondiente. No se presume un cambio por una reforma ni por umbrales.</p>}
        {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
        {message && <p role="status" className="text-xs text-emerald-700">{message}</p>}
        <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
          <ShieldCheck className="h-4 w-4" /> {busy ? 'Guardando…' : 'Guardar cambio y conservar historial'}
        </button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs font-bold text-slate-800"><FileText className="h-4 w-4" /> Eventos registrados ({ordered.length})</div>
        {ordered.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">Aún no hay eventos históricos. Registre primero la condición inicial y su fecha de vigencia; después agregue cada cambio.</p> : (
          <ol className="space-y-2">
            {ordered.map(item => (
              <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{DIMENSIONS.find(d => d.value === item.dimension)?.label || item.dimension}</strong><span className="font-mono text-slate-500">Vigente desde {item.effectiveDate}</span></div>
                <p className="mt-1 text-slate-700">{statusLabel(item.dimension, String(item.status))}</p>
                {(item.authorityReference || item.supportingDocumentRef) && <p className="mt-1 text-slate-500">{[item.authorityReference, item.authorityDate ? 'Fecha acto: ' + item.authorityDate : '', item.supportingDocumentRef].filter(Boolean).join(' · ')}</p>}
                {item.notes && <p className="mt-1 text-slate-600">{item.notes}</p>}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};
