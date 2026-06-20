import { useState, useMemo, useCallback, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, BarChart, Bar, Cell,
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area, ComposedChart
} from "recharts";

// ═══════════════════ THEME & CONSTANTS ═══════════════════
const T = {
  bg: "#0f172a", card: "#1e293b", cardAlt: "#283548",
  border: "#334155", text: "#e2e8f0", muted: "#94a3b8", dim: "#64748b",
  green: "#22c55e", red: "#ef4444", yellow: "#eab308",
  blue: "#3b82f6", purple: "#a855f7", orange: "#f97316", cyan: "#06b6d4",
  lime: "#84cc16",
};

// ═══════════════════ MATH HELPERS ═══════════════════
const sma = (arr, p) => {
  const r = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < p - 1) { r.push(null); continue; }
    let s = 0; for (let j = i - p + 1; j <= i; j++) s += arr[j];
    r.push(+(s / p).toFixed(2));
  }
  return r;
};
const ema = (arr, p) => {
  const k = 2 / (p + 1), r = [arr[0]];
  for (let i = 1; i < arr.length; i++) r.push(+(arr[i] * k + r[i - 1] * (1 - k)).toFixed(2));
  return r;
};
const calcRSI = (closes, p = 14) => {
  const gains = [], losses = [];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    gains.push(Math.max(d, 0)); losses.push(Math.max(-d, 0));
  }
  const rsis = new Array(closes.length).fill(null);
  for (let i = p - 1; i < gains.length; i++) {
    const ag = gains.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
    const al = losses.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
    rsis[i + 1] = al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(1);
  }
  return rsis;
};
const calcMACD = (closes) => {
  const e12 = ema(closes, 12), e26 = ema(closes, 26);
  const line = e12.map((v, i) => +(v - e26[i]).toFixed(3));
  const sigLine = ema(line.slice(25), 9);
  const sig = Array(25).fill(null).concat(sigLine);
  return { line, signal: sig, hist: line.map((v, i) => sig[i] != null ? +(v - sig[i]).toFixed(3) : 0) };
};
const calcATR = (data, p = 14) => {
  const tr = data.map((d, i) =>
    i === 0 ? d.high - d.low : Math.max(d.high - d.low, Math.abs(d.high - data[i - 1].close), Math.abs(d.low - data[i - 1].close))
  );
  const r = []; for (let i = 0; i < tr.length; i++) {
    if (i < p) { r.push(null); continue; }
    r.push(+(tr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p).toFixed(2));
  }
  return r;
};
const fmt = (n) => {
  if (n == null || isNaN(n)) return "-";
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + "T";
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return n.toFixed(0);
};
const pct = (n) => { if (n == null || isNaN(n)) return "N/A"; return (n >= 0 ? "+" : "") + n.toFixed(1) + "%"; };
const safeNum = (v, fallback = 0) => (v != null && !isNaN(v) && isFinite(v)) ? v : fallback;
const naOr = (v, fmtFn) => (v != null && v !== 0) ? fmtFn(v) : "N/A";

// ═══════════════════ SCORING HELPERS ═══════════════════
const calcFundScore = (fin) => {
  if (!fin || fin.fwdPE == null) return null;
  let s = 50;
  if (fin.fwdPE < 20) s += 15; else if (fin.fwdPE < 30) s += 5; else s -= 10;
  if (fin.revG > 30) s += 15; else if (fin.revG > 10) s += 8; else s -= 5;
  if (fin.niG > 30) s += 10; else if (fin.niG > 0) s += 5; else s -= 10;
  if (fin.roe > 25) s += 10; else if (fin.roe > 15) s += 5;
  if (fin.gm > 50) s += 5;
  return Math.min(100, Math.max(0, s));
};
const calcCompositeScore = (fundScore, techScore, sentBuzz = 50) => {
  let s = 50;
  if (fundScore != null) s += (fundScore - 50) * 0.45;
  s += (techScore - 50) * 0.40;
  s += (sentBuzz - 50) * 0.15;
  return Math.round(Math.min(100, Math.max(0, s)));
};
const scoreToRating = (sc) => sc >= 70 ? "买入" : sc >= 55 ? "持有" : sc >= 40 ? "观望" : "回避";
const scoreToSub = (sc) => sc >= 70 ? "Accumulate" : sc >= 55 ? "Hold" : sc >= 40 ? "Neutral" : "Avoid";

// ═══════════════════ EXTERNAL API SERVICES (via Vercel proxy) ═══════════════════
// All external API calls go through serverless proxy to avoid CORS and protect API keys

const safeJson = async (r) => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const fetchSentiment = async (symbol) => {
  try {
    const r = await fetch(`/api/sentiment?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message, count: 0, labeledCount: 0, bullish: 0, bearish: 0, bullPct: 50, bearPct: 50, watchlist: 0, recentPosts: [], source: "StockTwits (失败)" }; }
};

const fetchMacro = async () => {
  try {
    const r = await fetch(`/api/macro`, { signal: AbortSignal.timeout(12000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, yield10y: "N/A", fedFunds: "N/A", error: e.message, source: "FRED (失败)" }; }
};

const fetchNews = async (symbol) => {
  try {
    const r = await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, total: 0, articles: [], error: e.message, source: "NewsAPI (失败)" }; }
};

const fetchFinancials = async (symbol) => {
  try {
    const r = await fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message, source: "FMP financials (失败)" }; }
};

const fetchProfile = async (symbol) => {
  try {
    const r = await fetch(`/api/profile?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(15000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message }; }
};

const fetchHistory = async (symbol) => {
  try {
    const r = await fetch(`/api/history?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(20000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message, bars: [], yearStartPrice: null }; }
};

const fetchEvents = async (symbol) => {
  try {
    const r = await fetch(`/api/events?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message, earnings: null, macroEvents: [], indicators: {} }; }
};

const fetchRating = async (symbol) => {
  try {
    const r = await fetch(`/api/rating?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(20000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message }; }
};

// Futu OpenD bridge - local proxy for real options IV data
const FUTU_BRIDGE = "http://localhost:9876";
const fetchIV = async (symbol, price) => {
  const isLocal = typeof window !== "undefined" && ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (!isLocal) return { ok: false, skipped: true, error: "Futu bridge is local-only" };
  try {
    const r = await fetch(`${FUTU_BRIDGE}/api/option-volatility?symbol=${encodeURIComponent(symbol)}&price=${price}`, { signal: AbortSignal.timeout(8000) });
    return await safeJson(r);
  } catch (e) { return { ok: false, error: e.message }; }
};

// ═══════════════════ FMP PROFILE → ANALYSIS FORMAT ═══════════════════
const mergeLiveWithPreset = (ticker, prof) => {
  const p = prof;
  const cur = p.currency === "HKD" ? "HK$" : (p.currency === "CNY" ? "CN¥" : "$");
  const market = (p.exchange?.includes("HK") || p.exchangeFullName?.includes("Hong")) ? "HK" : "US";
  const price = safeNum(p.price, null);

  // Parse 52-week range from profile ("140.1-339.8")
  const rangeParts = (p.range || "").split("-").map(Number);
  const high52 = rangeParts.length === 2 && rangeParts[1] > 0 ? rangeParts[1] : null;
  const low52 = rangeParts.length === 2 && rangeParts[0] > 0 ? rangeParts[0] : null;

  // YTD — will be computed from real history in doAnalyze; null means unknown
  const chgPct = safeNum(p.changePercentage, null);
  const ytd = null;

  // Volatility estimate from beta
  const vol = null;

  // Dividend yield
  const divY = safeNum(p.lastDividend, null) > 0 && price > 0 ? (safeNum(p.lastDividend) / price * 100) : null;

  const fin = {
    pe: null, fwdPE: null, pb: null, rev: null, revG: null, ni: null, niG: null,
    cash: null, ocf: null, gm: null, nm: null, roe: null, overR: null,
    divY: divY === null ? null : +divY.toFixed(2), da: null,
    finAvailable: false,
  };

  const risks = [
    { t: "市场波动风险", d: "市场整体波动可能影响个股表现", l: "低-中" },
    { t: "宏观环境不确定", d: "需关注宏观经济和行业政策变化", l: "中" },
    { t: "流动性风险", d: "成交量变化可能影响买卖时机", l: "低" },
  ];
  const bulls = [
    { t: "实时行情跟踪", d: `当前价 ${cur}${price}${high52 && low52 ? `，52周区间 ${cur}${low52.toFixed(1)}-${cur}${high52.toFixed(1)}` : ""}` },
    { t: "市值与行业", d: `${p.companyName || ticker}，${p.sector || ""} / ${p.industry || ""}` },
    { t: "基本面关注", d: `日均成交量 ${fmt(safeNum(p.averageVolume, 0))}，市场关注度${safeNum(p.averageVolume, 0) > 1e7 ? "较高" : "中等"}` },
  ];
  const verdict = `${p.companyName || ticker} 当前价 ${cur}${price}。结论仅在真实财务、历史行情和统一评级返回后生成。`;
  const score = 50;
  const rating = scoreToRating(score);
  const sub = scoreToSub(score);

  return {
    name: p.companyName || ticker, market, price, cur,
    high52, low52, ytd, vol, fin,
    prices: null,
    peers: [],
    risks: risks.slice(0, 3), bulls: bulls.slice(0, 3), verdict,
    rating, sub, score,
    sent: { reddit: null, stocktwits: null, trend: null, buzz: 50, rating: "中性" },
    cat: `${p.sector || ""} / ${p.industry || ""}`,
    liveData: { // extra live data from API for display
      volume: p.volume, avgVolume: p.averageVolume, marketCap: p.marketCap,
      beta: p.beta, change: p.change, chgPct, description: p.description,
    },
  };
};

const QUICK_PICKS = {
  "9992.HK": "泡泡玛特",
  AAPL: "Apple",
  TSLA: "Tesla",
  NVDA: "NVIDIA",
  "0700.HK": "腾讯"
};

// Historical reference only. Production analysis never reads these values.
const UNUSED_LEGACY_PRESETS_DO_NOT_USE = {
  "9992.HK": {
    name: "泡泡玛特 Pop Mart", market: "HK", price: 170.5, cur: "HK$",
    high52: 339.8, ytd: -10.6, vol: 0.035,
    fin: { pe: 12.2, fwdPE: 11.8, pb: 5.6, rev: 37.12e9, revG: 106.9, ni: 13.78e9, niG: 284.5, cash: 13.78e9, ocf: 16.5e9, gm: 66.8, nm: 37.1, roe: 48.5, overR: 43.8, divY: 0.8, da: 0 },
    peers: [{ n: "MINISO", pe: 29, pb: 8.2 }, { n: "乐高(非上市)", pe: 35, pb: 12 }, { n: "行业均值", pe: 35, pb: 9.5 }],
    risks: [
      { t: "单一IP依赖", d: "Labubu占收入38.1%，热度趋势Trends 66→6，二手价格-50%", l: "高" },
      { t: "H1增速验证", d: "市场共识H1增速15%，MS 13%/DB -2%，需8月中报确认", l: "中" },
      { t: "估值回调", d: "距52周高-50%，若增速不及预期，PE可能进一步压缩", l: "中" },
    ],
    bulls: [
      { t: "估值折价显著", d: "Forward PE~12x vs MINISO 29x/行业35x，存在估值修复空间" },
      { t: "海外第二曲线", d: "海外收入占比31.8%→43.8%，美国市场+748%爆发式增长" },
      { t: "技术面反弹信号", d: "50SMA/10EMA支撑，MACD金叉，RSI>55，上行动能确认" },
    ],
    verdict: "多空胜负手在于2026增速能否守住公司'>20%'指引。下行有净现金+低估值底，上行需业绩确认，故'买但不追、分批留弹'。",
    rating: "买入", sub: "分批低吸 (Accumulate, 偏谨慎)", score: 70,
    sent: { reddit: 28, stocktwits: 15, trend: 45, buzz: 66, rating: "低-中" },
    cat: "潮玩/消费",
  },
  AAPL: {
    name: "Apple Inc.", market: "US", price: 192.5, cur: "$",
    high52: 237.5, ytd: -5.2, vol: 0.018,
    fin: { pe: 29.5, fwdPE: 27.8, pb: 45.2, rev: 383.3e9, revG: 2.0, ni: 93.7e9, niG: -2.8, cash: 55.2e9, ocf: 110.5e9, gm: 46.2, nm: 24.4, roe: 156, overR: 64.5, divY: 0.52, da: 12.5e9 },
    peers: [{ n: "MSFT", pe: 33, pb: 11.5 }, { n: "GOOGL", pe: 25, pb: 6.8 }, { n: "行业均值", pe: 30, pb: 8.2 }],
    risks: [
      { t: "iPhone周期见顶", d: "智能手机市场饱和，换机周期延长至4年以上", l: "中" },
      { t: "中国市场风险", d: "地缘政治+华为竞争，中国区收入占比约19%", l: "中-高" },
      { t: "AI落后焦虑", d: "Apple Intelligence进展慢于预期，vs OpenAI/Google竞争", l: "中" },
    ],
    bulls: [
      { t: "服务收入高增长", d: "服务业务毛利率>70%，收入占比持续提升，贡献估值溢价" },
      { t: "强劲回购支撑", d: "年回购超$90B，流通股持续缩减，EPS增速优于营收" },
      { t: "生态护城河", d: "全球22亿活跃设备，用户粘性极强，ARPU持续提升" },
    ],
    verdict: "成熟期巨头，增长放缓但现金流无敌。AI战略若兑现可打开新空间，当前估值合理偏贵，适合长期持有而非追涨。",
    rating: "持有", sub: "Hold (估值中性, 等待AI催化)", score: 55,
    sent: { reddit: 82, stocktwits: 78, trend: 55, buzz: 70, rating: "高" },
    cat: "科技/消费电子",
  },
  TSLA: {
    name: "Tesla Inc.", market: "US", price: 252, cur: "$",
    high52: 299.3, ytd: -16.8, vol: 0.038,
    fin: { pe: 68, fwdPE: 55, pb: 14.5, rev: 96.8e9, revG: 3.1, ni: 12.0e9, niG: -8.5, cash: 26.9e9, ocf: 13.3e9, gm: 18.2, nm: 12.4, roe: 21.3, overR: 42.0, divY: 0, da: 4.9e9 },
    peers: [{ n: "BYD", pe: 22, pb: 5.1 }, { n: "RIVN", pe: -15, pb: 2.8 }, { n: "行业均值", pe: 18, pb: 3.5 }],
    risks: [
      { t: "毛利率持续下行", d: "价格战压力，汽车毛利率从28%降至17%附近", l: "高" },
      { t: "FSD/Robotaxi证伪", d: "自动驾驶商业化进度不及预期，监管风险", l: "高" },
      { t: "品牌形象受损", d: "CEO争议+政治参与，欧洲/中国市场份额下滑", l: "中" },
    ],
    bulls: [
      { t: "能源业务爆发", d: "Megapack/储能业务增速>100%，成为第二增长极" },
      { t: "FSD技术领先", d: "端到端自动驾驶若商业化成功，估值天花板极高" },
      { t: "全球产能释放", d: "墨西哥/印度工厂推进，产能利用率提升空间大" },
    ],
    verdict: "高估值+高波动的成长博弈标的。核心看FSD和能源业务能否接棒汽车增长。不适合价值投资者，适合有高风险偏好的趋势交易者。",
    rating: "观望", sub: "Neutral (高波动, 等待方向确认)", score: 42,
    sent: { reddit: 90, stocktwits: 95, trend: 72, buzz: 88, rating: "极高" },
    cat: "新能源汽车/科技",
  },
  NVDA: {
    name: "NVIDIA Corp.", market: "US", price: 135.5, cur: "$",
    high52: 153.1, ytd: 1.2, vol: 0.032,
    fin: { pe: 55, fwdPE: 35, pb: 52, rev: 130.5e9, revG: 114.2, ni: 72.9e9, niG: 144.8, cash: 26.0e9, ocf: 64.2e9, gm: 75.2, nm: 55.9, roe: 119, overR: 53.0, divY: 0.03, da: 5.2e9 },
    peers: [{ n: "AMD", pe: 45, pb: 4.2 }, { n: "AVGO", pe: 32, pb: 14.5 }, { n: "行业均值", pe: 38, pb: 8.5 }],
    risks: [
      { t: "AI投资周期见顶", d: "客户资本开支增速放缓，GPU需求可能阶段性回调", l: "中-高" },
      { t: "竞争加剧", d: "AMD MI300/自研芯片(TPU)蚕食份额，定价权削弱", l: "中" },
      { t: "出口管制", d: "对华AI芯片出口限制升级，影响约10-15%收入", l: "中" },
    ],
    bulls: [
      { t: "数据中心垄断地位", d: "AI训练GPU市占率>80%，CUDA生态壁垒极深" },
      { t: "收入加速增长", d: "连续4季度收入超预期，Blackwell架构驱动新一轮周期" },
      { t: "估值已回落", d: "Forward PE从60x回落至35x，增速匹配后PEG<0.5" },
    ],
    verdict: "AI基础设施绝对龙头，短期估值消化后性价比提升。核心跟踪：数据中心收入增速+Blackwell出货节奏。逢回调分批建仓优于一把梭。",
    rating: "买入", sub: "Accumulate (回调买入, 长期持有)", score: 75,
    sent: { reddit: 88, stocktwits: 85, trend: 80, buzz: 82, rating: "极高" },
    cat: "半导体/AI",
  },
  "0700.HK": {
    name: "腾讯控股 Tencent", market: "HK", price: 425, cur: "HK$",
    high52: 482, ytd: 12.5, vol: 0.022,
    fin: { pe: 20.5, fwdPE: 17.2, pb: 5.8, rev: 660.3e9, revG: 9.8, ni: 195.8e9, niG: 68.2, cash: 240e9, ocf: 280e9, gm: 53.5, nm: 29.6, roe: 25.8, overR: 32.5, divY: 0.8, da: 18e9 },
    peers: [{ n: "阿里", pe: 12, pb: 1.8 }, { n: "美团", pe: 28, pb: 5.2 }, { n: "行业均值", pe: 22, pb: 4.5 }],
    risks: [
      { t: "游戏监管政策", d: "未成年人保护+版号发放节奏不确定", l: "中" },
      { t: "广告收入波动", d: "宏观经济下行压力影响广告主预算", l: "低-中" },
      { t: "投资减值风险", d: "联营公司投资组合存在减值可能", l: "低" },
    ],
    bulls: [
      { t: "视频号商业化", d: "视频号广告+电商变现刚起步，空间巨大" },
      { t: "AI大模型赋能", d: "混元大模型落地微信生态，提升用户时长和变现" },
      { t: "回购+分红提升", d: "年回购超千亿港元，股东回报率持续提升" },
    ],
    verdict: "中国互联网核心资产，估值合理偏低。游戏+广告+金融科技三大引擎稳健，视频号和AI是增量看点。适合中长线配置。",
    rating: "买入", sub: "Buy (估值修复+增长确认)", score: 72,
    sent: { reddit: 45, stocktwits: 35, trend: 50, buzz: 55, rating: "中" },
    cat: "互联网/科技",
  },
};

// ═══════════════════ ANALYSIS ENGINE ═══════════════════
function runAnalysis(ticker, stockData, dataSource) {
  const p = stockData;
  const hasHistory = p.prices && p.prices.length >= 50;
  if (!hasHistory) throw new Error("真实历史K线不足50条，已停止技术分析，未使用模拟数据。请稍后重试或更换标的。");
  const prices = p.prices;
  const closes = prices.map(d => d.close);

  // Moving averages
  const sma20 = sma(closes, 20), sma50 = sma(closes, 50);
  const sma200arr = sma(closes, 200); // compute real SMA200
  const ema10 = ema(closes, 10), ema20 = ema(closes, 20);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const atr = calcATR(prices, 14);
  const curATR = atr.filter(v => v != null).pop();
  const curRSI = rsi.filter(v => v !== null).pop() || 50;
  const curSMA20 = sma20.filter(v => v !== null).pop();
  const curSMA50 = sma50.filter(v => v !== null).pop();
  // Real SMA200 — use actual 200-day average if enough data, else use all available
  const curSMA200 = sma200arr.filter(v => v !== null).pop() || null;

  const curMACD = macd.line[macd.line.length - 1];
  const curSignal = macd.signal[macd.signal.length - 1];
  const macdHist = macd.hist[macd.hist.length - 1];
  const avgVol = prices.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;

  // If real history data, compute real 52-week high/low from actual prices
  let realHigh52 = p.high52, realLow52 = p.low52;
  if (hasHistory && prices.length >= 100) {
    const last252 = prices.slice(-Math.min(252, prices.length));
    realHigh52 = Math.max(...last252.map(d => d.high));
    realLow52 = Math.min(...last252.map(d => d.low));
  }

  // Bollinger Bands (20-day, 2 std dev)
  const bbLen = 20;
  let bollMid = curSMA20, bollUpper = null, bollLower = null;
  if (closes.length >= bbLen) {
    const bbSlice = closes.slice(-bbLen);
    const bbMean = bbSlice.reduce((a, b) => a + b, 0) / bbLen;
    const bbStd = Math.sqrt(bbSlice.reduce((s, v) => s + (v - bbMean) ** 2, 0) / bbLen);
    bollMid = +bbMean.toFixed(2);
    bollUpper = +(bbMean + 2 * bbStd).toFixed(2);
    bollLower = +(bbMean - 2 * bbStd).toFixed(2);
  }

  // VWMA (20-day Volume Weighted Moving Average) — confirms trend with volume
  let vwma = null;
  if (closes.length >= 20) {
    const rp = closes.slice(-20);
    const rv = prices.slice(-20).map(d => d.volume || 0);
    const tv = rv.reduce((a, b) => a + b, 0);
    if (tv > 0) vwma = +(rp.reduce((s, p, i) => s + p * rv[i], 0) / tv).toFixed(2);
  }

  // Chart data — show last 80 bars (or all if less)
  const chartLen = Math.min(80, prices.length);
  const chartData = prices.slice(-chartLen).map((d, i) => {
    const idx = prices.length - chartLen + i;
    return {
      date: d.date, close: d.close, volume: d.volume,
      sma20: sma20[idx], sma50: sma50[idx], ema10: ema10[idx],
      rsi: rsi[idx], macd: macd.line[idx], signal: macd.signal[idx], hist: macd.hist[idx],
    };
  });

  const signals = [];
  if (curRSI > 70) signals.push({ name: "RSI", val: curRSI, sig: "超买", color: T.red });
  else if (curRSI > 55) signals.push({ name: "RSI", val: curRSI, sig: "偏多", color: T.green });
  else if (curRSI < 30) signals.push({ name: "RSI", val: curRSI, sig: "超卖", color: T.green });
  else signals.push({ name: "RSI", val: curRSI, sig: "中性", color: T.yellow });
  signals.push({ name: "MACD", val: curMACD > 0 ? "+" : "-", sig: curMACD > curSignal ? "金叉(多)" : "死叉(空)", color: curMACD > curSignal ? T.green : T.red });
  if (curSMA20) signals.push({ name: "vs SMA20", val: closes[closes.length - 1] > curSMA20 ? "上方" : "下方", sig: closes[closes.length - 1] > curSMA20 ? "短期趋势向上" : "短期趋势向下", color: closes[closes.length - 1] > curSMA20 ? T.green : T.red });
  if (curSMA50) signals.push({ name: "vs SMA50", val: closes[closes.length - 1] > curSMA50 ? "上方" : "下方", sig: closes[closes.length - 1] > curSMA50 ? "中期趋势向上" : "中期趋势向下", color: closes[closes.length - 1] > curSMA50 ? T.green : T.red });
  // Add SMA200 signal if available
  if (closes.length >= 200) {
    signals.push({ name: "vs SMA200", val: closes[closes.length - 1] > curSMA200 ? "上方" : "下方", sig: closes[closes.length - 1] > curSMA200 ? "长期趋势向上" : "长期趋势向下", color: closes[closes.length - 1] > curSMA200 ? T.green : T.red });
  }
  // Add Bollinger Band signal
  if (bollUpper && bollLower) {
    const curPrice = closes[closes.length - 1];
    if (curPrice > bollUpper) signals.push({ name: "Boll", val: "上轨上方", sig: "超买区间", color: T.red });
    else if (curPrice < bollLower) signals.push({ name: "Boll", val: "下轨下方", sig: "超卖区间", color: T.green });
    else signals.push({ name: "Boll", val: `${bollLower}-${bollUpper}`, sig: "区间内运行", color: T.yellow });
  }
  // Add VWMA signal (volume-price trend confirmation)
  if (vwma) {
    const curPrice = closes[closes.length - 1];
    const aboveVwma = curPrice > vwma;
    signals.push({ name: "VWMA", val: vwma.toFixed(1), sig: aboveVwma ? "量价确认多头" : "量价背离(弱)", color: aboveVwma ? T.green : T.yellow });
  }

  // Use real 52-week high/low from historical data if available
  const high52 = realHigh52 || p.high52;
  const low52 = realLow52 || p.low52;
  const priceVs52h = high52 ? ((p.price - high52) / high52 * 100) : -20;
  const priceVsSMA200 = curSMA200 ? ((p.price - curSMA200) / curSMA200 * 100) : 0;

  const f = p.fin;
  const hasFinData = f.fwdPE != null;
  const fundScore = calcFundScore(f);

  let techScore = 50;
  if (curRSI > 50 && curRSI < 70) techScore += 10; else if (curRSI > 70) techScore -= 5; else if (curRSI < 30) techScore += 10;
  if (curMACD > curSignal) techScore += 15; else techScore -= 10;
  if (p.price > curSMA20) techScore += 10; else techScore -= 5;
  if (p.price > curSMA50) techScore += 10; else techScore -= 5;
  techScore = Math.min(100, Math.max(0, techScore));

  const posTarget = 1.0;
  const atrPct = (curATR / p.price * 100);
  const overAlloc = atrPct > 4 ? "高ATR，不超配" : atrPct > 2.5 ? "中ATR，标准配" : "低ATR，可超配";
  // Precise price zones for position entries
  const curPrice = p.price;
  const sma50Val = curSMA50 || curPrice;
  const ema10Val = ema10[ema10.length - 1] || curPrice;
  const entryZone = { lo: +(curPrice * 0.99).toFixed(2), hi: +(curPrice * 1.01).toFixed(2) };
  const sma50Zone = { lo: +(sma50Val * 0.98).toFixed(2), hi: +(sma50Val * 1.00).toFixed(2) };
  const deepZone = { lo: +(sma50Val * 0.85).toFixed(2), hi: +(sma50Val * 0.90).toFixed(2) };
  const weeklyStop = +(sma50Val * 0.85).toFixed(2);
  const entries = [
    { label: "首批", size: 0.40, priceZone: `${p.cur}${entryZone.lo}-${entryZone.hi}`, cond: `当前价附近 (${p.cur}${entryZone.lo}~${entryZone.hi}) 或回踩 SMA50 (${p.cur}${sma50Zone.lo}~${sma50Zone.hi})`, level: "current" },
    { label: "加码A", size: 0.25, priceZone: `EMA10 ${p.cur}${ema10Val.toFixed(2)}`, cond: `站稳 EMA10 (${p.cur}${ema10Val.toFixed(2)})，MACD 金叉确认 + 成交量 > ${fmt(avgVol)}`, level: "ema10" },
    { label: "加码B", size: 0.20, priceZone: `${p.cur}${deepZone.lo}-${deepZone.hi}`, cond: `深度回调至 SMA50×0.85~0.90 (${p.cur}${deepZone.lo}~${deepZone.hi})，强支撑位补仓`, level: "deep" },
    { label: "储备", size: 0.15, priceZone: "待定", cond: "保留至下一财报季，验证 EPS 增速趋势后再部署", level: "reserve" },
  ];
  const triggers = [
    { cond: `日线收盘跌破 SMA50 (${p.cur}${sma50Val.toFixed(2)}) 且缩量 < ${fmt(avgVol * 0.7)}`, action: "减半仓至 0.50，暂停所有加码计划", severity: "warn" },
    { cond: `周线收盘跌破 ${p.cur}${weeklyStop} (SMA50×0.85)`, action: "减仓至 ≤0.25 或清仓止损", severity: "critical" },
    { cond: `触及情景止损位 ${p.cur}${(sma50Val * 0.85).toFixed(2)}`, action: "执行硬止损，不等反弹", severity: "critical" },
    { cond: "下一财报 EPS 同比增速 < 10% 或营收 miss", action: "降级至减持(Underweight)，待增速恢复后重新评估", severity: "warn" },
    { cond: `站上 SMA200 (${curSMA200 ? p.cur + curSMA200.toFixed(2) : "待确认"}) 且 RSI > 55`, action: "升级至增持(Overweight)，首批仓位可加至 0.50", severity: "good" },
  ];
  const radarData = [
    { dim: "估值", val: hasFinData ? (f.fwdPE < 20 ? 85 : f.fwdPE < 30 ? 60 : 35) : 0, na: !hasFinData },
    { dim: "成长", val: hasFinData ? Math.min(100, Math.max(20, f.revG * 0.8)) : 0, na: !hasFinData },
    { dim: "盈利", val: hasFinData ? Math.min(100, f.roe * 1.5) : 0, na: f.roe == null },
    { dim: "技术面", val: techScore },
    { dim: "情绪", val: p.sent.buzz },
    { dim: "安全边际", val: Math.min(100, Math.abs(priceVs52h) * 1.5) },
  ];

  // Support/Resistance via Classic Pivot + ATR
  const last = prices[prices.length - 1];
  const pivot = (last.high + last.low + last.close) / 3;
  const s1 = +(2 * pivot - last.high).toFixed(2), r1 = +(2 * pivot - last.low).toFixed(2);
  const s2 = +(pivot - (last.high - last.low)).toFixed(2), r2 = +(pivot + (last.high - last.low)).toFixed(2);
  const s3 = +(last.low - 2 * (last.high - pivot)).toFixed(2), r3 = +(last.high + 2 * (pivot - last.low)).toFixed(2);

  // ═══ P3: Volatility Analytics (proxy for options IV) ═══
  // Historical volatility from daily returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const variance = returns.length > 1 ? returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1) : 0;
  const dailyVol = Math.sqrt(variance);
  const hvAnnualized = +(dailyVol * Math.sqrt(252) * 100).toFixed(1); // HV as %

  // ATR-implied daily/weekly/monthly moves
  const atrDailyPct = +(curATR / p.price * 100).toFixed(2);
  const atrWeeklyPct = +(atrDailyPct * Math.sqrt(5)).toFixed(1);
  const atrMonthlyPct = +(atrDailyPct * Math.sqrt(21)).toFixed(1);

  // Bollinger implied volatility (2 std devs = ~95% confidence)
  const bollWidth = bollUpper && bollLower && bollMid ? +((bollUpper - bollLower) / (2 * bollMid) * 100).toFixed(1) : null;

  // Scenario analysis (P3-2)
  const bullTarget = curPrice * (1 + atrMonthlyPct / 100 * 2); // +2 monthly ATR moves
  const baseTarget = curPrice * (1 + atrMonthlyPct / 100 * 0.5); // +0.5 monthly ATR
  const bearTarget = curPrice * (1 - atrMonthlyPct / 100 * 2); // -2 monthly ATR
  const stopLoss = curSMA50 ? curSMA50 * 0.85 : curPrice * 0.85; // 15% below SMA50
  const riskReward = curPrice > stopLoss ? +((bullTarget - curPrice) / (curPrice - stopLoss)).toFixed(1) : 0;

  // Expected value (probability-weighted)
  const scenarios = [
    { name: "乐观", prob: 0.25, target: bullTarget, desc: `突破阻力 + 财报超预期`, color: T.green },
    { name: "基准", prob: 0.50, target: baseTarget, desc: `技术面确认 + 业绩符合预期`, color: T.yellow },
    { name: "悲观", prob: 0.25, target: bearTarget, desc: `跌破支撑 + 财报不及预期`, color: T.red },
  ];
  const expectedValue = scenarios.reduce((s, sc) => s + sc.prob * sc.target, 0);
  const expectedReturn = +((expectedValue - curPrice) / curPrice * 100).toFixed(1);

  // Dynamic composite score from fundamentals + technicals
  const compositeScore = calcCompositeScore(fundScore, techScore, p.sent?.buzz);

  const finalScore = compositeScore;
  const rating = scoreToRating(finalScore);
  const sub = scoreToSub(finalScore);

  // Generate dynamic verdict based on actual data
  const verdict = (() => {
    const parts = [];
    const companyName = p.name || p.companyName || ticker;
    parts.push(`${companyName} 当前价 ${p.cur}${curPrice.toFixed(2)}`);
    if (high52 && curPrice > 0) {
      const distHigh = ((curPrice - high52) / high52 * 100).toFixed(0);
      parts.push(`距52周高点 ${distHigh}%`);
    }
    if (fundScore != null) {
      if (fundScore >= 70) parts.push("基本面优秀");
      else if (fundScore >= 55) parts.push("基本面良好");
      else if (fundScore >= 40) parts.push("基本面一般");
      else parts.push("基本面偏弱");
    }
    if (techScore >= 65) parts.push("技术面偏多");
    else if (techScore <= 35) parts.push("技术面偏空");
    else parts.push("技术面中性");
    parts.push(finalScore >= 70 ? "建议分批建仓" : finalScore >= 55 ? "可持有观望" : finalScore >= 40 ? "建议观望等待更好时机" : "建议暂时回避");
    return parts.join("，") + "。";
  })();

  return {
    ticker, ...p, high52, low52, prices, chartData, closes, dataSource,
    score: finalScore, rating, sub, verdict,
    tech: { sma20: curSMA20, sma50: curSMA50, sma200: curSMA200, ema10: ema10[ema10.length - 1], rsi: curRSI, macd: curMACD, signal: curSignal, hist: macdHist, atr: curATR, atrPct, avgVol, signals, priceVs52h, priceVsSMA200,
      boll: { mid: bollMid, upper: bollUpper, lower: bollLower },
      vwma,
      levels: { pivot: +pivot.toFixed(2), s1, s2, s3, r1, r2, r3 },
      historyLen: closes.length, isRealHistory: hasHistory },
    // P3: Volatility & Scenarios
    vol: {
      hv: hvAnnualized,
      atrDailyPct, atrWeeklyPct, atrMonthlyPct,
      bollWidth,
      dailyVol: +(dailyVol * 100).toFixed(3),
    },
    scenarios: {
      items: scenarios,
      stopLoss: +stopLoss.toFixed(2),
      riskReward,
      expectedValue: +expectedValue.toFixed(2),
      expectedReturn,
      bullTarget: +bullTarget.toFixed(2),
      baseTarget: +baseTarget.toFixed(2),
      bearTarget: +bearTarget.toFixed(2),
    },
    fundScore, techScore, radarData,
    pos: { target: posTarget, overAlloc, entries, triggers },
  };
}

// ═══════════════════ SUB-COMPONENTS ═══════════════════
const Card = ({ children, style, ...props }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 10, padding: 16, ...style }} {...props}>{children}</div>
);
const Badge = ({ text, color }) => (
  <span style={{ display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: color + "22", color, border: `1px solid ${color}44` }}>{text}</span>
);
const MetricCard = ({ label, value, sub, color = T.text, highlight }) => (
  <Card style={{ padding: 12, flex: "1 1 140px", minWidth: 130, borderLeft: highlight ? `3px solid ${highlight}` : "none" }}>
    <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>{label}</div>
    <div style={{ fontSize: 20, fontWeight: 700, color }}>{value}</div>
    {sub && <div style={{ fontSize: 11, color: T.dim, marginTop: 2 }}>{sub}</div>}
  </Card>
);
const SectionTitle = ({ children, icon }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, marginTop: 4 }}>
    <span style={{ fontSize: 18 }}>{icon}</span>
    <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{children}</span>
  </div>
);
const TabBtn = ({ label, active, onClick }) => (
  <button className="sa-btn sa-tab-btn" onClick={onClick} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: active ? T.blue : "transparent", color: active ? "#fff" : T.muted }}>{label}</button>
);
const RiskBadge = ({ level }) => {
  const c = level.includes("高") ? T.red : level.includes("中") ? T.yellow : T.green;
  return <Badge text={level} color={c} />;
};
const ScoreGauge = ({ score, label, size = 90 }) => {
  const angle = (score / 100) * 180 - 90;
  const color = score >= 70 ? T.green : score >= 50 ? T.yellow : T.red;
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ width: size, height: size / 2, overflow: "hidden", position: "relative", margin: "0 auto" }}>
        <div style={{ width: size, height: size, borderRadius: size / 2, border: `8px solid ${T.border}`, borderTopColor: "transparent", borderRightColor: "transparent", transform: "rotate(225deg)", position: "absolute", top: 0 }} />
        <div style={{ width: size, height: size, borderRadius: size / 2, border: `8px solid transparent`, borderTopColor: color, borderRightColor: color, transform: `rotate(${90 + angle}deg)`, position: "absolute", top: 0, transition: "transform 0.5s" }} />
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: -8 }}>{score}</div>
      <div style={{ fontSize: 11, color: T.muted }}>{label}</div>
    </div>
  );
};

// ═══════════════════ MOBILE HOOK ═══════════════════
const useIsMobile = (bp = 640) => {
  const [m, setM] = useState(() => typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp}px)`);
    const h = (e) => setM(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [bp]);
  return m;
};

// ═══════════════════ MAIN COMPONENT ═══════════════════
export default function StockAnalysisTool() {
  const mob = useIsMobile();
  const [input, setInput] = useState("9992.HK");
  const [activeTicker, setActiveTicker] = useState("");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sentiment, setSentiment] = useState(null);
  const [macro, setMacro] = useState(null);
  const [news, setNews] = useState(null);
  const [finData, setFinData] = useState(null);
  const [dataStatus, setDataStatus] = useState([]);
  const [events, setEvents] = useState(null);
  const [ivData, setIvData] = useState(null);

  const doAnalyze = useCallback(async (ticker) => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true); setError(""); setActiveTicker(t); setTab("overview");
    setSentiment(null); setMacro(null); setNews(null); setFinData(null); setDataStatus([]); setEvents(null);

    try {
    let stockData = null, dataSource = "live";
    const status = [];
    const supplemental = {
      sentiment: fetchSentiment(t),
      macro: fetchMacro(),
      financials: fetchFinancials(t),
      history: fetchHistory(t),
      events: fetchEvents(t),
      rating: fetchRating(t),
    };

    // 1. Try FMP profile API for live price data (via serverless proxy)
    {
      let profileResult = null;
      try {
        const proxyRes = await fetchProfile(t);
        if (proxyRes?.ok && proxyRes.profile) {
          profileResult = { profile: proxyRes.profile, source: proxyRes.source };
        } else if (!proxyRes?.ok) {
          status.push({ name: "FMP 行情", ok: false, level: "missing", note: proxyRes?.error || "Profile API 返回错误" });
        }
      } catch (e) {
        status.push({ name: "FMP 行情", ok: false, level: "missing", note: `代理请求失败: ${e.message}` });
      }
      if (profileResult?.profile) {
        stockData = mergeLiveWithPreset(t, profileResult.profile);
        dataSource = "live";
      }
    }

    if (!stockData) {
      setError(`无法从 FMP 获取 "${t}" 的真实行情。已停止分析，不会使用预设或模拟数据。请检查股票代码后重试。`);
      setLoading(false);
      setResult(null);
      return;
    }
    if (!(stockData.price > 0)) {
      setError(`${t} 没有可验证的实时价格，已停止分析。`);
      setLoading(false);
      setResult(null);
      return;
    }

    // 4. Fetch external data (sentiment, macro, news, financials, history) in parallel
    status.push({ name: "FMP 行情", ok: dataSource === "live", level: dataSource === "live" ? "complete" : "degraded", note: dataSource === "live" ? "实时价格/52周/市值" : "预设数据(可能过时)" });

    const [sent, mac, nws, fin, hist, evts, unifiedRating, iv] = await Promise.all([
      supplemental.sentiment,
      supplemental.macro,
      fetchNews(t),
      supplemental.financials,
      supplemental.history,
      supplemental.events,
      supplemental.rating,
      fetchIV(t, stockData.price),
    ]);

    let analysis;
    if (hist.ok && hist.bars && hist.bars.length >= 50) {
      stockData.prices = hist.bars; // attach real OHLCV to stockData
      analysis = runAnalysis(t, stockData, dataSource);
      // Compute real YTD from yearStartPrice
      if (hist.yearStartPrice && hist.yearStartPrice > 0 && analysis.price > 0) {
        const realYTD = +((analysis.price - hist.yearStartPrice) / hist.yearStartPrice * 100).toFixed(1);
        analysis = { ...analysis, ytd: realYTD };
      }
      analysis = { ...analysis, historySource: "live" };
      status.push({ name: "历史K线", ok: true, level: hist.count >= 200 ? "complete" : hist.count >= 50 ? "degraded" : "degraded", note: `${hist.count}天真实OHLCV (${hist.bars[0]?.date}~${hist.bars[hist.bars.length - 1]?.date})${hist.count < 200 ? " (<200天, 部分长期指标精度降低)" : ""}` });
      status.push({ name: "技术指标", ok: true, level: hist.count >= 100 ? "complete" : "degraded", note: `真实K线计算 (SMA/EMA/RSI/MACD/ATR)${hist.count < 100 ? " (<100天, SMA200不可用)" : ""}` });
    } else {
      setError(`无法取得 ${t} 至少50条真实历史K线，已停止分析。${hist.error ? ` 原因：${hist.error}` : ""}`);
      setResult(null);
      return;
    }
    // Don't setResult here yet — wait for financials merge to avoid badge flash

    setSentiment(sent);
    // Patch analysis with real sentiment buzz (replace preset value) for radar chart & composite score
    if (sent.ok && sent.bullPct != null) {
      const realBuzz = Math.round(sent.bullPct);
      analysis = { ...analysis, sent: { ...analysis.sent, buzz: realBuzz, reddit: null, stocktwits: realBuzz, trend: sent.strength ?? 50, rating: sent.direction ?? "中" }, sentSource: "live" };
      // Recalculate composite score with real sentiment
      {
        const newScore = calcCompositeScore(analysis.fundScore, analysis.techScore ?? 50, realBuzz);
        const newRating = scoreToRating(newScore);
        const newSub = scoreToSub(newScore);
        analysis = { ...analysis, score: newScore, rating: newRating, sub: newSub };
      }
    }
    status.push({ name: "社交情绪", ok: sent.ok && sent.labeledCount >= 20, level: sent.labeledCount >= 30 ? "complete" : sent.labeledCount >= 20 ? "degraded" : "missing", note: sent.ok ? `StockTwits ${sent.count}帖，其中 ${sent.labeledCount || 0} 条有方向标签；看多 ${sent.bullPct}%${sent.labeledCount < 20 ? "（有效样本不足，评级按中性50处理）" : ""}` : sent.error });

    setMacro(mac);
    status.push({ name: "宏观数据", ok: mac.ok, level: mac.ok ? "complete" : "missing", note: mac.ok ? `10Y ${mac.yield10y}, FedFunds ${mac.fedFunds}` : mac.error });

    setEvents(evts);
    if (evts.ok) {
      const evtCount = evts.macroEvents?.length || 0;
      status.push({ name: "事件日历", ok: true, level: (evts.earnings?.date && (evts.macroEvents?.length || 0) > 0) ? "complete" : "degraded", note: `${evtCount}个宏观事件${evts.earnings?.date ? `, 财报预计 ${evts.earnings.date}` : " (财报日期待确认)"}` });
    } else {
      status.push({ name: "事件日历", ok: false, level: "missing", note: evts.error || "事件数据不可用" });
    }

    // 4b. Try to fetch real options IV from Futu OpenD bridge (optional, local only)
    setIvData(iv.ok ? iv : null);
    if (iv.ok) {
      status.push({ name: "期权IV", ok: true, level: "complete", note: `IV ${iv.avg_iv}%, HV ${iv.avg_hv}%, 溢价 ${iv.vol_premium}% (${iv.contracts_scanned}合约)` });
    } else if (!iv.skipped) {
      status.push({ name: "期权IV", ok: false, level: "degraded", note: "本地Futu桥接未连接，使用HV历史波动率替代" });
    }

    setNews(nws);
    status.push({ name: "新闻", ok: nws.ok, level: nws.ok ? (nws.total > 5 ? "complete" : "degraded") : "missing", note: nws.ok ? `${nws.total}条相关新闻` : nws.error });

    // 5. Merge real financials into analysis if available
    if (fin.ok && fin.eps != null && analysis.price > 0) {
      setFinData(fin);
      // PE is only meaningful when EPS > 0; null otherwise (display as N/A)
      const realPE = fin.eps > 0 ? +(analysis.price / fin.eps).toFixed(1) : null;
      const fwdEPS = fin.eps * (1 + (fin.epsGrowth || 0) / 100);
      const realFwdPE = fwdEPS > 0 ? +(analysis.price / fwdEPS).toFixed(1) : null;
      // PB: prefer direct balance-sheet calculation; fall back to ROE-derived
      const bookValuePS = (fin.totalEquity && fin.shares && fin.shares > 0)
        ? fin.totalEquity / fin.shares
        : ((fin.roe > 0 && fin.eps > 0) ? (fin.eps / (fin.roe / 100)) : 0);
      const realPB = bookValuePS > 0 ? +(analysis.price / bookValuePS).toFixed(1) : 0;

      // Override fin data in analysis result — use real balance sheet / cash flow where available
      const updatedFin = {
        ...analysis.fin,
        pe: realPE,
        fwdPE: realFwdPE,
        pb: realPB || analysis.fin.pb,
        rev: fin.revenue,
        revG: fin.revenueGrowth,
        ni: fin.netIncome,
        niG: fin.niGrowth,
        gm: fin.grossMargin,
        nm: fin.netMargin,
        roe: fin.roe,
        epsGrowth: fin.epsGrowth ?? null,
        // Real data from balance sheet / cash flow (null if unavailable — never fabricate)
        ocf: fin.operatingCF ?? null,
        cash: fin.cash ?? null,
        // New fields from P1 — balance sheet & cash flow
        totalDebt: fin.totalDebt ?? null,
        netDebt: fin.netDebt ?? null,
        totalAssets: fin.totalAssets ?? null,
        totalLiabilities: fin.totalLiabilities ?? null,
        totalEquity: fin.totalEquity ?? null,
        debtToEquity: fin.debtToEquity ?? null,
        freeCashFlow: fin.freeCashFlow ?? null,
        capitalExpenditure: fin.capitalExpenditure ?? null,
        operatingCF: fin.operatingCF ?? null,
        // Analyst price targets
        analystTarget: fin.analystTarget ?? null,
        // Quarterly trends (P2)
        quarters: fin.quarters ?? null,
        finAvailable: "live",
      };
      // Recalculate fundamental score with real data
      const liveFundScore = calcFundScore(updatedFin);

      analysis = { ...analysis, fin: updatedFin, finSource: "live", fundScore: liveFundScore };

      // Recalculate composite score with real financials
      {
        const newScore = calcCompositeScore(liveFundScore, analysis.techScore ?? 50, analysis.sent?.buzz);
        const newRating = scoreToRating(newScore);
        const newSub = scoreToSub(newScore);
        analysis = { ...analysis, score: newScore, rating: newRating, sub: newSub };
      }
      status.push({ name: "财务报表", ok: true, level: fin.quarters?.length >= 4 ? "complete" : fin.eps > 0 ? "degraded" : "degraded", note: `PE ${realPE != null ? realPE + "x" : "N/A(亏损)"}, 营收 ${fmt(fin.revenue)}, EPS ${analysis.cur}${fin.eps.toFixed(2)}${fin.operatingCF ? ", OCF " + fmt(fin.operatingCF) : ""}${fin.cash ? ", 现金 " + fmt(fin.cash) : ""}${fin.quarters?.length < 4 ? " (季报数据不完整)" : ""}` });
      if (fin.analystTarget?.avgTarget) {
        status.push({ name: "分析师预测", ok: true, level: fin.analystTarget.count >= 5 ? "complete" : "degraded", note: `${fin.analystTarget.count}位分析师, 均价 ${analysis.cur}${fin.analystTarget.avgTarget.toFixed(1)}${fin.analystTarget.count < 5 ? " (覆盖较少)" : ""}` });
      } else {
        status.push({ name: "分析师预测", ok: false, level: "missing", note: "分析师目标价不可用" });
      }
    } else {
      setFinData(null);
      status.push({ name: "财务报表", ok: false, level: "missing", note: fin.error ? fin.error : `${t} 财务报表不可用；页面不会以预设值代替` });
      status.push({ name: "分析师预测", ok: false, level: "missing", note: "需FMP付费套餐" });
    }

    // The server rating is authoritative for both this site and the radar batch job.
    if (unifiedRating.ok && unifiedRating.rating) {
      const unified = unifiedRating.rating;
      const unifiedFundamentals = unifiedRating.metrics?.fundamentals || {};
      analysis = {
        ...analysis,
        fin: {
          ...analysis.fin,
          fwdPE: unifiedFundamentals.fwdPe ?? analysis.fin?.fwdPE ?? null,
          fwdPESource: unifiedFundamentals.fwdPeSource || null,
          estimateDate: unifiedFundamentals.estimateDate || null
        },
        score: unified.score,
        rating: unified.rating,
        sub: unified.ratingEn,
        fundScore: unified.components?.fundamental?.score ?? analysis.fundScore,
        techScore: unified.components?.technical?.score ?? analysis.techScore,
        sent: {
          ...analysis.sent,
          buzz: unified.components?.sentiment?.score ?? analysis.sent?.buzz ?? 50
        },
        expectationDetails: unified.components?.expectation?.details || unified.components?.sentiment?.details || null,
        ratingConfidence: unified.confidence,
        ratingConfidenceLabel: unified.confidenceLabel,
        ratingModelVersion: unified.modelVersion
      };
      if (unifiedRating.modelApplicability?.suitable === false) {
        analysis = { ...analysis, modelApplicabilityWarning: unifiedRating.modelApplicability.reason };
      }
      status.push({
        name: "统一评级",
        ok: unified.confidence >= 50,
        level: unified.confidence >= 80 ? "complete" : unified.confidence >= 50 ? "degraded" : "missing",
        note: `${unified.score}分 · ${unified.rating} · 评分指标完整度 ${unified.confidence}%`
      });
    } else {
      status.push({ name: "统一评级", ok: false, level: "missing", note: unifiedRating.error || "评级接口暂不可用" });
      setError(`统一评级所需的真实数据暂不可用，已停止输出买入/持有/观望结论。${unifiedRating.error ? ` 原因：${unifiedRating.error}` : ""}`);
      setResult(null);
      setDataStatus(status);
      return;
    }

    setResult(analysis); // Single setResult after all data is merged — prevents badge flashing
    setDataStatus(status);
    } catch (err) {
      console.error("[StockAnalyzer] 分析异常:", err);
      setError(`分析过程出错: ${err.message || "未知错误"}。请重试或换一个股票。`);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-analyze from URL ?symbol= param (e.g. from wiseain.com deep link)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sym = params.get("symbol")?.trim().toUpperCase();
    if (sym && /^[A-Z0-9.=\-]+$/.test(sym) && sym.length <= 20) {
      setInput(sym);
      doAnalyze(sym);
    }
  }, [doAnalyze]);

  const doSearch = () => doAnalyze(input);
  const tabs = [
    { key: "overview", label: "概览" }, { key: "fundamental", label: "基本面" },
    { key: "technical", label: "技术面" }, { key: "position", label: "仓位 & 风控" },
    { key: "sentiment", label: "市场预期" }, { key: "report", label: "综合报告" },
  ];
  const tip = { background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, color: T.text };

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", minHeight: "100vh", padding: mob ? "12px 10px" : "20px 24px", maxWidth: 1100, margin: "0 auto" }}>
      <style>{`
        .sa-btn{transition:all .15s ease}.sa-btn:hover{opacity:.85}.sa-btn:active{transform:scale(.94)}
        @media(max-width:640px){
          .sa-qtable{overflow-x:auto;-webkit-overflow-scrolling:touch}
          .sa-qtable table{min-width:680px}
          .sa-tab-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;flex-wrap:nowrap!important}
          .sa-tab-scroll::-webkit-scrollbar{display:none}
          .sa-chart-h300 .recharts-wrapper{height:220px!important}
          .sa-chart-h240 .recharts-wrapper{height:180px!important}
          .sa-chart-h160 .recharts-wrapper{height:130px!important}
          .sa-tab-btn{padding:6px 12px!important;font-size:12px!important;white-space:nowrap;flex-shrink:0}
          .sa-scenario-bar{min-height:50px}
        }
      `}</style>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: mob ? 18 : 22, fontWeight: 800, color: T.blue }}>StockAnalyzer</span>
        <span style={{ fontSize: 12, color: T.dim, background: T.card, padding: "2px 8px", borderRadius: 4 }}>v2.1</span>
        <span style={{ fontSize: 11, color: T.dim }}>多维度股票监测评估系统</span>
        {result && <Badge text={result.dataSource === "live" ? (result.finSource === "live" ? "实时行情 + 实时财务" : result.fin?.finAvailable === "preset" ? "实时行情 + 预设财务(参考)" : "实时行情 · 财务数据不可用") : "演示数据"} color={result.dataSource === "live" ? (result.finSource === "live" ? T.green : result.fin?.finAvailable === "preset" ? T.yellow : T.red) : T.red} />}
      </div>

      {/* SEARCH */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder={mob ? "输入股票代码，如 AAPL, 0700.HK" : "输入任意股票代码，如 AAPL, NVDA, 9992.HK, 0700.HK, MSFT ..."}
          style={{ flex: 1, minWidth: mob ? 140 : 220, padding: mob ? "8px 10px" : "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: mob ? 13 : 14, fontFamily: "inherit", outline: "none" }}
        />
        <button className="sa-btn" onClick={doSearch} disabled={loading}
          style={{ padding: mob ? "8px 16px" : "10px 24px", borderRadius: 8, border: "none", background: loading ? T.dim : T.blue, color: "#fff", fontWeight: 700, cursor: loading ? "wait" : "pointer", fontSize: mob ? 13 : 14, minWidth: mob ? 64 : 80 }}>
          {loading ? "分析中..." : "分析"}
        </button>
      </div>

      {/* Quick Picks */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontSize: 11, color: T.dim, lineHeight: "28px" }}>快速选择:</span>
        {Object.entries(QUICK_PICKS).map(([k, name]) => (
          <button key={k} className="sa-btn" onClick={() => { setInput(k); doAnalyze(k); }}
            style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${activeTicker === k ? T.blue : T.border}`, background: activeTicker === k ? T.blue + "22" : "transparent", color: activeTicker === k ? T.blue : T.muted, fontSize: 12, cursor: "pointer", fontWeight: activeTicker === k ? 700 : 400 }}>
            {k} {name}
          </button>
        ))}
      </div>

      {/* LOADING */}
      {loading && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 30, marginBottom: 12, animation: "spin 1s linear infinite" }}>&#x23F3;</div>
          <div style={{ fontSize: 15, color: T.muted }}>正在分析 {input} ...</div>
          <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>FMP 行情 · StockTwits 情绪 · FRED 宏观 · NewsAPI 新闻 · 技术指标计算</div>
        </Card>
      )}

      {/* ERROR */}
      {error && !loading && (
        <Card style={{ textAlign: "center", padding: 30, borderColor: T.red + "44" }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>&#x26A0;&#xFE0F;</div>
          <div style={{ fontSize: 14, color: T.muted, lineHeight: 1.6 }}>{error}</div>
        </Card>
      )}

      {/* NO RESULT */}
      {!result && !loading && !error && (
        <Card style={{ textAlign: "center", padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>&#x1F50D;</div>
          <div style={{ fontSize: 16, color: T.muted }}>输入股票代码开始分析</div>
          <div style={{ fontSize: 12, color: T.dim, marginTop: 6 }}>已配置 FMP API Key，支持美股+港股任意标的实时分析</div>
        </Card>
      )}

      {/* RESULT */}
      {result && !loading && (
        <>
          {/* Data source banner */}
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {result.dataSource === "live" ? (
              <div style={{ padding: "6px 14px", borderRadius: 8, background: T.green + "15", border: `1px solid ${T.green}33`, fontSize: 12, color: T.green }}>
                实时行情 · FMP API · 价格/52周/市值/成交量为真实数据
                {result.finSource === "live" ? " · 财务指标来自 FMP 实时报表" : " · 财务指标来自预设库(参考值,请以财报为准)"}
                {result.historySource === "live" ? ` · ${result.tech.historyLen}天真实K线` : " · ⚠ 技术指标基于模拟K线"}
                · {new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </div>
            ) : (
              <div style={{ padding: "6px 14px", borderRadius: 8, background: T.yellow + "15", border: `1px solid ${T.yellow}33`, fontSize: 12, color: T.yellow }}>
                演示数据 · API 请求失败或 Key 无效，已回退到预设数据 · 请检查 API Key 或网络
              </div>
            )}
          </div>
          {/* Preset financial warning */}
          {result.finSource !== "live" && (
            <div style={{ padding: "8px 14px", borderRadius: 8, background: T.yellow + "15", border: `1px solid ${T.yellow}44`, fontSize: 12, color: T.yellow, marginBottom: 12, lineHeight: 1.6 }}>
              <b>&#x26A0; 注意：</b>该股票的财务指标（PE/PB/营收/利润等）来自预设数据或无法获取，<b>可能不准确</b>。请以公司官方财报为准。升级 FMP 付费套餐可获取实时报表数据。
            </div>
          )}

          {/* Simulated K-line warning */}
          {result.historySource === "simulated" && (
            <div style={{ padding: "8px 14px", borderRadius: 8, background: T.red + "12", border: `1px solid ${T.red}44`, fontSize: 12, color: T.red, marginBottom: 12, lineHeight: 1.6 }}>
              <b>&#x26A0; 重要提示：</b>该股票的历史K线数据不可用（港股需更高级FMP套餐），<b>所有技术指标（SMA/EMA/RSI/MACD/ATR/支撑阻力位）均基于模拟数据计算</b>，仅供趋势参考，不代表真实市场状况。
            </div>
          )}

          {/* STOCK HEADER */}
          <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.card}, ${T.cardAlt})` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: mob ? 6 : 10, marginBottom: 6, flexWrap: "wrap" }}>
                  <span style={{ fontSize: mob ? 18 : 22, fontWeight: 800 }}>{result.ticker}</span>
                  <Badge text={result.market === "US" ? "美股" : "港股"} color={T.blue} />
                  <Badge text={result.cat} color={T.purple} />
                  {dataStatus.length > 0 && (() => {
                    const dc = dataStatus.filter(s => s.level === "complete").length;
                    const dt = dataStatus.length;
                    const dqLabel = dc >= dt * 0.8 ? "数据完整" : dc >= dt * 0.5 ? "数据良好" : "数据有限";
                    const dqColor = dc >= dt * 0.8 ? T.green : dc >= dt * 0.5 ? T.yellow : T.dim;
                    return <Badge text={`${dqLabel} ${dc}/${dt}`} color={dqColor} />;
                  })()}
                </div>
                <div style={{ fontSize: 15, color: T.muted, marginBottom: 8 }}>{result.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: mob ? 28 : 36, fontWeight: 800, color: T.text }}>{result.cur}{result.price?.toFixed(2)}</span>
                  {result.liveData?.change != null && (
                    <span style={{ fontSize: 14, color: result.liveData.change < 0 ? T.red : T.green, fontWeight: 600 }}>
                      {result.liveData.change > 0 ? "+" : ""}{result.liveData.change?.toFixed(2)} ({result.liveData.chgPct?.toFixed(2)}%)
                    </span>
                  )}
                  {result.ytd != null && <span style={{ fontSize: 14, color: result.ytd < 0 ? T.red : T.green, fontWeight: 600 }}>YTD {pct(result.ytd)}</span>}
                  <span style={{ fontSize: 12, color: T.dim }}>52周高 {result.cur}{result.high52?.toFixed(1)} ({pct(result.tech.priceVs52h)})</span>
                </div>
                {result.dataSource === "live" && result.liveData && (
                  <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 11, color: T.muted, flexWrap: "wrap" }}>
                    <span>市值: {result.cur}{fmt(result.liveData.marketCap)}</span>
                    <span>成交量: {fmt(result.liveData.volume)}</span>
                    <span>均量: {fmt(result.liveData.avgVolume)}</span>
                    <span>Beta: {result.liveData.beta?.toFixed(2) || "-"}</span>
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>最终评级</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: result.score >= 65 ? T.green : result.score >= 45 ? T.yellow : T.red }}>{result.rating}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{result.sub}</div>
                <div style={{ marginTop: 8 }}><ScoreGauge score={result.score} label="综合评分" size={80} /></div>
                <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>
                  基本面 {result.fundScore != null ? result.fundScore + "分" : "N/A"}(权重45%) · 技术面 {result.techScore}分(40%) · 市场预期 {result.sent?.buzz ?? 50}分(15%)
                </div>
                {result.ratingConfidence != null && <div style={{ fontSize: 10, color: T.dim, marginTop: 3 }}>评分指标完整度 {result.ratingConfidence}%（{result.ratingConfidenceLabel}）</div>}
              </div>
            </div>
          </Card>

          {result.modelApplicabilityWarning && (
            <div style={{ marginBottom: 12, padding: "10px 14px", border: `1px solid ${T.yellow}`, borderRadius: 8, color: T.yellow, background: T.yellow + "10", fontSize: 12, lineHeight: 1.6 }}>
              <b>模型适用性有限：</b>{result.modelApplicabilityWarning} 页面保留原始数据供核对，但不应把分数直接解释为买卖等级。
            </div>
          )}

          {/* RATING METHODOLOGY */}
          <details style={{ marginBottom: 12, background: T.card, border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 14px" }}>
            <summary style={{ cursor: "pointer", fontSize: 12, color: T.muted, userSelect: "none", listStyle: "none" }}>
              <span style={{ marginRight: 4 }}>&#x2139;&#xFE0F;</span> 评分与评级方法 <span style={{ fontSize: 10, color: T.dim }}>（点击展开）</span>
            </summary>
            <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.9, marginTop: 10 }}>
              <div style={{ marginBottom: 8 }}>
                <b style={{ color: T.text }}>综合评分（0-100）</b> = 基本面 × 45% + 技术面 × 40% + 情绪 × 15%，以50为中枢上下浮动。
              </div>
              <div style={{ display: "flex", gap: mob ? 8 : 20, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: "1 1 180px", background: T.cardAlt, padding: "8px 12px", borderRadius: 6 }}>
                  <b style={{ color: T.blue }}>基本面（45%）</b><br />
                  <span style={{ color: T.dim }}>FwdPE &lt;20 +15 / &lt;30 +5 / ≥30 -10<br />
                  营收增速 &gt;30% +15 / &gt;10% +8 / 否则 -5<br />
                  净利润增速 &gt;30% +10 / &gt;0 +5 / 否则 -10<br />
                  ROE &gt;25% +10 / &gt;15% +5<br />
                  毛利率 &gt;50% +5</span>
                </div>
                <div style={{ flex: "1 1 180px", background: T.cardAlt, padding: "8px 12px", borderRadius: 6 }}>
                  <b style={{ color: T.purple }}>技术面（40%）</b><br />
                  <span style={{ color: T.dim }}>RSI 50-70 +10 / &gt;70超买 -5 / &lt;30超卖 +10<br />
                  MACD金叉 +15 / 死叉 -10<br />
                  价格 &gt; SMA20 +10 / 否则 -5<br />
                  价格 &gt; SMA50 +10 / 否则 -5</span>
                </div>
                <div style={{ flex: "1 1 140px", background: T.cardAlt, padding: "8px 12px", borderRadius: 6 }}>
                  <b style={{ color: T.orange }}>市场预期（15%）</b><br />
                  <span style={{ color: T.dim }}>分析师 EPS 预测修订 45%<br />
                  明确新闻事件信号 35%<br />
                  StockTwits 收缩情绪 20%</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <span><b style={{ color: T.green }}>≥70 积极关注</b> (Accumulate)</span>
                <span><b style={{ color: T.yellow }}>55-69 持有观察</b> (Hold)</span>
                <span><b style={{ color: T.orange }}>40-54 中性观察</b> (Neutral)</span>
                <span><b style={{ color: T.red }}>&lt;40 谨慎回避</b> (Avoid)</span>
              </div>
              <div style={{ fontSize: 10, color: T.dim, marginTop: 4 }}>
                评分仅为研究排序参考，不构成投资建议。完整度只表示模型所需字段返回了多少，不代表数据绝对正确；缺失指标按中性处理并降低完整度。
              </div>
            </div>
          </details>

          {/* TABS */}
          <div className={mob ? "sa-tab-scroll" : ""} style={{ display: "flex", gap: 4, marginBottom: 16, background: T.card, padding: 4, borderRadius: 10, flexWrap: "wrap" }}>
            {tabs.map(t => <TabBtn key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          </div>

          {/* ═══ OVERVIEW ═══ */}
          <div style={{ display: tab === "overview" ? "block" : "none" }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <MetricCard label="Forward PE" value={result.fin.fwdPE != null ? result.fin.fwdPE + "x" : "N/A"} sub={result.fin.fwdPE != null ? `行业 ${result.peers[2]?.pe || "-"}x` : "前瞻EPS仍为负，无法计算"} color={result.fin.fwdPE != null && result.fin.fwdPE < 25 ? T.green : result.fin.fwdPE != null ? T.yellow : T.dim} highlight={T.blue} />
                <MetricCard label="营收增速" value={result.fin.revG ? pct(result.fin.revG) : "N/A"} sub={`净利润 ${result.fin.niG ? pct(result.fin.niG) : "N/A"}`} color={result.fin.revG > 20 ? T.green : result.fin.revG > 0 ? T.yellow : result.fin.revG ? T.red : T.dim} highlight={T.green} />
                <MetricCard label="RSI (14)" value={result.tech.rsi.toFixed(1)} sub={result.tech.rsi > 55 ? "偏多动能" : result.tech.rsi < 45 ? "偏弱" : "中性区间"} color={result.tech.rsi > 70 ? T.red : result.tech.rsi > 55 ? T.green : T.yellow} highlight={T.purple} />
                <MetricCard label="MACD" value={result.tech.macd > result.tech.signal ? "金叉" : "死叉"} sub={`柱状 ${result.tech.hist > 0 ? "+" : ""}${result.tech.hist.toFixed(3)}`} color={result.tech.macd > result.tech.signal ? T.green : T.red} highlight={T.orange} />
                <MetricCard label="ATR 波动率" value={result.tech.atrPct.toFixed(1) + "%"} sub={result.pos.overAlloc} color={result.tech.atrPct > 4 ? T.red : T.yellow} highlight={T.cyan} />
              </div>
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle icon="&#x1F4E1;">技术信号汇总</SectionTitle>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {result.tech.signals.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: T.cardAlt, padding: "8px 14px", borderRadius: 8, flex: "1 1 180px" }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: T.muted }}>{typeof s.val === "number" ? s.val.toFixed(1) : s.val}</span>
                      <span style={{ fontSize: 12, color: s.color, marginLeft: "auto" }}>{s.sig}</span>
                    </div>
                  ))}
                </div>
              </Card>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                <Card style={{ flex: "1 1 300px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F3AF;">多维评分雷达</SectionTitle>
                  <ResponsiveContainer width="100%" height={mob ? 180 : 240}>
                    <RadarChart data={result.radarData}>
                      <PolarGrid stroke={T.border} />
                      <PolarAngleAxis dataKey="dim" tick={{ fill: T.muted, fontSize: 12 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: T.dim, fontSize: 10 }} />
                      <Radar name="评分" dataKey="val" stroke={T.blue} fill={T.blue} fillOpacity={0.25} strokeWidth={2} />
                    </RadarChart>
                  </ResponsiveContainer>
                </Card>
                <Card style={{ flex: "1 1 350px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4CB;">核心判断</SectionTitle>
                  <p style={{ fontSize: 14, lineHeight: 1.8, color: T.text, margin: 0 }}>{result.verdict}</p>
                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>三条看多理由</div>
                    {result.bulls.map((b, i) => (
                      <div key={i} style={{ fontSize: 13, color: T.text, padding: "6px 0", borderBottom: i < 2 ? `1px solid ${T.border}` : "none" }}>
                        <span style={{ color: T.green, fontWeight: 700, marginRight: 6 }}>{i + 1}.</span>
                        <strong>{b.t}</strong> — <span style={{ color: T.muted }}>{b.d}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
              {/* Macro Context */}
              {macro && (
                <Card style={{ marginTop: 16 }}>
                  <SectionTitle icon="&#x1F310;">宏观环境 (Macro Context)</SectionTitle>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ background: T.cardAlt, padding: "10px 16px", borderRadius: 8, flex: "1 1 140px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>10Y 美债收益率</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{macro.ok ? macro.yield10y : "N/A"}</div>
                      <div style={{ fontSize: 11, color: T.dim }}>{macro.ok ? `${macro.yield10yDate} · ${macro.yield10yChg}` : macro.error}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 16px", borderRadius: 8, flex: "1 1 140px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>Fed Funds Rate</div>
                      <div style={{ fontSize: 20, fontWeight: 700, color: T.text }}>{macro.ok ? macro.fedFunds : "N/A"}</div>
                      <div style={{ fontSize: 11, color: T.dim }}>{macro.ok ? macro.source : ""}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 16px", borderRadius: 8, flex: "2 1 260px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>宏观解读</div>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.6 }}>
                        {macro.ok
                          ? (parseFloat(macro.yield10y) > 4.2
                              ? "利率偏高，成长股估值承压，利好高现金流/低估值标的"
                              : parseFloat(macro.yield10y) > 3.5
                                ? "利率中性偏高，关注利率走向对估值的影响"
                                : "利率偏低，利好成长股和高beta标的")
                          : "宏观数据暂不可用"}
                      </div>
                    </div>
                  </div>
                </Card>
              )}

              {/* P2-1: Macro Events Calendar */}
              {events?.ok && (
                <Card style={{ marginTop: 16 }}>
                  <SectionTitle icon="&#x1F4C5;">事件日历 & 宏观数据 <Badge text={`更新于 ${events.generatedAt}`} color={T.dim} /></SectionTitle>
                  {/* Earnings date (highest priority) */}
                  {events.earnings?.date && (
                    <div style={{ padding: "10px 14px", background: T.red + "12", borderRadius: 8, borderLeft: `3px solid ${T.red}`, marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 800, color: T.red }}>&#x1F6A8; {result.ticker} 财报发布</span>
                          <span style={{ fontSize: 13, color: T.muted, marginLeft: 10 }}>{events.earnings.date}</span>
                          {events.earnings.hour && events.earnings.hour !== "TBD" && <span style={{ fontSize: 12, color: T.dim, marginLeft: 6 }}>({events.earnings.hour})</span>}
                        </div>
                        <Badge text={`日历日期 · ${events.earnings.source || "FMP"}`} color={T.green} />
                      </div>
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 4, display: "flex", gap: 14, flexWrap: "wrap" }}>
                        {events.earnings.fiscalQuarterEnding && <span>财报季度: {events.earnings.fiscalQuarterEnding}</span>}
                        {events.earnings.epsForecast != null && <span>EPS 预期: {result.cur}{events.earnings.epsForecast.toFixed(2)}</span>}
                        {events.earnings.lastYearEPS != null && <span>去年同期EPS: {result.cur}{events.earnings.lastYearEPS.toFixed(2)}</span>}
                        {events.earnings.analystCount != null && <span>{events.earnings.analystCount}位分析师预估</span>}
                        {events.earnings.lastQuarter && <span>上季: {events.earnings.lastQuarter}</span>}
                      </div>
                    </div>
                  )}
                  {/* Macro events timeline */}
                  {events.macroEvents?.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 10 }}>
                      <div style={{ fontSize: 12, color: T.muted, marginBottom: 4 }}>近期宏观事件</div>
                      {events.macroEvents.map((ev, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 12px", background: T.cardAlt, borderRadius: 6, borderLeft: `3px solid ${ev.impact.includes("最高") ? T.red : ev.impact.includes("高") ? T.orange : ev.impact.includes("中") ? T.yellow : T.dim}` }}>
                          <span style={{ fontSize: 11, color: T.dim, minWidth: 80, flexShrink: 0 }}>{ev.date}</span>
                          <span style={{ fontSize: 14, flexShrink: 0 }}>{ev.icon}</span>
                          <span style={{ fontSize: 13, color: T.text, flex: 1 }}>{ev.name}</span>
                          <Badge text={`影响: ${ev.impact}`} color={ev.impact.includes("最高") ? T.red : ev.impact.includes("高") ? T.orange : ev.impact.includes("中") ? T.yellow : T.dim} />
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Economic indicators snapshot */}
                  {Object.keys(events.indicators || {}).length > 0 && (
                    <div style={{ marginTop: 12, padding: "10px 12px", background: T.cardAlt, borderRadius: 8 }}>
                      <div style={{ fontSize: 12, color: T.muted, marginBottom: 8 }}>最新经济指标</div>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        {Object.entries(events.indicators).map(([key, ind]) => (
                          <div key={key} style={{ flex: "1 1 120px", minWidth: 100 }}>
                            <div style={{ fontSize: 11, color: T.dim }}>{ind.label}</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{ind.value}{ind.unit}</div>
                            <div style={{ fontSize: 11, color: T.dim }}>
                              {ind.yoy && <span style={{ color: ind.yoy.includes("-") ? T.green : T.yellow }}>YoY {ind.yoy}</span>}
                              {ind.change != null && <span>{ind.change > 0 ? "+" : ""}{ind.change} MoM</span>}
                            </div>
                            {ind.desc && <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>{ind.desc}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 10, color: T.dim }}>经济指标来源: FRED；财报日期仅在 FMP earnings-calendar 明确返回时显示。未来宏观发布日期未接入官方日历前保持为空。</div>
                </Card>
              )}

              {/* Recent News */}
              {news && news.ok && news.articles.length > 0 && (
                <Card style={{ marginTop: 16 }}>
                  <SectionTitle icon="&#x1F4F0;">近期新闻 ({news.total}条相关)</SectionTitle>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {news.articles.slice(0, 5).map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", background: T.cardAlt, borderRadius: 8 }}>
                        <span style={{ fontSize: 11, color: T.blue, fontWeight: 700, minWidth: 70, flexShrink: 0 }}>{a.source}</span>
                        <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, color: T.text, textDecoration: "none", lineHeight: 1.5, flex: 1 }}>{a.title}</a>
                        <span style={{ fontSize: 11, color: T.dim, flexShrink: 0 }}>{a.date}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: T.dim, marginTop: 8 }}>来源: {news.source} · 仅供参考</div>
                </Card>
              )}
            </div>

          {/* ═══ FUNDAMENTAL ═══ */}
          <div style={{ display: tab === "fundamental" ? "block" : "none" }}>
              {result.finSource !== "live" && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: T.yellow + "18", border: `1px solid ${T.yellow}44`, fontSize: 13, color: T.yellow, marginBottom: 16, lineHeight: 1.7 }}>
                  &#x26A0;&#xFE0F; <b>以下财务指标为预设参考值，未经实时财报验证，可能不准确！</b>
                  <br />请以公司最新财报（10-K/10-Q/年报）为准。如需实时数据，请升级 FMP 付费套餐。
                </div>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4B0;">估值指标 {result.finSource === "live" ? <Badge text="实时数据" color={T.green} /> : result.fin?.finAvailable === "preset" ? <Badge text="预设参考值" color={T.yellow} /> : <Badge text="数据不可用" color={T.red} />}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 10 }}>
                    {[
                      { l: "PE (TTM)", v: result.fin.pe != null ? result.fin.pe + "x" : "N/A", sub: result.fin.pe == null && result.finSource === "live" ? "公司当前亏损" : null },
                      { l: "Forward PE", v: result.fin.fwdPE != null ? result.fin.fwdPE + "x" : "N/A", hl: T.blue, sub: result.fin.fwdPE == null && result.finSource === "live" ? "前瞻EPS仍为负" : null },
                      { l: "PB", v: result.fin.pb != null ? result.fin.pb + "x" : "N/A" },
                      { l: "股息率", v: result.fin.divY.toFixed(2) + "%" },
                      { l: "ROE", v: result.fin.roe != null ? result.fin.roe.toFixed(1) + "%" : "N/A" },
                      { l: "毛利率", v: result.fin.gm != null ? result.fin.gm.toFixed(1) + "%" : "N/A" },
                    ].map((m, i) => (
                      <div key={i} style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: m.hl ? `3px solid ${m.hl}` : "none" }}>
                        <div style={{ fontSize: 11, color: T.muted }}>{m.l}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{m.v}</div>
                        {m.sub && <div style={{ fontSize: 10, color: T.dim, marginTop: 2 }}>{m.sub}</div>}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: 10, background: T.cardAlt, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>基本面评分</div>
                    {result.fundScore != null ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4, overflow: "hidden" }}>
                          <div style={{ width: `${result.fundScore}%`, height: "100%", background: result.fundScore >= 65 ? T.green : result.fundScore >= 45 ? T.yellow : T.red, borderRadius: 4, transition: "width 0.5s" }} />
                        </div>
                        <span style={{ fontSize: 16, fontWeight: 800, color: result.fundScore >= 65 ? T.green : T.yellow }}>{result.fundScore}</span>
                      </div>
                    ) : (
                      <div style={{ fontSize: 14, color: T.dim, padding: "4px 0" }}>N/A — 财务数据不可用，无法评分</div>
                    )}
                  </div>
                </Card>
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4CA;">增长与盈利 {result.finSource === "live" ? <Badge text="实时" color={T.green} /> : result.fin?.finAvailable === "preset" ? <Badge text="参考值" color={T.yellow} /> : null}</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: mob ? "1fr" : "1fr 1fr", gap: 10 }}>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>营收</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.fin.rev ? result.cur + fmt(result.fin.rev) : "N/A"}</div>
                      <div style={{ fontSize: 12, color: result.fin.revG > 0 ? T.green : result.fin.revG < 0 ? T.red : T.dim }}>{result.fin.revG ? pct(result.fin.revG) : "—"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>净利润</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.fin.ni ? result.cur + fmt(result.fin.ni) : "N/A"}</div>
                      <div style={{ fontSize: 12, color: result.fin.niG > 0 ? T.green : result.fin.niG < 0 ? T.red : T.dim }}>{result.fin.niG ? pct(result.fin.niG) : "—"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>净利率</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.fin.nm != null ? result.fin.nm.toFixed(1) + "%" : "N/A"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>经营现金流 {result.finSource === "live" && result.fin.operatingCF ? <Badge text="实时" color={T.green} /> : ""}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.fin.ocf ? result.cur + fmt(result.fin.ocf) : "N/A"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>自由现金流 {result.finSource === "live" && result.fin.freeCashFlow ? <Badge text="实时" color={T.green} /> : ""}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: (result.fin.freeCashFlow) > 0 ? T.green : T.red }}>{result.fin.freeCashFlow ? result.cur + fmt(result.fin.freeCashFlow) : "N/A"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>现金及等价物 {result.finSource === "live" && result.fin.cash ? <Badge text="实时" color={T.green} /> : ""}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: result.fin.cash > 0 ? T.green : T.red }}>{result.fin.cash ? result.cur + fmt(result.fin.cash) : "N/A"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>总负债 {result.finSource === "live" && result.fin.totalDebt ? <Badge text="实时" color={T.green} /> : ""}</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.fin.totalDebt ? result.cur + fmt(result.fin.totalDebt) : "N/A"}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>D/E 负债率 {result.finSource === "live" && result.fin.debtToEquity != null ? <Badge text="实时" color={T.green} /> : ""}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: result.fin.debtToEquity != null ? (result.fin.debtToEquity > 100 ? T.red : result.fin.debtToEquity > 50 ? T.yellow : T.green) : T.text }}>
                        {result.fin.debtToEquity != null ? result.fin.debtToEquity.toFixed(1) + "%" : (result.fin.da ? (result.fin.da / Math.max(result.fin.rev, 1) * 100).toFixed(0) + "%" : "N/A")}
                      </div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>EPS 增速</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: result.fin.epsGrowth > 0 ? T.green : result.fin.epsGrowth < 0 ? T.red : T.dim }}>
                        {result.fin.epsGrowth != null ? pct(result.fin.epsGrowth) : "N/A"}
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
              {/* P2-2: Quarterly Trends (Q-over-Q) */}
              {result.fin.quarters && result.fin.quarters.length >= 2 && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle icon="&#x1F4C8;">季度环比趋势 <Badge text={`${result.fin.quarters.length}个季度`} color={T.cyan} /></SectionTitle>
                  <div className="sa-qtable" style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", minWidth: 680, borderCollapse: "collapse", fontSize: mob ? 11 : 12 }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                          <th style={{ padding: "8px 10px", textAlign: "left", color: T.muted, fontWeight: 600 }}>季度</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>营收</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>环比</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>净利润</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>环比</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>毛利率</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>净利率</th>
                          <th style={{ padding: "8px 10px", textAlign: "right", color: T.muted, fontWeight: 600 }}>EPS</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.fin.quarters.map((q, i) => {
                          const prev = result.fin.quarters[i + 1];
                          const revQoQ = prev?.revenue ? ((q.revenue - prev.revenue) / prev.revenue * 100) : null;
                          const niQoQ = prev?.netIncome ? ((q.netIncome - prev.netIncome) / Math.abs(prev.netIncome) * 100) : null;
                          return (
                            <tr key={i} style={{ borderBottom: `1px solid ${T.border}33` }}>
                              <td style={{ padding: "8px 10px", color: i === 0 ? T.blue : T.text, fontWeight: i === 0 ? 700 : 400 }}>
                                {q.date ? new Date(q.date).toISOString().slice(0, 7) : q.period}
                                {i === 0 && <span style={{ marginLeft: 6, fontSize: 10, color: T.blue }}>最新</span>}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: T.text, fontWeight: 600 }}>{q.revenue ? result.cur + fmt(q.revenue) : "—"}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: revQoQ != null ? (revQoQ > 0 ? T.green : revQoQ < 0 ? T.red : T.dim) : T.dim, fontWeight: 600 }}>
                                {revQoQ != null ? (revQoQ > 0 ? "+" : "") + revQoQ.toFixed(1) + "%" : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: T.text }}>{q.netIncome ? result.cur + fmt(q.netIncome) : "—"}</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: niQoQ != null ? (niQoQ > 0 ? T.green : niQoQ < 0 ? T.red : T.dim) : T.dim, fontWeight: 600 }}>
                                {niQoQ != null ? (niQoQ > 0 ? "+" : "") + niQoQ.toFixed(1) + "%" : "—"}
                              </td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: q.grossMargin > 50 ? T.green : T.text }}>{q.grossMargin.toFixed(1)}%</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: q.netMargin > 20 ? T.green : T.text }}>{q.netMargin.toFixed(1)}%</td>
                              <td style={{ padding: "8px 10px", textAlign: "right", color: T.text, fontWeight: 600 }}>{q.eps ? result.cur + q.eps.toFixed(2) : "—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {result.fin.quarters.length >= 2 && (() => {
                    const latest = result.fin.quarters[0];
                    const oldest = result.fin.quarters[result.fin.quarters.length - 1];
                    const revTrend = oldest.revenue > 0 ? ((latest.revenue - oldest.revenue) / oldest.revenue * 100) : 0;
                    const niTrend = oldest.netIncome > 0 ? ((latest.netIncome - oldest.netIncome) / Math.abs(oldest.netIncome) * 100) : 0;
                    return (
                      <div style={{ marginTop: 10, padding: "8px 12px", background: T.cardAlt, borderRadius: 6, fontSize: 12, color: T.muted, lineHeight: 1.7 }}>
                        <span style={{ color: T.cyan, fontWeight: 700 }}>趋势摘要:</span>{" "}
                        从 {oldest.date ? new Date(oldest.date).toISOString().slice(0, 7) : "最早"} 到 {latest.date ? new Date(latest.date).toISOString().slice(0, 7) : "最新"}，
                        营收<span style={{ color: revTrend > 0 ? T.green : T.red, fontWeight: 700 }}>{revTrend > 0 ? "增长" : "下降"} {Math.abs(revTrend).toFixed(1)}%</span>，
                        净利润<span style={{ color: niTrend > 0 ? T.green : T.red, fontWeight: 700 }}>{niTrend > 0 ? "增长" : "下降"} {Math.abs(niTrend).toFixed(1)}%</span>
                      </div>
                    );
                  })()}
                  <div style={{ marginTop: 6, fontSize: 10, color: T.dim }}>来源: FMP income-statement (最近{result.fin.quarters.length}个季度) · 仅供参考</div>
                </Card>
              )}
              {/* Analyst Price Targets */}
              {result.fin.analystTarget?.avgTarget && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle icon="&#x1F3AF;">分析师目标价共识 <Badge text={`${result.fin.analystTarget.count || "?"}位分析师`} color={T.blue} /></SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
                    <div style={{ background: T.cardAlt, padding: "12px 14px", borderRadius: 8, borderLeft: `3px solid ${T.blue}` }}>
                      <div style={{ fontSize: 11, color: T.muted }}>近1月目标均价</div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: T.blue }}>{result.cur}{result.fin.analystTarget.avgTarget.toFixed(1)}</div>
                      {result.fin.analystTarget.count > 0 && <div style={{ fontSize: 11, color: T.dim }}>{result.fin.analystTarget.count}位分析师覆盖</div>}
                    </div>
                    {result.fin.analystTarget.avgTargetQuarter && (
                      <div style={{ background: T.cardAlt, padding: "12px 14px", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: T.muted }}>近1季目标均价</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{result.cur}{result.fin.analystTarget.avgTargetQuarter.toFixed(1)}</div>
                      </div>
                    )}
                    {result.fin.analystTarget.avgTargetYear && (
                      <div style={{ background: T.cardAlt, padding: "12px 14px", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: T.muted }}>近1年目标均价</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{result.cur}{result.fin.analystTarget.avgTargetYear.toFixed(1)}</div>
                        {result.fin.analystTarget.countYear > 0 && <div style={{ fontSize: 11, color: T.dim }}>{result.fin.analystTarget.countYear}位分析师</div>}
                      </div>
                    )}
                    <div style={{ background: T.cardAlt, padding: "12px 14px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>距现价空间</div>
                      {(() => {
                        const upside = ((result.fin.analystTarget.avgTarget - result.price) / result.price * 100);
                        return (
                          <>
                            <div style={{ fontSize: 22, fontWeight: 800, color: upside > 0 ? T.green : T.red }}>{upside > 0 ? "+" : ""}{upside.toFixed(1)}%</div>
                            <div style={{ fontSize: 11, color: T.dim }}>{upside > 10 ? "分析师看好" : upside > 0 ? "温和看涨" : "目标价低于现价"}</div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 11, color: T.dim }}>来源: FMP price-target-summary · 基于卖方分析师近1月/1季/1年共识 · 仅供参考</div>
                </Card>
              )}
              <Card>
                <SectionTitle icon="&#x1F50D;">可比公司估值对比 <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>{result.finSource === "live" ? "标的PE/PB为实时数据" : "预设参考值"}，可比公司为静态预设</span></SectionTitle>
                <ResponsiveContainer width="100%" height={mob ? 170 : 220}>
                  <BarChart data={[{ n: result.ticker, pe: result.fin.fwdPE, pb: result.fin.pb }, ...result.peers.map(p => ({ ...p }))]} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                    <XAxis dataKey="n" tick={{ fill: T.muted, fontSize: 12 }} />
                    <YAxis tick={{ fill: T.dim, fontSize: 11 }} />
                    <Tooltip contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 12, color: T.muted }} />
                    <Bar dataKey="pe" name="Forward PE" fill={T.blue} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="pb" name="PB" fill={T.purple} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </div>

          {/* ═══ TECHNICAL ═══ */}
          <div style={{ display: tab === "technical" ? "block" : "none" }}>
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle icon="&#x1F4C8;">价格走势 & 均线系统 {result.tech.isRealHistory ? (result.dataSource === "live" && <Badge text={`${result.tech.historyLen}天真实K线`} color={T.green} />) : <Badge text="⚠ 模拟K线 (非真实行情)" color={T.red} />}</SectionTitle>
                <ResponsiveContainer width="100%" height={mob ? 220 : 300}>
                  <LineChart data={result.chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                    <XAxis dataKey="date" tick={{ fill: T.dim, fontSize: 10 }} interval={Math.floor(result.chartData.length / 6)} />
                    <YAxis domain={["auto", "auto"]} tick={{ fill: T.dim, fontSize: 11 }} />
                    <Tooltip contentStyle={tip} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="close" name="收盘价" stroke={T.text} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="sma20" name="SMA20" stroke={T.yellow} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                    <Line type="monotone" dataKey="sma50" name="SMA50" stroke={T.orange} strokeWidth={1.5} dot={false} strokeDasharray="4 2" connectNulls />
                    <Line type="monotone" dataKey="ema10" name="EMA10" stroke={T.cyan} strokeWidth={1} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
                <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: T.muted }}>SMA20: <b style={{ color: T.yellow }}>{result.tech.sma20?.toFixed(1) || "-"}</b></span>
                  <span style={{ fontSize: 11, color: T.muted }}>SMA50: <b style={{ color: T.orange }}>{result.tech.sma50?.toFixed(1) || "-"}</b></span>
                  <span style={{ fontSize: 11, color: T.muted }}>SMA200: <b style={{ color: T.purple }}>{result.tech.sma200?.toFixed(1) || "-"}</b></span>
                  <span style={{ fontSize: 11, color: T.muted }}>EMA10: <b style={{ color: T.cyan }}>{result.tech.ema10?.toFixed(1) || "-"}</b></span>
                  <span style={{ fontSize: 11, color: T.muted }}>VWMA20: <b style={{ color: T.lime }}>{result.tech.vwma?.toFixed(1) || "-"}</b></span>
                </div>
              </Card>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <Card style={{ flex: "1 1 45%", minWidth: 300 }}>
                  <SectionTitle icon="&#x1F4CA;">RSI (14)</SectionTitle>
                  <ResponsiveContainer width="100%" height={mob ? 120 : 160}>
                    <AreaChart data={result.chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                      <XAxis dataKey="date" tick={{ fill: T.dim, fontSize: 10 }} interval={14} />
                      <YAxis domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: T.dim, fontSize: 11 }} />
                      <Tooltip contentStyle={tip} />
                      <ReferenceLine y={70} stroke={T.red} strokeDasharray="3 3" label={{ value: "超买", fill: T.red, fontSize: 10 }} />
                      <ReferenceLine y={30} stroke={T.green} strokeDasharray="3 3" label={{ value: "超卖", fill: T.green, fontSize: 10 }} />
                      <Area type="monotone" dataKey="rsi" stroke={T.purple} fill={T.purple + "22"} strokeWidth={1.5} dot={false} connectNulls />
                    </AreaChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>当前 RSI: <b style={{ color: result.tech.rsi > 70 ? T.red : result.tech.rsi > 55 ? T.green : T.yellow }}>{result.tech.rsi.toFixed(1)}</b></div>
                </Card>
                <Card style={{ flex: "1 1 45%", minWidth: 300 }}>
                  <SectionTitle icon="&#x1F4C9;">MACD (12,26,9)</SectionTitle>
                  <ResponsiveContainer width="100%" height={mob ? 120 : 160}>
                    <ComposedChart data={result.chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={T.border} />
                      <XAxis dataKey="date" tick={{ fill: T.dim, fontSize: 10 }} interval={14} />
                      <YAxis tick={{ fill: T.dim, fontSize: 11 }} />
                      <Tooltip contentStyle={tip} />
                      <ReferenceLine y={0} stroke={T.dim} />
                      <Bar dataKey="hist" name="柱状图" radius={[2, 2, 0, 0]}>
                        {result.chartData.map((d, i) => (<Cell key={i} fill={d.hist >= 0 ? T.green + "88" : T.red + "88"} />))}
                      </Bar>
                      <Line type="monotone" dataKey="macd" stroke={T.blue} strokeWidth={1.5} dot={false} />
                      <Line type="monotone" dataKey="signal" stroke={T.orange} strokeWidth={1} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                  <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                    MACD: <b style={{ color: result.tech.macd > result.tech.signal ? T.green : T.red }}>{result.tech.macd > result.tech.signal ? "金叉(多)" : "死叉(空)"}</b> | 柱状: {result.tech.hist > 0 ? "+" : ""}{result.tech.hist.toFixed(3)}
                  </div>
                </Card>
              </div>
              <Card>
                <SectionTitle icon="&#x2699;&#xFE0F;">技术指标总结 {result.tech.isRealHistory ? <Badge text={`${result.tech.historyLen}天真实数据`} color={T.green} /> : <Badge text="模拟数据" color={T.red} />}</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
                  {[
                    { l: "ATR (14)", v: result.tech.atr.toFixed(2), s: `(${result.tech.atrPct.toFixed(1)}%/日)`, c: result.tech.atrPct > 4 ? T.red : T.yellow },
                    { l: "vs 52周高", v: pct(result.tech.priceVs52h), s: result.cur + result.high52?.toFixed(1), c: T.red },
                    { l: "vs SMA200", v: pct(result.tech.priceVsSMA200), s: result.cur + result.tech.sma200?.toFixed(0), c: result.tech.priceVsSMA200 > 0 ? T.green : T.red },
                    { l: "20日均量", v: fmt(result.tech.avgVol), s: "股/日", c: T.text },
                    ...(result.tech.boll?.upper ? [
                      { l: "Boll 上轨", v: result.cur + result.tech.boll.upper, s: "中轨 " + result.cur + result.tech.boll.mid, c: T.orange },
                      { l: "Boll 下轨", v: result.cur + result.tech.boll.lower, s: `带宽 ${((result.tech.boll.upper - result.tech.boll.lower) / result.tech.boll.mid * 100).toFixed(1)}%`, c: T.orange },
                    ] : []),
                    ...(result.tech.vwma ? [
                      { l: "VWMA20", v: result.cur + result.tech.vwma.toFixed(1), s: result.price > result.tech.vwma ? "价格>VWMA 量价多头" : "价格<VWMA 量价弱势", c: result.price > result.tech.vwma ? T.lime : T.yellow },
                    ] : []),
                  ].map((m, i) => (
                    <div key={i} style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>{m.l}</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: m.c }}>{m.v}</div>
                      <div style={{ fontSize: 11, color: T.dim }}>{m.s}</div>
                    </div>
                  ))}
                </div>
              </Card>
              {/* Support / Resistance Levels */}
              {result.tech.levels && (
                <Card style={{ marginTop: 16 }}>
                  <SectionTitle icon="&#x1F4CF;">支撑 & 阻力位 (Pivot + ATR)</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10 }}>
                    {[
                      { l: "S3 (强支撑)", v: result.cur + result.tech.levels.s3?.toFixed(1), c: T.green, dist: ((result.price - result.tech.levels.s3) / result.price * 100).toFixed(1) + "%" },
                      { l: "S2 (支撑)", v: result.cur + result.tech.levels.s2?.toFixed(1), c: T.green, dist: ((result.price - result.tech.levels.s2) / result.price * 100).toFixed(1) + "%" },
                      { l: "S1 (弱支撑)", v: result.cur + result.tech.levels.s1?.toFixed(1), c: T.green, dist: ((result.price - result.tech.levels.s1) / result.price * 100).toFixed(1) + "%" },
                      { l: "Pivot", v: result.cur + result.tech.levels.pivot?.toFixed(1), c: T.blue, dist: "-" },
                      { l: "R1 (弱阻力)", v: result.cur + result.tech.levels.r1?.toFixed(1), c: T.red, dist: ((result.tech.levels.r1 - result.price) / result.price * 100).toFixed(1) + "%" },
                      { l: "R2 (阻力)", v: result.cur + result.tech.levels.r2?.toFixed(1), c: T.red, dist: ((result.tech.levels.r2 - result.price) / result.price * 100).toFixed(1) + "%" },
                      { l: "R3 (强阻力)", v: result.cur + result.tech.levels.r3?.toFixed(1), c: T.red, dist: ((result.tech.levels.r3 - result.price) / result.price * 100).toFixed(1) + "%" },
                    ].map((lv, i) => (
                      <div key={i} style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${lv.c}`, textAlign: "center" }}>
                        <div style={{ fontSize: 11, color: T.muted }}>{lv.l}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: lv.c }}>{lv.v}</div>
                        <div style={{ fontSize: 10, color: T.dim }}>{lv.dist !== "-" ? `距现价 ${lv.dist}` : "枢轴点"}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: T.dim }}>
                    经典 Pivot 计算: P = (H+L+C)/3 · 证据强度: <Badge text={result.tech.isRealHistory ? "高" : "低"} color={result.tech.isRealHistory ? T.green : T.dim} /> ({result.tech.isRealHistory ? `基于${result.tech.historyLen}天真实日线` : "基于模拟数据"})
                  </div>
                </Card>
              )}
            </div>

          {/* ═══ POSITION ═══ */}
          <div style={{ display: tab === "position" ? "block" : "none" }}>
              <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.card}, #1a2744)` }}>
                <SectionTitle icon="&#x1F3AF;">仓位计划 (总目标 = 1.0 单位, 中等仓) <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>基于技术指标自动生成，仅供参考</span></SectionTitle>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>ATR {result.tech.atrPct.toFixed(1)}% → {result.pos.overAlloc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.pos.entries.map((e, i) => {
                    const entryColors = [T.blue, T.green, T.yellow, T.muted];
                    return (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: T.cardAlt, padding: "12px 14px", borderRadius: 8, borderLeft: `3px solid ${entryColors[i]}` }}>
                      <div style={{ minWidth: 64 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: entryColors[i] }}>{e.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{e.size.toFixed(2)}</div>
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 4 }}>{e.priceZone}</div>
                        <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{e.cond}</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>仓位分配</div>
                  <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden" }}>
                    {result.pos.entries.map((e, i) => (
                      <div key={i} style={{ width: `${e.size * 100}%`, background: [T.blue, T.green, T.yellow, T.dim][i], display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "#fff" }}>
                        {e.label} {(e.size * 100).toFixed(0)}%
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
              <Card>
                <SectionTitle icon="&#x26A0;&#xFE0F;">风控触发条件 (触发 → 动作)</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.pos.triggers.map((t, i) => {
                    const sevColor = t.severity === "critical" ? T.red : t.severity === "good" ? T.green : T.yellow;
                    const sevIcon = t.severity === "critical" ? "⛔" : t.severity === "good" ? "✅" : "⚠️";
                    return (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", background: T.cardAlt, borderRadius: 8, borderLeft: `3px solid ${sevColor}` }}>
                      <span style={{ fontSize: 14, minWidth: 20 }}>{sevIcon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{t.cond}</div>
                        <div style={{ fontSize: 12, color: sevColor }}>→ {t.action}</div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              </Card>

              {/* ═══ P3: VOLATILITY ANALYTICS ═══ */}
              <Card style={{ marginTop: 16 }}>
                <SectionTitle icon="&#x1F4CA;">波动率分析</SectionTitle>
                {ivData ? (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Badge text="Futu OpenD" color={T.cyan} />
                      <span style={{ fontSize: 11, color: T.muted }}>实时期权隐含波动率</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${T.cyan}` }}>
                        <div style={{ fontSize: 11, color: T.muted }}>隐含波动率 (IV)</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.cyan }}>{ivData.avg_iv}%</div>
                        <div style={{ fontSize: 10, color: T.dim }}>Call {ivData.call_iv}% / Put {ivData.put_iv}%</div>
                      </div>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${T.purple}` }}>
                        <div style={{ fontSize: 11, color: T.muted }}>历史波动率 (HV)</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.purple }}>{ivData.avg_hv}%</div>
                        <div style={{ fontSize: 10, color: T.dim }}>{ivData.hv_days}日回望期</div>
                      </div>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${ivData.vol_premium > 0 ? T.yellow : T.green}` }}>
                        <div style={{ fontSize: 11, color: T.muted }}>波动率溢价</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: ivData.vol_premium > 0 ? T.yellow : T.green }}>{ivData.vol_premium > 0 ? "+" : ""}{ivData.vol_premium}%</div>
                        <div style={{ fontSize: 10, color: T.dim }}>IV - HV (期权定价{ivData.vol_premium > 5 ? "偏高" : ivData.vol_premium > 0 ? "合理" : "偏低"})</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "8px 12px", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: T.muted }}>Put-Call 偏度</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: ivData.skew > 3 ? T.red : ivData.skew > 0 ? T.yellow : T.green }}>
                          {ivData.skew > 0 ? "+" : ""}{ivData.skew}%
                        </div>
                        <div style={{ fontSize: 10, color: T.dim }}>{ivData.skew > 3 ? "看跌保护需求强" : ivData.skew > 0 ? "轻微看跌偏好" : "看涨情绪主导"}</div>
                      </div>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "8px 12px", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: T.muted }}>期限结构</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: ivData.term_structure === "contango" ? T.green : ivData.term_structure === "backwardation" ? T.red : T.yellow }}>
                          {ivData.term_structure === "contango" ? "正向 (Contango)" : ivData.term_structure === "backwardation" ? "反向 (Backwardation)" : "平坦 (Flat)"}
                        </div>
                        <div style={{ fontSize: 10, color: T.dim }}>近期 {ivData.near_term_iv}% / 远期 {ivData.far_term_iv}%</div>
                      </div>
                      <div style={{ flex: "1 1 120px", background: T.cardAlt, padding: "8px 12px", borderRadius: 8 }}>
                        <div style={{ fontSize: 11, color: T.muted }}>扫描合约数</div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{ivData.contracts_scanned}</div>
                        <div style={{ fontSize: 10, color: T.dim }}>近月/次月 ATM 合约</div>
                      </div>
                    </div>
                    {/* IV vs HV visual comparison bar */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>IV vs HV 对比</div>
                      <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: T.cardAlt }}>
                        <div style={{ width: `${Math.min(100, (ivData.avg_iv / Math.max(ivData.avg_iv, ivData.avg_hv) * 100))}%`, background: `linear-gradient(90deg, ${T.cyan}, ${T.blue})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", transition: "width 0.5s" }}>
                          IV {ivData.avg_iv}%
                        </div>
                        <div style={{ flex: 1 }} />
                        <div style={{ width: `${Math.min(100, (ivData.avg_hv / Math.max(ivData.avg_iv, ivData.avg_hv) * 100))}%`, background: `linear-gradient(90deg, ${T.purple}, ${T.orange})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, color: "#fff", transition: "width 0.5s" }}>
                          HV {ivData.avg_hv}%
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                      <Badge text="历史计算" color={T.yellow} />
                      <span style={{ fontSize: 11, color: T.muted }}>基于真实历史价格计算；期权IV为可选高级数据，不参与综合评级</span>
                    </div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ flex: "1 1 140px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${T.purple}` }}>
                        <div style={{ fontSize: 11, color: T.muted }}>历史波动率 (HV)</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.purple }}>{result.vol.hv}%</div>
                        <div style={{ fontSize: 10, color: T.dim }}>年化 · 日收益率标准差 × √252</div>
                      </div>
                      <div style={{ flex: "1 1 140px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${T.blue}` }}>
                        <div style={{ fontSize: 11, color: T.muted }}>日波动率</div>
                        <div style={{ fontSize: 22, fontWeight: 800, color: T.blue }}>{result.vol.dailyVol}%</div>
                        <div style={{ fontSize: 10, color: T.dim }}>日均对数收益率标准差</div>
                      </div>
                      {result.vol.bollWidth != null && (
                        <div style={{ flex: "1 1 140px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: `3px solid ${T.cyan}` }}>
                          <div style={{ fontSize: 11, color: T.muted }}>布林带宽度</div>
                          <div style={{ fontSize: 22, fontWeight: 800, color: T.cyan }}>{result.vol.bollWidth}%</div>
                          <div style={{ fontSize: 10, color: T.dim }}>2σ通道 / 中轨 (波动区间参考)</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ATR-implied moves */}
                <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 8 }}>ATR 隐含波动区间</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {[
                    { label: "日内", val: result.vol.atrDailyPct, color: T.blue },
                    { label: "周", val: result.vol.atrWeeklyPct, color: T.green },
                    { label: "月", val: result.vol.atrMonthlyPct, color: T.yellow },
                  ].map((item, i) => (
                    <div key={i} style={{ flex: "1 1 100px", background: T.cardAlt, padding: "8px 10px", borderRadius: 8, textAlign: "center" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>{item.label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: item.color }}>±{item.val}%</div>
                      <div style={{ fontSize: 10, color: T.dim }}>
                        ≈ {result.cur}{item.label === "日内" ? (result.price * item.val / 100).toFixed(2) : (result.price * item.val / 100).toFixed(1)}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* ═══ P3: SCENARIO STRESS TEST ═══ */}
              <Card style={{ marginTop: 16 }}>
                <SectionTitle icon="&#x1F3AF;">三情景压力测试 <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>机械波动区间，不是目标价或概率预测</span></SectionTitle>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                  {result.scenarios.items.map((sc, i) => (
                    <div key={i} style={{ flex: "1 1 180px", background: T.cardAlt, borderRadius: 10, padding: "14px 16px", borderTop: `3px solid ${sc.color}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: sc.color }}>{sc.name}</span>
                        <Badge text={`假设权重${(sc.prob * 100).toFixed(0)}%`} color={sc.color} />
                      </div>
                      <div style={{ fontSize: 24, fontWeight: 800, color: T.text, marginBottom: 4 }}>
                        {result.cur}{sc.target.toFixed(2)}
                      </div>
                      <div style={{ fontSize: 12, color: sc.target > result.price ? T.green : T.red, fontWeight: 600, marginBottom: 4 }}>
                        {sc.target > result.price ? "+" : ""}{((sc.target - result.price) / result.price * 100).toFixed(1)}%
                      </div>
                      <div style={{ fontSize: 11, color: T.muted }}>{sc.desc}</div>
                    </div>
                  ))}
                </div>

                {/* Expected Value */}
                <div style={{ background: `linear-gradient(135deg, ${T.cardAlt}, #1a2744)`, borderRadius: 10, padding: "14px 16px", marginBottom: 14 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.muted, marginBottom: 10 }}>假设加权结果 <span style={{ fontSize: 10, color: T.dim }}>(权重固定为25/50/25，不代表真实发生概率)</span></div>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 120px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>假设加权价</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: result.scenarios.expectedReturn >= 0 ? T.green : T.red }}>
                        {result.cur}{result.scenarios.expectedValue}
                      </div>
                    </div>
                    <div style={{ flex: "1 1 120px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>假设加权变动</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: result.scenarios.expectedReturn >= 0 ? T.green : T.red }}>
                        {result.scenarios.expectedReturn >= 0 ? "+" : ""}{result.scenarios.expectedReturn}%
                      </div>
                    </div>
                    <div style={{ flex: "1 1 120px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>风险收益比</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: result.scenarios.riskReward >= 2 ? T.green : result.scenarios.riskReward >= 1 ? T.yellow : T.red }}>
                        1:{result.scenarios.riskReward}
                      </div>
                    </div>
                    <div style={{ flex: "1 1 120px" }}>
                      <div style={{ fontSize: 11, color: T.muted }}>参考防守位</div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: T.red }}>
                        {result.cur}{result.scenarios.stopLoss}
                      </div>
                      <div style={{ fontSize: 10, color: T.dim }}>SMA50 × 0.85</div>
                    </div>
                  </div>
                </div>

                {/* Scenario visualization bar */}
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>情景分布 (价格轴)</div>
                <div style={{ position: "relative", height: 40, background: T.cardAlt, borderRadius: 8, overflow: "hidden" }}>
                  {(() => {
                    const minP = Math.min(result.scenarios.bearTarget, result.scenarios.stopLoss) * 0.95;
                    const maxP = result.scenarios.bullTarget * 1.05;
                    const range = maxP - minP;
                    const toPercent = (v) => ((v - minP) / range * 100);
                    const curPct = toPercent(result.price);
                    return (
                      <>
                        <div style={{ position: "absolute", left: `${toPercent(result.scenarios.bearTarget * 0.9)}%`, width: `${Math.max(1, toPercent(result.scenarios.stopLoss) - toPercent(result.scenarios.bearTarget * 0.9))}%`, height: "100%", background: T.red + "20" }} />
                        <div style={{ position: "absolute", left: `${toPercent(result.scenarios.stopLoss)}%`, width: `${Math.max(1, toPercent(result.scenarios.bullTarget) - toPercent(result.scenarios.stopLoss))}%`, height: "100%", background: T.green + "10" }} />
                        <div style={{ position: "absolute", left: `${curPct}%`, top: 0, bottom: 0, width: 2, background: T.text, zIndex: 2 }}>
                          <div style={{ position: "absolute", top: -2, left: -14, fontSize: 9, color: T.text, whiteSpace: "nowrap" }}>现价</div>
                        </div>
                        {result.scenarios.items.map((sc, i) => (
                          <div key={i} style={{ position: "absolute", left: `${toPercent(sc.target)}%`, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderRadius: "50%", background: sc.color, border: "2px solid #fff", zIndex: 3 }} title={`${sc.name}: ${result.cur}${sc.target.toFixed(2)}`} />
                        ))}
                        <div style={{ position: "absolute", left: `${toPercent(result.scenarios.stopLoss)}%`, top: "50%", transform: "translateY(-50%)", width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderBottom: `8px solid ${T.red}`, zIndex: 3 }} title={`止损: ${result.cur}${result.scenarios.stopLoss}`} />
                        <div style={{ position: "absolute", bottom: 2, left: 4, fontSize: 9, color: T.dim }}>{result.cur}{minP.toFixed(0)}</div>
                        <div style={{ position: "absolute", bottom: 2, right: 4, fontSize: 9, color: T.dim }}>{result.cur}{maxP.toFixed(0)}</div>
                      </>
                    );
                  })()}
                </div>
              </Card>
            </div>

          {/* ═══ SENTIMENT ═══ */}
          <div style={{ display: tab === "sentiment" ? "block" : "none" }}>
              {result.expectationDetails && (
                <Card style={{ marginBottom: 16 }}>
                  <SectionTitle icon="&#x1F9ED;">市场预期构成</SectionTitle>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 190px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>分析师 EPS 修订 · 权重45%</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: result.expectationDetails.analyst?.available ? T.text : T.dim }}>{result.expectationDetails.analyst?.score ?? 50}分</div>
                      <div style={{ fontSize: 10, color: T.dim }}>{result.expectationDetails.analyst?.available ? `${result.expectationDetails.analyst.daysCompared}天变化 ${result.expectationDetails.analyst.changePct >= 0 ? "+" : ""}${result.expectationDetails.analyst.changePct.toFixed(2)}%` : "历史快照不足，按中性处理"}</div>
                    </div>
                    <div style={{ flex: "1 1 190px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>明确新闻事件 · 权重35%</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: result.expectationDetails.news?.available ? T.text : T.dim }}>{result.expectationDetails.news?.score ?? 50}分</div>
                      <div style={{ fontSize: 10, color: T.dim }}>扫描 {result.expectationDetails.news?.articleCount || 0} 条，匹配 {result.expectationDetails.news?.matchedEvents?.length || 0} 个明确事件</div>
                    </div>
                    <div style={{ flex: "1 1 190px", background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>StockTwits 收缩情绪 · 权重20%</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{result.expectationDetails.social?.score ?? 50}分</div>
                      <div style={{ fontSize: 10, color: T.dim }}>{result.expectationDetails.social?.labeledCount || 0} 条方向标签；加入20个中性先验样本</div>
                    </div>
                  </div>
                  {result.expectationDetails.news?.matchedEvents?.length > 0 && (
                    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 5 }}>
                      {result.expectationDetails.news.matchedEvents.map((event, index) => (
                        <a key={`${event.url || event.title}-${index}`} href={event.url || "#"} target="_blank" rel="noopener noreferrer" style={{ color: event.direction === "positive" ? T.green : T.red, fontSize: 11, textDecoration: "none" }}>
                          {event.date || ""} · {event.direction === "positive" ? "正向明确事件" : "负向明确事件"} · {event.title}
                        </a>
                      ))}
                    </div>
                  )}
                </Card>
              )}
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                {/* StockTwits Real Sentiment */}
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4AC;">社交情绪 (StockTwits)</SectionTitle>
                  {sentiment ? (
                    sentiment.ok ? (
                      <>
                        <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
                          <div style={{ flex: "1 1 80px", background: T.green + "15", border: `1px solid ${T.green}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, color: T.green }}>{sentiment.bullPct}%</div>
                            <div style={{ fontSize: 11, color: T.muted }}>原始 Bullish ({sentiment.bullish}帖)</div>
                          </div>
                          <div style={{ flex: "1 1 80px", background: T.red + "15", border: `1px solid ${T.red}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, color: T.red }}>{sentiment.bearPct}%</div>
                            <div style={{ fontSize: 11, color: T.muted }}>原始 Bearish ({sentiment.bearish}帖)</div>
                          </div>
                          <div style={{ flex: "1 1 80px", background: T.blue + "15", border: `1px solid ${T.blue}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: mob ? 20 : 24, fontWeight: 800, color: T.blue }}>{sentiment.count}</div>
                            <div style={{ fontSize: 11, color: T.muted }}>总帖子</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: "1 1 80px" }}>
                            <div style={{ fontSize: 11, color: T.muted }}>情绪方向</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: sentiment.direction === "偏多" ? T.green : sentiment.direction === "偏空" ? T.red : T.yellow }}>{sentiment.direction}</div>
                          </div>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: "1 1 80px" }}>
                            <div style={{ fontSize: 11, color: T.muted }}>讨论热度</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{sentiment.crowdedness}</div>
                          </div>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: "1 1 80px" }}>
                            <div style={{ fontSize: 11, color: T.muted }}>Watchlist</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{sentiment.watchlist || "-"}</div>
                          </div>
                        </div>
                        {/* Sentiment bar */}
                        <div style={{ height: 10, display: "flex", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
                          <div style={{ width: `${sentiment.bullPct}%`, background: T.green, transition: "width 0.5s" }} />
                          <div style={{ width: `${100 - sentiment.bullPct - sentiment.bearPct}%`, background: T.dim, transition: "width 0.5s" }} />
                          <div style={{ width: `${sentiment.bearPct}%`, background: T.red, transition: "width 0.5s" }} />
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.dim }}>
                          <span>Bullish {sentiment.bullPct}%</span><span>Neutral</span><span>Bearish {sentiment.bearPct}%</span>
                        </div>
                      </>
                    ) : (
                      <div style={{ padding: 16, textAlign: "center", color: T.muted }}>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>&#x26A0;</div>
                        <div>StockTwits 数据获取失败</div>
                        <div style={{ fontSize: 11, color: T.dim }}>{sentiment.error} · 可能该股票在 StockTwits 无数据</div>
                      </div>
                    )
                  ) : (
                    <div style={{ padding: 16, textAlign: "center", color: T.dim, fontSize: 12 }}>加载中...</div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10, color: T.dim }}>来源: {sentiment?.source || "StockTwits 公开API"} · 证据强度: <Badge text={sentiment?.strength || "低"} color={sentiment?.strength === "高" ? T.green : sentiment?.strength === "中" ? T.yellow : T.dim} /></div>
                </Card>

                {/* Recent StockTwits Posts */}
                <Card style={{ flex: "1 1 350px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4E8;">最新帖子</SectionTitle>
                  {sentiment?.recentPosts?.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }}>
                      {sentiment.recentPosts.map((p, i) => (
                        <div key={i} style={{ padding: "8px 10px", background: T.cardAlt, borderRadius: 6, borderLeft: `3px solid ${p.sentiment === "Bullish" ? T.green : p.sentiment === "Bearish" ? T.red : T.dim}` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                            <Badge text={p.sentiment === "Bullish" ? "Bull" : p.sentiment === "Bearish" ? "Bear" : "Neutral"} color={p.sentiment === "Bullish" ? T.green : p.sentiment === "Bearish" ? T.red : T.dim} />
                            <span style={{ fontSize: 10, color: T.dim }}>{p.time}</span>
                          </div>
                          <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>{p.body}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ padding: 16, textAlign: "center", color: T.dim, fontSize: 12 }}>暂无帖子数据</div>
                  )}
                </Card>
              </div>

              {/* Risks */}
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle icon="&#x26A0;&#xFE0F;">核心风险因素</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {result.risks.map((r, i) => (
                    <div key={i} style={{ padding: "12px 14px", background: T.cardAlt, borderRadius: 8, borderLeft: `3px solid ${r.l.includes("高") ? T.red : r.l.includes("中") ? T.yellow : T.green}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.t}</span>
                        <div style={{ display: "flex", gap: 6 }}>
                          <RiskBadge level={r.l} />
                          {(() => {
                            const riskEv = result.dataSource === "live" && result.finSource === "live" ? "高" : result.dataSource === "live" || result.finSource === "live" ? "中" : "低";
                            return <Badge text={`证据: ${riskEv}`} color={riskEv === "高" ? T.green : riskEv === "中" ? T.yellow : T.dim} />;
                          })()}
                        </div>
                      </div>
                      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>{r.d}</div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Data Status Table */}
              <Card>
                <SectionTitle icon="&#x1F50E;">数据采集状态</SectionTitle>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {dataStatus.length > 0 ? dataStatus.map((s, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", background: T.cardAlt, borderRadius: 6 }}>
                      <div style={{ width: 8, height: 8, borderRadius: 4, background: s.ok ? T.green : T.dim, flexShrink: 0 }} />
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, minWidth: 90 }}>{s.name}</span>
                      <span style={{ fontSize: 12, color: T.muted, flex: 1 }}>{s.note}</span>
                      <Badge text={s.ok ? "已获取" : "不可用"} color={s.ok ? T.green : T.dim} />
                    </div>
                  )) : (
                    <div style={{ padding: 12, color: T.dim, fontSize: 12 }}>分析完成后显示数据采集状态...</div>
                  )}
                </div>
                <div style={{ marginTop: 12, padding: "8px 12px", background: T.yellow + "15", border: `1px solid ${T.yellow}33`, borderRadius: 6, fontSize: 11, color: T.yellow }}>
                  数据来源: FMP Profile(行情) + Historical(K线) + Income Statement/Metrics(财务) · StockTwits(情绪) · FRED(宏观) · NewsAPI(新闻)
                </div>
              </Card>
            </div>

          {/* ═══ REPORT ═══ */}
          <div style={{ display: tab === "report" ? "block" : "none" }}>
            <Card style={{ fontFamily: "'SF Mono', 'Fira Code', monospace", fontSize: 13, lineHeight: 2 }}>
              {/* Header */}
              <div style={{ borderBottom: `1px solid ${T.border}`, paddingBottom: 12, marginBottom: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <span style={{ color: T.dim }}>Research Report</span> <span style={{ color: T.blue, fontWeight: 700, fontSize: 15 }}>{result.ticker} {result.name}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <Badge text={result.rating + " / " + result.sub} color={result.score >= 65 ? T.green : result.score >= 45 ? T.yellow : T.red} />
                    <Badge text={result.dataSource === "live" ? "行情实时" : "DEMO"} color={result.dataSource === "live" ? T.green : T.yellow} />
                    <Badge text={"综合评分 " + result.score} color={T.blue} />
                  </div>
                </div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
                  {new Date().toISOString().slice(0, 10)} · {result.cur}{result.price?.toFixed(2)} {result.dataSource === "live" ? "(实时)" : "(演示)"} · 距52周高 {pct(result.tech.priceVs52h)}{result.ytd != null ? ` · YTD ${pct(result.ytd)}` : ""}
                </div>
              </div>

              {/* Macro Context */}
              {macro?.ok && (
                <div style={{ padding: "8px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 14, borderLeft: `3px solid ${T.cyan}` }}>
                  <span style={{ color: T.cyan, fontWeight: 700 }}>宏观环境:</span>{" "}
                  <span style={{ color: T.muted }}>10Y 美债 {macro.yield10y} ({macro.yield10yChg}) · Fed Funds {macro.fedFunds}</span>{" "}
                  <span style={{ color: T.dim }}>· {parseFloat(macro.yield10y) > 4 ? "利率偏高，成长股估值承压" : parseFloat(macro.yield10y) > 3.5 ? "利率中性偏高" : "利率偏低，利好成长股"}</span>
                  <span style={{ fontSize: 10, color: T.dim, marginLeft: 6 }}>[{macro.source}]</span>
                </div>
              )}

              {/* P2-3: Structured Multi-Perspective Debate */}
              <div style={{ marginBottom: 16, padding: "12px 14px", background: T.cardAlt, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  &#x2696;&#xFE0F; 多空博弈分析
                  <Badge text={`${result.dataSource === "live" ? "实时数据" : "演示数据"}驱动`} color={result.dataSource === "live" ? T.green : T.yellow} />
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {/* Bull Case - Dynamic Evidence */}
                  <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ color: T.green, fontSize: 15 }}>&#x1F7E2;</span>
                      <span style={{ color: T.green, fontWeight: 700, fontSize: 13 }}>激进派 (看多)</span>
                    </div>
                    {[
                      // Generate bull arguments from real data
                      { t: "估值与增长", d: result.fin.fwdPE && result.fin.revG > 0
                        ? `Forward PE ${result.fin.fwdPE}x, 营收增速 ${result.fin.revG.toFixed(1)}%, PEG ${(result.fin.fwdPE / Math.max(result.fin.revG, 1)).toFixed(1)} — ${result.fin.fwdPE / Math.max(result.fin.revG, 1) < 1.5 ? "性价比优秀" : "估值合理"}`
                        : result.bulls[0]?.d || "估值水平具有吸引力",
                        ev: result.finSource === "live" ? "高" : "中" },
                      { t: "技术面动能", d: result.tech.rsi > 50 && result.tech.macd > result.tech.signal
                        ? `RSI ${result.tech.rsi.toFixed(0)} 偏强, MACD 金叉, ${result.price > result.tech.sma50 ? "站上50日均线" : "50日均线下方蓄势"}${result.tech.vwma && result.price > result.tech.vwma ? ", 量价确认" : ""}`
                        : result.bulls[2]?.d || "技术面存在反弹信号",
                        ev: result.tech.isRealHistory ? "高" : "低" },
                      { t: "市场共识", d: result.fin.analystTarget?.avgTarget
                        ? `${result.fin.analystTarget.count}位分析师均价 ${result.cur}${result.fin.analystTarget.avgTarget.toFixed(1)}, 距现价 ${((result.fin.analystTarget.avgTarget - result.price) / result.price * 100 > 0 ? "+" : "")}${((result.fin.analystTarget.avgTarget - result.price) / result.price * 100).toFixed(1)}%`
                        : result.bulls[1]?.d || "机构持仓稳定",
                        ev: result.fin.analystTarget?.avgTarget ? "高" : "中" },
                    ].map((b, i) => (
                      <div key={i} style={{ padding: "8px 10px", background: T.green + "08", borderRadius: 6, marginBottom: 5, borderLeft: `2px solid ${T.green}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: T.text, fontSize: 12 }}>{b.t}</span>
                          <Badge text={`证据: ${b.ev}`} color={b.ev === "高" ? T.green : b.ev === "中" ? T.yellow : T.dim} />
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>{b.d}</div>
                      </div>
                    ))}
                  </div>

                  {/* Neutral Perspective */}
                  <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ color: T.yellow, fontSize: 15 }}>&#x1F7E1;</span>
                      <span style={{ color: T.yellow, fontWeight: 700, fontSize: 13 }}>中性派 (框架合理, 触发待验证)</span>
                    </div>
                    {[
                      (() => {
                        const srcCount = [result.dataSource === "live", result.finSource === "live", result.tech.isRealHistory, sentiment?.ok, macro?.ok, events?.ok].filter(Boolean).length;
                        const compEv = srcCount >= 5 ? "高" : srcCount >= 3 ? "中" : "低";
                        return { t: "数据完整度", d: `实时行情: ${result.dataSource === "live" ? "✓" : "✗"}, 实时财务: ${result.finSource === "live" ? "✓" : "✗"}, 真实K线: ${result.tech.isRealHistory ? `${result.tech.historyLen}天` : "✗"}, 情绪: ${sentiment?.ok ? "✓" : "✗"}, 宏观: ${macro?.ok ? "✓" : "✗"}, 事件: ${events?.ok ? "✓" : "✗"}`, ev: compEv };
                      })(),
                      { t: "技术面分歧", d: result.tech.signals.length >= 4
                        ? `${result.tech.signals.filter(s => s.color === T.green).length}多/${result.tech.signals.filter(s => s.color === T.red).length}空/${result.tech.signals.filter(s => s.color === T.yellow).length}中性 — 信号未完全一致, 需更多确认`
                        : "技术指标不足, 无法形成一致判断",
                        ev: result.tech.isRealHistory && result.tech.historyLen > 100 ? "中-高" : result.tech.isRealHistory ? "中" : "低" },
                      { t: "风险预算示例", d: `当前 ATR ${result.tech.atrPct.toFixed(1)}%。仓位比例仅为演示模板，未考虑你的资产规模、持仓相关性、投资期限和最大可承受亏损，不能直接作为下单建议。`, ev: "低" },
                    ].map((n, i) => (
                      <div key={i} style={{ padding: "8px 10px", background: T.yellow + "08", borderRadius: 6, marginBottom: 5, borderLeft: `2px solid ${T.yellow}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: T.text, fontSize: 12 }}>{n.t}</span>
                          <Badge text={`证据: ${n.ev}`} color={n.ev === "高" ? T.green : n.ev.includes("高") ? T.cyan : n.ev === "中" ? T.yellow : n.ev === "事实" ? T.blue : T.dim} />
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>{n.d}</div>
                      </div>
                    ))}
                  </div>

                  {/* Bear Case - Dynamic Evidence */}
                  <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                      <span style={{ color: T.red, fontSize: 15 }}>&#x1F534;</span>
                      <span style={{ color: T.red, fontWeight: 700, fontSize: 13 }}>保守派 (风险警示)</span>
                    </div>
                    {result.risks.map((r, i) => (
                      <div key={i} style={{ padding: "8px 10px", background: T.red + "08", borderRadius: 6, marginBottom: 5, borderLeft: `2px solid ${T.red}` }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: T.text, fontSize: 12 }}>{r.t}</span>
                          <RiskBadge level={r.l} />
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>{r.d}</div>
                      </div>
                    ))}
                    {/* Additional bear argument from data */}
                    <div style={{ padding: "8px 10px", background: T.red + "08", borderRadius: 6, marginBottom: 5, borderLeft: `2px solid ${T.red}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: T.text, fontSize: 12 }}>距52周高</span>
                        <Badge text={result.tech.priceVs52h > -10 ? "低" : "中"} color={result.tech.priceVs52h > -10 ? T.green : T.yellow} />
                      </div>
                      <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
                        距高点 {pct(result.tech.priceVs52h)}, {result.tech.isRealHistory ? "真实K线确认" : "模拟数据, 需验证"}
                        {result.tech.boll?.upper && result.price > result.tech.boll.upper * 0.95 ? ", 接近布林上轨, 短期承压" : ""}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Debate Synthesis */}
                <div style={{ marginTop: 12, padding: "10px 14px", background: T.blue + "10", borderRadius: 8, borderLeft: `3px solid ${T.blue}` }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.blue, marginBottom: 4 }}>辩论结论</div>
                  <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.8 }}>
                    {(() => {
                      const bullScore = result.tech.signals.filter(s => s.color === T.green).length;
                      const bearScore = result.tech.signals.filter(s => s.color === T.red).length;
                      const hasRealData = result.dataSource === "live" && result.finSource === "live";
                      const hasEarnings = events?.earnings?.date;
                      const upside = result.fin.analystTarget?.avgTarget ? ((result.fin.analystTarget.avgTarget - result.price) / result.price * 100) : null;
                      return (
                        <>
                          {bullScore > bearScore ? "技术面偏多" : bullScore < bearScore ? "技术面偏空" : "技术面中性"},
                          {" "}基本面{result.fin.revG > 30 ? "强劲增长" : result.fin.revG > 10 ? "稳健增长" : result.fin.revG > 0 ? "低速增长" : result.fin.revG < 0 ? "负增长" : "数据待确认"}。
                          {upside != null && <> 分析师共识{upside > 10 ? "看涨 " + upside.toFixed(0) + "%" : upside > 0 ? "温和看涨" : "目标价低于现价"}。</>}
                          {hasEarnings && <> 即将发布财报({events.earnings.date}), 事件前宜控制仓位。</>}
                          {!hasRealData && <span style={{ color: T.yellow }}> ⚠ 部分数据非实时, 结论可靠性受限。</span>}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Key Levels */}
              {result.tech.levels && (
                <div style={{ padding: "10px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 14, borderLeft: `3px solid ${T.purple}` }}>
                  <span style={{ color: T.purple, fontWeight: 700 }}>关键价位:</span>{" "}
                  <span style={{ color: T.green }}>S1 {result.cur}{result.tech.levels.s1?.toFixed(1)}</span>{" "}
                  <span style={{ color: T.green }}>S2 {result.cur}{result.tech.levels.s2?.toFixed(1)}</span>{" "}
                  <span style={{ color: T.green }}>S3 {result.cur}{result.tech.levels.s3?.toFixed(1)}</span>{" "}
                  <span style={{ color: T.blue, fontWeight: 700 }}>|</span>{" "}
                  <span style={{ color: T.red }}>R1 {result.cur}{result.tech.levels.r1?.toFixed(1)}</span>{" "}
                  <span style={{ color: T.red }}>R2 {result.cur}{result.tech.levels.r2?.toFixed(1)}</span>{" "}
                  <span style={{ color: T.red }}>R3 {result.cur}{result.tech.levels.r3?.toFixed(1)}</span>
                  <span style={{ fontSize: 10, color: T.dim, marginLeft: 6 }}>[Pivot Points]</span>
                </div>
              )}

              {/* Technical Signals */}
              <div style={{ padding: "10px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 14, borderLeft: `3px solid ${T.orange}` }}>
                <span style={{ color: T.orange, fontWeight: 700 }}>技术面:</span>{" "}
                {result.tech.signals.map((s, i) => (
                  <span key={i} style={{ color: s.color, marginRight: 12 }}>
                    {s.name} {typeof s.val === "number" ? s.val.toFixed(1) : s.val} ({s.sig})
                  </span>
                ))}
                <span style={{ fontSize: 10, color: T.dim }}>[SMA/EMA/MACD/RSI]</span>
              </div>

              {/* Sentiment Summary */}
              {sentiment?.ok && (
                <div style={{ padding: "10px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 14, borderLeft: `3px solid ${T.purple}` }}>
                  <span style={{ color: T.purple, fontWeight: 700 }}>市场情绪:</span>{" "}
                  <span style={{ color: T.muted }}>
                    StockTwits {sentiment.count}帖 · Bullish {sentiment.bullPct}% / Bearish {sentiment.bearPct}% · 方向 <b style={{ color: sentiment.direction === "偏多" ? T.green : sentiment.direction === "偏空" ? T.red : T.yellow }}>{sentiment.direction}</b> · 热度 {sentiment.crowdedness}
                    {sentiment.watchlist > 0 && <> · Watchlist {sentiment.watchlist}</>}
                  </span>
                  <span style={{ fontSize: 10, color: T.dim, marginLeft: 6 }}>[{sentiment.source}]</span>
                </div>
              )}

              {/* Position Plan */}
              <div style={{ padding: "10px 12px", background: T.cardAlt, borderRadius: 8, marginBottom: 14, borderLeft: `3px solid ${T.blue}` }}>
                <span style={{ color: T.blue, fontWeight: 700 }}>仓位计划 <span style={{ fontWeight: 400, color: T.dim }}>(1.0单位, ATR {result.tech.atrPct.toFixed(1)}% → {result.pos.overAlloc}):</span></span>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
                  {result.pos.entries.map(e => `${e.label} ${e.size.toFixed(2)}`).join(" → ")}
                </div>
              </div>

              {/* Verdict */}
              <div style={{ padding: "14px 16px", background: T.cardAlt, borderRadius: 8, borderLeft: `4px solid ${result.score >= 65 ? T.green : result.score >= 45 ? T.yellow : T.red}`, marginBottom: 14 }}>
                <div style={{ color: result.score >= 65 ? T.green : result.score >= 45 ? T.yellow : T.red, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>核心判断:</div>
                <div style={{ color: T.text, lineHeight: 1.8, fontSize: 14 }}>"{result.verdict}"</div>
              </div>

              {/* Data Transparency */}
              <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 10, marginTop: 10 }}>
                <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.8 }}>
                  <span style={{ color: T.yellow }}>数据来源透明度:</span>
                  {(() => {
                    const complete = dataStatus.filter(s => s.level === "complete").length;
                    const degraded = dataStatus.filter(s => s.level === "degraded").length;
                    const missing = dataStatus.filter(s => s.level === "missing").length;
                    const total = dataStatus.length;
                    const qualityLabel = complete >= total * 0.8 ? "优秀" : complete >= total * 0.5 ? "良好" : complete + degraded >= total * 0.5 ? "一般" : "不足";
                    const qualityColor = complete >= total * 0.8 ? T.green : complete >= total * 0.5 ? T.cyan : T.yellow;
                    return <span style={{ marginLeft: 6, color: qualityColor, fontWeight: 700 }}>数据质量: {qualityLabel} ({complete}完整/{degraded}降级/{missing}缺失)</span>;
                  })()}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                  {dataStatus.length > 0 && dataStatus.map((s, i) => {
                    const lvColor = s.level === "complete" ? T.green : s.level === "degraded" ? T.yellow : T.dim;
                    const lvIcon = s.level === "complete" ? "✓" : s.level === "degraded" ? "◐" : "○";
                    return (
                      <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: lvColor + "15", color: lvColor, border: `1px solid ${lvColor}30` }} title={s.note}>
                        {lvIcon} {s.name}
                      </span>
                    );
                  })}
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>
                  <span style={{ color: T.yellow }}>&#x26A0;</span> 技术指标基于{result.tech.isRealHistory ? `${result.tech.historyLen}天真实日线` : "模拟K线（该股票历史数据不可用）"}计算。本报告自动生成，仅供参考，不构成投资建议。
                </div>
              </div>

              <div style={{ marginTop: 8, color: T.dim, fontSize: 11 }}>
                本报告由 StockAnalyzer 自动生成 · 仅供参考，不构成投资建议 · 投资有风险，入市需谨慎
              </div>
            </Card>
          </div>
        </>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "20px 0 8px", fontSize: 11, color: T.dim }}>
        StockAnalyzer v2.1 · 数据来源: FMP(行情) · FRED(宏观) · StockTwits(情绪) · NewsAPI(新闻) · 仅供参考，不构成投资建议
      </div>
    </div>
  );
}
