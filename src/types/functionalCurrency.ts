import type { ExchangeabilityAssessment, FunctionalCurrencyAssessment } from './accounting';

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function currencyIsComplete(code: string, other?: string): boolean {
  return ['VES', 'USD', 'EUR'].includes(code) || (code === 'OTHER' && Boolean(other?.trim()));
}

/** Devuelve todos los bloqueos; no asigna moneda ni calcula una conclusión automática. */
export function validateFunctionalCurrencyAssessment(input: FunctionalCurrencyAssessment): string[] {
  const errors: string[] = [];
  if (!input.id.trim()) errors.push('Falta el identificador del expediente.');
  if (!currencyIsComplete(input.functionalCurrency, input.functionalCurrencyOther)) errors.push('Indique una moneda funcional válida.');
  if (!currencyIsComplete(input.presentationCurrency, input.presentationCurrencyOther)) errors.push('Indique una moneda de presentación válida.');
  if (!validIsoDate(input.assessmentDate) || !validIsoDate(input.effectiveDate) || input.effectiveDate < input.assessmentDate) {
    errors.push('Las fechas de evaluación y vigencia deben ser válidas y coherentes.');
  }
  if (!input.preparedBy.trim()) errors.push('Identifique al preparador del expediente.');
  if (!input.primaryEconomicEnvironment.trim()) errors.push('Describa el entorno económico principal.');
  if (!input.salesPriceFactors.trim()) errors.push('Documente los factores de precios de venta.');
  if (!input.costFactors.trim()) errors.push('Documente los factores de costos.');
  if (!input.financingFactors.trim()) errors.push('Documente los factores de financiación.');
  if (!input.operatingReceiptsFactors.trim()) errors.push('Documente la moneda y retención de cobros operativos.');
  if (!input.professionalConclusion.trim()) errors.push('Falta la conclusión del juicio profesional.');
  if (!Array.isArray(input.evidenceReferences) || !input.evidenceReferences.some(item => item.trim())) {
    errors.push('Adjunte al menos una referencia de evidencia.');
  }
  if (input.status === 'APPROVED') {
    if (!input.approvedBy?.trim() || !validIsoDate(input.approvedAt || '')) {
      errors.push('Un expediente aprobado requiere responsable y fecha de aprobación.');
    }
  }
  return errors;
}

/** La convertibilidad se determina por fecha, propósito y monto; nunca por una tasa general. */
export function validateExchangeabilityAssessment(input: ExchangeabilityAssessment): string[] {
  const errors: string[] = [];
  if (!validIsoDate(input.measurementDate)) errors.push('Indique una fecha de medición válida.');
  if (!input.purpose.trim()) errors.push('Indique el propósito concreto de la conversión.');
  if (!currencyIsComplete(input.currency, input.currencyOther)) errors.push('Indique la moneda que se necesita convertir.');
  if (!Number.isFinite(input.amountRequired) || input.amountRequired <= 0) errors.push('El monto requerido debe ser positivo.');
  if (!input.legalMechanism.trim()) errors.push('Identifique el mecanismo legal evaluado.');
  if (!input.preparedBy.trim() || !input.approvedBy.trim() || !validIsoDate(input.approvedAt)) {
    errors.push('La evaluación requiere preparador, aprobador y fecha de aprobación.');
  }
  if (!Array.isArray(input.evidenceReferences) || !input.evidenceReferences.some(item => item.trim())) {
    errors.push('La convertibilidad requiere evidencia documental.');
  }
  if (input.conclusion === 'CONVERTIBLE') {
    if (!input.legallyAccessible || !input.actuallyAccessible) errors.push('No puede concluirse convertibilidad sin acceso legal y efectivo.');
    if (!Number.isFinite(input.amountAvailable) || (input.amountAvailable as number) < input.amountRequired) {
      errors.push('El monto efectivamente disponible no cubre el monto requerido.');
    }
    if (!Number.isFinite(input.accessibleSpotRate) || (input.accessibleSpotRate as number) <= 0) {
      errors.push('Registre una tasa spot accesible y sustentada.');
    }
  } else if (input.conclusion === 'NOT_CONVERTIBLE') {
    if (!Number.isFinite(input.estimatedSpotRate) || (input.estimatedSpotRate as number) <= 0) {
      errors.push('La no convertibilidad requiere una estimación de tasa spot sustentada.');
    }
    if (!input.estimationMethod?.trim() || !input.estimationEvidence?.trim()) {
      errors.push('Documente la metodología y evidencia de la tasa estimada.');
    }
  } else {
    errors.push('Seleccione una conclusión de convertibilidad válida.');
  }
  return errors;
}
