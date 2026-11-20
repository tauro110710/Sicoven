import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDecimal, compareDecimal, decimalToString, divideDecimal, multiplyDecimal,
  parseDecimal, roundDecimal, subtractDecimal
} from './exactDecimal';

const text = (value: ReturnType<typeof parseDecimal>) => decimalToString(value);

test('suma y resta decimales alineando escalas sin errores binarios', () => {
  assert.equal(text(addDecimal('0.1', '0.2')), '0.3');
  assert.equal(text(subtractDecimal('1.00000001', '0.00000002')), '0.99999999');
  assert.equal(text(addDecimal('999999999999999999999.99', '0.01')), '1000000000000000000000');
});

test('multiplica importes y cantidades con precisión decimal exacta', () => {
  assert.equal(text(multiplyDecimal('0.1', '0.2')), '0.02');
  assert.equal(text(multiplyDecimal('12345678901234567890.1234', '0.00000001')), '123456789012.345678901234');
});

test('divide con precisión explícita y redondeo simétrico fuera de cero', () => {
  assert.equal(text(divideDecimal('1', '3', 12)), '0.333333333333');
  assert.equal(text(divideDecimal('1', '8', 2)), '0.13');
  assert.equal(text(divideDecimal('-1', '8', 2)), '-0.13');
  assert.equal(text(divideDecimal('1', '-8', 2)), '-0.13');
});

test('redondea solo cuando se solicita y conserva los importes originales', () => {
  assert.equal(text(parseDecimal('1.005')), '1.005');
  assert.equal(text(roundDecimal('1.005', 2)), '1.01');
  assert.equal(text(roundDecimal('-1.005', 2)), '-1.01');
  assert.equal(text(roundDecimal('1.0049', 2)), '1');
});

test('compara valores con escalas distintas', () => {
  assert.equal(compareDecimal('1.20', '1.2'), 0);
  assert.equal(compareDecimal('-0.01', '0'), -1);
  assert.equal(compareDecimal('100000000000000000000', '99999999999999999999'), 1);
});

test('admite notación científica de entradas numéricas y normaliza ceros', () => {
  assert.equal(text(parseDecimal('1.25e-7')), '0.000000125');
  assert.equal(text(parseDecimal('12e3')), '12000');
  assert.equal(text(parseDecimal('-0.000')), '0');
});

test('permite escalas intermedias mayores al calcular divisiones de precisión máxima', () => {
  assert.equal(text(divideDecimal('0.1', '0.1', 1000)), '1');
});

test('rechaza datos inválidos, división por cero y escalas fuera de rango', () => {
  assert.throws(() => parseDecimal('1,25'), /formato decimal/);
  assert.throws(() => parseDecimal(Number.NaN), /finito/);
  assert.throws(() => divideDecimal('1', '0'), /cero/);
  assert.throws(() => divideDecimal('1', '3', -1), /precisión/);
  assert.throws(() => roundDecimal('1.2', 1001), /precisión/);
});
