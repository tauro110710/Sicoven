'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTenantOperationContext } = require('./tenant-operation-context.cjs');

function makeRuntime() {
  const records = [
    { id: 'company-a', status: 'ACTIVE' },
    { id: 'company-b', status: 'ACTIVE' },
    { id: 'company-archived', status: 'ARCHIVED' }
  ];
  const open = new Map();
  const runtime = {
    listCompanies: () => records,
    isCompanyOpen: id => open.has(id),
    getCompanyDatabase: id => {
      const record = records.find(item => item.id === id && item.status === 'ACTIVE');
      if (!record) throw new Error('company unavailable');
      if (!open.has(id)) open.set(id, {
        companyId: id,
        prepare: () => ({ get: () => ({ state_json: JSON.stringify({
          companies: [{ id }], currentCompanyId: id
        }) }) })
      });
      return open.get(id);
    },
    closeCompany: id => open.delete(id)
  };
  return { runtime, open };
}

function makeContext(t, options = {}) {
  const { runtime, open } = makeRuntime();
  const context = createTenantOperationContext({
    runtime,
    flushPendingWrites: options.flushPendingWrites || (async () => {})
  });
  t.after(() => {
    for (const id of [...open.keys()]) runtime.closeCompany(id);
  });
  return { context, runtime, open };
}

test('requires a validated active company before exposing an operational database', async t => {
  const { context } = makeContext(t);
  await assert.rejects(() => context.withActiveDatabase(() => true), /No hay una empresa activa/);
});

test('waits for pending renderer persistence before switching the active company', async t => {
  const calls = [];
  const { context } = makeContext(t, {
    flushPendingWrites: async () => { calls.push('flush'); }
  });
  const result = await context.switchCompany('company-a');
  assert.deepEqual(calls, ['flush']);
  assert.deepEqual(result, {
    ok: true, changed: true, companyId: 'company-a', previousCompanyId: null
  });
  assert.equal(context.getActiveCompanyId(), 'company-a');
});

test('does not expose the target company until an in-flight operation has completed', async t => {
  const { context } = makeContext(t);
  await context.switchCompany('company-a');
  let releaseOperation;
  const operation = context.withActiveDatabase(() => new Promise(resolve => {
    releaseOperation = resolve;
  }));
  const switching = context.switchCompany('company-b');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.isSwitching(), true);
  await assert.rejects(() => context.withActiveDatabase(() => true), /cambio de empresa está en curso/);
  assert.equal(context.getActiveCompanyId(), 'company-a');
  releaseOperation('finished');
  assert.equal(await operation, 'finished');
  const result = await switching;
  assert.equal(result.companyId, 'company-b');
  assert.equal(context.getActiveCompanyId(), 'company-b');
});


test('permits only the queued persistence drain while switching and closes that lane before waiting for active work', async t => {
  let context;
  const flushCalls = [];
  const { runtime, open } = makeRuntime();
  context = createTenantOperationContext({
    runtime,
    flushPendingWrites: async () => {
      if (!context.getActiveCompanyId()) return;
      const saved = await context.withPersistenceDatabase((db, companyId) => [db.companyId, companyId]);
      flushCalls.push(saved);
    }
  });
  t.after(() => { for (const id of [...open.keys()]) runtime.closeCompany(id); });

  await context.switchCompany('company-a');
  let releaseOperation;
  const operation = context.withActiveDatabase(() => new Promise(resolve => {
    releaseOperation = resolve;
  }));
  const switching = context.switchCompany('company-b');
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(flushCalls, [['company-a', 'company-a']]);
  assert.equal(context.isSwitching(), true);
  await assert.rejects(
    () => context.withPersistenceDatabase(() => true),
    /cambio de empresa está en curso/
  );

  releaseOperation();
  await operation;
  await switching;
  assert.equal(context.getActiveCompanyId(), 'company-b');
});

test('preserves the previous company when the requested company is missing or archived', async t => {
  const { context } = makeContext(t);
  await context.switchCompany('company-a');
  await assert.rejects(() => context.switchCompany('company-archived'), /no está registrada o se encuentra archivada/);
  assert.equal(context.getActiveCompanyId(), 'company-a');
  await assert.rejects(() => context.switchCompany('unknown-company'), /no está registrada o se encuentra archivada/);
  assert.equal(context.getActiveCompanyId(), 'company-a');
});

test('serializes asynchronous database operations and recovers the queue after a rejection', async t => {
  const { context } = makeContext(t);
  await context.switchCompany('company-a');
  const events = [];
  let releaseFirst;
  const first = context.withActiveDatabase(async (_db, companyId) => {
    events.push('first-start:' + companyId);
    await new Promise(resolve => { releaseFirst = resolve; });
    events.push('first-end:' + companyId);
    throw new Error('expected first operation failure');
  });
  const second = context.withActiveDatabase((_db, companyId) => {
    events.push('second:' + companyId);
    return 'second-complete';
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['first-start:company-a']);
  releaseFirst();
  await assert.rejects(first, /expected first operation failure/);
  assert.equal(await second, 'second-complete');
  assert.deepEqual(events, ['first-start:company-a', 'first-end:company-a', 'second:company-a']);
  assert.equal(context.getActiveOperationCount(), 0);
});

test('serializes access through the active tenant and closes the previous connection after a successful switch', async t => {
  const { context, open } = makeContext(t);
  await context.switchCompany('company-a');
  const first = await context.withActiveDatabase((db, companyId) => ({
    dbCompanyId: db.companyId, companyId
  }));
  assert.deepEqual(first, { dbCompanyId: 'company-a', companyId: 'company-a' });
  await context.switchCompany('company-b');
  assert.equal(open.has('company-a'), false);
  assert.equal(open.has('company-b'), true);
  const second = await context.withActiveDatabase((db, companyId) => [db.companyId, companyId]);
  assert.deepEqual(second, ['company-b', 'company-b']);
});

test('clears the active company only after flushing persistence and draining operations', async t => {
  const events = [];
  const { context } = makeContext(t, {
    flushPendingWrites: async () => { events.push('flush'); }
  });
  await context.switchCompany('company-a');
  const result = await context.clearActiveCompany();
  assert.deepEqual(events, ['flush', 'flush']);
  assert.equal(result.previousCompanyId, 'company-a');
  assert.equal(context.getActiveCompanyId(), null);
  await assert.rejects(() => context.withActiveDatabase(() => true), /No hay una empresa activa/);
});

test('rejects overlapping company switches rather than racing database handles', async t => {
  let releaseFlush;
  const { context } = makeContext(t, {
    flushPendingWrites: () => new Promise(resolve => { releaseFlush = resolve; })
  });
  const first = context.switchCompany('company-a');
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(() => context.switchCompany('company-b'), /Ya hay un cambio de empresa en curso/);
  releaseFlush();
  await first;
  assert.equal(context.getActiveCompanyId(), 'company-a');
});
