import test from "node:test";
import assert from "node:assert/strict";
import { assessRisk, researchState } from "../api/_rating.js";

test("high valuation and volatility remain separate from priority score", () => {
  const risk = assessRisk({ fwdPe: 202, beta: 3.79, annualizedVolatility20: 90, maxDrawdown60: -15, latest: 440, sma50: 350 });
  assert.equal(risk.level, "高");
  assert.ok(risk.score >= 60);
  assert.equal(researchState(72, risk), "高风险观察");
});

test("lower-risk high priority remains priority research", () => {
  const risk = assessRisk({ fwdPe: 22, beta: 1.1, annualizedVolatility20: 24, maxDrawdown60: -8, latest: 120, sma50: 110 });
  assert.equal(risk.level, "低");
  assert.equal(researchState(75, risk), "优先研究");
});

test("borderline risk inputs receive gradual points instead of cliff effects", () => {
  const risk = assessRisk({ fwdPe: 18.45, beta: 1.29, annualizedVolatility20: 34.3, maxDrawdown60: -8.36, latest: 1096.56, sma50: 973.87 });
  assert.ok(risk.score > 0);
  assert.ok(risk.score < 20);
  assert.equal(risk.level, "低");
});

test("limited-applicability industries use a dedicated research state", () => {
  const risk = assessRisk({ fwdPe: 18.45, beta: 1.29, annualizedVolatility20: 34.3, maxDrawdown60: -8.36, latest: 1096.56, sma50: 973.87 });
  assert.equal(researchState(75, risk, { suitable: false }), "行业专项评估");
});

test("low completeness blocks an otherwise high-priority state", () => {
  const risk = assessRisk({ fwdPe: 20, beta: 1, annualizedVolatility20: 20, maxDrawdown60: -4, latest: 120, sma50: 110 });
  assert.equal(researchState(90, risk, { suitable: true }, 49), "数据不足，暂缓判断");
});

test("missing risk inputs reduce coverage without inventing flags", () => {
  const risk = assessRisk({ fwdPe: null, beta: null });
  assert.equal(risk.available, 0);
  assert.equal(risk.flags.length, 0);
});
