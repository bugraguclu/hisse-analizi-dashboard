"""Request-ID middleware, access logging and error responses (no DB, no network)."""

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException
from structlog.testing import capture_logs

from src.api.app import RATE_LIMIT_DETAIL, http_exception_handler, rate_limit_exceeded_handler, unhandled_exception_handler
from src.api.limiter import limiter
from src.api.middleware import INTERNAL_ERROR_DETAIL, RequestContextMiddleware, resolve_request_id


def build_app() -> FastAPI:
    app = FastAPI()
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_middleware(RequestContextMiddleware)

    @app.get("/ok")
    async def ok(request: Request):
        return {"request_id": request.state.request_id}

    @app.get("/boom")
    async def boom():
        raise RuntimeError("database password is hunter2")

    @app.get("/missing")
    async def missing():
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")

    @app.get("/health")
    async def health():
        return {"status": "ok"}

    @app.get("/limited-for-test")
    @limiter.limit("1/minute")
    async def limited(request: Request):
        return {"ok": True}

    return app


# Built once: @limiter.limit registers the route limit on the shared limiter.
APP = build_app()


@pytest.fixture
def client() -> TestClient:
    return TestClient(APP, raise_server_exceptions=False)


def test_generates_request_id(client):
    response = client.get("/ok")
    request_id = response.headers["X-Request-ID"]
    assert len(request_id) == 32
    assert response.json() == {"request_id": request_id}


def test_propagates_valid_incoming_request_id(client):
    response = client.get("/ok", headers={"X-Request-ID": "trace-123.abc"})
    assert response.headers["X-Request-ID"] == "trace-123.abc"


def test_rejects_malformed_incoming_request_id():
    assert resolve_request_id("bad id\r\nX-Evil: 1") != "bad id\r\nX-Evil: 1"
    # "$" alone would also accept a trailing newline, which is then echoed in a header
    assert resolve_request_id("trace-1\n") != "trace-1\n"
    assert len(resolve_request_id("x" * 500)) == 32
    assert resolve_request_id(None)


def test_unhandled_exception_is_generic_turkish_json(client):
    with capture_logs() as logs:
        response = client.get("/boom", headers={"X-Request-ID": "req-1"})
    assert response.status_code == 500
    assert response.json() == {"detail": INTERNAL_ERROR_DETAIL}
    assert "hunter2" not in response.text and "RuntimeError" not in response.text
    assert response.headers["X-Request-ID"] == "req-1"
    assert any(e["event"] == "unhandled_exception" and e.get("exc_info") for e in logs)


def test_custom_http_errors_keep_their_detail(client):
    response = client.get("/missing")
    assert response.status_code == 404
    assert response.json() == {"detail": "Şirket bulunamadı."}


def test_default_not_found_is_translated(client):
    response = client.get("/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"detail": "Kaynak bulunamadı."}


def test_rate_limit_is_turkish_json_with_retry_after(client):
    assert client.get("/limited-for-test").status_code == 200
    response = client.get("/limited-for-test")
    assert response.status_code == 429
    assert response.json() == {"detail": RATE_LIMIT_DETAIL}
    assert 1 <= int(response.headers["Retry-After"]) <= 61


def test_access_log_skips_health_checks(client):
    with capture_logs() as logs:
        client.get("/health")
        client.get("/ok")
    paths = [e["path"] for e in logs if e["event"] == "http_request"]
    assert paths == ["/ok"]
    entry = next(e for e in logs if e["event"] == "http_request")
    assert entry["method"] == "GET" and entry["status"] == 200 and entry["duration_ms"] >= 0
