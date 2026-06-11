export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol param" });
  try {
    const r = await fetch(
      `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(symbol)}.json`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) throw new Error("StockTwits " + r.status);
    const data = await r.json();
    const msgs = data.messages || [];
    const sym = data.symbol || {};
    let bullish = 0, bearish = 0;
    const recentPosts = [];
    for (const m of msgs) {
      const s = m.entities?.sentiment?.basic;
      if (s === "Bullish") bullish++;
      else if (s === "Bearish") bearish++;
      if (recentPosts.length < 8) recentPosts.push({
        body: (m.body || "").slice(0, 120),
        sentiment: s || "Neutral",
        time: (m.created_at || "").slice(0, 16)
      });
    }
    const total = msgs.length || 1;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({
      ok: true, count: msgs.length, watchlist: sym.watchlist_count || 0,
      bullish, bearish, neutral: total - bullish - bearish,
      bullPct: Math.round(bullish / total * 100),
      bearPct: Math.round(bearish / total * 100),
      direction: Math.round(bullish / total * 100) > 60 ? "\u504F\u591A" : Math.round(bearish / total * 100) > 60 ? "\u504F\u7A7A" : "\u4E2D\u6027",
      crowdedness: msgs.length > 25 ? "\u9AD8" : msgs.length > 15 ? "\u4E2D" : "\u4F4E",
      strength: msgs.length > 20 ? "\u4E2D" : "\u4F4E",
      recentPosts, source: "StockTwits \u516C\u5F00API"
    });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message, count: 0, bullish: 0, bearish: 0, bullPct: 0, bearPct: 0, watchlist: 0, recentPosts: [], source: "StockTwits (\u5931\u8D25)" });
  }
}
