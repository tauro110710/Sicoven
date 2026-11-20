import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmFiscalExerciseCycle, validatePersistedFiscalExerciseCalendar } from './fiscalExerciseLifecycle';
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
    closingEntryId: 'entry-close-2015', closedAt: '2016-01-02'
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
