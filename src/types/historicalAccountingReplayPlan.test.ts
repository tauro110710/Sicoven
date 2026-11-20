import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalAccountingReplayPlan,
  findOrphanedVatWithholdingEvents,
  findCrossCompanyVatWithholdingEvents,
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

test('separa la fecha fiscal/inventario de la fecha de abono en cuenta de una compra', () => {
  const input = base();
  input.purchases = [{
    id: 'purchase-credit-date',
    companyId: 'company-1',
    invoiceDate: '2023-02-01',
    accountCreditDate: '2023-02-05',
    journalEntryId: 'journal-purchase'
  }];
  input.journalEntries = [{ id: 'journal-purchase', companyId: 'company-1', date: '2023-02-05' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.sourceEvents.map(event => [event.kind, event.effectiveDate]), [
    ['PURCHASE', '2023-02-01'],
    ['PURCHASE_ACCOUNT_CREDIT', '2023-02-05']
  ]);
  assert.equal(plan.sourceEvents[0].linkedJournalEntryId, null);
  assert.equal(plan.sourceEvents[1].linkedJournalEntryId, 'journal-purchase');
  assert.deepEqual(plan.sourceEvents[0].relatedJournalEntryIds, ['journal-purchase']);
  assert.deepEqual(plan.sourceEvents[1].relatedJournalEntryIds, ['journal-purchase']);
});

test('incluye abono en cuenta dentro del rango aunque la factura sea anterior al inicio', () => {
  const input = base();
  input.startDate = '2023-02-05';
  input.purchases = [{
    id: 'purchase-prior-invoice',
    companyId: 'company-1',
    invoiceDate: '2023-02-01',
    accountCreditDate: '2023-02-05',
    journalEntryId: 'journal-purchase'
  }];
  input.journalEntries = [{ id: 'journal-purchase', companyId: 'company-1', date: '2023-02-05' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.sourceEvents.length, 1);
  assert.equal(plan.sourceEvents[0].kind, 'PURCHASE_ACCOUNT_CREDIT');
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
    serviceDate: '2023-04-15', sourceJournalEntryId: 'journal-asset', assetCode: 'AF-001',
    depreciationEvents: [
      { id: 'dep-1', companyId: 'company-1', date: '2023-12-31', journalEntryId: 'journal-dep-1', createdAt: '2023-12-31T23:00:00.000Z' },
      { id: 'dep-2', companyId: 'company-1', date: '2024-12-31', journalEntryId: 'journal-dep-2', createdAt: '2024-12-31T23:00:00.000Z' }
    ]
  }];
  input.throughDate = '2024-12-31';
  input.journalEntries = [
    { id: 'journal-asset', companyId: 'company-1', date: '2023-04-01' },
    { id: 'journal-dep-1', companyId: 'company-1', date: '2023-12-31' },
    { id: 'journal-dep-2', companyId: 'company-1', date: '2024-12-31' }
  ];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.sourceEvents.map(event => event.kind), [
    'FIXED_ASSET', 'FIXED_ASSET_PLACED_IN_SERVICE',
    'FIXED_ASSET_DEPRECIATION', 'FIXED_ASSET_DEPRECIATION'
  ]);
  assert.equal(plan.sourceEvents[0].linkedJournalEntryId, 'journal-asset');
  assert.deepEqual(plan.sourceEvents[1].relatedJournalEntryIds, ['journal-asset']);
  assert.equal(plan.sourceEvents[2].linkedJournalEntryId, 'journal-dep-1');
  assert.equal(plan.sourceEvents[1].effectiveDate, '2023-04-15');
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

test('usa fiscalDate para ubicar eventos ISLR en la cronología histórica', () => {
  const input = base();
  input.islrFiscalEvents = [{
    id: 'islr-event-1',
    companyId: 'company-1',
    fiscalDate: '2023-04-12',
    kind: 'ACCOUNT_CREDIT',
    voucherId: 'islr-voucher-1',
    journalEntryId: 'journal-islr-1',
    createdAt: '2023-04-12T10:00:00.000Z'
  }];
  input.journalEntries = [{ id: 'journal-islr-1', companyId: 'company-1', date: '2023-04-12' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.sourceEvents.length, 1);
  assert.equal(plan.sourceEvents[0].kind, 'ISLR_FISCAL_EVENT');
  assert.equal(plan.sourceEvents[0].effectiveDate, '2023-04-12');
  assert.equal(plan.sourceEvents[0].linkedJournalEntryId, 'journal-islr-1');
});


test('exige fecha fiscal efectiva para comprobantes de retención IVA', () => {
  const input = base();
  input.vatVouchers = [{
    id: 'vat-voucher-1',
    companyId: 'company-1',
    date: '2023-04-02',
    fiscalDate: '2023-04-05',
    voucherNumber: '20230400000001',
    purchaseRecordId: 'purchase-vat-parent'
  }];
  input.purchases = [{
    id: 'purchase-vat-parent', companyId: 'company-1', invoiceDate: '2023-04-01',
    accountCreditDate: '2023-04-05', journalEntryId: 'journal-vat-parent'
  }];
  input.journalEntries = [{ id: 'journal-vat-parent', companyId: 'company-1', date: '2023-04-05' }];
  const plan = buildHistoricalAccountingReplayPlan(input);
  const voucherEvent = plan.sourceEvents.find(event => event.collection === 'vatVouchers');
  assert.equal(voucherEvent?.effectiveDate, '2023-04-05');
  assert.equal(voucherEvent?.linkedJournalEntryId, null);
  assert.deepEqual(voucherEvent?.relatedJournalEntryIds, ['journal-vat-parent']);
});

test('bloquea comprobantes IVA históricos sin fecha fiscal efectiva verificable', () => {
  const input = base();
  input.vatVouchers = [{
    id: 'vat-voucher-legacy',
    companyId: 'company-1',
    date: '2023-04-02',
    voucherNumber: '20230400000001'
  }];
  const plan = buildHistoricalAccountingReplayPlan(input);
  assert.equal(plan.canProceedToTransactionalReplay, false);
  assert.match(plan.blockers.join(' '), /vatVouchers\/vat-voucher-legacy/);
});

test('marca como dependencia externa la presentación de una declaración por evento', () => {
  const input = base();
  input.vatOwnDeclarationEvents = [{
    id: 'vat-own-filed-1',
    companyId: 'company-1',
    declarationId: 'vat-own-1',
    eventType: 'FILED',
    occurredAt: '2023-04-30T12:00:00.000Z',
    recordedAt: '2023-04-30T12:00:00.000Z'
  }];
  const plan = buildHistoricalAccountingReplayPlan(input);
  assert.ok(plan.externalDependencies.some(item => item.includes('vat-own-filed-1')));
});


test('extiende la fecha final automática hasta el último asiento de la empresa', () => {
  const input = base();
  input.purchases = [{
    id: 'purchase-1',
    companyId: 'company-1',
    invoiceDate: '2023-02-01'
  }];
  input.journalEntries = [{
    id: 'journal-later',
    companyId: 'company-1',
    date: '2024-06-30'
  }];
  const plan = buildHistoricalAccountingReplayPlan(input);
  assert.equal(plan.throughDate, '2024-06-30');
  assert.deepEqual(plan.derivedJournalEntryIds, ['journal-later']);
});


test('usa recordedAt de eventos fiscales para ordenar operaciones del mismo día', () => {
  const input = base();
  input.vatOwnDeclarationEvents = [
    { id: 'event-later', companyId: 'company-1', declarationId: 'vat-own-1', eventType: 'REVIEWED', occurredAt: '2023-04-30T00:00:00.000Z', recordedAt: '2023-04-30T12:00:00.000Z' },
    { id: 'event-earlier', companyId: 'company-1', declarationId: 'vat-own-1', eventType: 'PAYMENT', occurredAt: '2023-04-30T00:00:00.000Z', recordedAt: '2023-04-30T10:00:00.000Z' }
  ];
  const plan = buildHistoricalAccountingReplayPlan(input);
  assert.deepEqual(plan.sourceEvents.map(event => event.sourceId), ['event-earlier', 'event-later']);
  assert.equal(plan.warnings.some(item => item.includes('carece de marca de registro')), false);
});


test('los eventos huérfanos de otra empresa no bloquean la reconstrucción seleccionada', () => {
  const events = [
    { id: 'orphan-other', companyId: 'company-2', declarationId: 'missing-2' },
    { id: 'orphan-own', companyId: 'company-1', declarationId: 'missing-1' },
    { id: 'orphan-unknown', declarationId: 'missing-unknown' }
  ];
  const declarations = [
    { id: 'declaration-other', companyId: 'company-2' }
  ];
  const selectedCompanyOrphans = findOrphanedVatWithholdingEvents(events, declarations, 'company-1');
  assert.deepEqual(selectedCompanyOrphans.map(event => event.id), ['orphan-own']);
});

test('un vínculo cruzado entre evento y declaración se detecta sin clasificarlo como huérfano', () => {
  const events = [{ id: 'event-cross', companyId: 'company-1', declarationId: 'declaration-2' }];
  const declarations = [{ id: 'declaration-2', companyId: 'company-2' }];
  assert.deepEqual(findOrphanedVatWithholdingEvents(events, declarations, 'company-1'), []);
  assert.deepEqual(findCrossCompanyVatWithholdingEvents(events, declarations, 'company-1').map(event => event.id), ['event-cross']);
  assert.deepEqual(findCrossCompanyVatWithholdingEvents(events, declarations, 'company-2').map(event => event.id), ['event-cross']);
  assert.deepEqual(findCrossCompanyVatWithholdingEvents(events, declarations, 'company-3'), []);
});

test('no confunde eventos sin empresa explícita ni declaración con cruces entre empresas', () => {
  const events = [
    { id: 'legacy-unknown', declarationId: 'declaration-2' },
    { id: 'legacy-orphan', declarationId: 'missing' }
  ];
  const declarations = [{ id: 'declaration-2', companyId: 'company-2' }];
  assert.deepEqual(findCrossCompanyVatWithholdingEvents(events, declarations, 'company-1'), []);
  assert.deepEqual(findCrossCompanyVatWithholdingEvents(events, declarations, 'company-2'), []);
});


test('resuelve asientos de un comprobante ISLR mediante su evento fiscal vinculado', () => {
  const input = base();
  input.islrVouchers = [{
    id: 'islr-voucher-1', companyId: 'company-1', date: '2023-04-12',
    voucherNumber: 'ISLR-001', invoiceDate: '2023-04-01'
  }];
  input.islrFiscalEvents = [{
    id: 'islr-event-1', companyId: 'company-1', fiscalDate: '2023-04-12',
    voucherId: 'islr-voucher-1', journalEntryId: 'journal-islr-voucher'
  }];
  input.journalEntries = [{
    id: 'journal-islr-voucher', companyId: 'company-1', date: '2023-04-12'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);
  const voucher = plan.sourceEvents.find(event => event.collection === 'islrVouchers');

  assert.deepEqual(voucher?.relatedJournalEntryIds, ['journal-islr-voucher']);
  assert.equal(plan.blockers.length, 0);
});

test('conserva los asientos actuales e históricos de una conciliación bancaria', () => {
  const input = base();
  input.bankStatementMovements = [{
    id: 'bank-link-1', companyId: 'company-1', date: '2023-05-01',
    isReconciled: true, journalEntryId: 'journal-bank-current',
    reconciledWithJournalEntryId: 'journal-bank-current',
    reconciledJournalEntryIds: ['journal-bank-old', 'journal-bank-current']
  }];
  input.journalEntries = [
    { id: 'journal-bank-old', companyId: 'company-1', date: '2023-04-30' },
    { id: 'journal-bank-current', companyId: 'company-1', date: '2023-05-01' }
  ];

  const plan = buildHistoricalAccountingReplayPlan(input);
  const bankEvent = plan.sourceEvents[0];

  assert.equal(bankEvent.linkedJournalEntryId, 'journal-bank-current');
  assert.deepEqual(bankEvent.relatedJournalEntryIds, ['journal-bank-current', 'journal-bank-old']);
  assert.equal(plan.blockers.length, 0);
});

test('bloquea vínculos explícitos a asientos inexistentes o de otra empresa', () => {
  const input = base();
  input.sales = [
    { id: 'sale-missing-entry', companyId: 'company-1', invoiceDate: '2023-06-01', journalEntryId: 'journal-missing' },
    { id: 'sale-cross-company', companyId: 'company-1', invoiceDate: '2023-06-02', journalEntryId: 'journal-other-company' }
  ];
  input.journalEntries = [{
    id: 'journal-other-company', companyId: 'company-2', date: '2023-06-02'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.match(plan.blockers.join(' '), /asiento contable inexistente journal-missing/);
  assert.match(plan.blockers.join(' '), /asiento journal-other-company de otra empresa/);
  assert.equal(plan.canProceedToTransactionalReplay, false);
});


test('captura el contexto contable, tributario, BCV y maestros de la empresa', () => {
  const input = base();
  input.company = {
    id: 'company-1',
    taxStatusHistory: [{ id: 'tax-1', effectiveFrom: '2020-01-01', effectiveTo: '2024-12-31' }],
    accountingBcvRateHistory: [{ id: 'bcv-1', effectiveDate: '2023-01-01', rate: 20 }],
    functionalCurrencyAssessments: [{ id: 'currency-1' }],
    exchangeabilityAssessments: [{ id: 'exchange-1' }]
  };
  input.accounts = [{ code: '1.1.1.01', isMovement: true }];
  input.products = [{ id: 'product-1', companyId: 'company-1' }];
  input.bankAccounts = [{ id: 'bank-1', companyId: 'company-1', accountCode: '1.1.1.01' }];
  input.customers = [{ id: 'customer-1', companyId: 'company-1' }];
  input.suppliers = [{ id: 'supplier-1', companyId: 'company-1' }];
  input.financialDisclosures = [{ id: 'disclosure-1', companyId: 'company-1' }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.contextCoverage, {
    companyMetadata: true,
    taxStatusPeriods: 1,
    accountingBcvRateEntries: 1,
    functionalCurrencyAssessments: 1,
    exchangeabilityAssessments: 1,
    chartOfAccounts: 1,
    inventoryProducts: 1,
    bankAccounts: 1,
    customers: 1,
    suppliers: 1,
    financialDisclosures: 1
  });
});

test('bloquea tramos tributarios solapados y tasas BCV históricas inválidas', () => {
  const input = base();
  input.company = {
    id: 'company-1',
    taxStatusHistory: [
      { id: 'tax-1', effectiveFrom: '2020-01-01', effectiveTo: '2023-12-31' },
      { id: 'tax-2', effectiveFrom: '2023-06-01', effectiveTo: '2024-12-31' }
    ],
    accountingBcvRateHistory: [{ id: 'bcv-bad', effectiveDate: '2023-02-30', rate: 0 }]
  };

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.blockers.some(item => item.includes('tramos solapados')));
  assert.ok(plan.blockers.some(item => item.includes('historial BCV contable')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});

test('incluye la cadena de reversión y ajuste entre asientos relacionados', () => {
  const input = base();
  input.sales = [{
    id: 'sale-1', companyId: 'company-1', invoiceDate: '2023-01-10',
    journalEntryId: 'journal-sale'
  }];
  input.journalEntries = [
    {
      id: 'journal-sale', companyId: 'company-1', date: '2023-01-10',
      reversedByEntryId: 'journal-reversal'
    },
    {
      id: 'journal-reversal', companyId: 'company-1', date: '2023-02-10',
      reversalOfEntryId: 'journal-sale',
      adjustmentForEntryId: 'journal-adjustment'
    },
    {
      id: 'journal-adjustment', companyId: 'company-1', date: '2023-02-11'
    }
  ];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.deepEqual(plan.derivedJournalEntryIds.sort(), [
    'journal-adjustment', 'journal-reversal', 'journal-sale'
  ]);
  assert.ok(plan.journalEntryRelationships.some(item =>
    item.entryId === 'journal-reversal' && item.relatedEntryId === 'journal-sale' && item.relationType === 'REVERSAL_OF'
  ));
  assert.ok(plan.journalEntryRelationships.some(item =>
    item.entryId === 'journal-reversal' && item.relatedEntryId === 'journal-adjustment' && item.relationType === 'ADJUSTMENT_FOR'
  ));
});

test('bloquea relaciones de reversión o ajuste entre empresas distintas', () => {
  const input = base();
  input.journalEntries = [
    {
      id: 'journal-own', companyId: 'company-1', date: '2023-01-10',
      reversedByEntryId: 'journal-other'
    },
    { id: 'journal-other', companyId: 'company-2', date: '2023-01-11' }
  ];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.blockers.some(item => item.includes('de otra empresa')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});

test('bloquea movimientos bancarios, inventario y cuentas con maestros inexistentes', () => {
  const input = base();
  input.movements = [{
    id: 'movement-1', companyId: 'company-1', date: '2023-01-10',
    productId: 'missing-product'
  }];
  input.bankStatementMovements = [{
    id: 'bank-movement-1', companyId: 'company-1', date: '2023-01-10',
    bankAccountId: 'missing-bank'
  }];
  input.journalEntries = [{
    id: 'journal-1', companyId: 'company-1', date: '2023-01-10',
    items: [{ accountCode: '9.9.9.99' }]
  }];
  input.products = [];
  input.bankAccounts = [];
  input.accounts = [];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.blockers.some(item => item.includes('artículo inexistente')));
  assert.ok(plan.blockers.some(item => item.includes('cuenta bancaria inexistente')));
  assert.ok(plan.blockers.some(item => item.includes('cuenta no encontrada')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});


test('construye vínculos entre documentos, liquidaciones, retenciones y declaraciones', () => {
  const input = base();
  input.purchases = [
    { id: 'purchase-original', companyId: 'company-1', invoiceDate: '2023-01-01' },
    { id: 'purchase-credit', companyId: 'company-1', invoiceDate: '2023-02-01', originalPurchaseId: 'purchase-original' }
  ];
  input.sales = [
    { id: 'sale-original', companyId: 'company-1', invoiceDate: '2023-01-02' },
    { id: 'sale-credit', companyId: 'company-1', invoiceDate: '2023-02-02', originalSaleId: 'sale-original' }
  ];
  input.movements = [
    { id: 'movement-original', companyId: 'company-1', date: '2023-01-01' },
    { id: 'movement-correction', companyId: 'company-1', date: '2023-02-03', correctionForMovementId: 'movement-original' }
  ];
  input.bankStatementMovements = [{ id: 'bank-movement', companyId: 'company-1', date: '2023-03-01' }];
  input.vatVouchers = [{
    id: 'vat-voucher', companyId: 'company-1', fiscalDate: '2023-01-05',
    purchaseRecordId: 'purchase-original'
  }];
  input.vatWithholdingDeclarations = [{
    id: 'vat-declaration', companyId: 'company-1', periodEndDate: '2023-01-31',
    voucherIds: ['vat-voucher']
  }];
  input.vatWithholdingDeclarationEvents = [{
    id: 'vat-event', companyId: 'company-1', date: '2023-02-10',
    declarationId: 'vat-declaration', bankStatementMovementIds: ['bank-movement']
  }];
  input.islrVouchers = [{ id: 'islr-voucher', companyId: 'company-1', date: '2023-01-05' }];
  input.islrFiscalEvents = [{
    id: 'islr-event', companyId: 'company-1', fiscalDate: '2023-01-05',
    voucherId: 'islr-voucher', allocations: [{ purchaseId: 'purchase-original' }]
  }];
  input.vatOwnDeclarations = [{
    id: 'vat-own', companyId: 'company-1', periodEndDate: '2023-01-31',
    sourceIds: ['purchase-original', 'sale-original']
  }];
  input.vatOwnDeclarationEvents = [{
    id: 'vat-own-event', companyId: 'company-1', date: '2023-02-15',
    declarationId: 'vat-own'
  }];
  input.creditSettlements = [{
    id: 'settlement', companyId: 'company-1', documentId: 'sale-original',
    kind: 'SALE_COLLECTION', settlementDate: '2023-02-20'
  }];
  input.supplierDirectAdvances = [{ id: 'direct-advance', companyId: 'company-1', date: '2023-01-10' }];
  input.supplierAdvanceSettlements = [{
    id: 'advance-settlement', companyId: 'company-1', date: '2023-02-25',
    sourceCreditNoteIds: ['purchase-credit'], sourceDirectAdvanceIds: ['direct-advance'],
    targetPurchaseId: 'purchase-original'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);
  const relations = new Set(plan.sourceDependencies.map(item => item.relationType));

  for (const expected of [
    'CORRECTS_PURCHASE', 'CORRECTS_SALE', 'CORRECTS_INVENTORY_MOVEMENT',
    'VAT_WITHHOLDING_FOR_PURCHASE', 'DECLARATION_INCLUDES_VAT_VOUCHER',
    'VAT_WITHHOLDING_EVENT_FOR_DECLARATION', 'VAT_WITHHOLDING_PAYMENT_BANK_SUPPORT',
    'ISLR_EVENT_FOR_VOUCHER', 'ISLR_EVENT_FOR_PURCHASE',
    'VAT_OWN_DECLARATION_SOURCE', 'VAT_OWN_EVENT_FOR_DECLARATION',
    'SETTLEMENT_FOR_DOCUMENT', 'SUPPLIER_ADVANCE_FROM_CREDIT_NOTE',
    'SUPPLIER_ADVANCE_FROM_DIRECT_DISBURSEMENT', 'SUPPLIER_ADVANCE_APPLIED_TO_PURCHASE'
  ]) assert.ok(relations.has(expected), 'Falta relación ' + expected);

  assert.equal(plan.blockers.length, 0);
});

test('bloquea vínculos de corrección a documentos inexistentes', () => {
  const input = base();
  input.sales = [{
    id: 'sale-credit', companyId: 'company-1', invoiceDate: '2023-02-01',
    originalSaleId: 'sale-missing'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.blockers.some(item => item.includes('sales/sale-missing')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});

test('bloquea operaciones tributarias cuando existe historial con brechas de vigencia', () => {
  const input = base();
  input.company = {
    id: 'company-1',
    taxStatusHistory: [{
      id: 'tax-current', effectiveFrom: '2023-02-01', effectiveTo: '2023-12-31'
    }]
  };
  input.sales = [{
    id: 'sale-before-status', companyId: 'company-1', invoiceDate: '2023-01-15'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.blockers.some(item => item.includes('no tiene exactamente un tramo de condición tributaria vigente')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});


test('acepta operaciones cubiertas por un único tramo tributario vigente', () => {
  const input = base();
  input.startDate = '2010-01-01';
  input.company = {
    id: 'company-1',
    taxStatusHistory: [{
      id: 'tax-all-years', effectiveFrom: '2010-01-01'
    }]
  };
  input.sales = [{
    id: 'sale-covered', companyId: 'company-1', invoiceDate: '2014-07-15'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.equal(plan.blockers.some(item => item.includes('condición tributaria vigente')), false);
  assert.equal(plan.canProceedToTransactionalReplay, true);
});

test('detecta vínculos de eventos fiscales revertidos y no mezcla empresas', () => {
  const input = base();
  input.islrFiscalEvents = [
    { id: 'islr-original', companyId: 'company-1', fiscalDate: '2023-01-10' },
    { id: 'islr-reversal', companyId: 'company-1', fiscalDate: '2023-02-10', reversalOfEventId: 'islr-original' }
  ];
  input.vatOwnDeclarations = [{
    id: 'vat-own', companyId: 'company-1', periodEndDate: '2023-01-31',
    sourceIds: ['sale-other-company']
  }];
  input.sales = [{
    id: 'sale-other-company', companyId: 'company-2', invoiceDate: '2023-01-10'
  }];

  const plan = buildHistoricalAccountingReplayPlan(input);

  assert.ok(plan.sourceDependencies.some(item =>
    item.sourceId === 'islr-reversal' && item.targetId === 'islr-original' &&
    item.relationType === 'REVERSAL_OF_ISLR_EVENT'
  ));
  assert.ok(plan.blockers.some(item => item.includes('de otra empresa')));
  assert.equal(plan.canProceedToTransactionalReplay, false);
});
