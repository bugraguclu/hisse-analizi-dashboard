"""Unit tests for adapter data structures — no external calls."""
from src.adapters.base import RawEventData, PriceRecord


def test_raw_event_data_defaults():
    event = RawEventData()
    assert event.external_id is None
    assert event.canonical_url is None
    assert event.content_hash == ""
    assert event.attachment_urls == []
    assert event.body_text is None


def test_raw_event_data_with_values():
    event = RawEventData(
        external_id="12345",
        canonical_url="https://kap.org.tr/tr/Bildirim/12345",
        title="Test Bildirim",
        content_hash="abc123",
    )
    assert event.external_id == "12345"
    assert event.title == "Test Bildirim"


def test_price_record_defaults():
    rec = PriceRecord()
    assert rec.ticker == ""
    assert rec.source == "borsapy"
    assert rec.interval == "1d"
    assert rec.open is None


def test_price_record_with_values():
    rec = PriceRecord(
        ticker="THYAO",
        open=18.5,
        high=19.0,
        low=18.3,
        close=18.7,
        volume=37000000,
    )
    assert rec.ticker == "THYAO"
    assert rec.close == 18.7
