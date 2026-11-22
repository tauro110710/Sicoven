import React, { useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { BankAccount, BankMovementType } from '../../types/accounting';
import { Landmark, X, Check } from 'lucide-react';
import { formatBs, formatUsd } from '../../utils/formatters';
import { resolveBcvRateForDate } from '../../utils/resolveBcvRateForDate';

interface NewBankMovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  bankAccount: BankAccount;
}

export const NewBankMovementModal: React.FC<NewBankMovementModalProps> = ({
  isOpen,
  onClose,
  bankAccount
}) => {
  const { currentCompany, addBankStatementMovement, waitForPersistence } = useAccounting();
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [date, setDate] = useState<string>(() => {
    const s = currentCompany?.accountingStartDate;
    const today = new Date().toISOString().slice(0, 10);
    return (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && s < today) ? s : today;
  });
  const [reference, setReference] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [type, setType] = useState<BankMovementType>('CREDIT');
  const [amountBs, setAmountBs] = useState<string>('');
  const [bcvRateEffectiveDate, setBcvRateEffectiveDate] = useState<string>('');
  const [movementBcvRate, setMovementBcvRate] = useState<string>('');

  // Actualizar la fecha cuando se cambia de empresa mientras el modal permanece montado.
  React.useEffect(() => {
    const s = currentCompany?.accountingStartDate;
    const today = new Date().toISOString().slice(0, 10);
    setDate((s && /^\\d{4}-\\d{2}-\\d{2}$/.test(s) && s < today) ? s : today);
  }, [currentCompany.id, currentCompany.accountingStartDate]);

  // La tasa sugerida debe corresponder siempre a la fecha del movimiento,
  // tanto para cuentas Bs como USD (la equivalencia USD también se calcula en cuentas Bs).
  React.useEffect(() => {
    const history = currentCompany.accountingBcvRateHistory || [];
    let best;
    for (const entry of history) {
      if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(entry.effectiveDate) || entry.effectiveDate > date) continue;
      const rate = Number(entry.rate);
      if (!Number.isFinite(rate) || rate <= 0) continue;
      if (!best || entry.effectiveDate >= best.effectiveDate) best = entry;
    }
    setMovementBcvRate(best ? String(best.rate) : '');
    setBcvRateEffectiveDate(best ? best.effectiveDate : '');
  }, [date, currentCompany.id, currentCompany.accountingBcvRateHistory]);

  if (!isOpen) return null;

  const parseDecimalInput = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); };
  const bcvRate = parseDecimalInput(movementBcvRate) || 0;
  const parsedAmount = parseDecimalInput(amountBs) || 0;
  const parsedAmountBs = bankAccount.currency === 'USD'
    ? (bcvRate > 0 ? Math.round(parsedAmount * bcvRate * 100) / 100 : 0)
    : Math.round(parsedAmount * 100) / 100;
  const amountUsd = bankAccount.currency === 'USD'
    ? Math.round(parsedAmount * 1000000) / 1000000
    : (bcvRate > 0 ? Math.round((parsedAmountBs / bcvRate) * 1000000) / 1000000 : 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return;
    if (!description.trim()) return;
    if (bankAccount.currency === 'USD' && bcvRate <= 0) {
      window.alert('Configure una tasa BCV válida para convertir el movimiento USD a bolívares.');
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      addBankStatementMovement({
        bankAccountId: bankAccount.id,
        date,
        reference: reference.trim(),
        description: description.trim(),
        type,
        amountBs: parsedAmountBs,
        amountUsd,
        bcvRate,
        bcvRateEffectiveDate,
        isReconciled: false
      });
      await waitForPersistence();
      setReference('');
      setDescription('');
      setAmountBs('');
      onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo registrar el movimiento del extracto bancario.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="relative z-[1001] isolate pointer-events-auto bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Registrar Movimiento en Extracto Bancario</h3>
              <p className="text-xs text-slate-400">{bankAccount.bankName}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Fecha del Movimiento *</label>
              <input
                type="date"
                required
                value={date}
                onChange={e => {
                  const nextDate = e.target.value;
                  setDate(nextDate);
                  setMovementBcvRate('');
          setBcvRateEffectiveDate('');
                }}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tipo de Operación Bancaria *</label>
              <select
                value={type}
                onChange={e => setType(e.target.value as BankMovementType)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-bold focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="CREDIT">Crédito (+) Depósito / Cobranza</option>
                <option value="DEBIT">Débito (-) Pago / Comisión / Retiro</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Fecha de vigencia BCV *</label>
              <input type="date" required value={bcvRateEffectiveDate} max={date}
                onChange={e => setBcvRateEffectiveDate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tasa BCV (Bs/USD) *</label>
              <input type="text" inputMode="decimal" required placeholder="Ej.: 889,67" value={movementBcvRate}
                onChange={e => setMovementBcvRate(e.target.value)}
                className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Número de Referencia / Cheque / Transferencia *
            </label>
            <input
              type="text"
              required
              placeholder="Ej: 00008401, CHQ-1049, ND-89124"
              value={reference}
              onChange={e => setReference(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Concepto / Descripción del Banco *
            </label>
            <input
              type="text"
              required
              placeholder="Ej: Transferencia Interbancaria Recibida de Cliente..."
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Monto de la Operación ({bankAccount.currency === 'USD' ? 'USD' : 'Bs.'}) *</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs font-bold text-slate-400">{bankAccount.currency === 'USD' ? 'USD' : 'Bs.'}</span>
              <input
                type="text"
                inputMode="decimal"
                required
                placeholder="0.00"
                value={amountBs}
                onChange={e => setAmountBs(e.target.value)}
                className="w-full pl-10 pr-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold text-sm focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <span className="text-[11px] text-slate-500 font-mono mt-1 block">
              {bankAccount.currency === 'USD'
                ? `Equivalente en Bs.: ${formatBs(parsedAmountBs)}`
                : `Equivalente en USD: ${formatUsd(amountUsd)}`} {bcvRate > 0 ? `(Tasa BCV: Bs. ${bcvRate.toFixed(2)})` : '(Tasa BCV no configurada)'}
            </span>
          </div>

          <div className="pt-3 border-t border-slate-200 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-800 transition cursor-pointer disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || parsedAmountBs <= 0 || bcvRate <= 0 || !description.trim()}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {saving ? "Confirmando SQLite..." : "Guardar Movimiento"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
