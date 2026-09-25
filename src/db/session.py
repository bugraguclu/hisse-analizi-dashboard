import asyncio
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.core.config import settings

engine = create_async_engine(
    settings.database_url,
    echo=settings.db_echo,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=300,
)

async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


async def check_database(timeout_seconds: float = 2.0) -> bool:
    """Return True when ``SELECT 1`` succeeds within ``timeout_seconds``."""

    async def _ping() -> None:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))

    try:
        await asyncio.wait_for(_ping(), timeout=timeout_seconds)
    except Exception:
        return False
    return True


async def dispose_engine() -> None:
    """Close every pooled connection (graceful shutdown)."""
    await engine.dispose()
