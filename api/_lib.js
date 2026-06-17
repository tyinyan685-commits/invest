// Shared configuration and helpers for Vercel serverless functions
// All API keys should eventually be moved to process.env (Vercel environment variables)

const FMP_KEY = process.env.FMP_API_KEY || "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";
const FRED_KEY = process.env.FRED_API_KEY || "07a98309feadf15506ac4004b1d66492";
const NEWSAPI_KEY = process.env.NEWSAPI_KEY || "6150d75a436e482aa42d48e7d0c8a765";

const FMP_BASE = "https://financialmodelingprep.com/stable";
const FRED_BASE = "https://api.stlouisfed.org/fred";

// Fetch JSON with timeout, returns null on failure (for optional data)
const fetchJSON = (url, timeoutMs = 12000) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(() => null);

// Fetch JSON array with timeout, returns [] on failure (for list endpoints)
const fetchJSONArray = (url, timeoutMs = 12000) =>
  fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .catch(() => []);

// Standard CORS headers
const setCORS = (res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
};

// Validate symbol parameter
const validateSymbol = (symbol) => {
  if (!symbol) return "Missing symbol";
  if (symbol.length > 20) return "Symbol too long";
  if (!/^[A-Z0-9.=\-]+$/i.test(symbol)) return "Invalid symbol format";
  return null;
};

export { FMP_KEY, FRED_KEY, NEWSAPI_KEY, FMP_BASE, FRED_BASE, fetchJSON, fetchJSONArray, setCORS, validateSymbol };
