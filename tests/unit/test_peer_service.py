"""Similar companies (/fundamentals/{t}/peers): pools and fallbacks, scoring, reasons, missing data."""

import math
import uuid
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.dialects import postgresql

from src.adapters.utils import MarketDataError
from src.api import routers_sectors
from src.db.models import FinancialRatio
from src.db.repositories.sectors import ListedStock, _revenue
from src.services import peer_service, sector_service
from src.services.peer_service import (
    MIN_PEERS,
    WEIGHTS,
    candidate_pool,
    peers_view,
    score_candidate,
)
from src.services.sector_service import DbInputs, build_snapshot


def _stock(ticker: str, sector: str | None) -> ListedStock:
    return ListedStock(id=uuid.uuid4(), ticker=ticker, name=f"{ticker} A.Ş.", sector=sector)


TRANSPORT = "ULAŞTIRMA VE DEPOLAMA"
BANKS = "BANKALAR"
LABELS = {"Airlines": "Havayolları", "Marine Shipping": "Deniz taşımacılığı", "Major Banks": "Büyük bankalar"}


@pytest.fixture
def snapshot():
    stocks = [
        _stock("THYAO", TRANSPORT),
        _stock("PGSUS", TRANSPORT),
        _stock("TAVHL", TRANSPORT),
        _stock("CLEBI", TRANSPORT),
        _stock("RYSAS", TRANSPORT),
        _stock("GSDDE", TRANSPORT),
        _stock("AKBNK", BANKS),
        _stock("GARAN", BANKS),
        _stock("ISCTR", BANKS),
        _stock("YKBNK", BANKS),
    ]
    market_rows = [
        {"symbol": "THYAO", "industry": "Airlines", "market_cap": 400e9, "pe": 3.6, "pb": 0.7},
        {"symbol": "PGSUS", "industry": "Airlines", "market_cap": 80e9, "pe": 6.0},
        # Close in size, but another sub-sector.
        {"symbol": "TAVHL", "industry": "Airport Services", "market_cap": 330e9},
        {"symbol": "CLEBI", "industry": "Airport Services", "market_cap": 40e9},
        {"symbol": "RYSAS", "industry": "Marine Shipping", "market_cap": 20e9},
        # No market data at all.
        {"symbol": "GSDDE"},
        {"symbol": "AKBNK", "industry": "Major Banks", "market_cap": 300e9},
        {"symbol": "GARAN", "industry": "Major Banks", "market_cap": 450e9},
        {"symbol": "ISCTR", "industry": "Major Banks", "market_cap": 350e9},
        {"symbol": "YKBNK", "industry": "Major Banks", "market_cap": 280e9, "loss": True},
    ]
    ratios = {
        "THYAO": {"ebitda_margin": 20.0, "net_margin": 12.0, "roe": 25.0, "debt_to_equity": 1.5,
                  "revenue_growth_yoy": 40.0, "revenue": 900e9},
        "PGSUS": {"ebitda_margin": 22.0, "net_margin": 10.0, "roe": 18.0, "debt_to_equity": 2.5,
                  "revenue_growth_yoy": 55.0, "revenue": 150e9},
        "TAVHL": {"ebitda_margin": 35.0, "debt_to_equity": 1.4, "revenue": 120e9},
        # Negative equity: its D/E is not compared (never as a value).
        "CLEBI": {"ebitda_margin": 19.0, "debt_to_equity": -3.0},
        "AKBNK": {"roe": 30.0, "debt_to_equity": 9.0},
        "GARAN": {"roe": 32.0, "debt_to_equity": 9.5},
        "ISCTR": {"roe": 20.0},
        "YKBNK": {"roe": 28.0, "debt_to_equity": 10.0},
    }
    return build_snapshot(stocks, ratios, {}, market_rows, "2026-11-23T10:00:00+03:00", LABELS)


# ---------------------------------------------------------------------------
# Snapshot inputs
# ---------------------------------------------------------------------------

def test_snapshot_keeps_sub_sectors_and_revenue(snapshot):
    assert snapshot.industries["THYAO"] == "Airlines"
    assert "GSDDE" not in snapshot.industries
    assert snapshot.industry_labels["Airlines"] == "Havayolları"
    assert snapshot.values["THYAO"]["revenue"] == 900e9


# ---------------------------------------------------------------------------
# Candidate pools and fallbacks
# ---------------------------------------------------------------------------

def test_sub_sector_pool_when_it_has_enough_companies(snapshot):
    pool = candidate_pool(snapshot, "AKBNK")
    assert pool.scope == "industry"
    assert sorted(pool.members) == ["GARAN", "ISCTR", "YKBNK"]
    assert pool.industry_count == 3


def test_small_sub_sector_widens_to_the_kap_sector(snapshot):
    # Only PGSUS shares THYAO's sub-sector (< MIN_PEERS): every transport company is a candidate.
    pool = candidate_pool(snapshot, "THYAO")
    assert MIN_PEERS == 3
    assert pool.scope == "sector"
    assert pool.industry_count == 1
    assert sorted(pool.members) == ["CLEBI", "GSDDE", "PGSUS", "RYSAS", "TAVHL"]


def test_small_sector_widens_to_the_sub_sector_elsewhere():
    stocks = [_stock("AAA", "SAVUNMA"), _stock("BBB", "SAVUNMA"), _stock("CCC", "BİLİŞİM"), _stock("DDD", "BİLİŞİM")]
    rows = [
        {"symbol": "AAA", "industry": "Aerospace & Defense", "market_cap": 10.0},
        {"symbol": "BBB", "industry": "Electronic Equipment", "market_cap": 9.0},
        {"symbol": "CCC", "industry": "Aerospace & Defense", "market_cap": 8.0},
        {"symbol": "DDD", "industry": "Packaged Software", "market_cap": 7.0},
    ]
    snap = build_snapshot(stocks, {}, {}, rows)
    pool = candidate_pool(snap, "AAA")
    # Neither the sub-sector (0) nor the sector (1) nor both (2) reach MIN_PEERS: the widest pool.
    assert pool.scope == "industry_wide"
    assert pool.members == ["BBB", "CCC"]
    view = peers_view(snap, "AAA")
    assert view["fallback"] is True
    by_symbol = {peer["symbol"]: peer for peer in view["peers"]}
    assert [r["type"] for r in by_symbol["CCC"]["reasons"]][:1] == ["same_industry"]
    assert "same_sector" not in [r["type"] for r in by_symbol["CCC"]["reasons"]]
    assert {"type": "same_sector", "sector": "savunma", "fallback": True} in by_symbol["BBB"]["reasons"]


def test_alone_in_its_sector_without_a_sub_sector():
    snap = build_snapshot([_stock("AAA", "SAVUNMA")], {}, {}, [{"symbol": "AAA", "market_cap": 1.0}])
    view = peers_view(snap, "AAA")
    assert view["available"] is True
    assert view["scope"] is None
    assert view["peers"] == []
    assert view["candidates"] == 0


def test_unknown_stock_is_unavailable(snapshot):
    view = peers_view(snapshot, "XXXXX")
    assert view["available"] is False
    assert view["peers"] == []
    assert view["company"] is None


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def test_weights_sum_to_100():
    assert sum(WEIGHTS.values()) == 100


def test_identical_company_scores_100():
    stocks = [_stock(t, "BANKALAR") for t in ("AAA", "BBB")]
    rows = [{"symbol": t, "industry": "Major Banks", "market_cap": 5.0} for t in ("AAA", "BBB")]
    ratios = {t: {"roe": 10.0, "debt_to_equity": 8.0} for t in ("AAA", "BBB")}
    snap = build_snapshot(stocks, ratios, {}, rows)
    match = score_candidate(snap, "AAA", "BBB")
    assert match.score == pytest.approx(100.0)
    assert match.coverage == pytest.approx(1.0)
    assert match.missing == []


def test_score_formula_and_weights(snapshot):
    match = score_candidate(snapshot, "THYAO", "PGSUS")
    size = 1 - abs(math.log(80e9 / 400e9)) / math.log(10)
    revenue = 1 - abs(math.log(150e9 / 900e9)) / math.log(10)
    leverage = 1 - abs(math.log(3.5 / 2.5)) / math.log(4)
    expected = {
        "industry": 1.0,
        "market_cap": size,
        "revenue": revenue,
        "ebitda_margin": 1 - 2 / 15,
        "net_margin": 1 - 2 / 10,
        "roe": 1 - 7 / 15,
        "debt_to_equity": leverage,
        "revenue_growth_yoy": 1 - 15 / 30,
    }
    assert match.components == pytest.approx(expected)
    assert match.score == pytest.approx(sum(WEIGHTS[m] * s for m, s in expected.items()))
    assert match.coverage == pytest.approx(1.0)


def test_missing_values_earn_nothing_and_are_never_zero(snapshot):
    # GSDDE has no data at all: nothing compared, nothing invented.
    empty = score_candidate(snapshot, "THYAO", "GSDDE")
    assert empty.components == {}
    assert empty.score == 0.0
    assert empty.coverage == 0.0
    assert set(empty.missing) == set(WEIGHTS)
    # CLEBI's negative-equity D/E is left out like a missing value (not compared as -3).
    clebi = score_candidate(snapshot, "THYAO", "CLEBI")
    assert "debt_to_equity" not in clebi.components
    assert "debt_to_equity" in clebi.missing


def test_metrics_the_stock_lacks_drop_out_for_everyone(snapshot):
    # ISCTR has no D/E: GARAN's D/E is not compared and does not count toward the score.
    match = score_candidate(snapshot, "ISCTR", "GARAN")
    assert set(match.components) == {"industry", "market_cap", "roe"}
    assert match.coverage == pytest.approx(1.0)
    view = peers_view(snapshot, "ISCTR")
    assert "debt_to_equity" in view["unavailable"]
    assert "revenue" in view["unavailable"]
    assert "industry" not in view["unavailable"]


def test_ranking_prefers_the_sub_sector_and_is_deterministic(snapshot):
    view = peers_view(snapshot, "THYAO")
    symbols = [peer["symbol"] for peer in view["peers"]]
    assert symbols[0] == "PGSUS"
    # No data, last.
    assert symbols[-1] == "GSDDE"
    assert view == peers_view(snapshot, "THYAO")
    scores = [peer["score"] for peer in view["peers"]]
    assert scores == sorted(scores, reverse=True)


def test_limit(snapshot):
    assert len(peers_view(snapshot, "THYAO", limit=2)["peers"]) == 2
    assert len(peers_view(snapshot, "THYAO", limit=0)["peers"]) == 1


# ---------------------------------------------------------------------------
# Reasons
# ---------------------------------------------------------------------------

def test_reasons_carry_both_values(snapshot):
    view = peers_view(snapshot, "THYAO")
    assert view["scope"] == "sector"
    assert view["fallback"] is True
    assert view["industry"] == {"key": "Airlines", "name": "Havayolları", "count": 2}
    assert view["sector"] == {"key": "ulastirma-ve-depolama", "name": TRANSPORT, "count": 6}
    pgsus = view["peers"][0]
    reasons = pgsus["reasons"]
    assert reasons[0] == {"type": "same_industry", "industry": {"key": "Airlines", "name": "Havayolları"}}
    assert reasons[1] == {"type": "same_sector", "sector": "ulastirma-ve-depolama", "fallback": True}
    by_metric = {r["metric"]: r for r in reasons if "metric" in r}
    # Close: EBITDA margin (2 pp), net margin (2 pp), D/E; not close: size 5x, revenue 6x, ROE 7 pp, growth 15 pp.
    assert set(by_metric) == {"ebitda_margin", "net_margin", "debt_to_equity"}
    assert by_metric["ebitda_margin"] == {
        "type": "close_metric", "metric": "ebitda_margin", "value": 20.0, "peer_value": 22.0,
        "similarity": 0.867, "difference": 2.0,
    }
    # Highest weight × similarity first.
    assert [r["metric"] for r in reasons[2:]] == ["ebitda_margin", "debt_to_equity", "net_margin"]
    assert pgsus["values"]["revenue"] == 150e9
    assert pgsus["missing"] == []


def test_size_reason_has_the_ratio(snapshot):
    view = peers_view(snapshot, "AKBNK")
    assert view["scope"] == "industry"
    assert view["fallback"] is False
    garan = next(peer for peer in view["peers"] if peer["symbol"] == "GARAN")
    size = next(r for r in garan["reasons"] if r["type"] == "similar_size")
    assert size == {
        "type": "similar_size", "metric": "market_cap", "value": 300e9, "peer_value": 450e9,
        "similarity": pytest.approx(0.824, abs=1e-3), "ratio": 1.5,
    }
    assert {"type": "same_sector", "sector": "bankalar", "fallback": False} in garan["reasons"]
    yk = next(peer for peer in view["peers"] if peer["symbol"] == "YKBNK")
    assert yk["loss"] is True


def test_no_reason_without_both_values(snapshot):
    view = peers_view(snapshot, "THYAO")
    for peer in view["peers"]:
        for reason in peer["reasons"]:
            if "metric" in reason:
                assert reason["value"] is not None and reason["peer_value"] is not None
                assert reason["metric"] not in peer["missing"]
    gsdde = next(peer for peer in view["peers"] if peer["symbol"] == "GSDDE")
    assert [r["type"] for r in gsdde["reasons"]] == ["same_sector"]
    assert gsdde["values"] == {}
    tav = next(peer for peer in view["peers"] if peer["symbol"] == "TAVHL")
    # Another sub-sector: no same_industry reason, the industry component scores 0.
    assert "same_industry" not in [r["type"] for r in tav["reasons"]]
    assert tav["components"]["industry"] == 0.0


# ---------------------------------------------------------------------------
# Service and HTTP contract
# ---------------------------------------------------------------------------

async def test_get_peers_view_uses_the_sector_snapshot(monkeypatch):
    async def inputs():
        return DbInputs(
            stocks=[_stock(t, BANKS) for t in ("AAA", "BBB")],
            ratios={"AAA": {"roe": 10.0}, "BBB": {"roe": 12.0}},
            ratio_periods={},
            loaded_at=datetime(2026, 11, 23),
        )

    async def universe():
        return {
            "as_of": "2026-11-23T10:00:00+03:00",
            "industries": {"Major Banks": "Büyük bankalar"},
            "rows": [
                {"symbol": "AAA", "industry": "Major Banks", "market_cap": 10.0},
                {"symbol": "BBB", "industry": "Major Banks", "market_cap": 12.0},
            ],
        }

    monkeypatch.setattr(sector_service, "_memo", None)
    monkeypatch.setattr(sector_service, "_db_inputs", inputs)
    monkeypatch.setattr(sector_service, "get_screener_universe", universe)
    view = await peer_service.get_peers_view("AAA")
    assert view["industry"] == {"key": "Major Banks", "name": "Büyük bankalar", "count": 2}
    assert [peer["symbol"] for peer in view["peers"]] == ["BBB"]
    assert view["meta"]["stale"] is False
    assert view["meta"]["notes"][0].startswith("Benzer şirketler")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(routers_sectors.sectors_router)
    return TestClient(app)


def test_peer_route_validates_and_maps_errors(client, monkeypatch):
    seen: list[tuple[str, int]] = []

    async def view(symbol, limit):
        seen.append((symbol, limit))
        return {"ticker": symbol}

    monkeypatch.setattr(peer_service, "get_peers_view", view)
    assert client.get("/fundamentals/thyao.is/peers").json() == {"ticker": "THYAO"}
    assert client.get("/fundamentals/THYAO/peers?limit=12").status_code == 200
    assert seen == [("THYAO", 8), ("THYAO", 12)]
    assert client.get("/fundamentals/!!/peers").status_code == 400
    assert client.get("/fundamentals/THYAO/peers?limit=0").status_code == 422
    assert client.get("/fundamentals/THYAO/peers?limit=21").status_code == 422

    async def unavailable(symbol, limit):
        raise MarketDataError("Sektör verileri şu anda alınamıyor", status_code=503)

    monkeypatch.setattr(peer_service, "get_peers_view", unavailable)
    response = client.get("/fundamentals/THYAO/peers")
    assert response.status_code == 503
    assert response.json()["detail"] == "Sektör verileri şu anda alınamıyor"


# ---------------------------------------------------------------------------
# Revenue from the ratio store
# ---------------------------------------------------------------------------

def test_revenue_is_read_as_text_and_left_out_for_financials():
    assert _revenue("1250000000.5", "false") == 1250000000.5
    assert _revenue("1250000000", None) == 1250000000.0
    assert _revenue("900", "true") is None
    assert _revenue(None, None) is None
    assert _revenue("NaN", None) is None
    assert _revenue("abc", None) is None
    sql = str(
        FinancialRatio.inputs_json[("flows", "revenue")].astext.compile(
            dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}
        )
    )
    assert "#>> '{flows, revenue}'" in sql
