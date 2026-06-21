import test from "node:test";
import assert from "node:assert/strict";
import { compactNumber, finiteNumber, finiteOr, fixed, signedPercent } from "../src/valueSafety.js";

test("finiteNumber accepts real numeric values and numeric strings", () => {
  assert.equal(finiteNumber(12.5), 12.5);
  assert.equal(finiteNumber("12.5"), 12.5);
  assert.equal(finiteOr("3.4", 0), 3.4);
});

test("missing and invalid values stay missing", () => {
  for (const value of [null, undefined, "", "not-a-number", NaN, Infinity]) {
    assert.equal(finiteNumber(value), null);
    assert.equal(fixed(value, 2, "%"), "N/A");
  }
});

test("formatters preserve zero instead of treating it as missing", () => {
  assert.equal(fixed(0, 2, "%"), "0.00%");
  assert.equal(signedPercent(0), "+0.0%");
  assert.equal(compactNumber(0), "0");
});

test("compactNumber safely formats numeric strings", () => {
  assert.equal(compactNumber("1250000000"), "1.3B");
});
