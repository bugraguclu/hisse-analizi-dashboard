"""Shared TradingView chart connection (src/adapters/tradingview_chart.py), against a fake socket."""

import json
import queue
import re
import threading
import time
from datetime import datetime

import pandas as pd
import pytest
from borsapy._providers.tradingview import get_tradingview_provider
from borsapy.exceptions import APIError

from src.adapters import price
from src.adapters import tradingview_chart as tvc
from src.adapters.utils import SymbolNotFoundError

DAY1, DAY2, DAY3 = (int(pd.Timestamp(f"2026-09-{day} 10:00", tz="Europe/Istanbul").timestamp()) for day in (21, 22, 23))
BARS = {
    "BIST:THYAO": [[DAY1, 300.0, 305.0, 298.0, 304.0, 1_000_000], [DAY2, 304.0, 310.0, 303.0, 309.5, 1_200_000]],
    # Indices come without a volume field.
    "BIST:XU100": [[DAY1, 10_000.0, 10_100.0, 9_950.0, 10_050.0], [DAY3, 10_050.0, 10_200.0, 10_000.0, 10_150.0]],
}
FRAME = re.compile(r"~m~(\d+)~m~")


def _packet(payload: dict | str) -> str:
    data = payload if isinstance(payload, str) else json.dumps(payload)
    return f"~m~{len(data)}~m~{data}"


def _decode(raw: str) -> list[dict | str]:
    out: list[dict | str] = []
    pos = 0
    while match := FRAME.match(raw, pos):
        start = match.end()
        body = raw[start : start + int(match.group(1))]
        out.append(body if body.startswith("~h~") else json.loads(body))
        pos = start + int(match.group(1))
    return out


class FakeSocket:
    """websocket.WebSocket stand-in: the reader thread gets whatever the fake server queues."""

    def __init__(self, server: "FakeServer") -> None:
        self.server = server
        self.inbox: queue.Queue[str | BaseException] = queue.Queue()
        self.sent: list[str] = []
        self.closed = False

    def settimeout(self, _timeout: float) -> None:
        pass

    def send(self, data: str) -> None:
        if self.closed:
            raise BrokenPipeError("socket closed")
        self.sent.append(data)
        self.server.on_send(self, data)

    def recv(self) -> str:
        item = self.inbox.get(timeout=5)
        if isinstance(item, BaseException):
            raise item
        return item

    def shutdown(self) -> None:
        self.closed = True
        self.inbox.put(ConnectionResetError("shutdown"))


class FakeServer:
    """Answers create_series like TradingView: bars + series_completed, or an error, or nothing."""

    def __init__(self, behaviour: dict[str, str] | None = None) -> None:
        self.behaviour = behaviour or {}  # tv symbol -> "silent" | "drop"
        self.sockets: list[FakeSocket] = []
        self.symbols: dict[str, str] = {}
        self.series: list[tuple[str, str, int]] = []
        self.lock = threading.Lock()

    def connect(self, url: str, header: dict[str, str], timeout: float) -> FakeSocket:
        assert url == tvc.WS_URL and header == {"Origin": tvc.ORIGIN}
        socket = FakeSocket(self)
        with self.lock:
            self.sockets.append(socket)
        return socket

    def on_send(self, socket: FakeSocket, raw: str) -> None:
        for packet in _decode(raw):
            if not isinstance(packet, dict):
                continue
            method, params = packet["m"], packet["p"]
            if method == "resolve_symbol":
                self.symbols[params[0]] = json.loads(params[2][1:])["symbol"]
            elif method == "create_series":
                session, timeframe, count = params[0], params[4], params[5]
                symbol = self.symbols[session]
                with self.lock:
                    self.series.append((symbol, timeframe, count))
                self.answer(socket, session, symbol)

    def answer(self, socket: FakeSocket, session: str, symbol: str) -> None:
        behaviour = self.behaviour.get(symbol)
        if behaviour == "silent":
            return
        if behaviour == "drop":
            socket.inbox.put(ConnectionResetError("reset by peer"))
            return
        if symbol not in BARS:
            socket.inbox.put(
                _packet({"m": "symbol_error", "p": [session, "ser_1", "invalid symbol"]})
                + _packet({"m": "series_error", "p": [session, "$prices", "s1", "resolve error"]})
            )
            return
        candles = [{"i": i, "v": values} for i, values in enumerate(BARS[symbol])]
        socket.inbox.put(
            _packet({"m": "timescale_update", "p": [session, {"$prices": {"s": candles}}]})
            + _packet({"m": "series_completed", "p": [session, "$prices", "streaming", "s1"]})
        )


@pytest.fixture
def server(monkeypatch):
    fake = FakeServer()
    monkeypatch.setattr("websocket.create_connection", fake.connect)
    monkeypatch.setattr(tvc, "_client", tvc._ChartClient())
    monkeypatch.setattr(tvc, "REQUEST_TIMEOUT", 0.5)
    return fake


@pytest.fixture
def one_shot(monkeypatch):
    """Records fallbacks to the provider's one-shot fetch."""
    calls: list[tuple[str, str, str]] = []

    def fake_get_history(symbol, period="1mo", interval="1d", start=None, end=None, exchange="BIST"):
        calls.append((symbol, interval, exchange))
        return pd.DataFrame({"Close": [1.0]})

    monkeypatch.setattr(get_tradingview_provider(), "get_history", fake_get_history)
    return calls


def test_history_frame_matches_the_provider_shape(server, one_shot):
    frame = tvc.get_history("thyao", period="1mo", interval="1d")

    assert list(frame.columns) == ["Open", "High", "Low", "Close", "Volume"]
    assert str(frame.index.tz) == "Europe/Istanbul"
    assert frame.index[0] == pd.Timestamp("2026-09-21 10:00", tz="Europe/Istanbul")
    assert frame["Close"].tolist() == [304.0, 309.5]
    assert frame["Volume"].tolist() == [1_000_000, 1_200_000]
    # Same timeframe and bar count as the provider would request.
    provider = get_tradingview_provider()
    assert server.series == [("BIST:THYAO", "1D", provider._calculate_bars("1mo", "1d", None, None))]
    assert one_shot == []


def test_candles_without_volume_get_zero_like_the_provider(server, one_shot):
    frame = tvc.get_history("XU100", period="5d", interval="15m")

    assert frame["Volume"].tolist() == [0.0, 0.0]
    assert server.series[0][:2] == ("BIST:XU100", "15")


def test_requests_share_one_connection(server, one_shot):
    tvc.get_history("THYAO", period="1mo", interval="1d")
    tvc.get_history("XU100", period="10y", interval="1wk")

    assert len(server.sockets) == 1
    assert [symbol for symbol, _, _ in server.series] == ["BIST:THYAO", "BIST:XU100"]
    sent = [packet for raw in server.sockets[0].sent for packet in _decode(raw) if isinstance(packet, dict)]
    assert sent[0] == {"m": "set_auth_token", "p": ["unauthorized_user_token"]}
    # Every chart session is deleted once answered.
    assert sum(packet["m"] == "chart_delete_session" for packet in sent) == 2


def test_concurrent_requests_multiplex_on_the_socket(server, one_shot):
    results: dict[str, pd.DataFrame] = {}

    def fetch(symbol: str) -> None:
        results[symbol] = tvc.get_history(symbol, period="1mo", interval="1d")

    threads = [threading.Thread(target=fetch, args=(symbol,)) for symbol in ["THYAO", "XU100"] * 3]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(server.sockets) == 1
    assert results["THYAO"]["Close"].iloc[-1] == 309.5
    assert results["XU100"]["Close"].iloc[-1] == 10_150.0
    assert one_shot == []


def test_heartbeats_are_echoed(server, one_shot):
    tvc.get_history("THYAO")
    socket = server.sockets[0]
    socket.inbox.put("~m~4~m~~h~7")
    for _ in range(100):
        if "~m~4~m~~h~7" in socket.sent:
            break
        time.sleep(0.01)
    assert "~m~4~m~~h~7" in socket.sent


def test_unknown_symbol_raises_the_provider_error_without_fallback(server, one_shot):
    with pytest.raises(APIError, match="invalid symbol") as excinfo:
        tvc.get_history("NOPE", period="1mo", interval="1d")

    assert one_shot == []
    # price maps it to a 404 exactly like the provider's own error.
    assert isinstance(price._history_error("NOPE", excinfo.value), SymbolNotFoundError)
    # The connection stays usable.
    assert tvc.get_history("THYAO")["Close"].iloc[-1] == 309.5
    assert len(server.sockets) == 1


def test_connect_failure_falls_back_to_one_shot_and_backs_off(monkeypatch, one_shot):
    attempts = 0

    def refuse(*_args, **_kwargs):
        nonlocal attempts
        attempts += 1
        raise OSError("network unreachable")

    monkeypatch.setattr("websocket.create_connection", refuse)
    monkeypatch.setattr(tvc, "_client", tvc._ChartClient())

    assert tvc.get_history("THYAO")["Close"].tolist() == [1.0]
    assert tvc.get_history("THYAO")["Close"].tolist() == [1.0]
    assert one_shot == [("THYAO", "1d", "BIST"), ("THYAO", "1d", "BIST")]
    assert attempts == 1  # the second request did not queue on another handshake


def test_dropped_connection_falls_back_then_reconnects(server, one_shot):
    server.behaviour["BIST:THYAO"] = "drop"
    assert tvc.get_history("THYAO")["Close"].tolist() == [1.0]
    assert one_shot == [("THYAO", "1d", "BIST")]

    server.behaviour.clear()
    assert tvc.get_history("THYAO")["Close"].iloc[-1] == 309.5
    assert len(server.sockets) == 2


def test_silent_connection_times_out_is_replaced_and_falls_back(server, one_shot):
    server.behaviour["BIST:THYAO"] = "silent"
    assert tvc.get_history("THYAO")["Close"].tolist() == [1.0]
    assert server.sockets[0].closed

    server.behaviour.clear()
    assert tvc.get_history("THYAO")["Close"].iloc[-1] == 309.5
    assert len(server.sockets) == 2


def test_start_trims_like_the_provider(server, one_shot):
    frame = tvc.get_history("XU100", interval="1d", start=datetime(2026, 9, 22))

    assert frame.index.tolist() == [pd.Timestamp("2026-09-23 10:00", tz="Europe/Istanbul")]
