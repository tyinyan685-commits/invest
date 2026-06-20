import { FMP_BASE, FMP_KEY, fetchJSONArray, setCORS, validateSymbol } from "./_lib.js";
import { calculateTechnicalMetrics, numberOrNull, scoreRating } from "./_rating.js";

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
      history: `${FMP_BASE}/historical-price-eod/full?symbol=${encoded}&apikey=${FMP_KEY}`
    };
    const [profiles, quotes, incomeRows, metricRows, estimates, historyValue, sentiment] = await Promise.all([
      fetchJSONArray(urls.profile),
      fetchJSONArray(urls.quote),
      fetchJSONArray(urls.income),
      fetchJSONArray(urls.metrics),
      fetchJSONArray(urls.estimates),
      fetch(urls.history, { signal: AbortSignal.timeout(15000) }).then((response) => response.json()).catch(() => []),
      loadSentiment(symbol)
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
      estimateDate: analystEstimate?.date || null,
      estimateHorizonDays: analystEstimate?.horizonDays ?? null,
      revenueGrowth: growth(revenue, priorRevenue),
      netIncomeGrowth: growth(netIncome, priorNetIncome),
      roe: roeRaw === null ? null : roeRaw * 100,
      grossMargin: ratioPercent(grossProfit, revenue),
      fiscalDate: latestIncome.date || null
    };
    const rating = scoreRating({ fundamentals, technical, sentiment });

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
      metrics: { fundamentals, technical, sentiment },
      sources: {
        marketAndFinancials: "Financial Modeling Prep",
        sentiment: sentiment.source,
        priceAsOf: technical.latestDate,
        fiscalAsOf: fundamentals.fiscalDate,
        estimateAsOf: fundamentals.estimateDate
      },
      dataPolicy: "仅使用真实接口返回值；缺失指标按中性处理并降低指标完整度。完整度不等于准确率，评分不代表收益预测。"
    });
  } catch (error) {
    setCORS(res);
    return res.status(500).json({ ok: false, error: error.message || "Rating failed" });
  }
}
