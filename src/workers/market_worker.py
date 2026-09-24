"""Market worker — quotes, daily bars, history backfill and İş Yatırım reconciliation (WS2).

Jobs (``ingestion_runs.job``), all Europe/Istanbul, weekdays:

* ``market.quotes`` — ONE TradingView scanner request for every active company plus
  the main indices, every ``MARKET_QUOTE_INTERVAL_SECONDS`` inside the polling window
  (``MARKET_SESSION_OPEN`` … ``MARKET_SESSION_CLOSE``) and once more after the
  session became final (``price.SESSION_FINAL_TIME``). Symbols the scanner lacks
  (e.g. ``XUSIN``) fall back to İş Yatırım ``OneEndeks``. Writes ``quotes``
  (``delay_seconds=900``), the running daily bar (``is_final=false`` until the
  session is final) and the TradingView extras used by fast-info.
* ``market.bars.daily`` — after ``MARKET_DAILY_BARS_AFTER`` (and once at start-up
  when the last run predates the last close): final daily bars for the universe
  from one scanner request, plus a continuity check — the stored previous close
  must equal TradingView's ``close[1]``; a mismatch (missed sessions, a split that
  re-adjusted the series) flags the symbol for a full history refresh. Once the
  session is final, one paced İş Yatırım OneEndeks pass over the stocks puts the
  official lot count and TL turnover on the day's final bars (see *Volume and
  turnover* below) and writes ``market.volume_vs_oneendeks``. Updates the legacy
  ``polling_state`` row ``price`` (``run_job``).
* ``market.bars.backfill`` — TradingView websocket history (split-adjusted, the
  canonical series) for symbols whose stored history is shorter than the target
  (``tracking_tier=core`` and the main indices: ``MARKET_BACKFILL_CORE_YEARS``,
  the rest: ``MARKET_BACKFILL_UNIVERSE_YEARS``) or that are flagged for refresh;
  bounded per pass (``MARKET_BACKFILL_BATCH_SIZE`` / ``MARKET_BACKFILL_MAX_SECONDS``).
* ``market.bars.reconcile`` — after ``MARKET_RECONCILE_AFTER``: İş Yatırım
  ``HisseTekil`` for the last ``MARKET_RECONCILE_DAYS`` → TL turnover + VWAP on the
  stored bars, official closes for sessions TradingView lacks, the official lot
  count of the latest session where the stored volume still disagrees with
  ``HG_HACIM / HG_AOF`` (OneEndeks re-read), and the cross-source checks
  ``market.close_tv_vs_isy`` / ``market.volume_units`` (``data_quality_checks``).
* ``market.bars.reconcile.backfill`` — gradual, resumable enrichment of the stored
  history with İş Yatırım ``HG_HACIM`` (turnover) and ``HG_AOF`` (VWAP, scaled to the
  stored basis) through the same :func:`reconcile_symbol` rules (OHLCV untouched):
  one ≤ ``TURNOVER_CHUNK_DAYS`` ``HisseTekil`` window per symbol and pass, newest
  first, progress in the ``market.history:*`` marker (``extra.turnover_from``). Runs
  from the backfill loop once the price history is complete.
* ``market.accuracy`` — after ``MARKET_RECONCILE_AFTER`` (or on demand): the
  served fast-info values of a rotating core sample (or ``symbols``) against the
  official figures → ``market.pb_field``, ``market.shares_vs_paid_in`` and
  ``market.volume_vs_oneendeks`` rows per symbol (:func:`run_accuracy_checks`).

Volume and turnover of the stored daily bars (``price_bars``):

* ``volume`` (lots) — İş Yatırım OneEndeks ``quantity`` for the day's final bar
  (daily job; the reconciliation re-reads it where the stored count still differs
  from ``HG_HACIM / HG_AOF``), otherwise TradingView's ``volume``. TradingView's
  same-day volume misses the trades at the closing price (2026-09-23: SASA
  19,999,998 lots, KCHOL 607,900); its history carries them from the next day on.
  A same-close TradingView re-write never lowers a final bar's volume
  (:func:`src.db.repositories.market.upsert_bars`, rule 5).
* ``turnover`` (TL) — İş Yatırım ``HisseTekil`` ``HG_HACIM`` (reconciliation), else
  OneEndeks ``volume`` (daily job). TradingView's ``Value.Traded`` (close × lots) is
  never stored.

Intraday bars (1h/15m) are not stored: the legacy poller never stored them either
(``PriceAdapter`` emits daily bars only); intraday charts stay live.
"""

from __future__ import annotations

import asyncio
import random
import time as _time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import structlog

from src.adapters import price
from src.adapters.index_adapter import MAIN_INDICES
from src.adapters.isyatirim_prices import IsyDailyRow, fetch_daily_history, fetch_isyatirim_quotes, fetch_quote
from src.adapters.utils import MarketDataError, finite_float, tradingview_scan
from src.core.config import settings
from src.db.models import DataQualityCheck
from src.db.repositories.market import (
    HistoryMarker,
    HistoryMarkerRepository,
    MarketBarRepository,
    QuoteRepository,
    UniverseMember,
    active_universe,
    enrich_bars,
    paid_in_capitals,
    quality_check,
    upsert_bars,
)
from src.db.session import async_session_factory
from src.services import market_service as ms
from src.services.ingestion import latest_runs, run_job
from src.workers.polling_worker import sleep_or_stop, source_lock

logger = structlog.get_logger(__name__)

JOB_QUOTES = "market.quotes"
JOB_BARS_DAILY = "market.bars.daily"
JOB_BACKFILL = "market.bars.backfill"
JOB_RECONCILE = "market.bars.reconcile"
JOB_ACCURACY = "market.accuracy"
JOB_TURNOVER_BACKFILL = "market.bars.reconcile.backfill"
ALL_JOBS: tuple[str, ...] = (
    JOB_QUOTES, JOB_BARS_DAILY, JOB_BACKFILL, JOB_RECONCILE, JOB_TURNOVER_BACKFILL, JOB_ACCURACY,
)
DEFAULT_ONCE_JOBS: tuple[str, ...] = (JOB_QUOTES, JOB_BARS_DAILY, JOB_BACKFILL)

QUOTE_SCAN_COLUMNS: tuple[str, ...] = tuple(dict.fromkeys((*price._QUOTE_COLUMNS, *ms.EXTRA_COLUMNS)))
DAILY_SCAN_COLUMNS: tuple[str, ...] = (
    "open", "high", "low", "close", "volume", "close[1]", "change_abs", "time", "update_time",
)

# Continuity: stored previous close vs TradingView close[1] (price steps are ≥ 0.01 TL).
CONTINUITY_TOLERANCE = 0.001
# Reconciliation tolerances (relative): closes, and TradingView lots vs İş Yatırım turnover / VWAP.
CLOSE_MATCH_TOLERANCE = 0.0005
VOLUME_MATCH_TOLERANCE = 0.005
# Extra history requested before the target start (weekends, holidays, one reference week).
BACKFILL_MARGIN_DAYS = 21
# Loop pacing.
BACKFILL_BUSY_PAUSE_SECONDS = 30.0
IDLE_RECHECK_SECONDS = 900.0
ERROR_RETRY_SECONDS = 120.0
# İş Yatırım OneEndeks passes (official lots / TL turnover): paced for the WAF and time-boxed.
OFFICIAL_PASS_CONCURRENCY = 3
OFFICIAL_PASS_PAUSE_SECONDS = (0.05, 0.15)
OFFICIAL_PASS_BUDGET_SECONDS = 180.0
OFFICIAL_PROBE_SYMBOLS = 3  # core symbols read first; all between sessions → the pass is skipped
# Historical turnover/VWAP enrichment (market.bars.reconcile.backfill): one HisseTekil window of
# at most this many days per symbol and pass (a 3-year window answers in 1-6 s), politely paced.
TURNOVER_CHUNK_DAYS = 1100
TURNOVER_CONCURRENCY = 3
TURNOVER_PAUSE_SECONDS = (0.5, 1.0)
TURNOVER_BATCH_SIZE = 25  # symbols per background pass
TURNOVER_MAX_SECONDS = 300.0  # time budget of one background pass
# İş Yatırım's history may start a few sessions after the first stored bar.
TURNOVER_DONE_TOLERANCE_DAYS = 7
# Stored volume vs HG_HACIM / HG_AOF: HG_AOF has three decimals, so the implied lot count is
# only this exact (relative); a larger gap on the latest session means TradingView's short count.
IMPLIED_LOTS_FLOOR = 0.0001
IMPLIED_LOTS_PRICE_STEP = 0.0006


# ---------------------------------------------------------------------------
# Universe
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Target:
    symbol: str
    company_id: Any
    tier: str  # core | universe | index
    security_type: str


async def load_targets(symbols: Sequence[str] | None = None, *, include_indices: bool = True) -> list[Target]:
    """Active companies (core first) + the main indices; ``symbols`` restricts the list."""
    async with async_session_factory() as session:
        members: list[UniverseMember] = await active_universe(session)
    targets = [Target(m.ticker, m.company_id, m.tracking_tier, m.security_type) for m in members]
    if include_indices:
        known = {t.symbol for t in targets}
        targets.extend(Target(code, None, "index", "index") for code in MAIN_INDICES if code not in known)
    if symbols is not None:
        wanted = [s.strip().upper() for s in symbols if s and s.strip()]
        by_symbol = {t.symbol: t for t in targets}
        targets = [by_symbol.get(s) or Target(s, None, "universe", "stock") for s in dict.fromkeys(wanted)]
    return targets


def _scope(symbols: Sequence[str] | None) -> str:
    if not symbols:
        return "universe"
    return ",".join(list(symbols)[:5]) + ("…" if len(symbols) > 5 else "")


def _duration(started: float) -> float:
    return round(_time.monotonic() - started, 2)


# ---------------------------------------------------------------------------
# market.quotes
# ---------------------------------------------------------------------------

def _extras(row: dict[str, Any]) -> dict[str, Any]:
    return {column: row.get(column) for column in ms.EXTRA_COLUMNS if row.get(column) is not None}


async def run_quotes(symbols: Sequence[str] | None = None, *, now: datetime | None = None) -> dict[str, Any]:
    """One quote cycle for the universe (or ``symbols``); see the module docstring."""
    async with source_lock(JOB_QUOTES) as acquired:
        if not acquired:
            return {"job": JOB_QUOTES, "skipped": "locked"}
        async with run_job(JOB_QUOTES, scope=_scope(symbols)) as run:
            started = _time.monotonic()
            current = now or price.now_istanbul()
            targets = await load_targets(symbols)
            wanted = [t.symbol for t in targets]
            ids = {t.symbol: t.company_id for t in targets}

            scan_error: str | None = None
            try:
                rows = await tradingview_scan(wanted, QUOTE_SCAN_COLUMNS)
            except MarketDataError as e:
                rows, scan_error = {}, e.message
            fetched_at = datetime.now(UTC)
            quotes: dict[str, dict[str, Any]] = {}
            for symbol, row in rows.items():
                quote = price.quote_from_scan(symbol, row)
                if quote is not None:
                    quotes[symbol] = quote
            missing = [s for s in wanted if s not in quotes]
            fallback = await fetch_isyatirim_quotes(missing[: max(0, settings.market_isy_fallback_max_symbols)])
            quotes.update(fallback)
            unresolved = [s for s in wanted if s not in quotes]

            bar_rows = [bar for q in quotes.values() if (bar := ms.bar_from_quote(q, current)) is not None]
            types = {t.symbol: t.security_type for t in targets}
            async with async_session_factory() as session:
                written = await QuoteRepository(session).upsert_many(
                    {**ms.quote_to_row(q, ids.get(symbol)), "security_type": types.get(symbol) or q.get("type") or "stock"}
                    for symbol, q in quotes.items()
                )
                bar_stats = await upsert_bars(session, ({**r, "company_id": ids.get(r["symbol"])} for r in bar_rows))
                await session.commit()
            extras = {s: _extras(r) for s, r in rows.items() if _extras(r)}
            if extras and symbols is None:
                await ms.save_quote_extras(extras)

            sessions = sorted({str(q["session_date"]) for q in quotes.values() if q.get("session_date")})
            run.items_total = len(wanted)
            run.items_ok = len(quotes)
            run.items_failed = len(unresolved)
            run.details = {
                "scanner_rows": len(rows),
                "scanner_error": scan_error,
                "isyatirim_fallback": sorted(fallback),
                "unresolved": unresolved[:50],
                "quotes_written": written,
                "bars": bar_stats.as_dict(),
                "session_dates": sessions[-3:],
                "fetched_at": fetched_at.isoformat(),
                "duration_seconds": _duration(started),
            }
            if not quotes and scan_error:
                raise MarketDataError(scan_error, status_code=503)
            return {"job": JOB_QUOTES, **run.details, "items_total": run.items_total, "items_ok": run.items_ok}


# ---------------------------------------------------------------------------
# Official figures (İş Yatırım OneEndeks): lots and TL turnover of a finished session
# ---------------------------------------------------------------------------

async def fetch_official_quotes(
    symbols: Sequence[str],
    *,
    budget_seconds: float = OFFICIAL_PASS_BUDGET_SECONDS,
    stop: asyncio.Event | None = None,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """OneEndeks quotes of ``symbols`` — paced (the site sits behind a WAF) and time-boxed.

    Returns ``(quotes, failures)``; symbols not reached within ``budget_seconds`` are
    reported as failures (``"budget"``) and left to the reconciliation.
    """
    started = _time.monotonic()
    semaphore = asyncio.Semaphore(OFFICIAL_PASS_CONCURRENCY)
    quotes: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}

    async def one(symbol: str) -> None:
        async with semaphore:
            if (stop is not None and stop.is_set()) or _time.monotonic() - started > budget_seconds:
                failures[symbol] = "budget"
                return
            try:
                quotes[symbol] = await fetch_quote(symbol)
            except MarketDataError as e:
                failures[symbol] = e.message
            await asyncio.sleep(random.uniform(*OFFICIAL_PASS_PAUSE_SECONDS))

    await asyncio.gather(*(one(symbol) for symbol in dict.fromkeys(symbols)))
    return quotes, failures


def apply_official_volumes(bar_rows: list[dict[str, Any]], official: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Put OneEndeks lots / TL turnover on the final bars of the same session (in place).

    Returns ``[{symbol, bar_date, tradingview, official}]`` for every bar whose
    TradingView lot count differed from the official one.
    """
    differences: list[dict[str, Any]] = []
    for row in bar_rows:
        figures = ms.official_session_figures(official.get(row["symbol"]), row["bar_date"]) if row["is_final"] else None
        if figures is None:
            continue
        lots, turnover = figures
        tradingview = finite_float(row.get("volume"))
        if tradingview != lots:
            differences.append(
                {"symbol": row["symbol"], "bar_date": row["bar_date"].isoformat(), "tradingview": tradingview,
                 "official": lots}
            )
        row["volume"] = lots
        if turnover is not None:
            row["turnover"] = round(turnover, 2)
    return differences


def official_volume_check(
    stored: dict[str, Any],
    official: dict[str, dict[str, Any]],
    differences: Sequence[dict[str, Any]],
    failures: dict[str, str],
    session_date: date,
) -> Any:
    """``market.volume_vs_oneendeks`` (subject ``universe``): stored final bars vs OneEndeks.

    ``stored`` maps symbol → stored bar of ``session_date`` after the write. Status:
    every compared bar must carry exactly the official lot count (``fail`` above 1 %
    of them). ``tradingview_short`` lists how many same-day TradingView counts were
    below the official ones (informational: that is why the official count is used).
    """
    compared = 0
    mismatched: list[dict[str, Any]] = []
    for symbol, quote in official.items():
        bar = stored.get(symbol)
        figures = ms.official_session_figures(quote, session_date)
        if bar is None or figures is None or not bar.is_final:
            continue
        compared += 1
        lots, turnover = figures
        volume = finite_float(bar.volume)
        stored_turnover = finite_float(bar.turnover)
        if volume != lots:
            mismatched.append({"symbol": symbol, "stored_lots": volume, "official_lots": lots,
                               "stored_turnover": stored_turnover, "official_turnover": turnover})
    if not compared:
        return None
    share = len(mismatched) / compared
    short = [d for d in differences if (d["tradingview"] or 0) < d["official"]]
    worst = sorted(short, key=lambda d: -(d["official"] - (d["tradingview"] or 0)) / d["official"])[:20]
    return quality_check(
        "market.volume_vs_oneendeks",
        "pass" if not mismatched else ("warn" if share <= 0.01 else "fail"),
        subject="universe",
        expected=float(compared),
        actual=float(compared - len(mismatched)),
        deviation=round(share, 6),
        details={
            "session_date": session_date.isoformat(),
            "rule": "stored final bar volume = OneEndeks quantity (lots), turnover = OneEndeks volume (TL)",
            "mismatches": mismatched[:20],
            "tradingview_short": len(short),
            "tradingview_short_worst": [
                {**d, "missing_lots": d["official"] - (d["tradingview"] or 0)} for d in worst
            ],
            "official_failures": len(failures),
        },
    )


# ---------------------------------------------------------------------------
# market.bars.daily
# ---------------------------------------------------------------------------

async def _flag_refresh(symbols_reasons: dict[str, str], today: date) -> list[str]:
    """Mark symbols for a full history refresh (at most once per day per symbol)."""
    flagged: list[str] = []
    if not symbols_reasons:
        return flagged
    async with async_session_factory() as session:
        repo = HistoryMarkerRepository(session)
        markers = await repo.get_many(list(symbols_reasons))
        for symbol, reason in symbols_reasons.items():
            marker = markers.get(symbol) or HistoryMarker(symbol=symbol)
            if marker.refresh or marker.extra.get("refreshed_on") == today.isoformat():
                continue
            marker.refresh = True
            marker.reason = reason[:200]
            await repo.save(marker)
            flagged.append(symbol)
        await session.commit()
    return flagged


def continuity_breaks(
    rows: dict[str, dict[str, Any]], previous: dict[str, Any], tolerance: float = CONTINUITY_TOLERANCE
) -> dict[str, str]:
    """Symbols whose stored previous final close differs from TradingView's ``close[1]``."""
    breaks: dict[str, str] = {}
    for symbol, row in rows.items():
        stored = previous.get(symbol)
        tv_previous = price._positive(row.get("close[1]"))
        stored_close = finite_float(getattr(stored, "close", None)) if stored is not None else None
        if stored is None or tv_previous is None or stored_close is None:
            continue
        if not ms.closes_match(stored_close, tv_previous, tolerance):
            breaks[symbol] = (
                f"continuity: stored {stored.bar_date.isoformat()} close {stored_close:g} "
                f"vs TradingView close[1] {tv_previous:g}"
            )
    return breaks


# Symbols cross-checked against İş Yatırım OneEndeks by every daily run (rotating over the core).
QUOTE_CHECK_SAMPLE = 10
_QUOTE_CHECK_FIELDS = ("last", "open", "high", "low", "prev_close")


def pick_quote_sample(targets: Sequence[Target], day: date, size: int = QUOTE_CHECK_SAMPLE) -> list[str]:
    """A different slice of the core companies every day (all of them within ~10 trading days)."""
    core = sorted(t.symbol for t in targets if t.tier == "core")
    if not core:
        return []
    start = (day.toordinal() * size) % len(core)
    return [core[(start + i) % len(core)] for i in range(min(size, len(core)))]


def quote_cross_check(rows: dict[str, dict[str, Any]], isy: dict[str, dict[str, Any]]) -> Any:
    """``market.quote_tv_vs_isy``: the same delayed snapshot from both providers (prices exact, volume in lots)."""
    compared = mismatched = 0
    worst = 0.0
    examples: list[dict[str, Any]] = []
    volume_short: list[dict[str, Any]] = []
    for symbol, quote in isy.items():
        row = rows.get(symbol)
        tv = price.quote_from_scan(symbol, row) if row is not None else None
        if tv is None or tv.get("session_date") != quote.get("session_date"):
            continue  # a stale/suspended symbol on one side
        for field_name in _QUOTE_CHECK_FIELDS:
            a, b = price._positive(tv.get(field_name)), price._positive(quote.get(field_name))
            if a is None or b is None:
                continue
            compared += 1
            deviation = abs(a / b - 1)
            worst = max(worst, deviation)
            if deviation > CLOSE_MATCH_TOLERANCE:
                mismatched += 1
                if len(examples) < 10:
                    examples.append({"symbol": symbol, "field": field_name, "tradingview": a, "isyatirim": b})
        tv_volume, isy_volume = price._positive(tv.get("volume")), price._positive(quote.get("volume"))
        if tv_volume and isy_volume and abs(tv_volume / isy_volume - 1) > VOLUME_MATCH_TOLERANCE:
            volume_short.append({"symbol": symbol, "tradingview_lots": tv_volume, "isyatirim_lots": isy_volume})
    if not compared:
        return None
    status = "pass" if not mismatched else ("warn" if worst <= 0.01 else "fail")
    return quality_check(
        "market.quote_tv_vs_isy",
        status,
        subject="core_sample",
        expected=float(compared),
        actual=float(compared - mismatched),
        deviation=round(worst, 6),
        details={"symbols": sorted(isy), "tolerance": CLOSE_MATCH_TOLERANCE, "mismatches": examples,
                 "volume_differences": volume_short,
                 "note": "OneEndeks quantity = lots (TradingView volume), volume = TL"},
    )


async def run_daily_bars(symbols: Sequence[str] | None = None, *, now: datetime | None = None) -> dict[str, Any]:
    """Final daily bars for the universe from one scanner request (+ continuity check)."""
    async with source_lock(JOB_BARS_DAILY) as acquired:
        if not acquired:
            return {"job": JOB_BARS_DAILY, "skipped": "locked"}
        async with run_job(JOB_BARS_DAILY, scope=_scope(symbols)) as run:
            started = _time.monotonic()
            current = now or price.now_istanbul()
            targets = await load_targets(symbols)
            wanted = [t.symbol for t in targets]
            ids = {t.symbol: t.company_id for t in targets}
            rows = await tradingview_scan(wanted, DAILY_SCAN_COLUMNS)

            bar_rows: list[dict[str, Any]] = []
            by_session: dict[date, dict[str, dict[str, Any]]] = {}
            for symbol, row in rows.items():
                session_date = price.session_date_from_epoch(row.get("time"))
                close = price._positive(row.get("close"))
                if session_date is None or close is None:
                    continue
                by_session.setdefault(session_date, {})[symbol] = row
                bar_rows.append(
                    {
                        "symbol": symbol,
                        "company_id": ids.get(symbol),
                        "interval": "1d",
                        "bar_date": session_date,
                        "open": price._positive(row.get("open")),
                        "high": price._positive(row.get("high")),
                        "low": price._positive(row.get("low")),
                        "close": close,
                        "volume": price._non_negative(row.get("volume")),
                        "source": ms.TV_SOURCE,
                        "adjusted": True,
                        "is_final": price.is_session_final(session_date, current),
                    }
                )

            # Official lot count / TL turnover of the day's final stock bars (one paced OneEndeks pass).
            stocks = {t.symbol for t in targets if t.security_type != "index"}
            final_stocks = [r["symbol"] for r in bar_rows if r["is_final"] and r["symbol"] in stocks]
            official: dict[str, dict[str, Any]] = {}
            official_failures: dict[str, str] = {}
            official_skipped: str | None = None
            if final_stocks:
                # A run before the open (catch-up after a restart) meets OneEndeks's overnight reset:
                # probe the first core symbols instead of reading ~600 empty rows.
                official, official_failures = await fetch_official_quotes(final_stocks[:OFFICIAL_PROBE_SYMBOLS])
                if any(quote.get("session_date") is not None for quote in official.values()):
                    rest, rest_failures = await fetch_official_quotes(final_stocks[OFFICIAL_PROBE_SYMBOLS:])
                    official.update(rest)
                    official_failures.update(rest_failures)
                elif official:
                    official_skipped = "between_sessions"
            differences = apply_official_volumes(bar_rows, official)

            # Symbols the scanner lacks (XUSIN): the İş Yatırım quote carries the day's OHLCV.
            missing = [s for s in wanted if s not in rows]
            fallback = await fetch_isyatirim_quotes(missing[: max(0, settings.market_isy_fallback_max_symbols)])
            for symbol, quote in fallback.items():
                bar = ms.bar_from_quote(quote, current)
                if bar is not None:
                    bar_rows.append({**bar, "company_id": ids.get(symbol)})

            # Cross-source check of the same delayed snapshot (a rotating sample of the core);
            # after the close the official pass already holds the sample's quotes.
            sample = [s for s in pick_quote_sample(targets, current.date()) if s in rows]
            sample_quotes = {s: official[s] for s in sample if s in official}
            unread = [s for s in sample if s not in official]
            if unread:
                sample_quotes.update(await fetch_isyatirim_quotes(unread))
            check = quote_cross_check(rows, sample_quotes) if sample_quotes else None

            breaks: dict[str, str] = {}
            volume_check = None
            async with async_session_factory() as session:
                repo = MarketBarRepository(session)
                for session_date, session_rows in by_session.items():
                    previous = await repo.last_final_bars(list(session_rows), before=session_date)
                    breaks.update(continuity_breaks(session_rows, previous))
                stats = await upsert_bars(session, bar_rows)
                official_days = sorted({r["bar_date"] for r in bar_rows if r["is_final"] and r["symbol"] in official})
                if official_days:
                    day = official_days[-1]
                    stored = {symbol: bar for (symbol, _), bar in (await repo.bars_on(list(official), [day])).items()}
                    volume_check = official_volume_check(stored, official, differences, official_failures, day)
                session.add_all([c for c in (check, volume_check) if c is not None])
                await session.commit()
            flagged = await _flag_refresh(breaks, current.date())

            final = sum(1 for r in bar_rows if r["is_final"])
            run.items_total = len(wanted)
            run.items_ok = len(bar_rows)
            run.items_failed = len(wanted) - len(bar_rows)
            run.details = {
                "bars": stats.as_dict(),
                "final_bars": final,
                "running_bars": len(bar_rows) - final,
                "session_dates": sorted(d.isoformat() for d in by_session)[-3:],
                "isyatirim_fallback": sorted(fallback),
                "missing": [s for s in missing if s not in fallback][:50],
                "continuity_breaks": dict(list(breaks.items())[:20]),
                "refresh_flagged": flagged,
                "quote_check": (
                    {"status": check.status, "compared": int(check.expected or 0), "max_deviation": check.deviation}
                    if check is not None
                    else None
                ),
                "official_volume": {
                    "skipped": official_skipped,
                    "quotes": len(official),
                    "failures": len(official_failures),
                    "failed_symbols": sorted(official_failures)[:20],
                    "tradingview_differs": len(differences),
                    "check": volume_check.status if volume_check is not None else None,
                },
                "duration_seconds": _duration(started),
            }
            return {"job": JOB_BARS_DAILY, **run.details, "items_total": run.items_total}


# ---------------------------------------------------------------------------
# market.bars.backfill
# ---------------------------------------------------------------------------

def target_years(target: Target) -> int:
    if target.tier in ("core", "index"):
        return settings.market_backfill_core_years
    return settings.market_backfill_universe_years


def history_start(target: Target, today: date) -> date:
    return today - timedelta(days=round(365.25 * target_years(target)))


@dataclass(frozen=True)
class BackfillItem:
    target: Target
    start: date  # requested start (target start minus a margin)
    reason: str
    priority: int


def plan_backfill(
    targets: Sequence[Target],
    coverage: dict[str, Any],
    markers: dict[str, HistoryMarker],
    today: date,
) -> list[BackfillItem]:
    """Symbols that need history, most urgent first.

    Order: refresh requests (the stored series is wrong: gap or re-adjustment; core
    first), then core/index symbols without or with too short history, then the rest
    of the universe (missing before short).
    """
    items: list[BackfillItem] = []
    for target in targets:
        required = history_start(target, today)
        request_from = required - timedelta(days=BACKFILL_MARGIN_DAYS)
        core = target.tier in ("core", "index")
        marker = markers.get(target.symbol)
        cov = coverage.get(target.symbol)
        if marker is not None and not marker.refresh and marker.extra.get("failed_on") == today.isoformat():
            continue  # the provider had nothing for it today: retry tomorrow, not every pass
        if marker is not None and marker.refresh:
            items.append(BackfillItem(target, request_from, marker.reason or "refresh", 0 if core else 1))
        elif cov is None:
            items.append(BackfillItem(target, request_from, "no_history", 2 if core else 4))
        elif not ms.history_covers(cov.first_date, required, marker):
            reason = f"short_history_from_{cov.first_date.isoformat()}"
            items.append(BackfillItem(target, request_from, reason, 3 if core else 5))
    return sorted(items, key=lambda item: (item.priority, item.target.symbol))


async def _backfill_symbol(item: BackfillItem, now: datetime) -> dict[str, Any]:
    target = item.target
    frame = await price._load_bars(
        target.symbol, None, "1d", start=datetime.combine(item.start, datetime.min.time())
    )
    rows = ms.frame_to_bar_rows(target.symbol, frame, now)
    marker = HistoryMarker(
        symbol=target.symbol,
        first_available=rows[0]["bar_date"] if rows else None,
        requested_from=item.start,
        bars=len(rows),
        refresh=False,
        reason=item.reason[:200],
        extra={"refreshed_on": now.date().isoformat()},
    )
    async with async_session_factory() as session:
        stats = await upsert_bars(session, ({**row, "company_id": target.company_id} for row in rows))
        await HistoryMarkerRepository(session).save(marker)
        await session.commit()
    return {
        "symbol": target.symbol,
        "bars": len(rows),
        "first": rows[0]["bar_date"].isoformat() if rows else None,
        **stats.as_dict(),
    }


async def _mark_failed(symbol: str, marker: HistoryMarker | None, today: date, failures: dict[str, str]) -> None:
    """Remember a failed download so the symbol is retried tomorrow instead of every pass."""
    try:
        async with async_session_factory() as session:
            current = marker or HistoryMarker(symbol=symbol)
            current.refresh = False
            current.extra = {**current.extra, "failed_on": today.isoformat(), "error": failures.get(symbol)}
            await HistoryMarkerRepository(session).save(current)
            await session.commit()
    except Exception as e:  # bookkeeping only
        logger.warning("market_backfill_marker_not_saved", symbol=symbol, error=str(e))


async def run_backfill(
    symbols: Sequence[str] | None = None,
    *,
    max_symbols: int | None = None,
    max_seconds: float | None = None,
    stop: asyncio.Event | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """One bounded backfill pass. With explicit ``symbols`` every listed symbol is processed."""
    async with source_lock(JOB_BACKFILL) as acquired:
        if not acquired:
            return {"job": JOB_BACKFILL, "skipped": "locked"}
        current = now or price.now_istanbul()
        targets = await load_targets(symbols)
        async with async_session_factory() as session:
            coverage = await MarketBarRepository(session).coverage([t.symbol for t in targets])
            markers = await HistoryMarkerRepository(session).get_many([t.symbol for t in targets])
        if symbols is not None:
            # Explicit request: (re)load every listed symbol regardless of coverage.
            plan = [
                BackfillItem(t, history_start(t, current.date()) - timedelta(days=BACKFILL_MARGIN_DAYS), "manual", 0)
                for t in targets
            ]
        else:
            plan = plan_backfill(targets, coverage, markers, current.date())
        if not plan:
            # Still recorded: /data/status and quality's ingestion.health expect a recent run.
            async with run_job(JOB_BACKFILL, scope=_scope(symbols)) as run:
                run.details = {"pending_before": 0, "pending_after": 0, "covered": len(targets)}
            return {"job": JOB_BACKFILL, "pending_before": 0, "pending_after": 0, "processed": 0}

        limit = max_symbols if max_symbols is not None else (len(plan) if symbols else settings.market_backfill_batch_size)
        budget = max_seconds if max_seconds is not None else (None if symbols else settings.market_backfill_max_seconds)
        async with run_job(JOB_BACKFILL, scope=_scope(symbols)) as run:
            started = _time.monotonic()
            results: list[dict[str, Any]] = []
            failures: dict[str, str] = {}
            for index, item in enumerate(plan[:limit]):
                if stop is not None and stop.is_set():
                    break
                if budget is not None and _time.monotonic() - started > budget:
                    break
                if index:
                    await asyncio.sleep(settings.market_backfill_delay_seconds)
                try:
                    result = await _backfill_symbol(item, current)
                    if not result["bars"]:
                        raise MarketDataError("Sağlayıcı bu sembol için fiyat geçmişi döndürmedi")
                    results.append(result)
                except Exception as e:  # one symbol never stops the pass
                    failures[item.target.symbol] = f"{type(e).__name__}: {e}"[:200]
                    logger.warning(
                        "market_backfill_symbol_failed", symbol=item.target.symbol, error=failures[item.target.symbol]
                    )
                    await _mark_failed(item.target.symbol, markers.get(item.target.symbol), current.date(), failures)
            processed = len(results) + len(failures)
            run.items_total = processed
            run.items_ok = len(results)
            run.items_failed = len(failures)
            run.details = {
                "pending_before": len(plan),
                "pending_after": len(plan) - len(results),
                "bars_written": sum(r["inserted"] + r["updated"] for r in results),
                "bars_inserted": sum(r["inserted"] for r in results),
                "symbols": [r["symbol"] for r in results][:100],
                "failures": failures,
                "reasons": _count(item.reason.split("_from_")[0] for item in plan[:processed]),
                "duration_seconds": _duration(started),
            }
            return {"job": JOB_BACKFILL, **run.details, "processed": processed}


def _count(values: Any) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return counts


# ---------------------------------------------------------------------------
# market.bars.reconcile
# ---------------------------------------------------------------------------

@dataclass
class ReconcileOutcome:
    enrich: list[dict[str, Any]]
    fallback_rows: list[dict[str, Any]]
    compared: int
    close_mismatches: list[dict[str, Any]]
    volume_compared: int
    volume_mismatches: list[dict[str, Any]]
    max_close_deviation: float
    split_ratio: float | None  # stored / as-traded ratio of the latest corporate-action segment
    stale_basis: bool = False  # the newest sessions are not on the as-traded basis: refresh the history


@dataclass
class BasisSegment:
    """Consecutive sessions whose stored/as-traded close ratio is the same (one price basis)."""

    days: list[date]
    ratio: float

    @property
    def as_traded(self) -> bool:
        return abs(self.ratio - 1) <= CLOSE_MATCH_TOLERANCE


def basis_segments(ratios: Sequence[tuple[date, float]]) -> list[BasisSegment]:
    segments: list[BasisSegment] = []
    for day, ratio in sorted(ratios):
        if segments and abs(ratio / segments[-1].ratio - 1) <= CLOSE_MATCH_TOLERANCE:
            segments[-1].days.append(day)
        else:
            segments.append(BasisSegment([day], ratio))
    return segments


def reconcile_symbol(
    symbol: str,
    isy_rows: Sequence[IsyDailyRow],
    stored: dict[date, Any],
    now: datetime,
) -> ReconcileOutcome:
    """Compare İş Yatırım's official sessions with the stored bars of one symbol.

    The stored/as-traded close ratio is 1 after the last corporate action and the
    split factor before it (TradingView adjusts for splits, ``HG_KAPANIS`` is as
    traded), so the ratios form constant segments:

    * a segment of ≥ 2 sessions (or the oldest one) with ratio ≠ 1 is a corporate
      action — reported as ``split_ratio``, not as a mismatch; a lone session whose
      ratio differs from its neighbours is a close mismatch;
    * the newest segment must be as traded — otherwise the stored series has a stale
      basis (``stale_basis``: the worker requests a history refresh);
    * enrichment: ``turnover`` = TL turnover (basis-independent), ``vwap`` =
      ``HG_AOF`` × the session's basis ratio; volumes are compared on the same basis;
    * fallback bars (open/volume unknown) only for completed sessions after the first
      as-traded session of the newest segment, when TradingView has no bar.
    """
    final: dict[date, float] = {}
    for row in isy_rows:
        bar = stored.get(row.bar_date)
        close = finite_float(getattr(bar, "close", None)) if bar is not None else None
        if bar is not None and bar.is_final and close is not None and row.close:
            final[row.bar_date] = close
    segments = basis_segments(
        [(row.bar_date, final[row.bar_date] / row.close) for row in isy_rows if row.close and row.bar_date in final]
    )
    basis: dict[date, float] = {}
    lone: set[date] = set()
    split_ratio: float | None = None
    for index, segment in enumerate(segments):
        for day in segment.days:
            basis[day] = segment.ratio
        if segment.as_traded:
            continue
        if len(segment.days) >= 2 or index == 0:
            split_ratio = segment.ratio
        else:
            lone.update(segment.days)
    newest = segments[-1] if segments else None
    stale_basis = newest is not None and not newest.as_traded and len(newest.days) >= 2
    fallback_from = newest.days[0] if newest is not None and newest.as_traded else None

    enrich: list[dict[str, Any]] = []
    mismatches: list[dict[str, Any]] = []
    volume_mismatches: list[dict[str, Any]] = []
    compared = volume_compared = 0
    max_dev = 0.0
    fallback: list[dict[str, Any]] = []
    for row in isy_rows:
        if row.close is None:
            continue
        bar = stored.get(row.bar_date)
        if bar is None:
            if fallback_from is not None and row.bar_date > fallback_from and price.is_session_final(row.bar_date, now):
                fallback.append(
                    {
                        "symbol": symbol,
                        "interval": "1d",
                        "bar_date": row.bar_date,
                        "open": None,
                        "high": row.high,
                        "low": row.low,
                        "close": row.close,
                        "volume": None,
                        "turnover": row.turnover,
                        "vwap": row.vwap,
                        "source": ms.ISY_SOURCE,
                        "adjusted": True,
                        "is_final": True,
                    }
                )
            continue
        if row.bar_date not in final:
            continue
        stored_close = final[row.bar_date]
        compared += 1
        expected_ratio = 1.0 if row.bar_date in lone else basis[row.bar_date]
        deviation = stored_close / (row.close * expected_ratio) - 1
        max_dev = max(max_dev, abs(deviation))
        if abs(deviation) > CLOSE_MATCH_TOLERANCE:
            mismatches.append(
                {"symbol": symbol, "date": row.bar_date.isoformat(), "stored": stored_close, "isyatirim": row.close,
                 "deviation": round(deviation, 6)}
            )
            continue  # no enrichment from a session the two sources disagree on
        session_basis = basis[row.bar_date]
        vwap = round(row.vwap * session_basis, 4) if row.vwap is not None else None
        turnover = round(row.turnover, 2) if row.turnover is not None else None
        stored_vwap = finite_float(bar.vwap)
        stored_turnover = finite_float(bar.turnover)
        if (turnover is not None and (stored_turnover is None or abs(stored_turnover - turnover) > 0.5)) or (
            vwap is not None and (stored_vwap is None or abs(stored_vwap - vwap) > 0.00005)
        ):
            enrich.append({"symbol": symbol, "interval": "1d", "bar_date": row.bar_date, "turnover": turnover, "vwap": vwap})
        volume = finite_float(bar.volume)
        lots = row.lots
        if volume and lots:
            volume_compared += 1
            # TradingView volume is split-adjusted: lots on the stored basis = lots / basis.
            ratio = volume * session_basis / lots
            if abs(ratio - 1) > VOLUME_MATCH_TOLERANCE:
                volume_mismatches.append(
                    {"symbol": symbol, "date": row.bar_date.isoformat(), "tradingview_lots": volume,
                     "isyatirim_lots": round(lots / session_basis), "ratio": round(ratio, 5)}
                )
    return ReconcileOutcome(
        enrich, fallback, compared, mismatches, volume_compared, volume_mismatches, max_dev, split_ratio, stale_basis
    )


def official_volume_candidate(
    symbol: str, isy_rows: Sequence[IsyDailyRow], stored: dict[date, Any], now: datetime
) -> dict[str, Any] | None:
    """The latest finished session whose stored lot count still disagrees with ``HG_HACIM / HG_AOF``.

    Only as-traded sessions (stored close = ``HG_KAPANIS``) are considered; the
    tolerance follows the precision of ``HG_AOF`` (three decimals).
    """
    latest = isy_rows[-1] if isy_rows else None
    if latest is None or latest.close is None or not latest.vwap or not price.is_session_final(latest.bar_date, now):
        return None
    bar = stored.get(latest.bar_date)
    implied = latest.lots
    volume = finite_float(getattr(bar, "volume", None)) if bar is not None else None
    if bar is None or not bar.is_final or implied is None or not volume:
        return None
    if not ms.closes_match(finite_float(bar.close), latest.close, CLOSE_MATCH_TOLERANCE):
        return None
    tolerance = max(IMPLIED_LOTS_FLOOR, IMPLIED_LOTS_PRICE_STEP / latest.vwap)
    if abs(volume / implied - 1) <= tolerance:
        return None
    return {"symbol": symbol, "bar_date": latest.bar_date, "stored": volume, "implied": round(implied)}


async def apply_official_lots(
    candidates: Sequence[dict[str, Any]], *, stop: asyncio.Event | None = None
) -> dict[str, Any]:
    """Re-read OneEndeks for ``candidates`` and store the official lot count of their session."""
    if not candidates:
        return {"candidates": 0, "fixed": 0}
    quotes, failures = await fetch_official_quotes([c["symbol"] for c in candidates], stop=stop)
    rows: list[dict[str, Any]] = []
    for candidate in candidates:
        figures = ms.official_session_figures(quotes.get(candidate["symbol"]), candidate["bar_date"])
        if figures is None or figures[0] == candidate["stored"]:
            continue
        rows.append({"symbol": candidate["symbol"], "interval": "1d", "bar_date": candidate["bar_date"],
                     "volume": figures[0]})
    if rows:
        async with async_session_factory() as session:
            await enrich_bars(session, rows)
            await session.commit()
    stored_by_symbol = {c["symbol"]: c for c in candidates}
    return {
        "candidates": len(candidates),
        "fixed": len(rows),
        "failures": len(failures),
        "examples": [
            {"symbol": r["symbol"], "bar_date": r["bar_date"].isoformat(), "stored": stored_by_symbol[r["symbol"]]["stored"],
             "implied": stored_by_symbol[r["symbol"]]["implied"], "official": r["volume"]}
            for r in rows[:10]
        ],
    }


async def run_reconcile(
    symbols: Sequence[str] | None = None,
    *,
    days: int | None = None,
    stop: asyncio.Event | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """İş Yatırım reconciliation of the last ``days`` calendar days (stocks only)."""
    async with source_lock(JOB_RECONCILE) as acquired:
        if not acquired:
            return {"job": JOB_RECONCILE, "skipped": "locked"}
        async with run_job(JOB_RECONCILE, scope=_scope(symbols)) as run:
            started = _time.monotonic()
            current = now or price.now_istanbul()
            window = days if days is not None else settings.market_reconcile_days
            start = current.date() - timedelta(days=window)
            targets = [t for t in await load_targets(symbols, include_indices=False) if t.security_type != "index"]
            semaphore = asyncio.Semaphore(max(1, settings.market_reconcile_concurrency))
            fetched: dict[str, list[IsyDailyRow]] = {}
            failures: dict[str, str] = {}

            async def fetch(target: Target) -> None:
                if stop is not None and stop.is_set():
                    return
                async with semaphore:
                    try:
                        fetched[target.symbol] = await fetch_daily_history(target.symbol, start, current.date())
                    except MarketDataError as e:
                        failures[target.symbol] = e.message
                    await asyncio.sleep(0.2 + random.random() * 0.2)

            await asyncio.gather(*(fetch(t) for t in targets))

            ids = {t.symbol: t.company_id for t in targets}
            enrich_rows: list[dict[str, Any]] = []
            fallback_rows: list[dict[str, Any]] = []
            compared = volume_compared = 0
            close_mismatches: list[dict[str, Any]] = []
            volume_mismatches: list[dict[str, Any]] = []
            splits: dict[str, float] = {}
            stale: dict[str, str] = {}
            candidates: list[dict[str, Any]] = []
            max_dev = 0.0
            async with async_session_factory() as session:
                repo = MarketBarRepository(session)
                for symbol, rows in fetched.items():
                    stored = {bar.bar_date: bar for bar in await repo.series(symbol, since=start)}
                    outcome = reconcile_symbol(symbol, rows, stored, current)
                    candidate = official_volume_candidate(symbol, rows, stored, current)
                    if candidate is not None:
                        candidates.append(candidate)
                    enrich_rows.extend(outcome.enrich)
                    fallback_rows.extend({**r, "company_id": ids.get(symbol)} for r in outcome.fallback_rows)
                    compared += outcome.compared
                    volume_compared += outcome.volume_compared
                    close_mismatches.extend(outcome.close_mismatches)
                    volume_mismatches.extend(outcome.volume_mismatches)
                    max_dev = max(max_dev, outcome.max_close_deviation)
                    if outcome.split_ratio is not None:
                        splits[symbol] = round(outcome.split_ratio, 6)
                    if outcome.stale_basis:
                        stale[symbol] = f"reconcile: newest sessions differ from as-traded closes ({symbol})"
                enriched = await enrich_bars(session, enrich_rows)
                fallback_stats = await upsert_bars(session, fallback_rows)
                session.add_all(
                    reconcile_checks(
                        compared, close_mismatches, max_dev, volume_compared, volume_mismatches, splits, window
                    )
                )
                await session.commit()
            # The latest session's official lot count where the stored one is still TradingView's short count.
            official_lots = await apply_official_lots(candidates, stop=stop)
            refresh = await _flag_refresh(stale, current.date())

            run.items_total = len(targets)
            run.items_ok = len(fetched)
            run.items_failed = len(failures)
            run.details = {
                "days": window,
                "sessions_compared": compared,
                "close_mismatches": len(close_mismatches),
                "max_close_deviation": round(max_dev, 6),
                "volume_compared": volume_compared,
                "volume_mismatches": len(volume_mismatches),
                "enriched": enriched,
                "official_lots": official_lots,
                "fallback_bars": fallback_stats.as_dict(),
                "splits": splits,
                "refresh_flagged": refresh,
                "failures": dict(list(failures.items())[:20]),
                "duration_seconds": _duration(started),
            }
            return {"job": JOB_RECONCILE, **run.details}


def reconcile_checks(
    compared: int,
    close_mismatches: list[dict[str, Any]],
    max_dev: float,
    volume_compared: int,
    volume_mismatches: list[dict[str, Any]],
    splits: dict[str, float],
    days: int,
) -> list[Any]:
    """``data_quality_checks`` rows of one reconciliation run."""
    checks = []
    if compared:
        worst = sorted(close_mismatches, key=lambda m: -abs(m["deviation"]))[:20]
        status = "pass" if not close_mismatches else ("warn" if max_dev <= 0.01 else "fail")
        checks.append(
            quality_check(
                "market.close_tv_vs_isy",
                status,
                subject="universe",
                expected=float(compared),
                actual=float(compared - len(close_mismatches)),
                deviation=round(max_dev, 6),
                details={"days": days, "tolerance": CLOSE_MATCH_TOLERANCE, "mismatches": worst, "splits": splits},
            )
        )
    if volume_compared:
        worst_volume = sorted(volume_mismatches, key=lambda m: -abs(m["ratio"] - 1))[:20]
        share = len(volume_mismatches) / volume_compared
        checks.append(
            quality_check(
                "market.volume_units",
                "pass" if share <= 0.05 else ("warn" if share <= 0.2 else "fail"),
                subject="universe",
                expected=float(volume_compared),
                actual=float(volume_compared - len(volume_mismatches)),
                deviation=round(share, 6),
                details={
                    "units": "TradingView volume = lots (shares); İş Yatırım HG_HACIM = TL turnover; "
                    "lots ≈ HG_HACIM / HG_AOF",
                    "tolerance": VOLUME_MATCH_TOLERANCE,
                    "mismatches": worst_volume,
                },
            )
        )
    return checks


# ---------------------------------------------------------------------------
# market.bars.reconcile.backfill — İş Yatırım turnover/VWAP for the stored history
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TurnoverItem:
    target: Target
    start: date
    end: date
    first_stored: date

    @property
    def completes(self) -> bool:
        return self.start <= self.first_stored + timedelta(days=TURNOVER_DONE_TOLERANCE_DAYS)


def _iso_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def plan_turnover_backfill(
    targets: Sequence[Target], coverage: dict[str, Any], markers: dict[str, HistoryMarker], today: date
) -> list[TurnoverItem]:
    """The next ≤ ``TURNOVER_CHUNK_DAYS`` window of every stock whose stored history is not yet
    enriched back to its first bar (newest window first; core before the rest of the universe)."""
    items: list[TurnoverItem] = []
    for target in targets:
        cov = coverage.get(target.symbol)
        if cov is None or target.security_type == "index":
            continue
        extra = markers[target.symbol].extra if target.symbol in markers else {}
        if extra.get("turnover_failed_on") == today.isoformat():
            continue  # İş Yatırım refused it today: retry tomorrow
        done_from = _iso_date(extra.get("turnover_from"))
        if done_from is not None and done_from <= cov.first_date + timedelta(days=TURNOVER_DONE_TOLERANCE_DAYS):
            continue
        end = done_from - timedelta(days=1) if done_from is not None else today
        start = max(cov.first_date, end - timedelta(days=TURNOVER_CHUNK_DAYS))
        items.append(TurnoverItem(target, start, end, cov.first_date))
    return sorted(items, key=lambda item: (0 if item.target.tier in ("core", "index") else 1, item.target.symbol))


async def _enrich_turnover_window(item: TurnoverItem, isy_rows: Sequence[IsyDailyRow], now: datetime) -> dict[str, Any]:
    """Reconcile one window (``reconcile_symbol`` rules: OHLCV untouched, VWAP on the stored basis)."""
    symbol = item.target.symbol
    async with async_session_factory() as session:
        stored = {
            bar.bar_date: bar
            for bar in await MarketBarRepository(session).series(symbol, since=item.start, until=item.end)
        }
        outcome = reconcile_symbol(symbol, isy_rows, stored, now)
        enriched = await enrich_bars(session, outcome.enrich)
        await HistoryMarkerRepository(session).merge_extra(
            symbol,
            {"turnover_from": item.start.isoformat(), "turnover_done": item.completes,
             "turnover_checked_on": now.date().isoformat()},
        )
        await session.commit()
    return {
        "symbol": symbol,
        "start": item.start.isoformat(),
        "end": item.end.isoformat(),
        "sessions": len(isy_rows),
        "stored": len(stored),
        "compared": outcome.compared,
        "enriched": enriched,
        "close_mismatches": len(outcome.close_mismatches),
        "split_ratio": round(outcome.split_ratio, 6) if outcome.split_ratio is not None else None,
        "done": item.completes,
    }


async def run_turnover_backfill(
    symbols: Sequence[str] | None = None,
    *,
    max_symbols: int | None = None,
    max_seconds: float | None = None,
    until_done: bool | None = None,
    stop: asyncio.Event | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """İş Yatırım turnover/VWAP for the stored history, one window per symbol and pass.

    Background passes (``symbols=None``) handle ``TURNOVER_BATCH_SIZE`` symbols within
    ``TURNOVER_MAX_SECONDS``; explicit ``symbols`` are walked back to their first stored
    bar (``until_done``). Resumable: progress lives in the ``market.history:*`` markers.
    """
    async with source_lock(JOB_TURNOVER_BACKFILL) as acquired:
        if not acquired:
            return {"job": JOB_TURNOVER_BACKFILL, "skipped": "locked"}
        current = now or price.now_istanbul()
        today = current.date()
        targets = [t for t in await load_targets(symbols, include_indices=False) if t.security_type != "index"]
        walk = bool(symbols) if until_done is None else until_done
        limit = max_symbols if max_symbols is not None else (len(targets) if symbols else TURNOVER_BATCH_SIZE)
        budget = max_seconds if max_seconds is not None else (None if symbols else TURNOVER_MAX_SECONDS)
        async with run_job(JOB_TURNOVER_BACKFILL, scope=_scope(symbols)) as run:
            started = _time.monotonic()
            results: list[dict[str, Any]] = []
            failures: dict[str, str] = {}
            pending_before: int | None = None
            plan: list[TurnoverItem] = []
            semaphore = asyncio.Semaphore(TURNOVER_CONCURRENCY)
            while stop is None or not stop.is_set():
                symbol_list = [t.symbol for t in targets]
                async with async_session_factory() as session:
                    coverage = await MarketBarRepository(session).coverage(symbol_list)
                    markers = await HistoryMarkerRepository(session).get_many(symbol_list)
                plan = [item for item in plan_turnover_backfill(targets, coverage, markers, today)
                        if item.target.symbol not in failures]
                if pending_before is None:
                    pending_before = len(plan)
                if not plan or (budget is not None and _time.monotonic() - started > budget):
                    break

                async def one(item: TurnoverItem) -> None:
                    async with semaphore:
                        if (stop is not None and stop.is_set()) or (
                            budget is not None and _time.monotonic() - started > budget
                        ):
                            return
                        symbol = item.target.symbol
                        try:
                            rows = await fetch_daily_history(symbol, item.start, item.end)
                            results.append(await _enrich_turnover_window(item, rows, current))
                        except MarketDataError as e:
                            failures[symbol] = e.message
                            async with async_session_factory() as session:
                                await HistoryMarkerRepository(session).merge_extra(
                                    symbol, {"turnover_failed_on": today.isoformat(), "turnover_error": e.message[:200]}
                                )
                                await session.commit()
                        await asyncio.sleep(random.uniform(*TURNOVER_PAUSE_SECONDS))

                await asyncio.gather(*(one(item) for item in plan[:limit]))
                if not walk:
                    break
            async with async_session_factory() as session:
                symbol_list = [t.symbol for t in targets]
                coverage = await MarketBarRepository(session).coverage(symbol_list)
                markers = await HistoryMarkerRepository(session).get_many(symbol_list)
            remaining = plan_turnover_backfill(targets, coverage, markers, today)
            run.items_total = len({r["symbol"] for r in results}) + len(failures)
            run.items_ok = len({r["symbol"] for r in results})
            run.items_failed = len(failures)
            run.details = {
                "pending_before": pending_before or 0,
                "pending_after": len(remaining),
                "windows": len(results),
                "sessions": sum(r["sessions"] for r in results),
                "compared": sum(r["compared"] for r in results),
                "enriched": sum(r["enriched"] for r in results),
                "close_mismatches": sum(r["close_mismatches"] for r in results),
                "completed_symbols": sorted({r["symbol"] for r in results if r["done"]})[:100],
                "splits": {r["symbol"]: r["split_ratio"] for r in results if r["split_ratio"] is not None},
                "failures": dict(list(failures.items())[:20]),
                "duration_seconds": _duration(started),
            }
            return {"job": JOB_TURNOVER_BACKFILL, **run.details}


# ---------------------------------------------------------------------------
# market.accuracy — served per-symbol values vs the official figures
# ---------------------------------------------------------------------------

ACCURACY_TV_COLUMNS: tuple[str, ...] = (
    "close", "change_abs", "volume", "Value.Traded", "market_cap_basic", "total_shares_outstanding",
    "price_book_fq", "price_book_ratio", "update_time", "time",
)
PB_WARN_TOLERANCE = 0.02  # served P/B within 2 % of the expected one (other rounding) → warn
SHARES_WARN_TOLERANCE = 0.005
VOLUME_WARN_TOLERANCE = 0.01


@dataclass
class AccuracyInputs:
    """Everything one symbol's accuracy checks compare (see :func:`run_accuracy_checks`)."""

    symbol: str
    served: dict[str, Any]  # the fast-info payload's ``fast_info`` block
    tradingview: dict[str, Any]  # TradingView scanner row (:data:`ACCURACY_TV_COLUMNS`)
    official: dict[str, Any] | None  # a fresh İş Yatırım OneEndeks quote
    card: dict[str, Any] | None = None  # İş Yatırım company card (informational)
    stored_capital: float | None = None  # companies.paid_in_capital
    stored_bar: Any | None = None  # latest stored daily bar (what /prices/latest serves)

    @property
    def last(self) -> float | None:
        return price._positive(self.served.get("last_price"))

    @property
    def tv_session(self) -> date | None:
        return price.session_date_from_epoch(self.tradingview.get("time"))


def _relative(actual: float | None, expected: float | None) -> float | None:
    if actual is None or expected is None or expected == 0:
        return None
    return round(abs(actual / expected - 1), 8)


def pb_field_check(inputs: AccuracyInputs) -> DataQualityCheck | None:
    """``market.pb_field``: served P/B vs last × paid-in capital / latest-quarter parent equity.

    Expected = the own calculation from OneEndeks ``capital``/``equity``, else
    TradingView ``price_book_fq``; ``price_book_ratio`` (year-end equity) is shown only
    as the legacy value.
    """
    served = finite_float(inputs.served.get("pb_ratio"))
    official = inputs.official or {}
    capital, equity, last = price._positive(official.get("capital")), finite_float(official.get("equity")), inputs.last
    own = last * capital / equity if last is not None and capital is not None and equity else None
    tv_fq = finite_float(inputs.tradingview.get("price_book_fq"))
    expected = round(own, 2) if own is not None else (round(tv_fq, 2) if tv_fq is not None else None)
    if served is None and expected is None:
        return None
    deviation = _relative(served, expected)
    if served is not None and expected is not None and abs(served - expected) <= 0.0051:
        status = "pass"
    elif deviation is not None and deviation <= PB_WARN_TOLERANCE:
        status = "warn"
    else:
        status = "fail"
    card = inputs.card or {}
    return quality_check(
        "market.pb_field",
        status,
        subject=inputs.symbol,
        expected=expected,
        actual=served,
        deviation=deviation,
        details={
            "rule": "PD/DD = son fiyat × ödenmiş sermaye / son çeyrek ana ortaklık özkaynakları (İş Yatırım); "
            "yoksa TradingView price_book_fq",
            "served_source": inputs.served.get("pb_source"),
            "own_calc": round(own, 4) if own is not None else None,
            "tradingview_price_book_fq": round(tv_fq, 4) if tv_fq is not None else None,
            "legacy_tradingview_price_book_ratio": finite_float(inputs.tradingview.get("price_book_ratio")),
            "isyatirim_card_pb": finite_float(card.get("pb_ratio")),
            "last": last,
            "capital": capital,
            "parent_equity": equity,
        },
    )


def shares_vs_paid_in_check(inputs: AccuracyInputs) -> DataQualityCheck | None:
    """``market.shares_vs_paid_in``: served share count / market cap vs paid-in capital × last."""
    from src.adapters.fundamentals_snapshot import _shares_outstanding  # legacy estimate, for the record

    served_shares = finite_float(inputs.served.get("shares"))
    served_cap = finite_float(inputs.served.get("market_cap"))
    official_capital = price._positive((inputs.official or {}).get("capital"))
    capital = official_capital or price._positive(inputs.stored_capital)
    last = inputs.last
    if capital is None or last is None:
        return None
    expected_cap = round(last * capital, 2)
    shares_deviation = _relative(served_shares, float(round(capital)))
    cap_deviation = _relative(served_cap, expected_cap)
    exact = served_shares is not None and abs(served_shares - round(capital)) <= 1 and (cap_deviation or 0) <= 1e-6
    if exact and cap_deviation is not None:
        status = "pass"
    elif max(shares_deviation or 1, cap_deviation or 1) <= SHARES_WARN_TOLERANCE:
        status = "warn"
    else:
        status = "fail"
    tv = inputs.tradingview
    card = inputs.card or {}
    close, change = finite_float(tv.get("close")), finite_float(tv.get("change_abs"))
    legacy = _shares_outstanding(
        finite_float(card.get("market_cap")),
        finite_float(tv.get("market_cap_basic")),
        close - change if close is not None and change is not None else None,
        close,
        finite_float(tv.get("total_shares_outstanding")),
    )
    return quality_check(
        "market.shares_vs_paid_in",
        status,
        subject=inputs.symbol,
        expected=float(round(capital)),
        actual=served_shares,
        deviation=shares_deviation,
        details={
            "rule": "pay adedi = ödenmiş sermaye (1 TL nominal); piyasa değeri = son fiyat × ödenmiş sermaye",
            "served_source": inputs.served.get("shares_source"),
            "served_market_cap": served_cap,
            "expected_market_cap": expected_cap,
            "market_cap_deviation": cap_deviation,
            "isyatirim_capital": official_capital,
            "stored_paid_in_capital": price._positive(inputs.stored_capital),
            "tradingview_total_shares_outstanding": finite_float(tv.get("total_shares_outstanding")),
            "tradingview_market_cap_basic": finite_float(tv.get("market_cap_basic")),
            "isyatirim_card_market_cap": finite_float(card.get("market_cap")),
            "legacy_shares": legacy,
            "legacy_market_cap": round(last * legacy, 2) if legacy is not None else None,
        },
    )


def volume_vs_oneendeks_check(inputs: AccuracyInputs, *, now: datetime) -> DataQualityCheck | None:
    """``market.volume_vs_oneendeks``: served lots / TL turnover (fast-info and the stored daily bar)
    vs OneEndeks ``quantity`` / ``volume`` of the same session — exact once the session is final."""
    session_date = inputs.tv_session
    figures = ms.official_session_figures(inputs.official, session_date)
    if figures is None:
        return None
    lots, turnover = figures
    served_volume = finite_float(inputs.served.get("volume"))
    served_amount = finite_float(inputs.served.get("amount"))
    bar = inputs.stored_bar
    bar_volume = finite_float(getattr(bar, "volume", None)) if bar is not None else None
    bar_turnover = finite_float(getattr(bar, "turnover", None)) if bar is not None else None
    final = session_date is not None and price.is_session_final(session_date, now)
    bar_is_session = bar is not None and bar.bar_date == session_date and bar.is_final
    served_exact = served_volume == lots and (
        turnover is None or (served_amount is not None and abs(served_amount - turnover) <= 0.5)
    )
    bar_exact = not (final and bar_is_session) or (
        bar_volume == lots and (turnover is None or (bar_turnover is not None and abs(bar_turnover - turnover) <= 1.0))
    )
    deviation = _relative(served_volume, lots)
    if served_exact and bar_exact:
        status = "pass"
    elif max(deviation if deviation is not None else 1, _relative(bar_volume, lots) or 0) <= VOLUME_WARN_TOLERANCE:
        status = "warn"
    else:
        status = "fail"
    tv = inputs.tradingview
    return quality_check(
        "market.volume_vs_oneendeks",
        status,
        subject=inputs.symbol,
        expected=lots,
        actual=served_volume,
        deviation=deviation,
        details={
            "session_date": session_date.isoformat() if session_date else None,
            "session_final": final,
            "served_source": inputs.served.get("volume_source"),
            "served_amount": served_amount,
            "official_turnover": turnover,
            "stored_bar": {
                "bar_date": bar.bar_date.isoformat(), "volume": bar_volume, "turnover": bar_turnover,
                "is_final": bar.is_final,
            } if bar is not None else None,
            "tradingview_volume": finite_float(tv.get("volume")),
            "tradingview_value_traded": finite_float(tv.get("Value.Traded")),
            "served_updated_at": inputs.served.get("updated_at"),
            "session_state": inputs.served.get("session_state"),
        },
    )


async def run_accuracy_checks(
    symbols: Sequence[str] | None = None, *, now: datetime | None = None, include_card: bool | None = None
) -> dict[str, Any]:
    """Served fast-info values vs official figures → ``data_quality_checks`` rows per symbol.

    ``symbols`` defaults to the day's rotating core sample (:func:`pick_quote_sample`);
    ``include_card`` (default: only for explicit symbols) adds the İş Yatırım company
    card to the details (2-3 s per symbol).
    """
    from src.adapters import fundamentals_snapshot  # the adapter layer builds the served payload

    async with run_job(JOB_ACCURACY, scope=_scope(symbols)) as run:
        started = _time.monotonic()
        current = now or price.now_istanbul()
        if symbols:
            wanted = list(dict.fromkeys(s.strip().upper() for s in symbols if s and s.strip()))
        else:
            wanted = pick_quote_sample(await load_targets(include_indices=False), current.date())
        with_card = bool(symbols) if include_card is None else include_card
        tv_rows = await tradingview_scan(wanted, ACCURACY_TV_COLUMNS) if wanted else {}
        official, failures = await fetch_official_quotes(wanted) if wanted else ({}, {})
        async with async_session_factory() as session:
            capitals = await paid_in_capitals(session, wanted)
            repo = MarketBarRepository(session)
            bars = {}
            for symbol in wanted:
                series = await repo.series(symbol, since=current.date() - timedelta(days=10))
                bars[symbol] = series[-1] if series else None
        checks: list[DataQualityCheck] = []
        results: list[dict[str, Any]] = []
        for symbol in wanted:
            payload = await fundamentals_snapshot.get_fast_info(symbol)
            card = None
            if with_card:
                try:
                    card = await price.get_company_metrics(symbol)
                except MarketDataError:
                    card = None
            inputs = AccuracyInputs(
                symbol=symbol,
                served=dict(payload.get("fast_info") or {}),
                tradingview=tv_rows.get(symbol) or {},
                official=official.get(symbol),
                card=card,
                stored_capital=capitals.get(symbol),
                stored_bar=bars.get(symbol),
            )
            for check in (pb_field_check(inputs), shares_vs_paid_in_check(inputs),
                          volume_vs_oneendeks_check(inputs, now=current)):
                if check is None:
                    continue
                checks.append(check)
                results.append({"check": check.check_name, "subject": symbol, "status": check.status,
                                "expected": check.expected, "actual": check.actual, "deviation": check.deviation,
                                "details": check.details_json})
        async with async_session_factory() as session:
            session.add_all(checks)
            await session.commit()
        statuses: dict[str, dict[str, str]] = {}
        for result in results:
            statuses.setdefault(result["subject"], {})[result["check"]] = result["status"]
        run.items_total = len(wanted)
        run.items_ok = sum(1 for s in wanted if statuses.get(s) and all(v == "pass" for v in statuses[s].values()))
        run.items_failed = len(wanted) - run.items_ok
        run.details = {
            "symbols": wanted,
            "statuses": statuses,
            "official_failures": failures,
            "checks_written": len(checks),
            "duration_seconds": _duration(started),
        }
        return {"job": JOB_ACCURACY, **run.details, "results": results}


# ---------------------------------------------------------------------------
# Manual / admin entry point
# ---------------------------------------------------------------------------

_RUNNERS = {
    JOB_QUOTES: lambda symbols: run_quotes(symbols),
    JOB_BARS_DAILY: lambda symbols: run_daily_bars(symbols),
    JOB_BACKFILL: lambda symbols: run_backfill(symbols),
    JOB_RECONCILE: lambda symbols: run_reconcile(symbols),
    JOB_TURNOVER_BACKFILL: lambda symbols: run_turnover_backfill(symbols),
    JOB_ACCURACY: lambda symbols: run_accuracy_checks(symbols),
}


async def run_market_once(
    *, symbols: list[str] | None = None, jobs: tuple[str, ...] = DEFAULT_ONCE_JOBS
) -> dict[str, Any]:
    """Run the given market jobs once, in order (admin trigger / manual runs).

    ``symbols`` restricts every job to those symbols (backfill then reloads each
    of them fully). Unknown job names raise ``ValueError``. A failing job is
    reported (``{"error": ...}``) and does not stop the following ones.
    """
    unknown = [job for job in jobs if job not in _RUNNERS]
    if unknown:
        raise ValueError(f"unknown market job(s): {', '.join(unknown)}")
    results: dict[str, Any] = {}
    for job in jobs:
        started = _time.monotonic()
        try:
            results[job] = await _RUNNERS[job](symbols)
        except Exception as e:
            logger.error("market_job_failed", job=job, error=f"{type(e).__name__}: {e}")
            results[job] = {"job": job, "error": f"{type(e).__name__}: {e}"[:500]}
        results[job].setdefault("wall_seconds", _duration(started))
    return results


# ---------------------------------------------------------------------------
# Loop
# ---------------------------------------------------------------------------

def _at(day: date, hhmm: str, default: str) -> datetime:
    moment = ms.parse_hhmm(hhmm, ms.parse_hhmm(default, datetime.min.time()))
    return datetime.combine(day, moment, tzinfo=price.ISTANBUL_TZ)


def next_quote_run(now: datetime, last_final_run: date | None) -> float:
    """Seconds until the next quote cycle (0 = run now)."""
    today = now.date()
    if ms.in_quote_window(now):
        return 0.0
    final_at = datetime.combine(today, price.SESSION_FINAL_TIME, tzinfo=price.ISTANBUL_TZ)
    if ms.is_weekday(today) and now >= final_at and last_final_run != today:
        return 0.0
    candidates = []
    if ms.is_weekday(today) and now < final_at:
        opens = datetime.combine(today, ms.session_open_time(), tzinfo=price.ISTANBUL_TZ)
        candidates.append(opens if now < opens else final_at)
    day = today + timedelta(days=1)
    while not ms.is_weekday(day):
        day += timedelta(days=1)
    candidates.append(datetime.combine(day, ms.session_open_time(), tzinfo=price.ISTANBUL_TZ))
    return max(1.0, (min(candidates) - now).total_seconds())


async def _quotes_loop(stop: asyncio.Event) -> None:
    last_final_run: date | None = None
    first = True
    while not stop.is_set():
        now = price.now_istanbul()
        wait = 0.0 if first else next_quote_run(now, last_final_run)
        if wait > 0:
            await sleep_or_stop(stop, min(wait, IDLE_RECHECK_SECONDS))
            continue
        first = False
        cycle_started = _time.monotonic()
        try:
            await run_quotes(now=now)
            if not ms.in_quote_window(now) and price.is_session_final(now.date(), now):
                last_final_run = now.date()
        except Exception as e:
            logger.error("market_quotes_cycle_failed", error=f"{type(e).__name__}: {e}")
            await sleep_or_stop(stop, ERROR_RETRY_SECONDS)
            continue
        if ms.in_quote_window(now):
            elapsed = _time.monotonic() - cycle_started
            await sleep_or_stop(stop, max(1.0, settings.market_quote_interval_seconds - elapsed))


async def _last_success(job: str) -> datetime | None:
    async with async_session_factory() as session:
        runs = await latest_runs(session, [job], per_job=5)
    finished = [r.started_at for r in runs if r.status in ("ok", "partial")]
    return max(finished) if finished else None


def daily_job_due(now: datetime, last_success: datetime | None, after: str, default: str) -> bool:
    """Due when the most recent weekday ``after`` time passed since the last successful run."""
    day = now.date()
    scheduled = _at(day, after, default)
    if not ms.is_weekday(day) or now < scheduled:
        day = ms.previous_weekday(day)
        scheduled = _at(day, after, default)
    return last_success is None or last_success < scheduled


async def _scheduled_loop(stop: asyncio.Event, job: str, after: str, default: str) -> None:
    runner = _RUNNERS[job]
    while not stop.is_set():
        try:
            if daily_job_due(price.now_istanbul(), await _last_success(job), after, default):
                await runner(None)
        except Exception as e:
            logger.error("market_scheduled_job_failed", job=job, error=f"{type(e).__name__}: {e}")
            await sleep_or_stop(stop, ERROR_RETRY_SECONDS)
            continue
        await sleep_or_stop(stop, 300.0)


async def _backfill_loop(stop: asyncio.Event) -> None:
    await sleep_or_stop(stop, 60.0)  # let the first quote/daily cycles go first
    while not stop.is_set():
        if not settings.market_backfill_enabled:
            await sleep_or_stop(stop, settings.market_backfill_idle_seconds)
            continue
        try:
            result = await run_backfill(stop=stop)
            busy = bool(result.get("pending_after")) and not result.get("skipped")
            if not busy and not stop.is_set():
                # Price history complete: enrich the older bars with İş Yatırım turnover/VWAP.
                turnover = await run_turnover_backfill(stop=stop)
                busy = bool(turnover.get("pending_after")) and not turnover.get("skipped")
        except Exception as e:
            logger.error("market_backfill_pass_failed", error=f"{type(e).__name__}: {e}")
            await sleep_or_stop(stop, ERROR_RETRY_SECONDS)
            continue
        await sleep_or_stop(stop, BACKFILL_BUSY_PAUSE_SECONDS if busy else settings.market_backfill_idle_seconds)


async def market_loop(stop: asyncio.Event) -> None:
    """Run the market jobs until ``stop`` is set (wired by ``run_workers.DATA_PLATFORM_LOOPS``)."""
    logger.info("market_loop_started", jobs=list(ALL_JOBS))
    tasks = [
        asyncio.create_task(_quotes_loop(stop), name="market:quotes"),
        asyncio.create_task(_scheduled_loop(stop, JOB_BARS_DAILY, settings.market_daily_bars_after, "18:40"),
                            name="market:bars.daily"),
        asyncio.create_task(_scheduled_loop(stop, JOB_RECONCILE, settings.market_reconcile_after, "20:00"),
                            name="market:bars.reconcile"),
        asyncio.create_task(_scheduled_loop(stop, JOB_ACCURACY, settings.market_reconcile_after, "20:00"),
                            name="market:accuracy"),
        asyncio.create_task(_backfill_loop(stop), name="market:bars.backfill"),
    ]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("market_loop_stopped")


async def _main(argv: Sequence[str] | None = None) -> int:
    """``python -m src.workers.market_worker [--jobs a,b] [--symbols X,Y]`` — one manual run (JSON on stdout)."""
    import argparse
    import json

    from src.adapters.utils import close_http_client
    from src.db.session import dispose_engine

    parser = argparse.ArgumentParser(description="Run market store jobs once.")
    parser.add_argument("--jobs", default=",".join(DEFAULT_ONCE_JOBS), help=f"comma-separated: {', '.join(ALL_JOBS)}")
    parser.add_argument("--symbols", default="", help="comma-separated symbols (default: the whole universe)")
    args = parser.parse_args(argv)
    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()] or None
    try:
        result = await run_market_once(symbols=symbols, jobs=tuple(j.strip() for j in args.jobs.split(",") if j.strip()))
        print(json.dumps(result, default=str, ensure_ascii=False, indent=1))
        return 1 if any("error" in r for r in result.values()) else 0
    finally:
        await close_http_client()
        await dispose_engine()


if __name__ == "__main__":
    import sys

    sys.exit(asyncio.run(_main()))
