import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.routers import router, admin_router
from src.api.routers_technical import technical_router
from src.api.routers_fundamentals import fundamentals_router
from src.api.routers_macro import macro_router
from src.api.routers_market import market_router


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
    version="0.2.0",
    lifespan=lifespan,
)

app.include_router(router)
app.include_router(admin_router)
app.include_router(technical_router)
app.include_router(fundamentals_router)
app.include_router(macro_router)
app.include_router(market_router)
