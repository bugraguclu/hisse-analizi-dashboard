"""Minimal streaming client for OpenAI-compatible chat completions (NVIDIA by default).

Uses httpx (already a dependency) instead of the openai SDK: only ``POST
/chat/completions`` with ``stream: true`` and function tools is needed.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from src.core.config import settings

#: A request that failed before anything streamed (connection, 429/5xx) is tried once more.
_ATTEMPTS = 2
_RETRY_DELAY_SECONDS = 1.0
_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


def _thinks_by_default(model: str) -> bool:
    """NVIDIA Nemotron chat models think unless `enable_thinking` is false."""
    return "nemotron" in model.lower()


class LLMError(Exception):
    """Provider failure, with a stable ``code`` for the client (never the provider's text)."""

    def __init__(self, code: str, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


class _Retryable(Exception):
    def __init__(self, error: LLMError) -> None:
        super().__init__(error.code)
        self.error = error


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: str


@dataclass
class TextDelta:
    text: str


@dataclass
class Completion:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None


StreamItem = TextDelta | Completion


class ChatModel(Protocol):
    model: str

    def stream_chat(
        self, messages: Sequence[dict[str, Any]], tools: Sequence[dict[str, Any]] | None
    ) -> AsyncGenerator[StreamItem, None]: ...


def _error_for_status(status: int) -> LLMError:
    if status in (401, 403):
        return LLMError("llm_auth", status)
    if status == 429:
        return LLMError("llm_busy", status)
    if status in (400, 404, 422):
        return LLMError("llm_bad_request", status)
    return LLMError("llm_unavailable", status)


@dataclass
class _Accumulator:
    content: list[str] = field(default_factory=list)
    calls: dict[int, dict[str, str]] = field(default_factory=dict)
    finish: str | None = None

    def add(self, chunk: dict[str, Any]) -> str | None:
        """Merge one streamed chunk; returns its text delta, if any."""
        text_out: list[str] = []
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            text = delta.get("content")
            if isinstance(text, str) and text:
                self.content.append(text)
                text_out.append(text)
            for raw in delta.get("tool_calls") or []:
                index = raw["index"] if isinstance(raw.get("index"), int) else len(self.calls)
                slot = self.calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
                if raw.get("id"):
                    slot["id"] = str(raw["id"])
                function = raw.get("function") or {}
                if function.get("name") and not slot["name"]:
                    slot["name"] = str(function["name"])
                if function.get("arguments"):
                    slot["arguments"] += str(function["arguments"])
            if choice.get("finish_reason"):
                self.finish = str(choice["finish_reason"])
        return "".join(text_out) or None

    def completion(self) -> Completion:
        tool_calls = [
            ToolCall(id=slot["id"] or f"call_{index}", name=slot["name"], arguments=slot["arguments"] or "{}")
            for index, slot in sorted(self.calls.items())
            if slot["name"]
        ]
        return Completion(content="".join(self.content), tool_calls=tool_calls, finish_reason=self.finish)


class OpenAICompatibleChat:
    """``POST {base_url}/chat/completions`` with SSE streaming and tool calls."""

    def __init__(
        self,
        *,
        api_key: str,
        base_url: str,
        model: str,
        timeout_seconds: float,
        max_tokens: int,
        transport: httpx.AsyncBaseTransport | None = None,
        retry_delay: float = _RETRY_DELAY_SECONDS,
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._timeout = httpx.Timeout(connect=15.0, read=timeout_seconds, write=15.0, pool=15.0)
        self._max_tokens = max_tokens
        self._transport = transport
        self._retry_delay = retry_delay

    async def stream_chat(
        self, messages: Sequence[dict[str, Any]], tools: Sequence[dict[str, Any]] | None
    ) -> AsyncGenerator[StreamItem, None]:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": list(messages),
            "temperature": 0.2,
            "top_p": 0.9,
            "max_tokens": self._max_tokens,
            "stream": True,
        }
        if tools:
            body["tools"] = list(tools)
            body["tool_choice"] = "auto"
        if _thinks_by_default(self.model):
            # Nemotron reasons before answering unless told not to: slower, and
            # short or tool-calling turns can come back empty. A system prompt
            # ("/no_think") or reasoning_effort does not switch it off; this does.
            body["chat_template_kwargs"] = {"enable_thinking": False}
        for attempt in range(1, _ATTEMPTS + 1):
            acc = _Accumulator()
            try:
                async for text in self._stream_once(body, acc):
                    yield TextDelta(text)
            except _Retryable as e:
                if attempt == _ATTEMPTS:
                    raise e.error from e
                await asyncio.sleep(self._retry_delay)
                continue
            yield acc.completion()
            return

    async def _stream_once(self, body: dict[str, Any], acc: _Accumulator) -> AsyncGenerator[str, None]:
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "text/event-stream"}
        streamed = False
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                async with client.stream("POST", self._url, json=body, headers=headers) as response:
                    if response.status_code != 200:
                        await response.aread()
                        error = _error_for_status(response.status_code)
                        raise _Retryable(error) if response.status_code in _RETRY_STATUSES else error
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data)
                        except ValueError:
                            continue
                        if not isinstance(chunk, dict):
                            continue
                        if chunk.get("error"):
                            raise LLMError("llm_unavailable")
                        text = acc.add(chunk)
                        if text:
                            streamed = True
                            yield text
        except (LLMError, _Retryable):
            raise
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout) as e:
            raise _Retryable(LLMError("llm_unavailable" if isinstance(e, httpx.ConnectError) else "llm_timeout")) from e
        except httpx.TimeoutException as e:
            raise LLMError("llm_timeout") from e
        except httpx.HTTPError as e:
            error = LLMError("llm_unavailable")
            raise (error if streamed else _Retryable(error)) from e


def configured_model() -> OpenAICompatibleChat | None:
    """The configured client, or ``None`` when no API key is set (assistant disabled)."""
    key = settings.llm_effective_api_key
    if not key:
        return None
    return OpenAICompatibleChat(
        api_key=key,
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        timeout_seconds=settings.llm_timeout_seconds,
        max_tokens=settings.llm_max_output_tokens,
    )
