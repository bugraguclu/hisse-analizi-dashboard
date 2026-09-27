"""Sektör ortalamaları — KAP sektörüne göre medyanlar, hissenin sektördeki yeri ve emsalleri.

Sektör = şirketin KAP sektörü (``companies.sector``; universe.sync yazar, ör. "BANKALAR",
"GAYRİMENKUL YATIRIM ORTAKLIKLARI"). TradingView'ın sektörü emsal karşılaştırması için fazla
geniştir: "Finance" bankaları, GYO'ları, holdingleri ve aracı kurumları birlikte tutar (138 şirket).

Değerler, sitede aynı göstergenin gösterildiği kaynaktan gelir:

* Piyasa çarpanları ve getiriler — tarama evreni (TradingView, 15 dk gecikmeli): piyasa değeri,
  F/K, PD/DD, temettü verimi, günlük değişim, 1H…1Y getiri, yabancı payı. Hisse sayfasındaki F/K
  ve PD/DD ile Hisse Tarama tablosu aynı değerleri gösterir.
* Finansal oranlar — ``financial_ratios`` (KAP + İş Yatırım tablolarından son 12 ay; bankalarda
  son yıllık): marjlar, ROE/ROA, cari oran, borçluluk, büyüme, F/S, FD/FAVÖK. Finansal oranlar
  kartı aynı hesabı gösterir.

"Ortalama" medyandır: F/K 400 ya da −%900 marj gibi uç değerler aritmetik ortalamayı anlamsız
kılar. En az :data:`MIN_COMPANIES` şirketin değeri yoksa medyan verilmez. Çarpanlarda (F/K, PD/DD,
F/S, FD/FAVÖK) ve cari oranda yalnızca pozitif değerler sayılır; borç/özkaynakta negatif
özkaynaklı şirketler dışarıda kalır. Temettü veriminin medyanı temettü ödeyen şirketlerden
alınır (çoğu sektörde şirketlerin yarısından azı öder, sıfırlarla medyan %0 çıkardı); kaç
şirketin değeri olduğu ``reported``, kaçının sayıldığı ``count`` alanındadır.
"""

from __future__ import annotations

import re
import statistics
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Literal

import structlog

from src.adapters.screener_adapter import EXCLUDED_SYMBOLS
from src.adapters.screener_universe import PRICE_DELAY_MINUTES, get_screener_universe
from src.adapters.utils import MarketDataError, cached, finite_float, upstream_failure
from src.core.meta import DataMeta, with_meta
from src.core.time import utcnow
from src.db.repositories.sectors import ListedStock, RatioRow, SectorRepository
from src.db.session import async_session_factory

logger = structlog.get_logger(__name__)

METHOD = "median"
#: A sector median needs at least this many companies with a value.
MIN_COMPANIES = 3
#: Ratio rows older than this many months are too stale to compare (every listed company
#: has filed a newer report by then; banks' store stops at the last fiscal year).
RATIO_LOOKBACK_MONTHS = 15
#: DB inputs (sector map + latest ratios) change with the daily jobs.
TTL_DB_INPUTS = 600

SOURCE = "kap+isyatirim+tradingview"
SOURCE_URL = "https://www.kap.org.tr/tr/Sektorler"
WARNING_SECTORS = "sectors"
_MSG_UNAVAILABLE = "Sektör verileri şu anda alınamıyor"
_NOTE_METHOD = "Sektör ortalaması: KAP sektöründeki şirketlerin medyanı"
_NOTE_MARKET_DOWN = "Piyasa verisi alınamadı; yalnızca finansal oranlar karşılaştırıldı"

Source = Literal["market", "ratios"]


@dataclass(frozen=True)
class MetricRule:
    source: Source
    #: Only values > 0 count (a negative P/E or P/B means nothing; dividend yield: payers).
    positive: bool = False
    #: Only values ≥ 0 count (debt/equity of a company with negative equity).
    non_negative: bool = False

    def counts(self, value: float) -> bool:
        if self.positive:
            return value > 0
        if self.non_negative:
            return value >= 0
        return True


METRICS: dict[str, MetricRule] = {
    # Tarama evreni (TradingView + İş Yatırım)
    "market_cap": MetricRule("market", positive=True),
    "pe": MetricRule("market", positive=True),
    "pb": MetricRule("market", positive=True),
    "dividend_yield": MetricRule("market", positive=True),
    "change_pct": MetricRule("market"),
    "perf_1w": MetricRule("market"),
    "perf_1m": MetricRule("market"),
    "perf_3m": MetricRule("market"),
    "perf_ytd": MetricRule("market"),
    "perf_1y": MetricRule("market"),
    "foreign_ratio": MetricRule("market", non_negative=True),
    # financial_ratios (KAP + İş Yatırım)
    "gross_margin": MetricRule("ratios"),
    "operating_margin": MetricRule("ratios"),
    "ebitda_margin": MetricRule("ratios"),
    "net_margin": MetricRule("ratios"),
    "roe": MetricRule("ratios"),
    "roa": MetricRule("ratios"),
    "current_ratio": MetricRule("ratios", positive=True),
    "debt_to_equity": MetricRule("ratios", non_negative=True),
    "net_debt_ebitda": MetricRule("ratios"),
    "revenue_growth_yoy": MetricRule("ratios"),
    "net_income_growth_yoy": MetricRule("ratios"),
    "ps_ratio": MetricRule("ratios", positive=True),
    "ev_ebitda": MetricRule("ratios", positive=True),
}
MARKET_METRICS: tuple[str, ...] = tuple(name for name, rule in METRICS.items() if rule.source == "market")
RATIO_METRICS: tuple[str, ...] = tuple(name for name, rule in METRICS.items() if rule.source == "ratios")

# Result lines: a row with any of these is the period /live-ratios computes its flows for.
_FLOW_METRICS: tuple[str, ...] = (
    "gross_margin", "operating_margin", "ebitda_margin", "net_margin", "roe", "roa",
    "revenue_growth_yoy", "net_income_growth_yoy",
)

_FOLD = str.maketrans("çğıöşüâîûÇĞİÖŞÜÂÎÛ", "cgiosuaiuCGIOSUAIU")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def sector_key(name: str) -> str:
    """URL-safe key of a KAP sector name: "GIDA, İÇECEK VE TÜTÜN" → "gida-icecek-ve-tutun"."""
    return _NON_ALNUM.sub("-", name.strip().translate(_FOLD).lower()).strip("-")


def since_period(today: date, months: int = RATIO_LOOKBACK_MONTHS) -> str:
    """Oldest ratio period ("YYYY/MM") still compared on ``today``."""
    index = today.year * 12 + today.month - 1 - months
    return f"{index // 12:04d}/{index % 12 + 1:02d}"


def _round(value: float, digits: int = 4) -> float:
    return round(value, digits)


# ---------------------------------------------------------------------------
# Pure core
# ---------------------------------------------------------------------------

def latest_ratio_values(rows: Sequence[RatioRow]) -> tuple[dict[str, float], str | None]:
    """Newest value per ratio, never from a period older than the newest row with results.

    Rows run newest first, TTM before annual within a period. A bank's newest TTM row carries
    only the balance-sheet valuation (its flows stop at the last fiscal year), so the flows come
    from that fiscal year and the newer rows still count — the choice ``/live-ratios`` makes.
    Returns the values and the period of the results (``None`` without any).
    """
    ordered = sorted(rows, key=lambda row: (row.period, row.basis == "ttm"), reverse=True)
    main = next((row for row in ordered if any(row.values.get(k) is not None for k in _FLOW_METRICS)), None)
    values: dict[str, float] = {}
    for row in ordered:
        if main is not None and row.period < main.period:
            break
        for name, raw in row.values.items():
            number = finite_float(raw)
            if number is not None and name not in values:
                values[name] = number
    return values, (main.period if main is not None else None)


@dataclass(frozen=True)
class MetricStats:
    """Distribution of one metric in a sector (``median`` etc. are ``None`` below MIN_COMPANIES)."""

    count: int
    reported: int
    median: float | None = None
    p25: float | None = None
    p75: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return {"median": self.median, "p25": self.p25, "p75": self.p75, "count": self.count, "reported": self.reported}


def metric_stats(values: Sequence[float], reported: int) -> MetricStats:
    """Median and quartiles of ``values`` (quartiles interpolate like spreadsheets' QUARTILE.INC)."""
    count = len(values)
    if count < MIN_COMPANIES:
        return MetricStats(count=count, reported=reported)
    ordered = sorted(values)
    q1, _, q3 = statistics.quantiles(ordered, n=4, method="inclusive")
    return MetricStats(
        count=count,
        reported=reported,
        median=_round(statistics.median(ordered)),
        p25=_round(q1),
        p75=_round(q3),
    )


@dataclass
class Sector:
    key: str
    name: str
    #: Tickers, largest market cap first.
    members: list[str]
    stats: dict[str, MetricStats]
    #: (ticker, value) pairs that count toward each metric's median.
    samples: dict[str, list[tuple[str, float]]]
    market_cap: float | None
    #: The most common results period of the members' ratios ("2026/06").
    ratio_period: str | None


@dataclass
class SectorSnapshot:
    sectors: dict[str, Sector]
    #: ticker → sector key
    company_sector: dict[str, str]
    names: dict[str, str]
    #: ticker → metric → value (every value, also the ones a rule leaves out)
    values: dict[str, dict[str, float]]
    #: Tickers TradingView reports as loss-making over the last 12 months (no P/E).
    loss: set[str]
    ratio_periods: dict[str, str]
    #: Market data time (ISO) or ``None`` when the scan failed.
    market_as_of: str | None
    built_at: datetime = field(default_factory=utcnow)


def build_snapshot(
    stocks: Sequence[ListedStock],
    ratios: Mapping[str, Mapping[str, float]],
    ratio_periods: Mapping[str, str],
    market_rows: Sequence[Mapping[str, Any]],
    market_as_of: str | None = None,
) -> SectorSnapshot:
    """Every sector's members, medians and samples from the listed stocks, their ratios and the scan rows."""
    market = {str(row.get("symbol") or "").upper(): row for row in market_rows if row.get("symbol")}
    company_sector: dict[str, str] = {}
    sector_names: dict[str, str] = {}
    names: dict[str, str] = {}
    values: dict[str, dict[str, float]] = {}
    loss: set[str] = set()
    for stock in stocks:
        ticker = stock.ticker.upper()
        name = (stock.sector or "").strip()
        if not name or ticker in EXCLUDED_SYMBOLS:
            continue
        key = sector_key(name)
        if not key:
            continue
        company_sector[ticker] = key
        sector_names.setdefault(key, name)
        names[ticker] = stock.name
        row = market.get(ticker, {})
        own: dict[str, float] = {}
        for metric in MARKET_METRICS:
            number = finite_float(row.get(metric))
            if number is not None:
                own[metric] = number
        for metric in RATIO_METRICS:
            number = finite_float(ratios.get(ticker, {}).get(metric))
            if number is not None:
                own[metric] = number
        values[ticker] = own
        if row.get("loss") is True:
            loss.add(ticker)

    members_by_key: dict[str, list[str]] = defaultdict(list)
    for ticker, key in company_sector.items():
        members_by_key[key].append(ticker)

    sectors: dict[str, Sector] = {}
    for key, members in members_by_key.items():
        members.sort(key=lambda t: (-(values[t].get("market_cap") or 0.0), t))
        samples: dict[str, list[tuple[str, float]]] = {}
        stats: dict[str, MetricStats] = {}
        for metric, rule in METRICS.items():
            reported = [(t, values[t][metric]) for t in members if metric in values[t]]
            counted = [(t, v) for t, v in reported if rule.counts(v)]
            samples[metric] = counted
            stats[metric] = metric_stats([v for _, v in counted], len(reported))
        caps = [v for _, v in samples["market_cap"]]
        periods = Counter(ratio_periods[t] for t in members if t in ratio_periods)
        sectors[key] = Sector(
            key=key,
            name=sector_names[key],
            members=members,
            stats=stats,
            samples=samples,
            market_cap=round(sum(caps)) if caps else None,
            ratio_period=periods.most_common(1)[0][0] if periods else None,
        )
    return SectorSnapshot(
        sectors=sectors,
        company_sector=company_sector,
        names=names,
        values=values,
        loss=loss,
        ratio_periods=dict(ratio_periods),
        market_as_of=market_as_of,
    )


def _sector_block(sector: Sector) -> dict[str, Any]:
    return {
        "key": sector.key,
        "name": sector.name,
        "count": len(sector.members),
        "market_cap": sector.market_cap,
        "ratio_period": sector.ratio_period,
    }


def company_view(snapshot: SectorSnapshot, ticker: str) -> dict[str, Any]:
    """``/fundamentals/{t}/sector``: the stock's sector, each metric's median next to the stock's
    value and position (``below``/``above`` = how many other companies have a lower/higher value),
    and every company of the sector (largest first) as peers."""
    ticker = ticker.upper()
    key = snapshot.company_sector.get(ticker)
    base: dict[str, Any] = {"ticker": ticker, "method": METHOD, "min_companies": MIN_COMPANIES}
    if key is None:
        return {**base, "available": False, "sector": None, "metrics": {}, "peers": []}
    sector = snapshot.sectors[key]
    own = snapshot.values.get(ticker, {})
    metrics: dict[str, Any] = {}
    for metric, stats in sector.stats.items():
        entry = stats.to_dict()
        value = own.get(metric)
        entry["value"] = _round(value) if value is not None else None
        if value is not None and METRICS[metric].counts(value):
            others = [v for t, v in sector.samples[metric] if t != ticker]
            entry["below"] = sum(1 for v in others if v < value)
            entry["above"] = sum(1 for v in others if v > value)
        metrics[metric] = entry
    peers = []
    for member in sector.members:
        peer: dict[str, Any] = {"symbol": member, "name": snapshot.names.get(member)}
        peer.update({metric: _round(v) for metric, v in snapshot.values.get(member, {}).items()})
        if member in snapshot.loss:
            peer["loss"] = True
        if member in snapshot.ratio_periods:
            peer["ratio_period"] = snapshot.ratio_periods[member]
        peers.append(peer)
    return {
        **base,
        "available": True,
        "sector": _sector_block(sector),
        "ratio_period": snapshot.ratio_periods.get(ticker),
        "metrics": metrics,
        "peers": peers,
    }


def sectors_view(snapshot: SectorSnapshot) -> dict[str, Any]:
    """``/sectors``: every KAP sector with its size and medians (A→Z by key)."""
    return {
        "method": METHOD,
        "min_companies": MIN_COMPANIES,
        "count": len(snapshot.sectors),
        "sectors": [
            {**_sector_block(sector), "metrics": {m: s.to_dict() for m, s in sector.stats.items()}}
            for sector in sorted(snapshot.sectors.values(), key=lambda s: s.key)
        ],
    }


def annotate_rows(
    payload: Mapping[str, Any], company_sector: Mapping[str, str], names: Mapping[str, str]
) -> dict[str, Any]:
    """Screener universe with each row's KAP sector key (``kap_sector``) and the sector list
    (``kap_sectors``: key, KAP name, rows) — new dicts, the cached payload is not modified."""
    rows = payload.get("rows")
    if not isinstance(rows, list):
        return dict(payload)
    counts: Counter[str] = Counter()
    annotated: list[Any] = []
    for row in rows:
        key = company_sector.get(str(row.get("symbol") or "").upper()) if isinstance(row, dict) else None
        if key:
            counts[key] += 1
            annotated.append({**row, "kap_sector": key})
        else:
            annotated.append(row)
    return {
        **payload,
        "rows": annotated,
        "kap_sectors": [{"key": key, "name": names.get(key, key), "count": counts[key]} for key in sorted(counts)],
    }


# ---------------------------------------------------------------------------
# Inputs (store + cached scan)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class DbInputs:
    stocks: list[ListedStock]
    ratios: dict[str, dict[str, float]]
    ratio_periods: dict[str, str]
    loaded_at: datetime

    def sector_map(self) -> tuple[dict[str, str], dict[str, str]]:
        """``({ticker: key}, {key: KAP name})`` for the listed stocks with a sector."""
        company_sector: dict[str, str] = {}
        names: dict[str, str] = {}
        for stock in self.stocks:
            name = (stock.sector or "").strip()
            ticker = stock.ticker.upper()
            if name and ticker not in EXCLUDED_SYMBOLS and (key := sector_key(name)):
                company_sector[ticker] = key
                names.setdefault(key, name)
        return company_sector, names


@cached(TTL_DB_INPUTS, "sectors")
async def _db_inputs() -> DbInputs:
    since = since_period(utcnow().date())
    async with async_session_factory() as session:
        repo = SectorRepository(session)
        stocks = await repo.listed_stocks()
        rows = await repo.ratio_rows([stock.id for stock in stocks], since_period=since)
    by_company: dict[Any, list[RatioRow]] = defaultdict(list)
    for row in rows:
        by_company[row.company_id].append(row)
    ratios: dict[str, dict[str, float]] = {}
    periods: dict[str, str] = {}
    for stock in stocks:
        company_rows = by_company.get(stock.id)
        if not company_rows:
            continue
        values, period = latest_ratio_values(company_rows)
        ticker = stock.ticker.upper()
        if values:
            ratios[ticker] = values
        if period:
            periods[ticker] = period
    return DbInputs(stocks=stocks, ratios=ratios, ratio_periods=periods, loaded_at=utcnow())


_memo: tuple[tuple[datetime, str | None], SectorSnapshot] | None = None


async def sector_snapshot() -> SectorSnapshot:
    """Snapshot of every sector; rebuilt only when the DB inputs or the market scan changed."""
    global _memo
    try:
        db = await _db_inputs()
    except Exception as e:
        logger.warning("sectors_db_unavailable", error=f"{type(e).__name__}: {e}"[:300])
        raise MarketDataError(_MSG_UNAVAILABLE, status_code=503) from e
    universe = await get_screener_universe()
    failure = upstream_failure(universe)
    if failure is not None:
        logger.info("sectors_market_unavailable", error=failure[1])
        rows: list[Any] = []
        as_of: str | None = None
    else:
        rows = [row for row in universe.get("rows") or [] if isinstance(row, dict)]
        as_of = universe.get("as_of")
    key = (db.loaded_at, as_of)
    if _memo is not None and _memo[0] == key and as_of is not None:
        return _memo[1]
    snapshot = build_snapshot(db.stocks, db.ratios, db.ratio_periods, rows, as_of)
    _memo = (key, snapshot)
    return snapshot


def _meta(snapshot: SectorSnapshot) -> DataMeta:
    fetched = snapshot.built_at
    if snapshot.market_as_of:
        try:
            fetched = datetime.fromisoformat(snapshot.market_as_of)
        except ValueError:
            pass
    notes = [_NOTE_METHOD] + ([] if snapshot.market_as_of else [_NOTE_MARKET_DOWN])
    return DataMeta(
        source=SOURCE,
        fetched_at=fetched,
        source_url=SOURCE_URL,
        as_of=fetched.date().isoformat(),
        served_from="store",
        stale=snapshot.market_as_of is None,
        delay_seconds=PRICE_DELAY_MINUTES * 60 if snapshot.market_as_of else None,
        notes=notes,
    )


async def get_company_sector_view(ticker: str) -> dict[str, Any]:
    snapshot = await sector_snapshot()
    return with_meta(company_view(snapshot, ticker), _meta(snapshot))


async def get_sectors_view() -> dict[str, Any]:
    snapshot = await sector_snapshot()
    return with_meta(sectors_view(snapshot), _meta(snapshot))


async def annotate_universe(payload: dict[str, Any]) -> dict[str, Any]:
    """Screener universe + KAP sectors; without the store it is returned as is with a warning."""
    if upstream_failure(payload) is not None or not payload.get("rows"):
        return payload
    try:
        db = await _db_inputs()
    except Exception as e:
        logger.warning("sectors_annotate_failed", error=f"{type(e).__name__}: {e}"[:300])
        warnings = list(payload.get("warnings") or [])
        return {**payload, "warnings": [*warnings, WARNING_SECTORS] if WARNING_SECTORS not in warnings else warnings}
    company_sector, names = db.sector_map()
    return annotate_rows(payload, company_sector, names)


__all__ = [
    "MARKET_METRICS",
    "METRICS",
    "MIN_COMPANIES",
    "RATIO_METRICS",
    "MetricStats",
    "SectorSnapshot",
    "annotate_rows",
    "annotate_universe",
    "build_snapshot",
    "company_view",
    "get_company_sector_view",
    "get_sectors_view",
    "latest_ratio_values",
    "metric_stats",
    "sector_key",
    "sector_snapshot",
    "sectors_view",
    "since_period",
]
