"""Fundamentals worker helpers, the legacy FinancialService wrapper and market inputs (no network)."""

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.adapters.financial_adapter import FUNDAMENTALS_REFRESH_EVENT, FinancialAdapter
from src.core.config import settings
from src.services import fundamentals_service as svc
from src.services.event_service import FinancialService
from src.workers import fundamentals_worker as worker


def test_ratio_window_opens_after_the_istanbul_ratio_hour(monkeypatch):
    monkeypatch.setattr(settings, "fundamentals_ratios_hour", 19)
    assert not worker.ratios_window_open(datetime(2026, 9, 23, 15, 59, tzinfo=timezone.utc))  # 18:59 Istanbul
    assert worker.ratios_window_open(datetime(2026, 9, 23, 16, 0, tzinfo=timezone.utc))  # 19:00 Istanbul
    assert worker.next_ratio_run(datetime(2026, 9, 23, 17, 0, tzinfo=timezone.utc)).day == 24


async def test_unknown_jobs_are_rejected():
    with pytest.raises(ValueError):
        await worker.run_fundamentals_once(["THYAO"], jobs=("fundamentals.everything",))


async def test_run_once_forces_explicit_tickers_and_skips_duplicate_ratio_work(monkeypatch):
    calls = {}

    async def statements(tickers, **kwargs):
        calls["statements"] = (tickers, kwargs)
        return {"job": worker.JOB_STATEMENTS}

    async def ratios(tickers):
        calls["ratios"] = tickers
        return {"job": worker.JOB_RATIOS}

    monkeypatch.setattr(worker, "run_statements_job", statements)
    monkeypatch.setattr(worker, "run_ratios_job", ratios)

    summary = await worker.run_fundamentals_once(["THYAO"])

    assert set(summary) == {worker.JOB_STATEMENTS, worker.JOB_RATIOS}
    tickers, kwargs = calls["statements"]
    assert tickers == ["THYAO"] and kwargs["force"] is True and kwargs["compute_ratios"] is False
    assert calls["ratios"] == ["THYAO"]

    await worker.run_fundamentals_once(None, jobs=(worker.JOB_STATEMENTS,), limit=5)
    _, kwargs = calls["statements"]
    assert kwargs["force"] is False and kwargs["limit"] == 5 and kwargs["compute_ratios"] is True


async def test_statements_job_does_nothing_when_nothing_is_due(monkeypatch):
    async def none_due(**kwargs):
        return []

    monkeypatch.setattr(svc, "due_companies", none_due)

    assert (await worker.run_statements_job())["skipped"] == "nothing_due"


async def test_legacy_adapter_returns_a_refresh_marker_without_network():
    events = await FinancialAdapter().fetch(" thyao ")

    assert len(events) == 1
    assert events[0].source_event_type == FUNDAMENTALS_REFRESH_EVENT
    assert events[0].raw_payload_json == {"ticker": "THYAO", "refresh": True}


async def test_financial_service_is_a_cadence_gated_store_refresh(monkeypatch):
    seen = {}

    async def refresh(ticker, *, max_age=None, **kwargs):
        seen["args"] = (ticker, max_age)
        return svc.RefreshResult(ticker=ticker, ok=True, statements=None, ratios=7)

    monkeypatch.setattr(svc, "refresh_company_statements", refresh)
    company = SimpleNamespace(ticker="THYAO", tracking_tier="core")

    stats = await FinancialService(session=None).process_financials([], company)  # type: ignore[arg-type]

    assert stats == {"financial_records_processed": 0, "financial_ratios_calculated": 7}
    assert seen["args"][0] == "THYAO"
    assert seen["args"][1].total_seconds() == settings.fundamentals_refresh_core_hours * 3600


async def test_financial_service_surfaces_a_failed_refresh(monkeypatch):
    async def refresh(ticker, **kwargs):
        return svc.RefreshResult(ticker=ticker, ok=False, kap_error="MarketDataError: KAP")

    monkeypatch.setattr(svc, "refresh_company_statements", refresh)

    with pytest.raises(RuntimeError, match="KAP"):
        await FinancialService(session=None).process_financials(  # type: ignore[arg-type]
            [], SimpleNamespace(ticker="THYAO", tracking_tier="universe")
        )


@asynccontextmanager
async def _broken_session():
    raise RuntimeError("database down")
    yield  # pragma: no cover


async def test_market_inputs_from_one_scanner_request_when_quotes_are_missing():
    requested = {}

    async def scan(symbols, columns):
        requested["symbols"], requested["columns"] = list(symbols), list(columns)
        return {
            # KCHOL: TradingView's reported count is wrong; its market cap is not.
            "KCHOL": {"close": 221.0, "change_abs": -1.3, "market_cap_basic": 563_730_145_608,
                      "total_shares_outstanding": 1_856_230_000, "price_earnings_ttm": 15.8, "price_book_ratio": 0.83},
            "THYAO": {"close": 300.0, "change_abs": None, "market_cap_basic": 414e9},
        }

    inputs = await svc.load_market_inputs(["kchol", "THYAO", "NOPE"], session_factory=_broken_session, scan=scan)

    assert requested["symbols"] == ["KCHOL", "NOPE", "THYAO"]
    kchol = inputs["KCHOL"]
    assert kchol.price == 221.0 and kchol.price_source == "tradingview"
    assert kchol.implied_shares == pytest.approx(2_535_898_000, rel=1e-6)  # market cap ÷ previous close
    assert kchol.total_shares == 1_856_230_000
    assert kchol.provider_pe == 15.8 and kchol.provider_pb == 0.83
    assert inputs["THYAO"].implied_shares == pytest.approx(1.38e9)  # no change → close is the basis
    assert "NOPE" not in inputs


async def test_fresh_quote_price_wins_over_the_scanner(monkeypatch):
    quote = SimpleNamespace(last=299.5, quote_time=datetime.now(timezone.utc), fetched_at=None)

    class Repo:
        def __init__(self, session):
            pass

        async def quotes(self, symbols):
            return {"THYAO": quote}

    async def scan(symbols, columns):
        return {"THYAO": {"close": 300.0, "change_abs": 1.0, "market_cap_basic": 411e9}}

    monkeypatch.setattr(svc, "FundamentalsRepository", Repo)

    inputs = await svc.load_market_inputs(["THYAO"], session=object(), scan=scan)  # type: ignore[arg-type]

    assert inputs["THYAO"].price == 299.5 and inputs["THYAO"].price_source == "quotes"


def test_ratio_checks_compare_ttm_pe_and_annual_pb_with_tradingview():
    rows = [
        {"period": "2026/06", "basis": "ttm", "pe_ratio": 3.68, "pb_ratio": 0.40},
        {"period": "2025/12", "basis": "annual", "pe_ratio": 3.48, "pb_ratio": 0.45},
    ]
    market = svc.MarketInputs(price=300.0, provider_pe=3.66, provider_pb=0.45)

    checks = {c["check_name"]: c for c in svc.ratio_checks("THYAO", rows, market)}

    assert checks["fundamentals.ratios.pe_vs_tradingview"]["status"] == "pass"
    assert checks["fundamentals.ratios.pe_vs_tradingview"]["actual"] == 3.68
    assert checks["fundamentals.ratios.pb_vs_tradingview"]["actual"] == 0.45  # the annual row, like TradingView
    assert svc.ratio_checks("THYAO", rows, None) == []


def test_shares_check_flags_tradingview_share_count_errors():
    check = svc.shares_check("KCHOL", 2_536e6, svc.MarketInputs(total_shares=1_856_230_000, implied_shares=2_535_898_126))

    assert check is not None and check["status"] == "fail"
    assert check["deviation"] == pytest.approx(1_856_230_000 / 2_536e6 - 1)
    assert check["details"]["shares_source"] == "paid_in_capital"
    assert svc.shares_check("KCHOL", None, svc.MarketInputs(total_shares=1.0)) is None
