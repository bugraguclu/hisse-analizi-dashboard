"""Tests for iOS widget QR pairing, single-use code consumption, revocation, and summary API."""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from src.api import routers_widget
from src.api.app import app
from src.core.meta import DataMeta
from src.db.session import get_db
from src.services import market_service, widget_service

OWNER_A = "owner_key_alpha_1234567890"
OWNER_B = "owner_key_beta_0987654321"


class InMemoryWidgetStore:
    """In-memory backing store enforcing the exact DB constraints of WidgetRepository."""

    def __init__(self) -> None:
        self.pairings: dict[uuid.UUID, SimpleNamespace] = {}
        self.devices: dict[uuid.UUID, SimpleNamespace] = {}
        self.company_names: dict[str, str] = {"THYAO": "Türk Hava Yolları", "GARAN": "Garanti BBVA"}
        self.expected_disclosures: list[tuple[str, SimpleNamespace]] = []
        self.dividends: list[tuple[str, SimpleNamespace]] = []
        self.commits = 0


class FakeWidgetRepository:
    store: InMemoryWidgetStore

    def __init__(self, db: Any) -> None:
        self.db = db

    async def replace_pairing(
        self,
        *,
        owner_hash: str,
        code_hash: str,
        watchlist_id: str,
        watchlist_name: str,
        tickers: list[str],
        dashboard_id: str | None,
        now: datetime,
        expires_at: datetime,
    ) -> SimpleNamespace:
        for pid in list(self.store.pairings):
            p = self.store.pairings[pid]
            if p.owner_hash == owner_hash or p.expires_at <= now:
                del self.store.pairings[pid]
        row = SimpleNamespace(
            id=uuid.uuid4(),
            owner_hash=owner_hash,
            code_hash=code_hash,
            watchlist_id=watchlist_id,
            watchlist_name=watchlist_name,
            tickers=list(tickers),
            dashboard_id=dashboard_id,
            expires_at=expires_at,
            created_at=now,
        )
        self.store.pairings[row.id] = row
        return row

    async def consume_pairing(
        self,
        *,
        code_hash: str,
        now: datetime,
        device_name: str,
        token_hash: str,
    ) -> SimpleNamespace | None:
        matched = next(
            (p for p in self.store.pairings.values() if p.code_hash == code_hash and p.expires_at > now),
            None,
        )
        if matched is None:
            return None
        del self.store.pairings[matched.id]
        device = SimpleNamespace(
            id=uuid.uuid4(),
            owner_hash=matched.owner_hash,
            name=device_name,
            token_hash=token_hash,
            scope="widget:read",
            watchlist_id=matched.watchlist_id,
            watchlist_name=matched.watchlist_name,
            tickers=list(matched.tickers),
            dashboard_id=matched.dashboard_id,
            created_at=now,
            last_seen_at=None,
        )
        self.store.devices[device.id] = device
        return device

    async def list_devices(self, owner_hash: str) -> list[SimpleNamespace]:
        return sorted(
            [d for d in self.store.devices.values() if d.owner_hash == owner_hash],
            key=lambda d: d.created_at,
            reverse=True,
        )

    async def update_device(
        self,
        *,
        owner_hash: str,
        device_id: uuid.UUID,
        watchlist_id: str,
        watchlist_name: str,
        tickers: list[str],
        dashboard_id: str | None,
    ) -> SimpleNamespace | None:
        device = self.store.devices.get(device_id)
        if device is None or device.owner_hash != owner_hash:
            return None
        device.watchlist_id = watchlist_id
        device.watchlist_name = watchlist_name
        device.tickers = list(tickers)
        device.dashboard_id = dashboard_id
        return device

    async def delete_device(self, *, owner_hash: str, device_id: uuid.UUID) -> bool:
        device = self.store.devices.get(device_id)
        if device is None or device.owner_hash != owner_hash:
            return False
        del self.store.devices[device_id]
        return True

    async def get_device_by_token_hash(self, token_hash: str) -> SimpleNamespace | None:
        return next((d for d in self.store.devices.values() if d.token_hash == token_hash), None)

    async def touch_device(self, device_id: uuid.UUID, seen_at: datetime) -> None:
        if device_id in self.store.devices:
            self.store.devices[device_id].last_seen_at = seen_at

    async def delete_device_by_id(self, device_id: uuid.UUID) -> bool:
        return self.store.devices.pop(device_id, None) is not None

    async def company_names_for_tickers(self, tickers: list[str]) -> dict[str, str]:
        return {t: self.store.company_names[t] for t in tickers if t in self.store.company_names}

    async def upcoming_expected_disclosures(
        self, tickers: list[str], *, from_date: date, until_date: date
    ) -> list[tuple[str, SimpleNamespace]]:
        return [
            (ticker, row)
            for ticker, row in self.store.expected_disclosures
            if ticker in tickers and (
                (row.start_date and from_date <= row.start_date <= until_date)
                or (row.end_date and from_date <= row.end_date <= until_date)
            )
        ]

    async def upcoming_dividends(
        self, tickers: list[str], *, from_date: date, until_date: date
    ) -> list[tuple[str, SimpleNamespace]]:
        return [
            (ticker, row)
            for ticker, row in self.store.dividends
            if ticker in tickers and (
                from_date <= row.ex_date <= until_date
                or (row.payment_date and from_date <= row.payment_date <= until_date)
            )
        ]


class FakeSession:
    def __init__(self, store: InMemoryWidgetStore) -> None:
        self.store = store

    async def commit(self) -> None:
        self.store.commits += 1


@pytest.fixture
def widget_env(monkeypatch: pytest.MonkeyPatch):
    store = InMemoryWidgetStore()
    FakeWidgetRepository.store = store
    monkeypatch.setattr(routers_widget, "WidgetRepository", FakeWidgetRepository)
    monkeypatch.setattr(widget_service, "WidgetRepository", FakeWidgetRepository)

    fixed_now = datetime(2026, 11, 20, 10, 0, tzinfo=UTC)
    clock = {"now": fixed_now}
    monkeypatch.setattr(routers_widget, "utcnow", lambda: clock["now"])
    monkeypatch.setattr(widget_service, "utcnow", lambda: clock["now"])

    async def fake_quotes(symbols: tuple[str, ...]):
        quotes: dict[str, dict[str, Any]] = {}
        for s in symbols:
            if s == "XU100":
                quotes[s] = {
                    "symbol": "XU100",
                    "last": 10245.5,
                    "change": 142.3,
                    "change_percent": 1.41,
                    "updated_at": "2026-11-20T12:45:00+03:00",
                    "session_state": "open",
                }
            elif s == "THYAO":
                quotes[s] = {
                    "symbol": "THYAO",
                    "name": "THY",
                    "last": 312.5,
                    "change": 6.0,
                    "change_percent": 1.96,
                    "updated_at": "2026-11-20T12:45:00+03:00",
                    "session_state": "open",
                }
            elif s == "GARAN":
                quotes[s] = {
                    "symbol": "GARAN",
                    "name": "Garanti",
                    "last": 124.2,
                    "change": -1.1,
                    "change_percent": -0.88,
                    "updated_at": "2026-11-20T12:45:00+03:00",
                    "session_state": "open",
                }
        return SimpleNamespace(
            quotes=quotes,
            meta=DataMeta(
                source="tradingview",
                fetched_at=clock["now"],
                as_of="2026-11-20T12:45:00+03:00",
                served_from="store",
                stale=False,
                delay_seconds=900,
            ),
        )

    async def fake_tcmb():
        return {
            "source": "TCMB",
            "events": [
                {"type": "ppk", "label": "PPK Faiz Kararı", "date": "2026-11-26"},
            ],
        }

    async def fake_econ(*args: Any, **kwargs: Any):
        return {
            "calendar": [
                {
                    "id": "tr-cpi-nov",
                    "title_tr": "TÜFE (Yıllık)",
                    "country_code": "TR",
                    "Date": "2026-12-03",
                    "datetime": "2026-12-03T10:00:00+03:00",
                    "importance": "high",
                    "Forecast": "%44,2",
                }
            ]
        }

    monkeypatch.setattr(market_service, "get_quotes", fake_quotes)
    monkeypatch.setattr(widget_service, "get_tcmb_calendar", fake_tcmb)
    monkeypatch.setattr(widget_service, "get_economic_calendar", fake_econ)

    store.expected_disclosures.append(
        (
            "THYAO",
            SimpleNamespace(
                subject="3. Çeyrek Finansal Rapor",
                period_term="9 Aylık",
                fiscal_year=2026,
                start_date=date(2026, 11, 24),
                end_date=date(2026, 11, 28),
            ),
        )
    )
    store.dividends.append(
        (
            "GARAN",
            SimpleNamespace(
                ex_date=date(2026, 11, 27),
                payment_date=date(2026, 12, 1),
                net_per_share=Decimal("3.45"),
                gross_per_share=Decimal("4.06"),
            ),
        )
    )

    session = FakeSession(store)

    async def override_db():
        yield session

    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client, store, clock
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_pairing_code_single_use_and_hashed_storage(widget_env):
    client, store, _clock = widget_env

    # Create pairing code
    resp = client.post(
        "/widget/devices",
        headers={"X-Widget-Owner": OWNER_A},
        json={
            "watchlist_id": "favorites",
            "watchlist_name": "Favorilerim",
            "tickers": ["thyao.is", "GARAN", "BAD!!", "THYAO"],
            "dashboard_id": "morning",
        },
    )
    assert resp.status_code == 201
    data = resp.json()
    code = data["code"]
    assert len(code) == 8
    assert data["tickers"] == ["THYAO", "GARAN"]
    # Pairing code is never stored in plaintext
    assert all(p.code_hash != code for p in store.pairings.values())

    # Pair with formatted code (hyphens & lowercase accepted)
    formatted = f"{code[:4].lower()}-{code[4:].lower()}"
    pair_resp = client.post("/widget/pair", json={"code": formatted, "name": "Buğra iPhone"})
    assert pair_resp.status_code == 200
    pair_body = pair_resp.json()
    token = pair_body["token"]
    assert len(token) >= 32
    assert pair_body["scope"] == "widget:read"
    assert pair_body["device"]["name"] == "Buğra iPhone"
    # Raw bearer token is never stored in DB — only SHA-256 hash
    assert all(d.token_hash != token for d in store.devices.values())
    assert len(store.pairings) == 0

    # Reusing the exact same code fails with 400 invalid_code
    reuse = client.post("/widget/pair", json={"code": code, "name": "Other iPhone"})
    assert reuse.status_code == 400
    assert reuse.json()["code"] == "invalid_code"


def test_expired_and_invalid_codes_rejected(widget_env):
    client, _store, clock = widget_env

    bad = client.post("/widget/pair", json={"code": "INVALID!", "name": "iPhone"})
    assert bad.status_code == 400
    assert bad.json()["code"] == "invalid_code"

    created = client.post(
        "/widget/devices",
        headers={"X-Widget-Owner": OWNER_A},
        json={"watchlist_id": "favorites", "tickers": ["THYAO"]},
    )
    code = created.json()["code"]

    # Advance past 10-minute TTL
    clock["now"] = clock["now"] + timedelta(minutes=11)
    expired = client.post("/widget/pair", json={"code": code, "name": "iPhone"})
    assert expired.status_code == 400
    assert expired.json()["code"] == "invalid_code"


def test_summary_payload_and_web_revocation(widget_env):
    client, store, _clock = widget_env

    # Create & pair
    code = client.post(
        "/widget/devices",
        headers={"X-Widget-Owner": OWNER_A},
        json={"watchlist_id": "fav-1", "watchlist_name": "BIST Takip", "tickers": ["THYAO", "GARAN"]},
    ).json()["code"]
    paired = client.post("/widget/pair", json={"code": code, "name": "iPhone 16"}).json()
    token = paired["token"]
    device_id = paired["device"]["id"]

    # Fetch widget summary
    summary_resp = client.get("/widget/summary", headers={"Authorization": f"Bearer {token}"})
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    assert summary["bist100"]["symbol"] == "XU100"
    assert summary["bist100"]["last"] == 10245.5
    assert summary["session_state"] == "open"
    assert summary["delay_seconds"] == 900
    assert summary["watchlist"]["id"] == "fav-1"
    assert [i["ticker"] for i in summary["watchlist"]["items"]] == ["THYAO", "GARAN"]
    assert summary["watchlist"]["items"][0]["name"] == "Türk Hava Yolları"

    # Upcoming events include earnings, dividend, TCMB PPK, and economic calendar sorted chronologically
    kinds = {e["kind"] for e in summary["upcoming_events"]}
    assert kinds == {"earnings", "dividend", "economic"}
    ids = [e["id"] for e in summary["upcoming_events"]]
    assert any(i.startswith("earnings:THYAO:") for i in ids)
    assert any(i.startswith("dividend:GARAN:") for i in ids)
    assert "tcmb:ppk:2026-11-26" in ids
    assert any(i.startswith("econ:tr:") for i in ids)
    dates = [e["scheduled_at"] for e in summary["upcoming_events"]]
    assert dates == sorted(dates)

    # Owner B cannot see or revoke Owner A's device
    assert client.get("/widget/devices", headers={"X-Widget-Owner": OWNER_B}).json()["devices"] == []
    assert client.delete(f"/widget/devices/{device_id}", headers={"X-Widget-Owner": OWNER_B}).status_code == 404

    # Owner A can update the device's watchlist without re-pairing
    patch_resp = client.patch(
        f"/widget/devices/{device_id}",
        headers={"X-Widget-Owner": OWNER_A},
        json={"watchlist_id": "banka", "watchlist_name": "Bankalar", "tickers": ["GARAN"]},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["tickers"] == ["GARAN"]

    # Owner A revokes device -> subsequent summary fetch immediately fails with 401 widget_unpaired
    revoke = client.delete(f"/widget/devices/{device_id}", headers={"X-Widget-Owner": OWNER_A})
    assert revoke.status_code == 200
    assert revoke.json() == {"revoked": True}

    after_revoke = client.get("/widget/summary", headers={"Authorization": f"Bearer {token}"})
    assert after_revoke.status_code == 401
    assert after_revoke.json()["code"] == "widget_unpaired"
    assert len(store.devices) == 0


def test_phone_self_unpair_and_missing_headers(widget_env):
    client, _store, _clock = widget_env

    assert client.get("/widget/devices").status_code == 400
    assert client.get("/widget/summary").status_code == 401

    code = client.post(
        "/widget/devices",
        headers={"X-Widget-Owner": OWNER_A},
        json={"watchlist_id": "favorites", "tickers": ["THYAO"]},
    ).json()["code"]
    token = client.post("/widget/pair", json={"code": code, "name": "iPhone"}).json()["token"]

    unpair = client.delete("/widget/summary", headers={"Authorization": f"Bearer {token}"})
    assert unpair.status_code == 200
    assert unpair.json() == {"revoked": True}

    # Already unpaired -> 401
    assert client.get("/widget/summary", headers={"Authorization": f"Bearer {token}"}).status_code == 401
