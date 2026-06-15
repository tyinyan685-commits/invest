export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
  const KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
  const BASE = "https://financialmodelingprep.com/stable";
  const opt = { signal: AbortSignal.timeout(12000) };
  const fetchJSON = (url) => fetch(url, opt).then(r => r.json()).catch(() => []);
  try {
    // Fetch 7 endpoints in parallel (income quarterly for QoQ trends, annual for growth rates)
    const [incRes, incAnnual, kmRes, fgRes, bsRes, cfRes, ptRes] = await Promise.all([
      fetchJSON(`${BASE}/income-statement?symbol=${symbol}&apikey=${KEY}&limit=5&period=quarter`),
      fetchJSON(`${BASE}/income-statement?symbol=${symbol}&apikey=${KEY}&limit=2`),
      fetchJSON(`${BASE}/key-metrics?symbol=${symbol}&apikey=${KEY}&limit=1`),
      fetchJSON(`${BASE}/financial-growth?symbol=${symbol}&apikey=${KEY}&limit=1`),
      fetchJSON(`${BASE}/balance-sheet-statement?symbol=${symbol}&apikey=${KEY}&limit=1`),
      fetchJSON(`${BASE}/cash-flow-statement?symbol=${symbol}&apikey=${KEY}&limit=1`),
      fetchJSON(`${BASE}/price-target-summary?symbol=${symbol}&apikey=${KEY}`),
    ]);

    // Annual data for headline metrics (PE, revenue, growth rates)
    const inc = Array.isArray(incAnnual) && incAnnual[0] ? incAnnual[0] : (Array.isArray(incRes) && incRes[0] ? incRes[0] : null);
    const incPrev = Array.isArray(incAnnual) && incAnnual[1] ? incAnnual[1] : null;
    const km = Array.isArray(kmRes) && kmRes[0] ? kmRes[0] : null;
    const fg = Array.isArray(fgRes) && fgRes[0] ? fgRes[0] : null;
    const bs = Array.isArray(bsRes) && bsRes[0] ? bsRes[0] : null;
    const cf = Array.isArray(cfRes) && cfRes[0] ? cfRes[0] : null;
    const pt = Array.isArray(ptRes) && ptRes[0] ? ptRes[0] : null;

    if (!inc && !km) {
      return res.status(200).json({ ok: false, error: "No financial data available" });
    }

    // Income statement
    const revenue = inc?.revenue || 0;
    const netIncome = inc?.netIncome || 0;
    const grossProfit = inc?.grossProfit || 0;
    const eps = inc?.epsDiluted || inc?.eps || 0;
    const shares = inc?.weightedAverageShsOut || 0;
    const grossMargin = revenue > 0 ? (grossProfit / revenue * 100) : 0;
    const netMargin = revenue > 0 ? (netIncome / revenue * 100) : 0;

    // Growth rates
    const revenueGrowth = fg?.revenueGrowth ? fg.revenueGrowth * 100 : (
      incPrev?.revenue ? ((revenue - incPrev.revenue) / incPrev.revenue * 100) : 0
    );
    const niGrowth = fg?.netIncomeGrowth ? fg.netIncomeGrowth * 100 : (
      incPrev?.netIncome ? ((netIncome - incPrev.netIncome) / incPrev.netIncome * 100) : 0
    );
    const epsGrowth = fg?.epsdilutedGrowth ? fg.epsdilutedGrowth * 100 : (
      incPrev?.epsDiluted ? ((eps - (incPrev.epsDiluted || incPrev.eps)) / (incPrev.epsDiluted || incPrev.eps || 1) * 100) : 0
    );

    // ROE, ROA
    const roe = km?.returnOnEquity ? km.returnOnEquity * 100 : 0;
    const roa = km?.returnOnAssets ? km.returnOnAssets * 100 : 0;

    // Key metrics
    const marketCap = km?.marketCap || 0;
    const evToSales = km?.evToSales || 0;
    const evToEBITDA = km?.evToEBITDA || 0;
    const currentRatio = km?.currentRatio || 0;

    // Balance sheet (real data, no more estimates)
    const cash = bs ? (bs.cashAndCashEquivalents || 0) + (bs.shortTermInvestments || 0) : null;
    const totalDebt = bs?.totalDebt || null;
    const netDebt = bs?.netDebt || null;
    const totalAssets = bs?.totalAssets || null;
    const totalLiabilities = bs?.totalLiabilities || null;
    const totalEquity = bs?.totalStockholdersEquity || null;
    const debtToEquity = (totalDebt && totalEquity && totalEquity > 0) ? +(totalDebt / totalEquity * 100).toFixed(1) : null;

    // Cash flow (real data)
    const operatingCF = cf?.operatingCashFlow || null;
    const capitalExpenditure = cf?.capitalExpenditure || null;
    const freeCashFlow = cf?.freeCashFlow || null;
    const dividendsPaid = cf?.dividendsPaid || 0;

    // Analyst price targets
    const analystTarget = pt ? {
      avgTarget: pt.lastMonthAvgPriceTarget || pt.lastQuarterAvgPriceTarget || null,
      count: pt.lastMonthCount || pt.lastQuarterCount || 0,
      avgTargetQuarter: pt.lastQuarterAvgPriceTarget || null,
      avgTargetYear: pt.lastYearAvgPriceTarget || null,
      countYear: pt.lastYearCount || 0,
    } : null;

    // Quarterly trends (for QoQ display) — up to 5 quarters
    const quarters = [];
    if (Array.isArray(incRes) && incRes.length >= 2) {
      for (let i = 0; i < Math.min(incRes.length, 5); i++) {
        const q = incRes[i];
        const rev = q.revenue || 0;
        const ni = q.netIncome || 0;
        const gp = q.grossProfit || 0;
        const epsVal = q.epsDiluted || q.eps || 0;
        quarters.push({
          date: q.date || "",
          period: q.period || "",
          symbol: q.symbol || symbol,
          revenue: rev,
          netIncome: ni,
          grossProfit: gp,
          eps: epsVal,
          grossMargin: rev > 0 ? +((gp / rev) * 100).toFixed(1) : 0,
          netMargin: rev > 0 ? +((ni / rev) * 100).toFixed(1) : 0,
        });
      }
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      ok: true,
      // Income
      revenue, netIncome, grossProfit, eps, shares,
      grossMargin: +grossMargin.toFixed(1),
      netMargin: +netMargin.toFixed(1),
      // Growth
      revenueGrowth: +revenueGrowth.toFixed(1),
      niGrowth: +niGrowth.toFixed(1),
      epsGrowth: +epsGrowth.toFixed(1),
      // Profitability
      roe: +roe.toFixed(1),
      roa: +roa.toFixed(1),
      // Market
      marketCap, evToSales: +evToSales.toFixed(1), evToEBITDA: +evToEBITDA.toFixed(1),
      currentRatio: +currentRatio.toFixed(2),
      // Balance sheet (real)
      cash, totalDebt, netDebt, totalAssets, totalLiabilities, totalEquity, debtToEquity,
      // Cash flow (real)
      operatingCF, capitalExpenditure, freeCashFlow, dividendsPaid,
      // Analyst targets
      analystTarget,
      // Quarterly trends (P2)
      quarters,
      // Meta
      fiscalDate: inc?.date || "",
      fiscalPeriod: inc?.period || "",
      balanceSheetDate: bs?.date || "",
      cashFlowDate: cf?.date || "",
      source: "FMP income+metrics+growth+balance+cashflow+targets"
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message, source: "FMP financials (failed)" });
  }
}
