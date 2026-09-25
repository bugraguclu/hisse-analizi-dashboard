"""/events query building (compiled against the PostgreSQL dialect, no DB needed)."""

from datetime import datetime, timezone

import pytest
from sqlalchemy.dialects import postgresql

from src.core.enums import EventCategory, EventType, Severity
from src.db.repository import (
    EventFilters,
    build_event_count_query,
    build_event_facet_query,
    build_event_page_query,
    escape_like,
    fold_search_text,
)

DISCLOSURE_KEY = "coalesce(normalized_events.event_url, CAST(normalized_events.id AS VARCHAR))"


def compile_sql(stmt) -> tuple[str, dict]:
    compiled = stmt.compile(dialect=postgresql.dialect())
    return str(compiled), compiled.params


def test_page_query_groups_company_rows_of_one_disclosure_with_stable_order():
    sql, params = compile_sql(build_event_page_query())
    assert "JOIN companies ON companies.id = normalized_events.company_id" in sql
    assert f"GROUP BY {DISCLOSURE_KEY}" in sql
    # Representative row = alphabetically first ticker; id breaks ties.
    assert "array_agg(normalized_events.id ORDER BY companies.ticker, normalized_events.id)" in sql
    assert sql.rstrip().endswith("LIMIT %(param_5)s OFFSET %(param_6)s")
    assert "ORDER BY disclosures.published_at DESC, disclosures.rep_id DESC" in sql
    assert params["param_5"] == 50 and params["param_6"] == 0


@pytest.mark.parametrize(
    ("sort", "order"),
    [
        ("newest", "ORDER BY disclosures.published_at DESC, disclosures.rep_id DESC"),
        ("oldest", "ORDER BY disclosures.published_at ASC, disclosures.rep_id ASC"),
        ("severity", "ORDER BY disclosures.severity_rank DESC, disclosures.published_at DESC, disclosures.rep_id DESC"),
        ("ticker", "ORDER BY disclosures.first_ticker ASC, disclosures.published_at DESC, disclosures.rep_id DESC"),
    ],
)
def test_sort_orders(sort, order):
    sql, _ = compile_sql(build_event_page_query(sort=sort))
    assert order in sql


def test_severity_rank_puts_high_first():
    _, params = compile_sql(build_event_page_query(sort="severity"))
    ranks = {params[f"severity_{i}"]: params[f"param_{i}"] for i in (1, 2, 3)}
    assert ranks == {Severity.INFO: 0, Severity.WATCH: 1, Severity.HIGH: 2}


def test_all_filters():
    since = datetime(2026, 8, 1, tzinfo=timezone.utc)
    until = datetime(2026, 8, 31, tzinfo=timezone.utc)
    filters = EventFilters(
        source_code="kap",
        event_type=EventType.KAP_DISCLOSURE,
        ticker=" thyao ",
        tickers=["garan", " AKBNK ", "GARAN", ""],
        categories=[EventCategory.DIVIDEND, EventCategory.SHARE_BUYBACK],
        severities=[Severity.HIGH],
        since=since,
        until=until,
    )
    sql, params = compile_sql(build_event_page_query(filters, limit=20, offset=40))
    assert "normalized_events.source_code = %(source_code_1)s" in sql
    assert "normalized_events.event_type = %(event_type_1)s" in sql
    assert "companies.ticker = %(ticker_1)s" in sql
    assert params["ticker_1"] == "THYAO"  # exact, normalized — no substring match
    assert "companies.ticker IN (__[POSTCOMPILE_ticker_2])" in sql
    assert params["ticker_2"] == ["AKBNK", "GARAN"]  # normalized and de-duplicated
    assert "normalized_events.category IN (__[POSTCOMPILE_category_1])" in sql
    assert params["category_1"] == [EventCategory.DIVIDEND, EventCategory.SHARE_BUYBACK]
    assert "normalized_events.severity IN (__[POSTCOMPILE_severity_4])" in sql
    assert params["published_at_1"] == since and params["published_at_2"] == until
    assert "ILIKE" not in sql


def test_count_query_counts_disclosures_not_company_rows():
    sql, _ = compile_sql(build_event_count_query(EventFilters(ticker="THYAO", severities=[Severity.HIGH])))
    assert sql.startswith(f"SELECT count(DISTINCT {DISCLOSURE_KEY}) AS count_1")
    assert "companies.ticker = %(ticker_1)s" in sql
    assert "LIMIT" not in sql and "ORDER BY" not in sql


def test_facet_queries_ignore_their_own_filter_only():
    filters = EventFilters(categories=[EventCategory.DIVIDEND], severities=[Severity.HIGH], ticker="THYAO")

    category_sql, _ = compile_sql(build_event_facet_query(filters, "category"))
    assert "GROUP BY normalized_events.category" in category_sql
    assert "normalized_events.category IN" not in category_sql
    assert "normalized_events.severity IN" in category_sql and "companies.ticker =" in category_sql
    assert f"count(DISTINCT {DISCLOSURE_KEY})" in category_sql

    severity_sql, _ = compile_sql(build_event_facet_query(filters, "severity"))
    assert "GROUP BY normalized_events.severity" in severity_sql
    assert "normalized_events.severity IN" not in severity_sql
    assert "normalized_events.category IN" in severity_sql


def test_ticker_facet_counts_only_the_asked_codes_and_ignores_the_ticker_filter():
    filters = EventFilters(tickers=["THYAO"], categories=[EventCategory.DIVIDEND])
    sql, params = compile_sql(build_event_facet_query(filters, "ticker", tickers=["garan", "THYAO", "garan", " "]))
    assert "GROUP BY companies.ticker" in sql
    assert f"count(DISTINCT {DISCLOSURE_KEY})" in sql
    assert "normalized_events.category IN" in sql
    # The active ticker filter (THYAO) is dropped; only the candidates restrict the rows.
    assert sql.count("companies.ticker IN") == 1
    assert params["ticker_1"] == ["GARAN", "THYAO"]


def test_search_matches_title_summary_company_and_ticker_prefix_with_escaped_wildcards():
    sql, params = compile_sql(build_event_page_query(EventFilters(search="100%_a\\b")))
    for n, column in enumerate(("normalized_events.title", "normalized_events.excerpt", "companies.display_name")):
        folded = (
            f"translate(replace(lower({column}), %(replace_{2 * n + 1})s, %(replace_{2 * n + 2})s), "
            f"%(translate_{3 * n + 1})s, %(translate_{3 * n + 2})s) LIKE %(translate_{3 * n + 3})s ESCAPE '\\\\'"
        )
        assert folded in sql
        assert params[f"translate_{3 * n + 3}"] == "%100\\%\\_a\\\\b%"  # folded, wildcards escaped
    assert params["ticker_1"] == "100\\%\\_A\\\\B%"  # ticker prefix match, upper-cased


@pytest.mark.parametrize(
    ("text", "folded"),
    [("TEMETTÜ", "temettu"), ("İş Bankası", "is bankasi"), ("IĞDIR  çöü", "igdir cou"), ("Kâr Payı", "kar payi")],
)
def test_search_text_folding_ignores_case_and_turkish_diacritics(text, folded):
    assert fold_search_text(text) == folded


def test_blank_search_is_ignored():
    sql, _ = compile_sql(build_event_page_query(EventFilters(search="   ")))
    assert "LIKE" not in sql


def test_escape_like():
    assert escape_like("a%b_c\\d") == "a\\%b\\_c\\\\d"
