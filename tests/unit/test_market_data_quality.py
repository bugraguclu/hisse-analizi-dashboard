"""Market quote normalization and batch snapshot contract tests."""

import pytest

from src.adapters.index_adapter import _normalize_quote
from src.adapters.scanner_adapter import _format_scan_records
from src.adapters.screener_adapter import _merge_live_market_fields, _normalize_filters
from src.adapters.stream_adapter import _snapshot_from_records


def test_index_quote_recomputes_daily_change_and_removes_sentinel_volume():
    quote = _normalize_quote({"last": 110.0, "prev_close": 100.0, "change": 99, "volume": 1e100})

    assert quote["change"] == 10.0
    assert quote["change_percent"] == 10.0
    assert quote["volume"] is None


def test_batch_snapshot_keeps_symbol_grain_and_derives_previous_close():
    result = _snapshot_from_records(
        ["THYAO", "GARAN"],
        [{"symbol": "THYAO", "close": 102.0, "change": 2.0, "high": 103.0, "low": 99.0}],
    )

    assert result["THYAO"]["last_price"] == 102.0
    assert result["THYAO"]["previous_close"] == pytest.approx(100.0)
    assert result["THYAO"]["day_high"] == 103.0
    assert "error" in result["GARAN"]


def test_screener_filter_contract_maps_ranges_and_keeps_templates():
    result = _normalize_filters(
        {
            "template": "low_pe",
            "price_earnings_ttm": [None, 10],
            "return_on_equity": [15, None],
        }
    )

    assert result == {"template": "low_pe", "pe_max": 10, "roe_min": 15}


def test_screener_rows_receive_real_market_fields_without_losing_fundamentals():
    result = _merge_live_market_fields(
        [{"symbol": "THYAO", "criteria_7": 320.0, "pe": 3.2}],
        [{"symbol": "THYAO", "close": 323.75, "change": 2.13, "volume": 70_677_933}],
    )

    assert result == [
        {
            "symbol": "THYAO",
            "criteria_7": 320.0,
            "pe": 3.2,
            "close": 323.75,
            "change_pct": 2.13,
            "volume": 70_677_933,
            "market_cap": None,
        }
    ]


def test_scanner_formats_alias_result_and_golden_cross_value():
    result = _format_scan_records(
        [{"symbol": "THYAO", "sma20": 325.0, "sma50": 315.0}],
        "Golden Cross",
        "sma_spread",
    )

    assert result[0]["ticker"] == "THYAO"
    assert result[0]["signal"] == "Golden Cross"
    assert result[0]["value"] == 10.0
