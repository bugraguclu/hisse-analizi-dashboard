"""Screener universe (/market/screener/universe): row mapping, source merging and degradation."""

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.adapters import screener_universe
from src.adapters.screener_universe import _labels, _sma_cross, build_row
from src.adapters.utils import MarketDataError, adapter_cache
from src.api import routers_market


@pytest.fixture(autouse=True)
def _clear_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


THYAO_MARKET = {
    "close": 298.0, "change": 1.5302, "Value.Traded": 16216942460.4, "average_volume_30d_calc": 47_561_192.1,
    "market_cap_basic": 405_030_000_000.2, "description": "TURK HAVA YOLLARI", "sector": "Transportation",
    "sector.tr": "Taşımacılık", "industry": "Airlines", "industry.tr": "Havayolları",
    "price_earnings_ttm": 3.6512, "earnings_per_share_basic_ttm": 81.6, "price_book_fq": 0.4011,
    "enterprise_value_ebitda_ttm": 7.091, "dividends_yield_current": 2.3456, "dividends_yield": 0.0,
    "return_on_equity": 12.664, "net_margin": 9.891, "RSI": 50.234, "SMA50": 305.67, "SMA200": 303.8,
    "SMA50[1]": 306.1, "SMA200[1]": 303.7, "Recommend.All": -0.11212, "relative_volume_10d_calc": 1.104,
    "price_52_week_high": 355.5, "price_52_week_low": 258.25, "Perf.W": 0.7612, "Perf.1M": -1.32,
    "Perf.3M": -8.38, "Perf.YTD": 9.96, "Perf.Y": -9.01,
}


def test_row_maps_units_rounds_and_derives_distances():
    row = build_row(
        {"symbol": "thyao", "name": "Türk Hava Yolları", "criteria_8": 405_030.0},
        THYAO_MARKET,
        {"recommendation": "AL", "target_price": 455.0, "foreign_ratio": 22.951},
        ["XU030", "XU100"],
    )

    assert row == {
        "symbol": "THYAO",
        "name": "Türk Hava Yolları",
        "sector": "Transportation",
        "industry": "Airlines",
        "indices": ["XU030", "XU100"],
        "close": 298.0,
        "change_pct": 1.53,
        "turnover": 16216942460,
        "avg_turnover": round(47_561_192.1 * 298.0),
        "market_cap": 405_030_000_000,
        "pe": 3.65,
        "pb": 0.4,
        "ev_ebitda": 7.09,
        "dividend_yield": 2.35,
        "roe": 12.66,
        "net_margin": 9.89,
        "rsi": 50.2,
        "sma50_dist": round((298.0 / 305.67 - 1) * 100, 2),
        "sma200_dist": round((298.0 / 303.8 - 1) * 100, 2),
        "tech_rating": -0.112,
        "rel_volume": 1.1,
        "high_52w_dist": round((298.0 / 355.5 - 1) * 100, 2),
        "low_52w_dist": round((298.0 / 258.25 - 1) * 100, 2),
        "perf_1w": 0.76,
        "perf_1m": -1.32,
        "perf_3m": -8.38,
        "perf_ytd": 9.96,
        "perf_1y": -9.01,
        "recommendation": "AL",
        "target_price": 455.0,
        "upside": round((455.0 / 298.0 - 1) * 100, 2),
        "foreign_ratio": 22.95,
    }


def test_row_omits_missing_values_and_flags_loss_makers():
    row = build_row(
        {"symbol": "EGEEN", "name": "", "criteria_8": 14_844.4},
        {"close": 5155.0, "change": 9.39, "description": "EGE ENDÜSTRİ VE TİCARET A.Ş.",
         "price_earnings_ttm": None, "earnings_per_share_basic_ttm": -12.5, "price_book_fq": -0.5,
         "enterprise_value_ebitda_ttm": -3.1, "dividends_yield_current": None, "dividends_yield": 1.12,
         "SMA50": None, "SMA200": 0},
        {},
        [],
    )

    # Negative EPS: P/E is undefined (flagged), not "missing"; negative P/B and
    # EV/EBITDA are not meaningful multiples; TradingView's legal name fills an
    # empty İş Yatırım name; the market cap falls back to İş Yatırım (million TL).
    assert row == {
        "symbol": "EGEEN",
        "name": "EGE ENDÜSTRİ VE TİCARET A.Ş.",
        "close": 5155.0,
        "change_pct": 9.39,
        "market_cap": 14_844_400_000,
        "loss": True,
        "dividend_yield": 1.12,
    }


def test_row_without_a_quote_has_no_change_or_derived_price_fields():
    row = build_row({"symbol": "NEWCO", "name": "Yeni Şirket"}, {"change": 0.0, "SMA50": 10.0}, {"target_price": 20.0}, [])

    assert row == {"symbol": "NEWCO", "name": "Yeni Şirket", "target_price": 20.0}


@pytest.mark.parametrize(
    ("sma50", "sma200", "prev50", "prev200", "expected"),
    [
        (101.0, 100.0, 99.0, 100.0, "golden"),
        (101.0, 100.0, 100.0, 100.0, "golden"),  # touching the day before still counts
        (99.0, 100.0, 101.0, 100.0, "death"),
        (99.0, 100.0, 100.0, 100.0, "death"),
        (102.0, 100.0, 101.0, 100.0, None),  # already above
        (98.0, 100.0, 99.0, 100.0, None),  # already below
        (100.0, 100.0, 100.0, 100.0, None),
        (101.0, None, 99.0, 100.0, None),
    ],
)
def test_sma_cross_detects_only_the_latest_bar(sma50, sma200, prev50, prev200, expected):
    market = {"SMA50": sma50, "SMA200": sma200, "SMA50[1]": prev50, "SMA200[1]": prev200}
    assert _sma_cross(market) == expected


def test_turkish_labels_are_sentence_case():
    market = {
        "A": {"sector": "Utilities", "sector.tr": "Elektrik, Su, Gaz Hizmetleri"},
        "B": {"sector": "Transportation", "sector.tr": "Hava Kargo/Taşıyıcılar"},
        "C": {"sector": "Consumer Durables", "sector.tr": "Ev İnşaası"},
        "D": {"sector": "Technology Services", "sector.tr": "Bilgi Teknolojisi (BT)"},
        "E": {"sector": "Miscellaneous", "sector.tr": "Çeşitli Hizmetler"},
        "F": {"sector": "Finance", "sector.tr": ""},
        "G": {"sector": "Finance", "sector.tr": "Finans"},
        "H": {"sector": "Health Services"},
    }

    assert _labels(market, "sector") == {
        "Utilities": "Elektrik, su, gaz hizmetleri",
        "Transportation": "Hava kargo/taşıyıcılar",
        "Consumer Durables": "Ev inşaası",
        "Technology Services": "Bilgi teknolojisi (BT)",
        "Miscellaneous": "Çeşitli",
        "Finance": "Finans",  # any row with a Turkish label beats one without
        "Health Services": "Health Services",
    }


def test_all_stock_queries_use_the_market_cap_criterion(monkeypatch):
    import borsapy.screener

    calls: list[tuple] = []

    class FakeScreener:
        def add_filter(self, criteria, min=None, max=None):
            calls.append(("filter", criteria, min, max))
            return self

        def set_recommendation(self, recommendation):
            calls.append(("recommendation", recommendation))
            return self

        def run(self):
            return pd.DataFrame([{"symbol": "THYAO", "name": "THY", "criteria_51": 455.0}])

    monkeypatch.setattr(borsapy.screener, "Screener", FakeScreener)

    screener_universe._isy_screen_sync(None, "AL")
    screener_universe._isy_screen_sync("target_price")

    # The price criterion would drop every stock priced at 1,000 TL or more.
    assert calls == [
        ("filter", "market_cap", 0, 1_000_000_000),
        ("recommendation", "AL"),
        ("filter", "target_price", -1_000_000_000, 1_000_000_000),
    ]


# ---------------------------------------------------------------------------
# get_screener_universe: merging and degradation
# ---------------------------------------------------------------------------

COMPANIES = [
    {"symbol": "THYAO", "name": "Türk Hava Yolları", "criteria_8": 405_030.0},
    {"symbol": "ISKUR", "name": "", "criteria_8": 366_542.7},
    {"symbol": "GSRAY", "name": "Galatasaray", "criteria_8": 12_285.0},
    {"symbol": "thyao", "name": "duplicate", "criteria_8": 1.0},
]
MARKET = {
    "THYAO": {"close": 298.0, "change": 1.53, "sector": "Transportation", "sector.tr": "Taşımacılık",
              "industry": "Airlines", "industry.tr": "Havayolları"},
    "GSRAY": {"close": 0.91, "change": 0.0, "sector": "Consumer Services", "sector.tr": "Tüketici hizmetleri",
              "industry": "Movies/Entertainment", "industry.tr": "Filmler/Eğlence"},
}


@pytest.fixture
def sources(monkeypatch):
    state: dict = {
        "companies": {"count": len(COMPANIES), "companies": COMPANIES},
        "market": MARKET,
        "criteria": {"target_price": {"THYAO": 455.0}, "foreign_ratio": {"THYAO": 22.95, "GSRAY": 3.1}},
        "recommendations": {"AL": ["THYAO"], "TUT": [], "SAT": []},
        "indices": {code: [] for code in screener_universe.UNIVERSE_INDICES} | {"XU030": ["THYAO"], "XU100": ["THYAO", "GSRAY", "DELISTED"]},
        "scanned": [],
    }

    async def list_companies():
        return state["companies"]

    async def tradingview_scan(symbols, columns, **kwargs):
        state["scanned"].append(list(symbols))
        if isinstance(state["market"], Exception):
            raise state["market"]
        return state["market"]

    def isy_screen(criterion=None, recommendation=None):
        if recommendation:
            value = state["recommendations"][recommendation]
            if isinstance(value, Exception):
                raise value
            return [{"symbol": s, "name": s} for s in value]
        value = state["criteria"][criterion]
        if isinstance(value, Exception):
            raise value
        column = f"criteria_{screener_universe._ISY_CRITERIA[criterion]}"
        return [{"symbol": s, column: v} for s, v in value.items()]

    def index_components():
        if isinstance(state["indices"], Exception):
            raise state["indices"]
        return state["indices"]

    monkeypatch.setattr(screener_universe, "list_companies", list_companies)
    monkeypatch.setattr(screener_universe, "tradingview_scan", tradingview_scan)
    monkeypatch.setattr(screener_universe, "_isy_screen_sync", isy_screen)
    monkeypatch.setattr(screener_universe, "_index_components_sync", index_components)
    return state


async def test_universe_merges_all_sources(sources):
    result = await screener_universe.get_screener_universe()

    assert "error" not in result
    assert result["warnings"] == []
    assert result["count"] == 2 and result["priced"] == 2
    # Privileged/founder share classes and duplicate symbols are dropped before the scan.
    assert sources["scanned"] == [["THYAO", "GSRAY"]]
    thyao, gsray = result["rows"]
    assert thyao["symbol"] == "THYAO" and thyao["name"] == "Türk Hava Yolları"
    assert thyao["recommendation"] == "AL" and thyao["target_price"] == 455.0 and thyao["foreign_ratio"] == 22.95
    assert thyao["indices"] == ["XU030", "XU100"]
    assert gsray["indices"] == ["XU100"] and "recommendation" not in gsray and gsray["foreign_ratio"] == 3.1
    # Only listed members count; the delisted XU100 member is ignored.
    assert result["indices"] == [{"code": "XU030", "count": 1}, {"code": "XU100", "count": 2}]
    assert result["sectors"] == [
        {"key": "Consumer Services", "name_tr": "Tüketici hizmetleri", "count": 1},
        {"key": "Transportation", "name_tr": "Taşımacılık", "count": 1},
    ]
    assert result["industries"] == {"Airlines": "Havayolları", "Movies/Entertainment": "Filmler/eğlence"}
    assert result["delay_minutes"] == 15 and result["as_of"].endswith("+00:00")


async def test_failed_analyst_criterion_blanks_only_its_column(sources):
    sources["criteria"]["target_price"] = MarketDataError("İş Yatırım yanıt vermedi", status_code=503)

    result = await screener_universe.get_screener_universe()

    assert result["warnings"] == ["analyst"]
    thyao = result["rows"][0]
    assert "target_price" not in thyao and "upside" not in thyao
    assert thyao["foreign_ratio"] == 22.95 and thyao["recommendation"] == "AL"


async def test_partial_recommendations_are_not_shown(sources):
    sources["recommendations"]["SAT"] = MarketDataError("İş Yatırım yanıt vermedi", status_code=503)

    result = await screener_universe.get_screener_universe()

    # AL/TUT alone would present every SAT-rated stock as "not rated".
    assert result["warnings"] == ["analyst"]
    assert all("recommendation" not in row for row in result["rows"])


async def test_missing_index_components_degrade_to_a_warning(sources):
    sources["indices"] = {code: [] for code in screener_universe.UNIVERSE_INDICES}

    result = await screener_universe.get_screener_universe()

    assert result["warnings"] == ["indices"]
    assert result["indices"] == []
    assert all("indices" not in row for row in result["rows"])


async def test_market_data_outage_is_an_uncached_503(sources):
    sources["market"] = MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503)

    failed = await screener_universe.get_screener_universe()
    assert failed["error_status"] == 503 and failed["rows"] == []

    sources["market"] = MARKET
    recovered = await screener_universe.get_screener_universe()
    assert recovered["count"] == 2


async def test_company_list_outage_is_reported(sources):
    sources["companies"] = {"count": 0, "companies": [], "error": "Şirket listesi alınamadı", "error_status": 503}

    result = await screener_universe.get_screener_universe()

    assert result["error"] == "Şirket listesi alınamadı" and result["error_status"] == 503


def test_universe_route_maps_adapter_errors(monkeypatch):
    app = FastAPI()
    app.include_router(routers_market.market_router)
    client = TestClient(app)

    async def ok():
        return {"rows": [{"symbol": "THYAO"}], "warnings": []}

    async def down():
        return {"rows": [], "error": "Piyasa verisi sağlayıcısına ulaşılamadı", "error_status": 503}

    monkeypatch.setattr(routers_market, "get_screener_universe", ok)
    assert client.get("/market/screener/universe").json()["rows"] == [{"symbol": "THYAO"}]

    monkeypatch.setattr(routers_market, "get_screener_universe", down)
    response = client.get("/market/screener/universe")
    assert response.status_code == 503
    assert response.json() == {"detail": "Piyasa verisi sağlayıcısına ulaşılamadı"}
