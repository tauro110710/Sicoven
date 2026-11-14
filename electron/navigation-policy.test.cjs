'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { isTrustedNavigation } = require('./navigation-policy.cjs');

const entryPath = path.join(os.tmpdir(), 'sicoven', 'dist', 'index.html');

test('packaged window only accepts its exact local application entry point', () => {
  assert.equal(isTrustedNavigation(pathToFileURL(entryPath).href, { isPackaged: true, entryPath }), true);
  assert.equal(isTrustedNavigation(pathToFileURL(path.join(path.dirname(entryPath), 'other.html')).href, { isPackaged: true, entryPath }), false);
  assert.equal(isTrustedNavigation('https://example.com/', { isPackaged: true, entryPath }), false);
});

test('development window accepts only the configured local Vite origin', () => {
  const options = { isPackaged: false, devServerOrigin: 'http://localhost:3000' };
  assert.equal(isTrustedNavigation('http://localhost:3000/', options), true);
  assert.equal(isTrustedNavigation('http://localhost:3000/accounting', options), true);
  assert.equal(isTrustedNavigation('http://localhost.evil.example:3000/', options), false);
  assert.equal(isTrustedNavigation('https://localhost:3000/', options), false);
  assert.equal(isTrustedNavigation('https://example.com/', options), false);
});

test('malformed and non-string navigation targets are rejected', () => {
  assert.equal(isTrustedNavigation('not a URL', { isPackaged: false }), false);
  assert.equal(isTrustedNavigation('', { isPackaged: true, entryPath }), false);
});
