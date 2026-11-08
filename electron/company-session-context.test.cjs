'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompanySessionContext } = require('./company-session-context.cjs');

const tokenA = 'a'.repeat(64);
const tokenB = 'b'.repeat(64);

function fixture(overrides = {}) {
  let activeCompanyId = null;
  const calls = [];
  const companies = [
    { id: 'company-a', status: 'ACTIVE' },
    { id: 'company-b', status: 'ACTIVE' },
    { id: 'company-archived', status: 'ARCHIVED' }
  ];
  const runtime = { listCompanies: () => companies };
  const operationContext = {
    async switchCompany(id) {
      calls.push(['switch', id]);
      const previous = activeCompanyId;
      activeCompanyId = id;
      return { ok: true, changed: previous !== id };
    },
    async clearActiveCompany() {
      const previous = activeCompanyId;
      activeCompanyId = null;
      calls.push(['clear', previous]);
      return { ok: true, previousCompanyId: previous };
    },
    getActiveCompanyId: () => activeCompanyId,
    withActiveDatabase(operation) {
      return Promise.resolve(operation({ marker: activeCompanyId }, activeCompanyId));
    }
  };
  const sessions = new Map([
    [tokenA, { id: 1, role: 'admin' }],
    [tokenB, { id: 2, role: 'contador' }]
  ]);
  const context = createCompanySessionContext({
    runtime,
    operationContext,
    getActiveSession: token => sessions.get(token) || null,
    canAccessCompany: async (actor, company) => actor.role === 'admin' || company.id === 'company-b',
    ...overrides
  });
  return { context, calls, sessions, operationContext, companies };
}

test('requires an authenticated main-process session before selecting a company', async () => {
  const { context } = fixture();
  await assert.rejects(() => context.selectCompany('invalid', 'company-a'), /Sesión no válida/);
  await assert.rejects(() => context.selectCompany('c'.repeat(64), 'company-a'), /sesión expiró/i);
});

test('rejects archived and unauthorized companies', async () => {
  const { context } = fixture();
  await assert.rejects(() => context.selectCompany(tokenA, 'company-archived'), /archivada/i);
  await assert.rejects(() => context.selectCompany(tokenB, 'company-a'), /no tiene acceso/i);
});

test('binds the selected tenant to the session and ignores renderer tenant changes', async () => {
  const { context, operationContext } = fixture();
  await context.selectCompany(tokenA, 'company-a');
  assert.equal(context.getSelectedCompanyId(tokenA), 'company-a');
  assert.throws(() => context.getSelectedCompanyId(tokenB), /no tiene una empresa/i);
  const result = await context.withSelectedDatabase(tokenA, (db, companyId) => ({
    marker: db.marker, companyId
  }));
  assert.deepEqual(result, { marker: 'company-a', companyId: 'company-a' });
  assert.equal(operationContext.getActiveCompanyId(), 'company-a');
});

test('switches only after the operation context has completed its guarded switch', async () => {
  const { context, calls } = fixture();
  await context.selectCompany(tokenA, 'company-a');
  await context.selectCompany(tokenA, 'company-b');
  assert.deepEqual(calls, [['switch', 'company-a'], ['switch', 'company-b']]);
  assert.equal(context.getSelectedCompanyId(tokenA), 'company-b');
});

test('logout clears the active tenant and invalidates the session binding', async () => {
  const { context, calls } = fixture();
  await context.selectCompany(tokenA, 'company-a');
  const result = await context.clearSession(tokenA);
  assert.deepEqual(result, { ok: true, changed: true, previousCompanyId: 'company-a' });
  assert.equal(calls.at(-1)[0], 'clear');
  assert.throws(() => context.getSelectedCompanyId(tokenA), /no tiene una empresa/i);
});

test('revalidates session and permissions after a delayed tenant switch', async () => {
  let valid = true;
  let access = true;
  let activeCompanyId = null;
  const context = createCompanySessionContext({
    runtime: { listCompanies: () => [{ id: 'company-a', status: 'ACTIVE' }] },
    operationContext: {
      async switchCompany(id) {
        await Promise.resolve();
        activeCompanyId = id;
        return { changed: true };
      },
      clearActiveCompany: async () => ({ previousCompanyId: activeCompanyId }),
      getActiveCompanyId: () => activeCompanyId,
      withActiveDatabase: operation => operation({}, activeCompanyId)
    },
    getActiveSession: () => valid ? { id: 1, role: 'admin' } : null,
    canAccessCompany: async () => access
  });
  // Session expiration while the switch is in flight must not publish a binding.
  const switching = context.selectCompany(tokenA, 'company-a');
  valid = false;
  await assert.rejects(() => switching, /sesión expiró/i);
  assert.throws(() => context.getSelectedCompanyId(tokenA), /sesión expiró/i);
});
