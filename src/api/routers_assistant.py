"""AI explanation assistant: answers from the app's own data, with sources.

``GET /assistant/status`` tells the UI whether the assistant is configured.
``POST /assistant/ask`` streams the answer as Server-Sent Events (see
:mod:`src.services.assistant.engine` for the event types). Errors before the stream
starts are ordinary JSON responses: 422 (invalid body), 429 (rate limit, with
``Retry-After``), 503 ``code: assistant_not_configured``.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import AsyncIterator
from typing import Literal

import structlog
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from src.api.limiter import limiter
from src.core.config import settings
from src.services.assistant import engine, guardrails
from src.services.assistant.llm import configured_model

logger = structlog.get_logger(__name__)

assistant_router = APIRouter(prefix="/assistant", tags=["assistant"])

HEARTBEAT_SECONDS = 10.0
NOT_CONFIGURED_DETAIL = "Asistan bu sunucuda yapılandırılmamış."
_PAGE_RE = re.compile(r"^/[A-Za-z0-9\-_/.%]*$")


class HistoryIn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=guardrails.MAX_QUESTION_CHARS)
    locale: Literal["tr", "en", "fr"] = "tr"
    page: str | None = Field(default=None, max_length=guardrails.MAX_PATH_CHARS, description="Açık sayfanın yolu, ör. /hisse/THYAO")
    ticker: str | None = Field(default=None, max_length=12, description="Sayfadaki hisse")
    watchlist: list[str] = Field(default_factory=list, max_length=guardrails.MAX_WATCHLIST_TICKERS)
    history: list[HistoryIn] = Field(default_factory=list, max_length=guardrails.MAX_HISTORY_TURNS * 2)


def to_request(body: AskIn) -> engine.AskRequest | None:
    question = guardrails.clean_user_text(body.question, guardrails.MAX_QUESTION_CHARS)
    if len(question) < 2:
        return None
    page = body.page if body.page and _PAGE_RE.fullmatch(body.page) else None
    tickers = guardrails.valid_tickers([body.ticker] if body.ticker else [], limit=1)
    return engine.AskRequest(
        question=question,
        locale=body.locale,
        page_path=page,
        page_ticker=tickers[0] if tickers else None,
        watchlist=tuple(guardrails.valid_tickers(body.watchlist)),
        history=tuple(engine.HistoryTurn(role=turn.role, content=turn.content) for turn in body.history),
    )


@assistant_router.get("/status")
async def assistant_status() -> dict[str, object]:
    """Whether the assistant is available (the UI hides it otherwise)."""
    enabled = bool(settings.llm_effective_api_key)
    return {
        "enabled": enabled,
        "model": settings.llm_model if enabled else None,
        "max_question_chars": guardrails.MAX_QUESTION_CHARS,
        "rate_limit": settings.assistant_rate_limit,
    }


async def _event_stream(req: engine.AskRequest, model: engine.ChatModel) -> AsyncIterator[bytes]:
    """Engine events as SSE, with a comment heartbeat so proxies keep the stream open."""
    queue: asyncio.Queue[bytes | None] = asyncio.Queue()

    async def produce() -> None:
        try:
            async for event, data in engine.answer(req, model):
                await queue.put(engine.sse(event, data))
        except Exception as e:  # noqa: BLE001 - the stream has started: report in-band
            logger.error("assistant_stream_failed", error=type(e).__name__)
            await queue.put(engine.sse("error", {"code": "internal", "detail": "Beklenmeyen bir hata oluştu."}))
        finally:
            await queue.put(None)

    task = asyncio.create_task(produce())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
            except TimeoutError:
                yield b": ping\n\n"
                continue
            if item is None:
                break
            yield item
    finally:
        if not task.done():
            task.cancel()


@assistant_router.post("/ask", responses={
    200: {"content": {"text/event-stream": {}}, "description": "SSE: meta, status, delta, discard, done | error"},
    429: {"description": "Hız sınırı (Retry-After)"},
    503: {"description": "Asistan yapılandırılmamış (code: assistant_not_configured)"},
})
@limiter.limit(lambda: settings.assistant_rate_limit)
async def assistant_ask(request: Request, body: AskIn):
    model = configured_model()
    if model is None:
        return JSONResponse({"detail": NOT_CONFIGURED_DETAIL, "code": "assistant_not_configured"}, status_code=503)
    req = to_request(body)
    if req is None:
        return JSONResponse({"detail": "Soru boş olamaz.", "code": "invalid_question"}, status_code=422)
    return StreamingResponse(
        _event_stream(req, model),
        media_type="text/event-stream",
        headers={
            # no-transform: Next's compression and Caddy's encode must not buffer the stream.
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )
