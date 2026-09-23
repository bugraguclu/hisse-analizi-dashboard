"""/fundamentals/{ticker}/<reference> endpoints: legacy body + additive ``meta``, legacy error contract."""

from datetime import datetime, timezone

import httpx
import pytest

from src.adapters.utils import MarketDataError
from src.api.app import app
from src.core.meta import DataMeta
from src.db.session import get_db
from src.services import reference_service

FETCHED = datetime(2026, 9, 23, 6, 0, tzinfo=timezone.utc)


@pytest.fixture
async def client():
    async def fake_db():
        yield object()

    app.dependency_overrides[get_db] = fake_db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
            yield c
    finally:
        app.dependency_overrides.pop(get_db, None)


ENDPOINTS = {
    "dividends": "get_dividends",
    "holders": "get_holders",
    "recommendations": "get_recommendations",
    "price-targets": "get_price_targets",
    "earnings-dates": "get_earnings_dates",
}


@pytest.mark.parametrize(("path", "function"), sorted(ENDPOINTS.items()))
async def test_reference_endpoint_adds_meta_to_the_legacy_body(client, monkeypatch, path, function):
    seen = {}

    async def fake(session, ticker):
        seen["ticker"] = ticker
        body = {"ticker": ticker, "source": "İş Yatırım (borsapy)", "items": [], "available": False}
        return body, DataMeta(source="isyatirim", fetched_at=FETCHED, served_from="store", as_of="2026-09-23")

    monkeypatch.setattr(reference_service, function, fake)
    response = await client.get(f"/fundamentals/thyao.is/{path}")

    assert response.status_code == 200
    data = response.json()
    assert seen["ticker"] == "THYAO"  # normalised symbol
    assert list(data)[:4] == ["ticker", "source", "items", "available"]
    assert data["meta"]["served_from"] == "store" and data["meta"]["source"] == "isyatirim"
    assert data["meta"]["fetched_at"] == FETCHED.isoformat() and data["meta"]["stale"] is False


@pytest.mark.parametrize("status", [404, 502, 503])
async def test_provider_failure_keeps_the_turkish_error_contract(client, monkeypatch, status):
    async def failing(session, ticker):
        raise MarketDataError("Veri sağlayıcısına şu anda ulaşılamıyor", status_code=status)

    monkeypatch.setattr(reference_service, "get_dividends", failing)
    response = await client.get("/fundamentals/THYAO/dividends")

    assert response.status_code == status
    assert response.json() == {"detail": "Veri sağlayıcısına şu anda ulaşılamıyor"}


async def test_invalid_symbol_is_400(client):
    response = await client.get("/fundamentals/TH$YAO/holders")

    assert response.status_code == 400
