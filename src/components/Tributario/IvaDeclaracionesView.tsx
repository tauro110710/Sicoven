import React, { useMemo, useState } from 'react';
import { CalendarDays, FileText, Receipt, ShoppingCart, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import { formatBs } from '../../utils/formatters';
import { getVatOwnOutstandingBalance, getReceivedVatWithholdingSales, resolveVatOwnDailySalesSources, calculateVatOwnPosition, calculateVatOwnPurchaseCreditSummary, buildVatOwnPurchaseVatReclassificationItems, buildVatOwnSourceSnapshots, areVatOwnSourceSnapshotsCurrent, getUnfiledVatOwnActivityPeriods, getVatOwnFiledLaterPeriods, resolveVatOwnPaymentBcvRate, isValidVatOwnDeclarationPeriod } from '../../types/vatOwnDeclaration';

const money = (value: number | undefined) => Number.isFinite(value) ? Number(value) : 0;
const parseLocalizedNumber = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); };
const signedDocument = (type: '01' | '02' | '03') => type === '03' ? -1 : 1;
const localIsoDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offset = Math.abs(offsetMinutes);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${String(date.getMilliseconds()).padStart(3, '0')}${sign}${pad(Math.floor(offset / 60))}:${pad(offset % 60)}`;
};

export const IvaDeclaracionesView: React.FC = () => {
  const { currentCompany, accounts, sales, purchases, journalEntries, vatOwnDeclarations, vatOwnDeclarationEvents, createVatOwnDeclaration, recordVatOwnDeclarationEvent, isStorageReady } = useAccounting();
  const today = new Date();
  const [period, setPeriod] = useState(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`);
  const [periodYear, periodMonth] = period.split('-').map(Number);
  const periodEndDate = Number.isInteger(periodYear) && Number.isInteger(periodMonth) && periodMonth >= 1 && periodMonth <= 12
    ? new Date(Date.UTC(periodYear, periodMonth, 0)).toISOString().slice(0, 10) : '';
  const localToday = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const periodCanBeFiled = Boolean(periodEndDate && localToday > periodEndDate);
  const [dailySourceChoices, setDailySourceChoices] = useState<Record<string, 'Z' | 'INDIVIDUAL'>>({});
  const [declarationNumber, setDeclarationNumber] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10));
  const [paymentBcvRate, setPaymentBcvRate] = useState(String(currentCompany.bcvRate || ''));
  const paymentHistoricalBcvRate = resolveVatOwnPaymentBcvRate(currentCompany.accountingBcvRateHistory || [], paymentDate);
  const paymentRateMatchesHistory = paymentHistoricalBcvRate !== null &&
    Math.abs(parseLocalizedNumber(paymentBcvRate) - paymentHistoricalBcvRate) <= 0.000001;
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

  const reversedJournalIds = useMemo(() => new Set(journalEntries
    .filter(entry => Boolean(entry.reversalOfEntryId))
    .map(entry => entry.reversalOfEntryId as string)), [journalEntries]);
  const monthZ = useMemo(() => journalEntries.filter(entry =>
    entry.companyId === currentCompany.id && Boolean(entry.fiscalZReport) && !reversedJournalIds.has(entry.id) &&
    String(entry.fiscalZReport?.date || entry.date).startsWith(period)
  ).sort((a, b) => String(a.fiscalZReport?.date || a.date).localeCompare(String(b.fiscalZReport?.date || b.date)) || a.entryNumber - b.entryNumber), [journalEntries, currentCompany.id, period, reversedJournalIds]);
  const activityContinuity = useMemo(() => {
    const activityDates = [
      ...sales.filter(item => item.companyId === currentCompany.id && !item.isCancelled)
        .flatMap(item => [item.invoiceDate, item.retentionVoucherDate].filter((date): date is string => Boolean(date))),
      ...purchases.filter(item => item.companyId === currentCompany.id && !item.isCancelled).map(item => item.invoiceDate),
      ...journalEntries.filter(entry => entry.companyId === currentCompany.id && Boolean(entry.fiscalZReport) && !reversedJournalIds.has(entry.id))
        .map(entry => entry.fiscalZReport!.date || entry.date)
    ];
    try {
      return {
        missing: getUnfiledVatOwnActivityPeriods({
          companyId: currentCompany.id, targetPeriod: period, activityDates, declarations: vatOwnDeclarations
        }),
        laterFiled: getVatOwnFiledLaterPeriods({
          companyId: currentCompany.id, targetPeriod: period, declarations: vatOwnDeclarations
        }),
        error: null
      };
    } catch (error) {
      return { missing: [], laterFiled: [], error: error instanceof Error ? error.message : 'No se pudo verificar la continuidad de períodos IVA.' };
    }
  }, [sales, purchases, journalEntries, currentCompany.id, period, vatOwnDeclarations, reversedJournalIds]);
  const savedDeclaration = vatOwnDeclarations.find(item => item.companyId === currentCompany.id && item.period === period);
  const activeSourceChoices = useMemo(() => savedDeclaration?.status === 'FILED'
    ? savedDeclaration.dailySourceChoices || {}
    : { ...(savedDeclaration?.dailySourceChoices || {}), ...dailySourceChoices },
  [savedDeclaration?.status, savedDeclaration?.dailySourceChoices, dailySourceChoices]);
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

  const rawTaxableSalesBase = dailySalesResolution.days.reduce((sum, day) =>
    sum + day.taxableBase16Bs + day.taxableBase8Bs + day.taxableBase31Bs, 0);
  const rawExemptSalesBase = dailySalesResolution.days.reduce((sum, day) => sum + day.exemptSalesBs, 0);
  const taxableSalesBase = Math.max(0, rawTaxableSalesBase);
  const exemptSalesBase = Math.max(0, rawExemptSalesBase);
  const purchaseSummaryResult = useMemo(() => {
    if (dailySalesResolution.unresolvedDates.length > 0) {
      return { summary: null, reclassifications: null, error: 'Resuelve primero las fechas con Reporte Z y ventas individuales coincidentes.' };
    }
    try {
      const summary = calculateVatOwnPurchaseCreditSummary({
        companyId: currentCompany.id, period, purchases: monthPurchases,
        allPurchases: purchases, priorDeclarations: vatOwnDeclarations,
        taxableSalesBaseBs: rawTaxableSalesBase, exemptSalesBaseBs: rawExemptSalesBase
      });
      const reclassifications = buildVatOwnPurchaseVatReclassificationItems({
        companyId: currentCompany.id, period, bcvRate: Number(currentCompany.bcvRate),
        allPurchases: purchases, journalEntries, summary
      });
      return { summary, reclassifications, error: null };
    } catch (error) {
      return { summary: null, reclassifications: null, error: error instanceof Error ? error.message : 'No se pudo conciliar el crédito fiscal de compras.' };
    }
  }, [currentCompany.id, period, monthPurchases, purchases, vatOwnDeclarations, journalEntries, currentCompany.bcvRate, rawTaxableSalesBase, rawExemptSalesBase, dailySalesResolution.unresolvedDates]);
  const purchaseSummary = purchaseSummaryResult.summary;
  const purchaseSummaryError = purchaseSummaryResult.error;
  const creditForPreview = useMemo(() => purchaseSummary || ({
    prorationRate: 0, gross16Bs: 0, gross8Bs: 0, eligible16Bs: 0, eligible8Bs: 0,
    nonEligible16Bs: 0, nonEligible8Bs: 0, priorReversalEligible16Bs: 0,
    priorReversalEligible8Bs: 0, priorReversalNonEligible16Bs: 0,
    priorReversalNonEligible8Bs: 0, relatedPurchaseIds: [], reclassifications: []
  }), [purchaseSummary]);
  const unfiledActivityPeriods = activityContinuity.missing;
  const laterFiledPeriods = activityContinuity.laterFiled;
  const activityPeriodError = activityContinuity.error;
  const prorationUnavailable = Boolean(purchaseSummaryError?.toLowerCase().includes('prorrata'));
  const purchaseReclassificationItems = purchaseSummaryResult.reclassifications || [];
  const prorationRate = purchaseSummary?.prorationRate ?? null;
  const purchaseCreditGross16 = purchaseSummary?.gross16Bs ?? 0;
  const purchaseCreditGross8 = purchaseSummary?.gross8Bs ?? 0;
  const purchaseCredit = purchaseCreditGross16 + purchaseCreditGross8;
  const purchaseCreditEligible = outputVat === null || !purchaseSummary
    ? null : purchaseSummary.eligible16Bs + purchaseSummary.eligible8Bs;
  const purchaseCreditNonEligible = purchaseSummary
    ? purchaseSummary.nonEligible16Bs + purchaseSummary.nonEligible8Bs : null;
  const purchaseCreditReversal = purchaseSummary
    ? purchaseSummary.priorReversalEligible16Bs + purchaseSummary.priorReversalEligible8Bs : 0;
  const purchaseCreditReversalNonEligible = purchaseSummary
    ? purchaseSummary.priorReversalNonEligible16Bs + purchaseSummary.priorReversalNonEligible8Bs : 0;
  const priorCredit = vatOwnDeclarations.filter(item => item.companyId === currentCompany.id && item.status === 'FILED' && item.period < period)
    .sort((a,b)=>b.period.localeCompare(a.period))[0]?.position.creditCarryForwardBs || 0;
  const receivedWithholdingRows = useMemo(() => getReceivedVatWithholdingSales(sales, currentCompany.id, period), [sales, currentCompany.id, period]);
  const receivedWithholdings = receivedWithholdingRows.reduce((sum, item) => sum + signedDocument(item.documentType) * money(item.vatWithheldBs), 0);
  const currentPositionPreview = useMemo(() => {
    if (outputVat === null) return null;
    try {
      const output16Raw = dailySalesResolution.days.reduce((sum, day) => sum + day.outputVat16Bs, 0);
      const output8Raw = dailySalesResolution.days.reduce((sum, day) => sum + day.outputVat8Bs, 0);
      const withholdingRaw = receivedWithholdingRows.reduce((sum, item) =>
        sum + signedDocument(item.documentType) * money(item.vatWithheldBs), 0);
      return calculateVatOwnPosition({
        outputVatBs: Math.max(0, output16Raw) + Math.max(0, output8Raw),
        outputVat16Bs: Math.max(0, output16Raw), outputVat8Bs: Math.max(0, output8Raw),
        purchaseCreditBs: creditForPreview.eligible16Bs + creditForPreview.eligible8Bs,
        purchaseCredit16Bs: creditForPreview.eligible16Bs, purchaseCredit8Bs: creditForPreview.eligible8Bs,
        purchaseCreditGrossBs: creditForPreview.gross16Bs + creditForPreview.gross8Bs,
        purchaseCreditGross16Bs: creditForPreview.gross16Bs, purchaseCreditGross8Bs: creditForPreview.gross8Bs,
        purchaseCreditNonEligibleBs: creditForPreview.nonEligible16Bs + creditForPreview.nonEligible8Bs,
        purchaseCreditReversalBs: creditForPreview.priorReversalEligible16Bs + creditForPreview.priorReversalEligible8Bs,
        purchaseCreditReversal16Bs: creditForPreview.priorReversalEligible16Bs,
        purchaseCreditReversal8Bs: creditForPreview.priorReversalEligible8Bs,
        purchaseCreditReversalNonEligibleBs: creditForPreview.priorReversalNonEligible16Bs + creditForPreview.priorReversalNonEligible8Bs,
        purchaseCreditReversalNonEligible16Bs: creditForPreview.priorReversalNonEligible16Bs,
        purchaseCreditReversalNonEligible8Bs: creditForPreview.priorReversalNonEligible8Bs,
        prorationRate: creditForPreview.prorationRate,
        taxableSalesBaseBs: taxableSalesBase, exemptSalesBaseBs: exemptSalesBase,
        receivedWithholdingsBs: Math.max(0, withholdingRaw), priorCreditBs: priorCredit,
        debitAdjustmentsBs: Math.max(0, -withholdingRaw),
        creditAdjustmentsBs: Math.max(0, -output16Raw) + Math.max(0, -output8Raw),
        creditAdjustments16Bs: Math.max(0, -output16Raw), creditAdjustments8Bs: Math.max(0, -output8Raw)
      });
    } catch {
      return null;
    }
  }, [outputVat, creditForPreview, dailySalesResolution.days, receivedWithholdingRows, taxableSalesBase, exemptSalesBase, priorCredit]);
  const preliminaryBalance = currentPositionPreview
    ? currentPositionPreview.amountDueBs > 0.01
      ? currentPositionPreview.amountDueBs
      : -currentPositionPreview.creditCarryForwardBs
    : null;
  const currentSourceIds = [...new Set([
    ...dailySalesResolution.days.flatMap(day => day.sourceIds),
    ...monthPurchases.map(item => item.id),
    ...(purchaseSummary?.relatedPurchaseIds || []),
    ...receivedWithholdingRows.map(item => item.id)
  ])].sort();
  const savedSourceIds = [...new Set([...(savedDeclaration?.sourceIds || []), ...(savedDeclaration?.relatedSourceIds || [])])].sort();
  const sourceIdsChanged = Boolean(savedDeclaration && JSON.stringify(currentSourceIds) !== JSON.stringify(savedSourceIds));
  const currentSourceSnapshots = buildVatOwnSourceSnapshots({
    companyId: currentCompany.id, sourceIds: currentSourceIds, sales, purchases, journalEntries
  });
  const sourceSnapshotsChanged = Boolean(savedDeclaration &&
    !areVatOwnSourceSnapshotsCurrent(savedDeclaration.sourceSnapshots, currentSourceSnapshots));
  const sourceChoicesChanged = Boolean(savedDeclaration?.status === 'DRAFT' && dailySalesResolution.conflicts.some(conflict =>
    activeSourceChoices[conflict.date] !== savedDeclaration.dailySourceChoices?.[conflict.date]
  ));
  const bcvRateChanged = Boolean(savedDeclaration && (!Number.isFinite(Number(savedDeclaration.bcvRate)) || Math.abs(Number(savedDeclaration.bcvRate) - Number(currentCompany.bcvRate)) > 0.000001));
  const purchaseReclassificationChanged = Boolean(savedDeclaration &&
    JSON.stringify(purchaseReclassificationItems) !== JSON.stringify(savedDeclaration.purchaseVatReclassificationItems || []));
  const positionSummaryChanged = Boolean(savedDeclaration && (
    !currentPositionPreview ||
    (Object.keys(currentPositionPreview) as Array<keyof typeof currentPositionPreview>).some(field => {
      const savedValue = Number(savedDeclaration.position[field] ?? 0);
      const tolerance = field === 'prorationRate' ? 0.000001 : 0.02;
      return !Number.isFinite(savedValue) || Math.abs(currentPositionPreview[field] - savedValue) > tolerance;
    })
  ));
  const draftNeedsRefresh = savedDeclaration?.status === 'DRAFT' && (
    savedDeclaration.calculationStatus === 'PROVISIONAL' || (savedDeclaration.pendingCalculationItems || []).length > 0 ||
    sourceIdsChanged || sourceSnapshotsChanged || sourceChoicesChanged || bcvRateChanged || purchaseReclassificationChanged || positionSummaryChanged ||
    Boolean(purchaseSummaryError) || laterFiledPeriods.length > 0 || Boolean(activityPeriodError) || dailySalesResolution.unresolvedDates.length > 0
  );

  const includedZSourceIds = new Set(dailySalesResolution.days
    .filter(day => day.source === 'Z')
    .flatMap(day => day.sourceIds));
  const zSources = monthZ.filter(entry => includedZSourceIds.has(entry.id)).map(entry => ({
    id: entry.id,
    date: entry.fiscalZReport?.date || entry.date,
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
            <input aria-label="Período mensual" type="month" value={period} onChange={event => setPeriod(event.target.value.trim())} className="rounded-md border border-slate-300 bg-white px-2 py-1" />
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
          <p className="text-xs font-semibold text-sky-800">IVA crédito bruto · Compras</p>
          <p className="mt-2 text-xl font-black text-slate-900">{purchaseSummary ? format(purchaseCredit) : 'Pendiente'}</p>
          <p className="mt-1 text-xs text-slate-600">Acreditable estimado: {purchaseCreditEligible === null ? 'Pendiente de conciliar' : format(purchaseCreditEligible)}</p>
          <p className="mt-1 text-xs text-slate-500">{monthPurchases.length} documentos · {purchaseCreditNonEligible === null ? 'prorrata pendiente' : 'No acreditable estimado: ' + format(purchaseCreditNonEligible)}</p>
        </article>
        <article className="rounded-xl border border-violet-200 bg-white p-4">
          <p className="text-xs font-semibold text-violet-800">Retenciones recibidas y ajustes</p>
          <p className="mt-2 text-xl font-black text-slate-900">{format(receivedWithholdings)}</p>
          <p className="mt-1 text-xs text-slate-500">Comprobantes de retención y ajustes de notas de venta del período</p>
        </article>
        <article className={`rounded-xl border p-4 ${preliminaryBalance !== null && preliminaryBalance >= 0 ? 'border-amber-300 bg-amber-50/50' : 'border-teal-300 bg-teal-50/50'}`}>
          <p className="text-xs font-semibold text-slate-700">Saldo preliminar del período</p>
          <p className="mt-2 text-xl font-black text-slate-900">{preliminaryBalance === null ? 'Conciliar' : format(Math.abs(preliminaryBalance))}</p>
          <p className="mt-1 text-xs font-semibold text-slate-600">{preliminaryBalance === null ? 'Pendiente de conciliación de fuentes y crédito fiscal' : preliminaryBalance >= 0 ? 'Estimación usando crédito acreditable y prorrata' : 'Saldo a favor preliminar usando crédito acreditable'}</p>
        </article>
      </section>

      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div className="text-sm text-amber-950">
            <p className="font-bold">Control previo a la declaración; no es todavía una declaración SENIAT ni un pago registrado.</p>
            {dailySalesResolution.unresolvedDates.length > 0 && <p className="mt-2 font-bold">Selecciona para cada fecha coincidente si el contador registró las ventas mediante el Reporte Z o mediante facturas individuales. SICOVEN incluirá una sola fuente por día.</p>}
            {unfiledActivityPeriods.length > 0 && <p className="mt-2 font-bold text-rose-800">Hay períodos mensuales anteriores sin declaración presentada: {unfiledActivityPeriods.join(', ')}. Puedes preparar y revisar este borrador; antes de registrar la presentación, completa o regulariza esos períodos.</p>}
            {laterFiledPeriods.length > 0 && <p className="mt-2 font-bold text-rose-800">Ya existen declaraciones posteriores presentadas: {laterFiledPeriods.join(', ')}. No se permite alterar este mes directamente; utiliza el procedimiento de rectificación para conservar la secuencia fiscal.</p>}
            {activityPeriodError && <p className="mt-2 font-bold text-rose-800">{activityPeriodError}</p>}
            <p className="mt-1">El IVA bruto de compras no equivale automáticamente al crédito acreditable: el estimado aplica el tratamiento gravado/exento/común y la prorrata sobre las ventas seleccionadas. El cálculo definitivo se conserva en el borrador. El crédito fiscal y las retenciones deben validarse contra sus comprobantes, requisitos de deducibilidad y período fiscal. Los reportes Z de POS externo se muestran como soporte operativo y requieren conciliación con los documentos fiscales exigibles. Si también se registraron esas mismas facturas individualmente, no deben computarse dos veces. Este saldo no sustituye la revisión del contador ni la Forma 30.</p>
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
              <button type="button" disabled={savedDeclaration?.status === 'FILED'} onClick={() => setDailySourceChoices(prev => ({ ...prev, [conflict.date]: 'Z' }))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSourceChoices[conflict.date] === 'Z' ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>Usar Reporte Z</button>
              <button type="button" disabled={savedDeclaration?.status === 'FILED'} onClick={() => setDailySourceChoices(prev => ({ ...prev, [conflict.date]: 'INDIVIDUAL' }))} className={`rounded-lg border px-3 py-2 text-sm font-semibold ${activeSourceChoices[conflict.date] === 'INDIVIDUAL' ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-slate-300 text-slate-700'}`}>Usar ventas individuales</button>
            </div>
          </div>)}
        </div>
      </section>}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <FileText className="h-4 w-4 text-slate-600" />
          <h2 className="font-bold text-slate-900">Reportes Z incluidos en el débito fiscal</h2>
        </div>
        {zSources.length === 0 ? <p className="p-6 text-center text-sm text-slate-500">No hay reportes Z seleccionados como fuente del débito fiscal para este período. Si existen días coincidentes, revisa la fuente elegida en cada fecha.</p> : (
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
          <p className="mt-2 text-sm text-slate-600">El IVA bruto se separa del monto acreditable. El estimado aplica el tratamiento gravado (100%), exento (0%) o común (prorrata según ventas gravadas y exentas).</p>
          <p className="mt-3 text-lg font-black text-sky-800">{purchaseCreditEligible === null ? 'Pendiente de conciliar' : format(purchaseCreditEligible)}</p>
          {prorationUnavailable && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-900">No existe una base válida de ventas gravadas y exentas para determinar la prorrata de las compras comunes. Puedes guardar un borrador provisional con el crédito pendiente en cero; no podrás registrar la presentación hasta conciliar y actualizar el borrador.</p>}
          {purchaseSummaryError && <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs font-semibold text-rose-900">{purchaseSummaryError}</p>}
          {purchaseSummary && (purchaseCreditReversal > 0 || purchaseCreditReversalNonEligible > 0) && <p className="mt-2 rounded-lg bg-sky-50 p-2 text-xs font-semibold text-sky-900">Notas de crédito de períodos anteriores: reversión de crédito acreditable {format(purchaseCreditReversal)} · reversión de IVA no acreditable {format(purchaseCreditReversalNonEligible)}.</p>}
          <p className="mt-1 text-xs text-slate-500">IVA bruto: {purchaseSummary ? format(purchaseCredit) : 'Pendiente'} · No acreditable estimado: {purchaseCreditNonEligible === null ? '—' : format(purchaseCreditNonEligible)}</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-violet-700" /><h2 className="font-bold text-slate-900">Retenciones y ajustes de IVA</h2></div>
          <p className="mt-2 text-sm text-slate-600">Se descuentan únicamente las retenciones registradas en los documentos de venta de este período. Verifica que exista el comprobante y que corresponda al mes declarado.</p>
          <p className="mt-3 text-lg font-black text-violet-800">{format(receivedWithholdings)}</p>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-lg font-bold text-slate-900">Declaración mensual · Control y presentación</h2><p className="mt-1 text-sm text-slate-600">Prepara un borrador desde los libros, conserva las fuentes elegidas y registra presentación y enteramientos con su asiento contable.</p></div>
          {!savedDeclaration && <button type="button" disabled={!isStorageReady || !isValidVatOwnDeclarationPeriod(period) || outputVat === null || !currentPositionPreview || laterFiledPeriods.length > 0 || Boolean(activityPeriodError)} onClick={async()=>{
            setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
            try { await createVatOwnDeclaration({period,choices:activeSourceChoices});setWorkflowMessage('Borrador de declaración guardado y confirmado en SQLite.'); }
            catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo preparar la declaración.');}
            finally{setWorkflowBusy(false);}
          }} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Guardando…':'Preparar declaración mensual'}</button>}
        </div>
        {savedDeclaration ? <>
          <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-slate-100 px-3 py-1 font-bold text-slate-700">{savedDeclaration.period}</span><span className={`rounded-full px-3 py-1 font-bold ${savedDeclaration.status==='FILED'?'bg-emerald-100 text-emerald-800':'bg-amber-100 text-amber-800'}`}>{savedDeclaration.status==='FILED'?'PRESENTADA':'BORRADOR'}</span>{savedDeclaration.declarationNumber && <span className="font-mono text-slate-600">N° {savedDeclaration.declarationNumber}</span>}<span className="text-slate-500">Fuentes fiscales: {savedDeclaration.sourceIds.length} · Facturas relacionadas: {savedDeclaration.relatedSourceIds?.length || 0}</span>{savedDeclaration.calculationStatus === 'PROVISIONAL' && <span className="rounded-full bg-amber-100 px-3 py-1 font-bold text-amber-900">CÁLCULO PROVISIONAL</span>}</div>
          {savedDeclaration.calculationStatus === 'PROVISIONAL' && (savedDeclaration.pendingCalculationItems || []).length > 0 && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><p className="font-bold">El débito fiscal se guardó; el crédito fiscal sigue pendiente.</p><ul className="mt-2 list-disc space-y-1 pl-5">{savedDeclaration.pendingCalculationItems!.map((item,index)=><li key={index}>{item}</li>)}</ul><p className="mt-2 font-semibold">El saldo mostrado es provisional y no puede presentarse al SENIAT hasta actualizar este borrador.</p></div>}
          {savedDeclaration.status === 'DRAFT' && draftNeedsRefresh && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
            <p className="text-sm font-semibold text-amber-950">El borrador quedó desactualizado frente a los libros o la tasa BCV vigente. Revisa las fuentes diarias pendientes y actualízalo antes de presentarlo. La versión anterior se conservará en el historial.</p>
            {dailySalesResolution.unresolvedDates.length > 0 && <p className="text-xs text-amber-900">Fechas que requieren elegir una fuente: {dailySalesResolution.unresolvedDates.join(', ')}</p>}
            <button type="button" disabled={workflowBusy || !isValidVatOwnDeclarationPeriod(period) || outputVat === null || !currentPositionPreview || prorationRate === null || Boolean(purchaseSummaryError) || unfiledActivityPeriods.length > 0 || laterFiledPeriods.length > 0 || Boolean(activityPeriodError) || dailySalesResolution.unresolvedDates.length > 0} onClick={async()=>{
              setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
              try { await createVatOwnDeclaration({period,choices:activeSourceChoices,refresh:true});setWorkflowMessage('Borrador actualizado. La versión anterior quedó conservada en el historial.'); }
              catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo actualizar el borrador.');}
              finally{setWorkflowBusy(false);}
            }} className="rounded-lg bg-amber-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Actualizando…':'Actualizar borrador'}</button>
          </div>}
          {(savedDeclaration.revisions?.length || 0) > 0 && <details className="rounded-lg border border-slate-200 p-3 text-xs">
            <summary className="cursor-pointer font-bold text-slate-700">Historial de versiones del borrador ({savedDeclaration.revisions!.length})</summary>
            <div className="mt-2 space-y-2">{savedDeclaration.revisions!.map(revision=><div key={revision.revision} className="rounded-md bg-slate-50 p-2">
              <p className="font-semibold">Versión anterior {revision.revision} · {revision.revisedAt.slice(0,10)}</p>
              <p>IVA por enterar: {format(revision.position.amountDueBs)} · Crédito trasladable: {format(revision.position.creditCarryForwardBs)} · Fuentes: {revision.sourceIds.length} · Relacionadas: {revision.relatedSourceIds?.length || 0}</p>
              <p className="text-slate-500">{revision.reason}</p>
            </div>)}</div>
          </details>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">IVA débito</p><strong>{format(savedDeclaration.position.outputVatBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Crédito acreditable</p><strong>{format(savedDeclaration.position.purchaseCreditBs)}</strong><p className="mt-1 text-[10px] text-slate-500">Bruto: {format(savedDeclaration.position.purchaseCreditGrossBs)}</p></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Retenciones recibidas</p><strong>{format(savedDeclaration.position.receivedWithholdingsBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">IVA por enterar</p><strong>{format(savedDeclaration.position.amountDueBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Crédito trasladable</p><strong>{format(savedDeclaration.position.creditCarryForwardBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">Reversión crédito previo</p><strong>{format(Number(savedDeclaration.position.purchaseCreditReversalBs || 0))}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><p className="text-[11px] text-slate-500">IVA no acreditable reclasificado</p><strong>{format(Number(savedDeclaration.position.purchaseCreditNonEligibleBs || 0) + Number(savedDeclaration.position.purchaseCreditReversalNonEligibleBs || 0))}</strong></div>
          </div>
          <div className="grid grid-cols-1 gap-2 rounded-lg border border-slate-100 p-3 text-xs sm:grid-cols-2">
            <div><strong>Desglose del débito fiscal:</strong> IVA 16% (incluye base 31%): {format(savedDeclaration.position.outputVat16Bs)} · IVA 8%: {format(savedDeclaration.position.outputVat8Bs)}</div>
            <div><strong>Desglose del crédito fiscal:</strong> Compras 16%: {format(savedDeclaration.position.purchaseCredit16Bs)} · Compras 8%: {format(savedDeclaration.position.purchaseCredit8Bs)}</div>
          </div>
          <p className="text-xs text-slate-500">El impuesto adicional del 15% y el IGTF se mantienen separados del IVA acreditable y del débito fiscal; no se suman como IVA en la declaración mensual.</p>
          <p className="text-xs text-slate-500">El asiento de determinación reclasifica el IVA no acreditable hacia las mismas cuentas de inventario, costo, gasto o activo utilizadas por las compras de origen. Líneas de reclasificación: {savedDeclaration.purchaseVatReclassificationItems?.length || 0}.</p>
          {(savedDeclaration.purchaseVatReclassificationItems?.length || 0) > 0 && <details className="rounded-lg border border-slate-200 p-3 text-xs">
            <summary className="cursor-pointer font-bold text-slate-700">Ver detalle de reclasificación por cuenta</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left">
                <thead className="bg-slate-50 text-slate-500"><tr><th className="px-2 py-2">Cuenta de origen</th><th className="px-2 py-2">Concepto</th><th className="px-2 py-2 text-right">Debe Bs.</th><th className="px-2 py-2 text-right">Haber Bs.</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{savedDeclaration.purchaseVatReclassificationItems!.map((item,index)=><tr key={item.accountCode+'-'+index}>
                  <td className="px-2 py-2"><strong>{item.accountCode}</strong><p className="text-slate-500">{item.accountName}</p></td>
                  <td className="px-2 py-2">{item.description}</td>
                  <td className="px-2 py-2 text-right font-mono">{item.debitBs>0?format(item.debitBs):'—'}</td>
                  <td className="px-2 py-2 text-right font-mono">{item.creditBs>0?format(item.creditBs):'—'}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>}
          {savedDeclaration.status==='DRAFT' ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
            <p className="text-sm font-semibold text-amber-950">Al presentar, SICOVEN registra el número oficial y el asiento de determinación mensual. El borrador y sus documentos fuente permanecen conservados.</p>
            {!periodCanBeFiled && <p className="text-xs font-semibold text-amber-900">La presentación estará disponible después de finalizar el período {period} (cierre: {periodEndDate || 'fecha pendiente'}). Puedes preparar y conciliar el borrador mientras tanto.</p>}
            <div className="flex flex-wrap gap-2"><input value={declarationNumber} onChange={event=>setDeclarationNumber(event.target.value)} placeholder="Número oficial de declaración" className="min-w-[220px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" />
              <button type="button" disabled={workflowBusy || !declarationNumber.trim() || draftNeedsRefresh || !periodCanBeFiled} onClick={async()=>{
                setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
                try { await recordVatOwnDeclarationEvent(savedDeclaration.id,{companyId:currentCompany.id,eventType:'FILED',occurredAt:localIsoDateTime(new Date(new Date().getFullYear(),new Date().getMonth(),new Date().getDate(),12)),declarationNumber:declarationNumber.trim(),idempotencyKey:'FILED:'+savedDeclaration.id});setWorkflowMessage('Presentación registrada con su asiento de determinación.'); }
                catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo registrar la presentación.');}
                finally{setWorkflowBusy(false);}
              }} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Procesando…':'Registrar presentación'}</button>
            </div>
          </div> : <div className="rounded-xl border border-slate-200 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">Saldo pendiente de enteramiento</strong><strong className="text-lg">{format(declarationOutstanding)}</strong></div>
            {declarationOutstanding>0.01 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input type="date" value={paymentDate} onChange={event=>{const nextDate=event.target.value;setPaymentDate(nextDate);const rate=resolveVatOwnPaymentBcvRate(currentCompany.accountingBcvRateHistory || [],nextDate);setPaymentBcvRate(rate===null?'':String(rate));}} className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentAmount} onChange={event=>setPaymentAmount(event.target.value)} placeholder="Importe pagado en Bs." inputMode="decimal" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentReference} onChange={event=>setPaymentReference(event.target.value)} placeholder="Referencia del comprobante" className="rounded-lg border px-3 py-2 text-sm" />
              <input value={paymentBcvRate} onChange={event=>setPaymentBcvRate(event.target.value)} placeholder="Tasa BCV del pago" inputMode="decimal" className="rounded-lg border px-3 py-2 text-sm" /><p className="text-xs text-slate-500 sm:col-span-2">{paymentHistoricalBcvRate===null?'No hay tasa BCV histórica registrada para esta fecha.':`BCV histórico efectivo: ${paymentHistoricalBcvRate} Bs/USD`}</p>
              <select value={treasuryAccountCode} onChange={event=>setTreasuryAccountCode(event.target.value)} className="rounded-lg border px-3 py-2 text-sm sm:col-span-2"><option value="">Cuenta de caja o banco…</option>{accounts.filter(account=>account.isMovement&&account.type==='ACTIVO'&&account.code.startsWith('1.1.1.')).map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select>
              <button type="button" disabled={workflowBusy||!paymentReference.trim()||!paymentAmount.trim()||!treasuryAccountCode||!paymentRateMatchesHistory} onClick={async()=>{
                setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
                try { await recordVatOwnDeclarationEvent(savedDeclaration.id,{companyId:currentCompany.id,eventType:'PAYMENT',occurredAt:paymentDate+'T12:00:00.000Z',amountBs:parseLocalizedNumber(paymentAmount),reference:paymentReference.trim(),bcvRate:parseLocalizedNumber(paymentBcvRate),treasuryAccountCode,idempotencyKey:'PAYMENT:'+savedDeclaration.id+':'+paymentReference.trim()});setPaymentAmount('');setPaymentReference('');setWorkflowMessage('Pago registrado y contabilizado.');}
                catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo registrar el pago.');}
                finally{setWorkflowBusy(false);}
              }} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-40">{workflowBusy?'Registrando…':'Registrar pago y asiento'}</button>
            </div>}
            {declarationOutstanding<=0.01 && <p className="text-sm font-semibold text-emerald-800">Declaración totalmente enterada o con saldo a favor. No hay pagos pendientes.</p>}
          </div>}
          <div className="space-y-2"><h3 className="text-sm font-bold text-slate-800">Historial de eventos</h3>
            {declarationEvents.length===0 ? <p className="text-xs text-slate-500">Todavía no hay presentación ni pagos registrados.</p> : declarationEvents.map(event=>{
              const reversed = declarationEvents.some(item=>item.eventType==='REVERSAL'&&item.reversalOfEventId===event.id);
              return <div key={event.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 px-3 py-2 text-xs">
                <span className="font-semibold">{event.eventType==='FILED'?'Presentación':event.eventType==='PAYMENT'?'Pago':'Reversión'} · {event.reference || event.declarationNumber || event.note || 'Evento fiscal'}{event.journalEntryId?' · Asiento '+event.journalEntryId:''}</span>
                <span className="flex items-center gap-2 text-slate-500">{event.occurredAt.slice(0,10)}{event.amountBs? ' · '+format(event.amountBs):''}
                  {event.eventType==='PAYMENT'&&!reversed&&<button type="button" disabled={workflowBusy} onClick={async()=>{
                    const reason=window.prompt('Indica el motivo de reversión del pago. El asiento original se conservará en el historial.');
                    if(!reason?.trim())return;
                    setWorkflowBusy(true);setWorkflowError('');setWorkflowMessage('');
                    try { await recordVatOwnDeclarationEvent(savedDeclaration.id,{companyId:currentCompany.id,eventType:'REVERSAL',occurredAt:localIsoDateTime(new Date()),idempotencyKey:'REVERSAL:'+event.id,reversalOfEventId:event.id,note:reason.trim()});setWorkflowMessage('Pago revertido mediante contra-asiento.'); }
                    catch(error){setWorkflowError(error instanceof Error?error.message:'No se pudo revertir el pago.');}
                    finally{setWorkflowBusy(false);}
                  }} className="font-bold text-rose-700 underline">Revertir pago</button>}
                </span>
              </div>;
            })}
          </div>
        </> : <p className="text-sm text-slate-500">Todavía no existe una declaración guardada para este período. Resuelve las fechas coincidentes y prepara el borrador para conservar los importes y documentos que lo sustentan.</p>}
        {workflowError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{workflowError}</p>}
        {workflowMessage && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{workflowMessage}</p>}
      </section>
    </div>
  );
};
