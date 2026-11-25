import React, { useState } from 'react';
import { VatRetentionVoucher } from '../../types/accounting';
import { getVatVoucherDeliveryWindow } from '../../utils/vatVoucherDelivery';
import { requiresSnat2026DocumentReference } from '../../types/retentionVoucherCompliance';
import { X, Printer, ShieldCheck } from 'lucide-react';
import { formatBs, formatDate, formatNumberVe } from '../../utils/formatters';
import { formatUsdForDate } from '../../utils/monetaryPolicy';

interface VatVoucherModalProps {
  voucher: VatRetentionVoucher | null;
  correctionContext?: {
    period: string; window: 'FIRST_HALF' | 'SECOND_HALF'; status: string;
    declarationNumber?: string; totalWithheldBs: number; paidBs: number; pendingBs: number;
  };
  onClose: () => void;
  onRecordDelivery: (draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }) => Promise<VatRetentionVoucher>;
}

export const VatVoucherModal: React.FC<VatVoucherModalProps> = ({ voucher, correctionContext, onClose, onRecordDelivery }) => {
  const localToday = () => {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const [deliveryDate, setDeliveryDate] = useState(localToday);
  const [deliveryMethod, setDeliveryMethod] = useState<'PHYSICAL' | 'ELECTRONIC'>('PHYSICAL');
  const [electronicAgreed, setElectronicAgreed] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  if (!voucher) return null;
  const estimatedDeliveryWindow = getVatVoucherDeliveryWindow(voucher.period);

  const handleRecordDelivery = async () => {
    setDeliveryBusy(true);
    setDeliveryMessage('');
    try {
      await onRecordDelivery({
        deliveryDate,
        deliveryMethod,
        ...(deliveryMethod === 'ELECTRONIC' ? { electronicDeliveryAgreed: electronicAgreed } : {})
      });
      setDeliveryMessage('Entrega registrada y guardada.');
    } catch (error) {
      setDeliveryMessage(error instanceof Error ? error.message : 'No se pudo registrar la entrega.');
    } finally {
      setDeliveryBusy(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 sm:my-6 overflow-hidden border border-slate-300">
        {/* Top Control Bar (no-print) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-slate-900 text-white no-print">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-emerald-400 flex-shrink-0" />
            <span className="font-semibold text-xs sm:text-sm truncate">
              Comprobante de Retención de IVA (SNAT/2025/000054)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white transition cursor-pointer shadow"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Imprimir (2 copias)</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {voucher.requiresFiscalCorrection && (
          <div className="no-print border-b border-amber-300 bg-amber-50 px-4 sm:px-6 py-3 text-xs text-amber-950 space-y-1">
            <strong>Corrección fiscal pendiente</strong>
            {correctionContext ? (
              <>
                <p>Declaración original: {correctionContext.period} · {correctionContext.window === 'FIRST_HALF' ? '1.ª quincena' : '2.ª quincena'} · Estado: {correctionContext.status}{correctionContext.declarationNumber ? ' · N.º ' + correctionContext.declarationNumber : ''}.</p>
                <p>Retención incluida: {formatBs(correctionContext.totalWithheldBs)} · Enterado: {formatBs(correctionContext.paidBs)} · Saldo pendiente: {formatBs(correctionContext.pendingBs)}.</p>
              </>
            ) : <p>Este comprobante aún no figura en una declaración quincenal registrada.</p>}
            {voucher.correctionNote && <p>Motivo registrado: {voucher.correctionNote}</p>}
            <p>El comprobante y su declaración histórica no se modifican automáticamente. La rectificación y el tratamiento de importes ya enterados requieren revisión fiscal.</p>
          </div>
        )}
        {!voucher.deliveryDate ? (
          <div className="no-print border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-4 space-y-3">
            <div>
              <h3 className="text-xs font-bold text-slate-900">Registrar entrega al proveedor</h3>
              <p className="mt-1 text-[11px] text-slate-600">Registra la fecha real de entrega. No se exige adjuntar archivos. La entrega electrónica requiere acuerdo previo del proveedor. La norma exige entregar el comprobante dentro de los primeros dos días hábiles del período siguiente. {estimatedDeliveryWindow ? `Como orientación (sin descontar feriados), los dos primeros días de lunes a viernes serían ${formatDate(estimatedDeliveryWindow.firstDay)} y ${formatDate(estimatedDeliveryWindow.secondDay)}.` : 'No se pudo calcular una referencia de días hábiles para este período.'} Verifica los feriados oficiales aplicables: esta referencia no es un vencimiento legal definitivo. SICOVEN registra la fecha efectiva y no bloquea operaciones por falta de entrega.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs font-semibold text-slate-700">Fecha efectiva de entrega
                <input type="date" min={voucher.date} value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" />
              </label>
              <label className="text-xs font-semibold text-slate-700">Medio de entrega
                <select value={deliveryMethod} onChange={event => setDeliveryMethod(event.target.value as 'PHYSICAL' | 'ELECTRONIC')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
                  <option value="PHYSICAL">Físico</option>
                  <option value="ELECTRONIC">Electrónico</option>
                </select>
              </label>
              {deliveryMethod === 'ELECTRONIC' && <label className="flex items-center gap-2 text-xs text-slate-700 sm:pt-6">
                <input type="checkbox" checked={electronicAgreed} onChange={event => setElectronicAgreed(event.target.checked)} />
                Existe acuerdo con el proveedor
              </label>}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" disabled={deliveryBusy || !deliveryDate || (deliveryMethod === 'ELECTRONIC' && !electronicAgreed)} onClick={() => void handleRecordDelivery()} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">
                {deliveryBusy ? 'Guardando…' : 'Registrar entrega'}
              </button>
              {deliveryMessage && <p role="status" className="text-xs text-slate-700">{deliveryMessage}</p>}
            </div>
          </div>
        ) : (
          <div className="no-print border-b border-emerald-200 bg-emerald-50 px-4 sm:px-6 py-3 text-xs text-emerald-900">
            Entregado el {formatDate(voucher.deliveryDate)} por medio {voucher.deliveryMethod === 'ELECTRONIC' ? 'electrónico (acuerdo confirmado)' : 'físico'}.
          </div>
        )}

        {/* Printable Official Voucher Document */}
        <div className="p-3 sm:p-8 text-black bg-white space-y-3 sm:space-y-4 print:p-0 print:space-y-3 font-sans text-xs">
          {/* Header Title */}
          <div className="border border-black p-2 sm:p-3 text-center space-y-1">
            <h1 className="font-black text-xs sm:text-sm tracking-wide uppercase">
              REPÚBLICA BOLIVARIANA DE VENEZUELA
            </h1>
            <h2 className="font-bold text-[11px] sm:text-xs uppercase text-slate-800">
              COMPROBANTE DE RETENCIÓN DEL IMPUESTO AL VALOR AGREGADO (IVA)
            </h2>
            {requiresSnat2026DocumentReference(voucher.date) && (
              <p className="text-[9px] sm:text-[10px] font-semibold text-slate-700">
                Emitido conforme a la Providencia Administrativa SNAT/2026/00093 (artículo 19).
              </p>
            )}
            <p className="text-[9px] sm:text-[10px] text-slate-700 italic">
              (Ley que Establece el Impuesto al Valor Agregado - Art. 11 y Providencia Administrativa SNAT/2025/000054)
            </p>
          </div>

          {/* Identification Box */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Voucher and Dates */}
            <div className="border border-black p-2.5 space-y-1">
              <div>
                <span className="font-bold">NÚMERO DE COMPROBANTE: </span>
                <span className="font-mono font-black text-sm text-purple-900 print:text-black">
                  {voucher.voucherNumber}
                </span>
              </div>
              <div>
                <span className="font-bold">FECHA DE EMISIÓN: </span>
                <span className="font-mono">{formatDate(voucher.date)}</span>
              </div>
              <div>
                <span className="font-bold">FECHA DE ENTREGA: </span>
                <span className="font-mono">{voucher.deliveryDate ? formatDate(voucher.deliveryDate) : 'Pendiente de registrar'}</span>
              </div>
              <div>
                <span className="font-bold">PERÍODO FISCAL: </span>
                <span className="font-mono">{voucher.period} (Año: {voucher.period.slice(0, 4)} Mes: {voucher.period.slice(4, 6)})</span>
              </div>
            </div>

            {/* Currency conversion memo */}
            <div className="border border-black p-2.5 space-y-1 bg-slate-50 print:bg-transparent">
              <div>
                <span className="font-bold">TASA OFICIAL BCV APLICADA: </span>
                <span className="font-mono font-bold">Bs. {voucher.bcvRate.toFixed(2)} por 1,00 USD</span>
              </div>
              <div>
                <span className="font-bold">NORMA APLICABLE: </span>
                <span>Providencia Administrativa SNAT/2025/000054, artículo 16</span>
              </div>
              <div className="text-[10px] text-slate-600">
                Original para el proveedor y duplicado para el agente de retención. Si la entrega es física, configura 2 copias en el diálogo de impresión.
              </div>
            </div>
          </div>

          {/* Agente de Retención (Nuestra Empresa) */}
          <div className="border border-black p-2.5 space-y-1">
            <div className="font-bold bg-slate-200 print:bg-slate-300 px-1 py-0.5 uppercase text-[11px]">
              1. DATOS DEL AGENTE DE RETENCIÓN
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <div className="sm:col-span-2">
                <span className="font-bold">NOMBRE O RAZÓN SOCIAL: </span>
                <span className="font-semibold">{voucher.agentNameSnapshot || 'No conservado en emisión'}</span>
              </div>
              <div>
                <span className="font-bold">NÚMERO DE RIF: </span>
                <span className="font-mono font-bold">{voucher.agentRifSnapshot || 'No conservado en emisión'}</span>
              </div>
            </div>
            <div>
              <span className="font-bold">DIRECCIÓN FISCAL: </span>
              <span>{voucher.agentAddressSnapshot || 'No conservado en emisión'}</span>
            </div>
          </div>

          {/* Sujeto Retenido (Proveedor) */}
          <div className="border border-black p-2.5 space-y-1">
            <div className="font-bold bg-slate-200 print:bg-slate-300 px-1 py-0.5 uppercase text-[11px]">
              2. DATOS DEL SUJETO RETENIDO (PROVEEDOR)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <div className="sm:col-span-2">
                <span className="font-bold">NOMBRE O RAZÓN SOCIAL: </span>
                <span className="font-semibold">{voucher.supplierName}</span>
              </div>
              <div>
                <span className="font-bold">NÚMERO DE RIF: </span>
                <span className="font-mono font-bold">{voucher.supplierRif}</span>
              </div>
            </div>
            <div>
              <span className="font-bold">DIRECCIÓN FISCAL: </span>
              <span>{voucher.supplierAddress || 'No registrada'}</span>
            </div>
            {voucher.supplierEmailSnapshot && <div><span className="font-bold">CORREO ELECTRÓNICO: </span><span>{voucher.supplierEmailSnapshot}</span></div>}
          </div>

          {/* Table of operations */}
          <div className="border border-black overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-200 print:bg-slate-300 border-b border-black font-bold text-center">
                  <th className="p-1 border-r border-black w-8">Oper.</th>
                  <th className="p-1 border-r border-black w-18">Fecha Factura</th>
                  <th className="p-1 border-r border-black w-20">N° Factura</th>
                  <th className="p-1 border-r border-black w-20">N° Control</th>
                  <th className="p-1 border-r border-black w-24 text-right">Total Factura (Bs.)</th>
                  <th className="p-1 border-r border-black w-20 text-right">Exento (Bs.)</th>
                  <th className="p-1 border-r border-black w-24 text-right">Base Imponible</th>
                  <th className="p-1 border-r border-black w-12 text-center">% Alíc.</th>
                  <th className="p-1 border-r border-black w-24 text-right">Impuesto IVA</th>
                  <th className="p-1 border-r border-black w-14 text-center">% Ret.</th>
                  <th className="p-1 text-right w-24">IVA Retenido (Bs.)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-right border-b border-black">
                  <td className="p-1.5 border-r border-black text-center font-mono">1</td>
                  <td className="p-1.5 border-r border-black text-center font-mono whitespace-nowrap">
                    {formatDate(voucher.invoiceDate)}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono font-bold">
                    {voucher.invoiceNumber}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono">
                    {voucher.controlNumber}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono font-bold">
                    {formatNumberVe(voucher.totalAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.exemptAmountBs || 0)}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.taxableBaseBs)}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono">
                    {voucher.taxRate}%
                  </td>
                  <td className="p-1.5 border-r border-black font-mono font-bold">
                    {formatNumberVe(voucher.vatAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono font-bold">
                    {voucher.retentionRate}%
                  </td>
                  <td className="p-1.5 font-mono font-black text-black">
                    {formatNumberVe(voucher.vatWithheldBs)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 print:bg-slate-200 font-bold text-right border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-center uppercase">
                    TOTALES:
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.totalAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.exemptAmountBs || 0)}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.taxableBaseBs)}
                  </td>
                  <td className="p-1.5 border-r border-black"></td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.vatAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black"></td>
                  <td className="p-1.5 font-mono font-black text-black">
                    {formatNumberVe(voucher.vatWithheldBs)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Dual currency reference note */}
          <div className="border border-black p-2 flex justify-between items-center text-[11px] bg-slate-50 print:bg-transparent">
            <div>
              <span className="font-bold">TOTAL RETENIDO EN MONEDA NACIONAL: </span>
              <span className="font-mono font-black">{formatBs(voucher.vatWithheldBs)}</span>
            </div>
            <div>
              <span className="font-bold">EQUIVALENTE REFERENCIAL: </span>
              <span className="font-mono font-bold">{formatUsdForDate(voucher.vatWithheldUsd, voucher.date)}</span>
            </div>
          </div>

          {/* Signatures & Stamps */}
          <div className="grid grid-cols-2 gap-8 pt-8">
            <div className="text-center space-y-1">
              <div className="border-t border-black w-64 mx-auto pt-1"></div>
              <p className="font-bold uppercase text-[11px]">{voucher.agentNameSnapshot || 'No conservado en emisión'}</p>
              <p className="text-[10px] text-slate-600">FIRMA Y SELLO DEL AGENTE DE RETENCIÓN</p>
            </div>
            <div className="text-center space-y-1">
              <div className="border-t border-black w-64 mx-auto pt-1"></div>
              <p className="font-bold uppercase text-[11px]">{voucher.supplierName}</p>
              <p className="text-[10px] text-slate-600">FIRMA Y SELLO DE RECEPCIÓN (PROVEEDOR)</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
