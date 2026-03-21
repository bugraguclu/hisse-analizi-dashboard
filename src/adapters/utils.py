"""Shared adapter utilities — TTL cache, HTTP client, thread offload, serialization.

All adapters should use these instead of maintaining local copies.
"""

import asyncio
import math
import time
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
    """Simple in-memory TTL cache. Thread-safe for reads/writes in asyncio context.

    Does NOT cache errors — only successful (non-None) results.
    """

    def __init__(self):
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> tuple[bool, Any]:
        """Returns (hit, value). hit=False means cache miss or expired."""
        entry = self._store.get(key)
        if entry is None:
            return False, None
        expires_at, value = entry
        if time.monotonic() > expires_at:
            del self._store[key]
            return False, None
        return True, value

    def set(self, key: str, value: Any, ttl_seconds: float) -> None:
        self._store[key] = (time.monotonic() + ttl_seconds, value)

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
                connect=settings.http_connect_timeout,
                read=settings.http_read_timeout,
            ),
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
            limits=httpx.Limits(
                max_connections=20,
                max_keepalive_connections=10,
            ),
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

async def run_sync(func: Callable, *args) -> Any:
    """Run a synchronous function in the default executor.

    Replaces the deprecated asyncio.get_event_loop().run_in_executor() pattern.
    """
    return await asyncio.to_thread(func, *args)


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
    if hasattr(obj, "__dict__"):
        return {k: v for k, v in obj.__dict__.items() if not k.startswith("_")}
    return {"value": str(obj)}
