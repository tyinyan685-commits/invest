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
    const twoWeeks = new Date(today);
    twoWeeks.setDate(today.getDate() + 14);
    const fmtDate = (d) => d.toISOString().slice(0, 10);

    // Parallel: earnings calendar + FRED releases + key economic series
    const [earnRes, releasesRes, cpiRes, ppiRes, unrateRes, payRes] = await Promise.all([
      fetchJSON(`${FMP}/earning-calendar?symbol=${symbol}&apikey=${FMP_KEY}`),
      fetchJSON(`${FRED}/releases/dates?api_key=${FRED_KEY}&file_type=json&realtime_start=${fmtDate(today)}&realtime_end=${fmtDate(twoWeeks)}&limit=25`),
      fetchJSON(`${FRED}/series/observations?series_id=CPIAUCSL&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED}/series/observations?series_id=PPIACO&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED}/series/observations?series_id=UNRATE&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED}/series/observations?series_id=PAYEMS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
    ]);

    // --- 1. Earnings date ---
    let earnings = null;
    if (earnRes && Array.isArray(earnRes)) {
      const upcoming = earnRes.find(e => e.date && new Date(e.date) >= new Date(fmtDate(today))) || earnRes[0];
      if (upcoming) {
        earnings = {
          date: upcoming.date,
          hour: upcoming.hour || "TBD",
          epsEstimate: upcoming.epsEstimated || null,
          revenueEstimate: upcoming.revenueEstimated || null,
        };
      }
    }

    // --- 2. FRED economic releases (next 2 weeks) ---
    const releaseMap = {
      "Consumer Price Index": { tag: "CPI", impact: "高", icon: "📊" },
      "Producer Price Index": { tag: "PPI", impact: "中-高", icon: "📈" },
      "Employment Situation": { tag: "非农就业", impact: "高", icon: "👷" },
      "FOMC": { tag: "FOMC利率决议", impact: "最高", icon: "🏦" },
      "Federal Open Market Committee": { tag: "FOMC", impact: "最高", icon: "🏦" },
      "Retail Sales": { tag: "零售销售", impact: "中", icon: "🛒" },
      "Housing Starts": { tag: "新屋开工", impact: "低-中", icon: "🏠" },
      "Industrial Production": { tag: "工业产出", impact: "低-中", icon: "🏭" },
      "Advance Retail Sales": { tag: "零售销售", impact: "中", icon: "🛒" },
      "Business Inventories": { tag: "商业库存", impact: "低", icon: "📦" },
      "Gross Domestic Product": { tag: "GDP", impact: "高", icon: "📉" },
      "Personal Income and Outlays": { tag: "PCE消费", impact: "中-高", icon: "💰" },
    };

    let macroEvents = [];
    if (releasesRes?.releases) {
      const seen = new Set();
      for (const rel of releasesRes.releases) {
        const name = rel.name || "";
        let mapped = null;
        for (const [key, val] of Object.entries(releaseMap)) {
          if (name.includes(key) && !seen.has(val.tag)) {
            mapped = val;
            seen.add(val.tag);
            break;
          }
        }
        if (mapped) {
          macroEvents.push({
            date: rel.date,
            name: mapped.tag,
            fullName: name,
            impact: mapped.impact,
            icon: mapped.icon,
          });
        }
      }
    }
    // Sort by date
    macroEvents.sort((a, b) => (a.date > b.date ? 1 : -1));

    // --- 3. Latest economic indicators ---
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

    const cpi = parseLatest(cpiRes);
    const ppi = parseLatest(ppiRes);
    const unrate = parseLatest(unrateRes);
    const pay = parseLatest(payRes);

    if (cpi) indicators.cpi = { ...cpi, label: "CPI (同比)", unit: "" };
    if (ppi) indicators.ppi = { ...ppi, label: "PPI (同比)", unit: "" };
    if (unrate) indicators.unemployment = { ...unrate, label: "失业率", unit: "%" };
    if (pay) indicators.nonfarm = { ...pay, label: "非农就业(月)", unit: "千人" };

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      ok: true,
      earnings,
      macroEvents: macroEvents.slice(0, 12),
      indicators,
      generatedAt: fmtDate(today),
      endDate: fmtDate(twoWeeks),
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message });
  }
}
