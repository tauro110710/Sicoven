'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeOperationReceiptSchema } = require('./operation-receipts.cjs');
const { registerCompanySessionIpc } = require('./company-session-ipc.cjs');

function fixture(overrides = {}) {
  const handlers = new Map();
  const calls = [];
  const controlDb = new Database(':memory:');
  controlDb.pragma('foreign_keys = ON');
  controlDb.exec('CREATE TABLE app_state(state_key TEXT PRIMARY KEY,state_json TEXT NOT NULL,updated_at TEXT NOT NULL DEFAULT (datetime(\'now\')));');
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
    controlDb,
    licenseView: () => ({ authorized: true }),
    getActiveSession: token => token === 'valid-token' ? { id: 1, username: 'admin', role: 'admin' } : null,
    ...overrides
  });
  return { handlers, calls, controlDb };
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

test('returns the active company only through the authenticated session binding', async () => {
  const { handlers, calls } = fixture();
  assert.deepEqual(await handlers.get('sicoven:company-get-active')({}, 'valid-token'), { companyId: 'company-a' });
  assert.deepEqual(calls, [['active', 'valid-token']]);
});


test('recreates company metadata saga tables after a global database restore', async () => {
  const { handlers, controlDb } = fixture();
  controlDb.exec('DROP TABLE company_metadata_completions; DROP TABLE company_metadata_intents;');
  await handlers.get('sicoven:company-list-accessible')({}, 'valid-token');
  const tables = new Set(controlDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  assert.ok(tables.has('company_metadata_intents'));
  assert.ok(tables.has('company_metadata_completions'));
});

test('updates registry metadata and records one recoverable tenant audit receipt', async () => {
  let companyRecord = { id: 'company-a', name: 'Empresa A', rif: 'J-1', status: 'ACTIVE' };
  let acquired = 0, released = 0;
  const tenantDb = new Database(':memory:');
  initializeOperationReceiptSchema(tenantDb);
  tenantDb.exec(`CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL);`);
  const { handlers, controlDb } = fixture({
    runtime: {
      listCompanies: () => [companyRecord],
      createCompany: async company => ({ ok: true, company }),
      updateCompanyMetadata: company => {
        companyRecord = { ...companyRecord, ...company };
        return companyRecord;
      },
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
  const input = {
    operationId: 'company-metadata-operation-001',
    companyId: 'company-a', name: 'EMPRESA A ACTUALIZADA', rif: 'J-12345678-9'
  };
  const result = await handlers.get('sicoven:company-update-metadata')({}, 'valid-token', input);
  assert.equal(result.ok, true);
  assert.deepEqual(companyRecord, { id: 'company-a', name: 'EMPRESA A ACTUALIZADA', rif: 'J-12345678-9', status: 'ACTIVE' });
  const auditEvents = tenantDb.prepare('SELECT event_type,details_json FROM audit_events').all();
  assert.equal(auditEvents.length, 1);
  assert.equal(auditEvents[0].event_type, 'company_metadata_updated');
  const details = JSON.parse(auditEvents[0].details_json);
  assert.equal(details.operationId, input.operationId);
  assert.equal(details.actorUserId, 1);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_intents').get().count, 1);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_completions').get().count, 1);
  const replay = await handlers.get('sicoven:company-update-metadata')({}, 'valid-token', input);
  assert.equal(replay.replayed, true);
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  assert.equal(acquired, 2);
  assert.equal(released, 2);
  tenantDb.close();
});


test('recovers metadata audit after a crash between control registry commit and tenant audit', async () => {
  let companyRecord = { id: 'company-a', name: 'Empresa A', rif: 'J-1', status: 'ACTIVE' };
  let failOpen = true;
  const tenantDb = new Database(':memory:');
  initializeOperationReceiptSchema(tenantDb);
  tenantDb.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL);');
  const { handlers, controlDb } = fixture({
    runtime: {
      listCompanies: () => [companyRecord],
      createCompany: async company => ({ ok: true, company }),
      updateCompanyMetadata: company => { companyRecord = { ...companyRecord, ...company }; return companyRecord; },
      getCompanyDatabase: () => {
        if (failOpen) { failOpen = false; throw new Error('simulated tenant open interruption'); }
        return tenantDb;
      }
    }
  });
  const input = {
    operationId: 'company-metadata-recover-before-audit',
    companyId: 'company-a', name: 'EMPRESA A NUEVA', rif: 'J-12345678-9'
  };
  await assert.rejects(
    () => handlers.get('sicoven:company-update-metadata')({}, 'valid-token', input),
    /simulated tenant open interruption/
  );
  assert.equal(companyRecord.name, 'EMPRESA A NUEVA');
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_intents').get().count, 1);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_completions').get().count, 0);
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 0);
  await handlers.get('sicoven:company-list-accessible')({}, 'valid-token');
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_completions').get().count, 1);
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  await handlers.get('sicoven:company-list-accessible')({}, 'valid-token');
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  tenantDb.close();
});

test('recovery after tenant audit commit but lost control completion does not duplicate the audit', async () => {
  let companyRecord = { id: 'company-a', name: 'Empresa A', rif: 'J-1', status: 'ACTIVE' };
  const tenantDb = new Database(':memory:');
  initializeOperationReceiptSchema(tenantDb);
  tenantDb.exec('CREATE TABLE audit_events(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT NOT NULL,details_json TEXT NOT NULL);');
  const { handlers, controlDb } = fixture({
    runtime: {
      listCompanies: () => [companyRecord],
      createCompany: async company => ({ ok: true, company }),
      updateCompanyMetadata: company => { companyRecord = { ...companyRecord, ...company }; return companyRecord; },
      getCompanyDatabase: () => tenantDb
    }
  });
  controlDb.exec(`CREATE TRIGGER fail_metadata_completion BEFORE INSERT ON company_metadata_completions
    BEGIN SELECT RAISE(ABORT, 'simulated control completion interruption'); END;`);
  const input = {
    operationId: 'company-metadata-recover-after-audit',
    companyId: 'company-a', name: 'EMPRESA A NUEVA', rif: 'J-12345678-9'
  };
  await assert.rejects(
    () => handlers.get('sicoven:company-update-metadata')({}, 'valid-token', input),
    /simulated control completion interruption/
  );
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM operation_receipts').get().count, 1);
  controlDb.exec('DROP TRIGGER fail_metadata_completion');
  await handlers.get('sicoven:company-list-accessible')({}, 'valid-token');
  assert.equal(tenantDb.prepare('SELECT COUNT(*) AS count FROM audit_events').get().count, 1);
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_completions').get().count, 1);
  tenantDb.close();
});

test('metadata intent and registry update roll back together when registry validation fails', async () => {
  const { handlers, controlDb } = fixture({
    runtime: {
      listCompanies: () => [{ id: 'company-a', name: 'Empresa A', rif: 'J-1', status: 'ACTIVE' }],
      createCompany: async company => ({ ok: true, company }),
      updateCompanyMetadata: () => { throw new Error('duplicate RIF'); }
    }
  });
  await assert.rejects(
    () => handlers.get('sicoven:company-update-metadata')({}, 'valid-token', {
      operationId: 'company-metadata-rollback-001',
      companyId: 'company-a', name: 'EMPRESA A NUEVA', rif: 'J-12345678-9'
    }),
    /duplicate RIF/
  );
  assert.equal(controlDb.prepare('SELECT COUNT(*) AS count FROM company_metadata_intents').get().count, 0);
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
