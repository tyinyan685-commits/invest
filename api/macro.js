export default async function handler(req, res) {
  const FRED_KEY = "07a98309feadf15506ac4004b1d66492";
  try {
    const [r10y, rFF] = await Promise.all([
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5`, { signal: AbortSignal.timeout(10000) }),
      fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`, { signal: AbortSignal.timeout(10000) }),
    ]);
    const d10y = await r10y.json();
    const dFF = await rFF.json();
    const y10 = d10y.observations?.[0] || {};
    const ff = dFF.observations?.[0] || {};
    const y10prev = d10y.observations?.[4] || {};
    const chg = y10prev.value && y10.value
      ? ((parseFloat(y10.value) - parseFloat(y10prev.value)) * 100).toFixed(0) + "bp"
      : "N/A";
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      ok: true,
      yield10y: y10.value ? parseFloat(y10.value).toFixed(2) + "%" : "N/A",
      yield10yDate: y10.date || "",
      yield10yChg: chg + " (5\u65E5)",
      fedFunds: ff.value ? parseFloat(ff.value).toFixed(2) + "%" : "N/A",
      source: "FRED API"
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, yield10y: "N/A", fedFunds: "N/A", error: e.message, source: "FRED (\u5931\u8D25)" });
  }
}
