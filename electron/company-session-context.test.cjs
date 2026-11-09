'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCompanySessionContext } = require('./company-session-context.cjs');
const { registerCompanySessionIpc } = require('./company-session-ipc.cjs');

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

test('lists only active companies authorized for the authenticated actor without exposing database paths', async () => {
  const { context, companies } = fixture();
  companies.push({
    id: 'company-path-check', status: 'ACTIVE', name: 'Empresa protegida',
    rif: 'J-123', relativePath: 'companies/company-path-check/accounting.sqlite'
  });
  const adminChoices = await context.listAccessibleCompanies(tokenA);
  assert.deepEqual(adminChoices, [
    { id: 'company-a', name: '', rif: '' },
    { id: 'company-b', name: '', rif: '' },
    { id: 'company-path-check', name: 'Empresa protegida', rif: 'J-123' }
  ]);
  const accountantChoices = await context.listAccessibleCompanies(tokenB);
  assert.deepEqual(accountantChoices, [{ id: 'company-b', name: '', rif: '' }]);
  assert.equal(JSON.stringify(adminChoices).includes('relativePath'), false);
  await assert.rejects(() => context.listAccessibleCompanies('invalid'), /Sesión no válida/);
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

test('prevents a second authenticated session from taking over the single operational tenant context', async () => {
  const { context } = fixture();
  await context.selectCompany(tokenA, 'company-a');
  await assert.rejects(
    () => context.selectCompany(tokenB, 'company-b'),
    /otra sesión autenticada/i
  );
  assert.equal(context.getSelectedCompanyId(tokenA), 'company-a');
  assert.throws(() => context.getSelectedCompanyId(tokenB), /no tiene una empresa/i);
  await context.clearSession(tokenA);
  await context.selectCompany(tokenB, 'company-b');
  assert.equal(context.getSelectedCompanyId(tokenB), 'company-b');
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

test('clears the active database as well as every session binding on license shutdown', async () => {
  const { context, calls, operationContext } = fixture();
  await context.selectCompany(tokenA, 'company-a');
  const result = await context.clearAllSessions();
  assert.deepEqual(result, { ok: true });
  assert.equal(operationContext.getActiveCompanyId(), null);
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

test('preserves the prior authenticated tenant binding when a switch is rejected by a failed persistence drain', async () => {
  let activeCompanyId = null;
  let failNextSwitch = false;
  const context = createCompanySessionContext({
    runtime: { listCompanies: () => [
      { id: 'company-a', status: 'ACTIVE' },
      { id: 'company-b', status: 'ACTIVE' }
    ] },
    operationContext: {
      async switchCompany(id) {
        if (failNextSwitch) {
          failNextSwitch = false;
          throw new Error('simulated persistence drain failure');
        }
        const previous = activeCompanyId;
        activeCompanyId = id;
        return { changed: previous !== id };
      },
      async clearActiveCompany() {
        const previousCompanyId = activeCompanyId;
        activeCompanyId = null;
        return { previousCompanyId };
      },
      getActiveCompanyId: () => activeCompanyId,
      withActiveDatabase: operation => Promise.resolve(operation({ marker: activeCompanyId }, activeCompanyId))
    },
    getActiveSession: token => token === tokenA ? { id: 1, role: 'admin' } : null,
    canAccessCompany: async () => true
  });

  await context.selectCompany(tokenA, 'company-a');
  failNextSwitch = true;
  await assert.rejects(
    () => context.selectCompany(tokenA, 'company-b'),
    /simulated persistence drain failure/
  );
  assert.equal(context.getSelectedCompanyId(tokenA), 'company-a');
  assert.equal(activeCompanyId, 'company-a');
  const result = await context.withSelectedDatabase(tokenA, (db, companyId) => [db.marker, companyId]);
  assert.deepEqual(result, ['company-a', 'company-a']);
});


test('rechecks company status and access before every tenant database operation', async () => {
  let allowed = true;
  const companies = [{ id: 'company-a', status: 'ACTIVE' }];
  let activeCompanyId = null;
  const context = createCompanySessionContext({
    runtime: { listCompanies: () => companies },
    operationContext: {
      async switchCompany(id) { activeCompanyId = id; return { changed: true }; },
      async clearActiveCompany() { const previousCompanyId = activeCompanyId; activeCompanyId = null; return { previousCompanyId }; },
      getActiveCompanyId: () => activeCompanyId,
      withActiveDatabase: operation => Promise.resolve(operation({ marker: 'tenant-db' }, activeCompanyId))
    },
    getActiveSession: token => token === tokenA ? { id: 1, role: 'admin' } : null,
    canAccessCompany: async () => allowed
  });
  await context.selectCompany(tokenA, 'company-a');
  assert.equal(await context.withSelectedDatabase(tokenA, db => db.marker), 'tenant-db');
  allowed = false;
  await assert.rejects(() => context.withSelectedDatabase(tokenA, () => true), /no tiene acceso autorizado/);
  allowed = true;
  companies[0].status = 'ARCHIVED';
  await assert.rejects(() => context.withSelectedDatabase(tokenA, () => true), /no tiene acceso autorizado/);
});


test('company creation IPC serializes tenant creation and persists the selected-company preference', async () => {
  const handlers = new Map();
  const preferences = new Map();
  let createdActor = null;
  let selectedCompanyId = null;
  let createdCompany = null;
  let acquired = 0, released = 0;
  const controlDb = {
    prepare: () => ({ run: (_json) => preferences.set('active_company_preference', _json) })
  };
  registerCompanySessionIpc({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    companySessionContext: {
      listAccessibleCompanies: async () => [],
      selectCompany: async (_token, companyId) => { selectedCompanyId = companyId; return { ok: true, changed: true, companyId }; },
      getSelectedCompanyId: () => selectedCompanyId
    },
    runtime: {
      createCompany: async (company, actor) => { createdCompany = company; createdActor = actor; return { ok: true, company }; }
    },
    operationContext: {
      acquireMaintenanceLock: async () => {
        acquired += 1;
        return () => { released += 1; };
      }
    },
    controlDb,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === tokenA ? ({ id: 1, username: 'admin', role: 'admin' }) : null
  });
  const result = await handlers.get('sicoven:company-create')({}, tokenA, {
    name: 'EMPRESA A', rif: 'J-12345678-9', taxpayerType: 'ORDINARIO'
  });
  assert.equal(result.ok, true);
  assert.ok(createdCompany.id);
  assert.equal(selectedCompanyId, createdCompany.id);
  assert.equal(acquired, 1);
  assert.equal(released, 1);
  assert.equal(createdActor.username, 'admin');
  assert.ok(preferences.has('active_company_preference'));
});
