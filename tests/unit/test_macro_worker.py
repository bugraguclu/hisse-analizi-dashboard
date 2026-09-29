"""macro_worker loops survive a failing job (no DB/network: collaborators are monkeypatched).

Regression: on 2026-09-27 the 10:00 ``macro.rates`` run hit a Postgres outage
(``OSError: Connect call failed``); the error escaped ``macro_loop`` and
``run_workers`` stopped every loop with exit code 1.
"""

import asyncio
from datetime import datetime

import pytest
from sqlalchemy.exc import OperationalError
from structlog.testing import capture_logs

from src.workers import macro_worker as mw

CONNECT_ERRORS = [
    OSError("Multiple exceptions: [Errno 61] Connect call failed ('127.0.0.1', 5432)"),
    OperationalError("SELECT 1", {}, ConnectionRefusedError(61, "Connect call failed")),
]


def _fixed_now(monkeypatch, moment: datetime) -> None:
    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return moment

    monkeypatch.setattr(mw, "datetime", FixedDatetime)


def _stop_after(monkeypatch, sleeps: int) -> list[float]:
    """Fake ``sleep_or_stop``: returns at once, sets ``stop`` on the ``sleeps``-th call."""
    calls: list[float] = []

    async def fake_sleep(stop, seconds):
        calls.append(seconds)
        if len(calls) >= sleeps:
            stop.set()
        await asyncio.sleep(0)

    monkeypatch.setattr(mw, "sleep_or_stop", fake_sleep)
    return calls


def _failing_jobs(monkeypatch, error: Exception) -> list[str]:
    runs: list[str] = []

    async def failing(job):
        runs.append(job)
        raise error

    monkeypatch.setattr(mw, "_execute_job", failing)
    return runs


@pytest.mark.parametrize("error", CONNECT_ERRORS, ids=["oserror", "operational"])
@pytest.mark.parametrize(("loop", "job"), [(mw._rates_loop, "macro.rates"), (mw._inflation_loop, "macro.inflation")])
async def test_scheduled_loop_logs_a_failing_job_and_runs_it_again_next_time(monkeypatch, loop, job, error):
    _fixed_now(monkeypatch, datetime(2026, 9, 28, 9, 59, tzinfo=mw.ISTANBUL_TZ))
    runs = _failing_jobs(monkeypatch, error)
    _stop_after(monkeypatch, sleeps=3)

    with capture_logs() as logs:
        await asyncio.wait_for(loop(asyncio.Event()), timeout=5)

    assert runs == [job, job]  # failed at two scheduled times, loop still alive for the third
    failures = [e for e in logs if e["event"] == "macro_scheduled_job_failed"]
    assert [e["job"] for e in failures] == [job, job]
    assert failures[0]["log_level"] == "error"
    assert failures[0]["error"].startswith(type(error).__name__)


@pytest.mark.parametrize("error", CONNECT_ERRORS, ids=["oserror", "operational"])
async def test_fx_loop_keeps_retrying_hourly_while_the_db_is_down(monkeypatch, error):
    _fixed_now(monkeypatch, datetime(2026, 9, 28, 15, 34, tzinfo=mw.ISTANBUL_TZ))
    runs = _failing_jobs(monkeypatch, error)
    sleeps = _stop_after(monkeypatch, sleeps=3)

    def unreachable_db():
        raise error

    monkeypatch.setattr(mw, "async_session_factory", unreachable_db)

    with capture_logs() as logs:
        await asyncio.wait_for(mw._fx_loop(asyncio.Event()), timeout=5)

    assert runs == ["macro.fx", "macro.fx"]  # 15:35 run, then the hourly retry
    assert sleeps[1] == mw._FX_RETRY_EVERY_SECONDS
    events = [e["event"] for e in logs]
    assert events.count("macro_scheduled_job_failed") == 2
    assert "macro_fx_bulletin_check_failed" in events


async def test_macro_loop_survives_every_job_failing(monkeypatch):
    _fixed_now(monkeypatch, datetime(2026, 9, 28, 10, 0, tzinfo=mw.ISTANBUL_TZ))
    runs = _failing_jobs(monkeypatch, CONNECT_ERRORS[0])
    _stop_after(monkeypatch, sleeps=9)

    def unreachable_db():
        raise CONNECT_ERRORS[0]

    monkeypatch.setattr(mw, "async_session_factory", unreachable_db)

    await asyncio.wait_for(mw.macro_loop(asyncio.Event()), timeout=5)  # returns, does not raise

    assert {"macro.rates", "macro.inflation", "macro.fx"} <= set(runs)


async def test_scheduled_job_does_not_swallow_cancellation(monkeypatch):
    async def cancelled(job):
        raise asyncio.CancelledError

    monkeypatch.setattr(mw, "_execute_job", cancelled)
    with pytest.raises(asyncio.CancelledError):
        await mw._run_scheduled_job("macro.rates")
