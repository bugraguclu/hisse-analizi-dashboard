"""TradingView scanner client: request shape, parsing and error mapping (no network)."""

import json

import httpx
import pytest

from src.adapters import utils
from src.adapters.utils import MarketDataError, tradingview_scan, upstream_failure


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_scan_requests_exact_tickers_and_parses_rows(monkeypatch):
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"totalCount": 2, "data": [
            {"s": "BIST:THYAO", "d": [300.25, 1e100]},
            {"s": "BIST:KONTR", "d": [2.31, None]},
            {"s": "BIST:BROKEN", "d": [1.0]},  # wrong arity is ignored
        ]})

    monkeypatch.setattr(utils, "get_http_client", lambda: _client(handler))
    rows = await tradingview_scan(["THYAO", "KONTR", "THYAO"], ["close", "volume"])

    assert seen["body"]["symbols"]["tickers"] == ["BIST:THYAO", "BIST:KONTR"]
    assert seen["body"]["columns"] == ["close", "volume"]
    assert rows == {"THYAO": {"close": 300.25, "volume": None}, "KONTR": {"close": 2.31, "volume": None}}


async def test_empty_symbol_list_never_scans_the_whole_market(monkeypatch):
    def handler(request):  # pragma: no cover - must not be called
        raise AssertionError("no request expected")

    monkeypatch.setattr(utils, "get_http_client", lambda: _client(handler))
    assert await tradingview_scan([], ["close"]) == {}


@pytest.mark.parametrize(
    ("response", "status"),
    [
        (httpx.Response(500, text="oops"), 503),
        (httpx.Response(429, text="slow down"), 503),
        (httpx.Response(400, json={"error": "Unknown field"}), 502),
        (httpx.Response(200, text="<html>"), 502),
    ],
)
async def test_scan_errors_map_to_safe_messages(monkeypatch, response, status):
    monkeypatch.setattr(utils, "get_http_client", lambda: _client(lambda request: response))

    with pytest.raises(MarketDataError) as exc_info:
        await tradingview_scan(["THYAO"], ["close"])
    assert exc_info.value.status_code == status
    assert "oops" not in exc_info.value.message


async def test_network_failure_is_503(monkeypatch):
    def handler(request):
        raise httpx.ConnectError("boom")

    monkeypatch.setattr(utils, "get_http_client", lambda: _client(handler))
    with pytest.raises(MarketDataError) as exc_info:
        await tradingview_scan(["THYAO"], ["close"])
    assert exc_info.value.status_code == 503


def test_upstream_failure_helper():
    assert upstream_failure({"data": []}) is None
    assert upstream_failure({"error": "x", "error_status": 404}) == (404, "x")
    assert upstream_failure({"error": "x", "error_status": True}) == (502, "x")
    assert upstream_failure({"error": "x"}) == (502, "x")
    assert upstream_failure({"error": "  "}) is None
