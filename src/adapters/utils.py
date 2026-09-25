"""Shared adapter utilities — TTL cache, HTTP client, thread offload, serialization,
input normalization and the TradingView scanner client.

All adapters should use these instead of maintaining local copies.
"""

import asyncio
import functools
import math
import re
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable, Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from typing import Any, ParamSpec, TypeVar, cast
from zoneinfo import ZoneInfo

import httpx
import structlog

from src.core.config import settings

logger = structlog.get_logger(__name__)

P = ParamSpec("P")
R = TypeVar("R")

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

# TradingView occasionally uses 1e100 as a missing numeric value.  It is a
# transport sentinel, not a real market value, and must never reach the UI.
INVALID_NUMERIC_SENTINEL_ABS = 1e90


# ---------------------------------------------------------------------------
# Errors — adapters return ``{"error": <short Turkish message>, "error_status": <HTTP code>}``
# ---------------------------------------------------------------------------

class MarketDataError(Exception):
    """Market-data failure carrying a short, user-safe Turkish message.

    ``status_code`` is the HTTP status the API layer should answer with:
    400 invalid input, 404 unknown symbol, 502 bad upstream data,
    503 upstream unreachable / timed out.
    """

    def __init__(self, message: str, *, status_code: int = 502) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class InvalidInputError(MarketDataError, ValueError):
    """Client supplied an invalid symbol/period/filter (HTTP 400)."""

    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=400)


class SymbolNotFoundError(MarketDataError):
    """The upstream provider does not know the symbol (HTTP 404)."""

    def __init__(self, symbol: str) -> None:
        super().__init__(f"Sembol bulunamadı: {symbol}", status_code=404)
        self.symbol = symbol


def error_payload(exc: BaseException, default_message: str) -> dict[str, Any]:
    """Adapter error dict for ``exc`` — never exposes raw exception text."""
    if isinstance(exc, MarketDataError):
        return {"error": exc.message, "error_status": exc.status_code}
    return {"error": default_message, "error_status": 502}


def upstream_failure(payload: Any) -> tuple[int, str] | None:
    """Return ``(status_code, detail)`` when an adapter payload carries an error."""
    if not isinstance(payload, dict):
        return None
    error = payload.get("error")
    if not isinstance(error, str) or not error.strip():
        return None
    status = payload.get("error_status")
    if isinstance(status, int) and not isinstance(status, bool) and 400 <= status < 600:
        return status, error
    return 502, error


# ---------------------------------------------------------------------------
# TTL Cache
# ---------------------------------------------------------------------------

class TTLCache:
    """In-memory TTL cache bounded by LRU eviction. Safe in asyncio context.

    Does NOT cache errors — only successful (non-None) results.
    Entries beyond max_size evict the least recently used key, so the cache
    cannot grow without bound even if expired keys are never read again.
    """

    def __init__(self, max_size: int = 1000):
        self._store: OrderedDict[str, tuple[float, Any]] = OrderedDict()
        self._max_size = max_size

    def get(self, key: str) -> tuple[bool, Any]:
        """Returns (hit, value). hit=False means cache miss or expired."""
        entry = self._store.get(key)
        if entry is None:
            return False, None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return False, None
        self._store.move_to_end(key)
        return True, value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (time.monotonic() + ttl_seconds, value)
        while len(self._store) > self._max_size:
            self._store.popitem(last=False)

    def invalidate(self, key: str) -> None:
        self._store.pop(key, None)

    def clear(self) -> None:
        self._store.clear()

    @property
    def size(self) -> int:
        return len(self._store)


# Module-level cache instance shared by all adapters
adapter_cache = TTLCache()
_inflight_requests: dict[str, asyncio.Task[Any]] = {}

# TTL constants (seconds)
TTL_TECHNICAL = 60          # Technical indicators change fast
TTL_FUNDAMENTALS = 300      # Company info changes less often
TTL_MACRO = 600             # Macro data changes slowly
TTL_MARKET = 120            # Screener/scanner results
TTL_PRICE_SNAPSHOT = 30     # Real-time price snapshots
TTL_QUOTE = 30              # Live quotes (the free TradingView feed is 15 min delayed anyway)
TTL_INTRADAY_BARS = 60      # 1g/5g chart bars
TTL_DAILY_BARS = 120        # Daily bars — the last bar is the session in progress
TTL_LONG_BARS = 300         # Weekly/monthly bars
TTL_COMPANY_METRICS = 3600  # İş Yatırım company card (market cap, F/K, free float)
TTL_COMPANY_LIST = 6 * 3600  # Company universe / symbol search
TTL_STATIC = 24 * 3600      # Static metadata (screener templates)


def _is_cacheable(value: Any) -> bool:
    if value is None:
        return False
    return not (isinstance(value, dict) and "error" in value)


def _cache_key(prefix: str, name: str, args: tuple[Any, ...], kwargs: dict[str, Any]) -> str:
    parts = [prefix, name]
    parts.extend(str(a) for a in args)
    parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
    return ":".join(parts)


class _SharedFailure:
    """A failed shared fetch, re-raised in every waiter.

    The shared task itself finishes normally: if every waiter was cancelled
    first (an optional chart part timed out), a failing task would otherwise
    be logged by asyncio as an unhandled "exception in shielded future".
    """

    __slots__ = ("error",)

    def __init__(self, error: Exception) -> None:
        self.error = error


async def _run_and_store(coro: Awaitable[Any], cache_key: str, ttl_seconds: float) -> Any:
    try:
        result = await coro
    except Exception as e:
        return _SharedFailure(e)
    if _is_cacheable(result):
        adapter_cache.set(cache_key, result, ttl_seconds)
        logger.debug("cache_set", key=cache_key, ttl=ttl_seconds)
    return result


def _forget_inflight(cache_key: str, task: asyncio.Task[Any]) -> None:
    if _inflight_requests.get(cache_key) is task:
        del _inflight_requests[cache_key]
    if not task.cancelled():
        # Every waiter already received the outcome; mark it retrieved so a
        # failure with no remaining waiters does not log "never retrieved".
        task.exception()


def cached(ttl_seconds: float, key_prefix: str) -> Callable[[Callable[P, Awaitable[R]]], Callable[P, Awaitable[R]]]:
    """Decorator for async functions. Caches successful results for ``ttl_seconds``.

    ``None`` and ``{"error": ...}`` payloads are never cached; exceptions
    propagate to every caller. Concurrent calls with identical arguments share
    one in-flight task (single-flight), so a cold dashboard load opens one
    upstream connection per key instead of one per widget. The shared task
    stores its own result, so the work is not wasted when the request that
    started it is cancelled (client navigated away).
    """
    def decorator(func: Callable[P, Awaitable[R]]) -> Callable[P, Awaitable[R]]:
        @functools.wraps(func)
        async def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
            cache_key = _cache_key(key_prefix, func.__name__, args, kwargs)
            hit, value = adapter_cache.get(cache_key)
            if hit:
                logger.debug("cache_hit", key=cache_key)
                return cast(R, value)

            loop = asyncio.get_running_loop()
            task = _inflight_requests.get(cache_key)
            if task is None or task.done() or task.get_loop() is not loop:
                task = loop.create_task(_run_and_store(func(*args, **kwargs), cache_key, ttl_seconds))
                _inflight_requests[cache_key] = task
                task.add_done_callback(functools.partial(_forget_inflight, cache_key))
            outcome = await asyncio.shield(task)
            if isinstance(outcome, _SharedFailure):
                raise outcome.error
            return cast(R, outcome)
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# Shared HTTP Client
# ---------------------------------------------------------------------------

_http_client: httpx.AsyncClient | None = None


def get_http_client() -> httpx.AsyncClient:
    """Get or create a shared async HTTP client with connection pooling."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(
                settings.http_read_timeout,  # varsayilan (write/pool dahil)
                connect=settings.http_connect_timeout,
                read=settings.http_read_timeout,
            ),
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
            ),
            # Docker VM'de IPv6 cikisi yok; IPv6'ya cozulen hostlar (news.google.com)
            # baglanti hatasi veriyor. IPv4'e sabitle.
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        )
    return _http_client


async def close_http_client() -> None:
    """Close the shared HTTP client. Call during shutdown."""
    global _http_client
    if _http_client and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None


# ---------------------------------------------------------------------------
# Thread Offload (replaces asyncio.get_event_loop().run_in_executor)
# ---------------------------------------------------------------------------

# Bounded executor: caps OS threads spawned for sync borsapy/yfinance calls,
# instead of the unbounded default asyncio.to_thread pool. Sized so a slow
# fundamentals scrape cannot starve the (fast) market-data calls queued behind it.
_sync_executor = ThreadPoolExecutor(max_workers=16, thread_name_prefix="adapter-sync")


async def run_sync(func: Callable[..., Any], *args: Any) -> Any:
    """Run a synchronous function in a bounded thread pool executor."""
    loop = asyncio.get_running_loop()
    if args:
        return await loop.run_in_executor(_sync_executor, functools.partial(func, *args))
    return await loop.run_in_executor(_sync_executor, func)


# ---------------------------------------------------------------------------
# DataFrame / Object Serialization
# ---------------------------------------------------------------------------

def df_to_records(df: Any) -> list[dict[str, Any]]:
    """Convert a pandas DataFrame to JSON-serializable list of dicts.

    Handles NaN, Inf, -Inf by converting to None.
    """
    if df is None:
        return []
    if hasattr(df, "empty") and df.empty:
        return []
    try:
        records = df.reset_index().to_dict(orient="records")
    except Exception as e:
        logger.warning("df_to_records_failed", error=str(e))
        return []
    sanitized = sanitize_data(records)
    return sanitized if isinstance(sanitized, list) else []


def _is_numpy_value(value: Any) -> bool:
    # numpy is not imported here: its stubs need Python 3.12 syntax, which the
    # project's mypy target (3.11) cannot parse. float64 is already a float.
    if type(value).__module__ != "numpy" or isinstance(value, float) or not hasattr(value, "tolist"):
        return False
    kind = getattr(getattr(value, "dtype", None), "kind", "")
    return kind not in ("M", "m")  # keep datetime64/timedelta64 untouched


def sanitize_data(value: Any) -> Any:
    """Recursively replace non-finite/provider-sentinel numbers with ``None``.

    Financial values can legitimately be large, so the bound intentionally
    only targets the 1e100-style missing-value sentinel used by TradingView.
    NumPy scalars become plain Python numbers and ``NaT`` becomes ``None``.
    """
    if _is_numpy_value(value):
        value = value.tolist()  # NumPy scalar -> Python scalar, ndarray -> list
    if isinstance(value, float):
        if not math.isfinite(value) or abs(value) >= INVALID_NUMERIC_SENTINEL_ABS:
            return None
        return value
    if isinstance(value, datetime) and value != value:  # pandas.NaT
        return None
    if isinstance(value, dict):
        return {key: sanitize_data(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [sanitize_data(item) for item in value]
    return value


def safe_serialize(obj: Any) -> dict[Any, Any] | list[Any]:
    """Convert any borsapy object to a JSON-serializable dict or list."""
    if obj is None:
        return {}
    if isinstance(obj, (dict, list)):
        return cast(dict[Any, Any] | list[Any], sanitize_data(obj))
    if hasattr(obj, "to_dict"):
        return cast(dict[Any, Any] | list[Any], sanitize_data(obj.to_dict()))
    # Mapping-like objects (e.g. borsapy FastInfo keeps data in _data but
    # exposes keys()/__getitem__) — plain __dict__ scraping would return {}.
    if hasattr(obj, "keys") and callable(obj.keys):
        try:
            return cast(dict[Any, Any], sanitize_data({k: obj[k] for k in obj.keys()}))
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        public = {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
        if public:
            return cast(dict[Any, Any], sanitize_data(public))
    return {"value": str(obj)}


def finite_float(value: Any) -> float | None:
    """``value`` as a finite float, or ``None`` for missing/NaN/Inf/sentinel/bool values."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= INVALID_NUMERIC_SENTINEL_ABS:
        return None
    return number


# ---------------------------------------------------------------------------
# Symbol normalization
# ---------------------------------------------------------------------------

_SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,10}$")
_SYMBOL_SUFFIXES = (".IS", ".E")


def normalize_symbol(raw: str) -> str:
    """Normalize a BIST ticker / index code.

    Trims, uppercases, drops Yahoo-style ``.IS`` / ``.E`` suffixes and accepts
    only ``^[A-Z0-9]{2,10}$``. Raises :class:`InvalidInputError` otherwise.
    """
    value = (raw or "").strip().upper()
    for suffix in _SYMBOL_SUFFIXES:
        if value.endswith(suffix):
            value = value[: -len(suffix)]
            break
    if not _SYMBOL_RE.fullmatch(value):
        raise InvalidInputError(
            "Geçersiz sembol. 2-10 karakterlik harf/rakam kullanın (örn. THYAO, XU100)."
        )
    return value


# ---------------------------------------------------------------------------
# Period normalization (UI periods -> borsapy period/interval + display window)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class ChartPeriod:
    """How a chart period is fetched and trimmed.

    borsapy's ``period`` is really a bar count (``1mo`` daily = 30 bars ≈ 6
    weeks, ``1y`` = 365 bars ≈ 17 months) and intraday requests count bars
    back across sessions, so every chart is trimmed to the real window here.
    """

    key: str                     # canonical UI period ("1g", "1ay", ...)
    interval: str                # borsapy bar interval
    yf_period: str               # yfinance-style period (legacy normalize_period output)
    months: int | None = None    # keep bars newer than now - N calendar months
    ytd: bool = False            # keep bars since 1 January (Istanbul)
    sessions: int | None = None  # intraday: keep the last N trading sessions

    @property
    def is_intraday(self) -> bool:
        return self.sessions is not None


_CHART_PERIODS: dict[str, ChartPeriod] = {
    "1g": ChartPeriod("1g", "15m", "1d", sessions=1),
    "5g": ChartPeriod("5g", "30m", "5d", sessions=5),
    "1ay": ChartPeriod("1ay", "1d", "1mo", months=1),
    "3ay": ChartPeriod("3ay", "1d", "3mo", months=3),
    "6ay": ChartPeriod("6ay", "1d", "6mo", months=6),
    "ytd": ChartPeriod("ytd", "1d", "ytd", ytd=True),
    "1y": ChartPeriod("1y", "1d", "1y", months=12),
    "2y": ChartPeriod("2y", "1wk", "2y", months=24),
    "5y": ChartPeriod("5y", "1wk", "5y", months=60),
    "max": ChartPeriod("max", "1mo", "max"),
}

# yfinance-style and Turkish UI spellings accepted in addition to the keys above.
_PERIOD_ALIASES: dict[str, str] = {
    "1d": "1g",
    "5d": "5g",
    "1mo": "1ay",
    "3mo": "3ay",
    "6mo": "6ay",
    "ybk": "ytd",
    "maks": "max",
    "maks.": "max",
}

VALID_PERIODS: tuple[str, ...] = tuple(_CHART_PERIODS)


def resolve_period(period: str) -> ChartPeriod:
    """Map a UI period to its :class:`ChartPeriod`; unknown values raise InvalidInputError."""
    key = (period or "").strip().lower()
    key = _PERIOD_ALIASES.get(key, key)
    spec = _CHART_PERIODS.get(key)
    if spec is None:
        raise InvalidInputError(
            f"Geçersiz periyot: '{period}'. Geçerli değerler: {', '.join(VALID_PERIODS)}"
        )
    return spec


def normalize_period(period: str) -> tuple[str, str]:
    """Map a UI period string to a valid borsapy (period, interval) pair.

    Kept for backward compatibility: unknown values fall back to ("1mo", "1d").
    New code should use :func:`resolve_period`, which rejects unknown values.
    """
    try:
        spec = resolve_period(period)
    except InvalidInputError:
        return "1mo", "1d"
    return spec.yf_period, spec.interval


# ---------------------------------------------------------------------------
# TradingView scanner (one HTTP request for many symbols/columns)
# ---------------------------------------------------------------------------

TRADINGVIEW_SCAN_URL = "https://scanner.tradingview.com/turkey/scan"
_TRADINGVIEW_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}
_TRADINGVIEW_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


async def tradingview_scan(
    symbols: Iterable[str],
    columns: Sequence[str],
    *,
    exchange: str = "BIST",
) -> dict[str, dict[str, Any]]:
    """Fetch ``columns`` for explicit ``symbols`` in one TradingView scanner call.

    Unlike borsapy's ``TechnicalScanner`` (which scans the top-N rows of the
    whole market and filters client-side) this asks for the exact tickers, so
    small caps are never silently dropped. Returns ``{SYMBOL: {column: value}}``
    with NaN/sentinels sanitized; symbols TradingView does not know are absent.
    Raises :class:`MarketDataError` (503/502) on transport or payload errors.
    """
    tickers = [f"{exchange}:{symbol}" for symbol in dict.fromkeys(symbols)]
    if not tickers:
        return {}  # an empty ticker list would scan the entire market
    payload = {
        "symbols": {"tickers": tickers, "query": {"types": []}},
        "columns": list(columns),
        "options": {"lang": "tr"},
    }
    try:
        response = await get_http_client().post(
            TRADINGVIEW_SCAN_URL,
            json=payload,
            headers=_TRADINGVIEW_HEADERS,
            timeout=_TRADINGVIEW_TIMEOUT,
        )
    except httpx.HTTPError as e:
        logger.warning("tradingview_scan_unreachable", error=str(e), tickers=len(tickers))
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503) from e
    if response.status_code >= 400:
        logger.warning("tradingview_scan_http_error", status=response.status_code, body=response.text[:200])
        status = 503 if response.status_code == 429 or response.status_code >= 500 else 502
        raise MarketDataError("Piyasa verisi sağlayıcısı isteği reddetti", status_code=status)
    try:
        body = response.json()
    except ValueError as e:
        raise MarketDataError("Piyasa verisi sağlayıcısından geçersiz yanıt alındı") from e

    data = body.get("data") if isinstance(body, dict) else None
    rows: dict[str, dict[str, Any]] = {}
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        values = item.get("d")
        if not isinstance(values, list) or len(values) != len(columns):
            continue
        symbol = str(item.get("s", "")).split(":", 1)[-1].upper()
        if symbol:
            rows[symbol] = sanitize_data(dict(zip(columns, values)))
    return rows
