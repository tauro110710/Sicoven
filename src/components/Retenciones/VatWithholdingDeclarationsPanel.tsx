import React, { useMemo, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import type { VatWithholdingDeclaration, VatWithholdingDeclarationEvent } from '../../types/accounting';
import { getVatDeclarationStatus } from '../../types/vatWithholdingDeclaration';
import { formatBs, formatDate } from '../../utils/formatters';

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
    vatVouchers, vatWithholdingDeclarations, vatWithholdingDeclarationEvents,
    createVatWithholdingDeclaration, recordVatWithholdingDeclarationEvent
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
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceReference, setSourceReference] = useState('');

  const ordered = useMemo(() => [...vatWithholdingDeclarations]
    .sort((a, b) => b.period.localeCompare(a.period) || b.startDate.localeCompare(a.startDate)), [vatWithholdingDeclarations]);
  const selected = ordered.find(item => item.id === selectedId) || null;
  const periodKey = period.replace('-', '');
  const assignedLegacyIds = new Set(ordered
    .filter(item => item.period === periodKey)
    .flatMap(item => (item.legacyDateAssignments || []).map(assignment => assignment.voucherId)));
  const unresolvedLegacyVouchers = vatVouchers.filter(voucher =>
    voucher.period === periodKey && !voucher.fiscalDate && !assignedLegacyIds.has(voucher.id));
  const selectedEvents = selected
    ? vatWithholdingDeclarationEvents.filter(item => item.declarationId === selected.id)
    : [];
  const selectedStatus = selected ? getVatDeclarationStatus(selected, selectedEvents) : null;

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
      setSelectedId(declaration.id);
    });
  };

  const addEvent = (draft: Omit<VatWithholdingDeclarationEvent, 'id' | 'declarationId' | 'recordedAt'>) => {
    if (!selected) return;
    void run(() => recordVatWithholdingDeclarationEvent(selected.id, draft));
  };

  const hasLegacy = Boolean(selected?.voucherSnapshots.some(item => item.dateBasis === 'LEGACY_DOCUMENT_DATE'));
  const hasCorrections = Boolean(selected && selected.voucherIds.some(id =>
    selected.voucherSnapshots.some(snapshot => snapshot.voucherId === id && snapshot.requiresFiscalCorrection) ||
    vatVouchers.some(voucher => voucher.id === id && voucher.requiresFiscalCorrection)));
  const hasDueDate = selectedEvents.some(item => item.eventType === 'DUE_DATE_SET');

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

          {hasCorrections && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">Esta fotografía contiene comprobantes con corrección fiscal pendiente. No puede revisarse hasta regularizarse.</div>}
          {hasLegacy && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Incluye comprobantes históricos que no guardaban fecha del evento fiscal. La fecha documental se usa solo como referencia provisional y requiere verificación documentada.</div>}

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
              <button type="button" disabled={busy || hasCorrections || (hasLegacy && (!ackLegacy || reviewNote.trim().length < 10))}
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
              <button type="button" disabled={busy || !declarationNumber.trim() || !receiptReference.trim()}
                onClick={() => addEvent({ eventType: 'FILED', occurredAt: eventDate, declarationNumber, receiptReference })}
                className="rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-3">Registrar presentación</button>
            </div>
          )}

          {(selectedStatus === 'FILED' || selectedStatus === 'PARTIALLY_PAID') && selected.totalWithheldBs > 0 && (
            <div className="grid grid-cols-1 gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-4">
              <label className="text-xs font-semibold text-slate-700">Importe enterado (Bs.)
                <input type="number" min="0.01" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Referencia bancaria
                <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Soporte documental
                <input value={evidenceReference} onChange={e => setEvidenceReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Fecha de pago
                <input type="date" value={eventDate} onChange={e => setEventDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
              </label>
              <button type="button" disabled={busy || !paymentAmount || !paymentReference.trim() || !evidenceReference.trim()}
                onClick={() => addEvent({ eventType: 'PAYMENT', occurredAt: eventDate, amountBs: Number(paymentAmount), paymentReference, evidenceReference })}
                className="rounded-lg bg-purple-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-4">Registrar enteramiento</button>
            </div>
          )}

          {!hasDueDate && (
            <details className="rounded-xl border border-slate-200 p-4">
              <summary className="cursor-pointer text-xs font-bold text-slate-800">Registrar vencimiento con fuente oficial verificada</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-700">Fecha límite publicada
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Título de la fuente oficial
                  <input value={sourceTitle} onChange={e => setSourceTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">URL oficial SENIAT
                  <input value={sourceUrl} onChange={e => setSourceUrl(e.target.value)} placeholder="https://www.seniat.gob.ve/..." className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <label className="text-xs font-semibold text-slate-700">Referencia / publicación
                  <input value={sourceReference} onChange={e => setSourceReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 p-2" />
                </label>
                <button type="button" disabled={busy || !dueDate || !sourceTitle.trim() || !sourceUrl.trim() || !sourceReference.trim()}
                  onClick={() => addEvent({ eventType: 'DUE_DATE_SET', occurredAt: today(), dueDate, officialSourceTitle: sourceTitle, officialSourceUrl: sourceUrl, officialReference: sourceReference })}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 sm:col-span-2">Guardar vencimiento verificado</button>
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
                  {event.dueDate && <span> · Vence {formatDate(event.dueDate)}</span>}
                </li>)}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
