import React, { useEffect, useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';

type SourceCode = 'ESTIMACION_EXPERTO' | 'ESTUDIO_FCCPV' | 'ESTIMACION_PROPIA_EXCEPCIONAL';
type SourceSeries = { id: string; seriesCode: SourceCode; firstPeriod: string; lastPeriod: string; seriesVersion: number; sourceTitle: string; issuer: string; approvalStatus: string };
type EvidenceDraft = { evidenceType: string; title: string; description: string; file?: File };
type Dossier = Record<string, any>;
const REQUIREMENTS: Record<SourceCode, { code: string; label: string }[]> = {
  ESTIMACION_EXPERTO: [
    { code: 'EXPERT_IDENTITY', label: 'Identidad del experto' },
    { code: 'EXPERT_CREDENTIALS', label: 'Credenciales y calificación profesional' },
    { code: 'SIGNED_STUDY', label: 'Estudio firmado' },
    { code: 'METHODOLOGY', label: 'Metodología' },
    { code: 'COVERAGE', label: 'Cobertura geográfica y de bienes/servicios' },
    { code: 'MONTHLY_SUPPORT', label: 'Soporte mensual de observaciones' },
    { code: 'BIAS_DECLARATION', label: 'Declaración de sesgo y limitaciones' }
  ],
  ESTUDIO_FCCPV: [
    { code: 'FCCPV_INDICATION', label: 'Evidencia de indicación o publicación FCCPV' },
    { code: 'SIGNED_STUDY', label: 'Estudio identificado y firmado' },
    { code: 'METHODOLOGY', label: 'Metodología' },
    { code: 'COVERAGE', label: 'Cobertura geográfica y de bienes/servicios' }
  ],
  ESTIMACION_PROPIA_EXCEPCIONAL: [
    { code: 'DISPROPORTIONATE_COST_ANALYSIS', label: 'Análisis cuantificado de costo/esfuerzo desproporcionado' },
    { code: 'FCCPV_ABSENCE_SEARCH', label: 'Búsqueda documentada de ausencia de publicación FCCPV' },
    { code: 'EXTERNAL_MACRO_SOURCES', label: 'Fuentes macroeconómicas externas' },
    { code: 'METHODOLOGY', label: 'Metodología y supuestos' },
    { code: 'CALCULATION_WORKPAPERS', label: 'Papeles de cálculo' },
    { code: 'PROFESSIONAL_APPROVAL', label: 'Aprobación profesional del estudio' }
  ]
};
const LABELS: Record<string, string> = {
  ESTIMACION_EXPERTO: 'Estimación de experto — párrafo 17',
  ESTUDIO_FCCPV: 'Estudio indicado por FCCPV — párrafo 18',
  ESTIMACION_PROPIA_EXCEPCIONAL: 'Estimación propia excepcional — párrafo 19',
  DRAFT: 'Borrador incompleto',
  NEEDS_EVIDENCE: 'Requiere evidencia',
  APPROVED_FOR_DOCUMENTED_USE: 'Aprobado para uso documentado',
  REJECTED: 'Rechazado'
};
const emptyEvidence = (): EvidenceDraft => ({ evidenceType: '', title: '', description: '' });
const b64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
async function serializeEvidence(item: EvidenceDraft) {
  if (!item.file) throw new Error('Adjunte un documento para cada evidencia registrada.');
  if (item.file.size > 5 * 1024 * 1024) throw new Error('Cada documento debe ser de 5 MB o menos.');
  const bytes = new Uint8Array(await item.file.arrayBuffer());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, '0')).join('');
  return { evidenceType: item.evidenceType, title: item.title, description: item.description,
    fileName: item.file.name, mimeType: item.file.type || 'application/octet-stream',
    obtainedAt: new Date().toISOString().slice(0, 10), contentBase64: b64(bytes), sha256 };
}
export const InflationSourceDossierView: React.FC<{ token: string; userRole: string }> = ({ token, userRole }) => {
  const { companies, currentCompany } = useAccounting();
  const [series, setSeries] = useState<SourceSeries[]>([]);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [selectedSeries, setSelectedSeries] = useState('');
  const [companyId, setCompanyId] = useState(currentCompany?.id || '');
  const [fiscalYear, setFiscalYear] = useState(String(currentCompany?.fiscalYear || new Date().getFullYear()));
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState('');
  const [framework, setFramework] = useState('VEN_NIF_FULL');
  const [frameworkDetail, setFrameworkDetail] = useState('');
  const [purpose, setPurpose] = useState('REME_FINANCIAL_STATEMENTS');
  const [rationale, setRationale] = useState('');
  const [professionalName, setProfessionalName] = useState('');
  const [professionalRole, setProfessionalRole] = useState('');
  const [professionalCredential, setProfessionalCredential] = useState('');
  const [professionalCredentialEvidence, setProfessionalCredentialEvidence] = useState('');
  const [methodologyVersion, setMethodologyVersion] = useState('1.0');
  const [methodologyDescription, setMethodologyDescription] = useState('');
  const [coverageDescription, setCoverageDescription] = useState('');
  const [periodicity, setPeriodicity] = useState('Mensual');
  const [limitations, setLimitations] = useState('');
  const [biasDeclaration, setBiasDeclaration] = useState('');
  const [evidence, setEvidence] = useState<EvidenceDraft[]>([emptyEvidence()]);
  const [reviewing, setReviewing] = useState<Dossier | null>(null);
  const [decision, setDecision] = useState<'APPROVED_FOR_DOCUMENTED_USE' | 'NEEDS_EVIDENCE' | 'REJECTED'>('NEEDS_EVIDENCE');
  const [reviewReason, setReviewReason] = useState('');
  const [reviewerName, setReviewerName] = useState('');
  const [reviewerCredential, setReviewerCredential] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const activeSeries = series.find(item => item.id === selectedSeries);
  const requiredEvidence = activeSeries ? REQUIREMENTS[activeSeries.seriesCode] : [];
  const companyLabel = (id: string) => companies.find(item => item.id === id)?.name || id;
  const missing = useMemo(() => requiredEvidence.filter(item => !evidence.some(entry => entry.evidenceType === item.code && entry.file && entry.title.trim() && entry.description.trim())), [requiredEvidence, evidence]);
  const refresh = async () => {
    if (!window.sicovenStore) throw new Error('Los expedientes requieren SICOVEN Desktop y SQLite local.');
    const [catalog, records] = await Promise.all([
      window.sicovenStore.listInflationIndexSeries(token),
      window.sicovenStore.listInflationSourceDossiers(token)
    ]);
    setSeries((catalog as unknown as SourceSeries[]).filter(item => Object.prototype.hasOwnProperty.call(REQUIREMENTS, item.seriesCode)));
    setDossiers(records as unknown as Dossier[]);
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        if (!window.sicovenStore) throw new Error('Los expedientes solo están disponibles en SICOVEN Desktop.');
        const [catalog, records] = await Promise.all([
          window.sicovenStore.listInflationIndexSeries(token),
          window.sicovenStore.listInflationSourceDossiers(token)
        ]);
        if (!active) return;
        setSeries((catalog as unknown as SourceSeries[]).filter(item => Object.prototype.hasOwnProperty.call(REQUIREMENTS, item.seriesCode)));
        setDossiers(records as unknown as Dossier[]);
      } catch (err) { if (active) setError(err instanceof Error ? err.message : 'No se pudo cargar el expediente de fuentes.'); }
    })();
    return () => { active = false; };
  }, [token]);
  useEffect(() => { if (!companyId && currentCompany?.id) setCompanyId(currentCompany.id); }, [currentCompany?.id, companyId]);
  const updateEvidence = (index: number, patch: Partial<EvidenceDraft>) => setEvidence(previous => previous.map((item, i) => i === index ? { ...item, ...patch } : item));
  const submitDossier = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (!window.sicovenStore) throw new Error('SICOVEN Desktop no está disponible.');
      if (!activeSeries) throw new Error('Seleccione una serie alternativa.');
      if (missing.length) throw new Error('Complete y adjunte toda la evidencia obligatoria: ' + missing.map(item => item.label).join('; '));
      const serialized = await Promise.all(evidence.filter(item => item.evidenceType).map(serializeEvidence));
      const result = await window.sicovenStore.createInflationSourceDossier(token, {
        seriesId: selectedSeries, companyId, fiscalYear: Number(fiscalYear), periodFrom, periodTo,
        accountingFramework: framework, ...(framework === 'OTHER_DOCUMENTED' ? { accountingFrameworkDetail: frameworkDetail } : {}),
        purpose, normativeRationale: rationale,
        professional: { name: professionalName, role: professionalRole, credential: professionalCredential, credentialEvidence: professionalCredentialEvidence },
        methodologyVersion, methodologyDescription, coverageDescription, periodicity, limitations, biasDeclaration, evidence: serialized
      });
      await refresh();
      setNotice(result.eligibleForReview ? 'Expediente guardado en SQLite. Está listo para revisión profesional independiente.' : 'Expediente guardado como borrador; todavía falta evidencia obligatoria.');
      setEvidence([emptyEvidence()]);
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar el expediente.'); }
    finally { setBusy(false); }
  };
  const missingFor = (item: Dossier) => {
    const requirements = REQUIREMENTS[item.source_code as SourceCode] || [];
    const present = new Set((item.evidenceManifest || []).map((entry: any) => entry.evidenceType));
    return requirements.filter(entry => !present.has(entry.code));
  };
  const downloadEvidence = async (evidenceId: string) => {
    try {
      if (!window.sicovenStore) throw new Error('SICOVEN Desktop no está disponible.');
      const file = await window.sicovenStore.getInflationSourceDossierEvidence(token, evidenceId);
      if (!file.contentBase64) {
        if (file.sourceUrl) { window.open(file.sourceUrl, '_blank', 'noopener,noreferrer'); return; }
        throw new Error('El expediente no conserva bytes descargables para esta referencia.');
      }
      const binary = atob(file.contentBase64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType || 'application/octet-stream' }));
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = file.fileName || 'evidencia';
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
      setNotice('Documento descargado. El acceso quedó registrado en la auditoría de SICOVEN.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo recuperar el documento.'); }
  };
  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault(); if (!reviewing) return; setBusy(true); setError(''); setNotice('');
    try {
      if (!window.sicovenStore) throw new Error('SICOVEN Desktop no está disponible.');
      await window.sicovenStore.reviewInflationSourceDossier(token, {
        dossierId: reviewing.id, decision, reason: reviewReason,
        reviewerProfessionalName: reviewerName, reviewerCredential,
        approvedCompanyId: reviewing.company_id, approvedFiscalYear: reviewing.fiscal_year,
        approvedPeriodFrom: reviewing.period_from, approvedPeriodTo: reviewing.period_to,
        approvedFramework: reviewing.accounting_framework, approvedPurpose: reviewing.purpose
      });
      await refresh(); setReviewing(null); setNotice('Decisión profesional registrada en el historial inmutable del expediente.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo registrar la revisión.'); }
    finally { setBusy(false); }
  };
  if (userRole !== 'admin') return <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950">La creación y revisión de expedientes de fuentes alternativas requiere una sesión administradora. La consulta del expediente debe realizarse con autorización administrativa.</div>;
  const field = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900';
  const label = 'block text-xs font-semibold text-slate-700';
  return <div className="space-y-5">
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <strong>Control REME:</strong> este expediente documenta la admisibilidad de una fuente alternativa para una empresa y alcance concretos. No habilita cálculos, factores de reexpresión ni asientos contables. La aprobación no modifica el gate oficial BCV.
    </section>
    {error && <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</div>}
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-bold text-slate-900">Nuevo expediente de fuente alternativa</h2><p className="mt-1 text-sm text-slate-600">La evidencia se conserva en SQLite con huella SHA-256 y alcance inmutable.</p></div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{series.length} series alternativas</span>
      </div>
      {series.length === 0 ? <p className="mt-4 rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No hay series alternativas importadas. Primero registre una serie como estimación de experto, estudio FCCPV o estimación propia excepcional en «Índices y fuentes».</p> : <form onSubmit={submitDossier} className="mt-4 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className={label}>Serie y categoría normativa<select className={field} value={selectedSeries} onChange={e => { setSelectedSeries(e.target.value); setEvidence([emptyEvidence()]); }} required><option value="">Seleccione serie alternativa</option>{series.map(item => <option key={item.id} value={item.id}>{LABELS[item.seriesCode]} · v{item.seriesVersion} · {item.firstPeriod} a {item.lastPeriod} · {item.sourceTitle}</option>)}</select></label>
          <label className={label}>Empresa<select className={field} value={companyId} onChange={e => setCompanyId(e.target.value)} required><option value="">Seleccione empresa</option>{companies.map(company => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
          <label className={label}>Ejercicio contable<input className={field} type="number" min="1900" max="2200" value={fiscalYear} onChange={e => { setFiscalYear(e.target.value); setPeriodFrom(''); setPeriodTo(''); }} required /></label>
          <label className={label}>Marco contable<select className={field} value={framework} onChange={e => setFramework(e.target.value)}><option value="VEN_NIF_FULL">VEN-NIF General</option><option value="VEN_NIF_PYMES">VEN-NIF PYMES</option><option value="OTHER_DOCUMENTED">Otro marco documentado</option></select></label>
          {framework === 'OTHER_DOCUMENTED' && <label className={label}>Identificación del marco<input className={field} value={frameworkDetail} onChange={e => setFrameworkDetail(e.target.value)} required /></label>}
          <label className={label}>Desde (YYYY-MM)<input className={field} type="month" value={periodFrom} onChange={e => setPeriodFrom(e.target.value)} required /></label>
          <label className={label}>Hasta (YYYY-MM)<input className={field} type="month" value={periodTo} onChange={e => setPeriodTo(e.target.value)} required /></label>
          <label className={label}>Finalidad<select className={field} value={purpose} onChange={e => setPurpose(e.target.value)}><option value="REME_FINANCIAL_STATEMENTS">Estados financieros REME</option><option value="REME_SUPPORTING_ANALYSIS">Análisis de soporte REME</option></select></label>
        </div>
        <label className={label}>Justificación normativa y explicación de por qué la fuente encaja en el supuesto invocado<textarea className={field} rows={3} maxLength={2000} value={rationale} onChange={e => setRationale(e.target.value)} required /></label>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Profesional responsable del estudio</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className={label}>Nombre<input className={field} value={professionalName} onChange={e => setProfessionalName(e.target.value)} required /></label>
            <label className={label}>Responsabilidad profesional<input className={field} value={professionalRole} onChange={e => setProfessionalRole(e.target.value)} required /></label>
            <label className={label}>Credencial o registro<input className={field} value={professionalCredential} onChange={e => setProfessionalCredential(e.target.value)} required /></label>
            <label className={label}>Referencia de verificación de credenciales<input className={field} value={professionalCredentialEvidence} onChange={e => setProfessionalCredentialEvidence(e.target.value)} required /></label>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900">Metodología, cobertura y limitaciones</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className={label}>Versión de metodología<input className={field} value={methodologyVersion} onChange={e => setMethodologyVersion(e.target.value)} required /></label>
            <label className={label}>Periodicidad<input className={field} value={periodicity} onChange={e => setPeriodicity(e.target.value)} required /></label>
            <label className={label + ' md:col-span-2'}>Descripción metodológica<textarea className={field} rows={3} value={methodologyDescription} onChange={e => setMethodologyDescription(e.target.value)} required /></label>
            <label className={label + ' md:col-span-2'}>Cobertura geográfica, población y bienes/servicios<textarea className={field} rows={2} value={coverageDescription} onChange={e => setCoverageDescription(e.target.value)} required /></label>
            <label className={label}>Limitaciones conocidas<textarea className={field} rows={2} value={limitations} onChange={e => setLimitations(e.target.value)} required /></label>
            <label className={label}>Declaración de sesgo y mitigación<textarea className={field} rows={2} value={biasDeclaration} onChange={e => setBiasDeclaration(e.target.value)} required /></label>
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-slate-900">Evidencia documental exigida para este supuesto</h3><span className="text-xs text-slate-500">{evidence.filter(item => item.file).length} adjuntos</span></div>
          <div className="mt-2 space-y-3">
            {evidence.map((item, index) => <div key={index} className="grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-2">
              <label className={label}>Tipo de evidencia<select className={field} value={item.evidenceType} onChange={e => updateEvidence(index, { evidenceType: e.target.value })}><option value="">Seleccione</option>{requiredEvidence.map(req => <option key={req.code} value={req.code}>{req.label}</option>)}</select></label>
              <label className={label}>Título del documento<input className={field} value={item.title} onChange={e => updateEvidence(index, { title: e.target.value })} /></label>
              <label className={label + ' md:col-span-2'}>Qué demuestra y cómo respalda el supuesto normativo<textarea className={field} rows={2} value={item.description} onChange={e => updateEvidence(index, { description: e.target.value })} /></label>
              <label className={label + ' md:col-span-2'}>Adjuntar documento (máximo 5 MB)<input className={field} type="file" onChange={e => updateEvidence(index, { file: e.target.files?.[0] })} /></label>
              <div className="flex items-center justify-between md:col-span-2"><span className="text-xs text-slate-500">{item.file ? item.file.name + ' · ' + Math.ceil(item.file.size / 1024) + ' KB' : 'Sin archivo adjunto'}</span><button type="button" className="text-xs font-semibold text-red-700" onClick={() => setEvidence(previous => previous.filter((_, i) => i !== index))}>Eliminar</button></div>
            </div>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => setEvidence(previous => [...previous, emptyEvidence()])} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">Agregar evidencia</button><span className="text-xs text-slate-500">Total máximo: 20 MB · SHA-256 calculado al guardar</span></div>
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{missing.length ? 'Faltan requisitos: ' + missing.map(item => item.label).join('; ') : 'Se adjuntaron todos los tipos obligatorios. La revisión profesional seguirá siendo independiente.'}</div>
        </div>
        <div className="flex justify-end"><button type="submit" disabled={busy || !selectedSeries || missing.length > 0} className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando en SQLite…' : 'Guardar expediente documental'}</button></div>
      </form>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-slate-900">Expedientes registrados</h2><button type="button" onClick={() => void refresh().catch(err => setError(err.message))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Actualizar</button></div>
      {dossiers.length === 0 ? <p className="mt-3 text-sm text-slate-500">No hay expedientes registrados.</p> : <div className="mt-3 space-y-3">{dossiers.map(item => <article key={item.id} className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{LABELS[item.source_code] || item.source_code} · expediente v{item.dossier_version}</h3><p className="mt-1 text-xs text-slate-600">{companyLabel(item.company_id)} · {item.fiscal_year} · {item.period_from} a {item.period_to} · {item.accounting_framework}</p><p className="mt-1 text-xs text-slate-600">Fuente: {item.sourceTitle} · Emisor: {item.sourceIssuer} · Publicación: {item.sourcePublishedAt}</p><p className="mt-1 break-all text-xs text-slate-500">Referencia: {item.sourceReference} · Archivo: {item.sourceFileName} · SHA-256: {item.sourceSha256}</p>{item.sourceUrl && <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-700 underline">Consultar fuente HTTPS</a>}</div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{LABELS[item.status] || item.status}</span></div>
        <p className="mt-2 text-sm text-slate-700">{item.normative_rationale}</p><details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-slate-700">Ver expediente profesional completo</summary><div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700"><p><strong>Responsabilidad:</strong> {item.professional_role}</p><p><strong>Credencial y verificación:</strong> {item.professional_credential} · {item.professional_credential_evidence}</p><p><strong>Metodología v{item.methodology_version}:</strong> {item.methodology_description}</p><p><strong>Cobertura:</strong> {item.coverage_description}</p><p><strong>Periodicidad:</strong> {item.periodicity}</p><p><strong>Limitaciones:</strong> {item.limitations}</p><p><strong>Sesgos y mitigación:</strong> {item.bias_declaration}</p><p><strong>Marco:</strong> {item.accounting_framework} {item.accounting_framework_detail || ''} · <strong>Finalidad:</strong> {item.purpose}</p></div></details>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-2"><p>Responsable: {item.professional_name} · {item.professional_credential}</p><p>Metodología: {item.methodology_version} · {item.periodicity}</p><p>Revisión: {item.reviewerProfessionalName ? item.reviewerProfessionalName + ' · ' + item.reviewerCredential + ' · cuenta ' + item.reviewerUsername + ' · ' + item.reviewedAt : 'Pendiente'}</p><p>Documentos: {item.evidence?.length || 0} · {item.evidence_bytes} bytes</p></div>
        <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-blue-800">Ver evidencias y huellas SHA-256</summary><div className="mt-2 space-y-2">{(item.evidence || []).map((doc: any) => <div key={doc.id} className="rounded bg-slate-50 p-2 text-xs"><strong>{doc.evidenceType}</strong> — {doc.title}<p>{doc.description}</p><p>{doc.fileName} · SHA-256: {doc.sha256}</p><button type="button" onClick={() => void downloadEvidence(doc.id)} className="mt-1 text-xs font-semibold text-blue-700 underline">{doc.sourceUrl && !doc.bytes ? 'Abrir referencia HTTPS' : 'Descargar y revisar documento'}</button></div>)}</div></details>
        {item.status === 'DRAFT' && missingFor(item).length > 0 && <p className="mt-2 text-xs text-amber-800">Evidencia faltante: {missingFor(item).map(entry => entry.label).join(', ')}</p>}
        {!item.decision && <button type="button" onClick={() => { setReviewing(item); setReviewReason(''); setDecision('NEEDS_EVIDENCE'); }} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Abrir revisión profesional</button>}
        {item.decision && <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-600">Decisión: {item.decision} · {item.reviewReason}</p>}
      </article>)}</div>}
    </section>
    {reviewing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"><form onSubmit={submitReview} className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-auto rounded-xl bg-white p-5 shadow-xl">
      <div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-slate-900">Revisión profesional independiente</h2><p className="text-xs text-slate-500">Alcance cerrado: {companyLabel(reviewing.company_id)} · {reviewing.fiscal_year} · {reviewing.period_from} a {reviewing.period_to}</p></div><button type="button" onClick={() => setReviewing(null)} className="text-sm font-semibold text-slate-600">Cerrar</button></div>
      <label className={label}>Decisión<select className={field} value={decision} onChange={e => setDecision(e.target.value as typeof decision)}><option value="NEEDS_EVIDENCE">Requiere evidencia adicional</option><option value="APPROVED_FOR_DOCUMENTED_USE">Aprobar solo para el alcance documentado</option><option value="REJECTED">Rechazar</option></select></label>
      <label className={label}>Nombre del profesional revisor<input className={field} value={reviewerName} onChange={e => setReviewerName(e.target.value)} required /></label>
      <label className={label}>Credencial profesional verificada<input className={field} value={reviewerCredential} onChange={e => setReviewerCredential(e.target.value)} required /></label>
      <label className={label}>Justificación profesional (mínimo 30 caracteres)<textarea className={field} rows={4} minLength={30} maxLength={2000} value={reviewReason} onChange={e => setReviewReason(e.target.value)} required /></label>
      <div className="rounded bg-amber-50 p-3 text-xs text-amber-900">El sistema impedirá que el importador revise el expediente o que el profesional responsable apruebe su propio estudio. La aprobación queda limitada a la empresa, ejercicio, período, marco y finalidad anteriores.</div>
      <div className="flex justify-end gap-2"><button type="button" onClick={() => setReviewing(null)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">Cancelar</button><button type="submit" disabled={busy || reviewReason.trim().length < 30} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Registrando…' : 'Registrar decisión inmutable'}</button></div>
    </form></div>}
  </div>;
};
