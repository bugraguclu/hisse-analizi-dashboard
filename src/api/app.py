import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.routers import router, admin_router
from src.api.routers_technical import technical_router
from src.api.routers_fundamentals import fundamentals_router
from src.api.routers_macro import macro_router
from src.api.routers_market import market_router

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    # Start workers if not in test mode
    if settings.app_env != "test":
        from src.workers.polling_worker import polling_loop
        from src.workers.notification_worker import notification_loop

        polling_task = asyncio.create_task(polling_loop())
        notification_task = asyncio.create_task(notification_loop())

    yield

    if settings.app_env != "test":
        polling_task.cancel()
        notification_task.cancel()


app = FastAPI(
    title="Hisse Analizi Dashboard",
    description="BIST Hisse Analizi Dashboard — teknik/temel analiz, makro veri, tarama ve bildirim sistemi",
    version="0.3.0",
    lifespan=lifespan,
)

# CORS — dashboard ve local gelistirme icin
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routers
app.include_router(router)
app.include_router(admin_router)
app.include_router(technical_router)
app.include_router(fundamentals_router)
app.include_router(macro_router)
app.include_router(market_router)

# Dashboard UI routes (must be before static mount)
@app.get("/", include_in_schema=False)
async def root_redirect():
    """Redirect root to dashboard."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url="/dashboard")


@app.get("/dashboard", include_in_schema=False)
async def dashboard():
    """Developer test dashboard UI."""
    return FileResponse(str(STATIC_DIR / "index.html"))


# Static files (CSS/JS) — must be last
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
