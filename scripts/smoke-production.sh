#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://stocks.wiseain.com}"
RADAR_HISTORY_URL="${RADAR_HISTORY_URL:-https://www.wiseain.com/api/history?days=30&limit=40}"
CHROME_BIN="${CHROME_BIN:-google-chrome}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

history_json="$WORK_DIR/history.json"
curl --fail --silent --show-error --location \
  --user-agent "wiseain-production-smoke/1.0" \
  "$RADAR_HISTORY_URL" > "$history_json"

symbols="$WORK_DIR/symbols.txt"
{
  printf '%s\n' ARM
  jq -r '.candidates[]?.symbol // empty' "$history_json"
} | awk 'NF && !seen[$0]++' > "$symbols"

failures=0
while IFS= read -r symbol; do
  page="$WORK_DIR/${symbol//[^A-Za-z0-9._-]/_}.html"
  url="$BASE_URL/?symbol=$symbol&smoke=1"
  echo "Checking $symbol"
  if ! timeout 55s "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --virtual-time-budget=35000 \
    --dump-dom "$url" > "$page" 2> "$WORK_DIR/chrome.log"; then
    echo "::error title=$symbol smoke failed::Browser process failed or timed out"
    failures=$((failures + 1))
    continue
  fi
  if ! grep -q "最终评级" "$page"; then
    echo "::error title=$symbol detail missing::The analysis page did not render its final rating"
    failures=$((failures + 1))
  fi
  if grep -q "详情暂时无法显示" "$page"; then
    echo "::error title=$symbol render boundary::The page reached the render error boundary"
    failures=$((failures + 1))
  fi
done < "$symbols"

if (( failures > 0 )); then
  echo "$failures production smoke check(s) failed"
  exit 1
fi

echo "All $(wc -l < "$symbols" | tr -d ' ') production stock pages rendered successfully"
