import type { Company, PersistedFiscalExercise, PersistedFiscalExerciseCycle } from './accounting';

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

export function ensureFiscalExerciseCalendar(
  company: Pick<Company, 'id' | 'accountingStartDate' | 'fiscalExercises'>,
  fiscalYear: number
): PersistedFiscalExercise[] {
  const companyId = String(company.id || '').trim();
  if (!companyId) throw new Error('La empresa debe estar identificada para inicializar su calendario fiscal.');
  if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 9999) {
    throw new Error('El ejercicio fiscal indicado no es válido.');
  }
  const exercises = [...(company.fiscalExercises || [])];
  if (!exercises.length) {
    const configuredStart = company.accountingStartDate;
    const startYear = configuredStart ? Number(configuredStart.slice(0, 4)) : fiscalYear;
    if (configuredStart && (!isValidIsoDate(configuredStart) || startYear > fiscalYear)) {
      throw new Error('La fecha de inicio contable configurada no permite inicializar el calendario.');
    }
    // Initialize every ordinary fiscal year from the accountant's chosen start year
    // through the active year and the following year. No prior year is marked closed.
    for (let year = startYear; year <= fiscalYear + 1; year += 1) {
      const startDate = year === startYear
        ? getFiscalExerciseStartDate(company, year)
        : String(year) + '-01-01';
      exercises.push(createExercise(companyId, year, startDate));
    }
    validatePersistedFiscalExerciseCalendar(exercises, companyId);
    return exercises;
  }

  validatePersistedFiscalExerciseCalendar(exercises, companyId);
  const ordered = exercises.filter(item => item.companyId === companyId)
    .slice().sort((a, b) => a.fiscalYear - b.fiscalYear);
  let current = ordered.find(item => item.fiscalYear === fiscalYear);
  if (!current) {
    const last = ordered[ordered.length - 1];
    if (!last || last.fiscalYear !== fiscalYear - 1 || last.endDate !== String(fiscalYear - 1) + '-12-31') {
      throw new Error('El calendario fiscal no contiene el ejercicio activo ni evidencia una continuidad segura. No se crearán períodos históricos automáticamente.');
    }
    const created = createExercise(companyId, fiscalYear, getFiscalExerciseStartDate(company, fiscalYear));
    exercises.push(created);
    current = created;
  }
  const expectedStart = getFiscalExerciseStartDate(company, fiscalYear);
  if (current.startDate !== expectedStart || current.endDate !== String(fiscalYear) + '-12-31') {
    throw new Error('El rango del ejercicio activo no coincide con la fecha de inicio contable configurada. Se requiere revisión antes de cerrar.');
  }
  const nextYear = fiscalYear + 1;
  const next = exercises.find(item => item.companyId === companyId && item.fiscalYear === nextYear);
  if (!next) {
    const last = exercises.filter(item => item.companyId === companyId)
      .sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
    if (!last || last.fiscalYear !== fiscalYear || last.endDate !== String(fiscalYear) + '-12-31') {
      throw new Error('No se puede ampliar el calendario: existe una discontinuidad o un ejercicio posterior no documentado.');
    }
    exercises.push(createExercise(companyId, nextYear, String(nextYear) + '-01-01'));
  } else if (next.startDate !== String(nextYear) + '-01-01' || next.endDate !== String(nextYear) + '-12-31') {
    throw new Error('El ejercicio siguiente tiene un rango distinto al calendario anual esperado.');
  }
  validatePersistedFiscalExerciseCalendar(exercises, companyId);
  return exercises;
}

/** Builds only the active and immediately following periods; it never labels undocumented prior years as closed. */
export function buildPersistedFiscalExerciseCalendar(
  company: Pick<Company, 'id' | 'accountingStartDate' | 'fiscalYear' | 'fiscalExercises'>,
  _journalEntries: unknown[] = []
): PersistedFiscalExercise[] {
  return ensureFiscalExerciseCalendar(company, Number(company.fiscalYear));
}

export interface FiscalExerciseCycleInput {
  exercises: PersistedFiscalExercise[];
  companyId: string;
  exerciseId: string;
  closingEntryId: string;
  openingEntryId: string;
  closedAt: string;
}

/** Applies the cycle to the snapshot that atomically commits both journal entries in SQLite. */
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
  const targetCycles = normalizeCycles(target);
  const repeated = targetCycles.find(cycle =>
    cycle.closingEntryId === closingEntryId && cycle.openingEntryId === openingEntryId && !cycle.reopenedAt);
  if (repeated && target.status === 'CERRADO') return exercises;
  const allCycles = exercises.flatMap(normalizeCycles);
  const directDuplicate = exercises.some(item =>
    item.closingEntryId === closingEntryId || item.openingEntryId === openingEntryId);
  if (directDuplicate || allCycles.some(cycle =>
    cycle.closingEntryId === closingEntryId || cycle.openingEntryId === openingEntryId)) {
    throw new Error('Uno de los asientos ya está vinculado a otro ciclo; se bloqueó la duplicación.');
  }
  if (target.status !== 'ABIERTO' && target.status !== 'EN_CIERRE' && target.status !== 'REABIERTO') {
    throw new Error('Solo se puede cerrar un ejercicio abierto o formalmente reabierto.');
  }
  if (target.status === 'REABIERTO' && (!targetCycles.length || !targetCycles[targetCycles.length - 1].reopenedAt)) {
    throw new Error('El ejercicio figura reabierto, pero no conserva evidencia de la reapertura anterior.');
  }
  const nextIndex = targetIndex + 1;
  const next = exercises[nextIndex];
  const nextStartDate = addOneDay(target.endDate);
  if (!next || next.companyId !== companyId || next.startDate !== nextStartDate || next.fiscalYear !== target.fiscalYear + 1) {
    throw new Error('No existe el ejercicio siguiente consecutivo para vincular la apertura.');
  }
  if (next.status === 'CERRADO' || next.openingEntryId) {
    throw new Error('El ejercicio siguiente ya tiene una apertura vigente o está cerrado.');
  }
  const cycleNumber = Math.max(0, ...targetCycles.map(cycle => cycle.cycleNumber)) + 1;
  const cycle: PersistedFiscalExerciseCycle = {
    cycleNumber, closingEntryId, openingEntryId, closedAt
  };
  return exercises.map((item, index) => {
    if (index === targetIndex) {
      return {
        ...item, status: 'CERRADO', closingEntryId, openingEntryId, closedAt,
        cycles: [...targetCycles, cycle]
      };
    }
    if (index === nextIndex) return { ...item, openingEntryId };
    return item;
  });
}

/** Records a formal SQLite reopening without deleting the original closing/opening evidence. */
export function reopenFiscalExerciseCycle(
  exercises: PersistedFiscalExercise[],
  companyId: string,
  closingEntryId: string,
  openingEntryId: string,
  reopenedAt: string,
  reopeningId: string
): PersistedFiscalExercise[] {
  if (!isValidIsoDate(reopenedAt) || !reopeningId.trim()) {
    throw new Error('La reapertura requiere fecha e identificador de auditoría válidos.');
  }
  const index = exercises.findIndex(item => item.companyId === companyId &&
    (item.closingEntryId === closingEntryId || normalizeCycles(item).some(cycle => cycle.closingEntryId === closingEntryId)));
  if (index < 0) throw new Error('El cierre no está vinculado al calendario fiscal de la empresa.');
  const target = exercises[index];
  const cycles = normalizeCycles(target);
  const cycleIndex = cycles.findIndex(cycle => cycle.closingEntryId === closingEntryId && cycle.openingEntryId === openingEntryId);
  if (cycleIndex < 0 || cycleIndex !== cycles.length - 1 || cycles[cycleIndex].reopenedAt) {
    throw new Error('El ciclo no es el último ciclo vigente o ya fue reabierto.');
  }
  const next = exercises[index + 1];
  if (!next || next.companyId !== companyId || next.openingEntryId !== openingEntryId) {
    throw new Error('El ejercicio siguiente no conserva la apertura que se está revirtiendo.');
  }
  const updatedCycles = cycles.map((cycle, i) => i === cycleIndex
    ? { ...cycle, reopenedAt, reopeningId }
    : cycle);
  return exercises.map((item, i) => {
    if (i === index) return { ...item, status: 'REABIERTO', cycles: updatedCycles };
    if (i === index + 1 && item.openingEntryId === openingEntryId) {
      return { ...item, openingEntryId: undefined };
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
  const cycleEntryIds = new Set<string>();
  for (let index = 0; index < companyExercises.length; index += 1) {
    const item = companyExercises[index];
    if (!item.id.trim() || ids.has(item.id)) throw new Error('El calendario contiene identificadores de ejercicio duplicados.');
    ids.add(item.id);
    if (!isValidIsoDate(item.startDate) || !isValidIsoDate(item.endDate) ||
        item.startDate > item.endDate || !Number.isInteger(item.fiscalYear)) {
      throw new Error('El calendario contiene un ejercicio con fechas o año inválidos.');
    }
    if (index > 0 && (item.startDate !== addOneDay(companyExercises[index - 1].endDate) ||
        item.fiscalYear !== companyExercises[index - 1].fiscalYear + 1)) {
      throw new Error('El calendario contiene un salto o solapamiento entre ejercicios.');
    }
    const cycles = normalizeCycles(item);
    let previousCycleNumber = 0;
    for (const cycle of cycles) {
      if (!Number.isInteger(cycle.cycleNumber) || cycle.cycleNumber <= previousCycleNumber ||
          !cycle.closingEntryId.trim() || !cycle.openingEntryId.trim() || !isValidIsoDate(cycle.closedAt) ||
          (cycle.reopenedAt !== undefined && !isValidIsoDate(cycle.reopenedAt)) ||
          (cycle.reopeningId !== undefined && !cycle.reopeningId.trim())) {
        throw new Error('El historial de ciclos del ejercicio contiene evidencia inválida.');
      }
      if (cycleEntryIds.has(cycle.closingEntryId) || cycleEntryIds.has(cycle.openingEntryId)) {
        throw new Error('Un asiento está vinculado a más de un ciclo fiscal.');
      }
      cycleEntryIds.add(cycle.closingEntryId);
      cycleEntryIds.add(cycle.openingEntryId);
      previousCycleNumber = cycle.cycleNumber;
    }
    const latest = cycles[cycles.length - 1];
    if (item.status === 'CERRADO' && (!latest || latest.reopenedAt ||
        item.closingEntryId !== latest.closingEntryId || item.openingEntryId !== latest.openingEntryId ||
        item.closedAt !== latest.closedAt || companyExercises[index + 1]?.openingEntryId !== latest.openingEntryId)) {
      throw new Error('Un ejercicio cerrado debe conservar el último cierre, la apertura siguiente y su fecha de confirmación.');
    }
    if (item.status === 'REABIERTO' && (!latest?.reopenedAt || latest.closingEntryId !== item.closingEntryId ||
        latest.openingEntryId !== item.openingEntryId || companyExercises[index + 1]?.openingEntryId === latest.openingEntryId)) {
      throw new Error('Un ejercicio reabierto debe conservar el ciclo original y haber retirado la apertura vigente siguiente.');
    }
  }
}

function normalizeCycles(exercise: PersistedFiscalExercise): PersistedFiscalExerciseCycle[] {
  if (Array.isArray(exercise.cycles) && exercise.cycles.length) return exercise.cycles;
  if (exercise.closingEntryId && exercise.openingEntryId && exercise.closedAt) {
    return [{
      cycleNumber: 1,
      closingEntryId: exercise.closingEntryId,
      openingEntryId: exercise.openingEntryId,
      closedAt: exercise.closedAt
    }];
  }
  return [];
}

function createExercise(companyId: string, fiscalYear: number, startDate: string): PersistedFiscalExercise {
  return {
    id: 'fiscal-exercise:' + companyId + ':' + fiscalYear,
    companyId, fiscalYear, startDate,
    endDate: String(fiscalYear) + '-12-31',
    status: 'ABIERTO'
  };
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
