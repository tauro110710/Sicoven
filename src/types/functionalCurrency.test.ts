import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExchangeabilityAssessment, validateFunctionalCurrencyAssessment } from './functionalCurrency';

const functional = {
  id: 'fc-1', status: 'APPROVED' as const, functionalCurrency: 'VES' as const,
  presentationCurrency: 'USD' as const, assessmentDate: '2026-11-04', effectiveDate: '2026-11-04',
  preparedBy: 'Contador', approvedBy: 'Representante', approvedAt: '2026-11-04',
  primaryEconomicEnvironment: 'Venezuela', salesPriceFactors: 'Precios y mercado',
  costFactors: 'Nómina y compras', financingFactors: 'Financiación local',
  operatingReceiptsFactors: 'Cobros y retención de efectivo',
  professionalConclusion: 'Conclusión profesional documentada', evidenceReferences: ['acta-01']
};

const exchangeability = {
  id: 'ex-1', measurementDate: '2026-11-04', purpose: 'Pago a proveedor extranjero',
  currency: 'USD' as const, amountRequired: 1000, legalMechanism: 'Mecanismo legal descrito',
  legallyAccessible: true, actuallyAccessible: true, amountAvailable: 1000, accessibleSpotRate: 900,
  evidenceReferences: ['constancia-01'], conclusion: 'CONVERTIBLE' as const,
  preparedBy: 'Contador', approvedBy: 'Representante', approvedAt: '2026-11-04'
};

test('NIC 21 requiere expediente completo y evidencia; no acepta una moneda implícita', () => {
  assert.deepEqual(validateFunctionalCurrencyAssessment(functional), []);
  assert.ok(validateFunctionalCurrencyAssessment({ ...functional, evidenceReferences: [] }).some(x => x.includes('evidencia')));
  assert.ok(validateFunctionalCurrencyAssessment({ ...functional, approvedBy: '', approvedAt: '' }).some(x => x.includes('aprobado')));
});

test('convertibilidad exige acceso legal, efectivo, monto y tasa para fecha y propósito', () => {
  assert.deepEqual(validateExchangeabilityAssessment(exchangeability), []);
  assert.ok(validateExchangeabilityAssessment({ ...exchangeability, actuallyAccessible: false }).some(x => x.includes('acceso legal y efectivo')));
  assert.ok(validateExchangeabilityAssessment({ ...exchangeability, amountAvailable: 500 }).some(x => x.includes('no cubre')));
});

test('no convertibilidad exige tasa estimada, metodología y evidencia', () => {
  const notConvertible = {
    ...exchangeability, conclusion: 'NOT_CONVERTIBLE' as const,
    legallyAccessible: false, actuallyAccessible: false, amountAvailable: 0,
    accessibleSpotRate: undefined, estimatedSpotRate: 950,
    estimationMethod: 'Transacción ordenada entre participantes de mercado',
    estimationEvidence: 'Cotizaciones documentadas'
  };
  assert.deepEqual(validateExchangeabilityAssessment(notConvertible), []);
  assert.ok(validateExchangeabilityAssessment({ ...notConvertible, estimationMethod: '' }).some(x => x.includes('metodología')));
});
