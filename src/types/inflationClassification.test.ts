import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Account } from './accounting';
import {
  assertNoDuplicateInflationClassification,
  getInflationRestatementTreatment,
  validateInflationClassificationDecision,
  type InflationClassificationDecision
} from './inflationClassification';

const accounts: Account[] = [
  { code: '1.1.1.01', name: 'Caja', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.4.01', name: 'Inventario', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '1.1.2.03', name: 'Anticipos a proveedores', type: 'ACTIVO', level: 4, isMovement: true },
  { code: '2.1.1.01', name: 'Proveedores', type: 'PASIVO', level: 4, isMovement: true },
  { code: '3.1.1.01', name: 'Capital', type: 'PATRIMONIO', level: 4, isMovement: true },
  { code: '4.1.1.01', name: 'Ingresos', type: 'INGRESOS', level: 4, isMovement: true },
  { code: '1.1.1', name: 'Efectivo agrupador', type: 'ACTIVO', level: 3, isMovement: false }
];

const decision = (overrides: Partial<InflationClassificationDecision> = {}): InflationClassificationDecision => ({
  id: 'classification-1',
  version: 1,
  companyId: 'company-1',
  fiscalYear: 2026,
  accountCode: '1.1.1.01',
  scope: 'ACCOUNT_DEFAULT',
  classification: 'MONETARY',
  measurementBasis: 'CASH_OR_FIXED_CURRENCY',
  treatment: 'NOT_RESTATE_MONETARY',
  rationale: 'La partida representa efectivo disponible en moneda.',
  normativeReference: 'NIC 29, párrafo 12; BA VEN-NIF 2 aplicable.',
  status: 'PENDING_REVIEW',
  ...overrides
});

describe('inflation classification rules', () => {
  it('does not infer a classification from account code or account name', () => {
    assert.throws(() => validateInflationClassificationDecision(
      decision({ classification: undefined as never }), accounts
    ), /clasificación|no reconocida/i);
  });

  it('classifies cash as monetary and does not restate it', () => {
    const result = validateInflationClassificationDecision(decision(), accounts);
    assert.equal(result.treatment, 'NOT_RESTATE_MONETARY');
  });

  it('requires a verifiable origin date for historical-cost non-monetary components', () => {
    const base = decision({
      accountCode: '1.1.4.01',
      scope: 'BALANCE_COMPONENT',
      componentRef: 'INV-LOT-001',
      classification: 'NON_MONETARY',
      measurementBasis: 'HISTORICAL_COST',
      reportingDate: '2026-12-31',
      carryingAmountBs: 100,
      currency: 'BS'
    });
    assert.throws(() => validateInflationClassificationDecision(base, accounts), /fecha de origen/);
    const result = validateInflationClassificationDecision({ ...base, originDate: '2025-03-14' }, accounts);
    assert.equal(result.treatment, 'RESTATE_FROM_ORIGIN');
  });

  it('treats contract-indexed monetary components according to the contract, not as ordinary cash', () => {
    const base = decision({
      scope: 'BALANCE_COMPONENT',
      componentRef: 'LOAN-001',
      measurementBasis: 'INDEX_LINKED',
      contractReference: 'Contrato de préstamo, cláusula 8',
      carryingAmountBs: 1000,
      currency: 'BS'
    });
    assert.equal(validateInflationClassificationDecision(base, accounts).treatment, 'ADJUST_PER_CONTRACT');
    assert.throws(() => validateInflationClassificationDecision({
      ...base, contractReference: ''
    }, accounts), /cláusula de indexación/);
  });

  it('uses the fair-value measurement date when it predates the reporting date', () => {
    const base = decision({
      accountCode: '1.1.4.01', scope: 'BALANCE_COMPONENT', componentRef: 'PPE-FAIR-001',
      classification: 'NON_MONETARY', measurementBasis: 'FAIR_VALUE',
      measurementDate: '2026-06-30', reportingDate: '2026-10-31',
      carryingAmountBs: 5000, currency: 'BS'
    });
    assert.equal(validateInflationClassificationDecision(base, accounts).treatment, 'RESTATE_FROM_MEASUREMENT_DATE');
    assert.equal(validateInflationClassificationDecision({ ...base, measurementDate: '2026-10-31' }, accounts).treatment, 'NOT_RESTATE_CURRENT_MEASURE');
  });

  it('rejects invalid or post-report valuation dates instead of silently treating the balance as current', () => {
    const base = decision({
      accountCode: '1.1.4.01', scope: 'BALANCE_COMPONENT', componentRef: 'PPE-FAIR-002',
      classification: 'NON_MONETARY', measurementBasis: 'FAIR_VALUE',
      measurementDate: '2026-11-01', reportingDate: '2026-10-31',
      carryingAmountBs: 7000, currency: 'BS'
    });
    assert.throws(() => validateInflationClassificationDecision(base, accounts), /no puede ser posterior/);
    assert.throws(() => validateInflationClassificationDecision({
      ...base, measurementDate: '2026-02-30'
    }, accounts), /fecha de medición/);
  });

  it('requires both historical currency amounts when the component is dual currency', () => {
    const base = decision({
      scope: 'BALANCE_COMPONENT',
      componentRef: 'AR-001',
      carryingAmountBs: 100,
      currency: 'DUAL'
    });
    assert.throws(() => validateInflationClassificationDecision(base, accounts), /DUAL exige Bs. y USD/);
    assert.doesNotThrow(() => validateInflationClassificationDecision({
      ...base, carryingAmountUsd: 10
    }, accounts));
  });

  it('requires mixed accounts to be split into individually classified balance components', () => {
    const mixed = decision({
      classification: 'MIXED',
      measurementBasis: 'MIXED'
    });
    assert.equal(validateInflationClassificationDecision(mixed, accounts).treatment, 'REQUIRES_COMPONENT_SPLIT');
    assert.throws(() => validateInflationClassificationDecision({
      ...mixed, scope: 'BALANCE_COMPONENT', componentRef: 'mixed-1',
      carryingAmountBs: 1, currency: 'BS'
    }, accounts), /solo puede definir la cuenta como mixta/);
  });

  it('does not classify income, costs or expenses as monetary/non-monetary balance items', () => {
    assert.throws(() => validateInflationClassificationDecision(decision({
      accountCode: '4.1.1.01'
    }), accounts), /flujos del período/);
    assert.equal(validateInflationClassificationDecision(decision({
      accountCode: '4.1.1.01',
      classification: 'NOT_APPLICABLE',
      measurementBasis: 'FLOW',
      treatment: 'NOT_APPLICABLE'
    }), accounts).treatment, 'NOT_APPLICABLE');
  });

  it('rejects non-imputable and nonexistent accounts', () => {
    assert.throws(() => validateInflationClassificationDecision(decision({
      accountCode: '1.1.1'
    }), accounts), /cuenta imputable/);
    assert.throws(() => validateInflationClassificationDecision(decision({
      accountCode: '9.9.9'
    }), accounts), /cuenta imputable/);
  });

  it('requires reviewer and date for approval and reason for rejection', () => {
    assert.throws(() => validateInflationClassificationDecision(decision({
      status: 'APPROVED'
    }), accounts), /revisor y fecha/);
    assert.doesNotThrow(() => validateInflationClassificationDecision(decision({
      status: 'APPROVED', reviewer: 'contador', reviewedAt: '2026-10-31'
    }), accounts));
    assert.throws(() => validateInflationClassificationDecision(decision({
      status: 'REJECTED',
      rejectionReason: 'No'
    }), accounts), /justificación/);
  });

  it('prevents duplicate active decisions for the same company, year, account and scope', () => {
    const current = decision();
    assert.throws(() => assertNoDuplicateInflationClassification(current, [{ ...current, id: 'older', version: 1 }]), /siguiente versión/);
    assert.doesNotThrow(() => assertNoDuplicateInflationClassification(current, []));
    const next = { ...current, id: 'classification-2', version: 2, supersedesDecisionId: 'classification-1' };
    assert.doesNotThrow(() => assertNoDuplicateInflationClassification(next, [current]));
    assert.throws(() => assertNoDuplicateInflationClassification({ ...next, supersedesDecisionId: 'wrong' }, [current]), /enlazar explícitamente/);
  });

  it('does not restate monetary items and re-expresses non-monetary items from their actual origin or measurement date', () => {
    assert.equal(getInflationRestatementTreatment('MONETARY', 'CASH_OR_FIXED_CURRENCY'), 'NOT_RESTATE_MONETARY');
    assert.equal(getInflationRestatementTreatment('NON_MONETARY', 'HISTORICAL_COST'), 'RESTATE_FROM_ORIGIN');
    assert.equal(getInflationRestatementTreatment('NON_MONETARY', 'FAIR_VALUE', '2026-10-31', '2026-10-31'), 'NOT_RESTATE_CURRENT_MEASURE');
    assert.equal(getInflationRestatementTreatment('NON_MONETARY', 'FAIR_VALUE', '2026-06-30', '2026-10-31'), 'RESTATE_FROM_MEASUREMENT_DATE');
    assert.equal(getInflationRestatementTreatment('NON_MONETARY', 'REVALUED', '2025-12-31', '2026-10-31'), 'RESTATE_FROM_MEASUREMENT_DATE');
    assert.throws(() => getInflationRestatementTreatment('NON_MONETARY', 'FAIR_VALUE'), /fecha válida/);
  });
});
