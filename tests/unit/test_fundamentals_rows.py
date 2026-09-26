"""financial_statements rows ⇄ adapter payloads: row building, content hashes, exact reconstruction
(store-served views must equal live ones) — no network, no database."""

import copy
import json

import pytest

from src.adapters import fundamentals_statements as fs
from tests.unit.test_fundamentals_data_quality import BANK_SUMMARY_HTML, KAP_SUMMARY_HTML

ISY_TABLE = {
    "group": "XI_29",
    "template": "industrial",
    "periods": ["2025/12", "2025/09", "2024/12"],
    "items": [
        {"code": "1A", "label": "Dönen Varlıklar", "statement": "balance",
         "values": {"2025/12": 500.0, "2025/09": 480.0, "2024/12": 400.0}},
        {"code": "1BL", "label": "TOPLAM VARLIKLAR", "statement": "balance",
         "values": {"2025/12": 1_996_745e6 / 0.85, "2025/09": 1_794e9, "2024/12": 1_399_606e6 / 0.76}},
        {"code": "2AA", "label": "Finansal Borçlar (Kısa Vadeli Yükümlülükler)", "statement": "balance",
         "values": {"2025/12": 10.0, "2025/09": None, "2024/12": 0.0}},
        {"code": "3C", "label": "Satış Gelirleri", "statement": "income",
         "values": {"2025/12": 955_472e6 / 0.85, "2025/09": 690e9, "2024/12": 745_430e6 / 0.76}},
        {"code": "3L", "label": "DÖNEM KARI (ZARARI)", "statement": "income",
         "values": {"2025/12": 118_117e6 / 0.85, "2025/09": 80e9, "2024/12": 113_357e6 / 0.76}},
        {"code": "4CAB", "label": "Amortisman & İtfa Payları", "statement": "cashflow",
         "values": {"2025/12": 111e9, "2025/09": 67e9, "2024/12": 94e9}},
        {"code": "4CBL", "label": "Dönem Sonu Nakit", "statement": "cashflow",
         "values": {"2025/12": 97e9, "2025/09": 100e9, "2024/12": 118e9}},
    ],
}


def _kap(html=KAP_SUMMARY_HTML):
    kap = fs._parse_kap_financial_summary(html)
    kap["source_url"] = "https://www.kap.org.tr/tr/sirket-finansal-bilgileri/1107-turk-hava-yollari-a-o"
    return kap


def _dump(value):
    return json.dumps(value, sort_keys=True, default=str)


def test_kap_rows_are_one_per_period_and_statement_with_ordered_items():
    rows = fs.kap_statement_rows(_kap())

    keys = sorted((r["period"], r["statement_type"]) for r in rows)
    assert keys == [
        ("2024/12", "balance_sheet"), ("2024/12", "income_stmt"),
        ("2025/03", "balance_sheet"), ("2025/03", "income_stmt"),
        ("2025/12", "balance_sheet"), ("2025/12", "income_stmt"),
    ]
    income = next(r for r in rows if r["period"] == "2025/03" and r["statement_type"] == "income_stmt")
    assert [i["label"] for i in income["items_json"]] == ["Hasılat", "Net Dönem Kârı (Zararı)"]
    assert income["items_json"][0] == {"code": None, "label": "Hasılat", "key": "hasilat", "value": 221_815e6}
    assert income["months"] == 3 and income["period_type"] == "interim"
    assert income["presentation_unit"] == "1000000 TL"
    assert income["source"] == "kap" and income["restated"] is False
    assert len(income["content_hash"]) == 64


def test_content_hash_is_stable_and_content_sensitive():
    rows = fs.kap_statement_rows(_kap())
    again = fs.kap_statement_rows(_kap())
    assert [r["content_hash"] for r in rows] == [r["content_hash"] for r in again]

    changed = copy.deepcopy(rows[0])
    changed["items_json"][0]["value"] += 1
    assert fs.statement_content_hash(changed) != rows[0]["content_hash"]
    dated = {**rows[0], "published_at": "2026-03-04"}
    assert fs.statement_content_hash(dated) != rows[0]["content_hash"]


@pytest.mark.parametrize("html", [KAP_SUMMARY_HTML, BANK_SUMMARY_HTML])
def test_kap_summary_round_trips_through_rows(html):
    kap = _kap(html)

    rebuilt = fs.kap_summary_from_rows(fs.kap_statement_rows(kap), set(kap["periods"]))

    assert _dump(rebuilt) == _dump(kap)


def test_isyatirim_rows_flag_restated_year_ends_and_round_trip():
    rows = fs.isyatirim_statement_rows(
        ISY_TABLE, ticker="thyao", restated={"2025/12": 0.8491958, "2024/12": 0.764}, consolidation="Konsolide"
    )

    assert len(rows) == 9  # 3 periods × balance/income/cash flow
    fy = next(r for r in rows if r["period"] == "2025/12" and r["statement_type"] == "balance_sheet")
    assert fy["restated"] is True and fy["restatement_factor"] == 0.849196
    assert fy["source_url"].endswith("hisse=THYAO")
    assert fy["presentation_unit"] == "TL" and fy["consolidation"] == "Konsolide"
    interim = next(r for r in rows if r["period"] == "2025/09" and r["statement_type"] == "cash_flow")
    assert interim["restated"] is False and interim["restatement_factor"] is None
    assert [i["code"] for i in interim["items_json"]] == ["4CAB", "4CBL"]

    rebuilt = fs.isyatirim_table_from_rows(rows)
    assert _dump(rebuilt) == _dump(ISY_TABLE)


def test_reconstruction_keeps_only_the_latest_fetch_periods():
    kap = _kap()
    rows = fs.kap_statement_rows(kap)
    # A first-published interim stored by an earlier run, no longer on KAP's page.
    old = fs.kap_statement_rows({**kap, "periods": ["2024/09"],
                                 "balance_sheet": [{"Item": "Toplam Varlıklar", "2024/09": 1.0}],
                                 "income_statement": [{"Item": "Hasılat", "2024/09": 2.0}]})

    latest = fs.kap_summary_from_rows([*rows, *old], set(kap["periods"]))
    everything = fs.kap_summary_from_rows([*rows, *old])

    assert latest["periods"] == kap["periods"]
    assert "2024/09" in everything["periods"]


@pytest.mark.parametrize("quarterly", [False, True])
@pytest.mark.parametrize("section", ["balance", "income"])
def test_statement_views_from_store_equal_live_views(section, quarterly):
    kap = _kap()
    isy = copy.deepcopy(ISY_TABLE)
    rows = fs.kap_statement_rows(kap) + fs.isyatirim_statement_rows(isy, ticker="THYAO")
    kap2 = fs.kap_summary_from_rows(rows, set(kap["periods"]))
    isy2 = fs.isyatirim_table_from_rows(rows, set(isy["periods"]))

    live = fs.build_statement_view("THYAO", kap, isy, quarterly=quarterly, section=section)
    stored = fs.build_statement_view("THYAO", kap2, isy2, quarterly=quarterly, section=section)

    assert _dump(stored) == _dump(live)
    assert live["source_url"] == kap["source_url"]


@pytest.mark.parametrize("quarterly", [False, True])
def test_cashflow_view_from_store_equals_live(quarterly):
    kap = _kap()
    rows = fs.kap_statement_rows(kap) + fs.isyatirim_statement_rows(ISY_TABLE, ticker="THYAO")

    live = fs.build_cashflow_view("THYAO", kap, ISY_TABLE, quarterly=quarterly)
    stored = fs.build_cashflow_view(
        "THYAO", fs.kap_summary_from_rows(rows), fs.isyatirim_table_from_rows(rows), quarterly=quarterly
    )

    assert live["available"] is True
    assert _dump(stored) == _dump(live)


def test_statement_view_without_any_source_raises_the_statements_error():
    with pytest.raises(fs.MarketDataError):
        fs.build_statement_view("THYAO", None, None, quarterly=False, section="balance")


def test_statement_maps_from_rows_feed_the_facts_builder():
    kap = _kap()
    rows = fs.kap_statement_rows(kap)

    maps = fs.statement_maps_from_rows(rows, "kap")

    assert maps["2025/12"]["balance"]["Toplam Varlıklar"] == 1_996_745e6
    assert maps["2025/03"]["income"]["Net Dönem Kârı (Zararı)"] == 17_650e6
    assert fs.statement_maps_from_rows(rows, "isyatirim") == {}
