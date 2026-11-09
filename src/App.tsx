import React, { useEffect, useState } from 'react';
import { AccountingProvider, useAccounting } from './context/AccountingContext';
import { Navbar } from './components/Navbar';
import { CompanyModal } from './components/CompanyModal';
import { LibroDiarioView } from './components/LibroDiario/LibroDiarioView';
import { LibroMayorView } from './components/LibroMayor/LibroMayorView';
import { BalancesView } from './components/Balances/BalancesView';
import { LibroComprasView } from './components/LibroCompras/LibroComprasView';
import { LibroVentasView } from './components/LibroVentas/LibroVentasView';
import { InventarioView } from './components/Inventario/InventarioView';
import { FixedAssetsView } from './components/ActivosFijos/FixedAssetsView';
import { RetencionesIvaView } from './components/Retenciones/RetencionesIvaView';
import { RetencionesIslrView } from './components/Retenciones/RetencionesIslrView';
import { CatalogoView } from './components/Catalogo/CatalogoView';
import { ConfiguracionView } from './components/Configuracion/ConfiguracionView';
import { ConciliacionBancariaView } from './components/Conciliacion/ConciliacionBancariaView';
import { TesoreriaView } from './components/Tesoreria/TesoreriaView';
import { CuentasPorPagarView } from './components/CuentasPorPagar/CuentasPorPagarView';
import { CuentasPorCobrarView } from './components/CuentasPorCobrar/CuentasPorCobrarView';
import { ReversionFiscalView } from './components/ReversionFiscalView';
import { InflationWorkspace } from './components/Inflacion/InflationWorkspace';
import { ShieldCheck, Building2 } from 'lucide-react';
import { LoginScreen, AuthUser } from './components/LoginScreen';
import { AdminUsers } from './components/AdminUsers';
import { LicenseGate } from './components/LicenseGate';
import { ModuleHelp } from './components/ModuleHelp';

const AppContent: React.FC<{ auth: {token:string; user:AuthUser}; logout: () => Promise<void> }> = ({ auth, logout }) => {
  const [showAdmins, setShowAdmins] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('diario');
  const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
  const { currentCompany, companies, isStorageReady, storageError } = useAccounting();
  const [accessibleCompanies, setAccessibleCompanies] = useState<Array<{ id: string; name: string; rif: string }>>([]);
  const [tenantMigration, setTenantMigration] = useState<{
    loading: boolean; required: boolean; blocked: string | null;
    companyIds: string[]; running: boolean; error: string | null;
  }>({ loading: true, required: false, blocked: null, companyIds: [], running: false, error: null });
  const [companySwitching, setCompanySwitching] = useState(false);

  useEffect(() => {
    let active = true;
    const inspectTenants = async () => {
      if (!window.sicovenStore) {
        if (active) setTenantMigration({ loading: false, required: false, blocked: null, companyIds: [], running: false, error: null });
        return;
      }
      try {
        const accessible = await window.sicovenStore.listAccessibleCompanies(auth.token);
        if (!active) return;
        setAccessibleCompanies(accessible);
        const registry = await window.sicovenStore.getTenantRegistryStatus(auth.token);
        if (!active) return;
        if (registry.registeredCount > 0) {
          if (accessible.length > 0) {
            setTenantMigration({ loading: false, required: false, blocked: null, companyIds: [], running: false, error: null });
          } else {
            setTenantMigration({
              loading: false, required: false,
              blocked: 'El registro local contiene empresas, pero ninguna está activa o disponible para esta sesión. No se repetirá la migración ni se crearán bases nuevas. Revisa el estado de las empresas desde una sesión autorizada.',
              companyIds: [], running: false, error: null
            });
          }
          return;
        }
        const preflight = await window.sicovenStore.inspectTenantMigrationPreflight(auth.token);
        if (!active) return;
        if (preflight.companyCount > 0 && preflight.ok) {
          setTenantMigration({ loading: false, required: true, blocked: null, companyIds: preflight.companyIds, running: false, error: null });
        } else if (preflight.companyCount > 0 && !preflight.ok) {
          setTenantMigration({
            loading: false, required: false,
            blocked: preflight.errors.join(' ') || 'La base heredada requiere revisión antes de migrar.',
            companyIds: preflight.companyIds, running: false, error: null
          });
        } else {
          setTenantMigration({ loading: false, required: false, blocked: null, companyIds: [], running: false, error: null });
        }
      } catch (error) {
        if (!active) return;
        setTenantMigration({
          loading: false, required: false,
          blocked: error instanceof Error ? error.message : 'No se pudo verificar el registro local de empresas.',
          companyIds: [], running: false, error: null
        });
      }
    };
    void inspectTenants();
    return () => { active = false; };
  }, [auth.token]);

  useEffect(() => {
    if (!tenantMigration.loading && !tenantMigration.required && !tenantMigration.blocked &&
        isStorageReady && companies.length === 0) setIsCompanyModalOpen(true);
  }, [tenantMigration.loading, tenantMigration.required, tenantMigration.blocked, isStorageReady, companies.length]);

  const executeTenantMigration = async () => {
    if (!window.sicovenStore || tenantMigration.running || !tenantMigration.required) return;
    setTenantMigration(state => ({ ...state, running: true, error: null }));
    try {
      const result = await window.sicovenStore.executeTenantMigration(auth.token);
      if (!result?.ok || !result.companies?.length) {
        throw new Error('La migración no confirmó la creación de las bases individuales de empresa.');
      }
      const firstCompanyId = tenantMigration.companyIds[0] || result.companies[0].companyId;
      if (!firstCompanyId) throw new Error('La migración terminó sin una empresa inicial seleccionable.');
      await window.sicovenStore.selectActiveCompany(auth.token, firstCompanyId);
      window.location.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo completar la migración.';
      setTenantMigration(state => ({
        ...state, required: false, running: false,
        blocked: 'La migración no quedó confirmada. Se bloqueó el reintento automático para proteger los archivos preparados y el journal. No elimines ni sobrescribas las bases locales. Detalle: ' + message,
        error: message
      }));
    }
  };

  const switchCompany = async (companyId: string) => {
    if (!window.sicovenStore || !companyId || companyId === currentCompany.id || companySwitching) return;
    setCompanySwitching(true);
    try {
      await window.sicovenStore.selectActiveCompany(auth.token, companyId);
      window.location.reload();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo cambiar la empresa activa.');
      setCompanySwitching(false);
    }
  };

  const exportCurrentCompany = async (format: 'sqlite' | 'json') => {
    if (!window.sicovenStore || !currentCompany?.id) return;
    try {
      const result = await window.sicovenStore.exportCompanyData(auth.token, { format });
      if (result.ok) window.alert('La entrega de datos de la empresa se generó correctamente en: ' + (result.destination || 'la ubicación seleccionada.'));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo exportar la empresa seleccionada.');
    }
  };

  const renderActiveTab = () => {
    switch (activeTab) {
      case 'diario':
        return <LibroDiarioView />;
      case 'mayor':
        return <LibroMayorView />;
      case 'balances':
        return <BalancesView />;
      case 'tesoreria':
        return <TesoreriaView />;
      case 'conciliacion':
        return <ConciliacionBancariaView />;
      case 'compras':
        return <LibroComprasView />;
      case 'cxp':
        return <CuentasPorPagarView />;
      case 'cxc':
        return <CuentasPorCobrarView />;
      case 'ventas':
        return <LibroVentasView />;
      case 'inventario':
        return <InventarioView />;
      case 'activos-fijos':
        return <FixedAssetsView />;
      case 'ret-iva':
        return <RetencionesIvaView />;
      case 'ret-islr':
        return <RetencionesIslrView />;
      case 'catalogo':
        return <CatalogoView />;
      case 'config':
        return <ConfiguracionView token={auth.token} />;
      case 'reversiones':
        return <ReversionFiscalView userRole={auth.user.role} />;
      case 'inflacion':
        return <InflationWorkspace token={auth.token} userRole={auth.user.role} />;
      default:
        return <LibroDiarioView />;
    }
  };

  if (showAdmins) return <AdminUsers token={auth.token} user={auth.user} onLogout={logout} onBack={() => setShowAdmins(false)} />;
  if (tenantMigration.loading && window.sicovenStore) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-100"><div className="rounded-xl bg-white p-8 text-center shadow-lg"><div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" /><h1 className="font-bold text-slate-900">Verificando empresas locales</h1><p className="mt-2 text-sm text-slate-600">SICOVEN está comprobando el registro SQLite y el estado de migración.</p></div></div>;
  }
  if (tenantMigration.required || tenantMigration.blocked) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4 py-8">
      <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-xl">
        <div className="flex items-center gap-3"><Building2 className="h-8 w-8 text-emerald-700" /><div><h1 className="text-xl font-black text-slate-900">Bases locales independientes por empresa</h1><p className="text-sm text-slate-500">Migración controlada de SICOVEN</p></div></div>
        {tenantMigration.required ? <>
          <p className="mt-5 text-sm leading-6 text-slate-700">Se detectó una base heredada con {tenantMigration.companyIds.length} empresa(s). SICOVEN puede separar sus datos en archivos SQLite locales independientes. La base original se conserva y la migración crea un respaldo consistente, verifica cada empresa y mantiene el registro de recuperación.</p>
          <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">No cierres SICOVEN ni apagues el equipo durante la migración. Las operaciones contables permanecerán bloqueadas hasta verificar el resultado.</p>
          {tenantMigration.error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{tenantMigration.error}</p>}
          <button disabled={tenantMigration.running} onClick={() => void executeTenantMigration()} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:opacity-60">{tenantMigration.running ? 'Migrando y verificando bases...' : 'Iniciar migración local segura'}</button>
        </> : <>
          <p className="mt-5 text-sm leading-6 text-rose-700">SICOVEN no pudo autorizar la migración automática. No se modificó la base heredada. Conserva el archivo sicoven.sqlite y solicita revisión técnica.</p>
          <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{tenantMigration.blocked}</p>
        </>}
        <button onClick={logout} className="mt-4 w-full rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700">Cerrar sesión</button>
      </div>
    </div>;
  }
  if (!isStorageReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 px-6">
        <div role="status" aria-live="polite" className="max-w-md rounded-xl bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-emerald-600" />
          <h1 className="text-lg font-bold text-slate-900">{storageError ? 'No se pudo abrir la base de datos local' : 'Iniciando SICOVEN'}</h1>
          <p className="mt-2 text-sm text-slate-600">{storageError || 'Verificando y cargando los datos locales antes de habilitar las operaciones contables.'}</p>
          <p className="mt-3 text-xs text-slate-500">{storageError ? 'Las operaciones permanecen bloqueadas para proteger sus datos. Cierre SICOVEN y compruebe los permisos de escritura de la carpeta de datos antes de volver a abrirlo.' : 'Si esta pantalla no desaparece, cierre el programa y compruebe los permisos de escritura de la carpeta de datos.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col selection:bg-emerald-500 selection:text-white">
      {auth && <div className="flex flex-wrap items-center justify-end gap-2 bg-slate-800 px-4 py-2 text-xs text-white no-print">
        <span>Sesión: <strong>{auth.user.username}</strong></span>
        {window.sicovenStore && accessibleCompanies.length > 0 && <select aria-label="Empresa activa" disabled={companySwitching} value={currentCompany?.id || ''} onChange={event => void switchCompany(event.target.value)} className="max-w-[220px] rounded-lg border border-slate-600 bg-slate-700 px-2 py-1.5 text-white"><option value={currentCompany?.id || ''}>{currentCompany?.name || 'Empresa activa'}</option>{accessibleCompanies.filter(company => company.id !== currentCompany?.id).map(company => <option key={company.id} value={company.id}>{company.name || company.rif || company.id}</option>)}</select>}
        {window.sicovenStore && currentCompany?.id && <><button onClick={() => void exportCurrentCompany('sqlite')} className="rounded-lg border border-slate-600 px-3 py-1.5 hover:bg-slate-700">Entregar SQLite</button><button onClick={() => void exportCurrentCompany('json')} className="rounded-lg border border-slate-600 px-3 py-1.5 hover:bg-slate-700">Entregar JSON</button></>}
        <button onClick={()=>setShowAdmins(true)} className="rounded-lg border border-slate-600 px-3 py-1.5 hover:bg-slate-700">Usuarios</button><button onClick={logout} className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold hover:bg-emerald-700">Cerrar sesión</button>
      </div>}
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenCompanyModal={() => setIsCompanyModalOpen(true)}
        userRole={auth.user.role}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-2.5 sm:px-6 lg:px-8 py-4 sm:py-6 overflow-x-hidden">
        {renderActiveTab()}
        <ModuleHelp moduleId={activeTab} />
      </main>

      {/* Footer (hidden on print) */}
      <footer className="bg-slate-900 border-t border-slate-800 text-slate-400 py-6 text-xs no-print mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <img src="./sicoven-logo-horizontal.svg" alt="SICOVEN · Sistema Contable VEN-NIF & SENIAT" className="h-6 w-auto object-contain" />
            <span className="text-slate-600">•</span>
            <span>Sistema Contable VEN-NIF & SENIAT</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-400">
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              Providencia SNAT/2015/0049 • Decreto 1808 • VEN-NIF
            </span>
            <span className="text-slate-600">•</span>
            <span>Valores expresados en Bolívares (Bs.) y Dólares ($ USD)</span>
          </div>
        </div>
      </footer>

      {/* Global Modals */}
      <CompanyModal
        isOpen={isCompanyModalOpen}
        onClose={() => setIsCompanyModalOpen(false)}
      />
</div>
  );
};

export default function App() {
  const [licenseAllowed, setLicenseAllowed] = useState(false);
  const [auth, setAuth] = useState<{token:string; user:AuthUser} | null>(null);

  const logout = async () => {
    try {
      if (auth && window.sicovenStore) await window.sicovenStore.logout(auth.token);
      try { localStorage.removeItem('sicoven_auth_token'); } catch {}
      setAuth(null);
    } catch (error) {
      // If SQLite cannot confirm its pending writes, keep the authenticated
      // session visible so the accountant can retry instead of being signed out.
      const message = error instanceof Error ? error.message : 'No se pudo cerrar la sesión de SICOVEN.';
      window.alert(message);
    }
  };

  useEffect(() => {
    if (!window.sicovenStore) return;
    const enforceStatus = (status: { authorized: boolean }) => {
      if (!status.authorized) {
        setAuth(null);
        setLicenseAllowed(false);
        try { localStorage.removeItem('sicoven_auth_token'); } catch {}
      }
    };
    const unsubscribe = window.sicovenStore.onLicenseStatusChanged(enforceStatus);
    const onReconnect = () => {
      void window.sicovenStore?.revalidateLicense().then(enforceStatus).catch(() => {});
    };
    window.addEventListener('online', onReconnect);
    return () => {
      unsubscribe();
      window.removeEventListener('online', onReconnect);
    };
  }, []);

  useEffect(() => {
    if (!window.sicovenStore) return;
    let mounted = true;
    const restore = async () => {
      try {
        const license = await window.sicovenStore!.getLicenseStatus();
        if (!mounted) return;
        if (!license.authorized) {
          setLicenseAllowed(false);
          return;
        }
        setLicenseAllowed(true);
        let token = '';
        try { token = localStorage.getItem('sicoven_auth_token') || ''; } catch {}
        if (!token) return;
        const result = await window.sicovenStore!.restoreSession(token);
        if (!mounted) return;
        if (result.ok && result.token && result.user) {
          setAuth({ token: result.token, user: result.user });
        } else {
          try { localStorage.removeItem('sicoven_auth_token'); } catch {}
        }
      } catch {
        if (mounted) {
          setAuth(null);
          try { localStorage.removeItem('sicoven_auth_token'); } catch {}
        }
      }
    };
    void restore();
    return () => { mounted = false; };
  }, []);

  if (window.sicovenStore && !licenseAllowed) return <LicenseGate onReady={() => setLicenseAllowed(true)} />;
  if (!auth) return (
    <LoginScreen
      onLogin={(token, user) => {
        try { localStorage.setItem('sicoven_auth_token', token); } catch {}
        setAuth({ token, user });
      }}
    />
  );

  return (
    <AccountingProvider token={auth.token}>
      <AppContent auth={auth} logout={logout} />
    </AccountingProvider>
  );
}
