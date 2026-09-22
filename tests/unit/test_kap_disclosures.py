"""KAP disclosure adapter tests (no network)."""

import httpx
import pandas as pd
import pytest

from src.adapters import kap
from src.parsers.helpers import compute_content_hash


@pytest.fixture(autouse=True)
def _isolate_feed_cache(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    monkeypatch.setattr(kap, "_feed_failed_until", 0.0)
    yield
    utils.adapter_cache.clear()

def test_stock_codes_are_exact_tokens():
    assert kap.stock_codes("AKSA, BERA,YBTAS") == {"AKSA", "BERA", "YBTAS"}
    assert kap.stock_codes(["isctr", "ISATR"]) == {"ISCTR", "ISATR"}
    # Substring matching used to attribute "ISCTR" disclosures to a ticker "ISC".
    assert "ISC" not in kap.stock_codes("ISCTR, ISBTR")
    assert kap.stock_codes(None) == set()


def test_disclosure_event_keeps_hash_inputs_stable():
    event = kap.disclosure_event(
        title="  Özel Durum   Açıklaması (Genel) ",
        url="https://www.kap.org.tr/tr/Bildirim/1660523",
        date_text="08.09.2026 22:06:03",
    )

    assert event is not None
    assert event.external_id == "1660523"
    assert event.title == "Özel Durum Açıklaması (Genel)"
    assert event.published_at is not None
    assert event.published_at.isoformat() == "2026-09-08T22:06:03+03:00"
    # Must match hashes of rows already stored (Istanbul-local ISO string).
    assert event.content_hash == compute_content_hash(
        "https://www.kap.org.tr/tr/Bildirim/1660523",
        "Özel Durum Açıklaması (Genel)",
        "2026-09-08T22:06:03+03:00",
    )
    assert kap.disclosure_event(title=" ", url="x", date_text="") is None


async def test_borsapy_disclosures_are_deduplicated(monkeypatch):
    frame = pd.DataFrame(
        [
            {"Date": "22.09.2026 11:16:04", "Title": "Temerrüt İşlemi", "URL": "https://www.kap.org.tr/tr/Bildirim/1666463"},
            {"Date": "22.09.2026 11:16:04", "Title": "Temerrüt İşlemi", "URL": "https://www.kap.org.tr/tr/Bildirim/1666463"},
            {"Date": "21.09.2026 19:29:09", "Title": "SPK İşlem Yasağı", "URL": "https://www.kap.org.tr/tr/Bildirim/1666319"},
        ]
    )

    class FakeTicker:
        news = frame

    import borsapy

    monkeypatch.setattr(borsapy, "Ticker", lambda symbol: FakeTicker())

    events = await kap.KAPAdapter("thyao").fetch()

    assert [e.external_id for e in events] == ["1666463", "1666319"]


async def test_empty_borsapy_result_does_not_hit_the_legacy_api(monkeypatch):
    class FakeTicker:
        news = pd.DataFrame(columns=["Date", "Title", "URL"])

    import borsapy

    monkeypatch.setattr(borsapy, "Ticker", lambda symbol: FakeTicker())

    async def boom(self):  # pragma: no cover - must not be called
        raise AssertionError("fallback must only run when borsapy fails")

    monkeypatch.setattr(kap.KAPAdapter, "_fetch_via_kap_api", boom)

    assert await kap.KAPAdapter("THYAO").fetch() == []


async def test_legacy_api_filters_by_exact_stock_code(monkeypatch):
    payload = [
        {"basic": {"stockCodes": "ISCTR, ISATR", "disclosureIndex": 1, "title": "İş Bankası", "publishDate": "22.09.2026 10:00:00"}},
        {"basic": {"stockCodes": "ISC", "disclosureIndex": 2, "title": "Doğru şirket", "publishDate": "22.09.2026 11:00:00"}},
    ]

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return payload

    class FakeClient:
        async def get(self, url, timeout=None):
            return FakeResponse()

    monkeypatch.setattr(kap, "get_http_client", lambda: FakeClient())

    events = await kap.KAPAdapter("ISC")._fetch_via_kap_api()

    assert [e.external_id for e in events] == ["2"]
    assert events[0].canonical_url == "https://www.kap.org.tr/tr/Bildirim/2"


async def test_feed_is_downloaded_once_per_cycle_for_all_companies(monkeypatch):
    payload = [
        {"basic": {"stockCodes": "THYAO", "disclosureIndex": 7, "title": "THY", "publishDate": "22.09.2026 10:00:00"}},
        {"basic": {"stockCodes": "GARAN", "disclosureIndex": 8, "title": "Garanti", "publishDate": "22.09.2026 11:00:00"}},
    ]
    calls = 0

    class FakeResponse:
        status_code = 200

        def raise_for_status(self):
            return None

        def json(self):
            return payload

    class FakeClient:
        async def get(self, url, timeout=None):
            nonlocal calls
            calls += 1
            return FakeResponse()

    monkeypatch.setattr(kap, "get_http_client", lambda: FakeClient())

    thy = await kap.KAPAdapter("THYAO")._fetch_via_kap_api()
    garan = await kap.KAPAdapter("GARAN")._fetch_via_kap_api()

    assert [e.external_id for e in thy] == ["7"]
    assert [e.external_id for e in garan] == ["8"]
    assert calls == 1


async def test_both_sources_down_raises_and_feed_fails_fast(monkeypatch):
    import borsapy

    calls = 0

    class DownClient:
        async def get(self, url, timeout=None):
            nonlocal calls
            calls += 1
            raise httpx.ReadTimeout("timeout")

    def broken_ticker(symbol):
        raise RuntimeError("Server disconnected without sending a response.")

    monkeypatch.setattr(borsapy, "Ticker", broken_ticker)
    monkeypatch.setattr(kap, "get_http_client", lambda: DownClient())

    with pytest.raises(kap.KapUnavailableError):
        await kap.KAPAdapter("THYAO").fetch()
    with pytest.raises(kap.KapUnavailableError):
        await kap.KAPAdapter("GARAN").fetch()
    assert calls == 1  # the second company does not re-download during the cooldown
