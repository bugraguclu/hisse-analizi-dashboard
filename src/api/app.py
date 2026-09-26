import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import structlog
from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import http_exception_handler as fastapi_http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from slowapi.errors import RateLimitExceeded
from starlette.exceptions import HTTPException as StarletteHTTPException

from src.api.limiter import RATE_LIMIT_DETAIL, enforce_default_rate_limit, limiter
from src.api.middleware import INTERNAL_ERROR_DETAIL, REQUEST_ID_HEADER, RequestContextMiddleware
from src.api.routers import admin_router, router
from src.api.routers_data import router as data_router
from src.api.routers_fundamentals import fundamentals_router
from src.api.routers_macro import macro_router
from src.api.routers_market import market_router
from src.api.routers_news import news_router
from src.api.routers_technical import technical_router
from src.core.config import settings
from src.core.logging import setup_logging
from src.core.version import get_version
from src.db.session import dispose_engine

logger = structlog.get_logger(__name__)

# Default Starlette/FastAPI error phrases -> Turkish (custom details are kept as-is).
_DEFAULT_DETAIL_TR = {
    "Not Found": "Kaynak bulunamadı.",
    "Method Not Allowed": "Bu HTTP metodu desteklenmiyor.",
    "Unauthorized": "Kimlik doğrulaması gerekli.",
    "Forbidden": "Bu işlem için yetkiniz yok.",
    "Bad Request": "Geçersiz istek.",
    "Internal Server Error": INTERNAL_ERROR_DETAIL,
}


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    setup_logging()
    logger.info("api_startup", version=get_version(), environment=settings.app_env)
    # Workers are NOT started here.
    # They run in a dedicated worker process via: python -m src.workers.run_workers
    # See docker-compose.yml 'worker' service.
    yield
    # Graceful shutdown: shared HTTP client + DB connection pool
    from src.adapters.utils import close_http_client

    await close_http_client()
    await dispose_engine()


app = FastAPI(
    title="Hisse Analizi Dashboard",
    description="BIST Hisse Analizi Dashboard — teknik/temel analiz, makro veri, tarama ve bildirim sistemi",
    version=get_version(),
    lifespan=lifespan,
    dependencies=[Depends(enforce_default_rate_limit)],
)

app.state.limiter = limiter


def _retry_after_seconds(request: Request) -> int | None:
    """Seconds until the exhausted rate-limit window resets (slowapi bookkeeping)."""
    current = getattr(request.state, "view_rate_limit", None)
    if not current:
        return None
    try:
        reset_at, _remaining = limiter.limiter.get_window_stats(current[0], *current[1])
    except Exception:
        return None
    return max(1, int(reset_at - time.time()) + 1)


async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> JSONResponse:
    headers: dict[str, str] = {}
    retry_after = _retry_after_seconds(request)
    if retry_after is not None:
        headers["Retry-After"] = str(retry_after)
    logger.info("rate_limit_exceeded", path=request.url.path, limit=str(getattr(exc, "detail", "")))
    return JSONResponse({"detail": RATE_LIMIT_DETAIL}, status_code=429, headers=headers)


async def http_exception_handler(request: Request, exc: Exception) -> Response:
    """FastAPI's default handler, with the stock English phrases translated."""
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover - registration guarantees it
        raise exc
    detail: Any = exc.detail
    if isinstance(detail, str) and detail in _DEFAULT_DETAIL_TR:
        exc = StarletteHTTPException(exc.status_code, detail=_DEFAULT_DETAIL_TR[detail], headers=exc.headers)
    return await fastapi_http_exception_handler(request, exc)


async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Safety net (RequestContextMiddleware normally converts errors first)."""
    logger.error("unhandled_exception", path=request.url.path, exc_info=exc)
    request_id = getattr(request.state, "request_id", None)
    headers = {REQUEST_ID_HEADER: request_id} if request_id else None
    return JSONResponse({"detail": INTERNAL_ERROR_DETAIL}, status_code=500, headers=headers)


app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
app.add_exception_handler(Exception, unhandled_exception_handler)

# Middleware order: the last added is the outermost. CORS wraps the request context
# middleware so that even the generic 500 response carries CORS headers.
app.add_middleware(RequestContextMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key", REQUEST_ID_HEADER],
    expose_headers=[REQUEST_ID_HEADER, "Retry-After", "X-Total-Count", "X-Data-Meta"],
)

# API routers
app.include_router(router)
app.include_router(admin_router)
app.include_router(technical_router)
app.include_router(fundamentals_router)
app.include_router(macro_router)
app.include_router(market_router)
app.include_router(news_router)
app.include_router(data_router)


@app.get("/", include_in_schema=False)
async def root_redirect() -> RedirectResponse:
    return RedirectResponse(url="/docs")
