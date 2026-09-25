"""Hisse tarama evreni — tüm BIST hisseleri tek tabloda (fiyat, oranlar, teknik, analist).

/tarama sayfası bu tabloyu bir kez çeker; filtreleme, sıralama ve sayfalama
tarayıcıda yapılır (~600 satır). Böylece ekranda görünen değer ile filtrelenen
değer her zaman aynı kaynaktan gelir. (İş Yatırım taramasında filtre İş Yatırım
oranıyla yapılıyor, tabloda ise o oran hiç gösterilmiyordu.)

Kaynaklar:
- Hisse listesi ve adları: İş Yatırım (``list_companies``, 6 saat önbellek).
- Fiyat, günlük değişim, oranlar, teknik göstergeler, performans, sektör:
  TradingView tarayıcısı — tüm hisseler tek istekte (akış 15 dk gecikmeli).
- Analist önerisi, hedef fiyat ve yabancı oranı: İş Yatırım. İş Yatırım bir
  kriteri boş olan hisseyi sonuçtan attığı için her kriter ayrı istekle alınır
  ve sembole göre birleştirilir. Piyasa değeri yedeği şirket listesinden gelir.
- Endeks üyelikleri: Borsa İstanbul endeks bileşenleri CSV'si (borsapy).

TradingView verisi alınamazsa tablo anlamsızlaşacağı için 503 döner; analist ve
endeks verisi alınamazsa tablo yine döner, ``warnings`` ilgili kodu içerir.
"""

import asyncio
import re
from collections import Counter
from typing import Any

import structlog

from src.adapters.screener_adapter import ALL_STOCKS_CRITERION, EXCLUDED_SYMBOLS
from src.adapters.search_adapter import list_companies
from src.adapters.utils import (
    TTL_COMPANY_LIST,
    TTL_COMPANY_METRICS,
    TTL_MARKET,
    MarketDataError,
    cached,
    df_to_records,
    error_payload,
    finite_float,
    run_sync,
    tradingview_scan,
    upstream_failure,
)
from src.core.time import utcnow

logger = structlog.get_logger(__name__)

SOURCE = "TradingView + İş Yatırım + Borsa İstanbul (borsapy)"
# The free TradingView feed for BIST is delayed (update_mode "delayed_streaming_900").
PRICE_DELAY_MINUTES = 15

# Indices offered as screening universes; every row lists the ones it belongs to.
UNIVERSE_INDICES: tuple[str, ...] = (
    "XU030", "XU050", "XU100", "XKTUM", "XK030", "XTMTU", "XHARZ",
    "XBANK", "XUSIN", "XUHIZ", "XUMAL", "XUTEK", "XHOLD", "XGMYO",
)

_TV_COLUMNS: tuple[str, ...] = (
    "close", "change", "Value.Traded", "average_volume_30d_calc", "market_cap_basic",
    "description", "sector", "sector.tr", "industry", "industry.tr",
    "price_earnings_ttm", "earnings_per_share_basic_ttm", "price_book_fq",
    "enterprise_value_ebitda_ttm", "dividends_yield_current", "dividends_yield",
    "return_on_equity", "net_margin",
    "RSI", "SMA50", "SMA200", "SMA50[1]", "SMA200[1]", "Recommend.All",
    "relative_volume_10d_calc", "price_52_week_high", "price_52_week_low",
    "Perf.W", "Perf.1M", "Perf.3M", "Perf.YTD", "Perf.Y",
)

# İş Yatırım criteria (borsapy ``Screener.add_filter`` names → result column ids).
_ISY_CRITERIA: dict[str, str] = {
    "target_price": "51",   # analyst target price (TL)
    "foreign_ratio": "40",  # current foreign ownership (%)
}
_ISY_RECOMMENDATIONS: tuple[str, ...] = ("AL", "TUT", "SAT")
_ISY_CONCURRENCY = 3
# Wide enough to never exclude a value; İş Yatırım still drops rows without one.
_ISY_WIDE_BOUND = 1_000_000_000


WARNING_ANALYST = "analyst"
WARNING_INDICES = "indices"


# ---------------------------------------------------------------------------
# İş Yatırım (analyst metrics)
# ---------------------------------------------------------------------------

def _isy_screen_sync(criterion: str | None = None, recommendation: str | None = None) -> list[dict[str, Any]]:
    from borsapy.screener import Screener

    screener = Screener()
    if criterion:
        screener.add_filter(criterion, min=-_ISY_WIDE_BOUND, max=_ISY_WIDE_BOUND)
    else:
        # İş Yatırım needs one criterion; this one keeps every listed stock
        # (the price criterion would drop shares priced at 1,000 TL or more).
        name, low, high = ALL_STOCKS_CRITERION
        screener.add_filter(name, min=low, max=high)
    if recommendation:
        screener.set_recommendation(recommendation)
    return df_to_records(screener.run())


@cached(TTL_COMPANY_METRICS, "screener_universe")
async def _isy_criterion(name: str) -> dict[str, float]:
    """``{SYMBOL: value}`` for one İş Yatırım criterion (rows without a value are absent)."""
    column = f"criteria_{_ISY_CRITERIA[name]}"
    rows = await run_sync(_isy_screen_sync, name)
    values: dict[str, float] = {}
    for row in rows:
        symbol = str(row.get("symbol") or "").strip().upper()
        value = finite_float(row.get(column))
        if symbol and value is not None:
            values[symbol] = value
    if not values:
        # A criterion that exists for hundreds of stocks never comes back empty.
        raise MarketDataError(f"İş Yatırım '{name}' verisi boş döndü", status_code=503)
    return values


@cached(TTL_COMPANY_METRICS, "screener_universe")
async def _isy_recommendations(recommendation: str) -> list[str]:
    """Symbols İş Yatırım research currently rates ``recommendation`` (AL/TUT/SAT)."""
    rows = await run_sync(_isy_screen_sync, None, recommendation)
    return sorted({str(row.get("symbol") or "").strip().upper() for row in rows} - {""})


async def _analyst_metrics() -> tuple[dict[str, dict[str, Any]], bool]:
    """Per-symbol İş Yatırım fields and whether every request succeeded.

    Each criterion is cached on its own, so one failing request only blanks its
    own column (and is retried on the next refresh) instead of all of them.
    """
    semaphore = asyncio.Semaphore(_ISY_CONCURRENCY)

    async def bounded(awaitable: Any) -> Any:
        async with semaphore:
            return await awaitable

    names = list(_ISY_CRITERIA)
    results = await asyncio.gather(
        *(bounded(_isy_criterion(name)) for name in names),
        *(bounded(_isy_recommendations(rec)) for rec in _ISY_RECOMMENDATIONS),
        return_exceptions=True,
    )
    complete = True
    metrics: dict[str, dict[str, Any]] = {}
    for name, result in zip(names, results[: len(names)]):
        if isinstance(result, BaseException):
            complete = False
            logger.warning("screener_universe_isy_failed", criterion=name, error=str(result))
            continue
        for symbol, value in result.items():
            metrics.setdefault(symbol, {})[name] = value

    rated: list[tuple[str, list[str]]] = []
    failures: list[str] = []
    for recommendation, result in zip(_ISY_RECOMMENDATIONS, results[len(names):]):
        if isinstance(result, BaseException):
            failures.append(str(result))
        else:
            rated.append((recommendation, result))
    if failures:
        # A partial set would mislabel the missing ratings as "no rating".
        complete = False
        logger.warning("screener_universe_isy_recommendations_failed", errors=failures)
    else:
        for recommendation, symbols in rated:
            for symbol in symbols:
                metrics.setdefault(symbol, {})["recommendation"] = recommendation
    return metrics, complete


# ---------------------------------------------------------------------------
# Borsa İstanbul index membership
# ---------------------------------------------------------------------------

def _index_components_sync() -> dict[str, list[str]]:
    import borsapy as bp

    return {code: [str(s).upper() for s in bp.Index(code).component_symbols] for code in UNIVERSE_INDICES}


@cached(TTL_COMPANY_LIST, "screener_universe")
async def _index_memberships() -> dict[str, list[str]]:
    """``{INDEX: [SYMBOL, ...]}`` for :data:`UNIVERSE_INDICES`."""
    components: dict[str, list[str]] = await run_sync(_index_components_sync)
    if not any(components.values()):
        # borsapy returns [] for every index when the CSV download fails.
        raise MarketDataError("Endeks bileşen listesi alınamadı", status_code=503)
    return components


# ---------------------------------------------------------------------------
# Row assembly
# ---------------------------------------------------------------------------

def _positive(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number > 0 else None


def _rounded(value: float | None, digits: int) -> float | None:
    return None if value is None else round(value, digits)


def _whole(value: float | None) -> int | None:
    return None if value is None else int(round(value))


def _distance_pct(value: float | None, reference: float | None) -> float | None:
    """How far ``value`` is above (+) or below (−) ``reference``, in percent."""
    if value is None or reference is None or reference <= 0:
        return None
    return (value / reference - 1) * 100


def _sma_cross(market: dict[str, Any]) -> str | None:
    """SMA50/SMA200 cross on the latest daily bar: ``"golden"`` (up) or ``"death"`` (down)."""
    sma50, sma200 = finite_float(market.get("SMA50")), finite_float(market.get("SMA200"))
    prev50, prev200 = finite_float(market.get("SMA50[1]")), finite_float(market.get("SMA200[1]"))
    if sma50 is None or sma200 is None or prev50 is None or prev200 is None:
        return None
    if prev50 <= prev200 and sma50 > sma200:
        return "golden"
    if prev50 >= prev200 and sma50 < sma200:
        return "death"
    return None


def build_row(
    company: dict[str, Any],
    market: dict[str, Any],
    analyst: dict[str, Any],
    indices: list[str],
) -> dict[str, Any]:
    """One screener row. Missing values are omitted, not sent as ``null``.

    Units: prices in TL; ``market_cap``/``turnover``/``avg_turnover`` in TL;
    ``change_pct``, ratios in percent (``dividend_yield``, ``roe``, ``net_margin``,
    ``upside``, ``foreign_ratio``, ``perf_*``, ``*_dist``); ``pe``/``pb``/``ev_ebitda``
    as multiples; ``tech_rating`` is TradingView's Recommend.All (−1 … +1).
    """
    symbol = str(company.get("symbol") or "").strip().upper()
    close = _positive(market.get("close"))

    market_cap = _positive(market.get("market_cap_basic"))
    if market_cap is None:
        # The company list comes from İş Yatırım's market-cap criterion (million TL).
        isy_cap = _positive(company.get("criteria_8"))
        market_cap = isy_cap * 1e6 if isy_cap is not None else None

    avg_volume = _positive(market.get("average_volume_30d_calc"))
    eps = finite_float(market.get("earnings_per_share_basic_ttm"))
    pe = _positive(market.get("price_earnings_ttm"))
    dividend_yield = finite_float(market.get("dividends_yield_current"))
    if dividend_yield is None:
        dividend_yield = finite_float(market.get("dividends_yield"))
    target = _positive(analyst.get("target_price"))

    row: dict[str, Any] = {
        "symbol": symbol,
        # İş Yatırım leaves a few names empty (MARMR); TradingView's legal name fills in.
        "name": str(company.get("name") or "").strip() or str(market.get("description") or "").strip() or None,
        "sector": market.get("sector") or None,
        "industry": market.get("industry") or None,
        "indices": indices or None,
        "close": _rounded(close, 4),
        "change_pct": _rounded(finite_float(market.get("change")), 2) if close is not None else None,
        "turnover": _whole(finite_float(market.get("Value.Traded"))),
        # 30-day average share volume valued at the last price (liquidity proxy).
        "avg_turnover": _whole(avg_volume * close) if avg_volume is not None and close is not None else None,
        "market_cap": _whole(market_cap),
        "pe": _rounded(pe, 2),
        # Loss-making over the last 12 months: P/E is undefined, not missing data.
        "loss": True if pe is None and eps is not None and eps < 0 else None,
        "pb": _rounded(_positive(market.get("price_book_fq")), 2),
        "ev_ebitda": _rounded(_positive(market.get("enterprise_value_ebitda_ttm")), 2),
        "dividend_yield": _rounded(dividend_yield, 2),
        "roe": _rounded(finite_float(market.get("return_on_equity")), 2),
        "net_margin": _rounded(finite_float(market.get("net_margin")), 2),
        "rsi": _rounded(finite_float(market.get("RSI")), 1),
        "sma50_dist": _rounded(_distance_pct(close, _positive(market.get("SMA50"))), 2),
        "sma200_dist": _rounded(_distance_pct(close, _positive(market.get("SMA200"))), 2),
        "cross": _sma_cross(market),
        "tech_rating": _rounded(finite_float(market.get("Recommend.All")), 3),
        "rel_volume": _rounded(finite_float(market.get("relative_volume_10d_calc")), 2),
        "high_52w_dist": _rounded(_distance_pct(close, _positive(market.get("price_52_week_high"))), 2),
        "low_52w_dist": _rounded(_distance_pct(close, _positive(market.get("price_52_week_low"))), 2),
        "perf_1w": _rounded(finite_float(market.get("Perf.W")), 2),
        "perf_1m": _rounded(finite_float(market.get("Perf.1M")), 2),
        "perf_3m": _rounded(finite_float(market.get("Perf.3M")), 2),
        "perf_ytd": _rounded(finite_float(market.get("Perf.YTD")), 2),
        "perf_1y": _rounded(finite_float(market.get("Perf.Y")), 2),
        "recommendation": analyst.get("recommendation"),
        "target_price": _rounded(target, 2),
        "upside": _rounded(_distance_pct(target, close), 2),
        "foreign_ratio": _rounded(finite_float(analyst.get("foreign_ratio")), 2),
    }
    return {key: value for key, value in row.items() if value is not None}


# TradingView calls this group "Çeşitli Hizmetler", but it holds investment trusts
# and holdings, not services.
_TR_LABEL_FIXES: dict[str, str] = {"Miscellaneous": "Çeşitli"}
_WORD_RE = re.compile(r"\w+")


def _sentence_case(label: str) -> str:
    """TradingView mixes "Elektrik, Su, Gaz Hizmetleri" with "Ticari hizmetler";
    lower-case every capitalised word after the first (acronyms stay)."""

    def lower(match: re.Match[str]) -> str:
        word = match.group()
        if not (word[0].isupper() and word[1:].islower()):
            return word
        return {"İ": "i", "I": "ı"}.get(word[0], word[0].lower()) + word[1:]

    first = _WORD_RE.search(label)
    head = first.end() if first else 0
    return label[:head] + _WORD_RE.sub(lower, label[head:])


def _labels(market_by_symbol: dict[str, dict[str, Any]], key: str) -> dict[str, str]:
    """English key → Turkish label (TradingView ``sector``/``sector.tr`` pairs)."""
    labels: dict[str, str] = {}
    for market in market_by_symbol.values():
        english, turkish = market.get(key), market.get(f"{key}.tr")
        if not isinstance(english, str) or not english:
            continue
        if english in _TR_LABEL_FIXES:
            labels[english] = _TR_LABEL_FIXES[english]
        elif isinstance(turkish, str) and turkish and labels.get(english, english) == english:
            labels[english] = _sentence_case(turkish)
        else:
            labels.setdefault(english, english)
    return labels


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def _company_list() -> list[dict[str, Any]]:
    """Listed stocks (İş Yatırım), one entry per symbol, without :data:`EXCLUDED_SYMBOLS`."""
    payload = await list_companies()
    failure = upstream_failure(payload)
    if failure is not None:
        raise MarketDataError(failure[1], status_code=failure[0])
    companies: dict[str, dict[str, Any]] = {}
    for company in payload.get("companies", []):
        if not isinstance(company, dict):
            continue
        symbol = str(company.get("symbol") or "").strip().upper()
        if symbol and symbol not in EXCLUDED_SYMBOLS and symbol not in companies:
            companies[symbol] = {**company, "symbol": symbol}
    if not companies:
        raise MarketDataError("Hisse listesi alınamadı", status_code=503)
    return list(companies.values())


@cached(TTL_MARKET, "screener_universe")
async def get_screener_universe() -> dict:
    """Every BIST stock with price, valuation, profitability, technical and analyst fields."""
    try:
        companies = await _company_list()
        symbols = [company["symbol"] for company in companies]
        fetched_at = utcnow()
        market_result, analyst_result, members_result = await asyncio.gather(
            tradingview_scan(symbols, _TV_COLUMNS),
            _analyst_metrics(),
            _index_memberships(),
            return_exceptions=True,
        )
        if isinstance(market_result, BaseException):
            raise market_result
        if not market_result:
            raise MarketDataError("Piyasa verisi sağlayıcısından boş yanıt alındı", status_code=503)

        warnings: list[str] = []
        if isinstance(analyst_result, BaseException):
            logger.warning("screener_universe_analyst_failed", error=str(analyst_result))
            analyst, analyst_complete = {}, False
        else:
            analyst, analyst_complete = analyst_result
        if not analyst_complete:
            warnings.append(WARNING_ANALYST)

        membership: dict[str, list[str]] = {}
        index_counts: list[dict[str, Any]] = []
        if isinstance(members_result, BaseException):
            logger.warning("screener_universe_indices_failed", error=str(members_result))
            warnings.append(WARNING_INDICES)
        else:
            listed = set(symbols)
            for code in UNIVERSE_INDICES:
                members = [s for s in members_result.get(code, []) if s in listed]
                for symbol in members:
                    membership.setdefault(symbol, []).append(code)
                if members:
                    index_counts.append({"code": code, "count": len(members)})

        rows = []
        for company in companies:
            symbol = company["symbol"]
            rows.append(build_row(company, market_result.get(symbol, {}), analyst.get(symbol, {}), membership.get(symbol, [])))

        sector_counts = Counter(row["sector"] for row in rows if row.get("sector"))
        sector_labels = _labels(market_result, "sector")
        return {
            "as_of": fetched_at.isoformat(),
            "source": SOURCE,
            "delay_minutes": PRICE_DELAY_MINUTES,
            "count": len(rows),
            "priced": sum(1 for row in rows if "change_pct" in row),
            "indices": index_counts,
            "sectors": [
                {"key": key, "name_tr": sector_labels.get(key, key), "count": count}
                for key, count in sorted(sector_counts.items())
            ],
            "industries": _labels(market_result, "industry"),
            "warnings": warnings,
            "rows": rows,
        }
    except Exception as e:
        logger.error("screener_universe_error", error=str(e))
        return {"rows": [], **error_payload(e, "Tarama verileri alınamadı")}
