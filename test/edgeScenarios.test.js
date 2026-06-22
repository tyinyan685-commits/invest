import test from "node:test";
import assert from "node:assert/strict";
import { calculateTechnicalMetrics, scoreRating } from "../api/_rating.js";
import { dividendYield, fixed } from "../src/valueSafety.js";

function dailyPrices(count, start = 20) {
  return Array.from({ length: count }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, "0")}`,
    close: start + index * 0.25
  }));
}

test("zero dividend is shown as zero while missing dividend stays unavailable", () => {
  assert.equal(dividendYield(0, 100), 0);
  assert.equal(fixed(dividendYield(0, 100), 2, "%"), "0.00%");
  assert.equal(dividendYield(null, 100), null);
  assert.equal(fixed(dividendYield(null, 100), 2, "%"), "N/A");
});

test("loss-making company does not receive an invented forward PE", () => {
  const result = scoreRating({
    fundamentals: { fwdPe: null, revenueGrowth: -8, netIncomeGrowth: -35, roe: -12, grossMargin: 18 },
    technical: {},
    expectation: {},
    sentiment: {}
  });
  assert.equal(result.components.fundamental.details.some((item) => item.metric === "FwdPE"), false);
  assert.ok(Number.isFinite(result.score));
});

test("missing analyst coverage stays neutral and lowers completeness", () => {
  const result = scoreRating({
    fundamentals: { fwdPe: 24, revenueGrowth: 12, netIncomeGrowth: 5, roe: 18, grossMargin: 40 },
    technical: { latest: 110, sma20: 100, sma50: 95, rsi14: 55, macdLine: 2, macdSignal: 1 },
    expectation: { analystRevision: { usable: false }, news: { usable: false } },
    sentiment: { labeledCount: 0, bullPct: 50 }
  });
  assert.equal(result.components.expectation.score, 50);
  assert.equal(result.components.expectation.available, 0);
  assert.ok(result.confidence < 100);
});

test("new listing uses available history without inventing long-term indicators", () => {
  const technical = calculateTechnicalMetrics(dailyPrices(20));
  assert.ok(Number.isFinite(technical.sma20));
  assert.equal(technical.sma50, null);
  assert.equal(technical.macdLine, null);
  const result = scoreRating({ technical });
  assert.ok(Number.isFinite(result.score));
  assert.ok(result.components.technical.available < result.components.technical.total);
});
