"""Sector medians (/sectors, /fundamentals/{t}/sector) and the screener's KAP sector annotation."""

import uuid
from datetime import date, datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.adapters.utils import MarketDataError
from src.api import routers_sectors
from src.db.repositories.sectors import ListedStock, RatioRow
from src.services import sector_service
from src.services.sector_service import (
    DbInputs,
    annotate_rows,
    build_snapshot,
    company_view,
    latest_ratio_values,
    metric_stats,
    sector_key,
    sectors_view,
    since_period,
)


def _stock(ticker: str, sector: str | None) -> ListedStock:
    return ListedStock(id=uuid.uuid4(), ticker=ticker, name=f"{ticker} A.Ş.", sector=sector)


def _ratio(period: str, basis: str = "ttm", **values: float | None) -> RatioRow:
    return RatioRow(company_id=uuid.uuid4(), period=period, basis=basis, values=values)


# ---------------------------------------------------------------------------
# Keys and periods
# ---------------------------------------------------------------------------

def test_sector_key_folds_turkish_letters_and_punctuation():
    assert sector_key("GIDA, İÇECEK VE TÜTÜN") == "gida-icecek-ve-tutun"
    assert sector_key("GAYRİMENKUL YATIRIM ORTAKLIKLARI") == "gayrimenkul-yatirim-ortakliklari"
    assert sector_key(" BANKALAR ") == "bankalar"
    assert sector_key("  ") == ""


def test_since_period_goes_back_across_year_boundaries():
    assert since_period(date(2026, 9, 27)) == "2025/06"
    assert since_period(date(2026, 1, 15), months=1) == "2025/12"


# ---------------------------------------------------------------------------
# Latest ratios
# ---------------------------------------------------------------------------

def test_latest_ratios_prefer_ttm_and_stop_at_the_results_period():
    rows = [
        _ratio("2025/12", roe=18.0, gross_margin=30.0),
        _ratio("2026/06", "quarterly", net_margin=5.0),
        _ratio("2026/06", roe=20.0, net_margin=10.0, current_ratio=float("nan")),
    ]
    values, period = latest_ratio_values(rows)
    assert period == "2026/06"
    # TTM wins within the period; the older year never fills the gaps of the newest results.
    assert values == {"roe": 20.0, "net_margin": 10.0}


def test_bank_flows_come_from_the_fiscal_year_and_newer_balance_values_count():
    rows = [
        _ratio("2026/06", debt_to_equity=4.2),
        _ratio("2025/12", "annual", roe=30.0, net_margin=25.0, debt_to_equity=5.0),
        _ratio("2025/09", roe=28.0, revenue_growth_yoy=40.0),
    ]
    values, period = latest_ratio_values(rows)
    assert period == "2025/12"
    assert values == {"debt_to_equity": 4.2, "roe": 30.0, "net_margin": 25.0}


def test_latest_ratios_without_results_keep_the_newest_values():
    values, period = latest_ratio_values([_ratio("2025/12", current_ratio=1.1), _ratio("2026/03", current_ratio=1.4)])
    assert period is None
    assert values == {"current_ratio": 1.4}


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

def test_metric_stats_needs_three_companies():
    stats = metric_stats([1.0, 2.0], reported=5)
    assert (stats.count, stats.reported, stats.median, stats.p25, stats.p75) == (2, 5, None, None, None)


def test_metric_stats_median_and_inclusive_quartiles():
    assert metric_stats([3.0, 1.0, 2.0], reported=3).to_dict() == {
        "median": 2.0, "p25": 1.5, "p75": 2.5, "count": 3, "reported": 3,
    }
    stats = metric_stats([4.0, 1.0, 3.0, 2.0], reported=4)
    assert (stats.median, stats.p25, stats.p75) == (2.5, 1.75, 3.25)


# ---------------------------------------------------------------------------
# Snapshot and views
# ---------------------------------------------------------------------------

@pytest.fixture
def snapshot():
    stocks = [
        _stock("AAA", "BANKALAR"),
        _stock("BBB", "BANKALAR"),
        _stock("CCC", "BANKALAR"),
        _stock("DDD", "BANKALAR"),
        _stock("EEE", None),
        _stock("ISATR", "BANKALAR"),
        _stock("FFF", "GIDA, İÇECEK VE TÜTÜN"),
    ]
    market_rows = [
        {"symbol": "AAA", "market_cap": 300.0, "pe": 5.0, "pb": 1.0, "dividend_yield": 0.0, "change_pct": -1.0},
        {"symbol": "BBB", "market_cap": 200.0, "pe": 10.0, "pb": 2.0, "dividend_yield": 3.0},
        {"symbol": "CCC", "market_cap": 100.0, "pe": None, "loss": True, "pb": 0.8, "dividend_yield": 5.0},
        {"symbol": "DDD", "market_cap": 50.0, "pe": 20.0, "pb": -0.5, "dividend_yield": 4.0},
        {"symbol": "ISATR", "market_cap": 999.0, "pe": 1.0},
        {"symbol": "FFF", "market_cap": 10.0, "pe": 8.0},
    ]
    ratios = {
        "AAA": {"roe": 20.0, "debt_to_equity": 5.0},
        "BBB": {"roe": 10.0, "debt_to_equity": -2.0},
        "CCC": {"roe": -5.0},
        "DDD": {"roe": 15.0},
    }
    periods = {"AAA": "2025/12", "BBB": "2025/12", "CCC": "2026/06"}
    return build_snapshot(stocks, ratios, periods, market_rows, "2026-09-27T10:00:00+03:00")


def test_snapshot_groups_listed_stocks_by_kap_sector(snapshot):
    assert snapshot.company_sector == {
        "AAA": "bankalar", "BBB": "bankalar", "CCC": "bankalar", "DDD": "bankalar", "FFF": "gida-icecek-ve-tutun",
    }
    banks = snapshot.sectors["bankalar"]
    assert banks.name == "BANKALAR"
    assert banks.members == ["AAA", "BBB", "CCC", "DDD"]
    assert banks.market_cap == 650
    assert banks.ratio_period == "2025/12"


def test_rules_decide_which_values_count(snapshot):
    stats = snapshot.sectors["bankalar"].stats
    # P/E: loss-makers have none; P/B: negative equity is left out.
    assert (stats["pe"].count, stats["pe"].median) == (3, 10.0)
    assert (stats["pb"].count, stats["pb"].reported, stats["pb"].median) == (3, 4, 1.0)
    # Dividend yield: the median of the payers, the non-payer still reported.
    assert (stats["dividend_yield"].count, stats["dividend_yield"].reported, stats["dividend_yield"].median) == (3, 4, 4.0)
    assert (stats["roe"].count, stats["roe"].median) == (4, 12.5)
    # Too few companies: no median.
    assert stats["debt_to_equity"].median is None
    assert stats["debt_to_equity"].count == 1
    assert stats["change_pct"].count == 1


def test_company_view_places_the_stock_in_its_sector(snapshot):
    view = company_view(snapshot, "aaa")
    assert view["ticker"] == "AAA"
    assert view["available"] is True
    assert view["sector"] == {"key": "bankalar", "name": "BANKALAR", "count": 4, "market_cap": 650, "ratio_period": "2025/12"}
    assert view["ratio_period"] == "2025/12"
    pe = view["metrics"]["pe"]
    assert (pe["value"], pe["median"], pe["below"], pe["above"]) == (5.0, 10.0, 0, 2)
    roe = view["metrics"]["roe"]
    assert (roe["value"], roe["below"], roe["above"]) == (20.0, 3, 0)
    # A value the rule leaves out (no dividend) has no position.
    assert view["metrics"]["dividend_yield"]["value"] == 0.0
    assert "below" not in view["metrics"]["dividend_yield"]
    assert [peer["symbol"] for peer in view["peers"]] == ["AAA", "BBB", "CCC", "DDD"]
    ccc = view["peers"][2]
    assert ccc["loss"] is True
    assert ccc["ratio_period"] == "2026/06"
    assert ccc["name"] == "CCC A.Ş."


def test_small_sector_and_unknown_stock(snapshot):
    food = company_view(snapshot, "FFF")
    assert food["available"] is True
    assert food["metrics"]["pe"]["median"] is None
    assert food["metrics"]["pe"]["value"] == 8.0
    unknown = company_view(snapshot, "EEE")
    assert unknown == {"ticker": "EEE", "method": "median", "min_companies": 3, "available": False, "sector": None, "metrics": {}, "peers": []}


def test_sectors_view_lists_every_sector(snapshot):
    view = sectors_view(snapshot)
    assert view["count"] == 2
    assert [s["key"] for s in view["sectors"]] == ["bankalar", "gida-icecek-ve-tutun"]
    assert view["sectors"][0]["metrics"]["roe"]["median"] == 12.5


# ---------------------------------------------------------------------------
# Screener annotation
# ---------------------------------------------------------------------------

def test_annotate_rows_adds_keys_without_touching_the_cached_payload():
    payload = {"rows": [{"symbol": "AAA", "pe": 5.0}, {"symbol": "XYZ"}], "as_of": "t"}
    result = annotate_rows(payload, {"AAA": "bankalar"}, {"bankalar": "BANKALAR"})
    assert result["rows"] == [{"symbol": "AAA", "pe": 5.0, "kap_sector": "bankalar"}, {"symbol": "XYZ"}]
    assert result["kap_sectors"] == [{"key": "bankalar", "name": "BANKALAR", "count": 1}]
    assert result["as_of"] == "t"
    assert "kap_sector" not in payload["rows"][0]


def _db_inputs(stocks: list[ListedStock]) -> DbInputs:
    return DbInputs(stocks=stocks, ratios={}, ratio_periods={}, loaded_at=datetime(2026, 9, 27))


async def test_annotate_universe(monkeypatch):
    async def inputs():
        return _db_inputs([_stock("AAA", "BANKALAR"), _stock("ISATR", "BANKALAR")])

    monkeypatch.setattr(sector_service, "_db_inputs", inputs)
    result = await sector_service.annotate_universe({"rows": [{"symbol": "AAA"}, {"symbol": "ISATR"}]})
    assert result["rows"] == [{"symbol": "AAA", "kap_sector": "bankalar"}, {"symbol": "ISATR"}]

    failed = {"error": "TradingView yanıt vermedi", "rows": []}
    assert await sector_service.annotate_universe(failed) is failed


async def test_annotate_universe_without_the_store_warns(monkeypatch):
    async def broken():
        raise ConnectionError("db down")

    monkeypatch.setattr(sector_service, "_db_inputs", broken)
    payload = {"rows": [{"symbol": "AAA"}], "warnings": ["analyst"]}
    result = await sector_service.annotate_universe(payload)
    assert result["rows"] == [{"symbol": "AAA"}]
    assert result["warnings"] == ["analyst", "sectors"]


async def test_snapshot_without_market_data_keeps_the_ratios(monkeypatch):
    async def inputs():
        return DbInputs(
            stocks=[_stock(t, "BANKALAR") for t in ("AAA", "BBB", "CCC")],
            ratios={"AAA": {"roe": 1.0}, "BBB": {"roe": 2.0}, "CCC": {"roe": 3.0}},
            ratio_periods={},
            loaded_at=datetime(2026, 9, 27),
        )

    async def universe():
        return {"error": "TradingView yanıt vermedi", "error_status": 503}

    monkeypatch.setattr(sector_service, "_db_inputs", inputs)
    monkeypatch.setattr(sector_service, "get_screener_universe", universe)
    view = await sector_service.get_company_sector_view("BBB")
    assert view["metrics"]["roe"]["median"] == 2.0
    assert view["metrics"]["pe"]["count"] == 0
    assert view["meta"]["stale"] is True


async def test_snapshot_without_the_store_is_unavailable(monkeypatch):
    async def broken():
        raise ConnectionError("db down")

    monkeypatch.setattr(sector_service, "_db_inputs", broken)
    with pytest.raises(MarketDataError) as excinfo:
        await sector_service.sector_snapshot()
    assert excinfo.value.status_code == 503


# ---------------------------------------------------------------------------
# HTTP contract
# ---------------------------------------------------------------------------

@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routers_sectors.sectors_router)
    return TestClient(app)


def test_sector_routes_map_errors(client, monkeypatch):
    seen: list[str] = []

    async def view(symbol):
        seen.append(symbol)
        return {"ticker": symbol}

    async def unavailable():
        raise MarketDataError("Sektör verileri şu anda alınamıyor", status_code=503)

    monkeypatch.setattr(sector_service, "get_company_sector_view", view)
    monkeypatch.setattr(sector_service, "get_sectors_view", unavailable)
    assert client.get("/fundamentals/thyao.is/sector").json() == {"ticker": "THYAO"}
    assert seen == ["THYAO"]
    assert client.get("/fundamentals/!!/sector").status_code == 400
    response = client.get("/sectors")
    assert response.status_code == 503
    assert response.json()["detail"] == "Sektör verileri şu anda alınamıyor"
