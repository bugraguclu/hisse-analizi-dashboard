"""Market quote normalization, batch snapshot, screener and scanner contract tests."""

import pandas as pd
import pytest

from src.adapters import price, scanner_adapter
from src.adapters.index_adapter import _index_quote_payload
from src.adapters.price import build_quote, get_quotes, quote_from_scan
from src.adapters.scanner_adapter import _format_scan_records, resolve_condition
from src.adapters.screener_adapter import _merge_live_market_fields, normalize_filters
from src.adapters.stream_adapter import _snapshot_from_quotes
from src.adapters.utils import InvalidInputError, MarketDataError, adapter_cache


@pytest.fixture(autouse=True)
def _clear_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


def test_quote_recomputes_daily_change_and_removes_sentinel_volume():
    quote = build_quote("XU100", last=110.0, prev_close=100.0, volume=1e100)

    assert quote is not None
    assert quote["change"] == 10.0
    assert quote["change_percent"] == 10.0
    assert quote["volume"] is None


def test_quote_without_previous_close_has_no_change_instead_of_zero():
    quote = build_quote("THYAO", last=300.0, prev_close=None)

    assert quote is not None
    assert quote["change"] is None
    assert quote["change_percent"] is None


def test_quote_without_positive_last_price_is_missing():
    assert build_quote("THYAO", last=0, prev_close=100.0) is None
    assert build_quote("THYAO", last=float("nan"), prev_close=100.0) is None


def test_scan_quote_derives_previous_close_from_absolute_change():
    quote = quote_from_scan(
        "THYAO",
        {"close": 300.25, "change": 2.3, "change_abs": 6.75, "close[1]": 290.0, "volume": 1000,
         "update_time": 1790077140, "description": "TÜRK HAVA YOLLARI A.O."},
    )

    assert quote is not None
    assert quote["prev_close"] == pytest.approx(293.5)
    assert quote["change"] == pytest.approx(6.75)
    assert quote["change_percent"] == pytest.approx(6.75 / 293.5 * 100, rel=1e-6)
    assert quote["updated_at"] == "2026-09-22T14:39:00+03:00"
    assert quote["name"] == "TÜRK HAVA YOLLARI A.O."


def test_scan_quote_falls_back_to_previous_bar_close():
    quote = quote_from_scan("THYAO", {"close": 102.0, "close[1]": 100.0})

    assert quote is not None
    assert quote["prev_close"] == 100.0
    assert quote["change_percent"] == pytest.approx(2.0)


def test_index_quote_payload_keeps_historical_shape():
    quote = build_quote("XU100", last=13250.0, prev_close=13337.69, timestamp=1790077140)
    payload = _index_quote_payload(quote)

    for key in ("symbol", "exchange", "last", "change", "change_percent", "open", "high", "low", "prev_close",
                "volume", "bid", "ask", "bid_size", "ask_size", "timestamp", "description", "currency", "name",
                "type"):
        assert key in payload
    assert payload["name"] == "BIST 100"
    assert payload["type"] == "index"


def test_batch_snapshot_keeps_symbol_grain():
    quotes = {"THYAO": build_quote("THYAO", last=102.0, prev_close=100.0, high=103.0, low=99.0)}
    result = _snapshot_from_quotes(["THYAO", "KONTR"], quotes)

    assert result["THYAO"]["last_price"] == 102.0
    assert result["THYAO"]["previous_close"] == 100.0
    assert result["THYAO"]["change_percent"] == pytest.approx(2.0)
    assert result["THYAO"]["day_high"] == 103.0
    assert "error" in result["KONTR"]


async def test_quotes_request_exact_tickers_and_fall_back_to_websocket_for_indices(monkeypatch):
    requested: list[tuple] = []

    async def fake_scan(symbols, columns, **kwargs):
        requested.append(tuple(symbols))
        return {"XU100": {"close": 13250.0, "change_abs": -87.24}, "KONTR": {"close": 2.31, "change_abs": -0.25}}

    monkeypatch.setattr(price, "tradingview_scan", fake_scan)
    monkeypatch.setattr(price, "_websocket_quote_sync", lambda symbol: {"last": 17594.34, "prev_close": 17926.4})

    quotes = await get_quotes(("XU100", "XUSIN", "KONTR", "NOPE1"))

    assert requested == [("XU100", "XUSIN", "KONTR", "NOPE1")]
    assert quotes["KONTR"]["prev_close"] == pytest.approx(2.56)  # small caps are not dropped
    assert quotes["XUSIN"]["prev_close"] == 17926.4  # index missing from the scanner
    assert "NOPE1" not in quotes  # unknown stock: no slow websocket fallback


async def test_quotes_raise_when_scanner_fails_and_nothing_can_be_recovered(monkeypatch):
    async def failing_scan(symbols, columns, **kwargs):
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    monkeypatch.setattr(price, "tradingview_scan", failing_scan)

    with pytest.raises(MarketDataError) as exc_info:
        await get_quotes(("THYAO",))
    assert exc_info.value.status_code == 503


def test_screener_filter_contract_maps_ranges_and_keeps_templates():
    result = normalize_filters(
        {
            "template": "low_pe",
            "price_earnings_ttm": [None, 10],
            "return_on_equity": [15, None],
        }
    )

    assert result == {"template": "low_pe", "pe_min": 0, "pe_max": 10, "roe_min": 15}


def test_screener_valuation_caps_exclude_loss_makers():
    # borsapy's default lower P/E bound is -1,000: "P/E ≤ 10" returned BIGEN (-540), KENT (-105), ...
    assert normalize_filters({"pe_max": 10}) == {"pe_max": 10, "pe_min": 0}
    assert normalize_filters({"price_book_fq": [None, 1]}) == {"pb_max": 1, "pb_min": 0}
    assert normalize_filters({"pe_min": -5, "pe_max": 10}) == {"pe_min": -5, "pe_max": 10}
    # A cap at or below zero asks for loss-makers: a 0 floor would make the range empty.
    assert normalize_filters({"price_earnings_ttm": [None, -5]}) == {"pe_max": -5}
    assert normalize_filters({"price_book_fq": [None, 0]}) == {"pb_max": 0}


def test_screener_market_cap_alias_converts_tl_to_million_tl():
    # İş Yatırım's market-cap criterion is in million TL; "> 1 milyar TL" must become 1000.
    assert normalize_filters({"market_cap_basic": [1_000_000_000, None]}) == {"market_cap_min": 1000.0}


@pytest.mark.parametrize(
    "filters",
    [
        {"template": "not_a_template"},
        {"unknown_filter": 1},
        {"pe_max": "ten"},
        {"pe_max": True},
        {"price_earnings_ttm": [None]},
        {"recommendation": "MAYBE"},
        {"sector": ""},
    ],
)
def test_screener_rejects_invalid_filters_with_400(filters):
    with pytest.raises(InvalidInputError) as exc_info:
        normalize_filters(filters)
    assert exc_info.value.status_code == 400


async def test_unfiltered_screen_and_company_list_keep_stocks_priced_under_one_lira(monkeypatch):
    import borsapy.screener
    from src.adapters import screener_adapter, search_adapter

    added: list[tuple] = []

    class FakeScreener:
        def add_filter(self, criteria, min=None, max=None):
            added.append((criteria, min, max))
            return self

        def run(self):
            return pd.DataFrame([{"symbol": "GSRAY", "name": "Galatasaray", "criteria_8": 12_096.0},
                                 {"symbol": "DSTKF", "name": "Destek Finans Faktoring", "criteria_8": 536_000.0},
                                 {"symbol": "THYAO", "name": "THY", "criteria_8": 405_030.0},
                                 {"symbol": "ISATR", "name": "İş Bankası (A)", "criteria_8": 365_300.0}])

    async def market(symbols, columns, **kwargs):
        return {"GSRAY": {"close": 0.91, "change": 1.1}, "DSTKF": {"close": 1608.0, "change": -9.97}}

    monkeypatch.setattr(borsapy.screener, "Screener", FakeScreener)
    monkeypatch.setattr(screener_adapter, "tradingview_scan", market)

    screen = await screener_adapter.screen_stocks()
    companies = await search_adapter.list_companies()

    # borsapy's criterion-less default ("price > 1 TL") would drop GSRAY, TSPOR, IHLAS, ...
    # and İş Yatırım's price criterion drops everything at 1,000 TL or more (DSTKF, BRYAT, ...).
    assert added == [("market_cap", 0, 1_000_000_000)] * 2
    # İş Bankası's A/B/founder shares carry the whole bank's market cap: kept out of screens,
    # but still listed (search finds them).
    assert [row["symbol"] for row in screen["results"]] == ["GSRAY", "DSTKF", "THYAO"]
    assert [row["close"] for row in screen["results"]] == [0.91, 1608.0, None]
    assert companies["count"] == 4


def test_screener_rows_receive_real_market_fields_without_losing_fundamentals():
    result = _merge_live_market_fields(
        [{"symbol": "THYAO", "criteria_7": 320.0, "pe": 3.2}, {"symbol": "NEWCO", "criteria_7": 12.5}],
        {"THYAO": {"close": 323.75, "change": 2.13, "change_abs": 6.75, "volume": 70_677_933,
                   "Value.Traded": 1.2e10, "market_cap_basic": 4.05e11, "sector.tr": "Ulaştırma",
                   "industry.tr": "Havayolları"}},
    )

    assert result[0] == {
        "symbol": "THYAO",
        "criteria_7": 320.0,
        "pe": 3.2,
        "close": 323.75,
        "change_pct": 2.13,
        "change": 6.75,
        "volume": 70_677_933,
        "turnover": 1.2e10,
        "market_cap": 4.05e11,
        "sector": "Ulaştırma",
        "industry": "Havayolları",
    }
    # Without live data the row keeps İş Yatırım's close and reports the rest as missing.
    assert result[1]["close"] == 12.5
    assert result[1]["change_pct"] is None and result[1]["volume"] is None


def test_scanner_formats_golden_cross_value_as_sma50_minus_sma200():
    result = _format_scan_records(
        [{"symbol": "THYAO", "sma50": 325.0, "sma200": 315.0, "change": 1.5}],
        "Golden Cross",
        "sma_spread",
        "golden_cross",
    )

    assert result[0]["ticker"] == "THYAO"
    assert result[0]["signal"] == "Golden Cross"
    assert result[0]["signal_key"] == "golden_cross"
    assert result[0]["value"] == 10.0
    assert result[0]["change_pct"] == 1.5


def test_scanner_conditions_are_whitelisted():
    assert resolve_condition(None).expression == "close > 0"
    assert resolve_condition("golden_cross").expression == "sma_50 crosses_above sma_200"
    with pytest.raises(InvalidInputError):
        resolve_condition("close > 0; drop")


async def test_scanner_outage_is_503_not_an_empty_match_list(monkeypatch):
    # borsapy swallows scanner request errors (warning + empty frame).
    runs: list[str] = []

    def swallowed_failure(expression, signal):
        runs.append(expression)
        return pd.DataFrame()

    async def scanner_down(symbols, columns, **kwargs):
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    monkeypatch.setattr(scanner_adapter, "_run_scan", swallowed_failure)
    monkeypatch.setattr(scanner_adapter, "tradingview_scan", scanner_down)

    for _ in range(2):
        result = await scanner_adapter.scan_signals("rsi_oversold")
        assert result["error_status"] == 503 and result["results"] == []
    assert len(runs) == 2  # the outage is not cached as "no matches"


async def test_scanner_empty_result_is_a_real_no_match_when_scanner_is_up(monkeypatch):
    async def scanner_up(symbols, columns, **kwargs):
        return {"XU100": {"close": 13198.84}}

    monkeypatch.setattr(scanner_adapter, "_run_scan", lambda expression, signal: pd.DataFrame())
    monkeypatch.setattr(scanner_adapter, "tradingview_scan", scanner_up)

    result = await scanner_adapter.scan_signals("golden_cross")
    assert "error" not in result and result["results"] == []


@pytest.mark.parametrize("components", [[], ["XU100"]])
def test_scanner_without_index_components_raises_503(monkeypatch, components):
    import borsapy

    class FakeScanner:
        symbols = components

        def set_universe(self, universe):
            return self

    monkeypatch.setattr(borsapy, "TechnicalScanner", FakeScanner)
    with pytest.raises(MarketDataError) as exc_info:
        scanner_adapter._run_scan("rsi < 30", "RSI Aşırı Satım")
    assert exc_info.value.status_code == 503


def test_screener_sector_filter_accepts_only_sector_codes():
    import pytest

    from src.adapters.screener_adapter import normalize_filters
    from src.adapters.utils import InvalidInputError

    assert normalize_filters({"sector": " 0001 "})["sector"] == "0001"
    with pytest.raises(InvalidInputError):
        normalize_filters({"sector": "Bankacılık"})
