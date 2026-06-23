import test from "node:test";
import assert from "node:assert/strict";
import { aggregateTtmIncome, calculateTechnicalMetrics, forwardPeMetric, nextFiscalYearEstimate, scoreRating } from "../api/_rating.js";
import { ytdReference } from "../api/history.js";
import { normalizeBalanceSheet } from "../api/financials.js";
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
  assert.deepEqual(forwardPeMetric(100, -2), { value: null, reason: "预测 EPS 非正，Forward PE 不适用" });
  const result = scoreRating({
    fundamentals: { fwdPe: null, revenueGrowth: -8, netIncomeGrowth: -35, roe: -12, grossMargin: 18 },
    technical: {},
    expectation: {},
    sentiment: {}
  });
  assert.equal(result.components.fundamental.details.some((item) => item.metric === "FwdPE"), false);
  assert.ok(Number.isFinite(result.score));
});

test("forward PE distinguishes missing estimates from non-positive estimates", () => {
  assert.deepEqual(forwardPeMetric(100, null), { value: null, reason: "分析师 EPS 预测未返回" });
  assert.deepEqual(forwardPeMetric(null, 5), { value: null, reason: "价格数据未返回" });
  assert.deepEqual(forwardPeMetric(100, 5), { value: 20, reason: null });
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

test("RSI uses Wilder smoothing instead of a rolling simple average", () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46, 46.03];
  const rows = closes.map((close, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, close }));
  assert.ok(Math.abs(calculateTechnicalMetrics(rows).rsi14 - 66.48) < 0.02);
});

test("TTM income aggregates the latest four quarters and compares the preceding four", () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    date: `202${6 - Math.floor(index / 4)}-${String(12 - (index % 4) * 3).padStart(2, "0")}-28`,
    revenue: index < 4 ? 25 : 10,
    netIncome: index < 4 ? 8 : 1,
    grossProfit: index < 4 ? 15 : 4,
    epsDiluted: index < 4 ? 2 : 0.25
  }));
  const ttm = aggregateTtmIncome(rows);
  assert.deepEqual(ttm.current, { revenue: 100, netIncome: 32, grossProfit: 60, operatingIncome: null, eps: 8, date: rows[0].date });
  assert.equal(ttm.prior.revenue, 40);
});

test("forward PE selects the next fiscal year rather than the unfinished current year", () => {
  const estimates = [
    { date: "2026-08-28", estimatedEpsAvg: 62.34 },
    { date: "2027-08-28", estimatedEpsAvg: 120.45 }
  ];
  const estimate = nextFiscalYearEstimate(estimates, "2025-08-28", new Date("2026-06-23T00:00:00Z"));
  assert.equal(estimate.date, "2027-08-28");
  assert.equal(estimate.estimateType, "next-fiscal-year");
});

test("next-fiscal-year selection advances correctly after a fiscal year was reported", () => {
  const estimates = [
    { date: "2027-03-31", estimatedEpsAvg: 10 },
    { date: "2028-03-31", estimatedEpsAvg: 13 }
  ];
  const estimate = nextFiscalYearEstimate(estimates, "2026-03-31", new Date("2026-06-23T00:00:00Z"));
  assert.equal(estimate.date, "2028-03-31");
});

test("YTD return uses the prior calendar year's final close", () => {
  const reference = ytdReference([
    { date: "2025-12-31", close: 285.41 },
    { date: "2026-01-02", close: 315.42 }
  ], 2026);
  assert.deepEqual(reference, { price: 285.41, date: "2025-12-31" });
});

test("incomplete quarterly fields stay unavailable instead of becoming zero", () => {
  const rows = Array.from({ length: 4 }, (_, index) => ({
    date: `2026-0${index + 1}-28`, revenue: 10, netIncome: 1, grossProfit: index === 2 ? null : 4, epsDiluted: 0.25
  }));
  const ttm = aggregateTtmIncome(rows);
  assert.equal(ttm.current.revenue, 40);
  assert.equal(ttm.current.grossProfit, null);
  assert.equal(ttm.current.operatingIncome, null);
});

test("zero debt remains a real zero rather than being labeled missing", () => {
  const balance = normalizeBalanceSheet({
    cashAndCashEquivalents: 5, shortTermInvestments: 2, totalDebt: 0, netDebt: -7,
    totalAssets: 20, totalLiabilities: 3, totalStockholdersEquity: 17
  });
  assert.equal(balance.cash, 7);
  assert.equal(balance.totalDebt, 0);
  assert.equal(balance.debtToEquity, 0);
});

test("an improving loss does not earn the profitable growth bonus", () => {
  const result = scoreRating({
    fundamentals: { fwdPe: null, revenueGrowth: 20, netIncomeGrowth: 60, netIncome: -2, roe: -5, grossMargin: 30 }
  });
  const detail = result.components.fundamental.details.find((item) => item.metric === "净利润增速");
  assert.equal(detail.points, 0);
  assert.equal(detail.profitable, false);
});
