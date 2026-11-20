"""Deterministic cross-platform market & error scenario verification (backend).

Reads the shared fixture contract at ``tests/fixtures/market_error_scenarios.json``
also consumed by frontend tests so both platforms verify identical timestamps,
stale fallback signals, missing-balance-sheet payloads, disconnect codes, and
dual-device retry/conflict semantics.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from src.core.meta import DataMeta, with_meta
from src.core.mutations import (
    IdempotencyLedger,
    MutationJournal,
    MutationRecord,
    RequestConflictError,
    UndoConflictError,
)

FIXTURE_PATH = Path(__file__).resolve().parents[1] / "fixtures" / "market_error_scenarios.json"


def _load_fixture() -> dict[str, Any]:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def test_shared_fixture_schema_covers_all_required_scenarios() -> None:
    data = _load_fixture()
    assert data["schemaVersion"] == 1
    expected = {
        "session_open_fresh",
        "session_closed_last_close",
        "stale_price_provider_down",
        "missing_balance_sheet",
        "provider_disconnected",
        "empty_watchlist",
        "dual_device_conflict_and_retry",
    }
    assert expected.issubset(set(data["scenarios"].keys()))


def test_stale_price_meta_roundtrip_matches_shared_fixture() -> None:
    scenario = _load_fixture()["scenarios"]["stale_price_provider_down"]
    expected_meta = scenario["snapshot"]["meta"]

    clock = datetime.fromisoformat(scenario["clock"]).astimezone(timezone.utc)
    fetched = datetime.fromisoformat(expected_meta["fetched_at"]).astimezone(timezone.utc)

    meta = DataMeta(
        source=expected_meta["source"],
        fetched_at=fetched,
        as_of=expected_meta["as_of"],
        served_from="stale",
        stale=True,
        delay_seconds=expected_meta["delay_seconds"],
        notes=list(expected_meta["notes"]),
    )
    wrapped = with_meta({"snapshot": scenario["snapshot"]["snapshot"]}, meta, now=clock)

    assert wrapped["meta"]["stale"] is True
    assert wrapped["meta"]["served_from"] == "stale"
    assert wrapped["meta"]["as_of"] == "2026-11-18"
    assert wrapped["meta"]["age_seconds"] == expected_meta["age_seconds"]
    assert wrapped["meta"]["notes"] == expected_meta["notes"]


def test_missing_balance_sheet_payload_is_empty_safe_and_explicit() -> None:
    scenario = _load_fixture()["scenarios"]["missing_balance_sheet"]
    bs = scenario["balanceSheet"]
    ratios = scenario["ratios"]

    assert bs["statements"] == []
    assert bs["meta"]["source"] == "kap+isyatirim"
    assert bs["meta"]["as_of"] is None
    assert bs["meta"]["stale"] is False
    assert ratios["pe"] is None
    assert ratios["pb"] is None
    assert ratios["market_cap"] > 0


def test_provider_disconnected_error_contract() -> None:
    errors = _load_fixture()["scenarios"]["provider_disconnected"]["errors"]
    by_kind = {err["kind"]: err for err in errors}

    assert by_kind["upstream_unavailable"]["status"] == 502
    assert by_kind["upstream_unavailable"]["retryable"] is True
    assert by_kind["upstream_timeout"]["status"] == 504
    assert by_kind["upstream_timeout"]["retryable"] is True
    assert by_kind["network_drop"]["status"] is None
    assert by_kind["network_drop"]["retryable"] is True
    assert by_kind["request_conflict"]["status"] == 409
    assert by_kind["request_conflict"]["retryable"] is False


def test_dual_device_retry_and_undo_conflict_scenario() -> None:
    scenario = _load_fixture()["scenarios"]["dual_device_conflict_and_retry"]
    t0 = datetime(2026, 11, 20, 11, 30, tzinfo=timezone.utc)

    # 1. Dropped response retry creates a single record.
    ledger = IdempotencyLedger()
    payload = {
        "owner_id": scenario["ownerId"],
        "entity_id": scenario["entityId"],
        "tickers": scenario["afterDeviceARemoveTickers"],
    }
    first = ledger.record(
        "watchlist:update",
        scenario["requestId"],
        payload,
        status_code=200,
        body={"revision": scenario["deviceADeleteRevision"]},
        now=t0,
    )
    assert first.replayed is False

    replay = ledger.lookup("watchlist:update", scenario["requestId"], payload, now=t0)
    assert replay is not None and replay.replayed is True
    assert replay.body["revision"] == scenario["deviceADeleteRevision"]

    with pytest.raises(RequestConflictError):
        ledger.lookup(
            "watchlist:update",
            scenario["requestId"],
            {**payload, "tickers": scenario["afterDeviceBAddTickers"]},
            now=t0,
        )

    # 2. Device B edits the list (rev 2 -> 3); Device A's stale undo must fail with 409 undo_conflict.
    journal = MutationJournal()
    journal.record(
        MutationRecord(
            change_id="chg-device-a",
            owner_id=scenario["ownerId"],
            entity_type="watchlist",
            entity_id=scenario["entityId"],
            action="update",
            before_revision=scenario["initialRevision"],
            after_revision=scenario["deviceADeleteRevision"],
            before_state={"tickers": scenario["initialTickers"]},
            after_state={"tickers": scenario["afterDeviceARemoveTickers"]},
            changed_fields=("tickers",),
            decided_at=t0,
        )
    )

    with pytest.raises(UndoConflictError) as conflict:
        journal.plan_undo(
            owner_id=scenario["ownerId"],
            change_id="chg-device-a",
            current_revision=scenario["deviceBEditRevision"],
            current_state={"tickers": scenario["afterDeviceBAddTickers"]},
            now=t0,
        )
    assert conflict.value.status_code == scenario["expectedConflictStatus"]
    assert conflict.value.code == scenario["expectedConflictCode"]
