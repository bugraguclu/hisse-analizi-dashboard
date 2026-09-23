"""``/prices`` and ``/prices/latest``: store-first refresh, additive fields, provenance (PostgreSQL)."""

from datetime import date

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.api import routers
from src.db.models import Company
from src.db.repositories.market import upsert_bars
from src.db.session import get_db
from src.services import market_service


@pytest.fixture
async def api(pg_session, pg_url, monkeypatch):
    schema = (await pg_session.execute(text("show search_path"))).scalar()
    engine = create_async_engine(pg_url, connect_args={"server_settings": {"search_path": schema}})
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def db():
        async with factory() as session:
            yield session

    pg_session.add(Company(ticker="THYAO", legal_name="THY", display_name="THY", tracking_tier="core"))
    await pg_session.flush()
    await upsert_bars(pg_session, [
        {"symbol": "THYAO", "bar_date": date(2026, 9, 22), "open": 293.5, "high": 302.75, "low": 291.25,
         "close": 298.0, "volume": 54419270, "turnover": 16212514335.0, "vwap": 297.919, "source": "tradingview"},
        {"symbol": "THYAO", "bar_date": date(2026, 9, 23), "open": 298.75, "high": 302.25, "low": 297.25,
         "close": 298.5, "volume": 34150549, "source": "tradingview", "is_final": False},
    ])
    await pg_session.commit()

    refreshed: list[str] = []

    async def fake_daily_bars(symbol):
        refreshed.append(symbol)
        meta = market_service.build_meta(source="tradingview", fetched_at=None, served_from="store",
                                         as_of=date(2026, 9, 23), symbol=symbol)
        return market_service.DailyBars(frame=None, meta=meta)

    monkeypatch.setattr(routers.market_service, "get_daily_bars", fake_daily_bars)
    app = FastAPI()
    app.include_router(routers.router)
    app.dependency_overrides[get_db] = db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        yield client, refreshed
    await engine.dispose()


async def test_prices_list_keeps_its_shape_and_adds_store_fields(api):
    client, refreshed = api
    response = await client.get("/prices", params={"ticker": "thyao", "limit": 5})

    assert response.status_code == 200 and refreshed == ["THYAO"]
    rows = response.json()
    assert isinstance(rows, list) and [r["trading_date"] for r in rows] == ["2026-09-23", "2026-09-22"]
    first, second = rows
    for key in ("id", "ticker", "source", "open", "high", "low", "close", "adjusted_close", "volume",
                "trading_date", "interval", "fetched_at"):
        assert key in first  # historical fields untouched
    assert first["is_final"] is False and second["is_final"] is True
    assert float(second["turnover"]) == 16212514335.0 and float(second["vwap"]) == 297.919
    assert response.headers["x-data-served-from"] == "store"
    assert response.headers["x-data-delay-seconds"] == "900"
    assert response.headers["x-data-as-of"] == "2026-09-23"


async def test_latest_price_carries_meta(api):
    client, _ = api
    body = (await client.get("/prices/latest", params={"ticker": "THYAO"})).json()

    assert body["trading_date"] == "2026-09-23" and float(body["close"]) == 298.5
    assert body["meta"]["served_from"] == "store" and body["meta"]["source"] == "tradingview"


async def test_intraday_intervals_are_not_refreshed(api):
    client, refreshed = api
    response = await client.get("/prices", params={"ticker": "THYAO", "interval": "1h"})
    assert response.status_code == 200 and response.json() == [] and refreshed == []
    assert "x-data-served-from" not in response.headers


async def test_refresh_failures_never_break_the_endpoint(api, monkeypatch):
    client, _ = api

    async def broken(symbol):
        raise RuntimeError("provider down, nothing stored")

    monkeypatch.setattr(routers.market_service, "get_daily_bars", broken)
    response = await client.get("/prices/latest", params={"ticker": "THYAO"})
    assert response.status_code == 200 and response.json()["meta"] is None
