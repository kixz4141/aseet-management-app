#!/usr/bin/env python3
"""
yfinance で日本株の株価を取得し prices.json に保存する。
"""

import json
import os
import sys
import time
from datetime import datetime, timezone, timedelta

import yfinance as yf

JST = timezone(timedelta(hours=9))

DEFAULT_TICKERS = [
    {"code": "7203", "name": "トヨタ自動車"},
    {"code": "8306", "name": "三菱UFJフィナンシャル・グループ"},
    {"code": "9432", "name": "日本電信電話"},
    {"code": "9433", "name": "KDDI"},
    {"code": "8316", "name": "三井住友フィナンシャルグループ"},
    {"code": "4502", "name": "武田薬品工業"},
    {"code": "2914", "name": "日本たばこ産業"},
    {"code": "8058", "name": "三菱商事"},
    {"code": "7267", "name": "ホンダ"},
    {"code": "6758", "name": "ソニーグループ"},
]


def load_tickers():
    path = "tickers.json"
    if not os.path.exists(path):
        return DEFAULT_TICKERS
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def fetch_one(code, name):
    ticker_symbol = f"{code}.T"
    try:
        t = yf.Ticker(ticker_symbol)
        fi = t.fast_info
        price = fi.last_price
        prev = fi.previous_close

        try:
            info = t.info
            div = info.get("dividendRate") or 0
            if div == 0 and info.get("trailingAnnualDividendRate"):
                div = info.get("trailingAnnualDividendRate") or 0
        except Exception:
            div = 0

        if price is None or prev is None:
            return None

        return {
            "code": code,
            "name": name,
            "price": round(float(price), 2),
            "prev": round(float(prev), 2),
            "div": round(float(div), 2),
        }
    except Exception as e:
        print(f"[ERROR] {code} ({name}): {e}", file=sys.stderr)
        return None


def main():
    tickers = load_tickers()
    print(f"対象銘柄数: {len(tickers)}")

    results = {}
    success = 0
    failed = []

    for t in tickers:
        code = t["code"]
        name = t.get("name", "")
        print(f"取得中: {code} {name}", flush=True)

        result = fetch_one(code, name)
        if result:
            results[code] = result
            success += 1
        else:
            failed.append(code)

        time.sleep(0.5)

    if os.path.exists("prices.json") and failed:
        try:
            with open("prices.json", "r", encoding="utf-8") as f:
                old = json.load(f)
            for code in failed:
                if code in old.get("prices", {}):
                    results[code] = old["prices"][code]
                    print(f"[KEEP] {code}: 旧データを保持")
        except Exception:
            pass

    output = {
        "updatedAt": datetime.now(JST).isoformat(),
        "updatedAtUnix": int(time.time()),
        "successCount": success,
        "failedCount": len(failed),
        "failedCodes": failed,
        "prices": results,
    }

    with open("prices.json", "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n成功: {success} / 失敗: {len(failed)}")

    if success == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
