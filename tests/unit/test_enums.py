"""Unit tests for enums."""
from src.core.enums import (
    EventType,
    Severity,
    SourceKind,
    OutboxStatus,
    PriceInterval,
)


def test_event_type_values():
    assert EventType.KAP_DISCLOSURE.value == "KAP_DISCLOSURE"
    assert EventType.OFFICIAL_NEWS.value == "OFFICIAL_NEWS"
    assert EventType.OFFICIAL_IR_UPDATE.value == "OFFICIAL_IR_UPDATE"


def test_severity_order():
    severities = [Severity.INFO, Severity.WATCH, Severity.HIGH]
    assert len(severities) == 3


def test_source_kind_values():
    assert SourceKind.KAP.value == "kap"
    assert SourceKind.PRICE_DATA.value == "price_data"


def test_outbox_status():
    assert OutboxStatus.PENDING.value == "pending"
    assert OutboxStatus.DONE.value == "done"


def test_price_interval():
    assert PriceInterval.ONE_DAY.value == "1d"
    assert PriceInterval.ONE_HOUR.value == "1h"
    assert PriceInterval.FIFTEEN_MIN.value == "15m"
