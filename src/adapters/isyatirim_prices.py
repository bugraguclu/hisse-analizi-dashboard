"""İş Yatırım fiyat uçları — resmî günlük geçmiş (``HisseTekil``) ve anlık kotasyon (``OneEndeks``).

Both endpoints are public JSON handlers of isyatirim.com.tr (~0.1 s per request
on a warm connection). They are the reconciliation and fallback source of the
market store (docs/data-platform.md §2):

* :func:`fetch_daily_history` — one row per session. ``HG_*`` fields are the
  prices as they were traded (**unadjusted**); ``HGDG_*`` fields are adjusted
  for capital increases **and dividends** (total-return basis). TradingView's
  bars are adjusted for splits/bonus issues only, so neither İş Yatırım series
  equals the stored series before the last corporate action — after it all three
  coincide. The rows carry no opening price. ``HG_HACIM`` is the TL turnover,
  ``HG_AOF`` the session VWAP ("ağırlıklı ortalama fiyat") and ``SERMAYE`` the
  paid-in capital (a change marks a capital increase).
* :func:`fetch_quote` — last/open/high/low, previous close (``dayClose``),
  bid/ask, TL turnover (``volume``) and lot quantity (``quantity``), plus the
  company's paid-in capital (``capital`` — TL, 1 TL nominal per lot, so it is the
  share count BIST/İş Yatırım value the company with) and the parent-company
  equity of the latest reported quarter (``equity`` — equals the fundamentals
  store's ``parent_equity``, e.g. BIMAS 2026/06 201,353,398,000). During the
  session ``updateDate`` equals TradingView's ``update_time`` (the same ~15 minute
  delayed feed); after the close it stays at the session end (18:09:5x). The
  ``quantity``/``volume`` of a finished session are the official totals: they
  include the trades at the closing price that TradingView's same-day ``volume``
  misses (2026-09-23: SASA +19,999,998 lots, KCHOL +607,900). Overnight (seen at
  08:05) the row is reset for the next session — ``quantity``/``volume``/``high``/
  ``low``/``bid``/``ask`` are 0 and ``dayClose`` is the last close — while
  ``updateDate`` still names the previous session's 18:09:5x: such a row carries no
  session figures (``session_date``/``volume``/``turnover`` = ``None``) and is not used
  as a fallback quote. Indices (``XUSIN``, which the TradingView scanner lacks) work too.

Errors follow the adapter convention: :class:`MarketDataError` (503 transport,
502 payload) and :class:`SymbolNotFoundError` for unknown symbols.
"""

from __future__ import annotations

import asyncio
import weakref
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

import httpx
import structlog

from src.adapters.utils import (
    ISTANBUL_TZ,
    MarketDataError,
    SymbolNotFoundError,
    finite_float,
    get_http_client,
)

logger = structlog.get_logger(__name__)

SOURCE = "isyatirim"
BASE_URL = "https://www.isyatirim.com.tr/_layouts/15/IsYatirim.Website/Common/Data.aspx"
HISTORY_URL = f"{BASE_URL}/HisseTekil"
QUOTE_URL = f"{BASE_URL}/OneEndeks"
# The free feed shares TradingView's 15 minute delay (identical update times).
QUOTE_DELAY_SECONDS = 900

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.isyatirim.com.tr/tr-tr/analiz/hisse/Sayfalar/default.aspx",
}
_QUOTE_TIMEOUT = httpx.Timeout(8.0, connect=5.0)
# A 5-year history is ~1 MB and takes a few seconds on a cold server.
_HISTORY_TIMEOUT = httpx.Timeout(45.0, connect=5.0)
# İş Yatırım sits behind a WAF: keep the request rate modest.
_MAX_CONCURRENCY = 4
_semaphores: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = weakref.WeakKeyDictionary()
_DATE_FORMAT = "%d-%m-%Y"


def _semaphore() -> asyncio.Semaphore:
    """Per event loop (a semaphore is bound to the loop that first waits on it)."""
    loop = asyncio.get_running_loop()
    semaphore = _semaphores.get(loop)
    if semaphore is None:
        semaphore = _semaphores[loop] = asyncio.Semaphore(_MAX_CONCURRENCY)
    return semaphore


@dataclass(frozen=True)
class IsyDailyRow:
    """One ``HisseTekil`` session row (prices in TL, ``None`` when missing)."""

    symbol: str
    bar_date: date
    close: float | None  # HG_KAPANIS — as traded (unadjusted)
    low: float | None  # HG_MIN
    high: float | None  # HG_MAX
    vwap: float | None  # HG_AOF — session VWAP (unadjusted)
    turnover: float | None  # HG_HACIM — TL
    close_adjusted: float | None  # HGDG_KAPANIS — capital increases + dividends adjusted
    vwap_adjusted: float | None  # HGDG_AOF
    capital: float | None  # SERMAYE — paid-in capital (TL, 1 TL nominal per share)
    market_cap: float | None  # PD
    free_float_market_cap: float | None  # HAO_PD
    usd_close: float | None  # DOLAR_BAZLI_FIYAT
    xu100_close: float | None  # END_DEGER — BIST 100 close of the same session

    @property
    def lots(self) -> float | None:
        """Traded quantity implied by turnover / VWAP (İş Yatırım publishes no lot count)."""
        if self.turnover is None or not self.vwap:
            return None
        return self.turnover / self.vwap


def _positive(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number > 0 else None


def _non_negative(value: Any) -> float | None:
    number = finite_float(value)
    return number if number is not None and number >= 0 else None


def _parse_date(value: Any) -> date | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value.strip()[:10], _DATE_FORMAT).date()
    except ValueError:
        return None


def parse_history_row(symbol: str, row: dict[str, Any]) -> IsyDailyRow | None:
    """``HisseTekil`` row → :class:`IsyDailyRow` (``None`` without a date or close)."""
    bar_date = _parse_date(row.get("HGDG_TARIH"))
    close = _positive(row.get("HG_KAPANIS"))
    if bar_date is None or close is None:
        return None
    return IsyDailyRow(
        symbol=symbol,
        bar_date=bar_date,
        close=close,
        low=_positive(row.get("HG_MIN")),
        high=_positive(row.get("HG_MAX")),
        vwap=_positive(row.get("HG_AOF")),
        turnover=_non_negative(row.get("HG_HACIM")),
        close_adjusted=_positive(row.get("HGDG_KAPANIS")),
        vwap_adjusted=_positive(row.get("HGDG_AOF")),
        capital=_positive(row.get("SERMAYE")),
        market_cap=_positive(row.get("PD")),
        free_float_market_cap=_positive(row.get("HAO_PD")),
        usd_close=_positive(row.get("DOLAR_BAZLI_FIYAT")),
        xu100_close=_positive(row.get("END_DEGER")),
    )


async def _get_json(url: str, params: dict[str, str], timeout: httpx.Timeout, symbol: str) -> Any:
    response: httpx.Response | None = None
    async with _semaphore():
        for attempt in (1, 2):  # one retry: the server occasionally stalls or resets a connection
            try:
                response = await get_http_client().get(url, params=params, headers=_HEADERS, timeout=timeout)
                break
            except httpx.HTTPError as e:
                logger.warning(
                    "isyatirim_unreachable",
                    url=url.rsplit("/", 1)[-1],
                    symbol=symbol,
                    attempt=attempt,
                    error=f"{type(e).__name__}: {e}",
                )
                if attempt == 2 or not isinstance(e, httpx.TransportError):
                    raise MarketDataError("İş Yatırım verisine ulaşılamadı", status_code=503) from e
                await asyncio.sleep(1.5)
    assert response is not None
    if response.status_code >= 400:
        logger.warning("isyatirim_http_error", symbol=symbol, status=response.status_code)
        status = 503 if response.status_code == 429 or response.status_code >= 500 else 502
        raise MarketDataError("İş Yatırım isteği reddetti", status_code=status)
    try:
        return response.json()
    except ValueError as e:
        # The WAF answers blocked clients with an HTML page.
        raise MarketDataError("İş Yatırım'dan geçersiz yanıt alındı", status_code=503) from e


def _raise_for_error_payload(body: Any, symbol: str) -> None:
    error = body.get("error") if isinstance(body, dict) else None
    if not error:
        return
    code = error.get("code") if isinstance(error, dict) else None
    message = str(error.get("message") if isinstance(error, dict) else error)
    if code == "EINVAL" or "not allowed" in message.lower():
        raise SymbolNotFoundError(symbol)
    raise MarketDataError("İş Yatırım verisi alınamadı")


async def fetch_daily_history(symbol: str, start: date, end: date) -> list[IsyDailyRow]:
    """Official daily rows of ``symbol`` between ``start`` and ``end`` (inclusive), oldest first."""
    body = await _get_json(
        HISTORY_URL,
        {"hisse": symbol, "startdate": start.strftime(_DATE_FORMAT), "enddate": end.strftime(_DATE_FORMAT)},
        _HISTORY_TIMEOUT,
        symbol,
    )
    _raise_for_error_payload(body, symbol)
    values = body.get("value") if isinstance(body, dict) else None
    if isinstance(body, dict) and body.get("ok") is False:
        raise MarketDataError("İş Yatırım verisi alınamadı")
    rows: dict[date, IsyDailyRow] = {}
    for raw in values if isinstance(values, list) else []:
        if isinstance(raw, dict):
            parsed = parse_history_row(symbol, raw)
            if parsed is not None:
                rows[parsed.bar_date] = parsed
    return [rows[d] for d in sorted(rows)]


def _parse_update_time(value: Any) -> datetime | None:
    """``"2026-09-23T18:09:59.000+03"`` → aware datetime (Istanbul when no offset)."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if len(text) >= 3 and text[-3] in "+-" and text[-2:].isdigit():
        text = f"{text}:00"  # "+03" → "+03:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=ISTANBUL_TZ)


def parse_quote(symbol: str, row: dict[str, Any]) -> dict[str, Any] | None:
    """``OneEndeks`` row → quote fields (``None`` without a positive last price).

    ``volume`` is the lot quantity (``quantity``) so it is comparable with the
    TradingView volume; ``turnover`` is İş Yatırım's TL volume. ``capital``
    (paid-in capital, TL) and ``equity`` (latest-quarter parent equity, TL) are
    ``None`` for indices. ``session_date`` is the Istanbul day of ``updateDate`` —
    ``None`` (with ``volume``/``turnover``) for a row without trades (no high/low):
    the overnight reset keeps the previous session's ``updateDate``.
    """
    last = _positive(row.get("last"))
    if last is None:
        return None
    traded = _positive(row.get("high")) is not None and _positive(row.get("low")) is not None
    prev_close = _positive(row.get("dayClose"))
    change = round(last - prev_close, 6) if prev_close is not None else None
    change_pct = round((last - prev_close) / prev_close * 100, 6) if prev_close is not None else None
    quote_time = _parse_update_time(row.get("updateDate"))
    return {
        "symbol": str(row.get("symbol") or symbol).upper(),
        "last": last,
        "open": _positive(row.get("open")),
        "high": _positive(row.get("high")),
        "low": _positive(row.get("low")),
        "prev_close": prev_close,
        "change": change,
        "change_percent": change_pct,
        "volume": _non_negative(row.get("quantity")) if traded else None,
        "turnover": _non_negative(row.get("volume")) if traded else None,
        "bid": _positive(row.get("bid")),
        "ask": _positive(row.get("ask")),
        "quote_time": quote_time,
        "timestamp": int(quote_time.timestamp()) if quote_time else None,
        "updated_at": quote_time.astimezone(ISTANBUL_TZ).isoformat() if quote_time else None,
        "session_date": quote_time.astimezone(ISTANBUL_TZ).date() if quote_time and traded else None,
        "capital": _positive(row.get("capital")),
        "equity": finite_float(row.get("equity")),
    }


async def fetch_quote(symbol: str) -> dict[str, Any]:
    """Delayed İş Yatırım quote of a stock or index (see :func:`parse_quote`)."""
    body = await _get_json(QUOTE_URL, {"endeks": symbol}, _QUOTE_TIMEOUT, symbol)
    _raise_for_error_payload(body, symbol)
    row = body[0] if isinstance(body, list) and body and isinstance(body[0], dict) else None
    quote = parse_quote(symbol, row) if row is not None else None
    if quote is None:
        raise SymbolNotFoundError(symbol)
    return quote


def _is_index(symbol: str) -> bool:
    try:
        from borsapy.index import INDICES
    except ImportError:  # pragma: no cover - borsapy is a hard dependency
        return False
    return symbol in INDICES


async def fetch_isyatirim_quotes(symbols: list[str] | tuple[str, ...]) -> dict[str, dict[str, Any]]:
    """Fallback quotes for ``symbols`` in the canonical quote shape; failures are skipped.

    Adds ``source``/``delay_seconds``/``session_date``/``type`` so the rows can be
    stored next to TradingView quotes. ``session_date`` is the Istanbul date of
    the provider's update time.
    """

    async def one(symbol: str) -> tuple[str, dict[str, Any] | None]:
        try:
            quote = await fetch_quote(symbol)
        except MarketDataError as e:
            logger.info("isyatirim_quote_unavailable", symbol=symbol, error=e.message)
            return symbol, None
        quote.pop("quote_time", None)
        if quote.get("session_date") is None:  # between sessions (overnight reset): nothing to show
            logger.info("isyatirim_quote_between_sessions", symbol=symbol)
            return symbol, None
        return symbol, {
            **quote,
            "symbol": symbol,
            "name": None,
            "type": "index" if _is_index(symbol) else "stock",
            "currency": "TRY",
            "market_cap": None,
            "source": SOURCE,
            "delay_seconds": QUOTE_DELAY_SECONDS,
        }

    results = await asyncio.gather(*(one(symbol) for symbol in dict.fromkeys(symbols)))
    return {symbol: quote for symbol, quote in results if quote is not None}
