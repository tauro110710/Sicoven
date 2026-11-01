import test from 'node:test';
import assert from 'node:assert/strict';
import { getSeniatVatWithholdingDueDate } from './seniatVatDueDates';

test('SENIAT 2026 calendar resolves the first-half due date by the final RIF digit', () => {
  const due = getSeniatVatWithholdingDueDate('J-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED');
  assert.equal(due?.dueDate, '2026-10-19');
  assert.match(due?.sourceTitle || '', /SNAT\/2025\/000091/);
});

test('SENIAT 2026 calendar resolves the second-half due date in the following month', () => {
  const due = getSeniatVatWithholdingDueDate('J-12345678-9', '202610', 'SECOND_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED');
  assert.equal(due?.dueDate, '2026-11-10');
});

test('SENIAT calendar does not infer dates for Article 2-only agents, unconfirmed natural firms or unpublished years', () => {
  assert.equal(getSeniatVatWithholdingDueDate('J-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_2_METALS'), null);
  assert.equal(getSeniatVatWithholdingDueDate('J-12345678-9', '202701', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED'), null);
  assert.equal(getSeniatVatWithholdingDueDate('J-12345678-9', '202612', 'SECOND_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED'), null);
  assert.equal(getSeniatVatWithholdingDueDate('V-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED'), null);
  assert.equal(getSeniatVatWithholdingDueDate('P-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED'), null);
  assert.equal(getSeniatVatWithholdingDueDate('P-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED', true)?.dueDate, '2026-10-19');
  assert.equal(getSeniatVatWithholdingDueDate('ABC-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED'), null);
  assert.equal(getSeniatVatWithholdingDueDate('V-12345678-9', '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED', true)?.dueDate, '2026-10-19');
});


test('SENIAT 2026 VAT calendar matches every final RIF digit in both quincenas', () => {
  const firstHalf = [20, 28, 29, 23, 22, 30, 21, 27, 26, 19];
  const secondHalf = [13, 12, 2, 9, 5, 4, 11, 3, 6, 10];
  for (let digit = 0; digit <= 9; digit += 1) {
    const rif = 'J-12345678-' + digit;
    const first = getSeniatVatWithholdingDueDate(rif, '202610', 'FIRST_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED');
    const second = getSeniatVatWithholdingDueDate(rif, '202610', 'SECOND_HALF', 'ARTICLE_1_SPECIAL_DESIGNATED');
    assert.equal(first?.dueDate, '2026-10-' + String(firstHalf[digit]).padStart(2, '0'));
    assert.equal(second?.dueDate, '2026-11-' + String(secondHalf[digit]).padStart(2, '0'));
  }
});
