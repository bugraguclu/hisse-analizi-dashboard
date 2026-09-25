"""Makro ekonomik veri API endpoint'leri.

Hata sözleşmesi: geçersiz döviz kodu / periyot → 400, TCMB bülteninde olmayan
kod ya da bilinmeyen piyasa göstergesi → 404, kaynağa ulaşılamıyor → 503, kaynak
verisi kullanılamaz → 502 (kısa Türkçe ``detail``). Ekonomik takvim kaynağı
boşsa hata değil ``available: false``.
"""

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Path, Query

from src.adapters.economic_calendar import get_economic_calendar
from src.adapters.macro import (
    get_fx_bulletin,
    get_fx_rates,
    get_inflation,
    get_policy_rate,
    get_tcmb_calendar,
    get_tcmb_rates,
)
from src.adapters.macro_markets import get_macro_indicators, get_market_history, get_market_snapshot
from src.adapters.utils import upstream_failure

macro_router = APIRouter(prefix="/macro", tags=["macro"])


def _respond(payload: Any) -> Any:
    failure = upstream_failure(payload)
    if failure is not None:
        status_code, detail = failure
        raise HTTPException(status_code=status_code, detail=detail)
    return payload


@macro_router.get("/tcmb")
async def tcmb_rates():
    """Güncel politika faizi ve faiz koridoru (gecelik, geç likidite)."""
    return _respond(await get_tcmb_rates())


@macro_router.get("/policy-rate")
async def policy_rate():
    """TCMB politika faizi (tarihe göre en son karar) + son 24 karar."""
    return _respond(await get_policy_rate())


@macro_router.get("/tcmb-calendar")
async def tcmb_calendar():
    """TCMB PPK toplantıları / özetleri, Enflasyon Raporu ve FİR tarihleri; türe göre sıradaki ve son olay."""
    return _respond(await get_tcmb_calendar())


@macro_router.get("/inflation")
async def inflation():
    """TÜFE ve ÜFE: en son dönem (yıllık / aylık ayrı) + geçmiş."""
    return _respond(await get_inflation())


@macro_router.get("/fx-bulletin")
async def fx_bulletin():
    """TCMB gösterge niteliğindeki günlük kur bülteni: tüm dövizler + önceki bültene göre değişim."""
    return _respond(await get_fx_bulletin())


@macro_router.get("/fx/{currency}")
async def fx_rates(currency: str = "USD"):
    """TCMB döviz kuru (1 birim). currency: USD, EUR, GBP, JPY, CHF, vb."""
    return _respond(await get_fx_rates(currency.strip().upper()))


@macro_router.get("/markets")
async def market_snapshot():
    """Tahvil getirileri (basit yıllık), döviz, altın/gümüş, Brent, DXY — son değer ve günlük değişim."""
    return _respond(await get_market_snapshot())


@macro_router.get("/markets/{key}/history")
async def market_history(
    key: Annotated[str, Path(min_length=2, max_length=20, pattern=r"^[A-Za-z0-9_]+$")],
    period: Annotated[str, Query(max_length=5, description="1ay, 3ay, 6ay, ytd, 1y, 2y, 5y")] = "1y",
):
    """Piyasa göstergesinin kapanış geçmişi (gerçek takvim penceresi) ve dönem değişimi."""
    return _respond(await get_market_history(key, period))


@macro_router.get("/indicators")
async def macro_indicators():
    """Büyüme, istihdam, dış denge, rezerv ve maliye göstergeleri (son iki gözlem, referans dönemi)."""
    return _respond(await get_macro_indicators())


@macro_router.get("/calendar")
async def economic_calendar(
    countries: Annotated[
        str | None,
        Query(max_length=100, description="Ülke kodları, virgülle (TR,US,EU,DE,GB,...) ya da 'all'. Varsayılan: TR,US"),
    ] = None,
    start: Annotated[
        str | None, Query(max_length=10, description="Pencere başı (dahil), YYYY-AA-GG. Varsayılan: geçen ayın 1'i")
    ] = None,
    end: Annotated[
        str | None, Query(max_length=10, description="Pencere sonu (dahil), YYYY-AA-GG. Varsayılan: gelecek ayın sonu")
    ] = None,
    importance: Annotated[
        str | None, Query(max_length=20, description="Önem: low, mid, high (virgülle birden fazla)")
    ] = None,
    tags: Annotated[
        str | None,
        Query(max_length=200, description="Konu etiketleri, virgülle: rates, inflation, labor, growth, surveys, ..."),
    ] = None,
    q: Annotated[
        str | None, Query(min_length=2, max_length=100, description="Olay / ülke adında arama (Türkçe karakter duyarsız)")
    ] = None,
):
    """Ekonomik takvim (TradingView; Türkçe adlar doviz.com'dan), zamana göre sıralı.

    Pencere varsayılan olarak geçen aydan gelecek aya kadardır (en fazla 124 gün);
    satırlarda gerçekleşen / beklenti / önceki değerler (``*_value`` + ``unit``/``scale``),
    İngilizce ve Türkçe ad (``title_en`` / ``title_tr``), konu etiketleri (``tags``) ve
    merkez bankası faiz kararı işareti (``key_event``) bulunur. ``window`` istenen gün
    aralığı, ``unavailable_months`` kaynağa ulaşılamayan aylardır.
    """
    return _respond(
        await get_economic_calendar(countries, start=start, end=end, importance=importance, tags=tags, q=q)
    )
