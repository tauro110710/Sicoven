'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { restoreWindowFocus } = require('./window-focus.cjs');

test('restoreWindowFocus restores minimized window and focuses window and webContents', () => {
  const calls = [];
  const win = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    focus: () => calls.push('win.focus'),
    webContents: {
      isDestroyed: () => false,
      focus: () => calls.push('webContents.focus')
    }
  };

  assert.equal(restoreWindowFocus(win), true);
  assert.deepEqual(calls, ['restore', 'win.focus', 'webContents.focus']);
});

test('restoreWindowFocus skips destroyed windows and falls back to BrowserWindow.getAllWindows', () => {
  const calls = [];
  const destroyed = { isDestroyed: () => true };
  const live = {
    isDestroyed: () => false,
    isMinimized: () => false,
    focus: () => calls.push('live.focus'),
    webContents: { isDestroyed: () => false, focus: () => calls.push('live.wc.focus') }
  };

  assert.equal(restoreWindowFocus(destroyed), false);
  assert.equal(restoreWindowFocus(null, { getAllWindows: () => [destroyed, live] }), true);
  assert.deepEqual(calls, ['live.focus', 'live.wc.focus']);
});
