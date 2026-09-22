"""/events query building (compiled against the PostgreSQL dialect, no DB needed)."""

from datetime import datetime, timezone

from sqlalchemy.dialects import postgresql

from src.core.enums import EventCategory, EventType, Severity
from src.db.repository import EventFilters, build_event_count_query, build_event_list_query, escape_like


def compile_sql(stmt) -> tuple[str, dict]:
    compiled = stmt.compile(dialect=postgresql.dialect())
    return str(compiled), compiled.params


def test_base_query_is_single_round_trip_with_stable_order():
    sql, params = compile_sql(build_event_list_query())
    assert "JOIN companies ON companies.id = normalized_events.company_id" in sql
    assert "companies.ticker" in sql.split("FROM")[0]  # company columns eager-loaded (no N+1)
    assert "ORDER BY normalized_events.published_at DESC, normalized_events.id DESC" in sql
    assert params["param_1"] == 50 and params["param_2"] == 0


def test_all_filters():
    since = datetime(2026, 8, 1, tzinfo=timezone.utc)
    until = datetime(2026, 8, 31, tzinfo=timezone.utc)
    filters = EventFilters(
        source_code="kap",
        event_type=EventType.KAP_DISCLOSURE,
        ticker=" thyao ",
        categories=[EventCategory.DIVIDEND, EventCategory.LEGAL],
        severities=[Severity.HIGH],
        since=since,
        until=until,
    )
    sql, params = compile_sql(build_event_list_query(filters, limit=20, offset=40))
    assert "normalized_events.source_code = %(source_code_1)s" in sql
    assert "normalized_events.event_type = %(event_type_1)s" in sql
    assert "companies.ticker = %(ticker_1)s" in sql
    assert params["ticker_1"] == "THYAO"  # exact, normalized — no substring match
    assert "normalized_events.category IN (__[POSTCOMPILE_category_1])" in sql
    assert params["category_1"] == [EventCategory.DIVIDEND, EventCategory.LEGAL]
    assert "normalized_events.severity IN (__[POSTCOMPILE_severity_1])" in sql
    assert params["published_at_1"] == since and params["published_at_2"] == until
    assert "ILIKE" not in sql
    assert params["param_1"] == 20 and params["param_2"] == 40


def test_count_query_uses_the_same_filters_without_paging():
    sql, params = compile_sql(build_event_count_query(EventFilters(ticker="THYAO", severities=[Severity.HIGH])))
    assert sql.startswith("SELECT count(*) AS count_1")
    assert "companies.ticker = %(ticker_1)s" in sql
    assert "LIMIT" not in sql and "ORDER BY" not in sql


def test_search_escapes_like_wildcards():
    sql, params = compile_sql(build_event_list_query(EventFilters(search="100%_a\\b")))
    assert "normalized_events.title ILIKE %(title_1)s ESCAPE '\\\\'" in sql
    assert params["title_1"] == "%100\\%\\_a\\\\b%"
    assert params["ticker_1"] == "100\\%\\_A\\\\B%"  # ticker prefix match, upper-cased


def test_blank_search_is_ignored():
    sql, _ = compile_sql(build_event_list_query(EventFilters(search="   ")))
    assert "ILIKE" not in sql


def test_escape_like():
    assert escape_like("a%b_c\\d") == "a\\%b\\_c\\\\d"
