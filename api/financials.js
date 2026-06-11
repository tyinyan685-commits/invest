export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
  const KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
  const BASE = "https://financialmodelingprep.com/stable";
  try {
    const [incRes, kmRes, fgRes] = await Promise.all([
      fetch(`${BASE}/income-statement?symbol=${symbol}&apikey=${KEY}&limit=2`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => []),
      fetch(`${BASE}/key-metrics?symbol=${symbol}&apikey=${KEY}&limit=1`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => []),
      fetch(`${BASE}/financial-growth?symbol=${symbol}&apikey=${KEY}&limit=1`, { signal: AbortSignal.timeout(12000) }).then(r => r.json()).catch(() => []),
    ]);

    const inc = Array.isArray(incRes) && incRes[0] ? incRes[0] : null;
    const incPrev = Array.isArray(incRes) && incRes[1] ? incRes[1] : null;
    const km = Array.isArray(kmRes) && kmRes[0] ? kmRes[0] : null;
    const fg = Array.isArray(fgRes) && fgRes[0] ? fgRes[0] : null;

    if (!inc && !km) {
      return res.status(200).json({ ok: false, error: "No financial data available" });
    }

    // Extract raw values
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

    // Market cap from key-metrics (more recent than profile for some stocks)
    const marketCap = km?.marketCap || 0;
    const evToSales = km?.evToSales || 0;
    const evToEBITDA = km?.evToEBITDA || 0;
    const currentRatio = km?.currentRatio || 0;

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      ok: true,
      revenue, netIncome, grossProfit, eps, shares,
      grossMargin: +grossMargin.toFixed(1),
      netMargin: +netMargin.toFixed(1),
      revenueGrowth: +revenueGrowth.toFixed(1),
      niGrowth: +niGrowth.toFixed(1),
      epsGrowth: +epsGrowth.toFixed(1),
      roe: +roe.toFixed(1),
      roa: +roa.toFixed(1),
      marketCap,
      evToSales: +evToSales.toFixed(1),
      evToEBITDA: +evToEBITDA.toFixed(1),
      currentRatio: +currentRatio.toFixed(2),
      fiscalDate: inc?.date || "",
      fiscalPeriod: inc?.period || "",
      source: "FMP income-statement + key-metrics + financial-growth"
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message, source: "FMP financials (failed)" });
  }
}
