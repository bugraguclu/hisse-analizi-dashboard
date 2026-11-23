"""Alert rule decisions (pure) and the device/push-endpoint guards."""

from decimal import Decimal

import pytest

from src.core.device import InvalidDeviceKeyError, device_key_hash, is_allowed_push_endpoint
from src.core.enums import Severity
from src.services.alert_service import (
    change_triggered,
    evaluate_price_rule,
    format_number,
    kap_rule_matches,
)
from src.services.push_service import build_payload, classify_status, push_topic

D = Decimal


def run(kind: str, threshold: str, prices: list[str], *, repeat: str = "once", hysteresis: str = "1") -> list[bool]:
    """Feed a price path through the rule; returns which steps fired."""
    armed: bool | None = None
    count = 0
    fired: list[bool] = []
    for price in prices:
        decision = evaluate_price_rule(
            kind, D(threshold), D(price), armed=armed, repeat=repeat, trigger_count=count, hysteresis_pct=D(hysteresis)
        )
        armed = decision.armed
        count += decision.fire
        fired.append(decision.fire)
    return fired


def test_new_rule_never_fires_on_its_first_look():
    assert run("price_above", "100", ["105"]) == [False]
    assert run("price_below", "100", ["95"]) == [False]


def test_price_above_fires_on_the_crossing_only_once():
    assert run("price_above", "100", ["98", "99", "100.5", "101", "99", "102"]) == [False, False, True, False, False, False]


def test_rearm_needs_the_hysteresis_band_before_firing_again():
    # 1 % band under 100 = 99: 99.5 is not enough, 98.9 re-arms, 100 fires again.
    path = ["98", "100", "99.5", "100.2", "98.9", "100"]
    assert run("price_above", "100", path, repeat="rearm") == [False, True, False, False, False, True]


def test_price_below_mirrors_price_above():
    path = ["102", "99", "100.5", "101.5", "99.9"]
    assert run("price_below", "100", path, repeat="rearm") == [False, True, False, False, True]


def test_rule_created_beyond_the_threshold_waits_for_a_real_crossing():
    # Already above: once the price drops back through the band, the next rise fires.
    assert run("price_above", "100", ["105", "100.5", "98.5", "101"]) == [False, False, False, True]


@pytest.mark.parametrize(
    ("direction", "change", "expected"),
    [("up", "5", True), ("up", "-5", False), ("down", "-5", True), ("down", "4.9", False), ("both", "-5.2", True), (None, "4", False)],
)
def test_daily_change_direction(direction, change, expected):
    assert change_triggered(direction, D("5"), D(change)) is expected


def test_kap_severity_filter():
    assert kap_rule_matches(None, Severity.INFO)
    assert kap_rule_matches("WATCH", Severity.HIGH)
    assert not kap_rule_matches("HIGH", Severity.WATCH)


def test_numbers_use_the_locale_and_missing_is_a_dash():
    assert format_number(D("1234.5"), "tr") == "1.234,50"
    assert format_number(D("1234.5"), "en") == "1,234.50"
    assert format_number(D("1234.5"), "fr") == "1 234,50"
    assert format_number(None, "tr") == "—"


def test_device_key_is_hashed_and_validated():
    key = "A" * 43
    digest = device_key_hash(key)
    assert len(digest) == 64 and key not in digest
    for bad in (None, "", "short", "A" * 44, "A" * 42 + "!"):
        with pytest.raises(InvalidDeviceKeyError):
            device_key_hash(bad)


@pytest.mark.parametrize(
    ("endpoint", "allowed"),
    [
        ("https://fcm.googleapis.com/fcm/send/abc", True),
        ("https://updates.push.services.mozilla.com/wpush/v2/x", True),
        ("https://web.push.apple.com/QGx", True),
        ("http://fcm.googleapis.com/fcm/send/abc", False),
        ("https://evil.example/fcm.googleapis.com", False),
        ("https://fcm.googleapis.com.evil.example/x", False),
        # Userinfo in the URL is rejected; built from parts so secret scanners
        # don't report this fake credential as a leaked password.
        ("https://" + ":".join(("user", "x")) + "@fcm.googleapis.com/x", False),
        ("https://fcm.googleapis.com:8443/x", False),
        ("https://169.254.169.254/latest", False),
        ("not a url", False),
    ],
)
def test_push_endpoints_are_restricted_to_known_push_services(endpoint, allowed):
    assert is_allowed_push_endpoint(endpoint) is allowed


def test_push_status_classification_and_payload():
    assert classify_status(201) == "sent"
    assert classify_status(410) == classify_status(404) == classify_status(403) == "gone"
    assert classify_status(413) == "rejected"
    assert classify_status(429) == classify_status(503) == classify_status(None) == "retry"
    import json
    import uuid

    delivery_id = uuid.uuid4()
    payload = json.loads(
        build_payload({"id": delivery_id, "title": "T", "body": "B", "url": "/hisse/THYAO", "kind": "price_above", "ticker": "THYAO"})
    )
    assert payload["url"] == "/hisse/THYAO" and payload["tag"] == f"alert-{delivery_id}"
    assert len(push_topic(delivery_id)) == 32
