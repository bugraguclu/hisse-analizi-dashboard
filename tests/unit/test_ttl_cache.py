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


async def test_cached_does_not_store_error_payloads_or_exceptions():
    adapter_cache.clear()
    calls = 0

    @cached(10, "error-test")
    async def flaky(fail: bool):
        nonlocal calls
        calls += 1
        if fail:
            raise RuntimeError("upstream down")
        return {"error": "Sağlayıcı yanıt vermedi"}

    for _ in range(2):
        assert await flaky(False) == {"error": "Sağlayıcı yanıt vermedi"}
    for _ in range(2):
        try:
            await flaky(True)
        except RuntimeError:
            pass
    assert calls == 4


async def test_cancelled_caller_does_not_cancel_shared_fetch_and_result_is_cached():
    adapter_cache.clear()
    calls = 0
    release = asyncio.Event()

    @cached(10, "cancel-test")
    async def slow(key: str):
        nonlocal calls
        calls += 1
        await release.wait()
        return {"key": key}

    first = asyncio.create_task(slow("k"))
    await asyncio.sleep(0)
    first.cancel()  # e.g. the browser navigated away
    await asyncio.sleep(0)
    release.set()
    await asyncio.sleep(0.01)

    assert await slow("k") == {"key": "k"}  # served from the cache filled by the orphaned task
    assert calls == 1


async def test_failure_after_every_waiter_was_cancelled_is_not_reported_as_unhandled():
    # An optional chart part times out (its waiter is cancelled) and the shared
    # fetch fails later: that is a handled upstream error, not an asyncio error log.
    adapter_cache.clear()
    loop = asyncio.get_running_loop()
    reported: list[dict] = []
    previous_handler = loop.get_exception_handler()
    loop.set_exception_handler(lambda _loop, context: reported.append(context))
    release = asyncio.Event()

    @cached(10, "orphan-failure-test")
    async def slow_failure():
        await release.wait()
        raise RuntimeError("upstream down")

    try:
        waiter = asyncio.create_task(slow_failure())
        await asyncio.sleep(0)
        waiter.cancel()
        await asyncio.sleep(0)
        release.set()
        await asyncio.sleep(0.01)
    finally:
        loop.set_exception_handler(previous_handler)

    assert reported == []
    try:
        await slow_failure()  # a later caller still sees the failure (nothing was cached)
    except RuntimeError as exc:
        assert str(exc) == "upstream down"
    else:
        raise AssertionError("expected the upstream failure")


async def test_failed_inflight_task_is_not_reused_by_later_callers():
    adapter_cache.clear()
    attempts = 0

    @cached(10, "retry-test")
    async def sometimes():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise RuntimeError("first attempt fails")
        return {"ok": True}

    try:
        await sometimes()
    except RuntimeError:
        pass
    assert await sometimes() == {"ok": True}
    assert attempts == 2
