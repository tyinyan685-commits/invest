## StockAnalyzer 技术文档

StockAnalyzer 是一个多维度股票监测评估系统，集成实时行情、财务报表、技术指标、社交情绪和宏观数据，通过量化评分模型生成综合评级。部署于 Vercel，支持美股和港股。


### 技术栈

前端框架为 React 18，图表库使用 Recharts，构建工具为 Vite 6。后端无独立服务，所有 API 调用通过 Vercel Serverless Functions 代理外部数据源，解决浏览器 CORS 限制。运行时依赖仅三个包：react、react-dom、recharts。

Node.js 版本要求 18+（Vercel 运行时），本地开发使用 Vite 内置的 localApiPlugin 中间件模拟 Vercel Serverless 环境，确保本地和线上共享同一套 API 代码。


### 项目结构

```
invest-app/
├── index.html                 # SPA 入口（zh-CN）
├── package.json               # stock-analyzer v2.0.0
├── vite.config.js             # Vite 配置 + localApiPlugin 本地代理
├── vercel.json                # Vercel 部署配置 + SPA 路由重写
├── start.sh                   # 一键启动开发环境（含 Futu Bridge）
├── api/                       # Vercel Serverless Functions（7个端点 + 1个共享库）
│   ├── _lib.js                # API Key 配置、fetch 封装、CORS、symbol 校验
│   ├── profile.js             # 公司概况（FMP /profile，回退 /quote）
│   ├── history.js             # 历史 K 线（FMP /historical-price-eod/full）
│   ├── financials.js          # 财务报表（FMP 7个并行请求）
│   ├── sentiment.js           # 社交情绪（StockTwits 公开 API）
│   ├── news.js                # 新闻（NewsAPI /v2/everything）
│   ├── macro.js               # 宏观数据（FRED：10Y 国债 + 联邦基金利率）
│   └── events.js              # 事件日历（Nasdaq 财报 + FRED 经济指标）
├── futu-bridge/               # Python Flask 期权 IV 桥接（可选，本地运行）
│   ├── server.py
│   ├── requirements.txt
│   └── README.md
└── src/
    ├── main.jsx               # React 入口
    └── App.jsx                # 整个应用（约 2200 行，单文件架构）
```

整个前端逻辑集中在 `src/App.jsx` 一个文件中，包含所有组件、状态管理、数据获取、评分计算和 UI 渲染。采用内联样式（`style` 属性）而非 CSS 文件，主题色定义在文件顶部的 `T` 常量对象中。


### 外部数据源

| 数据源 | 用途 | 是否需要 Key | API 端点 |
|--------|------|-------------|----------|
| Financial Modeling Prep (FMP) | 行情、财务、历史K线、分析师目标价 | 是（FMP_API_KEY） | /api/profile, /api/history, /api/financials |
| FRED (美联储经济数据) | 10Y国债收益率、联邦基金利率 | 是（FRED_API_KEY） | /api/macro |
| NewsAPI | 新闻文章搜索 | 是（NEWSAPI_KEY） | /api/news |
| StockTwits | 社交情绪（看多/看空比例） | 否（公开API） | /api/sentiment |
| Nasdaq | 财报日历 | 否（公开API） | /api/events（内部调用） |
| Futu OpenD（可选） | 期权隐含波动率 | 否（本地桥接） | localhost:9876 |

三个 API Key 全部通过 Vercel 环境变量配置，代码中无硬编码回退值，前端也不提供 API Key 输入框。未配置时端点返回明确的中文错误提示。


### 统一评级 API

`GET /api/rating?symbol=AAPL` 是分析站和选股雷达共同使用的权威评级接口。它在服务端并行读取 FMP 公司、行情、年度财报、TTM 指标、分析师预期和真实历史价格，并读取 StockTwits 已标注情绪。

接口不会生成或使用模拟 K 线。单项数据缺失时，该指标按中性处理，同时降低 `confidence`；可信度低于 50% 时返回“数据不足”，避免把残缺数据包装成精确结论。返回内容包括综合分、评级、三个分项、每项打分明细、数据可信度、模型版本和数据日期。

当前模型版本为 `2026-06-20-v1`。评级用于研究排序，不是自动交易指令。


### 数据流架构

整个分析流程由 `doAnalyze(ticker)` 函数编排，执行步骤如下：

**第一步：获取公司概况。** 调用 `fetchProfile(ticker)` 获取实时价格、52周区间、市值等基础数据。成功后 `dataSource` 标记为 `"live"`，失败则回退到预设数据（`dataSource = "demo"`）。

**第二步：合并数据。** `mergeLiveWithPreset(ticker, profile)` 将实时行情与预设基本面数据合并。如果股票在 PRESETS 中有预设（如 AAPL、NVDA），财务指标暂用预设值（标记 `finAvailable: "preset"`）；如果不在预设中，财务字段全部置空。

**第三步：首次技术分析。** `runAnalysis(ticker, stockData, dataSource)` 计算技术指标（SMA/EMA/RSI/MACD/ATR/布林带/VWMA）、支撑阻力位、情景分析。如果没有真实历史K线（`prices` 为 null），使用确定性伪随机数生成器（mulberry32，以 ticker 字符串为种子）生成模拟K线。

**第四步：并行获取补充数据。** 同时发起 6 个请求：情绪（StockTwits）、宏观（FRED）、新闻（NewsAPI）、财务报表（FMP 7个并行）、历史K线（FMP）、事件日历（Nasdaq+FRED）。

**第五步：合并真实数据。** 如果历史K线 ≥30 条，替换模拟数据并重新运行 `runAnalysis`；如果财务报表成功且 EPS 不为 null，用真实数据覆盖预设财务，重新计算基本面评分和综合评分；用 StockTwits 真实 bullPct 替换预设情绪值。

**第六步：统一渲染。** 所有数据合并完成后调用一次 `setResult(analysis)` 和 `setDataStatus(status)`，避免 UI 闪烁。


### 评分体系

综合评分由三个维度加权计算：

**基本面评分（权重 45%）** 以 50 分为基准，根据以下指标加减分：FwdPE < 20 加 15 分、< 30 加 5 分、≥ 30 减 10 分；营收增速 > 30% 加 15 分、> 10% 加 8 分、否则减 5 分；净利润增速 > 30% 加 10 分、> 0 加 5 分、否则减 10 分；ROE > 25% 加 10 分、> 15% 加 5 分；毛利率 > 50% 加 5 分。结果限制在 0-100 范围内。如果 FwdPE 为 null（如亏损公司），基本面评分返回 null，不参与综合评分。

**技术面评分（权重 40%）** 以 50 分为基准：RSI 在 50-70 加 10 分、> 70（超买）减 5 分、< 30（超卖）加 10 分；MACD 金叉加 15 分、死叉减 10 分；价格站上 SMA20 加 10 分、否则减 5 分；价格站上 SMA50 加 10 分、否则减 5 分。范围同样 0-100。

**情绪评分（权重 15%）** 取 StockTwits 看多比例（0-100）作为 buzz 值。数据不足时默认取 50（中性）。

**综合评分公式：** `50 + (fundScore - 50) × 0.45 + (techScore - 50) × 0.40 + (sentBuzz - 50) × 0.15`，结果四舍五入取整并限制在 0-100。

**评级映射：** ≥ 70 分 → 买入 (Accumulate)，55-69 → 持有 (Hold)，40-54 → 观望 (Neutral)，< 40 → 回避 (Avoid)。

雷达图展示六个维度：估值（基于 FwdPE）、成长（营收增速 × 0.8）、盈利（ROE × 1.5）、技术面（techScore）、情绪（buzz）、安全边际（距 52 周高点距离 × 1.5）。


### 技术指标计算

所有技术指标均在客户端 `runAnalysis` 函数中计算，基于历史K线的收盘价数组：

SMA（简单移动平均线）使用滚动窗口求均值，计算 SMA20、SMA50 和 SMA200。EMA（指数移动平均线）使用标准平滑系数 k = 2/(p+1)，初始值取首个数据点，计算 EMA10 和 EMA20。

RSI（相对强弱指数）采用 Wilder 平滑法的简单均值变体：先计算每日涨跌幅，分离涨幅和跌幅，取 14 期简单平均，RSI = 100 - 100/(1 + avgGain/avgloss)。当平均损失为零时 RSI 设为 100。

MACD 由三部分组成：MACD 线 = EMA12 - EMA26，信号线 = MACD 线的 EMA9（从第 25 个数据点开始计算），柱状图 = MACD 线 - 信号线。前 25 个周期的信号线和柱状图为 null。

ATR（平均真实波幅）先计算每日 True Range = max(high-low, |high-prevClose|, |low-prevClose|)，再取 14 期简单平均。

布林带使用 20 日收盘价的均值和 2 倍标准差（总体标准差）构建上轨和下轨。VWMA（成交量加权移动平均线）对 20 日收盘价按成交量加权求均值。

支撑阻力位采用经典 Pivot Point 公式：Pivot = (H+L+C)/3，S1 = 2P-H，R1 = 2P-L，S2 = P-(H-L)，R2 = P+(H-L)，S3 = L-2(H-P)，R3 = H+2(P-L)。


### 模拟数据机制

当 FMP 历史K线 API 返回数据不足 30 条时（常见于港股或新上市股票），系统使用确定性伪随机数生成模拟K线：

种子生成：将 ticker 字符串通过 `seedHash` 函数转为 32 位无符号整数。PRNG 算法为 mulberry32，保证同一 ticker 每次生成完全相同的K线。

模拟K线生成 80 根日线，日期标记为 D-79 到 D-0（相对日期，非真实日历日期），包含开高低收和随机成交量。最后一根K线的收盘价强制设为当前真实价格，确保图表终点与实际价格一致。

**标识机制：** 当使用模拟K线时，页面顶部显示红色警告横幅，图表标题处显示红色"模拟K线（非真实行情）"标识，技术指标区域显示红色"模拟数据"Badge，数据完整度面板标注"基于模拟K线，仅供趋势参考"。


### URL 参数跳转

支持通过 URL query 参数 `?symbol=` 自动触发分析，用于从外部系统（如 wiseain.com 选股平台）的深度研判按钮跳转。

页面加载时 `useEffect` 读取 `window.location.search` 中的 `symbol` 参数，校验格式后自动填入搜索框并调用 `doAnalyze`。跳转链接格式：`https://stocks.wiseain.com/?symbol=AAPL`。


### 预设股票数据

PRESETS 对象包含 5 只预设股票的基本面数据（泡泡玛特 9992.HK、苹果 AAPL、特斯拉 TSLA、英伟达 NVDA、腾讯 0700.HK）。当 API 请求失败时，这些预设数据作为回退展示。

每只预设包含：硬编码的财务指标（PE/PB/营收/增速等）、可比公司（3 家）、风险点（3 条）、看多理由（3 条）、投资结论、评分和评级、情绪预设值。预设财务数据会标注"预设参考值"黄色 Badge，与实时数据区分。

当 API 成功获取实时行情但财务数据 API 失败时，预设股票会使用预设财务数据（标记 `finAvailable: "preset"`），非预设股票的财务字段全部为 null（显示 N/A）。


### 移动端适配

响应式设计采用 640px 断点，通过 `useIsMobile` Hook 监听 `window.matchMedia` 实现。主要适配措施包括：容器内边距缩小（20px → 12px）、标题和价格字号缩小、搜索框最小宽度自适应、图表高度降低（300px → 220px）、双栏网格变单栏、Tab 栏横向滚动、表格横向滚动。

CSS 媒体查询补充处理：Tab 按钮不换行且可滚动（隐藏滚动条）、表格容器 overflow-x auto、Recharts 图表高度覆盖。


### Tab 缓存策略

6 个 Tab 页（概览、基本面、技术面、仓位、情绪、报告）使用 CSS `display: none/block` 切换而非 React 条件渲染。这样切换 Tab 时 Recharts 图表不会卸载和重新挂载，避免不必要的重渲染和闪烁。首次加载后所有 Tab 内容始终保留在 DOM 中。


### 环境变量配置

在 Vercel 项目的 Settings → Environment Variables 中配置：

| 变量名 | 说明 | 获取方式 |
|--------|------|----------|
| FMP_API_KEY | Financial Modeling Prep API Key | financialmodelingprep.com 注册 |
| FRED_API_KEY | FRED 经济数据 API Key | fred.stlouisfed.org 注册 |
| NEWSAPI_KEY | NewsAPI 新闻搜索 Key | newsapi.org 注册 |

三个变量在 Production 和 Preview 环境均需启用。未配置时对应端点返回 `{ ok: false, error: "XXX_KEY 未配置" }`，前端会显示相应的数据不可用提示。


### 部署与本地开发

**Vercel 部署：** 推送代码到 GitHub 后 Vercel 自动构建部署。`vercel.json` 中 `framework: "vite"` 启用 Vite 框架预设，`api/` 目录自动识别为 Serverless Functions。SPA 路由通过 `rewrites` 规则将所有路径指向 `index.html`。

**本地开发：** 运行 `npm install` 安装依赖，`npm run dev` 启动 Vite 开发服务器（默认 5173 端口）。Vite 配置中的 `localApiPlugin` 拦截 `/api/*` 请求，动态加载 `api/` 目录下的 handler 文件，创建模拟的 req/res 对象，实现本地和 Vercel 完全一致的 API 行为。本地开发需要在项目根目录创建 `.env` 文件配置 API Key，或者在 `api/_lib.js` 中临时填入 Key 进行测试。

**Futu Bridge（可选）：** 如需期权 IV 数据，运行 `start.sh` 一键启动 Futu 桥接和开发服务器。桥接需要本地运行 Futu OpenD 网关（端口 11111）。


### 关键代码索引（App.jsx）

| 行号范围 | 内容 |
|----------|------|
| 1-16 | 依赖导入 + 主题色常量 T |
| 18-63 | 技术指标函数（sma/ema/RSI/MACD/ATR）+ 格式化函数 |
| 77-95 | 评分函数（calcFundScore/calcCompositeScore/scoreToRating） |
| 97-116 | 确定性价格生成器（seedHash/mulberry32/genPrices） |
| 118-182 | API 客户端函数（fetchSentiment/fetchProfile/fetchHistory 等） |
| 184-245 | mergeLiveWithPreset — 实时数据与预设数据合并 |
| 248-349 | PRESETS — 5 只预设股票的硬编码数据 |
| 352-597 | runAnalysis — 技术分析 + 评分 + 情景分析（核心计算函数） |
| 641-651 | useIsMobile Hook |
| 654-670 | 主组件状态声明 |
| 672-867 | doAnalyze — 分析编排函数（数据获取 + 合并 + 评分） |
| 870-880 | Tab 定义 + URL 参数自动分析 useEffect |
| 880-2196 | JSX 渲染（Header + 搜索 + 6 个 Tab 页 + 报告 + 数据状态面板） |
