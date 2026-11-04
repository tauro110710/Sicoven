import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, LockKeyhole, ShieldCheck, Undo2 } from 'lucide-react';
import { useAccounting, type AccountingAuditEvent } from '../context/AccountingContext';
import { formatBs, formatUsd, formatDate } from '../utils/formatters';
import { buildReversalItems, assessJournalReversal, validateBankStatementReversal, validateSaleInventoryReturnReconciliation, validatePurchaseInventoryReconciliation, type BankStatementReversalReadiness } from '../types/journalReversal';
import type { VatFiscalIncident } from '../types/vatFiscalIncidents';

type CorrectionEmissionMedium = 'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | '';

interface CorrectionNoteFormFieldsProps {
  minDate: string;
  noteDate: string;
  setNoteDate: (value: string) => void;
  noteNumber: string;
  setNoteNumber: (value: string) => void;
  controlNumber: string;
  setControlNumber: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  taxableBase: string;
  setTaxableBase: (value: string) => void;
  exemptAmount: string;
  setExemptAmount: (value: string) => void;
  medium: CorrectionEmissionMedium;
  setMedium: (value: CorrectionEmissionMedium) => void;
  sameMedium: boolean;
  setSameMedium: (value: boolean) => void;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel: string;
}

const CorrectionNoteFormFields: React.FC<CorrectionNoteFormFieldsProps> = ({
  minDate, noteDate, setNoteDate, noteNumber, setNoteNumber,
  controlNumber, setControlNumber, reason, setReason,
  taxableBase, setTaxableBase, exemptAmount, setExemptAmount,
  medium, setMedium, sameMedium, setSameMedium, submitting, onSubmit, submitLabel
}) => (
  <div className="space-y-3">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-semibold text-slate-700">Fecha de emisión
        <input type="date" min={minDate} value={noteDate} onChange={event=>setNoteDate(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
      </label>
      <label className="text-xs font-semibold text-slate-700">Número de nota
        <input value={noteNumber} onChange={event=>setNoteNumber(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="NC / ND"/>
      </label>
      <label className="text-xs font-semibold text-slate-700">Número de control
        <input value={controlNumber} onChange={event=>setControlNumber(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
      </label>
      <label className="text-xs font-semibold text-slate-700">Base imponible (Bs.)
        <input type="number" min="0" step="0.01" value={taxableBase} onChange={event=>setTaxableBase(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
      </label>
      <label className="text-xs font-semibold text-slate-700">Monto exento (Bs.)
        <input type="number" min="0" step="0.01" value={exemptAmount} onChange={event=>setExemptAmount(event.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
      </label>
      <label className="text-xs font-semibold text-slate-700">Medio de emisión de la nota
        <select value={medium} onChange={event=>setMedium(event.target.value as CorrectionEmissionMedium)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
          <option value="">Seleccione el medio utilizado en la factura original…</option>
          <option value="DIGITAL">Digital</option>
          <option value="FISCAL_MACHINE">Máquina fiscal</option>
          <option value="CONTINGENCY">Contingencia</option>
        </select>
      </label>
    </div>
    <label className="block text-xs font-semibold text-slate-700">Motivo de la corrección
      <textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="Explique brevemente el motivo (mínimo 10 caracteres)."/>
    </label>
    <label className="flex items-start gap-2 text-xs text-slate-700">
      <input type="checkbox" checked={sameMedium} onChange={event=>setSameMedium(event.target.checked)} className="mt-0.5"/>
      Confirmo que la nota será emitida por el mismo medio de la factura original.
    </label>
    <button type="button" onClick={onSubmit} disabled={submitting || !noteDate || !noteNumber.trim() || !controlNumber.trim() || reason.trim().length<10 || !medium || !sameMedium || Number(taxableBase)<0 || Number(exemptAmount)<0 || Number(taxableBase)+Number(exemptAmount)<=0} className="rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">
      {submitting ? 'Registrando y validando…' : submitLabel}
    </button>
  </div>
);

export const ReversionFiscalView: React.FC<{ userRole?: string }> = ({ userRole = 'admin' }) => {
  const isAccountant = userRole === 'contador';
  const {
    currentCompany, accounts, journalEntries, sales, purchases, movements, products, vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents, addMovement, addPurchaseCreditNote, addPurchaseServiceCreditNote, addSaleCorrectionNote, addSupplierDebitNote,
    bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements, getCreditBalance, getAuditEvents, waitForPersistence, reverseJournalEntry, closeAccountingPeriod, listVatFiscalIncidents, createVatFiscalIncident, recordVatFiscalIncidentEvent, correctBcvRate, authorizeCorrectionCase, listCorrectionCases, executeCorrectionCase
  } = useAccounting();
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const [selectedId, setSelectedId] = useState('');
  const [executionAssistantOpen, setExecutionAssistantOpen] = useState(!isAccountant);
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [reason, setReason] = useState('');
  const [retainedEarningsCode, setRetainedEarningsCode] = useState('');
  const [correctionMovementId, setCorrectionMovementId] = useState('');
  const [correctionQuantity, setCorrectionQuantity] = useState('1');
  const [correctionDate, setCorrectionDate] = useState(today);
  const [correctionDocumentRef, setCorrectionDocumentRef] = useState('');
  const [supplierReturnLines, setSupplierReturnLines] = useState<Array<{productId:string;quantity:string}>>([{productId:'',quantity:'1'}]);
  const [supplierReturnDate, setSupplierReturnDate] = useState(today);
  const [supplierCreditNoteNumber, setSupplierCreditNoteNumber] = useState('');
  const [supplierCreditControlNumber, setSupplierCreditControlNumber] = useState('');
  const [supplierCreditReason, setSupplierCreditReason] = useState('');
  const [supplierCreditNoteSubmitting, setSupplierCreditNoteSubmitting] = useState(false);
  const [reversalSubmitting, setReversalSubmitting] = useState(false);
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false);
  const [closingPeriodSubmitting, setClosingPeriodSubmitting] = useState(false);

  const [closedDate, setClosedDate] = useState(currentCompany.closedThroughDate || '');
  const [feedback, setFeedback] = useState<{kind:'success'|'error'; message:string}|null>(null);

  const [auditEvents, setAuditEvents] = useState<AccountingAuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [fiscalIncidents, setFiscalIncidents] = useState<VatFiscalIncident[]>([]);
  const [incidentsLoading, setIncidentsLoading] = useState(false);
  const [incidentError, setIncidentError] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState('');
  const [incidentEventType, setIncidentEventType] = useState<'REVIEW_RECORDED' | 'ACTION_RECORDED'>('REVIEW_RECORDED');
  const [incidentDecision, setIncidentDecision] = useState('');
  const [incidentExternalReference, setIncidentExternalReference] = useState('');
  const [incidentSaving, setIncidentSaving] = useState(false);
  const [incidentPurchaseId, setIncidentPurchaseId] = useState('');
  const [incidentCreateReason, setIncidentCreateReason] = useState('');
  const [incidentCreating, setIncidentCreating] = useState(false);
  const [bcvCorrectionOpen, setBcvCorrectionOpen] = useState(false);
  const [bcvCorrectionRate, setBcvCorrectionRate] = useState(String(currentCompany.bcvRate || ''));
  const [bcvCorrectionDate, setBcvCorrectionDate] = useState(today);
  const [bcvCorrectionReason, setBcvCorrectionReason] = useState('');
  const [bcvCorrectionSaving, setBcvCorrectionSaving] = useState(false);
  const [requestEntityType, setRequestEntityType] = useState<'SALE' | 'PURCHASE' | 'JOURNAL_ENTRY' | 'INVENTORY_MOVEMENT' | 'BANK_MOVEMENT' | 'CREDIT_SETTLEMENT' | 'SUPPLIER_ADVANCE_SETTLEMENT'>('JOURNAL_ENTRY');
  const [requestSearch, setRequestSearch] = useState('');
  const [requestEntityId, setRequestEntityId] = useState('');
  const [requestCorrectionType, setRequestCorrectionType] = useState('NOTA_CREDITO_VENTA');
  const [requestSourceRef, setRequestSourceRef] = useState('');
  const [requestTargetRef, setRequestTargetRef] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestCorrectionDate, setRequestCorrectionDate] = useState(today);
  const [requestControlNumber, setRequestControlNumber] = useState('');
  const [requestTaxableBaseBs, setRequestTaxableBaseBs] = useState('');
  const [requestExemptAmountBs, setRequestExemptAmountBs] = useState('');
  const [requestFiscalEmissionMedium, setRequestFiscalEmissionMedium] = useState<'DIGITAL' | 'FISCAL_MACHINE' | 'CONTINGENCY' | ''>('');
  const [requestSameMediumAsOriginal, setRequestSameMediumAsOriginal] = useState(false);
  const [requestActionSubmitting, setRequestActionSubmitting] = useState(false);
  const [supplierDebitCause, setSupplierDebitCause] = useState<'PRICE_DIFFERENCE'|'ADDITIONAL_EXPENSE'|'FINANCING_CHARGE'|'OTHER'>('ADDITIONAL_EXPENSE');
  const [supplierDebitClassificationNote, setSupplierDebitClassificationNote] = useState('');
  const [supplierDebitAccountCode, setSupplierDebitAccountCode] = useState('');
  const [supplierDebitVatAccountCode, setSupplierDebitVatAccountCode] = useState('');
  const [supplierDebitPayableAccountCode, setSupplierDebitPayableAccountCode] = useState('');
  const [supplierDebitTaxRate, setSupplierDebitTaxRate] = useState('16');
  const [supplierDebitFiscalBreakdownReviewed, setSupplierDebitFiscalBreakdownReviewed] = useState(false);
  const [supplierDebitNoWithholdingConfirmed, setSupplierDebitNoWithholdingConfirmed] = useState(false);
  const [supplierDebitNoIgtfConfirmed, setSupplierDebitNoIgtfConfirmed] = useState(false);
  const [correctionCases, setCorrectionCases] = useState<import('../context/AccountingContext').CorrectionCase[]>([]);
  const refreshCorrectionCases = useCallback(async () => { try { setCorrectionCases(await listCorrectionCases()); } catch (error) { setFeedback({kind:'error',message:error instanceof Error?error.message:'No se pudo consultar el historial de correcciones.'}); } },[listCorrectionCases]);
  useEffect(() => { void refreshCorrectionCases(); },[refreshCorrectionCases]);
  useEffect(() => {
    if (isAccountant && executionAssistantOpen) {
      document.getElementById('correction-execution-assistant')?.scrollIntoView({behavior:'smooth',block:'start'});
    }
  },[isAccountant,executionAssistantOpen,selectedId]);
  const refreshAuditEvents = useCallback(async () => {
    setAuditLoading(true);
    try {
      const events = await getAuditEvents(500);
      setAuditEvents(events.filter(event =>
        !event.details.companyId || event.details.companyId === currentCompany.id
      ));
      setAuditError(null);
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'No se pudo leer el historial de auditoría.');
    } finally {
      setAuditLoading(false);
    }
  }, [getAuditEvents, currentCompany.id]);
  useEffect(() => { void refreshAuditEvents(); }, [refreshAuditEvents]);
  const correctionRequests = useMemo(() => auditEvents
    .filter(event => event.eventType === 'accounting_correction_requested')
    .map(request => {
      const source = request.details || {};
      const completedBy = auditEvents.find(event => {
        if (event.eventType !== 'accounting_correction_executed') return false;
        const result = event.details || {};
        return result.companyId === source.companyId &&
          result.entityType === source.entityType &&
          result.entityId === source.entityId &&
          result.correctionType === source.correctionType &&
          result.correctionDocumentRef === source.correctionDocumentRef &&
          (!request.createdAt || !event.createdAt || event.createdAt >= request.createdAt);
      });
      return { request, completedBy };
    }), [auditEvents]);
  const refreshFiscalIncidents = useCallback(async () => {
    setIncidentsLoading(true);
    try {
      const items = await listVatFiscalIncidents();
      setFiscalIncidents(items);
      setIncidentError(null);
    } catch (error) {
      setIncidentError(error instanceof Error ? error.message : 'No se pudieron consultar los expedientes fiscales.');
    } finally {
      setIncidentsLoading(false);
    }
  }, [listVatFiscalIncidents]);
  useEffect(() => { void refreshFiscalIncidents(); }, [refreshFiscalIncidents]);
  const submitCreateFiscalIncident = async () => {
    const note = purchases.find(item => item.id === incidentPurchaseId && item.companyId === currentCompany.id && item.documentType === '03');
    if (!note || incidentCreateReason.trim().length < 15 || incidentCreating) return;
    const original = purchases.find(item => item.id === note.originalPurchaseId && item.companyId === currentCompany.id);
    if (!original) { setIncidentError('La nota no conserva una factura original verificable.'); return; }
    const affectedVoucher = vatVouchers.find(item => item.companyId === currentCompany.id && item.purchaseRecordId === original.id);
    const affectedDeclaration = affectedVoucher
      ? vatWithholdingDeclarations.find(item => item.companyId === currentCompany.id && item.voucherIds.includes(affectedVoucher.id))
      : undefined;
    const declarationEventIds = affectedDeclaration
      ? vatWithholdingDeclarationEvents.filter(item => item.declarationId === affectedDeclaration.id).map(item => item.id)
      : [];
    setIncidentCreating(true);
    try {
      await createVatFiscalIncident({
        purchaseId: note.id, vatVoucherId: affectedVoucher?.id,
        declarationId: affectedDeclaration?.id, declarationEventIds,
        reason: incidentCreateReason.trim(), detectedAt: today
      });
      setIncidentPurchaseId('');
      setIncidentCreateReason('');
      await refreshFiscalIncidents();
      setFeedback({kind:'success', message:'Incidencia fiscal creada y vinculada a la nota correctiva. El expediente permanece pendiente de revisión y actuación documentada.'});
    } catch (error) {
      setIncidentError(error instanceof Error ? error.message : 'No se pudo crear el expediente fiscal.');
    } finally { setIncidentCreating(false); }
  };
  const correctionSourceOptions = useMemo(() => [
    ...journalEntries.filter(item=>item.companyId===currentCompany.id).map(item=>({entityType:'JOURNAL_ENTRY' as const,id:String(item.id),reference:String(item.referenceDoc || item.entryNumber || item.id),label:`Asiento #${item.entryNumber} · ${item.date} · ${item.description || ''}`})),
    ...sales.filter(item=>item.companyId===currentCompany.id).map(item=>({entityType:'SALE' as const,id:String(item.id),reference:String(item.invoiceNumber || item.id),label:`Venta ${item.invoiceNumber || item.id} · ${item.invoiceDate} · ${item.customerName || ''}`})),
    ...purchases.filter(item=>item.companyId===currentCompany.id).map(item=>({entityType:'PURCHASE' as const,id:String(item.id),reference:String(item.invoiceNumber || item.id),label:`Compra ${item.invoiceNumber || item.id} · ${item.invoiceDate} · ${item.supplierName || ''}`})),
    ...movements.filter(item=>item.companyId===currentCompany.id).map(item=>({entityType:'INVENTORY_MOVEMENT' as const,id:String(item.id),reference:String(item.documentRef || item.id),label:`Kardex ${item.documentRef || item.id} · ${item.date} · ${item.productName || ''}`})),
    ...bankStatementMovements.filter(item=>item.companyId===currentCompany.id).map(item=>({entityType:'BANK_MOVEMENT' as const,id:String(item.id),reference:String(item.reference || item.id),label:`Banco ${item.reference || item.id} · ${item.date} · ${item.description || ''} · ${item.isReconciled ? 'Conciliado' : 'Sin conciliar'}`})),
    ...creditSettlements.filter(item=>item.companyId===currentCompany.id && !item.isReversed).map(item=>({entityType:'CREDIT_SETTLEMENT' as const,id:String(item.id),reference:String(item.reference || item.id),label:`${item.kind==='SALE_COLLECTION'?'Cobro CxC':'Pago CxP'} ${item.reference || item.id} · ${item.settlementDate} · ${item.amountBs.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})} Bs.`})),
    ...supplierAdvanceSettlements.filter(item=>item.companyId===currentCompany.id && !item.isReversed).map(item=>({entityType:'SUPPLIER_ADVANCE_SETTLEMENT' as const,id:String(item.id),reference:String(item.reference || item.id),label:`Anticipo proveedor ${item.reference || item.id} · ${item.date} · ${item.supplierName}`}))
  ],[journalEntries,sales,purchases,movements,bankStatementMovements,creditSettlements,supplierAdvanceSettlements,currentCompany.id]);
  const filteredCorrectionSources = useMemo(() => {
    const query=requestSearch.trim().toLocaleLowerCase();
    return correctionSourceOptions.filter(item=>!query || (item.label+' '+item.reference+' '+item.id).toLocaleLowerCase().includes(query)).slice(0,100);
  },[correctionSourceOptions,requestSearch]);

  const selectedSaleForCorrection = requestEntityType === 'SALE' ? sales.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedPurchaseForCorrection = requestEntityType === 'PURCHASE' ? purchases.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedMovementForCorrection = requestEntityType === 'INVENTORY_MOVEMENT' ? movements.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedBankMovementForCorrection = requestEntityType === 'BANK_MOVEMENT' ? bankStatementMovements.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedCreditSettlementForCorrection = requestEntityType === 'CREDIT_SETTLEMENT' ? creditSettlements.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedSupplierAdvanceSettlementForCorrection = requestEntityType === 'SUPPLIER_ADVANCE_SETTLEMENT' ? supplierAdvanceSettlements.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedJournalForCorrection = requestEntityType === 'JOURNAL_ENTRY' ? journalEntries.find(item => item.id === requestEntityId && item.companyId === currentCompany.id) : undefined;
  const selectedPurchaseHasInventory = Boolean(selectedPurchaseForCorrection && (
    selectedPurchaseForCorrection.inventoryLines?.length ||
    movements.some(item => item.companyId === currentCompany.id &&
      (item.journalEntryId === selectedPurchaseForCorrection.journalEntryId ||
       item.documentRef.trim().toUpperCase() === ('FAC-' + selectedPurchaseForCorrection.invoiceNumber).trim().toUpperCase()))
  ));
  const selectedSaleEntryForCorrection = selectedSaleForCorrection?.journalEntryId
    ? journalEntries.find(item=>item.id===selectedSaleForCorrection.journalEntryId && item.companyId===currentCompany.id)
    : undefined;
  const selectedSaleHasInventory = Boolean(selectedSaleForCorrection && (
    selectedSaleEntryForCorrection?.items.some(line =>
      String(line.accountCode || '').startsWith('1.1.4.') ||
      accounts.some(account=>account.code===line.accountCode && account.type==='COSTOS')
    ) ||
    journalEntries.some(entry=>entry.companyId===currentCompany.id && entry.type==='INVENTARIO' &&
      (String(entry.referenceDoc || '').trim().toUpperCase()===('FAC-'+selectedSaleForCorrection.invoiceNumber).trim().toUpperCase() ||
       String(entry.referenceDoc || '').trim().toUpperCase()===selectedSaleForCorrection.invoiceNumber.trim().toUpperCase())) ||
    movements.some(item =>
      item.companyId === currentCompany.id &&
      (item.journalEntryId === selectedSaleForCorrection.journalEntryId ||
       item.documentRef.trim().toUpperCase() === ('FAC-' + selectedSaleForCorrection.invoiceNumber).trim().toUpperCase())
    )
  ));
  const selectedPurchaseEntryForCorrection = selectedPurchaseForCorrection?.journalEntryId
    ? journalEntries.find(item=>item.id===selectedPurchaseForCorrection.journalEntryId && item.companyId===currentCompany.id)
    : undefined;
  const selectedPurchaseHasInventory = Boolean(selectedPurchaseForCorrection && (
    selectedPurchaseForCorrection.inventoryLines?.length ||
    selectedPurchaseEntryForCorrection?.items.some(line=>String(line.accountCode || '').startsWith('1.1.4.')) ||
    movements.some(item => item.companyId === currentCompany.id &&
      (item.journalEntryId === selectedPurchaseForCorrection.journalEntryId ||
       item.documentRef.trim().toUpperCase() === ('FAC-' + selectedPurchaseForCorrection.invoiceNumber).trim().toUpperCase()))
  ));
  const selectedCorrectionJournalId = selectedJournalForCorrection?.id ||
    selectedSaleForCorrection?.journalEntryId || selectedPurchaseForCorrection?.journalEntryId ||
    selectedMovementForCorrection?.journalEntryId ||
    (selectedBankMovementForCorrection?.isReconciled
      ? selectedBankMovementForCorrection.reconciledWithJournalEntryId ||
        (selectedBankMovementForCorrection.reconciledJournalEntryIds?.length === 1
          ? selectedBankMovementForCorrection.reconciledJournalEntryIds[0] : '')
      : '') ||
    selectedCreditSettlementForCorrection?.journalEntryId ||
    selectedSupplierAdvanceSettlementForCorrection?.journalEntryId || '';

  const openExistingCorrectionFlow = () => {
    if (!selectedCorrectionJournalId) {
      setFeedback({kind:'error',message:'El registro no conserva un asiento contable vinculado. No se puede abrir una reversión segura.'});
      return;
    }
    setSelectedId(selectedCorrectionJournalId);
    setEffectiveDate(today);
    setReason(requestReason);
    setExecutionAssistantOpen(true);
  };

  const submitDirectCorrection = async () => {
    if (requestActionSubmitting) return;
    if (!requestTargetRef.trim() || !requestControlNumber.trim() || requestReason.trim().length < 10 ||
        !requestCorrectionDate || !requestFiscalEmissionMedium || !requestSameMediumAsOriginal ||
        Number(requestTaxableBaseBs) < 0 || Number(requestExemptAmountBs) < 0 ||
        Number(requestTaxableBaseBs) + Number(requestExemptAmountBs) <= 0) {
      setFeedback({kind:'error',message:'Complete número y control de la nota, fecha, motivo, bases y confirme el mismo medio de emisión de la factura original.'});
      return;
    }
    setRequestActionSubmitting(true);
    try {
      if (selectedSaleForCorrection) {
        const note = await addSaleCorrectionNote({
          sourceSaleId: selectedSaleForCorrection.id,
          kind: requestCorrectionType === 'NOTA_DEBITO_VENTA' ? 'DEBIT' : 'CREDIT',
          noteDate: requestCorrectionDate,
          noteNumber: requestTargetRef.trim(),
          controlNumber: requestControlNumber.trim(),
          reason: requestReason.trim(),
          workpaperNote: '',
          taxableBaseBs: Number(requestTaxableBaseBs),
          exemptAmountBs: Number(requestExemptAmountBs),
          bcvRate: Number(selectedSaleForCorrection.bcvRate),
          fiscalEmissionMedium: requestFiscalEmissionMedium,
          sameMediumAsOriginal: true
        });
        await waitForPersistence();
        setFeedback({kind:'success',message:(note.documentType === '03' ? 'Nota de crédito ' : 'Nota de débito ') +
          note.invoiceNumber + ' registrada. El asiento correctivo y el auxiliar CxC quedaron vinculados; la factura original permanece intacta.'});
      } else if (selectedPurchaseForCorrection && requestCorrectionType === 'NOTA_DEBITO_PROVEEDOR') {
        const taxableBase = Number(requestTaxableBaseBs);
        const exemptAmount = Number(requestExemptAmountBs);
        const taxRate = Number(supplierDebitTaxRate);
        const vatAmount = Math.round((taxableBase * taxRate / 100 + Number.EPSILON) * 100) / 100;
        const totalAmount = Math.round((taxableBase + exemptAmount + vatAmount + Number.EPSILON) * 100) / 100;
        if (!supplierDebitAccountCode || (vatAmount > 0 && !supplierDebitVatAccountCode) ||
            (selectedPurchaseForCorrection.paymentTerm === 'CONTADO' && !supplierDebitPayableAccountCode) ||
            !supplierDebitFiscalBreakdownReviewed || !supplierDebitNoWithholdingConfirmed ||
            !supplierDebitNoIgtfConfirmed ||
            (supplierDebitCause === 'OTHER' && supplierDebitClassificationNote.trim().length < 10)) {
          throw new Error('Complete la cuenta de débito, las cuentas fiscales que correspondan y las confirmaciones profesionales de IVA, retenciones e IGTF.');
        }
        const note = await addSupplierDebitNote({
          companyId: currentCompany.id,
          sourcePurchaseId: selectedPurchaseForCorrection.id,
          debitNoteNumber: requestTargetRef.trim(),
          controlNumber: requestControlNumber.trim(),
          affectedInvoiceNumber: selectedPurchaseForCorrection.invoiceNumber,
          fiscalEmissionMedium: requestFiscalEmissionMedium,
          sameMediumAsOriginal: true,
          issueDate: requestCorrectionDate,
          recognitionDate: requestCorrectionDate,
          economicCause: supplierDebitCause,
          reason: requestReason.trim(),
          classificationNote: supplierDebitClassificationNote.trim() || undefined,
          debitAccountCode: supplierDebitAccountCode,
          vatAccountCode: supplierDebitVatAccountCode || undefined,
          payableAccountCode: supplierDebitPayableAccountCode || undefined,
          taxableBaseBs: taxableBase,
          exemptAmountBs: exemptAmount,
          taxRate,
          vatAmountBs: vatAmount,
          totalAmountBs: totalAmount,
          bcvRate: Number(selectedPurchaseForCorrection.bcvRate),
          fiscalBreakdownReviewed: supplierDebitFiscalBreakdownReviewed,
          withholdingNotApplicableConfirmed: supplierDebitNoWithholdingConfirmed,
          igtfNotApplicableConfirmed: supplierDebitNoIgtfConfirmed,
          fiscalReviewNote: requestReason.trim(),
          closedThroughDate: currentCompany.closedThroughDate || undefined
        });
        await waitForPersistence();
        setFeedback({kind:'success',message:'Nota de débito ' + (note.debitNoteNumber || note.invoiceNumber) + ' registrada con asiento correctivo y aumento trazable de CxP. La factura original permanece intacta.'});
      } else if (selectedPurchaseForCorrection && !selectedPurchaseHasInventory) {
        const note = await addPurchaseServiceCreditNote({
          purchaseId: selectedPurchaseForCorrection.id,
          noteDate: requestCorrectionDate,
          creditNoteNumber: requestTargetRef.trim(),
          controlNumber: requestControlNumber.trim(),
          reason: requestReason.trim(),
          workpaperNote: '',
          taxableBaseBs: Number(requestTaxableBaseBs),
          exemptAmountBs: Number(requestExemptAmountBs),
          bcvRate: Number(selectedPurchaseForCorrection.bcvRate),
          fiscalEmissionMedium: requestFiscalEmissionMedium,
          sameMediumAsOriginal: true
        });
        await waitForPersistence();
        setFeedback({kind:'success',message:'Nota de crédito ' + (note.creditNoteNumber || note.invoiceNumber) +
          ' registrada con asiento correctivo y ajuste del auxiliar CxP/anticipo. La factura original permanece intacta.'});
      } else {
        setFeedback({kind:'error',message:'Este tipo de registro requiere el flujo especializado de reversión o devolución que se abre desde el asistente inferior.'});
        return;
      }
      setRequestTargetRef('');
      setRequestControlNumber('');
      setRequestReason('');
      setRequestTaxableBaseBs('');
      setRequestExemptAmountBs('');
      setRequestSameMediumAsOriginal(false);
      setRequestFiscalEmissionMedium('');
      await refreshCorrectionCases();
      await refreshAuditEvents();
    } catch (error) {
      setFeedback({kind:'error',message:error instanceof Error ? error.message : 'No se pudo ejecutar la corrección en SQLite.'});
    } finally { setRequestActionSubmitting(false); }
  };

  const submitBcvRateCorrection = async () => {
    if (bcvCorrectionSaving) return;
    setBcvCorrectionSaving(true);
    try {
      await correctBcvRate({newRate:Number(bcvCorrectionRate),effectiveDate:bcvCorrectionDate,reason:bcvCorrectionReason,workpaperNote:''});
      setBcvCorrectionOpen(false);
      setBcvCorrectionReason('');
      setFeedback({kind:'success', message:'La tasa BCV quedó corregida en SQLite y la solicitud/ejecución quedó registrada en auditoría.'});
      await refreshAuditEvents();
    } catch (error) {
      setFeedback({kind:'error', message:error instanceof Error ? error.message : 'No se pudo corregir la tasa BCV.'});
    } finally { setBcvCorrectionSaving(false); }
  };
  const submitFiscalIncidentEvent = async () => {
    if (!selectedIncidentId || incidentDecision.trim().length < 20 || incidentSaving) return;
    setIncidentSaving(true);
    try {
      await recordVatFiscalIncidentEvent({
        incidentId: selectedIncidentId, eventType: incidentEventType,
        decisionText: incidentDecision.trim(),
        declarationId: fiscalIncidents.find(item => item.id === selectedIncidentId)?.declarationId || undefined,
        declarationEventIds: fiscalIncidents.find(item => item.id === selectedIncidentId)?.declarationEventIds || [],
        bankMovementIds: fiscalIncidents.find(item => item.id === selectedIncidentId)?.bankMovementIds || [],
        journalEntryId: (() => {
          const incident = fiscalIncidents.find(item => item.id === selectedIncidentId);
          const note = purchases.find(item => item.id === incident?.purchaseId && item.companyId === currentCompany.id);
          return incident?.vatVoucherId ? note?.journalEntryId : undefined;
        })(),
        externalReference: incidentExternalReference.trim() || undefined
      });
      setIncidentDecision('');
      setIncidentExternalReference('');
      setSelectedIncidentId('');
      await refreshFiscalIncidents();
      setFeedback({ kind: 'success', message: 'La actuación quedó incorporada al expediente fiscal en SQLite. El expediente permanece abierto hasta que exista evidencia de rectificación y validación.' });
    } catch (error) {
      setIncidentError(error instanceof Error ? error.message : 'No se pudo registrar la actuación fiscal.');
    } finally {
      setIncidentSaving(false);
    }
  };

  const source = journalEntries.find(entry => entry.id === selectedId && entry.companyId === currentCompany.id);
  const reversalAssessment = useMemo(() => {
    if (!source) return null;
    try {
      return assessJournalReversal({
        companyId: currentCompany.id, source, accounts, sales, purchases, movements, products,
        journalEntries, bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements,
        priorPeriodAdjustment: Boolean(currentCompany.closedThroughDate && source.date <= currentCompany.closedThroughDate),
        retainedEarningsAccountCode: retainedEarningsCode
      });
    } catch {
      return null;
    }
  }, [source, currentCompany.id, accounts, sales, purchases, movements, products,
      journalEntries, bankAccounts, bankStatementMovements, creditSettlements, supplierAdvanceSettlements]);
  const isPriorPeriod = Boolean(source && currentCompany.closedThroughDate && source.date <= currentCompany.closedThroughDate);
  const retainedEarningsAccounts = accounts.filter(account => account.type === 'PATRIMONIO' && account.isMovement);
  const accountMap = useMemo(() => new Map(accounts.map(account => [account.code, account])), [accounts]);
  const correctionDocuments = useMemo(() => [
    ...sales.filter(item => item.companyId === currentCompany.id && ['02', '03'].includes(item.documentType) && item.originalSaleId)
      .map(item => ({ id: item.id, kind: item.documentType === '03' ? 'NC cliente' : 'ND cliente',
        number: item.invoiceNumber, sourceNumber: item.affectedInvoiceNumber || '',
        date: item.invoiceDate, party: item.customerName, amountBs: item.totalAmountBs,
        amountUsd: item.totalAmountUsd, journalEntryId: item.journalEntryId || '',
        reason: item.correctionReason || item.notes || '', workpaper: item.correctionWorkpaper || '', medium: item.fiscalEmissionMedium || '' })),
    ...purchases.filter(item => item.companyId === currentCompany.id && item.documentType === '03' && item.originalPurchaseId)
      .map(item => ({ id: item.id, kind: 'NC proveedor', number: item.creditNoteNumber || item.invoiceNumber,
        sourceNumber: item.affectedInvoiceNumber || '', date: item.invoiceDate, party: item.supplierName,
        amountBs: item.totalAmountBs, amountUsd: item.totalAmountUsd, journalEntryId: item.journalEntryId || '',
        reason: item.notes || '', workpaper: '', medium: item.fiscalEmissionMedium || '' })),
    ...purchases.filter(item => item.companyId === currentCompany.id && item.documentType === '02' && item.affectedInvoiceNumber)
      .map(item => ({ id: item.id, kind: 'ND proveedor', number: item.debitNoteNumber || item.invoiceNumber,
        sourceNumber: item.affectedInvoiceNumber || '', date: item.invoiceDate, party: item.supplierName,
        amountBs: item.totalAmountBs, amountUsd: item.totalAmountUsd, journalEntryId: item.journalEntryId || '',
        reason: item.notes || '', workpaper: '', medium: item.fiscalEmissionMedium || '' }))
  ].sort((a, b) => b.date.localeCompare(a.date)), [sales, purchases, currentCompany.id]);

  const hasReversal = (entryId: string) => journalEntries.some(entry => entry.reversalOfEntryId === entryId) ||
    Boolean(journalEntries.find(entry => entry.id === entryId)?.reversedByEntryId);

  const previewResult = useMemo(() => {
    if (!source) return { items: [], error: null as string | null };
    try {
      const items = buildReversalItems(source, accounts, isPriorPeriod, retainedEarningsCode)
        .map(item => ({
          ...item,
          targetCode: item.accountCode,
          targetName: item.accountName,
          toRetained: Boolean(item.description?.startsWith('AIA · '))
        }));
      return { items, error: null as string | null };
    } catch (error) {
      return {
        items: [],
        error: error instanceof Error ? error.message : 'No se pudo validar el asiento original.'
      };
    }
  }, [source, accounts, isPriorPeriod, retainedEarningsCode]);
  const preview = previewResult.items;
  const previewError = previewResult.error;

  const linkedSale = reversalAssessment?.linkedSale;
  const linkedPurchase = reversalAssessment?.linkedPurchase;
  const linkedInvoiceNumber = linkedSale?.invoiceNumber || linkedPurchase?.invoiceNumber;
  const linkedInventoryMovements = source
    ? movements.filter(movement => movement.companyId === currentCompany.id &&
        (movement.journalEntryId === source.id || Boolean(linkedInvoiceNumber &&
          (movement.documentRef.trim().toLocaleUpperCase() === linkedInvoiceNumber.trim().toLocaleUpperCase() ||
           movement.documentRef.trim().toLocaleUpperCase() === ('FAC-' + linkedInvoiceNumber).toLocaleUpperCase()))))
    : [];
  const saleInventoryReadiness = linkedSale && source
    ? validateSaleInventoryReturnReconciliation({
        companyId: currentCompany.id, invoiceNumber: linkedSale.invoiceNumber,
        source, movements, products, journalEntries
      })
    : null;
  const sourceHasInventoryAccountingFootprint = Boolean(source?.items.some(line =>
    String(line.accountCode || '').startsWith('1.1.4.') ||
    String(line.accountCode || '').startsWith('5.1.1.') ||
    /inventario|costo de ventas/i.test(String(line.accountName || '')) ||
    accounts.some(account=>account.code===line.accountCode && account.type==='COSTOS')
  ));
  const requiresInventoryReview = (linkedInventoryMovements.length > 0 ||
    Boolean(linkedPurchase?.inventoryLines?.length) || sourceHasInventoryAccountingFootprint) &&
    (!linkedSale || Boolean(linkedPurchase) || !saleInventoryReadiness?.ready);
  const linkedBankMovements = source
    ? bankStatementMovements.filter(movement => movement.companyId === currentCompany.id &&
        (movement.reconciledWithJournalEntryId === source.id ||
          movement.reconciledJournalEntryIds?.includes(source.id)))
    : [];
  const bankReversalReadiness: BankStatementReversalReadiness = source
    ? validateBankStatementReversal({
        companyId: currentCompany.id, source, reversalItems: preview,
        bankAccounts, statementMovements: bankStatementMovements
      })
    : { ready: true, pairs: [] };
  const linkedDocumentId = linkedSale?.id || linkedPurchase?.id;
  const linkedSettlementKind = linkedSale ? 'SALE_COLLECTION' : linkedPurchase ? 'PURCHASE_PAYMENT' : undefined;
  const linkedCreditBalance = linkedDocumentId && linkedSettlementKind
    ? (() => { try { return getCreditBalance(linkedDocumentId, linkedSettlementKind); } catch { return null; } })()
    : null;
  const activeLinkedSettlements = linkedDocumentId && linkedSettlementKind
    ? creditSettlements.filter(item => item.companyId === currentCompany.id &&
        item.documentId === linkedDocumentId && item.kind === linkedSettlementKind && !item.isReversed)
    : [];
  const reversalBlockReasons = reversalAssessment?.blockers || [
    ...(requiresInventoryReview ? [linkedPurchase
      ? 'La compra tiene inventario vinculado: requiere un documento fiscal de nota de crédito y devolución coordinada.'
      : saleInventoryReadiness?.reason || 'Hay movimientos de Kardex relacionados que requieren una reversión coordinada de inventario y costo.'] : []),
    ...(linkedBankMovements.length && !bankReversalReadiness.ready ? [bankReversalReadiness.reason || 'No se pudo conciliar el movimiento bancario inverso.'] : []),
    ...(activeLinkedSettlements.length ? ['La factura tiene ' + activeLinkedSettlements.length + ' cobro(s)/pago(s) vigente(s) que deben reversarse antes.'] : [])
  ];
  const reversalDisabled = !source || Boolean(previewError) || hasReversal(source.id) || reversalBlockReasons.length > 0 ||
    (isPriorPeriod && !retainedEarningsAccounts.some(account => account.code === retainedEarningsCode)) ||
    !effectiveDate || effectiveDate < (source?.date || today) ||
    Boolean(currentCompany.closedThroughDate && effectiveDate <= currentCompany.closedThroughDate);

  const purchaseLineReconciliation = useMemo(() => {
    if (!linkedPurchase) return null;
    return validatePurchaseInventoryReconciliation({
      companyId: currentCompany.id, purchase: linkedPurchase, movements, journalEntries
    });
  }, [linkedPurchase, journalEntries, movements, currentCompany.id]);


  const correctableMovements = linkedInventoryMovements.filter(movement => {
    const matchesDocumentFlow = linkedSale
      ? movement.type === 'SALIDA' && movement.concept === 'VENTA'
      : linkedPurchase ? movement.type === 'ENTRADA' && movement.concept === 'COMPRA' : false;
    if (!matchesDocumentFlow) return false;
    const corrected = movements.filter(item => item.companyId === currentCompany.id && item.correctionForMovementId === movement.id)
      .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    return Number(movement.quantity) - corrected > 1e-8;
  });
  const selectedCorrectionSource = correctableMovements.find(movement => movement.id === correctionMovementId);
  const remainingCorrectionQuantity = selectedCorrectionSource
    ? Math.max(0, selectedCorrectionSource.quantity - movements.filter(item => item.companyId === currentCompany.id && item.correctionForMovementId === selectedCorrectionSource.id).reduce((sum, item) => sum + Number(item.quantity || 0), 0))
    : 0;

  const balanceSheetImpactBs = preview.reduce((sum, item) => {
    const type = accountMap.get(item.targetCode)?.type;
    return ['ACTIVO','PASIVO','PATRIMONIO'].includes(type || '') ? sum + item.debitBs - item.creditBs : sum;
  }, 0);
  const balanceSheetImpactUsd = preview.reduce((sum, item) => {
    const type = accountMap.get(item.targetCode)?.type;
    return ['ACTIVO','PASIVO','PATRIMONIO'].includes(type || '') ? sum + item.debitUsd - item.creditUsd : sum;
  }, 0);
  const profitLossImpactBs = preview.reduce((sum, item) => {
    const type = accountMap.get(item.targetCode)?.type;
    return ['INGRESOS','COSTOS','GASTOS'].includes(type || '') ? sum + item.debitBs - item.creditBs : sum;
  }, 0);
  const profitLossImpactUsd = preview.reduce((sum, item) => {
    const type = accountMap.get(item.targetCode)?.type;
    return ['INGRESOS','COSTOS','GASTOS'].includes(type || '') ? sum + item.debitUsd - item.creditUsd : sum;
  }, 0);

  const submitSupplierCreditNote = async () => {
    if (!linkedPurchase || !purchaseLineReconciliation?.ok || supplierCreditNoteSubmitting) {
      setFeedback({ kind: 'error', message: 'La factura, sus líneas, el Kardex y el asiento deben estar conciliados antes de registrar una nota de crédito.' });
      return;
    }
    setSupplierCreditNoteSubmitting(true);
    try {
      const lines = supplierReturnLines.map(row => {
        const movement = linkedInventoryMovements.find(item => item.productId === row.productId &&
          item.type === 'ENTRADA' && item.concept === 'COMPRA' && !item.correctionForMovementId);
        if (!movement) throw new Error('Seleccione un artículo con entrada original de Kardex.');
        const quantity = Number(row.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Cada cantidad devuelta debe ser mayor que cero.');
        return { productId: row.productId, originalMovementId: movement.id, quantity };
      });
      const note = await addPurchaseCreditNote({
        purchaseId: linkedPurchase.id, lines, returnDate: supplierReturnDate,
        creditNoteNumber: supplierCreditNoteNumber, controlNumber: supplierCreditControlNumber,
        reason: supplierCreditReason
      });
      setFeedback({ kind: 'success', message: 'Nota de crédito ' + note.creditNoteNumber +
        ' registrada con ' + note.creditNoteLines?.length + ' línea(s). CxP disminuyó ' +
        formatBs(note.netPayableReductionBs || 0) + ' (' + formatUsd(note.netPayableReductionUsd || 0) +
        '), con salidas de Kardex y contra-asiento vinculados. Los comprobantes de retención afectados quedaron marcados para revisión fiscal antes de declarar.' });
      setSupplierReturnLines([{productId:'',quantity:'1'}]);
      setSupplierCreditNoteNumber('');
      setSupplierCreditControlNumber('');
      setSupplierCreditReason('');
      void refreshAuditEvents();
    } catch (error) {
      setFeedback({ kind: 'error', message: error instanceof Error ? error.message : 'No se pudo registrar la nota de crédito.' });
    } finally {
      setSupplierCreditNoteSubmitting(false);
    }
  };

  const registerInventoryCorrection = async () => {
    if (correctionSubmitting) return;
    if (linkedPurchase && !linkedSale) {
      setFeedback({kind:'error', message:'La devolución física a proveedor no se automatiza desde la reversión de factura: el contra-asiento ya revierte CxP y el asiento original. Registrar aquí otra devolución podría duplicar el efecto contable. Requiere conciliación documentada de la cuenta de inventario antes de generar el movimiento físico.'});
      return;
    }
    const original = selectedCorrectionSource;
    if (!original) {
      setFeedback({kind:'error', message:'Seleccione un movimiento original de Kardex que admita devolución.'});
      return;
    }
    const quantity = Number(correctionQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remainingCorrectionQuantity + 1e-8) {
      setFeedback({kind:'error', message:'La cantidad debe ser positiva y no superar las unidades pendientes del movimiento original (' + remainingCorrectionQuantity + ').'});
      return;
    }
    const latestProductMovementDate = movements
      .filter(item => item.companyId === currentCompany.id && item.productId === original.productId)
      .reduce((latest, item) => item.date > latest ? item.date : latest, original.date);
    if (!correctionDate || correctionDate < original.date || correctionDate < latestProductMovementDate || correctionDocumentRef.trim().length < 4) {
      setFeedback({kind:'error', message:'La fecha debe ser válida y no anterior al último movimiento del Kardex (' + latestProductMovementDate + '); indique también una referencia documental de al menos 4 caracteres.'});
      return;
    }
    const product = products.find(item => item.id === original.productId && item.companyId === currentCompany.id);
    if (!product) {
      setFeedback({kind:'error', message:'No se encontró el artículo original en la empresa activa.'});
      return;
    }
    const isCustomerReturn = Boolean(linkedSale);
    if (!isCustomerReturn && product.costingMethod === 'PEPS') {
      setFeedback({kind:'error', message:'La devolución a proveedor con PEPS requiere identificar el lote de origen. No se registró el movimiento.'});
      return;
    }
    setCorrectionSubmitting(true);
    try {
      const rate = Number(original.bcvRate || currentCompany.bcvRate);
      const correctionCaseId = await authorizeCorrectionCase({entityType:'INVENTORY_MOVEMENT',entityId:original.id,sourceDocumentRef:original.documentRef,correctionDocumentRef:correctionDocumentRef.trim()});
      addMovement({
        productId: original.productId, productName: original.productName, productCode: original.productCode,
        date: correctionDate, type: isCustomerReturn ? 'ENTRADA' : 'SALIDA',
        concept: isCustomerReturn ? 'DEVOLUCION_CLIENTE' : 'DEVOLUCION_COMPRA',
        documentRef: correctionDocumentRef.trim(), documentType: 'Soporte de devolución física',
        counterpartyRif: original.counterpartyRif || (linkedSale ? linkedSale.customerRif : linkedPurchase?.supplierRif) || '',
        counterpartyName: original.counterpartyName || (linkedSale ? linkedSale.customerName : linkedPurchase?.supplierName) || '',
        bcvRate: rate, quantity, unitCostBs: original.unitCostBs, unitCostUsd: original.unitCostUsd,
        totalCostBs: quantity * original.unitCostBs, totalCostUsd: quantity * original.unitCostUsd,
        balanceQty: product.currentStock, balanceTotalBs: product.currentStock * product.avgCostBs,
        balanceTotalUsd: product.currentStock * product.avgCostUsd,
        correctionForMovementId: original.id
      });
      await waitForPersistence();
      await executeCorrectionCase({caseId:correctionCaseId,executionRef:correctionDocumentRef.trim(),reason:'Devolución física registrada y vinculada al movimiento original del Kardex.'});
      setFeedback({kind:'success', message:'Devolución física registrada, vinculada al movimiento original del Kardex y corrección cerrada automáticamente con trazabilidad. El asistente comprobará si todas las cantidades de la factura fueron devueltas y si cada asiento de costo concilia; una devolución parcial no habilita la reversión total.'});
      setCorrectionQuantity('1');
      setCorrectionMovementId('');
      setCorrectionDocumentRef('');
    } catch (error) {
      setFeedback({kind:'error', message:error instanceof Error ? error.message : 'No se pudo registrar la corrección de inventario en SQLite.'});
    } finally {
      setCorrectionSubmitting(false);
    }
  };

  const submitReversal = async () => {
    if (!source || reversalDisabled || reversalSubmitting) return;
    const confirmed = window.confirm(
      'Se registrará un contra-asiento nuevo e inmutable. No se borrará el asiento original. La reversión contable no sustituye la nota de crédito ni la rectificación fiscal que legalmente corresponda. ¿Desea continuar?'
    );
    if (!confirmed) return;
    setReversalSubmitting(true);
    try {
      const entry = await reverseJournalEntry(
        source.id, effectiveDate, reason,
        '',
        isPriorPeriod, isPriorPeriod ? retainedEarningsCode : undefined
      );
      setFeedback({kind:'success', message:'Contra-asiento '+entry.entryNumber+' registrado y enlazado al asiento '+source.entryNumber+'. El original permanece en el historial.'});
      setReason('');
      setSelectedId('');
    } catch (error) {
      setFeedback({kind:'error', message:error instanceof Error ? error.message : 'No se pudo registrar la reversión en SQLite.'});
    } finally {
      setReversalSubmitting(false);
    }
  };

  const submitClose = async () => {
    if (closingPeriodSubmitting || !window.confirm('Va a bloquear el período contable hasta '+closedDate+'. La fecha no podrá retroceder desde esta pantalla. ¿Confirma el cierre?')) return;
    setClosingPeriodSubmitting(true);
    try {
      closeAccountingPeriod(closedDate);
      await waitForPersistence();
      setFeedback({kind:'success', message:'Período cerrado y confirmado en SQLite hasta '+closedDate+'. No se admitirán nuevos asientos ni facturas con fecha igual o anterior.'});
    } catch (error) {
      setFeedback({kind:'error', message:error instanceof Error ? error.message : 'No se pudo confirmar el cierre del período en SQLite.'});
    } finally {
      setClosingPeriodSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {isAccountant && <>
      <section className="rounded-2xl border border-indigo-200 bg-white p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3"><ShieldCheck className="h-6 w-6 text-indigo-700"/><div><h2 className="font-bold text-slate-900">Centro de Correcciones</h2><p className="text-xs text-slate-500">Busque el asiento o documento original y ejecute aquí la corrección compatible. No se crea una solicitud ni un expediente previo.</p></div></div>
        {feedback && <div role="status" className={`rounded-lg border p-3 text-sm ${feedback.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{feedback.message}</div>}
        <label className="block text-xs font-semibold text-slate-700">Buscar asiento, venta, compra, Kardex, banco o auxiliar
          <input value={requestSearch} onChange={e=>setRequestSearch(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="Factura, asiento, banco, cobro, pago, proveedor, cliente o artículo…"/>
        </label>
        <label className="block text-xs font-semibold text-slate-700">Registro original
          <select value={requestEntityId ? requestEntityType+'::'+requestEntityId : ''} onChange={e=>{
            const value=e.target.value; const split=value.indexOf('::');
            if(split<0){setRequestEntityId('');setRequestSourceRef('');return;}
            const entityType=value.slice(0,split) as typeof requestEntityType; const id=value.slice(split+2);
            const found=correctionSourceOptions.find(item=>item.entityType===entityType&&item.id===id);
            const sale=sales.find(item=>item.id===id&&item.companyId===currentCompany.id);
            const purchase=purchases.find(item=>item.id===id&&item.companyId===currentCompany.id);
            setRequestEntityType(entityType);setRequestEntityId(id);setRequestSourceRef(found?.reference||'');
            setRequestCorrectionDate(today);setRequestTargetRef('');setRequestControlNumber('');setRequestReason('');
            setRequestTaxableBaseBs(String(sale?.taxableBaseBs ?? purchase?.taxableBaseBs ?? ''));
            setRequestExemptAmountBs(String(sale?.exemptAmountBs ?? purchase?.exemptAmountBs ?? ''));
            setRequestFiscalEmissionMedium((sale?.fiscalEmissionMedium || purchase?.fiscalEmissionMedium || '') as typeof requestFiscalEmissionMedium);
            setRequestSameMediumAsOriginal(false);
            setRequestCorrectionType(sale ? 'NOTA_CREDITO_VENTA' : purchase ? ((purchase.inventoryLines?.length || movements.some(item=>item.companyId===currentCompany.id && (item.journalEntryId===purchase.journalEntryId || item.documentRef.trim().toUpperCase()===('FAC-'+purchase.invoiceNumber).trim().toUpperCase()))) ? 'NOTA_CREDITO_INVENTARIO' : 'NOTA_CREDITO_SERVICIO') : 'REVERSIÓN_CONTABLE');
            if (purchase) {
              const sourceEntry=journalEntries.find(item=>item.id===purchase.journalEntryId && item.companyId===currentCompany.id);
              setSupplierDebitTaxRate(String(purchase.taxRate ?? 16));
              setSupplierDebitAccountCode('');
              setSupplierDebitVatAccountCode('');
              setSupplierDebitPayableAccountCode(sourceEntry?.items.find(item=>item.accountCode.startsWith('2.1.1.') && Number(item.creditBs)>0)?.accountCode || '');
              setSupplierDebitCause('ADDITIONAL_EXPENSE');
              setSupplierDebitClassificationNote('');
              setSupplierDebitFiscalBreakdownReviewed(false);
              setSupplierDebitNoWithholdingConfirmed(false);
              setSupplierDebitNoIgtfConfirmed(false);
            }
          }} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
            <option value="">Seleccione el registro que desea corregir…</option>
            {filteredCorrectionSources.map(item=><option key={item.entityType+'::'+item.id} value={item.entityType+'::'+item.id}>{item.label}</option>)}
          </select>
        </label>
        {requestEntityId && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs"><p><strong>Original:</strong> {requestSourceRef} · <strong>Tipo:</strong> {requestEntityType}</p></div>}
        {selectedSaleForCorrection && <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          {selectedSaleForCorrection.documentType !== '01' || selectedSaleForCorrection.isCancelled ? <div className="space-y-2 text-xs"><p>Este documento ya es una nota correctiva o está anulado. No se emite otra nota sobre él desde este formulario.</p><button type="button" onClick={openExistingCorrectionFlow} className="rounded bg-indigo-700 px-3 py-2 font-semibold text-white">Abrir reversión del asiento vinculado</button></div> : <>
          <label className="block text-xs font-semibold text-slate-700">Acción sobre la factura de venta
            <select value={requestCorrectionType} onChange={e=>setRequestCorrectionType(e.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
              <option value="NOTA_CREDITO_VENTA">Emitir nota de crédito (NC)</option>
              <option value="NOTA_DEBITO_VENTA">Emitir nota de débito (ND)</option>
            </select>
          </label>
          {selectedSaleHasInventory && requestCorrectionType === 'NOTA_CREDITO_VENTA' && !saleInventoryReadiness?.ready ? <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs">
            <p>Esta factura tiene huella contable de inventario. Primero debe registrar la devolución física de todas las unidades y conciliar su costo por artículo en el asistente.</p>
            <button type="button" onClick={openExistingCorrectionFlow} className="rounded bg-indigo-700 px-3 py-2 font-semibold text-white">Abrir devolución y conciliación de Kardex</button>
            {saleInventoryReadiness?.reason && <p className="text-amber-900">{saleInventoryReadiness.reason}</p>}
          </div> : <>
          {selectedSaleHasInventory && requestCorrectionType === 'NOTA_CREDITO_VENTA' && saleInventoryReadiness?.ready && <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">Devolución física total y asiento de costo conciliados. Ya puede emitir la NC fiscal; SICOVEN volverá a validar el Kardex antes de guardar.</p>}
          <CorrectionNoteFormFields
            minDate={selectedSaleForCorrection.invoiceDate}
            noteDate={requestCorrectionDate} setNoteDate={setRequestCorrectionDate}
            noteNumber={requestTargetRef} setNoteNumber={setRequestTargetRef}
            controlNumber={requestControlNumber} setControlNumber={setRequestControlNumber}
            reason={requestReason} setReason={setRequestReason}
            taxableBase={requestTaxableBaseBs} setTaxableBase={setRequestTaxableBaseBs}
            exemptAmount={requestExemptAmountBs} setExemptAmount={setRequestExemptAmountBs}
            medium={requestFiscalEmissionMedium} setMedium={setRequestFiscalEmissionMedium}
            sameMedium={requestSameMediumAsOriginal} setSameMedium={setRequestSameMediumAsOriginal}
            submitting={requestActionSubmitting}
            onSubmit={()=>void submitDirectCorrection()}
            submitLabel={requestCorrectionType === 'NOTA_DEBITO_VENTA' ? 'Registrar ND de venta' : 'Registrar NC de venta'}
          />}
          </>}
          </>}
        </div>}
        {selectedPurchaseForCorrection && <div className="space-y-3 rounded-lg border border-slate-200 p-3">
          {selectedPurchaseForCorrection.documentType !== '01' || selectedPurchaseForCorrection.isCancelled ? <div className="space-y-2 text-xs"><p>Este documento ya es una nota correctiva o está anulado. No se emite otra nota sobre él desde este formulario.</p><button type="button" onClick={openExistingCorrectionFlow} className="rounded bg-indigo-700 px-3 py-2 font-semibold text-white">Abrir reversión del asiento vinculado</button></div> : <>
            <label className="block text-xs font-semibold text-slate-700">Acción sobre la factura de compra
              <select value={requestCorrectionType} onChange={e=>{
                setRequestCorrectionType(e.target.value);
                if(e.target.value==='NOTA_DEBITO_PROVEEDOR'){
                  setRequestTargetRef('');setRequestControlNumber('');setRequestReason('');
                  setRequestTaxableBaseBs('');setRequestExemptAmountBs('');setRequestSameMediumAsOriginal(false);
                  setSupplierDebitVatAccountCode('');setSupplierDebitFiscalBreakdownReviewed(false);
                  setSupplierDebitNoWithholdingConfirmed(false);setSupplierDebitNoIgtfConfirmed(false);
                }
              }} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                {selectedPurchaseHasInventory ? <option value="NOTA_CREDITO_INVENTARIO">NC por devolución de inventario</option> : <option value="NOTA_CREDITO_SERVICIO">NC de servicios/gastos</option>}
                <option value="NOTA_DEBITO_PROVEEDOR">Emitir nota de débito del proveedor</option>
              </select>
            </label>
            {requestCorrectionType === 'NOTA_DEBITO_PROVEEDOR' ? <div className="space-y-3 rounded border border-slate-200 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">Número de ND
                  <input value={requestTargetRef} onChange={e=>setRequestTargetRef(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Control de ND
                  <input value={requestControlNumber} onChange={e=>setRequestControlNumber(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Fecha de emisión / reconocimiento
                  <input type="date" min={selectedPurchaseForCorrection.invoiceDate} value={requestCorrectionDate} onChange={e=>setRequestCorrectionDate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Medio de emisión de la ND
                  <select value={requestFiscalEmissionMedium} onChange={e=>setRequestFiscalEmissionMedium(e.target.value as typeof requestFiscalEmissionMedium)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                    <option value="">Seleccione el mismo medio de la factura original…</option>
                    <option value="DIGITAL">Digital</option>
                    <option value="FISCAL_MACHINE">Máquina fiscal</option>
                    <option value="CONTINGENCY">Contingencia</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">Causa económica
                  <select value={supplierDebitCause} onChange={e=>{
                    const nextCause=e.target.value as typeof supplierDebitCause;
                    setSupplierDebitCause(nextCause);
                    setSupplierDebitAccountCode('');
                  }} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                    <option value="PRICE_DIFFERENCE">Diferencia de precio</option>
                    <option value="ADDITIONAL_EXPENSE">Gasto adicional</option>
                    <option value="FINANCING_CHARGE">Cargo de financiación</option>
                    <option value="OTHER">Otra causa</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-700">Base imponible (Bs.)
                  <input type="number" min="0" step="0.01" value={requestTaxableBaseBs} onChange={e=>setRequestTaxableBaseBs(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Monto exento (Bs.)
                  <input type="number" min="0" step="0.01" value={requestExemptAmountBs} onChange={e=>setRequestExemptAmountBs(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Alícuota IVA (%)
                  <input type="number" min="0" max="100" step="0.01" value={supplierDebitTaxRate} onChange={e=>setSupplierDebitTaxRate(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>
                <label className="text-xs font-semibold text-slate-700">Cuenta de débito
                  <select value={supplierDebitAccountCode} onChange={e=>setSupplierDebitAccountCode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                    <option value="">Seleccione la cuenta de costo/gasto…</option>
                    {accounts.filter(item=>item.isMovement && (supplierDebitCause==='FINANCING_CHARGE' ? item.type==='GASTOS' : ['COSTOS','GASTOS'].includes(item.type))).map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
                  </select>
                </label>
                {Number(requestTaxableBaseBs)>0 && Number(supplierDebitTaxRate)>0 && <label className="text-xs font-semibold text-slate-700">Cuenta de IVA de destino
                  <select value={supplierDebitVatAccountCode} onChange={e=>setSupplierDebitVatAccountCode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                    <option value="">Seleccione cuenta de destino…</option>
                    {accounts.filter(item=>item.isMovement && ['ACTIVO','COSTOS','GASTOS'].includes(item.type)).map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
                  </select>
                </label>}
                {selectedPurchaseForCorrection.paymentTerm === 'CONTADO' && <label className="text-xs font-semibold text-slate-700">Cuenta CxP para la nueva obligación
                  <select value={supplierDebitPayableAccountCode} onChange={e=>setSupplierDebitPayableAccountCode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
                    <option value="">Seleccione auxiliar CxP…</option>
                    {accounts.filter(item=>item.isMovement && item.type==='PASIVO' && item.code.startsWith('2.1.1.')).map(item=><option key={item.code} value={item.code}>{item.code} · {item.name}</option>)}
                  </select>
                </label>}
                {supplierDebitCause === 'OTHER' && <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Clasificación de la otra causa
                  <input value={supplierDebitClassificationNote} onChange={e=>setSupplierDebitClassificationNote(e.target.value)} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal"/>
                </label>}
              </div>
              <label className="block text-xs font-semibold text-slate-700">Motivo de la ND
                <textarea value={requestReason} onChange={e=>setRequestReason(e.target.value)} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2 font-normal" placeholder="Describa el motivo económico de la nota (mínimo 10 caracteres)."/>
              </label>
              <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={requestSameMediumAsOriginal} onChange={e=>setRequestSameMediumAsOriginal(e.target.checked)} className="mt-0.5"/> Confirmo que la ND se emitió por el mismo medio que la factura original.</label>
              <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={supplierDebitFiscalBreakdownReviewed} onChange={e=>setSupplierDebitFiscalBreakdownReviewed(e.target.checked)} className="mt-0.5"/> Confirmo que la base, exento e IVA de la ND fueron revisados contra el documento fiscal.</label>
              <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={supplierDebitNoWithholdingConfirmed} onChange={e=>setSupplierDebitNoWithholdingConfirmed(e.target.checked)} className="mt-0.5"/> Confirmo que no aplica retención de IVA ni ISLR a esta ND.</label>
              <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={supplierDebitNoIgtfConfirmed} onChange={e=>setSupplierDebitNoIgtfConfirmed(e.target.checked)} className="mt-0.5"/> Confirmo que no aplica IGTF a esta ND.</label>
              <p className="rounded bg-slate-50 p-2 text-xs text-slate-700">IVA calculado: Bs. {(Math.round((Number(requestTaxableBaseBs)*Number(supplierDebitTaxRate)/100+Number.EPSILON)*100)/100).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})} · Total: Bs. {(Math.round((Number(requestTaxableBaseBs)+Number(requestExemptAmountBs)+Number(requestTaxableBaseBs)*Number(supplierDebitTaxRate)/100+Number.EPSILON)*100)/100).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>
              <button type="button" disabled={requestActionSubmitting || !requestTargetRef.trim() || !requestControlNumber.trim() || requestReason.trim().length<10 || !requestFiscalEmissionMedium || !requestSameMediumAsOriginal || Number(requestTaxableBaseBs)<0 || Number(requestExemptAmountBs)<0 || Number(requestTaxableBaseBs)+Number(requestExemptAmountBs)<=0 || !supplierDebitAccountCode || !supplierDebitFiscalBreakdownReviewed || !supplierDebitNoWithholdingConfirmed || !supplierDebitNoIgtfConfirmed || (Number(requestTaxableBaseBs)>0 && Number(supplierDebitTaxRate)>0 && !supplierDebitVatAccountCode) || (selectedPurchaseForCorrection.paymentTerm==='CONTADO' && !supplierDebitPayableAccountCode) || (supplierDebitCause==='OTHER' && supplierDebitClassificationNote.trim().length<10)} onClick={()=>void submitDirectCorrection()} className="rounded bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{requestActionSubmitting ? 'Registrando…' : 'Registrar ND del proveedor'}</button>
            </div> : selectedPurchaseHasInventory ? <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs">
              <p>La compra tiene mercancía/Kardex. La NC debe calcular la devolución física por líneas y su efecto sobre inventario, CxP, retenciones e impuestos.</p>
              <button type="button" onClick={openExistingCorrectionFlow} className="rounded bg-indigo-700 px-3 py-2 font-semibold text-white">Abrir NC y devolución de inventario</button>
            </div> : <CorrectionNoteFormFields
            minDate={selectedPurchaseForCorrection.invoiceDate}
            noteDate={requestCorrectionDate} setNoteDate={setRequestCorrectionDate}
            noteNumber={requestTargetRef} setNoteNumber={setRequestTargetRef}
            controlNumber={requestControlNumber} setControlNumber={setRequestControlNumber}
            reason={requestReason} setReason={setRequestReason}
            taxableBase={requestTaxableBaseBs} setTaxableBase={setRequestTaxableBaseBs}
            exemptAmount={requestExemptAmountBs} setExemptAmount={setRequestExemptAmountBs}
            medium={requestFiscalEmissionMedium} setMedium={setRequestFiscalEmissionMedium}
            sameMedium={requestSameMediumAsOriginal} setSameMedium={setRequestSameMediumAsOriginal}
            submitting={requestActionSubmitting}
            onSubmit={()=>void submitDirectCorrection()}
            submitLabel="Registrar NC de compra de servicios"
          />}
          </>}
        </div>}
        {(selectedJournalForCorrection || selectedMovementForCorrection || selectedBankMovementForCorrection || selectedCreditSettlementForCorrection || selectedSupplierAdvanceSettlementForCorrection) && !selectedSaleForCorrection && !selectedPurchaseForCorrection && <div className="rounded-lg border border-slate-200 p-3 text-xs space-y-2">
          {selectedBankMovementForCorrection && !selectedBankMovementForCorrection.isReconciled
            ? <p>El movimiento bancario no está conciliado con un asiento. Se conserva como original y no se permite inventar una reversión sin contrapartida contable vinculada.</p>
            : selectedBankMovementForCorrection && !selectedCorrectionJournalId
              ? <p>El movimiento bancario no conserva un único asiento conciliado. Si la fila está vinculada a varios asientos, seleccione cada asiento original por separado; SICOVEN no elegirá uno arbitrariamente.</p>
              : selectedCreditSettlementForCorrection
                ? <p>Se reversará el asiento de este cobro/pago y SICOVEN marcará la liquidación como reversada, restaurando el saldo del auxiliar sin borrar el movimiento original.</p>
                : selectedSupplierAdvanceSettlementForCorrection
                ? <p>Se reversará el asiento de esta aplicación/devolución de anticipo y se restaurará el saldo del anticipo del proveedor, conservando la liquidación original.</p>
                : selectedBankMovementForCorrection
                  ? <p>Se abrirá el asiento conciliado. La reversión comprobará la contrapartida bancaria antes de retirar la conciliación vigente, conservando el historial de vínculos.</p>
                  : <p>Este registro requiere una operación contable vinculada. SICOVEN abrirá el asistente con su asiento original para validar los efectos cruzados antes de ejecutar.</p>}
          <button type="button" disabled={!selectedCorrectionJournalId} onClick={openExistingCorrectionFlow} className="rounded bg-indigo-700 px-3 py-2 font-semibold text-white disabled:opacity-40">Abrir reversión y validar efectos cruzados</button>
        </div>}
        <p className="text-xs text-slate-500">Las notas se contabilizan desde el flujo especializado existente; el motivo, la sesión del contador y la fecha quedan auditados. El original nunca se sobrescribe. Los casos no cubiertos se bloquean en lugar de registrar una corrección ficticia.</p>
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 space-y-3">
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold text-slate-900">Historial de correcciones ({correctionCases.length})</h2><button type="button" onClick={()=>void refreshCorrectionCases()} className="rounded border px-3 py-1">Actualizar</button></div>
        {correctionCases.length===0 ? <p className="text-sm text-slate-500">Todavía no hay correcciones registradas.</p> : correctionCases.map(item=><article key={item.id} className="rounded-lg border p-3 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{item.correction_type} · {item.entity_type} · {item.entity_id}</strong><span className="font-semibold">{item.status==='EXECUTED'?'EJECUTADA':item.status==='APPROVED'?'EN CURSO':item.status}</span></div>
          <p>Origen: {item.source_ref} · Correctivo: {item.correction_ref}</p><p>{item.reason || 'Sin motivo adicional.'}</p>
          <p className="text-slate-500">Contador: {item.requested_by_name} · Registro: {item.created_at} · Ejecución: {item.executed_at || 'Pendiente'}</p>

          <div className="border-t pt-2"><strong>Historial inalterable</strong>{item.events.map(ev=><p key={ev.id}>{ev.event_type==='APPROVED'?'HABILITADA PARA EJECUCIÓN DIRECTA':ev.event_type} · {ev.actor_name} · {ev.created_at} · {ev.reason}</p>)}</div>
        </article>)}
      </section>
      </>}
      {executionAssistantOpen && <section id="correction-execution-assistant" className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center gap-3">
          <Undo2 className="h-6 w-6 text-emerald-300" />
          <div>
            <h1 className="text-lg font-bold">Ejecución de correcciones con efectos cruzados</h1>
            <p className="text-sm text-slate-300">Inmutabilidad del Libro Diario · validación de efectos cruzados</p>
          </div>
          {isAccountant && <button type="button" onClick={()=>setExecutionAssistantOpen(false)} className="ml-auto rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-800">Cerrar asistente</button>}
        </div>
        <div className="p-4 sm:p-6 space-y-5">
          {feedback && <div role="status" className={`rounded-lg border p-3 text-sm ${feedback.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>{feedback.message}</div>}
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex gap-2 text-sm text-amber-950">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p>La reversión contable conserva la trazabilidad y no elimina documentos. <strong>No sustituye una nota de crédito/débito, una declaración sustitutiva ni el trámite ante el SENIAT.</strong> El impacto fiscal legal debe cotejarse con el documento válido y el período declarado.</p>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block text-sm font-semibold text-slate-700">1. Seleccione el asiento original</label>
              <select value={selectedId} onChange={event=>{setSelectedId(event.target.value);setFeedback(null);}} className="w-full rounded-lg border border-slate-300 p-2.5 text-sm bg-white">
                <option value="">Seleccionar asiento contabilizado…</option>
                {journalEntries.filter(entry=>entry.companyId===currentCompany.id && !entry.reversalOfEntryId && !hasReversal(entry.id)).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.entryNumber-a.entryNumber).map(entry=>(
                  <option key={entry.id} value={entry.id}>#{entry.entryNumber} · {entry.date} · {entry.description.slice(0,90)}</option>
                ))}
              </select>
              {source && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm space-y-1">
                <div><span className="text-slate-500">Asiento:</span> <strong>#{source.entryNumber}</strong> · {formatDate(source.date)}</div>
                <div><span className="text-slate-500">Tipo / referencia:</span> {source.type} · {source.referenceDoc || 'Sin referencia'}</div>
                <div><span className="text-slate-500">Descripción:</span> {source.description}</div>
                {(linkedSale || linkedPurchase) && <div className="font-semibold text-amber-800">Documento vinculado: {linkedSale ? 'Venta '+linkedSale.invoiceNumber+' · '+linkedSale.customerName : linkedPurchase!.documentType === '02' ? 'ND proveedor '+linkedPurchase!.invoiceNumber+' · '+linkedPurchase!.supplierName : 'Compra '+linkedPurchase!.invoiceNumber+' · '+linkedPurchase!.supplierName}</div>}
                {reversalAssessment && <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">Evaluación integral de reversión</strong><span className={reversalAssessment.ready?'rounded-full bg-emerald-100 px-2 py-1 text-xs font-bold text-emerald-800':'rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900'}>{reversalAssessment.ready?'PREVALIDACIÓN CONTABLE OK':'BLOQUEOS DETECTADOS'}</span></div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-500">Documento</span><strong>{reversalAssessment.documentKind==='SALE'?'Venta':reversalAssessment.documentKind==='PURCHASE'?'Compra':'Asiento general'}</strong></div>
                    <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-500">Kardex vinculado</span><strong>{reversalAssessment.linkedInventoryMovementCount} movimiento(s)</strong></div>
                    <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-500">Notas de crédito proveedor</span><strong>{reversalAssessment.linkedCreditNoteCount}</strong></div>
                    <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-500">Extracto bancario</span><strong>{reversalAssessment.linkedBankMovementCount} línea(s)</strong></div>
                    <div className="rounded-lg bg-slate-50 p-2"><span className="block text-slate-500">Cobros / pagos activos</span><strong>{reversalAssessment.activeSettlementCount}</strong></div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border p-2"><strong>Contra-asiento previsto</strong><div className="mt-1 flex justify-between"><span>Debe / Haber Bs.</span><span className="font-semibold">{formatBs(reversalAssessment.debitBs)} / {formatBs(reversalAssessment.creditBs)}</span></div><div className="flex justify-between"><span>Debe / Haber USD</span><span className="font-semibold">{formatUsd(reversalAssessment.debitUsd)} / {formatUsd(reversalAssessment.creditUsd)}</span></div></div>
                    <div className="rounded-lg border p-2"><strong>Controles revisados</strong><ul className="mt-1 space-y-1 text-slate-600"><li>✓ Integridad y duplicidad del asiento</li><li>✓ Documento y movimientos auxiliares</li><li>✓ Conciliación bancaria disponible</li><li>✓ Cuadre contable en Bs. y USD</li></ul></div>
                  </div>
                  {reversalAssessment.blockers.length>0&&<div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950"><strong>Acciones necesarias antes de confirmar</strong><ul className="mt-1 list-disc space-y-1 pl-5">{reversalAssessment.blockers.map((item,index)=><li key={index}>{item}</li>)}</ul></div>}
                </div>}
                {requiresInventoryReview && <div className="mt-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900 space-y-2"><p className="font-bold">Atención: hay {linkedInventoryMovements.length} movimiento(s) de inventario relacionado(s) con esta factura.</p><ul className="list-disc pl-5">{linkedInventoryMovements.map(movement=><li key={movement.id}>{movement.date} · {movement.type} · {movement.quantity} · {movement.productCode} · {movement.documentRef}{movement.journalEntryId ? ' · asiento de inventario vinculado' : ''}</li>)}</ul><p>La reversión de esta factura no modifica automáticamente el Kardex ni revierte sus asientos de costo de venta/ajuste. Debe conciliar y registrar por separado la compensación de cada movimiento, respetando las existencias disponibles y el método de costo.</p><div className="rounded-lg border border-slate-200 bg-white p-3 space-y-3">
                  <p className="font-bold text-slate-900">Registrar devolución física trazable (si corresponde)</p>
                  <p className="text-xs text-slate-600">Use esta acción solo para unidades que efectivamente regresaron del cliente o que efectivamente se devolvieron al proveedor. No registre aquí mercancía vendida, consumida, dañada o no localizada.</p>
                  {linkedPurchase && !linkedSale ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 space-y-2"><strong>Devolución a proveedor: conciliación y flujo separado</strong>
                    {purchaseLineReconciliation?.ok ? <p className="text-emerald-800">Conciliación técnica aprobada: factura, líneas, Kardex y asiento coinciden por artículo, fecha, proveedor, cantidad, costo y tasa BCV en Bs. y USD.</p> : <p className="text-rose-800">Conciliación no aprobada: {purchaseLineReconciliation?.reason || 'Faltan líneas de mercancía o existen diferencias entre factura, Kardex y asiento.'} No se habilitará devolución automática desde aquí.</p>}
                    {purchaseLineReconciliation && <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-xs"><span>Líneas registradas: <strong>{linkedPurchase?.inventoryLines?.length || 0}</strong></span><span>Base + exento: <strong>{formatBs(purchaseLineReconciliation.baseTotal)}</strong></span><span>Total líneas: <strong>{formatBs(purchaseLineReconciliation.lineTotal)}</strong></span><span>Total Kardex: <strong>{formatBs(purchaseLineReconciliation.movementTotal)}</strong></span><span>Débito inventario del asiento: <strong>{formatBs(purchaseLineReconciliation.journalInventoryDebit)}</strong></span><span>Débito inventario USD: <strong>{formatUsd(purchaseLineReconciliation.journalInventoryDebitUsd)}</strong></span><span>Factura ↔ líneas: <strong>{purchaseLineReconciliation.linesMatchInvoice ? "OK" : "DIFERENCIA"}</strong></span><span>Líneas ↔ Kardex: <strong>{purchaseLineReconciliation.movementMatchesLines ? "OK" : "DIFERENCIA"}</strong></span><span>Asiento ↔ factura: <strong>{purchaseLineReconciliation.journalMatchesInvoice ? "OK" : "DIFERENCIA"}</strong></span><span>Resultado: <strong>{purchaseLineReconciliation.ok ? 'CONCILIADO' : 'PENDIENTE'}</strong></span></div>}
                    {purchaseLineReconciliation?.ok ? <div className="mt-3 space-y-3 border-t border-amber-200 pt-3">
                      <strong className="text-slate-900">Registrar nota de crédito y devolución física</strong>
                      <p className="text-xs text-slate-700">Este proceso crea en una sola operación lógica la nota fiscal 03, la salida enlazada al movimiento original, el contra-asiento de inventario/CxP/IVA/retenciones/IGTF y la reducción del auxiliar de CxP. Solo admite facturas a crédito con saldo pendiente, costo promedio conciliado y productos con método promedio ponderado.</p>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between"><label className="text-xs font-semibold">Artículos / entradas originales de Kardex</label><button type="button" onClick={()=>setSupplierReturnLines(prev=>[...prev,{productId:'',quantity:'1'}])} className="rounded-lg border px-2 py-1 text-xs font-semibold">+ Agregar artículo</button></div>
                        {supplierReturnLines.map((row,index)=><div key={index} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_auto] gap-2 rounded-lg border bg-white p-2">
                          <select value={row.productId} onChange={event=>setSupplierReturnLines(prev=>prev.map((item,i)=>i===index?{...item,productId:event.target.value}:item))} className="w-full rounded-lg border border-slate-300 p-2 text-sm bg-white">
                            <option value="">Seleccione artículo de la factura…</option>
                            {linkedInventoryMovements.filter(item=>item.type==='ENTRADA' && item.concept==='COMPRA' && !item.correctionForMovementId).map(item=>{
                              const returned=movements.filter(m=>m.correctionForMovementId===item.id && m.type==='SALIDA' && m.concept==='DEVOLUCION_COMPRA').reduce((sum,m)=>sum+Number(m.quantity||0),0);
                              return <option key={item.id} value={item.productId}>{item.productCode} · {item.productName} · disponible {Math.max(0,item.quantity-returned)}</option>;
                            })}
                          </select>
                          <input aria-label={'Cantidad artículo '+(index+1)} type="number" min="0.000001" step="0.000001" value={row.quantity} onChange={event=>setSupplierReturnLines(prev=>prev.map((item,i)=>i===index?{...item,quantity:event.target.value}:item))} className="w-full rounded-lg border border-slate-300 p-2 text-sm" />
                          <button type="button" disabled={supplierReturnLines.length===1} onClick={()=>setSupplierReturnLines(prev=>prev.filter((_,i)=>i!==index))} className="rounded-lg border px-2 py-1 text-xs disabled:opacity-30">Quitar</button>
                        </div>)}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div><label className="block text-xs font-semibold mb-1">Fecha de la nota</label><input type="date" min={linkedPurchase.invoiceDate} value={supplierReturnDate} onChange={event=>setSupplierReturnDate(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm"/></div>
                        <div><label className="block text-xs font-semibold mb-1">Número de nota de crédito</label><input value={supplierCreditNoteNumber} onChange={event=>setSupplierCreditNoteNumber(event.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="NC-000123"/></div>
                        <div><label className="block text-xs font-semibold mb-1">Número de control</label><input value={supplierCreditControlNumber} onChange={event=>setSupplierCreditControlNumber(event.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="00-000123"/></div>
                        <div><label className="block text-xs font-semibold mb-1">Motivo y soporte (mínimo 20 caracteres)</label><textarea value={supplierCreditReason} onChange={event=>setSupplierCreditReason(event.target.value)} rows={2} maxLength={1000} className="w-full rounded-lg border border-slate-300 p-2 text-sm" placeholder="Motivo de devolución, referencia al soporte y condición de la mercancía…"/></div>
                      </div>
                      <button type="button" onClick={submitSupplierCreditNote} disabled={supplierCreditNoteSubmitting||supplierReturnLines.some(row=>!row.productId||Number(row.quantity)<=0)||!supplierCreditNoteNumber.trim()||!supplierCreditControlNumber.trim()||supplierCreditReason.trim().length<10} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{supplierCreditNoteSubmitting?'Guardando y confirmando en SQLite…':'Registrar nota de crédito y devolución'}</button>
                    </div> : <p>La devolución permanece bloqueada hasta conciliar factura, líneas, Kardex y asiento. Corrija primero las diferencias indicadas arriba.</p>}</div> : correctableMovements.length > 0 ? <>
                    <label className="block font-semibold">Movimiento original</label>
                    <select value={correctionMovementId} onChange={event=>setCorrectionMovementId(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm">
                      <option value="">Seleccione movimiento de Kardex…</option>
                      {correctableMovements.map(movement => {
                        const corrected = movements.filter(item => item.companyId === currentCompany.id && item.correctionForMovementId === movement.id).reduce((sum,item)=>sum+Number(item.quantity||0),0);
                        return <option key={movement.id} value={movement.id}>{movement.productCode} · {movement.productName} · original {movement.quantity} · pendiente {Math.max(0,movement.quantity-corrected)}</option>;
                      })}
                    </select>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div><label className="block text-xs font-semibold mb-1">Cantidad devuelta</label><input type="number" min="0.000001" max={remainingCorrectionQuantity || undefined} step="0.000001" value={correctionQuantity} onChange={event=>setCorrectionQuantity(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm" /></div>
                      <div><label className="block text-xs font-semibold mb-1">Fecha del movimiento</label><input type="date" min={selectedCorrectionSource?.date} value={correctionDate} onChange={event=>setCorrectionDate(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2 text-sm" /></div>
                      <div><label className="block text-xs font-semibold mb-1">Ref. nota/soporte</label><input value={correctionDocumentRef} onChange={event=>setCorrectionDocumentRef(event.target.value)} maxLength={120} placeholder="NC-000123" className="w-full rounded-lg border border-slate-300 p-2 text-sm" /></div>
                    </div>
                    {selectedCorrectionSource && !linkedSale && products.find(item=>item.id===selectedCorrectionSource.productId)?.costingMethod === 'PEPS' && <p className="text-xs text-amber-800">PEPS: la devolución al proveedor queda bloqueada hasta identificar el lote original; no se descargará un lote aproximado.</p>}
                    <button type="button" onClick={registerInventoryCorrection} disabled={correctionSubmitting} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-700">{correctionSubmitting ? 'Guardando y confirmando en SQLite…' : 'Registrar devolución y asiento de inventario'}</button>
                  </> : <p className="text-xs text-slate-600">No hay unidades pendientes que coincidan con una salida por venta o una entrada por compra. Si la mercancía no regresó físicamente, indique su disposición cuando sea necesario, sin alterar existencias.</p>}
                </div>
                <div className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900"><strong>Control de seguridad:</strong> una casilla o una referencia escrita no sustituyen la conciliación técnica. Mientras existan movimientos de Kardex vinculados, el contra-asiento de la factura permanecerá bloqueado hasta completar el flujo coordinado de inventario, costo y documento fiscal.</div></div>}
                {hasReversal(source.id) && <p className="text-red-700 font-semibold">Este asiento ya fue reversado.</p>}
              </div>}
              <label className="block text-sm font-semibold text-slate-700">2. Fecha del contra-asiento</label>
              <input type="date" value={effectiveDate} min={source?.date || today} onChange={event=>setEffectiveDate(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
              {isPriorPeriod && <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-950"><strong>Ajuste de Ejercicio Anterior (AIA).</strong> El asiento original está en período cerrado hasta {currentCompany.closedThroughDate}. El contra-asiento se registrará en el período abierto y las cuentas de ingresos, costos y gastos se reclasificarán a resultados acumulados. Revise el criterio con el contador responsable.</div>}
              {isPriorPeriod && <label className="block text-sm font-semibold text-slate-700">Cuenta de patrimonio para resultados acumulados</label>}
              {isPriorPeriod && <select value={retainedEarningsCode} onChange={event=>setRetainedEarningsCode(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2.5 text-sm bg-white"><option value="">Seleccione cuenta de patrimonio…</option>{retainedEarningsAccounts.map(account=><option key={account.code} value={account.code}>{account.code} · {account.name}</option>)}</select>}
              <label className="block text-sm font-semibold text-slate-700">3. Motivo de la reversión (opcional)</label>
              <textarea value={reason} onChange={event=>setReason(event.target.value)} rows={2} maxLength={1000} placeholder="Ej. Factura emitida con RIF incorrecto; documento soporte…" className="w-full rounded-lg border border-slate-300 p-2.5 text-sm" />
              {previewError && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900"><strong>No se puede simular una reversión válida:</strong> {previewError}</div>}
              {reversalBlockReasons.length > 0 && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 space-y-1"><strong>Reversión bloqueada por integridad cruzada</strong>{reversalBlockReasons.map((message,index)=><p key={index}>• {message}</p>)}<p className="font-medium">No basta con una confirmación manual: SICOVEN comprueba la reversión de los auxiliares y su asiento vinculado antes de permitir la ejecución.</p></div>}
                            <button disabled={reversalDisabled || reversalSubmitting} onClick={submitReversal} className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-300 flex items-center justify-center gap-2"><ShieldCheck className="w-4 h-4" /> {reversalSubmitting ? 'Guardando y confirmando en SQLite…' : 'Ejecutar reversión y registrar contra-asiento'}</button>
            </div>
            <div className="space-y-3">
              <h2 className="font-bold text-slate-900">Vista previa del impacto contable</h2>
              {!source ? <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">Seleccione un asiento para calcular el efecto antes de aprobar.</div> : <>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg bg-slate-50 border p-3"><p className="text-xs text-slate-500">Asiento original · Debe Bs.</p><p className="font-bold">{formatBs(source.items.reduce((sum,item)=>sum+item.debitBs,0))}</p><p className="text-xs text-slate-500 mt-1">Haber Bs. {formatBs(source.items.reduce((sum,item)=>sum+item.creditBs,0))}</p></div>
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3"><p className="text-xs text-emerald-800">Contra-asiento · Debe Bs.</p><p className="font-bold text-emerald-900">{formatBs(preview.reduce((sum,item)=>sum+item.debitBs,0))}</p><p className="text-xs text-emerald-800 mt-1">Haber Bs. {formatBs(preview.reduce((sum,item)=>sum+item.creditBs,0))}</p></div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs min-w-[480px]">
                    <thead className="bg-slate-100 text-slate-600"><tr><th className="text-left p-2">Cuenta destino</th><th className="text-right p-2">Debe Bs.</th><th className="text-right p-2">Haber Bs.</th><th className="text-right p-2">Debe USD</th><th className="text-right p-2">Haber USD</th></tr></thead>
                    <tbody>{preview.map((item,index)=><tr key={index} className="border-t border-slate-100"><td className="p-2">{item.targetCode} · {item.targetName}{item.toRetained && <span className="block text-indigo-700">Reclasificado a resultados acumulados</span>}</td><td className="p-2 text-right whitespace-nowrap">{formatBs(item.debitBs)}</td><td className="p-2 text-right whitespace-nowrap">{formatBs(item.creditBs)}</td><td className="p-2 text-right whitespace-nowrap">{formatUsd(item.debitUsd)}</td><td className="p-2 text-right whitespace-nowrap">{formatUsd(item.creditUsd)}</td></tr>)}</tbody>
                  </table>
                </div>
                {((linkedBankMovements.length > 0 && !bankReversalReadiness.ready) || activeLinkedSettlements.length > 0) && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 space-y-1"><strong>Conciliación de auxiliares pendiente</strong><p>Movimientos bancarios vinculados histórica o actualmente: {linkedBankMovements.length}</p><p>Cobros/pagos vigentes vinculados: {activeLinkedSettlements.length}</p><p>Estos importes no se compensarán por el solo hecho de generar un contra-asiento del Libro Diario.</p></div>}
                {bankReversalReadiness.ready && bankReversalReadiness.pairs.length > 0 && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1"><strong>Contrapartida bancaria verificada</strong><p>Se identificaron {bankReversalReadiness.pairs.length} movimiento(s) inverso(s) exacto(s) en el extracto. Al aprobar, el contra-asiento y ambas conciliaciones quedarán vinculados en la misma escritura local.</p></div>}
                {saleInventoryReadiness?.ready && saleInventoryReadiness.originalMovementCount > 0 && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 space-y-1"><strong>Kardex de venta conciliado</strong><p>Salidas originales: {saleInventoryReadiness.originalMovementCount} · devoluciones con asiento conciliado: {saleInventoryReadiness.returnedMovementCount}</p><p>Se verificó la devolución total de las cantidades y la contrapartida de inventario/costo. La reversión de la factura aún requiere su soporte fiscal legal.</p></div>}
                {linkedCreditBalance && <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800 space-y-1"><strong>Auxiliar {linkedSale ? 'Cuentas por Cobrar' : 'Cuentas por Pagar'}</strong><p>Principal original: {formatBs(linkedCreditBalance.originalAmountBs)} · {formatUsd(linkedCreditBalance.originalAmountUsd)}</p><p>Liquidado vigente: {formatBs(linkedCreditBalance.settledAmountBs)} · {formatUsd(linkedCreditBalance.settledAmountUsd)}</p><p>Saldo pendiente actual: <strong>{formatBs(linkedCreditBalance.outstandingBsAtInvoiceRate)} · {formatUsd(linkedCreditBalance.outstandingUsd)}</strong></p><p className="text-xs text-slate-600">La reversión sólo se habilita cuando no existan liquidaciones vigentes; el saldo auxiliar no se considera cancelado por una simple simulación.</p></div>}
                <div className="rounded-lg bg-sky-50 border border-sky-200 p-3 text-sm text-sky-950 space-y-1">
                  <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Balance previsto</p>
                  <p>La contrapartida invierte Debe/Haber por línea y conserva la partida doble en Bs. y USD.</p>
                  <p><strong>Balance General · movimiento neto:</strong> {formatBs(balanceSheetImpactBs)} · {formatUsd(balanceSheetImpactUsd)}. Es el efecto de las líneas del contra-asiento en cuentas de activo, pasivo y patrimonio; no sustituye el balance completo.</p>
                  <p><strong>Estado de Resultados · movimiento neto:</strong> {formatBs(profitLossImpactBs)} · {formatUsd(profitLossImpactUsd)} en ingresos, costos y gastos. En AIA esas cuentas se reclasifican a resultados acumulados.</p>
                  <div className="space-y-1"><p><strong>Libro de Compras/Ventas e IVA:</strong> {linkedSale ? 'Venta '+linkedSale.invoiceNumber+' · base '+formatBs(linkedSale.taxableBaseBs)+' · IVA '+formatBs(linkedSale.vatAmountBs)+' · retención IVA '+formatBs(linkedSale.vatWithheldBs)+' · IGTF '+formatBs(linkedSale.igtfAmountBs || 0) : linkedPurchase ? 'Compra '+linkedPurchase.invoiceNumber+' · base '+formatBs(linkedPurchase.taxableBaseBs)+' · IVA '+formatBs(linkedPurchase.vatAmountBs)+' · retención IVA '+formatBs(linkedPurchase.vatWithheldBs)+' · retención ISLR '+formatBs(linkedPurchase.islrWithheldBs || 0)+' · IGTF '+formatBs(linkedPurchase.igtfAmountBs || 0) : 'No se detectó una factura fiscal vinculada directamente.'}</p><p className="font-semibold text-amber-900">Estado fiscal: pendiente de regularización documental. Esta simulación no altera los importes históricos de los libros legales ni sustituye la nota de crédito/débito o declaración que corresponda.</p></div>
                </div>
              </>}
            </div>
          </div>
        </div>
      </section>}

      {!isAccountant && <>
      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="flex items-center gap-3"><LockKeyhole className="w-6 h-6 text-indigo-700" /><div><h2 className="font-bold text-slate-900">Candado de períodos fiscales</h2><p className="text-sm text-slate-500">Bloquea nuevos asientos y facturas con fecha igual o anterior al corte.</p></div></div>
        <div className="rounded-lg bg-slate-50 border p-3 text-sm">Estado actual: {currentCompany.closedThroughDate ? <strong>cerrado hasta {currentCompany.closedThroughDate}</strong> : <strong>sin período cerrado</strong>}</div>
        <div className="flex flex-col sm:flex-row gap-3 items-end"><div className="w-full sm:max-w-xs"><label className="block text-sm font-semibold text-slate-700 mb-1">Cerrar hasta</label><input type="date" max={today} value={closedDate} onChange={event=>setClosedDate(event.target.value)} className="w-full rounded-lg border border-slate-300 p-2.5 text-sm" /></div><button disabled={closingPeriodSubmitting || !closedDate || Boolean(currentCompany.closedThroughDate && closedDate < currentCompany.closedThroughDate) || closedDate > today} onClick={submitClose} className="rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-800 disabled:bg-slate-300 disabled:cursor-not-allowed flex items-center gap-2"><LockKeyhole className="w-4 h-4" /> {closingPeriodSubmitting ? 'Guardando cierre en SQLite…' : 'Confirmar cierre irreversible'}</button></div>
        <p className="text-xs text-slate-500">El cierre es progresivo e irreversible desde esta pantalla. Para reabrir un período debe existir autorización formal y un procedimiento auditado de administrador; no se habilita una reapertura informal.</p>
      </section>

      <section className="rounded-2xl bg-white border border-slate-200 shadow-sm p-4 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3"><ShieldCheck className="w-6 h-6 text-emerald-700" /><div><h2 className="font-bold text-slate-900">Pista de auditoría local SQLite</h2><p className="text-sm text-slate-500">Eventos append-only de asientos, reversiones, documentos fiscales y liquidaciones.</p></div></div>
          <button type="button" onClick={() => void refreshAuditEvents()} disabled={auditLoading} className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">{auditLoading ? 'Actualizando…' : 'Actualizar historial'}</button>
        </div>
        {auditError && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{auditError}</div>}
        {!auditError && auditEvents.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">{auditLoading ? 'Consultando eventos locales…' : 'Todavía no hay eventos de auditoría registrados.'}</p>}
        <div className="space-y-2">
          {auditEvents.map(event => {
            const details = event.details || {};
            const authorizationDetails = details.authorization && typeof details.authorization === 'object'
              ? details.authorization as Record<string, unknown> : {};
            const actorDetails = details.actor && typeof details.actor === 'object'
              ? details.actor as Record<string, unknown> : {};
            const actorName = details.actorUsername || actorDetails.username;
            const title = event.eventType === 'journal_entry_reversed' ? 'Contra-asiento registrado'
              : event.eventType === 'journal_entry_posted' ? 'Asiento contabilizado'
              : event.eventType === 'fiscal_document_reversal_marked' ? 'Documento fiscal marcado como reversado contablemente'
              : event.eventType === 'credit_settlement_reversed' ? 'Liquidación de crédito reversada'
              : event.eventType === 'bank_statement_reconciled' ? 'Movimiento bancario conciliado'
              : event.eventType === 'bank_statement_unreconciled' ? 'Movimiento bancario desconciliado'
              : event.eventType === 'inventory_movement_posted' ? 'Movimiento de Kardex registrado'
              : event.eventType === 'inventory_correction_posted' ? 'Corrección de Kardex registrada'
              : event.eventType === 'accounting_period_closed' ? 'Período contable cerrado'
              : event.eventType === 'accounting_correction_requested' ? 'Solicitud de corrección registrada · pendiente de revisión'
              : event.eventType === 'accounting_correction_executed' ? 'Corrección ejecutada y auditada'
              : event.eventType === 'company_bcv_rate_updated' ? 'Tasa BCV modificada'
              : event.eventType === 'factory_reset' ? 'Reinicio de datos operativos'
              : event.eventType === 'state_saved' ? 'Estado contable persistido en SQLite'
              : event.eventType.replace(/_/g, ' ');
            return <article key={event.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{title}</strong><span className="font-mono text-slate-500">#{event.id} · {event.createdAt}</span></div>
              {details.entryNumber != null && <p>Asiento #{String(details.entryNumber)} · {String(details.date || '')} · {String(details.referenceDoc || '')}</p>}
              {Boolean(actorName) && <p><strong>Responsable:</strong> {String(actorName)} · rol {String(details.actorRole || '')} · usuario #{String(details.actorUserId || actorDetails.userId || '')}</p>}
              {Boolean(details.correctionType) && <p><strong>Operación:</strong> {String(details.correctionType)} · {String(details.entityType || '')} · registro {String(details.entityId || '')}</p>}
              {details.previousRate != null && <p><strong>Tasa BCV:</strong> {String(details.previousRate)} → {String(details.newRate)} Bs/USD · vigencia {String(details.effectiveDate || 'sin fecha indicada')}</p>}
              {Boolean(details.sourceDocumentRef) && <p><strong>Documento original:</strong> {String(details.sourceDocumentRef)} · <strong>Documento correctivo:</strong> {String(details.correctionDocumentRef || '')}</p>}
              {Boolean(details.reason) && <p><strong>Motivo:</strong> {String(details.reason)}</p>}
              {Boolean(details.fiscalEmissionMedium) && <p><strong>Medio fiscal declarado:</strong> {String(details.fiscalEmissionMedium)} · coincidencia con original: {details.sameMediumAsOriginal ? 'confirmada' : 'no confirmada'}</p>}
              {Boolean(details.authorization) && <p><strong>Autorización:</strong> sesión autenticada {String(authorizationDetails.method || '')} · confirmación expresa {authorizationDetails.explicitConfirmation ? 'sí' : 'no'}</p>}
              {Boolean(details.journalEntryId) && <p><strong>Asiento correctivo:</strong> {String(details.journalEntryId)}</p>}
              {Boolean(details.reversalOfEntryId) && <p>Asiento original: {String(details.reversalOfEntryId)}</p>}
              {Boolean(details.invoiceNumber) && <p>Factura: {String(details.invoiceNumber)} · {String(details.collection || '')}</p>}
              {Boolean(details.reversalReason) && <p><strong>Motivo:</strong> {String(details.reversalReason)}</p>}
              {Boolean(details.cancellationReason) && <p><strong>Motivo de regularización:</strong> {String(details.cancellationReason)}</p>}
              {Boolean(details.documentId) && <p>Documento vinculado: {String(details.documentId)}</p>}
              {Boolean(details.closedThroughDate) && <p>Cierre hasta: {String(details.closedThroughDate)}</p>}
              {Boolean(details.statementMovementId) && <p>Extracto: {String(details.statementMovementId)} · asiento vinculado: {String(details.journalEntryId || '')} · referencia: {String(details.reference || '')}</p>}
              {Boolean(details.movementId) && <p>Kardex: {String(details.productCode || '')} · {String(details.concept || '')} · cantidad {String(details.quantity || '')} · documento {String(details.documentRef || '')} · asiento {String(details.journalEntryId || '')}</p>}
            </article>;
          })}
        </div>
        <p className="text-[11px] text-slate-500">Se muestran los últimos 200 eventos. El historial se almacena en SQLite y el reinicio operativo no lo elimina.</p>
      </section>
      </>}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-900">Corrección de tasa BCV</h2><p className="text-xs text-slate-500">Tasa vigente: {formatBs(currentCompany.bcvRate)} Bs/USD · última fecha: {currentCompany.lastRateUpdate || 'sin fecha registrada'}</p></div>
          <button type="button" onClick={()=>{setBcvCorrectionRate(String(currentCompany.bcvRate || ''));setBcvCorrectionDate(today);setBcvCorrectionOpen(value=>!value);}} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold">{bcvCorrectionOpen ? 'Cerrar' : 'Corregir tasa BCV'}</button>
        </div>
        {bcvCorrectionOpen && <div className="mt-3 grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Nueva tasa Bs/USD
            <input type="number" min="0.000001" step="0.000001" value={bcvCorrectionRate} onChange={event=>setBcvCorrectionRate(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700">Fecha de vigencia
            <input type="date" value={bcvCorrectionDate} onChange={event=>setBcvCorrectionDate(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal" />
          </label>
          <label className="text-xs font-semibold text-slate-700 sm:col-span-2">Motivo de la corrección
            <textarea value={bcvCorrectionReason} onChange={event=>setBcvCorrectionReason(event.target.value)} rows={2} placeholder="Explique por qué debe corregirse la tasa registrada…" className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal" />
          </label>
          <div className="sm:col-span-2"><button type="button" disabled={bcvCorrectionSaving || Number(bcvCorrectionRate)<=0} onClick={()=>void submitBcvRateCorrection()} className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{bcvCorrectionSaving ? 'Guardando corrección…' : 'Confirmar y auditar corrección'}</button></div>
        </div>}
      </section>
      {!isAccountant && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-900">Expedientes de rectificación fiscal</h2><p className="text-xs text-slate-500">Incidencias append-only vinculadas a comprobantes, declaraciones y acciones documentadas</p></div>
          <button type="button" onClick={() => void refreshFiscalIncidents()} disabled={incidentsLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50">{incidentsLoading ? 'Actualizando…' : 'Actualizar expedientes'}</button>
        </div>
        {incidentError && <p role="alert" className="mb-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-800">{incidentError}</p>}
        <div className="mb-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Nota de crédito de proveedor afectada
            <select value={incidentPurchaseId} onChange={event=>setIncidentPurchaseId(event.target.value)} className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal">
              <option value="">Seleccionar NC registrada…</option>
              {purchases.filter(item=>item.companyId===currentCompany.id && item.documentType==='03' && item.originalPurchaseId && !fiscalIncidents.some(incident=>incident.purchaseId===item.id)).map(item=><option key={item.id} value={item.id}>{item.creditNoteNumber || item.invoiceNumber} · {item.affectedInvoiceNumber}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Motivo de revisión fiscal
            <input value={incidentCreateReason} onChange={event=>setIncidentCreateReason(event.target.value)} placeholder="Explique qué comprobante o período debe rectificarse…" className="mt-1 w-full rounded border border-slate-300 bg-white p-2 font-normal" />
          </label>
          <div className="sm:col-span-2"><button type="button" disabled={incidentCreating || !incidentPurchaseId || incidentCreateReason.trim().length<10} onClick={()=>void submitCreateFiscalIncident()} className="rounded bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{incidentCreating ? 'Creando expediente…' : 'Crear expediente fiscal de esta NC'}</button></div>
        </div>
        {fiscalIncidents.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">{incidentsLoading ? 'Consultando SQLite…' : 'No hay incidencias fiscales registradas para esta empresa.'}</p> :
          <div className="space-y-3">{fiscalIncidents.map(incident => <article key={incident.id} className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 text-xs space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{incident.documentType} · {incident.documentNumber}</strong><span className="rounded bg-amber-100 px-2 py-1 font-semibold text-amber-900">{incident.status} · pendiente de cierre</span></div>
            <p>Factura original: {incident.affectedInvoiceNumber || '—'} · comprobante IVA: {incident.vatVoucherId || '—'} · declaración: {incident.declarationId || '—'}</p>
            <p><strong>Motivo:</strong> {incident.reason}</p>
            <p>Registrado por {incident.createdByUsername} · {incident.createdAt}</p>
            {incident.events.map(event => <p key={event.id} className="border-l-2 border-amber-300 pl-2 text-slate-600">{event.eventType} · {event.decisionText} {event.externalReference ? ' · Ref. ' + event.externalReference : ''} · {event.actorUsername} · {event.createdAt}</p>)}
            <div className="flex flex-wrap gap-2 pt-1">
              <button type="button" onClick={() => {setSelectedIncidentId(incident.id);setIncidentEventType('REVIEW_RECORDED');}} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold">Registrar revisión</button>
              <button type="button" disabled={!incident.events.some(event=>event.eventType==='REVIEW_RECORDED')} onClick={() => {setSelectedIncidentId(incident.id);setIncidentEventType('ACTION_RECORDED');}} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold disabled:opacity-40">Registrar actuación</button>
            </div>
            {selectedIncidentId === incident.id && <div className="space-y-2 rounded border border-slate-200 bg-white p-3">
              <p className="font-semibold">{incidentEventType === 'REVIEW_RECORDED' ? 'Documentar revisión profesional' : 'Documentar acción / rectificación externa'}</p>
              <textarea value={incidentDecision} onChange={event=>setIncidentDecision(event.target.value)} rows={2} placeholder="Describa la revisión, decisión, trámite o resultado (mínimo 10 caracteres)…" className="w-full rounded border border-slate-300 p-2" />
              <input value={incidentExternalReference} onChange={event=>setIncidentExternalReference(event.target.value)} placeholder="Referencia SENIAT / declaración / expediente (si aplica)" className="w-full rounded border border-slate-300 p-2" />
              <div className="flex gap-2"><button type="button" disabled={incidentSaving || incidentDecision.trim().length < 10} onClick={() => void submitFiscalIncidentEvent()} className="rounded bg-slate-900 px-3 py-2 font-semibold text-white disabled:opacity-40">{incidentSaving ? 'Guardando…' : 'Guardar en SQLite'}</button><button type="button" onClick={()=>setSelectedIncidentId('')} className="rounded border px-3 py-2">Cancelar</button></div>
            </div>}
          </article>)}</div>}
        <p className="mt-2 text-[11px] text-slate-500">Registrar una actuación no equivale a presentar una declaración sustitutiva ni a obtener aceptación del SENIAT. SICOVEN conserva el expediente abierto para impedir que se declare resuelto sin evidencia.</p>
      </section>}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div><h2 className="text-base font-bold text-slate-900">Documentos correctivos registrados</h2><p className="text-xs text-slate-500">NC/ND vinculadas a su documento original y asiento</p></div>
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{correctionDocuments.length} documento(s)</span>
        </div>
        {correctionDocuments.length === 0 ? <p className="rounded-lg border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">Todavía no hay notas correctivas vinculadas en esta empresa.</p> :
          <div className="space-y-2">{correctionDocuments.map(document => <article key={document.id} className="rounded-lg border border-slate-200 p-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-slate-900">{document.kind} · {document.number}</strong><span className="font-mono text-slate-500">{document.date}</span></div>
            <p className="mt-1 text-slate-600">{document.party} · afecta {document.sourceNumber}</p>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-slate-600"><span>Bs. {formatBs(document.amountBs)}</span><span>USD {formatUsd(document.amountUsd)}</span><span>{document.journalEntryId ? 'Asiento vinculado' : 'Sin asiento enlazado'}</span></div>
            {document.reason && <p className="mt-1"><strong>Motivo:</strong> {document.reason}</p>}
            {document.medium && <p className="mt-1"><strong>Medio fiscal declarado:</strong> {document.medium}</p>}
            <div className="mt-2 flex items-center justify-between gap-2"><span className="text-amber-700">Revisar efecto fiscal y declaración del período</span>
              {document.journalEntryId && <button type="button" onClick={() => setSelectedId(document.journalEntryId)} className="rounded bg-slate-100 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-200">Consultar asiento</button>}
            </div>
          </article>)}</div>}
      </section>
    </div>
  );
};
