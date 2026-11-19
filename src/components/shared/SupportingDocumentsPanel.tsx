import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Eye, FilePlus2, FileText, RefreshCw } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';

type EntityType = 'PURCHASE' | 'SALE' | 'JOURNAL_ENTRY' | 'COMPANY_TAX_STATUS_PERIOD';
interface Props {
  entityType: EntityType;
  entityId: string;
  documentType: string;
  title: string;
}

export const SupportingDocumentsPanel: React.FC<Props> = ({ entityType, entityId, documentType, title }) => {
  const { listSupportingDocuments, attachSupportingDocument, openSupportingDocument } = useAccounting();
  const [documents, setDocuments] = useState<Awaited<ReturnType<typeof listSupportingDocuments>>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    try {
      setDocuments(await listSupportingDocuments({ entityType, entityId }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron consultar los documentos.');
    } finally {
      setLoading(false);
    }
  }, [entityId, entityType, listSupportingDocuments]);

  useEffect(() => { void refresh(); }, [refresh]);

  const attach = async (replacesDocumentId?: string) => {
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await attachSupportingDocument({
        entityType, entityId, documentType, title,
        description: 'Documento adjuntado voluntariamente para organización de la empresa',
        replacesDocumentId
      });
      if (result.canceled) return;
      setMessage('Documento adjuntado correctamente.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo adjuntar el documento.');
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    setError('');
    try {
      await openSupportingDocument(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir el documento.');
    }
  };

  return (
    <section className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 no-print" aria-label="Documentos opcionales">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
          <FileText className="h-4 w-4" /> Documentos adjuntos (opcional)
          <span className="font-normal text-slate-500">({documents.length})</span>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={loading || busy} className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-600 disabled:opacity-50">
            <RefreshCw className="mr-1 inline h-3.5 w-3.5" />Actualizar
          </button>
          <button type="button" onClick={() => void attach()} disabled={busy} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            <FilePlus2 className="mr-1 inline h-3.5 w-3.5" />Adjuntar documento
          </button>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Puedes adjuntar facturas, comprobantes o recibos para mantener la información organizada en un solo lugar. Es totalmente voluntario y no afecta el registro ni el procesamiento de esta operación.
      </p>
      {message && <p role="status" className="mt-2 text-xs text-emerald-700">{message}</p>}
      {error && <p role="alert" className="mt-2 flex items-center gap-1 text-xs text-rose-700"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
      {loading ? <p className="mt-2 text-xs text-slate-500">Consultando documentos…</p> : documents.length > 0 ? (
        <div className="mt-2 space-y-2">
          {documents.map(doc => (
            <div key={doc.id} className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="break-words text-xs font-semibold text-slate-800">{doc.title}</p>
                  <p className="text-[11px] text-slate-500">{doc.fileName} · {(doc.byteSize / 1024 / 1024).toFixed(2)} MB</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button type="button" onClick={() => void open(doc.id)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"><Eye className="mr-1 inline h-3 w-3" />Abrir</button>
                  <button type="button" disabled={busy} onClick={() => void attach(doc.id)} className="rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-700"><RefreshCw className="mr-1 inline h-3 w-3" />Sustituir</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
};
