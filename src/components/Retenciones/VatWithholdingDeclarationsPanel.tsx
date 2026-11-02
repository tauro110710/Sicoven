import React, { useEffect, useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import type { VatWithholdingDeclaration, VatWithholdingDeclarationEvent } from '../../types/accounting';
import { getVatDeclarationStatus } from '../../types/vatWithholdingDeclaration';
import { buildVatBankReconciliationSummary } from '../../types/vatBankReconciliation';
import { getSeniatVatWithholdingDueDate } from '../../types/seniatVatDueDates';
import { formatBs, formatDate } from '../../utils/formatters';
import type { VatFiscalIncident } from '../../types/vatFiscalIncidents';

const today = () => {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const statusLabels: Record<string, string> = {
  PREPARED: 'Preparada',
  REVIEWED: 'Revisada',
  FILED: 'Presentada',
  PARTIALLY_PAID: 'Enteramiento parcial',
  PAID: 'Enterada'
};

export const VatWithholdingDeclarationsPanel: React.FC = () => {
  const {
    currentCompany, purchases, journalEntries, vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents,
    bankAccounts, bankStatementMovements,
    createVatWithholdingDeclaration, recordVatWithholdingDeclarationEvent,
    listVatFiscalIncidents, createVatFiscalIncident, recordVatFiscalIncidentEvent
  } = useAccounting();
  const now = new Date();
  const [period, setPeriod] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [windowKey, setWindowKey] = useState<'FIRST_HALF' | 'SECOND_HALF'>('FIRST_HALF');
  const [zeroOperations, setZeroOperations] = useState(false);
  const [legacyFiscalDates, setLegacyFiscalDates] = useState<Record<string, string>>({});
  const [legacyFiscalNotes, setLegacyFiscalNotes] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [eventDate, setEventDate] = useState(today());
  const [reviewNote, setReviewNote] = useState('');
  const [ackLegacy, setAckLegacy] = useState(false);
  const [declarationNumber, setDeclarationNumber] = useState('');
  const [receiptReference, setReceiptReference] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [selectedBankMovementIds, setSelectedBankMovementIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceReference, setSourceReference] = useState('');
  const [fiscalIncidents, setFiscalIncidents] = useState<VatFiscalIncident[]>([]);
  const [incidentPurchaseId, setIncidentPurchaseId] = useState('');
  const [incidentVoucherId, setIncidentVoucherId] = useState('');
  const [incidentDeclarationId, setIncidentDeclarationId] = useState('');
  const [incidentEventIds, setIncidentEventIds] = useState<string[]>([]);
  const [incidentMovementIds, setIncidentMovementIds] = useState<string[]>([]);
  const [incidentReason, setIncidentReason] = useState('');
  const [incidentDetectedAt, setIncidentDetectedAt] = useState(today());
  const [incidentBusy, setIncidentBusy] = useState(false);
  const [incidentMessage, setIncidentMessage] = useState('');
  const [eventIncidentId, setEventIncidentId] = useState('');
  const [incidentEventType, setIncidentEventType] = useState<'REVIEW_RECORDED' | 'ACTION_RECORDED'>('REVIEW_RECORDED');
  const [incidentDecisionText, setIncidentDecisionText] = useState('');
  const [incidentExternalReference, setIncidentExternalReference] = useState('');
  const [incidentJournalEntryId, setIncidentJournalEntryId] = useState('');

  useEffect(() => {
    setSelectedBankMovementIds([]);
    setPaymentReference('');
  }, [selectedId]);

  useEffect(() => {
    let active = true;
    listVatFiscalIncidents().then(items => { if (active) setFiscalIncidents(items); })
      .catch(error => { if (active) setIncidentMessage(error instanceof Error ? error.message : 'No se pudieron consultar las incidencias fiscales.'); });
    return () => { active = false; };
  }, [listVatFiscalIncidents]);

  const ordered = useMemo(() => vatWithholdingDeclarations
    .filter(item => item.companyId === currentCompany.id)
    .sort((a, b) => b.period.localeCompare(a.period) || b.startDate.localeCompare(a.startDate)), [vatWithholdingDeclarations, currentCompany.id]);
  const selected = ordered.find(item => item.id === selectedId) || null;
  const periodKey = period.replace('-', '');
  const assignedLegacyIds = new Set(ordered
    .filter(item => item.period === periodKey)
    .flatMap(item => (item.legacyDateAssignments || []).map(assignment => assignment.voucherId)));
  const unresolvedLegacyVouchers = vatVouchers.filter(voucher =>
    voucher.companyId === currentCompany.id && voucher.period === periodKey && !voucher.fiscalDate && !assignedLegacyIds.has(voucher.id));
  const selectedEvents = selected
    ? vatWithholdingDeclarationEvents.filter(item => item.declarationId === selected.id)
    : [];
  const selectedStatus = selected ? getVatDeclarationStatus(selected, selectedEvents) : null;
  const selectedFiledEvent = selectedEvents.find(item => item.eventType === 'FILED');
  const usedBankMovementIds = new Set(vatWithholdingDeclarationEvents.flatMap(item => item.bankStatementMovementIds || []));
  const availablePaymentMovements = selectedFiledEvent ? bankStatementMovements.filter(movement => {
    const account = bankAccounts.find(item => item.id === movement.bankAccountId && item.companyId === currentCompany.id);
    return movement.companyId === currentCompany.id && movement.type === 'DEBIT' && account?.currency === 'BS' &&
      !usedBankMovementIds.has(movement.id) && movement.date >= selectedFiledEvent.occurredAt.slice(0, 10) && movement.date <= eventDate;
  }) : [];
  const selectedPaymentMovements = selectedBankMovementIds.map(id => availablePaymentMovements.find(item => item.id === id)).filter(Boolean);
  const selectedPaymentTotalBs = selectedPaymentMovements.reduce((sum, item) => sum + Number(item?.amountBs || 0), 0);
  const bankReconciliation = selected ? buildVatBankReconciliationSummary(selected, selectedEvents, bankStatementMovements, bankAccounts, journalEntries) : null;

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
      setMessage('Operación guardada y confirmada por la persistencia contable.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo completar la operación.');
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const [yearText, monthText] = period.split('-');
    await run(async () => {
      const declaration = await createVatWithholdingDeclaration({
        year: Number(yearText), month: Number(monthText),
        window: windowKey, zeroOperations,
        legacyFiscalDates: Object.fromEntries(unresolvedLegacyVouchers.map(voucher => [voucher.id, {
          fiscalDate: legacyFiscalDates[voucher.id] || '', note: legacyFiscalNotes[voucher.id] || ''
        }]))
      });
      const scheduledDueDate = currentCompany.taxpayerType === 'ESPECIAL'
        ? getSeniatVatWithholdingDueDate(currentCompany.rif, declaration.period, declaration.window, currentCompany.ivaRetentionAgentBasis || '', currentCompany.isPersonalFirm === true)
        : null;
      if (scheduledDueDate) {
        await recordVatWithholdingDeclarationEvent(declaration.id, {
          eventType: 'DUE_DATE_SET',
          occurredAt: today(),
          dueDate: scheduledDueDate.dueDate,
          officialSourceTitle: scheduledDueDate.sourceTitle,
          officialReference: scheduledDueDate.sourceReference,
          officialSourceUrl: scheduledDueDate.sourceUrl
        });
      }
      setSelectedId(declaration.id);
    });
  };

  const addEvent = (draft: Omit<VatWithholdingDeclarationEvent, 'id' | 'declarationId' | 'recordedAt'>) => {
    if (!selected) return;
    void run(async () => {
      await recordVatWithholdingDeclarationEvent(selected.id, draft);
      if (draft.eventType === 'PAYMENT') {
        setSelectedBankMovementIds([]);
        setPaymentReference('');
      }
    });
  };

  const hasLegacy = Boolean(selected?.voucherSnapshots.some(item => item.dateBasis === 'LEGACY_DOCUMENT_DATE'));
  const hasCorrections = Boolean(selected && selected.voucherIds.some(id =>
    selected.voucherSnapshots.some(snapshot => snapshot.voucherId === id && snapshot.requiresFiscalCorrection) ||
    vatVouchers.some(voucher => voucher.id === id && voucher.requiresFiscalCorrection)));
  const selectedAssignments = new Map(ordered
    .flatMap(declaration => declaration.legacyDateAssignments || [])
    .map(item => [item.voucherId, item] as const));
  const selectedLateVouchers = selected ? vatVouchers.filter(voucher => {
    if (voucher.companyId !== selected.companyId || selected.voucherIds.includes(voucher.id)) return false;
    const fiscalDate = voucher.fiscalDate || selectedAssignments.get(voucher.id)?.confirmedFiscalDate;
    return Boolean(fiscalDate) && fiscalDate! >= selected.startDate && fiscalDate! <= selected.endDate;
  }) : [];
  const selectedUnresolvedLegacy = selected ? vatVouchers.filter(voucher =>
    voucher.companyId === selected.companyId && voucher.period === selected.period &&
    !voucher.fiscalDate && !selectedAssignments.has(voucher.id)) : [];
  const hasUncoveredVouchers = selectedLateVouchers.length > 0 || selectedUnresolvedLegacy.length > 0;
  const hasDueDate = selectedEvents.some(item => item.eventType === 'DUE_DATE_SET');

  const incidentPurchase = purchases.find(item => item.id === incidentPurchaseId) || null;
  const incidentOriginalPurchase = incidentPurchase
    ? incidentPurchase.documentType === '01' ? incidentPurchase
      : purchases.find(item => item.id === incidentPurchase.originalPurchaseId) ||
        purchases.find(item => item.documentType === '01' && item.invoiceNumber === incidentPurchase.affectedInvoiceNumber) || null
    : null;
  const incidentVoucherOptions = incidentOriginalPurchase
    ? vatVouchers.filter(item => item.purchaseRecordId === incidentOriginalPurchase.id) : [];
  const incidentDeclarationOptions = incidentVoucherId
    ? vatWithholdingDeclarations.filter(item => item.voucherIds.includes(incidentVoucherId)) : [];
  const incidentDeclaration = vatWithholdingDeclarations.find(item => item.id === incidentDeclarationId) || null;
  const incidentDeclarationEvents = incidentDeclaration
    ? vatWithholdingDeclarationEvents.filter(item => item.declarationId === incidentDeclaration.id) : [];
  const incidentPaymentEvents = incidentDeclarationEvents.filter(item => item.eventType === 'PAYMENT' && incidentEventIds.includes(item.id));
  const incidentMovementOptions = incidentPaymentEvents.flatMap(event =>
    (event.bankStatementMovementIds || []).map(id => bankStatementMovements.find(movement => movement.id === id)).filter((movement): movement is NonNullable<typeof movement> => Boolean(movement)));
  const saveIncident = async () => {
    setIncidentBusy(true); setIncidentMessage('');
    try {
      const incident = await createVatFiscalIncident({
        purchaseId: incidentPurchaseId, vatVoucherId: incidentVoucherId || undefined,
        declarationId: incidentDeclarationId || undefined, declarationEventIds: incidentEventIds,
        bankMovementIds: incidentMovementIds, reason: incidentReason, detectedAt: incidentDetectedAt
      });
      setFiscalIncidents(current => [incident, ...current.filter(item => item.id !== incident.id)]);
      setIncidentPurchaseId(''); setIncidentVoucherId(''); setIncidentDeclarationId('');
      setIncidentEventIds([]); setIncidentMovementIds([]); setIncidentReason('');
      setIncidentMessage('Incidencia registrada en SQLite. El expediente permanece pendiente de revisión.');
    } catch (error) {
      setIncidentMessage(error instanceof Error ? error.message : 'No se pudo registrar la incidencia.');
    } finally { setIncidentBusy(false); }
  };
  const saveIncidentEvent = async (incident: VatFiscalIncident) => {
    setIncidentBusy(true); setIncidentMessage('');
    try {
      const updated = await recordVatFiscalIncidentEvent({
        incidentId: incident.id, eventType: incidentEventType, decisionText: incidentDecisionText,
        externalReference: incidentExternalReference || undefined,
        declarationId: incident.declarationId || undefined, journalEntryId: incidentJournalEntryId || undefined
      });
      setFiscalIncidents(current => current.map(item => item.id === updated.id ? updated : item));
      setEventIncidentId(''); setIncidentDecisionText(''); setIncidentExternalReference(''); setIncidentJournalEntryId('');
      setIncidentMessage('Evento agregado al historial inmutable. El expediente no se marca como resuelto.');
    } catch (error) {
      setIncidentMessage(error instanceof Error ? error.message : 'No se pudo registrar el evento.');
    } finally { setIncidentBusy(false); }
  };

  const selectedScheduledDueDate = selected && currentCompany.taxpayerType === 'ESPECIAL'
    ? getSeniatVatWithholdingDueDate(currentCompany.rif, selected.period, selected.window, currentCompany.ivaRetentionAgentBasis || '', currentCompany.isPersonalFirm === true)
    : null;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Auxiliar de declaraciones quincenales de retenciones IVA</h2>
          <p className="text-xs leading-5 text-slate-600">
            Prepara una fotografía inmutable de los comprobantes por empresa y quincena, registra revisión,
            presentación y enteramientos. No calcula vencimientos automáticamente ni declara aceptación del Portal Fiscal.
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-4 sm:items-end">
          <label className="text-xs font-semibold text-slate-700">
            Período
            <input type="month" value={period} onChange={e => setPeriod(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-semibold text-slate-700">
            Ventana de enteramiento
            <select value={windowKey} onChange={e => setWindowKey(e.target.value as 'FIRST_HALF' | 'SECOND_HALF')}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <option value="FIRST_HALF">Día 1 al 15</option>
              <option value="SECOND_HALF">Día 16 al último día</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700 sm:pb-2">
            <input type="checkbox" checked={zeroOperations} onChange={e => setZeroOperations(e.target.checked)} />
            Declaración sin operaciones
          </label>
          <button type="button" onClick={create} disabled={busy || !/^\d{4}-\d{2}$/.test(period)}
            className="rounded-lg bg-purple-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-600 disabled:opacity-40">
            Preparar declaración
          </button>
        </div>

        {unresolvedLegacyVouchers.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 space-y-3">
            <div>
              <h3 className="text-xs font-bold text-amber-950">Comprobantes históricos sin fecha fiscal efectiva</h3>
              <p className="mt-1 text-xs leading-5 text-amber-900">
                Estos comprobantes no guardan el evento de pago/abono que ahora conserva el Bloque 4.2.
                Para no asignarlos a una quincena incorrecta, confirma la fecha efectiva usando el soporte original.
                La fecha de factura no se toma como sustituto.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {unresolvedLegacyVouchers.map(voucher => (
                <div key={voucher.id} className="rounded-lg border border-amber-200 bg-white p-3">
                  <p className="text-xs font-bold text-amber-950">{voucher.voucherNumber} · {voucher.supplierName}</p>
                  <label className="mt-2 block text-xs font-semibold text-amber-950">
                    Fecha efectiva de pago/abono
                    <input type="date" value={legacyFiscalDates[voucher.id] || ''}
                      onChange={e => setLegacyFiscalDates(prev => ({ ...prev, [voucher.id]: e.target.value }))}
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs" />
                  </label>
                  <label className="mt-2 block text-xs font-semibold text-amber-950">
                    Soporte original específico
                    <textarea value={legacyFiscalNotes[voucher.id] || ''}
                      onChange={e => setLegacyFiscalNotes(prev => ({ ...prev, [voucher.id]: e.target.value }))}
                      rows={2} placeholder="Referencia bancaria, recibo o documento que acredita la fecha efectiva."
                      className="mt-1 w-full rounded-lg border border-amber-300 bg-white p-2 text-xs font-normal" />
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Las fechas límite solo se registran cuando el usuario aporta fecha, publicación y enlace oficial HTTPS de SENIAT.
          No se generan fechas hábiles estimadas.
        </div>
        {message && <p role="status" className="mt-3 text-xs text-slate-700">{message}</p>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-bold text-slate-900">Declaraciones registradas</h3>
        </div>
        {ordered.length === 0 ? (
          <p className="p-6 text-center text-xs text-slate-500">Todavía no hay declaraciones quincenales preparadas para esta empresa.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-100 text-slate-600">
                <tr>
                  <th className="px-4 py-3">Período / ventana</th>
                  <th className="px-4 py-3">Comprobantes</th>
                  <th className="px-4 py-3 text-right">IVA retenido</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ordered.map(item => {
                  const status = getVatDeclarationStatus(item, vatWithholdingDeclarationEvents);
                  return (
                    <tr key={item.id} className={selectedId === item.id ? 'bg-purple-50' : ''}>
                      <td className="px-4 py-3 font-semibold text-slate-800">
                        {item.period} · {item.window === 'FIRST_HALF' ? '1–15' : '16–fin'}
                        <span className="block font-normal text-slate-500">{formatDate(item.startDate)} al {formatDate(item.endDate)}</span>
                        {item.zeroOperations && <span className="text-[10px] text-amber-700">Sin operaciones</span>}
                      </td>
                      <td className="px-4 py-3">{item.voucherIds.length}</td>
                      <td className="px-4 py-3 text-right font-mono font-bold">{formatBs(item.totalWithheldBs)}</td>
                      <td className="px-4 py-3">{statusLabels[status]}</td>
                      <td className="px-4 py-3">
                        <button type="button" onClick={() => setSelectedId(item.id)}
                          className="rounded-md border border-purple-300 px-3 py-1.5 font-semibold text-purple-800 hover:bg-purple-100">
                          Gestionar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900">Gestión · {selected.period} · {selected.window === 'FIRST_HALF' ? 'Primera quincena' : 'Segunda quincena'}</h3>
              <p className="text-xs text-slate-500">{selected.voucherIds.length} comprobantes · IVA retenido: {formatBs(selected.totalWithheldBs)}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabels[selectedStatus || 'PREPARED']}</span>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-slate-50 p-3"><span className="block text-[10px] font-semibold uppercase text-slate-500">Base imponible</span><strong className="font-mono text-sm text-slate-900">{formatBs(selected.totalTaxableBaseBs)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3"><span className="block text-[10px] font-semibold uppercase text-slate-500">IVA causado</span><strong className="font-mono text-sm text-slate-900">{formatBs(selected.totalVatAmountBs)}</strong></div>
            <div className="rounded-lg bg-purple-50 p-3"><span className="block text-[10px] font-semibold uppercase text-purple-700">IVA retenido</span><strong className="font-mono text-sm text-purple-900">{formatBs(selected.totalWithheldBs)}</strong></div>
          </div>

          {hasUncoveredVouchers && <div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
            Hay comprobantes de esta quincena que todavía no forman parte de esta fotografía, o fechas históricas que requieren asignación. La fotografía se conserva sin sobrescritura. Incluya las operaciones pendientes en una nueva declaración o gestione la rectificación que corresponda antes de revisar.
          </div>}
          {hasCorrections && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Esta fotografía contiene comprobantes con corrección fiscal pendiente. No puede revisarse hasta regularizarse.</div>}
          {hasLegacy && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Incluye comprobantes históricos cuya fecha efectiva fue asignada manualmente y debe verificarse contra el soporte disponible.</div>}

          {selectedStatus === 'PREPARED' && (
            <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-700 sm:col-span-2">
                Nota de revisión / verificación de fechas históricas
                <textarea value={reviewNote} onChange={e => setReviewNote(e.target.value)} rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 font-normal" />
              </label>
              {hasLegacy && <label className="flex items-center gap-2 text-xs text-slate-700 sm:col-span-2">
                <input type="checkbox" checked={ackLegacy} onChange={e => setAckLegacy(e.target.checked)} />
                Confirmo que verifiqué las fechas fiscales de los comprobantes históricos y documento el soporte en la nota.
              </label>}
              <button type="button" disabled={busy || hasCorrections || hasUncoveredVouchers || (hasLegacy && (!ackLegacy || reviewNote.trim().length < 10))}
                onClick={() => addEvent({ eventType: 'REVIEWED', occurredAt: eventDate, note: reviewNote, acknowledgedLegacyDates: ackLegacy })}
                className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">Marcar revisada</button>
            </div>
          )}

          {selectedStatus === 'REVIEWED' && (
            <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-3">
              <label className="text-xs font-semibold text-slate-700">N° declaración
                <input value={declarationNumber} onChange={e => setDeclarationNumber(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Referencia / acuse
                <input value={receiptReference} onChange={e => setReceiptReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Fecha de presentación
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <button type="button" disabled={busy || hasUncoveredVouchers || hasCorrections || !declarationNumber.trim() || !receiptReference.trim()}
                onClick={() => addEvent({ eventType: 'FILED', occurredAt: eventDate, declarationNumber, receiptReference })}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-3">Registrar presentación</button>
            </div>
          )}

          {(selectedStatus === 'FILED' || selectedStatus === 'PARTIALLY_PAID') && selected.totalWithheldBs > 0 && (
            <div className="space-y-3 rounded-xl bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700">Saldo pendiente de enterar</span>
                <strong className="font-mono text-base text-slate-900">{formatBs(Math.max(0, selected.totalWithheldBs - selectedEvents.filter(item => item.eventType === 'PAYMENT').reduce((sum, item) => sum + Number(item.amountBs || 0), 0)))}</strong>
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3">
                  <p className="mb-2 text-xs font-bold text-slate-800">Débitos bancarios disponibles en Bs.</p>
                  {availablePaymentMovements.length === 0 ? <p className="text-xs text-slate-500">No hay débitos bancarios elegibles sin utilizar entre la presentación y la fecha de pago.</p> : (
                    <div className="max-h-48 space-y-2 overflow-y-auto">
                      {availablePaymentMovements.map(movement => {
                        const account = bankAccounts.find(item => item.id === movement.bankAccountId);
                        return <label key={movement.id} className="flex items-start gap-2 rounded-md border border-slate-100 p-2 text-xs">
                          <input type="checkbox" checked={selectedBankMovementIds.includes(movement.id)} onChange={e => {
                            const next = e.target.checked ? [...selectedBankMovementIds, movement.id] : selectedBankMovementIds.filter(id => id !== movement.id);
                            setSelectedBankMovementIds(next);
                          }} />
                          <span className="min-w-0 flex-1">{account?.bankName || 'Banco'} · {formatDate(movement.date)} · Ref. {movement.reference}<br /><span className="font-mono font-bold">{formatBs(movement.amountBs)}</span> · {movement.description}</span>
                        </label>;
                      })}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="text-xs font-semibold text-slate-700">Importe respaldado (Bs.)
                    <input readOnly value={selectedPaymentTotalBs.toFixed(2)} className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 p-2" />
                  </label>
                  <label className="text-xs font-semibold text-slate-700">Referencia / comprobante de pago
                    <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="text-xs font-semibold text-slate-700">Fecha de pago
                    <input type="date" value={eventDate} onChange={e => { setEventDate(e.target.value); setSelectedBankMovementIds([]); }} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                  </label>
                  <button type="button" disabled={busy || selectedBankMovementIds.length === 0 || selectedPaymentMovements.length !== selectedBankMovementIds.length || !paymentReference.trim()}
                    onClick={() => addEvent({ eventType: 'PAYMENT', occurredAt: eventDate, amountBs: selectedPaymentTotalBs, paymentReference, bankStatementMovementIds: selectedBankMovementIds })}
                    className="rounded-lg bg-purple-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-3">Registrar enteramiento conciliado</button>
                </div>
              </div>
            </div>
          )}

          {!hasDueDate && (
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-xs font-bold text-slate-800">Registrar vencimiento de calendario fiscal verificado</summary>
              <div className="mt-3 space-y-3">
                {selectedScheduledDueDate && <button type="button" disabled={busy} onClick={() => addEvent({
                  eventType: 'DUE_DATE_SET', occurredAt: today(), dueDate: selectedScheduledDueDate.dueDate,
                  officialSourceTitle: selectedScheduledDueDate.sourceTitle,
                  officialReference: selectedScheduledDueDate.sourceReference,
                  officialSourceUrl: selectedScheduledDueDate.sourceUrl
                })} className="rounded-lg bg-purple-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
                  Aplicar calendario 2026: {formatDate(selectedScheduledDueDate.dueDate)}
                </button>}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">Fecha límite publicada
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Título de la fuente normativa
                  <input value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">URL de la fuente normativa
                  <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://www.seniat.gob.ve/... o copia de Gaceta Oficial" className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Referencia / publicación
                  <input value={sourceReference} onChange={e => setSourceReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <button type="button" disabled={busy || !dueDate || !sourceTitle.trim() || !sourceUrl.trim() || !sourceReference.trim()}
                  onClick={() => addEvent({ eventType: 'DUE_DATE_SET', occurredAt: today(), dueDate, officialSourceTitle: sourceTitle, officialSourceUrl: sourceUrl, officialReference: sourceReference })}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-2">Guardar vencimiento documentado</button>
                </div>
              </div>
            </details>
          )}

          {selected.legacyDateAssignments?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <strong>Fechas históricas verificadas:</strong>
              <ul className="mt-2 list-disc pl-5">
                {selected.legacyDateAssignments.map(assignment => (
                  <li key={assignment.voucherId}>{formatDate(assignment.confirmedFiscalDate)} · {assignment.note}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h4 className="mb-2 text-xs font-bold text-slate-800">Comprobantes incluidos (snapshot)</h4>
            {selected.voucherSnapshots.length === 0 ? (
              <p className="text-xs text-slate-500">Declaración expresamente marcada sin operaciones.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[580px] text-left text-xs">
                  <thead className="bg-slate-100 text-slate-600"><tr><th className="p-2">Comprobante</th><th className="p-2">Proveedor</th><th className="p-2">Fecha fiscal</th><th className="p-2 text-right">Base Bs.</th><th className="p-2 text-right">Retenido Bs.</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.voucherSnapshots.map(item => <tr key={item.voucherId}>
                      <td className="p-2 font-mono">{item.voucherNumber}{item.dateBasis === 'MANUALLY_VERIFIED_LEGACY_DATE' ? ' · FECHA LEGACY VERIFICADA' : item.dateBasis === 'LEGACY_DOCUMENT_DATE' ? ' · LEGACY PENDIENTE' : ''}</td>
                      <td className="p-2">{item.supplierName}</td>
                      <td className="p-2">{formatDate(item.fiscalDate)}</td>
                      <td className="p-2 text-right font-mono">{formatBs(item.taxableBaseBs)}</td>
                      <td className="p-2 text-right font-mono">{formatBs(item.vatWithheldBs)}</td>
                    </tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div>
            <h4 className="mb-2 text-xs font-bold text-slate-800">Historial de eventos</h4>
            {selectedEvents.length === 0 ? <p className="text-xs text-slate-500">Sin eventos posteriores a la preparación.</p> : (
              <ul className="space-y-2 text-xs">
                {selectedEvents.map(event => <li key={event.id} className="rounded-lg bg-slate-50 p-3">
                  <strong>{event.eventType}</strong> · {formatDate(event.occurredAt)}
                  {event.declarationNumber && <span> · Declaración {event.declarationNumber}</span>}
                  {event.receiptReference && <span> · Acuse {event.receiptReference}</span>}
                  {event.amountBs !== undefined && <span> · {formatBs(event.amountBs)}</span>}
                  {event.paymentReference && <span> · Ref. {event.paymentReference}</span>}
                  {event.bankStatementMovementIds?.length ? <span> · Movimientos bancarios: {event.bankStatementMovementIds.join(', ')}</span> : event.eventType === 'PAYMENT' ? <span className="font-bold text-amber-700"> · Pendiente de conciliación bancaria histórica</span> : null}
                  {event.dueDate && <span> · Vence {formatDate(event.dueDate)}</span>}
                </li>)}
              </ul>
            )}
          </div>
          {bankReconciliation && (
            <div className="rounded-xl border border-slate-200 p-4">
              <h4 className="mb-2 text-xs font-bold text-slate-800">Informe de conciliación fiscal-bancaria</h4>
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-emerald-50 p-2">Conciliados: <strong>{bankReconciliation.reconciledCount}</strong><br />{formatBs(bankReconciliation.reconciledAmountBs)}</div>
                <div className="rounded-lg bg-amber-50 p-2">Pendientes: <strong>{bankReconciliation.pendingCount}</strong><br />{formatBs(bankReconciliation.pendingAmountBs)}</div>
              </div>
              {bankReconciliation.lines.length === 0 ? <p className="text-xs text-slate-500">Todavía no hay enteramientos registrados.</p> : (
                <div className="space-y-2">
                  {bankReconciliation.lines.map(line => <div key={line.eventId} className="rounded-lg border border-slate-100 p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2"><strong>{formatBs(line.amountBs)} · {line.paymentReference || 'Sin referencia'}</strong><span className={line.status === 'RECONCILIADO' ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{line.status}</span></div>
                    {line.movements.length ? line.movements.map(movement => <p key={movement.id} className="mt-1 text-slate-600">{formatDate(movement.date)} · {movement.reference} · {formatBs(movement.amountBs)} · {movement.description}</p>) : <p className="mt-1 text-amber-700">Pago histórico sin movimiento bancario vinculado.</p>}
                  </div>)}
                </div>
              )}
            </div>
          )}
        </section>
      )}
      <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm">
        <div className="border-b border-slate-200 pb-4">
          <h2 className="text-lg font-bold text-slate-900">Expedientes de incidencias y rectificaciones IVA</h2>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Registra la incidencia y su trazabilidad sin recalcular comprobantes ni modificar declaraciones, pagos o asientos históricos.
            La actuación documentada no equivale a una rectificación aceptada ni cierra automáticamente el caso.
          </p>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-700">Documento fuente (factura, NC o ND)
            <select value={incidentPurchaseId} onChange={e => {
              setIncidentPurchaseId(e.target.value); setIncidentVoucherId(''); setIncidentDeclarationId('');
              setIncidentEventIds([]); setIncidentMovementIds([]);
            }} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
              <option value="">Seleccione documento</option>
              {purchases.filter(item => ['01','02','03'].includes(item.documentType)).map(item =>
                <option key={item.id} value={item.id}>{item.documentType === '01' ? 'Factura' : item.documentType === '02' ? 'Nota débito' : 'Nota crédito'} · {item.creditNoteNumber || item.debitNoteNumber || item.invoiceNumber}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Comprobante IVA de la factura original (opcional)
            <select value={incidentVoucherId} onChange={e => {
              setIncidentVoucherId(e.target.value); setIncidentDeclarationId(''); setIncidentEventIds([]); setIncidentMovementIds([]);
            }} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
              <option value="">Sin comprobante asociado</option>
              {incidentVoucherOptions.map(item => <option key={item.id} value={item.id}>{item.voucherNumber} · {item.supplierName}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Declaración IVA afectada (opcional)
            <select value={incidentDeclarationId} onChange={e => {
              setIncidentDeclarationId(e.target.value); setIncidentEventIds([]); setIncidentMovementIds([]);
            }} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
              <option value="">Sin declaración vinculada</option>
              {incidentDeclarationOptions.map(item => <option key={item.id} value={item.id}>{item.period} · {item.window === 'FIRST_HALF' ? '1.ª quincena' : '2.ª quincena'}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold text-slate-700">Fecha de detección
            <input type="date" value={incidentDetectedAt} onChange={e => setIncidentDetectedAt(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
          </label>
        </div>
        {incidentDeclaration && (
          <div className="mt-3 rounded-xl border border-slate-200 p-3">
            <p className="mb-2 text-xs font-bold text-slate-800">Eventos de la declaración relacionados</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {incidentDeclarationEvents.map(event => <label key={event.id} className="flex items-start gap-2 text-xs text-slate-700">
                <input type="checkbox" checked={incidentEventIds.includes(event.id)} onChange={e => {
                  setIncidentEventIds(current => e.target.checked ? [...current, event.id] : current.filter(id => id !== event.id));
                  if (!e.target.checked) setIncidentMovementIds([]);
                }} />
                <span>{event.eventType} · {formatDate(event.occurredAt)} {event.paymentReference ? '· ' + event.paymentReference : ''}</span>
              </label>)}
            </div>
            {incidentMovementOptions.length > 0 && <div className="mt-3 border-t border-slate-100 pt-3">
              <p className="mb-2 text-xs font-bold text-slate-800">Movimientos bancarios ya asociados a esos pagos</p>
              {incidentMovementOptions.map(movement => <label key={movement.id} className="flex items-center gap-2 py-1 text-xs text-slate-700">
                <input type="checkbox" checked={incidentMovementIds.includes(movement.id)} onChange={e =>
                  setIncidentMovementIds(current => e.target.checked ? [...current, movement.id] : current.filter(id => id !== movement.id))} />
                {formatDate(movement.date)} · {movement.reference} · {formatBs(movement.amountBs)}
              </label>)}
            </div>}
          </div>
        )}
        <label className="mt-3 block text-xs font-semibold text-slate-700">Motivo y descripción de la incidencia
          <textarea value={incidentReason} onChange={e => setIncidentReason(e.target.value)} rows={3}
            placeholder="Describa qué documento o evento requiere revisión y por qué..."
            className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
        </label>
        <button type="button" disabled={incidentBusy || incidentPurchaseId === '' || incidentReason.trim().length < 15 || !incidentDetectedAt}
          onClick={() => void saveIncident()} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
          Registrar incidencia en SQLite
        </button>
        {incidentMessage && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{incidentMessage}</p>}
        <div className="mt-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Historial de expedientes</h3>
          {fiscalIncidents.length === 0 ? <p className="text-xs text-slate-500">No hay incidencias registradas para esta empresa.</p> :
            fiscalIncidents.map(incident => <article key={incident.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-slate-900">{incident.documentType === '01' ? 'Factura' : incident.documentType === '02' ? 'Nota de débito' : 'Nota de crédito'} · {incident.documentNumber}</p>
                  <p className="mt-1 text-xs text-slate-600">Detectada {formatDate(incident.detectedAt)} · {incident.reason}</p>
                </div>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">{incident.status === 'PENDING_REVIEW' ? 'Pendiente revisión' : incident.status === 'REVIEW_DOCUMENTED' ? 'Revisión documentada' : 'Actuación documentada'}</span>
              </div>
              <ol className="mt-3 space-y-2 border-l-2 border-slate-200 pl-3">
                {incident.events.map(event => <li key={event.id} className="text-xs text-slate-700">
                  <strong>{event.eventType === 'INCIDENT_RECORDED' ? 'Incidencia' : event.eventType === 'REVIEW_RECORDED' ? 'Revisión' : 'Actuación'}</strong>
                  {' · '}{formatDate(event.createdAt.slice(0, 10))} · {event.decisionText}
                  {event.externalReference && <span> · Ref. {event.externalReference}</span>}
                  {event.journalEntryId && <span> · Asiento {event.journalEntryId}</span>}
                </li>)}
              </ol>
              {eventIncidentId === incident.id ? (
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
                  <label className="block text-xs font-semibold text-slate-700">Tipo de evento
                    <select value={incidentEventType} onChange={e => setIncidentEventType(e.target.value as 'REVIEW_RECORDED' | 'ACTION_RECORDED')} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
                      <option value="REVIEW_RECORDED">Revisión documentada</option>
                      <option value="ACTION_RECORDED">Actuación documentada</option>
                    </select>
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Decisión o actuación del responsable
                    <textarea value={incidentDecisionText} onChange={e => setIncidentDecisionText(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Referencia externa / acuse (opcional)
                    <input value={incidentExternalReference} onChange={e => setIncidentExternalReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                  </label>
                  <label className="block text-xs font-semibold text-slate-700">Asiento correctivo vinculado (opcional)
                    <select value={incidentJournalEntryId} onChange={e => setIncidentJournalEntryId(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2">
                      <option value="">Sin asiento vinculado</option>
                      {journalEntries.map(entry => <option key={entry.id} value={entry.id}>{entry.entryNumber} · {entry.date} · {entry.description}</option>)}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={incidentBusy || incidentDecisionText.trim().length < 20} onClick={() => void saveIncidentEvent(incident)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-40">Guardar evento</button>
                    <button type="button" disabled={incidentBusy} onClick={() => setEventIncidentId('')} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Cancelar</button>
                  </div>
                </div>
              ) : <button type="button" disabled={incidentBusy} onClick={() => setEventIncidentId(incident.id)} className="mt-3 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">Añadir revisión o actuación</button>}
              <p className="mt-2 text-[10px] text-amber-700">No resuelto automáticamente · No altera snapshots ni confirma aceptación del SENIAT.</p>
            </article>)}
        </div>
      </section>
    </div>
  );
};
