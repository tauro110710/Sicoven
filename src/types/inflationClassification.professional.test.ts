import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from './accounting';
import { validateInflationClassificationDecision, type InflationClassificationDecision } from './inflationClassification';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.2.01', name: 'Cuentas por cobrar', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.2.02', name: 'Anticipos', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.2.1.01', name: 'Propiedad planta y equipo', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.2.2.01', name: 'Intangibles', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.3.01', name: 'Créditos fiscales', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', level: 4, isMovement: true },
  { code: '3.1.1.01', name: 'Capital', type: 'PATRIMONIO', level: 4, isMovement: true },
  { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', level: 4, isMovement: true }
];

const base = (overrides: Partial<InflationClassificationDecision> = {}): InflationClassificationDecision => ({
  id: 'case-1', version: 1, companyId: 'company-1', fiscalYear: 2026,
  accountCode: '1.1.1.01', scope: 'BALANCE_COMPONENT', componentRef: 'COMP-001',
  classification: 'MONETARY', measurementBasis: 'CASH_OR_FIXED_CURRENCY',
  treatment: 'NOT_RESTATE_MONETARY', rationale: 'Caso profesional documentado para validación.',
  normativeReference: 'NIC 29; BA VEN-NIF 2 aplicable al ejercicio.',
  status: 'PENDING_REVIEW', carryingAmountBs: 100, currency: 'BS', ...overrides
});

describe('professional inflation classification cases 3.2D', () => {
  it('CP-01 cash and bank balances remain monetary', () => {
    assert.equal(validateInflationClassificationDecision(base(), accounts).treatment, 'NOT_RESTATE_MONETARY');
  });

  it('CP-02 contract-indexed receivable requires a contract reference', () => {
    const indexed = base({ accountCode: '1.1.2.01', classification: 'MONETARY',
      measurementBasis: 'INDEX_LINKED', contractReference: 'Contrato CxC, cláusula 4' });
    assert.equal(validateInflationClassificationDecision(indexed, accounts).treatment, 'ADJUST_PER_CONTRACT');
    assert.throws(() => validateInflationClassificationDecision({ ...indexed, contractReference: '' }, accounts), /cláusula de indexación/);
  });

  it('CP-03 refundable advance is not presumed monetary without documented rationale', () => {
    const refundable = base({ accountCode: '1.1.2.02', rationale: 'Derecho exigible de devolución en efectivo según contrato firmado.' });
    assert.equal(validateInflationClassificationDecision(refundable, accounts).classification, 'MONETARY');
  });

  it('CP-04 advance for goods/services can be represented as a non-monetary component', () => {
    const advance = base({ accountCode: '1.1.2.02', classification: 'NON_MONETARY',
      measurementBasis: 'GOODS_OR_SERVICES', originDate: '2026-03-10' });
    assert.equal(validateInflationClassificationDecision(advance, accounts).treatment, 'RESTATE_FROM_ORIGIN');
  });

  it('CP-05 inventory lots require distinct components and origin dates', () => {
    const lotA = base({ accountCode: '1.1.4.01', classification: 'NON_MONETARY',
      measurementBasis: 'HISTORICAL_COST', componentRef: 'LOT-A', originDate: '2026-01-12' });
    const lotB = { ...lotA, id: 'case-2', componentRef: 'LOT-B', originDate: '2026-04-18' };
    assert.equal(validateInflationClassificationDecision(lotA, accounts).treatment, 'RESTATE_FROM_ORIGIN');
    assert.equal(validateInflationClassificationDecision(lotB, accounts).originDate, '2026-04-18');
  });

  it('CP-06 PPE at historical cost requires origin date; revaluation uses measurement date', () => {
    const historical = base({ accountCode: '1.2.1.01', classification: 'NON_MONETARY',
      measurementBasis: 'HISTORICAL_COST', originDate: '2022-07-01' });
    assert.equal(validateInflationClassificationDecision(historical, accounts).treatment, 'RESTATE_FROM_ORIGIN');
    const revalued = base({ accountCode: '1.2.1.01', classification: 'NON_MONETARY',
      measurementBasis: 'REVALUED', measurementDate: '2026-06-30', reportingDate: '2026-12-31' });
    assert.equal(validateInflationClassificationDecision(revalued, accounts).treatment, 'RESTATE_FROM_MEASUREMENT_DATE');
  });

  it('CP-07 intangible recognition is not inferred by classification rules', () => {
    const intangible = base({ accountCode: '1.2.2.01', classification: 'NON_MONETARY',
      measurementBasis: 'HISTORICAL_COST', originDate: '2026-02-01' });
    assert.equal(validateInflationClassificationDecision(intangible, accounts).treatment, 'RESTATE_FROM_ORIGIN');
  });

  it('CP-08 equity contribution requires explicit professional classification', () => {
    const equity = base({ accountCode: '3.1.1.01', classification: 'NON_MONETARY',
      measurementBasis: 'HISTORICAL_COST', originDate: '2020-01-01' });
    assert.equal(validateInflationClassificationDecision(equity, accounts).classification, 'NON_MONETARY');
  });

  it('CP-09 tax credits require a documented case-specific conclusion, not automatic monetary classification', () => {
    const taxCredit = base({ accountCode: '1.1.3.01', classification: 'NON_MONETARY',
      measurementBasis: 'GOODS_OR_SERVICES', originDate: '2026-05-15',
      rationale: 'Crédito aplicable exclusivamente contra obligaciones tributarias futuras.' });
    assert.equal(validateInflationClassificationDecision(taxCredit, accounts).treatment, 'RESTATE_FROM_ORIGIN');
  });

  it('CP-10 mixed balances require account-level split and do not accept mixed components', () => {
    const mixed = base({ scope: 'ACCOUNT_DEFAULT', componentRef: undefined,
      classification: 'MIXED', measurementBasis: 'MIXED', carryingAmountBs: undefined, currency: undefined });
    assert.equal(validateInflationClassificationDecision(mixed, accounts).treatment, 'REQUIRES_COMPONENT_SPLIT');
    assert.throws(() => validateInflationClassificationDecision(base({ classification: 'MIXED',
      measurementBasis: 'MIXED' }), accounts), /solo puede definir la cuenta como mixta/);
  });

  it('CP-11 current measurement rejects future valuation dates', () => {
    const future = base({ accountCode: '1.2.1.01', classification: 'NON_MONETARY',
      measurementBasis: 'FAIR_VALUE', measurementDate: '2027-01-01', reportingDate: '2026-12-31' });
    assert.throws(() => validateInflationClassificationDecision(future, accounts), /posterior/);
  });

  it('CP-12 income remains a period flow, not a balance item', () => {
    const flow = base({ accountCode: '4.1.1.01', scope: 'ACCOUNT_DEFAULT', componentRef: undefined,
      carryingAmountBs: undefined, currency: undefined, classification: 'NOT_APPLICABLE',
      measurementBasis: 'FLOW', treatment: 'NOT_APPLICABLE' });
    assert.equal(validateInflationClassificationDecision(flow, accounts).treatment, 'NOT_APPLICABLE');
  });
});
