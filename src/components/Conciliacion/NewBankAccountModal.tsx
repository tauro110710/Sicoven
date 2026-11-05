import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAccounting } from '../../context/AccountingContext';
import { Landmark, X, Check } from 'lucide-react';

interface NewBankAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewBankAccountModal: React.FC<NewBankAccountModalProps> = ({ isOpen, onClose }) => {
  const { addBankAccount, waitForPersistence } = useAccounting();
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [bankName, setBankName] = useState('');
  const [accountType, setAccountType] = useState<'CORRIENTE' | 'AHORRO'>('CORRIENTE');
  const [checkbookNumber, setCheckbookNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [currency, setCurrency] = useState<'BS' | 'USD'>('BS');
  const [initialBalanceBs, setInitialBalanceBs] = useState<string>('');
  const [bcvRateInput, setBcvRateInput] = useState<string>('');

  if (!isOpen) return null;

  const normalizedAccountNumber = accountNumber.replace(/\D/g, '');
  const parseAmount = (value: string) => { const raw = value.trim(); return Number(raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw); };
  const parsedOpeningBalance = parseAmount(initialBalanceBs) || 0;
  const bcvRate = parseAmount(bcvRateInput) || 0;
  const openingBalanceBs = currency === 'USD' ? parsedOpeningBalance * bcvRate : parsedOpeningBalance;
  const openingBalanceUsd = currency === 'USD' ? parsedOpeningBalance : (bcvRate > 0 ? parsedOpeningBalance / bcvRate : 0);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim()) return;
    if (normalizedAccountNumber.length !== 20) {
      window.alert('El número de cuenta debe contener exactamente 20 dígitos.');
      return;
    }
    if (parsedOpeningBalance < 0 || !Number.isFinite(parsedOpeningBalance)) {
      window.alert('El saldo inicial debe ser cero o positivo.');
      return;
    }
    if (parsedOpeningBalance > 0 && bcvRate <= 0) {
      window.alert('Configure una tasa BCV válida antes de registrar el saldo inicial.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      addBankAccount({
        bankName: bankName.trim(),
        accountNumber: normalizedAccountNumber,
        currency,
        bcvRate,
        initialBalanceBs: Math.round(openingBalanceBs * 100) / 100,
        initialBalanceUsd: Math.round(openingBalanceUsd * 1000000) / 1000000,
        accountType,
        checkbookNumber: checkbookNumber.trim() || undefined
      });
      await waitForPersistence();
      // Dejar el formulario limpio para la próxima alta, sin datos residuales.
      setBankName('');
      setAccountType('CORRIENTE');
      setCheckbookNumber('');
      setAccountNumber('');
      setCurrency('BS');
      setInitialBalanceBs('');
      setBcvRateInput('');
      onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo registrar la cuenta bancaria.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return createPortal((
    <div className="fixed inset-0 z-[2147483000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 pointer-events-auto select-text" style={{ pointerEvents: 'auto', WebkitAppRegion: 'no-drag' } as any} onMouseDown={e => e.stopPropagation()}>
      <div className="relative z-[2147483000] pointer-events-auto bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-150" style={{ pointerEvents: 'auto', WebkitAppRegion: 'no-drag' } as any} onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Landmark className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Registrar Cuenta Bancaria</h3>
              <p className="text-xs text-slate-400">Alta de cuenta y auxiliar contable automático</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={saving}
            className="p-1 rounded-lg text-slate-400 hover:text-white transition cursor-pointer disabled:opacity-40"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nombre de la Institución Bancaria *</label>
            <input
              type="text"
              required
              autoFocus
              autoComplete="organization"
              placeholder="Ej: Banco Provincial BBVA, Banco de Venezuela..."
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              className="pointer-events-auto select-text w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tipo de cuenta *</label>
              <select value={accountType} onChange={e => setAccountType(e.target.value as 'CORRIENTE' | 'AHORRO')} className="w-full px-3 py-1.5 border border-slate-300 rounded-lg">
                <option value="CORRIENTE">Corriente</option>
                <option value="AHORRO">Ahorro</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Chequera (opcional)</label>
              <input value={checkbookNumber} onChange={e => setCheckbookNumber(e.target.value)} placeholder="N.º / serie" className="w-full px-3 py-1.5 border border-slate-300 rounded-lg" />
            </div>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Número de Cuenta Bancaria (20 dígitos) *
            </label>
            <input
              type="text"
              placeholder="20 dígitos numéricos"
              inputMode="numeric"
              maxLength={24}
              required
              value={accountNumber}
              onChange={e => setAccountNumber(e.target.value.replace(/[^0-9-\s]/g, '').slice(0, 24))}
              className="pointer-events-auto select-text w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Moneda</label>
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value as 'BS' | 'USD')}
                className="pointer-events-auto select-text w-full px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              >
                <option value="BS">Bolívares (Bs.)</option>
                <option value="USD">Dólares ($ USD)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Saldo Inicial en {currency === 'USD' ? '$ USD' : 'Bs.'}</label>
              <input
                type="text"
                inputMode="decimal"
                value={initialBalanceBs}
                placeholder="0.00"
                onChange={e => setInitialBalanceBs(e.target.value)}
                className="pointer-events-auto select-text w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono focus:ring-1 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>

          {parsedOpeningBalance > 0 && <div>
            <label className="block font-semibold text-slate-700 mb-1">Tasa BCV aplicable al saldo inicial (Bs./USD) {currency === 'USD' ? '*' : '(opcional)'}</label>
            <input type="text" inputMode="decimal" value={bcvRateInput} onChange={e => setBcvRateInput(e.target.value)} placeholder="Ej.: 889,67" required className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono" />
          </div>}

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
              disabled={saving || !bankName.trim() || normalizedAccountNumber.length !== 20 || (parsedOpeningBalance > 0 && bcvRate <= 0)}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {saving ? "Confirmando SQLite..." : "Guardar y Crear Auxiliar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  ), document.body);
};
