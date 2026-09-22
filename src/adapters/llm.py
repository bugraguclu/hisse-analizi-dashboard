"""LLM adapter'lari — Google Gemini (varsayilan) ve Anthropic Claude.

Haber duygu/etki siniflandirmasi (src/services/news_service.py) tarafindan kullanilir.
Saglayici `AI_PROVIDER` ile secilir; iki istemci de ayni arayuzu sunar:
- is_configured, budget
- generate(system_prompt, user_content) -> LLMResult

Ortak ozellikler:
- Gunluk harcama limiti (circuit breaker): settings.ai_daily_budget_usd asilirsa istekler durur.
  Faturalanan HER saglayici cagrisi `ai_usage` tablosuna bir satir yazar; gunluk harcama
  bu tablonun toplamidir (bkz. DailyBudget) — surecler arasinda paylasilir ve surec
  yeniden baslasa bile kaybolmaz.
- Zaman asimi + 429/5xx icin backoff'lu tekrar deneme (saglayici SDK'lari araciligiyla)
- Maliyet takibi: model bazli fiyat tablosu uzerinden her cagri loglanir
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Literal
from zoneinfo import ZoneInfo

import structlog

from src.core.config import settings

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger(__name__)

# ai_usage.kind — eski satirlarda kaldirilan AI raporunun 'report'/'batch' degerleri de bulunur.
UsageKind = Literal["classification"]

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

# Tek bir LLM cagrisi (bir deneme) icin ust sinir — SDK'nin kendi HTTP
# istemcisine gecilir; hem baglanti hem okuma icin gecerlidir. Streaming
# yanitlarda httpx bunu "art arda iki chunk arasi" olarak uygular, yani
# yavas ama ilerleyen bir stream zaman asimina ugramaz.
_LLM_TIMEOUT_S = 60.0
# Gemini: ilk deneme + tekrarlar (429/5xx/timeout, ustel geri cekilme ile).
# Anthropic SDK'si kendi varsayilan max_retries=2 degerini kullanir.
_LLM_MAX_ATTEMPTS = 3
# Cagiran max_tokens gecmezse kullanilan cikti butcesi.
_DEFAULT_MAX_TOKENS = 2048

# Gunluk butce sifirlanma siniri: Europe/Istanbul gece yarisi (settings.tz).
_BUDGET_TZ = ZoneInfo(settings.tz)


def _day_window_utc(now: datetime | None = None) -> tuple[datetime, datetime]:
    """[bugunun basi, yarinin basi) - yerel (Europe/Istanbul) gune gore, UTC olarak."""
    now = now or datetime.now(timezone.utc)
    local_now = now.astimezone(_BUDGET_TZ)
    start_local = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


# "429" yalnizca tek basina bir sayi olarak: "(14290 token)" gibi bir metin eslesmemeli.
_HTTP_429_RE = re.compile(r"(?<!\d)429(?!\d)")


def is_rate_limit_error(error: BaseException) -> bool:
    """Provider quota / rate-limit errors (Gemini ClientError 429, Anthropic RateLimitError)."""
    for attr in ("code", "status_code", "status"):
        if getattr(error, attr, None) == 429:
            return True
    text = str(error)[:300].upper()
    return "RESOURCE_EXHAUSTED" in text or "RATE LIMIT" in text or bool(_HTTP_429_RE.search(text))


class LLMNotConfiguredError(RuntimeError):
    """Secili saglayicinin API anahtari tanimli degil."""


class LLMBudgetExceededError(RuntimeError):
    """Gunluk AI harcama limiti asildi."""


class LLMTruncatedError(RuntimeError):
    """Model yaniti tamamlanmadan kesildi (uzunluk siniri/guvenlik/diger) — kullanilmaz."""


# Normal tamamlanma disindaki finish_reason/stop_reason degerleri: metin
# VAR olabilir (bos-yanit kontrolunden gecer) ama EKSIKTIR — orn. JSON
# dizisi MAX_TOKENS'te kesilip son basliklar hic etiketlenmemis olabilir.
# Izin listesi (allowlist): BLOCKLIST/PROHIBITED_CONTENT/SPII/LANGUAGE
# (Gemini) veya model_context_window_exceeded/pause_turn (Anthropic) gibi
# diger ve ileride eklenecek tum degerler de "eksik" sayilir.
_GEMINI_OK_FINISH_REASONS = frozenset({"STOP"})
_ANTHROPIC_OK_STOP_REASONS = frozenset({"end_turn", "stop_sequence"})


def _is_incomplete(reason: str | None, ok_reasons: frozenset[str]) -> bool:
    return reason is not None and reason not in ok_reasons


@dataclass
class LLMResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int
    cost_usd: float


class DailyBudget:
    """Gunluk AI harcama sayaci — surecler arasinda PAYLASILIR.

    Kaynak-of-truth `ai_usage` tablosudur: faturalanan HER saglayici cagrisi
    (kesik/bos yanitlar dahil) cagri doner donmez kendi kisa isleminde bir
    satir yazar (`record_usage`). Gunluk harcama, Europe/Istanbul
    gece yarisindan beri `SUM(cost_usd)`'dir ve her kontrolde DB'den okunur:
    surec yeniden baslasa da kaybolmaz, tum surecler ayni toplami gorur.

    Bir LLM cagrisi BASLAMADAN once tahmini (ust-sinir) maliyet `reserve()`
    ile bu surecin `_reserved` sayacina eklenir — ayni surec icindeki es
    zamanli istekler boylece "yolda olan" harcamayi da gorur (atomik
    kontrol-ve-rezervasyon, asyncio.Lock ile). Kullanim satiri yazilinca
    `release()` rezervasyonu geri alir. Rezervasyonlar surece ozeldir: diger
    surecin o an suren cagrilarini gormez (en fazla onlarin tutari kadar asim).
    """

    def __init__(
        self,
        limit_usd: float,
        session_factory: Callable[[], AsyncSession] | None = None,
    ):
        self.limit_usd = limit_usd
        self._reserved = 0.0
        self._lock = asyncio.Lock()
        self._session_factory = session_factory

    def _sessions(self) -> Callable[[], AsyncSession]:
        if self._session_factory is not None:
            return self._session_factory
        from src.db.session import async_session_factory

        return async_session_factory

    async def _committed_spent_today(self) -> float:
        """Bugun (Europe/Istanbul) `ai_usage`'a yazilmis cagrilarin toplam maliyeti."""
        from src.db.repository import AIUsageRepository

        start, end = _day_window_utc()
        async with self._sessions()() as session:
            return await AIUsageRepository(session).cost_between(start, end)

    async def spent_today(self) -> float:
        """DB'ye islenmis + bu surecte suren (rezerve) harcama."""
        return await self._committed_spent_today() + self._reserved

    async def reserve(self, estimated_cost: float) -> None:
        """Cagriyi baslatmadan once butceyi kontrol eder ve tahmini rezerve eder."""
        async with self._lock:
            spent = await self._committed_spent_today() + self._reserved
            if spent + estimated_cost > self.limit_usd:
                raise LLMBudgetExceededError(f"Gunluk AI butcesi asildi: ${spent:.2f} / ${self.limit_usd:.2f}")
            self._reserved += estimated_cost

    def release(self, estimated_cost: float) -> None:
        """Cagri bitince (basarili/basarisiz, bkz. try/finally) rezervasyonu geri alir.

        Bilerek senkron: cagiran iptal edildiginde `finally` blogu iptal
        edilmis (anyio) bir kapsamda calisir; oradaki her `await` tekrar
        iptal edilip rezervasyonu kalici olarak sizdirabilirdi.
        """
        self._reserved = max(0.0, self._reserved - estimated_cost)

    async def record_usage(
        self,
        *,
        provider: str,
        model: str,
        kind: UsageKind,
        ticker: str | None,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> None:
        """Faturalanan bir cagri = bir `ai_usage` satiri, kendi kisa isleminde.

        Hata firlatmaz: muhasebe yazilamadi diye (odenmis) sonuc cope gitmesin;
        DB erisilemiyorsa bir sonraki `reserve()` zaten kapali kalir (fail-closed).
        """
        from src.db.repository import AIUsageRepository

        try:
            async with self._sessions()() as session:
                AIUsageRepository(session).add(
                    provider=provider,
                    model=model,
                    kind=kind,
                    ticker=ticker,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    cost_usd=cost_usd,
                )
                await session.commit()
        except Exception as e:
            logger.error(
                "ai_usage_record_failed",
                provider=provider,
                model=model,
                kind=kind,
                ticker=ticker,
                cost_usd=round(cost_usd, 6),
                error=f"{type(e).__name__}: {e}",
            )


# Saglayicilar arasi PAYLASILAN gunluk butce
_shared_budget = DailyBudget(settings.ai_daily_budget_usd)

# Iptal edilen (istemcisi kopan) cagrilarin kullanim kayitlari ayri gorevlerde
# tamamlanir; gorevlerin cop toplayiciya gitmemesi icin guclu referans.
_pending_usage_writes: set[asyncio.Task[None]] = set()


def _write_usage_in_background(write: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
    task = asyncio.get_running_loop().create_task(write)
    _pending_usage_writes.add(task)
    task.add_done_callback(_pending_usage_writes.discard)
    return task


async def _write_usage(write: Coroutine[Any, Any, None]) -> None:
    """Kullanim satirini yazar; cagiran iptal edilse bile (shield) yazim tamamlanir."""
    await asyncio.shield(_write_usage_in_background(write))


async def _drain_pending_usage_writes() -> None:
    """Testler ve kapanis icin: arka planda suren kullanim yazimlarini bekler."""
    pending: list[Awaitable[None]] = list(_pending_usage_writes)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def _simple_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000


def _estimate_cost(model: str, system_prompt: str, user_content: str, max_tokens: int) -> float:
    """Cagri ONCESI ust-sinir maliyet tahmini (rezervasyon icin).

    Gercek girdi token sayisi saglayiciya sorulmadan bilinemez; kaba bir
    karakter/4 yaklasimiyla girdi, ve modelin CIKTI butcesinin TAMAMINI
    kullanacagi (kotu senaryo) varsayimiyla cikis tahmin edilir. Kasten
    ustten tahmin eder (butceyi korur); gercek maliyet cagri bitince DB'ye
    islenir ve rezervasyon serbest kalir.
    """
    in_price, out_price = MODEL_PRICING.get(model, _DEFAULT_PRICING)
    approx_input_tokens = (len(system_prompt) + len(user_content)) / 4
    return (approx_input_tokens * in_price + max_tokens * out_price) / 1_000_000


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
            from google.genai import types

            self._client = genai.Client(
                api_key=settings.gemini_api_key,
                http_options=types.HttpOptions(
                    timeout=int(_LLM_TIMEOUT_S * 1000),  # ms bekler
                    retry_options=types.HttpRetryOptions(attempts=_LLM_MAX_ATTEMPTS),
                ),
            )
        return self._client

    def _config(self, system_prompt: str, max_tokens: int) -> Any:
        from google.genai import types

        return types.GenerateContentConfig(
            system_instruction=system_prompt,
            max_output_tokens=max_tokens,
            temperature=0.3,  # siniflandirma: dusuk sicaklik, tutarli cikti
            # gemini-3.5-flash "dusunen" bir model: varsayilan dusunme, gorunur
            # cikti icin ayrilan payi (max_output_tokens icinden) tuketip
            # yanitin MAX_TOKENS'te kesilmesine yol acabiliyordu (canlida
            # gozlendi). Baslik siniflandirma agir muhakeme gerektirmez —
            # dusunmeyi kapatip payin tamamini gorunur metne ayir.
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        )

    @staticmethod
    def _usage(resp: Any) -> tuple[int, int]:
        """(girdi, cikti) token'lari — cikti, dusunme (thoughts) token'larini da icerir:
        Gemini onlari cikti fiyatindan faturalar ama candidates_token_count'a katmaz."""
        meta = getattr(resp, "usage_metadata", None)
        if meta is None:
            return 0, 0
        return (
            int(getattr(meta, "prompt_token_count", 0) or 0),
            int(getattr(meta, "candidates_token_count", 0) or 0)
            + int(getattr(meta, "thoughts_token_count", 0) or 0),
        )

    @staticmethod
    def _finish_reason(resp: Any) -> str | None:
        """Ilk kandidatin bitis sebebi (STOP=normal; MAX_TOKENS/SAFETY/... = eksik/kesik)."""
        candidates = getattr(resp, "candidates", None) or []
        if not candidates:
            return None
        reason = getattr(candidates[0], "finish_reason", None)
        if reason is None:
            return None
        # FinishReason bir str-enum'dur (deger karsilastirmasi icin .value guvenli;
        # str() "FinishReason.MAX_TOKENS" gibi yaniltici bir repr donebilir).
        return str(getattr(reason, "value", reason))

    @staticmethod
    def _visible_text(resp: Any) -> str:
        """Yanittan SADECE gorunur metni ayiklar — dusunme (thought) parcalari atlanir.

        Gemini'nin dusunen modellerinde chunk.text dusunme metnini de icerebiliyor;
        parts uzerinden thought=True olanlari filtrelemek tek guvenli yol.
        """
        out: list[str] = []
        for cand in getattr(resp, "candidates", None) or []:
            content = getattr(cand, "content", None)
            for part in getattr(content, "parts", None) or []:
                if getattr(part, "thought", False):
                    continue
                text = getattr(part, "text", None)
                if text:
                    out.append(text)
        return "".join(out)

    def _usage_write(
        self, kind: UsageKind, ticker: str | None, model: str, in_tok: int, out_tok: int
    ) -> Coroutine[Any, Any, None]:
        return self.budget.record_usage(
            provider="gemini",
            model=model,
            kind=kind,
            ticker=ticker,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=_simple_cost(model, in_tok, out_tok),
        )

    async def generate(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
        *,
        kind: UsageKind = "classification",
        ticker: str | None = None,
    ) -> LLMResult:
        model = model or self.default_model
        max_tokens = max_tokens or _DEFAULT_MAX_TOKENS
        client = self._get_client()  # LLMNotConfiguredError rezervasyondan ONCE
        estimate = _estimate_cost(model, system_prompt, user_content, max_tokens)
        await self.budget.reserve(estimate)

        try:
            resp = await client.aio.models.generate_content(
                model=model,
                contents=user_content,
                config=self._config(system_prompt, max_tokens),
            )
            in_tok, out_tok = self._usage(resp)
            # Bos/kesik yanit da faturalanir: kontrollerden ONCE, rezervasyon
            # birakilmadan once yazilir (arada butce "bosluga" dusmez).
            await _write_usage(self._usage_write(kind, ticker, model, in_tok, out_tok))
        finally:
            self.budget.release(estimate)

        cost = _simple_cost(model, in_tok, out_tok)
        logger.info(
            "llm_generate_done",
            provider="gemini",
            model=model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            cost_usd=round(cost, 4),
        )

        text = self._visible_text(resp)
        if not text.strip():
            # Dusunme tokenlari cikti butcesini tuketmis veya guvenlik filtresi
            # devreye girmis olabilir — bos yaniti basarili saymamak icin hata
            # firlat (maliyet yukarida ai_usage'a zaten yazildi, gercekten
            # harcanmis token'lar sessizce kaybolmaz).
            logger.warning("llm_empty_response", provider="gemini", model=model)
            raise RuntimeError(
                "Model bos yanit dondurdu (finish_reason cikti limiti veya guvenlik filtresi olabilir)."
            )
        finish_reason = self._finish_reason(resp)
        if _is_incomplete(finish_reason, _GEMINI_OK_FINISH_REASONS):
            logger.warning(
                "llm_truncated_response", provider="gemini", model=model, finish_reason=finish_reason,
                text_len=len(text),
            )
            raise LLMTruncatedError(f"Model yaniti tamamlanmadan kesildi (finish_reason={finish_reason}).")
        return LLMResult(text=text, model=model, input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost)


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


def _anthropic_input_tokens(usage: Any) -> int:
    """Faturalanan tum girdi token'lari (cache okuma/yazma dahil; maliyet _anthropic_cost'ta)."""
    return sum(
        int(getattr(usage, name, 0) or 0)
        for name in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
    )


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
        return settings.ai_classifier_model

    def _get_client(self) -> Any:
        if not self.is_configured:
            raise LLMNotConfiguredError(
                "ANTHROPIC_API_KEY tanimli degil. .env dosyasina ekleyin ve konteynerleri yeniden baslatin."
            )
        if self._client is None:
            from anthropic import AsyncAnthropic

            # max_retries: SDK varsayilani (2) korunuyor — 429/5xx/baglanti
            # hatalarinda otomatik ustel geri cekilme ile tekrar dener.
            self._client = AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=_LLM_TIMEOUT_S)
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

    def _usage_write(
        self, kind: UsageKind, ticker: str | None, model: str, usage: Any
    ) -> Coroutine[Any, Any, None]:
        return self.budget.record_usage(
            provider="anthropic",
            model=model,
            kind=kind,
            ticker=ticker,
            input_tokens=_anthropic_input_tokens(usage),
            output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
            cost_usd=_anthropic_cost(model, usage),
        )

    async def generate(
        self,
        system_prompt: str,
        user_content: str,
        model: str | None = None,
        max_tokens: int | None = None,
        *,
        kind: UsageKind = "classification",
        ticker: str | None = None,
    ) -> LLMResult:
        model = model or self.default_model
        max_tokens = max_tokens or _DEFAULT_MAX_TOKENS
        client = self._get_client()  # LLMNotConfiguredError rezervasyondan ONCE
        estimate = _estimate_cost(model, system_prompt, user_content, max_tokens)
        await self.budget.reserve(estimate)

        try:
            async with client.messages.stream(
                model=model,
                max_tokens=max_tokens,
                system=self._system_blocks(system_prompt),
                messages=[{"role": "user", "content": user_content}],
            ) as stream:
                message = await stream.get_final_message()
            await _write_usage(self._usage_write(kind, ticker, model, message.usage))
        finally:
            self.budget.release(estimate)

        text = "".join(b.text for b in message.content if b.type == "text")
        cost = _anthropic_cost(model, message.usage)
        logger.info(
            "llm_generate_done",
            provider="anthropic",
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cache_read=getattr(message.usage, "cache_read_input_tokens", 0),
            cost_usd=round(cost, 4),
        )
        if not text.strip():
            logger.warning(
                "llm_empty_response",
                provider="anthropic",
                model=model,
                stop_reason=getattr(message, "stop_reason", None),
            )
            raise RuntimeError(
                "Model bos yanit dondurdu (guvenlik filtresi veya reddetme olabilir)."
            )
        stop_reason = getattr(message, "stop_reason", None)
        if _is_incomplete(stop_reason, _ANTHROPIC_OK_STOP_REASONS):
            logger.warning(
                "llm_truncated_response", provider="anthropic", model=model, stop_reason=stop_reason,
                text_len=len(text),
            )
            raise LLMTruncatedError(f"Model yaniti tamamlanmadan kesildi (stop_reason={stop_reason}).")
        return LLMResult(
            text=text,
            model=model,
            input_tokens=message.usage.input_tokens,
            output_tokens=message.usage.output_tokens,
            cost_usd=cost,
        )


# ---------------------------------------------------------------------------
# Saglayici fabrikasi
# ---------------------------------------------------------------------------

_clients: dict[str, GeminiClient | AnthropicClient] = {}


def get_llm_client() -> GeminiClient | AnthropicClient:
    """AI_PROVIDER ayarina gore tekil istemci dondurur (butce sayaci paylasilir)."""
    provider = settings.ai_provider.lower().strip()
    if provider not in _clients:
        if provider == "anthropic":
            _clients[provider] = AnthropicClient()
        else:
            _clients[provider] = GeminiClient()
    return _clients[provider]
