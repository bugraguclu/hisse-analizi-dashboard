"""Integration tests: borsapy / TradingView ile gercek veri cekme.
Bu testler network erisimi gerektirir; SKIP_NETWORK_TESTS=1 ile atlanir.
"""
import os

import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    # pytest-asyncio runs every test on a new event loop; the shared client is loop-bound.
    monkeypatch.setattr(utils, "_http_client", None)
    yield
    utils.adapter_cache.clear()


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_price_data():
    import borsapy as bp

    ticker = bp.Ticker("THYAO")
    # borsapy expects yfinance-style periods; Turkish ones ("1ay") are silently ignored.
    df = ticker.history(period="1mo", interval="1d")
    assert df is not None
    assert len(df) > 0
    assert "Close" in df.columns
    assert "Volume" in df.columns

    # The live quote and the latest daily candle must describe the same grain.
    fast_info = ticker.fast_info
    assert fast_info["last_price"] == pytest.approx(float(df.iloc[-1]["Close"]), rel=0.01)


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_companies():
    import borsapy as bp

    companies = bp.companies()
    assert companies is not None
    assert len(companies) > 700
    tickers = companies["ticker"].tolist()
    assert "THYAO" in tickers


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
async def test_exact_ticker_quotes_include_small_caps_and_indices():
    from src.adapters.price import get_quotes

    quotes = await get_quotes(("THYAO", "KONTR", "XU100", "XUSIN", "ZZZZZ"))

    for symbol in ("THYAO", "KONTR", "XU100", "XUSIN"):
        assert quotes[symbol]["last"] > 0
        assert quotes[symbol]["prev_close"] > 0
    assert "ZZZZZ" not in quotes


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
async def test_one_day_chart_contains_a_single_session():
    from src.adapters.price import get_chart_bars
    from src.adapters.utils import resolve_period

    frame = await get_chart_bars("XU100", resolve_period("1g"))
    assert len(frame) > 0
    assert len({ts.date() for ts in frame.index}) == 1


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
async def test_tradingview_rsi_matches_local_wilder_rsi():
    from src.adapters.price import get_daily_bars
    from src.adapters.technical import get_rsi, rsi_last

    tv = await get_rsi("THYAO", period=14)
    local = rsi_last((await get_daily_bars("THYAO"))["Close"], 14)
    assert tv["source"] == "TradingView"
    assert local is not None
    # Same data source; allow for the last bar moving between the two requests.
    assert tv["value"] == pytest.approx(local, abs=1.5)


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
async def test_unknown_symbol_is_not_found():
    from src.adapters.technical import get_ta_signals

    result = await get_ta_signals("ZZZZZ")
    assert result["error_status"] == 404
