import React, { useCallback, useEffect, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { Users, UserPlus, RefreshCw, AlertCircle, CheckCircle2, Calculator, FileText } from 'lucide-react';

type SalaryHistory = { id: string; effectiveFrom: string; effectiveTo: string | null; baseSalary: number; source: string };

type Employee = {
  id: string; companyId: string; fiscalId: string; fullName: string; hireDate: string;
  position: string; costCenter: string | null; frequency: 'WEEKLY' | 'BIWEEKLY';
  baseSalary: number; active: boolean;
};

const emptyForm: { fiscalId: string; fullName: string; hireDate: string; position: string; costCenter: string; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: string; salaryEffectiveFrom: string } = {
  fiscalId: '', fullName: '', hireDate: new Date().toISOString().slice(0, 10),
  position: '', costCenter: '', frequency: 'BIWEEKLY' as const, baseSalary: '', salaryEffectiveFrom: new Date().toISOString().slice(0,10)
};

export const PayrollView: React.FC<{ token: string }> = ({ token }) => {
  const { currentCompany } = useAccounting();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [salaryHistory, setSalaryHistory] = useState<Record<string, SalaryHistory[]>>({});
  const [historyOpen, setHistoryOpen] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [runs, setRuns] = useState<Array<{id:string;frequency:'WEEKLY'|'BIWEEKLY';periodStart:string;periodEnd:string;status:'DRAFT'|'CONFIRMED'|'VOIDED';totals:Record<string,number>;createdAt:string;confirmedAt:string|null; journalEntryId:string|null}>>([]);
  const [runFrequency, setRunFrequency] = useState<'WEEKLY'|'BIWEEKLY'>('BIWEEKLY');
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0,10));
  const [periodEnd, setPeriodEnd] = useState(new Date().toISOString().slice(0,10));
  const [payInputs, setPayInputs] = useState<Record<string,{earning:string;normal:string;integral:string;gross:string}>>({});
  const [creatingRun, setCreatingRun] = useState(false);
  const [rulesCount, setRulesCount] = useState(0);


  const loadEmployees = useCallback(async () => {
    if (!window.sicovenStore) { setError('El almacenamiento local no está disponible.'); setLoading(false); return; }
    setLoading(true); setError('');
    try { setEmployees(await window.sicovenStore.listPayrollEmployees(token)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los trabajadores.'); }
    finally { setLoading(false); }
  }, [token]);


  const loadRuns = useCallback(async () => {
    if (!window.sicovenStore) return;
    try {
      const [items, rules] = await Promise.all([
        window.sicovenStore.listPayrollRuns(token),
        window.sicovenStore.listPayrollLegalRules(token)
      ]);
      setRuns(items);
      setRulesCount(rules.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar el historial de nóminas.');
    }
  }, [token]);

  useEffect(() => { void loadEmployees(); void loadRuns(); }, [loadEmployees, loadRuns]);

  const updatePayInput = (employeeId: string, field: 'earning'|'normal'|'integral'|'gross', value: string) => {
    setPayInputs(current => ({
      ...current,
      [employeeId]: { earning: '', normal: '', integral: '', gross: '', ...current[employeeId], [field]: value }
    }));
  };

  const createDraftRun = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creatingRun || !window.sicovenStore) return;
    const selected = employees.filter(employee => employee.active && employee.frequency === runFrequency);
    if (selected.length === 0) { setError('No hay trabajadores activos con esta periodicidad.'); return; }
    const missing = selected.find(employee => {
      const values = payInputs[employee.id];
      return !values || ['earning','normal','integral','gross'].some(key => !Number.isFinite(Number(values[key])) || Number(values[key]) <= 0);
    });
    if (missing) { setError('Complete asignación del período y las tres bases salariales para ' + missing.fullName + '. No se asumirán equivalencias entre salario semanal, quincenal, normal e integral.'); return; }
    setCreatingRun(true); setError(''); setSuccess('');
    try {
      const result = await window.sicovenStore.createPayrollRun(token, {
        frequency: runFrequency, periodStart, periodEnd,
        employees: selected.map(employee => {
          const values = payInputs[employee.id];
          return {
            employeeId: employee.id,
            earnings: [{ code: 'SALARIO', description: 'Salario del período', amount: Number(values.earning), isSalary: true }],
            bases: { normalSalary: Number(values.normal), integralSalary: Number(values.integral), grossSalary: Number(values.gross) }
          };
        })
      });
      await loadRuns();
      setSuccess('Borrador de nómina creado. Revise sus importes y reglas antes de contabilizar; todavía no se ha confirmado ni generado asiento.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular el borrador de nómina.');
    } finally { setCreatingRun(false); }
  };


  const toggleSalaryHistory = async (employeeId: string) => {
    if (historyOpen === employeeId) { setHistoryOpen(null); return; }
    setHistoryOpen(employeeId);
    if (salaryHistory[employeeId]) return;
    if (!window.sicovenStore) return;
    setHistoryLoading(employeeId);
    try {
      const rows = await window.sicovenStore.listPayrollSalaryHistory(token, employeeId);
      setSalaryHistory(current => ({ ...current, [employeeId]: rows }));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar el historial salarial.'); setHistoryOpen(null); }
    finally { setHistoryLoading(null); }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !window.sicovenStore) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollEmployee(token, {
        ...(editingId ? { id: editingId } : {}),
        fiscalId: form.fiscalId, fullName: form.fullName, hireDate: form.hireDate,
        position: form.position, costCenter: form.costCenter || undefined,
        frequency: form.frequency, baseSalary: Number(form.baseSalary),
        salaryEffectiveFrom: editingId ? form.salaryEffectiveFrom : form.hireDate
      });
      setForm(emptyForm);
      setEditingId(null);
      await loadEmployees();
      setSuccess(editingId ? 'Ficha del trabajador actualizada.' : 'Trabajador registrado correctamente.');
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar el trabajador.'); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto w-full max-w-7xl space-y-5 p-3 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-wider text-emerald-700">SICOVEN · Gestión sencilla</p>
        <h1 className="text-2xl font-black text-slate-900">Nómina y trabajadores</h1>
        <p className="mt-1 text-sm text-slate-600">{currentCompany?.name || 'Empresa activa'} · Ficha breve, sin trámites innecesarios</p>
      </div>
      <button type="button" onClick={() => void loadEmployees()} disabled={loading}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">
        <RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Actualizar
      </button>
    </div>

    {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={18}/>{error}</div>}
    {success && <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 size={18}/>{success}</div>}

    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <form onSubmit={save} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 pb-3"><UserPlus className="text-emerald-700"/><h2 className="font-bold text-slate-900">{editingId ? 'Editar trabajador' : 'Registrar trabajador'}</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm font-medium text-slate-700">Cédula / RIF *
            <input required maxLength={40} value={form.fiscalId} onChange={e=>setForm(v=>({...v,fiscalId:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Nombre completo *
            <input required maxLength={180} value={form.fullName} onChange={e=>setForm(v=>({...v,fullName:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Fecha de ingreso *
            <input required type="date" value={form.hireDate} onChange={e=>setForm(v=>({...v,hireDate:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Salario base (Bs.) *
            <input required type="number" min="0.01" step="0.01" value={form.baseSalary} onChange={e=>setForm(v=>({...v,baseSalary:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          {editingId && <label className="space-y-1 text-sm font-medium text-slate-700">Salario vigente desde *
            <input required type="date" value={form.salaryEffectiveFrom} onChange={e=>setForm(v=>({...v,salaryEffectiveFrom:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>}
          <label className="space-y-1 text-sm font-medium text-slate-700">Periodicidad *
            <select value={form.frequency} onChange={e=>setForm(v=>({...v,frequency:e.target.value as 'WEEKLY'|'BIWEEKLY'}))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quincenal</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Cargo
            <input maxLength={120} value={form.position} onChange={e=>setForm(v=>({...v,position:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700 sm:col-span-2">Centro de costos (opcional)
            <input maxLength={120} value={form.costCenter} onChange={e=>setForm(v=>({...v,costCenter:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
        </div>
        <button disabled={saving} className="w-full rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
          {saving ? 'Guardando…' : editingId ? 'Guardar cambios' : 'Guardar trabajador'}
        </button>
        {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(emptyForm); }} className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancelar edición</button>}
      </form>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2"><Users className="text-emerald-700"/><h2 className="font-bold text-slate-900">Trabajadores registrados</h2></div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{employees.length}</span>
        </div>
        {loading ? <p className="py-8 text-center text-sm text-slate-500">Cargando trabajadores…</p> :
          employees.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">Todavía no hay trabajadores registrados en esta empresa.</p> :
          <div className="divide-y divide-slate-100">{employees.map(employee=><div key={employee.id} className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-semibold text-slate-900">{employee.fullName}</p><p className="text-xs text-slate-500">{employee.fiscalId} · {employee.position || 'Sin cargo indicado'}</p></div>
              <div className="flex flex-wrap items-center gap-2"><div className="text-right"><p className="text-sm font-semibold text-slate-800">Bs. {employee.baseSalary.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="text-xs text-slate-500">{employee.frequency === 'WEEKLY' ? 'Semanal' : 'Quincenal'}</p></div>
                <button type="button" onClick={() => void toggleSalaryHistory(employee.id)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">{historyLoading === employee.id ? 'Cargando…' : historyOpen === employee.id ? 'Ocultar historial' : 'Historial'}</button>
                <button type="button" onClick={() => { setEditingId(employee.id); setForm({ fiscalId: employee.fiscalId, fullName: employee.fullName, hireDate: employee.hireDate, position: employee.position || '', costCenter: employee.costCenter || '', frequency: employee.frequency, baseSalary: String(employee.baseSalary), salaryEffectiveFrom: new Date().toISOString().slice(0,10) }); setError(''); setSuccess(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Editar</button>
              </div>
            </div>
            {historyOpen === employee.id && <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Historial de salarios</p>
              {(salaryHistory[employee.id] || []).map(item=><div key={item.id} className="flex flex-wrap justify-between gap-2 border-t border-slate-200 py-2 text-sm">
                <span className="text-slate-600">{item.effectiveFrom} – {item.effectiveTo || 'Vigente'}</span>
                <span className="font-semibold text-slate-800">Bs. {item.baseSalary.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
              </div>)}
            </div>}
          </div>)}</div>}
      </section>
    </div>

    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
        <Calculator className="text-emerald-700"/><div><h2 className="font-bold text-slate-900">Procesar nómina</h2><p className="text-xs text-slate-500">Crea un borrador revisable; no contabiliza ni confirma automáticamente.</p></div>
      </div>
      <form onSubmit={createDraftRun} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm font-medium text-slate-700">Periodicidad
            <select value={runFrequency} onChange={e=>setRunFrequency(e.target.value as 'WEEKLY'|'BIWEEKLY')} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="WEEKLY">Semanal</option><option value="BIWEEKLY">Quincenal</option>
            </select>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Desde
            <input required type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-sm font-medium text-slate-700">Hasta
            <input required type="date" min={periodStart} value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          {rulesCount > 0 ? rulesCount + ' regla(s) legal(es) registradas. Solo se aplicarán las vigentes, verificadas y aplicables a esta empresa.' : 'No hay reglas legales configuradas. El borrador mostrará asignaciones y neto sin inventar retenciones ni aportes.'}
          Las bases normal, integral y bruta se solicitan por separado: no se deducen de la ficha salarial.
        </div>
        {employees.filter(employee=>employee.active && employee.frequency===runFrequency).length === 0
          ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">Registre trabajadores activos con periodicidad {runFrequency==='WEEKLY'?'semanal':'quincenal'} para procesar este período.</p>
          : <div className="space-y-3">
            {employees.filter(employee=>employee.active && employee.frequency===runFrequency).map(employee=>{
              const values=payInputs[employee.id] || {earning:'',normal:'',integral:'',gross:''};
              return <div key={employee.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-900">{employee.fullName}</p><span className="text-xs text-slate-500">{employee.fiscalId}</span></div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {([
                    ['earning','Asignación del período'],
                    ['normal','Base salario normal'],
                    ['integral','Base salario integral'],
                    ['gross','Base salario bruto']
                  ] as const).map(([field,label])=><label key={field} className="space-y-1 text-xs font-medium text-slate-600">{label} (Bs.)
                    <input required type="number" min="0.01" step="0.01" value={values[field]} onChange={e=>updatePayInput(employee.id,field,e.target.value)} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
                  </label>)}
                </div>
              </div>;
            })}
          </div>}
        <button disabled={creatingRun || loading || employees.filter(employee=>employee.active && employee.frequency===runFrequency).length===0} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 font-bold text-white hover:bg-emerald-800 disabled:opacity-60">
          <Calculator size={17}/>{creatingRun?'Calculando…':'Calcular y guardar borrador'}
        </button>
      </form>
      <div className="border-t border-slate-100 pt-4">
        <div className="mb-2 flex items-center gap-2"><FileText size={17} className="text-slate-600"/><h3 className="font-bold text-slate-900">Historial de nóminas</h3></div>
        {runs.length===0 ? <p className="text-sm text-slate-500">Todavía no hay nóminas procesadas en esta empresa.</p> :
          <div className="divide-y divide-slate-100">{runs.map(run=><div key={run.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
            <div><p className="font-semibold text-slate-800">{run.periodStart} al {run.periodEnd} · {run.frequency==='WEEKLY'?'Semanal':'Quincenal'}</p><p className="text-xs text-slate-500">Neto: Bs. {(run.totals.netPay||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})} · {run.id.slice(0,8)}</p></div>
            <span className={run.status==='CONFIRMED'?'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800':'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800'}>{run.status==='CONFIRMED'?'Confirmada':run.status==='VOIDED'?'Anulada':'Borrador'}</span>
          </div>)}</div>}
      </div>
    </section>
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      La ficha del trabajador ya se guarda en la base SQLite independiente de esta empresa. Los cálculos legales, recibos y contabilización se habilitarán cuando sus reglas vigentes hayan sido verificadas; no se aplican tasas supuestas.
    </div>
  </div>;
};
