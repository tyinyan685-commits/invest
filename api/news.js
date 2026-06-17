import { NEWSAPI_KEY, setCORS } from "./_lib.js";

export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ ok: false, error: "Missing q param" });
  if (q.length > 100) return res.status(400).json({ ok: false, error: "Query too long" });
  try {
    const r = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=${NEWSAPI_KEY}`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!r.ok) throw new Error("NewsAPI " + r.status);
    const data = await r.json();
    const articles = (data.articles || []).slice(0, 8).map(a => ({
      title: (a.title || "").slice(0, 100),
      source: a.source?.name || "?",
      date: (a.publishedAt || "").slice(0, 10),
      url: a.url || "#"
    }));
    setCORS(res);
    res.status(200).json({ ok: true, total: data.totalResults || 0, articles, source: "NewsAPI.org" });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, total: 0, articles: [], error: e.message, source: "NewsAPI (失败)" });
  }
}
