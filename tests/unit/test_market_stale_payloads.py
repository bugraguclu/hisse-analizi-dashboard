"""Provider outage: adapters answer from the market store with ``meta.stale`` and the historical shape."""

from datetime import UTC, date, datetime, timedelta

import pandas as pd
import pytest

from src.adapters import fundamentals_snapshot, index_adapter, isyatirim_prices, price, stream_adapter, technical
from src.adapters.utils import ISTANBUL_TZ, MarketDataError, adapter_cache
from src.services import market_service as ms

NOW = datetime(2026, 9, 23, 14, 0, tzinfo=ISTANBUL_TZ)
DOWN = MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)


def _quote(symbol, last, *, kind="stock"):
    return {
        "symbol": symbol, "name": f"{symbol} A.Ş.", "type": kind, "currency": "TRY", "last": last, "open": last - 1,
        "high": last + 1, "low": last - 2, "prev_close": last - 0.5, "change": 0.5,
        "change_percent": round(0.5 / (last - 0.5) * 100, 6), "volume": 1e6, "turnover": last * 1e6,
        "market_cap": 1e11, "bid": None, "ask": None, "timestamp": 1790163000,
        "updated_at": "2026-09-23T14:30:00+03:00", "session_date": date(2026, 9, 23), "delay_seconds": 900,
        "source": "tradingview", "fetched_at": datetime(2026, 9, 23, 7, 0, tzinfo=UTC),  # hours old
    }


@pytest.fixture(autouse=True)
def outage(monkeypatch):
    """Every provider is down; the store holds copies that are hours old."""
    adapter_cache.clear()
    stored = {s: _quote(s, v) for s, v in (("THYAO", 298.5), ("GARAN", 133.8))}
    stored["XU100"] = _quote("XU100", 13251.85, kind="index")
    days = pd.bdate_range(end="2026-09-23", periods=600)
    bars = [
        ms.StoredBar(bar_date=d.date(), open=100.0 + i, high=101.0 + i, low=99.0 + i, close=100.5 + i, volume=1e6,
                     turnover=None, vwap=None, source="tradingview", adjusted=True, is_final=d.date() < date(2026, 9, 23),
                     fetched_at=datetime(2026, 9, 23, 7, 0, tzinfo=UTC))
        for i, d in enumerate(days)
    ]

    async def read_quotes(symbols):
        return {s: stored[s] for s in symbols if s in stored}

    async def read_bars(symbol, since):
        return (bars, None) if symbol in stored else ([], None)

    async def nothing(*args, **kwargs):
        return None

    async def down(*args, **kwargs):
        raise DOWN

    async def no_isyatirim(symbols):
        return {}

    monkeypatch.setattr(ms, "_read_quotes", read_quotes)
    monkeypatch.setattr(ms, "_read_bars", read_bars)
    monkeypatch.setattr(ms, "_write_quotes", nothing)
    monkeypatch.setattr(ms, "_write_bars", nothing)
    monkeypatch.setattr(ms, "_read_quote_extras", nothing)
    monkeypatch.setattr(price, "tradingview_scan", down)
    monkeypatch.setattr(price, "_websocket_quote_sync", lambda symbol: (_ for _ in ()).throw(DOWN))
    monkeypatch.setattr(price, "_load_bars", down)
    monkeypatch.setattr(price, "get_company_metrics", down)
    monkeypatch.setattr(index_adapter, "get_company_metrics", down)
    monkeypatch.setattr(technical, "tradingview_scan", down)
    monkeypatch.setattr(isyatirim_prices, "fetch_isyatirim_quotes", no_isyatirim)
    monkeypatch.setattr(price, "now_istanbul", lambda: NOW)
    monkeypatch.setattr(fundamentals_snapshot, "_company_metrics_or_empty", lambda ticker: _empty())
    import src.adapters.utils as utils

    monkeypatch.setattr(utils, "tradingview_scan", down)  # snapshot rows import it lazily
    yield
    adapter_cache.clear()


async def _empty():
    return {}


async def test_snapshot_serves_stored_quotes_flagged_stale():
    payload = await stream_adapter.get_snapshot(["THYAO", "GARAN", "NOPE"])

    assert "error" not in payload
    assert payload["snapshot"]["THYAO"]["last_price"] == 298.5
    assert payload["snapshot"]["NOPE"] == {"error": stream_adapter.MISSING_QUOTE_MESSAGE}
    assert payload["meta"]["served_from"] == "stale" and payload["meta"]["stale"] is True
    assert ms.STALE_NOTE in payload["meta"]["notes"]


async def test_index_list_and_history_serve_the_store_during_an_outage():
    indices = await index_adapter.list_indices()
    history = await index_adapter.get_ticker_history("THYAO", "3ay")

    assert [q["symbol"] for q in indices["quotes"]] == ["XU100"] and indices["meta"]["stale"] is True
    assert "error" not in history and len(history["data"]) > 50
    assert history["info"]["last_price"] == 298.5
    assert history["meta"]["stale"] is True
    for key in ("ticker", "source", "period", "interval", "info", "reference_close", "reference_date", "data"):
        assert key in history


async def test_fast_info_falls_back_to_the_stored_quote():
    payload = await fundamentals_snapshot.get_fast_info("GARAN")

    assert "error" not in payload
    assert payload["fast_info"]["last_price"] == 133.8 and payload["fast_info"]["previous_close"] == 133.3
    assert payload["meta"]["served_from"] == "stale"


async def test_unknown_symbols_keep_the_error_contract():
    payload = await stream_adapter.get_snapshot(["NOPE"])
    assert payload["error_status"] == 503 and payload["snapshot"] == {}
    info = await fundamentals_snapshot.get_fast_info("NOPE")
    assert info["error_status"] == 503 and info["fast_info"] == {}


async def test_technical_values_come_from_the_stored_series_when_tradingview_is_down():
    rsi = await technical.get_rsi("THYAO")
    assert "error" not in rsi and rsi["source"] == technical.SOURCE_LOCAL
    assert rsi["meta"]["served_from"] == "stale"  # the running bar is hours old and the quote refresh failed
    assert (datetime.now(UTC) - datetime.fromisoformat(rsi["meta"]["fetched_at"])) > timedelta(hours=1)
