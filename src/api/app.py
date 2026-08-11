from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.limiter import limiter
from src.api.routers import router, admin_router
from src.api.routers_technical import technical_router
from src.api.routers_fundamentals import fundamentals_router
from src.api.routers_macro import macro_router
from src.api.routers_market import market_router
from src.api.routers_ai import ai_router
from src.api.routers_news import news_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    # Workers are NOT started here.
    # They run in a dedicated worker process via: python -m src.workers.run_workers
    # See docker-compose.yml 'worker' service.
    yield
    # Cleanup shared HTTP client on shutdown
    from src.adapters.utils import close_http_client
    await close_http_client()


app = FastAPI(
    title="Hisse Analizi Dashboard",
    description="BIST Hisse Analizi Dashboard — teknik/temel analiz, makro veri, tarama ve bildirim sistemi",
    version="0.8.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — config-driven allowlist, defaults to localhost for dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allowed_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)

# API routers
app.include_router(router)
app.include_router(admin_router)
app.include_router(technical_router)
app.include_router(fundamentals_router)
app.include_router(macro_router)
app.include_router(market_router)
app.include_router(ai_router)
app.include_router(news_router)

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/docs")
