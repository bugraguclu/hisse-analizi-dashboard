"""Source upsert keeps operator-tuned columns on re-seed (ON CONFLICT SET clause)."""

from typing import Any

from sqlalchemy.dialects import postgresql

from src.db.repository import SourceRepository


class _CapturingSession:
    def __init__(self) -> None:
        self.stmt: Any = None

    async def execute(self, stmt: Any) -> Any:
        self.stmt = stmt

        class _Result:
            def scalar_one(self) -> None:
                return None

        return _Result()


def _set_clause(sql: str) -> str:
    return sql.split("DO UPDATE SET", 1)[1].split("RETURNING", 1)[0]


async def test_keep_existing_columns_are_insert_only() -> None:
    session = _CapturingSession()
    await SourceRepository(session).upsert(  # type: ignore[arg-type]
        code="kap", name="KAP Bildirimleri", poll_interval_seconds=300, keep_existing=("poll_interval_seconds",)
    )
    sql = str(session.stmt.compile(dialect=postgresql.dialect()))
    assert "poll_interval_seconds" in sql.split("ON CONFLICT", 1)[0]  # still inserted
    assert "poll_interval_seconds" not in _set_clause(sql)
    assert "name" in _set_clause(sql)


async def test_default_upsert_updates_every_column() -> None:
    session = _CapturingSession()
    await SourceRepository(session).upsert(code="kap", name="KAP", poll_interval_seconds=300)  # type: ignore[arg-type]
    assert "poll_interval_seconds" in _set_clause(str(session.stmt.compile(dialect=postgresql.dialect())))
