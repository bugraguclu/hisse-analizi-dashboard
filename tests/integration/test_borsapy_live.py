"""Integration tests: borsapy ile gercek veri cekme.
Bu testler network erisimi gerektirir, CI'da skip edilebilir.
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

    # The live quote and the latest daily candle must describe the same grain.
    fast_info = ticker.fast_info
    assert fast_info["last_price"] == pytest.approx(float(df.iloc[-1]["Close"]), rel=0.01)


@pytest.mark.integration
@pytest.mark.skipif(not HAS_NETWORK, reason="Network tests disabled")
def test_borsapy_companies():
    import borsapy as bp

    companies = bp.companies()
    assert companies is not None
    assert len(companies) > 700
    tickers = companies["ticker"].tolist()
    assert "THYAO" in tickers
