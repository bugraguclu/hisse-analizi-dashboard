"""İş Yatırım price endpoints (HisseTekil / OneEndeks) with a mocked HTTP transport."""

from datetime import date

import httpx
import pytest

from src.adapters import isyatirim_prices as isy
from src.adapters.utils import MarketDataError, SymbolNotFoundError

HISTORY_ROW = {
    "HGDG_HS_KODU": "GARAN", "HGDG_TARIH": "22-09-2026", "HGDG_KAPANIS": 133.9, "HGDG_AOF": 134.2,
    "HGDG_MIN": 132.5, "HGDG_MAX": 135.9, "HGDG_HACIM": 3.52e9, "SERMAYE": 4.2e9, "HG_KAPANIS": 133.9,
    "HG_AOF": 134.2, "HG_MIN": 132.5, "HG_MAX": 135.9, "HG_HACIM": 3.52e9, "PD": 5.62e11, "HAO_PD": 7.9e10,
    "DOLAR_BAZLI_FIYAT": 2.75, "END_DEGER": 13198.84,
}


def _client(monkeypatch, handler):
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(isy, "get_http_client", lambda: client)
    monkeypatch.setattr(isy.asyncio, "sleep", _no_sleep)
    return client


async def _no_sleep(seconds):
    return None


async def test_history_is_parsed_sorted_and_deduplicated(monkeypatch):
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        older = {**HISTORY_ROW, "HGDG_TARIH": "21-09-2026", "HG_KAPANIS": 133.1}
        return httpx.Response(200, json={"ok": True, "value": [HISTORY_ROW, older, HISTORY_ROW, {"HGDG_TARIH": "x"}]})

    _client(monkeypatch, handler)
    rows = await isy.fetch_daily_history("GARAN", date(2026, 9, 15), date(2026, 9, 22))

    assert [r.bar_date for r in rows] == [date(2026, 9, 21), date(2026, 9, 22)]
    assert rows[1].turnover == 3.52e9 and rows[1].vwap == 134.2 and rows[1].capital == 4.2e9
    params = seen[0].url.params
    assert (params["hisse"], params["startdate"], params["enddate"]) == ("GARAN", "15-09-2026", "22-09-2026")


async def test_transport_errors_are_retried_once_then_reported_as_503(monkeypatch):
    attempts = []

    def flaky(request):
        attempts.append(1)
        if len(attempts) == 1:
            raise httpx.ReadTimeout("stalled")
        return httpx.Response(200, json={"ok": True, "value": [HISTORY_ROW]})

    _client(monkeypatch, flaky)
    assert len(await isy.fetch_daily_history("GARAN", date(2026, 9, 22), date(2026, 9, 22))) == 1
    assert len(attempts) == 2

    def down(request):
        raise httpx.ConnectError("refused")

    _client(monkeypatch, down)
    with pytest.raises(MarketDataError) as exc_info:
        await isy.fetch_daily_history("GARAN", date(2026, 9, 22), date(2026, 9, 22))
    assert exc_info.value.status_code == 503 and "İş Yatırım" in exc_info.value.message


@pytest.mark.parametrize(
    ("response", "status"),
    [
        (httpx.Response(429), 503),
        (httpx.Response(403), 502),
        (httpx.Response(200, text="<html>blocked</html>"), 503),  # WAF page
        (httpx.Response(200, json={"ok": False, "value": None}), 502),
    ],
)
async def test_bad_responses_map_to_safe_errors(monkeypatch, response, status):
    _client(monkeypatch, lambda request: response)
    with pytest.raises(MarketDataError) as exc_info:
        await isy.fetch_daily_history("GARAN", date(2026, 9, 22), date(2026, 9, 22))
    assert exc_info.value.status_code == status


async def test_quote_units_and_unknown_symbols(monkeypatch):
    def handler(request):
        symbol = request.url.params["endeks"]
        if symbol == "ZZZZZ":
            return httpx.Response(200, json={"error": {"code": "EINVAL", "message": "Symbols ZZZZZ are not allowed!"}})
        return httpx.Response(200, json=[{"updateDate": "2026-09-23T18:10:12.000+03", "last": 17713.37,
                                          "dayClose": 17613.11, "quantity": 5850137659, "volume": 68585390542.21,
                                          "open": 17432.37, "high": 17875.94, "low": 17432.37, "symbol": "XUSIN"}])

    _client(monkeypatch, handler)
    quote = await isy.fetch_quote("XUSIN")
    assert quote["volume"] == 5850137659 and quote["turnover"] == 68585390542.21
    assert quote["bid"] is None and quote["updated_at"] == "2026-09-23T18:10:12+03:00"
    with pytest.raises(SymbolNotFoundError):
        await isy.fetch_quote("ZZZZZ")

    quotes = await isy.fetch_isyatirim_quotes(["XUSIN", "ZZZZZ", "XUSIN"])
    assert list(quotes) == ["XUSIN"]
    assert quotes["XUSIN"]["type"] == "index" and quotes["XUSIN"]["source"] == "isyatirim"
    assert quotes["XUSIN"]["session_date"] == date(2026, 9, 23) and quotes["XUSIN"]["delay_seconds"] == 900
