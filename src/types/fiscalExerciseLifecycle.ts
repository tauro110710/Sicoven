import type { Company, PersistedFiscalExercise } from './accounting';

/** The first ordinary SICOVEN period follows accountingStartDate, never the historical operational start. */
export function getFiscalExerciseStartDate(company: Pick<Company, 'accountingStartDate'>, fiscalYear: number): string {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9999) {
    throw new Error('El ejercicio fiscal indicado no es válido.');
  }
  const configuredStart = company.accountingStartDate;
  if (configuredStart !== undefined && configuredStart !== '') {
    if (!isValidIsoDate(configuredStart)) {
      throw new Error('La fecha de inicio contable de SICOVEN no es válida.');
    }
    const configuredYear = Number(configuredStart.slice(0, 4));
    if (configuredYear > fiscalYear) {
      throw new Error('El ejercicio fiscal activo es anterior al inicio contable configurado.');
    }
    if (configuredYear === fiscalYear) return configuredStart;
  }
  return String(fiscalYear).padStart(4, '0') + '-01-01';
}


export interface FiscalExerciseCycleInput {
  exercises: PersistedFiscalExercise[];
  companyId: string;
  exerciseId: string;
  closingEntryId: string;
  openingEntryId: string;
  closedAt: string;
}

/**
 * Applies the persisted calendar transition only after SQLite confirms that
 * the closing and opening journal entries were committed together.
 * This pure function never creates or posts accounting entries.
 */
export function confirmFiscalExerciseCycle(input: FiscalExerciseCycleInput): PersistedFiscalExercise[] {
  const { exercises, companyId, exerciseId, closingEntryId, openingEntryId, closedAt } = input;
  if (!companyId.trim() || !exerciseId.trim() || !closingEntryId.trim() || !openingEntryId.trim()) {
    throw new Error('La empresa, el ejercicio y los dos asientos del ciclo son obligatorios.');
  }
  if (!isValidIsoDate(closedAt)) throw new Error('La fecha de confirmación del cierre no es válida.');

  const targetIndex = exercises.findIndex(item => item.id === exerciseId && item.companyId === companyId);
  if (targetIndex < 0) throw new Error('El ejercicio no existe en el calendario persistido de esta empresa.');
  const target = exercises[targetIndex];
  if (!isValidIsoDate(target.startDate) || !isValidIsoDate(target.endDate) || target.startDate > target.endDate) {
    throw new Error('El ejercicio contiene un rango de fechas inválido.');
  }
  if (closedAt < target.endDate) throw new Error('No se puede confirmar un cierre antes del último día del ejercicio.');

  const duplicateClosing = exercises.find(item => item.closingEntryId === closingEntryId);
  const duplicateOpening = exercises.find(item => item.openingEntryId === openingEntryId);
  if (target.status === 'CERRADO' &&
      target.closingEntryId === closingEntryId &&
      exercises[targetIndex + 1]?.openingEntryId === openingEntryId) {
    return exercises;
  }
  if (duplicateClosing || duplicateOpening) {
    throw new Error('Uno de los asientos ya está vinculado a otro ejercicio; se bloqueó la duplicación.');
  }
  if (target.status !== 'ABIERTO' && target.status !== 'EN_CIERRE') {
    throw new Error('Solo se puede cerrar un ejercicio abierto o en proceso de cierre.');
  }

  const nextStartDate = addOneDay(target.endDate);
  const next = exercises[targetIndex + 1];
  if (!next || next.companyId !== companyId || next.startDate !== nextStartDate) {
    throw new Error('No existe el ejercicio siguiente consecutivo para vincular la apertura.');
  }
  if (next.status === 'CERRADO' || next.openingEntryId) {
    throw new Error('El ejercicio siguiente ya tiene una apertura vigente o está cerrado.');
  }

  return exercises.map((item, index) => {
    if (index === targetIndex) {
      return { ...item, status: 'CERRADO', closingEntryId, closedAt };
    }
    if (index === targetIndex + 1) {
      return { ...item, openingEntryId };
    }
    return item;
  });
}

export function validatePersistedFiscalExerciseCalendar(
  exercises: PersistedFiscalExercise[],
  companyId: string
): void {
  const companyExercises = exercises.filter(item => item.companyId === companyId)
    .slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (!companyId.trim() || !companyExercises.length) {
    throw new Error('El calendario no contiene ejercicios para la empresa indicada.');
  }
  const ids = new Set<string>();
  const closingIds = new Set<string>();
  const openingIds = new Set<string>();
  for (let index = 0; index < companyExercises.length; index += 1) {
    const item = companyExercises[index];
    if (!item.id.trim() || ids.has(item.id)) throw new Error('El calendario contiene identificadores de ejercicio duplicados.');
    ids.add(item.id);
    if (!isValidIsoDate(item.startDate) || !isValidIsoDate(item.endDate) ||
        item.startDate > item.endDate || !Number.isInteger(item.fiscalYear)) {
      throw new Error('El calendario contiene un ejercicio con fechas o año inválidos.');
    }
    if (index > 0 && item.startDate !== addOneDay(companyExercises[index - 1].endDate)) {
      throw new Error('El calendario contiene un salto o solapamiento entre ejercicios.');
    }
    if (item.closingEntryId) {
      if (closingIds.has(item.closingEntryId)) throw new Error('Un asiento de cierre está vinculado a más de un ejercicio.');
      closingIds.add(item.closingEntryId);
    }
    if (item.openingEntryId) {
      if (openingIds.has(item.openingEntryId)) throw new Error('Un asiento de apertura está vinculado a más de un ejercicio.');
      openingIds.add(item.openingEntryId);
    }
    if (item.status === 'CERRADO' && (!item.closingEntryId || !item.closedAt ||
        !companyExercises[index + 1]?.openingEntryId)) {
      throw new Error('Un ejercicio cerrado debe conservar el asiento de cierre, la apertura siguiente y la fecha de confirmación.');
    }
  }
}

/**
 * Builds a safe calendar from the ordinary accounting start and verifiable
 * close/open journal-entry pairs. Historical periods without both entries
 * remain ABIERTO; operationalStartDate is intentionally never consulted.
 */
export function buildPersistedFiscalExerciseCalendar(
  company: Pick<Company, 'id' | 'fiscalYear' | 'accountingStartDate' | 'fiscalExercises'>,
  journalEntries: Array<Pick<import('./accounting').JournalEntry,
    'id' | 'companyId' | 'date' | 'type' | 'referenceDoc' | 'createdAt' |
    'isAdjusted' | 'reversedByEntryId' | 'annualCloseState' | 'exerciseLink'>>
): PersistedFiscalExercise[] {
  const companyId = String(company.id || '').trim();
  const currentYear = Number(company.fiscalYear);
  if (!companyId || !Number.isInteger(currentYear) || currentYear < 1900 || currentYear > 9999) {
    throw new Error('No se puede inicializar el calendario fiscal sin empresa y ejercicio vigente válidos.');
  }
  if (Array.isArray(company.fiscalExercises) && company.fiscalExercises.length > 0) {
    validatePersistedFiscalExerciseCalendar(company.fiscalExercises, companyId);
    return company.fiscalExercises.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));
  }

  const historicalStarts = journalEntries
    .filter(entry => String(entry.companyId) === companyId && entry.type === 'CIERRE' &&
      String(entry.referenceDoc || '').startsWith('CIERRE:') &&
      isValidIsoDate(String(entry.annualCloseState?.priorPeriodStartDate || '')))
    .map(entry => String(entry.annualCloseState!.priorPeriodStartDate));
  const configuredStart = company.accountingStartDate;
  const firstStart = configuredStart
    ? (isValidIsoDate(configuredStart) ? configuredStart : (() => { throw new Error('La fecha de inicio contable configurada no es válida.'); })())
    : historicalStarts.sort()[0] || String(currentYear).padStart(4, '0') + '-01-01';
  const firstYear = Number(firstStart.slice(0, 4));
  if (firstYear > currentYear || currentYear - firstYear > 250) {
    throw new Error('El rango de ejercicios requerido para inicializar el calendario no es válido.');
  }

  const exercises: PersistedFiscalExercise[] = [];
  for (let year = firstYear; year <= currentYear + 1; year += 1) {
    const startDate = year === firstYear ? firstStart : String(year).padStart(4, '0') + '-01-01';
    exercises.push({
      id: 'fiscal-exercise:' + companyId + ':' + year,
      companyId,
      fiscalYear: year,
      startDate,
      endDate: String(year).padStart(4, '0') + '-12-31',
      status: 'ABIERTO'
    });
  }

  const activeEntries = journalEntries.filter(entry => String(entry.companyId) === companyId &&
    entry.isAdjusted !== true && !entry.reversedByEntryId);
  for (const opening of activeEntries) {
    const link = opening.exerciseLink;
    if (opening.type !== 'APERTURA' || !link ||
        !isValidIsoDate(link.priorPeriodStartDate) ||
        !isValidIsoDate(link.priorPeriodEndDate) ||
        !isValidIsoDate(link.nextPeriodStartDate) ||
        opening.date !== link.nextPeriodStartDate) continue;
    const closing = activeEntries.find(entry => entry.type === 'CIERRE' &&
      String(entry.referenceDoc || '').startsWith('CIERRE:') &&
      entry.date === link.priorPeriodEndDate &&
      entry.annualCloseState?.priorPeriodStartDate === link.priorPeriodStartDate);
    if (!closing) continue;
    const target = exercises.find(item => item.startDate === link.priorPeriodStartDate &&
      item.endDate === link.priorPeriodEndDate);
    const next = exercises.find(item => item.startDate === link.nextPeriodStartDate);
    const closedAt = String(closing.createdAt || '').slice(0, 10);
    if (!target || !next || !isValidIsoDate(closedAt) || target.status !== 'ABIERTO') continue;
    target.status = 'CERRADO';
    target.closingEntryId = String(closing.id);
    target.closedAt = closedAt;
    next.openingEntryId = String(opening.id);
  }
  validatePersistedFiscalExerciseCalendar(exercises, companyId);
  return exercises;
}

function addOneDay(value: string): string {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
