import React, { useState } from 'react';
import { useAccounting } from '../context/AccountingContext';
import { Building2, X, ShieldAlert, Check, AlertCircle } from 'lucide-react';
import { AccountingFramework, TaxpayerType, IvaRetentionAgentBasis } from '../types/accounting';
import { validateVenezuelanRif } from '../utils/formatters';
import { isValidAccountingStartDate } from '../types/historicalAccountingCalendar';

interface CompanyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CompanyModal: React.FC<CompanyModalProps> = ({ isOpen, onClose }) => {
  const { addCompany, waitForPersistence } = useAccounting();
  const savingRef = React.useRef(false);
  const [saving, setSaving] = useState(false);

  const [rif, setRif] = useState('');
  const [rifError, setRifError] = useState<string | null>(null);
  const [rifTouched, setRifTouched] = useState(false);
  const [name, setName] = useState('');
  const [tradeName, setTradeName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [taxpayerType, setTaxpayerType] = useState<TaxpayerType>('ORDINARIO');
  const [specialTaxpayerNotificationReference, setSpecialTaxpayerNotificationReference] = useState('');
  const [specialTaxpayerNotificationDate, setSpecialTaxpayerNotificationDate] = useState('');
  const [defaultIvaRetentionRate, setDefaultIvaRetentionRate] = useState<number>(75);
  const [ivaRetentionAgentBasis, setIvaRetentionAgentBasis] = useState<IvaRetentionAgentBasis>('UNCONFIRMED');
  const [isPersonalFirm, setIsPersonalFirm] = useState(false);
  const [isIgtfPerceptionAgent, setIsIgtfPerceptionAgent] = useState(false);
  const [accountingStartDate, setAccountingStartDate] = useState('');
  const [operationalStartDate, setOperationalStartDate] = useState('');
  const [fiscalYear, setFiscalYear] = useState<string>(String(new Date().getFullYear()));
  const [accountingFramework, setAccountingFramework] = useState<AccountingFramework | ''>('');
  const [accountingFrameworkVersion, setAccountingFrameworkVersion] = useState('');
  const [accountingFrameworkAdoptionDate, setAccountingFrameworkAdoptionDate] = useState('');

  if (!isOpen) return null;

  const handleRifChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.toUpperCase();
    setRif(val);
    setIsPersonalFirm(false);
    if (rifTouched) {
      const res = validateVenezuelanRif(val);
      setRifError(res.error);
    }
  };

  const handleRifBlur = () => {
    setRifTouched(true);
    const res = validateVenezuelanRif(rif);
    setRifError(res.error);
    if (res.isValid) {
      setRif(res.formattedRif);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const rifValidation = validateVenezuelanRif(rif);
    if (!rifValidation.isValid) {
      setRifTouched(true);
      setRifError(rifValidation.error);
      return;
    }
    if (!name.trim()) return;
    const parsedAccountingStartDate = new Date(accountingStartDate + 'T00:00:00.000Z');
    if (!isValidAccountingStartDate(accountingStartDate) ||
        !Number.isFinite(parsedAccountingStartDate.getTime()) ||
        parsedAccountingStartDate.toISOString().slice(0, 10) !== accountingStartDate) {
      window.alert('Indique una fecha válida desde la que esta empresa comenzará su registro contable ordinario en SICOVEN.');
      return;
    }
    if (operationalStartDate) {
      const parsedOperationalStartDate = new Date(operationalStartDate + 'T00:00:00.000Z');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(operationalStartDate) ||
          !Number.isFinite(parsedOperationalStartDate.getTime()) ||
          parsedOperationalStartDate.toISOString().slice(0, 10) !== operationalStartDate) {
        window.alert('La fecha real de inicio de operaciones debe ser una fecha válida.');
        return;
      }
    }
    if (taxpayerType === 'ESPECIAL' && (!specialTaxpayerNotificationReference.trim() || !specialTaxpayerNotificationDate)) {
      window.alert('Para registrar una empresa como Contribuyente Especial, indique la referencia y fecha de la notificación expresa del SENIAT.');
      return;
    }
    const hasFrameworkMetadata = Boolean(accountingFramework || accountingFrameworkVersion.trim() || accountingFrameworkAdoptionDate);
    if (hasFrameworkMetadata && (!accountingFramework || !accountingFrameworkVersion.trim() || !accountingFrameworkAdoptionDate)) {
      window.alert('Para registrar la adopción VEN-NIF debe completar marco, versión normativa y fecha documentada.');
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
    await addCompany({
      rif: rifValidation.formattedRif,
      name: name.trim().toUpperCase(),
      tradeName: tradeName.trim() || undefined,
      address: address.trim() || 'Venezuela',
      phone: phone.trim() || '(0212) 000-0000',
      email: email.trim() || 'contacto@empresa.com.ve',
      taxpayerType,
      accountingStartDate,
      ...(operationalStartDate ? { operationalStartDate } : {}),
      ...(taxpayerType === 'ESPECIAL' ? { specialTaxpayerNotificationReference: specialTaxpayerNotificationReference.trim(), specialTaxpayerNotificationDate } : {}),
      ...(accountingFramework ? {
        accountingFramework,
        accountingFrameworkVersion: accountingFrameworkVersion.trim(),
        accountingFrameworkAdoptionDate
      } : {}),
      defaultIvaRetentionRate: taxpayerType === 'ESPECIAL' ? defaultIvaRetentionRate : 0,
      ivaRetentionAgentBasis,
      isPersonalFirm,
      isIgtfPerceptionAgent,
      fiscalYear: Number(fiscalYear) || new Date().getFullYear(),
      bcvRate: 0,
    });
    if (window.sicovenStore) {
      // The main process created and selected a separate SQLite tenant.
      // Reload before any stale in-memory company data can be persisted there.
      window.location.reload();
      return;
    }
    await waitForPersistence();
    onClose();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo confirmar el registro de la empresa en SQLite.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="relative z-[1001] isolate pointer-events-auto company-registration-modal bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 bg-slate-900 text-white">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base">Registrar Nueva Empresa</h3>
              <p className="text-xs text-slate-400">Crear entidad contable independiente (SENIAT / VEN-NIF)</p>
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto company-registration-form pointer-events-auto">
          {/* RIF & Razón Social */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  RIF Oficial *
                </label>
                <span className="text-[10px] text-slate-400 font-mono" title="Prefijos legales SENIAT: V, J, G, E, P">
                  [V,J,G,E,P]
                </span>
              </div>
              <div className="relative">
                <input
                  type="text"
                  required
                  placeholder="J-12345678-9"
                  value={rif}
                  onChange={handleRifChange}
                  onBlur={handleRifBlur}
                  maxLength={14}
                  className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none uppercase font-mono transition ${
                    rifTouched && rifError
                      ? 'border-rose-400 bg-rose-50/40 text-rose-900 focus:ring-2 focus:ring-rose-500/20'
                      : rifTouched && !rifError && rif
                      ? 'border-emerald-500 bg-emerald-50/30 text-slate-900 focus:ring-2 focus:ring-emerald-500/20'
                      : 'border-slate-300 focus:ring-2 focus:ring-emerald-500'
                  }`}
                  aria-invalid={!!(rifTouched && rifError)}
                  aria-describedby={rifTouched && rifError ? 'company-rif-error' : undefined}
                />
                {rifTouched && !rifError && rif && (
                  <span
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-full bg-emerald-100 text-emerald-600"
                    title="Estructura SENIAT válida"
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </span>
                )}
              </div>
              {rifTouched && rifError ? (
                <p id="company-rif-error" className="mt-1 text-[11px] text-rose-600 flex items-start gap-1 leading-tight" role="alert">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{rifError}</span>
                </p>
              ) : (
                <p className="mt-1 text-[10px] text-slate-400">
                  Estructura SENIAT: V, J, G, E, P (ej. J-12345678-9)
                </p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Razón Social *
              </label>
              <input
                type="text"
                required
                placeholder="EJEMPLO COMERCIAL, C.A."
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none uppercase"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Nombre Comercial (Opcional)
            </label>
            <input
              type="text"
              placeholder="Nombre de fantasía o marca"
              value={tradeName}
              onChange={e => setTradeName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 space-y-2">
            <label className="block text-xs font-bold text-slate-800">Marco contable VEN-NIF adoptado (si está documentado)</label>
            <select value={accountingFramework} onChange={e => setAccountingFramework(e.target.value as AccountingFramework | '')} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white">
              <option value="">Seleccione el marco aplicable</option>
              <option value="VEN_NIF_GE">VEN-NIF GE — Grandes Entidades</option>
              <option value="VEN_NIF_PYME">VEN-NIF PYME — Pequeñas y Medianas Entidades</option>
            </select>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Versión / referencia normativa</label>
                <input value={accountingFrameworkVersion} onChange={e => setAccountingFrameworkVersion(e.target.value)} placeholder="Ej. BA VEN-NIF 8, versión aplicable" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Fecha documentada de adopción</label>
                <input type="date" value={accountingFrameworkAdoptionDate} onChange={e => setAccountingFrameworkAdoptionDate(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
              </div>
            </div>
            <p className="text-[10px] text-slate-600">Registre la referencia y fecha respaldadas por la evaluación del contador. SICOVEN no presume la clasificación ni asigna automáticamente una versión.</p>
          </div>

          {/* Calificación SENIAT */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wide">
              Calificación Tributaria SENIAT
            </label>
            <p className="text-[11px] text-slate-600">Marque Contribuyente Especial únicamente si existe notificación expresa del SENIAT. La categoría no se presume por ingresos ni por el RIF.</p>
            <div className="grid grid-cols-2 gap-3">
              <label
                className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition ${
                  taxpayerType === 'ESPECIAL'
                    ? 'border-purple-500 bg-purple-50/50 text-purple-900 font-semibold'
                    : 'border-slate-200 hover:bg-white text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="taxpayerType"
                  value="ESPECIAL"
                  checked={taxpayerType === 'ESPECIAL'}
                  onChange={() => {
                    setTaxpayerType('ESPECIAL');
                    setDefaultIvaRetentionRate(75);
                  }}
                  className="mt-0.5 text-purple-600 focus:ring-purple-500"
                />
                <div>
                  <span className="block font-bold">Contribuyente Especial (con notificación SENIAT)</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    Agente de Retención designado por el SENIAT (75% / 100% IVA e ISLR).
                  </span>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition ${
                  taxpayerType === 'ORDINARIO'
                    ? 'border-sky-500 bg-sky-50/50 text-sky-900 font-semibold'
                    : 'border-slate-200 hover:bg-white text-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="taxpayerType"
                  value="ORDINARIO"
                  checked={taxpayerType === 'ORDINARIO'}
                  onChange={() => {
                    setTaxpayerType('ORDINARIO');
                    setDefaultIvaRetentionRate(0);
                    setIsPersonalFirm(false);
                    if (ivaRetentionAgentBasis === 'ARTICLE_1_SPECIAL_DESIGNATED' || ivaRetentionAgentBasis === 'ARTICLE_1_AND_2') setIvaRetentionAgentBasis('UNCONFIRMED');
                  }}
                  className="mt-0.5 text-sky-600 focus:ring-sky-500"
                />
                <div>
                  <span className="block font-bold">Contribuyente Ordinario</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    No designado como agente de retención de IVA.
                  </span>
                </div>
              </label>
            </div>

            {taxpayerType === 'ESPECIAL' && (
              <div className="rounded-lg border border-purple-200 bg-white p-3 space-y-2">
                <label className="block text-xs font-semibold text-slate-800">Notificación expresa del SENIAT *</label>
                <input required value={specialTaxpayerNotificationReference} onChange={e => setSpecialTaxpayerNotificationReference(e.target.value)} placeholder="Número o referencia de la notificación" className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
                <input required type="date" value={specialTaxpayerNotificationDate} onChange={e => setSpecialTaxpayerNotificationDate(e.target.value)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg" />
                <p className="text-[10px] text-slate-600">La calificación se registra únicamente con respaldo documental; los umbrales económicos no sustituyen la notificación.</p>
              </div>
            )}

            {taxpayerType === 'ESPECIAL' && (
              <div className="pt-2 flex items-center justify-between text-xs">
                <span className="font-medium text-slate-700">Porcentaje de Retención IVA por Defecto:</span>
                <select
                  value={defaultIvaRetentionRate}
                  onChange={e => setDefaultIvaRetentionRate(Number(e.target.value))}
                  className="px-2.5 py-1 border border-slate-300 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value={75}>75% (General)</option>
                  <option value={100}>100% (No inscritos o casos especiales)</option>
                </select>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-purple-200 bg-purple-50 p-3 space-y-2">
            <label className="block text-xs font-bold text-slate-800">Condición como agente de retención de IVA (Providencia 000054)</label>
            <select value={ivaRetentionAgentBasis} onChange={e => setIvaRetentionAgentBasis(e.target.value as IvaRetentionAgentBasis)} className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg bg-white">
              <option value="UNCONFIRMED">Pendiente de confirmar</option>
              <option value="ARTICLE_1_SPECIAL_DESIGNATED" disabled={taxpayerType !== 'ESPECIAL'}>Artículo 1 — Sujeto especial calificado y notificado</option>
              <option value="ARTICLE_2_METALS">Artículo 2 — Comprador habitual de metales o piedras preciosas</option>
              <option value="ARTICLE_1_AND_2" disabled={taxpayerType !== 'ESPECIAL'}>Artículos 1 y 2 — Sujeto especial y comprador habitual de metales o piedras preciosas</option>
              <option value="NOT_AGENT">No es agente de retención bajo esta Providencia</option>
            </select>
            <p className="text-[11px] text-slate-600">No se presume la designación por seleccionar “Contribuyente Especial”. Si queda pendiente, SICOVEN no calculará retenciones automáticamente.</p>
            {['ARTICLE_1_SPECIAL_DESIGNATED', 'ARTICLE_1_AND_2'].includes(ivaRetentionAgentBasis) && /^[VEP]/.test(rif.replace(/[^A-Z0-9]/gi, '')) && (
              <label className="flex items-start gap-2 text-xs text-slate-800">
                <input type="checkbox" checked={isPersonalFirm} onChange={e => setIsPersonalFirm(e.target.checked)} className="mt-0.5" />
                <span><strong>La persona natural está constituida como firma personal</strong><span className="block text-[11px] text-slate-600 mt-1">La Providencia incluye a personas naturales especiales únicamente cuando actúan como firma personal.</span></span>
              </label>
            )}
          </div>
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
            <label className="flex items-start gap-2 text-xs text-slate-800 cursor-pointer">
              <input type="checkbox" checked={isIgtfPerceptionAgent} onChange={e => setIsIgtfPerceptionAgent(e.target.checked)} className="mt-0.5" />
              <span><strong>Empresa designada agente de percepción del IGTF</strong><span className="block text-[11px] text-slate-600 mt-1">Actívelo únicamente si la designación aplica legalmente a esta empresa.</span></span>
            </label>
          </div>

          {/* Domicilio Fiscal y Contacto */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Dirección Fiscal
            </label>
            <textarea
              rows={2}
              placeholder="Av., Edificio, Piso, Oficina, Ciudad, Estado"
              value={address}
              onChange={e => setAddress(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Teléfono de Contacto
              </label>
              <input
                type="text"
                placeholder="(0212) 123-4567"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Correo Electrónico
              </label>
              <input
                type="email"
                placeholder="contabilidad@empresa.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
            </div>
          </div>
          {/* Inicio del registro contable ordinario en SICOVEN */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 space-y-1.5">
            <label className="block text-xs font-bold text-slate-800">
              Fecha de inicio contable en SICOVEN *
            </label>
            <input
              type="date"
              required
              min="2012-01-01"
              value={accountingStartDate}
              onChange={e => { const value = e.target.value; setAccountingStartDate(value); if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) setFiscalYear(value.slice(0, 4)); }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
            <p className="text-[10px] leading-4 text-slate-600">Desde esta fecha se registrarán las operaciones contables ordinarias. Puede iniciar desde el 01/01/2012. SICOVEN guarda por separado la fecha administrativa de registro.</p>
          </div>

          {/* Inicio real de operaciones, dato histórico opcional */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700">
              Fecha real de inicio de operaciones (opcional)
            </label>
            <input
              type="date"
              value={operationalStartDate}
              onChange={e => setOperationalStartDate(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-slate-400 focus:outline-none"
            />
            <p className="text-[10px] leading-4 text-slate-600">Indique cuándo comenzó realmente a operar la empresa, si conoce y tiene documentada esa fecha. Sirve para comprobar que la reconstrucción no omita períodos anteriores; no es requisito para registrar la empresa.</p>
          </div>

          {/* Ejercicio económico */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Ejercicio Económico (Año)
            </label>
            <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                required
                value={fiscalYear}
                onChange={e => setFiscalYear(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
              />
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
              disabled={saving}
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold shadow-md transition cursor-pointer"
            >
              <Check className="w-4 h-4" />
              {saving ? "Confirmando SQLite..." : "Guardar y Activar Empresa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
