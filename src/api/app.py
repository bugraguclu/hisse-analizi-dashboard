import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from src.core.config import settings
from src.core.logging import setup_logging
from src.api.routers import router, admin_router


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
    title="AEFES Listener",
    description="AEFES Haber & KAP Listener — polling tabanlı veri toplama ve bildirim sistemi",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(router)
app.include_router(admin_router)
