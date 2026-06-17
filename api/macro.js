import { FRED_KEY, FRED_BASE, setCORS } from "./_lib.js";

export default async function handler(req, res) {
  try {
    const [r10y, rFF] = await Promise.all([
      fetch(`${FRED_BASE}/series/observations?series_id=DGS10&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=5`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${FRED_BASE}/series/observations?series_id=FEDFUNDS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`, { signal: AbortSignal.timeout(10000) }),
    ]);
    const d10y = await r10y.json();
    const dFF = await rFF.json();
    const y10 = d10y.observations?.[0] || {};
    const ff = dFF.observations?.[0] || {};
    const y10prev = d10y.observations?.[4] || {};
    const chg = y10prev.value && y10.value
      ? ((parseFloat(y10.value) - parseFloat(y10prev.value)) * 100).toFixed(0) + "bp"
      : "N/A";
    setCORS(res);
    res.status(200).json({
      ok: true,
      yield10y: y10.value ? parseFloat(y10.value).toFixed(2) + "%" : "N/A",
      yield10yDate: y10.date || "",
      yield10yChg: chg + " (5\u65E5)",
      fedFunds: ff.value ? parseFloat(ff.value).toFixed(2) + "%" : "N/A",
      source: "FRED API"
    });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, yield10y: "N/A", fedFunds: "N/A", error: e.message, source: "FRED (\u5931\u8D25)" });
  }
}
