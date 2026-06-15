#!/usr/bin/env python3
"""
Futu OpenD Bridge - Local HTTP proxy for Futu OpenAPI option volatility data.

Requirements:
  1. Install Futu OpenD gateway: https://openapi.futunn.com/futu-api-doc/intro/intro.html
  2. Start OpenD (default port: 11111)
  3. pip install futu-api flask flask-cors
  4. python server.py

Usage:
  python server.py              # Start on port 9876
  python server.py --port 8888  # Custom port
"""

import sys
import argparse
import traceback
from datetime import datetime, timedelta

try:
    from flask import Flask, request, jsonify
    from flask_cors import CORS
except ImportError:
    print("ERROR: Flask not installed. Run: pip install flask flask-cors")
    sys.exit(1)

try:
    from futu import OpenQuoteContext, RET_OK
    HAS_FUTU = True
except ImportError:
    print("WARNING: futu-api not installed. Run: pip install futu-api")
    print("Bridge will start but option volatility requests will return errors.")
    HAS_FUTU = False

app = Flask(__name__)
CORS(app)

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
        "version": "1.1.0",
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
      price: Current stock price (float) - required for near-ATM filtering

    Returns:
      JSON with IV, HV, volatility premium, skew, term structure data
    """
    symbol = request.args.get("symbol", "").upper().strip()
    if not symbol:
        return jsonify({"ok": False, "error": "symbol parameter required"}), 400

    price = float(request.args.get("price", 0))
    if price <= 0:
        return jsonify({"ok": False, "error": "price parameter required (> 0)"}), 400

    ctx, err = get_quote_ctx()
    if err:
        return jsonify({"ok": False, "error": err}), 503

    try:
        # Step 1: Get available expiration dates
        ret, exp_df = ctx.get_option_expiration_date(f"US.{symbol}")
        if ret != RET_OK:
            return jsonify({"ok": False, "error": f"get_option_expiration_date failed: {exp_df}"}), 500

        if exp_df is None or len(exp_df) == 0:
            return jsonify({"ok": False, "error": f"No option expirations found for {symbol}"}), 404

        # Pick 2 expiration dates: nearest (>=10 days) + nearest monthly (>=30 days)
        today = datetime.now()
        expirations = []
        for _, row in exp_df.iterrows():
            exp_date = row["strike_time"]
            cycle = row.get("expiration_cycle", "")
            days_away = row.get("option_expiry_date_distance", 0)
            if days_away >= 7:
                expirations.append({
                    "date": exp_date,
                    "cycle": cycle,
                    "days": days_away,
                })

        # Select: first available (near-term) + first monthly >= 30 days (mid-term)
        selected_exps = []
        if expirations:
            selected_exps.append(expirations[0])  # nearest
            # Find a monthly >= 30 days away for term structure comparison
            for e in expirations:
                if e["cycle"] == "MONTH" and e["days"] >= 30 and e["date"] != expirations[0]["date"]:
                    selected_exps.append(e)
                    break
            # If no monthly found, take the second expiration
            if len(selected_exps) == 1 and len(expirations) >= 2:
                selected_exps.append(expirations[1])
        if not selected_exps:
            return jsonify({"ok": False, "error": "No suitable expiration dates"}), 404

        # Step 2: Get option chains and find near-ATM options
        vol_results = []
        for exp_info in selected_exps:
            exp_date = exp_info["date"]
            ret, chain = ctx.get_option_chain(f"US.{symbol}", start=exp_date, end=exp_date)
            if ret != RET_OK or chain is None or len(chain) == 0:
                continue

            # Filter near-ATM: strike within ±15% of current price
            lo = price * 0.85
            hi = price * 1.15
            near_atm = chain[(chain["strike_price"] >= lo) & (chain["strike_price"] <= hi)]

            # Sort by distance from current price (closest first)
            near_atm = near_atm.copy()
            near_atm["dist"] = abs(near_atm["strike_price"] - price)
            near_atm = near_atm.sort_values("dist")

            # Pick top 4 calls + top 4 puts (closest to ATM)
            calls = near_atm[near_atm["option_type"] == "CALL"].head(4)
            puts = near_atm[near_atm["option_type"] == "PUT"].head(4)
            selected = list(calls.iterrows()) + list(puts.iterrows())

            for _, row in selected:
                code = row["code"]
                try:
                    ret2, vol_df = ctx.get_option_volatility(code)
                    if ret2 == RET_OK and vol_df is not None and len(vol_df) > 0:
                        latest = vol_df.iloc[-1]
                        vol_results.append({
                            "code": code,
                            "type": "C" if row["option_type"] == "CALL" else "P",
                            "strike": float(row["strike_price"]),
                            "exp_date": exp_date,
                            "days_to_exp": int(exp_info["days"]),
                            "cycle": exp_info["cycle"],
                            "implied_volatility": round(float(latest.get("implied_volatility", 0)), 2),
                            "history_volatility": round(float(latest.get("history_volatility", 0)), 2),
                            "volatility_premium": round(float(latest.get("volatility_premium", 0)), 2),
                            "average_impvol": round(float(latest.get("average_impvol", 0)), 2),
                            "timestamp": str(latest.get("timestamp_str", "")),
                        })
                except Exception:
                    continue

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

        avg_iv = round(sum(all_iv) / len(all_iv), 2) if all_iv else 0
        avg_hv = round(sum(all_hv) / len(all_hv), 2) if all_hv else 0
        vol_premium = round(avg_iv - avg_hv, 2)

        # IV term structure (near vs far expiry) - use first/second expiration groups
        all_days = sorted(set(v["days_to_exp"] for v in vol_results))
        if len(all_days) >= 2:
            mid_days = (all_days[0] + all_days[-1]) / 2
            near_iv = [v["implied_volatility"] for v in vol_results
                       if v["days_to_exp"] <= mid_days and v["implied_volatility"] > 0]
            far_iv = [v["implied_volatility"] for v in vol_results
                      if v["days_to_exp"] > mid_days and v["implied_volatility"] > 0]
        else:
            near_iv = [v["implied_volatility"] for v in vol_results if v["implied_volatility"] > 0]
            far_iv = []
        near_avg = round(sum(near_iv) / len(near_iv), 2) if near_iv else avg_iv
        far_avg = round(sum(far_iv) / len(far_iv), 2) if far_iv else near_avg
        term_structure = "contango" if far_avg > near_avg * 1.02 else \
                         "backwardation" if near_avg > far_avg * 1.02 else "flat"

        # IV skew (put vs call)
        call_iv = [v["implied_volatility"] for v in calls if v["implied_volatility"] > 0]
        put_iv = [v["implied_volatility"] for v in puts if v["implied_volatility"] > 0]
        call_avg_iv = round(sum(call_iv) / len(call_iv), 2) if call_iv else avg_iv
        put_avg_iv = round(sum(put_iv) / len(put_iv), 2) if put_iv else avg_iv
        skew = round(put_avg_iv - call_avg_iv, 2)

        return jsonify({
            "ok": True,
            "symbol": symbol,
            "source": "Futu OpenD",
            "stock_price": price,
            "avg_iv": avg_iv,
            "avg_hv": avg_hv,
            "vol_premium": vol_premium,
            "call_iv": call_avg_iv,
            "put_iv": put_avg_iv,
            "skew": skew,
            "term_structure": term_structure,
            "near_term_iv": near_avg,
            "far_term_iv": far_avg,
            "contracts_scanned": len(vol_results),
            "hv_days": 30,
            "contracts": vol_results,
            "timestamp": datetime.now().isoformat(),
        })

    except Exception as e:
        traceback.print_exc()
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

    print(f"=== Futu OpenD Bridge v1.1 ===")
    print(f"OpenD: {OPEND_HOST}:{OPEND_PORT}")
    print(f"HTTP:  http://localhost:{args.port}")
    print(f"Futu SDK: {'installed' if HAS_FUTU else 'NOT INSTALLED (pip install futu-api)'}")
    print(f"Endpoints:")
    print(f"  GET /health                                - Health check")
    print(f"  GET /api/option-volatility?symbol=MU&price=103 - Option IV data")
    print(f"===============================")

    app.run(host="127.0.0.1", port=args.port, debug=False)
