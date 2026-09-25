"""Chart responses do not wait on slow secondary parts (index_adapter._with_optional_parts)."""

import asyncio
import time

import pytest

from src.adapters import index_adapter
from src.adapters.utils import adapter_cache, cached


async def _bars() -> str:
    return "bars"


async def test_part_still_running_after_the_grace_is_left_out(monkeypatch):
    monkeypatch.setattr(index_adapter, "OPTIONAL_PART_GRACE", 0.05)
    release = asyncio.Event()

    async def quick() -> dict:
        return {"last": 1}

    async def slow() -> dict:
        await release.wait()
        return {"never": True}

    started = time.monotonic()
    result, parts = await index_adapter._with_optional_parts(_bars(), {"quote": quick(), "metrics": slow()}, "THYAO")

    assert result == "bars"
    assert parts == {"quote": {"last": 1}, "metrics": None}
    assert time.monotonic() - started < 1  # not OPTIONAL_PART_TIMEOUT (6 s)
    release.set()


async def test_parts_finishing_within_the_grace_are_kept(monkeypatch):
    monkeypatch.setattr(index_adapter, "OPTIONAL_PART_GRACE", 1.0)

    async def part() -> int:
        await asyncio.sleep(0.05)
        return 42

    assert await index_adapter._with_optional_parts(_bars(), {"part": part()}, "THYAO") == ("bars", {"part": 42})


async def test_skipped_cached_part_keeps_loading_for_the_next_request(monkeypatch):
    monkeypatch.setattr(index_adapter, "OPTIONAL_PART_GRACE", 0.01)
    adapter_cache.clear()
    release = asyncio.Event()
    calls = 0

    @cached(60, "chart-part-test")
    async def company_card(ticker: str) -> dict:
        nonlocal calls
        calls += 1
        await release.wait()
        return {"ticker": ticker}

    _, parts = await index_adapter._with_optional_parts(_bars(), {"card": company_card("THYAO")}, "THYAO")
    assert parts == {"card": None}
    release.set()
    await asyncio.sleep(0.01)

    _, parts = await index_adapter._with_optional_parts(_bars(), {"card": company_card("THYAO")}, "THYAO")
    assert parts == {"card": {"ticker": "THYAO"}}
    assert calls == 1


async def test_failing_primary_cancels_the_parts():
    release = asyncio.Event()
    finished = False

    async def primary() -> str:
        await asyncio.sleep(0.01)  # the part is already running when the bars fail
        raise RuntimeError("no bars")

    async def part() -> None:
        nonlocal finished
        await release.wait()
        finished = True

    with pytest.raises(RuntimeError, match="no bars"):
        await index_adapter._with_optional_parts(primary(), {"part": part()}, "THYAO")
    release.set()
    await asyncio.sleep(0.01)
    assert not finished
