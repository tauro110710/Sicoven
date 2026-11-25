import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import {
  TrendingUp,
  Plus,
  Printer,
  Search,
  Calendar,
  CheckCircle2,
  Receipt,
  Download,
  AlertTriangle
} from 'lucide-react';
import { formatBs, formatDate } from '../../utils/formatters';
import { allowsUsdForOperationDate, formatUsdForDate } from '../../utils/monetaryPolicy';
import { NewSaleModal } from './NewSaleModal';
import { CreditSettlementModal } from '../shared/CreditSettlementModal';
import { CompanyLogoHeader } from '../CompanyLogoHeader';
import { exportVentasPdf } from '../../utils/pdfGenerator';
import { SupportingDocumentsPanel } from '../shared/SupportingDocumentsPanel';
import { JournalReversalModal } from '../LibroDiario/JournalReversalModal';
import { SaleCorrectionNoteModal } from './SaleCorrectionNoteModal';
import { FiscalZReportModal } from './FiscalZReportModal';
import { resolveVatOwnDailySalesSources } from '../../types/vatOwnDeclaration';
import { filterCompanyFiscalDocuments, filterActiveFiscalDocuments } from '../../types/companyFiscalDocuments';

export const LibroVentasView: React.FC = () => {
  const {
    currentCompany,
    accounts,
    sales,
    journalEntries,
    isStorageReady,
    addSaleCorrectionNote
  } = useAccounting();

  const sqliteAvailable = typeof window !== 'undefined' && Boolean(window.sicovenStore?.save);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isZModalOpen, setIsZModalOpen] = useState(false);
  const [zDocumentTarget, setZDocumentTarget] = useState<import('../../types/accounting').JournalEntry | null>(null);
  const [documentTarget, setDocumentTarget] = useState<{ id: string; title: string } | null>(null);
  const [reversalTarget, setReversalTarget] = useState<import('../../types/accounting').JournalEntry | null>(null);
  const [settlementTarget, setSettlementTarget] = useState<{id:string; number:string; party:string} | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<{ sale: import('../../types/accounting').SaleRecord; kind: 'CREDIT' | 'DEBIT' } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  // El período seleccionado es la fecha contable de los totales: antes de 2018
  // no se muestra equivalente USD.
  const salesUsdDate = monthFilter ? `${monthFilter}-01` : `${Number(currentCompany.fiscalYear)}-01-01`;
  const usdEnPeriodo = (amount: number) => formatUsdForDate(amount, salesUsdDate);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [dailySourceChoices, setDailySourceChoices] = useState<Record<string, 'Z' | 'INDIVIDUAL'>>({});

  const handleExportCsv = () => {
    const headers = ['Fecha','RIF / C.I.','Razón Social / Nombre','Tipo','N° Factura','N° Control','N° NC','Total USD','Total Facturado Bs.','Exento Bs.','Base 16% Bs.','IVA 16% Bs.','Base 8% Bs.','IVA 8% Bs.','Base 31% Bs.','IVA componente 16% Bs.','Impuesto adicional 15% Bs.','IGTF 3% Bs.','Tasa BCV','Origen','Cómputo fiscal'];
    const esc = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
    const rows: (string | number)[][] = activeSales.map(s => {
      const sign = s.documentType === '03' ? -1 : 1;
      const base16 = s.taxRate === 16 ? s.taxableBaseBs : 0;
      const base8 = s.taxRate === 8 ? s.taxableBaseBs : 0;
      const base31 = s.taxRate === 31 ? s.taxableBaseBs : 0;
      const iva16 = s.taxRate === 16 ? s.vatAmountBs : s.taxRate === 31 ? s.taxableBaseBs * 0.16 : 0;
      const iva8 = s.taxRate === 8 ? s.vatAmountBs : 0;
      // El CSV mantiene la misma regla monetaria que el PDF: sin USD antes de 2018.
      return [s.invoiceDate,s.customerRif,s.customerName,s.documentType === '03' ? 'NOTA DE CRÉDITO' : s.documentType === '02' ? 'NOTA DE DÉBITO' : 'FACTURA',s.invoiceNumber,s.controlNumber,s.creditNoteNumber || (s.documentType === '03' ? s.invoiceNumber : ''),allowsUsdForOperationDate(s.invoiceDate) ? sign * s.totalAmountUsd : '-',sign * s.totalAmountBs,sign * (s.exemptAmountBs + (s.taxRate === 0 ? s.taxableBaseBs : 0)),sign * base16,sign * iva16,sign * base8,sign * iva8,sign * base31,sign * (s.taxRate === 31 ? s.taxableBaseBs * 0.16 : 0),sign * (s.taxRate === 31 ? (s.additionalLuxuryTaxBs ?? s.taxableBaseBs * 0.15) : 0),sign * (s.igtfAmountBs || 0),allowsUsdForOperationDate(s.invoiceDate) ? s.bcvRate : '-','VENTA INDIVIDUAL',selectedIndividualIds.has(s.id) ? 'INCLUIDO' : dailySalesResolution.unresolvedDates.includes(s.invoiceDate) ? 'PENDIENTE DE SELECCIÓN' : 'FUENTE ALTERNATIVA'];
    });
    filteredZReports.forEach(entry => {
      const z = entry.fiscalZReport!;
      rows.push([z.date,'','VENTAS CONSOLIDADAS · ' + (z.sourceSystemName || z.machineBrand || 'Reporte Z'),'REPORTE Z',z.zNumber,z.controlStart || '', '',allowsUsdForOperationDate(z.date) ? (entry.bcvRate > 0 ? z.totalSalesBs / entry.bcvRate : '') : '-',z.totalSalesBs,z.exemptSalesBs,z.taxableBase16Bs,z.vat16Bs,z.taxableBase8Bs,z.vat8Bs,z.taxableBase31Bs,z.taxableBase31Bs * 0.16,z.additionalLuxuryTaxBs,z.igtfBs,allowsUsdForOperationDate(z.date) ? entry.bcvRate : '-','CIERRE Z',selectedZIds.has(entry.id) ? 'INCLUIDO' : dailySalesResolution.unresolvedDates.includes(z.date) ? 'PENDIENTE DE SELECCIÓN' : 'FUENTE ALTERNATIVA']);
    });
    const csv = '\uFEFF' + [headers,...rows].map(row => row.map(esc).join(';')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Libro_Ventas_' + (monthFilter || 'todos') + '.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = async () => {
    try {
      setIsExportingPdf(true);
      await exportVentasPdf(currentCompany, activeSales, monthFilter, filteredZReports, dailySourceChoices);
    } catch (err) {
      console.error('Error exporting Ventas PDF:', err);
      window.alert('No se pudo generar el PDF del Libro de Ventas: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsExportingPdf(false);
    }
  };

  const filteredSales = filterCompanyFiscalDocuments(sales, currentCompany.id)
    .filter(s => {
      if (monthFilter && !s.invoiceDate.startsWith(monthFilter)) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        return (
          s.customerName.toLowerCase().includes(term) ||
          s.customerRif.toLowerCase().includes(term) ||
          s.invoiceNumber.toLowerCase().includes(term) ||
          s.controlNumber.toLowerCase().includes(term) ||
          (s.retentionVoucherNumber && s.retentionVoucherNumber.toLowerCase().includes(term))
        );
      }
      return true;
    })
    .sort((a, b) => a.opNumber - b.opNumber);

  const activeSales = filterActiveFiscalDocuments(filteredSales);

  const filteredZReports = journalEntries
    .filter(entry => entry.companyId === currentCompany.id && entry.fiscalZReport)
    .filter(entry => !monthFilter || String(entry.fiscalZReport?.date || entry.date).startsWith(monthFilter))
    .sort((a, b) => String(a.fiscalZReport?.date || a.date).localeCompare(String(b.fiscalZReport?.date || b.date)) || a.entryNumber - b.entryNumber);

  // NC reduce el libro; ND incrementa sus importes. El documento original permanece intacto.
  const signed = (document: import('../../types/accounting').SaleRecord, amount: number) =>
    (document.documentType === '03' ? -1 : 1) * Number(amount || 0);
  const totalVentasConIvaBs = activeSales.reduce((s, x) => s + signed(x, x.totalAmountBs), 0);
  const totalExentoBs = activeSales.reduce((s, x) => s + signed(x, (x.exemptAmountBs || 0) + (x.taxRate === 0 ? x.taxableBaseBs : 0)), 0);
  const totalBaseBs = activeSales.reduce((s, x) => s + signed(x, x.taxableBaseBs), 0);
  const totalIvaDebitoBs = activeSales.reduce((s, x) => s + signed(x, x.taxRate === 31 ? x.taxableBaseBs * 0.16 : x.vatAmountBs), 0);
  const totalLuxuryTaxBs = activeSales.reduce((s, x) => s + signed(x, x.taxRate === 31 ? (x.additionalLuxuryTaxBs ?? x.taxableBaseBs * 0.15) : 0), 0);
  const totalLuxuryTaxUsd = activeSales.reduce((s, x) => s + signed(x, x.taxRate === 31 ? (x.additionalLuxuryTaxUsd ?? (x.bcvRate > 0 ? x.taxableBaseBs * 0.15 / x.bcvRate : 0)) : 0), 0);
  const totalIvaRetenidoBs = activeSales.reduce((s, x) => s + signed(x, x.vatWithheldBs || 0), 0);
  const totalIgtfBs = activeSales.reduce((s, x) => s + signed(x, x.igtfAmountBs || 0), 0);

  const totalVentasConIvaUsd = activeSales.reduce((s, x) => s + signed(x, x.totalAmountUsd), 0);
  const totalBaseUsd = activeSales.reduce((s, x) => s + signed(x, x.taxableBaseUsd), 0);
  const totalIvaDebitoUsd = activeSales.reduce((s, x) => s + signed(x, x.taxRate === 31 && x.bcvRate > 0 ? x.taxableBaseBs * 0.16 / x.bcvRate : x.vatAmountUsd), 0);
  const totalIvaRetenidoUsd = activeSales.reduce((s, x) => s + signed(x, x.vatWithheldUsd || 0), 0);

  const dailySalesResolution = useMemo(() => resolveVatOwnDailySalesSources({
    zReports: filteredZReports.map(entry => ({
      id: entry.id, date: entry.fiscalZReport!.date || entry.date,
      taxableBase16Bs: entry.fiscalZReport!.taxableBase16Bs, vat16Bs: entry.fiscalZReport!.vat16Bs,
      taxableBase8Bs: entry.fiscalZReport!.taxableBase8Bs, vat8Bs: entry.fiscalZReport!.vat8Bs,
      taxableBase31Bs: entry.fiscalZReport!.taxableBase31Bs, vat31Bs: entry.fiscalZReport!.vat31Bs,
      exemptSalesBs: entry.fiscalZReport!.exemptSalesBs
    })),
    sales: activeSales.map(item => ({
      id: item.id, date: item.invoiceDate, documentType: item.documentType,
      taxableBaseBs: item.taxableBaseBs, taxRate: item.taxRate,
      vatAmountBs: item.vatAmountBs, exemptAmountBs: item.exemptAmountBs
    })),
    choices: dailySourceChoices
  }), [filteredZReports, filteredSales, dailySourceChoices]);
  const selectedIndividualIds = new Set(dailySalesResolution.days
    .filter(day => day.source === 'INDIVIDUAL').flatMap(day => day.sourceIds));
  const selectedZIds = new Set(dailySalesResolution.days
    .filter(day => day.source === 'Z').flatMap(day => day.sourceIds));
  const selectedIndividualSales = activeSales.filter(s => selectedIndividualIds.has(s.id));
  const selectedZReports = filteredZReports.filter(entry => selectedZIds.has(entry.id));
  const totalFiscalBaseBs = dailySalesResolution.days.reduce((sum, day) =>
    sum + day.taxableBase16Bs + day.taxableBase8Bs + day.taxableBase31Bs, 0);
  const totalFiscalBaseUsd = selectedIndividualSales.reduce((sum, sale) => sum + signed(sale, sale.taxableBaseUsd), 0) +
    selectedZReports.reduce((sum, entry) => sum + ((entry.fiscalZReport?.taxableBase16Bs || 0) +
      (entry.fiscalZReport?.taxableBase8Bs || 0) + (entry.fiscalZReport?.taxableBase31Bs || 0)) /
      (entry.bcvRate > 0 ? entry.bcvRate : 1), 0);
  const totalFiscalIvaBs = dailySalesResolution.days.reduce((sum, day) => sum + day.outputVatBs, 0);
  const totalFiscalIvaUsd = selectedIndividualSales.reduce((sum, sale) =>
    sum + signed(sale, sale.taxRate === 31 && sale.bcvRate > 0 ? sale.taxableBaseBs * 0.16 / sale.bcvRate : sale.vatAmountUsd), 0) +
    selectedZReports.reduce((sum, entry) => sum + ((entry.fiscalZReport?.vat16Bs || 0) +
      (entry.fiscalZReport?.vat8Bs || 0) + (entry.fiscalZReport?.vat31Bs || 0)) /
      (entry.bcvRate > 0 ? entry.bcvRate : 1), 0);
  const totalFiscalExemptBs = dailySalesResolution.days.reduce((sum, day) => sum + day.exemptSalesBs, 0);
  const totalFiscalLuxuryTaxBs = selectedIndividualSales.reduce((sum, sale) =>
    sum + signed(sale, sale.taxRate === 31 ? (sale.additionalLuxuryTaxBs ?? sale.taxableBaseBs * 0.15) : 0), 0) +
    selectedZReports.reduce((sum, entry) => sum + (entry.fiscalZReport?.additionalLuxuryTaxBs || 0), 0);
  const totalFiscalLuxuryTaxUsd = selectedIndividualSales.reduce((sum, sale) =>
    sum + signed(sale, sale.additionalLuxuryTaxUsd ?? (sale.bcvRate > 0 ? sale.taxableBaseBs * 0.15 / sale.bcvRate : 0)), 0) +
    selectedZReports.reduce((sum, entry) => sum + (entry.bcvRate > 0 ? (entry.fiscalZReport?.additionalLuxuryTaxBs || 0) / entry.bcvRate : 0), 0);
  const totalFiscalIgtfBs = selectedIndividualSales.reduce((sum, sale) => sum + signed(sale, sale.igtfAmountBs || 0), 0) +
    selectedZReports.reduce((sum, entry) => sum + (entry.fiscalZReport?.igtfBs || 0), 0);
  const selectedWithholdingBs = selectedIndividualSales.reduce((sum, sale) => sum + signed(sale, sale.vatWithheldBs || 0), 0);
  const selectedWithholdingUsd = selectedIndividualSales.reduce((sum, sale) => sum + signed(sale, sale.vatWithheldUsd || 0), 0);
  const sourceSelectionPending = dailySalesResolution.unresolvedDates.length > 0;

  return (
    <div className="space-y-6">
    <section className="no-print rounded-2xl border border-sky-200 bg-sky-50/70 p-4 sm:p-5">
      <h3 className="flex items-center gap-2 text-sm font-bold text-sky-950"><span aria-hidden="true">❓</span> Preguntas frecuentes · Notas de crédito (NC) y débito (ND)</h3>
      <details className="mt-3 rounded-xl border border-sky-100 bg-white p-3" open>
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">¿Dónde y cómo hago una nota de crédito o una nota de débito?</summary>
        <div className="mt-3 space-y-2 text-xs leading-5 text-slate-700">
          <p>La nota se inicia desde la factura original: <strong>Libro de Ventas → busca la factura → columna Acción → NC o ND</strong>. SICOVEN abre el formulario asociado a esa factura.</p>
          <p>Completa la <strong>fecha de la nota</strong>, <strong>número de nota</strong>, <strong>número de control</strong>, <strong>tasa BCV</strong>, <strong>base imponible afectada</strong> y <strong>monto exento afectado</strong>. Selecciona el <strong>medio de emisión fiscal</strong> y confirma si es el mismo de la factura original. Indica el <strong>motivo</strong> y, si lo necesitas, agrega el <strong>papel de trabajo</strong>. El total se calcula automáticamente.</p>
          <p>Al guardar, SICOVEN registra la nota como un documento independiente vinculado a la factura original, genera el asiento contable de ajuste y conserva la factura original y la trazabilidad de la operación. <strong>No requiere autorización ni aprobación de otra persona:</strong> el contador realiza directamente el registro.</p>
        </div>
      </details>
      <details className="mt-2 rounded-xl border border-sky-100 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">¿Cuál es la diferencia entre NC y ND?</summary>
        <p className="mt-3 text-xs leading-5 text-slate-700">La <strong>nota de crédito (NC)</strong> disminuye el importe de la factura, los ingresos, los impuestos que correspondan y la cuenta por cobrar pendiente. La <strong>nota de débito (ND)</strong> aumenta el importe adeudado, los ingresos y los impuestos que correspondan. Ambas quedan relacionadas con la factura afectada; no se elimina ni se modifica el documento original.</p>
      </details>
      <details className="mt-2 rounded-xl border border-sky-100 bg-white p-3">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">¿Qué condiciones y limitaciones debo tener presentes?</summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-700">
          <li>El flujo disponible actualmente se inicia desde facturas vigentes tipo 01 y está habilitado para facturas a crédito; todavía no contempla facturas de contado.</li>
          <li>Para una NC de mercancía con inventario, debe registrarse y conciliarse la devolución física en el Kardex y su asiento de costo. El flujo actual admite devolución total, no parcial.</li>
          <li>El flujo actual no admite facturas con retención de IVA ni IGTF.</li>
          <li>Las operaciones con alícuota combinada del 31% requieren completar y verificar el desglose entre IVA del 16% e impuesto adicional del 15% antes de utilizar notas sobre esos documentos.</li>
          <li>La NC está limitada por el saldo de la cuenta por cobrar pendiente; los casos con cobros previos y reembolso necesitan completar el circuito de devolución y conciliación.</li>
        </ul>
      </details>
    </section>
      {/* Official SENIAT Header with Company Logo */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 print:border-none print:shadow-none print:p-0">
        <CompanyLogoHeader
          company={currentCompany}
          reportTitle="Libro de Ventas (SENIAT)"
          subtitle="Conforme al Art. 76 del Reglamento de la Ley de Impuesto al Valor Agregado"
          periodText={`Período Impositivo: ${monthFilter || 'Todos los períodos'}`}
        />

        {/* Action buttons (hidden on print) */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 no-print border-t border-slate-100">
          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span>Facturas Registradas: <strong className="text-slate-900">{filteredSales.length}</strong></span>
            <span>•</span>
            <span className="text-emerald-700 font-medium">Libro Fiscal Reglamentario</span>
          </div>

          <div className="flex items-center gap-2.5">
            <button onClick={handleExportCsv} disabled={filteredSales.length === 0 && filteredZReports.length === 0} className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl border border-slate-300"><Download className="w-3.5 h-3.5" /> Exportar CSV</button>
            <button
              onClick={handleExportPdf}
              disabled={isExportingPdf || (filteredSales.length === 0 && filteredZReports.length === 0)}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer border border-slate-300 shadow-sm"
              title="Descargar archivo PDF oficial del Libro de Ventas con logo y márgenes SENIAT"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              {isExportingPdf ? 'Generando PDF...' : 'Descargar PDF Oficial'}
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer border border-slate-300"
            >
              <Printer className="w-3.5 h-3.5" />
              Imprimir Libro
            </button>
            <button
              onClick={() => setIsModalOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl transition shadow cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Registrar Venta
            </button>
            <button onClick={() => setIsZModalOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-emerald-700 bg-white px-4 py-2 text-xs font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50">
              <Receipt className="h-4 w-4" /> Registrar Reporte Z
            </button>
          </div>
        </div>

        {/* Toolbar (no-print) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 no-print">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              placeholder="Buscar por RIF, cliente o factura..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <input
              type="month"
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              title="Filtrar por período mensual (AAAA-MM)"
            />
          </div>

          <div className="flex items-center justify-end text-xs text-slate-500">
            <span>Documentos fiscales: <strong className="text-slate-800">{filteredSales.length}</strong></span>
          </div>
        </div>
      </div>

      {/* Sales Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-100 text-slate-700 border-b border-slate-200 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3 text-center w-12">Op. N°</th>
                <th className="py-2.5 px-3 w-24">Fecha</th>
                <th className="py-2.5 px-3 min-w-[150px]">Condición / Vencimiento</th>
                <th className="py-2.5 px-3 w-28">RIF Cliente</th>
                <th className="py-2.5 px-3 min-w-[200px]">Nombre o Razón Social</th>
                <th className="py-2.5 px-3 w-28">N° Factura</th>
                <th className="py-2.5 px-3 w-24">Tipo</th>
                <th className="py-2.5 px-3 w-28">N° Control</th>
                <th className="py-2.5 px-3 text-right w-32">Total Ventas (Bs.)</th>
                <th className="py-2.5 px-3 text-right w-28">Exento (Bs.)</th>
                <th className="py-2.5 px-3 text-right w-32">Base Imponible</th>
                <th className="py-2.5 px-2 text-center w-14">% Alíc.</th>
                <th className="py-2.5 px-3 text-right w-28 text-emerald-800">IVA (Débito)</th>
                <th className="py-2.5 px-3 text-right w-28 text-amber-800">Imp. adicional 15%</th>
                <th className="py-2.5 px-3 text-right w-28 text-purple-800">IVA Retenido</th>
                <th className="py-2.5 px-3 w-32">N° Comprobante Ret.</th>
                <th className="py-2.5 px-3 w-28">Fecha Ret.</th>
                <th className="py-2.5 px-3 text-right w-28">IGTF (Bs.)</th>
                <th className="py-2.5 px-3 text-right w-24">Tasa BCV</th>
                <th className="py-2.5 px-2 text-center w-12 no-print">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSales.length === 0 ? (
                <tr>
                  <td colSpan={20} className="py-12 text-center text-slate-400">
                    <TrendingUp className="w-8 h-8 mx-auto mb-2 opacity-40" />
                    No hay facturas de ventas emitidas en este período.
                  </td>
                </tr>
              ) : (
                filteredSales.map(s => (
                  <tr key={s.id} className="hover:bg-slate-50 transition">
                    <td className="py-2 px-3 text-center font-mono font-bold text-slate-600 bg-slate-50/50">
                      {s.opNumber}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {formatDate(s.invoiceDate)}
                    </td>
                    <td className="py-2 px-3 text-xs whitespace-nowrap">
                      <span className={`inline-flex rounded px-1.5 py-0.5 font-semibold ${s.paymentTerm === 'CREDITO' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>{s.paymentTerm === 'CREDITO' ? 'CRÉDITO' : s.paymentTerm === 'CONTADO' ? 'CONTADO' : 'SIN DEFINIR'}</span>
                      {s.paymentTerm === 'CREDITO' && <div className="text-slate-500 mt-1">Vence: {s.dueDate ? formatDate(s.dueDate) : 'Sin fecha'}</div>}
                      {s.paymentTerm === 'CREDITO' && <div className="text-slate-400">{s.currencyPricingMode === 'USD_FIJO' ? 'USD fijo' : s.currencyPricingMode === 'BS_AJUSTABLE' ? 'Bs. ajustable' : 'Revisión manual'}</div>}
                    </td>
                    <td className="py-2 px-3 font-mono font-medium text-slate-800 whitespace-nowrap">
                      {s.customerRif}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-900 truncate max-w-xs" title={s.customerName}>
                      {s.customerName}
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {s.documentType === '03' ? 'NC ' : s.documentType === '02' ? 'ND ' : ''}{s.invoiceNumber}
                      {s.originalSaleId && <div className="text-[9px] text-slate-500">Afecta: {s.affectedInvoiceNumber}</div>}
                      {s.isCancelled && <span title={s.cancellationNote || 'Pendiente regularización fiscal'} className="ml-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">REVERSADA CONTABLE</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap"><span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold">{s.documentType === '03' ? 'NC' : s.documentType === '02' ? 'ND' : 'FACTURA'}</span></td>
                    <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {s.controlNumber}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 whitespace-nowrap">
                      {formatBs(s.totalAmountBs)}
                      {(
                        <div className="text-[10px] text-slate-400 font-normal">
                          {formatUsdForDate(s.totalAmountUsd, s.invoiceDate)}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 whitespace-nowrap">
                      {s.exemptAmountBs + (s.taxRate === 0 ? s.taxableBaseBs : 0) > 0 ? formatBs(s.exemptAmountBs + (s.taxRate === 0 ? s.taxableBaseBs : 0)) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 whitespace-nowrap">
                      {formatBs(s.taxableBaseBs)}
                      <div className="mt-1 space-y-0.5 text-[9px] font-normal text-slate-500">
                        {s.taxRate === 16 && <div>Base 16%: {formatBs(s.taxableBaseBs)}</div>}
                        {s.taxRate === 8 && <div>Base 8%: {formatBs(s.taxableBaseBs)}</div>}
                        {s.taxRate === 31 && <div>Base 31% comp.: {formatBs(s.taxableBaseBs)}</div>}
                      </div>
                      <div className="text-[10px] text-slate-400 font-normal">{formatUsdForDate(s.taxableBaseUsd, s.invoiceDate)}</div>
                    </td>
                    <td className="py-2 px-2 text-center font-mono text-slate-600">
                      {s.taxRate}%
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-emerald-700 whitespace-nowrap bg-emerald-50/30">
                      {formatBs(s.taxRate === 31 ? s.taxableBaseBs * 0.16 : s.vatAmountBs)}
                      <div className="mt-1 space-y-0.5 text-[9px] font-normal text-emerald-700/80">
                        {s.taxRate === 16 && <div>IVA 16%: {formatBs(s.vatAmountBs)}</div>}
                        {s.taxRate === 8 && <div>IVA 8%: {formatBs(s.vatAmountBs)}</div>}
                        {s.taxRate === 31 && <div>IVA comp. 16%: {formatBs(s.taxableBaseBs * 0.16)}</div>}
                      </div>
                      <div className="text-[10px] text-emerald-600/70 font-normal">{formatUsdForDate(s.taxRate === 31 && s.bcvRate > 0 ? s.taxableBaseBs * 0.16 / s.bcvRate : s.vatAmountUsd, s.invoiceDate)}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-amber-700 whitespace-nowrap bg-amber-50/30">
                      {s.taxRate === 31 ? formatBs(s.additionalLuxuryTaxBs ?? s.taxableBaseBs * 0.15) : '-'}
                      {s.taxRate === 31 && <div className="text-[10px] text-amber-600/70 font-normal">{formatUsdForDate(s.additionalLuxuryTaxUsd ?? (s.bcvRate > 0 ? s.taxableBaseBs * 0.15 / s.bcvRate : 0), s.invoiceDate)}</div>}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-purple-700 whitespace-nowrap bg-purple-50/30">
                      {s.vatWithheldBs > 0 ? (
                        <>
                          {formatBs(s.vatWithheldBs)}
                          {s.retentionRate ? <span className="text-[10px] block text-purple-500 font-normal">({s.retentionRate}%)</span> : null}
                        </>
                      ) : '-'}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs text-purple-700 whitespace-nowrap">
                      {s.retentionVoucherNumber || '-'}
                    </td>
                    <td className="py-2 px-3 font-mono text-xs text-purple-700 whitespace-nowrap">
                      {s.retentionVoucherDate ? formatDate(s.retentionVoucherDate) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-sky-700 whitespace-nowrap">
                      {(s.igtfAmountBs || 0) > 0 ? formatBs(s.igtfAmountBs || 0) : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 whitespace-nowrap">{s.bcvRate > 0 ? s.bcvRate.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 4 }) : '—'}</td>
                    <td className="py-2 px-2 text-center no-print">
                      <button onClick={() => setDocumentTarget({ id: s.id, title: 'Factura de venta ' + s.invoiceNumber })} className="mr-1 rounded bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100">Soportes</button>
                      {s.documentType === '01' && s.paymentTerm === 'CREDITO' && !s.isCancelled && <button onClick={() => setSettlementTarget({id:s.id, number:s.invoiceNumber, party:s.customerName})} className="mr-1 rounded bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100" title="Registrar cobro parcial o total">Cobrar</button>}
                      {s.documentType === '01' && s.paymentTerm === 'CREDITO' && !s.isCancelled && <>
                        <button type="button" disabled={!sqliteAvailable || !isStorageReady} onClick={() => setCorrectionTarget({sale:s,kind:'CREDIT'})}
                          className="mr-1 rounded bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-100">NC</button>
                        <button type="button" disabled={!sqliteAvailable || !isStorageReady} onClick={() => setCorrectionTarget({sale:s,kind:'DEBIT'})}
                          className="mr-1 rounded bg-sky-50 px-2 py-1 text-[10px] font-semibold text-sky-800 hover:bg-sky-100">ND</button>
                      </>}
                      {s.documentType === '01' && !s.isCancelled && <button
                        type="button"
                        disabled={!sqliteAvailable || !isStorageReady}
                        onClick={() => {
                          const source = journalEntries.find(entry => entry.companyId === s.companyId &&
                            (entry.id === s.journalEntryId || (!s.journalEntryId && entry.type === 'VENTA' && entry.referenceDoc === 'FAC-' + s.invoiceNumber)));
                          if (!source) window.alert('No se encontró el asiento contable de origen. No se puede anular sin conciliar primero la factura y su asiento.');
                          else setReversalTarget(source);
                        }}
                        className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                        title={!sqliteAvailable || !isStorageReady ? "La anulación requiere SQLite local disponible" : "Solicitar anulación con contra-asiento y análisis de dependencias"}
                      ><AlertTriangle className="h-3 w-3" /> Anular</button>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot>
              <tr className="bg-slate-900 text-white font-bold border-t border-slate-800 whitespace-nowrap">
                <td colSpan={8} className="py-3 px-3 text-right text-slate-300">
                  TOTALES LIBRO DE VENTAS (SENIAT):
                </td>
                <td className="py-3 px-3 text-right font-mono text-emerald-400">
                  {formatBs(totalVentasConIvaBs)}
                  {(
                    <div className="text-[10px] text-slate-400">{usdEnPeriodo(totalVentasConIvaUsd)}</div>
                  )}
                </td>
                <td className="py-3 px-3 text-right font-mono text-slate-300">
                  {formatBs(totalExentoBs)}
                </td>
                <td className="py-3 px-3 text-right font-mono text-emerald-400">
                  {formatBs(totalBaseBs)}
                  {(
                    <div className="text-[10px] text-slate-400">{usdEnPeriodo(totalBaseUsd)}</div>
                  )}
                </td>
                <td></td>
                <td className="py-3 px-3 text-right font-mono text-emerald-400 bg-slate-850">
                  {formatBs(totalIvaDebitoBs)}
                  {(
                    <div className="text-[10px] text-slate-400">{usdEnPeriodo(totalIvaDebitoUsd)}</div>
                  )}
                </td>
                <td className="py-3 px-3 text-right font-mono text-amber-300 bg-slate-850">{formatBs(totalLuxuryTaxBs)}<div className="text-[10px] text-slate-400">{usdEnPeriodo(totalLuxuryTaxUsd)}</div></td>
                <td className="py-3 px-3 text-right font-mono text-purple-300 bg-slate-850">
                  {formatBs(totalIvaRetenidoBs)}
                  {(
                    <div className="text-[10px] text-slate-400">{usdEnPeriodo(totalIvaRetenidoUsd)}</div>
                  )}
                </td>
                <td></td>
                <td></td>
                <td className="py-3 px-3 text-right font-mono text-sky-300 bg-slate-850">{formatBs(totalIgtfBs)}</td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Cierres diarios consolidados por máquina fiscal */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div><h3 className="text-sm font-bold text-slate-800">Reportes Z · Ventas consolidadas de máquinas fiscales</h3><p className="text-[11px] text-slate-500">Cada cierre conserva su rango de facturas, equipo fiscal, resumen tributario y asiento vinculado.</p></div>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800">{filteredZReports.length} cierres registrados</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px] text-left text-xs">
            <thead className="bg-slate-100 text-slate-700"><tr>
              <th className="px-3 py-2">Fecha</th><th className="px-3 py-2 text-right">Tasa BCV (Bs/USD)</th><th className="px-3 py-2">Cierre / N.º</th><th className="px-3 py-2">Origen / Sistema</th><th className="px-3 py-2">Documentos</th><th className="px-3 py-2">N.º control (si aplica)</th><th className="px-3 py-2 text-right">Base gravada</th><th className="px-3 py-2 text-right">IVA</th><th className="px-3 py-2 text-right">Imp. lujo</th><th className="px-3 py-2 text-right">Exento</th><th className="px-3 py-2 text-right">IGTF</th><th className="px-3 py-2 text-right">Total cierre</th><th className="px-3 py-2">Asiento / Soportes</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {filteredZReports.length === 0 ? <tr><td colSpan={13} className="px-3 py-8 text-center text-slate-400">Todavía no hay Reportes Z registrados para este período.</td></tr> : filteredZReports.map(entry => {
                const z = entry.fiscalZReport!;
                const taxable = z.taxableBase16Bs + z.taxableBase8Bs + z.taxableBase31Bs;
                const vat = z.vat16Bs + z.vat8Bs + z.vat31Bs;
                return <tr key={entry.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(z.date)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{Number.isFinite(Number(entry.bcvRate)) && Number(entry.bcvRate) > 0 ? new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(entry.bcvRate)) : 'No registrada'}</td>
                  <td className="px-3 py-2 font-mono font-bold">{z.zNumber}</td>
                  <td className="px-3 py-2">{(z.sourceType || 'FISCAL_MACHINE') === 'FISCAL_MACHINE' ? ([z.machineBrand,z.machineModel].filter(Boolean).join(' ') || 'Máquina fiscal') : (z.sourceType === 'POS' ? 'Sistema POS' : 'Facturación digital') + ' · ' + (z.sourceSystemName || 'Sistema no especificado')}<span className="block font-mono text-[10px] text-slate-500">{(z.sourceType || 'FISCAL_MACHINE') === 'FISCAL_MACHINE' ? z.machineSerial : (z.sourceTerminalId ? 'Terminal ' + z.sourceTerminalId : 'Sin terminal informada')}</span></td>
                  <td className="px-3 py-2 font-mono">{z.invoiceStart && z.invoiceEnd ? z.invoiceStart + ' – ' + z.invoiceEnd : 'No informado'}</td>
                  <td className="px-3 py-2 font-mono">{z.controlStart ? z.controlStart + ' – ' + z.controlEnd : '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatBs(taxable)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatBs(vat)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatBs(z.additionalLuxuryTaxBs || 0)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatBs(z.exemptSalesBs)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatBs(z.igtfBs)}</td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatBs(z.totalSalesBs)}</td>
                  <td className="px-3 py-2"><span className="block font-semibold">N.º {entry.entryNumber}</span><button type="button" onClick={() => setZDocumentTarget(entry)} className="mt-1 rounded bg-indigo-50 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-100">Soportes (opcional)</button></td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>

      {dailySalesResolution.conflicts.length > 0 && <section className="rounded-xl border border-amber-200 bg-white p-4">
        <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" /><div>
          <h4 className="text-sm font-bold text-slate-900">Días con dos modalidades de registro</h4>
          <p className="mt-1 text-xs text-slate-600">Selecciona la fuente que representa las ventas de cada fecha. SICOVEN incluirá una sola modalidad por día en el resumen fiscal; no sumará automáticamente el Z y las facturas individuales.</p>
        </div></div>
        <div className="mt-3 space-y-2">{dailySalesResolution.conflicts.map(conflict => <div key={conflict.date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
          <strong className="text-sm">{formatDate(conflict.date)}</strong><div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDailySourceChoices(prev => ({...prev,[conflict.date]:'Z'}))} className={dailySourceChoices[conflict.date] === 'Z' ? 'rounded-lg border border-emerald-700 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800' : 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold'}>Usar Reporte Z</button>
            <button type="button" onClick={() => setDailySourceChoices(prev => ({...prev,[conflict.date]:'INDIVIDUAL'}))} className={dailySourceChoices[conflict.date] === 'INDIVIDUAL' ? 'rounded-lg border border-emerald-700 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800' : 'rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold'}>Usar ventas individuales</button>
          </div>
        </div>)}</div>
      </section>}
      {sourceSelectionPending && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">El resumen de la Forma 30 queda pendiente hasta que el contador seleccione una sola fuente para cada día coincidente.</p>}

      {/* Forma 30 SENIAT Summary Card */}
      <div className="bg-gradient-to-r from-slate-900 to-slate-850 text-white p-5 rounded-2xl shadow-md border border-slate-800">
        <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          Resumen de Ventas para Declaración de IVA (Forma 30 SENIAT)
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 text-xs font-mono-nums">
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">Bases imponibles gravadas:</span>
            <span className="text-base font-bold text-white mt-1 block">{sourceSelectionPending ? 'Pendiente de selección' : formatBs(totalFiscalBaseBs)}</span>
            <span className="text-[10px] text-slate-400">{sourceSelectionPending ? '—' : usdEnPeriodo(totalFiscalBaseUsd)}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">Ventas exentas / exoneradas:</span>
            <span className="text-base font-bold text-white mt-1 block">{sourceSelectionPending ? 'Pendiente de selección' : formatBs(totalFiscalExemptBs)}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">Débito fiscal IVA:</span>
            <span className="text-base font-bold text-emerald-400 mt-1 block">{sourceSelectionPending ? 'Pendiente de selección' : formatBs(totalFiscalIvaBs)}</span>
            <span className="text-[10px] text-slate-400">{sourceSelectionPending ? '—' : usdEnPeriodo(totalFiscalIvaUsd)}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">Impuesto adicional al consumo suntuario (15%):</span>
            <span className="text-base font-bold text-amber-300 mt-1 block">{sourceSelectionPending ? 'Pendiente' : formatBs(totalFiscalLuxuryTaxBs)}</span><span className="text-[10px] text-slate-400">{sourceSelectionPending ? '—' : usdEnPeriodo(totalFiscalLuxuryTaxUsd)}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">IGTF percibido:</span>
            <span className="text-base font-bold text-sky-300 mt-1 block">{sourceSelectionPending ? 'Pendiente' : formatBs(totalFiscalIgtfBs)}</span>
          </div>
          <div className="bg-slate-800/60 p-3 rounded-xl border border-slate-700/60">
            <span className="text-[11px] text-slate-400 block">IVA retenido por clientes:</span>
            <span className="text-base font-bold text-purple-300 mt-1 block">{sourceSelectionPending ? 'Pendiente' : formatBs(selectedWithholdingBs)}</span>
            <span className="text-[10px] text-slate-400">{sourceSelectionPending ? '—' : usdEnPeriodo(selectedWithholdingUsd)}</span>
          </div>
        </div>
      </div>

      {/* Official Signatures block (print-only) */}
      <div className="hidden print:grid grid-cols-2 gap-12 pt-12 pb-6 text-xs print-break-inside-avoid">
        <div className="text-center space-y-1">
          <div className="border-t border-slate-900 w-48 mx-auto pt-2 font-bold text-slate-900">
            CONTADOR PÚBLICO COLEGIADO
          </div>
          <div className="text-[11px] text-slate-500">C.P.C. N° ___________</div>
        </div>
        <div className="text-center space-y-1">
          <div className="border-t border-slate-900 w-48 mx-auto pt-2 font-bold text-slate-900">
            REPRESENTANTE LEGAL
          </div>
          <div className="text-[11px] text-slate-500">{currentCompany.name}</div>
        </div>
      </div>

      <NewSaleModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
      <FiscalZReportModal isOpen={isZModalOpen} onClose={() => setIsZModalOpen(false)} />
      {documentTarget && <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Expediente documental">
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl bg-white p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800">{documentTarget.title}</h3><button type="button" onClick={() => setDocumentTarget(null)} className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">Cerrar</button></div>
          <SupportingDocumentsPanel entityType="SALE" entityId={documentTarget.id} documentType="FACTURA_VENTA" title={documentTarget.title} />
        </div>
      </div>}

      {zDocumentTarget && <div className="fixed inset-0 z-[65] overflow-y-auto bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Soportes opcionales del Reporte Z">
        <div className="mx-auto mt-10 max-w-3xl rounded-2xl bg-white p-4 shadow-2xl">
          <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-800">Soportes opcionales · Reporte Z {zDocumentTarget.fiscalZReport?.zNumber}</h3><button type="button" onClick={() => setZDocumentTarget(null)} className="rounded-lg px-3 py-1 text-xs text-slate-600 hover:bg-slate-100">Cerrar</button></div>
          <p className="mb-3 text-[11px] text-slate-500">Adjuntar documentos es opcional; el Reporte Z y su asiento ya están registrados.</p>
          <SupportingDocumentsPanel entityType="JOURNAL_ENTRY" entityId={zDocumentTarget.id} documentType="REPORTE_Z" title={'Reporte Z ' + (zDocumentTarget.fiscalZReport?.zNumber || '')} />
        </div>
      </div>}
      {settlementTarget && <CreditSettlementModal documentId={settlementTarget.id} documentNumber={settlementTarget.number} partyName={settlementTarget.party} kind="SALE_COLLECTION" onClose={() => setSettlementTarget(null)} />}
      <JournalReversalModal source={reversalTarget} onClose={() => setReversalTarget(null)} />
      {correctionTarget && <SaleCorrectionNoteModal sourceSale={correctionTarget.sale} kind={correctionTarget.kind}
        bcvRate={currentCompany.bcvRate}
        treasuryAccounts={accounts.filter(account => account.isMovement && account.type === 'ACTIVO' && account.code.startsWith('1.1.1.'))}
        onClose={() => setCorrectionTarget(null)} onSubmit={addSaleCorrectionNote} />}
    </div>
  );
};
