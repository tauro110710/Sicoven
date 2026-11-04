import test from 'node:test';
import assert from 'node:assert/strict';
import type { Account, BankAccount, BankStatementMovement, VatWithholdingDeclaration } from './accounting';
import { buildVatPaymentAccountingPlan } from './vatPaymentAccounting';

const accounts: Account[] = [
  { code: '2.1.2.03', name: 'Retenciones de IVA por Enterar', type: 'PASIVO', level: 4, isMovement: true },
  { code: '1.1.1.03', name: 'Banco Bs. 1', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.1.04', name: 'Banco Bs. 2', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '4.2.1.01', name: 'Ganancia por Diferencial Cambiario', type: 'INGRESOS', level: 4, isMovement: true },
  { code: '6.1.1.08', name: 'Pérdida en Diferencial Cambiario', type: 'GASTOS', level: 4, isMovement: true }
];
const banks: BankAccount[] = [
  { id: 'b1', companyId: 'c1', accountCode: '1.1.1.03', bankName: 'Banco Uno', accountNumber: '001', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 },
  { id: 'b2', companyId: 'c1', accountCode: '1.1.1.04', bankName: 'Banco Dos', accountNumber: '002', currency: 'BS', initialBalanceBs: 0, initialBalanceUsd: 0 }
];
const movement = (id: string, bankAccountId: string, amountBs: number, amountUsd: number): BankStatementMovement => ({
  id, companyId: 'c1', bankAccountId, date: '2026-10-20', reference: id, description: 'Enteramiento SENIAT',
  type: 'DEBIT', amountBs, amountUsd, bcvRate: amountUsd > 0 ? amountBs / amountUsd : 250, bcvRateEffectiveDate: '2026-10-20', isReconciled: false
});

const declaration = (usd = 1, bs = 100): VatWithholdingDeclaration => ({
  id:'d1',companyId:'c1',period:'202610',window:'FIRST_HALF',startDate:'2026-10-01',endDate:'2026-10-15',
  zeroOperations:false,voucherIds:['v1'],voucherSnapshots:[{voucherId:'v1',voucherNumber:'v1',supplierRif:'J-1',
  supplierName:'Proveedor',fiscalDate:'2026-10-10',dateBasis:'FISCAL_EVENT',taxableBaseBs:100,vatAmountBs:16,
  vatWithheldBs:bs,vatWithheldUsd:usd,bcvRate:bs/usd,requiresFiscalCorrection:false}],
  legacyDateAssignments:[],totalTaxableBaseBs:100,totalVatAmountBs:16,totalWithheldBs:bs,totalWithheldUsd:usd,
  createdAt:'2026-10-16T00:00:00.000Z'
});
const build=(amountBs:number,bankUsd:number,d=declaration(),priorPaidBs=0,moves=[movement('m1','b1',amountBs,bankUsd)],chart=accounts)=>
 buildVatPaymentAccountingPlan({occurredAt:'2026-10-20',amountBs,priorPaidBs,declaration:d,movements:moves,bankAccounts:banks,accounts:chart});

test('rejects bank movement USD equivalents inconsistent with the stored BCV rate',()=>{ assert.throws(()=>build(100,1,declaration(),0,[{...movement('m1','b1',100,1),bcvRate:250}]),/no concilia en Bs. y USD/); });
test('rejects bank payment movements without a BCV snapshot effective on the payment date',()=>{ assert.throws(()=>build(100,1,declaration(),0,[{...movement('m1','b1',100,1),bcvRateEffectiveDate:'2026-10-19'}]),/misma fecha del enteramiento/); });
test('rejects bank movements dated differently from the VAT payment',()=>{ assert.throws(()=>build(100,1,declaration(),0,[{...movement('m1','b1',100,1),date:'2026-10-19'}]),/misma fecha del enteramiento/); });
test('rejects mixed historical BCV rates in one VAT payment',()=>{ assert.throws(()=>build(100,1,declaration(),0,[movement('m1','b1',50,0.5),{...movement('m2','b2',50,50/251),bcvRate:251}]),/tasas BCV históricas distintas/); });
test('uses the historical BCV snapshot stored on the selected bank movement',()=>{ const p=build(100,0.9); assert.equal(p.bcvRate,100 / 0.9); });
test('cancels liability at historical USD carrying value',()=>{
 const p=build(100,1);assert.equal(p.liabilityUsd,1);assert.equal(p.fxDifferenceUsd,0);
 assert.equal(p.items[0].debitBs,p.items[1].creditBs);assert.equal(p.items[0].debitUsd,p.items[1].creditUsd);
});
test('recognizes exchange gain when bank USD is below liability',()=>{
 const p=build(100,0.9);assert.equal(p.fxDifferenceUsd,0.1);assert.equal(p.items[2].accountCode,'4.2.1.01');assert.equal(p.items[2].creditUsd,0.1);
});
test('recognizes exchange loss when bank USD exceeds liability',()=>{
 const p=build(100,1.1);assert.equal(p.fxDifferenceUsd,-0.1);assert.equal(p.items[2].accountCode,'6.1.1.08');assert.equal(p.items[2].debitUsd,0.1);
});
test('allocates partial payments proportionally and final remainder exactly',()=>{
 const d=declaration(1,100);const first=build(33.33,0.333333,d,0,[{...movement('m1','b1',33.33,0.333333),bcvRate:100}]);const last=build(66.67,0.666667,d,33.33,[{...movement('m2','b1',66.67,0.666667),bcvRate:100}]);
 assert.equal(first.liabilityUsd,0.3333);assert.equal(last.liabilityUsd,0.6667);assert.equal(first.liabilityUsd+last.liabilityUsd,1);
 for(const p of [first,last]) {
   assert.equal(p.items.reduce((s,x)=>s+x.debitBs,0),p.items.reduce((s,x)=>s+x.creditBs,0));
   assert.ok(Math.abs(p.items.reduce((s,x)=>s+x.debitUsd,0)-p.items.reduce((s,x)=>s+x.creditUsd,0))<0.000001);
 }
});
test('blocks legacy declarations without historical USD basis',()=>{
 const old={...declaration(),totalWithheldUsd:undefined,voucherSnapshots:[{...declaration().voucherSnapshots[0],vatWithheldUsd:undefined,bcvRate:undefined}]};
 assert.throws(()=>build(100,1,old),/base USD histórica completa/);
});
test('requires the configured FX account when there is a gain',()=>{
 assert.throws(()=>build(100,0.9,declaration(),0,[movement('m1','b1',100,0.9)],accounts.filter(x=>x.code!=='4.2.1.01')),/4.2.1.01/);
});
test('groups bank credits across multiple bank accounts',()=>{
 const p=build(100,0.7,declaration(0.666667),0,[{...movement('m1','b1',60,0.4),bcvRate:150},{...movement('m2','b2',40,0.266667),bcvRate:150}]);
 assert.deepEqual(p.items.slice(1).map(x=>x.accountCode),['1.1.1.03','1.1.1.04']);
});
test('rejects bank amount mismatch and missing historical bank USD',()=>{
 assert.throws(()=>build(100,1,declaration(),0,[movement('m1','b1',99,1)]),/no coinciden exactamente/);
 assert.throws(()=>build(100,0,declaration(),0,[movement('m1','b1',100,0)]),/equivalentes históricos/);
});

test('rejects invalid calendar dates and non-debit bank movements', () => {
  assert.throws(() => buildVatPaymentAccountingPlan({
    occurredAt: '2026-02-31', amountBs:100, priorPaidBs:0, declaration:declaration(), movements: [movement('m1', 'b1', 100, 1)],
    bankAccounts: banks, accounts
  }), /fecha del enteramiento/);
  assert.throws(() => buildVatPaymentAccountingPlan({
    occurredAt: '2026-10-20', amountBs:100, priorPaidBs:0, declaration:declaration(),
    movements: [{ ...movement('m1', 'b1', 100, 1), type: 'CREDIT' }],
    bankAccounts: banks, accounts
  }), /Solo los débitos/);
});
