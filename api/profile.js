import { FMP_KEY, FMP_BASE, setCORS, validateSymbol } from "./_lib.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err });
  if (!FMP_KEY) return res.status(200).json({ ok: false, error: "FMP_API_KEY 未配置 (请在 Vercel 环境变量中设置)" });
  try {
    let data = null, source = null;
    try {
      const r = await fetch(`${FMP_BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (Array.isArray(d) && d[0]) { data = d[0]; source = "profile"; }
    } catch (e) { /* try quote */ }
    if (!data) {
      try {
        const r = await fetch(`${FMP_BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (Array.isArray(d) && d[0]) { data = d[0]; source = "quote"; }
      } catch (e) { /* fail */ }
    }
    if (!data) {
      return res.status(200).json({ ok: false, error: "No profile data" });
    }
    setCORS(res);
    res.status(200).json({ ok: true, profile: data, source });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, error: e.message });
  }
}
