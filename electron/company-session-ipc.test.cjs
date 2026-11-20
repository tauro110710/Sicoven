'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerCompanySessionIpc } = require('./company-session-ipc.cjs');

function fixture(overrides = {}) {
  const handlers = new Map();
  const calls = [];
  const context = {
    async listAccessibleCompanies(token) {
      calls.push(['list', token]);
      return [{ id: 'company-a', name: 'Empresa A', rif: 'J-1' }];
    },
    async selectCompany(token, companyId) {
      calls.push(['select', token, companyId]);
      return { ok: true, companyId };
    },
    getSelectedCompanyId(token) {
      calls.push(['active', token]);
      return 'company-a';
    },
    ...overrides.context
  };
  registerCompanySessionIpc({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    companySessionContext: context,
    runtime: {
      createCompany: async company => ({ ok: true, company }),
      getCompanyDatabase: () => ({ prepare: () => ({ run: () => ({ lastInsertRowid: 1 }) }) })
    },
    operationContext: {
      getActiveCompanyId: () => 'company-a',
      acquireMaintenanceLock: async () => () => {}
    },
    controlDb: { prepare: () => ({ run: () => ({ changes: 1 }) }) },
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'valid-token' ? { id: 1, role: 'admin' } : null,
    ...overrides
  });
  return { handlers, calls };
}

test('lists only companies returned by the authenticated context', async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.get('sicoven:company-list-accessible')({}, 'valid-token');
  assert.deepEqual(result, [{ id: 'company-a', name: 'Empresa A', rif: 'J-1' }]);
  assert.deepEqual(calls, [['list', 'valid-token']]);
});

test('rejects company listing when license or session is invalid', async () => {
  const { handlers } = fixture({ licenseView: () => ({ authorized: false, message: 'Licencia vencida' }) });
  await assert.rejects(
    () => handlers.get('sicoven:company-list-accessible')({}, 'valid-token'),
    /Licencia vencida/
  );
});

test('passes only the requested company identifier to the session-owned context', async () => {
  const { handlers, calls } = fixture();
  const result = await handlers.get('sicoven:company-select-active')({}, 'valid-token', { companyId: 'company-a', path: 'C:\\unsafe' });
  assert.deepEqual(result, { ok: true, companyId: 'company-a' });
  assert.deepEqual(calls, [['select', 'valid-token', 'company-a']]);
});

test('rejects malformed company identifiers before invoking the context', async () => {
  const { handlers, calls } = fixture();
  await assert.rejects(
    () => handlers.get('sicoven:company-select-active')({}, 'valid-token', { companyId: 'x'.repeat(121) }),
    /no es válida/
  );
  assert.deepEqual(calls, []);
});

test('returns the active company only through the authenticated session binding', () => {
  const { handlers, calls } = fixture();
  assert.deepEqual(handlers.get('sicoven:company-get-active')({}, 'valid-token'), { companyId: 'company-a' });
  assert.deepEqual(calls, [['active', 'valid-token']]);
});


test('updates registry identity and records a tenant audit event under maintenance lock', async () => {
  let updatedMetadata = null;
  const auditEvents = [];
  let acquired = 0, released = 0;
  const tenantDb = { prepare: () => ({ run: (...args) => auditEvents.push(args) }) };
  const { handlers } = fixture({
    runtime: {
      listCompanies: () => [{ id: 'company-a', name: 'Empresa A', rif: 'J-1', status: 'ACTIVE' }],
      createCompany: async company => ({ ok: true, company }),
      updateCompanyMetadata: company => { updatedMetadata = company; return { ...company, status: 'ACTIVE' }; },
      getCompanyDatabase: () => tenantDb
    },
    operationContext: {
      getActiveCompanyId: () => 'company-a',
      acquireMaintenanceLock: async () => {
        acquired += 1;
        return () => { released += 1; };
      }
    }
  });
  const result = await handlers.get('sicoven:company-update-metadata')({}, 'valid-token', {
    companyId: 'company-a', name: 'EMPRESA A ACTUALIZADA', rif: 'J-12345678-9'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(updatedMetadata, { companyId: 'company-a', name: 'EMPRESA A ACTUALIZADA', rif: 'J-12345678-9' });
  assert.equal(auditEvents[0][0], 'company_metadata_updated');
  assert.equal(acquired, 1);
  assert.equal(released, 1);
});


test('company creation retries recover the same tenant instead of creating a duplicate', async () => {
  let companyRecord = null;
  let creationCount = 0;
  let creationAudit = null;
  const selections = [];
  const tenantDb = {
    prepare: () => ({
      get: () => creationAudit ? { details_json: JSON.stringify(creationAudit) } : undefined,
      run: () => ({ lastInsertRowid: 1 })
    })
  };
  const { handlers } = fixture({
    context: {
      async selectCompany(token, companyId) {
        selections.push(companyId);
        return { ok: true, companyId };
      }
    },
    runtime: {
      listCompanies: () => companyRecord ? [companyRecord] : [],
      getCompanyDatabase: () => tenantDb,
      createCompany: async (company, actor, operation) => {
        creationCount += 1;
        companyRecord = { id: company.id, name: company.name, rif: company.rif, status: 'ACTIVE' };
        creationAudit = {
          operationId: operation.operationId,
          requestHash: operation.requestHash,
          actorUserId: actor.id
        };
        return { ok: true, company: companyRecord };
      }
    }
  });
  const input = {
    operationId: 'company-create-operation-001',
    name: 'EMPRESA HISTORICA',
    rif: 'J-12345678-9',
    accountingStartDate: '2015-02-05'
  };
  const first = await handlers.get('sicoven:company-create')({}, 'valid-token', input);
  const recovered = await handlers.get('sicoven:company-create')({}, 'valid-token', input);
  assert.equal(first.ok, true);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.replayed, true);
  assert.equal(first.company.id, input.operationId);
  assert.equal(recovered.company.id, first.company.id);
  assert.equal(creationCount, 1);
  assert.deepEqual(selections, [input.operationId, input.operationId]);
  await assert.rejects(
    () => handlers.get('sicoven:company-create')({}, 'valid-token', { ...input, name: 'OTRA EMPRESA' }),
    /clave de creación ya está asociada/
  );
  assert.equal(creationCount, 1);
});
