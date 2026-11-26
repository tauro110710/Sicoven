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
    {accountCode:'6.1.1.06',debitBs:1530,creditBs:0,debitUsd:15.3,creditUsd:0},
    {accountCode:'1.2.1.05',debitBs:0,creditBs:1530,debitUsd:0,creditUsd:15.3}
  ]
};

const event = (overrides = {}) => ({
  id:'dep-event-1',companyId:'company-1',assetId:'asset-1',period:'2026-01',date:'2026-01-31',
  days:17,amountBs:1530,amountUsd:15.3,journalEntryId:'dep-1',
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


const historicalAccounting = () => ({
  accounts,
  companies: [{ id: 'company-1' }],
  journalEntries: [
    {
      id: 'acq-1', companyId: 'company-1', date: '2017-06-15', type: 'COMPRA', bcvRate: 3300,
      items: [{ accountCode: '1.2.1.01', debitBs: 36_500_000, creditBs: 0, debitUsd: 3650, creditUsd: 0 }]
    },
    {
      id: 'dep-jul', companyId: 'company-1', date: '2018-07-31', type: 'AJUSTE', bcvRate: 3300,
      referenceDoc: 'DEP-AF-00001-2018-07',
      items: [
        { accountCode: '6.1.1.06', debitBs: 16_425_000, creditBs: 0, debitUsd: 1642.5, creditUsd: 0 },
        { accountCode: '1.2.1.05', debitBs: 0, creditBs: 16_425_000, debitUsd: 0, creditUsd: 1642.5 }
      ]
    },
    {
      id: 'dep-aug', companyId: 'company-1', date: '2018-08-31', type: 'AJUSTE', bcvRate: 3300,
      referenceDoc: 'DEP-AF-00001-2018-08',
      items: [
        { accountCode: '6.1.1.06', debitBs: 164.25, creditBs: 0, debitUsd: 1642.5, creditUsd: 0 },
        { accountCode: '1.2.1.05', debitBs: 0, creditBs: 164.25, debitUsd: 0, creditUsd: 1642.5 }
      ]
    }
  ],
  fixedAssets: [asset({
    acquisitionDate: '2017-06-15', serviceDate: '2018-07-01', costScaleDate: '2017-06-15',
    acquisitionCostBs: 36_500_000, acquisitionCostUsd: 3650, acquisitionBcvRate: 3300,
    residualValueBs: 3_650_000, residualValueUsd: 365, usefulLifeMonths: 2,
    depreciationEvents: [
      event({ id: 'dep-event-jul', period: '2018-07', date: '2018-07-31', days: 31, amountBs: 16_425_000, amountUsd: 1642.5, journalEntryId: 'dep-jul' }),
      event({ id: 'dep-event-aug', period: '2018-08', date: '2018-08-31', days: 31, amountBs: 164.25, amountUsd: 1642.5, journalEntryId: 'dep-aug' })
    ]
  })]
});

test('acepta depreciaciones reexpresadas al cruzar la reconversión de 2018', () => {
  assert.doesNotThrow(() => validateFixedAssetLedger({}, historicalAccounting()));
});

test('rechaza una depreciación posterior a la reconversión calculada con la escala anterior', () => {
  const state = historicalAccounting();
  state.journalEntries[2] = {
    ...state.journalEntries[2],
    items: [
      { accountCode: '6.1.1.06', debitBs: 16_425_000, creditBs: 0, debitUsd: 1642.5, creditUsd: 0 },
      { accountCode: '1.2.1.05', debitBs: 0, creditBs: 16_425_000, debitUsd: 0, creditUsd: 1642.5 }
    ]
  };
  state.fixedAssets[0].depreciationEvents[1] = {
    ...state.fixedAssets[0].depreciationEvents[1], amountBs: 16_425_000
  };
  assert.throws(() => validateFixedAssetLedger({}, state), /no coinciden con el método lineal prorrateado/);
});

test('accepts a non-depreciable land asset without depreciation accounts or events', () => {
  const land = asset({
    category: 'Terreno', depreciationMethod: 'NON_DEPRECIABLE', usefulLifeMonths: 0,
    residualValueBs: 36500, residualValueUsd: 365,
    accumulatedDepreciationAccountCode: '', depreciationExpenseAccountCode: '', depreciationEvents: []
  });
  assert.doesNotThrow(() => validateFixedAssetLedger({}, state([land], [acquisition])));
});
