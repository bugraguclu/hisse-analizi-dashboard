"""/health (liveness) and /health/ready (readiness) with the DB check mocked."""

import pytest
from fastapi.testclient import TestClient

from src.api import routers
from src.api.app import app
from src.core.version import get_version


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, raise_server_exceptions=False)


def _db(monkeypatch, ok: bool) -> None:
    async def fake_check(timeout_seconds: float = 2.0) -> bool:
        assert timeout_seconds <= 2.0
        return ok

    monkeypatch.setattr(routers, "check_database", fake_check)


def test_health_ok(client, monkeypatch):
    _db(monkeypatch, True)
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["database"] == "ok"
    assert body["version"] == get_version()
    assert body["environment"] == "test"


def test_health_degraded_is_still_200(client, monkeypatch):
    _db(monkeypatch, False)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "degraded"
    assert response.json()["database"] == "unavailable"


def test_readiness(client, monkeypatch):
    _db(monkeypatch, True)
    assert client.get("/health/ready").status_code == 200
    _db(monkeypatch, False)
    response = client.get("/health/ready")
    assert response.status_code == 503
    assert response.json()["status"] == "degraded"


def test_openapi_version_matches(client):
    assert client.get("/openapi.json").json()["info"]["version"] == get_version()


@pytest.mark.parametrize(
    "path",
    [
        "/events?limit=0",
        "/events?limit=201",
        "/events?offset=-1",
        "/events?event_type=NOPE",
        "/events?search=a",
        "/prices?interval=2d",
        "/prices?since=yesterday",
        "/financials?ticker=THYAO&statement_type=foo",
    ],
)
def test_invalid_query_params_are_rejected_before_the_db(client, path):
    assert client.get(path).status_code == 422


@pytest.mark.parametrize(
    "path",
    [
        "/events?ticker=TH%25YAO",
        "/events?category=nonsense",
        "/events?category=DIVIDEND,nonsense",
        "/events?severity=CRITICAL",
        "/events?since=2026-09-02&until=2026-09-01",
    ],
)
def test_bad_filters_are_400(client, path):
    response = client.get(path)
    assert response.status_code == 400
    assert isinstance(response.json()["detail"], str)


def test_admin_stats_duplicate_removed(client):
    assert client.get("/admin/stats").status_code in (404, 405)
