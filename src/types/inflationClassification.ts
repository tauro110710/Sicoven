import type { Account, AccountType } from './accounting';

export type InflationItemClassification = 'MONETARY' | 'NON_MONETARY' | 'MIXED' | 'NOT_APPLICABLE';
export type InflationMeasurementBasis =
  | 'CASH_OR_FIXED_CURRENCY'
  | 'INDEX_LINKED'
  | 'GOODS_OR_SERVICES'
  | 'HISTORICAL_COST'
  | 'FAIR_VALUE'
  | 'NET_REALIZABLE_VALUE'
  | 'REVALUED'
  | 'MIXED'
  | 'FLOW';
export type InflationClassificationScope = 'ACCOUNT_DEFAULT' | 'BALANCE_COMPONENT';
export type InflationClassificationStatus = 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED';
export type InflationRestatementTreatment =
  | 'NOT_RESTATE_MONETARY'
  | 'ADJUST_PER_CONTRACT'
  | 'RESTATE_FROM_ORIGIN'
  | 'NOT_RESTATE_CURRENT_MEASURE'
  | 'REQUIRES_COMPONENT_SPLIT'
  | 'NOT_APPLICABLE';

export interface InflationClassificationDecision {
  id: string;
  version: number;
  supersedesDecisionId?: string;
  companyId: string;
  fiscalYear: number;
  accountCode: string;
  scope: InflationClassificationScope;
  componentRef?: string;
  classification: InflationItemClassification;
  measurementBasis: InflationMeasurementBasis;
  treatment: InflationRestatementTreatment;
  rationale: string;
  normativeReference: string;
  status: InflationClassificationStatus;
  originDate?: string;
  measurementDate?: string;
  carryingAmountBs?: number;
  carryingAmountUsd?: number;
  currency?: 'BS' | 'USD' | 'DUAL';
  contractReference?: string;
  reviewer?: string;
  reviewedAt?: string;
  rejectionReason?: string;
}

const BALANCE_SHEET_TYPES = new Set<AccountType>(['ACTIVO', 'PASIVO', 'PATRIMONIO']);
const FLOW_TYPES = new Set<AccountType>(['INGRESOS', 'COSTOS', 'GASTOS']);

const validIsoDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const validAmount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function getInflationRestatementTreatment(
  classification: InflationItemClassification,
  basis: InflationMeasurementBasis
): InflationRestatementTreatment {
  if (classification === 'MONETARY') {
    if (basis === 'INDEX_LINKED') return 'ADJUST_PER_CONTRACT';
    if (basis === 'CASH_OR_FIXED_CURRENCY') return 'NOT_RESTATE_MONETARY';
    throw new Error('Una partida monetaria debe sustentarse como efectivo/derecho u obligación en importe fijo o determinable, o como partida contractualmente indexada.');
  }
  if (classification === 'NON_MONETARY') {
    if (basis === 'HISTORICAL_COST' || basis === 'GOODS_OR_SERVICES') return 'RESTATE_FROM_ORIGIN';
    if (basis === 'FAIR_VALUE' || basis === 'NET_REALIZABLE_VALUE') return 'NOT_RESTATE_CURRENT_MEASURE';
    if (basis === 'REVALUED') return 'RESTATE_FROM_ORIGIN';
    throw new Error('La base de medición no corresponde a una partida no monetaria.');
  }
  if (classification === 'MIXED') {
    if (basis !== 'MIXED') throw new Error('Una cuenta mixta debe declarar base MIXED y desglosarse en componentes.');
    return 'REQUIRES_COMPONENT_SPLIT';
  }
  if (classification === 'NOT_APPLICABLE') {
    if (basis !== 'FLOW') throw new Error('Los ingresos, costos y gastos son flujos del período; no se clasifican como saldos monetarios/no monetarios.');
    return 'NOT_APPLICABLE';
  }
  throw new Error('Clasificación de inflación no reconocida.');
}

/**
 * Validates a professional classification decision. It deliberately does not
 * infer a classification from the account code or account name.
 */
export function validateInflationClassificationDecision(
  input: InflationClassificationDecision,
  accounts: Account[]
): InflationClassificationDecision {
  if (!input || typeof input !== 'object') throw new Error('La decisión de clasificación no es válida.');
  if (!String(input.id || '').trim()) throw new Error('La decisión requiere un identificador único.');
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error('La versión de la decisión debe ser un entero positivo.');
  const companyId = String(input.companyId || '').trim();
  if (!companyId) throw new Error('La clasificación debe estar vinculada a una empresa.');
  if (!Number.isInteger(input.fiscalYear) || input.fiscalYear < 1900 || input.fiscalYear > 2200) {
    throw new Error('El ejercicio contable de la clasificación no es válido.');
  }
  const accountCode = String(input.accountCode || '').trim();
  const account = accounts.find(item => item.code === accountCode);
  if (!account || !account.isMovement) {
    throw new Error('La clasificación debe vincularse a una cuenta imputable existente.');
  }
  const scope = input.scope;
  if (scope !== 'ACCOUNT_DEFAULT' && scope !== 'BALANCE_COMPONENT') {
    throw new Error('El alcance debe ser cuenta o componente de saldo.');
  }
  if (BALANCE_SHEET_TYPES.has(account.type)) {
    if (input.classification === 'NOT_APPLICABLE' || input.measurementBasis === 'FLOW') {
      throw new Error('Una cuenta de activo, pasivo o patrimonio requiere evaluación monetaria/no monetaria.');
    }
  } else if (FLOW_TYPES.has(account.type)) {
    if (input.classification !== 'NOT_APPLICABLE' || input.measurementBasis !== 'FLOW') {
      throw new Error('Las cuentas de ingresos, costos y gastos se tratan como flujos del período, no como saldos monetarios/no monetarios.');
    }
  } else {
    throw new Error('El tipo de cuenta no está contemplado en la matriz de clasificación.');
  }

  const treatment = getInflationRestatementTreatment(input.classification, input.measurementBasis);
  const rationale = String(input.rationale || '').trim();
  const normativeReference = String(input.normativeReference || '').trim();
  if (rationale.length < 10 || rationale.length > 2000) {
    throw new Error('La justificación profesional debe contener entre 10 y 2.000 caracteres.');
  }
  if (!normativeReference || normativeReference.length > 500) {
    throw new Error('Indique la referencia normativa o documental que sustenta la clasificación.');
  }
  if (scope === 'BALANCE_COMPONENT') {
    if (!String(input.componentRef || '').trim()) throw new Error('El componente de saldo requiere una referencia única.');
    if (!validAmount(input.carryingAmountBs) && !validAmount(input.carryingAmountUsd)) {
      throw new Error('El componente requiere al menos un importe histórico válido en Bs. o USD.');
    }
    if (!input.currency || !['BS', 'USD', 'DUAL'].includes(input.currency)) {
      throw new Error('Indique la moneda en que se conserva el importe histórico.');
    }
    if ((input.currency === 'BS' && !validAmount(input.carryingAmountBs)) ||
        (input.currency === 'USD' && !validAmount(input.carryingAmountUsd)) ||
        (input.currency === 'DUAL' && (!validAmount(input.carryingAmountBs) || !validAmount(input.carryingAmountUsd)))) {
      throw new Error('Los importes históricos deben corresponder con la moneda declarada; DUAL exige Bs. y USD.');
    }
    if (input.measurementBasis === 'INDEX_LINKED' && !String(input.contractReference || '').trim()) {
      throw new Error('Una partida indexada requiere referencia al contrato y su cláusula de indexación.');
    }
    if (input.classification === 'NON_MONETARY' &&
        (input.measurementBasis === 'HISTORICAL_COST' || input.measurementBasis === 'GOODS_OR_SERVICES' || input.measurementBasis === 'REVALUED')) {
      if (!validIsoDate(input.originDate)) {
        throw new Error('La partida no monetaria requiere fecha de origen verificable para determinar el período de reexpresión.');
      }
    }
    if ((input.measurementBasis === 'FAIR_VALUE' || input.measurementBasis === 'NET_REALIZABLE_VALUE') &&
        !validIsoDate(input.measurementDate)) {
      throw new Error('La medición a valor corriente requiere fecha de medición verificable.');
    }
  } else if (input.componentRef || input.originDate || input.measurementDate ||
      input.carryingAmountBs !== undefined || input.carryingAmountUsd !== undefined || input.contractReference) {
    throw new Error('La clasificación general de cuenta no debe almacenar importes ni fechas de un componente específico.');
  }

  if (input.classification === 'MIXED' && scope !== 'ACCOUNT_DEFAULT') {
    throw new Error('La clasificación MIXED solo puede definir la cuenta como mixta; cada componente debe clasificarse individualmente.');
  }
  if (input.status === 'APPROVED') {
    if (!String(input.reviewer || '').trim() || !validIsoDate(input.reviewedAt)) {
      throw new Error('Una clasificación aprobada requiere revisor y fecha de aprobación.');
    }
  }
  if (input.status === 'REJECTED' && String(input.rejectionReason || '').trim().length < 10) {
    throw new Error('Una clasificación rechazada requiere una justificación de al menos 10 caracteres.');
  }
  if (!['PENDING_REVIEW', 'APPROVED', 'REJECTED'].includes(input.status)) {
    throw new Error('Estado de revisión no válido.');
  }

  return { ...input, companyId, accountCode, rationale, normativeReference, treatment };
}

export function assertNoDuplicateInflationClassification(
  decision: InflationClassificationDecision,
  existing: InflationClassificationDecision[]
): void {
  const sameKey = existing.filter(item =>
    item.companyId === decision.companyId &&
    item.fiscalYear === decision.fiscalYear &&
    item.accountCode === decision.accountCode &&
    item.scope === decision.scope &&
    String(item.componentRef || '') === String(decision.componentRef || '') &&
    item.id !== decision.id
  );
  const latest = sameKey.sort((a, b) => b.version - a.version)[0];
  if (!latest) {
    if (decision.version !== 1 || decision.supersedesDecisionId) {
      throw new Error('La primera clasificación debe iniciar en versión 1 y no puede sustituir una decisión inexistente.');
    }
    return;
  }
  if (decision.supersedesDecisionId !== latest.id || decision.version !== latest.version + 1) {
    throw new Error('La nueva clasificación debe crear la siguiente versión y enlazar explícitamente la última decisión del mismo componente; el historial anterior no se sobrescribe.');
  }
}
