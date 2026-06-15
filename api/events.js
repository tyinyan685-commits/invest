export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
  const FMP_KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
  const FRED_KEY = "07a98309feadf15506ac4004b1d66492";
  const FMP = "https://financialmodelingprep.com/stable";
  const FRED = "https://api.stlouisfed.org/fred";
  const opt = { signal: AbortSignal.timeout(12000) };
  const fetchJSON = (url) => fetch(url, opt).then(r => r.json()).catch(() => null);

  try {
    const today = new Date();
    const fmtDate = (d) => d.toISOString().slice(0, 10);

    // Parallel: quarterly income (fallback) + key economic series + Nasdaq earnings search
    // First, generate list of upcoming business days to search
    const searchDates = [];
    for (let i = 1; i <= 60 && searchDates.length < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      if (d.getDay() !== 0 && d.getDay() !== 6) searchDates.push(fmtDate(d));
    }

    // Query Nasdaq earnings calendar in parallel batches of 8
    let earnings = null;
    const NASDAQ = "https://api.nasdaq.com/api/calendar/earnings";
    const nasdaqHeaders = {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      "Accept": "application/json",
    };

    for (let batch = 0; batch < searchDates.length && !earnings; batch += 8) {
      const batchDates = searchDates.slice(batch, batch + 8);
      const results = await Promise.all(
        batchDates.map(async (date) => {
          try {
            const r = await fetch(`${NASDAQ}?date=${date}`, {
              headers: nasdaqHeaders,
              signal: AbortSignal.timeout(8000),
            });
            const d = await r.json();
            return { date, rows: d?.data?.rows || [] };
          } catch (e) {
            return { date, rows: [] };
          }
        })
      );
      for (const { date, rows } of results) {
        const match = rows.find(r => r.symbol === symbol);
        if (match) {
          earnings = {
            date,
            estimated: false,
            hour: match.time === "time-after-hours" ? "\u76D8\u540E" : match.time === "time-pre-market" ? "\u76D8\u524D" : "TBD",
            epsForecast: match.epsForecast ? parseFloat(String(match.epsForecast).replace(/[$,]/g, "")) || null : null,
            lastYearEPS: match.lastYearEPS ? parseFloat(String(match.lastYearEPS).replace(/[$,]/g, "")) || null : null,
            lastYearDate: match.lastYearRptDt || null,
            fiscalQuarterEnding: match.fiscalQuarterEnding || null,
            analystCount: match.noOfEsts ? parseInt(match.noOfEsts) : null,
            source: "Nasdaq",
          };
          break;
        }
      }
    }

    // Parallel: quarterly income (for earnings fallback) + key economic series
    const [qIncRes, cpiRes, ppiRes, unrateRes, payRes, fomcRes] = await Promise.all([
      fetchJSON(`${FMP}/income-statement?symbol=${symbol}&apikey=${FMP_KEY}&limit=4&period=quarter`),
      fetchJSON(`${FRED}/series/observations?series_id=CPIAUCSL&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=14`),
      fetchJSON(`${FRED}/series/observations?series_id=PPIACO&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=14`),
      fetchJSON(`${FRED}/series/observations?series_id=UNRATE&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED}/series/observations?series_id=PAYEMS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED}/series/observations?series_id=FEDFUNDS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
    ]);

    // Fallback: estimate earnings from quarterly income pattern if Nasdaq didn't find it
    if (!earnings && Array.isArray(qIncRes) && qIncRes.length > 0) {
      const latest = qIncRes[0];
      const acceptedDate = latest.acceptedDate ? new Date(latest.acceptedDate.split(" ")[0]) : null;
      const latestDate = acceptedDate || (latest.date ? new Date(latest.date) : null);
      if (latestDate) {
        const estNext = new Date(latestDate);
        estNext.setDate(estNext.getDate() + 90);
        if (estNext < today) estNext.setDate(estNext.getDate() + 90);
        earnings = {
          date: fmtDate(estNext),
          estimated: true,
          hour: "TBD",
          lastQuarter: `${latest.period || ""} (${fmtDate(latestDate)})`,
          lastRevenue: latest.revenue || null,
          lastEps: latest.epsDiluted || latest.eps || null,
          source: "estimated",
        };
      }
    }

    // --- 2. Build macro calendar from known schedules + FRED data ---
    const fomcDates2026 = [
      "2026-01-28", "2026-03-18", "2026-04-29", "2026-06-17",
      "2026-07-29", "2026-09-16", "2026-11-04", "2026-12-16",
    ];

    const macroEvents = [];

    for (const d of fomcDates2026) {
      if (new Date(d) > today) {
        macroEvents.push({ date: d, name: "FOMC \u5229\u7387\u51B3\u8BAE", icon: "\u{1F3E6}", impact: "\u6700\u9AD8", source: "Federal Reserve" });
        break;
      }
    }

    const nextCPI = new Date(today);
    nextCPI.setDate(13);
    if (nextCPI <= today) nextCPI.setMonth(nextCPI.getMonth() + 1);
    macroEvents.push({ date: fmtDate(nextCPI), name: "CPI \u6570\u636E\u53D1\u5E03", icon: "\u{1F4CA}", impact: "\u9AD8", source: "BLS" });

    const nextPPI = new Date(today);
    nextPPI.setDate(15);
    if (nextPPI <= today) nextPPI.setMonth(nextPPI.getMonth() + 1);
    macroEvents.push({ date: fmtDate(nextPPI), name: "PPI \u6570\u636E\u53D1\u5E03", icon: "\u{1F4C8}", impact: "\u4E2D-\u9AD8", source: "BLS" });

    const nextNFP = new Date(today);
    nextNFP.setDate(1);
    while (nextNFP.getDay() !== 5) nextNFP.setDate(nextNFP.getDate() + 1);
    if (nextNFP <= today) {
      nextNFP.setMonth(nextNFP.getMonth() + 1);
      nextNFP.setDate(1);
      while (nextNFP.getDay() !== 5) nextNFP.setDate(nextNFP.getDate() + 1);
    }
    macroEvents.push({ date: fmtDate(nextNFP), name: "\u975E\u519C\u5C31\u4E1A\u62A5\u544A", icon: "\u{1F477}", impact: "\u9AD8", source: "BLS" });

    macroEvents.sort((a, b) => (a.date > b.date ? 1 : -1));

    // --- 3. Latest economic indicators with YoY ---
    const indicators = {};
    const parseLatest = (res) => {
      if (!res?.observations?.length) return null;
      const obs = res.observations;
      const latest = obs[0];
      const prev = obs[1] || obs[0];
      if (!latest?.value || latest.value === ".") return null;
      const v = parseFloat(latest.value);
      const pv = parseFloat(prev?.value || latest.value);
      return { value: v, prev: pv, change: +(v - pv).toFixed(2), date: latest.date };
    };

    const parseYoY = (res) => {
      if (!res?.observations?.length) return null;
      const obs = res.observations;
      const latest = obs[0];
      const yearAgo = obs[obs.length - 1];
      if (!latest?.value || latest.value === ".") return null;
      const v = parseFloat(latest.value);
      const yv = yearAgo ? parseFloat(yearAgo.value) : v;
      const yoy = yv > 0 ? +((v - yv) / yv * 100).toFixed(1) : 0;
      const prev = obs[1] || latest;
      const pv = parseFloat(prev?.value || latest.value);
      return { value: +v.toFixed(1), yoy, mom: +(v - pv).toFixed(2), date: latest.date };
    };

    const cpi = parseYoY(cpiRes);
    const ppi = parseYoY(ppiRes);
    const unrate = parseLatest(unrateRes);
    const pay = parseLatest(payRes);
    const ff = parseLatest(fomcRes);

    if (cpi) indicators.cpi = { value: cpi.value, yoy: cpi.yoy + "%", mom: cpi.mom, date: cpi.date, label: "CPI", unit: "", desc: cpi.yoy > 3 ? "\u504F\u9AD8\uFF0C\u6210\u957F\u80A1\u4F30\u503C\u627F\u538B" : cpi.yoy > 2 ? "\u6E29\u548C" : "\u4F4E\u8FF7" };
    if (ppi) indicators.ppi = { value: ppi.value, yoy: ppi.yoy + "%", mom: ppi.mom, date: ppi.date, label: "PPI", unit: "", desc: ppi.yoy > 4 ? "\u751F\u4EA7\u7AEF\u901A\u80C0\u538B\u529B" : ppi.yoy > 2 ? "\u751F\u4EA7\u7AEF\u6E29\u548C" : "\u751F\u4EA7\u7AEF\u4F4E\u8FF7" };
    if (unrate) indicators.unemployment = { value: unrate.value, change: unrate.change, date: unrate.date, label: "\u5931\u4E1A\u7387", unit: "%", desc: unrate.value > 5 ? "\u52B3\u52A8\u5E02\u573A\u964D\u6E29" : "\u52B3\u52A8\u5E02\u573A\u7A33\u5065" };
    if (pay) indicators.nonfarm = { value: pay.value, change: pay.change, date: pay.date, label: "\u975E\u519C\u5C31\u4E1A", unit: "\u5343\u4EBA", desc: pay.change > 100 ? "\u5C31\u4E1A\u5F3A\u52B2" : pay.change > 0 ? "\u5C31\u4E1A\u7A33\u5B9A" : "\u5C31\u4E1A\u8D70\u5F31" };
    if (ff) indicators.fedFunds = { value: ff.value, date: ff.date, label: "Fed Funds", unit: "%", desc: "" };

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      ok: true,
      earnings,
      macroEvents: macroEvents.slice(0, 8),
      indicators,
      generatedAt: fmtDate(today),
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message });
  }
}
