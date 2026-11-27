import React, { useEffect, useMemo } from 'react';
import type { Account, BankAccount } from '../../types/accounting';
import {
  PAYMENT_METHODS,
  getPaymentMethod,
  isIgtfEligiblePaymentMethod,
  listPaymentCounterpartAccounts,
  paymentMethodRequiresReference,
  suggestPaymentAccountCode,
  type PaymentMethodCode
} from '../../types/paymentMethods';

export interface PaymentSelectionValue {
  method: PaymentMethodCode;
  /** Cuenta de Caja/Banco que recibe (venta) o entrega (compra) el dinero. */
  accountCode: string;
  reference: string;
}

interface PaymentMethodFieldProps {
  kind: 'SALE' | 'PURCHASE';
  value: PaymentSelectionValue;
  onChange: (next: PaymentSelectionValue) => void;
  accounts: Account[];
  bankAccounts: BankAccount[];
  companyId: string;
  /** Importe neto que se mueve por tesorería (después de retenciones). */
  amountBs: number;
  disabled?: boolean;
  invalid?: boolean;
  /** Compras: el soporte del desembolso es obligatorio incluso en efectivo. */
  alwaysRequireReference?: boolean;
}

const formatBs = (value: number) => Number(value || 0).toLocaleString('es-VE', {
  minimumFractionDigits: 2, maximumFractionDigits: 2
});

/**
 * Selector compartido de medio de pago/cobro y su contrapartida contable.
 * Evita que ventas y compras mantengan listas de medios divergentes.
 */
export default function PaymentMethodField({
  kind, value, onChange, accounts, bankAccounts, companyId, amountBs, disabled, invalid,
  alwaysRequireReference
}: PaymentMethodFieldProps) {
  const isSale = kind === 'SALE';
  const counterparts = useMemo(
    () => listPaymentCounterpartAccounts(accounts, bankAccounts, companyId),
    [accounts, bankAccounts, companyId]
  );
  const method = getPaymentMethod(value.method);
  const selectedAccount = counterparts.find(account => account.code === value.accountCode);

  // Sugiere la contrapartida coherente con el medio y la reemplaza si la
  // cuenta elegida deja de ser válida (por ejemplo, una cuenta desactivada).
  useEffect(() => {
    if (disabled) return;
    if (value.accountCode && selectedAccount) return;
    const suggested = suggestPaymentAccountCode(value.method, counterparts);
    if (suggested && suggested !== value.accountCode) {
      onChange({ ...value, accountCode: suggested });
    }
  }, [disabled, value.method, value.accountCode, selectedAccount, counterparts]);

  if (disabled) {
    return (
      <p className="rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-600">
        Operación a crédito: la contrapartida es la {isSale ? 'cuenta por cobrar del cliente (1.1.2.01)' : 'cuenta por pagar del proveedor'};
        el medio y la cuenta de tesorería se usan al registrar el {isSale ? 'cobro' : 'pago'}.
      </p>
    );
  }

  const handleMethodChange = (code: string) => {
    const nextMethod = code as PaymentMethodCode;
    onChange({
      ...value,
      method: nextMethod,
      accountCode: suggestPaymentAccountCode(nextMethod, counterparts)
    });
  };

  const referenceHint = method?.family === 'TARJETA'
    ? 'N.º de voucher, lote o aprobación del terminal'
    : method?.family === 'DIGITAL'
      ? 'N.º de confirmación u operación del proveedor'
      : 'N.º de transferencia, cheque o soporte del movimiento';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            {isSale ? 'Medio de cobro' : 'Medio de pago'} *
          </label>
          <select
            required
            value={value.method}
            onChange={event => handleMethodChange(event.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:ring-1 focus:ring-sky-500 focus:outline-none"
          >
            <optgroup label="Moneda nacional (Bs.)">
              {PAYMENT_METHODS.filter(item => item.currency === 'BS').map(item => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </optgroup>
            <optgroup label="Moneda extranjera (USD)">
              {PAYMENT_METHODS.filter(item => item.currency === 'USD').map(item => (
                <option key={item.code} value={item.code}>{item.label}</option>
              ))}
            </optgroup>
          </select>
          {method && <p className="mt-1 text-[11px] text-slate-500">{method.hint}</p>}
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">
            Cuenta contable de contrapartida (Caja / Banco) *
          </label>
          <select
            required
            value={value.accountCode}
            onChange={event => onChange({ ...value, accountCode: event.target.value })}
            aria-invalid={invalid}
            className={`w-full px-3 py-2 rounded-lg bg-white focus:ring-1 focus:outline-none ${invalid ? 'border border-rose-400 bg-rose-50' : 'border border-slate-300 focus:ring-sky-500'}`}
          >
            <option value="">Selecciona Caja o Banco…</option>
            {counterparts.map(account => (
              <option key={account.code} value={account.code}>{account.code} · {account.name}</option>
            ))}
          </select>
          {counterparts.length === 0 && (
            <p className="mt-1 text-[11px] text-rose-700">
              No hay cuentas de Caja/Banco de movimiento disponibles en el Plan de Cuentas.
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="block font-semibold text-slate-700 mb-1">
          Referencia o comprobante {alwaysRequireReference || paymentMethodRequiresReference(value.method) ? '*' : '(opcional)'}
        </label>
        <input
          value={value.reference}
          onChange={event => onChange({ ...value, reference: event.target.value })}
          maxLength={200}
          aria-invalid={invalid}
          placeholder={referenceHint}
          className={`w-full px-3 py-2 rounded-lg bg-white focus:ring-1 focus:outline-none ${invalid ? 'border border-rose-400 bg-rose-50' : 'border border-slate-300 focus:ring-sky-500'}`}
        />
        <p className="mt-1 text-[11px] text-slate-500">
          Se conserva en la factura y en la descripción del asiento para auditoría.
        </p>
      </div>

      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-900">
        {selectedAccount ? (
          <>
            La cuenta <strong>{selectedAccount.code} · {selectedAccount.name}</strong> se {isSale ? 'debitará' : 'acreditará'} por
            <strong> Bs. {formatBs(amountBs)}</strong>, neto después de las retenciones aplicables.
          </>
        ) : (
          'Selecciona la cuenta de Caja o Banco que movió el dinero para conocer el efecto contable.'
        )}
      </div>

      {isIgtfEligiblePaymentMethod(value.method) && (
        <p className="text-[11px] text-amber-900">
          {isSale
            ? 'Medio en divisas: en ventas, la percepción del 3% solo se calcula para cobros de contado en efectivo en divisas o criptoactivos, siempre que la empresa sea agente de percepción en la fecha.'
            : 'Medio en moneda extranjera: el IGTF solo se aplica si la empresa es agente de percepción en la fecha, la operación es de contado y el contador confirma la sujeción fiscal.'}
        </p>
      )}
    </div>
  );
}
