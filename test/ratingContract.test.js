import test from "node:test";
import assert from "node:assert/strict";
import { validateRatingPayload } from "../src/ratingContract.js";

function validPayload() {
  return {
    ok: true,
    symbol: "TEST",
    researchState: "持有观察",
    rating: {
      score: 60,
      confidence: 80,
      components: { fundamental: {}, technical: {}, expectation: {} }
    },
    metrics: { risk: { score: 10, level: "低" } },
    sources: { priceAsOf: "2026-06-18" }
  };
}

test("accepts a complete unified rating response", () => {
  const payload = validPayload();
  assert.equal(validateRatingPayload(payload, "TEST"), payload);
});

test("rejects malformed or mismatched rating responses", () => {
  const malformed = validPayload();
  malformed.symbol = "OTHER";
  malformed.rating.score = "not-a-score";
  delete malformed.metrics.risk;
  const result = validateRatingPayload(malformed, "TEST");
  assert.equal(result.ok, false);
  assert.ok(result.validationErrors.includes("股票代码不匹配"));
  assert.ok(result.validationErrors.includes("score 非法"));
  assert.ok(result.validationErrors.includes("风险结构不完整"));
});
