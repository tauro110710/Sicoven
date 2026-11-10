import React, { useCallback, useEffect, useState } from 'react';
import { useAccounting } from '../../context/AccountingContext';
import { Users, UserPlus, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

type Employee = {
  id: string; companyId: string; fiscalId: string; fullName: string; hireDate: string;
  position: string; costCenter: string | null; frequency: 'WEEKLY' | 'BIWEEKLY';
  baseSalary: number; active: boolean;
};

const emptyForm: { fiscalId: string; fullName: string; hireDate: string; position: string; costCenter: string; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: string } = {
  fiscalId: '', fullName: '', hireDate: new Date().toISOString().slice(0, 10),
  position: '', costCenter: '', frequency: 'BIWEEKLY' as const, baseSalary: ''
};

export const PayrollView: React.FC<{ token: string }> = ({ token }) => {
  const { currentCompany } = useAccounting();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const loadEmployees = useCallback(async () => {
    if (!window.sicovenStore) { setError('El almacenamiento local no está disponible.'); setLoading(false); return; }
    setLoading(true); setError('');
    try { setEmployees(await window.sicovenStore.listPayrollEmployees(token)); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudieron cargar los trabajadores.'); }
    finally { setLoading(false); }
  }, [token]);

  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !window.sicovenStore) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollEmployee(token, {
        ...(editingId ? { id: editingId } : {}),
        fiscalId: form.fiscalId, fullName: form.fullName, hireDate: form.hireDate,
        position: form.position, costCenter: form.costCenter || undefined,
        frequency: form.frequency, baseSalary: Number(form.baseSalary)
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
          <div className="divide-y divide-slate-100">{employees.map(employee=><div key={employee.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div><p className="font-semibold text-slate-900">{employee.fullName}</p><p className="text-xs text-slate-500">{employee.fiscalId} · {employee.position || 'Sin cargo indicado'}</p></div>
            <div className="flex items-center gap-3"><div className="text-right"><p className="text-sm font-semibold text-slate-800">Bs. {employee.baseSalary.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="text-xs text-slate-500">{employee.frequency === 'WEEKLY' ? 'Semanal' : 'Quincenal'}</p></div><button type="button" onClick={() => { setEditingId(employee.id); setForm({ fiscalId: employee.fiscalId, fullName: employee.fullName, hireDate: employee.hireDate, position: employee.position || '', costCenter: employee.costCenter || '', frequency: employee.frequency, baseSalary: String(employee.baseSalary) }); setError(''); setSuccess(''); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">Editar</button></div>
          </div>)}</div>}
      </section>
    </div>
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      La ficha del trabajador ya se guarda en la base SQLite independiente de esta empresa. Los cálculos legales, recibos y contabilización se habilitarán cuando sus reglas vigentes hayan sido verificadas; no se aplican tasas supuestas.
    </div>
  </div>;
};
