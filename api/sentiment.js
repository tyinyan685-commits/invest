import { setCORS, validateSymbol } from "./_lib.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err });
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
    const labeled = bullish + bearish;
    const bullPct = labeled ? Math.round(bullish / labeled * 100) : 50;
    const bearPct = labeled ? 100 - bullPct : 50;
    setCORS(res);
    res.status(200).json({
      ok: true, count: msgs.length, watchlist: sym.watchlist_count || 0,
      bullish, bearish, neutral: msgs.length - labeled, labeledCount: labeled,
      bullPct,
      bearPct,
      direction: labeled < 20 ? "\u4E2D\u6027(\u6837\u672C\u4E0D\u8DB3)" : bullPct > 60 ? "\u504F\u591A" : bullPct < 40 ? "\u504F\u7A7A" : "\u4E2D\u6027",
      crowdedness: msgs.length > 25 ? "\u9AD8" : msgs.length > 15 ? "\u4E2D" : "\u4F4E",
      strength: labeled >= 30 ? "\u9AD8" : labeled >= 20 ? "\u4E2D" : labeled >= 10 ? "\u4F4E-\u4E2D" : "\u4F4E",
      recentPosts, source: "StockTwits labeled messages", samplePolicy: "\u4EC5\u6709\u660E\u786E Bullish/Bearish \u6807\u7B7E\u7684\u5E16\u5B50\u8FDB\u5165\u6BD4\u4F8B\uFF1B\u5C11\u4E8E20\u6761\u65F6\u6309\u4E2D\u602750\u5904\u7406\u3002"
    });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, error: e.message, count: 0, labeledCount: 0, bullish: 0, bearish: 0, bullPct: 50, bearPct: 50, watchlist: 0, recentPosts: [], source: "StockTwits (\u5931\u8D25)" });
  }
}
