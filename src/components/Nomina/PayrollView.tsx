import React, { useCallback, useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import { useAccounting } from '../../context/AccountingContext';

import { buildPayrollJournalItems } from '../../utils/payrollAccounting';
import { Users, UserPlus, RefreshCw, AlertCircle, CheckCircle2, Calculator, FileText, Printer, BookCheck } from 'lucide-react';

type SalaryHistory = { id: string; effectiveFrom: string; effectiveTo: string | null; baseSalary: number; source: string };
type PayrollLegalRule = {
  id: string; code: string; description: string; base: 'normalSalary'|'integralSalary'|'grossSalary';
  frequencyScope: 'ALL'|'WEEKLY'|'BIWEEKLY'; workerRate: number; employerRate: number;
  baseCap: number|null; effectiveFrom: string; effectiveTo: string|null;
  sourceReference: string; verifiedAt: string; applicability: Record<string, unknown>; active: boolean;
};

type Employee = {
  id: string; companyId: string; fiscalId: string; fullName: string; hireDate: string;
  position: string; costCenter: string | null; frequency: 'WEEKLY' | 'BIWEEKLY';
  baseSalary: number; active: boolean;
};

type ProfitSharingResult = {
  netProfits: number; statutoryRate: number; distributableFund: number; totalWagesEarned: number;
  totalMinimum: number; totalMaximum: number; totalPayable: number; employerShortfall: number;
  undistributedRemainder: number; sourceReference: string; verifiedAt: string; salaryEvidence: string;
  employees: Array<{ employeeId: string; fullName: string; wagesEarned: number; monthlyNormalSalary: number;
    monthsWorked: number; minimumDays: number; maximumDays: number; minimumAmount: number;
    maximumAmount: number; proportionalShare: number; amount: number }>;
};

const emptyForm: { fiscalId: string; fullName: string; hireDate: string; position: string; costCenter: string; frequency: 'WEEKLY' | 'BIWEEKLY'; baseSalary: string; salaryEffectiveFrom: string } = {
  fiscalId: '', fullName: '', hireDate: new Date().toISOString().slice(0, 10),
  position: '', costCenter: '', frequency: 'BIWEEKLY' as const, baseSalary: '', salaryEffectiveFrom: new Date().toISOString().slice(0,10)
};

export const PayrollView: React.FC<{ token: string }> = ({ token }) => {
  const { currentCompany, accounts, journalEntries, addJournalEntry, waitForPersistence, isStorageReady } = useAccounting();
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
  const [postingRun, setPostingRun] = useState<string | null>(null);
  const [pdfRun, setPdfRun] = useState<string | null>(null);
  const [legalCalcOpen, setLegalCalcOpen] = useState<string | null>(null);
  const [legalCalcLoading, setLegalCalcLoading] = useState<string | null>(null);
  const [legalCalcInputs, setLegalCalcInputs] = useState<Record<string, {salaryType:'FIXED'|'VARIABLE';lastMonth:string;month1:string;month2:string;month3:string;asOfDate:string;fiscalYearStart:string}>>({});
  const [legalCalcResults, setLegalCalcResults] = useState<Record<string, {salaryBasis:{monthlySalary:number;dailySalary:number;monthsAveraged:number;legalBasis:string};completedYears:number;vacationDays:number;vacationPay:number;vacationBonusDays:number;vacationBonus:number;profitSharingMinimumDays:number;profitSharingMinimum:number;profitSharingMaximumDays:number;profitSharingMaximum:number;monthsInFiscalYear:number;sources:string[]}>>({});
  const [legalRules, setLegalRules] = useState<PayrollLegalRule[]>([]);
  const [ruleForm, setRuleForm] = useState({
    code: '', description: '', base: 'normalSalary' as 'normalSalary'|'integralSalary'|'grossSalary',
    frequencyScope: 'ALL' as 'ALL'|'WEEKLY'|'BIWEEKLY', workerRate: '', employerRate: '',
    baseCap: '', effectiveFrom: new Date().toISOString().slice(0,10), effectiveTo: '',
    sourceReference: '', verifiedAt: new Date().toISOString().slice(0,10)
  });
  const [savingRule, setSavingRule] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [profitSharingInputs, setProfitSharingInputs] = useState({
    fiscalYearStart: new Date().getFullYear() + '-01-01',
    fiscalYearEnd: new Date().getFullYear() + '-12-31',
    netProfits: '', sourceReference: '', verifiedAt: new Date().toISOString().slice(0,10)
  });
  const [profitSharingBases, setProfitSharingBases] = useState<Record<string,{monthlyNormalSalary:string;monthsWorked:string}>>({});
  const [profitSharingLoading, setProfitSharingLoading] = useState(false);
  const [profitSharingResult, setProfitSharingResult] = useState<ProfitSharingResult | null>(null);
  const [severanceOpen, setSeveranceOpen] = useState<string | null>(null);
  const [severanceHistory, setSeveranceHistory] = useState<Record<string, {deposits:Array<Record<string,unknown>>;interests:Array<Record<string,unknown>>}>>({});
  const [severanceBusy, setSeveranceBusy] = useState<string | null>(null);
  const [severanceResult, setSeveranceResult] = useState<Record<string, Record<string,unknown>>>({});
  const [interestResult, setInterestResult] = useState<Record<string, Record<string,unknown>>>({});
  const [depositForm, setDepositForm] = useState({depositDate:new Date().toISOString().slice(0,10),kind:'QUARTERLY' as 'QUARTERLY'|'SENIORITY'|'ADVANCE',days:'15',dailyIntegralSalary:'',sourceReference:'',modeEvidence:'',verifiedAt:new Date().toISOString().slice(0,10)});
  const [interestForm, setInterestForm] = useState({month:new Date().toISOString().slice(0,7),mode:'UNDEPOSITED' as 'TRUST_OR_FUND'|'AUTHORIZED_BOOK_CREDIT'|'UNDEPOSITED',capital:'',monthlyRate:'',sourceReference:'',verifiedAt:new Date().toISOString().slice(0,10)});
  const [severanceCalcForm, setSeveranceCalcForm] = useState({asOfDate:new Date().toISOString().slice(0,10),dailyIntegralSalary:''});

  const requiredBaseFields = new Set(legalRules
    .filter(rule => rule.active && (rule.frequencyScope === 'ALL' || rule.frequencyScope === runFrequency) &&
      rule.effectiveFrom <= periodEnd && (!rule.effectiveTo || rule.effectiveTo >= periodEnd))
    .map(rule => rule.base));


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
      setLegalRules(rules);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar el historial de nóminas.');
    }
  }, [token]);

  useEffect(() => { void loadEmployees(); void loadRuns(); }, [loadEmployees, loadRuns]);

  const updatePayInput = (employeeId: string, field: 'earning'|'normal'|'integral'|'gross', value: string) => {
    setPayInputs(current => {
      const previous = current[employeeId] ?? { earning: '', normal: '', integral: '', gross: '' };
      return { ...current, [employeeId]: { ...previous, [field]: value } };
    });
  };

  const createDraftRun = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creatingRun || !window.sicovenStore) return;
    const selected = employees.filter(employee => employee.active && employee.frequency === runFrequency);
    if (selected.length === 0) { setError('No hay trabajadores activos con esta periodicidad.'); return; }
    const missing = selected.find(employee => {
      const values = payInputs[employee.id];
      if (!values || !Number.isFinite(Number(values.earning)) || Number(values.earning) <= 0) return true;
      const requiredFields = [['normalSalary','normal'],['integralSalary','integral'],['grossSalary','gross']] as const;
      return requiredFields.some(([base, field]) => requiredBaseFields.has(base) &&
        (!Number.isFinite(Number(values[field])) || Number(values[field]) <= 0));
    });
    if (missing) { setError('Complete la asignación del período y las bases que requieren las reglas legales vigentes para ' + missing.fullName + '. No se asumirán equivalencias salariales.'); return; }
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


  const saveLegalRule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRule || !window.sicovenStore) return;
    const workerRate = Number(ruleForm.workerRate), employerRate = Number(ruleForm.employerRate);
    if (!Number.isFinite(workerRate) || workerRate < 0 || workerRate > 100 ||
        !Number.isFinite(employerRate) || employerRate < 0 || employerRate > 100) {
      setError('Las tasas del trabajador y patronales deben estar entre 0 y 100%.');
      return;
    }
    if (!ruleForm.code.trim() || !ruleForm.description.trim() || !ruleForm.sourceReference.trim()) {
      setError('Indique código, descripción y fuente normativa de la obligación.');
      return;
    }
    setSavingRule(true); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollLegalRule(token, {
        ...(editingRuleId ? { id: editingRuleId } : {}),
        code: ruleForm.code.trim(), description: ruleForm.description.trim(),
        base: ruleForm.base, frequencyScope: ruleForm.frequencyScope,
        workerRate: workerRate / 100, employerRate: employerRate / 100,
        baseCap: ruleForm.baseCap.trim() ? Number(ruleForm.baseCap) : null,
        effectiveFrom: ruleForm.effectiveFrom, effectiveTo: ruleForm.effectiveTo || null,
        sourceReference: ruleForm.sourceReference.trim(), verifiedAt: ruleForm.verifiedAt,
        applicability: legalRules.find(rule => rule.id === editingRuleId)?.applicability || {},
        active: true
      });
      await loadRuns();
      setSuccess('Regla legal guardada para esta empresa. Se aplicará solo en los períodos y periodicidades de su vigencia.');
      setEditingRuleId(null);
      setRuleForm(current => ({ ...current, code: '', description: '', workerRate: '', employerRate: '', baseCap: '', effectiveTo: '', sourceReference: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la regla legal.');
    } finally { setSavingRule(false); }
  };

  const editLegalRule = (rule: PayrollLegalRule) => {
    setEditingRuleId(rule.id);
    setRuleForm({
      code: rule.code, description: rule.description, base: rule.base,
      frequencyScope: rule.frequencyScope, workerRate: String(rule.workerRate * 100),
      employerRate: String(rule.employerRate * 100), baseCap: rule.baseCap == null ? '' : String(rule.baseCap),
      effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo || '',
      sourceReference: rule.sourceReference, verifiedAt: rule.verifiedAt
    });
  };

  const deactivateLegalRule = async (rule: PayrollLegalRule) => {
    if (!window.sicovenStore || savingRule) return;
    setSavingRule(true); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollLegalRule(token, {
        id: rule.id, code: rule.code, description: rule.description, base: rule.base,
        frequencyScope: rule.frequencyScope, workerRate: rule.workerRate, employerRate: rule.employerRate,
        baseCap: rule.baseCap, effectiveFrom: rule.effectiveFrom, effectiveTo: rule.effectiveTo,
        sourceReference: rule.sourceReference, verifiedAt: rule.verifiedAt,
        applicability: rule.applicability, active: false
      });
      await loadRuns();
      if (editingRuleId === rule.id) setEditingRuleId(null);
      setSuccess('Regla legal desactivada. Los borradores y nóminas confirmadas conservan sus cálculos históricos.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo desactivar la regla legal.');
    } finally { setSavingRule(false); }
  };

  const calculateAnnualRights = async (employeeId: string) => {
    if (legalCalcLoading || !window.sicovenStore) return;
    const values = legalCalcInputs[employeeId] || {
      salaryType: 'FIXED' as const, lastMonth: '', month1: '', month2: '', month3: '',
      asOfDate: new Date().toISOString().slice(0,10), fiscalYearStart: new Date().getFullYear() + '-01-01'
    };
    if (values.salaryType === 'FIXED' && (!Number.isFinite(Number(values.lastMonth)) || Number(values.lastMonth) <= 0)) {
      setError('Indique el salario normal del mes anterior para calcular vacaciones y beneficios.');
      return;
    }
    if (values.salaryType === 'VARIABLE' && [values.month1,values.month2,values.month3].some(value => !Number.isFinite(Number(value)) || Number(value) <= 0)) {
      setError('Para salario variable se requieren los tres salarios normales mensuales anteriores.');
      return;
    }
    setLegalCalcLoading(employeeId); setError(''); setSuccess('');
    try {
      const result = await window.sicovenStore.calculatePayrollAnnualRights(token, {
        employeeId, asOfDate: values.asOfDate, fiscalYearStart: values.fiscalYearStart,
        salaryType: values.salaryType,
        ...(values.salaryType === 'FIXED'
          ? { lastMonthNormalSalary: Number(values.lastMonth) }
          : { previousThreeMonthsNormalSalary: [values.month1,values.month2,values.month3].map(Number) })
      });
      setLegalCalcResults(current => ({ ...current, [employeeId]: result }));
      setSuccess('Cálculo LOTTT actualizado para ' + result.fullName + '. Revise el salario base y el período antes de utilizarlo.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo calcular los beneficios LOTTT.');
    } finally { setLegalCalcLoading(null); }
  };


  const calculateProfitSharing = async () => {
    if (profitSharingLoading || !window.sicovenStore) return;
    const supplied = Object.entries(profitSharingBases).filter(([, values]) =>
      values.monthlyNormalSalary.trim() || values.monthsWorked.trim()
    );
    if (supplied.some(([, values]) => !values.monthlyNormalSalary.trim() || !values.monthsWorked.trim())) {
      setError('Complete salario normal y meses trabajados, o deje ambos campos vacíos.');
      return;
    }
    const employeeBases = supplied.map(([employeeId, values]) => ({
      employeeId, monthlyNormalSalary: Number(values.monthlyNormalSalary), monthsWorked: Number(values.monthsWorked)
    }));
    if (!Number.isFinite(Number(profitSharingInputs.netProfits)) || Number(profitSharingInputs.netProfits) < 0 ||
        !profitSharingInputs.sourceReference.trim() || employeeBases.length === 0) {
      setError('Indique los beneficios líquidos, su fuente y las bases salariales de los trabajadores.');
      return;
    }
    setProfitSharingLoading(true); setError(''); setSuccess('');
    try {
      const result = await window.sicovenStore.calculatePayrollProfitSharing(token, {
        fiscalYearStart: profitSharingInputs.fiscalYearStart,
        fiscalYearEnd: profitSharingInputs.fiscalYearEnd,
        netProfits: Number(profitSharingInputs.netProfits),
        sourceReference: profitSharingInputs.sourceReference.trim(),
        verifiedAt: profitSharingInputs.verifiedAt,
        employees: employeeBases
      });
      setProfitSharingResult(result);
      setSuccess('Distribución de utilidades calculada con nóminas confirmadas.');
    } catch (e) {
      setProfitSharingResult(null);
      setError(e instanceof Error ? e.message : 'No se pudo calcular la distribución de utilidades.');
    } finally { setProfitSharingLoading(false); }
  };

  const postPayrollRun = async (runId: string) => {
    if (postingRun || !window.sicovenStore || !isStorageReady) return;
    setPostingRun(runId); setError(''); setSuccess('');
    try {
      const run = await window.sicovenStore.getPayrollRun(token, runId);
      if (run.status === 'CONFIRMED') {
        setSuccess('Esta nómina ya está confirmada y vinculada a su asiento contable.');
        await loadRuns();
        return;
      }
      if (run.status !== 'DRAFT') throw new Error('Solo se puede contabilizar una nómina en borrador.');
      const existingEntry = journalEntries.find(entry =>
        entry.companyId === currentCompany.id && entry.referenceDoc === 'NOM-' + run.id
      );
      const rateRecord = [...(currentCompany.accountingBcvRateHistory || [])]
        .filter(item => item.effectiveDate <= run.periodEnd && Number.isFinite(Number(item.rate)) && Number(item.rate) > 0)
        .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.recordedAt.localeCompare(a.recordedAt))[0];
      if (!rateRecord) throw new Error('No existe una tasa BCV del historial contable con vigencia igual o anterior al cierre del período. Registre la tasa desde el módulo contable; no se utilizará la tasa de Inventario.');
      const ageDays = Math.floor((Date.parse(run.periodEnd + 'T00:00:00Z') - Date.parse(rateRecord.effectiveDate + 'T00:00:00Z')) / 86400000);
      if (ageDays < 0 || ageDays > 7 || !Number.isFinite(rateRecord.rate) || rateRecord.rate <= 0) {
        throw new Error('La última tasa contable BCV disponible (' + rateRecord.effectiveDate + ') no es suficientemente próxima al período de nómina. Verifique el historial antes de contabilizar.');
      }
      const journalItems = buildPayrollJournalItems(run.totals as {
        grossEarnings: number; workerLegalDeductions: number; otherDeductions: number;
        employerContributions: number; netPay: number;
      }, accounts, rateRecord.rate);
      const journal = existingEntry || addJournalEntry({
        entryNumber: 0, date: run.periodEnd,
        description: 'Nómina ' + (run.frequency === 'WEEKLY' ? 'semanal' : 'quincenal') + ' ' + run.periodStart + ' al ' + run.periodEnd,
        type: 'MANUAL', bcvRate: rateRecord.rate, items: journalItems,
        referenceDoc: 'NOM-' + run.id,
        workpaperNote: 'Tasa BCV ' + rateRecord.rate + ' Bs/USD, vigente ' + rateRecord.effectiveDate + '. Fuente: ' + rateRecord.source + (rateRecord.note ? ' · ' + rateRecord.note : '') + '. Nómina ' + run.id + '.'
      }, accounts, currentCompany.id);
      if (!existingEntry) await waitForPersistence();
      await window.sicovenStore.confirmPayrollRun(token, run.id, journal.id);
      await loadRuns();
      setSuccess('Nómina contabilizada y confirmada. Asiento ' + journal.entryNumber + ' · Tasa BCV ' + rateRecord.rate + ' Bs/USD (' + rateRecord.effectiveDate + ').');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo contabilizar la nómina.');
    } finally { setPostingRun(null); }
  };

  const exportPayrollReceipts = async (runId: string) => {
    if (pdfRun || !window.sicovenStore) return;
    setPdfRun(runId); setError(''); setSuccess('');
    try {
      const run = await window.sicovenStore.getPayrollRun(token, runId);
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const money = (value: number) => 'Bs. ' + Number(value || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const companySnapshot = run.snapshot.companySnapshot;
      run.snapshot.employees.forEach((employee, index) => {
        if (index > 0) pdf.addPage();
        let y = 18;
        const write = (value: string, size = 10, bold = false) => {
          pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
          const rows = pdf.splitTextToSize(value, 180);
          pdf.text(rows, 15, y); y += rows.length * 5 + 2;
        };
        write(companySnapshot.name || currentCompany.name, 14, true);
        if (companySnapshot.rif || currentCompany.rif) write('RIF: ' + (companySnapshot.rif || currentCompany.rif), 9);
        if (companySnapshot.address) write(companySnapshot.address, 9);
        if (companySnapshot.phone) write('Teléfono: ' + companySnapshot.phone, 9);
        write('RECIBO DE PAGO · ' + (run.frequency === 'WEEKLY' ? 'NÓMINA SEMANAL' : 'NÓMINA QUINCENAL'), 12, true);
        write('Período: ' + run.periodStart + ' al ' + run.periodEnd, 10);
        write('Trabajador: ' + employee.fullName + ' · Cédula/RIF: ' + employee.fiscalId, 10, true);
        write('Salario base registrado: ' + money(employee.salaryRecord.baseSalary) + ' · Vigente desde: ' + employee.salaryRecord.effectiveFrom, 9);
        y += 2; pdf.line(15, y, 195, y); y += 7;
        write('ASIGNACIONES', 10, true);
        employee.earnings.forEach(line => write(line.description + ' (' + line.code + '): ' + money(line.amount), 9));
        write('Total asignaciones: ' + money(employee.grossEarnings), 10, true);
        y += 2; write('DEDUCCIONES DEL TRABAJADOR', 10, true);
        employee.contributions.filter(line => line.workerAmount > 0).forEach(line => write(line.description + ' (' + line.code + '): ' + money(line.workerAmount), 9));
        employee.deductions.forEach(line => write(line.description + ' (' + line.code + '): ' + money(line.amount), 9));
        write('Total deducciones: ' + money(employee.workerLegalDeductions + employee.otherDeductions), 10, true);
        y += 3; pdf.line(15, y, 195, y); y += 8;
        write('NETO A RECIBIR: ' + money(employee.netPay), 14, true);
        y += 6; write('Recibí conforme el importe neto indicado.', 9);
        write('Firma del trabajador: ____________________________________', 9);
        write('Fecha de recepción: ____ / ____ / ______', 9);
        y = Math.max(y, 265); pdf.setFontSize(8); pdf.setTextColor(110);
        pdf.text('Comprobante generado por SICOVEN · ' + new Date().toLocaleDateString('es-VE'), 15, Math.min(y, 285));
      });
      const dataUri = pdf.output('datauristring');
      const base64 = dataUri.slice(dataUri.indexOf(',') + 1);
      const saved = await window.sicovenStore.savePdf({ fileName: 'Recibos-Nomina-' + run.periodEnd + '.pdf', base64 });
      if (saved?.ok) setSuccess('Recibos PDF preparados para imprimir o guardar.');
      else if (!saved?.canceled) throw new Error('No se pudo guardar el PDF de recibos.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron generar los recibos PDF.');
    } finally { setPdfRun(null); }
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


  const openSeverance = async (employeeId: string) => {
    if (severanceOpen === employeeId) { setSeveranceOpen(null); return; }
    setSeveranceOpen(employeeId);
    if (severanceHistory[employeeId] || !window.sicovenStore) return;
    setSeveranceBusy(employeeId); setError('');
    try {
      const history = await window.sicovenStore.listPayrollSeveranceHistory(token, employeeId);
      setSeveranceHistory(current => ({...current,[employeeId]:history}));
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo consultar el historial de prestaciones.'); }
    finally { setSeveranceBusy(null); }
  };

  const saveSeveranceDeposit = async (employeeId: string) => {
    if (severanceBusy || !window.sicovenStore) return;
    if (!depositForm.dailyIntegralSalary.trim() || !depositForm.sourceReference.trim()) { setError('Indique el salario integral histórico y el comprobante del depósito.'); return; }
    setSeveranceBusy(employeeId); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollSeveranceDeposit(token,{employeeId,...depositForm,days:Number(depositForm.days),dailyIntegralSalary:Number(depositForm.dailyIntegralSalary)});
      const history=await window.sicovenStore.listPayrollSeveranceHistory(token,employeeId);
      setSeveranceHistory(current=>({...current,[employeeId]:history}));
      setSuccess('Registro histórico de prestaciones guardado sin alterar los anteriores.');
    } catch(e) { setError(e instanceof Error?e.message:'No se pudo guardar el depósito.'); }
    finally { setSeveranceBusy(null); }
  };

  const saveSeveranceInterest = async (employeeId: string) => {
    if (severanceBusy || !window.sicovenStore) return;
    if (!interestForm.capital.trim() || !interestForm.monthlyRate.trim() || !interestForm.sourceReference.trim() || !interestForm.modeEvidence.trim()) { setError('Indique capital mensual, tasa verificada, fuente y evidencia del régimen aplicable.'); return; }
    setSeveranceBusy(employeeId); setError(''); setSuccess('');
    try {
      await window.sicovenStore.savePayrollSeveranceInterestMonth(token,{employeeId,...interestForm,capital:Number(interestForm.capital),monthlyRate:Number(interestForm.monthlyRate)/100});
      const history=await window.sicovenStore.listPayrollSeveranceHistory(token,employeeId);
      setSeveranceHistory(current=>({...current,[employeeId]:history}));
      setSuccess('Interés mensual guardado con su fuente y verificación.');
    } catch(e) { setError(e instanceof Error?e.message:'No se pudo guardar el interés mensual.'); }
    finally { setSeveranceBusy(null); }
  };

  const calculateSeveranceForEmployee = async (employeeId: string) => {
    if (severanceBusy || !window.sicovenStore) return;
    if (!severanceCalcForm.dailyIntegralSalary.trim()) { setError('Indique el salario diario integral vigente a la fecha de corte.'); return; }
    setSeveranceBusy(employeeId); setError('');
    try {
      const result=await window.sicovenStore.calculatePayrollSeverance(token,{employeeId,asOfDate:severanceCalcForm.asOfDate,dailyIntegralSalary:Number(severanceCalcForm.dailyIntegralSalary)});
      setSeveranceResult(current=>({...current,[employeeId]:result as Record<string,unknown>}));
    } catch(e) { setSeveranceResult(current=>({...current,[employeeId]:{error:e instanceof Error?e.message:'No se pudo calcular las prestaciones.'}})); }
    finally { setSeveranceBusy(null); }
  };

  const calculateInterestForEmployee = async (employeeId: string) => {
    if (severanceBusy || !window.sicovenStore) return;
    setSeveranceBusy(employeeId); setError('');
    try {
      const result=await window.sicovenStore.calculatePayrollSeveranceInterest(token,{employeeId,mode:interestForm.mode});
      setInterestResult(current=>({...current,[employeeId]:result as Record<string,unknown>}));
    } catch(e) { setError(e instanceof Error?e.message:'No se pudo calcular los intereses.'); }
    finally { setSeveranceBusy(null); }
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
                <button type="button" onClick={() => setLegalCalcOpen(current => current === employee.id ? null : employee.id)} className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50">{legalCalcOpen === employee.id ? 'Cerrar cálculos' : 'Cálculos LOTTT'}</button>
                <button type="button" onClick={() => void openSeverance(employee.id)} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-50">{severanceOpen === employee.id ? 'Cerrar prestaciones' : 'Prestaciones e intereses'}</button>
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

            {severanceOpen === employee.id && <div className="mt-3 space-y-4 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div><p className="font-semibold text-slate-800">Prestaciones sociales e intereses · LOTTT arts. 142 y 143</p><p className="text-xs text-slate-600">Registre cada depósito con los días y el salario integral histórico del momento. Los registros son inmutables; las correcciones se agregan como rectificaciones. No se estiman datos faltantes.</p></div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <label className="space-y-1 text-xs text-slate-700">Fecha del depósito<input type="date" value={depositForm.depositDate} onChange={e=>setDepositForm(v=>({...v,depositDate:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                <label className="space-y-1 text-xs text-slate-700">Tipo<select value={depositForm.kind} onChange={e=>setDepositForm(v=>({...v,kind:e.target.value as typeof v.kind}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"><option value="QUARTERLY">Garantía trimestral</option><option value="SENIORITY">Adicional por antigüedad</option><option value="ADVANCE">Anticipo pagado</option></select></label>
                <label className="space-y-1 text-xs text-slate-700">Días reconocidos<input type="number" min="0.01" step="0.01" value={depositForm.days} onChange={e=>setDepositForm(v=>({...v,days:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                <label className="space-y-1 text-xs text-slate-700">Salario diario integral histórico (Bs.)<input type="number" min="0.01" step="0.01" value={depositForm.dailyIntegralSalary} onChange={e=>setDepositForm(v=>({...v,dailyIntegralSalary:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                <label className="space-y-1 text-xs text-slate-700 sm:col-span-2">Comprobante / fuente<input value={depositForm.sourceReference} onChange={e=>setDepositForm(v=>({...v,sourceReference:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2" placeholder="Referencia bancaria, fideicomiso o recibo"/></label>
                <label className="space-y-1 text-xs text-slate-700">Verificado el<input type="date" value={depositForm.verifiedAt} onChange={e=>setDepositForm(v=>({...v,verifiedAt:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
              </div>
              <button type="button" onClick={()=>void saveSeveranceDeposit(employee.id)} disabled={severanceBusy===employee.id} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar depósito histórico</button>
              <div className="border-t border-amber-200 pt-3"><p className="mb-2 text-xs font-bold text-slate-700">Intereses mensuales (art. 143)</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="space-y-1 text-xs text-slate-700">Mes<input type="month" value={interestForm.month} onChange={e=>setInterestForm(v=>({...v,month:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                  <label className="space-y-1 text-xs text-slate-700">Régimen<select value={interestForm.mode} onChange={e=>setInterestForm(v=>({...v,mode:e.target.value as typeof v.mode}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"><option value="TRUST_OR_FUND">Fideicomiso o fondo</option><option value="AUTHORIZED_BOOK_CREDIT">Abono contable autorizado</option><option value="UNDEPOSITED">No depositado</option></select></label>
                  <label className="space-y-1 text-xs text-slate-700">Capital del mes (Bs.)<input type="number" min="0" step="0.01" value={interestForm.capital} onChange={e=>setInterestForm(v=>({...v,capital:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                  <label className="space-y-1 text-xs text-slate-700">Tasa mensual (%)<input type="number" min="0" max="100" step="0.0001" value={interestForm.monthlyRate} onChange={e=>setInterestForm(v=>({...v,monthlyRate:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                  <label className="space-y-1 text-xs text-slate-700 sm:col-span-2">Evidencia del régimen (autorización escrita o referencia de seis bancos)<input value={interestForm.modeEvidence} onChange={e=>setInterestForm(v=>({...v,modeEvidence:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2" placeholder="Indique la autorización o base bancaria"/></label><label className="space-y-1 text-xs text-slate-700 sm:col-span-2">Fuente de tasa verificada<input value={interestForm.sourceReference} onChange={e=>setInterestForm(v=>({...v,sourceReference:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2" placeholder="BCV, banco, fideicomiso o fondo"/></label>
                  <label className="space-y-1 text-xs text-slate-700">Verificada el<input type="date" value={interestForm.verifiedAt} onChange={e=>setInterestForm(v=>({...v,verifiedAt:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label>
                </div>
                <div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>void saveSeveranceInterest(employee.id)} disabled={severanceBusy===employee.id} className="rounded-lg bg-amber-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Guardar interés del mes</button><button type="button" onClick={()=>void calculateInterestForEmployee(employee.id)} disabled={severanceBusy===employee.id} className="rounded-lg border border-amber-400 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">Calcular intereses registrados</button></div>
                {interestResult[employee.id] && <p className="mt-2 text-sm font-semibold text-slate-800">Intereses acumulados registrados: Bs. {Number(interestResult[employee.id].totalInterest||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p>}
              </div>
              <div className="border-t border-amber-200 pt-3"><p className="mb-2 text-xs font-bold text-slate-700">Comparar garantía y terminación (art. 142)</p>
                <div className="grid gap-2 sm:grid-cols-2"><label className="space-y-1 text-xs text-slate-700">Fecha de corte<input type="date" value={severanceCalcForm.asOfDate} onChange={e=>setSeveranceCalcForm(v=>({...v,asOfDate:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label><label className="space-y-1 text-xs text-slate-700">Salario diario integral a la fecha (Bs.)<input type="number" min="0.01" step="0.01" value={severanceCalcForm.dailyIntegralSalary} onChange={e=>setSeveranceCalcForm(v=>({...v,dailyIntegralSalary:e.target.value}))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/></label></div>
                <button type="button" onClick={()=>void calculateSeveranceForEmployee(employee.id)} disabled={severanceBusy===employee.id} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Calcular prestaciones</button>
                {severanceResult[employee.id] && <div className="mt-2 rounded-lg bg-white p-3 text-sm">{severanceResult[employee.id].error ? <p className="text-rose-700">{String(severanceResult[employee.id].error)}</p> : <div className="grid gap-2 sm:grid-cols-2"><p>Garantía histórica: <strong>Bs. {Number(severanceResult[employee.id].guaranteeAmount||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></p><p>Terminación: <strong>Bs. {Number(severanceResult[employee.id].terminationAmount||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></p><p>Mayor importe legal: <strong>Bs. {Number(severanceResult[employee.id].greaterAmount||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></p><p>Anticipos: <strong>Bs. {Number(severanceResult[employee.id].advanceTotal||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></p><p>Saldo luego de anticipos: <strong>Bs. {Number(severanceResult[employee.id].netAfterAdvances||0).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</strong></p></div>}</div>}
              </div>
              <div className="border-t border-amber-200 pt-3"><p className="text-xs font-bold text-slate-700">Historial vigente · Depósitos {severanceHistory[employee.id]?.deposits.length||0} · Meses de intereses {severanceHistory[employee.id]?.interests.length||0}</p>
                {(severanceHistory[employee.id]?.deposits||[]).map((item:any)=><p key={String(item.id)} className="mt-1 text-xs text-slate-600">{String(item.depositDate)} · {String(item.kind)} · {Number(item.days)} días × Bs. {Number(item.dailyIntegralSalary).toFixed(2)} · Bs. {Number(item.amount).toFixed(2)} · {String(item.sourceReference)}</p>)}
                {(severanceHistory[employee.id]?.interests||[]).map((item:any)=><p key={String(item.id)} className="mt-1 text-xs text-slate-600">{String(item.month)} · {String(item.mode)} · tasa {(Number(item.monthlyRate)*100).toFixed(4)}% · interés Bs. {Number(item.interest).toFixed(2)} · {String(item.sourceReference)}</p>)}
              </div>
            </div>}
            {legalCalcOpen === employee.id && <div className="mt-3 space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div><p className="font-semibold text-slate-800">Vacaciones, bono vacacional y utilidades</p><p className="text-xs text-slate-600">Cálculo bajo LOTTT. Introduzca el salario normal aplicable; el salario contractual semanal/quincenal no se convierte automáticamente.</p></div>
              {(() => {
                const values = legalCalcInputs[employee.id] || {
                  salaryType: 'FIXED' as const, lastMonth: '', month1: '', month2: '', month3: '',
                  asOfDate: new Date().toISOString().slice(0,10), fiscalYearStart: new Date().getFullYear() + '-01-01'
                };
                const setField = <K extends keyof typeof values,>(field: K, value: (typeof values)[K]) => setLegalCalcInputs(current => ({
                  ...current, [employee.id]: { ...values, [field]: value }
                }));
                const result = legalCalcResults[employee.id];
                return <>
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="space-y-1 text-xs font-medium text-slate-700">Tipo de salario
                      <select value={values.salaryType} onChange={e=>setField('salaryType',e.target.value as 'FIXED'|'VARIABLE')} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2">
                        <option value="FIXED">Fijo</option><option value="VARIABLE">Variable (comisión/destajo)</option>
                      </select>
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-700">Fecha de cálculo
                      <input type="date" value={values.asOfDate} onChange={e=>setField('asOfDate',e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/>
                    </label>
                    <label className="space-y-1 text-xs font-medium text-slate-700">Inicio del ejercicio
                      <input type="date" value={values.fiscalYearStart} onChange={e=>setField('fiscalYearStart',e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2"/>
                    </label>
                  </div>
                  {values.salaryType === 'FIXED'
                    ? <label className="block max-w-sm space-y-1 text-xs font-medium text-slate-700">Salario normal del mes anterior (Bs.)
                        <input type="number" min="0.01" step="0.01" value={values.lastMonth} onChange={e=>setField('lastMonth',e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/>
                      </label>
                    : <div className="grid gap-2 sm:grid-cols-3">{(['month1','month2','month3'] as const).map((field,index)=><label key={field} className="space-y-1 text-xs font-medium text-slate-700">Mes anterior {index+1} (Bs.)
                        <input type="number" min="0.01" step="0.01" value={values[field]} onChange={e=>setField(field,e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"/>
                      </label>)}</div>}
                  <button type="button" onClick={()=>void calculateAnnualRights(employee.id)} disabled={legalCalcLoading===employee.id} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{legalCalcLoading===employee.id?'Calculando…':'Calcular beneficios'}</button>
                  {result && <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Vacaciones · {result.vacationDays} días</p><p className="font-bold text-slate-900">Bs. {result.vacationPay.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Bono vacacional · {result.vacationBonusDays} días</p><p className="font-bold text-slate-900">Bs. {result.vacationBonus.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Utilidades · mínimo ({result.profitSharingMinimumDays} días)</p><p className="font-bold text-slate-900">Bs. {result.profitSharingMinimum.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Utilidades · máximo ({result.profitSharingMaximumDays} días)</p><p className="font-bold text-slate-900">Bs. {result.profitSharingMaximum.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Salario normal diario aplicado</p><p className="font-bold text-slate-900">Bs. {result.salaryBasis.dailySalary.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    <div className="rounded-lg border border-slate-200 bg-white p-3"><p className="text-xs text-slate-500">Antigüedad</p><p className="font-bold text-slate-900">{result.completedYears} años · {result.monthsInFiscalYear} meses del ejercicio</p></div>
                  </div>}
                  <p className="text-xs text-slate-500">Base: LOTTT arts. 121, 131, 190 y 192. El importe real de utilidades depende de la participación en beneficios líquidos y su distribución; este cálculo muestra el mínimo y máximo individual, no inventa el beneficio de la empresa.</p>
                </>;
              })()}
            </div>}
          </div>)}</div>}
      </section>
    </div>


    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="font-bold text-slate-900">Distribución anual de utilidades</h2>
        <p className="mt-1 text-xs text-slate-600">Aplica el 15% de los beneficios líquidos y distribuye proporcionalmente según salarios devengados en nóminas confirmadas. Excluye borradores y conceptos no salariales.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs font-medium text-slate-700">Inicio del ejercicio
          <input type="date" value={profitSharingInputs.fiscalYearStart} onChange={e=>setProfitSharingInputs(v=>({...v,fiscalYearStart:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">Cierre del ejercicio
          <input type="date" value={profitSharingInputs.fiscalYearEnd} onChange={e=>setProfitSharingInputs(v=>({...v,fiscalYearEnd:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">Beneficios líquidos declarados (Bs.)
          <input type="number" min="0" step="0.01" value={profitSharingInputs.netProfits} onChange={e=>setProfitSharingInputs(v=>({...v,netProfits:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700">Verificados el
          <input type="date" value={profitSharingInputs.verifiedAt} onChange={e=>setProfitSharingInputs(v=>({...v,verifiedAt:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
        </label>
        <label className="space-y-1 text-xs font-medium text-slate-700 sm:col-span-2 lg:col-span-4">Fuente de beneficios líquidos
          <input maxLength={300} value={profitSharingInputs.sourceReference} onChange={e=>setProfitSharingInputs(v=>({...v,sourceReference:e.target.value}))} placeholder="Ej. Declaración ISLR o estados financieros del ejercicio" className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
        </label>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-700">Salario normal mensual y meses completos trabajados</p>
        {employees.map(employee => {
          const values = profitSharingBases[employee.id] || {monthlyNormalSalary:'',monthsWorked:''};
          return <div key={employee.id} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_1fr_1fr] sm:items-center">
            <div><p className="text-sm font-semibold text-slate-800">{employee.fullName}</p><p className="text-xs text-slate-500">{employee.fiscalId}{employee.active?'':' · Inactivo'}</p></div>
            <label className="space-y-1 text-xs text-slate-600">Salario normal mensual (Bs.)
              <input type="number" min="0.01" step="0.01" value={values.monthlyNormalSalary} onChange={e=>setProfitSharingBases(v=>({...v,[employee.id]:{...values,monthlyNormalSalary:e.target.value}}))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
            </label>
            <label className="space-y-1 text-xs text-slate-600">Meses completos (1–12)
              <input type="number" min="1" max="12" step="1" value={values.monthsWorked} onChange={e=>setProfitSharingBases(v=>({...v,[employee.id]:{...values,monthsWorked:e.target.value}}))} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"/>
            </label>
          </div>;
        })}
      </div>
      <button type="button" onClick={()=>void calculateProfitSharing()} disabled={profitSharingLoading || loading || employees.length===0} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
        <Calculator size={16}/>{profitSharingLoading?'Calculando…':'Calcular distribución legal'}
      </button>
      {profitSharingResult && <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Fondo legal · 15%</p><p className="font-bold text-slate-900">Bs. {profitSharingResult.distributableFund.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
          <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Total a distribuir</p><p className="font-bold text-slate-900">Bs. {profitSharingResult.totalPayable.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
          <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Diferencia patronal por mínimos</p><p className="font-bold text-slate-900">Bs. {profitSharingResult.employerShortfall.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
          <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">Excedente no distribuido</p><p className="font-bold text-slate-900">Bs. {profitSharingResult.undistributedRemainder.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
        </div>
        <div className="divide-y divide-slate-200 rounded-lg bg-white">
          {profitSharingResult.employees.map(item=><div key={item.employeeId} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div><p className="font-semibold text-slate-800">{item.fullName}</p><p className="text-xs text-slate-500">Salarios devengados: Bs. {item.wagesEarned.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})} · Proporción: Bs. {item.proportionalShare.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
            <div className="text-right"><p className="font-bold text-slate-900">Bs. {item.amount.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</p><p className="text-xs text-slate-500">Mín. {item.minimumDays} días · Máx. {item.maximumDays} días</p></div>
          </div>)}
        </div>
        <p className="text-xs text-slate-600">Fuente: {profitSharingResult.sourceReference} · Verificada: {profitSharingResult.verifiedAt}. {profitSharingResult.salaryEvidence} La diferencia patronal y el excedente quedan identificados sin redistribución arbitraria.</p>
      </div>}
    </section>

    <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-bold text-slate-900">Configurar obligaciones legales de esta empresa</summary>
      <p className="mt-2 text-xs text-slate-600">Configuración única por empresa. Registre cada obligación por separado, con su base, periodicidad, vigencia y fuente. Las tasas se expresan en porcentaje; no se aplican valores supuestos ni reglas de otra empresa.</p>
      <div className="mt-3 space-y-2">
        {legalRules.length === 0 ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">No hay reglas legales activas. Los borradores no aplicarán retenciones ni aportes hasta que registre las reglas verificadas.</p> :
          legalRules.map(rule=><div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-xs">
            <div><p className="font-bold text-slate-800">{rule.code} · {rule.description} {rule.active ? '' : '(inactiva)'}</p>
              <p className="text-slate-600">Base: {rule.base} · Periodicidad: {rule.frequencyScope==='ALL'?'Semanal y quincenal':rule.frequencyScope==='WEEKLY'?'Semanal':'Quincenal'} · Trabajador: {(rule.workerRate*100).toFixed(3)}% · Patrono: {(rule.employerRate*100).toFixed(3)}%</p>
              <p className="text-slate-500">Vigencia: {rule.effectiveFrom} – {rule.effectiveTo || 'abierta'} · Verificada: {rule.verifiedAt}</p>
            </div>
            {rule.active && <div className="flex gap-2">
              <button type="button" onClick={()=>editLegalRule(rule)} className="rounded-lg border border-slate-300 px-2.5 py-1.5 font-semibold text-slate-700">Editar</button>
              <button type="button" onClick={()=>void deactivateLegalRule(rule)} disabled={savingRule} className="rounded-lg border border-rose-200 px-2.5 py-1.5 font-semibold text-rose-700 disabled:opacity-50">Desactivar</button>
            </div>}
          </div>)}
      </div>
      <form onSubmit={saveLegalRule} className="mt-4 space-y-3 border-t border-slate-200 pt-4">
        <h3 className="font-semibold text-slate-800">{editingRuleId ? 'Editar regla legal' : 'Agregar regla legal'}</h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="space-y-1 text-xs font-medium text-slate-700">Código
            <input required maxLength={60} value={ruleForm.code} onChange={e=>setRuleForm(v=>({...v,code:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Descripción
            <input required maxLength={240} value={ruleForm.description} onChange={e=>setRuleForm(v=>({...v,description:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Base
            <select value={ruleForm.base} onChange={e=>setRuleForm(v=>({...v,base:e.target.value as 'normalSalary'|'integralSalary'|'grossSalary'}))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="normalSalary">Salario normal</option><option value="integralSalary">Salario integral</option><option value="grossSalary">Salario bruto</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Se aplica a
            <select value={ruleForm.frequencyScope} onChange={e=>setRuleForm(v=>({...v,frequencyScope:e.target.value as 'ALL'|'WEEKLY'|'BIWEEKLY'}))} className="w-full rounded-lg border border-slate-300 px-3 py-2">
              <option value="ALL">Semanal y quincenal</option><option value="WEEKLY">Solo semanal</option><option value="BIWEEKLY">Solo quincenal</option>
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Retención trabajador (%)
            <input required type="number" min="0" max="100" step="0.001" value={ruleForm.workerRate} onChange={e=>setRuleForm(v=>({...v,workerRate:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Aporte patronal (%)
            <input required type="number" min="0" max="100" step="0.001" value={ruleForm.employerRate} onChange={e=>setRuleForm(v=>({...v,employerRate:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Tope de base por período (Bs., opcional)
            <input type="number" min="0" step="0.01" value={ruleForm.baseCap} onChange={e=>setRuleForm(v=>({...v,baseCap:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Vigente desde
            <input required type="date" value={ruleForm.effectiveFrom} onChange={e=>setRuleForm(v=>({...v,effectiveFrom:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Vigente hasta (opcional)
            <input type="date" value={ruleForm.effectiveTo} onChange={e=>setRuleForm(v=>({...v,effectiveTo:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700">Verificada el
            <input required type="date" value={ruleForm.verifiedAt} onChange={e=>setRuleForm(v=>({...v,verifiedAt:e.target.value}))} className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-700 sm:col-span-2 lg:col-span-3">Fuente normativa y referencia
            <input required maxLength={1000} value={ruleForm.sourceReference} onChange={e=>setRuleForm(v=>({...v,sourceReference:e.target.value}))} placeholder="Ley, artículo, Gaceta Oficial o fuente oficial consultada" className="w-full rounded-lg border border-slate-300 px-3 py-2"/>
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled={savingRule} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{savingRule?'Guardando…':editingRuleId?'Guardar cambios':'Guardar regla'}</button>
          {editingRuleId && <button type="button" onClick={()=>{setEditingRuleId(null);setRuleForm(current=>({...current,code:'',description:'',workerRate:'',employerRate:'',baseCap:'',effectiveTo:'',sourceReference:''}));}} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700">Cancelar edición</button>}
        </div>
      </form>
    </details>

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
          {requiredBaseFields.size > 0
            ? 'Hay reglas legales vigentes para este período. Indique únicamente las bases que esas reglas necesitan; no se asumirán equivalencias salariales.'
            : 'No hay reglas legales vigentes para este período. Solo debe indicar la asignación; no se inventarán retenciones ni aportes.'}
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
                    ['earning','Asignación del período',true],
                    ['normal','Base salario normal',requiredBaseFields.has('normalSalary')],
                    ['integral','Base salario integral',requiredBaseFields.has('integralSalary')],
                    ['gross','Base salario bruto',requiredBaseFields.has('grossSalary')]
                  ] as const).filter(([, , required]) => required).map(([field,label])=><label key={field} className="space-y-1 text-xs font-medium text-slate-600">{label} (Bs.)
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
            <div className="flex flex-wrap items-center gap-2">
              <span className={run.status==='CONFIRMED'?'rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800':'rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800'}>{run.status==='CONFIRMED'?'Confirmada':run.status==='VOIDED'?'Anulada':'Borrador'}</span>
              <button type="button" onClick={() => void exportPayrollReceipts(run.id)} disabled={pdfRun===run.id || run.status==='VOIDED'} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold text-slate-700 disabled:opacity-50"><Printer size={14}/>{pdfRun===run.id?'Generando…':'Recibos PDF'}</button>
              {run.status==='DRAFT' && <button type="button" onClick={() => void postPayrollRun(run.id)} disabled={postingRun!==null} className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"><BookCheck size={14}/>{postingRun===run.id?'Contabilizando…':'Contabilizar y confirmar'}</button>}
            </div>
          </div>)}</div>}
      </div>
    </section>
    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
      Los borradores conservan sus bases y reglas aplicadas. La confirmación genera un asiento balanceado en ambas monedas con la tasa BCV histórica del período; los recibos PDF incluyen asignaciones, deducciones y neto por trabajador.
    </div>
  </div>;
};
