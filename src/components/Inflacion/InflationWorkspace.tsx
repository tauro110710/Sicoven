import React,{useState} from 'react';
import {InflationIndexView} from './InflationIndexView';
import {InflationClassificationView} from './InflationClassificationView';
export const InflationWorkspace:React.FC<{token:string;userRole:string}>=({token,userRole})=>{
 const [section,setSection]=useState<'indexes'|'classifications'>('indexes');
 return <div className="space-y-4">
  <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
   <button type="button" onClick={()=>setSection('indexes')} className={section==='indexes'?'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white':'rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100'}>Índices y fuentes</button>
   <button type="button" onClick={()=>setSection('classifications')} className={section==='classifications'?'rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white':'rounded-lg px-4 py-2 text-sm text-slate-700 hover:bg-slate-100'}>Clasificación monetaria</button>
  </div>
  {section==='indexes'?<InflationIndexView token={token}/>:<InflationClassificationView token={token} userRole={userRole}/>}
 </div>;
};
