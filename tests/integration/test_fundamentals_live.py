"""Live fundamentals sources (KAP financial summary + İş Yatırım MaliTablo) — 2 KAP requests.

Network tests: skipped with SKIP_NETWORK_TESTS=1. They check the provider facts the
store relies on: KAP-first facts with a consistent IAS 29 restatement factor for an
industrial reporter, and a detected solo/consolidated scope difference for a bank.
"""

import os

import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"

pytestmark = [pytest.mark.integration, pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")]


@pytest.fixture(autouse=True)
def _fresh_client(monkeypatch):
    from src.adapters import fundamentals_common, utils

    utils.adapter_cache.clear()
    monkeypatch.setattr(utils, "_http_client", None)  # the shared client is loop-bound
    monkeypatch.setattr(fundamentals_common, "kap_gate", fundamentals_common._KapGate())
    yield
    utils.adapter_cache.clear()


async def test_industrial_facts_are_kap_first_with_a_consistent_restatement_factor():
    from src.adapters import fundamentals_statements as fs
    from src.services.fundamentals_service import fetch_sources

    kap, isy, kap_error, isy_error = await fetch_sources("THYAO")

    assert kap is not None, kap_error
    assert isy is not None, isy_error
    facts = fs.facts_from_sources(kap, isy)
    assert facts.isyatirim_scope == "match"
    latest = kap["periods"][0]
    total_assets = next(r for r in kap["balance_sheet"] if r["Item"] == "Toplam Varlıklar")
    assert facts.items[latest]["total_assets"] == total_assets[latest]  # KAP, as first published
    # Every re-expressed year end uses one factor per period (a CPI ratio).
    for period, factor in facts.restated_periods.items():
        assert 0.3 < factor < 1.0, period
        assert facts.factors[period]["flow"] == pytest.approx(factor, rel=0.01)
    rows = fs.kap_statement_rows(kap) + fs.isyatirim_statement_rows(isy, ticker="THYAO")
    rebuilt = fs.build_statement_view(
        "THYAO", fs.kap_summary_from_rows(rows), fs.isyatirim_table_from_rows(rows), quarterly=True, section="balance"
    )
    assert rebuilt == fs.build_statement_view("THYAO", kap, isy, quarterly=True, section="balance")


async def test_bank_solo_statements_are_not_mixed_into_kap_facts():
    from src.adapters import fundamentals_statements as fs
    from src.services.fundamentals_service import fetch_sources

    kap, isy, kap_error, _ = await fetch_sources("GARAN")

    assert kap is not None, kap_error
    facts = fs.facts_from_sources(kap, isy)
    assert facts.template == "bank"
    if isy is not None:
        assert facts.isyatirim_scope == "mismatch"
        assert set(facts.items) <= set(kap["periods"])
