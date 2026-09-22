"""News sentiment classifier: pause on provider quota/rate-limit errors, bounded backlog retries."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.adapters.llm import is_rate_limit_error
from src.services import news_service


class _QuotaError(Exception):
    code = 429


class _FakeLLM:
    is_configured = True

    def __init__(self, error: Exception | None = None, text: str = "[]") -> None:
        self.error = error
        self.text = text
        self.calls = 0
        self.usage: list[tuple[str | None, str | None]] = []

    async def generate(self, system: str, user: str, max_tokens: int = 0, *, kind=None, ticker=None):
        self.calls += 1
        self.usage.append((kind, ticker))
        if self.error is not None:
            raise self.error
        return SimpleNamespace(text=self.text)


@pytest.fixture(autouse=True)
def _enabled(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(news_service.settings, "ai_news_classify_enabled", True)
    monkeypatch.setattr(news_service, "_classify_paused_until", 0.0)
    monkeypatch.setattr(news_service, "_classify_failures", {})


class _LabelAllLLM(_FakeLLM):
    """Labels every numbered headline it receives (except ``skip`` titles)."""

    def __init__(self, skip: tuple[str, ...] = ()) -> None:
        super().__init__()
        self.skip = skip
        self.batch_sizes: list[int] = []

    async def generate(self, system: str, user: str, max_tokens: int = 0, *, kind=None, ticker=None):
        self.calls += 1
        self.usage.append((kind, ticker))
        lines = [line for line in user.splitlines() if line[:1].isdigit()]
        self.batch_sizes.append(len(lines))
        rows = [
            f'{{"i": {line.split(".", 1)[0]}, "sentiment": "pozitif", "impact": "orta", "rationale": "x"}}'
            for line in lines
            if not any(s in line for s in self.skip)
        ]
        return SimpleNamespace(text="[" + ",".join(rows) + "]")


class _FakeSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _backlog(monkeypatch: pytest.MonkeyPatch, titles: list[str]) -> list[SimpleNamespace]:
    now = datetime.now(timezone.utc)
    items = [
        SimpleNamespace(id=uuid.uuid4(), title=t, published_at=now, sentiment=None, impact=None, rationale=None)
        for t in titles
    ]

    async def unlabelled(session, company_id, exclude=()):
        return [n for n in items if n.sentiment is None and n.id not in set(exclude)][:30]

    async def no_news(*args, **kwargs):
        return []  # Google News unreachable / nothing relevant this cycle

    monkeypatch.setattr(news_service, "_unlabelled_recent", unlabelled)
    monkeypatch.setattr(news_service, "fetch_news", no_news)
    return items


_COMPANY = SimpleNamespace(id=uuid.uuid4(), ticker="THYAO", display_name="Türk Hava Yolları", legal_name=None)


async def test_backlog_is_classified_even_when_no_news_was_fetched(monkeypatch: pytest.MonkeyPatch) -> None:
    items = _backlog(monkeypatch, ["Başlık A", "Başlık B"])
    llm = _LabelAllLLM()
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)
    session = _FakeSession()

    assert await news_service.ingest_for_company(session, _COMPANY) == 0

    assert [n.sentiment for n in items] == ["pozitif", "pozitif"]
    assert session.commits == 1
    assert llm.usage == [("classification", "THYAO")]  # ai_usage rows are attributable


async def test_large_backlog_is_sent_in_chunks(monkeypatch: pytest.MonkeyPatch) -> None:
    items = _backlog(monkeypatch, [f"Başlık {i}" for i in range(30)])
    llm = _LabelAllLLM()
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)

    await news_service.ingest_for_company(_FakeSession(), _COMPANY)

    # 30 labelled rows would not fit max_tokens=2048 in a single answer.
    assert max(llm.batch_sizes) <= news_service._CLASSIFY_CHUNK_SIZE
    assert all(n.sentiment == "pozitif" for n in items)


async def test_unlabelable_headline_is_not_resent_every_cycle(monkeypatch: pytest.MonkeyPatch) -> None:
    items = _backlog(monkeypatch, ["Normal başlık", "Modelin atladığı başlık"])
    llm = _LabelAllLLM(skip=("atladığı",))
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)

    for _ in range(10):  # ten 15-minute cycles
        await news_service.ingest_for_company(_FakeSession(), _COMPANY)

    assert items[0].sentiment == "pozitif" and items[1].sentiment is None
    assert llm.calls == news_service._MAX_CLASSIFY_ATTEMPTS


async def test_unavailable_classifier_does_not_use_up_attempts(monkeypatch: pytest.MonkeyPatch) -> None:
    items = _backlog(monkeypatch, ["Başlık"])
    quota = _FakeLLM(error=_QuotaError("429 RESOURCE_EXHAUSTED"))
    monkeypatch.setattr(news_service, "get_llm_client", lambda: quota)
    for _ in range(5):
        await news_service.ingest_for_company(_FakeSession(), _COMPANY)
        monkeypatch.setattr(news_service, "_classify_paused_until", 0.0)  # pause elapsed

    llm = _LabelAllLLM()
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)
    await news_service.ingest_for_company(_FakeSession(), _COMPANY)

    assert items[0].sentiment == "pozitif"


async def test_quota_error_pauses_further_calls(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = _FakeLLM(error=_QuotaError("429 RESOURCE_EXHAUSTED. You exceeded your current quota"))
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)

    assert await news_service.classify_news_batch("THYAO", ["Başlık"]) == {}
    assert await news_service.classify_news_batch("GARAN", ["Başlık"]) == {}
    assert llm.calls == 1  # the second company is skipped while paused


async def test_other_errors_do_not_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    llm = _FakeLLM(error=ValueError("bozuk JSON"))
    monkeypatch.setattr(news_service, "get_llm_client", lambda: llm)

    await news_service.classify_news_batch("THYAO", ["Başlık"])
    await news_service.classify_news_batch("GARAN", ["Başlık"])
    assert llm.calls == 2


@pytest.mark.parametrize(
    "error",
    [_QuotaError("x"), RuntimeError("ClientError: 429 RESOURCE_EXHAUSTED"), RuntimeError("Rate limit reached")],
)
def test_rate_limit_detection(error: Exception) -> None:
    assert is_rate_limit_error(error)


def test_non_rate_limit_error_is_not_detected() -> None:
    assert not is_rate_limit_error(RuntimeError("503 UNAVAILABLE"))
