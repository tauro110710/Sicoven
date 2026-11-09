'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { assertSqliteIntegrity } = require('./sqlite-integrity.cjs');
const { createTenantRuntime } = require('./tenant-runtime.cjs');
const { registerCompanyExportIpc } = require('./company-export-ipc.cjs');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-company-export-ipc-'));
  const controlDb = new Database(path.join(root, 'sicoven.sqlite'));
  const runtime = createTenantRuntime({ controlDb, userDataDir: root, Database, assertSqliteIntegrity });
  const company = { id: 'ipc-company', name: 'Empresa IPC', rif: 'J-12345678-9' };
  t.after(() => {
    try { runtime.closeAll(); } catch {}
    try { controlDb.close(); } catch {}
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, controlDb, runtime, company };
}

function registerFixture({ root, runtime, company, destination, lockState, getActiveSession = () => ({ id: 7, username: 'admin', role: 'admin' }), onLock = () => {} }) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  registerCompanyExportIpc({
    ipcMain,
    runtime,
    operationContext: {
      acquireMaintenanceLock: async () => {
        lockState.acquired += 1;
        onLock();
        return () => { lockState.released += 1; };
      }
    },
    companySessionContext: { getSelectedCompanyId: () => company.id },
    licenseView: () => ({ authorized: true }),
    getActiveSession,
    dialog: { showSaveDialog: async () => ({ canceled: false, filePath: destination }) },
    app: { getPath: key => key === 'userData' ? root : root },
    getWindow: () => null
  });
  return handlers.get('sicoven:company-export-data');
}

test('company export IPC records a durable start and completion audit and always releases maintenance lock', async t => {
  const fixture = setup(t);
  await fixture.runtime.createCompany(fixture.company);
  const lockState = { acquired: 0, released: 0 };
  const destination = path.join(fixture.root, 'company-handover.json');
  const handler = registerFixture({ ...fixture, destination, lockState });
  const result = await handler({ sender: {} }, 'a'.repeat(64), { format: 'json' });
  assert.equal(result.ok, true);
  assert.equal(result.companyId, fixture.company.id);
  assert.equal(lockState.acquired, 1);
  assert.equal(lockState.released, 1);
  const events = fixture.runtime.getCompanyDatabase(fixture.company.id)
    .prepare("SELECT event_type,details_json FROM audit_events WHERE event_type LIKE 'company_data_export_%' ORDER BY id").all();
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.event_type), ['company_data_export_started', 'company_data_exported']);
  assert.equal(JSON.parse(events[0].details_json).exportId, JSON.parse(events[1].details_json).exportId);
  assert.equal(JSON.parse(events[1].details_json).destination, destination);
});

test('company export IPC records failed attempts without marking rejected cross-company packages as exported', async t => {
  const fixture = setup(t);
  await fixture.runtime.createCompany(fixture.company);
  const db = fixture.runtime.getCompanyDatabase(fixture.company.id);
  db.exec('CREATE TABLE export_ipc_probe (id TEXT PRIMARY KEY, company_id TEXT NOT NULL)');
  db.prepare('INSERT INTO export_ipc_probe(id,company_id) VALUES(?,?)').run('foreign', 'other-company');
  const lockState = { acquired: 0, released: 0 };
  const destination = path.join(fixture.root, 'blocked-handover.json');
  const handler = registerFixture({ ...fixture, destination, lockState });
  await assert.rejects(handler({ sender: {} }, 'a'.repeat(64), { format: 'json' }), /pertenecientes a otra empresa/);
  assert.equal(lockState.acquired, 1);
  assert.equal(lockState.released, 1);
  assert.equal(fs.existsSync(destination), false);
  const events = db.prepare("SELECT event_type FROM audit_events WHERE event_type LIKE 'company_data_export_%' ORDER BY id").all();
  assert.deepEqual(events.map(event => event.event_type), ['company_data_export_started', 'company_data_export_failed']);
});


test('company export IPC revalidates the authenticated session after the maintenance drain', async t => {
  const fixture = setup(t);
  await fixture.runtime.createCompany(fixture.company);
  let sessionActive = true;
  const lockState = { acquired: 0, released: 0 };
  const destination = path.join(fixture.root, 'expired-session-handover.json');
  const handler = registerFixture({
    ...fixture, destination, lockState,
    getActiveSession: () => sessionActive ? ({ id: 7, username: 'admin', role: 'admin' }) : null,
    onLock: () => { sessionActive = false; }
  });
  await assert.rejects(
    handler({ sender: {} }, 'a'.repeat(64), { format: 'json' }),
    /sesión expiró o perdió permisos/
  );
  assert.equal(lockState.acquired, 1);
  assert.equal(lockState.released, 1);
  assert.equal(fs.existsSync(destination), false);
  const db = fixture.runtime.getCompanyDatabase(fixture.company.id);
  const events = db.prepare("SELECT COUNT(*) AS count FROM audit_events WHERE event_type LIKE 'company_data_export_%'").get();
  assert.equal(events.count, 0);
});
