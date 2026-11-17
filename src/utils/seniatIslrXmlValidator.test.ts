import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeniatIslrXml } from './seniatIslrXmlValidator';

const validXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<RelacionRetencionesISLR RifAgente="J123456789" Periodo="202610">
  <DetalleRetencion>
    <RifRetenido>V123456789</RifRetenido>
    <NumeroFactura>F001</NumeroFactura>
    <NumeroControl>00123</NumeroControl>
    <FechaOperacion>05/10/2026</FechaOperacion>
    <CodigoConcepto>002</CodigoConcepto>
    <MontoOperacion>15000.63</MontoOperacion>
    <PorcentajeRetencion>3.00</PorcentajeRetencion>
  </DetalleRetencion>
</RelacionRetencionesISLR>`;

test('SENIAT ISLR XML accepts a complete monthly salaries/other-withholdings record', () => {
  const result = validateSeniatIslrXml(validXml);
  assert.equal(result.isValid, true);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.issues, []);
});

test('SENIAT ISLR XML requires the exact root attributes and period', () => {
  const result = validateSeniatIslrXml(validXml.replace('Periodo="202610"', 'Fecha="05/10/2026"'));
  assert.equal(result.isValid, false);
  assert.ok(result.issues.some(item => item.code === 'XML_ROOT_ATTRIBUTES'));
});

test('SENIAT ISLR XML rejects missing or reordered child elements', () => {
  const result = validateSeniatIslrXml(validXml.replace('<NumeroFactura>F001</NumeroFactura>', ''));
  assert.ok(result.issues.some(item => item.code === 'XML_FIELD_ORDER_OR_MISSING'));
});

test('SENIAT ISLR XML rejects invalid RIF, invoice/control identifiers and concept code', () => {
  const xml = validXml
    .replace('V123456789', 'V123')
    .replace('F001', 'FACTURA-0001')
    .replace('00123', '')
    .replace('002</CodigoConcepto>', '2</CodigoConcepto>');
  const result = validateSeniatIslrXml(xml);
  assert.ok(result.issues.some(item => item.code === 'SUPPLIER_RIF_INVALID'));
  assert.ok(result.issues.some(item => item.code === 'INVOICE_NUMBER_INVALID'));
  assert.ok(result.issues.some(item => item.code === 'CONTROL_NUMBER_INVALID'));
  assert.ok(result.issues.some(item => item.code === 'CONCEPT_CODE_INVALID'));
});

test('SENIAT ISLR XML rejects invalid dates and dates outside the declared period', () => {
  const invalidDate = validateSeniatIslrXml(validXml.replace('05/10/2026', '31/02/2026'));
  assert.ok(invalidDate.issues.some(item => item.code === 'OPERATION_DATE_INVALID'));
  const otherPeriod = validateSeniatIslrXml(validXml.replace('05/10/2026', '05/09/2026'));
  assert.ok(otherPeriod.issues.some(item => item.code === 'OPERATION_DATE_PERIOD_MISMATCH'));
});

test('SENIAT ISLR XML enforces decimal amounts and withholding percentage range', () => {
  const result = validateSeniatIslrXml(validXml
    .replace('15000.63', '15,000.63')
    .replace('3.00', '101.00'));
  assert.ok(result.issues.some(item => item.code === 'OPERATION_AMOUNT_INVALID'));
  assert.ok(result.issues.some(item => item.code === 'WITHHOLDING_RATE_INVALID'));
});

test('SENIAT ISLR XML rejects empty files, BOM, DTD and malformed XML', () => {
  assert.equal(validateSeniatIslrXml('').isValid, false);
  assert.ok(validateSeniatIslrXml('\ufeff' + validXml).issues.some(item => item.code === 'XML_BOM'));
  assert.ok(validateSeniatIslrXml(validXml.replace('<?xml', '<!DOCTYPE x [<!ENTITY e "x">]><?xml')).issues.some(item => item.code === 'XML_DTD_FORBIDDEN'));
  assert.ok(validateSeniatIslrXml(validXml.replace('</RelacionRetencionesISLR>', '')).issues.some(item => item.code === 'XML_ROOT_INVALID'));
});

test('SENIAT ISLR XML permits zero withholding and XML-escaped text values', () => {
  const xml = validXml.replace('<PorcentajeRetencion>3.00</PorcentajeRetencion>', '<PorcentajeRetencion>0</PorcentajeRetencion>');
  assert.equal(validateSeniatIslrXml(xml).isValid, true);
});
