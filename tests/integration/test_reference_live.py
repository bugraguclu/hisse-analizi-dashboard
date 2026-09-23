"""Integration: live universe sources (TradingView, Borsa İstanbul, KAP) and cross-source sanity.

Network required; skipped with SKIP_NETWORK_TESTS=1.
"""

import os

import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"

pytestmark = [pytest.mark.integration, pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")]


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    from src.adapters import utils

    utils.adapter_cache.clear()
    monkeypatch.setattr(utils, "_http_client", None)  # the shared client is loop-bound
    yield
    utils.adapter_cache.clear()


async def test_universe_sources_agree_on_xu100():
    from src.adapters.bist_reference import build_universe, fetch_universe_sources

    sources = await fetch_universe_sources()
    assert not sources.errors, sources.errors
    assert sources.index_file is not None and sources.tradingview is not None

    csv_core = sources.index_file.members("XU100")
    tv_core = {t for t, s in sources.tradingview.items() if "XU100" in s.index_codes}
    assert len(csv_core) == 100
    assert len(csv_core ^ tv_core) <= 2  # official file vs TradingView membership

    entries, _ = build_universe(sources)
    assert len(entries) >= 500
    by = {e.ticker: e for e in entries}
    assert by["THYAO"].isin == "TRATHYAO91M5" and by["THYAO"].kap_member_oid
    assert by["GARAN"].sector == "BANKALAR" and by["GARAN"].market_segment == "YILDIZ PAZAR"


async def test_kap_general_page_free_float_matches_isyatirim():
    from src.adapters.bist_reference import fetch_kap_general, resolve_member_oid
    from src.adapters.price import get_company_metrics

    oid = await resolve_member_oid("GARAN")
    assert oid
    general = await fetch_kap_general(oid)
    kap = general.free_float["GARAN"].ratio_pct
    isy = (await get_company_metrics("GARAN"))["free_float"]
    assert kap is not None and isy is not None
    assert abs(kap - isy) <= 0.2  # İş Yatırım rounds MKK's ratio to one decimal
