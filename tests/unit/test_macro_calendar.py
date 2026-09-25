"""Economic calendar: TradingView rows, Turkish names, doviz.com parsing/fallback, filters, /macro/calendar (no network)."""

from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.adapters import economic_calendar as cal
from src.adapters import economic_calendar_titles as titles
from src.api import routers_macro

_HEADER = (
    "<thead><th>Saat</th><th>Ülke</th><th>Önem</th><th>Olay</th>"
    "<th>Gerçekleşen</th><th>Beklenti</th><th>Önceki</th></thead>"
)


def _row(time, event, importance="mid", actual="", previous="", country="Türkiye"):
    return (
        f'<tr><td class="time">{time}</td><td class="region">{country}</td>'
        f'<td><span class="importance {importance}" title="x"></span></td>'
        f"<td>{event}</td><td>{actual}</td><td></td><td>{previous}</td></tr>"
    )


def _day(label, *rows):
    return (
        f'<div class="text-center mt-8 mb-8 text-bold">{label}</div>'
        f'<div class="table main-table calendar-table rate-list"><table class="calendar-scroll">{_HEADER}'
        + "".join(rows)
        + "</table></div>"
    )


def _tab(index, *days):
    body = "".join(days) or '<div class="no-events">Seçtiğiniz kriterlere uygun bir olay bulunmuyor.</div>'
    return f'<div id="calendar-content-{index}" class="hide">{body}</div>'


CONFIDENCE = _row("10:00", "Tüketici Güveni (-)", "high", "91,9", "90,8")
EXPORTS = _row("11:00", "İhracat  (Öncü) (-)", "mid", "23,5", "25,6")
RESERVES = _row("14:30", "Döviz Rezervleri (-)")

# The four tabs doviz.com sends (Bugün, Yarın, Bu hafta, Bu ay) — they overlap.
TR_HTML = "".join(
    [
        _tab(0, _day("22 Eylül 2026", CONFIDENCE)),
        _tab(1),
        _tab(
            2,
            _day("21 Eylül 2026", _row("10:00", "İş Dünyası Güveni (-)", "high", "102", "102,8")),
            # Stale copy without the released value: the filled-in copy must win.
            _day("22 Eylül 2026", _row("10:00", "Tüketici Güveni (-)", "high", "", "90,8")),
            _day("24 Eylül 2026", RESERVES),
        ),
        _tab(
            3,
            _day(
                "03 Eylül 2026",
                _row("10:00", "Enflasyon Oranı  (Yıllık) (-)", "high", "%31,51", "%31,75"),
                EXPORTS,
                EXPORTS,  # a real duplicate inside one tab is kept
            ),
            _day("10 Eylül 2026", _row("14:00", "TCMB Faiz Kararı (-)", "high", "%37", "%37")),
            _day("22 Eylül 2026", CONFIDENCE),
            _day("24 Eylül 2026", RESERVES),
            _day("30 Eylül 2026", _row("Tüm Gün", "Tatil (-)", "low")),
        ),
    ]
)

US_HTML = _tab(
    3,
    _day(
        "16 Eylül 2026",
        _row("21:00", "Fed Faiz Kararı (-)", "high", "%4", "%3,75", country="ABD"),
        _row("21:00", "Fed Maksimum Gösterge Faiz Oranı (Eylül)", "high", country="ABD"),
    ),
    _day("22 Eylül 2026", _row("15:30", "İlk İşsizlik Başvuruları (-)", "mid", "", "231K", country="ABD")),
)


def _by_title(rows):
    return {row["title"]: row for row in rows}


# ---------------------------------------------------------------------------
# doviz.com parsing
# ---------------------------------------------------------------------------


def test_each_row_gets_the_date_of_its_own_day_header():
    # borsapy stamped every row of a tab with that tab's FIRST header (all of "Bu ay" → the 1st).
    rows = _by_title(cal.parse_calendar_html(TR_HTML, "TR"))

    assert rows["Enflasyon Oranı (Yıllık)"]["Date"] == "2026-09-03"
    assert rows["TCMB Faiz Kararı"]["Date"] == "2026-09-10"
    assert rows["İş Dünyası Güveni"]["Date"] == "2026-09-21"
    assert rows["Döviz Rezervleri"]["Date"] == "2026-09-24"
    assert rows["Tatil"]["Date"] == "2026-09-30"


def test_overlapping_tabs_are_merged_but_real_duplicates_are_kept():
    rows = cal.parse_calendar_html(TR_HTML, "TR")
    names = [row["title"] for row in rows]

    assert names.count("Tüketici Güveni") == 1  # in all of Bugün / Bu hafta / Bu ay
    assert names.count("Döviz Rezervleri") == 1
    assert names.count("İhracat (Öncü)") == 2  # listed twice by the source itself
    assert len(rows) == 8
    assert len({row["id"] for row in rows}) == len(rows)


def test_the_copy_with_released_values_wins():
    confidence = _by_title(cal.parse_calendar_html(TR_HTML, "TR"))["Tüketici Güveni"]

    assert confidence["Actual"] == "91,9"
    assert confidence["actual_value"] == 91.9


def test_row_fields_keep_the_legacy_contract_and_add_new_ones():
    rows = _by_title(cal.parse_calendar_html(TR_HTML, "TR"))
    inflation, decision, holiday = rows["Enflasyon Oranı (Yıllık)"], rows["TCMB Faiz Kararı"], rows["Tatil"]

    assert inflation["Event"] == "Enflasyon Oranı (Yıllık) (-)"  # source name incl. period marker, spaces collapsed
    assert inflation["Period"] == "-" and inflation["period_label"] is None
    assert inflation["Importance"] == "high"
    assert inflation["Country"] == "Türkiye" and inflation["country_code"] == "TR"
    assert inflation["datetime"] == "2026-09-03T10:00:00+03:00"
    assert inflation["all_day"] is False
    assert inflation["actual_value"] == 31.51 and inflation["previous_value"] == 31.75
    assert inflation["Forecast"] is None and inflation["forecast_value"] is None
    assert inflation["tags"] == ["inflation"] and inflation["key_event"] is False
    assert decision["key_event"] is True and decision["tags"] == ["rates"]
    assert holiday["Time"] is None and holiday["all_day"] is True
    assert holiday["datetime"] == "2026-09-30T00:00:00+03:00"
    assert holiday["Importance"] == "low"
    # Same add-only shape as the TradingView rows.
    assert inflation["provider"] == "doviz" and inflation["title_tr"] == inflation["title"]
    assert inflation["title_en"] is None and inflation["unit"] is None and inflation["reference_date"] is None


def test_period_suffix_becomes_a_label():
    rows = _by_title(cal.parse_calendar_html(US_HTML, "US"))

    target = rows["Fed Maksimum Gösterge Faiz Oranı"]
    assert target["Period"] == "Eylül" and target["period_label"] == "Eylül"
    assert rows["İlk İşsizlik Başvuruları"]["previous_value"] == 231_000


def test_ids_are_stable_when_the_actual_value_is_released():
    before = cal.parse_calendar_html(_tab(0, _day("22 Eylül 2026", _row("10:00", "Tüketici Güveni (-)"))), "TR")
    after = cal.parse_calendar_html(TR_HTML, "TR")

    assert before[0]["id"] == _by_title(after)["Tüketici Güveni"]["id"]


def test_markup_without_tabs_is_still_parsed():
    rows = cal.parse_calendar_html(_day("05 Eylül 2026", RESERVES), "TR")

    assert [(row["Date"], row["title"]) for row in rows] == [("2026-09-05", "Döviz Rezervleri")]


# ---------------------------------------------------------------------------
# Tags, folding, numbers
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("title", "tags"),
    [
        ("TCMB Faiz Kararı", ["rates"]),
        ("Fed Williams Konuşması", ["rates", "speech"]),
        ("PPK Toplantı Özeti", ["rates", "speech"]),
        ("Enflasyon Oranı (Yıllık)", ["inflation"]),
        ("Çekirdek PCE Deflatör (Aylık)", ["inflation"]),
        ("Konut Fiyat Endeksi (Yıllık)", ["housing"]),  # a price index, but not consumer inflation
        ("İşsizlik Oranı", ["labor"]),
        ("GSYH Büyüme Oranı (Çeyreklik) (Final)", ["growth"]),
        ("S&P Global İmalat PMI (Öncü)", ["surveys"]),
        ("Michigan Enflasyon Beklentileri (Final)", ["inflation", "surveys"]),
        ("Perakende Satışlar (Benzin/Oto Hariç) (Aylık)", ["consumer"]),  # exclusions don't tag
        ("Dış Ticaret Dengesi", ["trade"]),
        ("Brüt Borç / GSYH", ["fiscal"]),
        ("M2 Para Arzı (Yıllık)", ["credit"]),
        ("EIA Ham Petrol Stokları Değişimi", ["energy"]),
        ("10 Yıllık Bund İhalesi", ["auction"]),
        ("İşçi Bayramı", ["holiday"]),
        ("Bilinmeyen Gösterge", ["other"]),
    ],
)
def test_calendar_tags(title, tags):
    assert cal.calendar_tags(title) == tags


def test_only_rate_decisions_are_key_events():
    assert cal.is_key_event("TCMB Faiz Kararı")
    assert cal.is_key_event("Faiz Kararı")
    assert not cal.is_key_event("Fed Maksimum Gösterge Faiz Oranı")
    assert not cal.is_key_event("MBA 30 Yıllık Mortgage Faizi")
    assert cal.is_key_event_en("Fed Interest Rate Decision")
    assert not cal.is_key_event_en("Loan Prime Rate 1Y")


def test_fold_is_turkish_and_diacritics_insensitive():
    assert cal.fold("İŞSİZLİK  Oranı") == "issizlik orani"
    assert cal.fold("ÜFE") == cal.fold("ufe") == "ufe"
    assert cal.fold("Kurumsal Kârlar") == "kurumsal karlar"


def test_calendar_number_parsing():
    assert cal.calendar_number("-0,3%") == -0.3
    assert cal.calendar_number("250K") == 250_000
    assert cal.calendar_number("1.234,5") == 1234.5
    assert cal.calendar_number("-") is None
    # doviz.com writes percentages the Turkish way, sign before the percent sign.
    assert cal.calendar_number("%7,6") == 7.6
    assert cal.calendar_number("%0,055") == 0.055
    assert cal.calendar_number("-%0,3") == -0.3
    assert cal.calendar_number("%-0,3") == -0.3
    assert cal.calendar_number("%") is None


# ---------------------------------------------------------------------------
# TradingView rows
# ---------------------------------------------------------------------------


def _tv(event_id, country, when, title, **fields):
    """A TradingView event as the endpoint returns it (``when`` in UTC)."""
    period = fields.pop("period", "Aug")
    return {"id": str(event_id), "country": country, "date": when, "title": title, "period": period, **fields}


TV_EVENTS = {
    "2026-08": [
        _tv(101, "TR", "2026-08-03T07:00:00.000Z", "Inflation Rate YoY", period="Jul", actual=32.9, forecast=33.1,
            previous=33.52, unit="%", importance=0, referenceDate="2026-07-31T00:00:00Z"),
        _tv(102, "US", "2026-08-07T12:30:00.000Z", "Non Farm Payrolls", period="Jul", actual=73, forecast=110,
            previous=14, scale="K", importance=1),
    ],
    "2026-09": [
        _tv(1, "TR", "2026-09-03T07:00:00.000Z", "Inflation Rate YoY", actual=31.51, forecast=31.62, previous=31.75,
            unit="%", importance=0, category="prce", referenceDate="2026-08-31T00:00:00Z",
            source="Turkish Statistical Institute", source_url="https://www.tuik.gov.tr"),
        _tv(2, "TR", "2026-09-03T09:15:00.000Z", "Balance of Trade Prel", actual=-5.24, previous=-7.34, unit="$",
            scale="B", importance=0, category="trd"),
        _tv(3, "TR", "2026-09-10T11:00:00.000Z", "TCMB Interest Rate Decision", period="", actual=37, forecast=37,
            previous=37, unit="%", importance=0, category="mny"),
        _tv(4, "US", "2026-09-16T18:00:00.000Z", "Fed Interest Rate Decision", period="", actual=4, forecast=4,
            previous=4.25, unit="%", importance=1, category="mny"),
        _tv(5, "US", "2026-09-16T18:30:00.000Z", "Fed Chair Powell Speech", period="", importance=1, category="mny"),
        _tv(6, "US", "2026-09-24T12:30:00.000Z", "Initial Jobless Claims", period="Sep/19", forecast=210,
            previous=196, scale="K", importance=0, category="lbr"),
        _tv(7, "US", "2026-09-07T00:00:00.000Z", "Labor Day", period="", importance=-1, category="gov"),
        _tv(8, "JP", "2026-09-25T23:30:00.000Z", "Tokyo CPI YoY", period="Sep", actual=2.5, previous=2.6, unit="%"),
        _tv(1, "TR", "2026-09-03T07:00:00.000Z", "Inflation Rate YoY", actual=31.51),  # duplicate id
        _tv(9, "XX", "2026-09-03T07:00:00.000Z", "Somewhere Else CPI"),  # unsupported country
    ],
    "2026-10": [
        _tv(201, "US", "2026-10-02T12:30:00.000Z", "Non Farm Payrolls", period="Sep", forecast=50, previous=22,
            scale="K", importance=1),
        # TradingView leaves the unit off some scheduled releases; the series' released rows have it.
        _tv(202, "TR", "2026-10-05T07:00:00.000Z", "Inflation Rate YoY", period="Sep", previous=31.51),
    ],
}


def _tv_rows(month):
    return {row["id"]: row for row in cal.tradingview_rows(TV_EVENTS[month])}


def test_tradingview_row_has_values_units_and_the_turkish_name():
    cpi = _tv_rows("2026-09")["tv1"]

    assert cpi["Date"] == "2026-09-03" and cpi["Time"] == "10:00"  # 07:00 UTC → Istanbul
    assert cpi["datetime"] == "2026-09-03T10:00:00+03:00" and cpi["all_day"] is False
    assert cpi["title_en"] == "Inflation Rate YoY"
    assert cpi["title"] == cpi["title_tr"] == "Enflasyon Oranı (Yıllık)"
    assert (cpi["Actual"], cpi["Forecast"], cpi["Previous"]) == ("%31,51", "%31,62", "%31,75")
    assert (cpi["actual_value"], cpi["forecast_value"], cpi["previous_value"]) == (31.51, 31.62, 31.75)
    assert cpi["unit"] == "%" and cpi["scale"] is None
    assert cpi["Importance"] == "high"  # doviz.com's level for TR CPI outranks TradingView's "0"
    assert cpi["tags"] == ["inflation"] and cpi["key_event"] is False
    assert cpi["Period"] == "Ağu" and cpi["period_label"] == "Aug" and cpi["reference_date"] == "2026-08-31"
    assert cpi["Event"] == "Enflasyon Oranı (Yıllık) (Ağu)" and cpi["Country"] == "Türkiye"
    assert cpi["source_name"] == "Turkish Statistical Institute" and cpi["provider"] == "tradingview"


def test_tradingview_row_scales_decisions_speeches_and_holidays():
    rows = _tv_rows("2026-09")

    trade = rows["tv2"]
    assert (trade["Actual"], trade["Previous"], trade["unit"], trade["scale"]) == ("-5,24B", "-7,34B", "$", "B")
    assert trade["Time"] == "12:15" and trade["tags"] == ["trade"]

    decision = rows["tv3"]
    assert decision["title"] == "TCMB Faiz Kararı" and decision["key_event"] is True
    assert decision["tags"] == ["rates"] and decision["Period"] is None

    speech = rows["tv5"]
    assert speech["title"] == "Fed Başkanı Powell Konuşması" and speech["tags"] == ["rates", "speech"]
    assert speech["Actual"] is None and speech["all_day"] is False  # 21:30 Istanbul, not midnight

    holiday = rows["tv7"]
    assert holiday["all_day"] is True and holiday["Time"] is None
    assert holiday["Date"] == "2026-09-07" and holiday["datetime"] == "2026-09-07T00:00:00+03:00"
    assert holiday["title"] == "İşçi Bayramı" and holiday["tags"] == ["holiday"]

    claims = rows["tv6"]
    assert claims["Forecast"] == "210K" and claims["Period"] == "19 Eyl" and claims["tags"] == ["labor"]
    assert claims["Importance"] == "mid"


def test_scheduled_releases_borrow_the_series_unit():
    released = _tv_rows("2026-09")
    scheduled = _tv_rows("2026-10")["tv202"]
    assert scheduled["unit"] is None and scheduled["Previous"] == "31,51"

    speech, cpi, trade = cal.fill_series_units(
        [released["tv5"], scheduled, released["tv2"]], siblings=[*released.values(), scheduled]
    )

    assert (cpi["unit"], cpi["scale"], cpi["Previous"], cpi["Actual"]) == ("%", None, "%31,51", None)
    assert scheduled["unit"] is None  # the cached row is left as it was
    assert speech is released["tv5"] and trade is released["tv2"]  # no values, or a unit already
    other_country = {**scheduled, "country_code": "US"}
    assert cal.fill_series_units([other_country], siblings=list(released.values())) == [other_country]


def test_tradingview_rows_drop_unusable_events_and_duplicates():
    rows = cal.tradingview_rows(TV_EVENTS["2026-09"])

    assert [row["id"] for row in rows].count("tv1") == 1
    assert {row["country_code"] for row in rows} == {"TR", "US", "JP"}
    assert cal.tradingview_record({"id": "1", "country": "TR", "date": "not a date", "title": "CPI"}) is None
    assert cal.tradingview_record({"id": "1", "country": "TR", "date": "2026-09-03T07:00:00Z", "title": " "}) is None


@pytest.mark.parametrize(
    ("value", "unit", "scale", "text"),
    [
        (31.51, "%", None, "%31,51"),
        (-0.3, "%", None, "%-0,3"),
        (206, None, "K", "206K"),
        (71.11, "$", "B", "71,11B"),
        (-395.698, "TRY", "B", "-395,698B"),
        (1234.5, None, None, "1.234,5"),
        (0.036, "$", "B", "0,036B"),
        (None, "%", None, None),
    ],
)
def test_tradingview_values_are_written_like_doviz(value, unit, scale, text):
    assert cal.format_tr_value(value, unit, scale) == text


@pytest.mark.parametrize(
    ("period", "label"),
    [("Aug", "Ağu"), ("Sept", "Eyl"), ("Sep/04", "4 Eyl"), ("Q3", "3. Çeyrek"), ("H1", "H1"), (None, None)],
)
def test_period_labels_in_turkish(period, label):
    assert cal.period_label_tr(period) == label


@pytest.mark.parametrize(
    ("title", "tags"),
    [
        ("Fed Interest Rate Decision", ["rates"]),
        ("ECB President Lagarde Speech", ["rates", "speech"]),
        ("Core PCE Price Index YoY", ["inflation"]),
        ("House Price Index YoY", ["housing"]),
        ("Unemployment Rate", ["labor"]),
        ("GDP Growth Rate QoQ Adv", ["growth"]),
        ("S&P Global Manufacturing PMI Flash", ["surveys"]),
        ("Michigan Inflation Expectations Prel", ["inflation", "surveys"]),
        ("Retail Sales Ex Autos MoM", ["consumer"]),
        ("Balance of Trade", ["trade"]),
        ("M2 Money Supply YoY", ["credit"]),
        ("EIA Crude Oil Stocks Change", ["energy"]),
        ("10-Year Note Auction", ["auction"]),
    ],
)
def test_tradingview_tags(title, tags):
    assert cal.tradingview_tags(title, None, None, False) == tags


def test_tradingview_tags_fall_back_to_the_category_and_skip_elections():
    assert cal.tradingview_tags("Unlisted Gauge", None, "hse", False) == ["housing"]
    assert cal.tradingview_tags("Unlisted Gauge", None, None, False) == ["other"]
    assert cal.tradingview_tags("Parliamentary Election", None, "gov", True) == ["other"]
    assert cal.tradingview_tags("Mid-Autumn Festival", None, "gov", True) == ["holiday"]


# ---------------------------------------------------------------------------
# Turkish names
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("title_en", "title_tr"),
    [
        ("Inflation Rate YoY", "Enflasyon Oranı (Yıllık)"),  # harvested from doviz.com
        ("GDP Growth Rate QoQ Adv", "GSYH Büyüme Oranı (Çeyreklik) (Öncü)"),  # learned base + qualifiers
        ("Tokyo CPI YoY", "Tokyo TÜFE (Yıllık)"),  # hand-kept base + qualifier
        ("Fed Chair Powell Speech", "Fed Başkanı Powell Konuşması"),
        ("BoE Gov Bailey Speech", "BoE Başkanı Bailey Konuşması"),
        ("RBA Hunter Speech", "RBA Hunter Konuşması"),
        ("HCOB Manufacturing PMI Flash", "HCOB İmalat PMI (Öncü)"),
        ("Istanbul Chamber of Industry Manufacturing PMI", "İstanbul Sanayi Odası (İSO) İmalat PMI"),
        ("7-Year Note Auction", "7 Yıllık Tahvil İhalesi"),
        ("26-Week Bill Auction", "26 Haftalık Bono İhalesi"),
        ("Treasury Gilt 2032 Auctions", "Hazine Gilt 2032 İhalesi"),
        ("RBNZ Interest Rate Decision", "RBNZ Faiz Kararı"),
        ("BoC Press Conference", "BoC Basın Toplantısı"),
        ("Eurogroup Meeting", "Eurogroup Toplantısı"),
        ("Labor Day", "İşçi Bayramı"),
        ("Some Unknown Gauge", None),
        ("Treasury Secretary Bessent Speech", None),  # not a central bank: stays English
    ],
)
def test_translate_title(title_en, title_tr):
    assert titles.translate_title(title_en) == title_tr


def test_qualifiers_split_on_both_sides():
    assert titles.split_qualifiers("Unit Labour Costs QoQ Final") == ("Unit Labour Costs", ["QoQ", "Final"])
    assert titles.split_qualifiers("GDP Growth Rate QoQ 3rd Est") == ("GDP Growth Rate", ["QoQ", "3rd Est"])
    assert titles.split_turkish_qualifiers("Perakende Stoklar (Oto Hariç) (Aylık) (Öncü)") == (
        "Perakende Stoklar (Oto Hariç)",  # an exclusion is part of the name
        ["Aylık", "Öncü"],
    )


def _dz(code, day, time, title, importance="mid", actual=None, previous=None):
    return {
        "country_code": code,
        "Date": day,
        "Time": time,
        "title": title,
        "Importance": importance,
        "actual_value": actual,
        "previous_value": previous,
    }


def test_pair_titles_matches_by_slot_and_values_then_lone_neighbours():
    events = [
        _tv(1, "TR", "2026-09-03T07:00:00.000Z", "Inflation Rate YoY", actual=31.51, previous=31.75),
        _tv(2, "TR", "2026-09-03T07:00:00.000Z", "Inflation Rate MoM", actual=1.84, previous=1.78),
        _tv(3, "US", "2026-09-02T18:00:00.000Z", "Fed Beige Book"),
        _tv(4, "US", "2026-09-16T18:30:00.000Z", "Fed Chair Powell Speech"),
        _tv(5, "US", "2026-09-04T12:30:00.000Z", "Unemployment Rate", actual=4.1, previous=4.2),
    ]
    rows = [
        _dz("TR", "2026-09-03", "10:00", "Enflasyon Oranı (Yıllık)", "high", 31.51, 31.75),
        _dz("TR", "2026-09-03", "10:00", "Enflasyon Oranı (Aylık)", "high", 1.84, 1.78),
        _dz("US", "2026-09-02", "21:00", "Fed Bej Kitap"),  # no values: a lone same-slot pair sharing "Fed"
        _dz("US", "2026-09-16", "21:30", "Fed Barr Konuşması"),  # speeches are left to the patterns
        _dz("US", "2026-09-04", "15:30", "İşsizlik Oranı", "high", 4.3, 4.2),  # actual disagrees, no shared word
    ]

    pairs = {(pair.title_en, pair.title_tr, pair.by_value) for pair in titles.pair_titles(rows, events)}

    assert pairs == {
        ("Inflation Rate YoY", "Enflasyon Oranı (Yıllık)", True),
        ("Inflation Rate MoM", "Enflasyon Oranı (Aylık)", True),
        ("Fed Beige Book", "Fed Bej Kitap", False),
    }


def test_harvest_takes_the_majority_and_prefers_value_matches():
    pair = titles.TitlePair
    names, importance = titles.harvest(
        [
            pair("TR", "CPI", "TÜFE", "high", True),
            pair("TR", "CPI", "TÜFE", "high", True),
            pair("US", "CPI", "Tüketici Fiyatları", "mid", False),
            pair("US", "CPI", "Tüketici Fiyatları", "mid", False),
        ]
    )

    assert names == {"CPI": "TÜFE"}  # two value matches (×3) beat two guesses
    assert importance == {"TR|CPI": "high", "US|CPI": "mid"}


# ---------------------------------------------------------------------------
# Window
# ---------------------------------------------------------------------------


def test_default_window_is_last_month_to_next_month():
    assert cal.resolve_window(None, None, date(2026, 9, 24)) == (date(2026, 8, 1), date(2026, 10, 31))
    assert cal.resolve_window(None, None, date(2026, 12, 5)) == (date(2026, 11, 1), date(2027, 1, 31))


def test_one_bound_opens_the_month_beside_it():
    assert cal.resolve_window(date(2026, 3, 10), None, date(2026, 9, 24)) == (date(2026, 3, 10), date(2026, 4, 30))
    assert cal.resolve_window(None, date(2026, 3, 10), date(2026, 9, 24)) == (date(2026, 2, 1), date(2026, 3, 10))


def test_windows_longer_than_four_months_are_rejected():
    with pytest.raises(cal.InvalidInputError, match="124 gün"):
        cal.resolve_window(date(2026, 1, 1), date(2026, 9, 30), date(2026, 9, 24))


def test_months_between_crosses_years():
    assert cal.months_between(date(2026, 11, 20), date(2027, 2, 1)) == ["2026-11", "2026-12", "2027-01", "2027-02"]


# ---------------------------------------------------------------------------
# get_economic_calendar
# ---------------------------------------------------------------------------


@pytest.fixture
def source(monkeypatch):
    """TradingView and doviz.com fixtures instead of the network; records every upstream call."""
    calls: list[str] = []
    down: set[str] = set()
    pages = {"TR": TR_HTML, "US": US_HTML, "EU": _tab(3)}

    def loader(kind):
        async def load(month):
            calls.append(f"{kind}:{month}")
            if month in down or "tradingview" in down:
                raise RuntimeError("TradingView down")
            return {"rows": cal.tradingview_rows(TV_EVENTS.get(month, [])), "fetched_at": f"{month}-24T12:00:00+03:00"}

        return load

    async def fake_country(code):
        calls.append(f"doviz:{code}")
        if code not in pages or "doviz" in down:
            raise RuntimeError("doviz.com down")
        return {"rows": cal.parse_calendar_html(pages[code], code), "fetched_at": "2026-09-24T11:00:00+03:00"}

    monkeypatch.setattr(cal, "_tradingview_month_live", loader("live"))
    monkeypatch.setattr(cal, "_tradingview_month_archive", loader("archive"))
    monkeypatch.setattr(cal, "_fetch_country", fake_country)
    monkeypatch.setattr(cal, "_today", lambda: date(2026, 9, 24))
    return {"calls": calls, "down": down}


async def test_defaults_to_turkey_and_us_last_month_to_next_month(source):
    result = await cal.get_economic_calendar()

    # Months already over are cached longer ("archive").
    assert source["calls"] == ["archive:2026-08", "live:2026-09", "live:2026-10"]
    rows = result["calendar"]
    assert {row["country_code"] for row in rows} == {"TR", "US"}  # JP comes with the month, not shown
    stamps = [row["datetime"] for row in rows]
    assert stamps == sorted(stamps)
    assert result["total"] == len(rows) == 11
    assert result["window"] == {"start": "2026-08-01", "end": "2026-10-31"}
    assert result["available"] is True and result["source"] == cal.TRADINGVIEW_SOURCE_LABEL
    assert result["providers"] == ["tradingview"] and result["unavailable_months"] == []
    assert result["failed_countries"] == [] and result["as_of"] == "2026-08-24T12:00:00+03:00"
    assert result["countries"] == [{"code": "TR", "name": "Türkiye"}, {"code": "US", "name": "ABD"}]
    assert {"code": "JP", "name": "Japonya"} in result["supported_countries"]
    assert sum(row["forecast_value"] is not None for row in rows) == 7
    upcoming_cpi = next(row for row in rows if row["id"] == "tv202")
    assert (upcoming_cpi["unit"], upcoming_cpi["Previous"]) == ("%", "%31,51")  # from the August/September releases


async def test_start_and_end_pick_the_months_and_filter(source):
    result = await cal.get_economic_calendar("tr,us", start="2026-09-10", end="2026-09-22", importance="high")

    assert source["calls"] == ["live:2026-09"]
    assert [row["title"] for row in result["calendar"]] == [
        "TCMB Faiz Kararı",
        "Fed Faiz Kararı",
        "Fed Başkanı Powell Konuşması",
    ]
    assert result["window"] == {"start": "2026-09-10", "end": "2026-09-22"}
    assert result["total"] == 3  # rows of the window, before the importance filter


async def test_text_search_matches_english_and_turkish_names(source):
    english = await cal.get_economic_calendar("TR,US", q="inflation rate")
    turkish = await cal.get_economic_calendar("TR,US", q="enflasyon türkiye")

    expected = ["tv101", "tv1", "tv202"]
    assert [row["id"] for row in english["calendar"]] == [row["id"] for row in turkish["calendar"]] == expected
    rates = await cal.get_economic_calendar("TR,US", tags="rates", start="2026-09-01", end="2026-09-30")
    assert {row["id"] for row in rates["calendar"]} == {"tv3", "tv4", "tv5"}


async def test_current_month_falls_back_to_doviz(source):
    source["down"].add("2026-09")

    result = await cal.get_economic_calendar("TR,US")

    assert "doviz:TR" in source["calls"] and "doviz:US" in source["calls"]
    assert result["providers"] == ["tradingview", "doviz"] and result["unavailable_months"] == []
    september = [row for row in result["calendar"] if row["Date"].startswith("2026-09")]
    assert september and {row["provider"] for row in september} == {"doviz"}
    others = [row for row in result["calendar"] if not row["Date"].startswith("2026-09")]
    assert others and {row["provider"] for row in others} == {"tradingview"}


async def test_a_past_month_failure_is_reported_without_fallback(source):
    source["down"].add("2026-08")

    result = await cal.get_economic_calendar("TR,US")

    assert not any(call.startswith("doviz:") for call in source["calls"])
    assert result["unavailable_months"] == ["2026-08"] and result["available"] is True
    assert not any(row["Date"].startswith("2026-08") for row in result["calendar"])


async def test_everything_down_is_unavailable_not_an_error(source):
    source["down"].update({"tradingview", "doviz"})

    result = await cal.get_economic_calendar("TR,US")

    assert result["calendar"] == [] and result["available"] is False and result["source"] is None
    assert result["providers"] == [] and result["failed_countries"] == ["TR", "US"]
    assert result["unavailable_months"] == ["2026-08", "2026-09", "2026-10"]
    assert result["as_of"] is None and result["window"] == {"start": "2026-08-01", "end": "2026-10-31"}


async def test_all_countries(source):
    result = await cal.get_economic_calendar("all")

    assert {row["country_code"] for row in result["calendar"]} == {"TR", "US", "JP"}
    assert result["available"] is True


@pytest.mark.parametrize(
    ("kwargs", "message"),
    [
        ({"countries": "TR,XX"}, "Geçersiz ülke kodu: XX"),
        ({"importance": "urgent"}, "Geçersiz önem"),
        ({"tags": "rates,astrology"}, "Geçersiz etiket"),
        ({"start": "22.09.2026"}, "Geçersiz 'start'"),
        ({"start": "2026-09-23", "end": "2026-09-22"}, "sonra olamaz"),
        ({"start": "2026-01-01", "end": "2026-09-30"}, "en fazla 124 gün"),
    ],
)
async def test_invalid_filters_are_400_payloads(source, kwargs, message):
    result = await cal.get_economic_calendar(**kwargs)

    assert result["error_status"] == 400 and message in result["error"]
    assert source["calls"] == []  # validation happens before any upstream call


def test_query_aliases_and_dedup():
    query = cal.CalendarQuery.parse("us,TR,US", importance="YÜKSEK,orta,medium", tags="Rates , rates")

    assert query.countries == ("US", "TR")
    assert query.importance == ("high", "mid")
    assert query.tags == ("rates",)


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routers_macro.macro_router)
    return TestClient(app)


def test_endpoint_passes_filters_through(client, source):
    response = client.get("/macro/calendar", params={"countries": "TR", "tags": "rates", "q": "tcmb"})

    assert response.status_code == 200
    body = response.json()
    assert [row["title"] for row in body["calendar"]] == ["TCMB Faiz Kararı"]
    assert body["calendar"][0]["key_event"] is True
    assert body["calendar"][0]["title_en"] == "TCMB Interest Rate Decision"


def test_endpoint_rejects_invalid_filters_with_400(client, source):
    response = client.get("/macro/calendar", params={"countries": "ZZ"})

    assert response.status_code == 400
    assert "Geçersiz ülke kodu" in response.json()["detail"]
