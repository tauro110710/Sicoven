'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseVersion, isVersionNewer, checkForUpdate, DOWNLOADS_URL } = require('./update-checker.cjs');

test('parseVersion accepts v-prefixed semantic versions', () => {
  assert.deepEqual(parseVersion('v1.2.3'), [1, 2, 3]);
  assert.deepEqual(parseVersion('1.2.3'), [1, 2, 3]);
  assert.equal(parseVersion('latest'), null);
});

test('isVersionNewer compares numeric components, not strings', () => {
  assert.equal(isVersionNewer('1.0.15', '1.0.14'), true);
  assert.equal(isVersionNewer('1.10.0', '1.9.9'), true);
  assert.equal(isVersionNewer('1.0.14', '1.0.14'), false);
  assert.equal(isVersionNewer('1.0.13', '1.0.14'), false);
});

test('new stable release notifies once and opens the official downloads page on click', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'sicoven-update-'));
  let shown = 0, clickHandler;
  class FakeNotification {
    static isSupported() { return true; }
    constructor(options) { this.options = options; }
    on(event, handler) { if (event === 'click') clickHandler = handler; }
    show() { shown += 1; }
  }
  const options = {
    currentVersion: '1.0.14',
    userDataPath,
    NotificationImpl: FakeNotification,
    shellImpl: { openExternal: url => assert.equal(url, DOWNLOADS_URL) },
    fetchImpl: async () => ({ ok: true, json: async () => ({ tag_name: 'v1.0.15', draft: false, prerelease: false }) })
  };
  try {
    const first = await checkForUpdate(options);
    assert.equal(first.status, 'notified');
    assert.equal(shown, 1);
    clickHandler();
    const second = await checkForUpdate(options);
    assert.equal(second.status, 'already-notified');
    assert.equal(shown, 1);
    const state = JSON.parse(fs.readFileSync(path.join(userDataPath, 'update-notification.json'), 'utf8'));
    assert.equal(state.lastNotifiedVersion, '1.0.15');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('offline check is non-fatal and does not notify', async () => {
  const result = await checkForUpdate({
    currentVersion: '1.0.14',
    userDataPath: os.tmpdir(),
    NotificationImpl: null,
    shellImpl: null,
    fetchImpl: async () => { throw new Error('offline'); }
  });
  assert.equal(result.status, 'offline-or-unavailable');
});

test('draft and prerelease versions are ignored', async () => {
  for (const release of [
    { tag_name: 'v1.0.15', draft: true, prerelease: false },
    { tag_name: 'v1.0.15', draft: false, prerelease: true }
  ]) {
    const result = await checkForUpdate({
      currentVersion: '1.0.14',
      userDataPath: os.tmpdir(),
      NotificationImpl: null,
      shellImpl: null,
      fetchImpl: async () => ({ ok: true, json: async () => release })
    });
    assert.equal(result.status, 'invalid-release');
  }
});
