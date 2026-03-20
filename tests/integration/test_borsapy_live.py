"""Integration tests: borsapy ile gerçek veri çekme.
Bu testler network erişimi gerektirir, CI'da skip edilebilir.
"""
import os
import pytest

HAS_NETWORK = os.environ.get("SKIP_NETWORK_TESTS") != "1"


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_kap_news():
    import borsapy as bp

    ticker = bp.Ticker("THYAO")
    news = ticker.news
    assert news is not None
    assert len(news) > 0
    assert "Title" in news.columns
    assert "URL" in news.columns


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_price_data():
    import borsapy as bp

    ticker = bp.Ticker("THYAO")
    df = ticker.history(period="1ay")
    assert df is not None
    assert len(df) > 0
    assert "Close" in df.columns
    assert "Volume" in df.columns


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_companies():
    import borsapy as bp

    companies = bp.companies()
    assert companies is not None
    assert len(companies) > 700
    # THYAO should be in the list
    tickers = companies["ticker"].tolist()
    assert "THYAO" in tickers


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_anadoluefes_news_page():
    import httpx

    resp = httpx.get(
        "https://www.anadoluefes.com/haber-liste/247",
        headers={"User-Agent": "FinancialAssistant/1.0"},
        follow_redirects=True,
        timeout=30,
    )
    assert resp.status_code == 200
    assert len(resp.text) > 1000
