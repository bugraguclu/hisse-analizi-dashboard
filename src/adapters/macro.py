"""Makro ekonomik veri adaptoru — TCMB, enflasyon, doviz, ekonomik takvim."""

import asyncio
from datetime import date, datetime, timedelta
from xml.etree import ElementTree

import structlog

from src.adapters.utils import (
    TTL_MACRO,
    cached,
    df_to_records,
    get_http_client,
    run_sync,
    safe_serialize,
)

logger = structlog.get_logger(__name__)

TCMB_POLICY_URL = (
    "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/"
    "Temel+Faaliyetler/Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo"
)
TCMB_FX_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"


def _date_string(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "date"):
        return str(value.date())
    return str(value).split("T")[0].split(" ")[0]


def _latest_rate_record(history, rate_type: str) -> dict | None:
    """Return the latest effective TCMB rate regardless of source row order."""
    if history is None or not hasattr(history, "sort_index") or len(history) == 0:
        return None
    ordered = history.sort_index()
    latest = ordered.iloc[-1]
    return {
        "type": rate_type,
        "date": _date_string(ordered.index[-1]),
        "borrowing": float(latest["borrowing"]) if latest.get("borrowing") is not None else None,
        "lending": float(latest["lending"]) if latest.get("lending") is not None else None,
    }


async def _tcmb_rate_history(tcmb, rate_type: str):
    return await run_sync(lambda: tcmb.history(rate_type))


@cached(TTL_MACRO, "macro")
async def get_tcmb_rates() -> dict:
    try:
        import borsapy as bp

        tcmb = await run_sync(bp.TCMB)
        rate_types = ("policy", "overnight", "late_liquidity")
        histories = await asyncio.gather(*(_tcmb_rate_history(tcmb, kind) for kind in rate_types))
        data = [
            record
            for record in (_latest_rate_record(history, kind) for history, kind in zip(histories, rate_types))
            if record is not None
        ]
        if not data:
            return {"source": "TCMB", "source_url": TCMB_POLICY_URL, "data": {}, "error": "TCMB faiz verisi boş"}
        return {"source": "TCMB", "source_url": TCMB_POLICY_URL, "data": data}
    except Exception as e:
        logger.error("macro_tcmb_error", error=str(e))
        return {"source": "TCMB", "data": {}, "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_policy_rate() -> dict:
    try:
        import borsapy as bp
        tcmb = await run_sync(bp.TCMB)
        history = await _tcmb_rate_history(tcmb, "policy")
        if history is not None and len(history) > 0:
            history = history.sort_index()
            latest = history.iloc[-1]
            return {
                "source": "TCMB",
                "source_url": TCMB_POLICY_URL,
                "policy_rate": {
                    "value": float(latest["lending"]),
                    "date": _date_string(history.index[-1]),
                },
                "history": df_to_records(history.tail(24)),
            }
        return {
            "source": "TCMB",
            "source_url": TCMB_POLICY_URL,
            "policy_rate": {},
            "error": "TCMB politika faizi verisi boş",
        }
    except Exception as e:
        logger.error("macro_policy_rate_error", error=str(e))
        return {"source": "TCMB", "policy_rate": {}, "error": str(e)}


@cached(TTL_MACRO, "macro")
async def get_inflation() -> dict:
    try:
        import borsapy as bp
        inf = await run_sync(bp.Inflation)
        latest = await run_sync(inf.latest)
        tufe_df = await run_sync(inf.tufe)
        return {
            "source": "TÜİK (TCMB veri tablosu)",
            "source_url": "https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/istatistikler/enflasyon+verileri",
            "as_of": latest.get("date") if isinstance(latest, dict) else None,
            "latest": latest if isinstance(latest, dict) else safe_serialize(latest),
            "tufe_history": df_to_records(tufe_df),
        }
    except Exception as e:
        logger.error("macro_inflation_error", error=str(e))
        return {"source": "TÜİK (TCMB veri tablosu)", "latest": {}, "tufe_history": [], "error": str(e)}


def _parse_tcmb_fx_xml(xml_text: str) -> dict:
    """Parse a TCMB daily bulletin and normalize quotes to one currency unit."""
    root = ElementTree.fromstring(xml_text)
    raw_date = root.attrib.get("Tarih") or root.attrib.get("Date")
    bulletin_date = None
    for fmt in ("%d.%m.%Y", "%m/%d/%Y"):
        try:
            bulletin_date = datetime.strptime(raw_date or "", fmt).date().isoformat()
            break
        except ValueError:
            continue
    if bulletin_date is None:
        raise ValueError("TCMB kur bülteni tarihi okunamadı")

    rates: dict[str, dict] = {}
    for node in root.findall("Currency"):
        code = (node.attrib.get("CurrencyCode") or node.attrib.get("Kod") or "").upper()
        if not code:
            continue
        unit_text = node.findtext("Unit") or "1"
        try:
            unit = int(unit_text)
        except ValueError:
            unit = 1
        divisor = unit if unit > 0 else 1

        def number(tag: str, current_node=node, current_divisor=divisor) -> float | None:
            text = (current_node.findtext(tag) or "").strip().replace(",", ".")
            if not text:
                return None
            return float(text) / current_divisor

        rates[code] = {
            "currency": code,
            "unit": 1,
            "quoted_unit": unit,
            "name": (node.findtext("CurrencyName") or node.findtext("Isim") or code).strip(),
            "forex_buying": number("ForexBuying"),
            "forex_selling": number("ForexSelling"),
            "banknote_buying": number("BanknoteBuying"),
            "banknote_selling": number("BanknoteSelling"),
        }
    return {"date": bulletin_date, "rates": rates}


async def _fetch_tcmb_fx_bulletin(url: str) -> dict:
    response = await get_http_client().get(url)
    response.raise_for_status()
    return _parse_tcmb_fx_xml(response.text)


@cached(TTL_MACRO, "macro_fx_bulletins")
async def _get_tcmb_fx_bulletins() -> dict:
    current = await _fetch_tcmb_fx_bulletin(TCMB_FX_TODAY_URL)
    current_date = date.fromisoformat(current["date"])
    previous = None
    for offset in range(1, 11):
        candidate = current_date - timedelta(days=offset)
        url = f"https://www.tcmb.gov.tr/kurlar/{candidate:%Y%m}/{candidate:%d%m%Y}.xml"
        try:
            previous = await _fetch_tcmb_fx_bulletin(url)
            break
        except Exception:
            continue
    return {"current": current, "previous": previous}


async def _get_fx_rates_fallback(currency: str, upstream_error: Exception) -> dict:
    """Use borsapy market spot data only when the official bulletin is unavailable."""
    try:
        import borsapy as bp

        fx = await run_sync(lambda: bp.FX(currency))
        info = await run_sync(lambda: fx.info if hasattr(fx, "info") else None)
        history = await run_sync(lambda: fx.history(period="1mo") if hasattr(fx, "history") else None)
        return {
            "currency": currency,
            "source": "TradingView (borsapy fallback)",
            "warning": f"TCMB günlük kuru alınamadı: {upstream_error}",
            "info": info if isinstance(info, dict) else safe_serialize(info) if info else {},
            "history": df_to_records(history) if history is not None else [],
        }
    except Exception as fallback_error:
        logger.error(
            "macro_fx_error",
            currency=currency,
            tcmb_error=str(upstream_error),
            fallback_error=str(fallback_error),
        )
        return {"currency": currency, "info": {}, "history": [], "error": str(fallback_error)}


@cached(TTL_MACRO, "macro")
async def get_fx_rates(currency: str = "USD") -> dict:
    try:
        bulletins = await _get_tcmb_fx_bulletins()
        current = bulletins["current"]
        previous = bulletins.get("previous")
        current_rate = current["rates"].get(currency)
        if current_rate is None or current_rate.get("forex_selling") is None:
            raise ValueError(f"{currency} TCMB günlük kur bülteninde bulunamadı")

        history = []
        if previous:
            previous_rate = previous["rates"].get(currency)
            if previous_rate and previous_rate.get("forex_selling") is not None:
                history.append({"Date": previous["date"], "Close": previous_rate["forex_selling"]})
        history.append({"Date": current["date"], "Close": current_rate["forex_selling"]})

        return {
            "currency": currency,
            "source": "TCMB",
            "source_url": "https://www.tcmb.gov.tr/kurlar/kurlar_tr.html",
            "rate_type": "forex_selling",
            "as_of": current["date"],
            "info": {
                **current_rate,
                "last": current_rate["forex_selling"],
                "close": current_rate["forex_selling"],
                "update_time": current["date"],
            },
            "history": history,
        }
    except Exception as e:
        logger.warning("macro_fx_tcmb_error", currency=currency, error=str(e))
        return await _get_fx_rates_fallback(currency, e)


async def _fetch_calendar_from_borsapy() -> list:
    """Try borsapy economic_calendar first."""
    import borsapy as bp
    cal = await run_sync(bp.economic_calendar)
    data = df_to_records(cal) if hasattr(cal, "iterrows") else safe_serialize(cal)
    if isinstance(data, list) and len(data) > 0:
        return data
    return []


async def _fetch_calendar_from_investpy() -> list:
    """Fallback: try investpy economic calendar."""
    try:
        import investpy
        today = datetime.now()
        from_date = today.strftime("%d/%m/%Y")
        to_date = (today + timedelta(days=30)).strftime("%d/%m/%Y")
        df = await run_sync(
            lambda: investpy.economic_calendar(
                countries=["turkey"],
                from_date=from_date,
                to_date=to_date,
            )
        )
        return df_to_records(df) if hasattr(df, "iterrows") else []
    except Exception as e:
        logger.warning("investpy_calendar_fallback_error", error=str(e))
        return []


@cached(TTL_MACRO, "macro")
async def get_economic_calendar() -> dict:
    try:
        data = await _fetch_calendar_from_borsapy()
        if data:
            return {"calendar": data, "source": "TradingView economic calendar (borsapy)"}
    except Exception as e:
        logger.warning("borsapy_calendar_error", error=str(e))

    try:
        data = await _fetch_calendar_from_investpy()
        if data:
            return {"calendar": data, "source": "Investing.com (investpy)"}
    except Exception as e:
        logger.warning("investpy_calendar_error", error=str(e))

    return {
        "calendar": [],
        "source": None,
        "error": "Ekonomik takvim sağlayıcılarından doğrulanmış veri alınamadı",
    }
