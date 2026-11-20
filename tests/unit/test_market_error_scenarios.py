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

from src.core.meta import DataMeta, with_meta


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
