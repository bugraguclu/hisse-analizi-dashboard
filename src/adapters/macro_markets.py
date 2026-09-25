"""Makro piyasa verileri ve ekonomik göstergeler (TradingView).

Kaynaklar ve kurallar:

- **Piyasa özeti** (:func:`get_market_snapshot`): TradingView global
  tarayıcısına TEK istek — Türkiye devlet tahvili getirileri (TVC:TR01Y…TR10Y),
  döviz çiftleri (FX_IDC), altın/gümüş, Brent, DXY ve ABD 10 yıllık getirisi.
  Değişim bir önceki günlük kapanışa (``close[1]``) göredir. Tahvil getirileri
  *basit yıllık* getiridir (uluslararası konvansiyon); doviz.com / BloombergHT
  gibi yerel kaynaklar daha yüksek görünen *bileşik* getiriyi yayınlar.
  Türetilmiş seriler: gram altın = ons × USD/TRY ÷ 31,1035;
  sepet kur = (USD/TRY + EUR/TRY) ÷ 2.
- **Piyasa geçmişi** (:func:`get_market_history`): TradingView grafik
  websocket'i (borsapy sağlayıcısı) — günlük/haftalık kapanışlar, gerçek takvim
  penceresine kırpılır (borsapy ``period`` değeri bar sayısıdır).
- **Ekonomik göstergeler** (:func:`get_macro_indicators`): TradingView
  ``ECONOMICS:*`` serileri — son değer, bir önceki dönemin değeri
  (``close[1]``) ve referans dönemi (``time`` = dönem sonu; politika faizinde
  karar günü). Geçmiş seriler ücretli olduğundan yalnızca son iki gözlem vardır.
"""

import asyncio
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx
import pandas as pd
import structlog

from src.adapters.price import clean_bars, now_istanbul, period_reference, split_chart_window
from src.adapters.utils import (
    ISTANBUL_TZ,
    ChartPeriod,
    InvalidInputError,
    MarketDataError,
    cached,
    error_payload,
    finite_float,
    get_http_client,
    resolve_period,
    run_sync,
    sanitize_data,
)

logger = structlog.get_logger(__name__)

SOURCE = "TradingView"
TRADINGVIEW_GLOBAL_SCAN_URL = "https://scanner.tradingview.com/global/scan"
_SCAN_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}
_SCAN_TIMEOUT = httpx.Timeout(10.0, connect=5.0)

TTL_MARKET_SNAPSHOT = 60        # the free feed is delayed anyway; one scanner call per minute
TTL_MARKET_HISTORY = 600        # daily/weekly bars; the live value comes from the snapshot
TTL_INDICATORS = 3600           # monthly/quarterly releases

TROY_OUNCE_GRAMS = 31.1034768

_MSG_MARKETS = "Piyasa verileri şu anda alınamıyor"
_MSG_HISTORY = "Piyasa geçmişi şu anda alınamıyor"
_MSG_INDICATORS = "Ekonomik göstergeler şu anda alınamıyor"


# ---------------------------------------------------------------------------
# Registries
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MarketInstrument:
    key: str
    group: str                      # fx | commodity | bond | global
    name: str
    unit: str                       # TRY | USD | percent | index
    ticker: str | None = None       # "EXCHANGE:SYMBOL"; None for derived series
    tenor_years: int | None = None  # bonds only

    @property
    def derived(self) -> bool:
        return self.ticker is None


MARKET_INSTRUMENTS: tuple[MarketInstrument, ...] = (
    MarketInstrument("usdtry", "fx", "USD/TRY", "TRY", "FX_IDC:USDTRY"),
    MarketInstrument("eurtry", "fx", "EUR/TRY", "TRY", "FX_IDC:EURTRY"),
    MarketInstrument("gbptry", "fx", "GBP/TRY", "TRY", "FX_IDC:GBPTRY"),
    MarketInstrument("basket", "fx", "Sepet kur (0,5 USD + 0,5 EUR)", "TRY"),
    MarketInstrument("gram_gold", "commodity", "Gram altın", "TRY"),
    MarketInstrument("xauusd", "commodity", "Ons altın", "USD", "OANDA:XAUUSD"),
    MarketInstrument("xagusd", "commodity", "Ons gümüş", "USD", "TVC:SILVER"),
    MarketInstrument("brent", "commodity", "Brent petrol", "USD", "FX:UKOIL"),
    MarketInstrument("tr01y", "bond", "TR 1 yıllık tahvil", "percent", "TVC:TR01Y", 1),
    MarketInstrument("tr02y", "bond", "TR 2 yıllık tahvil", "percent", "TVC:TR02Y", 2),
    MarketInstrument("tr03y", "bond", "TR 3 yıllık tahvil", "percent", "TVC:TR03Y", 3),
    MarketInstrument("tr05y", "bond", "TR 5 yıllık tahvil", "percent", "TVC:TR05Y", 5),
    MarketInstrument("tr10y", "bond", "TR 10 yıllık tahvil", "percent", "TVC:TR10Y", 10),
    MarketInstrument("eurusd", "global", "EUR/USD", "USD", "FX:EURUSD"),
    MarketInstrument("dxy", "global", "Dolar endeksi (DXY)", "index", "TVC:DXY"),
    MarketInstrument("us10y", "global", "ABD 10 yıllık tahvil", "percent", "TVC:US10Y", 10),
)
INSTRUMENTS_BY_KEY: dict[str, MarketInstrument] = {inst.key: inst for inst in MARKET_INSTRUMENTS}

# Derived series and the scanner instruments they are computed from.
_DERIVED_INPUTS: dict[str, tuple[str, str]] = {
    "basket": ("usdtry", "eurtry"),
    "gram_gold": ("xauusd", "usdtry"),
}


def _combine(key: str, a: float, b: float) -> float:
    if key == "basket":
        return (a + b) / 2
    if key == "gram_gold":
        return a * b / TROY_OUNCE_GRAMS
    raise KeyError(key)


@dataclass(frozen=True)
class MacroIndicator:
    key: str
    symbol: str      # TradingView ECONOMICS code
    group: str       # growth | labor | prices | external | fiscal | monetary | global
    name: str
    unit: str        # percent | index | USD | TRY | tonnes
    frequency: str   # decision | week | month | quarter | year


MACRO_INDICATORS: tuple[MacroIndicator, ...] = (
    MacroIndicator("gdp_growth_yoy", "TRGDPYY", "growth", "GSYH büyümesi (yıllık)", "percent", "quarter"),
    MacroIndicator("gdp_growth_qoq", "TRGDPQQ", "growth", "GSYH büyümesi (çeyreklik)", "percent", "quarter"),
    MacroIndicator("industrial_production_yoy", "TRIPYY", "growth", "Sanayi üretimi (yıllık)", "percent", "month"),
    MacroIndicator("retail_sales_yoy", "TRRSYY", "growth", "Perakende satışlar (yıllık)", "percent", "month"),
    MacroIndicator("capacity_utilization", "TRCU", "growth", "Kapasite kullanım oranı", "percent", "month"),
    MacroIndicator("consumer_confidence", "TRCCI", "growth", "Tüketici güven endeksi", "index", "month"),
    MacroIndicator("unemployment", "TRUR", "labor", "İşsizlik oranı", "percent", "month"),
    MacroIndicator("labor_force_participation", "TRLFPR", "labor", "İşgücüne katılım oranı", "percent", "month"),
    MacroIndicator("core_inflation_yoy", "TRCIR", "prices", "Çekirdek enflasyon (yıllık)", "percent", "month"),
    MacroIndicator("current_account", "TRCA", "external", "Cari işlemler dengesi", "USD", "month"),
    MacroIndicator("current_account_gdp", "TRCAG", "external", "Cari denge / GSYH", "percent", "year"),
    MacroIndicator("trade_balance", "TRBOT", "external", "Dış ticaret dengesi", "USD", "month"),
    MacroIndicator("exports", "TREXP", "external", "İhracat", "USD", "month"),
    MacroIndicator("imports", "TRIMP", "external", "İthalat", "USD", "month"),
    MacroIndicator("fdi", "TRFDI", "external", "Doğrudan yabancı yatırım (net giriş)", "USD", "month"),
    MacroIndicator("fx_reserves", "TRFER", "external", "TCMB döviz rezervleri", "USD", "week"),
    MacroIndicator("gold_reserves", "TRGRES", "external", "Altın rezervleri", "tonnes", "quarter"),
    MacroIndicator("budget_balance", "TRGBV", "fiscal", "Merkezi yönetim bütçe dengesi", "TRY", "month"),
    MacroIndicator("government_debt_gdp", "TRGDG", "fiscal", "Kamu borcu / GSYH", "percent", "year"),
    MacroIndicator("policy_rate", "TRINTR", "monetary", "TCMB politika faizi", "percent", "decision"),
    MacroIndicator("fed_rate", "USINTR", "global", "Fed politika faizi (üst sınır)", "percent", "decision"),
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _failure(exc: BaseException, message: str, event: str, **payload: Any) -> dict[str, Any]:
    if isinstance(exc, MarketDataError):
        logger.warning(event, error=exc.message, status=exc.status_code)
    else:
        logger.error(event, error=f"{type(exc).__name__}: {exc}")
    result = error_payload(exc, message)
    if not isinstance(exc, MarketDataError) and isinstance(exc, (httpx.HTTPError, TimeoutError, ConnectionError)):
        result["error_status"] = 503
    return {**payload, **result}


def _epoch_date(value: Any) -> str | None:
    """Reference-period end (UTC epoch seconds) → ISO calendar date."""
    seconds = finite_float(value)
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, UTC).date().isoformat()


def _epoch_iso(value: Any) -> str | None:
    seconds = finite_float(value)
    if seconds is None or seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, ISTANBUL_TZ).isoformat()


def _round(value: float | None, digits: int = 6) -> float | None:
    return round(value, digits) if value is not None else None


def _change(last: float | None, previous: float | None) -> tuple[float | None, float | None]:
    """``(absolute, percent)`` change; percent is ``None`` without a positive base."""
    if last is None or previous is None:
        return None, None
    change = last - previous
    percent = change / previous * 100 if previous > 0 else None
    return _round(change), _round(percent, 4)


async def _global_scan(tickers: Sequence[str], columns: Sequence[str]) -> dict[str, dict[str, Any]]:
    """``{"EXCHANGE:SYMBOL": {column: value}}`` for fully-qualified tickers in one scanner request.

    Unknown tickers are simply absent. Raises :class:`MarketDataError`
    (503 unreachable / rate limited, 502 bad payload).
    """
    unique = list(dict.fromkeys(tickers))
    if not unique:
        return {}  # an empty ticker list would scan the entire market
    payload = {"symbols": {"tickers": unique, "query": {"types": []}}, "columns": list(columns)}
    try:
        response = await get_http_client().post(
            TRADINGVIEW_GLOBAL_SCAN_URL, json=payload, headers=_SCAN_HEADERS, timeout=_SCAN_TIMEOUT
        )
    except httpx.HTTPError as e:
        logger.warning("macro_scan_unreachable", error=f"{type(e).__name__}: {e}", tickers=len(unique))
        raise MarketDataError("Piyasa verisi sağlayıcısına ulaşılamadı", status_code=503) from e
    if response.status_code >= 400:
        logger.warning("macro_scan_http_error", status=response.status_code, body=response.text[:200])
        status = 503 if response.status_code == 429 or response.status_code >= 500 else 502
        raise MarketDataError("Piyasa verisi sağlayıcısı isteği reddetti", status_code=status)
    try:
        body = response.json()
    except ValueError as e:
        raise MarketDataError("Piyasa verisi sağlayıcısından geçersiz yanıt alındı") from e

    data = body.get("data") if isinstance(body, dict) else None
    rows: dict[str, dict[str, Any]] = {}
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, dict):
            continue
        values = item.get("d")
        ticker = str(item.get("s", "")).upper()
        if ticker and isinstance(values, list) and len(values) == len(columns):
            rows[ticker] = sanitize_data(dict(zip(columns, values)))
    return rows


# ---------------------------------------------------------------------------
# Market snapshot
# ---------------------------------------------------------------------------

_MARKET_COLUMNS = ("close", "close[1]", "update_time")


def _level(inst: MarketInstrument, value: Any) -> float | None:
    """Prices/indices must be positive; yields only finite."""
    number = finite_float(value)
    if number is None:
        return None
    if inst.unit != "percent" and number <= 0:
        return None
    return number


def _quote(inst: MarketInstrument, last: float, previous: float | None, updated_at: str | None) -> dict[str, Any]:
    change, percent = _change(last, previous)
    return {
        "key": inst.key,
        "group": inst.group,
        "name": inst.name,
        "unit": inst.unit,
        "symbol": inst.ticker,
        "tenor_years": inst.tenor_years,
        "derived": inst.derived,
        "last": _round(last),
        "previous_close": _round(previous),
        "change": change,
        "change_percent": percent,
        "updated_at": updated_at,
    }


def _instrument_quote(inst: MarketInstrument, row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    last = _level(inst, row.get("close"))
    if last is None:
        return None
    return _quote(inst, last, _level(inst, row.get("close[1]")), _epoch_iso(row.get("update_time")))


def _derived_quote(inst: MarketInstrument, quotes: Mapping[str, Mapping[str, Any]]) -> dict[str, Any] | None:
    first, second = (quotes.get(key) for key in _DERIVED_INPUTS[inst.key])
    if not first or not second:
        return None
    last = _combine(inst.key, first["last"], second["last"])
    previous = None
    if first.get("previous_close") is not None and second.get("previous_close") is not None:
        previous = _combine(inst.key, first["previous_close"], second["previous_close"])
    stamps = [q["updated_at"] for q in (first, second) if q.get("updated_at")]
    # A derived value is only as fresh as its stalest input.
    return _quote(inst, last, previous, min(stamps) if stamps else None)


def _snapshot_payload(rows: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    quotes: dict[str, dict[str, Any]] = {}
    for inst in MARKET_INSTRUMENTS:
        if inst.ticker is not None:
            quote = _instrument_quote(inst, rows.get(inst.ticker))
            if quote is not None:
                quotes[inst.key] = quote
    for inst in MARKET_INSTRUMENTS:
        if inst.derived:
            quote = _derived_quote(inst, quotes)
            if quote is not None:
                quotes[inst.key] = quote
    instruments = [quotes[inst.key] for inst in MARKET_INSTRUMENTS if inst.key in quotes]
    if not instruments:
        raise MarketDataError(_MSG_MARKETS, status_code=502)
    stamps = [q["updated_at"] for q in instruments if q.get("updated_at")]
    return {"source": SOURCE, "as_of": max(stamps) if stamps else None, "instruments": instruments}


@cached(TTL_MARKET_SNAPSHOT, "macro_markets")
async def _market_rows() -> dict[str, dict[str, Any]]:
    tickers = [inst.ticker for inst in MARKET_INSTRUMENTS if inst.ticker]
    return await _global_scan(tickers, _MARKET_COLUMNS)


async def get_market_snapshot() -> dict:
    """Tahvil getirileri, döviz, emtia ve küresel göstergeler — son değer ve günlük değişim."""
    try:
        return _snapshot_payload(await _market_rows())
    except Exception as e:
        return _failure(e, _MSG_MARKETS, "macro_markets_error", source=SOURCE, instruments=[])


# ---------------------------------------------------------------------------
# Market history
# ---------------------------------------------------------------------------

HISTORY_PERIODS: tuple[str, ...] = ("1ay", "3ay", "6ay", "ytd", "1y", "2y", "5y")
# borsapy counts bars: 365 daily FX/bond bars ≈ 17 months, enough for every
# daily window plus the close before it. Weekly windows fetch a longer span
# for the same reason.
_DAILY_FETCH_PERIOD = "1y"
_LONG_FETCH_PERIOD = {"2y": "5y", "5y": "10y"}
_history_semaphore = asyncio.Semaphore(3)  # TradingView drops bursts of websocket sessions


def _load_history_sync(ticker: str, period: str, interval: str) -> Any:
    # borsapy has no public API for TVC/FX_IDC/OANDA symbols; the provider is
    # stable within the pinned borsapy<0.11 range.
    from borsapy._providers.tradingview import get_tradingview_provider

    exchange, symbol = ticker.split(":", 1)
    return get_tradingview_provider().get_history(symbol, period=period, interval=interval, exchange=exchange)


@cached(TTL_MARKET_HISTORY, "macro_market_bars")
async def _market_bars(ticker: str, period: str, interval: str) -> pd.DataFrame:
    last_error: Exception | None = None
    for attempt in range(2):
        try:
            async with _history_semaphore:
                raw = await run_sync(_load_history_sync, ticker, period, interval)
            frame = clean_bars(raw)
            if not frame.empty:
                return frame
            last_error = ValueError("empty history")
        except Exception as e:  # websocket hiccups are common; retry once
            last_error = e
        if attempt == 0:
            await asyncio.sleep(0.5)
    logger.warning("macro_market_history_failed", ticker=ticker, error=f"{type(last_error).__name__}: {last_error}")
    raise MarketDataError(_MSG_HISTORY, status_code=503)


def _fetch_args(spec: ChartPeriod) -> tuple[str, str]:
    if spec.interval == "1d":
        return _DAILY_FETCH_PERIOD, "1d"
    return _LONG_FETCH_PERIOD.get(spec.key, "10y"), spec.interval


def _daily_closes(frame: pd.DataFrame) -> pd.Series:
    """Close series indexed by Istanbul calendar day (sources stamp bars at different hours)."""
    closes = frame["Close"].dropna()
    closes.index = pd.DatetimeIndex(closes.index).tz_convert(ISTANBUL_TZ).normalize()
    return closes[~closes.index.duplicated(keep="last")]


def _combine_series(key: str, first: pd.Series, second: pd.Series) -> pd.DataFrame:
    joined = pd.concat([first, second], axis=1, join="inner").dropna()
    if joined.empty:
        return pd.DataFrame(columns=["Close"], index=pd.DatetimeIndex([], tz=ISTANBUL_TZ, name="Date"))
    closes = [_combine(key, float(a), float(b)) for a, b in joined.itertuples(index=False, name=None)]
    return pd.DataFrame({"Close": closes}, index=joined.index.rename("Date"))


async def _instrument_frame(inst: MarketInstrument, spec: ChartPeriod) -> pd.DataFrame:
    period, interval = _fetch_args(spec)
    if inst.ticker is not None:
        frame = await _market_bars(inst.ticker, period, interval)
        return pd.DataFrame({"Close": _daily_closes(frame)})
    first_key, second_key = _DERIVED_INPUTS[inst.key]
    first_ticker = INSTRUMENTS_BY_KEY[first_key].ticker
    second_ticker = INSTRUMENTS_BY_KEY[second_key].ticker
    assert first_ticker is not None and second_ticker is not None
    first, second = await asyncio.gather(
        _market_bars(first_ticker, period, interval), _market_bars(second_ticker, period, interval)
    )
    return _combine_series(inst.key, _daily_closes(first), _daily_closes(second))


def _history_payload(
    inst: MarketInstrument, spec: ChartPeriod, frame: pd.DataFrame, now: datetime | None = None
) -> dict[str, Any]:
    window, before = split_chart_window(frame, spec, now)
    closes = window["Close"].dropna()
    if closes.empty:
        raise MarketDataError(_MSG_HISTORY, status_code=502)
    points = [
        {"date": pd.Timestamp(ts).date().isoformat(), "close": _round(float(value))}
        for ts, value in closes.items()
    ]
    reference = period_reference(before)
    last = float(closes.iloc[-1])
    change, percent = _change(last, reference["reference_close"])
    return {
        "key": inst.key,
        "name": inst.name,
        "unit": inst.unit,
        "group": inst.group,
        "period": spec.key,
        "interval": spec.interval,
        "source": SOURCE,
        "points": points,
        "reference_close": _round(reference["reference_close"]),
        "reference_date": reference["reference_date"],
        "change": change,
        "change_percent": percent,
        "high": _round(float(closes.max())),
        "low": _round(float(closes.min())),
    }


def resolve_history_period(period: str) -> ChartPeriod:
    spec = resolve_period(period)
    if spec.key not in HISTORY_PERIODS:
        raise InvalidInputError(f"Geçersiz periyot: '{period}'. Geçerli değerler: {', '.join(HISTORY_PERIODS)}")
    return spec


async def get_market_history(key: str, period: str = "1y") -> dict:
    """Bir piyasa enstrümanının kapanış geçmişi (gerçek takvim penceresi) ve dönem değişimi."""
    normalized = (key or "").strip().lower()
    try:
        inst = INSTRUMENTS_BY_KEY.get(normalized)
        if inst is None:
            raise MarketDataError(f"Bilinmeyen piyasa göstergesi: {key}", status_code=404)
        spec = resolve_history_period(period)
        frame = await _instrument_frame(inst, spec)
        return _history_payload(inst, spec, frame, now_istanbul())
    except Exception as e:
        return _failure(e, _MSG_HISTORY, "macro_market_history_error", key=normalized, points=[])


# ---------------------------------------------------------------------------
# Economic indicators
# ---------------------------------------------------------------------------

_INDICATOR_COLUMNS = ("close", "close[1]", "time")


def _indicator_record(ind: MacroIndicator, row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    value = finite_float(row.get("close"))
    if value is None:
        return None
    previous = finite_float(row.get("close[1]"))
    return {
        "key": ind.key,
        "symbol": ind.symbol,
        "group": ind.group,
        "name": ind.name,
        "unit": ind.unit,
        "frequency": ind.frequency,
        "value": value,
        "previous": previous,
        # absolute change in the series' own unit (percentage points for rates)
        "change": _round(value - previous) if previous is not None else None,
        "period": _epoch_date(row.get("time")),
    }


def _indicators_payload(rows: Mapping[str, Mapping[str, Any]]) -> dict[str, Any]:
    indicators = []
    for ind in MACRO_INDICATORS:
        record = _indicator_record(ind, rows.get(f"ECONOMICS:{ind.symbol}"))
        if record is not None:
            indicators.append(record)
    if not indicators:
        raise MarketDataError(_MSG_INDICATORS, status_code=502)
    return {"source": f"{SOURCE} ekonomik veri", "indicators": indicators}


@cached(TTL_INDICATORS, "macro_indicators")
async def _indicator_rows() -> dict[str, Any]:
    rows = await _global_scan([f"ECONOMICS:{ind.symbol}" for ind in MACRO_INDICATORS], _INDICATOR_COLUMNS)
    return {"rows": rows, "fetched_at": now_istanbul().isoformat()}


async def get_macro_indicators() -> dict:
    """Büyüme, istihdam, dış denge, rezerv ve maliye göstergeleri — son iki gözlem ve referans dönemi."""
    try:
        fetched = await _indicator_rows()
        return {**_indicators_payload(fetched["rows"]), "as_of": fetched["fetched_at"]}
    except Exception as e:
        return _failure(e, _MSG_INDICATORS, "macro_indicators_error", source=f"{SOURCE} ekonomik veri", indicators=[])
