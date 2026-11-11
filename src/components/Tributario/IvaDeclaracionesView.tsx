import React, { useMemo, useState } from 'react';
import { CalendarDays, FileText, Receipt, ShoppingCart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import { formatBs } from '../../utils/formatters';

const money = (value: number | undefined) => Number.isFinite(value) ? Number(value) : 0;
const signedDocument = (type: '01' | '02' | '03') => type === '03' ? -1 : 1;

export const IvaDeclaracionesView: React.FC = () => {
  const { currentCompany, sales, purchases, journalEntries } = useAccounting();
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);

  const monthSales = useMemo(() => sales.filter(item =>
    item.companyId === currentCompany.id && item.invoiceDate?.startsWith(period) && !item.isCancelled
  ), [sales, currentCompany.id, period]);

  const monthPurchases = useMemo(() => purchases.filter(item =>
    item.companyId === currentCompany.id && item.invoiceDate?.startsWith(period) && !item.isCancelled
  ), [purchases, currentCompany.id, period]);

  const monthZ = useMemo(() => journalEntries.filter(entry =>
    entry.companyId === currentCompany.id && entry.date.startsWith(period) && Boolean(entry.fiscalZReport)
  ).sort((a, b) => a.date.localeCompare(b.date) || a.entryNumber - b.entryNumber), [journalEntries, currentCompany.id, period]);

  const salesDebit = monthSales.reduce((sum, item) =>
    sum + signedDocument(item.documentType) * money(item.vatAmountBs), 0);
  const zDebit = monthZ.reduce((sum, entry) => {
    const z = entry.fiscalZReport!;
    return sum + money(z.vat16Bs) + money(z.vat8Bs) + money(z.vat31Bs);
  }, 0);
  // Una factura individual y el Reporte Z que la resume pueden representar la misma venta.
  // Si coexisten ambos orígenes, no se suman automáticamente: se exige conciliación para evitar duplicar el débito.
  const hasMixedSalesSources = monthSales.length > 0 && monthZ.length > 0;
  const outputVat = hasMixedSalesSources ? null : salesDebit + zDebit;

  const purchaseCredit = monthPurchases.reduce((sum, item) =>
    sum + signedDocument(item.documentType) * money(item.vatAmountBs), 0);
  const receivedWithholdings = monthSales.reduce((sum, item) =>
    sum + signedDocument(item.documentType) * money(item.vatWithheldBs), 0);
  const preliminaryBalance = outputVat === null ? null : outputVat - purchaseCredit - receivedWithholdings;

  const zSources = monthZ.map(entry => ({
    id: entry.id,
    date: entry.date,
    number: entry.fiscalZReport?.zNumber || entry.referenceDoc || entry.entryNumber.toString(),
    source: entry.fiscalZReport?.sourceType === 'POS'
      ? `POS · ${entry.fiscalZReport.sourceSystemName || 'Sistema externo'}`
      : entry.fiscalZReport?.sourceType === 'DIGITAL'
        ? `Digital · ${entry.fiscalZReport.sourceSystemName || 'Plataforma'}`
        : 'Máquina fiscal',
    base: money(entry.fiscalZReport?.taxableBase16Bs) + money(entry.fiscalZReport?.taxableBase8Bs) + money(entry.fiscalZReport?.taxableBase31Bs),
    vat: money(entry.fiscalZReport?.vat16Bs) + money(entry.fiscalZReport?.vat8Bs) + money(entry.fiscalZReport?.vat31Bs)
  }));

  const format = (value: number) => formatBs(value);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-emerald-800"><Receipt className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wide">Obligaciones tributarias</span></div>
            <h1 className="mt-2 text-2xl font-black text-slate-900">IVA · Declaración mensual</h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-600">Consolidación de IVA generado en ventas, reportes Z, créditos fiscales de compras y retenciones de IVA recibidas.</p>
          </div>
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <CalendarDays className="h-4 w-4" />
            <span>Período</span>
            <input aria-label="Período mensual" type="month" value={period} onChange={event => setPeriod(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1" />
          </label>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-emerald-200 bg-white p-4">
          <p className="text-xs font-semibold text-emerald-800">IVA débito · Ventas y Z</p>
          <p className="mt-2 text-xl font-black text-slate-900">{outputVat === null ? 'Pendiente' : format(outputVat)}</p>
          <p className="mt-1 text-xs text-slate-500">{monthSales.length} documentos · {monthZ.length} reportes Z</p>
        </article>
        <article className="rounded-xl border border-sky-200 bg-white p-4">
          <p className="text-xs font-semibold text-sky-800">IVA crédito · Compras</p>
          <p className="mt-2 text-xl font-black text-slate-900">{format(purchaseCredit)}</p>
          <p className="mt-1 text-xs text-slate-500">{monthPurchases.length} documentos de compra</p>
        </article>
        <article className="rounded-xl border border-violet-200 bg-white p-4">
          <p className="text-xs font-semibold text-violet-800">Retenciones recibidas</p>
          <p className="mt-2 text-xl font-black text-slate-900">{format(receivedWithholdings)}</p>
          <p className="mt-1 text-xs text-slate-500">IVA retenido por clientes registrado en ventas</p>
        </article>
        <article className={`rounded-xl border p-4 ${preliminaryBalance !== null && preliminaryBalance >= 0 ? 'border-amber-300 bg-amber-50/50' : 'border-teal-300 bg-teal-50/50'}`}>
          <p className="text-xs font-semibold text-slate-700">Saldo preliminar del período</p>
          <p className="mt-2 text-xl font-black text-slate-900">{preliminaryBalance === null ? 'Conciliar' : format(Math.abs(preliminaryBalance))}</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">{preliminaryBalance === null ? 'No se calcula para evitar doble conteo' : preliminaryBalance >= 0 ? 'Estimación por pagar' : 'Saldo a favor preliminar'}</p>
        </article>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="text-sm text-amber-950">
            <p className="font-bold">Control previo a la declaración; no es todavía una declaración SENIAT ni un pago registrado.</p>
            {hasMixedSalesSources && <p className="mt-2 font-bold">Conciliación obligatoria: existen facturas individuales y reportes Z en el mismo período. Pueden resumir las mismas operaciones; SICOVEN no los suma automáticamente para evitar duplicar el IVA débito. Conciliá rangos y operaciones antes de determinar el saldo.</p>}
            <p className="mt-1">El crédito fiscal de compras y las retenciones deben validarse contra sus comprobantes, requisitos de deducibilidad y período fiscal. Los reportes Z de POS externo se muestran como soporte operativo y requieren conciliación con los documentos fiscales exigibles. Si también se registraron esas mismas facturas individualmente, no deben computarse dos veces. Este saldo no sustituye la revisión del contador ni la Forma 30.</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <FileText className="h-4 w-4 text-slate-600" />
          <h2 className="font-bold text-slate-900">Reportes Z incluidos en el débito fiscal</h2>
        </div>
        {zSources.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No hay reportes Z registrados para este período.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[650px] text-left text-xs">
              <thead className="bg-slate-50 text-slate-600"><tr><th className="px-4 py-3">Fecha</th><th className="px-4 py-3">Reporte Z</th><th className="px-4 py-3">Origen</th><th className="px-4 py-3 text-right">Base gravada</th><th className="px-4 py-3 text-right">IVA reportado</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {zSources.map(row => <tr key={row.id}><td className="px-4 py-3">{row.date}</td><td className="px-4 py-3 font-mono font-semibold">{row.number}</td><td className="px-4 py-3">{row.source}</td><td className="px-4 py-3 text-right font-mono">{format(row.base)}</td><td className="px-4 py-3 text-right font-mono font-bold text-emerald-700">{format(row.vat)}</td></tr>)}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-sky-700" /><h2 className="font-bold text-slate-900">Crédito fiscal de compras</h2></div>
          <p className="mt-2 text-sm text-slate-600">Se calcula desde las facturas y notas registradas en el Libro de Compras para el mes seleccionado. Debe cotejarse con el libro, comprobantes y tratamiento fiscal de cada operación.</p>
          <p className="mt-3 text-lg font-black text-sky-800">{format(purchaseCredit)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-violet-700" /><h2 className="font-bold text-slate-900">Retenciones de IVA recibidas</h2></div>
          <p className="mt-2 text-sm text-slate-600">Se descuentan únicamente las retenciones registradas en los documentos de venta de este período. Verifica que exista el comprobante y que corresponda al mes declarado.</p>
          <p className="mt-3 text-lg font-black text-violet-800">{format(receivedWithholdings)}</p>
        </article>
      </section>
    </div>
  );
};
