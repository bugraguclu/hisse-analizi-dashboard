"""Run the real WidgetRepository SQL (not the in-memory fake) through the HTTP API on SQLite.

The fake in ``test_widget_api.py`` covers response shapes; this file guards the actual
queries: single-use code consumption, owner scoping of patch/delete, and revocation.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from fastapi.responses import JSONResponse
from httpx import ASGITransport, AsyncClient
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles

from src.api.app import app
from src.db.models import WidgetDevice, WidgetPairing
from src.db.session import get_db
from src.services import widget_service

OWNER_A = {"X-Widget-Owner": "owner_key_alpha_1234567890"}
OWNER_B = {"X-Widget-Owner": "owner_key_beta_0987654321"}
PAIRING_BODY = {"watchlist_id": "fav", "watchlist_name": "Favoriler", "tickers": ["THYAO", "GARAN"]}


@compiles(JSONB, "sqlite")
def _jsonb_on_sqlite(element, compiler, **kw):  # pragma: no cover - DDL glue for tests only
    return "JSON"


@pytest.fixture
async def api(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'widget.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(WidgetPairing.__table__.create)
        await conn.run_sync(WidgetDevice.__table__.create)
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def override_db():
        async with sessions() as db:
            yield db

    summary = AsyncMock(return_value=JSONResponse({"ok": True}))  # skip market data
    monkeypatch.setattr("src.api.routers_widget.build_widget_summary", summary)
    monkeypatch.setattr(widget_service, "build_widget_summary", summary)
    app.dependency_overrides[get_db] = override_db
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            client.sessions = sessions  # type: ignore[attr-defined]
            yield client
    finally:
        app.dependency_overrides.pop(get_db, None)
        await engine.dispose()


async def _count(client, model) -> int:
    async with client.sessions() as db:
        return (await db.execute(select(func.count()).select_from(model))).scalar_one()


async def _pair(client, owner=OWNER_A) -> dict:
    code = (await client.post("/widget/devices", json=PAIRING_BODY, headers=owner)).json()["code"]
    response = await client.post("/widget/pair", json={"code": code, "name": "iPhone"})
    assert response.status_code == 200, response.text
    return {"code": code, **response.json()}


async def test_new_code_replaces_previous_code_for_same_owner(api):
    first = (await api.post("/widget/devices", json=PAIRING_BODY, headers=OWNER_A)).json()["code"]
    await api.post("/widget/devices", json=PAIRING_BODY, headers=OWNER_A)
    await api.post("/widget/devices", json=PAIRING_BODY, headers=OWNER_B)

    assert await _count(api, WidgetPairing) == 2  # one per owner
    stale = await api.post("/widget/pair", json={"code": first, "name": "iPhone"})
    assert stale.status_code == 400


async def test_code_is_single_use_and_token_reads_summary(api):
    paired = await _pair(api)
    again = await api.post("/widget/pair", json={"code": paired["code"], "name": "iPhone"})
    assert again.status_code == 400
    assert await _count(api, WidgetPairing) == 0

    devices = (await api.get("/widget/devices", headers=OWNER_A)).json()["devices"]
    assert [d["tickers"] for d in devices] == [["THYAO", "GARAN"]]

    # Scheme is case-insensitive; a refresh right after another does not rewrite last_seen_at.
    auth = {"Authorization": f"bearer {paired['token']}"}
    assert (await api.get("/widget/summary", headers=auth)).status_code == 200
    async with api.sessions() as db:
        first_seen = (await db.execute(select(WidgetDevice.last_seen_at))).scalar_one()
    assert first_seen is not None
    assert (await api.get("/widget/summary", headers=auth)).status_code == 200
    async with api.sessions() as db:
        assert (await db.execute(select(WidgetDevice.last_seen_at))).scalar_one() == first_seen


async def test_other_owner_cannot_change_or_revoke_device(api):
    paired = await _pair(api)
    device_id = paired["device"]["id"]
    update = {**PAIRING_BODY, "tickers": ["ASELS"]}

    assert (await api.patch(f"/widget/devices/{device_id}", json=update, headers=OWNER_B)).status_code == 404
    assert (await api.delete(f"/widget/devices/{device_id}", headers=OWNER_B)).status_code == 404
    assert (await api.get("/widget/devices", headers=OWNER_B)).json()["devices"] == []

    patched = await api.patch(f"/widget/devices/{device_id}", json=update, headers=OWNER_A)
    assert patched.json()["tickers"] == ["ASELS"]

    assert (await api.delete(f"/widget/devices/{device_id}", headers=OWNER_A)).status_code == 200
    auth = {"Authorization": f"Bearer {paired['token']}"}
    assert (await api.get("/widget/summary", headers=auth)).status_code == 401


async def test_phone_can_revoke_its_own_token(api):
    paired = await _pair(api)
    auth = {"Authorization": f"Bearer {paired['token']}"}
    assert (await api.delete("/widget/summary", headers=auth)).status_code == 200
    assert await _count(api, WidgetDevice) == 0
    assert (await api.get("/widget/summary", headers=auth)).status_code == 401
