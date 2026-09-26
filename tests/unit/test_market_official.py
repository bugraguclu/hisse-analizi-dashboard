"""Per-symbol accuracy rules: P/B field, share count = paid-in capital, official (OneEndeks) volume,
post-close quote time cap — with the 2026-09-23 BIMAS/SASA figures (no network, no database)."""

from datetime import UTC, date, datetime

import pytest

from src.adapters import fundamentals_snapshot as fs
from src.adapters import isyatirim_prices, price, stream_adapter
from src.adapters.isyatirim_prices import parse_quote
from src.adapters.utils import ISTANBUL_TZ, MarketDataError, adapter_cache
from src.core.meta import DataMeta
from src.services import market_service as ms

SESSION = date(2026, 9, 23)
BAR_OPEN = 1790143200  # 2026-09-23 09:00 Istanbul (TradingView ``time``)
POST_CLOSE_TICK = 1790180225  # 19:17:05 — TradingView keeps refreshing update_time after the close
CLOSE_1810 = 1790176200  # 18:10:00
AFTER_CLOSE = datetime(2026, 9, 23, 21, 0, tzinfo=ISTANBUL_TZ)
IN_SESSION = datetime(2026, 9, 23, 14, 0, tzinfo=ISTANBUL_TZ)

# TradingView scanner rows after the close (live values of 2026-09-23).
BIMAS_ROW = {
    "close": 433.75, "open": 430.25, "high": 437.5, "low": 429.75, "change": 0.8135, "change_abs": 3.5,
    "volume": 6580903, "Value.Traded": 2854466676.25, "market_cap_basic": 510181857605,
    "total_shares_outstanding": 1185780000, "price_book_ratio": 3.106159175279112,
    "price_book_fq": 2.5543749125108186, "price_earnings_ttm": 18.970290447720725, "description": "BİM",
    "currency": "TRY", "update_time": POST_CLOSE_TICK, "time": BAR_OPEN,
}
SASA_ROW = {
    "close": 2.26, "open": 2.29, "high": 2.3, "low": 2.24, "change": -1.31, "change_abs": -0.03,
    "volume": 2453505160, "Value.Traded": 5544921661.6, "market_cap_basic": 120195084873,
    "total_shares_outstanding": 52498747500, "price_book_ratio": 0.6417501036454812,
    "price_book_fq": 0.5517308725159904, "price_earnings_ttm": None, "update_time": 1790180710, "time": BAR_OPEN,
}
# İş Yatırım company card after its evening update (market cap at the day's close).
BIMAS_CARD = {"market_cap": 520_500_000_000, "pb_ratio": 2.6, "free_float": 67.9, "foreign_ratio": 49.48}


def _oneendeks(symbol, *, last, prev, quantity, volume, capital, equity, update="2026-09-23T18:09:54.000+03"):
    return parse_quote(symbol, {
        "updateDate": update, "last": last, "dayClose": prev, "open": prev, "high": last, "low": prev,
        "quantity": quantity, "volume": volume, "capital": capital, "equity": equity, "bid": last, "ask": last,
        "symbol": symbol,
    })


BIMAS_OFFICIAL = _oneendeks("BIMAS", last=433.75, prev=430.25, quantity=6580903, volume=2854686306.5,
                            capital=1_200_000_000, equity=201_353_398_000)
SASA_OFFICIAL = _oneendeks("SASA", last=2.26, prev=2.29, quantity=2473505158, volume=5665266988.47,
                           capital=52_501_931_146.27, equity=192_675_743_000, update="2026-09-23T18:09:56.000+03")


@pytest.fixture(autouse=True)
def _clean_cache():
    adapter_cache.clear()
    yield
    adapter_cache.clear()


# --- OneEndeks parsing ----------------------------------------------------------------------

def test_oneendeks_quote_carries_capital_equity_and_session_day():
    assert BIMAS_OFFICIAL["capital"] == 1_200_000_000 and BIMAS_OFFICIAL["equity"] == 201_353_398_000
    assert BIMAS_OFFICIAL["session_date"] == SESSION
    assert (BIMAS_OFFICIAL["volume"], BIMAS_OFFICIAL["turnover"]) == (6580903, 2854686306.5)  # lots, TL
    index = parse_quote("XU100", {"updateDate": "2026-09-23T18:10:12.000+03", "last": 13251.85, "dayClose": 1.0})
    assert index["capital"] is None and index["equity"] is None


# --- P/B field ------------------------------------------------------------------------------

def test_pb_is_market_cap_over_latest_quarter_equity_then_price_book_fq_never_the_annual_ratio():
    assert "price_book_fq" in ms.EXTRA_COLUMNS and "price_book_ratio" not in ms.EXTRA_COLUMNS
    assert "price_book_fq" in fs._SNAPSHOT_COLUMNS and "price_book_ratio" not in fs._SNAPSHOT_COLUMNS
    # 433.75 × 1.2 bn / 201.35 bn = 2.585 (İş Yatırım card 2.6; TradingView fq 2.554, annual 3.106)
    assert ms.price_to_book(520_500_000_000, 201_353_398_000, 2.5543) == (2.59, ms.PB_SOURCE_EQUITY)
    assert ms.price_to_book(None, 201_353_398_000, 2.5543) == (2.55, ms.PB_SOURCE_TRADINGVIEW)
    assert ms.price_to_book(520_500_000_000, None, None) == (None, None)
    assert ms.price_to_book(1e9, -5e8, 0.4)[0] == -2.0  # negative equity stays visible as ≤ 0

    fallback = fs._snapshot_from_scan(BIMAS_ROW, {}, now=AFTER_CLOSE)
    assert fallback["pb_ratio"] == 2.55 and fallback["pb_source"] == ms.PB_SOURCE_TRADINGVIEW
    fixed = fs._snapshot_from_scan(BIMAS_ROW, BIMAS_CARD, official=BIMAS_OFFICIAL,
                                   capital=ms.company_capital("BIMAS", BIMAS_OFFICIAL), now=AFTER_CLOSE)
    assert fixed["pb_ratio"] == 2.59 and fixed["pb_source"] == ms.PB_SOURCE_EQUITY
    assert fixed["pe_ratio"] == 18.97  # P/E stays TradingView price_earnings_ttm


# --- share count / market cap ---------------------------------------------------------------

def test_share_count_is_the_oneendeks_capital_then_the_stored_paid_in_capital():
    exact = ms.share_count(2_535_898_050, 2_536_000_000)  # KCHOL: the statement rounds to millions
    assert (exact.capital, exact.source) == (2_535_898_050, ms.SHARES_SOURCE_ISYATIRIM)
    stored = ms.share_count(None, 2_536_000_000)
    assert (stored.shares, stored.source) == (2_536_000_000, ms.SHARES_SOURCE_PAID_IN)
    assert ms.share_count(None, None).capital is None and ms.share_count(0, -1).source is None
    sasa = ms.share_count(52_501_931_146.27, None)
    assert sasa.shares == 52_501_931_146 and sasa.market_cap(2.26) == pytest.approx(118_654_364_390.57, abs=0.01)


def test_bimas_after_the_close_uses_paid_in_capital_not_the_card_over_previous_close():
    legacy = fs._snapshot_from_scan(BIMAS_ROW, BIMAS_CARD, now=AFTER_CLOSE)
    assert legacy["shares"] == 1_209_761_766  # 520.5 bn / 430.25: the audited inflation
    assert legacy["shares_source"] == ms.SHARES_SOURCE_MARKET

    fixed = fs._snapshot_from_scan(BIMAS_ROW, BIMAS_CARD, official=BIMAS_OFFICIAL,
                                   capital=ms.company_capital("BIMAS", BIMAS_OFFICIAL), stored_capital=1.2e9,
                                   now=AFTER_CLOSE)
    assert fixed["shares"] == 1_200_000_000 and fixed["market_cap"] == 520_500_000_000.0
    assert fixed["shares_source"] == ms.SHARES_SOURCE_ISYATIRIM

    from_store = fs._snapshot_from_scan(BIMAS_ROW, BIMAS_CARD, stored_capital=1.2e9, now=AFTER_CLOSE)
    assert from_store["shares"] == 1_200_000_000 and from_store["shares_source"] == ms.SHARES_SOURCE_PAID_IN
    assert from_store["pb_source"] == ms.PB_SOURCE_TRADINGVIEW  # no equity without OneEndeks


# --- volume / turnover ----------------------------------------------------------------------

def test_official_volume_replaces_tradingview_for_the_same_session_only():
    sasa = fs._snapshot_from_scan(SASA_ROW, {}, official=SASA_OFFICIAL,
                                  capital=ms.company_capital("SASA", SASA_OFFICIAL), now=AFTER_CLOSE)
    assert (sasa["volume"], sasa["amount"]) == (2473505158, 5665266988.47)  # +19,999,998 lots vs TradingView
    assert sasa["volume_source"] == ms.VOLUME_SOURCE_ISYATIRIM
    assert sasa["pb_ratio"] == 0.62 and sasa["market_cap"] == pytest.approx(118_654_364_390.57, abs=0.01)

    yesterday = {**SASA_OFFICIAL, "session_date": date(2026, 9, 22)}
    other = fs._snapshot_from_scan(SASA_ROW, {}, official=yesterday, now=AFTER_CLOSE)
    assert (other["volume"], other["amount"]) == (2453505160, 5544921661.6)
    assert other["volume_source"] == ms.VOLUME_SOURCE_TRADINGVIEW
    assert fs._snapshot_from_scan(SASA_ROW, {}, now=AFTER_CLOSE)["volume_source"] == ms.VOLUME_SOURCE_TRADINGVIEW


async def test_small_snapshots_carry_official_volume_and_market_cap(monkeypatch):
    stored_quote = {**price.quote_from_scan("SASA", {**SASA_ROW, "close[1]": 2.29}), "fetched_at": datetime.now(UTC)}

    async def quotes(symbols, now=None):
        return ms.QuoteResult({s: price.with_session_view(stored_quote, AFTER_CLOSE) for s in symbols},
                              ms.build_meta(source="tradingview", fetched_at=None, served_from="store"),
                              {s: "store" for s in symbols})

    async def official(symbol):
        return SASA_OFFICIAL

    async def no_capitals():
        return None

    monkeypatch.setattr(ms, "get_quotes", quotes)
    monkeypatch.setattr(isyatirim_prices, "fetch_quote", official)
    monkeypatch.setattr(ms, "_read_paid_in_capitals", no_capitals)

    one = await stream_adapter.get_snapshot(["SASA"])
    entry = one["snapshot"]["SASA"]
    assert entry["volume"] == 2473505158 and entry["volume_source"] == "isyatirim"
    assert entry["market_cap"] == pytest.approx(118_654_364_390.57, abs=0.01)
    assert entry["updated_at"] == "2026-09-23T18:10:00+03:00" and entry["session_state"] == "closed"
    assert one["meta"]["source"] == "tradingview+isyatirim" and ms.NOTE_VOLUME_OFFICIAL in one["meta"]["notes"]

    many = await stream_adapter.get_snapshot(["SASA", "A1", "A2", "A3"])  # watchlists stay on TradingView
    assert many["snapshot"]["SASA"]["volume"] == 2453505160 and many["meta"]["source"] == "tradingview"
    # ... but the capital seen earlier today still fixes the market cap without a new request.
    assert many["snapshot"]["SASA"]["market_cap"] == pytest.approx(118_654_364_390.57, abs=0.01)


# --- post-close quote time ------------------------------------------------------------------

def test_quote_time_is_capped_at_the_session_close_and_session_state_follows_finality():
    assert price.SESSION_CLOSE_TIME.isoformat() == "18:10:00"
    assert price.cap_to_session_close(POST_CLOSE_TICK, SESSION) == CLOSE_1810
    assert price.cap_to_session_close(1790163000, SESSION) == 1790163000  # 14:30 in session: untouched
    assert price.cap_to_session_close(None, SESSION) is None

    quote = price.quote_from_scan("BIMAS", {**BIMAS_ROW, "close[1]": 430.25})
    assert quote["updated_at"] == "2026-09-23T19:17:05+03:00"  # the provider time is kept for the store
    view = price.with_session_view(quote, AFTER_CLOSE)
    assert view["updated_at"] == "2026-09-23T18:10:00+03:00" and view["timestamp"] == CLOSE_1810
    assert view["session_state"] == "closed"
    assert price.with_session_view(quote, datetime(2026, 9, 23, 18, 20, tzinfo=ISTANBUL_TZ))["session_state"] == "open"
    assert price.session_state(date(2026, 9, 22), IN_SESSION) == "closed"
    assert price.session_state(None, IN_SESSION) is None

    live = fs._snapshot_from_scan(BIMAS_ROW, {}, now=AFTER_CLOSE)
    assert live["updated_at"] == "2026-09-23T18:10:00+03:00" and live["session_state"] == "closed"
    running = fs._snapshot_from_scan({**BIMAS_ROW, "update_time": 1790163000}, {}, now=IN_SESSION)
    assert running["updated_at"] == "2026-09-23T14:30:00+03:00" and running["session_state"] == "open"


async def test_store_first_quotes_are_served_with_the_capped_time(monkeypatch):
    stored = {**price.quote_from_scan("BIMAS", {**BIMAS_ROW, "close[1]": 430.25}),
              "fetched_at": datetime(2026, 9, 23, 16, 0, tzinfo=UTC)}  # checked after the final moment

    async def read(symbols):
        return {"BIMAS": stored}

    monkeypatch.setattr(ms, "_read_quotes", read)
    result = await ms.get_quotes(["BIMAS"], now=AFTER_CLOSE)
    assert result.served == {"BIMAS": "store"}
    assert result.quotes["BIMAS"]["updated_at"] == "2026-09-23T18:10:00+03:00"
    assert result.quotes["BIMAS"]["session_state"] == "closed"
    assert stored["updated_at"] == "2026-09-23T19:17:05+03:00"  # the stored copy is not mutated


# --- official reads, provenance, extras versioning --------------------------------------------

async def test_official_quote_is_optional_and_remembers_the_capital_for_the_day(monkeypatch):
    calls: list[str] = []

    async def down(symbol):
        calls.append(symbol)
        raise MarketDataError("İş Yatırım verisine ulaşılamadı", status_code=503)

    monkeypatch.setattr(isyatirim_prices, "fetch_quote", down)
    assert await ms.get_official_quote("BIMAS") is None
    assert ms.remembered_capital("BIMAS") is None and ms.company_capital("BIMAS", None) is None

    async def up(symbol):
        calls.append(symbol)
        return BIMAS_OFFICIAL

    monkeypatch.setattr(isyatirim_prices, "fetch_quote", up)
    assert (await ms.get_official_quote("BIMAS"))["volume"] == 6580903
    assert await ms.get_official_quote("BIMAS") is not None and calls == ["BIMAS", "BIMAS"]  # quote TTL cache
    assert ms.company_capital("BIMAS", None) == ms.CompanyCapital(1_200_000_000, 201_353_398_000)


def test_meta_names_isyatirim_only_when_it_served_a_field():
    meta = DataMeta(source="tradingview", fetched_at=datetime.now(UTC), source_url="https://tv", notes=["x"])
    served = ms.with_official_provenance(meta, {"volume_source": "isyatirim", "shares_source": "isyatirim_capital",
                                                "pb_source": "isyatirim_equity"})
    assert served.source == "tradingview+isyatirim" and served.source_url == "https://tv"
    assert served.notes == ["x", ms.NOTE_VOLUME_OFFICIAL, ms.NOTE_SHARES["isyatirim_capital"],
                            ms.NOTE_PB["isyatirim_equity"]]
    fallback = ms.with_official_provenance(meta, {"volume_source": "tradingview", "pb_source": "tradingview_fq"})
    assert fallback.source == "tradingview" and ms.NOTE_VOLUME_TRADINGVIEW in fallback.notes
    assert ms.with_official_provenance(None, {}) is None


async def test_extras_written_by_an_older_worker_are_not_served_from_the_store(monkeypatch):
    fresh = datetime.now(UTC)
    stored = {**price.quote_from_scan("BIMAS", {**BIMAS_ROW, "close[1]": 430.25}), "fetched_at": fresh}
    extras = ms.QuoteExtras({"BIMAS": {"price_book_ratio": 3.1}}, fresh, columns=())  # pre-fix row
    scans: list[tuple] = []

    async def read(symbols):
        return {"BIMAS": stored}

    async def read_extras():
        return extras

    async def scan(symbols, columns, **kwargs):
        scans.append(tuple(columns))
        return {"BIMAS": BIMAS_ROW}

    async def nothing(quotes):
        return None

    import src.adapters.utils as utils

    monkeypatch.setattr(ms, "_read_quotes", read)
    monkeypatch.setattr(ms, "_read_quote_extras", read_extras)
    monkeypatch.setattr(ms, "_write_quotes", nothing)
    monkeypatch.setattr(ms, "quote_is_fresh", lambda fetched_at, now=None: True)
    monkeypatch.setattr(utils, "tradingview_scan", scan)
    row, meta = await ms.get_snapshot_row("BIMAS", fs._SNAPSHOT_COLUMNS)
    assert scans and "price_book_fq" in scans[0] and meta.served_from == "live"

    adapter_cache.clear()
    scans.clear()
    extras = ms.QuoteExtras({"BIMAS": {"price_book_fq": 2.55}}, fresh, columns=ms.EXTRA_COLUMNS)
    row, meta = await ms.get_snapshot_row("BIMAS", fs._SNAPSHOT_COLUMNS)
    assert not scans and meta.served_from == "store"
    assert row["price_book_fq"] == 2.55 and row["session_date"] == SESSION and row["update_time"] == POST_CLOSE_TICK


async def test_fast_info_payload_end_to_end(monkeypatch):
    async def snapshot_row(symbol, columns):
        return dict(BIMAS_ROW), ms.build_meta(source="tradingview", fetched_at=None, served_from="store",
                                              symbol=symbol, as_of=SESSION)

    async def card(ticker):
        return dict(BIMAS_CARD)

    async def official(symbol):
        return BIMAS_OFFICIAL

    async def capitals():
        return {"BIMAS": 1_200_000_000.0}

    monkeypatch.setattr(ms, "get_snapshot_row", snapshot_row)
    monkeypatch.setattr(fs, "_company_metrics_or_empty", card)
    monkeypatch.setattr(isyatirim_prices, "fetch_quote", official)
    monkeypatch.setattr(ms, "_read_paid_in_capitals", capitals)
    monkeypatch.setattr(price, "now_istanbul", lambda: AFTER_CLOSE)

    payload = await fs.get_fast_info("BIMAS")
    info = payload["fast_info"]
    assert (info["shares"], info["market_cap"], info["pb_ratio"]) == (1_200_000_000, 520_500_000_000.0, 2.59)
    assert (info["volume"], info["amount"]) == (6580903, 2854686306.5)
    assert info["updated_at"] == "2026-09-23T18:10:00+03:00" and info["session_state"] == "closed"
    assert payload["meta"]["source"] == "tradingview+isyatirim"
    assert ms.NOTE_SHARES["isyatirim_capital"] in payload["meta"]["notes"]
