"""Anthropic Claude API adapter.

Ozellikler:
- Prompt caching: uzun Turkce sistem talimati cache_control ile isaretlenir (~%90 girdi tasarrufu)
- Gunluk harcama limiti (circuit breaker): settings.ai_daily_budget_usd asilirsa istekler durur
- Streaming: SSE endpoint'i icin token-token akis
- SDK yerlesik retry'lari kullanilir (429/5xx exponential backoff)
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime
from typing import Any, AsyncIterator

import structlog

from src.core.config import settings

logger = structlog.get_logger(__name__)

# USD / 1M token — model bazli fiyatlar (2026-07 itibariyla; intro fiyatlar 2026-08-31'e kadar)
MODEL_PRICING: dict[str, tuple[float, float]] = {
    "claude-sonnet-5": (2.00, 10.00),
    "claude-haiku-4-5": (1.00, 5.00),
    "claude-opus-4-8": (5.00, 25.00),
}
_DEFAULT_PRICING = (5.00, 25.00)  # bilinmeyen model: en pahali varsayim (butceyi korur)

# Cache okuma ~0.1x, cache yazma ~1.25x girdi fiyati
_CACHE_READ_MULT = 0.1
_CACHE_WRITE_MULT = 1.25


class LLMNotConfiguredError(RuntimeError):
    """ANTHROPIC_API_KEY tanimli degil."""


class LLMBudgetExceededError(RuntimeError):
    """Gunluk AI harcama limiti asildi."""


@dataclass
class LLMResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


def _calc_cost(model: str, usage: Any) -> float:
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cost = (
        input_tokens * in_price
        + cache_read * in_price * _CACHE_READ_MULT
        + cache_write * in_price * _CACHE_WRITE_MULT
        + output_tokens * out_price
    ) / 1_000_000
    return cost


class DailyBudget:
    """Bellek-ici gunluk harcama sayaci. Gun degisince sifirlanir (Europe/Istanbul yerine UTC gun sinirlari yeterli)."""

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


class LLMClient:
    """AsyncAnthropic sarmalayici — tembel baslatma, maliyet takibi, prompt caching."""

    def __init__(self) -> None:
        self._client: Any = None
        self.budget = DailyBudget(settings.ai_daily_budget_usd)

    @property
    def is_configured(self) -> bool:
        return bool(settings.anthropic_api_key)

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
        """Tek atimlik uretim (stream degil ama SDK stream helper ile timeout-guvenli)."""
        model = model or settings.ai_report_model
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
        cost = _calc_cost(model, message.usage)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_generate_done",
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
        """Token akisi: str parcalari yield eder, en sonda LLMResult yield eder."""
        model = model or settings.ai_report_model
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

        cost = _calc_cost(model, message.usage)
        spent = await self.budget.add(cost)
        logger.info(
            "llm_stream_done",
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


# Uygulama genelinde tek ornek (budget sayaci paylasilir)
llm_client = LLMClient()
