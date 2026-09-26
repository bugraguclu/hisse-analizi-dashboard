"""kap.org.tr request gate: one request at a time, minimum spacing, cool-down after a WAF block."""

import asyncio

import httpx
import pytest

from src.adapters import fundamentals_common as fc
from src.adapters.utils import MarketDataError
from src.core.config import settings


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def request(self, method, url, **kwargs):
        loop = asyncio.get_running_loop()
        self.calls.append((method, url, kwargs, loop.time()))
        outcome = self.responses.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return httpx.Response(outcome, request=httpx.Request(method, url))


@pytest.fixture
def gate(monkeypatch):
    monkeypatch.setattr(settings, "fundamentals_kap_min_interval_seconds", 0.05)
    monkeypatch.setattr(settings, "fundamentals_kap_block_seconds", 60.0)
    fresh = fc._KapGate()
    monkeypatch.setattr(fc, "kap_gate", fresh)
    return fresh


def _client(monkeypatch, responses):
    client = FakeClient(responses)
    monkeypatch.setattr(fc, "get_http_client", lambda: client)
    return client


async def test_requests_are_serialised_and_spaced(gate, monkeypatch):
    client = _client(monkeypatch, [200, 200, 200])

    await asyncio.gather(fc.kap_get("https://kap/a"), fc.kap_get("https://kap/b"), fc.kap_get("https://kap/c"))

    times = [call[3] for call in client.calls]
    assert all(later - earlier >= 0.045 for earlier, later in zip(times, times[1:]))
    assert gate.requests == 3


async def test_post_goes_through_the_same_gate(gate, monkeypatch):
    client = _client(monkeypatch, [200])

    response = await fc.kap_post("https://kap/api", {"fromDate": "2026-09-23"}, headers={"Referer": "https://kap/"})

    assert response.status_code == 200
    method, url, kwargs, _ = client.calls[0]
    assert (method, url) == ("POST", "https://kap/api")
    assert kwargs == {"json": {"fromDate": "2026-09-23"}, "headers": {"Referer": "https://kap/"}}


async def test_transport_failure_blocks_kap(gate, monkeypatch):
    client = _client(monkeypatch, [httpx.RemoteProtocolError("Server disconnected")])

    with pytest.raises(httpx.RemoteProtocolError):
        await fc.kap_get("https://kap/a")
    assert gate.blocked_for() > 50

    with pytest.raises(MarketDataError) as excinfo:  # fails fast, no request sent
        await fc.kap_post("https://kap/api", {})
    assert excinfo.value.status_code == 503
    assert len(client.calls) == 1


async def test_rate_limit_status_blocks_but_returns_the_response(gate, monkeypatch):
    _client(monkeypatch, [429])

    response = await fc.kap_get("https://kap/a")

    assert response.status_code == 429
    assert gate.blocked_for() > 0


async def test_server_error_does_not_block(gate, monkeypatch):
    _client(monkeypatch, [500, 200])

    assert (await fc.kap_get("https://kap/a")).status_code == 500
    assert gate.blocked_for() == 0
    assert (await fc.kap_get("https://kap/b")).status_code == 200
