import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPersistedFiscalExerciseCalendar, confirmFiscalExerciseCycle, ensureFiscalExerciseCalendar, getFiscalExerciseStartDate, reopenFiscalExerciseCycle, validatePersistedFiscalExerciseCalendar } from './fiscalExerciseLifecycle';
import type { PersistedFiscalExercise } from './accounting';

const exercises = (): PersistedFiscalExercise[] => [
  { id: 'co-1:2015', companyId: 'co-1', fiscalYear: 2015, startDate: '2015-02-05', endDate: '2015-12-31', status: 'ABIERTO' },
  { id: 'co-1:2016', companyId: 'co-1', fiscalYear: 2016, startDate: '2016-01-01', endDate: '2016-12-31', status: 'ABIERTO' },
  { id: 'co-1:2017', companyId: 'co-1', fiscalYear: 2017, startDate: '2017-01-01', endDate: '2017-12-31', status: 'ABIERTO' }
];

test('confirma un primer ejercicio parcial y enlaza cierre con apertura siguiente', () => {
  const result = confirmFiscalExerciseCycle({
    exercises: exercises(), companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2016-01-02'
  });
  assert.deepEqual(result[0], {
    ...exercises()[0], status: 'CERRADO',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016', closedAt: '2016-01-02',
    cycles: [{ cycleNumber: 1, closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016', closedAt: '2016-01-02' }]
  });
  assert.equal(result[1].openingEntryId, 'entry-open-2016');
  assert.equal(result[1].status, 'ABIERTO');
  assert.equal(result[2].status, 'ABIERTO');
  validatePersistedFiscalExerciseCalendar(result, 'co-1');
});

test('la confirmación es idempotente cuando se repite el mismo ciclo', () => {
  const first = confirmFiscalExerciseCycle({
    exercises: exercises(), companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2016-01-02'
  });
  const second = confirmFiscalExerciseCycle({
    exercises: first, companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2016-01-02'
  });
  assert.deepEqual(second, first);
});

test('bloquea ciclos con asientos duplicados, ejercicios no consecutivos o datos inválidos', () => {
  assert.throws(() => confirmFiscalExerciseCycle({
    exercises: exercises(), companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2015-12-30'
  }));
  const broken = exercises();
  broken[1] = { ...broken[1], startDate: '2016-01-02' };
  assert.throws(() => confirmFiscalExerciseCycle({
    exercises: broken, companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2016-01-02'
  }));
  const invalid = exercises();
  invalid[0] = { ...invalid[0], status: 'CERRADO' };
  assert.throws(() => validatePersistedFiscalExerciseCalendar(invalid, 'co-1'));
});

test('rechaza asientos ya vinculados a otro ejercicio', () => {
  const existing = exercises().map((item, index) => index === 2
    ? { ...item, openingEntryId: 'entry-open-2016' } : item);
  assert.throws(() => confirmFiscalExerciseCycle({
    exercises: existing, companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'entry-close-2015', openingEntryId: 'entry-open-2016',
    closedAt: '2016-01-02'
  }));
});


test('el inicio del ejercicio ordinario usa accountingStartDate y no operationalStartDate', () => {
  const companyWithDistinctDates = {
    accountingStartDate: '2025-02-05',
    operationalStartDate: '2015-02-05'
  };
  assert.equal(getFiscalExerciseStartDate(companyWithDistinctDates, 2025), '2025-02-05');
  assert.equal(getFiscalExerciseStartDate({ accountingStartDate: '2015-02-05' }, 2026), '2026-01-01');
  assert.equal(getFiscalExerciseStartDate({}, 2026), '2026-01-01');
  assert.throws(() => getFiscalExerciseStartDate({ accountingStartDate: '2025-02-30' }, 2025));
  assert.throws(() => getFiscalExerciseStartDate({ accountingStartDate: '2027-01-01' }, 2026));
});


test('inicializa el período activo y el siguiente sin inventar cierres anteriores', () => {
  const calendar = buildPersistedFiscalExerciseCalendar({
    id: 'co-1', fiscalYear: 2025, accountingStartDate: '2025-02-05',
    operationalStartDate: '2015-02-05'
  } as any, []);
  assert.equal(calendar.length, 2);
  assert.equal(calendar[0].startDate, '2025-02-05');
  assert.equal(calendar[0].status, 'ABIERTO');
  assert.equal(calendar[1].startDate, '2026-01-01');
  assert.equal(calendar[1].status, 'ABIERTO');
  assert.ok(calendar.every(item => !item.closingEntryId && !item.closedAt));
});

test('la reapertura conserva el ciclo original y permite un segundo ciclo sin borrar trazabilidad', () => {
  const first = confirmFiscalExerciseCycle({
    exercises: exercises(), companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'close-1', openingEntryId: 'open-1', closedAt: '2016-01-02'
  });
  const reopened = reopenFiscalExerciseCycle(first, 'co-1', 'close-1', 'open-1', '2016-02-01', 'reopen-1');
  assert.equal(reopened[0].status, 'REABIERTO');
  assert.equal(reopened[0].cycles?.[0].closingEntryId, 'close-1');
  assert.equal(reopened[0].cycles?.[0].openingEntryId, 'open-1');
  assert.equal(reopened[0].cycles?.[0].reopeningId, 'reopen-1');
  assert.equal(reopened[1].openingEntryId, undefined);
  const second = confirmFiscalExerciseCycle({
    exercises: reopened, companyId: 'co-1', exerciseId: 'co-1:2015',
    closingEntryId: 'close-2', openingEntryId: 'open-2', closedAt: '2016-02-02'
  });
  assert.equal(second[0].status, 'CERRADO');
  assert.deepEqual(second[0].cycles?.map(cycle => cycle.cycleNumber), [1, 2]);
  assert.equal(second[0].cycles?.[0].reopenedAt, '2016-02-01');
  assert.equal(second[0].closingEntryId, 'close-2');
  assert.equal(second[1].openingEntryId, 'open-2');
  validatePersistedFiscalExerciseCalendar(second, 'co-1');
});

test('rechaza calendario activo discontinuo en vez de fabricar ejercicios omitidos', () => {
  const broken = exercises().filter(item => item.fiscalYear !== 2016);
  assert.throws(() => ensureFiscalExerciseCalendar({
    id: 'co-1', accountingStartDate: '2015-02-05', fiscalExercises: broken
  }, 2017));
});

test('inicializa todos los ejercicios ordinarios desde el mes de inicio hasta el siguiente año fiscal', () => {
  const calendar = ensureFiscalExerciseCalendar({
    id: 'co-long', accountingStartDate: '2010-02-01', fiscalExercises: []
  }, 2026);
  assert.equal(calendar.length, 18);
  assert.equal(calendar[0].fiscalYear, 2010);
  assert.equal(calendar[0].startDate, '2010-02-01');
  assert.equal(calendar[0].endDate, '2010-12-31');
  assert.equal(calendar[16].fiscalYear, 2026);
  assert.equal(calendar[17].fiscalYear, 2027);
  assert.ok(calendar.every(item => item.status === 'ABIERTO'));
  assert.ok(calendar.every(item => !item.closingEntryId && !item.closedAt));
  validatePersistedFiscalExerciseCalendar(calendar, 'co-long');
});
