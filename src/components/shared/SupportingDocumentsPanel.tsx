import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Eye, FilePlus2, FileText, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';

type EntityType = 'PURCHASE' | 'SALE' | 'JOURNAL_ENTRY';
interface Props {
  entityType: EntityType;
  entityId: string;
  documentType: string;
  title: string;
}

const statusLabels: Record<string, string> = {
  ATTACHED_UNREVIEWED: 'Pendiente de revisión',
  VERIFIED: 'Verificado',
  OBSERVATION_REQUIRED: 'Con observaciones',
  REPLACED: 'Sustituido'
};

export const SupportingDocumentsPanel: React.FC<Props> = ({ entityType, entityId, documentType, title }) => {
  const { listSupportingDocuments, attachSupportingDocument, reviewSupportingDocument, openSupportingDocument } = useAccounting();
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listSupportingDocuments>>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [observation, setObservation] = useState('');

  const refresh = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      setDocuments(await listSupportingDocuments({ entityType, entityId }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron consultar los soportes.');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, listSupportingDocuments]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attach = async (replacesDocumentId?: string) => {
    setBusy(true); setMessage(''); setError('');
    try {
      const result = await attachSupportingDocument({
        entityType, entityId, documentType, title,
        description: 'Soporte documental asociado desde el módulo contable',
        replacesDocumentId
      });
      if (result.canceled) return;
      setMessage('Soporte incorporado al expediente.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo adjuntar el soporte.');
    } finally { setBusy(false); }
  };

  const review = async (documentId: string, decision: 'VERIFIED' | 'OBSERVATION_REQUIRED') => {
    const reason = decision === 'VERIFIED' ? 'Revisado por el usuario autorizado.' : observation.trim();
    if (!reason) { setError('Indique la observación antes de registrar la revisión.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      await reviewSupportingDocument({ documentId, decision, reason });
      setObservation('');
      setMessage('Revisión documental registrada.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar la revisión.');
    } finally { setBusy(false); }
  };

  const open = async (id: string) => {
    setError('');
    try { await openSupportingDocument(id); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo abrir el documento.'); }
  };

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 no-print" aria-label="Expediente documental">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <FileText className="h-4 w-4" /> Soportes documentales
          <span className="font-normal text-slate-500">({documents.length}) · opcionales</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading || busy} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 disabled:opacity-50">
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />Actualizar
          </button>
          <button type="button" onClick={() => void attach()} disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            <FilePlus2 className="mr-1 inline h-3.5 w-3.5" />Adjuntar soporte
          </button>
        </div>
      </div>
      {message && <p role="status" className="mt-2 text-xs text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-2 flex items-center gap-1 text-xs text-rose-700"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
      {loading ? <p className="mt-2 text-xs text-slate-500">Consultando expediente…</p> : documents.length === 0 ? (
        <p className="mt-2 text-xs text-slate-500">Esta operación no tiene soportes adjuntos. Puede incorporarlos ahora o posteriormente; esto no afecta su registro contable.</p>
      ) : (
        <div className="mt-2 space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-xs font-semibold text-slate-800">{doc.title}</p>
                  <p className="text-[11px] text-slate-500">{doc.fileName} · {(doc.byteSize / 1024 / 1024).toFixed(2)} MB</p>
                  <p className="mt-1 text-[11px] text-slate-600">Estado: <strong>{statusLabels[doc.status] || doc.status}</strong></p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => void open(doc.id)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"><Eye className="mr-1 inline h-3 w-3" />Abrir</button>
                  {doc.status !== 'REPLACED' && <button type="button" disabled={busy} onClick={() => void attach(doc.id)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"><RefreshCw className="mr-1 inline h-3 w-3" />Sustituir</button>}
                  {doc.status === 'ATTACHED_UNREVIEWED' && <>
                    <button type="button" disabled={busy} onClick={() => void review(doc.id, 'VERIFIED')} className="rounded border border-emerald-200 px-2 py-1 text-[11px] text-emerald-700"><ShieldCheck className="mr-1 inline h-3 w-3" />Verificar</button>
                    <button type="button" disabled={busy} onClick={() => { const reason = window.prompt('Describa la observación documental:'); if (reason?.trim()) { setObservation(reason.trim()); void (async () => { setBusy(true); try { await reviewSupportingDocument({ documentId: doc.id, decision: 'OBSERVATION_REQUIRED', reason: reason.trim() }); setMessage('Observación registrada.'); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar la observación.'); } finally { setBusy(false); } })(); } }} className="rounded border border-amber-200 px-2 py-1 text-[11px] text-amber-700"><AlertCircle className="mr-1 inline h-3 w-3" />Observar</button>
                  </>}
                  {doc.status === 'VERIFIED' && <span className="text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
