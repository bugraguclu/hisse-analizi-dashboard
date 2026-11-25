"""Freeze a compact, real-data regression fixture from the recorded demo API responses.

``dashboard/demo/data`` holds API responses recorded from the running platform (real
TradingView / İş Yatırım / KAP data). The demo is re-recorded from time to time, so the
calculation regression tests (``tests/unit/test_recorded_history_regression.py``) read a
frozen copy instead: only the fields they check, one JSON file.

    python scripts/freeze_recorded_fixture.py            # writes tests/fixtures/recorded_history.json

Re-freezing changes the pinned values on purpose; review the diff.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "dashboard" / "demo" / "data"
OUT = ROOT / "tests" / "fixtures" / "recorded_history.json"
TICKERS = ("THYAO", "GARAN", "ASELS", "BIMAS", "KCHOL", "SISE", "EREGL")

#: income-statement / balance-sheet rows the tests use (holdings and banks label them differently)
INCOME_ROWS = (
    "Hasılat",
    "Toplam Hasılat",
    "Brüt Kâr (Zarar)",
    "Esas Faaliyet Kârı (Zararı)",
    "Net Dönem Kârı (Zararı)",
    "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları",
)
BALANCE_ROWS = (
    "Toplam Varlıklar",
    "Varlıklar",
    "Varlıklar Toplamı",
    "Toplam Kaynaklar",
    "Kaynaklar",
    "Yükümlülükler Toplamı",
    "Toplam Yükümlülükler",
    "Yükümlülükler",
    "Toplam Özkaynaklar",
    "Özkaynaklar",
)


def _load(name: str) -> Any:
    return json.loads((DEMO / name).read_text(encoding="utf-8"))


def _bars(rows: list[dict[str, Any]]) -> list[list[Any]]:
    return [[r["Date"], r["Open"], r["High"], r["Low"], r["Close"], r["Volume"]] for r in rows]


def _rows(table: list[dict[str, Any]], wanted: tuple[str, ...]) -> dict[str, dict[str, Any]]:
    return {r["Item"]: {k: v for k, v in r.items() if k != "Item"} for r in table if r["Item"] in wanted}


def _ticker(t: str) -> dict[str, Any]:
    year = _load(f"market_ticker_{t}_history__period_1y_warmup_250.json")
    month = _load(f"market_ticker_{t}_history__period_1mo.json")
    usd = _load(f"market_ticker_{t}_history__currency_USD_period_3mo_warmup_250.json")
    quarterly = _load(f"fundamentals_{t}_income-statement__quarterly_true.json")
    annual = _load(f"fundamentals_{t}_income-statement__quarterly_false.json")
    balance = _load(f"fundamentals_{t}_balance-sheet__quarterly_true.json")
    live = _load(f"fundamentals_{t}_live-ratios.json")
    technical = {
        name: {k: v for k, v in _load(f"technical_{t}_{name}.json").items() if k != "meta"}
        for name in ("rsi", "macd", "bollinger", "stochastic", "moving-averages", "supertrend")
    }
    return {
        "history_1y": {
            "reference_close": year["reference_close"],
            "reference_date": year["reference_date"],
            "warmup": _bars(year["warmup"]),
            "data": _bars(year["data"]),
        },
        "history_1mo": {
            "reference_close": month.get("reference_close"),
            "reference_date": month.get("reference_date"),
            "data": _bars(month["data"]),
        },
        "history_usd_3mo": {"fx": usd["fx"], "data": [[r["Date"], r["Close"]] for r in usd["data"]]},
        "technical": technical,
        "income_quarterly": {
            "discrete_basis": quarterly.get("discrete_basis"),
            "fiscal_year_end_month": quarterly.get("fiscal_year_end_month"),
            "data": _rows(quarterly["data"], INCOME_ROWS),
            "discrete": _rows(quarterly["discrete"], INCOME_ROWS),
        },
        "income_annual": _rows(annual["data"], INCOME_ROWS),
        "balance_quarterly": _rows(balance["data"], BALANCE_ROWS),
        "live_ratios": {k: live.get(k) for k in (
            "as_of", "basis", "ttm_quarters", "ttm_method", "template", "ratios", "ttm", "valuation",
        )},
        "fast_info": _load(f"fundamentals_{t}_fast-info.json")["fast_info"],
        "ratio_rows": [
            {k: r.get(k) for k in ("period", "basis", "ttm_quarters", "pe_ratio", "market_cap", "roe", "net_margin",
                                    "revenue_growth_yoy")}
            for r in _load(f"financials_ratios__ticker_{t}.json")
        ],
    }


def main() -> int:
    if not DEMO.is_dir():
        print(f"recorded demo data not found: {DEMO}", file=sys.stderr)
        return 1
    fixture = {
        "_source": "dashboard/demo/data (recorded API responses), frozen by scripts/freeze_recorded_fixture.py",
        "_recorded_as_of": _load("technical_THYAO_rsi.json")["meta"]["as_of"],
        "tickers": {t: _ticker(t) for t in TICKERS},
    }
    OUT.write_text(json.dumps(fixture, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
