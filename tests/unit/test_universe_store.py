"""universe.sync write path against PostgreSQL (pg_session): column-wise company upsert,
index membership full replace, delisting. Skipped when the test database is unreachable."""

from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import select

from src.adapters import bist_reference as br
from src.db.models import Company, IndexMembership, MarketIndex
from src.services import universe_service
from src.services.universe_service import apply_universe

NOW = datetime(2026, 9, 23, 4, 30, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _small_universe_bounds(monkeypatch):
    # The production sanity bounds expect ~600 securities; the fixtures have a handful.
    monkeypatch.setattr(universe_service, "MIN_TRADINGVIEW_EQUITIES", 1)
    monkeypatch.setattr(universe_service, "MIN_INDEX_FILE_TICKERS", 1)
    monkeypatch.setattr(universe_service, "CORE_INDEX_BOUNDS", (1, 200))


def tv(ticker, isin, ff):
    return br.TvSecurity(ticker, f"{ticker} desc", isin, "Finans", "Büyük bankalar", "stock", "common", 1e9, ff, ())


def sources(pairs, tickers):
    index_file = br.IndexFile(
        as_of=date(2026, 9, 23),
        indices={code: br.IndexInfo(code, f"{code} TR", f"{code} EN") for code, _ in pairs},
        constituents=[br.IndexConstituent(code, t, f"{t} BULTEN") for code, t in pairs],
    )
    kap = br.KapDirectory(
        members={t: br.KapMember(t, f"oid-{t}", f"{t} RESMİ UNVAN A.Ş.") for t in tickers},
        sectors={t: br.KapSector(t, f"oid-{t}", "BANKALAR", None) for t in tickers},
        markets={t: "YILDIZ PAZAR" for t in tickers},
    )
    return br.UniverseSources(
        tradingview={t: tv(t, f"TRA{t}91N1", 14.03) for t in tickers}, index_file=index_file, kap=kap
    )


async def test_apply_universe_is_column_wise_and_replaces_memberships(pg_session):
    garan = Company(
        ticker="GARAN", legal_name="ESKİ UNVAN", display_name="Garanti BBVA", exchange="BIST",
        aliases=["GARAN", "Garanti BBVA"], tracking_tier="core",
        # WS3-owned columns: must survive the sync untouched
        fiscal_year_end_month=12, statement_template="bank", paid_in_capital=Decimal("4200000000.00"),
        free_float_pct=Decimal("13.98"), reference_updated_at=NOW,  # official (KAP) value already stored
    )
    kozal = Company(ticker="KOZAL", legal_name="KOZA ALTIN", display_name="Koza Altın", tracking_tier="core")
    pg_session.add_all([garan, kozal])
    await pg_session.commit()

    first = sources([("XU100", "GARAN"), ("XU100", "AKBNK"), ("XBANK", "GARAN")], ["GARAN", "AKBNK"])
    summary = await apply_universe(pg_session, first, now=NOW, extra_core=set())
    await pg_session.commit()

    assert summary["inserted"] == 1 and summary["delisted"] == ["KOZAL"] and summary["memberships"] == 3
    rows = {c.ticker: c for c in (await pg_session.execute(select(Company))).scalars()}
    for row in rows.values():
        await pg_session.refresh(row)
    g = rows["GARAN"]
    assert (g.fiscal_year_end_month, g.statement_template, g.paid_in_capital) == (12, "bank", Decimal("4200000000.00"))
    assert g.display_name == "Garanti BBVA" and g.aliases == ["GARAN", "Garanti BBVA"]
    assert g.legal_name == "GARAN RESMİ UNVAN A.Ş."
    assert g.free_float_pct == Decimal("13.98")  # not overwritten by TradingView's 14.03
    assert (g.isin, g.sector, g.industry, g.market_segment, g.kap_member_oid) == (
        "TRAGARAN91N1", "BANKALAR", "Büyük bankalar", "YILDIZ PAZAR", "oid-GARAN")
    assert g.tracking_tier == "core" and g.listing_status == "listed" and g.last_seen_at == NOW
    a = rows["AKBNK"]
    assert a.tracking_tier == "core" and a.security_type == "stock" and a.free_float_pct == Decimal("14.03")
    assert a.aliases == ["AKBNK", a.display_name]
    k = rows["KOZAL"]
    assert (k.listing_status, k.is_active, k.tracking_tier) == ("delisted", False, "universe")

    members = (await pg_session.execute(select(IndexMembership))).scalars().all()
    assert {(m.index_code, m.ticker) for m in members} == {("XU100", "GARAN"), ("XU100", "AKBNK"), ("XBANK", "GARAN")}
    assert all(m.company_id == rows[m.ticker].id and m.as_of == date(2026, 9, 23) for m in members)

    # Second sync: AKBNK left XU100, a new index appears → memberships fully replaced.
    second = sources([("XU100", "GARAN"), ("XU030", "GARAN")], ["GARAN", "AKBNK"])
    summary = await apply_universe(pg_session, second, now=NOW, extra_core=set())
    await pg_session.commit()

    assert summary["demoted"] == ["AKBNK"] and summary["inserted"] == 0
    members = (await pg_session.execute(select(IndexMembership.index_code, IndexMembership.ticker))).all()
    assert set(members) == {("XU100", "GARAN"), ("XU030", "GARAN")}
    codes = set((await pg_session.execute(select(MarketIndex.code))).scalars())
    assert codes == {"XU100", "XU030"}
    akbnk = (await pg_session.execute(select(Company).where(Company.ticker == "AKBNK"))).scalar_one()
    await pg_session.refresh(akbnk)
    assert akbnk.tracking_tier == "universe" and akbnk.is_active is True


async def test_apply_universe_without_index_file_keeps_tiers_and_memberships(pg_session):
    pg_session.add(Company(ticker="GARAN", legal_name="G", display_name="Garanti", tracking_tier="core"))
    await pg_session.commit()
    seeded = sources([("XU100", "GARAN")], ["GARAN"])
    await apply_universe(pg_session, seeded, now=NOW, extra_core=set())
    await pg_session.commit()

    degraded = br.UniverseSources(tradingview=seeded.tradingview, index_file=None, kap=None,
                                  errors={"index_file": "Borsa İstanbul endeks dosyasına ulaşılamadı"})
    summary = await apply_universe(pg_session, degraded, now=NOW, extra_core=set())
    await pg_session.commit()

    assert summary["memberships"] == 0 and summary["delisted"] == []
    assert any("Endeks üyelikleri güncellenmedi" in note for note in summary["notes"])
    garan = (await pg_session.execute(select(Company).where(Company.ticker == "GARAN"))).scalar_one()
    await pg_session.refresh(garan)
    assert garan.tracking_tier == "core" and garan.sector == "BANKALAR"  # KAP down: sector kept
    assert len((await pg_session.execute(select(IndexMembership))).scalars().all()) == 1  # previous copy kept
