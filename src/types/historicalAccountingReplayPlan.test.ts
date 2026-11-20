import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalAccountingReplayPlan,
  type HistoricalAccountingReplaySnapshot
} from './historicalAccountingReplayPlan';

const base = (): HistoricalAccountingReplaySnapshot => ({
  companyId: 'company-1',
  startDate: '2023-01-01',
  purchases: [],
  sales: [],
  movements: [],
  journalEntries: []
});

test('ordena las operaciones por fecha y conserva la referencia a documentos fuente', () => {
  const input = base();
  input.purchases = [
    { id: 'purchase-2', companyId: 'company-1', invoiceDate: '2023-03-02', invoiceNumber: 'F-2', createdAt: '2023-03-03T10:00:00.000Z' },
    { id: 'purchase-1', companyId: 'company-1', invoiceDate: '2023-02-01', invoiceNumber: 'F-1', createdAt: '2023-03-03T09:00:00.000Z' }
  ];
  input.sales = [{ id: 'sale-1', companyId: 'company-1', invoiceDate: '2023-02-15', invoiceNumber: 'V-1', createdAt: '2023-02-15T12:00:00.000Z' }];
  input.journalEntries = [{ id: 'journal-1', companyId: 'company-1', date: '2023-02-15' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.sourceEvents.map(event => event.sourceId), ['purchase-1', 'sale-1', 'purchase-2']);
  assert.deepEqual(plan.derivedJournalEntryIds, ['journal-1']);
  assert.equal(plan.canProceedToTransactionalReplay, true);
  assert.equal(plan.mode, 'READ_ONLY_PLAN');
});

test('aísla la empresa seleccionada sin incorporar operaciones de otras empresas', () => {
  const input = base();
  input.sales = [
    { id: 'sale-own', companyId: 'company-1', invoiceDate: '2023-02-01' },
    { id: 'sale-other', companyId: 'company-2', invoiceDate: '2023-02-02' }
  ];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.sourceEvents.map(event => event.sourceId), ['sale-own']);
  assert.equal(plan.blockers.length, 0);
});

test('bloquea registros de la empresa seleccionada sin fecha efectiva válida', () => {
  const input = base();
  input.purchases = [{ id: 'purchase-invalid', companyId: 'company-1', invoiceDate: '2023-02-30' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.canProceedToTransactionalReplay, false);
  assert.match(plan.blockers.join(' '), /fecha efectiva válida/);
});

test('usa la fecha contable de crédito para ubicar compras cuando existe', () => {
  const input = base();
  input.purchases = [{
    id: 'purchase-credit-date',
    companyId: 'company-1',
    invoiceDate: '2023-02-01',
    accountCreditDate: '2023-02-05'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.sourceEvents[0].effectiveDate, '2023-02-05');
});

test('identifica declaraciones presentadas y conciliaciones bancarias como dependencias externas', () => {
  const input = base();
  input.vatOwnDeclarations = [{
    id: 'vat-filed-1', companyId: 'company-1', periodEndDate: '2023-02-28',
    status: 'FILED', filedAt: '2023-03-15T10:00:00.000Z'
  }];
  input.bankStatementMovements = [{
    id: 'bank-1', companyId: 'company-1', date: '2023-02-10', isReconciled: true
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.externalDependencies.length, 2);
  assert.match(plan.externalDependencies.join(' '), /Declaración IVA propio presentada/);
  assert.match(plan.externalDependencies.join(' '), /Movimiento bancario conciliado/);
  assert.equal(plan.blockers.length, 0);
});

test('incluye depreciaciones como eventos independientes y calcula los ejercicios afectados', () => {
  const input = base();
  input.fixedAssets = [{
    id: 'asset-1', companyId: 'company-1', acquisitionDate: '2023-04-01',
    assetCode: 'AF-001',
    depreciationEvents: [
      { id: 'dep-1', companyId: 'company-1', date: '2023-12-31', createdAt: '2023-12-31T23:00:00.000Z' },
      { id: 'dep-2', companyId: 'company-1', date: '2024-12-31', createdAt: '2024-12-31T23:00:00.000Z' }
    ]
  }];
  input.throughDate = '2024-12-31';

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.sourceEvents.map(event => event.kind), [
    'FIXED_ASSET', 'FIXED_ASSET_DEPRECIATION', 'FIXED_ASSET_DEPRECIATION'
  ]);
  assert.deepEqual(plan.affectedExercises.map(item => item.fiscalYear), [2023, 2024]);
  assert.equal(plan.affectedExercises[0].includesYearEndClose, true);
  assert.equal(plan.affectedExercises[0].includesNextYearOpening, true);
  assert.equal(plan.affectedExercises[1].includesYearEndClose, true);
});

test('advierte cuando varias operaciones del mismo día carecen de marca temporal', () => {
  const input = base();
  input.sales = [{ id: 'sale-1', companyId: 'company-1', invoiceDate: '2023-05-01' }];
  input.purchases = [{ id: 'purchase-1', companyId: 'company-1', invoiceDate: '2023-05-01' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.sourceEvents.length, 2);
  assert.match(plan.warnings.join(' '), /orden original/);
});

test('no inventa una reconstrucción cuando el rango no contiene operaciones', () => {
  const plan = buildHistoricalAccountingReplayPlan(base());

  assert.equal(plan.sourceEvents.length, 0);
  assert.equal(plan.canProceedToTransactionalReplay, false);
  assert.match(plan.warnings.join(' '), /No hay operaciones fuente/);
});

test('rechaza fechas iniciales y finales inválidas', () => {
  const input = base();
  input.startDate = '2023-02-30';
  input.throughDate = '2023-13-01';

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.canProceedToTransactionalReplay, false);
  assert.equal(plan.blockers.length, 2);
});
