#!/bin/bash
# StockAnalyzer 一键启动脚本
# 用法: ./start.sh

cd "$(dirname "$0")"

echo "=== StockAnalyzer 启动中 ==="

# 1. 检查 OpenD
if lsof -i :11111 >/dev/null 2>&1; then
  echo "✓ OpenD 网关已运行 (端口 11111)"
else
  echo "✗ OpenD 网关未运行 — 请先启动 Futu OpenD"
  echo "  下载: https://openapi.futunn.com/futu-api-doc/intro/intro.html"
  echo ""
fi

# 2. 启动 Futu 桥接 (后台)
if lsof -i :9876 >/dev/null 2>&1; then
  echo "✓ Futu 桥接已运行 (端口 9876)"
else
  echo "→ 启动 Futu 桥接..."
  python3 futu-bridge/server.py --port 9876 &
  BRIDGE_PID=$!
  sleep 2
  if kill -0 $BRIDGE_PID 2>/dev/null; then
    echo "✓ Futu 桥接已启动 (端口 9876, PID $BRIDGE_PID)"
  else
    echo "✗ Futu 桥接启动失败 — pip install flask flask-cors futu-api"
  fi
fi

# 3. 启动 Vite 开发服务器 (前台)
echo "→ 启动前端开发服务器..."
echo ""
echo "  浏览器打开: http://localhost:5173/"
echo "  按 Ctrl+C 停止所有服务"
echo ""

# Trap Ctrl+C to also kill the bridge
trap "echo ''; echo '正在停止...'; kill $BRIDGE_PID 2>/dev/null; exit 0" INT TERM

npm run dev
