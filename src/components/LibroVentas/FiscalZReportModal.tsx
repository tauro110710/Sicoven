import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { FiscalZReportMetadata, JournalEntryItem } from '../../types/accounting';
import { calculateFiscalZTaxBreakdown } from '../../types/fiscalZReport';

type PaymentKey = 'cash' | 'foreignCash' | 'transfer' | 'card' | 'credit' | 'other';
const PAYMENT_ROWS: Array<{ key: PaymentKey; label: string; defaultAccount: string }> = [
  { key: 'cash', label: 'Efectivo en bolívares', defaultAccount: '1.1.1.01' },
  { key: 'foreignCash', label: 'Efectivo en divisas', defaultAccount: '1.1.1.02' },
  { key: 'transfer', label: 'Transferencias / depósitos', defaultAccount: '1.1.1.03' },
  { key: 'card', label: 'Tarjetas / punto de venta', defaultAccount: '1.1.1.03' },
  { key: 'credit', label: 'Ventas a crédito / cuentas por cobrar', defaultAccount: '1.1.2.01' },
  { key: 'other', label: 'Otros medios de cobro', defaultAccount: '1.1.1.01' }
];
const parseAmount = (value: string) => {
  const raw = value.trim();
  if (!raw) return 0;
  return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw);
};
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

interface Props { isOpen: boolean; onClose: () => void; }
export const FiscalZReportModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { currentCompany, accounts, journalEntries, addJournalEntry, waitForPersistence } = useAccounting();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [zNumber, setZNumber] = useState('');
  const [machineBrand, setMachineBrand] = useState('');
  const [machineModel, setMachineModel] = useState('');
  const [machineSerial, setMachineSerial] = useState('');
  const [invoiceStart, setInvoiceStart] = useState('');
  const [invoiceEnd, setInvoiceEnd] = useState('');
  const [controlStart, setControlStart] = useState('');
  const [controlEnd, setControlEnd] = useState('');
  const [base16, setBase16] = useState('');
  const [base8, setBase8] = useState('');
  const [base31, setBase31] = useState('');
  const [exempt, setExempt] = useState('');
  const [igtf, setIgtf] = useState('');
  const [rateInput, setRateInput] = useState(String(currentCompany.bcvRate || '').replace('.', ','));
  const [payments, setPayments] = useState<Record<PaymentKey, string>>({ cash: '', foreignCash: '', transfer: '', card: '', credit: '', other: '' });
  const [paymentAccounts, setPaymentAccounts] = useState<Record<PaymentKey, string>>({
    cash: '1.1.1.01', foreignCash: '1.1.1.02', transfer: '1.1.1.03', card: '1.1.1.03', credit: '1.1.2.01', other: '1.1.1.01'
  });
  const [observations, setObservations] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const movementAccounts = useMemo(() => accounts.filter(account => account.isMovement), [accounts]);
  const assetAccounts = movementAccounts.filter(account => account.type === 'ACTIVO');
  const receivableAccount = movementAccounts.find(account => account.code === '1.1.2.01' && account.type === 'ACTIVO');
  const revenueTaxable = movementAccounts.find(account => account.code === '4.1.1.01' && account.type === 'INGRESOS');
  const revenueExempt = movementAccounts.find(account => account.code === '4.1.1.02' && account.type === 'INGRESOS');
  const vat16Account = movementAccounts.find(account => account.code === '2.1.2.01' && account.type === 'PASIVO');
  const vat8Account = movementAccounts.find(account => account.code === '2.1.2.02' && account.type === 'PASIVO');
  const igtfAccount = movementAccounts.find(account => account.code === '2.1.2.06' && account.type === 'PASIVO');
  const luxuryTaxAccount = movementAccounts.find(account => account.code === '2.1.2.08' && account.type === 'PASIVO');

  const rate = parseAmount(rateInput);
  const b16 = parseAmount(base16), b8 = parseAmount(base8), b31 = parseAmount(base31);
  const e = parseAmount(exempt), ig = parseAmount(igtf);
  const taxBreakdown = calculateFiscalZTaxBreakdown({ taxableBase16Bs: b16, taxableBase8Bs: b8, taxableBase31Bs: b31, exemptSalesBs: e, igtfBs: ig });
  const { vat16Bs: v16, vat8Bs: v8, vat31Bs: v31, additionalLuxuryTaxBs: luxuryTax15, totalSalesBs: totalSales } = taxBreakdown;
  const paymentTotal = money(PAYMENT_ROWS.reduce((sum, row) => sum + parseAmount(payments[row.key]), 0));
  const diff = money(totalSales - paymentTotal);
  const fmt = (value: number) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  const sameMachineReports = journalEntries.filter(entry => entry.companyId === currentCompany.id && entry.fiscalZReport && entry.fiscalZReport.machineSerial.trim().toUpperCase() === machineSerial.trim().toUpperCase());
  const numericStart = /^\d+$/.test(invoiceStart.trim()) ? Number(invoiceStart) : null;
  const numericEnd = /^\d+$/.test(invoiceEnd.trim()) ? Number(invoiceEnd) : null;
  const sameDayRangeOverlap = numericStart !== null && numericEnd !== null && sameMachineReports.some(entry => {
    const z = entry.fiscalZReport!;
    if (z.date !== date || !/^\d+$/.test(z.invoiceStart) || !/^\d+$/.test(z.invoiceEnd)) return false;
    return numericStart <= Number(z.invoiceEnd) && numericEnd >= Number(z.invoiceStart);
  });
  const priorNumericReport = sameMachineReports.filter(entry => entry.date < date && /^\d+$/.test(entry.fiscalZReport!.invoiceEnd))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const priorEnd = priorNumericReport ? Number(priorNumericReport.fiscalZReport!.invoiceEnd) : null;
  const invoiceRangeWarning = numericStart !== null && priorEnd !== null && numericStart > priorEnd + 1
    ? 'Se observa un salto de numeración: el cierre anterior terminó en ' + priorEnd + ' y este comienza en ' + numericStart + '. Verifique el rango; puede continuar si el salto está justificado.'
    : '';

  if (!isOpen) return null;

  const updatePayment = (key: PaymentKey, value: string) => setPayments(prev => ({ ...prev, [key]: value }));
  const addLine = (items: JournalEntryItem[], account: { code: string; name: string } | undefined, amount: number, side: 'debit' | 'credit', description: string) => {
    if (amount <= 0) return;
    if (!account) throw new Error('Falta una cuenta contable de movimiento para: ' + description);
    items.push({
      accountCode: account.code, accountName: account.name,
      debitBs: side === 'debit' ? amount : 0, creditBs: side === 'credit' ? amount : 0,
      debitUsd: side === 'debit' ? amount / rate : 0, creditUsd: side === 'credit' ? amount / rate : 0,
      description
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    if (!window.sicovenStore?.save) { setError('El registro de Reporte Z requiere SICOVEN de escritorio con SQLite disponible.'); return; }
    if (!date || !zNumber.trim() || !machineSerial.trim() || !invoiceStart.trim() || !invoiceEnd.trim()) {
      setError('Complete fecha, número Z, serial de máquina fiscal y rango de facturas.'); return;
    }
    if (currentCompany.closedThroughDate && date <= currentCompany.closedThroughDate) {
      setError('El período está cerrado hasta ' + currentCompany.closedThroughDate + '.'); return;
    }
    if (!Number.isFinite(rate) || rate <= 0) { setError('Indique la tasa BCV aplicable al cierre.'); return; }
    const amounts = [b16, b8, b31, e, ig, ...PAYMENT_ROWS.map(row => parseAmount(payments[row.key]))];
    if (amounts.some(value => !Number.isFinite(value) || value < 0) || totalSales <= 0) {
      setError('Hay importes inválidos o negativos, o el cierre no contiene ventas.'); return;
    }
    if (Math.abs(diff) > 0.01) {
      setError('La distribución de cobros debe coincidir con el total del Reporte Z. Diferencia: Bs. ' + fmt(diff)); return;
    }
    if (controlStart.trim() && !controlEnd.trim() || !controlStart.trim() && controlEnd.trim()) {
      setError('Si utiliza rango de números de control, indique el inicial y el final.'); return;
    }
    const startNum = /^\d+$/.test(invoiceStart.trim()) ? Number(invoiceStart) : null;
    const endNum = /^\d+$/.test(invoiceEnd.trim()) ? Number(invoiceEnd) : null;
    if (startNum !== null && endNum !== null && endNum < startNum) { setError('La factura final no puede ser menor que la inicial.'); return; }
    if (sameDayRangeOverlap) { setError('El rango de facturas se solapa con otro Reporte Z ya registrado para esta máquina y fecha. Revise el cierre existente.'); return; }
    const referenceDoc = 'REPORTE-Z:' + machineSerial.trim().toUpperCase() + ':' + zNumber.trim().toUpperCase();
    if (journalEntries.some(entry => entry.companyId === currentCompany.id && entry.referenceDoc?.toUpperCase() === referenceDoc.toUpperCase())) {
      setError('Ese Reporte Z ya fue registrado para esta máquina fiscal.'); return;
    }
    if (PAYMENT_ROWS.some(row => parseAmount(payments[row.key]) > 0 && (
      row.key === 'credit'
        ? !receivableAccount || paymentAccounts[row.key] !== receivableAccount.code
        : !assetAccounts.some(account => account.code === paymentAccounts[row.key])
    ))) {
      setError('Seleccione una cuenta de movimiento válida para cada medio de cobro. Las ventas a crédito deben ir a Cuentas por Cobrar.'); return;
    }
    if (parseAmount(payments.credit) > 0 && !receivableAccount) { setError('El plan de cuentas no contiene una cuenta de movimiento válida para Cuentas por Cobrar.'); return; }

    setSaving(true);
    try {
      const items: JournalEntryItem[] = [];
      PAYMENT_ROWS.forEach(row => {
        const amount = parseAmount(payments[row.key]);
        if (amount <= 0) return;
        const account = movementAccounts.find(item => item.code === paymentAccounts[row.key]);
        addLine(items, account, amount, 'debit', row.label + ' · Reporte Z ' + zNumber.trim());
      });
      addLine(items, revenueTaxable, b16 + b8 + b31, 'credit', 'Ventas gravadas consolidadas · Reporte Z ' + zNumber.trim());
      addLine(items, revenueExempt, e, 'credit', 'Ventas exentas / exoneradas · Reporte Z ' + zNumber.trim());
      addLine(items, vat16Account, v16 + v31, 'credit', 'IVA débito fiscal 16% sobre ventas gravadas generales y suntuarias · Reporte Z ' + zNumber.trim());
      addLine(items, luxuryTaxAccount, luxuryTax15, 'credit', 'Impuesto adicional al consumo suntuario 15% · Reporte Z ' + zNumber.trim());
      addLine(items, vat8Account, v8, 'credit', 'IVA débito fiscal alícuota 8% · Reporte Z ' + zNumber.trim());
      addLine(items, igtfAccount, ig, 'credit', 'IGTF percibido informado en Reporte Z ' + zNumber.trim());

      const metadata: FiscalZReportMetadata = {
        date, zNumber: zNumber.trim(), machineBrand: machineBrand.trim() || undefined,
        machineModel: machineModel.trim() || undefined, machineSerial: machineSerial.trim(),
        invoiceStart: invoiceStart.trim(), invoiceEnd: invoiceEnd.trim(),
        controlStart: controlStart.trim() || undefined, controlEnd: controlEnd.trim() || undefined,
        taxableBase16Bs: b16, vat16Bs: v16, taxableBase8Bs: b8, vat8Bs: v8,
        taxableBase31Bs: b31, vat31Bs: v31, additionalLuxuryTaxBs: luxuryTax15, exemptSalesBs: e, igtfBs: ig, totalSalesBs: totalSales,
        payments: PAYMENT_ROWS.filter(row => parseAmount(payments[row.key]) > 0).map(row => ({
          method: row.label, amountBs: parseAmount(payments[row.key]), accountCode: paymentAccounts[row.key]
        })),
        observations: observations.trim() || undefined, supportRequired: false
      };
      const entry = addJournalEntry({
        entryNumber: 0, date,
        description: 'Cierre diario de ventas por Reporte Z N° ' + zNumber.trim() + ' · Máquina ' + machineSerial.trim(),
        type: 'VENTA', bcvRate: rate, referenceDoc, items, fiscalZReport: metadata
      });
      await waitForPersistence();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el Reporte Z.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[70] overflow-y-auto bg-slate-950/60 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Registrar Reporte Z">
    <div className="mx-auto my-4 max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
      <header className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
        <div><h2 className="text-base font-bold">Registrar ventas por Reporte Z</h2><p className="mt-1 text-xs text-slate-300">Cierre diario de máquina fiscal · asiento contable integrado</p></div>
        <button type="button" onClick={onClose} disabled={saving} className="rounded-lg px-3 py-2 text-sm hover:bg-slate-700">Cerrar</button>
      </header>
      <form onSubmit={handleSubmit} className="space-y-5 p-4 sm:p-6 text-xs">
        <section className="grid grid-cols-1 gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-3">
          <label className="font-semibold text-slate-700">Fecha del cierre<input type="date" value={date} onChange={event => setDate(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          <label className="font-semibold text-slate-700">Número de Reporte Z<input value={zNumber} onChange={event => setZNumber(event.target.value)} required placeholder="Ej. 001258" className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          <label className="font-semibold text-slate-700">Serial de máquina fiscal<input value={machineSerial} onChange={event => setMachineSerial(event.target.value)} required placeholder="Serial impreso en equipo" className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          <label className="font-semibold text-slate-700">Marca<input value={machineBrand} onChange={event => setMachineBrand(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          <label className="font-semibold text-slate-700">Modelo<input value={machineModel} onChange={event => setMachineModel(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          <label className="font-semibold text-slate-700">Tasa BCV del cierre<input inputMode="decimal" value={rateInput} onChange={event => setRateInput(event.target.value)} required placeholder="Ej. 889,67" className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
        </section>
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 font-bold text-slate-800">Rango de documentos emitidos</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="font-semibold">Factura inicial<input value={invoiceStart} onChange={event => setInvoiceStart(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
            <label className="font-semibold">Factura final<input value={invoiceEnd} onChange={event => setInvoiceEnd(event.target.value)} required className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
            <label className="font-semibold">Control inicial (si aplica)<input value={controlStart} onChange={event => setControlStart(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
            <label className="font-semibold">Control final (si aplica)<input value={controlEnd} onChange={event => setControlEnd(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Los números de control son opcionales y solo se completan cuando corresponden al sistema documental utilizado.</p>
          {sameDayRangeOverlap && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">El rango se solapa con otro cierre de esta máquina en la misma fecha.</p>}
          {invoiceRangeWarning && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800">{invoiceRangeWarning}</p>}
        </section>
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-3 font-bold text-slate-800">Resumen fiscal del cierre (importes en Bs.)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="font-semibold">Base gravada 16%<input inputMode="decimal" value={base16} onChange={event => setBase16(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" placeholder="0,00"/></label>
            <label className="font-semibold">Base gravada 8%<input inputMode="decimal" value={base8} onChange={event => setBase8(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" placeholder="0,00"/></label>
            <label className="font-semibold">Base gravada 31% combinado (16% IVA + 15% adicional)<input inputMode="decimal" value={base31} onChange={event => setBase31(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" placeholder="0,00"/></label>
            <label className="font-semibold">Ventas exentas / exoneradas<input inputMode="decimal" value={exempt} onChange={event => setExempt(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" placeholder="0,00"/></label>
            <label className="font-semibold">IGTF percibido (si aplica)<input inputMode="decimal" value={igtf} onChange={event => setIgtf(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" placeholder="0,00"/></label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-4">
            <div>IVA 16%<strong className="block text-sm">{fmt(v16)}</strong></div><div>IVA 8%<strong className="block text-sm">{fmt(v8)}</strong></div><div>IVA base suntuaria (16%)<strong className="block text-sm">{fmt(v31)}</strong></div><div>Adicional lujo (15%)<strong className="block text-sm">{fmt(luxuryTax15)}</strong></div><div>Total cierre<strong className="block text-sm text-emerald-700">{fmt(totalSales)}</strong></div>
          </div>
        </section>
        <section className="rounded-xl border border-slate-200 p-4">
          <h3 className="mb-1 font-bold text-slate-800">Distribución de cobros y cuentas contables</h3>
          <p className="mb-3 text-[11px] text-slate-500">Distribuya el total entre los medios realmente recibidos y ventas a crédito. Seleccione la cuenta contable que corresponda a cada medio.</p>
          <div className="space-y-3">
            {PAYMENT_ROWS.map(row => <div key={row.key} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_150px_1.5fr]">
              <label className="font-medium text-slate-700">{row.label}<input inputMode="decimal" value={payments[row.key]} onChange={event => updatePayment(row.key, event.target.value)} placeholder="0,00" className="mt-1 w-full rounded-lg border border-slate-300 p-2"/></label>
              <label className="font-semibold">Cuenta<select value={paymentAccounts[row.key]} onChange={event => setPaymentAccounts(prev => ({ ...prev, [row.key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-normal">{(row.key === 'credit' ? (receivableAccount ? [receivableAccount] : []) : assetAccounts).map(account => <option key={account.code} value={account.code}>{account.code}</option>)}</select></label>
              <div className="rounded-lg bg-slate-50 p-2 text-right"><span className="text-slate-500">Cuenta seleccionada</span><strong className="block">{movementAccounts.find(account => account.code === paymentAccounts[row.key])?.name || 'No disponible'}</strong></div>
            </div>)}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3"><span className="font-semibold">Total distribuido: Bs. {fmt(paymentTotal)}</span><span className={Math.abs(diff) <= 0.01 ? 'font-bold text-emerald-700' : 'font-bold text-rose-700'}>Diferencia: Bs. {fmt(diff)}</span></div>
          <p className="mt-2 text-[11px] text-amber-800">La porción de ventas a crédito se contabiliza como saldo consolidado en Cuentas por Cobrar; este cierre no identifica deudores individuales. El seguimiento por cliente requiere su auxiliar documental correspondiente.</p>
        </section>
        <label className="block font-semibold text-slate-700">Observaciones del contador (opcional)<textarea value={observations} onChange={event => setObservations(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal"/></label>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900"><strong>Soportes documentales opcionales.</strong> Puede registrar y contabilizar el cierre sin adjuntar PDF, fotografía ni otro archivo. La ausencia de soportes no bloquea el registro.</div>
        {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-800">{error}</div>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-slate-300 px-4 py-2 font-semibold text-slate-700">Cancelar</button><button type="submit" disabled={saving} className="rounded-lg bg-emerald-600 px-5 py-2 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Registrar Reporte Z y generar asiento'}</button></div>
      </form>
    </div>
  </div>;
};
