"""Fundamentals store against real PostgreSQL (ON CONFLICT, NUMERIC, JSONB) via ``pg_session``."""

import copy
import uuid
from contextlib import asynccontextmanager
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from src.adapters import fundamentals_statements as fs
from src.db.models import Company, DataQualityCheck, FinancialFact, FinancialRatio, FinancialStatement
from src.db.repositories.fundamentals import FundamentalsRepository
from src.services import fundamentals_service as svc
from src.services.analysis_service import MarketInputs

KAP = {
    "periods": ["2026/06", "2025/12", "2024/12"],
    "fiscal_year_end_month": 12,
    "template": "industrial",
    "unit": "TRY",
    "source_url": "https://www.kap.org.tr/tr/sirket-finansal-bilgileri/1107-turk-hava-yollari-a-o",
    "balance_sheet": [
        {"Item": "Dönen Varlıklar", "2026/06": 512_191e6, "2025/12": 436_412e6, "2024/12": 341_910e6},
        {"Item": "Toplam Varlıklar", "2026/06": 2_360_037e6, "2025/12": 1_996_745e6, "2024/12": 1_399_606e6},
        {"Item": "Kısa Vadeli Yükümlülükler", "2026/06": 566_751e6, "2025/12": 442_076e6, "2024/12": 339_533e6},
        {"Item": "Toplam Yükümlülükler", "2026/06": 1_341_584e6, "2025/12": 1_085_489e6, "2024/12": 719_594e6},
        {"Item": "Ana Ortaklığa Ait Özkaynaklar", "2026/06": 1_018_517e6, "2025/12": 911_222e6, "2024/12": 679_887e6},
        {"Item": "Ödenmiş Sermaye", "2026/06": 1_380e6, "2025/12": 1_380e6, "2024/12": 1_380e6},
        {"Item": "Toplam Özkaynaklar", "2026/06": 1_018_453e6, "2025/12": 911_256e6, "2024/12": 680_012e6},
    ],
    "income_statement": [
        {"Item": "Hasılat", "2026/06": 585_069e6, "2025/12": 955_472e6, "2024/12": 745_430e6},
        {"Item": "Brüt Kâr (Zarar)", "2026/06": 42_587e6, "2025/12": 155_560e6, "2024/12": 142_908e6},
        {"Item": "Esas Faaliyet Kârı (Zararı)", "2026/06": -5_098e6, "2025/12": 90_129e6, "2024/12": 80_393e6},
        {"Item": "Net Dönem Kârı (Zararı)", "2026/06": 18_766e6, "2025/12": 118_117e6, "2024/12": 113_357e6},
        {"Item": "Dönem Kârının (Zararının) Dağılımı, Ana Ortaklık Payları",
         "2026/06": 18_864e6, "2025/12": 118_208e6, "2024/12": 113_378e6},
    ],
    "period_info": {
        section: {p: {"presentation_unit": "1000000TL", "multiplier": 1e6, "currency": "TRY", "consolidation": "Konsolide"}
                  for p in ("2024/12", "2025/12", "2026/06")}
        for section in ("balance", "income")
    },
}
F25, F24 = 0.8491958, 0.7639867


def _isy_values(values_2606, values_2512, values_2506, values_2412):
    return {"2026/06": values_2606, "2025/12": values_2512, "2025/06": values_2506, "2024/12": values_2412}


ISY = {
    "group": "XI_29",
    "template": "industrial",
    "periods": ["2026/06", "2025/12", "2025/06", "2024/12"],
    "items": [
        {"code": "1A", "label": "Dönen Varlıklar", "statement": "balance",
         "values": _isy_values(512_191e6, 436_412e6 / F25, 400_000e6, 341_910e6 / F24)},
        {"code": "1AA", "label": "Nakit ve Nakit Benzerleri", "statement": "balance",
         "values": _isy_values(80_346e6, 86_035e6 / F25, 98_791e6, 95_992e6 / F24)},
        {"code": "1BL", "label": "TOPLAM VARLIKLAR", "statement": "balance",
         "values": _isy_values(2_360_037e6, 1_996_745e6 / F25, 1_652_589e6, 1_399_606e6 / F24)},
        {"code": "2A", "label": "Kısa Vadeli Yükümlülükler", "statement": "balance",
         "values": _isy_values(566_751e6, 442_076e6 / F25, 500_000e6, 339_533e6 / F24)},
        {"code": "2AA", "label": "Finansal Borçlar (Kısa Vadeli Yükümlülükler)", "statement": "balance",
         "values": _isy_values(187_257e6, 162_000e6 / F25, 150_000e6, 130_000e6 / F24)},
        {"code": "2N", "label": "Özkaynaklar", "statement": "balance",
         "values": _isy_values(1_018_453e6, 911_256e6 / F25, 752_120e6, 680_012e6 / F24)},
        {"code": "2O", "label": "Ana Ortaklığa Ait Özkaynaklar", "statement": "balance",
         "values": _isy_values(1_018_517e6, 911_222e6 / F25, 752_073e6, 679_887e6 / F24)},
        {"code": "2OA", "label": "Ödenmiş Sermaye", "statement": "balance",
         "values": _isy_values(1_380e6, 1_380e6, 1_380e6, 1_380e6)},
        {"code": "3C", "label": "Satış Gelirleri", "statement": "income",
         "values": _isy_values(585_069e6, 955_472e6 / F25, 408_036e6, 745_430e6 / F24)},
        {"code": "3D", "label": "BRÜT KAR (ZARAR)", "statement": "income",
         "values": _isy_values(42_587e6, 155_560e6 / F25, 56_146e6, 142_908e6 / F24)},
        {"code": "3DF", "label": "FAALİYET KARI (ZARARI)", "statement": "income",
         "values": _isy_values(-5_098e6, 90_129e6 / F25, 24_529e6, 80_393e6 / F24)},
        {"code": "3L", "label": "DÖNEM KARI (ZARARI)", "statement": "income",
         "values": _isy_values(18_766e6, 118_117e6 / F25, 24_935e6, 113_357e6 / F24)},
        {"code": "3Z", "label": "Ana Ortaklık Payları", "statement": "income",
         "values": _isy_values(18_864e6, 118_208e6 / F25, 25_013e6, 113_378e6 / F24)},
        {"code": "4CAB", "label": "Amortisman & İtfa Payları", "statement": "cashflow",
         "values": _isy_values(58_665e6, 111_496e6, 42_953e6, 94_643e6)},
    ],
}


@pytest.fixture
async def company(pg_session):
    row = Company(id=uuid.uuid4(), ticker="THYAO", legal_name="TÜRK HAVA YOLLARI A.O.", display_name="THY",
                  tracking_tier="core")
    pg_session.add(row)
    await pg_session.commit()
    return row


async def _count(session, model, *where):
    return (await session.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_statement_upsert_skips_unchanged_content(pg_session, company):
    first = await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()

    # KAP: 3 periods × 2 statements; İş Yatırım: 4 periods × 3 statements.
    assert (first.statements.inserted, first.statements.updated, first.statements.unchanged) == (18, 0, 0)
    assert await _count(pg_session, FinancialStatement) == 18

    second = await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()
    assert (second.statements.inserted, second.statements.updated, second.statements.unchanged) == (0, 0, 18)

    changed_isy = copy.deepcopy(ISY)
    changed_isy["items"][-1]["values"]["2026/06"] = 58_700e6  # D&A revised by the provider
    third = await svc.persist_refresh(pg_session, company, kap=KAP, isy=changed_isy)
    await pg_session.commit()
    assert (third.statements.inserted, third.statements.updated) == (0, 1)


async def test_restated_rows_facts_company_columns_and_manifest(pg_session, company):
    result = await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()
    repo = FundamentalsRepository(pg_session)

    rows = {(r.source, r.period, r.statement_type): r for r in await repo.statement_rows(company.id)}
    restated = rows[("isyatirim", "2025/12", "balance_sheet")]
    assert restated.restated is True
    assert restated.restatement_factor == Decimal("0.849196")
    assert rows[("isyatirim", "2026/06", "balance_sheet")].restated is False
    assert rows[("isyatirim", "2026/06", "balance_sheet")].consolidation == "Konsolide"
    assert rows[("kap", "2025/12", "balance_sheet")].presentation_unit == "1000000TL"
    assert rows[("kap", "2025/12", "income_stmt")].data_json["Hasılat"] == 955_472e6  # legacy {label: value} view

    facts = {f.period: f for f in await repo.facts(company.id)}
    assert result.facts == len(facts) == 4  # 2026/06, 2025/12, 2025/06 (İşY interim), 2024/12
    fy = facts["2025/12"]
    assert fy.total_assets == Decimal("1996745000000.00")  # first published (KAP)
    assert fy.depreciation_amortization == Decimal("94682000000.00")  # İşY × 0.849196, rounded to the KAP unit
    assert fy.months == 12 and fy.sources_json["keys"]["total_assets"] == "kap"
    assert facts["2025/06"].months == 6 and facts["2025/06"].revenue == Decimal("408036000000.00")

    await pg_session.refresh(company)
    assert company.fiscal_year_end_month == 12
    assert company.statement_template == "industrial"
    assert company.paid_in_capital == Decimal("1380000000.00")

    manifest = svc.Manifest.from_row("THYAO", (await repo.manifests(["THYAO"]))["THYAO"])
    assert manifest.periods("kap") == KAP["periods"]
    assert manifest.periods("isyatirim") == ISY["periods"]
    assert manifest.refreshed_at is not None and manifest.last_attempt_ok is True
    checks = await _count(pg_session, DataQualityCheck, DataQualityCheck.check_name.like("fundamentals.kap_vs_isy.%"))
    assert checks == 12  # 3 overlapping periods × 4 items
    statuses = (await pg_session.execute(select(DataQualityCheck.status).distinct())).scalars().all()
    assert set(statuses) == {"pass"}


async def test_store_rebuild_equals_the_fetched_payloads(pg_session, company):
    await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()
    repo = FundamentalsRepository(pg_session)
    rows = await repo.statement_rows(company.id)
    manifest = svc.Manifest.from_row("THYAO", (await repo.manifests(["THYAO"]))["THYAO"])
    state = svc.StoreState(ticker="THYAO", company=company, manifest=manifest, rows=rows)

    kap, isy = state.sources()

    for quarterly in (False, True):
        live = fs.build_statement_view("THYAO", KAP, ISY, quarterly=quarterly, section="income")
        stored = fs.build_statement_view("THYAO", kap, isy, quarterly=quarterly, section="income")
        assert stored == live


async def test_ratio_upsert_by_basis_and_valuation_on_the_latest_rows(pg_session, company):
    await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    market = MarketInputs(price=300.0, price_source="tradingview", total_shares=1_380e6, implied_shares=1_380e6)

    written = await svc.compute_company_ratios(pg_session, company, market, write_checks=True)
    await pg_session.commit()

    repo = FundamentalsRepository(pg_session)
    rows = {(r.period, r.basis): r for r in await repo.ratio_rows(company.id)}
    assert written == len(rows)
    assert {("2026/06", "ttm"), ("2025/12", "ttm"), ("2025/12", "annual"), ("2024/12", "annual")} <= set(rows)
    latest = rows[("2026/06", "ttm")]
    assert latest.ttm_quarters == ["2025/09", "2025/12", "2026/03", "2026/06"]
    assert latest.market_cap == Decimal("414000000000.00")
    assert latest.shares_outstanding == Decimal("1380000000") and latest.shares_source == "paid_in_capital"
    ttm_income = 18_864e6 + 118_208e6 - 25_013e6
    assert float(latest.pe_ratio) == pytest.approx(round(414e9 / ttm_income, 2))
    assert latest.inputs_json["flows"]["net_income_parent"] == pytest.approx(ttm_income)
    assert rows[("2025/12", "ttm")].market_cap is None
    assert rows[("2025/12", "annual")].market_cap is not None

    # Recompute without a price: same keys, valuation cleared, no duplicates.
    again = await svc.compute_company_ratios(pg_session, company, None)
    await pg_session.commit()
    assert again == written
    assert await _count(pg_session, FinancialRatio) == written
    refreshed = {(r.period, r.basis): r for r in await repo.ratio_rows(company.id)}
    await pg_session.refresh(refreshed[("2026/06", "ttm")])
    assert refreshed[("2026/06", "ttm")].market_cap is None
    shares_checks = await _count(pg_session, DataQualityCheck,
                                 DataQualityCheck.check_name == "fundamentals.shares.paid_in_capital_vs_tradingview")
    assert shares_checks == 1


async def test_statements_api_list_serves_fresh_store(pg_session, company):
    await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()

    rows, meta = await svc.statements_for_api(pg_session, company, statement_type="balance_sheet", source="kap")

    assert meta.served_from == "store" and meta.stale is False
    assert {r.period for r in rows} == {"2026/06", "2025/12", "2024/12"}
    assert all(r.source == "kap" and r.statement_type == "balance_sheet" for r in rows)
    assert meta.source_url == KAP["source_url"]


async def test_empty_facts_never_wipe_existing_rows(pg_session, company):
    await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()
    repo = FundamentalsRepository(pg_session)

    assert await repo.upsert_facts(company.id, {}, months={}, sources={}, template="industrial",
                                   fiscal_year_end_month=12) == 0
    assert await _count(pg_session, FinancialFact) == 4


@asynccontextmanager
async def _same_session(session):
    yield session


async def test_offline_rebuild_rederives_without_touching_fetch_times(pg_session, company):
    await svc.persist_refresh(pg_session, company, kap=KAP, isy=ISY)
    await pg_session.commit()
    repo = FundamentalsRepository(pg_session)
    company_id = company.id  # expire_all() below would expire ``company`` too
    before = {r.id: r.fetched_at for r in await repo.statement_rows(company_id)}

    result = await svc.rebuild_from_store(
        "THYAO",
        market=MarketInputs(price=300.0, implied_shares=1_380e6),
        session_factory=lambda: _same_session(pg_session),
    )

    assert result.ok and result.statements.unchanged == 18 and result.statements.changed == 0
    assert result.facts == 4 and result.ratios > 0
    pg_session.expire_all()
    after = {r.id: r.fetched_at for r in await repo.statement_rows(company_id)}
    assert after == before
    manifest = svc.Manifest.from_row("THYAO", (await repo.manifests(["THYAO"]))["THYAO"])
    assert manifest.payload.get("rebuilt_at") and manifest.periods("kap") == KAP["periods"]
