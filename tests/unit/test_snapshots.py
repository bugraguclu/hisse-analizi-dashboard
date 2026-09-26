"""Unit tests for the last-good-copy snapshot store (``src.services.snapshots``).

``json_safe`` is pure (no DB). ``get_or_fetch``/``put``/``purge_expired`` are exercised
against real PostgreSQL (``pg_session``) with a monkeypatched ``fetch`` callable per
docs/data-platform.md §4.1 — hit / miss / stale / error-payload-not-stored.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from src.adapters.utils import MarketDataError
from src.services import snapshots

# ---------------------------------------------------------------------------
# json_safe (pure)
# ---------------------------------------------------------------------------


def test_json_safe_converts_dates_decimal_and_nan():
    value = {
        "d": date(2026, 9, 22),
        "dt": datetime(2026, 9, 22, 18, 30),
        "dec": Decimal("133.10"),
        "nan": float("nan"),
        "inf": float("inf"),
        "neg_inf": float("-inf"),
        "nested_list": [Decimal("1.5"), {"x": float("nan")}],
        "ok_int": 42,
        "ok_none": None,
        "ok_str": "hello",
    }

    result = snapshots.json_safe(value)

    assert result["d"] == "2026-09-22"
    assert result["dt"] == "2026-09-22T18:30:00"
    assert result["dec"] == 133.10
    assert result["nan"] is None
    assert result["inf"] is None
    assert result["neg_inf"] is None
    assert result["nested_list"] == [1.5, {"x": None}]
    assert result["ok_int"] == 42
    assert result["ok_none"] is None
    assert result["ok_str"] == "hello"


def test_json_safe_recurses_into_tuples_and_sets():
    assert snapshots.json_safe((Decimal("2"), Decimal("3"))) == [2.0, 3.0]
    assert snapshots.json_safe({1, 2}) in ([1, 2], [2, 1])  # set order is not guaranteed


def test_json_safe_dict_keys_become_strings():
    assert snapshots.json_safe({1: "a", 2: "b"}) == {"1": "a", "2": "b"}


# ---------------------------------------------------------------------------
# get_or_fetch: store-first read-through (pg_session)
# ---------------------------------------------------------------------------


async def test_get_or_fetch_live_miss_then_store_hit(pg_session):
    calls = 0

    async def fetch():
        nonlocal calls
        calls += 1
        return {"value": 42}

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key1", fetch, kind="test", source="unittest", max_age=timedelta(hours=1)
    )
    assert payload == {"value": 42}
    assert meta.served_from == "live"
    assert meta.stale is False
    assert calls == 1

    payload2, meta2 = await snapshots.get_or_fetch(
        pg_session, "test:key1", fetch, kind="test", source="unittest", max_age=timedelta(hours=1)
    )
    assert payload2 == {"value": 42}
    assert meta2.served_from == "store"
    assert calls == 1  # fetch not called again: the store copy is fresh enough


async def test_get_or_fetch_refetches_live_once_the_store_copy_is_too_old(pg_session):
    await snapshots.put(pg_session, "test:key2", {"value": "old"}, kind="test", source="unittest")

    async def fetch():
        return {"value": "fresh"}

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key2", fetch, kind="test", source="unittest", max_age=timedelta(seconds=0)
    )
    assert payload == {"value": "fresh"}
    assert meta.served_from == "live"


async def test_get_or_fetch_falls_back_to_stale_on_market_data_error(pg_session):
    await snapshots.put(pg_session, "test:key3", {"value": "cached"}, kind="test", source="unittest")

    async def failing_fetch():
        raise MarketDataError("Sağlayıcı kapalı", status_code=503)

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key3", failing_fetch, kind="test", source="unittest", max_age=timedelta(seconds=0)
    )
    assert payload == {"value": "cached"}
    assert meta.served_from == "stale"
    assert meta.stale is True
    assert meta.notes and "kayıtlı veri" in meta.notes[0]


async def test_get_or_fetch_raises_when_store_empty_and_fetch_fails(pg_session):
    async def failing_fetch():
        raise MarketDataError("Sağlayıcı kapalı", status_code=503)

    with pytest.raises(MarketDataError):
        await snapshots.get_or_fetch(
            pg_session, "test:missing", failing_fetch, kind="test", source="unittest", max_age=timedelta(hours=1)
        )


async def test_get_or_fetch_never_stores_an_error_payload(pg_session):
    async def error_fetch():
        return {"error": "geçici sorun", "error_status": 503}

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key4", error_fetch, kind="test", source="unittest", max_age=timedelta(hours=1)
    )
    assert payload == {"error": "geçici sorun", "error_status": 503}
    assert meta.served_from == "live"  # existing error contract preserved, nothing stored

    calls = 0

    async def good_fetch():
        nonlocal calls
        calls += 1
        return {"value": "now ok"}

    payload2, meta2 = await snapshots.get_or_fetch(
        pg_session, "test:key4", good_fetch, kind="test", source="unittest", max_age=timedelta(hours=1)
    )
    assert payload2 == {"value": "now ok"}
    assert meta2.served_from == "live"
    assert calls == 1  # confirms the earlier error payload was never persisted as a "store" copy


async def test_get_or_fetch_error_payload_falls_back_to_stale_when_a_copy_exists(pg_session):
    await snapshots.put(pg_session, "test:key5", {"value": "cached"}, kind="test", source="unittest")

    async def error_fetch():
        return {"error": "geçici sorun", "error_status": 502}

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key5", error_fetch, kind="test", source="unittest", max_age=timedelta(seconds=0)
    )
    assert payload == {"value": "cached"}
    assert meta.served_from == "stale"
    assert meta.stale is True


async def test_get_or_fetch_none_payload_is_treated_as_failure(pg_session):
    await snapshots.put(pg_session, "test:key6", {"value": "cached"}, kind="test", source="unittest")

    async def none_fetch():
        return None

    payload, meta = await snapshots.get_or_fetch(
        pg_session, "test:key6", none_fetch, kind="test", source="unittest", max_age=timedelta(seconds=0)
    )
    assert payload == {"value": "cached"}
    assert meta.served_from == "stale"


# ---------------------------------------------------------------------------
# put / get / purge_expired
# ---------------------------------------------------------------------------


async def test_put_rejects_failure_payloads(pg_session):
    with pytest.raises(ValueError):
        await snapshots.put(pg_session, "test:bad", {"error": "x", "error_status": 500}, kind="test", source="unittest")
    with pytest.raises(ValueError):
        await snapshots.put(pg_session, "test:bad2", None, kind="test", source="unittest")  # type: ignore[arg-type]


async def test_put_then_get_round_trip(pg_session):
    row = await snapshots.put(pg_session, "test:key7", {"a": 1}, kind="ta_bundle", source="unittest", ttl=timedelta(days=1))
    assert row.key == "test:key7"
    assert row.kind == "ta_bundle"
    assert row.expires_at is not None

    fetched = await snapshots.get(pg_session, "test:key7")
    assert fetched is not None
    assert fetched.payload == {"a": 1}


async def test_purge_expired_removes_only_rows_past_the_grace_window(pg_session):
    await snapshots.put(pg_session, "test:exp1", {"v": 1}, kind="test", source="unittest", ttl=timedelta(days=-20))
    await snapshots.put(pg_session, "test:exp2", {"v": 2}, kind="test", source="unittest", ttl=timedelta(days=1))
    await snapshots.put(pg_session, "test:exp3", {"v": 3}, kind="test", source="unittest")  # never expires

    deleted = await snapshots.purge_expired(pg_session, grace=timedelta(days=1))

    assert deleted == 1
    assert await snapshots.get(pg_session, "test:exp1") is None
    assert await snapshots.get(pg_session, "test:exp2") is not None
    assert await snapshots.get(pg_session, "test:exp3") is not None
