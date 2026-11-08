'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerPersistenceFlushIpc } = require('./persistence-flush-ipc.cjs');

function setup({ authorized = true, session = true, timeoutMs = 100 } = {}) {
  const handlers = new Map();
  const events = new EventEmitter();
  const sender = new EventEmitter();
  sender.isDestroyed = () => false;
  sender.send = (channel, payload) => events.emit('request', channel, payload);
  const window = { isDestroyed: () => false };
  const ipcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    on: (channel, handler) => events.on(channel, handler),
    removeListener: (channel, handler) => events.removeListener(channel, handler),
    removeHandler: channel => handlers.delete(channel)
  };
  const bridge = registerPersistenceFlushIpc({
    ipcMain,
    licenseView: () => ({ authorized }),
    getActiveSession: token => session && token === 'valid-token' ? { id: 1 } : null,
    getWindow: candidate => candidate === sender ? window : null,
    timeoutMs
  });
  return { handlers, events, sender, bridge };
}

test('persistence flush resolves only after the same renderer acknowledges', async () => {
  const state = setup();
  const operation = state.handlers.get('sicoven:persistence-flush')({ sender: state.sender }, 'valid-token');
  const request = await new Promise(resolve => state.events.once('request', (_channel, payload) => resolve(payload)));
  state.events.emit('sicoven:persistence-flush-ack', { sender: state.sender }, { requestId: request.requestId, ok: true });
  assert.deepEqual(await operation, { ok: true });
  assert.equal(state.bridge.getPendingCount(), 0);
  state.bridge.dispose();
});

test('persistence flush ignores acknowledgements from another renderer', async () => {
  const state = setup();
  const operation = state.handlers.get('sicoven:persistence-flush')({ sender: state.sender }, 'valid-token');
  const request = await new Promise(resolve => state.events.once('request', (_channel, payload) => resolve(payload)));
  state.events.emit('sicoven:persistence-flush-ack', { sender: {} }, { requestId: request.requestId, ok: true });
  assert.equal(state.bridge.getPendingCount(), 1);
  state.events.emit('sicoven:persistence-flush-ack', { sender: state.sender }, { requestId: request.requestId, ok: true });
  assert.deepEqual(await operation, { ok: true });
  state.bridge.dispose();
});

test('persistence flush rejects unauthorized sessions and licenses', async () => {
  const noLicense = setup({ authorized: false });
  await assert.rejects(
    noLicense.handlers.get('sicoven:persistence-flush')({ sender: noLicense.sender }, 'valid-token'),
    /Licencia no autorizada/
  );
  noLicense.bridge.dispose();

  const noSession = setup({ session: false });
  await assert.rejects(
    noSession.handlers.get('sicoven:persistence-flush')({ sender: noSession.sender }, 'valid-token'),
    /Sesión no válida/
  );
  noSession.bridge.dispose();
});

test('persistence flush times out closed rather than allowing an unsafe switch', async () => {
  const state = setup({ timeoutMs: 10 });
  await assert.rejects(
    state.handlers.get('sicoven:persistence-flush')({ sender: state.sender }, 'valid-token'),
    /se canceló el cambio/
  );
  assert.equal(state.bridge.getPendingCount(), 0);
  state.bridge.dispose();
});

test('persistence flush rejects an acknowledgement that reports a renderer failure', async () => {
  const state = setup();
  const operation = state.handlers.get('sicoven:persistence-flush')({ sender: state.sender }, 'valid-token');
  const request = await new Promise(resolve => state.events.once('request', (_channel, payload) => resolve(payload)));
  state.events.emit('sicoven:persistence-flush-ack', { sender: state.sender }, {
    requestId: request.requestId, ok: false, message: 'SQLite no confirmó el guardado.'
  });
  await assert.rejects(operation, /SQLite no confirmó el guardado/);
  state.bridge.dispose();
});
