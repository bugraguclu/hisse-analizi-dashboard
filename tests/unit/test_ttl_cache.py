"""Tests for TTL cache."""

import time

import asyncio


from src.adapters.utils import TTLCache, adapter_cache, cached


class TestTTLCache:
    def test_set_and_get(self):
        cache = TTLCache()
        cache.set("key1", "value1", ttl_seconds=10)
        hit, value = cache.get("key1")
        assert hit is True
        assert value == "value1"

    def test_miss_on_empty(self):
        cache = TTLCache()
        hit, value = cache.get("nonexistent")
        assert hit is False
        assert value is None

    def test_expiration(self):
        cache = TTLCache()
        cache.set("key1", "value1", ttl_seconds=0.01)
        time.sleep(0.02)
        hit, value = cache.get("key1")
        assert hit is False
        assert value is None

    def test_invalidate(self):
        cache = TTLCache()
        cache.set("key1", "value1", ttl_seconds=10)
        cache.invalidate("key1")
        hit, value = cache.get("key1")
        assert hit is False

    def test_clear(self):
        cache = TTLCache()
        cache.set("key1", "value1", ttl_seconds=10)
        cache.set("key2", "value2", ttl_seconds=10)
        assert cache.size == 2
        cache.clear()
        assert cache.size == 0

    def test_overwrite(self):
        cache = TTLCache()
        cache.set("key1", "old", ttl_seconds=10)
        cache.set("key1", "new", ttl_seconds=10)
        hit, value = cache.get("key1")
        assert value == "new"


async def test_cached_coalesces_concurrent_identical_requests():
    adapter_cache.clear()
    calls = 0
    release = asyncio.Event()

    @cached(10, "singleflight-test")
    async def fetch_value(key: str):
        nonlocal calls
        calls += 1
        await release.wait()
        return {"key": key}

    first = asyncio.create_task(fetch_value("same"))
    second = asyncio.create_task(fetch_value("same"))
    await asyncio.sleep(0)
    release.set()

    assert await asyncio.gather(first, second) == [{"key": "same"}, {"key": "same"}]
    assert calls == 1
