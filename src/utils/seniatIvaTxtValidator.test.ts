import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSeniatIvaTxt } from './seniatIvaTxtValidator';

const validRow = [
  'J123456789', '202610', '2026-10-05', 'C', '01', 'J987654321',
  'F-001', '00-123', '1160', '1000', '120', '0',
  '20261000000001', '0', '16', '0'
].join('\t');

test('SENIAT IVA preflight accepts a valid 16-column row', () => {
  const result = validateSeniatIvaTxt(validRow);
  assert.equal(result.isValid, true);
  assert.equal(result.rowCount, 1);
  assert.deepEqual(result.issues, []);
});

test('SENIAT IVA preflight rejects wrong column count and blank fields', () => {
  const wrongCount = validateSeniatIvaTxt(validRow.split('\t').slice(0, 15).join('\t'));
  assert.equal(wrongCount.isValid, false);
  assert.ok(wrongCount.issues.some(issue => issue.code === 'FIELD_COUNT'));

  const blank = validRow.split('\t');
  blank[11] = '';
  const blankResult = validateSeniatIvaTxt(blank.join('\t'));
  assert.ok(blankResult.issues.some(issue => issue.code === 'EMPTY_FIELD' && issue.column === 12));
});

test('SENIAT IVA preflight requires tab-separated fields and CRLF rows', () => {
  const commaDelimited = validateSeniatIvaTxt(validRow.replaceAll('\t', ','));
  assert.ok(commaDelimited.issues.some(issue => issue.code === 'FIELD_COUNT'));

  const lfRows = validateSeniatIvaTxt(validRow + '\n' + validRow.replace('000001', '000002'));
  assert.ok(lfRows.issues.some(issue => issue.code === 'INVALID_LINE_ENDING'));
});

test('SENIAT IVA preflight validates RIF, period, real date, operation and document type', () => {
  const fields = validRow.split('\t');
  fields[0] = 'ABC';
  fields[1] = '202613';
  fields[2] = '2026-02-30';
  fields[3] = 'X';
  fields[4] = '04';
  const result = validateSeniatIvaTxt(fields.join('\t'));
  for (const code of ['INVALID_AGENT_RIF', 'INVALID_PERIOD', 'INVALID_DATE', 'INVALID_OPERATION', 'INVALID_DOCUMENT_TYPE']) {
    assert.ok(result.issues.some(issue => issue.code === code), code);
  }
});

test('SENIAT IVA preflight validates numeric fields, voucher period and unique sequence', () => {
  const first = validRow.split('\t');
  first[8] = '1.160,00';
  first[12] = '20260900000001';
  const second = validRow.split('\t');
  second[12] = '20260900000001';
  const result = validateSeniatIvaTxt(first.join('\t') + '\r\n' + second.join('\t'));
  assert.ok(result.issues.some(issue => issue.code === 'INVALID_NUMERIC_FORMAT'));
  assert.ok(result.issues.some(issue => issue.code === 'VOUCHER_PERIOD_MISMATCH'));
  assert.ok(result.issues.some(issue => issue.code === 'DUPLICATE_VOUCHER_NUMBER'));
});

test('SENIAT IVA preflight requires affected document for debit and credit notes', () => {
  const fields = validRow.split('\t');
  fields[4] = '03';
  fields[11] = '0';
  const result = validateSeniatIvaTxt(fields.join('\t'));
  assert.ok(result.issues.some(issue => issue.code === 'MISSING_AFFECTED_DOCUMENT'));
});

test('SENIAT IVA preflight rejects BOM and trailing empty line', () => {
  assert.ok(validateSeniatIvaTxt('\uFEFF' + validRow).issues.some(issue => issue.code === 'BOM_NOT_ALLOWED'));
  assert.ok(validateSeniatIvaTxt(validRow + '\r\n').issues.some(issue => issue.code === 'TRAILING_NEWLINE'));
});

test('SENIAT IVA preflight enforces one agent and one period per file', () => {
  const second = validRow.split('\t');
  second[0] = 'V123456789';
  second[1] = '202611';
  second[12] = '20261100000002';
  const result = validateSeniatIvaTxt(validRow + '\r\n' + second.join('\t'));
  assert.ok(result.issues.some(issue => issue.code === 'MIXED_AGENT_RIF'));
  assert.ok(result.issues.some(issue => issue.code === 'MIXED_PERIODS'));
});


test('SENIAT IVA preflight permits supplier RIF 0 as allowed by the generator for 100% retention cases', () => {
  const fields = validRow.split('\\t');
  fields[5] = '0';
  const result = validateSeniatIvaTxt(fields.join('\\t'));
  assert.equal(result.issues.some(issue => issue.code === 'INVALID_SUPPLIER_RIF'), false);
});
