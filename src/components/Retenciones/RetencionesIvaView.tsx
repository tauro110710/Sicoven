import React, { useEffect, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import {
  Receipt,
  Download,
  Printer,
  Eye,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Search,
  Code
} from 'lucide-react';
import { formatBs, formatUsd, formatDate, cleanRif } from '../../utils/formatters';
import { VatRetentionVoucher } from '../../types/accounting';
import { VatVoucherModal } from './VatVoucherModal';
import { generateSeniatIvaTxt, downloadFile } from '../../utils/seniatGenerators';
import { validateSeniatIvaTxt } from '../../utils/seniatIvaTxtValidator';
import { VatWithholdingDeclarationsPanel } from './VatWithholdingDeclarationsPanel';
import { getVatDeclarationStatus } from '../../types/vatWithholdingDeclaration';
import { getVatVoucherDeliveryControl } from '../../utils/vatVoucherDelivery';
import { VatFiscalIncidentPanel } from './VatFiscalIncidentPanel';

export const RetencionesIvaView: React.FC = () => {
  const { currentCompany, purchases, vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents, recordVatVoucherDelivery, displayCurrency } = useAccounting();

  const [selectedVoucher, setSelectedVoucher] = useState<VatRetentionVoucher | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState(() => `${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`);
  const [showTxtPreview, setShowTxtPreview] = useState(false);
  const [activeSection, setActiveSection] = useState<'vouchers' | 'declarations' | 'incidents'>('vouchers');

  const companyVouchers = vatVouchers.filter(voucher => voucher.companyId === currentCompany.id);
  const availablePeriods = [...new Set(companyVouchers.map(voucher => voucher.period))].sort((a, b) => b.localeCompare(a));
  useEffect(() => {
    setSelectedVoucher(null);
    setSearchTerm('');
  }, [currentCompany.id]);
  const effectivePeriod = availablePeriods.includes(selectedPeriod) ? selectedPeriod : (availablePeriods[0] || selectedPeriod);
  // La búsqueda solo filtra la tabla; nunca debe alterar la población fiscal exportada.
  const periodVouchers = companyVouchers
    .filter(v => v.period === effectivePeriod)
    .sort((a, b) => b.voucherNumber.localeCompare(a.voucherNumber));
  const filteredVouchers = periodVouchers
    .filter(v => {
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        return (
          v.voucherNumber.toLowerCase().includes(term) ||
          v.supplierName.toLowerCase().includes(term) ||
          v.supplierRif.toLowerCase().includes(term) ||
          v.invoiceNumber.toLowerCase().includes(term)
        );
      }
      return true;
    })
    .sort((a, b) => b.voucherNumber.localeCompare(a.voucherNumber));

  const hasPendingFiscalCorrection = periodVouchers.some(voucher => voucher.requiresFiscalCorrection);
  const totalRetenidoBs = filteredVouchers.reduce((s, v) => s + v.vatWithheldBs, 0);
  const totalRetenidoUsd = filteredVouchers.reduce((s, v) => s + v.vatWithheldUsd, 0);
  const totalBaseBs = filteredVouchers.reduce((s, v) => s + v.taxableBaseBs, 0);
  const companyDeclarations = vatWithholdingDeclarations.filter(item => item.companyId === currentCompany.id);
  const declaredVoucherIds = new Set(companyDeclarations.flatMap(item => item.voucherIds));
  const pendingDeclarationCount = companyVouchers.filter(voucher => !declaredVoucherIds.has(voucher.id)).length;
  const correctionCount = companyVouchers.filter(voucher => voucher.requiresFiscalCorrection).length;
  const selectedVoucherDeclaration = selectedVoucher
    ? companyDeclarations.find(item => item.voucherIds.includes(selectedVoucher.id))
    : undefined;
  const selectedVoucherDeclarationEvents = selectedVoucherDeclaration
    ? vatWithholdingDeclarationEvents.filter(event => event.declarationId === selectedVoucherDeclaration.id)
    : [];
  const selectedVoucherPaymentsBs = selectedVoucherDeclarationEvents
    .filter(event => event.eventType === 'PAYMENT')
    .reduce((sum, event) => sum + Number(event.amountBs || 0), 0);
  const selectedVoucherFiledEvent = selectedVoucherDeclarationEvents.find(event => event.eventType === 'FILED');
  const correctionContext = selectedVoucher?.requiresFiscalCorrection && selectedVoucherDeclaration
    ? {
        period: selectedVoucherDeclaration.period,
        window: selectedVoucherDeclaration.window,
        status: getVatDeclarationStatus(selectedVoucherDeclaration, selectedVoucherDeclarationEvents),
        declarationNumber: selectedVoucherFiledEvent?.declarationNumber,
        totalWithheldBs: selectedVoucherDeclaration.totalWithheldBs,
        paidBs: selectedVoucherPaymentsBs,
        pendingBs: Math.max(0, selectedVoucherDeclaration.totalWithheldBs - selectedVoucherPaymentsBs)
      }
    : undefined;

  const pendingDeliveryCount = companyVouchers.filter(voucher => !voucher.deliveryDate).length;
  const localToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const reviewPurchases = purchases.filter(purchase => purchase.companyId === currentCompany.id && purchase.ivaRetentionDecision?.decisionStatus === 'REVIEW');
  const pendingDeclarationStatuses = companyDeclarations.filter(item => {
    const status = getVatDeclarationStatus(item, vatWithholdingDeclarationEvents);
    return status === 'PREPARED' || status === 'REVIEWED' || status === 'FILED' || status === 'PARTIALLY_PAID';
  }).length;
  const normalizedCompanyRif = String(currentCompany.rif || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  const article1FirmConfirmed = currentCompany.taxpayerType === 'ESPECIAL' && (!/^[VEP]/.test(normalizedCompanyRif) || currentCompany.isPersonalFirm === true);
  const agentBasisLabel = currentCompany.ivaRetentionAgentBasis === 'ARTICLE_1_SPECIAL_DESIGNATED'
    ? (article1FirmConfirmed ? 'Agente designado · Art. 1' : 'Firma personal por confirmar')
    : currentCompany.ivaRetentionAgentBasis === 'ARTICLE_1_AND_2'
      ? (article1FirmConfirmed ? 'Agente designado · Arts. 1 y 2' : 'Firma personal por confirmar · Arts. 1 y 2')
      : currentCompany.ivaRetentionAgentBasis === 'ARTICLE_2_METALS'
      ? 'Agente por actividad · Art. 2'
      : currentCompany.ivaRetentionAgentBasis === 'NOT_AGENT'
        ? 'No agente de retención'
        : 'Condición de agente por confirmar';

  // El generador rechaza correctamente un archivo vacío; ese rechazo no debe tumbar
  // el render de la pantalla cuando el período aún no tiene comprobantes.
  let generatedTxt = '';
  let txtGenerationError = '';
  if (periodVouchers.length > 0) {
    try {
      generatedTxt = generateSeniatIvaTxt(
        currentCompany,
        periodVouchers,
        purchases.filter(purchase => purchase.companyId === currentCompany.id)
      );
    } catch (error) {
      txtGenerationError = error instanceof Error ? error.message : 'No fue posible validar el TXT de retenciones IVA.';
    }
  }

  const txtValidation = generatedTxt ? validateSeniatIvaTxt(generatedTxt) : null;

  const handleDownloadTxt = () => {
    if (hasPendingFiscalCorrection) {
      alert('Exportación bloqueada: hay comprobantes afectados por notas de crédito o reversiones. Registre y concilie la rectificación fiscal antes de generar el archivo SENIAT.');
      return;
    }
    if (txtGenerationError) {
      alert('Exportación bloqueada: ' + txtGenerationError);
      return;
    }
    if (txtValidation && !txtValidation.isValid) {
      alert('Exportación bloqueada: la validación local detectó errores. Revise el informe de validación en la vista previa.');
      setShowTxtPreview(true);
      return;
    }
    if (periodVouchers.length === 0) {
      alert('No hay comprobantes de retención para exportar.');
      return;
    }
    if (periodVouchers.some(voucher => voucher.period !== effectivePeriod)) {
      alert('La exportación debe contener un solo período fiscal. Seleccione el período que desea generar.');
      return;
    }
    const cleanR = cleanRif(currentCompany.rif);
    downloadFile(generatedTxt, `RetencionesIVA_${cleanR}_${effectivePeriod}.txt`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setActiveSection('vouchers')}
          className={`rounded-lg px-4 py-2 text-xs font-bold border ${activeSection === 'vouchers' ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-slate-700 border-slate-300'}`}>
          Comprobantes de retención
        </button>
        <button type="button" onClick={() => setActiveSection('declarations')}
          className={`rounded-lg px-4 py-2 text-xs font-bold border ${activeSection === 'declarations' ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-slate-700 border-slate-300'}`}>
          Declaraciones quincenales
        </button>
        <button type="button" onClick={() => setActiveSection('incidents')}
          className={`rounded-lg px-4 py-2 text-xs font-bold border ${activeSection === 'incidents' ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-slate-700 border-slate-300'}`}>
          Rectificaciones IVA
        </button>
      </div>
      {activeSection === 'incidents' ? <VatFiscalIncidentPanel /> : activeSection === 'vouchers' ? (
      <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Comprobantes por declarar</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{pendingDeclarationCount}</strong>
          <span className="text-[11px] text-slate-500">Detectados automáticamente por sus vínculos</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Declaraciones con gestión pendiente</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{pendingDeclarationStatuses}</strong>
          <span className="text-[11px] text-slate-500">Preparadas, revisadas o con enteramiento pendiente</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Comprobantes por corregir</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{correctionCount}</strong>
          <span className="text-[11px] text-slate-500">Se conservan hasta completar su regularización</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Entregas pendientes</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{pendingDeliveryCount}</strong>
          <span className="text-[11px] text-slate-500">Fecha y medio de entrega aún no registrados</span>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-500">Compras por revisar</span>
          <strong className="mt-1 block text-2xl font-bold text-slate-900">{reviewPurchases.length}</strong>
          <span className="text-[11px] text-slate-500">Decisión fiscal pendiente de confirmar</span>
        </div>
      </div>

      {reviewPurchases.length > 0 && (
        <details className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <summary className="cursor-pointer text-xs font-bold text-amber-900">Compras que requieren revisión fiscal ({reviewPurchases.length})</summary>
          <div className="mt-3 divide-y divide-amber-200">
            {reviewPurchases.map(purchase => (
              <div key={purchase.id} className="py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-slate-900">{purchase.supplierName} · {purchase.invoiceNumber}</strong>
                  <span className="font-mono text-slate-600">{formatDate(purchase.invoiceDate)}</span>
                </div>
                <p className="mt-1 text-amber-900">{purchase.ivaRetentionDecision?.decisionReason || 'La operación requiere validación fiscal.'}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-amber-800">Completa la clasificación o confirmación pendiente desde el Libro de Compras. No se emite retención mientras el caso permanezca en revisión.</p>
        </details>
      )}

      {/* Header */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-purple-700 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                {agentBasisLabel}
              </span>
              <span className="text-xs text-slate-400">•</span>
              <span className="text-xs font-semibold text-slate-600">
                RIF: {currentCompany.rif}
              </span>
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-1">
              Comprobantes de Retención de IVA & Generador TXT
            </h1>
            <p className="text-xs text-slate-500 max-w-2xl mt-0.5">
              Comprobantes y control de retenciones conforme a la Providencia Administrativa SNAT/2025/000054.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowTxtPreview(!showTxtPreview)}
              disabled={hasPendingFiscalCorrection}
              title={hasPendingFiscalCorrection ? 'Previsualización bloqueada hasta rectificar los comprobantes afectados' : 'Previsualizar archivo SENIAT'}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer border border-slate-300"
            >
              <Code className="w-3.5 h-3.5" />
              {showTxtPreview ? 'Ocultar TXT' : 'Previsualizar TXT'}
            </button>
            <button
              onClick={handleDownloadTxt}
              disabled={periodVouchers.length === 0 || hasPendingFiscalCorrection || Boolean(txtGenerationError) || Boolean(txtValidation && !txtValidation.isValid)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 disabled:opacity-40 rounded-xl transition shadow cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Descargar Archivo TXT SENIAT
            </button>
          </div>
        </div>

        {/* Metric summary */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-6">
          <div className="bg-purple-50 p-4 rounded-xl border border-purple-200">
            <span className="text-[11px] font-semibold text-purple-700 uppercase tracking-wide block">
              Total IVA Retenido a Enterar al SENIAT
            </span>
            <div className="text-lg font-bold font-mono text-purple-900 mt-1">
              {formatBs(totalRetenidoBs)}
            </div>
            <div className="text-xs font-mono text-purple-700">
              {formatUsd(totalRetenidoUsd)}
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
              Comprobantes Emitidos
            </span>
            <div className="text-lg font-bold text-slate-900 mt-1">
              {filteredVouchers.length} Comprobantes
            </div>
            <div className="text-xs text-slate-500">
              Correlativos de 14 dígitos normalizados
            </div>
          </div>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
            <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide block">
              Base Imponible Sujeta a Retención
            </span>
            <div className="text-lg font-bold font-mono text-slate-900 mt-1">
              {formatBs(totalBaseBs)}
            </div>
            <div className="text-xs text-slate-500">
              Alícuota aplicada según cada comprobante
            </div>
          </div>
        </div>

        {filteredVouchers.some(voucher => voucher.requiresFiscalCorrection) && (
          <div role="alert" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            Hay comprobantes vinculados a notas de crédito o reversiones que requieren rectificación fiscal. Se conservan como documentos históricos y la exportación SENIAT queda bloqueada hasta registrar la corrección aplicable.
          </div>
        )}

        {/* TXT Preview Card */}
        {showTxtPreview && !hasPendingFiscalCorrection && (
          <div className="mt-6 p-4 bg-slate-900 text-white rounded-xl border border-slate-800 space-y-2 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-bold text-purple-300">
                  Vista previa del TXT de retenciones IVA · 16 campos separados por tabulador
                </span>
              </div>
              <button
                onClick={handleDownloadTxt}
                disabled={hasPendingFiscalCorrection}
                className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" /> Descargar
              </button>
            </div>
            <pre className="p-3 bg-black/60 rounded-lg text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre max-h-48 border border-slate-800">
              {txtGenerationError
                ? '// EXPORTACIÓN BLOQUEADA: ' + txtGenerationError
                : periodVouchers.length === 0
                  ? '// No hay registros de retención de IVA para este período'
                  : generatedTxt}
            </pre>
            {txtValidation && (
              <div role={txtValidation.isValid ? 'status' : 'alert'}
                className={`rounded-lg border p-3 text-xs ${txtValidation.isValid ? 'border-emerald-700 bg-emerald-950/60 text-emerald-200' : 'border-amber-600 bg-amber-950/60 text-amber-100'}`}>
                <strong className="block">
                  {txtValidation.isValid ? 'Validación local aprobada' : 'Validación local: exportación bloqueada'}
                </strong>
                <span className="mt-1 block">
                  {txtValidation.rowCount} registro(s) revisado(s); 16 campos por fila, tabuladores, longitudes y reglas estructurales.
                </span>
                {txtValidation.issues.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {txtValidation.issues.map((issue, index) => (
                      <li key={`${issue.line}-${issue.column || 0}-${issue.code}-${index}`}>
                        Línea {issue.line}{issue.column ? `, columna ${issue.column} (${issue.field})` : ''}: {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-[10px] opacity-80">
                  Esta revisión es local y estructural. No consulta el SENIAT ni certifica la aceptación del archivo en el Portal Fiscal.
                </p>
              </div>
            )}
            <p className="text-[10px] text-slate-400 italic">
              Campos: RIF agente • Período • Fecha • Operación • Tipo de documento • RIF proveedor • Número de documento • Control • Total • Base imponible • IVA retenido • Documento afectado • Comprobante • Exento • Alícuota • Expediente
            </p>
          </div>
        )}

        {/* Search */}
        <div className="pt-6 border-t border-slate-200 mt-6 flex flex-col sm:flex-row gap-3">
          <label className="text-xs font-semibold text-slate-700 sm:w-44">Período fiscal
            <select value={effectivePeriod} onChange={e => setSelectedPeriod(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
              {(availablePeriods.length ? availablePeriods : [selectedPeriod]).map(period => <option key={period} value={period}>{period.slice(0, 4)}-{period.slice(4, 6)}</option>)}
            </select>
          </label>
          <div className="relative max-w-md flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por comprobante, proveedor o factura..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-purple-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      {/* Vouchers List */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-4 w-36">N° Comprobante</th>
                <th className="py-2.5 px-4 w-24">Fecha</th>
                <th className="py-2.5 px-4 w-28">RIF Proveedor</th>
                <th className="py-2.5 px-4 min-w-[200px]">Nombre del Sujeto Retenido</th>
                <th className="py-2.5 px-4 w-24">N° Factura</th>
                <th className="py-2.5 px-4 w-24">N° Control</th>
                <th className="py-2.5 px-4 text-right w-32">Total Factura</th>
                <th className="py-2.5 px-4 text-right w-32">Base Imponible</th>
                <th className="py-2.5 px-2 text-center w-16">% Ret.</th>
                <th className="py-2.5 px-4 text-right w-36 text-purple-800">IVA Retenido</th>
                <th className="py-2.5 px-4 text-center w-24">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-slate-400">
                    <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No hay comprobantes de retención de IVA emitidos.
                  </td>
                </tr>
              ) : (
                filteredVouchers.map(v => (
                  <tr key={v.id} className="hover:bg-slate-50 transition">
                    <td className="py-2.5 px-4 font-mono font-bold text-purple-900 bg-purple-50/30 whitespace-nowrap">
                      {v.voucherNumber}{!v.deliveryDate && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">PEND. ENTREGA</span>}{!v.deliveryDate && getVatVoucherDeliveryControl(v.period, localToday).status === 'REVIEW' && <span title="La estimación de días hábiles ya transcurrió; verificar feriados oficiales y fecha efectiva de entrega." className="ml-1 rounded bg-rose-100 px-1 py-0.5 text-[9px] font-bold text-rose-800">REVISAR PLAZO</span>}{v.deliveryDate && <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-800">ENTREGADO</span>}{v.deliveryDate && getVatVoucherDeliveryControl(v.period, localToday, v.deliveryDate).needsCalendarReview && <span title="La fecha registrada supera la estimación de días hábiles; revisar feriados oficiales antes de concluir incumplimiento." className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">VERIFICAR FECHA</span>}{v.requiresFiscalCorrection && <span title={v.correctionNote || 'Revisar regularización fiscal'} className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">REVISAR</span>}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {formatDate(v.date)}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-800 whitespace-nowrap">
                      {v.supplierRif}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-slate-900 truncate max-w-xs" title={v.supplierName}>
                      {v.supplierName}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {v.invoiceNumber}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {v.controlNumber}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {formatBs(v.totalAmountBs)}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-slate-700 whitespace-nowrap">
                      {formatBs(v.taxableBaseBs)}
                    </td>
                    <td className="py-2.5 px-2 text-center font-mono font-bold text-purple-700">
                      {v.retentionRate}%
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-black text-purple-900 bg-purple-50/50 whitespace-nowrap">
                      {formatBs(v.vatWithheldBs)}
                      {displayCurrency !== 'BS' && (
                        <div className="text-[10px] text-purple-600/70 font-normal">
                          {formatUsd(v.vatWithheldUsd)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center whitespace-nowrap">
                      <button
                        onClick={() => setSelectedVoucher(v)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-purple-700 bg-purple-100 hover:bg-purple-200 rounded-lg transition cursor-pointer"
                        title="Ver e imprimir comprobante"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Ver
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for official printable voucher */}
      <VatVoucherModal
        voucher={selectedVoucher}
        correctionContext={correctionContext}
        onClose={() => setSelectedVoucher(null)}
        onRecordDelivery={async draft => {
          if (!selectedVoucher) throw new Error('Seleccione un comprobante.');
          const updated = await recordVatVoucherDelivery(selectedVoucher.id, draft);
          setSelectedVoucher(updated);
          return updated;
        }}
      />
      </>
      ) : <VatWithholdingDeclarationsPanel />}
    </div>
  );
};
