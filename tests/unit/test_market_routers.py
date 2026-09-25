"""HTTP contract of the market/technical routers: validation and error mapping."""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.api import routers_market, routers_technical


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routers_market.market_router)
    app.include_router(routers_technical.technical_router)
    return TestClient(app)


@pytest.fixture
def recorded(monkeypatch):
    calls: dict[str, tuple] = {}

    def fake(name, payload):
        async def _fake(*args, **kwargs):
            calls[name] = (args, kwargs)
            return payload
        return _fake

    monkeypatch.setattr(routers_market, "get_ticker_history", fake("history", {"ticker": "THYAO", "data": []}))
    monkeypatch.setattr(routers_market, "get_index_data", fake("index", {"symbol": "XU100", "data": []}))
    monkeypatch.setattr(routers_market, "get_snapshot", fake("snapshot", {"snapshot": {}}))
    monkeypatch.setattr(routers_market, "search_symbol", fake("search", {"results": []}))
    monkeypatch.setattr(routers_market, "screen_stocks", fake("screener", {"results": []}))
    monkeypatch.setattr(routers_market, "scan_signals", fake("scanner", {"results": []}))
    monkeypatch.setattr(routers_technical, "get_rsi", fake("rsi", {"value": 50.0}))
    return calls


def test_symbols_are_normalized_before_reaching_adapters(client, recorded):
    assert client.get("/market/ticker/thyao.is/history?period=3AY").status_code == 200
    assert recorded["history"] == (("THYAO",), {"period": "3ay"})
    assert client.get("/technical/garan.e/rsi").status_code == 200
    assert recorded["rsi"] == (("GARAN",), {"period": 14})


@pytest.mark.parametrize("path", ["/technical/X/rsi", "/technical/TH%20YAO/rsi", "/market/ticker/%C5%9EEKER/history",
                                  "/market/index/ABCDEFGHIJK", "/market/snapshot?symbols=THYAO,G@RAN"])
def test_garbage_symbols_are_400_not_502(client, recorded, path):
    response = client.get(path)
    assert response.status_code == 400
    assert "Geçersiz sembol" in response.json()["detail"]


def test_unknown_period_is_400(client, recorded):
    response = client.get("/market/index/XU100?period=10ay")
    assert response.status_code == 400
    assert "Geçersiz periyot" in response.json()["detail"]
    assert "index" not in recorded


def test_snapshot_dedupes_and_caps_symbol_count(client, recorded):
    assert client.get("/market/snapshot?symbols=THYAO,thyao,GARAN").status_code == 200
    assert recorded["snapshot"] == ((["THYAO", "GARAN"],), {})

    too_many = ",".join(f"AB{i:02d}" for i in range(51))
    response = client.get(f"/market/snapshot?symbols={too_many}")
    assert response.status_code == 400
    assert client.get("/market/snapshot?symbols=,,").status_code == 400


def test_search_requires_two_characters(client, recorded):
    assert client.get("/market/search?q=T").status_code == 400
    assert client.get("/market/search?q=%20TH%20").status_code == 200
    assert recorded["search"] == (("TH",), {})


def test_screener_body_is_validated(client, recorded):
    bad = client.post("/market/screener", json={"template": "nope"})
    assert bad.status_code == 400 and "şablon" in bad.json()["detail"]
    assert client.post("/market/screener", json={"unknown": 1}).status_code == 400
    assert client.post("/market/screener", json={"template": "low_pe"}).status_code == 200
    assert "screener" in recorded


def test_scanner_condition_is_whitelisted(client, recorded):
    assert client.get("/market/scanner?condition=rsi%20%3C%2030").status_code == 400
    assert client.get("/market/scanner?condition=Golden_Cross").status_code == 200
    assert recorded["scanner"] == ((), {"condition": "golden_cross"})


@pytest.mark.parametrize(
    ("payload", "status"),
    [
        ({"error": "Sembol bulunamadı: ZZZZZ", "error_status": 404}, 404),
        ({"error": "Piyasa verisi sağlayıcısına ulaşılamadı", "error_status": 503}, 503),
        ({"error": "Fiyat geçmişi alınamadı"}, 502),
    ],
)
def test_adapter_errors_map_to_status_codes(client, monkeypatch, payload, status):
    async def failing(*args, **kwargs):
        return {"ticker": "ZZZZZ", "data": [], **payload}

    monkeypatch.setattr(routers_market, "get_ticker_history", failing)
    response = client.get("/market/ticker/ZZZZZ/history")
    assert response.status_code == status
    assert response.json() == {"detail": payload["error"]}
