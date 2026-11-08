export type FixedAssetDepreciationMethod = 'STRAIGHT_LINE';
export type FixedAssetStatus = 'ACTIVE' | 'DISPOSED';

export interface FixedAssetDepreciationEvent {
  id: string;
  companyId: string;
  assetId: string;
  period: string; // YYYY-MM
  date: string; // YYYY-MM-DD
  days: number;
  amountBs: number;
  amountUsd: number;
  journalEntryId: string;
  createdAt: string;
  reversedByJournalEntryId?: string;
}

export interface FixedAsset {
  id: string;
  companyId: string;
  assetCode: string;
  description: string;
  category: string;
  acquisitionDate: string;
  serviceDate: string;
  acquisitionCostBs: number;
  acquisitionCostUsd: number;
  acquisitionBcvRate: number;
  residualValueBs: number;
  residualValueUsd: number;
  usefulLifeMonths: number;
  depreciationMethod: FixedAssetDepreciationMethod;
  assetAccountCode: string;
  accumulatedDepreciationAccountCode: string;
  depreciationExpenseAccountCode: string;
  sourceJournalEntryId: string;
  sourceJournalLineIndex: number;
  status: FixedAssetStatus;
  depreciationEvents: FixedAssetDepreciationEvent[];
  createdAt: string;
}

export interface FixedAssetDepreciationCalculation {
  period: string;
  postingDate: string;
  days: number;
  amountBs: number;
  amountUsd: number;
  accumulatedBsAfter: number;
  accumulatedUsdAfter: number;
  netBookValueBsAfter: number;
  netBookValueUsdAfter: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_MS = 86_400_000;

function parseIsoDate(value: string, label: string): Date {
  if (!ISO_DATE.test(value)) throw new Error(label + ' debe tener formato YYYY-MM-DD.');
  const date = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(label + ' no es una fecha real.');
  }
  return date;
}

function addMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months;
  const firstOfTarget = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(firstOfTarget.getUTCFullYear(), firstOfTarget.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
}

function monthStart(period: string): Date {
  if (!ISO_MONTH.test(period)) throw new Error('El período de depreciación debe tener formato YYYY-MM.');
  const [year, month] = period.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1));
}

function nextMonthPeriod(period: string): string {
  const start = monthStart(period);
  const next = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 7);
}

function daysBetween(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / DAY_MS));
}

function roundBs(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundUsd(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function validateAsset(asset: FixedAsset): { serviceDate: Date; lifeEnd: Date } {
  const acquisitionDate = parseIsoDate(asset.acquisitionDate, 'La fecha de adquisición');
  const serviceDate = parseIsoDate(asset.serviceDate, 'La fecha de puesta en servicio');
  if (serviceDate < acquisitionDate) throw new Error('La puesta en servicio no puede ser anterior a la adquisición.');
  if (!Number.isInteger(asset.usefulLifeMonths) || asset.usefulLifeMonths <= 0) {
    throw new Error('La vida útil debe ser un número entero de meses mayor que cero.');
  }
  const values = [asset.acquisitionCostBs, asset.acquisitionCostUsd, asset.residualValueBs, asset.residualValueUsd];
  if (!values.every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Los costos y valores residuales del activo deben ser finitos y no negativos.');
  }
  if (asset.residualValueBs > asset.acquisitionCostBs || asset.residualValueUsd > asset.acquisitionCostUsd) {
    throw new Error('El valor residual no puede superar el costo de adquisición.');
  }
  if (asset.depreciationMethod !== 'STRAIGHT_LINE' || !Number.isInteger(asset.sourceJournalLineIndex) || asset.sourceJournalLineIndex < 0) {
    throw new Error('El método de depreciación o el vínculo a la línea contable de origen no es válido.');
  }
  if (!asset.assetCode.trim() || !asset.companyId || !asset.sourceJournalEntryId ||
      !asset.assetAccountCode || !asset.accumulatedDepreciationAccountCode || !asset.depreciationExpenseAccountCode) {
    throw new Error('El expediente del activo no contiene todos los vínculos contables obligatorios.');
  }
  return { serviceDate, lifeEnd: addMonthsClamped(serviceDate, asset.usefulLifeMonths) };
}

/** Returns the earliest unposted month in the asset's useful life. Reversed periods can be posted again. */
export function getNextFixedAssetDepreciationPeriod(asset: FixedAsset): string | null {
  const { serviceDate, lifeEnd } = validateAsset(asset);
  if (asset.status !== 'ACTIVE') return null;
  if (asset.acquisitionCostBs === asset.residualValueBs &&
      asset.acquisitionCostUsd === asset.residualValueUsd) return null;

  const firstPeriod = serviceDate.toISOString().slice(0, 7);
  const finalDay = new Date(lifeEnd.getTime() - DAY_MS);
  const lastPeriod = finalDay.toISOString().slice(0, 7);
  const activeEvents = asset.depreciationEvents.filter(event => !event.reversedByJournalEntryId);
  const periods = new Set<string>();
  for (const event of activeEvents) {
    if (!ISO_MONTH.test(event.period)) throw new Error('El historial de depreciación contiene un período inválido.');
    if (event.period < firstPeriod || event.period > lastPeriod ||
        event.companyId !== asset.companyId || event.assetId !== asset.id ||
        !event.journalEntryId || !Number.isFinite(event.amountBs) || !Number.isFinite(event.amountUsd) ||
        event.amountBs < 0 || event.amountUsd < 0) {
      throw new Error('El historial de depreciación contiene un evento inconsistente con el activo o su vida útil.');
    }
    parseIsoDate(event.date, 'La fecha del evento de depreciación');
    if (periods.has(event.period)) throw new Error('El activo contiene más de una depreciación vigente para el mismo período.');
    periods.add(event.period);
  }

  let period = firstPeriod;
  while (period <= lastPeriod) {
    if (!periods.has(period)) return period;
    period = nextMonthPeriod(period);
  }
  return null;
}

/**
 * Straight-line financial depreciation prorated by exact days in service.
 * The final period absorbs rounding residue so accumulated depreciation never
 * exceeds depreciable cost. Fiscal depreciation is deliberately separate.
 */
export function calculateFixedAssetDepreciation(
  asset: FixedAsset,
  period: string
): FixedAssetDepreciationCalculation {
  const { serviceDate, lifeEnd } = validateAsset(asset);
  const nextPeriod = getNextFixedAssetDepreciationPeriod(asset);
  if (!nextPeriod || period !== nextPeriod) {
    throw new Error('La depreciación debe registrarse en el primer período pendiente y en orden cronológico.');
  }

  const start = monthStart(period);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const overlapStart = start > serviceDate ? start : serviceDate;
  const overlapEnd = end < lifeEnd ? end : lifeEnd;
  const days = daysBetween(overlapStart, overlapEnd);
  if (days <= 0) throw new Error('El período seleccionado no contiene días de depreciación.');
  const usefulLifeDays = daysBetween(serviceDate, lifeEnd);
  if (usefulLifeDays <= 0) throw new Error('La vida útil del activo no contiene días válidos.');

  const priorEvents = asset.depreciationEvents.filter(event => !event.reversedByJournalEntryId && event.period < period);
  const accumulatedBs = priorEvents.reduce((sum, event) => sum + Number(event.amountBs || 0), 0);
  const accumulatedUsd = priorEvents.reduce((sum, event) => sum + Number(event.amountUsd || 0), 0);
  if (![accumulatedBs, accumulatedUsd].every(Number.isFinite)) {
    throw new Error('El historial de depreciación contiene importes no válidos.');
  }

  const baseBs = asset.acquisitionCostBs - asset.residualValueBs;
  const baseUsd = asset.acquisitionCostUsd - asset.residualValueUsd;
  if (accumulatedBs > baseBs + 0.01 || accumulatedUsd > baseUsd + 0.000001) {
    throw new Error('La depreciación acumulada supera el importe depreciable del activo.');
  }
  const isFinalPeriod = overlapEnd.getTime() === lifeEnd.getTime();
  const amountBs = isFinalPeriod
    ? roundBs(Math.max(0, baseBs - accumulatedBs))
    : roundBs(baseBs * days / usefulLifeDays);
  const amountUsd = isFinalPeriod
    ? roundUsd(Math.max(0, baseUsd - accumulatedUsd))
    : roundUsd(baseUsd * days / usefulLifeDays);
  if (amountBs <= 0 && amountUsd <= 0) {
    throw new Error('El período no genera depreciación pendiente para este activo.');
  }

  const postingDate = new Date(overlapEnd.getTime() - DAY_MS).toISOString().slice(0, 10);
  return {
    period, postingDate, days, amountBs, amountUsd,
    accumulatedBsAfter: roundBs(accumulatedBs + amountBs),
    accumulatedUsdAfter: roundUsd(accumulatedUsd + amountUsd),
    netBookValueBsAfter: roundBs(asset.acquisitionCostBs - accumulatedBs - amountBs),
    netBookValueUsdAfter: roundUsd(asset.acquisitionCostUsd - accumulatedUsd - amountUsd)
  };
}

export type FixedAssetRegistrationDraft = Omit<
  FixedAsset,
  'id' | 'companyId' | 'acquisitionCostBs' | 'acquisitionCostUsd' |
  'acquisitionBcvRate' | 'status' | 'depreciationEvents' | 'createdAt'
>;
