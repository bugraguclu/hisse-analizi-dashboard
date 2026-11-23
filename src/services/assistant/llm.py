"""Minimal streaming client for OpenAI-compatible chat completions (NVIDIA by default).

Uses httpx (already a dependency) instead of the openai SDK: only ``POST
/chat/completions`` with ``stream: true`` and function tools is needed.
"""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol

import httpx

from src.core.config import settings


class LLMError(Exception):
    """Provider failure, with a stable ``code`` for the client (never the provider's text)."""

    def __init__(self, code: str, status: int | None = None) -> None:
        super().__init__(code)
        self.code = code
        self.status = status


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
    ) -> None:
        self.model = model
        self._api_key = api_key
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._timeout = httpx.Timeout(connect=10.0, read=timeout_seconds, write=10.0, pool=10.0)
        self._max_tokens = max_tokens
        self._transport = transport

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
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "text/event-stream"}

        content: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        finish: str | None = None
        try:
            async with httpx.AsyncClient(timeout=self._timeout, transport=self._transport) as client:
                async with client.stream("POST", self._url, json=body, headers=headers) as response:
                    if response.status_code != 200:
                        await response.aread()
                        raise _error_for_status(response.status_code)
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
                        if isinstance(chunk, dict) and chunk.get("error"):
                            raise LLMError("llm_unavailable")
                        for choice in chunk.get("choices") or []:
                            delta = choice.get("delta") or {}
                            text = delta.get("content")
                            if isinstance(text, str) and text:
                                content.append(text)
                                yield TextDelta(text)
                            for raw in delta.get("tool_calls") or []:
                                index = raw.get("index", 0) if isinstance(raw.get("index"), int) else len(calls)
                                slot = calls.setdefault(index, {"id": "", "name": "", "arguments": ""})
                                if raw.get("id"):
                                    slot["id"] = str(raw["id"])
                                function = raw.get("function") or {}
                                if function.get("name") and not slot["name"]:
                                    slot["name"] = str(function["name"])
                                if function.get("arguments"):
                                    slot["arguments"] += str(function["arguments"])
                            if choice.get("finish_reason"):
                                finish = str(choice["finish_reason"])
        except LLMError:
            raise
        except httpx.TimeoutException as e:
            raise LLMError("llm_timeout") from e
        except httpx.HTTPError as e:
            raise LLMError("llm_unavailable") from e

        tool_calls = [
            ToolCall(id=slot["id"] or f"call_{index}", name=slot["name"], arguments=slot["arguments"] or "{}")
            for index, slot in sorted(calls.items())
            if slot["name"]
        ]
        yield Completion(content="".join(content), tool_calls=tool_calls, finish_reason=finish)


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
