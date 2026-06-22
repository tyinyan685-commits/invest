import { FMP_BASE, FMP_KEY, fetchJSONArray, setCORS, validateSymbol } from "./_lib.js";
import { assessRisk, calculateTechnicalMetrics, numberOrNull, researchState, scoreRating } from "./_rating.js";

function first(value) {
  return Array.isArray(value) ? value[0] || {} : value || {};
}

function growth(current, prior) {
  if (current === null || prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

function ratioPercent(numerator, denominator) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function normalizeHistory(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.historical) ? value.historical : [];
}

function modelApplicability(profile) {
  const classification = `${profile.sector || ""} ${profile.industry || ""}`;
  const limited = /financial|bank|insurance|reit|real estate/i.test(classification);
  return limited
    ? { suitable: false, reason: "该行业的收入、毛利率和资本结构口径与普通经营型公司差异较大，通用评分不能直接用于买卖判断。" }
    : { suitable: true, reason: null };
}

async function loadExpectationHistory(symbol) {
  const base = (process.env.EXPECTATIONS_API_BASE || "https://www.wiseain.com").replace(/\/$/, "");
  try {
    const response = await fetch(`${base}/api/expectations?symbol=${encodeURIComponent(symbol)}`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.samples) ? data.samples : [];
  } catch {
    return [];
  }
}

function analystRevision(currentEps, estimateDate, samples) {
  if (!(currentEps > 0) || !estimateDate) return { usable: false, reason: "Current estimate unavailable" };
  const today = new Date();
  const candidates = samples
    .map((sample) => ({
      ...sample,
      epsEstimate: numberOrNull(sample.epsEstimate),
      daysCompared: Math.round((today - new Date(sample.date)) / 86400000)
    }))
    .filter((sample) => sample.epsEstimate > 0 && sample.estimateDate === estimateDate && sample.daysCompared >= 7 && sample.daysCompared <= 120)
    .sort((a, b) => Math.abs(a.daysCompared - 30) - Math.abs(b.daysCompared - 30));
  const reference = candidates[0];
  if (!reference) return { usable: false, reason: "Need at least 7 days of comparable snapshots" };
  return {
    usable: true,
    changePct: ((currentEps - reference.epsEstimate) / reference.epsEstimate) * 100,
    currentEps,
    referenceEps: reference.epsEstimate,
    referenceDate: reference.date,
    daysCompared: reference.daysCompared,
    estimateDate
  };
}

function classifyNews(stockNews, pressReleases) {
  const positive = /\b(raises? guidance|boosts? outlook|beats? (estimates|expectations)|approved|approval|contract awarded|wins? contract|upgrades? to (buy|outperform)|record revenue)\b/i;
  const negative = /\b(cuts? guidance|lowers? outlook|misses? (estimates|expectations)|investigation|subpoena|recall|downgrades? to (sell|underperform)|bankruptcy|fraud charges?)\b/i;
  const seen = new Set();
  const articles = [...pressReleases.map((row) => ({ ...row, sourceType: "press-release" })), ...stockNews.map((row) => ({ ...row, sourceType: "stock-news" }))]
    .filter((row) => {
      const key = row.url || row.title;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
  let weightedSignal = 0;
  const matchedEvents = [];
  for (const article of articles) {
    const title = String(article.title || "");
    const isPositive = positive.test(title);
    const isNegative = negative.test(title);
    if (isPositive === isNegative) continue;
    const published = new Date(article.publishedDate || article.date || 0);
    const ageDays = Number.isFinite(published.getTime()) ? Math.max(0, (Date.now() - published) / 86400000) : 30;
    const recencyWeight = ageDays <= 2 ? 1 : ageDays <= 7 ? 0.6 : 0.25;
    const sourceWeight = article.sourceType === "press-release" ? 1 : 0.7;
    const direction = isPositive ? 1 : -1;
    weightedSignal += direction * recencyWeight * sourceWeight;
    matchedEvents.push({
      title,
      url: article.url || null,
      date: String(article.publishedDate || article.date || "").slice(0, 10),
      direction: direction > 0 ? "positive" : "negative",
      sourceType: article.sourceType
    });
  }
  return {
    usable: articles.length >= 3,
    score: Math.max(30, Math.min(70, 50 + weightedSignal * 8)),
    articleCount: articles.length,
    matchedEvents: matchedEvents.slice(0, 5),
    policy: "Only explicit event phrases are directional; unmatched headlines remain neutral."
  };
}

function nextAnalystEstimate(estimates, latestFiscalDate) {
  const cutoff = String(latestFiscalDate || "");
  const candidate = (Array.isArray(estimates) ? estimates : [])
    .filter((row) => numberOrNull(row.estimatedEpsAvg ?? row.epsAvg) !== null)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
    .find((row) => !cutoff || String(row.date || "") > cutoff) || null;
  if (!candidate?.date || !latestFiscalDate) return candidate;
  const horizonDays = Math.round((new Date(candidate.date) - new Date(latestFiscalDate)) / 86400000);
  return horizonDays > 0 && horizonDays <= 550 ? { ...candidate, horizonDays } : null;
}

async function loadSentiment(symbol) {
  try {
    const response = await fetch(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return { bullPct: 50, labeledCount: 0, source: `StockTwits ${response.status}` };
    const data = await response.json();
    let bullish = 0;
    let bearish = 0;
    for (const message of data.messages || []) {
      const label = message.entities?.sentiment?.basic;
      if (label === "Bullish") bullish += 1;
      if (label === "Bearish") bearish += 1;
    }
    const labeledCount = bullish + bearish;
    return {
      bullish,
      bearish,
      labeledCount,
      bullPct: labeledCount ? (bullish / labeledCount) * 100 : 50,
      source: "StockTwits labeled messages"
    };
  } catch (error) {
    return { bullPct: 50, labeledCount: 0, source: "StockTwits unavailable", error: error.message };
  }
}

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const validationError = validateSymbol(symbol);
  if (validationError) return res.status(400).json({ ok: false, error: validationError });
  if (!FMP_KEY) return res.status(500).json({ ok: false, error: "FMP_API_KEY 未配置" });

  try {
    const encoded = encodeURIComponent(symbol);
    const urls = {
      profile: `${FMP_BASE}/profile?symbol=${encoded}&apikey=${FMP_KEY}`,
      quote: `${FMP_BASE}/quote?symbol=${encoded}&apikey=${FMP_KEY}`,
      income: `${FMP_BASE}/income-statement?symbol=${encoded}&period=annual&limit=3&apikey=${FMP_KEY}`,
      metrics: `${FMP_BASE}/key-metrics-ttm?symbol=${encoded}&apikey=${FMP_KEY}`,
      estimates: `${FMP_BASE}/analyst-estimates?symbol=${encoded}&period=annual&limit=10&apikey=${FMP_KEY}`,
      history: `${FMP_BASE}/historical-price-eod/full?symbol=${encoded}&apikey=${FMP_KEY}`,
      pressReleases: `${FMP_BASE}/news/press-releases?symbols=${encoded}&limit=8&apikey=${FMP_KEY}`
    };
    const [profiles, quotes, incomeRows, metricRows, estimates, historyValue, sentiment, expectationHistory, pressReleases] = await Promise.all([
      fetchJSONArray(urls.profile),
      fetchJSONArray(urls.quote),
      fetchJSONArray(urls.income),
      fetchJSONArray(urls.metrics),
      fetchJSONArray(urls.estimates),
      fetch(urls.history, { signal: AbortSignal.timeout(15000) }).then((response) => response.json()).catch(() => []),
      loadSentiment(symbol),
      loadExpectationHistory(symbol),
      fetchJSONArray(urls.pressReleases)
    ]);

    const profile = first(profiles);
    const quote = first(quotes);
    const latestIncome = incomeRows[0] || {};
    const priorIncome = incomeRows[1] || {};
    const metrics = first(metricRows);
    const analystEstimate = nextAnalystEstimate(estimates, latestIncome.date);
    const history = normalizeHistory(historyValue);
    const technical = calculateTechnicalMetrics(history);
    const price = numberOrNull(quote.price ?? profile.price ?? technical.latest);
    const epsEstimate = numberOrNull(analystEstimate?.estimatedEpsAvg ?? analystEstimate?.epsAvg);
    const fwdPe = price !== null && epsEstimate !== null && epsEstimate > 0 ? price / epsEstimate : null;
    const revenue = numberOrNull(latestIncome.revenue);
    const priorRevenue = numberOrNull(priorIncome.revenue);
    const netIncome = numberOrNull(latestIncome.netIncome);
    const priorNetIncome = numberOrNull(priorIncome.netIncome);
    const grossProfit = numberOrNull(latestIncome.grossProfit);
    const roeRaw = numberOrNull(metrics.returnOnEquityTTM);
    const fundamentals = {
      fwdPe,
      fwdPeSource: fwdPe === null ? null : "FMP analyst-estimates",
      epsEstimate,
      estimateDate: analystEstimate?.date || null,
      estimateHorizonDays: analystEstimate?.horizonDays ?? null,
      revenueGrowth: growth(revenue, priorRevenue),
      netIncomeGrowth: growth(netIncome, priorNetIncome),
      roe: roeRaw === null ? null : roeRaw * 100,
      grossMargin: ratioPercent(grossProfit, revenue),
      fiscalDate: latestIncome.date || null
    };
    const expectation = {
      analystRevision: analystRevision(epsEstimate, fundamentals.estimateDate, expectationHistory),
      news: classifyNews([], pressReleases)
    };
    const applicability = modelApplicability(profile);
    const calculatedRating = scoreRating({ fundamentals, technical, expectation, sentiment });
    const rating = applicability.suitable
      ? calculatedRating
      : { ...calculatedRating, rating: "模型适用性有限", ratingEn: "Limited applicability" };
    const risk = assessRisk({
      fwdPe: fundamentals.fwdPe,
      beta: profile.beta ?? quote.beta,
      annualizedVolatility20: technical.annualizedVolatility20,
      maxDrawdown60: technical.maxDrawdown60,
      latest: technical.latest,
      sma50: technical.sma50
    });
    const state = researchState(rating.score, risk, applicability);

    setCORS(res);
    res.setHeader("Cache-Control", "public, s-maxage=1800, stale-while-revalidate=3600");
    return res.status(200).json({
      ok: true,
      symbol,
      name: profile.companyName || quote.name || symbol,
      price,
      currency: profile.currency || null,
      generatedAt: new Date().toISOString(),
      rating,
      researchState: state,
      modelApplicability: applicability,
      metrics: { fundamentals, technical, expectation, sentiment, risk },
      sources: {
        marketAndFinancials: "Financial Modeling Prep",
        sentiment: sentiment.source,
        analystRevisionHistory: "Supabase daily rating snapshots",
        newsSignal: "FMP company press releases",
        priceAsOf: technical.latestDate,
        fiscalAsOf: fundamentals.fiscalDate,
        estimateAsOf: fundamentals.estimateDate
      },
      dataPolicy: "仅使用真实接口返回值；分析师修订必须有至少7天同预测期快照；新闻仅对明确事件短语定向；社交情绪使用中性先验收缩。缺失项按中性处理并降低指标完整度。"
    });
  } catch (error) {
    setCORS(res);
    return res.status(500).json({ ok: false, error: error.message || "Rating failed" });
  }
}
