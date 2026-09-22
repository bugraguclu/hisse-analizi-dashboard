"""Polling worker: locks, backoff, cursor safety and per-company isolation (no DB)."""

import asyncio
import random
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from src.adapters.base import RawEventData
from src.workers import polling_worker as pw

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)


def test_lock_key_is_stable_int4_and_distinct():
    keys = {code: pw.source_lock_key(code) for code in pw.POLL_SOURCES}
    assert keys["kap"] == pw.source_lock_key("kap") == 388027913  # crc32("kap") & 0x7FFFFFFF
    assert len(set(keys.values())) == len(keys)
    assert all(0 <= k < 2**31 for k in keys.values())


@pytest.mark.parametrize(("failures", "window"), [(0, 0), (1, 60), (2, 120), (4, 480), (5, 900), (10**6, 900)])
def test_backoff_window(failures, window):
    assert pw.backoff_window(failures) == window


def test_backoff_has_bounded_jitter():
    rng = random.Random(42)
    samples = [pw.compute_backoff(3, rng) for _ in range(200)]
    assert all(120 <= s <= 240 for s in samples)
    assert len({round(s, 3) for s in samples}) > 100
    assert pw.compute_backoff(0) == 0


def test_in_backoff_uses_lower_jitter_bound():
    state = SimpleNamespace(consecutive_failures=2, last_attempt_at=NOW - timedelta(seconds=30))
    assert pw.in_backoff(state, NOW) is True  # window 120 s -> earliest retry after 60 s
    state.last_attempt_at = NOW - timedelta(seconds=61)
    assert pw.in_backoff(state, NOW) is False
    assert pw.in_backoff(SimpleNamespace(consecutive_failures=0, last_attempt_at=NOW), NOW) is False
    assert pw.in_backoff(None, NOW) is False


def test_kap_cursor_only_advances_to_disclosures_older_than_the_cycle():
    events = [
        RawEventData(external_id="1500", published_at=NOW - timedelta(hours=1)),
        RawEventData(external_id="1510", published_at=NOW - timedelta(minutes=10)),
        RawEventData(external_id="1520", published_at=NOW - timedelta(minutes=1)),  # inside safety margin
        RawEventData(external_id="abc", published_at=NOW - timedelta(hours=2)),
        RawEventData(external_id="1600", published_at=None),
    ]
    assert pw.kap_cursor_candidate(events, NOW) == 1510
    assert pw.kap_cursor_candidate([], NOW) is None


@pytest.mark.asyncio
async def test_poll_company_isolates_adapter_errors(monkeypatch):
    class BrokenAdapter:
        def __init__(self, ticker):
            pass

        async def fetch(self, state):
            raise ConnectionError("kap.org.tr unreachable")

    monkeypatch.setattr(pw, "KAPAdapter", BrokenAdapter)
    source = SimpleNamespace(code="kap")
    company = SimpleNamespace(ticker="THYAO")
    result = await pw._poll_company(source, company, None, None, NOW)  # type: ignore[arg-type]
    assert result["ok"] is False
    assert "ConnectionError" in result["error"]


class _FakeStateRepo:
    calls: list[tuple] = []

    def __init__(self, session):
        pass

    async def update_success(self, source_id, last_seen_external_id=None, last_seen_published_at=None, warning=None):
        _FakeStateRepo.calls.append(("success", last_seen_external_id, warning))

    async def update_failure(self, source_id, error):
        _FakeStateRepo.calls.append(("failure", error))


class _FakeSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def commit(self):
        pass


def _setup_cycle(monkeypatch, outcomes, *, failures=0, cursor=None, lock=True):
    source = SimpleNamespace(id=uuid.uuid4(), code="kap", enabled=True, poll_interval_seconds=30)
    state = SimpleNamespace(consecutive_failures=failures, last_attempt_at=None, last_seen_external_id=cursor, last_error=None)
    companies = [SimpleNamespace(ticker=t) for t in outcomes]

    async def fake_context(code):
        return source, state, companies

    @asynccontextmanager
    async def fake_lock(code):
        yield lock

    async def fake_poll(src, company, st, days, started):
        ok, cursor_value = outcomes[company.ticker]
        result = {"ticker": company.ticker, "ok": ok, "cursor": cursor_value}
        if not ok:
            result["error"] = f"{company.ticker} failed"
        return result

    _FakeStateRepo.calls = []
    monkeypatch.setattr(pw, "_load_cycle_context", fake_context)
    monkeypatch.setattr(pw, "source_lock", fake_lock)
    monkeypatch.setattr(pw, "_poll_company", fake_poll)
    monkeypatch.setattr(pw, "PollingStateRepository", _FakeStateRepo)
    monkeypatch.setattr(pw, "async_session_factory", _FakeSession)
    monkeypatch.setattr(pw, "_INTER_COMPANY_DELAY_SECONDS", 0)


@pytest.mark.asyncio
async def test_partial_failure_is_a_success_with_warning_and_cursor(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (True, 1500), "GARAN": (False, None), "AKBNK": (True, 1510)}, cursor="1400")
    summary = await pw.run_source_cycle("kap")
    assert (summary["companies"], summary["succeeded"], summary["failed"]) == (3, 2, 1)
    assert summary["consecutive_failures"] == 0
    kind, cursor, warning = _FakeStateRepo.calls[0]
    assert kind == "success" and cursor == "1510"
    assert "1/3" in warning and "GARAN failed" in warning


@pytest.mark.asyncio
async def test_cursor_never_moves_backwards(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (True, 1500)}, cursor="1600")
    await pw.run_source_cycle("kap")
    assert _FakeStateRepo.calls == [("success", None, None)]


@pytest.mark.asyncio
async def test_all_companies_failing_counts_as_source_failure(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (False, None), "GARAN": (False, None)}, failures=2)
    summary = await pw.run_source_cycle("kap")
    assert _FakeStateRepo.calls[0][0] == "failure"
    assert summary["consecutive_failures"] == 3


@pytest.mark.asyncio
async def test_locked_source_is_skipped(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (True, None)}, lock=False)
    summary = await pw.run_source_cycle("kap")
    assert summary["skipped"] == "locked"
    assert _FakeStateRepo.calls == []


@pytest.mark.asyncio
async def test_backoff_skips_cycle_unless_forced(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (True, None)}, failures=3)

    async def recent_failure_context(code):
        source = SimpleNamespace(id=uuid.uuid4(), code="kap", enabled=True, poll_interval_seconds=30)
        state = SimpleNamespace(consecutive_failures=3, last_attempt_at=datetime.now(timezone.utc),
                                last_seen_external_id=None, last_error="boom")
        return source, state, [SimpleNamespace(ticker="THYAO")]

    monkeypatch.setattr(pw, "_load_cycle_context", recent_failure_context)
    assert (await pw.run_source_cycle("kap"))["skipped"] == "backoff"
    forced = await pw.run_source_cycle("kap", respect_backoff=False)  # admin trigger
    assert forced["skipped"] is None and forced["succeeded"] == 1


@pytest.mark.asyncio
async def test_stop_event_prevents_new_company_polls(monkeypatch):
    _setup_cycle(monkeypatch, {"THYAO": (True, None), "GARAN": (True, None)})
    stop = asyncio.Event()
    stop.set()
    summary = await pw.run_source_cycle("kap", stop=stop)
    assert summary["companies"] == 0
    assert _FakeStateRepo.calls == []  # nothing attempted -> state untouched


@pytest.mark.asyncio
async def test_sleep_or_stop_wakes_up_on_stop():
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    started = loop.time()
    loop.call_later(0.05, stop.set)
    await pw.sleep_or_stop(stop, 5)
    assert loop.time() - started < 1
