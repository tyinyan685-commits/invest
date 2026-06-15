# Futu OpenD Bridge

本地桥接服务，将 Futu OpenD 的期权波动率数据通过 HTTP REST API 暴露给 StockAnalyzer 前端。

## 前置条件

1. **安装并启动 Futu OpenD 网关**
   - 下载地址: https://openapi.futunn.com/futu-api-doc/intro/intro.html
   - 默认端口: 11111
   - 需注册富途账号并登录 OpenD

2. **安装 Python 依赖**
   ```bash
   cd futu-bridge
   pip install -r requirements.txt
   ```

## 启动

```bash
python server.py                # 默认端口 9876
python server.py --port 8888    # 自定义端口
```

## API 端点

| 端点 | 说明 |
|------|------|
| `GET /health` | 健康检查，确认 OpenD 连接状态 |
| `GET /api/option-volatility?symbol=MU` | 获取期权隐含波动率 (IV) 数据 |
| `GET /api/option-chain?symbol=MU` | 获取期权链快照 |

### option-volatility 返回字段

- `avg_iv`: 平均隐含波动率 (%)
- `avg_hv`: 平均历史波动率 (%)
- `vol_premium`: 波动率溢价 (IV - HV)
- `call_iv` / `put_iv`: Call/Put 平均 IV
- `skew`: Put-Call IV 差值 (偏度)
- `term_structure`: 期限结构 (contango/backwardation/flat)
- `contracts`: 各合约明细

## 与 StockAnalyzer 集成

前端在开发模式下会自动尝试连接 `http://localhost:9876/api/option-volatility`。
如果桥接服务可用，会显示真实的期权 IV 数据；如果不可用，会使用基于历史价格计算的 HV 作为替代。

## 注意事项

- 仅限本地开发使用（Vercel 生产环境无法连接本地 OpenD）
- OpenD 免费额度限制 30 次请求/30 秒
- 美股期权数据需要对应的美股交易权限
