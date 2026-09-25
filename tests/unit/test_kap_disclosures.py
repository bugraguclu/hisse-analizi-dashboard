"""KAP disclosure adapter tests (no network)."""

from datetime import UTC, date, datetime

import httpx
import pytest

from src.adapters import kap
from src.db.models import PollingState
from src.parsers.helpers import compute_content_hash


@pytest.fixture(autouse=True)
def _isolate_kap_state(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    kap.reset_state()
    monkeypatch.setattr(kap, "_MIN_REQUEST_INTERVAL_SECONDS", 0.0)
    yield
    utils.adapter_cache.clear()
    kap.reset_state()


def _item(index: int, subject: str, stock_codes: str | None, *, related: str | None = None, **extra):
    return {
        "publishDate": "22.09.2026 21:54:26",
        "kapTitle": "PC İLETİŞİM VE MEDYA HİZMETLERİ SANAYİ TİCARET A.Ş.",
        "disclosureClass": "ODA",
        "disclosureType": "CA",
        "summary": "22.09.2026 Tarihli Pay Geri Alım İşlemleri",
        "subject": subject,
        "relatedStocks": related,
        "disclosureIndex": index,
        "stockCodes": stock_codes,
        "attachmentCount": 0,
        "modifyStatus": None,
        **extra,
    }


class FakeClient:
    """Stands in for the KAP httpx client; records calls, replays queued responses."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, str, object]] = []

    async def request(self, method, url, json=None, headers=None):
        self.calls.append((method, url, json))
        response = self.responses.pop(0) if self.responses else []
        if isinstance(response, Exception):
            raise response
        return httpx.Response(200, json=response, request=httpx.Request(method, url))


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
        summary="Yeni iş ilişkisi hk.",
    )

    assert event is not None
    assert event.external_id == "1660523"
    assert event.title == "Özel Durum Açıklaması (Genel)"
    assert event.summary == "Yeni iş ilişkisi hk."
    assert event.published_at is not None
    assert event.published_at.isoformat() == "2026-09-08T22:06:03+03:00"
    # Must match hashes of rows already stored (form name + Istanbul-local ISO string);
    # the summary is deliberately not part of it.
    assert event.content_hash == compute_content_hash(
        "https://www.kap.org.tr/tr/Bildirim/1660523",
        "Özel Durum Açıklaması (Genel)",
        "2026-09-08T22:06:03+03:00",
    )
    assert kap.disclosure_event(title=" ", url="x", date_text="") is None


def test_list_item_becomes_event_with_summary_and_payload():
    event = kap.event_from_item(_item(1666867, "Payların Geri Alınmasına İlişkin Bildirim", "PCILT"))

    assert event is not None
    assert event.external_id == "1666867"
    assert event.canonical_url == "https://www.kap.org.tr/tr/Bildirim/1666867"
    assert event.title == "Payların Geri Alınmasına İlişkin Bildirim"
    assert event.summary == "22.09.2026 Tarihli Pay Geri Alım İşlemleri"
    assert event.raw_payload_json is not None and event.raw_payload_json["source"] == "kap"
    assert kap.event_from_item({"disclosureIndex": None, "subject": "x"}) is None


def test_missing_summary_falls_back_to_the_form_name_and_apostrophes_are_repaired():
    no_summary = kap.event_from_item(_item(1, "Finansal Rapor", "THYAO", summary=None))
    assert no_summary is not None and no_summary.summary == "Finansal Rapor"
    broken = kap.event_from_item(_item(2, "Özel Durum Açıklaması (Genel)", "TRMET", summary="BIST 30 Endeksi?ne Dahil\nEdilmesi"))
    assert broken is not None and broken.summary == "BIST 30 Endeksi'ne Dahil Edilmesi"


def test_events_for_ticker_matches_publisher_and_related_stocks_exactly():
    items = [
        _item(1, "Temerrüt İşlemi", None, related="THYAO", kapTitle="İSTANBUL TAKAS VE SAKLAMA BANKASI A.Ş."),
        _item(2, "Özel Durum Açıklaması (Genel)", "VANGD", related="METRO"),
        _item(3, "Özel Durum Açıklaması (Genel)", "THYAOX"),
        _item(1, "Temerrüt İşlemi", None, related="THYAO"),  # duplicate row
    ]

    assert [e.external_id for e in kap.events_for_ticker(items, "thyao")] == ["1"]
    assert [e.external_id for e in kap.events_for_ticker(items, "METRO")] == ["2"]
    assert [e.external_id for e in kap.events_for_ticker(items, "VANGD")] == ["2"]


def test_disclosure_metadata_keeps_display_fields_only():
    meta = kap.disclosure_metadata(
        {
            "source": "kap",
            **_item(9, "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim", "GUBRF", related="X, Y", modifyStatus="DUZENLENEN", attachmentCount=2),
        }
    )

    assert meta == {
        "publisher": "PC İLETİŞİM VE MEDYA HİZMETLERİ SANAYİ TİCARET A.Ş.",
        "disclosure_class": "ODA",
        "disclosure_type": "CA",
        "stock_codes": ["GUBRF"],
        "related_stocks": ["X", "Y"],
        "is_correction": True,
        "attachment_count": 2,
    }
    assert kap.disclosure_metadata({"source": "borsapy", "title": "x"}) == {}
    assert kap.disclosure_metadata(None) == {}


def test_polling_window_is_yesterday_to_today_and_catches_up_after_an_outage():
    now = datetime(2026, 9, 22, 21, 30, tzinfo=UTC)  # 00:30 on the 23rd in Istanbul
    assert kap.polling_window(None, now) == (date(2026, 9, 22), date(2026, 9, 23))

    state = PollingState(last_success_at=datetime(2026, 9, 19, 10, 0, tzinfo=UTC))
    assert kap.polling_window(state, now) == (date(2026, 9, 19), date(2026, 9, 23))

    long_gone = PollingState(last_success_at=datetime(2026, 8, 1, tzinfo=UTC))
    assert kap.polling_window(long_gone, now) == (date(2026, 9, 16), date(2026, 9, 23))


async def test_feed_is_downloaded_once_per_cycle_for_all_companies(monkeypatch):
    client = FakeClient(
        [
            _item(7, "Özel Durum Açıklaması (Genel)", "THYAO"),
            _item(8, "Özel Durum Açıklaması (Genel)", "GARAN"),
        ]
    )
    monkeypatch.setattr(kap, "_get_client", lambda: client)

    thy = await kap.KAPAdapter("THYAO").fetch()
    garan = await kap.KAPAdapter("GARAN").fetch()

    assert [e.external_id for e in thy] == ["7"]
    assert [e.external_id for e in garan] == ["8"]
    assert len(client.calls) == 1
    method, url, body = client.calls[0]
    assert method == "POST" and url == kap.KAP_LIST_URL
    assert isinstance(body, dict) and body["mkkMemberOidList"] == [] and body["subjectList"] == []


async def test_failure_starts_a_cooldown_instead_of_re_poking_kap(monkeypatch):
    client = FakeClient(httpx.RemoteProtocolError("Server disconnected without sending a response."))
    monkeypatch.setattr(kap, "_get_client", lambda: client)

    with pytest.raises(kap.KapUnavailableError):
        await kap.KAPAdapter("THYAO").fetch()
    with pytest.raises(kap.KapUnavailableError):
        await kap.KAPAdapter("GARAN").fetch()
    with pytest.raises(kap.KapUnavailableError):
        await kap.fetch_disclosure_content("1666845")
    assert len(client.calls) == 1  # the cooldown covers every later KAP call


async def test_unexpected_list_format_is_an_upstream_error(monkeypatch):
    monkeypatch.setattr(kap, "_get_client", lambda: FakeClient({"error": "maintenance"}))
    with pytest.raises(kap.KapUnavailableError):
        await kap.fetch_disclosure_list(date(2026, 9, 22), date(2026, 9, 22))


async def test_capped_range_is_bisected_and_merged(monkeypatch):
    monkeypatch.setattr(kap, "LIST_RESULT_CAP", 3)
    windows: list[tuple[str, str]] = []
    per_day = {
        "2026-09-20": [_item(1, "a", "THYAO"), _item(2, "b", "THYAO")],
        "2026-09-21": [_item(3, "c", "THYAO"), _item(4, "d", "THYAO")],
    }

    async def fake_raw(from_date, to_date):
        windows.append((from_date.isoformat(), to_date.isoformat()))
        rows = [row for day, items in per_day.items() if from_date.isoformat() <= day <= to_date.isoformat() for row in items]
        return rows[-3:]  # KAP keeps the newest rows at the cap

    monkeypatch.setattr(kap, "_fetch_list_raw", fake_raw)

    items = await kap.fetch_disclosure_list(date(2026, 9, 20), date(2026, 9, 21))

    assert sorted(i["disclosureIndex"] for i in items) == [1, 2, 3, 4]
    assert windows == [("2026-09-20", "2026-09-21"), ("2026-09-20", "2026-09-20"), ("2026-09-21", "2026-09-21")]


# --- disclosure content ----------------------------------------------------------

XBRL_ODA = """
<table class="financial-header-table"><tr style="display: none;"><td>[CONSOLIDATION_METHOD_TITLE]</td>
<td>[CONSOLIDATION_METHOD]</td></tr></table>
<table class="financial-table">
<tbody><tr><td class="info-table-title-cell"><div class="content-tr">İlgili Şirketler</div>
<div class="content-en" style="display: none;">Related Companies</div></td>
<td class="info-table-title-cell"><div>[METRO]</div></td></tr>
<tr><td class="info-table-title-cell"><div class="content-tr">İlgili Fonlar</div></td>
<td class="info-table-title-cell"><div>[]</div></td></tr></tbody>
<tbody>
<tr class="abstract-row"><td class="taxonomy-field-name-cell"><div>oda_MaterialEventDisclosureGeneralAbstract|</div></td>
<td class="taxonomy-field-title"><table class="taxonomy-title-panel taxonomy-abstract-title"><tr>
<td><div class="content-tr">Özel Durum Açıklaması (Genel)</div></td><td><div class="content-en" style="display: none;">Material Event</div></td>
</tr></table></td><td class="taxonomy-table-black-cell"></td></tr>
<tr class="data-input-row"><td class="taxonomy-field-name-cell"><div>oda_UpdateAnnouncementFlag|</div></td>
<td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Yapılan Açıklama Güncelleme mi?</div></td></tr></table></td>
<td class="taxonomy-context-value content-tr"><div>Evet (Yes)</div></td>
<td class="taxonomy-context-value content-en" style="display: none;"><div>Evet (Yes)</div></td></tr>
<tr class="data-input-row"><td class="taxonomy-field-name-cell"><div>oda_CorrectionAnnouncementFlag|</div></td>
<td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Yapılan Açıklama Düzeltme mi?</div></td></tr></table></td>
<td class="taxonomy-context-value content-tr"><div>Hayır (No)</div></td></tr>
<tr class="data-input-row"><td class="taxonomy-field-name-cell"><div>oda_Previous|</div></td>
<td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Konuya İlişkin Daha Önce Yapılan Açıklamanın Tarihi</div></td></tr></table></td>
<td class="taxonomy-context-value content-tr"><div>-</div></td></tr>
<tr class="abstract-row"><td class="taxonomy-field-name-cell"></td>
<td class="taxonomy-field-title"><table class="taxonomy-title-panel taxonomy-abstract-title"><tr><td><div class="content-tr">Açıklamalar</div></td></tr></table></td>
<td class="taxonomy-table-black-cell"></td></tr>
<tr class="data-input-row"><td class="taxonomy-field-name-cell"><div>oda_ExplanationTextBlock|</div></td>
<td class="taxonomy-context-value-summernote content-tr"><div class="text-block-value">
<div>Birinci paragraf, <span style="font-weight: bold;">kalın</span> kısım.</div><div><br/></div>
<div>İkinci paragraf&#160;devam</div><div>ve alt satır.</div></div></td>
<td class="taxonomy-context-value-summernote content-en" style="display: none;"><div class="text-block-value">EN</div></td></tr>
</tbody></table>
"""

LEGACY_FORM = """
<table class="tbl_GAI_Report_ID"><tbody>
<tr><td><div><table><tbody>
<tr class="bgLightgray"><td><div class="bold font14">Özet Bilgi</div></td><td><div class="control-label">22.09.2026 Tarihli Pay Geri Alım İşlemleri</div></td></tr>
<tr><td><div class="bold font14">Yapılan Açıklama Güncelleme mi ?</div></td><td><div class="control-label">Hayır</div></td></tr>
<tr><td><div class="bold font14">Yönetim Kurulu Karar Tarihi</div></td><td><div class="control-label">14.09.2026</div></td></tr>
</tbody></table></div></td></tr>
<tr><td><div class="bgGreen"><div class="txtWhite font14">Geri Alım İşlemlerinin Detayları</div></div></td></tr>
<tr><td><table border="1"><tbody>
<tr><td><div>İşleme Konu Pay</div></td><td><div>İşlem Tarihi</div></td><td><div>Fiyat</div></td><td><div>Not</div></td></tr>
<tr><td><div>PCILT</div></td><td><div>15.09.2026</div></td><td><div>30,136</div></td><td><div></div></td></tr>
<tr><td><div>PCILT</div></td><td><div>16.09.2026</div></td><td><div>30,5</div></td><td><div></div></td></tr>
</tbody></table></td></tr>
<tr><td><div class="bgGreen"><div class="txtWhite font14">Boş Bölüm</div></div></td></tr>
<tr><td><div class="bgGreen"><div class="txtWhite font14">Ek Açıklamalar</div></div></td></tr>
<tr><td><div class="control-label">Serbest metin açıklaması.</div></td></tr>
</tbody></table>
"""

STATEMENT_TABLE = """
<table class="financial-table"><tbody>
<tr><td colspan="3" rowspan="1"></td><td class="taxonomy-footnote-header">Dipnot Referansı</td>
<td class="context-header">Cari Dönem</td><td class="context-header">Önceki Dönem</td></tr>
<tr><td class="taxonomy-field-name-cell">ifrs_Cash|</td><td></td><td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Nakit</div></td></tr></table></td>
<td></td><td>1.152.672</td><td>6.425.793</td></tr>
<tr><td class="taxonomy-field-name-cell">ifrs_Empty|</td><td></td><td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Boş Kalem</div></td></tr></table></td>
<td></td><td></td><td></td></tr>
</tbody></table>
"""


def test_xbrl_form_becomes_fields_and_text():
    blocks, truncated = kap.parse_disclosure_body([XBRL_ODA])

    assert not truncated
    assert blocks == [
        {"type": "field", "label": "İlgili Şirketler", "value": "METRO"},
        {"type": "heading", "text": "Özel Durum Açıklaması (Genel)"},
        {"type": "field", "label": "Yapılan Açıklama Güncelleme mi?", "value": "Evet"},
        {"type": "heading", "text": "Açıklamalar"},
        {"type": "text", "text": "Birinci paragraf, kalın kısım.\n\nİkinci paragraf devam\nve alt satır."},
    ]


def test_legacy_form_keeps_order_tables_and_drops_empty_sections():
    content = kap.parse_disclosure_detail(
        "1666867",
        [{"disclosure": {"disclosureBasic": {"title": "Payların Geri Alınmasına İlişkin Bildirim", "summary": None,
                                              "companyTitle": "PC İLETİŞİM A.Ş."}},
          "disclosureBody": [LEGACY_FORM], "attachments": [{"objId": "x", "fileName": " rapor.pdf "}]}],
    )

    # "Özet Bilgi" becomes the summary instead of a field; "Hayır" flags are dropped.
    assert content.summary == "22.09.2026 Tarihli Pay Geri Alım İşlemleri"
    assert content.publisher == "PC İLETİŞİM A.Ş."
    assert content.attachments == [{"name": "rapor.pdf"}]
    assert content.blocks == [
        {"type": "field", "label": "Yönetim Kurulu Karar Tarihi", "value": "14.09.2026"},
        {"type": "heading", "text": "Geri Alım İşlemlerinin Detayları"},
        {"type": "table", "rows": [["İşleme Konu Pay", "İşlem Tarihi", "Fiyat"], ["PCILT", "15.09.2026", "30,136"], ["PCILT", "16.09.2026", "30,5"]]},
        {"type": "heading", "text": "Ek Açıklamalar"},
        {"type": "text", "text": "Serbest metin açıklaması."},
    ]


def test_statement_rows_keep_their_columns_under_a_colspan_header():
    blocks, _ = kap.parse_disclosure_body([STATEMENT_TABLE])

    assert blocks == [
        # The label column has no header; the footnote column has no data and is dropped.
        {"type": "table", "rows": [["", "Cari Dönem", "Önceki Dönem"], ["Nakit", "1.152.672", "6.425.793"]]}
    ]


def test_form_title_heading_is_not_repeated_in_the_content():
    content = kap.parse_disclosure_detail(
        "1",
        [{"disclosure": {"disclosureBasic": {"title": "Özel Durum Açıklaması (Genel)", "summary": "Özet"}}, "disclosureBody": [XBRL_ODA]}],
    )
    assert {"type": "heading", "text": "Özel Durum Açıklaması (Genel)"} not in content.blocks
    assert content.summary == "Özet"


def test_huge_bodies_are_truncated(monkeypatch):
    monkeypatch.setattr(kap, "_MAX_HTML_CHARS", 200)
    _, truncated = kap.parse_disclosure_body([LEGACY_FORM])
    assert truncated


def test_bilingual_enumeration_values_keep_the_turkish_label_only():
    html = """<table class="financial-table"><tr>
    <td class="taxonomy-field-title"><table class="taxonomy-title-panel"><tr><td><div class="content-tr">Kişinin Niteliği</div></td></tr></table></td>
    <td class="taxonomy-context-value content-tr"><div class="taxonomy-label-field">Müşteri (Customer)</div></td></tr>
    <tr><td><div class="bold">Para Birimi</div></td><td><div>Türk Lirası (TRY)</div></td></tr></table>"""
    blocks, _ = kap.parse_disclosure_body([html])
    assert blocks == [
        {"type": "field", "label": "Kişinin Niteliği", "value": "Müşteri"},
        {"type": "field", "label": "Para Birimi", "value": "Türk Lirası (TRY)"},  # free text is kept as written
    ]


def test_content_json_carries_the_format_version():
    content = kap.DisclosureContent(index="1", blocks=[{"type": "text", "text": "x"}])
    assert content.to_json()["v"] == kap.CONTENT_FORMAT_VERSION


def test_malformed_detail_payload_is_an_upstream_error():
    with pytest.raises(kap.KapUnavailableError):
        kap.parse_disclosure_detail("1", ["not a dict"])


async def test_fetch_disclosure_content_requests_the_detail_endpoint(monkeypatch):
    client = FakeClient([{"disclosure": {"disclosureBasic": {"title": "X", "summary": "S"}}, "disclosureBody": [XBRL_ODA]}])
    monkeypatch.setattr(kap, "_get_client", lambda: client)

    content = await kap.fetch_disclosure_content("1666845")

    assert client.calls == [("GET", "https://www.kap.org.tr/tr/api/notification/attachment-detail/1666845", None)]
    assert content.index == "1666845" and content.summary == "S" and content.blocks
    with pytest.raises(ValueError):
        await kap.fetch_disclosure_content("../etc")
