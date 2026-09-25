"""TradingView OHLCV history over one long-lived chart websocket.

borsapy's ``TradingViewProvider.get_history`` opens a new websocket for every
call. The free chart servers answer from Asia (hkg1/tyo1), so TCP + TLS + the
websocket upgrade cost 1–2 s of the 2–3 s a cold chart period used to take,
and a burst of fresh connections gets dropped. Here one connection per process
stays open (its ~10 s heartbeats are echoed, as the TradingView web app does)
and every request runs in its own short-lived chart session on it: a cold
fetch is one resolve/create_series round trip (~0.4–0.6 s), and concurrent
requests share the socket.

Requests mirror the provider (symbol config, timeframe and bar-count mapping,
frame shape, start/end trimming), so callers get the same DataFrame. When the
shared connection cannot serve a request (connect or send failure, dropped
connection, no answer in time) it falls back to the provider's one-shot fetch;
an unknown symbol raises the provider's ``APIError`` like the provider does.
"""

import json
import os
import random
import re
import string
import threading
import time
from datetime import datetime
from typing import Any

import pandas as pd
import structlog
import websocket
from borsapy._providers.tradingview import TradingViewProvider, get_tradingview_provider
from borsapy.exceptions import APIError

logger = structlog.get_logger(__name__)

WS_URL = f"{TradingViewProvider.WS_URL}?type=chart"
CONNECT_TIMEOUT = 10.0
# A healthy request answers in well under a second; after this the connection
# is presumed dead, replaced, and the request retried one-shot.
REQUEST_TIMEOUT = 8.0
# The server sends a heartbeat every ~10 s: a socket silent for this long is dead.
READ_TIMEOUT = 30.0
# Nobody asked for bars for this long: close the socket until the next request.
IDLE_TIMEOUT = 1800.0
# After a failed handshake, requests go one-shot for this long instead of queueing on reconnects.
RECONNECT_BACKOFF = 30.0
# Chart sessions open at once on the socket (the web app runs up to 8 charts per layout).
MAX_SESSIONS = 8

_FRAME_SPLIT = re.compile(r"~m~\d+~m~")
_HEARTBEAT = re.compile(r"~h~\d+")
_SESSION_MESSAGES = frozenset({"timescale_update", "series_completed", "symbol_error", "series_error", "critical_error"})


class _Unavailable(Exception):
    """The shared connection could not serve the request (caller falls back to one-shot)."""


def _packet(data: str) -> str:
    return f"~m~{len(data)}~m~{data}"


def _message(method: str, params: list[Any]) -> str:
    return _packet(json.dumps({"m": method, "p": params}, separators=(",", ":")))


def _session_id() -> str:
    return "cs_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=12))


class _Request:
    __slots__ = ("bars", "error", "lost", "done")

    def __init__(self) -> None:
        self.bars: dict[int, dict[str, Any]] = {}
        self.error: str | None = None  # TradingView refused the series (e.g. unknown symbol)
        self.lost: str | None = None  # the connection went away before the answer
        self.done = threading.Event()


class _Connection:
    """One chart websocket; a reader thread routes messages to the waiting sessions."""

    def __init__(self, auth_token: str) -> None:
        self.ws = websocket.create_connection(
            WS_URL, header={"Origin": TradingViewProvider.ORIGIN}, timeout=CONNECT_TIMEOUT
        )
        self.ws.settimeout(READ_TIMEOUT)
        self.pid = os.getpid()
        self.alive = True
        self.slots = threading.BoundedSemaphore(MAX_SESSIONS)
        self._lock = threading.Lock()
        self._pending: dict[str, _Request] = {}
        self._last_used = time.monotonic()
        self.send(_message("set_auth_token", [auth_token]))
        threading.Thread(target=self._read, name="tradingview-chart", daemon=True).start()

    def usable(self) -> bool:
        # A forked child inherits the socket but not the reader thread.
        return self.alive and self.pid == os.getpid()

    def send(self, data: str) -> None:
        self.ws.send(data)  # websocket-client serialises concurrent senders

    def register(self, session: str, request: _Request) -> None:
        with self._lock:
            if not self.alive:
                raise _Unavailable("connection closed")
            self._pending[session] = request
            self._last_used = time.monotonic()

    def unregister(self, session: str) -> None:
        """After this no message reaches the session's request any more."""
        with self._lock:
            self._pending.pop(session, None)
            self._last_used = time.monotonic()

    def close(self, reason: str) -> None:
        """Drop the socket; every waiting request learns the connection is gone."""
        with self._lock:
            if not self.alive:
                return
            self.alive = False
            pending = list(self._pending.values())
            self._pending.clear()
        for request in pending:
            request.lost = reason
            request.done.set()
        try:
            self.ws.shutdown()
        except Exception:
            pass
        logger.debug("tradingview_chart_closed", reason=reason)

    def _idle(self) -> bool:
        with self._lock:
            return not self._pending and time.monotonic() - self._last_used > IDLE_TIMEOUT

    def _read(self) -> None:
        try:
            while self.alive:
                raw = self.ws.recv()
                if not raw:
                    raise ConnectionError("closed by server")
                for part in _FRAME_SPLIT.split(raw):
                    if part:
                        self._handle(part)
                if self._idle():
                    self.close("idle")
        except Exception as e:  # timeout (no heartbeat), reset, shutdown() from close()
            self.close(f"{type(e).__name__}: {e}")

    def _handle(self, part: str) -> None:
        if _HEARTBEAT.fullmatch(part):
            self.send(_packet(part))
            return
        try:
            packet = json.loads(part)
        except ValueError:
            return
        if not isinstance(packet, dict) or packet.get("m") not in _SESSION_MESSAGES:
            return
        method, params = packet["m"], packet.get("p") or []
        with self._lock:
            request = self._pending.get(params[0]) if isinstance(params[0], str) else None
            if request is None:
                return
            if method == "timescale_update":
                prices = params[1].get("$prices", {}) if len(params) > 1 and isinstance(params[1], dict) else {}
                for candle in prices.get("s", []):
                    values = candle.get("v", []) if isinstance(candle, dict) else []
                    # Indices (XGIDA, ...) come without a volume field: [time, O, H, L, C].
                    if len(values) >= 5:
                        ts = int(values[0])
                        request.bars[ts] = {
                            "time": ts,
                            "open": values[1],
                            "high": values[2],
                            "low": values[3],
                            "close": values[4],
                            "volume": values[5] if len(values) >= 6 else 0.0,
                        }
            elif method == "series_completed":
                request.done.set()
            else:  # symbol_error / series_error / critical_error, in the provider's error text
                request.error = request.error or str(params)
                request.done.set()


class _ChartClient:
    """Owns the process's shared connection and runs requests on it."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._connection: _Connection | None = None
        self._retry_at = 0.0

    def _connect(self) -> _Connection:
        with self._lock:  # concurrent first requests wait for one handshake
            if self._connection is not None and self._connection.usable():
                return self._connection
            if time.monotonic() < self._retry_at:
                raise _Unavailable("reconnect backoff")
            try:
                self._connection = _Connection(get_tradingview_provider()._get_auth_token())
            except Exception as e:
                self._retry_at = time.monotonic() + RECONNECT_BACKOFF
                raise _Unavailable(f"connect failed: {type(e).__name__}: {e}") from e
            return self._connection

    def fetch(self, tv_symbol: str, timeframe: str, bars: int) -> dict[int, dict[str, Any]]:
        connection = self._connect()
        session = _session_id()
        request = _Request()
        if not connection.slots.acquire(timeout=REQUEST_TIMEOUT):
            raise _Unavailable("no free chart session")
        try:
            connection.register(session, request)
            try:
                symbol = json.dumps({"symbol": tv_symbol, "adjustment": "splits", "session": "regular"}, separators=(",", ":"))
                connection.send(_message("chart_create_session", [session, ""]))
                connection.send(_message("resolve_symbol", [session, "ser_1", f"={symbol}"]))
                connection.send(_message("create_series", [session, "$prices", "s1", "ser_1", timeframe, bars, ""]))
                answered = request.done.wait(REQUEST_TIMEOUT)
                connection.unregister(session)
                if connection.alive:
                    connection.send(_message("chart_delete_session", [session]))
            except _Unavailable:
                raise
            except Exception as e:  # the socket broke under a send
                connection.close(f"send failed: {type(e).__name__}: {e}")
                if not request.done.is_set():
                    raise _Unavailable(f"send failed: {type(e).__name__}") from e
                answered = True
        finally:
            connection.unregister(session)
            connection.slots.release()
        if request.error is not None:
            raise APIError(f"TradingView error: {request.error}")
        if request.lost is not None:
            raise _Unavailable(request.lost)
        if not answered and not request.bars:
            connection.close("request timed out")
            raise _Unavailable("request timed out")
        # Bars without "series_completed" (answer cut short): the provider stops at the first batch too.
        return request.bars


_client = _ChartClient()


def _history_frame(tv_symbol: str, bars: dict[int, dict[str, Any]], start: datetime | None, end: datetime | None) -> pd.DataFrame:
    """The provider's frame: Open/High/Low/Close/Volume on an Istanbul DatetimeIndex, trimmed to start/end."""
    if not bars:
        raise APIError(f"No data received for {tv_symbol}")
    df = pd.DataFrame(list(bars.values()))
    df["Date"] = pd.to_datetime(df["time"], unit="s", utc=True)
    df = df.set_index("Date").sort_index()
    df = df[["open", "high", "low", "close", "volume"]]
    df.columns = ["Open", "High", "Low", "Close", "Volume"]
    df.index = df.index.tz_convert("Europe/Istanbul")
    if start:
        start_tz = pd.Timestamp(start, tz="Europe/Istanbul") if start.tzinfo is None else pd.Timestamp(start)
        df = df[df.index >= start_tz]
    if end:
        end_tz = pd.Timestamp(end, tz="Europe/Istanbul") if end.tzinfo is None else pd.Timestamp(end)
        end_tz = end_tz.normalize() + pd.Timedelta(days=1) - pd.Timedelta(seconds=1)  # the whole end day
        df = df[df.index <= end_tz]
    return df


def get_history(
    symbol: str,
    period: str = "1mo",
    interval: str = "1d",
    start: datetime | None = None,
    end: datetime | None = None,
    exchange: str = "BIST",
) -> pd.DataFrame:
    """``TradingViewProvider.get_history`` over the shared connection (blocking; run it in a thread)."""
    provider = get_tradingview_provider()
    symbol = symbol.upper().replace(".IS", "").replace(".E", "")
    tv_symbol = f"{exchange}:{symbol}"
    timeframe = provider.TIMEFRAMES.get(interval, "1D")
    bars = provider._calculate_bars(period, interval, start, end)
    try:
        received = _client.fetch(tv_symbol, timeframe, bars)
    except _Unavailable as e:
        logger.info("tradingview_chart_fallback", symbol=tv_symbol, interval=interval, reason=str(e))
        return provider.get_history(symbol, period=period, interval=interval, start=start, end=end, exchange=exchange)
    return _history_frame(tv_symbol, received, start, end)
