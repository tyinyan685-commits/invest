export default async function handler(req, res) {
  const { symbol } = req.query;
  if (!symbol) return res.status(400).json({ ok: false, error: "Missing symbol" });
  const KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
  const BASE = "https://financialmodelingprep.com/stable";
  try {
    // Try profile first, fallback to quote
    let data = null, source = null;
    try {
      const r = await fetch(`${BASE}/profile?symbol=${encodeURIComponent(symbol)}&apikey=${KEY}`, { signal: AbortSignal.timeout(12000) });
      const d = await r.json();
      if (Array.isArray(d) && d[0]) { data = d[0]; source = "profile"; }
    } catch (e) { /* try quote */ }
    if (!data) {
      try {
        const r = await fetch(`${BASE}/quote?symbol=${encodeURIComponent(symbol)}&apikey=${KEY}`, { signal: AbortSignal.timeout(12000) });
        const d = await r.json();
        if (Array.isArray(d) && d[0]) { data = d[0]; source = "quote"; }
      } catch (e) { /* fail */ }
    }
    if (!data) {
      return res.status(200).json({ ok: false, error: "No profile data" });
    }
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: true, profile: data, source });
  } catch (e) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.status(200).json({ ok: false, error: e.message });
  }
}
