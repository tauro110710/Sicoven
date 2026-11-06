import React, { useMemo, useState } from 'react';
import type { BankAccount } from '../../types/accounting';
import { useAccounting } from '../../context/AccountingContext';
import { isDuplicateBankStatementMovement } from '../../types/bankStatementMatching';
import {
  type BankStatementImportCandidate,
  normalizeBankStatementRows,
  parseBankStatementCsv,
  parseBankStatementXlsx,
  parseOfxBankStatement
} from '../../types/bankStatementImport';
import { X, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  bankAccount: BankAccount;
}

export const BankStatementImportModal: React.FC<Props> = ({ isOpen, onClose, bankAccount }) => {
  const { bankStatementMovements, addBankStatementMovements } = useAccounting();
  const [fileName,setFileName]=useState('');
  const [candidates,setCandidates]=useState<BankStatementImportCandidate[]>([]);
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [feedback,setFeedback]=useState('');
  const invalidCount=useMemo(()=>candidates.filter(row=>row.errors.length>0).length,[candidates]);
  if(!isOpen)return null;

  const handleFile=async(file?:File)=>{
    if(!file)return;
    setLoading(true);setFeedback('');setCandidates([]);setFileName(file.name);
    try{
      if(file.size===0||file.size>10*1024*1024)throw new Error('El archivo debe tener contenido y no superar 10 MB.');
      const extension=file.name.toLowerCase().split('.').pop();
      let rows:Record<string,unknown>[]=[],currency=bankAccount.currency;
      if(extension==='csv')rows=parseBankStatementCsv(await file.text());
      else if(extension==='xlsx')rows=await parseBankStatementXlsx(await file.arrayBuffer());
      else if(extension==='ofx'){
        const parsed=parseOfxBankStatement(await file.text());
        rows=parsed.rows;currency=parsed.currency;
      }else throw new Error('Formato no admitido. Seleccione CSV, Excel .xlsx u OFX.');
      const normalized=normalizeBankStatementRows(rows,currency);
      const existing=bankStatementMovements.filter(row=>row.bankAccountId===bankAccount.id);
      const seen=[...existing];
      const reviewed=normalized.map(row=>{
        const errors=[...row.errors];
        if(row.currency!==bankAccount.currency)errors.push('La moneda del archivo no coincide con la moneda de la cuenta bancaria seleccionada.');
        const duplicate=isDuplicateBankStatementMovement({
          existing:seen,
          candidate:{bankAccountId:bankAccount.id,date:row.date,reference:row.reference,type:row.type,amountBs:row.amountBs,amountUsd:row.amountUsd}
        });
        if(duplicate)errors.push('Movimiento duplicado: ya existe en SQLite o aparece repetido en el archivo.');
        else if(errors.length===0)seen.push({bankAccountId:bankAccount.id,date:row.date,reference:row.reference,type:row.type,amountBs:row.amountBs,amountUsd:row.amountUsd} as typeof seen[number]);
        return {...row,errors};
      });
      if(reviewed.length===0)throw new Error('No se encontraron movimientos en el archivo.');
      setCandidates(reviewed);
      setFeedback(reviewed.every(row=>row.errors.length===0)?'Previsualización validada. Ningún movimiento se ha guardado todavía.':`Hay ${reviewed.filter(row=>row.errors.length===0).length} fila(s) válidas y ${reviewed.filter(row=>row.errors.length>0).length} con observaciones. Corrija el archivo antes de confirmar.`);
    }catch(error){setFeedback(error instanceof Error?error.message:'No se pudo leer el extracto.');}
    finally{setLoading(false);}
  };

  const confirmImport=async()=>{
    if(saving||!candidates.length||invalidCount>0)return;
    setSaving(true);setFeedback('');
    try{
      await addBankStatementMovements(candidates.map(row=>({
        bankAccountId:bankAccount.id,date:row.date,reference:row.reference,description:row.description,
        type:row.type,amountBs:row.amountBs,amountUsd:row.amountUsd,bcvRate:row.bcvRate,
        bcvRateEffectiveDate:row.bcvRateEffectiveDate
      })));
      setFeedback(`SQLite confirmó la importación de ${candidates.length} movimiento(s).`);
      setCandidates([]);
      setFileName('');
    }catch(error){setFeedback(error instanceof Error?error.message:'No se pudo confirmar la importación. No se guardó el lote.');}
    finally{setSaving(false);}
  };

  return <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-3">
    <section role="dialog" aria-modal="true" aria-labelledby="bank-import-title" className="w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl flex flex-col">
      <header className="flex items-center justify-between gap-3 bg-slate-900 px-5 py-4 text-white">
        <div><h2 id="bank-import-title" className="font-bold">Importar extracto bancario</h2><p className="text-xs text-slate-300">{bankAccount.bankName} · {bankAccount.accountNumber} · {bankAccount.currency}</p></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Cerrar" className="rounded-lg p-2 hover:bg-slate-700 disabled:opacity-40"><X className="h-5 w-5"/></button>
      </header>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
          Cargue un archivo CSV, Excel (.xlsx) u OFX. Cada movimiento debe contener fecha, referencia, descripción, naturaleza, importe, tasa BCV histórica y fecha de vigencia de esa tasa. En OFX se leen las extensiones EXCHANGERATE y EXCHANGERATEDATE. No se inventan tasas faltantes.
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-sky-400">
          <Upload className="h-7 w-7 text-slate-500"/>
          <span className="text-sm font-semibold text-slate-800">{loading?'Leyendo archivo…':fileName||'Seleccionar archivo de extracto'}</span>
          <span className="text-xs text-slate-500">CSV · XLSX · OFX · máximo 10 MB</span>
          <input type="file" accept=".csv,.xlsx,.ofx" disabled={loading||saving} className="sr-only" onChange={e=>{void handleFile(e.target.files?.[0]);e.currentTarget.value='';}}/>
        </label>
        {candidates.length>0&&<div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-slate-900">Previsualización · {candidates.length} movimientos</h3><div className="flex items-center gap-2 text-xs"><span className="text-emerald-700">{candidates.length-invalidCount} válidos</span><span className="text-rose-700">{invalidCount} con errores</span></div></div>
          <div className="max-h-[42vh] overflow-auto rounded-xl border border-slate-200">
            <table className="w-full min-w-[1050px] text-left text-xs">
              <thead className="sticky top-0 bg-slate-100 text-slate-600"><tr><th className="p-2">Fila</th><th className="p-2">Fecha</th><th className="p-2">Referencia</th><th className="p-2">Descripción</th><th className="p-2">Naturaleza</th><th className="p-2">Bs.</th><th className="p-2">USD</th><th className="p-2">Tasa BCV</th><th className="p-2">Estado</th></tr></thead>
              <tbody>{candidates.map(row=><tr key={row.rowNumber} className="border-t align-top"><td className="p-2">{row.rowNumber}</td><td className="p-2 whitespace-nowrap">{row.date||'—'}</td><td className="p-2 font-mono">{row.reference||'—'}</td><td className="p-2">{row.description||'—'}</td><td className="p-2">{row.type==='CREDIT'?'Crédito':'Débito'}</td><td className="p-2 text-right">{row.amountBs.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2})}</td><td className="p-2 text-right">{row.amountUsd.toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:6})}</td><td className="p-2 text-right">{Number.isFinite(row.bcvRate)?row.bcvRate.toLocaleString('es-VE',{maximumFractionDigits:6}):'—'}<span className="block text-slate-400">{row.bcvRateEffectiveDate||'—'}</span></td><td className="p-2">{row.errors.length?<span className="inline-flex max-w-[260px] gap-1 text-rose-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0"/>{row.errors.join(' ')}</span>:<span className="inline-flex gap-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5"/>Válido</span>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>}
        {feedback&&<p role="status" className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{feedback}</p>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
        <p className="text-xs text-slate-500">La confirmación es atómica: si una fila es inválida o duplicada, no se importa ninguna.</p>
        <div className="flex gap-2"><button type="button" onClick={onClose} disabled={saving} className="rounded-lg border px-4 py-2 text-xs font-semibold">Cancelar</button><button type="button" onClick={()=>void confirmImport()} disabled={saving||loading||!candidates.length||invalidCount>0} className="rounded-lg bg-emerald-700 px-4 py-2 text-xs font-bold text-white disabled:opacity-40">{saving?'Guardando en SQLite…':`Confirmar ${candidates.length} movimiento(s)`}</button></div>
      </footer>
    </section>
  </div>;
};
