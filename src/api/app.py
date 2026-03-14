import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.routers import router, admin_router
from src.api.routers_extended import (
    company_router,
    financial_router,
    technical_router,
    macro_router,
    market_router,
    screener_router,
)


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
    title="Hisse Takibi API",
    description="BIST 30 Hisse Takibi — veri toplama, analiz ve bildirim sistemi",
    version="0.2.0",
    lifespan=lifespan,
)

# Mevcut router'lar
app.include_router(router)
app.include_router(admin_router)

# Yeni genişletilmiş router'lar
app.include_router(company_router)
app.include_router(financial_router)
app.include_router(technical_router)
app.include_router(macro_router)
app.include_router(market_router)
app.include_router(screener_router)
