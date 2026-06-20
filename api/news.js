import { FMP_KEY, FMP_BASE, fetchJSONArray, setCORS, validateSymbol } from "./_lib.js";

export default async function handler(req, res) {
  const symbol = String(req.query.symbol || "").trim().toUpperCase();
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err, articles: [], total: 0 });
  if (!FMP_KEY) return res.status(200).json({ ok: false, error: "FMP_API_KEY 未配置", articles: [], total: 0 });

  try {
    const rows = await fetchJSONArray(
      `${FMP_BASE}/news/stock?symbols=${encodeURIComponent(symbol)}&limit=10&apikey=${FMP_KEY}`
    );
    const articles = rows.slice(0, 8).map((article) => ({
      title: String(article.title || "").slice(0, 160),
      source: article.site || article.publisher || "FMP",
      date: String(article.publishedDate || article.date || "").slice(0, 10),
      url: article.url || null,
      symbol
    })).filter((article) => article.title && article.url);

    setCORS(res);
    return res.status(200).json({
      ok: articles.length > 0,
      total: articles.length,
      articles,
      source: "FMP stock news",
      queryPolicy: "按股票代码精确查询，不使用公司简称关键词扩展。"
    });
  } catch (error) {
    setCORS(res);
    return res.status(200).json({ ok: false, total: 0, articles: [], error: error.message, source: "FMP stock news (失败)" });
  }
}
