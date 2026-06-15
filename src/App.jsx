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
const pct = (n) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
const safeNum = (v, fallback = 0) => (v != null && !isNaN(v) && isFinite(v)) ? v : fallback;
const naOr = (v, fmtFn) => (v != null && v !== 0) ? fmtFn(v) : "N/A";

// ═══════════════════ PRICE GENERATOR (DEMO) ═══════════════════
const genPrices = (cur, days, vol) => {
  const data = []; let p = cur * (0.88 + Math.random() * 0.06);
  for (let i = 0; i < days; i++) {
    const trend = (i / days) * (cur - p) * 0.015;
    const chg = trend + (Math.random() - 0.47) * p * vol;
    const o = p, c = +(p + chg).toFixed(2);
    const h = +(Math.max(o, c) + Math.random() * Math.abs(chg) * 0.5).toFixed(2);
    const l = +(Math.min(o, c) - Math.random() * Math.abs(chg) * 0.5).toFixed(2);
    const v = Math.floor(2e6 + Math.random() * 25e6);
    data.push({ date: `D-${days - i}`, open: +o.toFixed(2), high: h, low: l, close: c, volume: v });
    p = c;
  }
  data[data.length - 1].close = cur;
  return data;
};

// ═══════════════════ FMP API SERVICE ═══════════════════
const FMP_STABLE = "https://financialmodelingprep.com/stable";
const DEFAULT_KEY = "7TTaEnINif0Z5FJZgM6xvJibocPeHFPn";

const fmpGet = async (endpoint, params, apiKey) => {
  const qs = new URLSearchParams({ ...params, apikey: apiKey }).toString();
  const url = `${FMP_STABLE}/${endpoint}?${qs}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`FMP ${r.status}`);
  const data = await r.json();
  if (data?.["Error Message"] || data?.["Premium Query Parameter"]) throw new Error("Premium/legacy");
  return data;
};

const fmpFetchProfile = async (symbol, apiKey) => {
  // Try profile first (most data), fallback to quote
  try {
    const data = await fmpGet("profile", { symbol }, apiKey);
    if (Array.isArray(data) && data[0]) return { profile: data[0], source: "profile" };
  } catch (e) { /* try quote */ }
  try {
    const data = await fmpGet("quote", { symbol }, apiKey);
    if (Array.isArray(data) && data[0]) return { profile: data[0], source: "quote" };
  } catch (e) { /* fail */ }
  return null;
};

// ═══════════════════ EXTERNAL API SERVICES (via Vercel proxy) ═══════════════════
// Direct browser calls blocked by CORS → proxy through /api serverless functions

const fetchSentiment = async (symbol) => {
  try {
    const r = await fetch(`/api/sentiment?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return d;
  } catch (e) { return { ok: false, error: e.message, count: 0, bullish: 0, bearish: 0, bullPct: 0, bearPct: 0, watchlist: 0, recentPosts: [], source: "StockTwits (失败)" }; }
};

const fetchMacro = async () => {
  try {
    const r = await fetch(`/api/macro`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return d;
  } catch (e) { return { ok: false, yield10y: "N/A", fedFunds: "N/A", error: e.message, source: "FRED (失败)" }; }
};

const fetchNews = async (query) => {
  try {
    const r = await fetch(`/api/news?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return d;
  } catch (e) { return { ok: false, total: 0, articles: [], error: e.message, source: "NewsAPI (失败)" }; }
};

const fetchFinancials = async (symbol) => {
  try {
    const r = await fetch(`/api/financials?symbol=${encodeURIComponent(symbol)}`, { signal: AbortSignal.timeout(12000) });
    const d = await r.json();
    return d;
  } catch (e) { return { ok: false, error: e.message, source: "FMP financials (失败)" }; }
};

// ═══════════════════ FMP PROFILE → ANALYSIS FORMAT ═══════════════════
const mergeLiveWithPreset = (ticker, prof) => {
  const p = prof;
  const cur = p.currency === "HKD" ? "HK$" : (p.currency === "CNY" ? "CN¥" : "$");
  const market = (p.exchange?.includes("HK") || p.exchangeFullName?.includes("Hong")) ? "HK" : "US";
  const price = safeNum(p.price, 100);

  // Parse 52-week range from profile ("140.1-339.8")
  const rangeParts = (p.range || "").split("-").map(Number);
  const high52 = rangeParts.length === 2 && rangeParts[1] > 0 ? rangeParts[1] : price * 1.3;
  const low52 = rangeParts.length === 2 && rangeParts[0] > 0 ? rangeParts[0] : price * 0.7;

  // YTD estimate from change data
  const chgPct = safeNum(p.changePercentage, 0);
  const ytd = chgPct * 3; // rough estimate since we don't have year start price

  // Volatility estimate from beta
  const vol = (safeNum(p.beta, 1.0) * 0.018);

  // Dividend yield
  const divY = safeNum(p.lastDividend, 0) > 0 && price > 0 ? (safeNum(p.lastDividend) / price * 100) : 0;

  // Merge with preset if available
  const preset = PRESETS[ticker];
  const fin = preset ? { ...preset.fin, finAvailable: "preset" } : {
    pe: null, fwdPE: null, pb: null, rev: 0, revG: 0, ni: 0, niG: 0,
    cash: 0, ocf: 0, gm: null, nm: null, roe: null, overR: 0, divY: +divY.toFixed(2), da: 0,
    finAvailable: false,
  };
  // Always override dividend yield with live data
  fin.divY = +divY.toFixed(2);

  const risks = preset?.risks || [
    { t: "市场波动风险", d: "市场整体波动可能影响个股表现", l: "低-中" },
    { t: "宏观环境不确定", d: "需关注宏观经济和行业政策变化", l: "中" },
    { t: "流动性风险", d: "成交量变化可能影响买卖时机", l: "低" },
  ];
  const bulls = preset?.bulls || [
    { t: "实时行情跟踪", d: `当前价 ${cur}${price}，52周区间 ${cur}${low52.toFixed(1)}-${cur}${high52.toFixed(1)}` },
    { t: "市值与行业", d: `${p.companyName || ticker}，${p.sector || ""} / ${p.industry || ""}` },
    { t: "基本面关注", d: `日均成交量 ${fmt(safeNum(p.averageVolume, 0))}，市场关注度${safeNum(p.averageVolume, 0) > 1e7 ? "较高" : "中等"}` },
  ];
  const verdict = preset?.verdict || `${p.companyName || ticker} 当前价 ${cur}${price}，距52周高点 ${(((price - high52) / high52) * 100).toFixed(0)}%。建议结合基本面深入研究后再做投资决策。`;
  const score = preset?.score || 50;
  const rating = preset?.rating || (score >= 70 ? "买入" : score >= 55 ? "持有" : score >= 40 ? "观望" : "回避");
  const sub = preset?.sub || (score >= 70 ? "Accumulate" : score >= 55 ? "Hold" : "Neutral");

  return {
    name: p.companyName || preset?.name || ticker, market, price, cur,
    high52, low52, ytd: +ytd.toFixed(1), vol, fin,
    prices: null, // Will use genPrices in runAnalysis
    peers: preset?.peers || [{ n: "行业均值", pe: 25, pb: 5 }, { n: "同行A", pe: 20, pb: 4 }, { n: "行业均值", pe: 25, pb: 5 }],
    risks: risks.slice(0, 3), bulls: bulls.slice(0, 3), verdict,
    rating, sub, score,
    sent: preset?.sent || { reddit: 50, stocktwits: 45, trend: 50, buzz: 50, rating: "中" },
    cat: preset?.cat || `${p.sector || ""} / ${p.industry || ""}`,
    liveData: { // extra live data from API for display
      volume: p.volume, avgVolume: p.averageVolume, marketCap: p.marketCap,
      beta: p.beta, change: p.change, chgPct, description: p.description,
    },
  };
};

// ═══════════════════ PRESET STOCKS (DEMO FALLBACK) ═══════════════════
const PRESETS = {
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
  const hasHistory = p.prices && p.prices.length >= 20;
  const prices = hasHistory ? p.prices : genPrices(p.price, 80, p.vol);
  const closes = prices.map(d => d.close);

  const sma20 = sma(closes, 20), sma50 = sma(closes, 50);
  const ema10 = ema(closes, 10), ema20 = ema(closes, 20);
  const rsi = calcRSI(closes, 14);
  const macd = calcMACD(closes);
  const atr = calcATR(prices, 14);
  const curATR = atr.filter(v => v != null).pop() || p.price * 0.03;
  const curRSI = rsi.filter(v => v !== null).pop() || 50;
  const curSMA20 = sma20.filter(v => v !== null).pop();
  const curSMA50 = sma50.filter(v => v !== null).pop();
  const curSMA200 = closes.length >= 60 ? closes.slice(0, 60).reduce((a, b) => a + b, 0) / 60 : p.price * 1.05;
  const curMACD = macd.line[macd.line.length - 1];
  const curSignal = macd.signal[macd.signal.length - 1];
  const macdHist = macd.hist[macd.hist.length - 1];
  const avgVol = prices.slice(-20).reduce((s, d) => s + d.volume, 0) / 20;

  const chartLen = Math.min(60, prices.length);
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

  const priceVs52h = p.high52 ? ((p.price - p.high52) / p.high52 * 100) : -20;
  const priceVsSMA200 = curSMA200 ? ((p.price - curSMA200) / curSMA200 * 100) : 0;

  const f = p.fin;
  let fundScore = 50;
  if (f.fwdPE < 20) fundScore += 15; else if (f.fwdPE < 30) fundScore += 5; else fundScore -= 10;
  if (f.revG > 30) fundScore += 15; else if (f.revG > 10) fundScore += 8; else fundScore -= 5;
  if (f.niG > 30) fundScore += 10; else if (f.niG > 0) fundScore += 5; else fundScore -= 10;
  if (f.roe > 25) fundScore += 10; else if (f.roe > 15) fundScore += 5;
  if (f.gm > 50) fundScore += 5;
  fundScore = Math.min(100, Math.max(0, fundScore));

  let techScore = 50;
  if (curRSI > 50 && curRSI < 70) techScore += 10; else if (curRSI > 70) techScore -= 5; else if (curRSI < 30) techScore += 10;
  if (curMACD > curSignal) techScore += 15; else techScore -= 10;
  if (p.price > curSMA20) techScore += 10; else techScore -= 5;
  if (p.price > curSMA50) techScore += 10; else techScore -= 5;
  techScore = Math.min(100, Math.max(0, techScore));

  const posTarget = 1.0;
  const atrPct = (curATR / p.price * 100);
  const overAlloc = atrPct > 4 ? "高ATR，不超配" : atrPct > 2.5 ? "中ATR，标准配" : "低ATR，可超配";
  const entries = [
    { label: "首批", size: 0.40, cond: `当前价 ${p.cur}${(p.price * 0.99).toFixed(0)}-${(p.price * 1.01).toFixed(0)}，或回踩 SMA50 ${curSMA50 ? (curSMA50 * 0.98).toFixed(0) + "-" + (curSMA50 * 1.0).toFixed(0) : "待确认"}` },
    { label: "加码A", size: 0.25, cond: `站稳 EMA10 ${(ema10[ema10.length - 1] || 0).toFixed(1)}，MACD不平 + 放量>${fmt(avgVol)}` },
    { label: "加码B", size: 0.20, cond: `价值区间 ${curSMA50 ? (curSMA50 * 0.85).toFixed(0) + "-" + (curSMA50 * 0.9).toFixed(0) : "待确认"}，深度回调补仓` },
    { label: "储备", size: 0.15, cond: "等待下一财报季验证后再决定" },
  ];
  const triggers = [
    { cond: `跌破 SMA50 (${curSMA50?.toFixed(0) || "?"}) 且缩量`, action: "减半仓，暂停加码，观察支撑位" },
    { cond: `周线收盘跌破 ${curSMA50 ? (curSMA50 * 0.85).toFixed(0) : "?"}`, action: "减仓至≤0.25或清仓" },
    { cond: "下一财报季增速不及预期", action: "降级至减持，确认增速后恢复" },
    { cond: p.risks[0]?.d?.slice(0, 30) + "…", action: "降级目标权重，重新评估逻辑" },
    { cond: `站上 SMA200 (${curSMA200?.toFixed(0) || "?"})`, action: "升级至增持(Overweight)" },
  ];
  const radarData = [
    { dim: "估值", val: f.fwdPE < 20 ? 85 : f.fwdPE < 30 ? 60 : 35 },
    { dim: "成长", val: Math.min(100, Math.max(20, f.revG * 0.8)) },
    { dim: "盈利", val: Math.min(100, f.roe * 1.5) },
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

  return {
    ticker, ...p, prices, chartData, closes, dataSource,
    tech: { sma20: curSMA20, sma50: curSMA50, sma200: curSMA200, ema10: ema10[ema10.length - 1], rsi: curRSI, macd: curMACD, signal: curSignal, hist: macdHist, atr: curATR, atrPct, avgVol, signals, priceVs52h, priceVsSMA200,
      levels: { pivot: +pivot.toFixed(2), s1, s2, s3, r1, r2, r3 } },
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
  <button onClick={onClick} style={{ padding: "8px 18px", borderRadius: 8, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, background: active ? T.blue : "transparent", color: active ? "#fff" : T.muted, transition: "all 0.2s" }}>{label}</button>
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

// ═══════════════════ MAIN COMPONENT ═══════════════════
export default function StockAnalysisTool() {
  const [input, setInput] = useState("9992.HK");
  const [activeTicker, setActiveTicker] = useState("");
  const [tab, setTab] = useState("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [apiKey, setApiKey] = useState(DEFAULT_KEY);
  const [showKey, setShowKey] = useState(false);
  const [sentiment, setSentiment] = useState(null);
  const [macro, setMacro] = useState(null);
  const [news, setNews] = useState(null);
  const [finData, setFinData] = useState(null);
  const [dataStatus, setDataStatus] = useState([]);

  const doAnalyze = useCallback(async (ticker) => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;
    setLoading(true); setError(""); setActiveTicker(t); setTab("overview");
    setSentiment(null); setMacro(null); setNews(null); setFinData(null); setDataStatus([]);

    let stockData = null, dataSource = "demo";
    const status = [];

    // 1. Try FMP profile API for live price data
    if (apiKey) {
      try {
        const apiResult = await fmpFetchProfile(t, apiKey);
        if (apiResult?.profile) {
          stockData = mergeLiveWithPreset(t, apiResult.profile);
          dataSource = "live";
        }
      } catch (e) {
        console.warn("FMP API failed:", e.message);
      }
    }

    // 2. Fallback to presets
    if (!stockData && PRESETS[t]) {
      stockData = PRESETS[t];
      dataSource = "demo";
    }

    if (!stockData) {
      setError(`无法找到 "${t}" 的数据。请检查股票代码是否正确，或确认 API Key 有效。支持的预设标的: ${Object.keys(PRESETS).join(", ")}`);
      setLoading(false);
      setResult(null);
      return;
    }

    const analysis = runAnalysis(t, stockData, dataSource);
    setResult(analysis);

    // 4. Fetch external data (sentiment, macro, news, financials) in parallel
    status.push({ name: "FMP 行情", ok: dataSource === "live", note: dataSource === "live" ? "实时价格/52周/市值" : "预设数据" });
    status.push({ name: "技术指标", ok: true, note: "本地计算 (SMA/EMA/RSI/MACD/ATR)" });

    const [sent, mac, nws, fin] = await Promise.all([
      fetchSentiment(t),
      fetchMacro(),
      fetchNews(stockData.name?.split(" ")[0] || t),
      fetchFinancials(t),
    ]);

    setSentiment(sent);
    status.push({ name: "社交情绪", ok: sent.ok, note: sent.ok ? `StockTwits ${sent.count}帖, Bullish ${sent.bullPct}%` : sent.error });

    setMacro(mac);
    status.push({ name: "宏观数据", ok: mac.ok, note: mac.ok ? `10Y ${mac.yield10y}, FedFunds ${mac.fedFunds}` : mac.error });

    setNews(nws);
    status.push({ name: "新闻", ok: nws.ok, note: nws.ok ? `${nws.total}条相关新闻` : nws.error });

    // 5. Merge real financials into analysis if available
    if (fin.ok && fin.eps > 0 && analysis.price > 0) {
      setFinData(fin);
      const realPE = +(analysis.price / fin.eps).toFixed(1);
      const fwdEPS = fin.eps * (1 + fin.epsGrowth / 100);
      const realFwdPE = fwdEPS > 0 ? +(analysis.price / fwdEPS).toFixed(1) : realPE;
      const bookValuePS = fin.roe > 0 ? (fin.eps / (fin.roe / 100)) : 0;
      const realPB = bookValuePS > 0 ? +(analysis.price / bookValuePS).toFixed(1) : 0;

      // Override fin data in analysis result
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
        ocf: fin.revenue * 0.4, // estimate
        cash: fin.netIncome * 0.7, // estimate
        finAvailable: "live",
      };
      const updatedAnalysis = { ...analysis, fin: updatedFin, finSource: "live" };
      setResult(updatedAnalysis);
      status.push({ name: "财务报表", ok: true, note: `PE ${realPE}x, 营收 ${fmt(fin.revenue)}, EPS $${fin.eps.toFixed(2)}` });
    } else {
      setFinData(null);
      const hasPreset = !!PRESETS[t];
      status.push({ name: "财务报表", ok: hasPreset, note: hasPreset ? "预设数据" : (fin.error ? fin.error : `${t} 财务报表需 FMP 付费套餐`) });
    }
    status.push({ name: "分析师预测", ok: false, note: "需FMP付费套餐" });

    setDataStatus(status);
    setLoading(false);
  }, [apiKey]);

  const doSearch = () => doAnalyze(input);
  const tabs = [
    { key: "overview", label: "概览" }, { key: "fundamental", label: "基本面" },
    { key: "technical", label: "技术面" }, { key: "position", label: "仓位 & 风控" },
    { key: "sentiment", label: "情绪" }, { key: "report", label: "综合报告" },
  ];
  const tip = { background: T.cardAlt, border: `1px solid ${T.border}`, borderRadius: 6, fontSize: 12, color: T.text };

  return (
    <div style={{ background: T.bg, color: T.text, fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace", minHeight: "100vh", padding: "20px 24px", maxWidth: 1100, margin: "0 auto" }}>

      {/* HEADER */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: T.blue }}>StockAnalyzer</span>
        <span style={{ fontSize: 12, color: T.dim, background: T.card, padding: "2px 8px", borderRadius: 4 }}>v2.1</span>
        <span style={{ fontSize: 11, color: T.dim }}>多维度股票监测评估系统</span>
        {result && <Badge text={result.dataSource === "live" ? (result.finSource === "live" ? "实时行情 + 实时财务" : "实时行情 + 预设财务") : "演示数据"} color={result.dataSource === "live" ? T.green : T.yellow} />}
      </div>

      {/* API KEY SETTINGS */}
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setShowKey(!showKey)} style={{ background: "none", border: "none", color: T.dim, fontSize: 11, cursor: "pointer", padding: 0 }}>
          {showKey ? "▾" : "▸"} API 设置 {apiKey ? "(已配置)" : "(未配置)"}
        </button>
        {showKey && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input value={apiKey} onChange={e => setApiKey(e.target.value)}
              placeholder="输入 FMP API Key (financialmodelingprep.com 免费注册)"
              style={{ flex: 1, minWidth: 260, padding: "6px 10px", borderRadius: 6, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 12, fontFamily: "inherit", outline: "none" }}
            />
            <span style={{ fontSize: 10, color: T.dim }}>Key 仅存于浏览器内存</span>
          </div>
        )}
      </div>

      {/* SEARCH */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && doSearch()}
          placeholder="输入任意股票代码，如 AAPL, NVDA, 9992.HK, 0700.HK, MSFT ..."
          style={{ flex: 1, minWidth: 220, padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.card, color: T.text, fontSize: 14, fontFamily: "inherit", outline: "none" }}
        />
        <button onClick={doSearch} disabled={loading}
          style={{ padding: "10px 24px", borderRadius: 8, border: "none", background: loading ? T.dim : T.blue, color: "#fff", fontWeight: 700, cursor: loading ? "wait" : "pointer", fontSize: 14, minWidth: 80 }}>
          {loading ? "分析中..." : "分析"}
        </button>
      </div>

      {/* Quick Picks */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 20 }}>
        <span style={{ fontSize: 11, color: T.dim, lineHeight: "28px" }}>快速选择:</span>
        {Object.entries(PRESETS).map(([k, v]) => (
          <button key={k} onClick={() => { setInput(k); doAnalyze(k); }}
            style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${activeTicker === k ? T.blue : T.border}`, background: activeTicker === k ? T.blue + "22" : "transparent", color: activeTicker === k ? T.blue : T.muted, fontSize: 12, cursor: "pointer", fontWeight: activeTicker === k ? 700 : 400 }}>
            {k} {v.name.split(" ")[0]}
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
                {result.finSource === "live" ? " · 财务指标来自 FMP 实时报表" : " · 财务指标来自预设库"}
                · {new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}
              </div>
            ) : (
              <div style={{ padding: "6px 14px", borderRadius: 8, background: T.yellow + "15", border: `1px solid ${T.yellow}33`, fontSize: 12, color: T.yellow }}>
                演示数据 · API 请求失败或 Key 无效，已回退到预设数据 · 请检查 API Key 或网络
              </div>
            )}
          </div>

          {/* STOCK HEADER */}
          <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.card}, ${T.cardAlt})` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <span style={{ fontSize: 22, fontWeight: 800 }}>{result.ticker}</span>
                  <Badge text={result.market === "US" ? "美股" : "港股"} color={T.blue} />
                  <Badge text={result.cat} color={T.purple} />
                </div>
                <div style={{ fontSize: 15, color: T.muted, marginBottom: 8 }}>{result.name}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 36, fontWeight: 800, color: T.text }}>{result.cur}{result.price?.toFixed(2)}</span>
                  {result.liveData?.change != null && (
                    <span style={{ fontSize: 14, color: result.liveData.change < 0 ? T.red : T.green, fontWeight: 600 }}>
                      {result.liveData.change > 0 ? "+" : ""}{result.liveData.change?.toFixed(2)} ({result.liveData.chgPct?.toFixed(2)}%)
                    </span>
                  )}
                  <span style={{ fontSize: 14, color: result.ytd < 0 ? T.red : T.green, fontWeight: 600 }}>YTD {pct(result.ytd)}</span>
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
              </div>
            </div>
          </Card>

          {/* TABS */}
          <div style={{ display: "flex", gap: 4, marginBottom: 16, background: T.card, padding: 4, borderRadius: 10, flexWrap: "wrap" }}>
            {tabs.map(t => <TabBtn key={t.key} label={t.label} active={tab === t.key} onClick={() => setTab(t.key)} />)}
          </div>

          {/* ═══ OVERVIEW ═══ */}
          {tab === "overview" && (
            <div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                <MetricCard label="Forward PE" value={result.fin.fwdPE != null ? result.fin.fwdPE + "x" : "N/A"} sub={`行业 ${result.peers[2]?.pe || "-"}x`} color={result.fin.fwdPE != null && result.fin.fwdPE < 25 ? T.green : result.fin.fwdPE != null ? T.yellow : T.dim} highlight={T.blue} />
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
                  <ResponsiveContainer width="100%" height={240}>
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
          )}

          {/* ═══ FUNDAMENTAL ═══ */}
          {tab === "fundamental" && (
            <div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4B0;">估值指标</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {[
                      { l: "PE (TTM)", v: result.fin.pe != null ? result.fin.pe + "x" : "N/A" },
                      { l: "Forward PE", v: result.fin.fwdPE != null ? result.fin.fwdPE + "x" : "N/A", hl: T.blue },
                      { l: "PB", v: result.fin.pb != null ? result.fin.pb + "x" : "N/A" },
                      { l: "股息率", v: result.fin.divY.toFixed(2) + "%" },
                      { l: "ROE", v: result.fin.roe != null ? result.fin.roe.toFixed(1) + "%" : "N/A" },
                      { l: "毛利率", v: result.fin.gm != null ? result.fin.gm.toFixed(1) + "%" : "N/A" },
                    ].map((m, i) => (
                      <div key={i} style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8, borderLeft: m.hl ? `3px solid ${m.hl}` : "none" }}>
                        <div style={{ fontSize: 11, color: T.muted }}>{m.l}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{m.v}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 10, padding: 10, background: T.cardAlt, borderRadius: 8 }}>
                    <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>基本面评分</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ flex: 1, height: 8, background: T.border, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ width: `${result.fundScore}%`, height: "100%", background: result.fundScore >= 65 ? T.green : result.fundScore >= 45 ? T.yellow : T.red, borderRadius: 4, transition: "width 0.5s" }} />
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 800, color: result.fundScore >= 65 ? T.green : T.yellow }}>{result.fundScore}</span>
                    </div>
                  </div>
                </Card>
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4CA;">增长与盈利</SectionTitle>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
                      <div style={{ fontSize: 11, color: T.muted }}>经营现金流</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{result.cur}{fmt(result.fin.ocf)}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>净现金</div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: result.fin.cash > 0 ? T.green : T.red }}>{result.cur}{fmt(result.fin.cash)}</div>
                    </div>
                    <div style={{ background: T.cardAlt, padding: "10px 12px", borderRadius: 8 }}>
                      <div style={{ fontSize: 11, color: T.muted }}>负债/资产</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{(result.fin.da / Math.max(result.fin.rev, 1) * 100).toFixed(0)}%</div>
                    </div>
                  </div>
                </Card>
              </div>
              <Card>
                <SectionTitle icon="&#x1F50D;">可比公司估值对比</SectionTitle>
                <ResponsiveContainer width="100%" height={220}>
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
          )}

          {/* ═══ TECHNICAL ═══ */}
          {tab === "technical" && (
            <div>
              <Card style={{ marginBottom: 16 }}>
                <SectionTitle icon="&#x1F4C8;">价格走势 & 均线系统 {result.dataSource === "live" && <Badge text="实时K线" color={T.green} />}</SectionTitle>
                <ResponsiveContainer width="100%" height={300}>
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
                </div>
              </Card>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                <Card style={{ flex: "1 1 45%", minWidth: 300 }}>
                  <SectionTitle icon="&#x1F4CA;">RSI (14)</SectionTitle>
                  <ResponsiveContainer width="100%" height={160}>
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
                  <ResponsiveContainer width="100%" height={160}>
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
                <SectionTitle icon="&#x2699;&#xFE0F;">技术指标总结</SectionTitle>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
                  {[
                    { l: "ATR (14)", v: result.tech.atr.toFixed(2), s: `(${result.tech.atrPct.toFixed(1)}%)`, c: result.tech.atrPct > 4 ? T.red : T.yellow },
                    { l: "vs 52周高", v: pct(result.tech.priceVs52h), s: result.cur + result.high52?.toFixed(1), c: T.red },
                    { l: "vs SMA200", v: pct(result.tech.priceVsSMA200), s: result.tech.sma200?.toFixed(0), c: result.tech.priceVsSMA200 > 0 ? T.green : T.red },
                    { l: "20日均量", v: fmt(result.tech.avgVol), s: "股/日", c: T.text },
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
                    经典 Pivot 计算: P = (H+L+C)/3 · 证据强度: <Badge text="中" color={T.yellow} /> (基于日线级别)
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* ═══ POSITION ═══ */}
          {tab === "position" && (
            <div>
              <Card style={{ marginBottom: 16, background: `linear-gradient(135deg, ${T.card}, #1a2744)` }}>
                <SectionTitle icon="&#x1F3AF;">仓位计划 (总目标 = 1.0 单位, 中等仓)</SectionTitle>
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 14 }}>ATR {result.tech.atrPct.toFixed(1)}% → {result.pos.overAlloc}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {result.pos.entries.map((e, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: T.cardAlt, padding: "12px 14px", borderRadius: 8 }}>
                      <div style={{ minWidth: 60 }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: [T.blue, T.green, T.yellow, T.muted][i] }}>{e.label}</div>
                        <div style={{ fontSize: 20, fontWeight: 800, color: T.text }}>{e.size.toFixed(2)}</div>
                      </div>
                      <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>{e.cond}</div>
                    </div>
                  ))}
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
                  {result.pos.triggers.map((t, i) => (
                    <div key={i} style={{ display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", background: T.cardAlt, borderRadius: 8, borderLeft: `3px solid ${i < 2 ? T.red : i === 4 ? T.green : T.yellow}` }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: i < 2 ? T.red : i === 4 ? T.green : T.yellow, minWidth: 20 }}>{i + 1}.</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 2 }}>{t.cond}</div>
                        <div style={{ fontSize: 12, color: T.muted }}>→ {t.action}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}

          {/* ═══ SENTIMENT ═══ */}
          {tab === "sentiment" && (
            <div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                {/* StockTwits Real Sentiment */}
                <Card style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <SectionTitle icon="&#x1F4AC;">社交情绪 (StockTwits)</SectionTitle>
                  {sentiment ? (
                    sentiment.ok ? (
                      <>
                        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                          <div style={{ flex: 1, background: T.green + "15", border: `1px solid ${T.green}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: 24, fontWeight: 800, color: T.green }}>{sentiment.bullPct}%</div>
                            <div style={{ fontSize: 11, color: T.muted }}>Bullish ({sentiment.bullish}帖)</div>
                          </div>
                          <div style={{ flex: 1, background: T.red + "15", border: `1px solid ${T.red}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: 24, fontWeight: 800, color: T.red }}>{sentiment.bearPct}%</div>
                            <div style={{ fontSize: 11, color: T.muted }}>Bearish ({sentiment.bearish}帖)</div>
                          </div>
                          <div style={{ flex: 1, background: T.blue + "15", border: `1px solid ${T.blue}33`, borderRadius: 8, padding: "10px 12px", textAlign: "center" }}>
                            <div style={{ fontSize: 24, fontWeight: 800, color: T.blue }}>{sentiment.count}</div>
                            <div style={{ fontSize: 11, color: T.muted }}>总帖子</div>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: 1 }}>
                            <div style={{ fontSize: 11, color: T.muted }}>情绪方向</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: sentiment.direction === "偏多" ? T.green : sentiment.direction === "偏空" ? T.red : T.yellow }}>{sentiment.direction}</div>
                          </div>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: 1 }}>
                            <div style={{ fontSize: 11, color: T.muted }}>讨论热度</div>
                            <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{sentiment.crowdedness}</div>
                          </div>
                          <div style={{ background: T.cardAlt, padding: "8px 12px", borderRadius: 8, flex: 1 }}>
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
                  <div style={{ marginTop: 10, fontSize: 10, color: T.dim }}>来源: {sentiment?.source || "StockTwits 公开API"} · 证据强度: <Badge text={sentiment?.strength || "低"} color={sentiment?.strength === "中" ? T.yellow : T.dim} /></div>
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
                          <Badge text="证据: 中" color={T.yellow} />
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
                  FMP 免费套餐仅支持实时行情(Profile)。财务报表/历史价格/分析师预测需升级付费套餐后启用。
                </div>
              </Card>
            </div>
          )}

          {/* ═══ REPORT ═══ */}
          {tab === "report" && (
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
                  {new Date().toISOString().slice(0, 10)} · {result.cur}{result.price?.toFixed(2)} {result.dataSource === "live" ? "(实时)" : "(演示)"} · 距52周高 {pct(result.tech.priceVs52h)} · YTD {pct(result.ytd)}
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

              {/* Bull/Bear Debate */}
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                {/* Bull Case */}
                <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ color: T.green, fontSize: 16 }}>&#x1F7E2;</span>
                    <span style={{ color: T.green, fontWeight: 700, fontSize: 14 }}>多头观点 (Bull Case)</span>
                  </div>
                  {result.bulls.map((b, i) => (
                    <div key={i} style={{ padding: "8px 12px", background: T.green + "08", borderRadius: 6, marginBottom: 6, borderLeft: `2px solid ${T.green}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: T.text }}>{b.t}</span>
                        <Badge text={i === 0 ? "证据: 高" : i === 1 ? "证据: 中-高" : "证据: 中"} color={i === 0 ? T.green : T.yellow} />
                      </div>
                      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>{b.d}</div>
                    </div>
                  ))}
                </div>

                {/* Bear Case */}
                <div style={{ flex: "1 1 300px", minWidth: 260 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <span style={{ color: T.red, fontSize: 16 }}>&#x1F534;</span>
                    <span style={{ color: T.red, fontWeight: 700, fontSize: 14 }}>空头观点 (Bear Case)</span>
                  </div>
                  {result.risks.map((r, i) => (
                    <div key={i} style={{ padding: "8px 12px", background: T.red + "08", borderRadius: 6, marginBottom: 6, borderLeft: `2px solid ${T.red}` }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, color: T.text }}>{r.t}</span>
                        <RiskBadge level={r.l} />
                      </div>
                      <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6 }}>{r.d}</div>
                    </div>
                  ))}
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
                  {dataStatus.length > 0 && dataStatus.map((s, i) => (
                    <span key={i} style={{ marginLeft: 6 }}>
                      <span style={{ color: s.ok ? T.green : T.dim }}>{s.ok ? "\u2713" : "\u25CB"}</span> {s.name}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: T.dim, marginTop: 6 }}>
                  <span style={{ color: T.yellow }}>&#x26A0;</span> FMP 免费套餐限制: 仅支持 Profile(实时行情)。财务报表/历史K线/分析师预测需升级付费套餐。技术指标基于模拟K线计算，仅供趋势参考。
                </div>
              </div>

              <div style={{ marginTop: 8, color: T.dim, fontSize: 11 }}>
                本报告由 StockAnalyzer 自动生成 · 仅供参考，不构成投资建议 · 投资有风险，入市需谨慎
              </div>
            </Card>
          )}
        </>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", padding: "20px 0 8px", fontSize: 11, color: T.dim }}>
        StockAnalyzer v2.1 · 数据来源: FMP(行情) · FRED(宏观) · StockTwits(情绪) · NewsAPI(新闻) · 仅供参考，不构成投资建议
      </div>
    </div>
  );
}
