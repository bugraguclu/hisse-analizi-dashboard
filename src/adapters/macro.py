"""Makro ekonomik veri adaptörü — TCMB faizleri, enflasyon, döviz kurları, ekonomik takvim.

Kaynaklar ve kurallar:

- **Politika faizi / koridor**: TCMB faiz sayfaları (borsapy ``TCMB().history``).
  Güncel değer = tarihe göre EN SON satır (borsapy'nin ``policy_rate`` /
  ``rates`` kısayolları 2010 satırını döndürüyor). 0 olan oranlar (ör. geç
  likidite penceresinde borç alma) "uygulanmıyor" demektir → ``None``.
  TCMB tablosu yalnızca faizin DEĞİŞTİĞİ günleri (kararın yürürlük tarihi,
  toplantının ertesi iş günü) listeler; son toplantı tarihi TCMB takviminden gelir.
- **TCMB takvimi**: TCMB "Takvim" sayfasındaki PPK karar / özet, Enflasyon
  Raporu ve Finansal İstikrar Raporu tarihleri. Faiz kararı 14:00'te açıklanır.
- **Enflasyon**: TÜFE ve ÜFE tabloları; son dönem tarihe göre seçilir, yıllık ve
  aylık değişim ayrı alanlardır. ÜFE alınamazsa TÜFE yine döner.
- **Döviz**: TCMB gösterge niteliğindeki günlük kur bülteni (``today.xml`` +
  geçmiş günlük bültenler). Birim bazlı kotasyonlar (JPY 100 birim gibi) 1
  birime normalize edilir; alış/satış ayrı alanlardır. TCMB'ye ulaşılamazsa
  TradingView piyasa kuru (borsapy) yedek olarak kullanılır.
- **Ekonomik takvim**: ayrı modülde — ``src/adapters/economic_calendar.py``
  (doviz.com, kendi HTML ayrıştırıcımızla; borsapy'nin tarih hatasını düzeltir).

Geçmiş serileri tarih sırasına göre döner: ``history`` (politika faizi, döviz)
eskiden yeniye, ``tufe_history`` yeniden eskiye (mevcut sözleşme).
"""

import asyncio
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timedelta
from typing import Any
from xml.etree import ElementTree
from zoneinfo import ZoneInfo

import httpx
import structlog
from bs4 import BeautifulSoup

from src.adapters.utils import (
    InvalidInputError,
    MarketDataError,
    cached,
    df_to_records,
    error_payload,
    get_http_client,
    run_sync,
    safe_serialize,
    sanitize_data,
)

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

TTL_RATES = 1800            # TCMB rate decisions (a few per year)
TTL_INFLATION = 3600        # monthly TÜİK release
TTL_FX_TODAY = 600          # today's TCMB bulletin (published once a business day)
TTL_FX_ARCHIVE = 24 * 3600  # past bulletins never change
TTL_TCMB_CALENDAR = 6 * 3600  # meeting/report schedule, published once a year

TCMB_POLICY_URL = (
    "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/"
    "Temel+Faaliyetler/Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo"
)
TCMB_INFLATION_URL = (
    "https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/istatistikler/enflasyon+verileri"
)
TCMB_FX_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"
TCMB_FX_PAGE_URL = "https://www.tcmb.gov.tr/kurlar/kurlar_tr.html"
_FX_HISTORY_DAYS = 31
_FX_ARCHIVE_CONCURRENCY = 6
_CURRENCY_RE = re.compile(r"^[A-Z]{3}$")

_MSG_TCMB = "TCMB faiz verisi şu anda alınamıyor"
_MSG_INFLATION = "Enflasyon verisi şu anda alınamıyor"
_MSG_FX = "Döviz kuru şu anda alınamıyor"


def _failure_status(exc: BaseException) -> int:
    if isinstance(exc, MarketDataError):
        return exc.status_code
    if isinstance(exc, (httpx.HTTPError, TimeoutError, ConnectionError)):
        return 503
    return 502


def _failure(exc: BaseException, message: str, event: str, **payload: Any) -> dict[str, Any]:
    logger.error(event, error=f"{type(exc).__name__}: {exc}")
    result = error_payload(exc, message)
    result["error_status"] = _failure_status(exc)
    return {**payload, **result}


def _date_string(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (datetime, date)):
        return value.date().isoformat() if isinstance(value, datetime) else value.isoformat()
    if hasattr(value, "date") and callable(value.date):
        try:
            return str(value.date())
        except (TypeError, ValueError):
            pass
    return str(value).split("T")[0].split(" ")[0] or None


def _rate(value: Any) -> float | None:
    """TCMB rate as float; missing, non-numeric and non-positive (not applicable) → ``None``."""
    number = sanitize_data(value)
    try:
        rate = float(number) if number is not None else None
    except (TypeError, ValueError):
        return None
    return rate if rate is not None and rate > 0 else None


# ---------------------------------------------------------------------------
# TCMB interest rates
# ---------------------------------------------------------------------------

def _sorted_history(history: Any) -> Any:
    if history is None or not hasattr(history, "sort_index") or len(history) == 0:
        return None
    return history.sort_index()


def _latest_rate_record(history: Any, rate_type: str) -> dict | None:
    """Latest effective TCMB rate by date, regardless of the source row order."""
    ordered = _sorted_history(history)
    if ordered is None:
        return None
    latest = ordered.iloc[-1]
    return {
        "type": rate_type,
        "date": _date_string(ordered.index[-1]),
        "borrowing": _rate(latest.get("borrowing")),
        "lending": _rate(latest.get("lending")),
    }


@cached(TTL_RATES, "macro_tcmb_history")
async def _tcmb_rate_history(rate_type: str) -> Any:
    import borsapy as bp

    tcmb = await run_sync(bp.TCMB)
    history = await run_sync(tcmb.history, rate_type)
    if history is None or len(history) == 0:
        raise ValueError(f"TCMB {rate_type} geçmişi boş")
    return history


@cached(TTL_RATES, "macro")
async def get_tcmb_rates() -> dict:
    """Güncel politika faizi ve faiz koridoru (gecelik, geç likidite penceresi)."""
    rate_types = ("policy", "overnight", "late_liquidity")
    try:
        results = await asyncio.gather(*(_tcmb_rate_history(kind) for kind in rate_types), return_exceptions=True)
        data = []
        for kind, history in zip(rate_types, results):
            if isinstance(history, BaseException):
                logger.warning("macro_tcmb_rate_failed", rate_type=kind, error=f"{type(history).__name__}: {history}")
                continue
            record = _latest_rate_record(history, kind)
            if record is not None:
                data.append(record)
        if not data:
            raise MarketDataError(_MSG_TCMB, status_code=503)
        dates = [d["date"] for d in data if d.get("date")]
        return {
            "source": "TCMB",
            "source_url": TCMB_POLICY_URL,
            "as_of": max(dates) if dates else None,
            "data": data,
        }
    except Exception as e:
        return _failure(e, _MSG_TCMB, "macro_tcmb_error", source="TCMB", data=[])


def _rate_changes(ordered: Any) -> list[dict[str, Any]]:
    """Every policy-rate change (ascending) with the move in basis points."""
    changes: list[dict[str, Any]] = []
    previous: float | None = None
    for day, lending in zip(ordered.index, ordered["lending"]):
        rate = _rate(lending)
        day_text = _date_string(day)
        if rate is None or not day_text:
            continue
        changes.append(
            {
                "date": day_text,
                "rate": rate,
                "previous": previous,
                "change_bp": round((rate - previous) * 100) if previous is not None else None,
            }
        )
        previous = rate
    return changes


@cached(TTL_RATES, "macro")
async def get_policy_rate() -> dict:
    """TCMB politika faizi (1 hafta repo): güncel değer + son 24 karar (eskiden yeniye).

    ``policy_rate.date`` son DEĞİŞİKLİĞİN yürürlük tarihidir (son toplantı değil);
    ``changes`` tüm değişiklikleri baz puan farkıyla verir.
    """
    try:
        ordered = _sorted_history(await _tcmb_rate_history("policy"))
        if ordered is None:
            raise MarketDataError(_MSG_TCMB, status_code=502)
        latest = _latest_rate_record(ordered, "policy") or {}
        value = latest.get("lending")
        if value is None:
            raise MarketDataError(_MSG_TCMB, status_code=502)
        history = [
            {**record, "borrowing": _rate(record.get("borrowing")), "lending": _rate(record.get("lending"))}
            for record in df_to_records(ordered.tail(24))
        ]
        changes = _rate_changes(ordered)
        return {
            "source": "TCMB",
            "source_url": TCMB_POLICY_URL,
            "as_of": latest.get("date"),
            "policy_rate": {"value": value, "date": latest.get("date")},
            "history": history,
            # add-only
            "changes": changes,
            "last_change": changes[-1] if changes else None,
        }
    except Exception as e:
        return _failure(e, _MSG_TCMB, "macro_policy_rate_error", source="TCMB", policy_rate={}, history=[])


# ---------------------------------------------------------------------------
# TCMB calendar (MPC meetings and reports)
# ---------------------------------------------------------------------------

TCMB_CALENDAR_URL = "https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/duyurular/takvim"
MPC_DECISION_TIME = "14:00"  # rate decisions are announced at 14:00 Istanbul time
_MSG_TCMB_CALENDAR = "TCMB takvimi şu anda alınamıyor"

_TR_MONTHS = {
    "ocak": 1, "şubat": 2, "mart": 3, "nisan": 4, "mayıs": 5, "haziran": 6,
    "temmuz": 7, "ağustos": 8, "eylül": 9, "ekim": 10, "kasım": 11, "aralık": 12,
}
# Column header keyword → event type (matched on the Turkish-lowercased header).
_CALENDAR_COLUMNS = (
    ("toplantı kararı", "mpc_decision"),
    ("toplantı özeti", "mpc_summary"),
    ("enflasyon raporu", "inflation_report"),
    ("finansal istikrar", "financial_stability_report"),
)
_TR_DATE_RE = re.compile(r"(\d{1,2})\s+([^\W\d_]+)\s+(\d{4})")


def _tr_lower(text: str) -> str:
    return text.replace("I", "ı").replace("İ", "i").lower()


def _parse_tr_date(text: str) -> str | None:
    """``"22 Ekim 2026"`` → ``"2026-10-22"``; anything else → ``None``."""
    match = _TR_DATE_RE.search(text or "")
    if not match:
        return None
    month = _TR_MONTHS.get(_tr_lower(match.group(2)))
    if month is None:
        return None
    try:
        return date(int(match.group(3)), month, int(match.group(1))).isoformat()
    except ValueError:
        return None


def _parse_tcmb_calendar(html: str) -> list[dict[str, Any]]:
    """Events of the TCMB "PPK toplantıları ve rapor takvimi" table, sorted by date."""
    soup = BeautifulSoup(html, "lxml")
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        if not rows:
            continue
        headers = [_tr_lower(cell.get_text(" ", strip=True)) for cell in rows[0].find_all(["th", "td"])]
        kinds = [next((kind for needle, kind in _CALENDAR_COLUMNS if needle in header), None) for header in headers]
        if "mpc_decision" not in kinds:
            continue
        events = []
        for row in rows[1:]:
            for kind, cell in zip(kinds, row.find_all(["td", "th"])):
                day = _parse_tr_date(cell.get_text(" ", strip=True)) if kind else None
                if kind and day:
                    event: dict[str, Any] = {"type": kind, "date": day}
                    if kind == "mpc_decision":
                        event["time"] = MPC_DECISION_TIME
                    events.append(event)
        if events:
            return sorted(events, key=lambda e: (e["date"], e["type"]))
    raise MarketDataError(_MSG_TCMB_CALENDAR, status_code=502)


def _calendar_status(events: Sequence[Mapping[str, Any]], now: datetime) -> tuple[dict, dict]:
    """``(next, last)`` event per type. A decision day counts as past from 14:00 on."""
    current = now.astimezone(ISTANBUL_TZ)
    upcoming: dict[str, Any] = {}
    past: dict[str, Any] = {}
    for event in events:
        day = date.fromisoformat(event["date"])
        if event.get("time"):
            hour, minute = (int(part) for part in str(event["time"]).split(":"))
            is_past = current >= datetime(day.year, day.month, day.day, hour, minute, tzinfo=ISTANBUL_TZ)
        else:
            is_past = current.date() > day
        if is_past:
            past[event["type"]] = dict(event)
        elif event["type"] not in upcoming:
            upcoming[event["type"]] = dict(event)
    return upcoming, past


@cached(TTL_TCMB_CALENDAR, "macro_tcmb_calendar")
async def _fetch_tcmb_calendar() -> list[dict[str, Any]]:
    response = await get_http_client().get(TCMB_CALENDAR_URL)
    response.raise_for_status()
    return _parse_tcmb_calendar(response.text)


async def get_tcmb_calendar() -> dict:
    """TCMB PPK toplantıları, PPK özetleri, Enflasyon Raporu ve FİR tarihleri + her türün sıradaki/son olayı."""
    try:
        events = await _fetch_tcmb_calendar()
        upcoming, past = _calendar_status(events, datetime.now(ISTANBUL_TZ))
        return {
            "source": "TCMB",
            "source_url": TCMB_CALENDAR_URL,
            "events": events,
            "next": upcoming,
            "last": past,
        }
    except Exception as e:
        return _failure(e, _MSG_TCMB_CALENDAR, "macro_tcmb_calendar_error", source="TCMB", events=[])


# ---------------------------------------------------------------------------
# Inflation
# ---------------------------------------------------------------------------

def _inflation_payload(records: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    """Latest period by date + newest-first history from TÜFE records."""
    rows = []
    for record in records:
        day = _date_string(record.get("Date"))
        if not day:
            continue
        rows.append(
            {
                "Date": record.get("Date"),
                "YearMonth": record.get("YearMonth"),
                "YearlyInflation": sanitize_data(record.get("YearlyInflation")),
                "MonthlyInflation": sanitize_data(record.get("MonthlyInflation")),
                "_day": day,
            }
        )
    rows.sort(key=lambda r: r["_day"], reverse=True)
    if not rows:
        raise MarketDataError(_MSG_INFLATION, status_code=502)
    top = rows[0]
    latest = {
        "date": top["_day"],
        "year_month": top["YearMonth"],
        "yearly_inflation": top["YearlyInflation"],
        "monthly_inflation": top["MonthlyInflation"],
        "type": "TUFE",
    }
    history = [{k: v for k, v in row.items() if k != "_day"} for row in rows]
    return {"as_of": top["_day"], "latest": latest, "tufe_history": history}


async def _ufe_fields(inflation: Any) -> dict[str, Any]:
    """ÜFE (producer prices) in the TÜFE shape; a failure here must not hide TÜFE."""
    try:
        ufe_df = await run_sync(inflation.ufe)
        payload = _inflation_payload(df_to_records(ufe_df))
    except Exception as e:
        logger.warning("macro_ufe_unavailable", error=f"{type(e).__name__}: {e}")
        return {"ufe_latest": None, "ufe_history": []}
    return {"ufe_latest": {**payload["latest"], "type": "UFE"}, "ufe_history": payload["tufe_history"]}


@cached(TTL_INFLATION, "macro")
async def get_inflation() -> dict:
    """TÜFE ve ÜFE: en son dönem (yıllık ve aylık ayrı) + geçmiş (yeniden eskiye)."""
    source = "TÜİK (TCMB veri tablosu)"
    try:
        import borsapy as bp

        inflation = await run_sync(bp.Inflation)
        tufe_df = await run_sync(inflation.tufe)
        payload = _inflation_payload(df_to_records(tufe_df))
        # add-only: ufe_latest / ufe_history
        return {"source": source, "source_url": TCMB_INFLATION_URL, **payload, **await _ufe_fields(inflation)}
    except Exception as e:
        return _failure(e, _MSG_INFLATION, "macro_inflation_error", source=source, latest={}, tufe_history=[])


# ---------------------------------------------------------------------------
# FX (TCMB daily bulletin)
# ---------------------------------------------------------------------------

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
        unit_text = (node.findtext("Unit") or "1").strip()
        try:
            unit = int(unit_text)
        except ValueError:
            unit = 1
        divisor = unit if unit > 0 else 1

        def number(tag: str, current_node: ElementTree.Element = node, current_divisor: int = divisor) -> float | None:
            text = (current_node.findtext(tag) or "").strip().replace(",", ".")
            if not text:
                return None
            try:
                value = float(text) / current_divisor
            except ValueError:
                return None
            return round(value, 6) if value > 0 else None

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


@cached(TTL_FX_TODAY, "macro_fx_today")
async def _get_tcmb_fx_today() -> dict:
    return await _fetch_tcmb_fx_bulletin(TCMB_FX_TODAY_URL)


@cached(TTL_FX_ARCHIVE, "macro_fx_archive")
async def _get_tcmb_fx_archive(day: str) -> dict:
    """Bulletin for ``day`` (ISO date). Weekends/holidays → ``{"date": day, "rates": {}}`` (cached)."""
    d = date.fromisoformat(day)
    url = f"https://www.tcmb.gov.tr/kurlar/{d:%Y%m}/{d:%d%m%Y}.xml"
    response = await get_http_client().get(url)
    if response.status_code == 404:
        return {"date": day, "rates": {}, "missing": True}
    response.raise_for_status()
    return _parse_tcmb_fx_xml(response.text)


async def _get_tcmb_fx_bulletins(days: int = _FX_HISTORY_DAYS) -> dict:
    """Today's bulletin plus the published bulletins of the previous ``days`` days (ascending)."""
    current = await _get_tcmb_fx_today()
    current_date = date.fromisoformat(current["date"])
    semaphore = asyncio.Semaphore(_FX_ARCHIVE_CONCURRENCY)

    async def one(day: date) -> dict | None:
        async with semaphore:
            try:
                return await _get_tcmb_fx_archive(day.isoformat())
            except Exception as e:
                logger.info("macro_fx_archive_unavailable", day=day.isoformat(), error=type(e).__name__)
                return None

    archive = await asyncio.gather(*(one(current_date - timedelta(days=offset)) for offset in range(1, days + 1)))
    bulletins = [b for b in archive if b and b.get("rates") and b.get("date") != current["date"]]
    bulletins.sort(key=lambda b: b["date"])
    return {"current": current, "history": [*bulletins, current]}


async def _get_fx_rates_fallback(currency: str) -> dict:
    """TradingView market rate (borsapy) when the official bulletin is unreachable."""
    try:
        import borsapy as bp

        fx = await run_sync(lambda: bp.FX(currency))
        info = await run_sync(lambda: fx.info if hasattr(fx, "info") else None)
        history = await run_sync(lambda: fx.history(period="1mo") if hasattr(fx, "history") else None)
        info_dict = info if isinstance(info, dict) else safe_serialize(info) if info else {}
        return {
            "currency": currency,
            "source": "TradingView (borsapy yedek)",
            "warning": "TCMB günlük kur bülteni alınamadı; piyasa kuru gösteriliyor.",
            "info": sanitize_data(info_dict),
            "history": df_to_records(history) if history is not None else [],
        }
    except Exception as fallback_error:
        return _failure(fallback_error, _MSG_FX, "macro_fx_error", currency=currency, info={}, history=[])


def _fx_payload(currency: str, bulletins: Mapping[str, Any]) -> dict:
    current = bulletins["current"]
    current_rate = current["rates"].get(currency)
    if current_rate is None or current_rate.get("forex_selling") is None:
        raise MarketDataError(f"Desteklenmeyen döviz kodu: {currency}", status_code=404)
    history = []
    for bulletin in bulletins.get("history", []):
        rate = (bulletin.get("rates") or {}).get(currency) or {}
        if rate.get("forex_selling") is not None:
            history.append({"Date": bulletin["date"], "Close": rate["forex_selling"]})
    last = current_rate["forex_selling"]
    previous = history[-2]["Close"] if len(history) >= 2 else None
    change = round(last - previous, 6) if previous is not None else None
    return {
        "currency": currency,
        "source": "TCMB",
        "source_url": TCMB_FX_PAGE_URL,
        "rate_type": "forex_selling",
        "as_of": current["date"],
        "info": {
            **current_rate,
            "last": last,
            "close": last,
            "update_time": current["date"],
            # add-only: change vs the previous published bulletin
            "previous_close": previous,
            "change": change,
            "change_percent": round(change / previous * 100, 4) if change is not None and previous else None,
        },
        "history": history,
    }


@cached(TTL_FX_TODAY, "macro")
async def get_fx_rates(currency: str = "USD") -> dict:
    """TCMB gösterge döviz kuru (1 birim, alış/satış) + son ~1 ayın günlük bülten kapanışları."""
    code = (currency or "").strip().upper()
    try:
        if not _CURRENCY_RE.fullmatch(code):
            raise InvalidInputError("Geçersiz döviz kodu. 3 harfli ISO kodu kullanın (örn. USD, EUR).")
        if code == "TRY":
            raise InvalidInputError("TRY için kur sorgulanamaz; başka bir döviz kodu kullanın.")
    except MarketDataError as e:
        return {"currency": code, "info": {}, "history": [], **error_payload(e, _MSG_FX)}
    try:
        bulletins = await _get_tcmb_fx_bulletins()
    except Exception as e:
        logger.warning("macro_fx_tcmb_unreachable", currency=code, error=f"{type(e).__name__}: {e}")
        return await _get_fx_rates_fallback(code)
    try:
        return _fx_payload(code, bulletins)
    except Exception as e:
        return _failure(e, _MSG_FX, "macro_fx_error", currency=code, info={}, history=[])


# Bulletin table order: the most-followed currencies first, the rest alphabetically.
_BULLETIN_PRIORITY = ("USD", "EUR", "GBP", "CHF", "JPY", "CNY", "RUB", "SAR", "AUD", "CAD")


async def _previous_bulletin(current_date: date) -> dict | None:
    """The last bulletin published before ``current_date`` (weekends/holidays skipped, ≤ 7 days back)."""
    for offset in range(1, 8):
        day = (current_date - timedelta(days=offset)).isoformat()
        try:
            bulletin = await _get_tcmb_fx_archive(day)
        except Exception as e:
            logger.info("macro_fx_archive_unavailable", day=day, error=type(e).__name__)
            return None
        if bulletin.get("rates"):
            return bulletin
    return None


def _bulletin_payload(current: Mapping[str, Any], previous: Mapping[str, Any] | None) -> dict:
    previous_rates = (previous or {}).get("rates") or {}
    rows = []
    for code, rate in (current.get("rates") or {}).items():
        selling = rate.get("forex_selling")
        previous_selling = (previous_rates.get(code) or {}).get("forex_selling")
        change_percent = None
        if selling is not None and previous_selling:
            change_percent = round((selling - previous_selling) / previous_selling * 100, 4)
        rows.append({**rate, "previous_selling": previous_selling, "change_percent": change_percent})
    if not rows:
        raise MarketDataError(_MSG_FX, status_code=502)
    rank = {code: index for index, code in enumerate(_BULLETIN_PRIORITY)}
    rows.sort(key=lambda row: (rank.get(row["currency"], len(rank)), row["currency"]))
    return {
        "source": "TCMB",
        "source_url": TCMB_FX_PAGE_URL,
        "date": current["date"],
        "previous_date": previous.get("date") if previous else None,
        "rates": rows,
    }


async def get_fx_bulletin() -> dict:
    """TCMB gösterge niteliğindeki günlük kur bülteni: tüm dövizler (1 birime normalize) + önceki bültene göre değişim."""
    try:
        current = await _get_tcmb_fx_today()
        previous = await _previous_bulletin(date.fromisoformat(current["date"]))
        return _bulletin_payload(current, previous)
    except Exception as e:
        return _failure(e, _MSG_FX, "macro_fx_bulletin_error", source="TCMB", rates=[])
