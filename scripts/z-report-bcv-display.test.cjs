'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'src/components/LibroVentas/LibroVentasView.tsx'),
  'utf8'
);

test('Reportes Z displays the historical BCV rate stored on its journal entry', () => {
  assert.match(source, /Tasa BCV \(Bs\/USD\)/);
  assert.match(source, /Number\(entry\.bcvRate\)\s*>\s*0/);
  assert.match(source, /Number\(entry\.bcvRate\)\s*\)/);
  assert.match(source, /No registrada/);
});

test('Reportes Z table column count and empty-state colspan stay aligned', () => {
  assert.match(source, /<td colSpan=\{13\}/);
  const header = source.match(/<thead[\s\S]*?<\/thead>/)?.[0] || '';
  assert.equal((header.match(/<th\b/g) || []).length, 13);
});
