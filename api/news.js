export default async function handler(req, res) {
  const { q } = req.query;
  if (!q) return res.status(400).json({ ok: false, error: "Missing q param" });
  try {
    const r = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=10&language=en&apiKey=6150d75a436e482aa42d48e7d0c8a765`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await r.json();
    const articles = (data.articles || []).slice(0, 8).map(a => ({
      title: (a.title || "").slice(0, 100),
      source: a.source?.name || "?",
      date: (a.publishedAt || "").slice(0, 10),
      url: a.url || "#"
    }));
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: true, total: data.totalResults || 0, articles, source: "NewsAPI.org" });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, total: 0, articles: [], error: e.message, source: "NewsAPI (失败)" });
  }
}
