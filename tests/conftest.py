import os
import sys
import uuid

# Ensure src is importable
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Set test environment
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///test.db")
os.environ.setdefault("DATABASE_URL_SYNC", "sqlite:///test.db")

import pytest  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    """Rate-limit counters live in process memory; isolate them per test."""
    from src.api.limiter import limiter

    limiter.reset()
    yield
    limiter.reset()


# ---------------------------------------------------------------------------
# PostgreSQL-backed tests (data platform)
# ---------------------------------------------------------------------------
# Repository / service tests that need real ON CONFLICT semantics, JSONB and
# NUMERIC behaviour run against a throwaway schema in TEST_DATABASE_URL
# (default: the local dev container's ``hisse_analizi_test`` database; CI's
# Postgres service). When the database is unreachable the tests are skipped.

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://hisse:hisse@localhost:5432/hisse_analizi_test"
)


@pytest.fixture(scope="session")
def pg_url() -> str:
    return TEST_DATABASE_URL


@pytest.fixture
async def pg_session(pg_url: str):
    """A fresh, private schema (all tables created, empty) per test; the session commits normally.

    The schema name carries the process id, so several pytest processes (parallel
    agents, CI shards) can share one database. Enum types are created inside the
    schema too, so nothing leaks into ``public``.
    """
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    from src.db.models import Base

    schema = f"t_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    engine = create_async_engine(pg_url, pool_pre_ping=True)
    try:
        async with engine.begin() as conn:
            await conn.execute(text(f"CREATE SCHEMA {schema}"))
            await conn.execute(text(f"SET search_path TO {schema}"))
            await conn.run_sync(Base.metadata.create_all)
    except Exception as e:  # database not reachable in this environment
        await engine.dispose()
        pytest.skip(f"PostgreSQL test database unavailable: {type(e).__name__}")

    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        await session.execute(text(f"SET search_path TO {schema}"))
        try:
            yield session
        finally:
            await session.rollback()
    async with engine.begin() as conn:
        await conn.execute(text(f"DROP SCHEMA IF EXISTS {schema} CASCADE"))
    await engine.dispose()
