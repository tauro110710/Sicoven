'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"\s*\/>/i);

test('renderer declares a restrictive Content Security Policy', () => {
  assert.ok(match, 'Content Security Policy meta tag must exist');
  const policy = match[1];
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self'/);
  assert.doesNotMatch(policy, /script-src[^;]*'unsafe-eval'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /frame-src 'none'/);
});

test('CSP permits only the known renderer network dependencies', () => {
  const policy = match?.[1] || '';
  const connect = policy.split(';').map(x => x.trim()).find(x => x.startsWith('connect-src ')) || '';
  assert.match(connect, /'self'/);
  assert.match(connect, /https:\/\/bcv\.today/);
  assert.match(connect, /ws:\/\/localhost:3000/);
  assert.doesNotMatch(connect, /https:\/\/crm-sicoven\.vercel\.app/);
});
