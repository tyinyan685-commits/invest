#!/usr/bin/env python3
"""
Futu OpenD Bridge - Local HTTP proxy for Futu OpenAPI option volatility data.

Requirements:
  1. Install Futu OpenD gateway: https://openapi.futunn.com/futu-api-doc/intro/intro.html
  2. Start OpenD (default port: 11111)
  3. pip install futu-api flask flask-cors
  4. python server.py

This bridge exposes a local HTTP REST API that the StockAnalyzer web app can call
to get real options implied volatility (IV) data from Futu.

Usage:
  python server.py              # Start on port 9876
  python server.py --port 8888  # Custom port
"""

import sys
import json
import argparse
from datetime import datetime, timedelta

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    print("ERROR: Flask not installed. Run: pip install flask flask-cors")
    sys.exit(1)

try:
    from futu import OpenQuoteContext, RET_OK, OptionVolatilityTimePeriodType
    HAS_FUTU = True
except ImportError:
    print("WARNING: futu-api not installed. Run: pip install futu-api")
    print("Bridge will start but option volatility requests will return errors.")
    HAS_FUTU = False

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from Vercel dev server

OPEND_HOST = "127.0.0.1"
OPEND_PORT = 11111


def get_quote_ctx():
    """Create a new quote context (connection to OpenD)."""
    if not HAS_FUTU:
        return None, "futu-api not installed"
    try:
        ctx = OpenQuoteContext(host=OPEND_HOST, port=OPEND_PORT)
        return ctx, None
    except Exception as e:
        return None, f"Cannot connect to OpenD at {OPEND_HOST}:{OPEND_PORT} - {str(e)}"


@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint."""
    ctx, err = get_quote_ctx()
    opend_ok = ctx is not None
    if ctx:
        ctx.close()
    return jsonify({
        "ok": True,
        "bridge": "futu-opend-bridge",
        "version": "1.0.0",
        "opend_connected": opend_ok,
        "futu_sdk": HAS_FUTU,
        "opend_host": OPEND_HOST,
        "opend_port": OPEND_PORT,
    })


@app.route("/api/option-volatility", methods=["GET"])
def option_volatility():
    """
    Get option volatility data for a US stock.

    Query params:
      symbol: Stock ticker (e.g., "MU", "AAPL") - required
      hv_days: Historical volatility period in days (5-250, default 30)
      query_period: Query time period (default "Month")

    Returns:
      JSON with IV, HV, volatility premium data
    """
    symbol = request.args.get("symbol", "").upper().strip()
    if not symbol:
        return jsonify({"ok": False, "error": "symbol parameter required"}), 400

    hv_days = min(250, max(5, int(request.args.get("hv_days", 30))))

    ctx, err = get_quote_ctx()
    if err:
        return jsonify({"ok": False, "error": err}), 503

    try:
        # Step 1: Get option list for the symbol to find active contracts
        ret, option_list = ctx.get_option_list(market="US", underlying=symbol)
        if ret != RET_OK:
            return jsonify({"ok": False, "error": f"get_option_list failed: {option_list}"}), 500

        if option_list is None or len(option_list) == 0:
            return jsonify({"ok": False, "error": f"No options found for {symbol}"}), 404

        # Filter: find near-the-money options expiring within 30-90 days
        today = datetime.now()
        min_exp = today + timedelta(days=14)
        max_exp = today + timedelta(days=90)

        candidates = []
        for _, row in option_list.iterrows():
            code = row["code"]
            # Parse option code: US.AAPL260427C270000
            # Format: US.[TICKER][YYMMDD][C/P][STRIKE*1000]
            try:
                parts = code.split(".")[1]  # Remove US. prefix
                # Find where the date starts (first digit after ticker)
                ticker_len = len(symbol)
                date_str = parts[ticker_len:ticker_len + 6]  # YYMMDD
                exp_date = datetime.strptime(date_str, "%y%m%d")
                option_type = parts[ticker_len + 6]  # C or P
                strike = int(parts[ticker_len + 7:]) / 1000.0

                if min_exp <= exp_date <= max_exp:
                    candidates.append({
                        "code": code,
                        "exp_date": exp_date,
                        "type": option_type,
                        "strike": strike,
                        "days_to_exp": (exp_date - today).days,
                    })
            except (ValueError, IndexError):
                continue

        if not candidates:
            # Broaden search to all options
            for _, row in option_list.iterrows():
                code = row["code"]
                candidates.append({"code": code, "type": "?", "strike": 0, "days_to_exp": 0})

        # Sort by days to expiry (prefer near-term)
        candidates.sort(key=lambda x: x["days_to_exp"])

        # Step 2: Get volatility data for up to 5 representative contracts
        # Pick: nearest ATM call, nearest ATM put, and a few more
        vol_results = []
        checked = set()
        for c in candidates[:20]:  # Check up to 20 candidates
            code = c["code"]
            if code in checked:
                continue
            checked.add(code)

            ret, vol_df = ctx.get_option_volatility(
                code,
                query_time_period=OptionVolatilityTimePeriodType.MONTH,
                hv_time_period=hv_days,
            )
            if ret == RET_OK and vol_df is not None and len(vol_df) > 0:
                latest = vol_df.iloc[-1]
                vol_results.append({
                    "code": code,
                    "type": c.get("type", "?"),
                    "strike": c.get("strike", 0),
                    "days_to_exp": c.get("days_to_exp", 0),
                    "implied_volatility": float(latest.get("implied_volatility", 0)),
                    "history_volatility": float(latest.get("history_volatility", 0)),
                    "volatility_premium": float(latest.get("volatility_premium", 0)),
                    "timestamp": str(latest.get("timestamp_str", "")),
                })

            if len(vol_results) >= 8:
                break

        if not vol_results:
            return jsonify({
                "ok": False,
                "error": f"No volatility data available for {symbol} options",
            }), 404

        # Step 3: Compute aggregate IV metrics
        calls = [v for v in vol_results if v["type"] == "C"]
        puts = [v for v in vol_results if v["type"] == "P"]
        all_iv = [v["implied_volatility"] for v in vol_results if v["implied_volatility"] > 0]
        all_hv = [v["history_volatility"] for v in vol_results if v["history_volatility"] > 0]

        avg_iv = sum(all_iv) / len(all_iv) if all_iv else 0
        avg_hv = sum(all_hv) / len(all_hv) if all_hv else 0
        vol_premium = avg_iv - avg_hv

        # IV term structure (near vs far expiry)
        near_iv = [v["implied_volatility"] for v in vol_results
                   if v["days_to_exp"] <= 45 and v["implied_volatility"] > 0]
        far_iv = [v["implied_volatility"] for v in vol_results
                  if v["days_to_exp"] > 45 and v["implied_volatility"] > 0]
        near_avg = sum(near_iv) / len(near_iv) if near_iv else avg_iv
        far_avg = sum(far_iv) / len(far_iv) if far_iv else avg_iv
        term_structure = "contango" if far_avg > near_avg * 1.05 else \
                         "backwardation" if near_avg > far_avg * 1.05 else "flat"

        # IV skew (put vs call)
        call_iv = [v["implied_volatility"] for v in calls if v["implied_volatility"] > 0]
        put_iv = [v["implied_volatility"] for v in puts if v["implied_volatility"] > 0]
        call_avg_iv = sum(call_iv) / len(call_iv) if call_iv else avg_iv
        put_avg_iv = sum(put_iv) / len(put_iv) if put_iv else avg_iv
        skew = put_avg_iv - call_avg_iv

        return jsonify({
            "ok": True,
            "symbol": symbol,
            "source": "Futu OpenD",
            "avg_iv": round(avg_iv, 2),
            "avg_hv": round(avg_hv, 2),
            "vol_premium": round(vol_premium, 2),
            "call_iv": round(call_avg_iv, 2),
            "put_iv": round(put_avg_iv, 2),
            "skew": round(skew, 2),
            "term_structure": term_structure,
            "near_term_iv": round(near_avg, 2),
            "far_term_iv": round(far_avg, 2),
            "contracts_scanned": len(vol_results),
            "hv_days": hv_days,
            "contracts": vol_results[:8],  # Top 8 contracts for detail
            "timestamp": datetime.now().isoformat(),
        })

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        ctx.close()


@app.route("/api/option-chain", methods=["GET"])
def option_chain():
    """
    Get basic option chain snapshot for a symbol.

    Query params:
      symbol: Stock ticker - required
      exp_days: Max days to expiry (default 60)
    """
    symbol = request.args.get("symbol", "").upper().strip()
    if not symbol:
        return jsonify({"ok": False, "error": "symbol parameter required"}), 400

    ctx, err = get_quote_ctx()
    if err:
        return jsonify({"ok": False, "error": err}), 503

    try:
        ret, option_list = ctx.get_option_list(market="US", underlying=symbol)
        if ret != RET_OK:
            return jsonify({"ok": False, "error": str(option_list)}), 500

        today = datetime.now()
        max_exp = today + timedelta(days=int(request.args.get("exp_days", 60)))

        chain = []
        for _, row in option_list.iterrows():
            code = row["code"]
            try:
                parts = code.split(".")[1]
                ticker_len = len(symbol)
                date_str = parts[ticker_len:ticker_len + 6]
                exp_date = datetime.strptime(date_str, "%y%m%d")
                if exp_date > max_exp:
                    continue
                option_type = parts[ticker_len + 6]
                strike = int(parts[ticker_len + 7:]) / 1000.0
                chain.append({
                    "code": code,
                    "exp_date": exp_date.strftime("%Y-%m-%d"),
                    "type": "Call" if option_type == "C" else "Put",
                    "strike": strike,
                })
            except (ValueError, IndexError):
                continue

        chain.sort(key=lambda x: (x["exp_date"], x["type"], x["strike"]))
        return jsonify({"ok": True, "symbol": symbol, "count": len(chain), "chain": chain[:50]})

    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    finally:
        ctx.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Futu OpenD Bridge Server")
    parser.add_argument("--port", type=int, default=9876, help="HTTP port (default: 9876)")
    parser.add_argument("--opend-port", type=int, default=11111, help="OpenD port (default: 11111)")
    parser.add_argument("--opend-host", default="127.0.0.1", help="OpenD host (default: 127.0.0.1)")
    args = parser.parse_args()

    OPEND_HOST = args.opend_host
    OPEND_PORT = args.opend_port

    print(f"=== Futu OpenD Bridge ===")
    print(f"OpenD: {OPEND_HOST}:{OPEND_PORT}")
    print(f"HTTP:  http://localhost:{args.port}")
    print(f"Futu SDK: {'installed' if HAS_FUTU else 'NOT INSTALLED (pip install futu-api)'}")
    print(f"Endpoints:")
    print(f"  GET /health                      - Health check")
    print(f"  GET /api/option-volatility?symbol=MU  - Option IV data")
    print(f"  GET /api/option-chain?symbol=MU       - Option chain")
    print(f"========================")

    app.run(host="0.0.0.0", port=args.port, debug=False)
