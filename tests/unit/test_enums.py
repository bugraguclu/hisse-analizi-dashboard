"""Unit tests for enums."""
from src.core.enums import (
    EventType,
    Severity,
    SourceKind,
    OutboxStatus,
    PriceInterval,
    EventCategory,
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
    assert SourceKind.FINANCIAL_STATEMENTS.value == "financial_statements"


def test_outbox_status():
    assert OutboxStatus.PENDING.value == "pending"
    assert OutboxStatus.DONE.value == "done"


def test_price_interval():
    assert PriceInterval.ONE_DAY.value == "1d"
    assert PriceInterval.ONE_HOUR.value == "1h"
    assert PriceInterval.FIFTEEN_MIN.value == "15m"


def test_event_category_values():
    assert EventCategory.DIVIDEND.value == "temettü"
    assert EventCategory.CAPITAL_INCREASE.value == "sermaye_artırımı"
    assert EventCategory.NEW_BUSINESS.value == "yeni_iş"
    assert EventCategory.LEGAL.value == "dava_ceza"
    assert EventCategory.MANAGEMENT.value == "yönetim_değişimi"
    assert EventCategory.FINANCIAL_RESULTS.value == "finansal_sonuç"
    assert EventCategory.OTHER.value == "diğer"


def test_event_category_count():
    assert len(EventCategory) == 7


def test_severity_rank_is_ordered():
    from src.core.enums import SEVERITY_RANK

    assert SEVERITY_RANK[Severity.INFO] < SEVERITY_RANK[Severity.WATCH] < SEVERITY_RANK[Severity.HIGH]


def test_parse_event_category_accepts_value_or_name():
    from src.core.enums import parse_event_category

    assert parse_event_category("temettü") == EventCategory.DIVIDEND
    assert parse_event_category("TEMETTÜ") == EventCategory.DIVIDEND
    assert parse_event_category("DIVIDEND") == EventCategory.DIVIDEND
    assert parse_event_category(" dividend ") == EventCategory.DIVIDEND
    assert parse_event_category("YÖNETİM_DEĞİŞİMİ") == EventCategory.MANAGEMENT
    assert parse_event_category("Finansal_Sonuç") == EventCategory.FINANCIAL_RESULTS
    assert parse_event_category("yok") is None


def test_parse_severity_is_case_insensitive():
    from src.core.enums import parse_severity

    assert parse_severity("high") == Severity.HIGH
    assert parse_severity(" Watch ") == Severity.WATCH
    assert parse_severity("critical") is None
