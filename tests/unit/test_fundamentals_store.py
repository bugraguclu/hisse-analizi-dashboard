"""Store-first reads (docs/data-platform.md §4.1) for the statement views and live ratios:
store hit, live miss, stale fallback, error contract — providers and the database are faked."""

import json
import uuid
from datetime import date, datetime, timedelta, timezone

import pytest

from src.adapters import fundamentals_statements as fs
from src.adapters.utils import MarketDataError, SymbolNotFoundError
from src.db.models import Company, FinancialFact, FinancialStatement
from src.services import fundamentals_service as svc
from tests.unit.test_fundamentals_data_quality import KAP_SUMMARY_HTML
from tests.unit.test_fundamentals_rows import ISY_TABLE

NOW = datetime.now(timezone.utc)
KAP_URL = "https://www.kap.org.tr/tr/sirket-finansal-bilgileri/1107-turk-hava-yollari-a-o"


def _sources():
    kap = fs._parse_kap_financial_summary(KAP_SUMMARY_HTML)
    kap["source_url"] = KAP_URL
    return kap, json.loads(json.dumps(ISY_TABLE))


def _rows(kap, isy, fetched_at):
    rows = []
    for row in fs.kap_statement_rows(kap) + fs.isyatirim_statement_rows(isy, ticker="THYAO"):
        statement = FinancialStatement(**row)
        statement.fetched_at = fetched_at
        rows.append(statement)
    return rows


def _manifest(kap, isy, fetched_at, *, attempt_ok=True, attempted_at=None):
    return svc.Manifest(
        ticker="THYAO",
        payload={
            "kap": {"ok": True, "fetched_at": fetched_at.isoformat(), "periods": kap["periods"], "source_url": KAP_URL},
            "isyatirim": {"ok": True, "fetched_at": fetched_at.isoformat(), "periods": isy["periods"]},
            "last_attempt_at": (attempted_at or fetched_at).isoformat(),
            "last_attempt_ok": attempt_ok,
        },
    )


def _company():
    return Company(id=uuid.uuid4(), ticker="THYAO", legal_name="THY", display_name="THY",
                   tracking_tier="core", statement_template="industrial", fiscal_year_end_month=12)


def _state(age_hours=1.0, *, tracked=True, attempt_ok=True, attempted_minutes_ago=None, with_rows=True):
    kap, isy = _sources()
    fetched = NOW - timedelta(hours=age_hours)
    attempted = NOW - timedelta(minutes=attempted_minutes_ago) if attempted_minutes_ago is not None else None
    state = svc.StoreState(ticker="THYAO")
    if tracked:
        state.company = _company()
        state.manifest = _manifest(kap, isy, fetched, attempt_ok=attempt_ok, attempted_at=attempted)
        state.rows = _rows(kap, isy, fetched) if with_rows else []
    return state


@pytest.fixture
def fake(monkeypatch):
    """Configurable store + live providers; records live calls and background refreshes."""
    calls = {"live": 0, "background": [], "state": _state(), "live_error": None}

    async def load_store(ticker, *, with_facts=False, session_factory=None):
        return calls["state"]

    async def live_sources(ticker, isy_wait=0.0):
        calls["live"] += 1
        if calls["live_error"] is not None:
            raise calls["live_error"]
        return _sources()

    monkeypatch.setattr(svc, "load_store", load_store)
    monkeypatch.setattr(fs, "_load_statement_sources", live_sources)
    monkeypatch.setattr(svc, "start_background_refresh", lambda ticker, session_factory=None: calls["background"].append(ticker))
    return calls


def _without_meta(payload):
    return {k: v for k, v in payload.items() if k != "meta"}


async def test_fresh_store_is_served_without_touching_the_providers(fake):
    payload = await svc.get_statement_view("THYAO", section="balance", quarterly=True)

    kap, isy = _sources()
    expected = fs.build_statement_view("THYAO", kap, isy, quarterly=True, section="balance")
    assert json.dumps(_without_meta(payload), sort_keys=True) == json.dumps(expected, sort_keys=True)
    assert payload["meta"]["served_from"] == "store"
    assert payload["meta"]["stale"] is False
    assert payload["meta"]["source"] == "kap+isyatirim"
    assert payload["meta"]["source_url"] == KAP_URL
    assert payload["meta"]["as_of"] == payload["as_of"]
    assert fake["live"] == 0 and fake["background"] == []


async def test_missing_store_fetches_live_and_stores_in_the_background(fake):
    fake["state"] = _state(tracked=True, with_rows=False)

    payload = await svc.get_statement_view("THYAO", section="income", quarterly=False)

    assert payload["meta"]["served_from"] == "live"
    assert payload["source"] == "KAP" and payload["data"]
    assert fake["live"] == 1
    assert fake["background"] == ["THYAO"]


async def test_untracked_symbol_is_served_live_without_storing(fake):
    fake["state"] = _state(tracked=False)

    payload = await svc.get_cashflow_view("SNPAM", quarterly=False)

    assert payload["meta"]["served_from"] == "live"
    assert fake["background"] == []


async def test_stale_store_is_served_when_the_provider_fails(fake):
    fake["state"] = _state(age_hours=24 * 10)
    fake["live_error"] = MarketDataError("KAP'a şu anda ulaşılamıyor", status_code=503)

    payload = await svc.get_statement_view("THYAO", section="balance", quarterly=False)

    assert payload["meta"]["served_from"] == "stale"
    assert payload["meta"]["stale"] is True
    assert payload["meta"]["notes"] == ["Sağlayıcıya ulaşılamadı; son kayıtlı veri"]
    assert payload["available"] is True and "error" not in payload
    assert fake["live"] == 1


async def test_recent_failed_refresh_serves_the_store_without_retrying(fake):
    fake["state"] = _state(age_hours=24 * 10, attempt_ok=False, attempted_minutes_ago=5)

    payload = await svc.get_statement_view("THYAO", section="balance", quarterly=False)

    assert payload["meta"]["served_from"] == "stale"
    assert fake["live"] == 0


async def test_empty_store_and_failing_provider_keep_the_error_contract(fake):
    fake["state"] = _state(tracked=False)
    fake["live_error"] = MarketDataError("Finansal tablolar şu anda alınamıyor", status_code=503)

    payload = await svc.get_statement_view("THYAO", section="balance", quarterly=False)

    assert payload == {"ticker": "THYAO", "data": [], "error": "Finansal tablolar şu anda alınamıyor",
                       "error_status": 503}


async def test_unknown_symbol_is_404(fake):
    fake["state"] = _state(tracked=False)
    fake["live_error"] = SymbolNotFoundError("XXXX")

    payload = await svc.get_statement_view("XXXX", section="balance", quarterly=False)

    assert payload["error_status"] == 404


def _facts_rows():
    values = {
        "2025/12": {"revenue": 955.0, "gross_profit": 155.0, "operating_profit": 90.0, "net_income": 118.0,
                    "net_income_parent": 118.0, "total_assets": 1_996.0, "total_equity": 911.0,
                    "parent_equity": 911.0, "paid_in_capital": 1.38, "depreciation_amortization": 94.0},
        "2024/12": {"revenue": 745.0, "net_income": 113.0, "net_income_parent": 113.0, "total_assets": 1_399.0,
                    "total_equity": 680.0, "parent_equity": 680.0},
    }
    rows = []
    for period, items in values.items():
        rows.append(FinancialFact(period=period, fiscal_year_end_month=12, months=12, template="industrial",
                                  sources_json={"balance": "kap", "income": "kap", "cashflow": "isyatirim"},
                                  **items))
    return rows


async def test_live_ratios_use_stored_facts_and_the_live_price(fake, monkeypatch):
    state = _state()
    state.facts = _facts_rows()
    fake["state"] = state

    async def snapshot(ticker):
        return {"last_price": 300.0, "shares": 1.38}

    monkeypatch.setattr(fs, "live_market_snapshot", snapshot)

    payload = await svc.get_live_ratios_view("THYAO")

    assert payload["meta"]["served_from"] == "store"
    assert payload["as_of"] == "2025/12" and payload["basis"] == "annual"
    assert payload["valuation"]["market_cap"] == pytest.approx(300.0 * 1.38)
    assert payload["ratios"]["pe_ratio"] == pytest.approx(round(300.0 * 1.38 / 118.0, 2))
    assert payload["source"] == "KAP + İş Yatırım finansal tabloları; TradingView fiyatı"
    assert fake["live"] == 0


async def test_live_ratios_fall_back_to_stale_facts(fake, monkeypatch):
    state = _state(age_hours=24 * 10)
    state.facts = _facts_rows()
    fake["state"] = state
    fake["live_error"] = MarketDataError("x", status_code=503)

    async def snapshot(ticker):
        return {"last_price": 300.0, "shares": 1.38}

    monkeypatch.setattr(fs, "live_market_snapshot", snapshot)

    payload = await svc.get_live_ratios_view("THYAO")

    assert payload["meta"]["stale"] is True and payload["available"] is True


def test_manifest_freshness_needs_both_sources():
    kap, isy = _sources()
    manifest = _manifest(kap, isy, NOW - timedelta(hours=2))
    assert manifest.refreshed_at == NOW - timedelta(hours=2)
    manifest.payload["isyatirim"] = {"ok": False, "error": "timeout"}
    assert manifest.refreshed_at is None
    assert manifest.last_success_at == NOW - timedelta(hours=2)


def test_refresh_due_respects_cadence_and_retry_window():
    kap, isy = _sources()
    cadence, retry = timedelta(hours=72), timedelta(hours=6)
    assert svc.refresh_due(None, NOW, cadence, retry)
    assert not svc.refresh_due(_manifest(kap, isy, NOW - timedelta(hours=10)), NOW, cadence, retry)
    assert svc.refresh_due(_manifest(kap, isy, NOW - timedelta(hours=80)), NOW, cadence, retry)
    failed_recently = _manifest(kap, isy, NOW - timedelta(hours=80), attempt_ok=False,
                                attempted_at=NOW - timedelta(hours=1))
    assert not svc.refresh_due(failed_recently, NOW, cadence, retry)


def test_published_dates_pick_the_first_report_after_the_period_end():
    reports = [datetime(2026, 3, 4, 15, 0, tzinfo=timezone.utc), datetime(2026, 4, 29, 15, 20, tzinfo=timezone.utc),
               datetime(2026, 8, 4, 21, 30, tzinfo=timezone.utc)]  # 5 Aug 00:30 in Istanbul

    dates = svc.published_dates(["2025/12", "2026/03", "2026/06", "2024/12"], reports)

    assert dates == {"2025/12": date(2026, 3, 4), "2026/03": date(2026, 4, 29), "2026/06": date(2026, 8, 5)}


def test_published_dates_never_borrow_the_next_quarters_report():
    # The FY 2025 report is not among the stored disclosures: 2025/12 stays unknown.
    reports = [datetime(2026, 4, 29, 15, 20, tzinfo=timezone.utc), datetime(2026, 4, 29, 15, 20, tzinfo=timezone.utc)]

    assert svc.published_dates(["2025/12", "2026/03"], reports) == {"2026/03": date(2026, 4, 29)}
    # A late annual report (early April) still belongs to the fiscal year, not to Q1.
    late = [datetime(2026, 4, 6, 9, 0, tzinfo=timezone.utc)]
    assert svc.published_dates(["2025/12", "2026/03"], late) == {"2025/12": date(2026, 4, 6)}


def test_meta_header_is_ascii_json():
    kap, isy = _sources()
    state = _state()
    header = svc.meta_header(state.meta("stale", stale=True, notes=["Sağlayıcıya ulaşılamadı"]))

    assert header.isascii()
    assert json.loads(header)["notes"] == ["Sağlayıcıya ulaşılamadı"]
