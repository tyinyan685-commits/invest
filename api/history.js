export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
  const KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
  const BASE = "https://financialmodelingprep.com/stable";
  try {
    const r = await fetch(
      `${BASE}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${KEY}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const raw = await r.text();

    // Check for premium/error responses
    // Valid data: JSON array [{...}, ...] → starts with "["
    // Invalid symbol: [] → handled by length check
    // Premium symbol: "Premium Query Parameter: ..." → plain text
    // API error: {"Error Message": "..."} → JSON object starts with "{"
    if (raw.startsWith("Premium")) {
      return res.status(200).json({ ok: false, error: raw.slice(0, 200) });
    }

    const data = JSON.parse(raw);

    // Handle wrapped responses (e.g., {"historical": [...]}) or error objects
    const bars = Array.isArray(data) ? data : (data?.historical || []);

    if (!Array.isArray(bars) || bars.length === 0) {
      return res.status(200).json({ ok: false, error: data?.["Error Message"] || "No historical data" });
    }

    // Data comes newest-first, reverse to oldest-first for charting
    // Keep last 300 trading days (enough for SMA200 + buffer + chart)
    const trimmed = bars.slice(0, 300).reverse();

    // Find year-start price for YTD calculation
    const now = new Date();
    const yearStart = `${now.getFullYear()}-01-02`;
    // Data is now oldest-first; find the first trading day of this year
    let yearStartPrice = null;
    for (const bar of trimmed) {
      if (bar.date >= yearStart) {
        yearStartPrice = bar.close;
        break;
      }
    }
    // If not in trimmed data, check full dataset
    if (!yearStartPrice) {
      for (const bar of bars) {
        if (bar.date >= yearStart) {
          yearStartPrice = bar.close;
          break;
        }
      }
    }

    // Compact format: only fields we need
    const compactBars = trimmed.map(d => ({
      date: d.date,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    }));

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      ok: true,
      count: compactBars.length,
      bars: compactBars,
      yearStartPrice,
      source: "FMP historical-price-eod/full",
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message });
  }
}
