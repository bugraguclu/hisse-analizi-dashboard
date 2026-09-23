"""Store-first reference reads (§4.1): store hit / live miss + write / stale fallback / error contract.

Providers are monkeypatched (no network); the store is a real PostgreSQL schema (pg_session).
"""

from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import select, update
from sqlalchemy.exc import OperationalError

from src.adapters import fundamentals_reference as fr
from src.adapters.bist_reference import ExpectedDisclosureRecord
from src.adapters.utils import MarketDataError, SymbolNotFoundError
from src.core.time import utcnow
from src.db.models import AnalystTarget, CapitalIncrease, Company, Dividend, IngestionRun, Shareholder
from src.services import reference_service as svc

BUNDLE = fr.SermayeBundle(
    dividends=[
        fr.DividendRecord(date(2025, 9, 2), Decimal("344.2000"), Decimal("292.5700"), Decimal("4750000000.00")),
        fr.DividendRecord(date(2025, 6, 16), Decimal("344.2000"), Decimal("292.5700"), Decimal("4750000000.00")),
    ],
    capital_increases=[
        fr.CapitalIncreaseRecord(date(1998, 1, 23), "rights_bonus", Decimal("100"), Decimal("100"), None,
                                 Decimal("10000000"), Decimal("30000000")),
    ],
    recommendation=fr.RecommendationRecord("AL", Decimal("455.0009"), Decimal("52.6849"), date(2026, 4, 24)),
)


class Calls:
    def __init__(self):
        self.count = 0


@pytest.fixture
def providers(monkeypatch):
    """Healthy providers by default; tests swap in failures."""
    calls = Calls()

    async def sermaye(ticker):
        calls.count += 1
        return BUNDLE

    async def fail(*args, **kwargs):
        calls.count += 1
        raise MarketDataError("Veri sağlayıcısına şu anda ulaşılamıyor", status_code=503)

    async def listed(ticker):
        return None

    monkeypatch.setattr(svc, "fetch_sermaye", sermaye)
    monkeypatch.setattr(svc, "_require_listed", listed)
    calls.fail = fail
    return calls


async def company(session, ticker="THYAO", **kwargs):
    row = Company(ticker=ticker, legal_name=f"{ticker} A.O.", display_name=ticker, tracking_tier="core", **kwargs)
    session.add(row)
    await session.commit()
    return row


async def test_dividends_live_then_store_then_stale(pg_session, providers, monkeypatch):
    await company(pg_session)

    live, meta = await svc.get_dividends(pg_session, "THYAO")
    assert meta.served_from == "live" and providers.count == 1
    assert list(live) == ["ticker", "source", "dividends", "available"]
    assert live["dividends"][0] == {"Date": "2025-09-02T00:00:00", "Amount": 3.442, "GrossRate": 344.2,
                                    "NetRate": 292.57, "TotalDividend": 4750000000.0}
    assert len((await pg_session.execute(select(Dividend))).scalars().all()) == 2
    assert len((await pg_session.execute(select(CapitalIncrease))).scalars().all()) == 1  # same call, stored too

    monkeypatch.setattr(svc, "fetch_sermaye", providers.fail)
    stored, meta = await svc.get_dividends(pg_session, "THYAO")
    assert meta.served_from == "store" and not meta.stale and providers.count == 1  # provider not called
    assert stored == live  # identical body from the store

    await pg_session.execute(update(Dividend).values(fetched_at=utcnow() - timedelta(days=3)))
    await pg_session.commit()
    stale, meta = await svc.get_dividends(pg_session, "THYAO")
    assert meta.served_from == "stale" and meta.stale and meta.notes == [svc.NOTE_STALE]
    assert stale == live and providers.count == 2


async def test_live_failure_without_store_keeps_the_error_contract(pg_session, providers, monkeypatch):
    await company(pg_session)
    monkeypatch.setattr(svc, "fetch_sermaye", providers.fail)

    with pytest.raises(MarketDataError) as info:
        await svc.get_dividends(pg_session, "THYAO")
    assert info.value.status_code == 503


async def test_unknown_ticker_is_404_and_nothing_is_stored(pg_session, providers, monkeypatch):
    async def not_listed(ticker):
        raise SymbolNotFoundError(ticker)

    monkeypatch.setattr(svc, "_require_listed", not_listed)
    with pytest.raises(MarketDataError) as info:
        await svc.get_dividends(pg_session, "NOPE")
    assert info.value.status_code == 404 and providers.count == 0


async def test_empty_dataset_is_fresh_after_a_successful_refresh(pg_session, providers, monkeypatch):
    await company(pg_session)
    pg_session.add(IngestionRun(job="reference.company", scope="THYAO", status="ok", finished_at=utcnow(),
                                details_json={"datasets": {"sermaye": {"ok": True, "dividends": 0}}}))
    await pg_session.commit()
    monkeypatch.setattr(svc, "fetch_sermaye", providers.fail)

    body, meta = await svc.get_dividends(pg_session, "THYAO")

    assert meta.served_from == "store" and body["dividends"] == [] and body["available"] is True
    rec, meta = await svc.get_recommendations(pg_session, "THYAO")  # no İş Yatırım call either
    assert meta.served_from == "store" and rec["available"] is False and providers.count == 0


async def test_recommendations_from_store(pg_session, providers, monkeypatch):
    await company(pg_session)
    await svc.get_dividends(pg_session, "THYAO")  # one İş Yatırım call stores all three datasets
    monkeypatch.setattr(svc, "fetch_sermaye", providers.fail)

    body, meta = await svc.get_recommendations(pg_session, "THYAO")

    assert meta.served_from == "store" and meta.as_of == "2026-04-24"
    assert body == {"ticker": "THYAO", "source": "İş Yatırım (borsapy)", "source_code": "isyatirim",
                    "recommendations": {"recommendation": "AL", "target_price": 455.0, "upside_potential": 52.68,
                                        "date": "2026-04-24"},
                    "available": True}
    target = (await pg_session.execute(select(AnalystTarget))).scalar_one()
    assert (target.source, target.target_mean, target.recommendation) == ("isyatirim", Decimal("455.0009"), "AL")


async def test_holders_keep_provider_order_and_replace_wholesale(pg_session, providers, monkeypatch):
    await company(pg_session)
    first = [fr.HolderRecord("Diğer", Decimal("50.88")), fr.HolderRecord("Türkiye Varlık Fonu", Decimal("49.12"))]

    async def holders(ticker):
        return first

    monkeypatch.setattr(svc, "fetch_holders", holders)
    live, meta = await svc.get_holders(pg_session, "THYAO")
    assert meta.served_from == "live"

    monkeypatch.setattr(svc, "fetch_holders", providers.fail)
    stored, meta = await svc.get_holders(pg_session, "THYAO")
    assert meta.served_from == "store" and stored == live
    assert [h["Holder"] for h in stored["holders"]] == ["Diğer", "Türkiye Varlık Fonu"]

    company_id = (await pg_session.execute(select(Company.id))).scalar_one()
    repo = svc.ReferenceRepository(pg_session)
    await repo.replace_shareholders(company_id, "isyatirim", [fr.HolderRecord("Tek Ortak", Decimal("100"))], utcnow())
    await pg_session.commit()
    names = (await pg_session.execute(select(Shareholder.holder_name))).scalars().all()
    assert names == ["Tek Ortak"]


async def test_price_targets_store_uses_the_live_price(pg_session, providers, monkeypatch):
    await company(pg_session)
    record = fr.PriceTargetRecord(Decimal("330"), Decimal("580"), Decimal("451.37"), 20)

    async def targets(ticker):
        return record

    async def price(ticker):
        return 300.0

    monkeypatch.setattr(svc, "fetch_price_targets", targets)
    monkeypatch.setattr(svc, "current_price", price)
    live, meta = await svc.get_price_targets(pg_session, "THYAO")
    assert meta.served_from == "live" and meta.source == "hedeffiyat"

    async def new_price(ticker):
        return 310.5

    monkeypatch.setattr(svc, "fetch_price_targets", providers.fail)
    monkeypatch.setattr(svc, "current_price", new_price)
    stored, meta = await svc.get_price_targets(pg_session, "THYAO")
    assert meta.served_from == "store"
    assert stored["targets"] == {**live["targets"], "current": 310.5}
    row = (await pg_session.execute(select(AnalystTarget))).scalar_one()
    assert row.target_median is None and row.upside_pct == Decimal("50.4567")  # no fabricated median in the store


async def test_empty_consensus_never_overwrites_a_stored_one(pg_session, providers, monkeypatch):
    await company(pg_session)

    async def targets(ticker):
        return fr.PriceTargetRecord(Decimal("330"), Decimal("580"), Decimal("451.37"), 20)

    async def nothing(ticker):
        return None

    async def price(ticker):
        return 300.0

    monkeypatch.setattr(svc, "current_price", price)
    monkeypatch.setattr(svc, "fetch_price_targets", targets)
    await svc.get_price_targets(pg_session, "THYAO")
    await pg_session.execute(update(AnalystTarget).values(fetched_at=utcnow() - timedelta(days=2)))
    await pg_session.commit()
    monkeypatch.setattr(svc, "fetch_price_targets", nothing)

    body, meta = await svc.get_price_targets(pg_session, "THYAO")

    assert meta.served_from == "stale" and meta.notes == [svc.NOTE_EMPTY_PROVIDER]
    assert body["targets"]["mean"] == 451.37 and body["available"] is True


async def test_earnings_dates_live_store_and_soft_failure(pg_session, providers, monkeypatch):
    await company(pg_session, kap_member_oid="oid-thy")
    records = [
        ExpectedDisclosureRecord("Finansal Rapor", "9 Aylık", 2026, date(2026, 10, 1), date(2026, 11, 9), "r1", "t1"),
        ExpectedDisclosureRecord("Faaliyet Raporu (Konsolide)", "9 Aylık", 2026, date(2026, 10, 1),
                                 date(2026, 11, 9), "r1", "t2"),
    ]

    async def expected(oid, today):
        assert oid == "oid-thy"
        return records

    monkeypatch.setattr(svc, "fetch_expected_disclosures", expected)
    monkeypatch.setattr(svc, "_today", lambda: date(2026, 9, 23))
    live, meta = await svc.get_earnings_dates(pg_session, "THYAO")
    assert meta.served_from == "live" and meta.source_url.endswith("/ozet/oid-thy")
    assert live["earnings_dates"] == [{"Earnings Date": "2026-11-09T00:00:00", "EPS Estimate": None,
                                       "Reported EPS": None, "Surprise(%)": None}]

    monkeypatch.setattr(svc, "fetch_expected_disclosures", providers.fail)
    stored, meta = await svc.get_earnings_dates(pg_session, "THYAO")
    assert meta.served_from == "store" and stored == live

    # A company without stored windows: an unreachable KAP is "no data", not an error (legacy contract).
    await company(pg_session, "ASELS", kap_member_oid="oid-asels")
    body, meta = await svc.get_earnings_dates(pg_session, "ASELS")
    assert body["earnings_dates"] == [] and body["available"] is False and meta.notes == [svc.NOTE_UNAVAILABLE]


class BrokenSession:
    """A session whose database is gone: every statement fails."""

    async def execute(self, *args, **kwargs):
        raise OperationalError("SELECT 1", {}, ConnectionRefusedError("db down"))

    async def commit(self):
        raise AssertionError("nothing to commit")

    async def rollback(self):
        return None


async def test_database_outage_degrades_to_live(providers):
    body, meta = await svc.get_dividends(BrokenSession(), "THYAO")  # type: ignore[arg-type]

    assert meta.served_from == "live" and body["dividends"][0]["GrossRate"] == 344.2
