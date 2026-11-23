import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVenezuelanAmount } from './parseVenezuelanAmount';

test('interpreta coma decimal para importes en formato venezolano', () => {
  assert.equal(parseVenezuelanAmount('1.234,56'), 1234.56);
  assert.equal(parseVenezuelanAmount('45,70'), 45.7);
});

test('acepta punto decimal y enteros sin alterarlos', () => {
  assert.equal(parseVenezuelanAmount('1234.56'), 1234.56);
  assert.equal(parseVenezuelanAmount('2000'), 2000);
});

test('retorna NaN para entradas no numéricas o vacías', () => {
  assert.ok(Number.isNaN(parseVenezuelanAmount('')));
  assert.ok(Number.isNaN(parseVenezuelanAmount('abc')));
});
