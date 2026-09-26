"""Universe merge (build_universe) and transition rules (plan_universe) — pure, no DB/network."""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from src.adapters import bist_reference as br
from src.db.repositories.reference import CompanyState
from src.services.universe_service import DELIST_MIN_CAP, plan_universe

NOW = datetime(2026, 9, 23, 5, 0, tzinfo=timezone.utc)


def tv(ticker, *, kind="stock", subtype="common", isin=None, ff=30.0, indexes=()):
    return br.TvSecurity(
        ticker=ticker, description=f"{ticker} Sanayi A.Ş.", isin=isin or f"TRA{ticker:<5}".replace(" ", "X") + "91A1",
        sector="Finans", industry="Bankalar", type=kind, subtype=subtype, market_cap=1e9, free_float_pct=ff,
        index_codes=tuple(indexes),
    )


def index_file(pairs):
    return br.IndexFile(
        as_of=date(2026, 9, 23),
        indices={code: br.IndexInfo(code, code, code) for code, _ in pairs},
        constituents=[br.IndexConstituent(code, ticker, f"{ticker} BULTEN") for code, ticker in pairs],
    )


def kap(*tickers):
    return br.KapDirectory(
        members={t: br.KapMember(t, f"oid-{t}", f"{t} OFFICIAL A.Ş.") for t in tickers},
        sectors={t: br.KapSector(t, f"oid-{t}", "BANKALAR", None) for t in tickers},
        markets={t: "YILDIZ PAZAR" for t in tickers},
    )


def state(ticker, *, tier="core", status="listed", active=True, isin=None, oid=None, ff=None, refreshed=None,
          legal="OLD NAME"):
    return CompanyState(
        id=uuid.uuid4(), ticker=ticker, legal_name=legal, display_name=f"{ticker} Curated", isin=isin,
        kap_member_oid=oid, tracking_tier=tier, listing_status=status, is_active=active,
        free_float_pct=ff, reference_updated_at=refreshed,
    )


def test_build_universe_unions_tradingview_and_index_file_and_skips_non_equity():
    sources = br.UniverseSources(
        tradingview={
            "GARAN": tv("GARAN", indexes=("XU100",)),
            "ISYAT": tv("ISYAT", kind="fund", subtype="closedend"),
            "ZGOLD": tv("ZGOLD", kind="fund", subtype="etf", isin="TRYZIPO00162"),
            "ALTIN": tv("ALTIN", isin="TRXDRP012213"),
        },
        index_file=index_file([("XU100", "GARAN"), ("XBANK", "ISATR")]),
        kap=kap("GARAN", "ISATR"),
    )

    entries, skipped = br.build_universe(sources)
    by = {e.ticker: e for e in entries}

    assert set(by) == {"GARAN", "ISATR", "ISYAT"}
    assert set(skipped) == {"ZGOLD", "ALTIN"}
    assert by["ISATR"].isin is None and by["ISATR"].sources == ("borsaistanbul", "kap")  # index-file only
    assert by["ISYAT"].security_type == "closed_end_fund"
    assert by["GARAN"].legal_name == "GARAN OFFICIAL A.Ş."  # KAP title wins over the TradingView description
    assert by["GARAN"].sector == "BANKALAR" and by["GARAN"].industry == "Bankalar"
    assert by["GARAN"].index_codes == ("XU100",)


def _entries(*tickers):
    sources = br.UniverseSources(
        tradingview={t: tv(t) for t in tickers}, index_file=index_file([("XU100", t) for t in tickers]),
        kap=kap(*tickers),
    )
    return br.build_universe(sources)[0]


def test_new_companies_are_inserted_with_tier_from_the_core_set():
    entries = _entries("AAA", "BBB")
    plan = plan_universe(entries, {}, now=NOW, core_set={"AAA"}, sources_complete=True)

    assert [row["ticker"] for row in plan.inserts] == ["AAA", "BBB"]
    tiers = {row["ticker"]: row["tracking_tier"] for row in plan.inserts}
    assert tiers == {"AAA": "core", "BBB": "universe"}
    assert plan.inserts[0]["aliases"] == ["AAA", plan.inserts[0]["display_name"]]
    assert plan.inserts[0]["free_float_pct"] == Decimal("30.00")
    assert plan.promoted == ["AAA"]


def test_existing_rows_update_reference_columns_only():
    entries = _entries("AAA")
    existing = {"AAA": state("AAA", tier="universe", refreshed=NOW, ff=Decimal("49.18"))}
    plan = plan_universe(entries, existing, now=NOW, core_set={"AAA"}, sources_complete=True,
                         official_titles={"AAA"})

    (update,) = plan.updates
    assert "display_name" not in update and "aliases" not in update  # curated values stay
    assert "free_float_pct" not in update  # an official (KAP) value is never overwritten by TradingView
    assert update["legal_name"] == "AAA OFFICIAL A.Ş."
    assert update["tracking_tier"] == "core" and plan.promoted == ["AAA"]
    assert update["id"] == existing["AAA"].id


def test_missing_source_values_never_erase_known_ones():
    sources = br.UniverseSources(tradingview={"AAA": tv("AAA")}, index_file=index_file([("XU100", "AAA")]), kap=None)
    entries = br.build_universe(sources)[0]
    existing = {"AAA": state("AAA", oid="oid-kept")}

    (update,) = plan_universe(entries, existing, now=NOW, core_set={"AAA"}, sources_complete=True).updates

    assert "kap_member_oid" not in update and "sector" not in update and "legal_name" not in update


def test_vanished_companies_are_delisted_and_demoted_not_deleted():
    entries = _entries("AAA")
    existing = {"AAA": state("AAA"), "KOZAL": state("KOZAL")}
    plan = plan_universe(entries, existing, now=NOW, core_set={"AAA"}, sources_complete=True)

    assert plan.delisted == ["KOZAL"] and plan.demoted == ["KOZAL"]
    delist = next(u for u in plan.updates if u["id"] == existing["KOZAL"].id)
    assert delist == {"id": existing["KOZAL"].id, "listing_status": "delisted", "is_active": False,
                      "tracking_tier": "universe"}


def test_delisting_is_skipped_when_a_source_is_missing_or_the_loss_is_implausible():
    entries = _entries("AAA")
    existing = {"AAA": state("AAA"), "BBB": state("BBB")}
    partial = plan_universe(entries, existing, now=NOW, core_set={"AAA"}, sources_complete=False)
    assert partial.delisted == [] and partial.missing == ["BBB"] and partial.delisting_skipped

    many = {f"X{i:03d}": state(f"X{i:03d}", tier="universe") for i in range(DELIST_MIN_CAP + 5)}
    implausible = plan_universe(entries, {**existing, **many}, now=NOW, core_set={"AAA"}, sources_complete=True)
    assert implausible.delisted == [] and implausible.delisting_skipped


def test_delisted_company_that_reappears_is_reactivated():
    entries = _entries("AAA")
    existing = {"AAA": state("AAA", tier="universe", status="delisted", active=False)}
    plan = plan_universe(entries, existing, now=NOW, core_set=set(), sources_complete=True)

    (update,) = plan.updates
    assert update["listing_status"] == "listed" and update["is_active"] is True
    assert plan.reactivated == ["AAA"]


def test_tier_is_kept_when_the_index_file_is_unavailable():
    entries = _entries("AAA", "NEW")
    existing = {"AAA": state("AAA", tier="core")}
    plan = plan_universe(entries, existing, now=NOW, core_set=None, sources_complete=False, extra_core={"NEW"})

    assert plan.updates[0]["tracking_tier"] == "core"
    assert plan.inserts[0]["tracking_tier"] == "core"  # pinned via REFERENCE_EXTRA_CORE_TICKERS


def test_ticker_change_is_detected_through_isin():
    entries = _entries("TRALT")
    isin = entries[0].isin
    existing = {"KOZAL": state("KOZAL", isin=isin)}
    plan = plan_universe(entries, existing, now=NOW, core_set={"TRALT"}, sources_complete=True)

    assert plan.renamed == {"KOZAL": "TRALT"}
    assert plan.delisted == ["KOZAL"]


def test_non_equity_rows_are_left_alone():
    entries = _entries("AAA")
    existing = {"AAA": state("AAA"), "ALTIN": state("ALTIN", tier="universe")}
    plan = plan_universe(entries, existing, now=NOW, core_set={"AAA"}, sources_complete=True,
                         listed_elsewhere={"ALTIN"})

    assert plan.missing == [] and plan.delisted == []
