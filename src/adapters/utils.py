"""Shared adapter utilities — TTL cache, HTTP client, thread offload, serialization.

All adapters should use these instead of maintaining local copies.
"""

import asyncio
import math
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from functools import wraps
from typing import Any, Callable

import httpx
import structlog

from src.core.config import settings

logger = structlog.get_logger(__name__)


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

# TTL constants (seconds)
TTL_TECHNICAL = 60          # Technical indicators change fast
TTL_FUNDAMENTALS = 300      # Company info changes less often
TTL_MACRO = 600             # Macro data changes slowly
TTL_MARKET = 120            # Screener/scanner results
TTL_PRICE_SNAPSHOT = 30     # Real-time price snapshots


def cached(ttl_seconds: float, key_prefix: str):
    """Decorator for async functions. Caches non-None results for ttl_seconds."""
    def decorator(func: Callable):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            # Build deterministic cache key from function args
            parts = [key_prefix, func.__name__]
            parts.extend(str(a) for a in args)
            parts.extend(f"{k}={v}" for k, v in sorted(kwargs.items()))
            cache_key = ":".join(parts)

            hit, value = adapter_cache.get(cache_key)
            if hit:
                logger.debug("cache_hit", key=cache_key)
                return value

            result = await func(*args, **kwargs)

            # Only cache successful results (not None, not error dicts)
            if result is not None and not (isinstance(result, dict) and "error" in result):
                adapter_cache.set(cache_key, result, ttl_seconds)
                logger.debug("cache_set", key=cache_key, ttl=ttl_seconds)

            return result
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
# instead of the unbounded default asyncio.to_thread pool.
_sync_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="adapter-sync")


async def run_sync(func: Callable, *args) -> Any:
    """Run a synchronous function in a bounded thread pool executor."""
    loop = asyncio.get_running_loop()
    if args:
        return await loop.run_in_executor(_sync_executor, lambda: func(*args))
    return await loop.run_in_executor(_sync_executor, func)


# ---------------------------------------------------------------------------
# DataFrame / Object Serialization
# ---------------------------------------------------------------------------

def df_to_records(df) -> list[dict]:
    """Convert a pandas DataFrame to JSON-serializable list of dicts.

    Handles NaN, Inf, -Inf by converting to None.
    """
    if df is None:
        return []
    if hasattr(df, "empty") and df.empty:
        return []
    try:
        result = df.reset_index()
        records = result.to_dict(orient="records")
        return [
            {
                k: (None if isinstance(v, float) and (math.isnan(v) or math.isinf(v)) else v)
                for k, v in row.items()
            }
            for row in records
        ]
    except Exception:
        return []


def safe_serialize(obj) -> dict | list:
    """Convert any borsapy object to a JSON-serializable dict or list."""
    if obj is None:
        return {}
    if isinstance(obj, (dict, list)):
        return obj
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    # Mapping-like objects (e.g. borsapy FastInfo keeps data in _data but
    # exposes keys()/__getitem__) — plain __dict__ scraping would return {}.
    if hasattr(obj, "keys") and callable(obj.keys):
        try:
            return {k: obj[k] for k in obj.keys()}
        except Exception:
            pass
    if hasattr(obj, "__dict__"):
        public = {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
        if public:
            return public
    return {"value": str(obj)}


# ---------------------------------------------------------------------------
# Period normalization (Turkish UI periods -> borsapy period/interval)
# ---------------------------------------------------------------------------

# borsapy expects yfinance-style periods (1d, 5d, 1mo, ...) plus a separate
# interval. The UI speaks Turkish periods (1g, 1ay, ...). Passing those
# through unchanged makes borsapy silently fall back to its default (1mo/1d),
# so every chart period looked identical.
_PERIOD_MAP: dict[str, tuple[str, str]] = {
    "1g": ("1d", "15m"),
    "1d": ("1d", "15m"),
    "5g": ("5d", "1h"),
    "5d": ("5d", "1h"),
    "1ay": ("1mo", "1d"),
    "1mo": ("1mo", "1d"),
    "3ay": ("3mo", "1d"),
    "3mo": ("3mo", "1d"),
    "6ay": ("6mo", "1d"),
    "6mo": ("6mo", "1d"),
    "ytd": ("ytd", "1d"),
    "1y": ("1y", "1d"),
    "2y": ("2y", "1wk"),
    "5y": ("5y", "1wk"),
    "max": ("max", "1mo"),
}


def normalize_period(period: str) -> tuple[str, str]:
    """Map a UI period string to a valid borsapy (period, interval) pair."""
    return _PERIOD_MAP.get(period.lower().strip(), ("1mo", "1d"))
