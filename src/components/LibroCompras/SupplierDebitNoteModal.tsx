import React, { useMemo, useState } from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useAccounting } from '../../context/AccountingContext';
import type { PurchaseRecord } from '../../types/accounting';
import type { SupplierDebitNoteEconomicCause } from '../../types/supplierDebitNote';

interface Props {
  purchase: PurchaseRecord;
  onClose: () => void;
}

const localToday = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};
const money = (value: number) => new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(value);

export const SupplierDebitNoteModal: React.FC<Props> = ({ purchase, onClose }) => {
  const {
    accounts, journalEntries, currentCompany, addSupplierDebitNote,
    isStorageReady, storageError
  } = useAccounting();
  const sqliteAvailable = typeof window !== 'undefined' && Boolean(window.sicovenStore?.save);
  const [issueDate, setIssueDate] = useState(localToday);
  const [recognitionDate, setRecognitionDate] = useState(localToday);
  const [debitNoteNumber, setDebitNoteNumber] = useState('');
  const [controlNumber, setControlNumber] = useState('');
  const [economicCause, setEconomicCause] = useState<SupplierDebitNoteEconomicCause>('ADDITIONAL_EXPENSE');
  const [reason, setReason] = useState('');
  const [classificationNote, setClassificationNote] = useState('');
  const [debitAccountCode, setDebitAccountCode] = useState('');
  const [payableAccountCode, setPayableAccountCode] = useState('');
  const [vatAccountCode, setVatAccountCode] = useState('');
  const [taxableBase, setTaxableBase] = useState('');
  const [exemptAmount, setExemptAmount] = useState('');
  const [vatAmount, setVatAmount] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const [bcvRate, setBcvRate] = useState(String(currentCompany.bcvRate || purchase.bcvRate || ''));
  const [fiscalBreakdownReviewed, setFiscalBreakdownReviewed] = useState(false);
  const [withholdingNotApplicableConfirmed, setWithholdingNotApplicableConfirmed] = useState(false);
  const [igtfNotApplicableConfirmed, setIgtfNotApplicableConfirmed] = useState(false);
  const [fiscalReviewNote, setFiscalReviewNote] = useState('');
  const [fiscalEmissionMedium, setFiscalEmissionMedium] = useState<'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | ''>('');
  const [sameMediumAsOriginal, setSameMediumAsOriginal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const sourceEntry = journalEntries.find(entry =>
    entry.companyId === purchase.companyId && entry.id === purchase.journalEntryId
  );
  const sourcePayableCodes = [...new Set((sourceEntry?.items || [])
    .filter(item => item.accountCode.startsWith('2.1.1.') && Number(item.creditBs) > 0)
    .map(item => item.accountCode))];
  const payableAccounts = accounts.filter(account =>
    account.isMovement && account.type === 'PASIVO' && account.code.startsWith('2.1.1.')
  );
  const suggestedPayableCode = purchase.paymentTerm === 'CREDITO' && sourcePayableCodes.length === 1
    ? sourcePayableCodes[0]
    : (payableAccounts.find(account => account.code === '2.1.1.01')?.code || payableAccounts[0]?.code || '');
  const debitAccounts = useMemo(() => accounts.filter(account =>
    account.isMovement && (economicCause === 'FINANCING_CHARGE'
      ? account.type === 'GASTOS'
      : account.type === 'COSTOS' || account.type === 'GASTOS')
  ), [accounts, economicCause]);
  const vatAccounts = accounts.filter(account =>
    account.isMovement && ['ACTIVO', 'COSTOS', 'GASTOS'].includes(account.type)
  );
  const taxableBaseBs = Number(taxableBase || 0);
  const exemptAmountBs = Number(exemptAmount || 0);
  const vatAmountBs = Number(vatAmount || 0);
  const taxRateValue = Number(taxRate);
  const totalAmountBs = Math.round((taxableBaseBs + exemptAmountBs + vatAmountBs + Number.EPSILON) * 100) / 100;
  const isInventoryCause = economicCause === 'ADDITIONAL_GOODS_RECEIVED' || economicCause === 'INVENTORY_COST_ADJUSTMENT';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError('');
    setSuccess('');
    if (!sqliteAvailable || !isStorageReady) {
      setError(storageError || 'SQLite local no está disponible. No se puede registrar la ND.');
      return;
    }
    if (purchase.documentType !== '01' || purchase.isCancelled) {
      setError('Solo se puede emitir una ND contra una factura original vigente tipo 01.');
      return;
    }
    if (!debitNoteNumber.trim() || !controlNumber.trim() || reason.trim().length < 10) {
      setError('Complete número de ND, número de control y una justificación de al menos 10 caracteres.');
      return;
    }
    if (economicCause === 'OTHER' && classificationNote.trim().length < 10) {
      setError('Describa la clasificación económica de la causa Otra con al menos 10 caracteres.');
      return;
    }
    if (!debitAccountCode || !payableAccountCode || !Number.isFinite(Number(bcvRate)) || Number(bcvRate) <= 0) {
      setError('Seleccione las cuentas contables y una tasa BCV válida.');
      return;
    }
    if ([taxableBaseBs, exemptAmountBs, vatAmountBs, taxRateValue].some(value => !Number.isFinite(value) || value < 0) || taxRateValue > 100 || !taxRate.trim() || totalAmountBs <= 0) {
      setError('Los importes deben ser positivos o cero y el total de la ND debe ser mayor que cero.');
      return;
    }
    if (vatAmountBs > 0 && (!vatAccountCode || !fiscalBreakdownReviewed)) {
      setError('El IVA requiere cuenta contable de destino seleccionada y revisión profesional confirmada.');
      return;
    }
    if (!withholdingNotApplicableConfirmed || !igtfNotApplicableConfirmed || fiscalReviewNote.trim().length < 10) {
      setError('Confirme expresamente la revisión de retenciones e IGTF y documente el criterio profesional. Si aplica alguno, no registre aún la ND.');
      return;
    }
    if (isInventoryCause) {
      setError('Las ND por mercancía adicional o ajuste de inventario permanecen bloqueadas hasta completar recepción, costos y Kardex por líneas.');
      return;
    }

    setSubmitting(true);
    try {
      const note = await addSupplierDebitNote({
        sourcePurchaseId: purchase.id,
        debitNoteNumber: debitNoteNumber.trim(),
        controlNumber: controlNumber.trim(),
        affectedInvoiceNumber: purchase.invoiceNumber,
        fiscalEmissionMedium: fiscalEmissionMedium as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY', sameMediumAsOriginal,
        issueDate, recognitionDate, economicCause, reason: reason.trim(),
        classificationNote: classificationNote.trim() || undefined,
        debitAccountCode, payableAccountCode: payableAccountCode || suggestedPayableCode,
        vatAccountCode: vatAccountCode || undefined,
        taxableBaseBs, exemptAmountBs, vatAmountBs, totalAmountBs, taxRate: taxRateValue,
        bcvRate: Number(bcvRate), fiscalBreakdownReviewed,
        withholdingNotApplicableConfirmed, igtfNotApplicableConfirmed,
        fiscalReviewNote: fiscalReviewNote.trim(), fiscalEmissionMedium: fiscalEmissionMedium as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY',
        sameMediumAsOriginal
      });
      setSuccess('ND ' + (note.debitNoteNumber || note.invoiceNumber) + ' registrada y confirmada en SQLite como obligación independiente. La factura original no fue modificada.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo confirmar la ND en SQLite.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/70 p-3 sm:p-6">
      <div className="flex max-h-[95vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-900 px-5 py-4 text-white">
          <div>
            <h2 className="text-base font-bold">Nota de débito de proveedor · Tipo 02</h2>
            <p className="mt-1 text-xs text-slate-300">Factura afectada {purchase.invoiceNumber} · {purchase.supplierName} · {purchase.supplierRif}</p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-5 overflow-y-auto p-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><p>La ND se registra como documento y obligación propios. No modifica la factura original ni genera movimientos de inventario. Retenciones, IGTF y efectos fiscales automáticos permanecen desactivados.</p></div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs font-semibold text-slate-700">Número de ND<input required value={debitNoteNumber} onChange={e=>setDebitNoteNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Número de control<input required value={controlNumber} onChange={e=>setControlNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Factura afectada<input readOnly value={purchase.invoiceNumber} className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Fecha de emisión<input required type="date" value={issueDate} onChange={e=>setIssueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Fecha de reconocimiento / abono<input required type="date" value={recognitionDate} onChange={e=>setRecognitionDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
            <label className="text-xs font-semibold text-slate-700">Tasa BCV de la ND<input required type="number" min="0.000001" step="0.000001" value={bcvRate} onChange={e=>setBcvRate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
          </div>
            <label className="text-xs font-semibold text-slate-700">Medio de emisión de la factura original
          <select required value={fiscalEmissionMedium} onChange={event => setFiscalEmissionMedium(event.target.value as 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | '')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal">
            <option value="">Seleccione…</option><option value="DIGITAL">Digital / electrónico</option><option value="FISCAL_MACHINE">Máquina fiscal</option><option value="CONTINGENCY">Contingencia autorizada</option>
          </select>
        </label>
        <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={sameMediumAsOriginal} onChange={event => setSameMediumAsOriginal(event.target.checked)} className="mt-0.5" />Confirmo que la ND se emitió por el mismo medio de la factura original, conforme a la Providencia SNAT/2026/00093.</label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Causa económica<select value={economicCause} onChange={e=>setEconomicCause(e.target.value as SupplierDebitNoteEconomicCause)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="PRICE_DIFFERENCE">Diferencia de precio</option>
              <option value="ADDITIONAL_EXPENSE">Gasto adicional</option>
              <option value="FINANCING_CHARGE">Cargo de financiación</option>
              <option value="OTHER">Otra causa</option>
            </select></label>
            <label className="text-xs font-semibold text-slate-700">Cuenta de débito según plan de cuentas<select required value={debitAccountCode} onChange={e=>setDebitAccountCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="">Seleccione cuenta</option>{debitAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
            </select></label>
          </div>
          <label className="block text-xs font-semibold text-slate-700">Justificación económica<textarea required minLength={10} value={reason} onChange={e=>setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Explique el origen económico del cargo." /></label>
          {economicCause === 'OTHER' && <label className="block text-xs font-semibold text-slate-700">Clasificación de la causa<textarea required minLength={10} value={classificationNote} onChange={e=>setClassificationNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>}
          <div>
            <h3 className="mb-2 text-sm font-bold text-slate-900">Desglose manual del documento</h3><p className="mb-2 text-xs text-slate-500">Este flujo admite una sola alícuota de IVA por ND. Si el documento contiene alícuotas mixtas, no lo registre aquí.</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="text-xs font-semibold text-slate-700">Base imponible Bs.<input required type="number" min="0" step="0.01" value={taxableBase} onChange={e=>setTaxableBase(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Exento Bs.<input required type="number" min="0" step="0.01" value={exemptAmount} onChange={e=>setExemptAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">Alícuota única IVA %<input required type="number" min="0" max="100" step="0.01" value={taxRate} onChange={e=>setTaxRate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <label className="text-xs font-semibold text-slate-700">IVA del documento Bs.<input required type="number" min="0" step="0.01" value={vatAmount} onChange={e=>setVatAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" /></label>
              <div className="rounded-lg border bg-slate-50 p-3"><p className="text-xs text-slate-500">Total calculado Bs.</p><p className="mt-1 text-lg font-bold text-slate-900">{money(totalAmountBs)}</p></div>
            </div>
            {vatAmountBs > 0 && <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700">Cuenta de destino del IVA (selección profesional)<select required value={vatAccountCode} onChange={e=>setVatAccountCode(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
                <option value="">Seleccione cuenta de destino</option>{vatAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name} ({account.type})</option>)}
              </select></label>
              <label className="flex items-center gap-2 rounded-lg border p-3 text-xs text-slate-700"><input type="checkbox" checked={fiscalBreakdownReviewed} onChange={e=>setFiscalBreakdownReviewed(e.target.checked)} />Confirmo que el desglose de IVA fue revisado contra el documento y su tratamiento contable.</label>
            </div>}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">Cuenta auxiliar CxP de la ND<select required value={payableAccountCode || suggestedPayableCode} onChange={e=>setPayableAccountCode(e.target.value)} disabled={purchase.paymentTerm === 'CREDITO' && sourcePayableCodes.length === 1} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">Seleccione auxiliar CxP</option>{payableAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}
            </select><span className="mt-1 block text-[11px] font-normal text-slate-500">{purchase.paymentTerm === 'CREDITO' ? 'Se conserva el auxiliar CxP de la factura original.' : 'La factura original fue de contado; esta ND genera una obligación nueva e independiente.'}</span></label>
            <label className="text-xs font-semibold text-slate-700">Revisión profesional de retenciones / IGTF<textarea required minLength={10} value={fiscalReviewNote} onChange={e=>setFiscalReviewNote(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Documente por qué no resultan aplicables las retenciones ni el IGTF." /></label>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex items-start gap-2 rounded-lg border p-3 text-xs text-slate-700"><input type="checkbox" checked={withholdingNotApplicableConfirmed} onChange={e=>setWithholdingNotApplicableConfirmed(e.target.checked)} className="mt-0.5" />Confirmo que, tras la revisión profesional, no corresponde registrar retención de IVA ni ISLR en esta ND.</label>
            <label className="flex items-start gap-2 rounded-lg border p-3 text-xs text-slate-700"><input type="checkbox" checked={igtfNotApplicableConfirmed} onChange={e=>setIgtfNotApplicableConfirmed(e.target.checked)} className="mt-0.5" />Confirmo que el IGTF no se reconoce en este momento o no resulta aplicable a esta operación.</label>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <strong>Inventario:</strong> las causas «mercancía adicional» y «ajuste de costo de inventario» no están disponibles aquí. Requieren recepción documentada, productos, cantidades, costos y conciliación Kardex antes de habilitarse.
          </div>
          {error && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
          {success && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{success}</div>}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <button type="button" onClick={onClose} disabled={submitting} className="rounded-lg border px-4 py-2 text-sm font-semibold text-slate-700">Cerrar</button>
            <button type="submit" disabled={submitting || Boolean(success)} className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}{submitting ? 'Guardando en SQLite…' : 'Registrar ND tipo 02'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
