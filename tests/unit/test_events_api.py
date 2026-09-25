"""/events API: filters, facets and disclosure content (DB and KAP mocked)."""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient

from src.adapters import kap
from src.api import routers
from src.api.app import app
from src.core.enums import EventCategory, EventType, Severity
from src.db.repository import EventFacets, EventFilters
from src.db.session import get_db

EVENT_ID = uuid.UUID("4eef0646-8800-4551-bc2c-4730aafe1503")
KAP_URL = "https://www.kap.org.tr/tr/Bildirim/1666380"


def _event(**overrides: Any) -> SimpleNamespace:
    values: dict[str, Any] = {
        "id": EVENT_ID,
        "event_type": EventType.KAP_DISCLOSURE,
        "title": "Yeni İş İlişkisi",
        "excerpt": "Mardin-2 Lisanssız Güneş Enerji Santrali Projesi Sözleşmesi",
        "published_at": datetime(2026, 9, 22, 9, 0, tzinfo=UTC),
        "event_url": KAP_URL,
        "source_code": "kap",
        "severity": Severity.HIGH,
        "is_notifiable": True,
        "ticker": "GESAN",
        "category": EventCategory.NEW_BUSINESS,
        "created_at": datetime(2026, 9, 22, 9, 1, tzinfo=UTC),
        "category_code": "NEW_BUSINESS",
        "summary": "Mardin-2 Lisanssız Güneş Enerji Santrali Projesi Sözleşmesi",
        "tickers": ["GESAN"],
        "company_name": "Girişim Elektrik",
        "publisher": "GİRİŞİM ELEKTRİK SANAYİ TAAHHÜT VE TİCARET A.Ş.",
        "is_correction": False,
        "attachment_count": None,
        "body_text": None,
        "metadata_json": {},
        "raw_event_id": uuid.uuid4(),
    }
    values.update(overrides)
    return SimpleNamespace(**values)


class FakeRepo:
    calls: ClassVar[list[tuple[str, Any]]] = []
    event: ClassVar[SimpleNamespace | None] = None
    content: ClassVar[tuple[dict[str, Any] | None, datetime | None] | None] = None
    saved: ClassVar[list[dict[str, Any]]] = []

    def __init__(self, session: Any) -> None:
        self.session = session

    async def get_page(self, filters: EventFilters, *, sort: str, limit: int, offset: int) -> list[SimpleNamespace]:
        FakeRepo.calls.append(("page", (filters, sort, limit, offset)))
        return [FakeRepo.event] if FakeRepo.event else []

    async def count(self, filters: EventFilters) -> int:
        FakeRepo.calls.append(("count", filters))
        return 99

    async def facets(self, filters: EventFilters, *, tickers: Sequence[str] = ()) -> EventFacets:
        FakeRepo.calls.append(("facets", filters))
        FakeRepo.calls.append(("facet_tickers", list(tickers)))
        return EventFacets(
            total=3,
            categories={c.name: 0 for c in EventCategory},
            severities={"INFO": 1, "WATCH": 0, "HIGH": 2},
            tickers={ticker: 1 for ticker in tickers},
        )

    async def get_by_id(self, event_id: uuid.UUID) -> SimpleNamespace | None:
        return FakeRepo.event if FakeRepo.event and FakeRepo.event.id == event_id else None

    async def get_content(self, event_id: uuid.UUID) -> tuple[dict[str, Any] | None, datetime | None] | None:
        return FakeRepo.content

    async def save_content(self, event_url: str, content: dict[str, Any], body_text: str | None, fetched_at: datetime, summary: str | None = None) -> None:
        FakeRepo.saved.append({"url": event_url, "content": content, "body_text": body_text, "summary": summary})


class FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


@pytest.fixture
def client(monkeypatch):
    FakeRepo.calls = []
    FakeRepo.event = _event()
    FakeRepo.content = None
    FakeRepo.saved = []
    monkeypatch.setattr(routers, "NormalizedEventRepository", FakeRepo)

    async def fake_db():
        yield FakeSession()

    app.dependency_overrides[get_db] = fake_db
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.pop(get_db, None)


def _page_call() -> tuple[EventFilters, str, int, int]:
    return next(args for name, args in FakeRepo.calls if name == "page")


def test_list_accepts_a_ticker_list_and_a_sort(client):
    response = client.get("/events?ticker=thyao,GARAN,THYAO&sort=severity&limit=10")

    assert response.status_code == 200
    filters, sort, limit, offset = _page_call()
    assert filters.tickers == ["THYAO", "GARAN"] and filters.ticker is None
    assert (sort, limit, offset) == ("severity", 10, 0)
    assert response.headers["X-Total-Count"] == "1"  # short first page: no COUNT query
    body = response.json()[0]
    assert body["summary"] and body["tickers"] == ["GESAN"] and body["category_code"] == "NEW_BUSINESS"
    assert body["category"] == "yeni_iş"  # legacy Turkish value kept for older clients


def test_full_page_asks_for_the_total(client):
    response = client.get("/events?limit=1")
    assert response.headers["X-Total-Count"] == "99"


def test_too_many_tickers_is_400(client):
    tickers = ",".join(f"T{i:03d}" for i in range(51))
    response = client.get(f"/events?ticker={tickers}")
    assert response.status_code == 400
    assert "50" in response.json()["detail"]


@pytest.mark.parametrize("path", ["/events?sort=random", "/events/facets?search=x"])
def test_invalid_params_are_422(client, path):
    assert client.get(path).status_code == 422


def test_facets_use_the_same_filters_and_are_not_shadowed_by_the_id_route(client):
    response = client.get("/events/facets?category=temettü,SHARE_BUYBACK&severity=high&since=2026-09-01")

    assert response.status_code == 200
    assert response.json()["total"] == 3 and response.json()["severities"]["HIGH"] == 2
    filters = next(args for name, args in FakeRepo.calls if name == "facets")
    assert filters.categories == [EventCategory.DIVIDEND, EventCategory.SHARE_BUYBACK]
    assert filters.severities == [Severity.HIGH]
    assert filters.since == datetime(2026, 8, 31, 21, 0, tzinfo=UTC)  # naive = Istanbul


def test_facets_count_the_asked_tickers(client):
    response = client.get("/events/facets?ticker=THYAO&ticker_facet=thyao,GARAN")

    assert response.status_code == 200
    assert response.json()["tickers"] == {"THYAO": 1, "GARAN": 1}
    assert next(args for name, args in FakeRepo.calls if name == "facet_tickers") == ["THYAO", "GARAN"]
    assert client.get("/events/facets").json()["tickers"] == {}
    assert client.get("/events/facets?ticker_facet=TH*").status_code == 400


def test_content_of_unknown_event_is_404(client):
    response = client.get(f"/events/{uuid.uuid4()}/content")
    assert response.status_code == 404


def test_cached_content_is_served_without_calling_kap(client, monkeypatch):
    async def boom(index):  # pragma: no cover - must not be called
        raise AssertionError("KAP must not be called for cached content")

    monkeypatch.setattr(routers, "fetch_disclosure_content", boom)
    fetched_at = datetime(2026, 9, 23, 5, 0, tzinfo=UTC)
    FakeRepo.content = ({"v": kap.CONTENT_FORMAT_VERSION, "blocks": [{"type": "text", "text": "Metin"}], "attachments": [], "truncated": False}, fetched_at)

    response = client.get(f"/events/{EVENT_ID}/content")

    assert response.status_code == 200
    assert response.json()["blocks"] == [{"type": "text", "text": "Metin"}]
    assert response.json()["source_url"] == KAP_URL


def test_content_is_fetched_parsed_and_cached_for_the_disclosure(client, monkeypatch):
    requested: list[str] = []

    async def fake_fetch(index):
        requested.append(index)
        return kap.DisclosureContent(
            index=index,
            blocks=[{"type": "field", "label": "Karar Tarihi", "value": "02.09.2026"}, {"type": "text", "text": "Açıklama"}],
            attachments=[{"name": "rapor.pdf"}],
            summary="Özet başlık",
        )

    monkeypatch.setattr(routers, "fetch_disclosure_content", fake_fetch)
    # An older cache format is refetched.
    FakeRepo.content = ({"v": 0, "blocks": []}, datetime(2026, 9, 1, tzinfo=UTC))

    response = client.get(f"/events/{EVENT_ID}/content")

    assert response.status_code == 200
    assert requested == ["1666380"]
    body = response.json()
    assert body["attachments"] == [{"name": "rapor.pdf"}] and not body["truncated"]
    assert [b["type"] for b in body["blocks"]] == ["field", "text"]
    [saved] = FakeRepo.saved
    assert saved["url"] == KAP_URL and saved["summary"] == "Özet başlık"
    assert saved["body_text"] == "Karar Tarihi: 02.09.2026\n\nAçıklama"
    assert saved["content"]["v"] == kap.CONTENT_FORMAT_VERSION


def test_kap_outage_is_a_503_with_a_machine_readable_code(client, monkeypatch):
    async def down(index):
        raise kap.KapUnavailableError("RemoteProtocolError: Server disconnected")

    monkeypatch.setattr(routers, "fetch_disclosure_content", down)

    response = client.get(f"/events/{EVENT_ID}/content")

    assert response.status_code == 503
    assert response.json()["code"] == "upstream_unavailable"
    assert response.headers["Retry-After"] == "60"
    assert FakeRepo.saved == []


def test_content_needs_a_kap_disclosure_url(client):
    FakeRepo.event = _event(source_code="official_news", event_url="https://example.com/haber/1")
    assert client.get(f"/events/{EVENT_ID}/content").status_code == 404
