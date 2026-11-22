import test from "node:test";
import assert from "node:assert/strict";
import { resolveBcvRateForDate } from "./resolveBcvRateForDate";

const entry = (effectiveDate: string, rate: number) => ({ effectiveDate, rate });

test("returns undefined when history is empty or missing", () => {
  assert.equal(resolveBcvRateForDate(undefined, "2024-01-15"), undefined);
  assert.equal(resolveBcvRateForDate(null, "2024-01-15"), undefined);
  assert.equal(resolveBcvRateForDate([], "2024-01-15"), undefined);
});

test("returns undefined for invalid date format", () => {
  const h = [entry("2024-01-01", 100)];
  assert.equal(resolveBcvRateForDate(h, ""), undefined);
  assert.equal(resolveBcvRateForDate(h, "not-a-date"), undefined);
  assert.equal(resolveBcvRateForDate(h, "2024-1-1"), undefined);
});

test("returns exact rate when effectiveDate equals query date", () => {
  assert.equal(resolveBcvRateForDate([entry("2024-03-15", 36.50)], "2024-03-15"), 36.50);
});

test("returns most recent rate on or before query date", () => {
  const h = [
    entry("2024-01-01", 36.00),
    entry("2024-03-01", 38.00),
    entry("2024-06-01", 42.50),
  ];
  assert.equal(resolveBcvRateForDate(h, "2024-01-01"), 36.00);
  assert.equal(resolveBcvRateForDate(h, "2024-02-15"), 36.00);
  assert.equal(resolveBcvRateForDate(h, "2024-03-01"), 38.00);
  assert.equal(resolveBcvRateForDate(h, "2024-05-20"), 38.00);
  assert.equal(resolveBcvRateForDate(h, "2024-06-01"), 42.50);
  assert.equal(resolveBcvRateForDate(h, "2025-12-31"), 42.50);
});

test("returns undefined when query date is before all entries", () => {
  const h = [entry("2024-06-01", 42.50)];
  assert.equal(resolveBcvRateForDate(h, "2024-05-31"), undefined);
  assert.equal(resolveBcvRateForDate(h, "2014-01-01"), undefined);
});

test("skips entries with invalid or zero rates", () => {
  const h = [
    entry("2024-01-01", 0),
    entry("2024-02-01", -5),
    entry("2024-04-01", 40.00),
  ];
  assert.equal(resolveBcvRateForDate(h, "2024-03-15"), undefined);
  assert.equal(resolveBcvRateForDate(h, "2024-04-01"), 40.00);
});

test("skips entries with malformed effectiveDate", () => {
  const h = [entry("not-a-date", 100), entry("2024-05-01", 36.00)];
  assert.equal(resolveBcvRateForDate(h, "2024-06-01"), 36.00);
  assert.equal(resolveBcvRateForDate(h, "2024-04-01"), undefined);
});

test("handles historical BsF/BsS rates for pre-2021 periods", () => {
  const h = [
    entry("2014-01-01", 6.30),
    entry("2016-03-01", 10.00),
    entry("2018-08-20", 0.000068),
    entry("2021-10-01", 4.18),
    entry("2024-01-01", 36.50),
  ];
  assert.equal(resolveBcvRateForDate(h, "2014-06-15"), 6.30);
  assert.equal(resolveBcvRateForDate(h, "2016-01-01"), 6.30);
  assert.equal(resolveBcvRateForDate(h, "2016-03-01"), 10.00);
  assert.equal(resolveBcvRateForDate(h, "2018-08-20"), 0.000068);
  assert.equal(resolveBcvRateForDate(h, "2021-10-01"), 4.18);
  assert.equal(resolveBcvRateForDate(h, "2024-06-01"), 36.50);
  assert.equal(resolveBcvRateForDate(h, "2013-12-31"), undefined);
});
