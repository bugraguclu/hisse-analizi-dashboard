from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.routers import router, admin_router
from src.api.routers_technical import technical_router
from src.api.routers_fundamentals import fundamentals_router
from src.api.routers_macro import macro_router
from src.api.routers_market import market_router

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])


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
    version="0.5.0",
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

DASHBOARD_DIR = STATIC_DIR / "dashboard"


# Dashboard UI routes (must be before static mount)
@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect root to main dashboard."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")


@app.get("/dashboard", include_in_schema=False)
async def dashboard():
    """Main user dashboard UI."""
    return FileResponse(str(DASHBOARD_DIR / "index.html"))


@app.get("/test-ui", include_in_schema=False)
async def test_ui():
    """Developer test UI (API endpoint tester)."""
    return FileResponse(str(STATIC_DIR / "index.html"))


# Static files (CSS/JS) — must be last
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
