const clamp = (value) => Math.max(0, Math.min(100, value));

const numberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function average(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function ema(values, period) {
  if (values.length < period) return [];
  const output = new Array(period - 1).fill(null);
  let current = average(values.slice(0, period));
  output.push(current);
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index += 1) {
    current = values[index] * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

function latestRsi(values, period = 14) {
  if (values.length <= period) return null;
  const recent = values.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < recent.length; index += 1) {
    const change = recent[index] - recent[index - 1];
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  if (losses === 0) return 100;
  const relativeStrength = gains / losses;
  return 100 - 100 / (1 + relativeStrength);
}

function latestMacd(values) {
  if (values.length < 35) return { line: null, signal: null };
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdValues = values.map((_, index) =>
    ema12[index] === null || ema12[index] === undefined || ema26[index] === null || ema26[index] === undefined
      ? null
      : ema12[index] - ema26[index]
  );
  const validMacd = macdValues.filter((value) => value !== null);
  const signalValues = ema(validMacd, 9);
  return {
    line: validMacd.at(-1) ?? null,
    signal: signalValues.at(-1) ?? null
  };
}

export function calculateTechnicalMetrics(rows) {
  const prices = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ date: row.date, close: numberOrNull(row.close ?? row.price ?? row.adjClose) }))
    .filter((row) => row.close !== null)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const closes = prices.map((row) => row.close);
  const latest = closes.at(-1) ?? null;
  const macd = latestMacd(closes);
  const recentReturns = closes.slice(-21).slice(1).map((close, index) => (close - closes.slice(-21)[index]) / closes.slice(-21)[index]);
  const meanReturn = average(recentReturns);
  const returnVariance = meanReturn === null ? null : average(recentReturns.map((value) => (value - meanReturn) ** 2));
  const annualizedVolatility20 = returnVariance === null ? null : Math.sqrt(returnVariance) * Math.sqrt(252) * 100;
  const drawdownWindow = closes.slice(-60);
  let peak = null;
  let maxDrawdown60 = null;
  for (const close of drawdownWindow) {
    peak = peak === null ? close : Math.max(peak, close);
    const drawdown = ((close - peak) / peak) * 100;
    maxDrawdown60 = maxDrawdown60 === null ? drawdown : Math.min(maxDrawdown60, drawdown);
  }
  return {
    latest,
    sma20: closes.length >= 20 ? average(closes.slice(-20)) : null,
    sma50: closes.length >= 50 ? average(closes.slice(-50)) : null,
    rsi14: latestRsi(closes),
    macdLine: macd.line,
    macdSignal: macd.signal,
    historyCount: closes.length,
    latestDate: prices.at(-1)?.date ?? null,
    annualizedVolatility20,
    maxDrawdown60
  };
}

export function forwardPeMetric(price, epsEstimate) {
  const priceValue = numberOrNull(price);
  const epsValue = numberOrNull(epsEstimate);
  if (priceValue === null || priceValue <= 0) return { value: null, reason: "价格数据未返回" };
  if (epsValue === null) return { value: null, reason: "分析师 EPS 预测未返回" };
  if (epsValue <= 0) return { value: null, reason: "预测 EPS 非正，Forward PE 不适用" };
  return { value: priceValue / epsValue, reason: null };
}

function interpolatedRiskPoints(value, anchors) {
  if (value <= anchors[0][0]) return anchors[0][1];
  for (let index = 1; index < anchors.length; index += 1) {
    const [upperValue, upperPoints] = anchors[index];
    const [lowerValue, lowerPoints] = anchors[index - 1];
    if (value <= upperValue) {
      const position = (value - lowerValue) / (upperValue - lowerValue);
      return lowerPoints + position * (upperPoints - lowerPoints);
    }
  }
  return anchors.at(-1)[1];
}

export function assessRisk({ fwdPe, beta, annualizedVolatility20, maxDrawdown60, latest, sma50 } = {}) {
  let score = 0;
  let available = 0;
  const flags = [];
  const pe = numberOrNull(fwdPe);
  const betaValue = numberOrNull(beta);
  const volatility = numberOrNull(annualizedVolatility20);
  const drawdown = numberOrNull(maxDrawdown60);
  const price = numberOrNull(latest);
  const average50 = numberOrNull(sma50);

  if (pe !== null) {
    available += 1;
    const points = Math.round(interpolatedRiskPoints(pe, [[20, 0], [30, 5], [40, 12], [60, 22], [100, 30]]));
    score += points;
    if (points) flags.push({ metric: "Forward PE", value: pe, points, message: `Forward PE ${pe.toFixed(1)}x` });
  }
  if (volatility !== null) {
    available += 1;
    const points = Math.round(interpolatedRiskPoints(volatility, [[20, 0], [35, 8], [50, 15], [80, 25]]));
    score += points;
    if (points) flags.push({ metric: "20日年化波动", value: volatility, points, message: `20日年化波动 ${volatility.toFixed(1)}%` });
  }
  if (betaValue !== null) {
    available += 1;
    const points = Math.round(interpolatedRiskPoints(betaValue, [[1, 0], [1.3, 6], [1.8, 12], [2.5, 20]]));
    score += points;
    if (points) flags.push({ metric: "Beta", value: betaValue, points, message: `Beta ${betaValue.toFixed(2)}` });
  }
  if (drawdown !== null) {
    available += 1;
    const drawdownSeverity = Math.max(0, -drawdown);
    const points = Math.round(interpolatedRiskPoints(drawdownSeverity, [[5, 0], [12, 6], [20, 12], [30, 20]]));
    score += points;
    if (points) flags.push({ metric: "60日最大回撤", value: drawdown, points, message: `60日最大回撤 ${drawdown.toFixed(1)}%` });
  }
  if (price !== null && average50 !== null) {
    available += 1;
    const percentBelow = Math.max(0, ((average50 - price) / average50) * 100);
    const points = Math.round(interpolatedRiskPoints(percentBelow, [[0, 0], [10, 8]]));
    score += points;
    if (points) flags.push({ metric: "价格/SMA50", value: "下方", points, message: "价格位于 SMA50 下方" });
  }

  const normalizedScore = Math.min(100, Math.round(score));
  const level = normalizedScore >= 60 ? "高" : normalizedScore >= 35 ? "中高" : normalizedScore >= 20 ? "中" : "低";
  return {
    score: normalizedScore,
    level,
    available,
    total: 5,
    flags: flags.sort((a, b) => b.points - a.points),
    policy: "风险分独立于综合评分；衡量估值、价格波动和回撤，并与综合分共同生成研究状态，不代表公司永久风险。"
  };
}

export function researchState(score, risk, modelApplicability = { suitable: true }, confidence = 100) {
  if ((numberOrNull(confidence) ?? 0) < 50) return "数据不足，暂缓判断";
  if (modelApplicability?.suitable === false) return "行业专项评估";
  const riskScore = numberOrNull(risk?.score) ?? 0;
  if (score >= 70 && riskScore >= 60) return "高风险观察";
  if (score >= 70 && riskScore >= 35) return "优先研究，严控风险";
  if (score >= 70) return "优先研究";
  if (score >= 55 && riskScore >= 60) return "高风险等待";
  if (score >= 55) return "持有观察";
  if (riskScore >= 60) return "暂不参与";
  return "中性观察";
}

function fundamentalScore(metrics) {
  let score = 50;
  let available = 0;
  const details = [];
  const fwdPe = numberOrNull(metrics.fwdPe);
  const revenueGrowth = numberOrNull(metrics.revenueGrowth);
  const netIncomeGrowth = numberOrNull(metrics.netIncomeGrowth);
  const roe = numberOrNull(metrics.roe);
  const grossMargin = numberOrNull(metrics.grossMargin);

  if (fwdPe !== null && fwdPe > 0) {
    available += 1;
    const points = fwdPe < 20 ? 15 : fwdPe < 30 ? 5 : -10;
    score += points;
    details.push({ metric: "FwdPE", value: fwdPe, points });
  }
  if (revenueGrowth !== null) {
    available += 1;
    const points = revenueGrowth > 30 ? 15 : revenueGrowth > 10 ? 8 : -5;
    score += points;
    details.push({ metric: "营收增速", value: revenueGrowth, points });
  }
  if (netIncomeGrowth !== null) {
    available += 1;
    const points = netIncomeGrowth > 30 ? 10 : netIncomeGrowth > 0 ? 5 : -10;
    score += points;
    details.push({ metric: "净利润增速", value: netIncomeGrowth, points });
  }
  if (roe !== null) {
    available += 1;
    const points = roe > 25 ? 10 : roe > 15 ? 5 : 0;
    score += points;
    details.push({ metric: "ROE", value: roe, points });
  }
  if (grossMargin !== null) {
    available += 1;
    const points = grossMargin > 50 ? 5 : 0;
    score += points;
    details.push({ metric: "毛利率", value: grossMargin, points });
  }

  return { score: Math.round(clamp(score)), available, total: 5, details };
}

function technicalScore(metrics) {
  let score = 50;
  let available = 0;
  const details = [];
  const rsi = numberOrNull(metrics.rsi14);
  const latest = numberOrNull(metrics.latest);
  const sma20 = numberOrNull(metrics.sma20);
  const sma50 = numberOrNull(metrics.sma50);
  const macdLine = numberOrNull(metrics.macdLine);
  const macdSignal = numberOrNull(metrics.macdSignal);

  if (rsi !== null) {
    available += 1;
    const points = rsi >= 50 && rsi <= 70 ? 10 : rsi > 70 ? -5 : rsi < 30 ? 10 : 0;
    score += points;
    details.push({ metric: "RSI14", value: rsi, points });
  }
  if (macdLine !== null && macdSignal !== null) {
    available += 1;
    const points = macdLine > macdSignal ? 15 : -10;
    score += points;
    details.push({ metric: "MACD", value: macdLine > macdSignal ? "信号线上方" : "信号线下方", points });
  }
  if (latest !== null && sma20 !== null) {
    available += 1;
    const points = latest > sma20 ? 10 : -5;
    score += points;
    details.push({ metric: "价格/SMA20", value: latest > sma20 ? "上方" : "下方", points });
  }
  if (latest !== null && sma50 !== null) {
    available += 1;
    const points = latest > sma50 ? 10 : -5;
    score += points;
    details.push({ metric: "价格/SMA50", value: latest > sma50 ? "上方" : "下方", points });
  }

  return { score: Math.round(clamp(score)), available, total: 4, details };
}

function expectationScore(expectation = {}, sentiment = {}) {
  const analystRevision = numberOrNull(expectation.analystRevision?.changePct);
  const analystUsable = expectation.analystRevision?.usable === true && analystRevision !== null;
  const analystScore = analystUsable ? clamp(50 + analystRevision * 4) : 50;

  const newsScoreValue = numberOrNull(expectation.news?.score);
  const newsUsable = expectation.news?.usable === true && newsScoreValue !== null;
  const newsScore = newsUsable ? clamp(newsScoreValue) : 50;

  const bullish = Math.max(0, Number(sentiment?.bullish || 0));
  const bearish = Math.max(0, Number(sentiment?.bearish || 0));
  const labeledCount = bullish + bearish;
  const socialScore = labeledCount ? ((bullish + 10) / (labeledCount + 20)) * 100 : 50;
  const socialAvailability = Math.min(20, labeledCount);

  const score = analystScore * 0.45 + newsScore * 0.35 + socialScore * 0.2;
  return {
    score: Math.round(clamp(score)),
    available: (analystUsable ? 45 : 0) + (newsUsable ? 35 : 0) + socialAvailability,
    total: 100,
    details: {
      analyst: {
        score: Math.round(analystScore),
        available: analystUsable,
        changePct: analystRevision,
        referenceDate: expectation.analystRevision?.referenceDate || null,
        daysCompared: expectation.analystRevision?.daysCompared ?? null,
        reason: expectation.analystRevision?.reason || null
      },
      news: {
        score: Math.round(newsScore),
        available: newsUsable,
        matchedEvents: expectation.news?.matchedEvents || [],
        articleCount: expectation.news?.articleCount || 0,
        latestArticleDate: expectation.news?.latestArticleDate || null
      },
      social: {
        score: Math.round(socialScore),
        availableWeight: socialAvailability,
        labeledCount,
        bullish,
        bearish,
        rawBullPct: labeledCount ? (bullish / labeledCount) * 100 : null,
        policy: "Beta-binomial shrinkage with 20 neutral pseudo-observations"
      }
    }
  };
}

export function scoreRating({ fundamentals = {}, technical = {}, expectation = {}, sentiment = {} }) {
  const fundamental = fundamentalScore(fundamentals);
  const technicalResult = technicalScore(technical);
  const expectationResult = expectationScore(expectation, sentiment);
  const score = Math.round(
    fundamental.score * 0.45 + technicalResult.score * 0.4 + expectationResult.score * 0.15
  );
  const confidence = Math.round(
    (fundamental.available / fundamental.total) * 45 +
      (technicalResult.available / technicalResult.total) * 40 +
      (expectationResult.available / expectationResult.total) * 15
  );
  const rating = score >= 70 ? "积极关注" : score >= 55 ? "持有观察" : score >= 40 ? "中性观察" : "谨慎回避";
  const ratingEn = score >= 70 ? "Accumulate" : score >= 55 ? "Hold" : score >= 40 ? "Neutral" : "Avoid";

  return {
    score,
    rating: confidence < 50 ? "数据不足" : rating,
    ratingEn: confidence < 50 ? "Insufficient data" : ratingEn,
    confidence,
    confidenceLabel: confidence >= 80 ? "高" : confidence >= 60 ? "中" : "低",
    components: {
      fundamental,
      technical: technicalResult,
      expectation: expectationResult,
      sentiment: expectationResult
    },
    metricCompleteness: confidence,
    modelVersion: "2026-06-22-v5"
  };
}

export { numberOrNull };
