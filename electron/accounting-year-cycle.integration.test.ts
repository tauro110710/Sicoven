import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import Database from 'better-sqlite3';
import { buildClosingEntryItems } from '../src/types/accountingYearClosing';
import { buildOpeningEntryItems } from '../src/types/accountingYearOpening';
import type { Account, JournalEntry } from '../src/types/accounting';

const require = createRequire(import.meta.url);
const { persistAccountingSnapshot, registerAccountingPersistenceHandler } =
  require('./accounting-persistence.cjs');

const companyId = 'co-annual-cycle';
const accounts: Account[] = [
  { code: '1.1.1', name: 'Banco', type: 'ACTIVO', level: 2, isMovement: true },
  { code: '3.1.1', name: 'Resultados acumulados', type: 'PATRIMONIO', level: 2, isMovement: true },
  { code: '4.1.1', name: 'Ingresos', type: 'INGRESOS', level: 2, isMovement: true },
  { code: '6.1.1', name: 'Gastos', type: 'GASTOS', level: 2, isMovement: true }
];
const line = (accountCode: string, debitBs: number, creditBs: number, debitUsd: number, creditUsd: number) => ({
  accountCode, accountName: accountCode, debitBs, creditBs, debitUsd, creditUsd
});
const baseEntries: JournalEntry[] = [
  {
    id: 'income-2025', companyId, entryNumber: 1, date: '2025-03-01',
    description: 'Ingreso de prueba', type: 'MANUAL', bcvRate: 100,
    createdAt: '2025-03-01T10:00:00.000Z',
    items: [line('1.1.1', 1000, 0, 10, 0), line('4.1.1', 0, 1000, 0, 10)]
  },
  {
    id: 'expense-2025', companyId, entryNumber: 2, date: '2025-06-01',
    description: 'Gasto de prueba', type: 'MANUAL', bcvRate: 100,
    createdAt: '2025-06-01T10:00:00.000Z',
    items: [line('6.1.1', 400, 0, 4, 0), line('1.1.1', 0, 400, 0, 4)]
  }
];

const makeHarness = () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE app_state (
      state_key TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      details_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const handlers = new Map<string, (...args: any[]) => any>();
  registerAccountingPersistenceHandler({
    ipcMain: { handle: (channel: string, handler: (...args: any[]) => any) => handlers.set(channel, handler) },
    db,
    licenseView: () => ({ authorized: true }),
    getActiveSession: (token: string) => token === 'valid-session'
      ? { id: 1, username: 'contador-prueba', role: 'admin' }
      : null
  });
  return {
    db,
    save: handlers.get('sicoven:save-state')!,
    reopen: handlers.get('sicoven:reopen-accounting-year')!
  };
};

const buildCycle = (
  journalEntries: JournalEntry[],
  cycleNumber: number,
  previousClosedThroughDate: string | null,
  createdAt: string
) => {
  const closingDate = '2025-12-31';
  const openingDate = '2026-01-01';
  const closing: JournalEntry = {
    id: 'annual-close-' + cycleNumber, companyId, entryNumber: 10 + cycleNumber * 10,
    date: closingDate, description: 'Cierre anual ciclo ' + cycleNumber,
    type: 'CIERRE', bcvRate: 100,
    referenceDoc: 'CIERRE:' + companyId + ':' + closingDate,
    workpaperNote: 'SICOVEN_AUTO_YEAR_CLOSE_V1',
    annualCloseState: {
      previousFiscalYear: 2025,
      previousClosedThroughDate,
      cycleNumber
    },
    createdAt,
    items: buildClosingEntryItems({
      companyId, periodStartDate: '2025-01-01', periodEndDate: closingDate,
      accounts, journalEntries, retainedEarningsAccountCode: '3.1.1'
    })
  };
  const opening: JournalEntry = {
    id: 'annual-opening-' + cycleNumber, companyId, entryNumber: 11 + cycleNumber * 10,
    date: openingDate, description: 'Apertura anual ciclo ' + cycleNumber,
    type: 'APERTURA', bcvRate: 100,
    referenceDoc: 'APERTURA:' + companyId + ':' + openingDate,
    exerciseLink: {
      priorPeriodStartDate: '2025-01-01',
      priorPeriodEndDate: closingDate,
      nextPeriodStartDate: openingDate,
      cycleNumber
    },
    createdAt,
    items: buildOpeningEntryItems({
      companyId, periodStartDate: '2025-01-01', periodEndDate: closingDate,
      openingDate, accounts, journalEntries: [...journalEntries, closing],
      retainedEarningsAccountCode: '3.1.1'
    })
  };
  return { closing, opening };
};

test('recorre dos ciclos anuales reales con builders, persistencia SQLite, IPC y reaperturas', () => {
  const harness = makeHarness();
  try {
    const baseState = {
      companies: [{ id: companyId, name: 'Empresa ciclo anual', fiscalYear: 2025 }],
      currentCompanyId: companyId,
      accounts,
      journalEntries: baseEntries,
      purchases: [], sales: [], movements: [],
      vatVouchers: [], islrVouchers: [], bankAccounts: [], bankStatementMovements: [],
      creditSettlements: [], displayCurrency: 'DUAL'
    };
    persistAccountingSnapshot(harness.db, baseState, { id: 1, username: 'contador-prueba' });

    const firstCycle = buildCycle(baseEntries, 1, null, '2025-12-31T20:00:00.000Z');
    const firstClosedState = {
      ...baseState,
      companies: [{ ...baseState.companies[0], fiscalYear: 2026, closedThroughDate: '2025-12-31' }],
      journalEntries: [...baseEntries, firstCycle.closing, firstCycle.opening]
    };
    harness.save({}, 'valid-session', firstClosedState);

    const firstReopen = harness.reopen({}, 'valid-session', {
      companyId, reason: 'Revisión integral del primer cierre anual.'
    });
    assert.equal(firstReopen.ok, true);
    assert.equal(firstReopen.company.fiscalYear, 2025);
    assert.equal(firstReopen.company.closedThroughDate, undefined);
    assert.equal(firstReopen.reversalEntries.length, 2);

    const afterFirstRow = harness.db.prepare(
      "SELECT state_json FROM app_state WHERE state_key='accounting'"
    ).get() as { state_json: string } | undefined;
    assert.ok(afterFirstRow);
    const afterFirst = JSON.parse(afterFirstRow.state_json);
    const secondCycle = buildCycle(
      afterFirst.journalEntries, 2, null,
      new Date(Date.now() + 10_000).toISOString()
    );
    const secondClosedState = {
      ...afterFirst,
      companies: afterFirst.companies.map((company: { id: string }) => company.id === companyId
        ? { ...company, fiscalYear: 2026, closedThroughDate: '2025-12-31' }
        : company),
      journalEntries: [...afterFirst.journalEntries, secondCycle.closing, secondCycle.opening]
    };
    harness.save({}, 'valid-session', secondClosedState);

    const secondReopen = harness.reopen({}, 'valid-session', {
      companyId, reason: 'Revisión integral del segundo cierre anual.'
    });
    assert.equal(secondReopen.ok, true);
    assert.equal(secondReopen.company.fiscalYear, 2025);
    assert.equal(secondReopen.reversalEntries.length, 2);

    const finalStateRow = harness.db.prepare(
      "SELECT state_json FROM app_state WHERE state_key='accounting'"
    ).get() as { state_json: string } | undefined;
    assert.ok(finalStateRow);
    const finalState = JSON.parse(finalStateRow.state_json);
    const originals = finalState.journalEntries.filter((entry: JournalEntry) =>
      ['annual-close-1', 'annual-opening-1', 'annual-close-2', 'annual-opening-2'].includes(entry.id)
    );
    const reversals = finalState.journalEntries.filter((entry: JournalEntry) => entry.reversalOfEntryId);
    assert.equal(originals.length, 4);
    assert.ok(originals.every((entry: JournalEntry) => entry.isAdjusted === true && Boolean(entry.reversedByEntryId)));
    assert.equal(reversals.length, 4);
    const exerciseLinks = harness.db.prepare(
      'SELECT COUNT(*) AS count FROM accounting_exercise_links'
    ).get() as { count: number };
    const reopenings = harness.db.prepare(
      'SELECT COUNT(*) AS count FROM accounting_year_reopenings'
    ).get() as { count: number };
    assert.equal(exerciseLinks.count, 2);
    assert.equal(reopenings.count, 2);
    const cycles = (harness.db.prepare(
      'SELECT cycle_number FROM accounting_exercise_links ORDER BY cycle_number'
    ).all() as Array<{ cycle_number: number }>).map(row => row.cycle_number);
    assert.deepEqual(cycles, [1, 2]);
    const auditEvents = harness.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_events WHERE event_type='accounting_year_reopened'"
    ).get() as { count: number };
    assert.equal(auditEvents.count, 2);
  } finally {
    harness.db.close();
  }
});
