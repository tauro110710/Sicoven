import React, { useState } from 'react';
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
import { VatWithholdingDeclarationsPanel } from './VatWithholdingDeclarationsPanel';
import { getVatDeclarationStatus } from '../../types/vatWithholdingDeclaration';

export const RetencionesIvaView: React.FC = () => {
  const { currentCompany, vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents, recordVatVoucherDelivery, displayCurrency } = useAccounting();

  const [selectedVoucher, setSelectedVoucher] = useState<VatRetentionVoucher | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showTxtPreview, setShowTxtPreview] = useState(false);
  const [activeSection, setActiveSection] = useState<'vouchers' | 'declarations'>('vouchers');

  const filteredVouchers = vatVouchers
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

  const hasPendingFiscalCorrection = filteredVouchers.some(voucher => voucher.requiresFiscalCorrection);
  const totalRetenidoBs = filteredVouchers.reduce((s, v) => s + v.vatWithheldBs, 0);
  const totalRetenidoUsd = filteredVouchers.reduce((s, v) => s + v.vatWithheldUsd, 0);
  const totalBaseBs = filteredVouchers.reduce((s, v) => s + v.taxableBaseBs, 0);
  const declaredVoucherIds = new Set(vatWithholdingDeclarations.flatMap(item => item.voucherIds));
  const pendingDeclarationCount = vatVouchers.filter(voucher => !declaredVoucherIds.has(voucher.id)).length;
  const correctionCount = vatVouchers.filter(voucher => voucher.requiresFiscalCorrection).length;
  const pendingDeliveryCount = vatVouchers.filter(voucher => !voucher.deliveryDate).length;
  const pendingDeclarationStatuses = vatWithholdingDeclarations.filter(item => {
    const status = getVatDeclarationStatus(item, vatWithholdingDeclarationEvents);
    return status === 'PREPARED' || status === 'REVIEWED' || status === 'FILED' || status === 'PARTIALLY_PAID';
  }).length;
  const agentBasisLabel = currentCompany.ivaRetentionAgentBasis === 'ARTICLE_1_SPECIAL_DESIGNATED'
    ? 'Agente designado · Art. 1'
    : currentCompany.ivaRetentionAgentBasis === 'ARTICLE_2_METALS'
      ? 'Agente por actividad · Art. 2'
      : currentCompany.ivaRetentionAgentBasis === 'NOT_AGENT'
        ? 'No agente de retención'
        : 'Condición de agente por confirmar';

  const generatedTxt = generateSeniatIvaTxt(currentCompany, filteredVouchers);

  const handleDownloadTxt = () => {
    if (hasPendingFiscalCorrection) {
      alert('Exportación bloqueada: hay comprobantes afectados por notas de crédito o reversiones. Registre y concilie la rectificación fiscal antes de generar el archivo SENIAT.');
      return;
    }
    if (filteredVouchers.length === 0) {
      alert('No hay comprobantes de retención para exportar.');
      return;
    }
    const cleanR = cleanRif(currentCompany.rif);
    const period = filteredVouchers[0]?.period || `${currentCompany.fiscalYear}10`;
    downloadFile(generatedTxt, `RetencionesIVA_${cleanR}_${period}.txt`);
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
      </div>
      {activeSection === 'vouchers' ? (
      <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
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
      </div>

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
              disabled={filteredVouchers.length === 0 || hasPendingFiscalCorrection}
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
                  Estructura Oficial del Archivo TXT para el Portal SENIAT (Separador: Tabulador)
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
              {generatedTxt || '// No hay registros de retención de IVA para este período'}
            </pre>
            <p className="text-[10px] text-slate-400 italic">
              Columnas: RIF Agente • Período • Fecha • Operación (C) • Tipo Doc (01) • RIF Proveedor • Factura • Control • Total • Base • IVA Retenido • Afectado • Comprobante (14 dígitos) • Exento • Alícuota • Expediente
            </p>
          </div>
        )}

        {/* Search */}
        <div className="pt-6 border-t border-slate-200 mt-6">
          <div className="relative max-w-md">
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
                      {v.voucherNumber}{!v.deliveryDate && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">PEND. ENTREGA</span>}{v.deliveryDate && <span className="ml-1 rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-bold text-emerald-800">ENTREGADO</span>}{v.requiresFiscalCorrection && <span title={v.correctionNote || 'Revisar regularización fiscal'} className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-bold text-amber-800">REVISAR</span>}
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
        company={currentCompany}
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
