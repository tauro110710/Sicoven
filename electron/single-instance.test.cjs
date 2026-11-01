'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { acquireSingleInstance } = require('./single-instance.cjs');

function fakeApp(lockResult) {
  const app = new EventEmitter();
  app.requestSingleInstanceLock = () => lockResult;
  return app;
}

test('first process acquires the lock and registers one second-instance handler', () => {
  const app = fakeApp(true);
  const calls = [];
  assert.equal(acquireSingleInstance(app, payload => calls.push(payload)), true);
  app.emit('second-instance', {}, ['sicoven.exe', '--open'], 'C:\\SICOVEN');
  assert.deepEqual(calls, [{ commandLine: ['sicoven.exe', '--open'], workingDirectory: 'C:\\SICOVEN' }]);
});

test('second process is rejected and cannot register a focus handler', () => {
  const app = fakeApp(false);
  let focused = false;
  assert.equal(acquireSingleInstance(app, () => { focused = true; }), false);
  assert.equal(app.listenerCount('second-instance'), 0);
  app.emit('second-instance', {});
  assert.equal(focused, false);
});

test('invalid Electron app is rejected before startup', () => {
  assert.throws(() => acquireSingleInstance({}, () => {}), /instancia válida/);
});
