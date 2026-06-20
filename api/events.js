import { FMP_KEY, FMP_BASE, FRED_KEY, FRED_BASE, fetchJSON, setCORS, validateSymbol } from "./_lib.js";

export default async function handler(req, res) {
  const { symbol } = req.query;
  const err = validateSymbol(symbol);
  if (err) return res.status(400).json({ ok: false, error: err });

  try {
    const today = new Date();
    const fmtDate = (d) => d.toISOString().slice(0, 10);

    const calendarEnd = new Date(today);
    calendarEnd.setDate(calendarEnd.getDate() + 60);

    // One FMP calendar request replaces up to 30 day-by-day Nasdaq requests.
    const [earningsCalendar, cpiRes, ppiRes, unrateRes, payRes, fomcRes] = await Promise.all([
      fetchJSON(`${FMP_BASE}/earnings-calendar?from=${fmtDate(today)}&to=${fmtDate(calendarEnd)}&apikey=${FMP_KEY}`),
      fetchJSON(`${FRED_BASE}/series/observations?series_id=CPIAUCSL&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=14`),
      fetchJSON(`${FRED_BASE}/series/observations?series_id=PPIACO&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=14`),
      fetchJSON(`${FRED_BASE}/series/observations?series_id=UNRATE&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED_BASE}/series/observations?series_id=PAYEMS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
      fetchJSON(`${FRED_BASE}/series/observations?series_id=FEDFUNDS&api_key=${FRED_KEY}&file_type=json&sort_order=desc&limit=3`),
    ]);

    const calendarMatch = Array.isArray(earningsCalendar)
      ? earningsCalendar.find((row) => String(row.symbol || "").toUpperCase() === String(symbol).toUpperCase())
      : null;
    let earnings = calendarMatch
      ? {
          date: calendarMatch.date || null,
          estimated: false,
          hour: calendarMatch.time === "amc" ? "盘后" : calendarMatch.time === "bmo" ? "盘前" : "TBD",
          epsForecast: calendarMatch.epsEstimated ?? null,
          revenueForecast: calendarMatch.revenueEstimated ?? null,
          fiscalQuarterEnding: calendarMatch.fiscalDateEnding || null,
          source: "FMP earnings-calendar",
        }
      : null;

    // FRED provides observations, not an authoritative future release calendar.
    // Keep this empty until dates are fetched from the official Fed/BLS calendars.
    const macroEvents = [];

    // --- 3. Latest economic indicators with YoY ---
    const indicators = {};
    const parseLatest = (res) => {
      if (!res?.observations?.length) return null;
      const obs = res.observations;
      const latest = obs[0];
      const prev = obs[1] || obs[0];
      if (!latest?.value || latest.value === ".") return null;
      const v = parseFloat(latest.value);
      const pv = parseFloat(prev?.value || latest.value);
      return { value: v, prev: pv, change: +(v - pv).toFixed(2), date: latest.date };
    };

    const parseYoY = (res) => {
      if (!res?.observations?.length) return null;
      const obs = res.observations;
      const latest = obs[0];
      const yearAgo = obs[12] || null;
      if (!latest?.value || latest.value === ".") return null;
      const v = parseFloat(latest.value);
      const yv = yearAgo ? parseFloat(yearAgo.value) : v;
      const yoy = yv > 0 ? +((v - yv) / yv * 100).toFixed(1) : null;
      const prev = obs[1] || latest;
      const pv = parseFloat(prev?.value || latest.value);
      const mom = pv > 0 ? +((v - pv) / pv * 100).toFixed(2) : null;
      return { value: +v.toFixed(1), yoy, mom, date: latest.date };
    };

    const cpi = parseYoY(cpiRes);
    const ppi = parseYoY(ppiRes);
    const unrate = parseLatest(unrateRes);
    const pay = parseLatest(payRes);
    const ff = parseLatest(fomcRes);

    if (cpi) indicators.cpi = { value: cpi.value, yoy: cpi.yoy === null ? null : cpi.yoy + "%", mom: cpi.mom, date: cpi.date, label: "CPI 指数", unit: "", desc: cpi.yoy > 3 ? "\u504F\u9AD8\uFF0C\u6210\u957F\u80A1\u4F30\u503C\u627F\u538B" : cpi.yoy > 2 ? "\u6E29\u548C" : "\u4F4E\u8FF7" };
    if (ppi) indicators.ppi = { value: ppi.value, yoy: ppi.yoy === null ? null : ppi.yoy + "%", mom: ppi.mom, date: ppi.date, label: "PPI 指数", unit: "", desc: ppi.yoy > 4 ? "\u751F\u4EA7\u7AEF\u901A\u80C0\u538B\u529B" : ppi.yoy > 2 ? "\u751F\u4EA7\u7AEF\u6E29\u548C" : "\u751F\u4EA7\u7AEF\u4F4E\u8FF7" };
    if (unrate) indicators.unemployment = { value: unrate.value, change: unrate.change, date: unrate.date, label: "\u5931\u4E1A\u7387", unit: "%", desc: unrate.value > 5 ? "\u52B3\u52A8\u5E02\u573A\u964D\u6E29" : "\u52B3\u52A8\u5E02\u573A\u7A33\u5065" };
    if (pay) indicators.nonfarm = { value: pay.value, change: pay.change, date: pay.date, label: "\u975E\u519C\u5C31\u4E1A", unit: "\u5343\u4EBA", desc: pay.change > 100 ? "\u5C31\u4E1A\u5F3A\u52B2" : pay.change > 0 ? "\u5C31\u4E1A\u7A33\u5B9A" : "\u5C31\u4E1A\u8D70\u5F31" };
    if (ff) indicators.fedFunds = { value: ff.value, date: ff.date, label: "Fed Funds", unit: "%", desc: "" };

    setCORS(res);
    res.status(200).json({
      ok: true,
      earnings,
      macroEvents: macroEvents.slice(0, 8),
      indicators,
      calendarPolicy: "未来宏观事件日期未接入官方日历时保持为空，不进行日期猜测。",
      generatedAt: fmtDate(today),
    });
  } catch (e) {
    setCORS(res);
    res.status(200).json({ ok: false, error: e.message });
  }
}
