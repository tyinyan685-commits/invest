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
  return {
    latest,
    sma20: closes.length >= 20 ? average(closes.slice(-20)) : null,
    sma50: closes.length >= 50 ? average(closes.slice(-50)) : null,
    rsi14: latestRsi(closes),
    macdLine: macd.line,
    macdSignal: macd.signal,
    historyCount: closes.length,
    latestDate: prices.at(-1)?.date ?? null
  };
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

function sentimentScore(sentiment) {
  const labeledCount = Number(sentiment?.labeledCount || 0);
  const bullPct = numberOrNull(sentiment?.bullPct);
  const usable = labeledCount >= 10 && bullPct !== null;
  return {
    score: usable ? Math.round(clamp(bullPct)) : 50,
    available: usable ? 1 : 0,
    total: 1,
    sampleSize: labeledCount,
    details: usable ? [{ metric: "StockTwits看多比例", value: bullPct, points: 0 }] : []
  };
}

export function scoreRating({ fundamentals = {}, technical = {}, sentiment = {} }) {
  const fundamental = fundamentalScore(fundamentals);
  const technicalResult = technicalScore(technical);
  const sentimentResult = sentimentScore(sentiment);
  const score = Math.round(
    fundamental.score * 0.45 + technicalResult.score * 0.4 + sentimentResult.score * 0.15
  );
  const confidence = Math.round(
    (fundamental.available / fundamental.total) * 45 +
      (technicalResult.available / technicalResult.total) * 40 +
      (sentimentResult.available / sentimentResult.total) * 15
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
      sentiment: sentimentResult
    },
    modelVersion: "2026-06-20-v1"
  };
}

export { numberOrNull };
