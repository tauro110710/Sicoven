import type { PersistedFiscalExercise } from './accounting';

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
      exercises.some(item => item.openingEntryId === openingEntryId)) {
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
    if (item.status === 'CERRADO' && (!item.closingEntryId || !item.openingEntryId || !item.closedAt)) {
      throw new Error('Un ejercicio cerrado debe conservar el asiento de cierre, la apertura siguiente y la fecha de confirmación.');
    }
  }
}

function addOneDay(value: string): string {
  const date = new Date(value + 'T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function isValidIsoDate(value: string): boolean {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
