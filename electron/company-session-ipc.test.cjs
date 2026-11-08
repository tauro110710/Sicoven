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
