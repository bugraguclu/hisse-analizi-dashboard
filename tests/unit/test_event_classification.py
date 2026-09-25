"""Severity / category classification of KAP disclosures (real titles from the DB)."""

import uuid
from unittest.mock import AsyncMock

import pytest

from src.core.enums import EventCategory, Severity
from src.services import event_service
from src.services.event_service import classify_category, classify_severity, fold_turkish, reclassify_events


@pytest.mark.parametrize(
    "title",
    [
        "Temerrüt İşlemi",
        "Şirket Genel Bilgi Formu",
        "Katılım Finansı İlkeleri Bilgi Formu",
        "TSRS Uyumlu Sürdürülebilirlik Raporu",
        "Sorumluluk Beyanı (Konsolide)",
        "Sorumluluk Beyanı (Konsolide Olmayan)",
        "Faaliyet Raporu (Konsolide)",
        "Kurumsal Yönetim Bilgi Formu (Güncelleme) - Yönetim Kurulu-2",
        "Kurumsal Yönetim İlkelerine Uyum Derecelendirmesi",
        "Bağımsız Denetim Kuruluşunun Belirlenmesi",
        "Finansal Takvim",
        "Genel Kurul İşlemlerine İlişkin Bildirim",
        "Pay Alım Satım Bildirimi",
        "Pay Dışında Sermaye Piyasası Aracı İşlemlerine İlişkin Bildirim (Faiz İçeren)",
        "Borçlanma Araçları, Yatırım Fonları ve Varant İtfa/Kupon/Getiri/ Nakdi Uzlaşı Ödeme İşlemleri",
        "İhraç Tavanına İlişkin Bildirim",
        "Kamuyu Aydınlatma Platformu Duyurusu",
        "Borsada İşlem Gören Tipe Dönüşüm Duyurusu",
        "Kar Dağıtım Politikası",
        "Bilgilendirme Politikası",
        "Piyasa Yapıcılığı Kapsamında Gerçekleştirilen İşlemler Bildirimi",
        "Likidite Sağlayıcılık Kapsamındaki İşlemler",
    ],
)
def test_boilerplate_filings_are_info(title):
    assert classify_severity(title, title, "kap") == Severity.INFO


@pytest.mark.parametrize(
    "title",
    [
        "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim",
        "Sermaye Artırımı - Azaltımı İşlemlerine İlişkin Bildirim",
        "Birleşme İşlemlerine İlişkin Bildirim",
        "Payların Geri Alınmasına İlişkin Bildirim",
        "Geri Alınan Payların Elden Çıkarılması",
        "Yeni İş İlişkisi",
        "İhale Süreci / Sonucu",
        "Ortaklık Aleyhine Dava Açılması veya Davaya İlişkin Gelişmeler",
        "Sermaye Piyasası Kurulu Tedbir Kararı",
        "SPK İşlem Yasağı Nedeniyle Pay Duyurusu",
        "Faaliyetlerin Kısmen veya Tamamen Durdurulması ya da İmkansız Hale Gelmesi",
        "Finansal Rapor",
        "Finansal Duran Varlık Edinimi",
        "Rüçhan Hakkı Referans Fiyatı",
        "TTK'nın 376. Maddesi Kapsamında Yapılan İşlemler",
        "Özsermaye Hallerine İlişkin Borsa Duyurusu",
    ],
)
def test_material_events_are_high(title):
    assert classify_severity(title, title, "kap") == Severity.HIGH


@pytest.mark.parametrize(
    "title",
    [
        "Özel Durum Açıklaması (Genel)",  # generic ÖDA: medium unless its text says more
        "Pay Bazında Devre Kesici Bildirimi",
        "Kredi Derecelendirmesi",
        "Esas Sözleşme Tadili",  # articles of association, not a business contract
        "İzahname (SPK Tarafından Onaylanan)",
        "Olağan Dışı Fiyat ve Miktar Hareketleri",
        "BISTECH Pay Piyasası Alım Satım Sistemi Duyurusu",
    ],
)
def test_other_kap_disclosures_default_to_watch(title):
    assert classify_severity(title, title, "kap") == Severity.WATCH


def test_generic_oda_with_material_summary_is_high():
    assert classify_severity("Özel Durum Açıklaması (Genel)", "Bedelsiz sermaye artırımı kararı", "kap") == Severity.HIGH


def test_source_default_applies_to_non_kap_sources():
    assert classify_severity("Basın bülteni", None, "official_news") == Severity.INFO
    assert classify_severity("Basın bülteni", None, "unknown_source") == Severity.INFO


@pytest.mark.parametrize(
    ("title", "category"),
    [
        ("Kar Payı Dağıtım İşlemlerine İlişkin Bildirim", EventCategory.DIVIDEND),
        ("KÂR PAYI DAĞITIMI", EventCategory.DIVIDEND),
        ("Sermaye Artırımı - Azaltımı İşlemlerine İlişkin Bildirim", EventCategory.CAPITAL_INCREASE),
        ("Yeni İş İlişkisi", EventCategory.NEW_BUSINESS),
        ("Esas Sözleşme", EventCategory.OTHER),
        ("Esas Sözleşme Tadili", EventCategory.OTHER),
        ("Önemli Sözleşme İmzalanması", EventCategory.NEW_BUSINESS),
        ("Ortaklık Aleyhine Dava Açılması veya Davaya İlişkin Gelişmeler", EventCategory.LEGAL),
        ("Yönetim Kurulu Komiteleri", EventCategory.MANAGEMENT),
        ("Likidite Sağlayıcı Atanması", EventCategory.MARKET_NOTICE),
        ("Finansal Rapor", EventCategory.FINANCIAL_RESULTS),
        ("Şirket Genel Bilgi Formu", EventCategory.OTHER),
        ("Payların Geri Alınmasına İlişkin Bildirim", EventCategory.SHARE_BUYBACK),
        ("Birleşme İşlemlerine İlişkin Bildirim", EventCategory.MERGER_ACQUISITION),
        ("Finansal Duran Varlık Edinimi", EventCategory.MERGER_ACQUISITION),
        ("Pay Alım Satım Bildirimi", EventCategory.INSIDER_TRADING),
        ("Pay Dışında Sermaye Piyasası Aracı İşlemlerine İlişkin Bildirim (Faiz İçeren)", EventCategory.DEBT_INSTRUMENT),
        ("Borçlanma Araçlarının / Kira Sertifikalarının İşlem Görmeye Başlaması", EventCategory.DEBT_INSTRUMENT),
        ("Kredi Derecelendirmesi", EventCategory.CREDIT_RATING),
        ("Genel Kurul İşlemlerine İlişkin Bildirim", EventCategory.GENERAL_ASSEMBLY),
        ("Pay Bazında Devre Kesici Bildirimi", EventCategory.MARKET_NOTICE),
        ("BIST Pay Endeksleri", EventCategory.MARKET_NOTICE),
        ("Temerrüt İşlemi", EventCategory.MARKET_NOTICE),
        ("SPK İşlem Yasağı Nedeniyle Pay Duyurusu", EventCategory.LEGAL),
        ("Pay Mali Hak Kullanım İşlemi - Nakit Ödeme", EventCategory.DIVIDEND),
        ("Kurumsal Yönetim İlkelerine Uyum Derecelendirmesi", EventCategory.MANAGEMENT),
        ("Sermaye Artırımından Elde Edilecek - Edilen Fonun Kullanımına İlişkin Rapor", EventCategory.CAPITAL_INCREASE),
    ],
)
def test_categories(title, category):
    assert classify_category(title, title) == category


@pytest.mark.parametrize(
    ("summary", "category"),
    [
        ("Tahsisli Sermaye Artırımı Kapsamında TTK 461 Raporu Hk.", EventCategory.CAPITAL_INCREASE),
        ("Armada-3 Yatırımı Kapsamında Sözleşme İmzalanması", EventCategory.NEW_BUSINESS),
        ("Yönetim Kurulu Üyesi Ataması Hk.", EventCategory.MANAGEMENT),
        # LEGAL outranks MANAGEMENT although the text mentions the board.
        ("Yönetim Kurulu Eski Üyeleri Hakkında Suç Duyurusunda Bulunulması Hususunda", EventCategory.LEGAL),
        ("Atlantis Yatırım Holding A.Ş. Paylarına Yönelik Pay Alım Teklifi Sürecine İlişkin Açıklama", EventCategory.MERGER_ACQUISITION),
        ("Şirketimizin BIST 30 Endeksi'ne Dahil Edilmesi Hakkında", EventCategory.MARKET_NOTICE),
        ("4. Tertip Kira Sertifikası İhracına İlişkin SPK Başvurusu hk.", EventCategory.DEBT_INSTRUMENT),
        # A collective labour agreement is not a business contract.
        ("Yetkili İşçi Sendikası ile Toplu İş Sözleşmesi Yapmak Üzere Görüşmelere Başlanacaktır.", EventCategory.OTHER),
        ("Şeker Üretimi Hakkında", EventCategory.OTHER),
    ],
)
def test_generic_material_event_is_categorised_by_its_summary(summary, category):
    assert classify_category("Özel Durum Açıklaması (Genel)", summary) == category


def test_form_name_outranks_the_summary():
    # A rating report that mentions a capital increase is still a rating report.
    assert classify_category("Kredi Derecelendirmesi", "Sermaye artırımı sonrası not teyidi") == EventCategory.CREDIT_RATING
    assert classify_category("Genel Kurul İşlemlerine İlişkin Bildirim", "Kar payı dağıtımı") == EventCategory.GENERAL_ASSEMBLY


def test_liquidity_provider_agreements_are_routine_market_notices():
    summary = "Likidite Sağlayıcılık İşlemlerine İlişkin Sözleşme İmzalanması ve Borsa İstanbul A.Ş.'ye Başvuru Yapılması"
    assert classify_category("Özel Durum Açıklaması (Genel)", summary) == EventCategory.MARKET_NOTICE
    assert classify_severity("Özel Durum Açıklaması (Genel)", summary, "kap") == Severity.INFO
    # Other contracts stay material.
    assert classify_severity("Özel Durum Açıklaması (Genel)", "Tedarik sözleşmesi imzalanması", "kap") == Severity.HIGH


def test_circuit_breaker_notices_are_not_trading_halts():
    breaker = "GENIL.E işlem sırasında Pay Bazında Devre Kesici Uygulaması devreye girmiştir"
    assert classify_severity("Pay Bazında Devre Kesici Bildirimi", breaker, "kap") == Severity.WATCH
    assert classify_category("Pay Bazında Devre Kesici Bildirimi", breaker) == EventCategory.MARKET_NOTICE
    halt = "ABCDE.E işlem sırası kapatılmıştır"
    assert classify_severity("Borsa İstanbul A.Ş. Duyurusu", halt, "kap") == Severity.HIGH
    assert classify_severity("Özel Durum Açıklaması (Genel)", "Paylarımızın işlem sırasının durdurulması", "kap") == Severity.HIGH


def test_material_summary_raises_a_boilerplate_form_to_high():
    assert classify_severity("Genel Kurul İşlemlerine İlişkin Bildirim", "Olağan Genel Kurul Toplantısı", "kap") == Severity.INFO
    assert classify_severity("Genel Kurul İşlemlerine İlişkin Bildirim", "Kar payı dağıtımına ilişkin karar", "kap") == Severity.HIGH
    assert classify_severity("Özel Durum Açıklaması (Genel)", "Toplu İş Sözleşmesi görüşmeleri", "kap") == Severity.WATCH


def test_fold_turkish_is_case_and_diacritic_insensitive():
    assert fold_turkish("DÖNEM KARI") == fold_turkish("Dönem Karı") == "donem kari"
    assert fold_turkish("İŞLEM  Sırası") == "islem sirasi"
    assert fold_turkish("Kâr Payı") == "kar payi"


class _FakeRepo:
    def __init__(self, rows):
        self.rows = rows
        self.updates: list[dict] = []

    async def iter_classification_batches(self, batch_size=500):
        for i in range(0, len(self.rows), batch_size):
            yield self.rows[i : i + batch_size]

    async def bulk_update_classification(self, changes):
        self.updates.extend(changes)


@pytest.mark.asyncio
@pytest.mark.parametrize("dry_run", [True, False])
async def test_reclassify_events_is_idempotent_and_honours_dry_run(monkeypatch, dry_run):
    title_oda = "Özel Durum Açıklaması (Genel)"
    title_form = "Şirket Genel Bilgi Formu"
    title_div = "Kar Payı Dağıtım İşlemlerine İlişkin Bildirim"
    rows = [
        (uuid.uuid4(), title_oda, title_oda, "kap", Severity.HIGH, EventCategory.OTHER),  # -> WATCH
        (uuid.uuid4(), title_form, title_form, "kap", Severity.WATCH, EventCategory.OTHER),  # -> INFO
        (uuid.uuid4(), title_div, title_div, "kap", Severity.HIGH, EventCategory.DIVIDEND),  # unchanged
        (uuid.uuid4(), "Esas Sözleşme", "Esas Sözleşme", "kap", Severity.WATCH, EventCategory.NEW_BUSINESS),
    ]
    repo = _FakeRepo(rows)
    monkeypatch.setattr(event_service, "NormalizedEventRepository", lambda session: repo)
    session = AsyncMock()

    result = await reclassify_events(session, dry_run=dry_run, batch_size=2)

    assert result["scanned"] == 4
    assert result["changed"] == 3
    assert result["severity_changes"] == {"HIGH->WATCH": 1, "WATCH->INFO": 1}
    assert result["category_changes"] == {"NEW_BUSINESS->OTHER": 1}
    if dry_run:
        assert repo.updates == []
        session.commit.assert_not_awaited()
    else:
        assert {u["id"] for u in repo.updates} == {rows[0][0], rows[1][0], rows[3][0]}
        session.commit.assert_awaited_once()
