"""LLM adapter'lari — Google Gemini (varsayilan) ve Anthropic Claude.

Saglayici `AI_PROVIDER` ile secilir; iki istemci de ayni arayuzu sunar:
- is_configured, budget
- generate(system_prompt, user_content) -> LLMResult
- generate_stream(...) -> str parcalari + sonda LLMResult

Ortak ozellikler:
- Gunluk harcama limiti (circuit breaker): settings.ai_daily_budget_usd asilirsa istekler durur
- Streaming: SSE endpoint'i icin token-token akis
- Maliyet takibi: model bazli fiyat tablosu uzerinden her cagri loglanir
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator

import structlog

from src.core.config import settings

logger = structlog.get_logger(__name__)

# USD / 1M token — model bazli fiyatlar.
# Gemini fiyatlari tahmindir (Google AI Studio fiyat sayfasindan teyit edin);
# butce kesici icin ustten tahmin guvenlidir.
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "gemini-3.5-flash": (0.30, 2.50),
    "gemini-2.5-flash": (0.30, 2.50),
    "claude-sonnet-5": (2.00, 10.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-opus-4-8": (5.00, 25.00),
}
_DEFAULT_PRICING = (5.00, 25.00)  # bilinmeyen model: en pahali varsayim (butceyi korur)

# Anthropic prompt cache carpanlari
_CACHE_READ_MULT = 0.1
_CACHE_WRITE_MULT = 1.25


class LLMNotConfiguredError(RuntimeError):
    """Secili saglayicinin API anahtari tanimli degil."""


class LLMBudgetExceededError(RuntimeError):
    """Gunluk AI harcama limiti asildi."""


@dataclass
class LLMResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


class DailyBudget:
    """Bellek-ici gunluk harcama sayaci. Gun degisince sifirlanir (UTC gun sinirlari)."""

    def __init__(self, limit_usd: float):
        self.limit_usd = limit_usd
        self._day = datetime.utcnow().date()
        self._spent = 0.0
        self._lock = asyncio.Lock()

    def _roll(self) -> None:
        today = datetime.utcnow().date()
        if today != self._day:
            self._day = today
            self._spent = 0.0

    async def check(self) -> None:
        async with self._lock:
            self._roll()
            if self._spent >= self.limit_usd:
                raise LLMBudgetExceededError(
                    f"Gunluk AI butcesi asildi: ${self._spent:.2f} / ${self.limit_usd:.2f}"
                )

    async def add(self, cost_usd: float) -> float:
        async with self._lock:
            self._roll()
            self._spent += cost_usd
            return self._spent

    @property
    def spent_today(self) -> float:
        self._roll()
        return self._spent


# Saglayicilar arasi PAYLASILAN gunluk butce
_shared_budget = DailyBudget(settings.ai_daily_budget_usd)


def _simple_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000


# ---------------------------------------------------------------------------
# Google Gemini (AI Studio) — varsayilan saglayici
# ---------------------------------------------------------------------------


class GeminiClient:
    """google-genai sarmalayici — tembel baslatma, maliyet takibi, streaming."""

    def __init__(self) -> None:
        self._client: Any = None
        self.budget = _shared_budget

    @property
    def is_configured(self) -> bool:
        return bool(settings.gemini_api_key)

    @property
    def default_model(self) -> str:
        return settings.gemini_model

    def _get_client(self) -> Any:
        if not self.is_configured:
            raise LLMNotConfiguredError(
                "GEMINI_API_KEY tanimli degil. https://aistudio.google.com/apikey adresinden "
                "anahtar olusturup .env dosyasina GEMINI_API_KEY=... olarak ekleyin ve "
                "konteynerleri yeniden baslatin."
            )
        if self._client is None:
            from google import genai

            self._client = genai.Client(api_key=settings.gemini_api_key)
        return self._client

    def _config(self, system_prompt: str, max_tokens: int) -> Any:
        from google.genai import types

        return types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=max_tokens,
            temperature=0.3,  # finansal rapor: dusuk sicaklik, tutarli ve veri sadik cikti
        )

    @staticmethod
    def _usage(resp: Any) -> tuple[int, int]:
        meta = getattr(resp, "usage_metadata", None)
        if meta is None:
            return 0, 0
        return (
            int(getattr(meta, "prompt_token_count", 0) or 0),
            int(getattr(meta, "candidates_token_count", 0) or 0),
        )

    async def generate(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult:
        model = model or self.default_model
        max_tokens = max_tokens or settings.ai_report_max_tokens
        await self.budget.check()
        client = self._get_client()

        resp = await client.aio.models.generate_content(
            model=model,
            contents=user_content,
            config=self._config(system_prompt, max_tokens),
        )
        text = resp.text or ""
        in_tok, out_tok = self._usage(resp)
        cost = _simple_cost(model, in_tok, out_tok)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_generate_done",
            provider="gemini",
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=round(cost, 4),
            spent_today_usd=round(spent, 4),
        )
        return LLMResult(text=text, model=model, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost)

    async def generate_stream(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str | LLMResult]:
        model = model or self.default_model
        max_tokens = max_tokens or settings.ai_report_max_tokens
        await self.budget.check()
        client = self._get_client()

        parts: list[str] = []
        in_tok = out_tok = 0
        stream = await client.aio.models.generate_content_stream(
            model=model,
            contents=user_content,
            config=self._config(system_prompt, max_tokens),
        )
        async for chunk in stream:
            if chunk.text:
                parts.append(chunk.text)
                yield chunk.text
            ci, co = self._usage(chunk)
            in_tok = max(in_tok, ci)
            out_tok = max(out_tok, co)

        cost = _simple_cost(model, in_tok, out_tok)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_stream_done",
            provider="gemini",
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=round(cost, 4),
            spent_today_usd=round(spent, 4),
        )
        yield LLMResult(
            text="".join(parts), model=model, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost
        )


# ---------------------------------------------------------------------------
# Anthropic Claude — alternatif saglayici (AI_PROVIDER=anthropic)
# ---------------------------------------------------------------------------


def _anthropic_cost(model: str, usage: Any) -> float:
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    return (
        input_tokens * in_price
        + cache_read * in_price * _CACHE_READ_MULT
        + cache_write * in_price * _CACHE_WRITE_MULT
        + output_tokens * out_price
    ) / 1_000_000


class AnthropicClient:
    """AsyncAnthropic sarmalayici — prompt caching, maliyet takibi, streaming."""

    def __init__(self) -> None:
        self._client: Any = None
        self.budget = _shared_budget

    @property
    def is_configured(self) -> bool:
        return bool(settings.anthropic_api_key)

    @property
    def default_model(self) -> str:
        return settings.ai_report_model

    def _get_client(self) -> Any:
        if not self.is_configured:
            raise LLMNotConfiguredError(
                "ANTHROPIC_API_KEY tanimli degil. .env dosyasina ekleyin ve konteynerleri yeniden baslatin."
            )
        if self._client is None:
            from anthropic import AsyncAnthropic

            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key)
        return self._client

    @staticmethod
    def _system_blocks(system_prompt: str) -> list[dict[str, Any]]:
        # Sabit sistem talimati cache'lenir; degisken veri messages icinde kalir
        return [
            {
                "type": "text",
                "text": system_prompt,
                "cache_control": {"type": "ephemeral"},
            }
        ]

    async def generate(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> LLMResult:
        model = model or self.default_model
        max_tokens = max_tokens or settings.ai_report_max_tokens
        await self.budget.check()
        client = self._get_client()

        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=self._system_blocks(system_prompt),
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            message = await stream.get_final_message()

        text = "".join(b.text for b in message.content if b.type == "text")
        cost = _anthropic_cost(model, message.usage)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_generate_done",
            provider="anthropic",
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cache_read=getattr(message.usage, "cache_read_input_tokens", 0),
            cost_usd=round(cost, 4),
            spent_today_usd=round(spent, 4),
        )
        return LLMResult(
            text=text,
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cost_usd=cost,
        )

    async def generate_stream(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str | LLMResult]:
        model = model or self.default_model
        max_tokens = max_tokens or settings.ai_report_max_tokens
        await self.budget.check()
        client = self._get_client()

        parts: list[str] = []
        async with client.messages.stream(
            model=model,
            max_tokens=max_tokens,
            system=self._system_blocks(system_prompt),
            messages=[{"role": "user", "content": user_content}],
        ) as stream:
            async for text in stream.text_stream:
                parts.append(text)
                yield text
            message = await stream.get_final_message()

        cost = _anthropic_cost(model, message.usage)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_stream_done",
            provider="anthropic",
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cost_usd=round(cost, 4),
            spent_today_usd=round(spent, 4),
        )
        yield LLMResult(
            text="".join(parts),
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cost_usd=cost,
        )


# ---------------------------------------------------------------------------
# Saglayici fabrikasi
# ---------------------------------------------------------------------------

_clients: dict[str, Any] = {}


def get_llm_client() -> GeminiClient | AnthropicClient:
    """AI_PROVIDER ayarina gore tekil istemci dondurur (butce sayaci paylasilir)."""
    provider = settings.ai_provider.lower().strip()
    if provider not in _clients:
        if provider == "anthropic":
            _clients[provider] = AnthropicClient()
        else:
            _clients[provider] = GeminiClient()
    return _clients[provider]
