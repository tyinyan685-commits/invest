#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://stocks.wiseain.com}"
RADAR_HISTORY_URL="${RADAR_HISTORY_URL:-https://www.wiseain.com/api/history?days=30&limit=40}"
CHROME_BIN="${CHROME_BIN:-google-chrome}"
DELAY_SECONDS="${SMOKE_DELAY_SECONDS:-8}"
RETRY_COOLDOWN_SECONDS="${SMOKE_RETRY_COOLDOWN_SECONDS:-65}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

history_json="$WORK_DIR/history.json"
curl --fail --silent --show-error --location \
  --user-agent "wiseain-production-smoke/1.0" \
  "$RADAR_HISTORY_URL" > "$history_json"

symbols="$WORK_DIR/symbols.txt"
if [[ -n "${SMOKE_SYMBOLS:-}" ]]; then
  printf '%s' "$SMOKE_SYMBOLS" | tr ', ' '\n\n' | awk 'NF && !seen[$0]++' > "$symbols"
else
  {
    printf '%s\n' ARM
    jq -r '.candidates[]?.symbol // empty' "$history_json"
  } | awk 'NF && !seen[$0]++' > "$symbols"
fi

dump_page() {
  local url="$1"
  local page="$2"
  shift 2
  timeout 55s "$CHROME_BIN" \
    --headless=new \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --virtual-time-budget=35000 \
    "$@" \
    --dump-dom "$url" > "$page" 2> "$WORK_DIR/chrome.log"
}

check_symbol() {
  local symbol="$1"
  local page url
  page="$WORK_DIR/${symbol//[^A-Za-z0-9._-]/_}.html"
  url="$BASE_URL/?symbol=$symbol&smoke=1"
  echo "Checking $symbol"
  if ! dump_page "$url" "$page"; then
    echo "$symbol: browser process failed; retrying in compatibility mode"
    if ! dump_page "$url" "$page" \
      --js-flags=--jitless \
      --disable-accelerated-2d-canvas \
      --disable-software-rasterizer; then
      echo "$symbol: browser process failed or timed out"
      return 1
    fi
  fi
  if ! grep -Eq "研究状态|最终评级" "$page"; then
    echo "$symbol: research state did not render"
    return 1
  fi
  if grep -q "详情暂时无法显示" "$page"; then
    echo "$symbol: page reached the render error boundary"
    return 1
  fi
  return 0
}

retry_symbols="$WORK_DIR/retry-symbols.txt"
: > "$retry_symbols"
while IFS= read -r symbol; do
  if ! check_symbol "$symbol"; then
    echo "$symbol" >> "$retry_symbols"
  fi
  sleep "$DELAY_SECONDS"
done < "$symbols"

failures=0
if [[ -s "$retry_symbols" ]]; then
  echo "Cooling down before retrying $(wc -l < "$retry_symbols" | tr -d ' ') symbol(s)"
  sleep "$RETRY_COOLDOWN_SECONDS"
  while IFS= read -r symbol; do
    if ! check_symbol "$symbol"; then
      echo "::error title=$symbol detail unavailable::The production analysis page failed twice"
      failures=$((failures + 1))
    fi
    sleep "$DELAY_SECONDS"
  done < "$retry_symbols"
fi

if (( failures > 0 )); then
  echo "$failures production smoke check(s) failed"
  exit 1
fi

echo "All $(wc -l < "$symbols" | tr -d ' ') production stock pages rendered successfully"
