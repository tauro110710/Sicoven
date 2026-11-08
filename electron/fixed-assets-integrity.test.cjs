const test = require('node:test');
const assert = require('node:assert/strict');
const { validateFixedAssetLedger } = require('./accounting-integrity.cjs');

const accounts = [
  { code:'1.2.1.01', name:'Mobiliario y Equipos de Oficina', type:'ACTIVO', isMovement:true },
  { code:'1.2.1.05', name:'(-) Depreciación Acumulada Mobiliario', type:'ACTIVO', isMovement:true },
  { code:'6.1.1.06', name:'Gasto de Depreciación de Propiedades, Planta y Equipos', type:'GASTOS', isMovement:true }
];

const asset = (overrides = {}) => ({
  id:'asset-1',companyId:'company-1',assetCode:'AF-00001',description:'Equipo de oficina',category:'Mobiliario',
  acquisitionDate:'2026-01-10',serviceDate:'2026-01-15',acquisitionCostBs:36500,acquisitionCostUsd:365,
  acquisitionBcvRate:100,residualValueBs:3650,residualValueUsd:36.5,usefulLifeMonths:12,
  depreciationMethod:'STRAIGHT_LINE',assetAccountCode:'1.2.1.01',
  accumulatedDepreciationAccountCode:'1.2.1.05',depreciationExpenseAccountCode:'6.1.1.06',
  sourceJournalEntryId:'acq-1',sourceJournalLineIndex:0,status:'ACTIVE',depreciationEvents:[],
  createdAt:'2026-01-10T12:00:00.000Z',...overrides
});

const acquisition = {
  id:'acq-1',companyId:'company-1',date:'2026-01-10',type:'COMPRA',bcvRate:100,
  items:[{accountCode:'1.2.1.01',debitBs:36500,creditBs:0,debitUsd:365,creditUsd:0}]
};

const depreciation = {
  id:'dep-1',companyId:'company-1',date:'2026-01-31',type:'AJUSTE',bcvRate:100,
  referenceDoc:'DEP-AF-00001-2026-01',
  items:[
    {accountCode:'6.1.1.06',debitBs:1528.77,creditBs:0,debitUsd:15.3,creditUsd:0},
    {accountCode:'1.2.1.05',debitBs:0,creditBs:1528.77,debitUsd:0,creditUsd:15.3}
  ]
};

const event = (overrides = {}) => ({
  id:'dep-event-1',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',
  days:17,amountBs:1528.77,amountUsd:15.3,journalEntryId:'dep-1',
  createdAt:'2026-01-31T12:00:00.000Z',...overrides
});

const state = (fixedAssets = [asset()], journalEntries = [acquisition]) => ({
  companies:[{id:'company-1'}],accounts,journalEntries,fixedAssets
});

test('accepts an asset linked to an existing capitalized journal line', () => {
  assert.doesNotThrow(() => validateFixedAssetLedger({}, state()));
});

test('accepts depreciation only when the dual-currency journal matches the asset event', () => {
  const current = asset({depreciationEvents:[event()]});
  assert.doesNotThrow(() => validateFixedAssetLedger({}, state([current],[acquisition,depreciation])));
});

test('rejects a balanced depreciation journal that does not match the straight-line calculation', () => {
  const incorrectEvent = event({amountBs:2000,amountUsd:20});
  const incorrectJournal = {
    ...depreciation,
    items:[
      {accountCode:'6.1.1.06',debitBs:2000,creditBs:0,debitUsd:20,creditUsd:0},
      {accountCode:'1.2.1.05',debitBs:0,creditBs:2000,debitUsd:0,creditUsd:20}
    ]
  };
  assert.throws(
    () => validateFixedAssetLedger({},state([asset({depreciationEvents:[incorrectEvent]})],[acquisition,incorrectJournal])),
    /no coinciden con el método lineal prorrateado/
  );
});

test('rejects changes to immutable acquisition details and source line', () => {
  const prior = state();
  const changed = state([asset({acquisitionCostBs:36000})]);
  assert.throws(() => validateFixedAssetLedger(prior,changed), /modificación de los datos originales/);
});

test('rejects deleting a registered asset or a depreciation event', () => {
  const prior = state([asset({depreciationEvents:[event()]})],[acquisition,depreciation]);
  assert.throws(() => validateFixedAssetLedger(prior,state([],[acquisition,depreciation])), /eliminación del activo fijo/);
  assert.throws(() => validateFixedAssetLedger(prior,state([asset()],[acquisition,depreciation])), /eliminación del evento de depreciación/);
});

test('rejects a depreciation event without its matching journal entry', () => {
  assert.throws(() => validateFixedAssetLedger({},state([asset({depreciationEvents:[event()]})],[acquisition])), /sin asiento dual vinculado/);
});

test('rejects out-of-sequence active depreciation periods', () => {
  const first = event({period:'2026-02',date:'2026-02-28',id:'dep-event-2',journalEntryId:'dep-2'});
  const secondEntry = {...depreciation,id:'dep-2',date:'2026-02-28',referenceDoc:'DEP-AF-00001-2026-02'};
  assert.throws(() => validateFixedAssetLedger({},state([asset({depreciationEvents:[first]})],[acquisition,secondEntry])), /fuera de secuencia/);
});

test('requires the asset event to record the journal reversal marker', () => {
  const reversal = {...depreciation,id:'rev-1',type:'AJUSTE',date:'2026-02-01',referenceDoc:'REV-1',reversalOfEntryId:'dep-1'};
  const current = asset({depreciationEvents:[event({reversedByJournalEntryId:'rev-1'})]});
  assert.doesNotThrow(() => validateFixedAssetLedger({},state([current],[acquisition,depreciation,reversal])));
  assert.throws(() => validateFixedAssetLedger({},state([asset({depreciationEvents:[event()]})],[acquisition,depreciation,reversal])), /no coincide con el Libro Diario/);
});
