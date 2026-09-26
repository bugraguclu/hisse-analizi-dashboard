"""``/data/*`` and ``/admin/data/*`` — platform status, quality checks, manual refresh.

Two sub-routers are merged into the single ``router`` this module exports so that
``src.api.app`` only needs one ``include_router`` line: the public ``/data/*`` reads
(mirrors ``/stats``, ``/polling-state`` in ``src.api.routers``) and the admin
``/admin/data/*`` triggers (``X-Admin-Key`` + the shared admin rate limit, exactly like
``src.api.routers.admin_router``).
"""

from __future__ import annotations

import asyncio
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.dependencies import require_admin
from src.api.limiter import limiter
from src.core.config import settings
from src.core.time import utcnow
from src.db.repositories.platform import QualityCheckRepository
from src.db.session import get_db
from src.schemas.data import DataStatusOut, QualityCheckOut, QualityRunRequest, RefreshRequest
from src.services import quality_service

DB = Annotated[AsyncSession, Depends(get_db)]

_public = APIRouter(prefix="/data", tags=["data-platform"])
_admin = APIRouter(prefix="/admin/data", tags=["admin", "data-platform"], dependencies=[Depends(require_admin)])

router = APIRouter()
router.include_router(_public)
router.include_router(_admin)


# --- Public: status + quality reads ---

@_public.get("/status", response_model=DataStatusOut)
async def data_status(db: DB) -> dict[str, Any]:
    """Per-domain (universe/market/fundamentals/macro/quality) ingestion + freshness
    snapshot. Aggregate SQL only — answers in well under a second, even empty."""
    return await quality_service.get_data_status(db)


@_public.get("/quality", response_model=list[QualityCheckOut])
async def data_quality(
    db: DB,
    status_: Annotated[str | None, Query(alias="status", pattern="^(pass|warn|fail)$")] = None,
    check: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[Any]:
    """Latest result per ``(check_name, subject)``, optionally filtered."""
    return await QualityCheckRepository(db).latest(status=status_, check_name=check, limit=limit)


@_public.get("/quality/history", response_model=list[QualityCheckOut])
async def data_quality_history(
    db: DB,
    check: Annotated[str | None, Query(max_length=80)] = None,
    subject: Annotated[str | None, Query(max_length=60)] = None,
    days: Annotated[int, Query(ge=1, le=365)] = 30,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
) -> list[Any]:
    since = utcnow() - timedelta(days=days)
    return await QualityCheckRepository(db).history(check_name=check, subject=subject, since=since, limit=limit)


# --- Admin: trigger a check run / a domain refresh ---

@_admin.post("/quality/run")
@limiter.limit(lambda: settings.rate_limit_admin)
async def run_quality(request: Request, db: DB, body: QualityRunRequest | None = None) -> dict[str, Any]:
    """Run the checks now (optionally a subset via ``names``) and return the summary."""
    names = body.names if body is not None else None
    try:
        results = await quality_service.run_quality_checks(db, names=names)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return {"summary": quality_service.summarize_results(results), "results": results}


@_admin.post("/refresh")
@limiter.limit(lambda: settings.rate_limit_admin)
async def refresh_domain(request: Request, body: RefreshRequest) -> dict[str, Any]:
    """Run one domain's ``run_<domain>_once`` now (manual/admin trigger)."""
    try:
        return await quality_service.run_domain_refresh(body.domain, tickers=body.tickers, jobs=body.jobs)
    except quality_service.UnknownDomainError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Bilinmeyen alan: {exc.domain}"
        ) from exc
    except quality_service.DomainModuleUnavailableError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"{exc.domain} yenileme modülü şu anda kullanılamıyor.",
        ) from exc
    except asyncio.TimeoutError as exc:
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="Yenileme işlemi zaman aşımına uğradı."
        ) from exc
