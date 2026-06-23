import { FMP_KEY, FMP_BASE, fetchJSONArray, setCORS, validateSymbol } from "./_lib.js";
import { aggregateTtmIncome, numberOrNull } from "./_rating.js";

export function normalizeBalanceSheet(row) {
  if (!row) return { cash: null, totalDebt: null, netDebt: null, totalAssets: null, totalLiabilities: null, totalEquity: null, debtToEquity: null };
  const cashOnly = numberOrNull(row.cashAndCashEquivalents);
  const shortTermInvestments = numberOrNull(row.shortTermInvestments);
  const cash = cashOnly === null && shortTermInvestments === null ? null : (cashOnly ?? 0) + (shortTermInvestments ?? 0);
  const totalDebt = numberOrNull(row.totalDebt);
  const totalEquity = numberOrNull(row.totalStockholdersEquity);
  return {
    cash,
    totalDebt,
    netDebt: numberOrNull(row.netDebt),
    totalAssets: numberOrNull(row.totalAssets),
    totalLiabilities: numberOrNull(row.totalLiabilities),
    totalEquity,
    debtToEquity: totalDebt !== null && totalEquity > 0 ? +(totalDebt / totalEquity * 100).toFixed(1) : null
  };
}

export default async function handler(req, res) {
  const { symbol } = req.query;
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err });
  if (!FMP_KEY) return res.status(200).json({ ok: false, error: "FMP_API_KEY 未配置" });
  const s = encodeURIComponent(symbol);
  try {
    // Income and cash-flow headlines use trailing four quarters; the balance sheet uses the latest quarter.
    const [incRes, incAnnual, kmRes, bsQuarterRes, bsAnnualRes, cfQuarterRes, cfAnnualRes, ptRes] = await Promise.all([
      fetchJSONArray(`${FMP_BASE}/income-statement?symbol=${s}&apikey=${FMP_KEY}&limit=8&period=quarter`),
      fetchJSONArray(`${FMP_BASE}/income-statement?symbol=${s}&apikey=${FMP_KEY}&limit=2`),
      fetchJSONArray(`${FMP_BASE}/key-metrics-ttm?symbol=${s}&apikey=${FMP_KEY}`),
      fetchJSONArray(`${FMP_BASE}/balance-sheet-statement?symbol=${s}&apikey=${FMP_KEY}&limit=1&period=quarter`),
      fetchJSONArray(`${FMP_BASE}/balance-sheet-statement?symbol=${s}&apikey=${FMP_KEY}&limit=1&period=annual`),
      fetchJSONArray(`${FMP_BASE}/cash-flow-statement?symbol=${s}&apikey=${FMP_KEY}&limit=4&period=quarter`),
      fetchJSONArray(`${FMP_BASE}/cash-flow-statement?symbol=${s}&apikey=${FMP_KEY}&limit=1&period=annual`),
      fetchJSONArray(`${FMP_BASE}/price-target-summary?symbol=${s}&apikey=${FMP_KEY}`),
    ]);

    const quarterRows = [...(Array.isArray(incRes) ? incRes : [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const annualRows = [...(Array.isArray(incAnnual) ? incAnnual : [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const ttm = aggregateTtmIncome(quarterRows);
    const latestQuarter = quarterRows[0] || null;
    const annualFallback = annualRows[0] || null;
    const inc = ttm.current || annualFallback;
    const incPrev = ttm.prior || annualRows[1] || null;
    const km = Array.isArray(kmRes) && kmRes[0] ? kmRes[0] : null;
    const bs = bsQuarterRes?.[0] || bsAnnualRes?.[0] || null;
    const cashFlowRows = [...(Array.isArray(cfQuarterRes) ? cfQuarterRes : [])]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, 4);
    const annualCashFlow = cfAnnualRes?.[0] || null;
    const pt = Array.isArray(ptRes) && ptRes[0] ? ptRes[0] : null;

    if (!inc && !km) {
      return res.status(200).json({ ok: false, error: "No financial data available" });
    }

    // Income statement
    const revenue = numberOrNull(inc?.revenue);
    const netIncome = numberOrNull(inc?.netIncome);
    const grossProfit = numberOrNull(inc?.grossProfit);
    const operatingIncome = numberOrNull(inc?.operatingIncome);
    const eps = numberOrNull(inc?.eps ?? inc?.epsDiluted);
    const shares = numberOrNull(latestQuarter?.weightedAverageShsOutDil ?? latestQuarter?.weightedAverageShsOut ?? annualFallback?.weightedAverageShsOut);
    const grossMargin = revenue > 0 && grossProfit !== null ? (grossProfit / revenue * 100) : null;
    const netMargin = revenue > 0 && netIncome !== null ? (netIncome / revenue * 100) : null;
    const operatingMargin = revenue > 0 && operatingIncome !== null ? (operatingIncome / revenue * 100) : null;

    // Growth rates
    const revenueGrowth = (
      revenue !== null && numberOrNull(incPrev?.revenue) !== null && Number(incPrev.revenue) !== 0
        ? ((revenue - Number(incPrev.revenue)) / Math.abs(Number(incPrev.revenue)) * 100) : null
    );
    const niGrowth = (
      netIncome !== null && numberOrNull(incPrev?.netIncome) !== null && Number(incPrev.netIncome) !== 0
        ? ((netIncome - Number(incPrev.netIncome)) / Math.abs(Number(incPrev.netIncome)) * 100) : null
    );
    const epsGrowth = (
      eps !== null && numberOrNull(incPrev?.eps ?? incPrev?.epsDiluted) !== null && Number(incPrev.eps ?? incPrev.epsDiluted) !== 0
        ? ((eps - Number(incPrev.eps ?? incPrev.epsDiluted)) / Math.abs(Number(incPrev.eps ?? incPrev.epsDiluted)) * 100) : null
    );

    // ROE, ROA
    const roeValue = numberOrNull(km?.returnOnEquityTTM ?? km?.returnOnEquity);
    const roaValue = numberOrNull(km?.returnOnAssetsTTM ?? km?.returnOnAssets);
    const roe = roeValue === null ? null : roeValue * 100;
    const roa = roaValue === null ? null : roaValue * 100;

    // Key metrics
    const marketCap = numberOrNull(km?.marketCapTTM ?? km?.marketCap);
    const evToSales = numberOrNull(km?.evToSalesTTM ?? km?.evToSales);
    const evToEBITDA = numberOrNull(km?.enterpriseValueOverEBITDATTM ?? km?.evToEBITDA);
    const currentAssets = numberOrNull(bs?.totalCurrentAssets);
    const currentLiabilities = numberOrNull(bs?.totalCurrentLiabilities);
    const currentRatio = currentAssets !== null && currentLiabilities > 0 ? currentAssets / currentLiabilities : null;

    // Balance sheet (real data, no more estimates)
    const { cash, totalDebt, netDebt, totalAssets, totalLiabilities, totalEquity, debtToEquity } = normalizeBalanceSheet(bs);

    // Cash flow (real data)
    const sumCashFlow = (key) => {
      if (cashFlowRows.length === 4) {
        const values = cashFlowRows.map((row) => numberOrNull(row[key]));
        if (!values.some((value) => value === null)) return values.reduce((total, value) => total + value, 0);
      }
      return numberOrNull(annualCashFlow?.[key]);
    };
    const operatingCF = sumCashFlow("operatingCashFlow");
    const capitalExpenditure = sumCashFlow("capitalExpenditure");
    const freeCashFlow = sumCashFlow("freeCashFlow");
    const dividendsPaid = sumCashFlow("dividendsPaid");

    // Analyst price targets
    const analystTarget = pt ? {
      avgTarget: pt.lastMonthAvgPriceTarget || pt.lastQuarterAvgPriceTarget || null,
      count: pt.lastMonthCount || pt.lastQuarterCount || 0,
      avgTargetQuarter: pt.lastQuarterAvgPriceTarget || null,
      avgTargetYear: pt.lastYearAvgPriceTarget || null,
      countYear: pt.lastYearCount || 0,
    } : null;

    const completenessFields = [revenue, netIncome, eps, grossMargin, operatingMargin, roe, totalEquity, operatingCF, freeCashFlow];
    const dataCompleteness = {
      available: completenessFields.filter((value) => value !== null).length,
      total: completenessFields.length
    };

    // Quarterly trends (for QoQ display) — up to 5 quarters
    const quarters = [];
    if (quarterRows.length >= 2) {
      for (let i = 0; i < Math.min(quarterRows.length, 5); i++) {
        const q = quarterRows[i];
        const rev = numberOrNull(q.revenue);
        const ni = numberOrNull(q.netIncome);
        const gp = numberOrNull(q.grossProfit);
        const epsVal = numberOrNull(q.epsDiluted ?? q.eps);
        quarters.push({
          date: q.date || "",
          period: q.period || "",
          symbol: q.symbol || symbol,
          revenue: rev,
          netIncome: ni,
          grossProfit: gp,
          eps: epsVal,
          grossMargin: rev > 0 && gp !== null ? +((gp / rev) * 100).toFixed(1) : null,
          netMargin: rev > 0 && ni !== null ? +((ni / rev) * 100).toFixed(1) : null,
        });
      }
    }

    setCORS(res);
    res.status(200).json({
      ok: true,
      // Income
      revenue, netIncome, grossProfit, operatingIncome, eps, shares,
      grossMargin: grossMargin === null ? null : +grossMargin.toFixed(1),
      netMargin: netMargin === null ? null : +netMargin.toFixed(1),
      operatingMargin: operatingMargin === null ? null : +operatingMargin.toFixed(1),
      // Growth
      revenueGrowth: revenueGrowth === null ? null : +revenueGrowth.toFixed(1),
      niGrowth: niGrowth === null ? null : +niGrowth.toFixed(1),
      epsGrowth: epsGrowth === null ? null : +epsGrowth.toFixed(1),
      // Profitability
      roe: roe === null ? null : +roe.toFixed(1),
      roa: roa === null ? null : +roa.toFixed(1),
      // Market
      marketCap, evToSales: evToSales === null ? null : +evToSales.toFixed(1), evToEBITDA: evToEBITDA === null ? null : +evToEBITDA.toFixed(1),
      currentRatio: currentRatio === null ? null : +currentRatio.toFixed(2),
      // Balance sheet (real)
      cash, totalDebt, netDebt, totalAssets, totalLiabilities, totalEquity, debtToEquity,
      // Cash flow (real)
      operatingCF, capitalExpenditure, freeCashFlow, dividendsPaid,
      // Analyst targets
      analystTarget,
      dataCompleteness,
      // Quarterly trends (P2)
      quarters,
      // Meta
      fiscalDate: inc?.date || latestQuarter?.date || annualFallback?.date || "",
      fiscalPeriod: ttm.current ? "TTM" : annualFallback?.period || "",
      balanceSheetDate: bs?.date || "",
      cashFlowDate: cashFlowRows.length === 4 ? cashFlowRows[0]?.date || "" : annualCashFlow?.date || "",
      cashFlowPeriod: cashFlowRows.length === 4 ? "TTM" : annualCashFlow?.period || "",
      source: "FMP TTM income+metrics; latest quarterly balance and TTM cash flow with annual fallback; analyst targets"
    });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, error: e.message, source: "FMP financials (failed)" });
  }
}
