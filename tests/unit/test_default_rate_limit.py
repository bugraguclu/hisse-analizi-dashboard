"""Site-wide default rate limit (global dependency on the FastAPI app)."""

import pytest
from fastapi.testclient import TestClient

from src.api import limiter as limiter_module
from src.api.app import app
from src.api.limiter import RATE_LIMIT_DETAIL, limiter


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(limiter_module.settings, "rate_limit_default", "3/minute")
    limiter.reset()
    # No context manager: entering it would run the app lifespan (setup_logging), which
    # reconfigures structlog for the rest of the test session.
    yield TestClient(app)
    limiter.reset()


def test_default_limit_applies_to_routes_inside_included_routers(client: TestClient) -> None:
    # /market/screener/templates lives in an included router and has no own @limiter.limit
    codes = [client.get("/market/screener/templates").status_code for _ in range(4)]
    assert codes[:3] == [200, 200, 200]
    assert codes[3] == 429
    response = client.get("/market/screener/templates")
    assert response.json() == {"detail": RATE_LIMIT_DETAIL}
    assert int(response.headers["Retry-After"]) >= 1


def test_health_probes_are_exempt(client: TestClient) -> None:
    for _ in range(5):
        client.get("/market/screener/templates")
    assert client.get("/health").status_code == 200
    assert client.get("/health/ready").status_code in (200, 503)


def test_disabled_limiter_skips_default_limit(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(limiter, "enabled", False)
    assert all(client.get("/market/screener/templates").status_code == 200 for _ in range(5))
