import { FMP_KEY, FMP_BASE, setCORS, validateSymbol } from "./_lib.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err });
  if (!FMP_KEY) return res.status(200).json({ ok: false, error: "FMP_API_KEY 未配置", bars: [], count: 0 });
  try {
    const r = await fetch(
      `${FMP_BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const raw = await r.text();

    if (raw.startsWith("Premium")) {
      return res.status(200).json({ ok: false, error: raw.slice(0, 200) });
    }

    const data = JSON.parse(raw);
    const bars = Array.isArray(data) ? data : (data?.historical || []);

    if (!Array.isArray(bars) || bars.length === 0) {
      return res.status(200).json({ ok: false, error: data?.["Error Message"] || "No historical data" });
    }

    const trimmed = bars.slice(0, 300).reverse();

    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-02`;
    let yearStartPrice = null;
    for (const bar of trimmed) {
      if (bar.date >= yearStart) { yearStartPrice = bar.close; break; }
    }
    if (!yearStartPrice) {
      for (const bar of bars) {
        if (bar.date >= yearStart) { yearStartPrice = bar.close; break; }
      }
    }

    const compactBars = trimmed.map(d => ({
      date: d.date, open: d.open, high: d.high, low: d.low, close: d.close, volume: d.volume,
    }));

    setCORS(res);
    res.status(200).json({
      ok: true, count: compactBars.length, bars: compactBars, yearStartPrice,
      source: "FMP historical-price-eod/full",
    });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, error: e.message });
  }
}
