"""Google News relevance, feed parsing, classification parsing and worker helpers (no network)."""

import asyncio
from datetime import datetime, timezone

import pytest

from src.adapters import news
from src.services import news_service
from src.workers import news_worker

NOW = datetime(2026, 9, 22, 12, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("Yaklaşık 100 işgalci İsrailli, Mescid-i Aksa'ya baskın düzenledi", False),
        ("Aksa Enerji'den iki yeni adım: Van'da lisans onayı", False),
        ("KAP *** AKSA ENERJİ ÜRETİM A.Ş. *** AKSEN *** Özel Durum Açıklaması", False),
        ("Akkök Holding (AKSA) Hisse Alımını Açıklayarak Payını Artırdı", True),
        ("AKSA’da 860 bin lotluk alım yapıldı!", True),
        ("Aksa'da temettü sonrası fiyat düzenlemesi belli oldu", True),
    ],
)
def test_short_generic_names_need_code_or_finance_context(title, expected):
    assert news.is_relevant(title, "", "AKSA", "Aksa", ["Aksa Enerji"]) is expected


def test_multi_word_names_match_as_a_phrase_with_turkish_folding():
    assert news.is_relevant("Turkiye Sigorta'dan yeni ürün", "", "TURSG", "Türkiye Sigorta")
    assert not news.is_relevant("Türkiye'de sigorta sektörü büyüdü", "", "TURSG", "Türkiye Sigorta")


def test_query_uses_company_name_and_finance_context_for_generic_names():
    assert news.build_query("THYAO", "Türk Hava Yolları") == '"Türk Hava Yolları" OR "THYAO hisse"'
    assert news.build_query("AKSA", "Aksa").startswith('"Aksa" (hisse OR borsa')
    assert news.company_short_name("ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş.") == "ASELSAN ELEKTRONİK"
    assert news.company_short_name("AKBANK T.A.Ş.") == "AKBANK"


def test_canonical_url_strips_tracking_parameters():
    url = "https://News.Google.com/rss/articles/CBMiXYZ?oc=5&utm_source=x#frag"
    assert news.canonical_url(url) == "https://news.google.com/rss/articles/CBMiXYZ"


FEED = """<?xml version="1.0" encoding="UTF-8"?><rss><channel>
<item><title>Aksa'da temettü sonrası fiyat - CNBC-e</title><link>https://news.google.com/rss/articles/A?oc=5</link>
  <pubDate>Mon, 21 Sep 2026 07:00:00 GMT</pubDate><source url="https://cnbce.com">CNBC-e</source></item>
<item><title>Aksa'da temettü sonrası fiyat - Başka Site</title><link>https://news.google.com/rss/articles/B?oc=5</link>
  <pubDate>Mon, 21 Sep 2026 08:00:00 GMT</pubDate><source url="https://x.com">Başka Site</source></item>
<item><title>AKSA hisse eski haber</title><link>https://news.google.com/rss/articles/C</link>
  <pubDate>Wed, 24 Jul 2024 07:00:00 GMT</pubDate></item>
<item><title>AKSA hisse tarihsiz</title><link>https://news.google.com/rss/articles/D</link></item>
<item><title>Mescid-i Aksa'da gerginlik</title><link>https://news.google.com/rss/articles/E</link>
  <pubDate>Tue, 22 Sep 2026 07:00:00 GMT</pubDate></item>
</channel></rss>"""


def test_parse_feed_filters_irrelevant_old_undated_and_duplicate_items():
    items = news.parse_feed(FEED, "AKSA", "Aksa", now=NOW)

    # A and B are the same syndicated headline → the earliest copy (A) is kept.
    assert [i["url"] for i in items] == ["https://news.google.com/rss/articles/A"]
    assert items[0]["title"] == "Aksa'da temettü sonrası fiyat"
    assert items[0]["published_at"] == datetime(2026, 9, 21, 7, 0, tzinfo=timezone.utc)


def test_classification_parser_validates_labels_and_indices():
    text = """```json
    [{"i": 0, "sentiment": "Pozitif", "impact": "Yüksek", "rationale": "Temettü"},
     {"i": "1", "sentiment": "belirsiz", "impact": "?", "rationale": "x"},
     {"i": 7, "sentiment": "negatif", "impact": "orta"},
     "not a row", {"i": null, "sentiment": "negatif"}]
    ```"""

    labels = news_service.parse_classification(text, count=2)

    assert labels == {
        0: {"sentiment": "pozitif", "impact": "yuksek", "rationale": "Temettü"},
        1: {"sentiment": "notr", "impact": "dusuk", "rationale": "x"},
    }
    assert news_service.parse_classification("model refused", count=3) == {}


def test_title_key_ignores_case_diacritics_and_punctuation():
    assert news_service.title_key("Aksa'da TEMETTÜ!") == news_service.title_key("aksa da temettu")


def test_exclusion_names_cover_longer_names_that_contain_a_company_name():
    excluded = news_worker.exclusion_names(
        [("AKSA", "Aksa"), ("AKSEN", "Aksa Enerji"), ("AEFES", "Anadolu Efes"), ("ANSGR", "Anadolu Sigorta")]
    )

    assert excluded["AKSA"] == ["Aksa Enerji"]
    assert excluded["AKSEN"] == []
    assert excluded["AEFES"] == []


def test_worker_backoff_grows_then_caps_at_interval(monkeypatch):
    monkeypatch.setattr(news_worker.random, "uniform", lambda a, b: 1.0)

    assert news_worker._next_delay(900, 0) == 900
    assert news_worker._next_delay(900, 1) == 60
    assert news_worker._next_delay(900, 3) == 240
    assert news_worker._next_delay(900, 10) == 900


async def test_news_loop_survives_failures_and_stops_on_event(monkeypatch):
    calls = {"n": 0}
    stop = asyncio.Event()

    async def flaky_poll():
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("db down")
        stop.set()
        return 0

    monkeypatch.setattr(news_worker, "_poll_once", flaky_poll)
    monkeypatch.setattr(news_worker, "_next_delay", lambda interval, failures: 0.01)
    monkeypatch.setattr(news_worker.settings, "news_poll_enabled", True)

    await asyncio.wait_for(news_worker.news_loop(stop), timeout=2)

    assert calls["n"] == 2
