import React, { useState } from 'react';
import { Company, IslrRetentionVoucher } from '../../types/accounting';
import { X, Printer, ShieldCheck } from 'lucide-react';
import { formatBs, formatUsd, formatDate, formatNumberVe } from '../../utils/formatters';

interface IslrVoucherModalProps {
  voucher: IslrRetentionVoucher | null;
  company: Company;
  onClose: () => void;
  onRecordDelivery: (draft: { deliveryDate: string; deliveryMethod: 'PHYSICAL' | 'ELECTRONIC'; electronicDeliveryAgreed?: boolean }) => Promise<IslrRetentionVoucher>;
}

export const IslrVoucherModal: React.FC<IslrVoucherModalProps> = ({ voucher, company, onClose, onRecordDelivery }) => {
  const localToday = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const [deliveryDate, setDeliveryDate] = useState(localToday);
  const [deliveryMethod, setDeliveryMethod] = useState<'PHYSICAL' | 'ELECTRONIC'>('PHYSICAL');
  const [electronicAgreed, setElectronicAgreed] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const [deliveryMessage, setDeliveryMessage] = useState('');
  if (!voucher) return null;
  const handleRecordDelivery = async () => {
    setDeliveryBusy(true); setDeliveryMessage('');
    try { await onRecordDelivery({ deliveryDate, deliveryMethod, ...(deliveryMethod === 'ELECTRONIC' ? { electronicDeliveryAgreed: electronicAgreed } : {}) }); setDeliveryMessage('Entrega registrada y guardada.'); }
    catch (error) { setDeliveryMessage(error instanceof Error ? error.message : 'No se pudo registrar la entrega.'); }
    finally { setDeliveryBusy(false); }
  };
  const agentName = voucher.agentNameSnapshot || company.name;
  const agentRif = voucher.agentRifSnapshot || company.rif;
  const agentAddress = voucher.agentAddressSnapshot || company.address;

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 sm:my-6 overflow-hidden border border-slate-300">
        {/* Top Control Bar (no-print) */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 bg-slate-900 text-white no-print">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-indigo-400 flex-shrink-0" />
            <span className="font-semibold text-xs sm:text-sm truncate">
              Comprobante Oficial de Retención de ISLR (Decreto 1808)
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white transition cursor-pointer shadow"
            >
              <Printer className="w-3.5 h-3.5" />
              <span className="hidden xs:inline">Imprimir</span>
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {!voucher.deliveryDate ? (
          <div className="no-print border-b border-slate-200 bg-slate-50 px-4 sm:px-6 py-4 space-y-3">
            <div><h3 className="text-xs font-bold text-slate-900">Registrar entrega al proveedor</h3><p className="mt-1 text-[11px] text-slate-600">Registre la fecha efectiva y el medio de entrega. La entrega electrónica requiere acuerdo previo del proveedor. No se modifica el contenido histórico del comprobante al registrar esta constancia.</p></div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs font-semibold text-slate-700">Fecha efectiva de entrega<input type="date" min={voucher.date} value={deliveryDate} onChange={event => setDeliveryDate(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" /></label>
              <label className="text-xs font-semibold text-slate-700">Medio de entrega<select value={deliveryMethod} onChange={event => setDeliveryMethod(event.target.value as 'PHYSICAL' | 'ELECTRONIC')} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2"><option value="PHYSICAL">Físico</option><option value="ELECTRONIC">Electrónico</option></select></label>
              {deliveryMethod === 'ELECTRONIC' && <label className="flex items-center gap-2 text-xs text-slate-700 sm:pt-6"><input type="checkbox" checked={electronicAgreed} onChange={event => setElectronicAgreed(event.target.checked)} /> Existe acuerdo con el proveedor</label>}
            </div>
            <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={deliveryBusy || !deliveryDate || (deliveryMethod === 'ELECTRONIC' && !electronicAgreed)} onClick={() => void handleRecordDelivery()} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{deliveryBusy ? 'Guardando…' : 'Registrar entrega'}</button>{deliveryMessage && <p role="status" className="text-xs text-slate-700">{deliveryMessage}</p>}</div>
          </div>
        ) : <div className="no-print border-b border-emerald-200 bg-emerald-50 px-4 sm:px-6 py-3 text-xs text-emerald-900">Entregado el {formatDate(voucher.deliveryDate)} por medio {voucher.deliveryMethod === 'ELECTRONIC' ? 'electrónico (acuerdo confirmado)' : 'físico'}.</div>}

        {/* Printable Official Voucher Document */}
        <div className="p-3 sm:p-8 text-black bg-white space-y-3 sm:space-y-4 print:p-0 print:space-y-3 font-sans text-xs">
          {/* Header Title */}
          <div className="border border-black p-2 sm:p-3 text-center space-y-1">
            <h1 className="font-black text-xs sm:text-sm tracking-wide uppercase">
              REPÚBLICA BOLIVARIANA DE VENEZUELA
            </h1>
            <h2 className="font-bold text-[11px] sm:text-xs uppercase text-slate-800">
              COMPROBANTE DE RETENCIÓN DE IMPUESTO SOBRE LA RENTA (ISLR)
            </h2>
            <p className="text-[9px] sm:text-[10px] text-slate-700 italic">
              (Decreto Presidencial N° 1.808 – Reglamento Parcial de la Ley de ISLR en Materia de Retenciones)
            </p>
          </div>

          {/* Identification Box */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="border border-black p-2.5 space-y-1">
              <div>
                <span className="font-bold">NÚMERO DE COMPROBANTE: </span>
                <span className="font-mono font-black text-sm text-indigo-900 print:text-black">
                  {voucher.voucherNumber}
                </span>
              </div>
              <div>
                <span className="font-bold">FECHA DE EMISIÓN: </span>
                <span className="font-mono">{formatDate(voucher.date)}</span>
              </div>
              <div>
                <span className="font-bold">PERÍODO FISCAL: </span>
                <span className="font-mono">{voucher.period} (Año: {voucher.period.slice(0, 4)} Mes: {voucher.period.slice(4, 6)})</span>
              </div>
            </div>

            <div className="border border-black p-2.5 space-y-1 bg-slate-50 print:bg-transparent">
              <div>
                <span className="font-bold">CALIFICACIÓN FISCAL DEL AGENTE: </span>
                <span className="font-semibold uppercase">
                  {company.taxpayerType === 'ESPECIAL' ? 'Contribuyente Especial' : 'Contribuyente Ordinario'}
                </span>
              </div>
              <div>
                <span className="font-bold">TASA OFICIAL BCV: </span>
                <span className="font-mono font-bold">Bs. {voucher.bcvRate.toFixed(2)} por 1,00 USD</span>
              </div>
              <div className="text-[10px] text-slate-600">
                Válido como comprobante de crédito fiscal definitivo para la Declaración Anual de ISLR
              </div>
            </div>
          </div>

          {/* Agente de Retención */}
          <div className="border border-black p-2.5 space-y-1">
            <div className="font-bold bg-slate-200 print:bg-slate-300 px-1 py-0.5 uppercase text-[11px]">
              1. DATOS DEL AGENTE DE RETENCIÓN
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
              <div className="sm:col-span-2">
                <span className="font-bold">NOMBRE O RAZÓN SOCIAL: </span>
                <span className="font-semibold">{agentName}</span>
              </div>
              <div>
                <span className="font-bold">NÚMERO DE RIF: </span>
                <span className="font-mono font-bold">{agentRif}</span>
              </div>
            </div>
            <div>
              <span className="font-bold">DIRECCIÓN FISCAL: </span>
              <span>{agentAddress}</span>
            </div>
          </div>

          {/* Sujeto Retenido */}
          <div className="border border-black p-2.5 space-y-1">
            <div className="font-bold bg-slate-200 print:bg-slate-300 px-1 py-0.5 uppercase text-[11px]">
              2. DATOS DEL BENEFICIARIO / SUJETO RETENIDO
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <span className="font-bold">TIPO DE PERSONA: </span>
                <span>{voucher.isPersonNatural ? 'Persona Natural' : 'Persona Jurídica'}</span>
              </div>
              <div>
                <span className="font-bold">CONDICIÓN: </span>
                <span>{voucher.isResident ? 'Residente / Domiciliado en el país' : 'No Residente'}</span>
              </div>
            </div>
            <div>
              <span className="font-bold">DIRECCIÓN FISCAL: </span>
              <span>{voucher.supplierAddress || 'Venezuela'}</span>
            </div>
            {voucher.supplierEmailSnapshot && <div><span className="font-bold">CORREO ELECTRÓNICO: </span><span>{voucher.supplierEmailSnapshot}</span></div>}
          </div>

          {/* Table of ISLR Operations */}
          <div className="border border-black overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-[10px]">
              <thead>
                <tr className="bg-slate-200 print:bg-slate-300 border-b border-black font-bold text-center">
                  <th className="p-1 border-r border-black w-20">Fecha Doc.</th>
                  <th className="p-1 border-r border-black w-20">N° Factura</th>
                  <th className="p-1 border-r border-black w-20">N° Control</th>
                  <th className="p-1 border-r border-black text-left">Concepto de Retención (Decreto 1808)</th>
                  <th className="p-1 border-r border-black w-24 text-right">Monto Operación (Bs.)</th>
                  <th className="p-1 border-r border-black w-12 text-center">% Tarifa</th>
                  <th className="p-1 border-r border-black w-20 text-right">Sustraendo (Bs.)</th>
                  <th className="p-1 text-right w-24">ISLR Retenido (Bs.)</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-right border-b border-black">
                  <td className="p-1.5 border-r border-black text-center font-mono whitespace-nowrap">
                    {formatDate(voucher.invoiceDate)}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono font-bold">
                    {voucher.invoiceNumber}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono">
                    {voucher.controlNumber}
                  </td>
                  <td className="p-1.5 border-r border-black text-left">
                    <span className="font-mono font-bold mr-1">Cod. {voucher.conceptCode}:</span>
                    {voucher.conceptDescription}
                  </td>
                  <td className="p-1.5 border-r border-black font-mono font-bold">
                    {formatNumberVe(voucher.baseAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black text-center font-mono font-bold">
                    {voucher.retentionRate}%
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.subtrahendBs || 0)}
                  </td>
                  <td className="p-1.5 font-mono font-black text-black">
                    {formatNumberVe(voucher.withheldAmountBs)}
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 print:bg-slate-200 font-bold text-right border-t border-black">
                  <td colSpan={4} className="p-1.5 border-r border-black text-center uppercase">
                    TOTAL RETENCIÓN DE ISLR:
                  </td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.baseAmountBs)}
                  </td>
                  <td className="p-1.5 border-r border-black"></td>
                  <td className="p-1.5 border-r border-black font-mono">
                    {formatNumberVe(voucher.subtrahendBs || 0)}
                  </td>
                  <td className="p-1.5 font-mono font-black text-black">
                    {formatNumberVe(voucher.withheldAmountBs)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Dual currency reference note */}
          <div className="border border-black p-2 flex justify-between items-center text-[11px] bg-slate-50 print:bg-transparent">
            <div>
              <span className="font-bold">MONTO TOTAL RETENIDO DE ISLR: </span>
              <span className="font-mono font-black">{formatBs(voucher.withheldAmountBs)}</span>
            </div>
            <div>
              <span className="font-bold">EQUIVALENTE A TASA BCV: </span>
              <span className="font-mono font-bold">{formatUsd(voucher.withheldAmountUsd)}</span>
            </div>
          </div>

          {/* Signatures & Stamps */}
          <div className="grid grid-cols-2 gap-8 pt-8">
            <div className="text-center space-y-1">
              <div className="border-t border-black w-64 mx-auto pt-1"></div>
              <p className="font-bold uppercase text-[11px]">{company.name}</p>
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
