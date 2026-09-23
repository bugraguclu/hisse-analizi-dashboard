"""Reference record normalisers and legacy payload builders (no network)."""

from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from src.adapters import fundamentals_reference as fr
from src.adapters.bist_reference import ExpectedDisclosureRecord
from src.services.reference_service import compare_holders, normalize_holder_name

IST = ZoneInfo("Europe/Istanbul")


def ms(day: date) -> float:
    return datetime(day.year, day.month, day.day, tzinfo=IST).timestamp() * 1000


RECOMMENDATION = {"ONERI": "AL", "HEDEF_FIYAT": 455.0009347826087, "GETIRI_POT": 0.5268487744382842,
                  "TARIH": ms(date(2026, 4, 24))}
ITEMS = [
    {**RECOMMENDATION, "SHT_KODU": "04", "SHHE_TARIH": ms(date(2025, 9, 2)), "SHHE_NAKIT_TM_ORAN": 344.2,
     "SHHE_NAKIT_TM_ORAN_NET": 292.57, "SHHE_NAKIT_TM_TUTAR": 4_750_000_000.0},
    {**RECOMMENDATION, "SHT_KODU": "04", "SHHE_TARIH": ms(date(2025, 6, 16)), "SHHE_NAKIT_TM_ORAN": 344.2,
     "SHHE_NAKIT_TM_ORAN_NET": 292.57, "SHHE_NAKIT_TM_TUTAR": 4_750_000_000.0},
    {**RECOMMENDATION, "SHT_KODU": "03", "SHHE_TARIH": ms(date(1998, 1, 23)), "SHHE_BDLI_ORAN": 100.0,
     "SHHE_BDSZ_IK_ORAN": 100.0, "HSP_BOLUNME_ONCESI_SERMAYE": 10_000_000.0, "HSP_BOLUNME_SONRASI_SERMAYE": 30_000_000.0},
    {**RECOMMENDATION, "SHT_KODU": "02", "SHHE_TARIH": ms(date(2011, 6, 1)), "SHHE_BDSZ_IK_ORAN": 40.0,
     "HSP_BOLUNME_ONCESI_SERMAYE": 5.15e6, "HSP_BOLUNME_SONRASI_SERMAYE": 7.21e6},
    {**RECOMMENDATION, "SHT_KODU": "09", "SHHE_TARIH": ms(date(2011, 6, 1)), "SHHE_BDSZ_TM_ORAN": 10.0,
     "HSP_BOLUNME_ONCESI_SERMAYE": 5.15e6, "HSP_BOLUNME_SONRASI_SERMAYE": 7.73e6},
    # "Rüçhan hakkı kısıtlanarak" with the provider's year-1 placeholder date → skipped
    {**RECOMMENDATION, "SHT_KODU": "07", "SHHE_TARIH": -62135596800000, "SHHE_RHK_ORAN": 13.68},
    {**RECOMMENDATION, "SHT_KODU": "99", "SHHE_TARIH": ms(date(2020, 1, 1))},  # administrative record
]


def test_dividend_payload_matches_the_legacy_builder():
    records = fr.dividend_records(ITEMS * 2)  # duplicates collapse

    assert [r.ex_date for r in records] == [date(2025, 9, 2), date(2025, 6, 16)]
    assert records[0].gross_rate_pct == Decimal("344.2000") and records[0].gross_per_share == Decimal("3.442000")
    assert fr.dividends_payload_rows(records) == fr._dividend_records(ITEMS)  # byte-for-byte legacy rows


def test_dividend_without_rates_keeps_legacy_zero_but_stores_none():
    item = {"SHT_KODU": "04", "SHHE_TARIH": ms(date(2024, 5, 2)), "SHHE_NAKIT_TM_ORAN": 12.5}
    (record,) = fr.dividend_records([item])

    assert record.net_rate_pct is None and record.total_amount is None  # nothing fabricated in the store
    (row,) = fr.dividends_payload_rows([record])
    assert row == fr._dividend_records([item])[0]  # legacy JSON: NetRate 0.0, TotalDividend null


def test_capital_increase_records():
    records = fr.capital_increase_records(ITEMS)
    by_key = {(r.event_date, r.kind): r for r in records}

    assert set(by_key) == {(date(1998, 1, 23), "rights_bonus"), (date(2011, 6, 1), "bonus")}
    rights = by_key[(date(1998, 1, 23), "rights_bonus")]
    assert (rights.rights_rate_pct, rights.bonus_rate_pct) == (Decimal("100.0000"), Decimal("100.0000"))
    assert (rights.capital_before, rights.capital_after) == (Decimal("10000000.00"), Decimal("30000000.00"))
    bonus = by_key[(date(2011, 6, 1), "bonus")]  # 02 + 09 on the same day merge
    assert bonus.bonus_rate_pct == Decimal("50.0000")
    assert (bonus.capital_before, bonus.capital_after) == (Decimal("5150000.00"), Decimal("7730000.00"))


def test_recommendation_record_and_payload():
    record = fr.recommendation_record(ITEMS)

    assert record == fr.RecommendationRecord("AL", Decimal("455.0009"), Decimal("52.6849"), date(2026, 4, 24))
    assert fr.recommendations_payload(record) == {
        "source": "İş Yatırım (borsapy)",
        "recommendations": {"recommendation": "AL", "target_price": 455.0, "upside_potential": 52.68},
        "available": True,
    }


def test_uncovered_company_has_no_fabricated_upside():
    uncovered = [{"SHT_KODU": "02", "ONERI": None, "HEDEF_FIYAT": 0.0, "GETIRI_POT": 0.0}]

    assert fr.recommendation_record(uncovered) is None
    assert fr.recommendations_payload(None) == {
        "source": "İş Yatırım (borsapy)",
        "recommendations": {"recommendation": None, "target_price": None, "upside_potential": None},
        "available": False,
    }


def test_targets_payload_keeps_the_legacy_key_set():
    record = fr.PriceTargetRecord(low=Decimal("330"), high=Decimal("580"), mean=Decimal("451.37"), analysts=20)

    body = fr.targets_payload(record, 298.5)
    assert body == {
        "source": "İş Yatırım analist konsensüsü (borsapy)",
        "targets": {"current": 298.5, "low": 330.0, "high": 580.0, "mean": 451.37, "median": 455.0,
                    "numberOfAnalysts": 20},
        "available": True,
    }
    assert list(body["targets"]) == ["current", "low", "high", "mean", "median", "numberOfAnalysts"]
    empty = fr.targets_payload(None, -1.0)
    assert empty["available"] is False and empty["targets"] == dict.fromkeys(body["targets"])


def test_holders_payload_rows_keep_order():
    records = [fr.HolderRecord("Diğer", Decimal("50.8800")), fr.HolderRecord("Türkiye Varlık Fonu", Decimal("49.12"))]

    assert fr.holders_payload_rows(records) == [
        {"Holder": "Diğer", "Percentage": 50.88},
        {"Holder": "Türkiye Varlık Fonu", "Percentage": 49.12},
    ]


def test_earnings_payload_rows_filter_financial_reports_in_the_window():
    def rec(subject, start, end):
        return ExpectedDisclosureRecord(subject, "9 Aylık", 2026, start, end, None, None)

    records = [
        rec("Finansal Rapor", date(2027, 1, 1), date(2027, 3, 11)),
        rec("Finansal Rapor", date(2026, 10, 1), date(2026, 11, 19)),
        rec("Finansal Rapor", date(2026, 10, 1), date(2026, 11, 19)),  # consolidated + solo taxonomies
        rec("Faaliyet Raporu (Konsolide)", date(2026, 10, 1), date(2026, 11, 19)),
        rec("Finansal Rapor", date(2026, 7, 1), date(2026, 8, 11)),  # window closed
        rec("Finansal Rapor", date(2027, 7, 1), date(2027, 8, 11)),  # beyond the 180-day horizon
    ]

    rows = fr.earnings_payload_rows(records, date(2026, 9, 23))

    assert [r["Earnings Date"] for r in rows] == ["2026-11-19T00:00:00", "2026-11-19T00:00:00", "2027-03-11T00:00:00"]
    assert rows[0] == {"Earnings Date": "2026-11-19T00:00:00", "EPS Estimate": None, "Reported EPS": None,
                       "Surprise(%)": None}


def test_to_decimal_rounds_like_postgres_and_rejects_non_finite():
    assert fr.to_decimal(2.345, 2) == Decimal("2.35")
    assert fr.to_decimal(-2.345, 2) == Decimal("-2.35")
    assert fr.to_decimal(float("nan"), 2) is None
    assert fr.to_decimal(1e100, 2) is None
    assert fr.to_decimal(None, 2) is None


def test_holder_names_match_across_kap_and_isyatirim():
    assert normalize_holder_name("BANCO BILBAO VIZCAYA ARGENTARIA S.A.") == normalize_holder_name(
        "Banco Bılbao Vızcaya Argentarıa")
    comparison = compare_holders(
        [("TÜRKİYE VARLIK FONU", 49.12), ("DİĞER", 50.88), ("YOK BÖYLE BİRİ A.Ş.", 5.5)],
        [("Diğer", 50.88), ("Türkiye Varlık Fonu", 49.12)],
    )
    assert comparison["max_gap"] == 0.0
    assert [m["holder"] for m in comparison["matched"]] == ["TÜRKİYE VARLIK FONU"]
    assert comparison["unmatched"] == ["YOK BÖYLE BİRİ A.Ş."]
