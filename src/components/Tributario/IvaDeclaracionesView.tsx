import React, { useMemo, useState } from 'react';
import { CalendarDays, FileText, Receipt, ShoppingCart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import { formatBs } from '../../utils/formatters';
import { getVatOwnOutstandingBalance, resolveVatOwnDailySalesSources } from '../../types/vatOwnDeclaration';

const money = (value: number | undefined) => Number.isFinite(value) ? Number(value) : 0;
const signedDocument = (type: '01' | '02' | '03') => type === '03' ? -1 : 1;

export const IvaDeclaracionesView: React.FC = () => {
  const { currentCompany, accounts, sales, purchases, journalEntries, vatOwnDeclarations, vatOwnDeclarationEvents, createVatOwnDeclaration, recordVatOwnDeclarationEvent, isStorageReady } = useAccounting();
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [dailySourceChoices, setDailySourceChoices] = useState<Record<string, 'Z' | 'INDIVIDUAL'>>({});
  const [declarationNumber, setDeclarationNumber] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentBcvRate, setPaymentBcvRate] = useState(String(currentCompany.bcvRate || ''));
  const [treasuryAccountCode, setTreasuryAccountCode] = useState('');
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState('');
  const [workflowMessage, setWorkflowMessage] = useState('');


  const monthSales = useMemo(() => sales.filter(item =>
    item.companyId === currentCompany.id && item.invoiceDate?.startsWith(period) && !item.isCancelled
  ), [sales, currentCompany.id, period]);

  const monthPurchases = useMemo(() => purchases.filter(item =>
    item.companyId === currentCompany.id && item.invoiceDate?.startsWith(period) && !item.isCancelled
  ), [purchases, currentCompany.id, period]);

  const monthZ = useMemo(() => journalEntries.filter(entry =>
    entry.companyId === currentCompany.id && Boolean(entry.fiscalZReport) && String(entry.fiscalZReport.date || entry.date).startsWith(period)
  ).sort((a, b) => String(a.fiscalZReport?.date || a.date).localeCompare(String(b.fiscalZReport?.date || b.date)) || a.entryNumber - b.entryNumber), [journalEntries, currentCompany.id, period]);
  const savedDeclaration = vatOwnDeclarations.find(item => item.companyId === currentCompany.id && item.period === period);
  const activeSourceChoices = savedDeclaration?.dailySourceChoices || dailySourceChoices;
  const declarationEvents = savedDeclaration ? vatOwnDeclarationEvents.filter(event => event.declarationId === savedDeclaration.id) : [];
  const declarationOutstanding = savedDeclaration ? getVatOwnOutstandingBalance(savedDeclaration, declarationEvents) : 0;


  const dailySalesResolution = useMemo(() => resolveVatOwnDailySalesSources({
    zReports: monthZ.map(entry => ({
      id: entry.id, date: entry.fiscalZReport!.date || entry.date,
      taxableBase16Bs: entry.fiscalZReport!.taxableBase16Bs, vat16Bs: entry.fiscalZReport!.vat16Bs,
      taxableBase8Bs: entry.fiscalZReport!.taxableBase8Bs, vat8Bs: entry.fiscalZReport!.vat8Bs,
      taxableBase31Bs: entry.fiscalZReport!.taxableBase31Bs, vat31Bs: entry.fiscalZReport!.vat31Bs,
      exemptSalesBs: entry.fiscalZReport!.exemptSalesBs
    })),
    sales: monthSales.map(item => ({
      id: item.id, date: item.invoiceDate, documentType: item.documentType,
      taxableBaseBs: item.taxableBaseBs, taxRate: item.taxRate,
      vatAmountBs: item.vatAmountBs, exemptAmountBs: item.exemptAmountBs
    })),
    choices: activeSourceChoices
  }), [monthZ, monthSales, activeSourceChoices]);
  const outputVat = dailySalesResolution.unresolvedDates.length
    ? null
    : dailySalesResolution.days.reduce((sum, day) => sum + day.outputVatBs, 0);

  const purchaseCredit = monthPurchases.reduce((sum, item) =>
    sum + signedDocument(item.documentType) * money(item.vatAmountBs), 0);
  const priorCredit = vatOwnDeclarations.filter(item => item.companyId === currentCompany.id && item.status === 'FILED' && item.period < period)
    .sort((a,b)=>b.period.localeCompare(a.period))[0]?.position.creditCarryForwardBs || 0;
  const includedIndividualIds = new Set(dailySalesResolution.days.filter(day => day.source === 'INDIVIDUAL').flatMap(day => day.sourceIds));
  const receivedWithholdings = sales.filter(item => item.companyId === currentCompany.id && item.retentionVoucherDate?.startsWith(period) && money(item.vatWithheldBs) > 0 && (!item.invoiceDate.startsWith(period) || includedIndividualIds.has(item.id))).reduce((sum, item) => sum + signedDocument(item.documentType) * money(item.vatWithheldBs), 0);
  const preliminaryBalance = outputVat === null ? null : outputVat - purchaseCredit - receivedWithholdings - priorCredit;

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
            {dailySalesResolution.unresolvedDates.length > 0 && <p className="mt-2 font-bold">Selecciona para cada fecha coincidente si el contador registró las ventas mediante el Reporte Z o mediante facturas individuales. SICOVEN incluirá una sola fuente por día.</p>}
            <p className="mt-1">El crédito fiscal de compras y las retenciones deben validarse contra sus comprobantes, requisitos de deducibilidad y período fiscal. Los reportes Z de POS externo se muestran como soporte operativo y requieren conciliación con los documentos fiscales exigibles. Si también se registraron esas mismas facturas individualmente, no deben computarse dos veces. Este saldo no sustituye la revisión del contador ni la Forma 30.</p>
          </div>
        </div>
      </section>

      {dailySalesResolution.conflicts.length > 0 && <section className="rounded-xl border border-amber-200 bg-white p-4">
        <h2 className="font-bold text-slate-900">Días con más de una modalidad registrada</h2>
        <p className="mt-1 text-sm text-slate-600">Elige qué fuente utilizó el contador en cada fecha coincidente. La otra fuente quedará fuera del cálculo de ese día para evitar duplicaciones.</p>
        <div className="mt-3 space-y-3">
          {dailySalesResolution.conflicts.map(conflict => <div key={conflict.date} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
            <span className="font-semibold">{conflict.date}</span>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={Boolean(savedDeclaration)} onClick={() => setDailySourceChoices(prev => ({ ...prev, [conflict.date]: 'Z' }))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSourceChoices[conflict.date] === 'Z' ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>Usar Reporte Z</button>
              <button type="button" disabled={Boolean(savedDeclaration)} onClick={() => setDailySourceChoices(prev => ({ ...prev, [conflict.date]: 'INDIVIDUAL' }))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSourceChoices[conflict.date] === 'INDIVIDUAL' ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>Usar ventas individuales</button>
            </div>
          </div>)}
        </div>
      </section>}
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

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-900">Declaración mensual · Control y presentación</h2><p className="mt-1 text-sm text-slate-600">Prepara un borrador desde los libros, conserva las fuentes elegidas y registra presentación y enteramientos con su asiento contable.</p></div>
          {!savedDeclaration && <button type="button" disabled={!isStorageReady || outputVat === null} onClick={async()=>{
            setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
            try { await createVatOwnDeclaration({period,choices:activeSourceChoices});setWorkflowMessage('Borrador de declaración guardado y confirmado en SQLite.'); }
            catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo preparar la declaración.');}
            finally{setWorkflowBusy(false);}
          }} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Guardando…':'Preparar declaración mensual'}</button>}
        </div>
        {savedDeclaration ? <>
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-700">{savedDeclaration.period}</span><span className={`rounded-full px-3 py-1 font-bold ${savedDeclaration.status==='FILED'?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}`}>{savedDeclaration.status==='FILED'?'PRESENTADA':'BORRADOR'}</span>{savedDeclaration.declarationNumber && <span className="font-mono text-slate-600">N° {savedDeclaration.declarationNumber}</span>}<span className="text-slate-500">Fuentes vinculadas: {savedDeclaration.sourceIds.length}</span></div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">IVA débito</p><strong>{format(savedDeclaration.position.outputVatBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Crédito de compras</p><strong>{format(savedDeclaration.position.purchaseCreditBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Retenciones recibidas</p><strong>{format(savedDeclaration.position.receivedWithholdingsBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">IVA por enterar</p><strong>{format(savedDeclaration.position.amountDueBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Crédito trasladable</p><strong>{format(savedDeclaration.position.creditCarryForwardBs)}</strong></div>
          </div>
          {savedDeclaration.status==='DRAFT' ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-950">Al presentar, SICOVEN registra el número oficial y el asiento de determinación mensual. El borrador y sus documentos fuente permanecen conservados.</p>
            <div className="flex flex-wrap gap-2"><input value={declarationNumber} onChange={event=>setDeclarationNumber(event.target.value)} placeholder="Número oficial de declaración" className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              <button type="button" disabled={workflowBusy || !declarationNumber.trim()} onClick={async()=>{
                setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
                try { await recordVatOwnDeclarationEvent(savedDeclaration.id,{companyId:currentCompany.id,eventType:'FILED',occurredAt:new Date().toISOString(),declarationNumber:declarationNumber.trim(),idempotencyKey:'FILED:'+savedDeclaration.id});setWorkflowMessage('Presentación registrada con su asiento de determinación.'); }
                catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo registrar la presentación.');}
                finally{setWorkflowBusy(false);}
              }} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Procesando…':'Registrar presentación'}</button>
            </div>
          </div> : <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Saldo pendiente de enteramiento</strong><strong className="text-lg">{format(declarationOutstanding)}</strong></div>
            {declarationOutstanding>0.01 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input type="date" value={paymentDate} onChange={event=>setPaymentDate(event.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentAmount} onChange={event=>setPaymentAmount(event.target.value)} placeholder="Importe pagado en Bs." inputMode="decimal" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentReference} onChange={event=>setPaymentReference(event.target.value)} placeholder="Referencia del comprobante" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentBcvRate} onChange={event=>setPaymentBcvRate(event.target.value)} placeholder="Tasa BCV del pago" inputMode="decimal" className="rounded-lg border px-3 py-2 text-sm" />
              <select value={treasuryAccountCode} onChange={event=>setTreasuryAccountCode(event.target.value)} className="rounded-lg border px-3 py-2 text-sm sm:col-span-2"><option value="">Cuenta de caja o banco…</option>{accounts.filter(account=>account.isMovement&&account.type==='ACTIVO'&&account.code.startsWith('1.1.1.')).map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select>
              <button type="button" disabled={workflowBusy||!paymentReference.trim()||!paymentAmount.trim()||!treasuryAccountCode} onClick={async()=>{
                setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
                try { await recordVatOwnDeclarationEvent(savedDeclaration.id,{companyId:currentCompany.id,eventType:'PAYMENT',occurredAt:paymentDate+'T12:00:00.000Z',amountBs:Number(paymentAmount.replace(',','.')),reference:paymentReference.trim(),bcvRate:Number(paymentBcvRate.replace(',','.')),treasuryAccountCode,idempotencyKey:'PAYMENT:'+savedDeclaration.id+':'+paymentReference.trim()});setPaymentAmount('');setPaymentReference('');setWorkflowMessage('Pago registrado y contabilizado.');}
                catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo registrar el pago.');}
                finally{setWorkflowBusy(false);}
              }} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Registrando…':'Registrar pago y asiento'}</button>
            </div>}
            {declarationOutstanding<=0.01 && <p className="text-sm font-semibold text-emerald-800">Declaración totalmente enterada o con saldo a favor. No hay pagos pendientes.</p>}
          </div>}
          <div className="space-y-2"><h3 className="text-sm font-bold text-slate-800">Historial de eventos</h3>
            {declarationEvents.length===0 ? <p className="text-xs text-slate-500">Todavía no hay presentación ni pagos registrados.</p> : declarationEvents.map(event=><div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs"><span className="font-semibold">{event.eventType==='FILED'?'Presentación':event.eventType==='PAYMENT'?'Pago':'Reversión'} · {event.reference || event.declarationNumber || event.note || 'Evento fiscal'}</span><span className="text-slate-500">{event.occurredAt.slice(0,10)}{event.amountBs? ' · '+format(event.amountBs):''}</span></div>)}
          </div>
        </> : <p className="text-sm text-slate-500">Todavía no existe una declaración guardada para este período. Resuelve las fechas coincidentes y prepara el borrador para conservar los importes y documentos que lo sustentan.</p>}
        {workflowError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{workflowError}</p>}
        {workflowMessage && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{workflowMessage}</p>}
      </section>
    </div>
  );
};
