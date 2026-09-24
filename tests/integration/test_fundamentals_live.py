"""Live fundamentals sources (KAP financial summary + İş Yatırım MaliTablo) — 4 KAP requests.

Network tests: skipped with SKIP_NETWORK_TESTS=1. They check the provider facts the
store relies on: KAP-first facts with a consistent IAS 29 restatement factor for an
industrial reporter, İş Yatırım's re-expressed interim comparatives converted back to
the first-published figures, and a detected solo/consolidated scope difference for a bank.
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
    # Every re-expressed year end uses one factor per period (a CPI ratio); THYAO's
    # interim comparatives are not re-expressed (USD functional currency).
    for period, factor in facts.restated_periods.items():
        assert 0.3 < factor < 1.0, period
        assert period in facts.factors, period
        assert facts.factors[period]["flow"] == pytest.approx(factor, rel=0.01)
    rows = fs.kap_statement_rows(kap) + fs.isyatirim_statement_rows(isy, ticker="THYAO")
    rebuilt = fs.build_statement_view(
        "THYAO", fs.kap_summary_from_rows(rows), fs.isyatirim_table_from_rows(rows), quarterly=True, section="balance"
    )
    assert rebuilt == fs.build_statement_view("THYAO", kap, isy, quarterly=True, section="balance")


async def test_reexpressed_interim_comparative_is_converted_to_first_published():
    from src.adapters import fundamentals_statements as fs
    from src.services.fundamentals_service import fetch_sources

    kap, isy, kap_error, isy_error = await fetch_sources("BIMAS")

    assert kap is not None, kap_error
    assert isy is not None, isy_error
    facts = fs.facts_from_sources(kap, isy)
    column = facts.columns["2025/06"]  # the 2026/06 report's comparative
    assert column.method in ("own_ratio", "own_ratio_unconfirmed") and 0.5 < (column.flow or 0) < 0.9
    # KAP disclosure 1478794 (first published 14 Aug 2025): revenue 309,834,891 thousand TL.
    assert facts.items["2025/06"]["revenue"] == pytest.approx(309_834_891_000.0, rel=1e-5)
    assert "2025/06" in facts.statement_restatements()


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
