import type { Account, BankAccount, BankStatementMovement, JournalEntryItem, VatWithholdingDeclaration } from './accounting';
import { isValidIsoDate } from './migrationParsing';

export interface VatPaymentAccountingPlan {
  date: string; amountBs: number; amountUsd: number; liabilityUsd: number; fxDifferenceUsd: number; bcvRate: number; items: JournalEntryItem[];
}
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const micros = (n: number) => Math.round((n + Number.EPSILON) * 1000000) / 1000000;

/** Cancela el pasivo a su costo histórico USD y reconoce la diferencia cambiaria realizada. */
export function buildVatPaymentAccountingPlan(input: {
  occurredAt: string; amountBs: number; priorPaidBs: number; declaration: VatWithholdingDeclaration;
  movements: BankStatementMovement[]; bankAccounts: BankAccount[]; accounts: Account[];
}): VatPaymentAccountingPlan {
  const date = String(input.occurredAt || '').slice(0, 10);
  if (!isValidIsoDate(date)) throw new Error('La fecha del enteramiento no es válida para el asiento contable.');
  if (!input.movements.length) throw new Error('El enteramiento requiere débitos bancarios vinculados.');
  const d = input.declaration;
  if (!Number.isFinite(d.totalWithheldUsd) || Number(d.totalWithheldUsd) <= 0 || d.totalWithheldBs <= 0 ||
      d.voucherSnapshots.some(v => !Number.isFinite(v.vatWithheldUsd) || Number(v.vatWithheldUsd) < 0 || !Number.isFinite(v.bcvRate) || Number(v.bcvRate) <= 0)) {
    throw new Error('La declaración no conserva la base USD histórica completa del pasivo; requiere revisión y no admite contabilización automática.');
  }
  const amountBs = cents(input.amountBs), priorPaidBs = cents(input.priorPaidBs);
  const cumulativeBs = cents(priorPaidBs + amountBs);
  if (amountBs <= 0 || cumulativeBs > cents(d.totalWithheldBs) + 0.0001) throw new Error('El importe acumulado del enteramiento excede el pasivo declarado.');
  const cumulativeUsd = Math.abs(cumulativeBs - cents(d.totalWithheldBs)) < 0.0001
    ? micros(Number(d.totalWithheldUsd)) : micros(Number(d.totalWithheldUsd) * cumulativeBs / Number(d.totalWithheldBs));
  const priorUsd = micros(Number(d.totalWithheldUsd) * priorPaidBs / Number(d.totalWithheldBs));
  const liabilityUsd = micros(cumulativeUsd - priorUsd);
  const liability = input.accounts.find(a => a.code === '2.1.2.03' && a.type === 'PASIVO' && a.isMovement);
  if (!liability) throw new Error('No está disponible la cuenta de movimiento 2.1.2.03 para retenciones de IVA por enterar.');
  const groups = new Map<string,{bank:BankAccount;bs:number;usd:number}>();
  for (const m of input.movements) {
    if (m.type !== 'DEBIT') throw new Error('Solo los débitos bancarios pueden respaldar el enteramiento de IVA.');
    const bank = input.bankAccounts.find(x => x.id === m.bankAccountId && x.companyId === m.companyId);
    if (!bank || bank.currency !== 'BS') throw new Error('La contrapartida bancaria del enteramiento debe ser una cuenta en bolívares.');
    if (!input.accounts.some(x => x.code === bank.accountCode && x.type === 'ACTIVO' && x.isMovement)) throw new Error('La cuenta contable bancaria ' + bank.accountCode + ' no existe o no acepta movimientos.');
    const bs=Number(m.amountBs), usd=Number(m.amountUsd);
    if (!Number.isFinite(bs)||bs<=0||!Number.isFinite(usd)||usd<=0) throw new Error('El débito bancario ' + m.reference + ' no tiene equivalentes históricos positivos en Bs. y USD.');
    const g=groups.get(bank.accountCode)||{bank,bs:0,usd:0}; g.bs+=bs;g.usd+=usd;groups.set(bank.accountCode,g);
  }
  const bankBs=cents([...groups.values()].reduce((s,g)=>s+g.bs,0));
  const amountUsd=micros([...groups.values()].reduce((s,g)=>s+g.usd,0));
  if (Math.abs(bankBs-amountBs)>=0.01) throw new Error('Los débitos bancarios no coinciden exactamente con el importe en bolívares del pago fiscal.');
  const diff=micros(amountUsd-liabilityUsd);
  const items:JournalEntryItem[]=[{accountCode:liability.code,accountName:liability.name,debitBs:amountBs,creditBs:0,debitUsd:liabilityUsd,creditUsd:0,description:'Cancelación del pasivo IVA a su valor USD histórico'}];
  for(const [code,g] of groups){const ac=input.accounts.find(x=>x.code===code)!;items.push({accountCode:code,accountName:ac.name,debitBs:0,creditBs:cents(g.bs),debitUsd:0,creditUsd:micros(g.usd),description:'Débito bancario '+g.bank.bankName+' · '+g.bank.accountNumber});}
  if(diff>0){const ac=input.accounts.find(x=>x.code==='4.2.1.01'&&x.type==='INGRESOS'&&x.isMovement);if(!ac)throw new Error('Falta la cuenta de movimiento 4.2.1.01 para ganancia por diferencial cambiario.');items.push({accountCode:ac.code,accountName:ac.name,debitBs:0,creditBs:0,debitUsd:0,creditUsd:diff,description:'Ganancia por diferencial cambiario en enteramiento IVA'});}
  if(diff<0){const ac=input.accounts.find(x=>x.code==='6.1.1.08'&&x.type==='GASTOS'&&x.isMovement);if(!ac)throw new Error('Falta la cuenta de movimiento 6.1.1.08 para pérdida por diferencial cambiario.');items.push({accountCode:ac.code,accountName:ac.name,debitBs:0,creditBs:0,debitUsd:Math.abs(diff),creditUsd:0,description:'Pérdida por diferencial cambiario en enteramiento IVA'});}
  const db=cents(items.reduce((s,x)=>s+x.debitBs,0)), cb=cents(items.reduce((s,x)=>s+x.creditBs,0));
  const du=micros(items.reduce((s,x)=>s+x.debitUsd,0)), cu=micros(items.reduce((s,x)=>s+x.creditUsd,0));
  if(Math.abs(db-cb)>=0.01||Math.abs(du-cu)>=0.000001)throw new Error('El asiento de enteramiento no cuadra en ambas monedas después de reconocer el diferencial cambiario.');
  return {date,amountBs,amountUsd,liabilityUsd,fxDifferenceUsd:diff,bcvRate:amountBs/amountUsd,items};
}
