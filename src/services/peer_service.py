"""Benzer şirketler — bir hisseye en çok benzeyen şirketler, her seçimin gerekçesiyle.

Sektör karşılaştırmasıyla (``sector_service``) aynı anlık görüntüyü kullanır: KAP sektörü, tarama
evreninin piyasa verisi (TradingView) ve ``financial_ratios`` deposundaki son oranlar. Yeni veri
kaynağı yoktur; alt sektör TradingView'ın ``industry`` alanıdır ("Airlines" / "Havayolları").

**Aday havuzu** (ilk yeterli olan seçilir, :data:`MIN_PEERS` diğer şirket):

1. ``industry`` — aynı KAP sektörü ve aynı alt sektör.
2. ``sector`` — alt sektörde yeterli şirket yoksa (ya da alt sektör bilinmiyorsa) bütün KAP sektörü.
3. ``industry_wide`` — KAP sektörü de küçükse sektörün şirketleri ve başka sektörlerdeki aynı alt
   sektör şirketleri.

Hiçbiri yeterli değilse en geniş boş olmayan havuz kullanılır; ``fallback`` ve gerekçelerdeki
``same_sector``/``same_industry`` bunu açıkça söyler.

**Puan** (0–100) belirleyici ve açıklanabilirdir: her bileşenin benzerliği 0–1 arasındadır ve
:data:`WEIGHTS` ile ağırlıklandırılır::

    puan = 100 × Σ(ağırlık × benzerlik, iki şirketin de değeri olan bileşenler)
               ÷ Σ(ağırlık, hissenin kendi değeri olan bileşenler)

Eksik değer hiçbir zaman 0 sayılmaz: hissenin değeri yoksa bileşen herkes için hesaptan çıkar
(``unavailable``); adayın değeri yoksa o bileşenden puan almaz ama değer uydurulmaz (``missing``,
``coverage`` karşılaştırılabilen ağırlık payıdır). Gerekçe yalnızca iki değer de varsa ve benzerlik
:data:`REASON_MIN_SIMILARITY` üstündeyse verilir. Metinleri arayüz kurar (i18n); burada yalnızca
makineyle okunur tür ve değerler vardır.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Literal

from src.core.meta import with_meta
from src.services.sector_service import METRICS, SectorSnapshot, sector_snapshot, snapshot_meta

Scope = Literal["industry", "sector", "industry_wide"]

#: A candidate pool is wide enough with this many other companies.
MIN_PEERS = 3
#: Peers returned by default / at most.
DEFAULT_LIMIT = 8
MAX_LIMIT = 20
#: A metric is named as a reason from this similarity on (size within ~2.5×, EBITDA margin within 6 pp…).
REASON_MIN_SIMILARITY = 0.6

#: Weight of each component (sum 100). Business line first, then size, then the profile.
WEIGHTS: dict[str, float] = {
    "industry": 30.0,  # same TradingView industry (sub-sector)
    "market_cap": 20.0,  # size on the market
    "revenue": 15.0,  # size of the business (net sales)
    "ebitda_margin": 10.0,  # operating profitability
    "debt_to_equity": 8.0,  # leverage
    "revenue_growth_yoy": 7.0,  # growth
    "net_margin": 5.0,  # bottom-line profitability
    "roe": 5.0,  # return on equity
}

#: Size metrics: similarity falls linearly with the log of the ratio, 0 at 10× apart.
SIZE_SPAN = 10.0
#: Leverage: like size, on (1 + D/E), 0 at 4× apart (0.5 vs 1.5 → 0.63; 10 vs 12 → 0.88).
LEVERAGE_SPAN = 4.0
#: Percent metrics: similarity falls linearly with the difference, 0 at this many points apart.
POINT_SPANS: dict[str, float] = {
    "ebitda_margin": 15.0,
    "net_margin": 10.0,
    "roe": 15.0,
    "revenue_growth_yoy": 30.0,
}

#: Figures listed next to each company (side by side in the UI).
VALUE_METRICS: tuple[str, ...] = (
    "market_cap", "revenue", "pe", "pb", "ebitda_margin", "net_margin", "roe", "debt_to_equity", "revenue_growth_yoy",
)

_NOTE_METHOD = "Benzer şirketler: alt sektör, büyüklük ve finansal profil benzerliği (ağırlıklar yanıtta)"


def _log_similarity(a: float, b: float, span: float) -> float:
    return max(0.0, 1.0 - abs(math.log(b / a)) / math.log(span))


def _size(a: float, b: float) -> float:
    return _log_similarity(a, b, SIZE_SPAN)


def _leverage(a: float, b: float) -> float:
    return _log_similarity(1.0 + a, 1.0 + b, LEVERAGE_SPAN)


def _points(metric: str) -> Callable[[float, float], float]:
    span = POINT_SPANS[metric]
    return lambda a, b: max(0.0, 1.0 - abs(b - a) / span)


SIMILARITY: dict[str, Callable[[float, float], float]] = {
    "market_cap": _size,
    "revenue": _size,
    "debt_to_equity": _leverage,
    **{metric: _points(metric) for metric in POINT_SPANS},
}


def _value(snapshot: SectorSnapshot, ticker: str, metric: str) -> float | None:
    """The value the comparison may use: present and allowed by the metric's rule (no negative
    market cap or revenue, no D/E of a company with negative equity)."""
    value = snapshot.values.get(ticker, {}).get(metric)
    if value is None or not METRICS[metric].counts(value):
        return None
    return value


def _r(value: float, digits: int = 4) -> float:
    return round(value, digits)


@dataclass(frozen=True)
class Pool:
    scope: Scope | None
    members: list[str]
    #: Other companies of the same KAP sector and sub-sector (what scope "industry" needs MIN_PEERS of).
    industry_count: int


def candidate_pool(snapshot: SectorSnapshot, ticker: str) -> Pool:
    """The narrowest pool with at least :data:`MIN_PEERS` other companies (see the module doc)."""
    sector = snapshot.company_sector.get(ticker)
    industry = snapshot.industries.get(ticker)
    sector_members = [t for t in snapshot.sectors[sector].members if t != ticker] if sector else []
    same_industry = [t for t in sector_members if industry is not None and snapshot.industries.get(t) == industry]
    tiers: list[tuple[Scope, list[str]]] = []
    if industry is not None and sector is not None:
        tiers.append(("industry", same_industry))
    if sector is not None:
        tiers.append(("sector", sector_members))
    if industry is not None:
        elsewhere = sorted(
            t for t, other in snapshot.industries.items()
            if other == industry and t != ticker and t in snapshot.company_sector and t not in sector_members
        )
        tiers.append(("industry_wide", sector_members + elsewhere))
    for scope, members in tiers:
        if len(members) >= MIN_PEERS:
            return Pool(scope, members, len(same_industry))
    # None is wide enough: the widest non-empty one (an earlier one on a tie).
    best: tuple[Scope, list[str]] | None = None
    for scope, members in tiers:
        if members and (best is None or len(members) > len(best[1])):
            best = (scope, members)
    if best is None:
        return Pool(None, [], len(same_industry))
    return Pool(best[0], best[1], len(same_industry))


@dataclass
class Match:
    symbol: str
    score: float
    coverage: float
    #: metric → similarity (0–1) of the components both companies have.
    components: dict[str, float]
    #: Components the stock has and this company lacks.
    missing: list[str]


def score_candidate(snapshot: SectorSnapshot, ticker: str, candidate: str) -> Match:
    """The weighted similarity of ``candidate`` to ``ticker`` (formula in the module doc)."""
    components: dict[str, float] = {}
    missing: list[str] = []
    possible = 0.0
    earned = 0.0
    compared = 0.0
    own_industry = snapshot.industries.get(ticker)
    for metric, weight in WEIGHTS.items():
        if metric == "industry":
            if own_industry is None:
                continue
            possible += weight
            other_industry = snapshot.industries.get(candidate)
            if other_industry is None:
                missing.append(metric)
                continue
            similarity = 1.0 if other_industry == own_industry else 0.0
        else:
            own = _value(snapshot, ticker, metric)
            if own is None:
                continue
            possible += weight
            other = _value(snapshot, ticker=candidate, metric=metric)
            if other is None:
                missing.append(metric)
                continue
            similarity = SIMILARITY[metric](own, other)
        components[metric] = similarity
        earned += weight * similarity
        compared += weight
    score = 100.0 * earned / possible if possible else 0.0
    coverage = compared / possible if possible else 0.0
    return Match(symbol=candidate, score=score, coverage=coverage, components=components, missing=missing)


def _industry_block(snapshot: SectorSnapshot, key: str | None) -> dict[str, Any] | None:
    if key is None:
        return None
    return {"key": key, "name": snapshot.industry_labels.get(key, key)}


def _values(snapshot: SectorSnapshot, ticker: str) -> dict[str, float]:
    own = snapshot.values.get(ticker, {})
    return {metric: _r(own[metric]) for metric in VALUE_METRICS if metric in own}


def reasons(snapshot: SectorSnapshot, ticker: str, match: Match, pool: Pool) -> list[dict[str, Any]]:
    """Why ``match`` was picked: the shared sub-sector/sector, then each close metric (most weight first).

    Every metric reason carries both companies' values; a metric is only named when both exist.
    """
    out: list[dict[str, Any]] = []
    peer = match.symbol
    industry = snapshot.industries.get(ticker)
    if industry is not None and snapshot.industries.get(peer) == industry:
        out.append({"type": "same_industry", "industry": _industry_block(snapshot, industry)})
    sector = snapshot.company_sector.get(ticker)
    if sector is not None and snapshot.company_sector.get(peer) == sector:
        out.append({
            "type": "same_sector",
            "sector": sector,
            # The sub-sector had too few companies: the comparison was widened to the KAP sector.
            "fallback": pool.scope != "industry",
        })
    close = [
        (metric, similarity) for metric, similarity in match.components.items()
        if metric != "industry" and similarity >= REASON_MIN_SIMILARITY
    ]
    close.sort(key=lambda item: (-WEIGHTS[item[0]] * item[1], item[0]))
    for metric, similarity in close:
        own = _value(snapshot, ticker, metric)
        other = _value(snapshot, peer, metric)
        if own is None or other is None:  # pragma: no cover - components only hold metrics both have
            continue
        entry: dict[str, Any] = {
            "metric": metric,
            "value": _r(own),
            "peer_value": _r(other),
            "similarity": _r(similarity, 3),
        }
        if metric in ("market_cap", "revenue"):
            out.append({"type": "similar_size", **entry, "ratio": _r(other / own, 3)})
        else:
            out.append({"type": "close_metric", **entry, "difference": _r(other - own)})
    return out


def peers_view(snapshot: SectorSnapshot, ticker: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    """``/fundamentals/{t}/peers``: the most similar companies, best first, each with its score,
    the reasons and the figures to set side by side."""
    ticker = ticker.upper()
    limit = max(1, min(limit, MAX_LIMIT))
    base: dict[str, Any] = {
        "ticker": ticker,
        "min_peers": MIN_PEERS,
        "weights": dict(WEIGHTS),
        "reason_min_similarity": REASON_MIN_SIMILARITY,
    }
    sector_key = snapshot.company_sector.get(ticker)
    if sector_key is None:
        return {**base, "available": False, "scope": None, "fallback": False, "sector": None, "industry": None,
                "company": None, "unavailable": [], "candidates": 0, "peers": []}

    pool = candidate_pool(snapshot, ticker)
    matches = [score_candidate(snapshot, ticker, candidate) for candidate in pool.members]
    own_cap = _value(snapshot, ticker, "market_cap")

    def size_gap(match: Match) -> float:
        other = _value(snapshot, match.symbol, "market_cap")
        return abs(math.log(other / own_cap)) if own_cap is not None and other is not None else math.inf

    # Best score first; a tie goes to the better-covered, then the closer in size, then A→Z.
    matches.sort(key=lambda m: (-round(m.score, 6), -round(m.coverage, 6), size_gap(m), m.symbol))

    industry = snapshot.industries.get(ticker)
    unavailable = [
        metric for metric in WEIGHTS
        if (industry is None if metric == "industry" else _value(snapshot, ticker, metric) is None)
    ]
    sector = snapshot.sectors[sector_key]
    peers = []
    for match in matches[:limit]:
        peer: dict[str, Any] = {
            "symbol": match.symbol,
            "name": snapshot.names.get(match.symbol),
            "score": round(match.score, 1),
            "coverage": _r(match.coverage, 3),
            "sector": snapshot.company_sector.get(match.symbol),
            "industry": _industry_block(snapshot, snapshot.industries.get(match.symbol)),
            "reasons": reasons(snapshot, ticker, match, pool),
            "components": {metric: _r(value, 3) for metric, value in match.components.items()},
            "missing": match.missing,
            "values": _values(snapshot, match.symbol),
        }
        if match.symbol in snapshot.loss:
            peer["loss"] = True
        peers.append(peer)

    industry_block = _industry_block(snapshot, industry)
    if industry_block is not None:
        # Companies of the sub-sector within the KAP sector, the stock included.
        industry_block["count"] = pool.industry_count + 1
    company: dict[str, Any] = {
        "symbol": ticker,
        "name": snapshot.names.get(ticker),
        "values": _values(snapshot, ticker),
    }
    if ticker in snapshot.loss:
        company["loss"] = True
    return {
        **base,
        "available": True,
        "scope": pool.scope,
        "fallback": pool.scope not in (None, "industry"),
        "sector": {"key": sector.key, "name": sector.name, "count": len(sector.members)},
        "industry": industry_block,
        "company": company,
        "unavailable": unavailable,
        "candidates": len(pool.members),
        "peers": peers,
    }


async def get_peers_view(ticker: str, limit: int = DEFAULT_LIMIT) -> dict[str, Any]:
    snapshot = await sector_snapshot()
    return with_meta(peers_view(snapshot, ticker, limit), snapshot_meta(snapshot, _NOTE_METHOD))


__all__ = [
    "DEFAULT_LIMIT",
    "MAX_LIMIT",
    "MIN_PEERS",
    "REASON_MIN_SIMILARITY",
    "WEIGHTS",
    "candidate_pool",
    "get_peers_view",
    "peers_view",
    "reasons",
    "score_candidate",
]
