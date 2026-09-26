"""Unit + integration tests for ``GET /data/status`` (``src.services.quality_service.get_data_status``
and ``src.db.repositories.platform.platform_counts``).

Pure building blocks (``_build_domain``, ``_to_datetime``, ``_job_out``) need no DB.
``get_data_status`` itself is tested against real PostgreSQL, both empty and populated
(aggregate SQL must never fail on an empty table), and once more through the actual
FastAPI app over ASGI with a session override, per docs/data-platform.md §7.
"""

from __future__ import annotations

import time
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.api.routers_data import router as data_router
from src.core.time import utcnow
from src.db.models import Company, IngestionRun, PriceBar, Quote
from src.db.session import get_db
from src.services import quality_service as qs

IST = ZoneInfo("Europe/Istanbul")


# ---------------------------------------------------------------------------
# Pure building blocks
# ---------------------------------------------------------------------------


def test_to_datetime_passes_through_datetime_and_combines_date():
    dt = datetime(2026, 9, 23, 10, 0, tzinfo=IST)
    assert qs._to_datetime(dt) is dt
    combined = qs._to_datetime(date(2026, 9, 23))
    assert combined is not None and combined.date() == date(2026, 9, 23)
    assert qs._to_datetime(None) is None


def test_build_domain_empty_table_is_down():
    now = datetime(2026, 9, 23, 19, 0, tzinfo=IST)
    domain = qs._build_domain("market", row_count=0, latest=None, now=now, jobs=[], tables=[])
    assert domain["status"] == "down"
    assert domain["freshness"] == "empty"
    assert domain["jobs"] == []


def test_build_domain_fresh_data_and_ok_job_is_ok():
    now = datetime(2026, 9, 23, 19, 0, tzinfo=IST)
    run = IngestionRun(job="market.quotes", scope="universe", status="ok", started_at=utcnow())
    domain = qs._build_domain("market", row_count=10, latest=now - timedelta(minutes=5), now=now, jobs=[run], tables=[])
    assert domain["status"] == "ok"
    assert domain["freshness"] == "fresh"
    assert domain["jobs"][0]["job"] == "market.quotes"


def test_build_domain_stale_data_is_degraded():
    now = datetime(2026, 9, 23, 19, 0, tzinfo=IST)
    domain = qs._build_domain("market", row_count=10, latest=now - timedelta(days=30), now=now, jobs=[], tables=[])
    assert domain["status"] == "degraded"
    assert domain["freshness"] == "stale"


# ---------------------------------------------------------------------------
# get_data_status against real Postgres
# ---------------------------------------------------------------------------


async def test_get_data_status_on_empty_database_never_raises(pg_session):
    result = await qs.get_data_status(pg_session)

    assert result["status"] == "down"  # every domain empty
    assert {d["domain"] for d in result["domains"]} == {"universe", "market", "fundamentals", "macro", "quality"}
    assert all(d["freshness"] == "empty" for d in result["domains"])
    assert result["polling_state"] == []
    assert isinstance(result["generated_at"], datetime)


async def test_get_data_status_reflects_seeded_rows(pg_session):
    company = Company(ticker="GARAN", legal_name="Garanti BBVA", display_name="Garanti BBVA", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()
    pg_session.add(Quote(symbol="GARAN", company_id=company.id, last=100, source="tradingview", fetched_at=utcnow()))
    pg_session.add(
        PriceBar(symbol="GARAN", company_id=company.id, bar_date=date(2026, 9, 23), close=100, source="tradingview")
    )
    pg_session.add(
        IngestionRun(
            id=uuid.uuid4(),
            job="market.quotes",
            scope="universe",
            status="ok",
            started_at=utcnow(),
            finished_at=utcnow(),
            items_total=1,
            items_ok=1,
        )
    )
    await pg_session.commit()

    result = await qs.get_data_status(pg_session)

    market = next(d for d in result["domains"] if d["domain"] == "market")
    assert market["freshness"] == "fresh"  # a quote fetched just now is well within the fresh window
    assert market["status"] == "ok"
    quotes_table = next(t for t in market["tables"] if t["table"] == "quotes")
    assert quotes_table["row_count"] == 1
    assert market["jobs"] and market["jobs"][0]["job"] == "market.quotes" and market["jobs"][0]["status"] == "ok"


async def test_get_data_status_is_fast(pg_session):
    started = time.monotonic()
    await qs.get_data_status(pg_session)
    elapsed = time.monotonic() - started
    assert elapsed < 1.0, f"/data/status took {elapsed:.3f}s (must answer in well under 1s)"


# ---------------------------------------------------------------------------
# ASGI transport, real DB via a session override (docs/data-platform.md §7)
# ---------------------------------------------------------------------------


async def test_data_status_endpoint_over_asgi(pg_session, pg_url):
    schema = (await pg_session.execute(text("show search_path"))).scalar()
    engine = create_async_engine(pg_url, connect_args={"server_settings": {"search_path": schema}})
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def db():
        async with factory() as session:
            yield session

    company = Company(ticker="THYAO", legal_name="THY", display_name="THY", tracking_tier="core")
    pg_session.add(company)
    await pg_session.flush()
    pg_session.add(Quote(symbol="THYAO", company_id=company.id, last=300, source="tradingview", fetched_at=utcnow()))
    await pg_session.commit()

    app = FastAPI()
    app.include_router(data_router)
    app.dependency_overrides[get_db] = db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/data/status")
    finally:
        await engine.dispose()

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {"generated_at", "status", "domains", "polling_state"}
    assert len(body["domains"]) == 5
    market = next(d for d in body["domains"] if d["domain"] == "market")
    assert any(t["row_count"] >= 1 for t in market["tables"])


async def test_data_quality_endpoint_over_asgi_returns_persisted_checks(pg_session, pg_url):
    schema = (await pg_session.execute(text("show search_path"))).scalar()
    engine = create_async_engine(pg_url, connect_args={"server_settings": {"search_path": schema}})
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def db():
        async with factory() as session:
            yield session

    from src.db.repositories.platform import QualityCheckRepository

    QualityCheckRepository(pg_session).record(
        {"check_name": "freshness.quotes", "subject": "quotes", "status": "fail", "expected": None, "actual": None, "details": {}}
    )
    await pg_session.commit()

    app = FastAPI()
    app.include_router(data_router)
    app.dependency_overrides[get_db] = db
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            response = await client.get("/data/quality", params={"status": "fail"})
    finally:
        await engine.dispose()

    assert response.status_code == 200
    body = response.json()
    assert len(body) == 1
    assert body[0]["check_name"] == "freshness.quotes"
    assert body[0]["status"] == "fail"
