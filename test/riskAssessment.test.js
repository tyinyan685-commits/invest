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

test("missing risk inputs reduce coverage without inventing flags", () => {
  const risk = assessRisk({ fwdPe: null, beta: null });
  assert.equal(risk.available, 0);
  assert.equal(risk.flags.length, 0);
});
