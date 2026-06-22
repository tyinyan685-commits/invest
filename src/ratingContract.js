function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function validateRatingPayload(payload, expectedSymbol) {
  if (!payload || typeof payload !== "object") {
    return { ok: false, error: "统一评级接口返回了无效数据结构" };
  }
  if (payload.ok !== true) return payload;

  const errors = [];
  if (typeof payload.symbol !== "string" || payload.symbol !== expectedSymbol) errors.push("股票代码不匹配");
  if (!payload.rating || typeof payload.rating !== "object") errors.push("缺少 rating");
  const score = finite(payload.rating?.score);
  const confidence = finite(payload.rating?.confidence);
  if (score === null || score < 0 || score > 100) errors.push("score 非法");
  if (confidence === null || confidence < 0 || confidence > 100) errors.push("confidence 非法");
  if (typeof payload.researchState !== "string" || !payload.researchState) errors.push("缺少 researchState");
  if (!payload.rating?.components?.fundamental || !payload.rating?.components?.technical || !payload.rating?.components?.expectation) {
    errors.push("评分分项不完整");
  }
  if (!payload.metrics?.risk || finite(payload.metrics.risk.score) === null || typeof payload.metrics.risk.level !== "string") {
    errors.push("风险结构不完整");
  }
  if (!payload.sources || typeof payload.sources !== "object") errors.push("缺少数据来源日期");

  return errors.length
    ? { ok: false, error: `统一评级响应结构异常：${errors.join("、")}`, validationErrors: errors }
    : payload;
}
