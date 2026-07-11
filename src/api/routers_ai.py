"""AI analiz raporu API endpoint'leri (Faz 1)."""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from src.adapters.llm import LLMBudgetExceededError, LLMNotConfiguredError, get_llm_client
from src.api.dependencies import require_admin, validate_ticker
from src.api.limiter import limiter
from src.core.config import settings
from src.db.session import get_db
from src.services import ai_service

ai_router = APIRouter(prefix="/ai", tags=["ai"])

DB = Annotated[AsyncSession, Depends(get_db)]


def _handle_llm_error(e: Exception) -> HTTPException:
    if isinstance(e, LLMNotConfiguredError):
        return HTTPException(status_code=503, detail=str(e))
    if isinstance(e, LLMBudgetExceededError):
        return HTTPException(status_code=429, detail=str(e))
    if isinstance(e, LookupError):
        return HTTPException(status_code=404, detail=str(e))
    return HTTPException(status_code=502, detail=f"AI rapor uretimi basarisiz: {e}")


@ai_router.get("/status")
async def ai_status():
    """AI servisinin durumu: saglayici, yapilandirma ve gunluk butce."""
    llm = get_llm_client()
    return {
        "provider": settings.ai_provider,
        "configured": llm.is_configured,
        "report_model": llm.default_model,
        "daily_budget_usd": settings.ai_daily_budget_usd,
        "spent_today_usd": round(llm.budget.spent_today, 4),
    }


@ai_router.get("/report/{ticker}")
@limiter.limit(lambda: settings.rate_limit_ai)
async def get_report(request: Request, ticker: str, db: DB):
    """Cache'li rapor dondurur; cache yoksa senkron uretir (10-20 sn surebilir)."""
    t = validate_ticker(ticker)
    try:
        return await ai_service.get_or_generate_report(db, t)
    except (LLMNotConfiguredError, LLMBudgetExceededError, LookupError) as e:
        raise _handle_llm_error(e) from e
    except Exception as e:
        raise _handle_llm_error(e) from e


@ai_router.get("/report/{ticker}/stream")
@limiter.limit(lambda: settings.rate_limit_ai)
async def stream_report(request: Request, ticker: str, db: DB):
    """Raporu SSE ile token-token akitir. Cache varsa tek 'cached' olayi doner."""
    t = validate_ticker(ticker)
    llm = get_llm_client()
    if not llm.is_configured:
        key_name = "ANTHROPIC_API_KEY" if settings.ai_provider == "anthropic" else "GEMINI_API_KEY"
        raise HTTPException(
            status_code=503,
            detail=f"{key_name} tanimli degil. .env dosyasina ekleyin.",
        )

    async def event_gen():
        try:
            async for evt in ai_service.stream_report(db, t):
                payload = json.dumps({"text": evt["data"]}, ensure_ascii=False)
                yield f"event: {evt['event']}\ndata: {payload}\n\n"
        except LLMBudgetExceededError as e:
            yield f"event: error\ndata: {json.dumps({'text': str(e)}, ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'text': f'Rapor uretimi basarisiz: {e}'}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@ai_router.post("/report/{ticker}/regenerate", dependencies=[Depends(require_admin)])
@limiter.limit(lambda: settings.rate_limit_ai)
async def regenerate_report(request: Request, ticker: str, db: DB):
    """Admin: cache'i yok sayip yeni rapor uretir."""
    t = validate_ticker(ticker)
    try:
        return await ai_service.get_or_generate_report(db, t, force=True)
    except Exception as e:
        raise _handle_llm_error(e) from e
