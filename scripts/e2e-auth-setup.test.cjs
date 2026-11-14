'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const e2e = fs.readFileSync(path.join(__dirname, 'e2e-migration-ui.cjs'), 'utf8');

test('Windows migration E2E follows the first-run administrator setup flow', () => {
  assert.match(e2e, /setInput\('#username', 'e2e-admin'\)/);
  assert.match(e2e, /setInput\('#password', 'E2E-Sicoven-Initial-Admin-2026!'\)/);
  assert.match(e2e, /clickButton\('Crear administrador inicial'\)/);
  assert.doesNotMatch(e2e, /clickButton\('Iniciar sesión'\)/);
});
