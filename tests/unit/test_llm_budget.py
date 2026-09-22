"""Tests for the shared, DB-backed daily AI budget breaker (src/adapters/llm.py).

No network. DailyBudget's two DB touch points (_committed_spent_today, record_usage)
are mocked in the client tests; the `ai_usage` ledger itself is exercised against an
in-memory SQLite database holding just that table.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from src.adapters import llm as llm_module
from src.adapters.llm import (
    AnthropicClient,
    DailyBudget,
    GeminiClient,
    LLMBudgetExceededError,
    LLMNotConfiguredError,
    LLMTruncatedError,
    _day_window_utc,
    _estimate_cost,
    get_llm_client,
    is_rate_limit_error,
)
from src.db.models import AIUsage


@pytest.fixture(autouse=True)
def _fresh_shared_budget(monkeypatch):
    """Clients share one process-wide DailyBudget; give each test its own, with the DB
    touch points mocked (no ai_usage table in the unit-test database)."""
    budget = DailyBudget(limit_usd=5.0)
    monkeypatch.setattr(budget, "_committed_spent_today", AsyncMock(return_value=0.0))
    monkeypatch.setattr(budget, "record_usage", AsyncMock())
    monkeypatch.setattr(llm_module, "_shared_budget", budget)
    return budget


@pytest.fixture
async def usage_db():
    """In-memory SQLite holding only the ai_usage table -> an async session factory."""
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as conn:
        await conn.run_sync(AIUsage.__table__.create)
    yield async_sessionmaker(engine, expire_on_commit=False)
    await engine.dispose()


async def _usage_rows(session_factory) -> list[AIUsage]:
    from sqlalchemy import select

    async with session_factory() as session:
        return list((await session.execute(select(AIUsage))).scalars().all())


def test_day_window_utc_uses_istanbul_local_midnight_not_utc_midnight():
    # 2026-09-22 22:30 UTC = 2026-09-23 01:30 Europe/Istanbul (UTC+3) -> already the "next" local day.
    now = datetime(2026, 9, 22, 22, 30, tzinfo=timezone.utc)
    start, end = _day_window_utc(now)
    assert start == datetime(2026, 9, 22, 21, 0, tzinfo=timezone.utc)
    assert end == datetime(2026, 9, 23, 21, 0, tzinfo=timezone.utc)
    assert start <= now < end
    assert (end - start).total_seconds() == 24 * 3600


def test_estimate_cost_assumes_full_max_tokens_as_worst_case_output():
    model = "gemini-3.5-flash"
    cost = _estimate_cost(model, "sys", "user content", max_tokens=1000)
    in_price, out_price = llm_module.MODEL_PRICING[model]
    approx_input_tokens = (len("sys") + len("user content")) / 4
    expected = (approx_input_tokens * in_price + 1000 * out_price) / 1_000_000
    assert cost == pytest.approx(expected)


async def test_reserve_raises_when_committed_plus_reserved_would_exceed_limit(monkeypatch):
    budget = DailyBudget(limit_usd=1.0)
    monkeypatch.setattr(budget, "_committed_spent_today", AsyncMock(return_value=0.90))

    await budget.reserve(0.05)  # 0.90 + 0.05 = 0.95 <= 1.0 -> OK
    with pytest.raises(LLMBudgetExceededError):
        await budget.reserve(0.10)  # 0.95 + 0.10 > 1.0 -> refused


async def test_release_frees_reservation_so_a_later_reserve_can_pass(monkeypatch):
    budget = DailyBudget(limit_usd=1.0)
    monkeypatch.setattr(budget, "_committed_spent_today", AsyncMock(return_value=0.90))

    await budget.reserve(0.09)
    with pytest.raises(LLMBudgetExceededError):
        await budget.reserve(0.02)

    budget.release(0.09)
    await budget.reserve(0.05)  # reservation freed -> 0.90 + 0.05 <= 1.0 -> OK now


async def test_release_never_goes_negative():
    budget = DailyBudget(limit_usd=1.0)
    budget.release(5.0)  # nothing was ever reserved
    assert budget._reserved == 0.0


async def test_spent_today_is_committed_plus_in_flight_reservation(monkeypatch):
    budget = DailyBudget(limit_usd=5.0)
    monkeypatch.setattr(budget, "_committed_spent_today", AsyncMock(return_value=1.0))
    await budget.reserve(0.5)
    assert await budget.spent_today() == pytest.approx(1.5)


async def test_gemini_generate_releases_reservation_when_provider_call_fails(monkeypatch):
    """A provider error mid-call must not leak a permanent budget reservation."""
    client = GeminiClient()
    monkeypatch.setattr(GeminiClient, "is_configured", property(lambda self: True))
    monkeypatch.setattr(client.budget, "_committed_spent_today", AsyncMock(return_value=0.0))

    class _FailingModels:
        async def generate_content(self, **kwargs):
            raise RuntimeError("upstream boom")

    class _FailingAio:
        models = _FailingModels()

    class _FailingClient:
        aio = _FailingAio()

    monkeypatch.setattr(client, "_get_client", lambda: _FailingClient())

    with pytest.raises(RuntimeError, match="upstream boom"):
        await client.generate("sys", "user", model="gemini-3.5-flash", max_tokens=100)

    assert client.budget._reserved == 0.0


async def test_gemini_generate_raises_on_empty_visible_text():
    """Safety-blocked / thinking-exhausted responses must fail loudly, not cache blank text."""
    client = GeminiClient()

    class _EmptyResponse:
        candidates: list = []
        usage_metadata = None

    class _EmptyModels:
        async def generate_content(self, **kwargs):
            return _EmptyResponse()

    class _EmptyAio:
        models = _EmptyModels()

    class _EmptyClient:
        aio = _EmptyAio()

    client._get_client = lambda: _EmptyClient()  # type: ignore[method-assign]
    client.budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="bos yanit"):
        await client.generate("sys", "user", model="gemini-3.5-flash", max_tokens=100)


async def test_anthropic_generate_raises_on_empty_text_instead_of_returning_blank():
    """Anthropic refusals (no text blocks) previously produced a silent empty result."""
    client = AnthropicClient()

    class _EmptyMessage:
        content: list = []
        usage = type("Usage", (), {"input_tokens": 5, "output_tokens": 0})()
        stop_reason = "refusal"

    class _StreamCtx:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get_final_message(self):
            return _EmptyMessage()

    class _EmptyMessages:
        def stream(self, **kwargs):
            return _StreamCtx()

    class _EmptyClient:
        messages = _EmptyMessages()

    client._get_client = lambda: _EmptyClient()  # type: ignore[method-assign]
    client.budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]

    with pytest.raises(RuntimeError, match="bos yanit"):
        await client.generate("sys", "user", model="claude-sonnet-5", max_tokens=100)


async def test_gemini_generate_succeeds_on_normal_stop_finish_reason():
    """Sanity check for the truncation guard: a normal STOP finish must NOT
    be mistaken for a truncated/blocked response.
    """
    client = GeminiClient()

    class _Part:
        thought = False
        text = "Tam rapor metni."

    class _Content:
        parts = [_Part()]

    class _Candidate:
        content = _Content()
        finish_reason = "STOP"

    class _OkResponse:
        candidates = [_Candidate()]
        usage_metadata = None

    class _OkModels:
        async def generate_content(self, **kwargs):
            return _OkResponse()

    class _OkClient:
        aio = type("Aio", (), {"models": _OkModels()})()

    client._get_client = lambda: _OkClient()  # type: ignore[method-assign]
    client.budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]

    result = await client.generate("sys", "user", model="gemini-3.5-flash", max_tokens=100)
    assert result.text == "Tam rapor metni."


async def test_gemini_generate_raises_truncated_error_on_max_tokens_finish():
    """A MAX_TOKENS finish means the visible text is real but INCOMPLETE (e.g. a
    JSON array cut off mid-way) -- must never be treated as a successful answer.
    """
    client = GeminiClient()

    class _Part:
        thought = False
        text = "Yarim kalan rapor metni..."

    class _Content:
        parts = [_Part()]

    class _Candidate:
        content = _Content()
        finish_reason = "MAX_TOKENS"

    class _TruncatedResponse:
        candidates = [_Candidate()]
        usage_metadata = None

    class _TruncModels:
        async def generate_content(self, **kwargs):
            return _TruncatedResponse()

    class _TruncClient:
        aio = type("Aio", (), {"models": _TruncModels()})()

    client._get_client = lambda: _TruncClient()  # type: ignore[method-assign]
    client.budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]

    with pytest.raises(LLMTruncatedError, match="MAX_TOKENS"):
        await client.generate("sys", "user", model="gemini-3.5-flash", max_tokens=100)

    assert client.budget._reserved == 0.0  # reservation still released despite the raise


async def test_anthropic_generate_raises_truncated_error_on_max_tokens_stop():
    client = AnthropicClient()

    class _TruncatedMessage:
        content = [type("Block", (), {"type": "text", "text": "Yarim kalan rapor..."})()]
        usage = type("Usage", (), {"input_tokens": 50, "output_tokens": 4096})()
        stop_reason = "max_tokens"

    class _StreamCtx:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get_final_message(self):
            return _TruncatedMessage()

    class _TruncMessages:
        def stream(self, **kwargs):
            return _StreamCtx()

    class _TruncClient:
        messages = _TruncMessages()

    client._get_client = lambda: _TruncClient()  # type: ignore[method-assign]
    client.budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]

    with pytest.raises(LLMTruncatedError, match="max_tokens"):
        await client.generate("sys", "user", model="claude-sonnet-5", max_tokens=100)

    assert client.budget._reserved == 0.0


def test_get_llm_client_returns_gemini_by_default(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "ai_provider", "gemini")
    llm_module._clients.clear()
    try:
        assert isinstance(get_llm_client(), GeminiClient)
    finally:
        llm_module._clients.clear()


def test_get_llm_client_returns_anthropic_when_selected(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "ai_provider", "anthropic")
    llm_module._clients.clear()
    try:
        assert isinstance(get_llm_client(), AnthropicClient)
    finally:
        llm_module._clients.clear()


def test_get_llm_client_shares_one_budget_across_providers(monkeypatch):
    """Both provider clients must draw from the SAME daily budget."""
    llm_module._clients.clear()
    try:
        monkeypatch.setattr(llm_module.settings, "ai_provider", "gemini")
        gemini = get_llm_client()
        monkeypatch.setattr(llm_module.settings, "ai_provider", "anthropic")
        anthropic_client = get_llm_client()
        assert gemini.budget is anthropic_client.budget
    finally:
        llm_module._clients.clear()


# ---------------------------------------------------------------------------
# Every paid call -- truncated or empty answers included -- must count against
# the daily budget through its ai_usage row.
# ---------------------------------------------------------------------------


def _gemini_response(text="Rapor.", finish="STOP", out_tokens=0, thoughts=0):
    part = SimpleNamespace(thought=False, text=text)
    candidate = SimpleNamespace(content=SimpleNamespace(parts=[part]), finish_reason=finish)
    usage = SimpleNamespace(prompt_token_count=0, candidates_token_count=out_tokens, thoughts_token_count=thoughts)
    return SimpleNamespace(candidates=[candidate], usage_metadata=usage)


def _gemini_client(budget, response):
    client = GeminiClient()
    client.budget = budget

    class _Models:
        async def generate_content(self, **kwargs):
            return response

    client._get_client = lambda: SimpleNamespace(aio=SimpleNamespace(models=_Models()))  # type: ignore[method-assign]
    return client


def _budget(limit_usd):
    budget = DailyBudget(limit_usd=limit_usd)
    budget._committed_spent_today = AsyncMock(return_value=0.0)  # type: ignore[method-assign]
    budget.record_usage = AsyncMock()  # type: ignore[method-assign]
    return budget


async def test_classification_calls_are_recorded_and_trip_the_budget(usage_db):
    """The ai_usage rows of classification calls alone must make the breaker trip."""
    budget = DailyBudget(limit_usd=1.0, session_factory=usage_db)
    client = _gemini_client(budget, _gemini_response(out_tokens=200_000))  # $2.50/M -> $0.50 per call

    await client.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)
    await client.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)
    with pytest.raises(LLMBudgetExceededError):
        await client.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)

    rows = await _usage_rows(usage_db)
    assert [(r.provider, r.kind, r.ticker, r.output_tokens) for r in rows] == [
        ("gemini", "classification", None, 200_000),
        ("gemini", "classification", None, 200_000),
    ]
    assert sum(float(r.cost_usd) for r in rows) == pytest.approx(1.0)
    assert budget._reserved == 0.0


async def test_truncated_answer_is_still_recorded(usage_db):
    budget = DailyBudget(limit_usd=5.0, session_factory=usage_db)
    client = _gemini_client(budget, _gemini_response(finish="MAX_TOKENS", out_tokens=400_000, thoughts=100))

    with pytest.raises(LLMTruncatedError):
        await client.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100, ticker="THYAO")

    [row] = await _usage_rows(usage_db)
    assert (row.kind, row.ticker, row.output_tokens) == ("classification", "THYAO", 400_100)  # thinking tokens included
    assert await budget.spent_today() == pytest.approx(1.00025)


async def test_two_processes_share_one_budget_through_the_db(usage_db):
    """Two processes = two client instances with their own in-memory reservations; the
    only thing they share is the ai_usage table -- which must be enough."""
    first = _gemini_client(DailyBudget(limit_usd=1.0, session_factory=usage_db), _gemini_response(out_tokens=300_000))
    second = _gemini_client(DailyBudget(limit_usd=1.0, session_factory=usage_db), _gemini_response(out_tokens=100))

    await first.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100, ticker="THYAO")  # $0.75
    assert await second.budget.spent_today() == pytest.approx(0.75)

    # second's own estimate (100 out tokens + input) fits, another $0.75 call from first would not
    await second.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)
    with pytest.raises(LLMBudgetExceededError):
        await second.generate("sys", "u", model="gemini-3.5-flash", max_tokens=200_000)
    with pytest.raises(LLMBudgetExceededError):
        await first.generate("sys", "u", model="gemini-3.5-flash", max_tokens=200_000, ticker="GARAN")


async def test_news_classification_call_is_recorded_as_classification(usage_db, monkeypatch):
    """The real classifier code path (news_service) books its call without passing a kind."""
    from src.services import news_service

    client = _gemini_client(
        DailyBudget(limit_usd=5.0, session_factory=usage_db),
        _gemini_response(text='[{"i": 0, "sentiment": "pozitif", "impact": "orta", "rationale": "x"}]', out_tokens=50),
    )
    monkeypatch.setattr(GeminiClient, "is_configured", property(lambda self: True))
    monkeypatch.setattr(news_service, "get_llm_client", lambda: client)
    monkeypatch.setattr(news_service.settings, "ai_news_classify_enabled", True)
    monkeypatch.setattr(news_service, "_classify_paused_until", 0.0)

    labels = await news_service.classify_news_batch("THYAO", ["THY filosuna yeni ucak katti"])

    assert labels[0]["sentiment"] == "pozitif"
    [row] = await _usage_rows(usage_db)
    assert (row.provider, row.kind, row.output_tokens) == ("gemini", "classification", 50)


async def test_no_reservation_is_leaked_when_the_provider_is_not_configured(monkeypatch, _fresh_shared_budget):
    monkeypatch.setattr(llm_module.settings, "gemini_api_key", "")
    with pytest.raises(LLMNotConfiguredError):
        await GeminiClient().generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)
    assert _fresh_shared_budget._reserved == 0.0


@pytest.mark.parametrize("reason", ["PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "LANGUAGE", "FINISH_REASON_UNSPECIFIED"])
async def test_gemini_any_finish_reason_other_than_stop_is_incomplete(reason):
    from google.genai import types

    client = _gemini_client(_budget(5.0), _gemini_response(finish=types.FinishReason(reason)))
    with pytest.raises(LLMTruncatedError, match=reason):
        await client.generate("sys", "u", model="gemini-3.5-flash", max_tokens=100)


@pytest.mark.parametrize("stop_reason", ["model_context_window_exceeded", "pause_turn"])
async def test_anthropic_any_stop_reason_other_than_end_turn_is_incomplete(stop_reason):
    message = SimpleNamespace(
        content=[SimpleNamespace(type="text", text="Yarim kalan rapor...")],
        usage=SimpleNamespace(input_tokens=10, output_tokens=10),
        stop_reason=stop_reason,
    )

    class _StreamCtx:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get_final_message(self):
            return message

    client = AnthropicClient()
    client.budget = _budget(5.0)
    client._get_client = lambda: SimpleNamespace(messages=SimpleNamespace(stream=lambda **kw: _StreamCtx()))  # type: ignore[method-assign]
    with pytest.raises(LLMTruncatedError, match=stop_reason):
        await client.generate("sys", "u", model="claude-sonnet-5", max_tokens=100)


def test_gemini_usage_bills_thinking_tokens_as_output():
    assert GeminiClient._usage(_gemini_response(out_tokens=50, thoughts=100)) == (0, 150)


class _StatusError(Exception):
    def __init__(self, code):
        super().__init__("upstream")
        self.code = code


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (_StatusError(429), True),
        (RuntimeError("ClientError: 429 RESOURCE_EXHAUSTED. quota exceeded"), True),
        (RuntimeError("Rate limit reached for requests"), True),
        (_StatusError(500), False),
        (RuntimeError("400 INVALID_ARGUMENT: input token count (14290) exceeds the limit"), False),
        (RuntimeError("connection to server at 10.0.4.29:5432 failed"), False),
    ],
)
def test_is_rate_limit_error_does_not_match_429_inside_other_numbers(error, expected):
    assert is_rate_limit_error(error) is expected
