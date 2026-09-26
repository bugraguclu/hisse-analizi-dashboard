"""TCMB source adapter for the macro store — full-history rate tables, CPI/PPI
tables and the daily FX bulletin (``today.xml`` + archive).

This module is independent from :mod:`src.adapters.macro` (owned by another
session on this branch): that module fetches a single "latest" snapshot per
call and is used unchanged for the live API/store-first fallback path. This
module fetches *full history* in one request per page/currency-set — the
source the macro store's ingestion worker (:mod:`src.workers.macro_worker`,
via :mod:`src.services.macro_service`) upserts into ``macro_series`` /
``fx_bulletins``.

Verified live on 2026-09-23 (see the WS4 report for details):

- The three rate-history pages (policy / overnight / late_liquidity) list
  rows **oldest first** (ascending by date) — the *last* row is the current
  rate. This is the opposite of what ``borsapy``'s ``TCMBRatesProvider``
  shortcuts assume (they read ``data[0]``), which is the documented "2010
  row" bug (see ``docs/data-platform.md`` §2). ``borsapy``'s ``TCMB().history()``
  itself sorts ascending and is safe; only its ``policy_rate``/``rates``
  shortcut properties are affected.
- A rate of ``0.00`` (or ``"-"``) means the facility does not apply on that
  date (e.g. the late liquidity window's borrowing leg), never a real 0%
  rate — callers must drop it, not store a fabricated zero.
- The CPI (TÜFE) table is a clean 3-column table, newest first.
- The PPI page carries **two** producer-price series side by side — the
  discontinued classic "ÜFE" (through 2013-12) and its replacement
  "Yİ-ÜFE" (from 2014-01) — in a two-row header, 5 data columns
  (Ay-Yıl, ÜFE yoy, Yİ-ÜFE yoy, ÜFE mom, Yİ-ÜFE mom). The cut-over is
  clean (no month has both populated), so :func:`parse_ppi_table` coalesces
  them into one continuous series.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any
from xml.etree import ElementTree

import structlog
from bs4 import BeautifulSoup

from src.adapters.utils import MarketDataError, get_http_client

logger = structlog.get_logger(__name__)

RATE_PAGE_URLS: dict[str, str] = {
    "policy": (
        "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/"
        "Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/1+Hafta+Repo"
    ),
    "overnight": (
        "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/"
        "Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/faiz-oranlari"
    ),
    "late_liquidity": (
        "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Temel+Faaliyetler/"
        "Para+Politikasi/Merkez+Bankasi+Faiz+Oranlari/Gec+Likidite+Penceresi+%28LON%29"
    ),
}
CPI_PAGE_URL = "https://www.tcmb.gov.tr/wps/wcm/connect/tr/tcmb+tr/main+menu/istatistikler/enflasyon+verileri"
PPI_PAGE_URL = (
    "https://www.tcmb.gov.tr/wps/wcm/connect/TR/TCMB+TR/Main+Menu/Istatistikler/"
    "Enflasyon+Verileri/Uretici+Fiyatlari"
)
FX_TODAY_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"

_FX_ARCHIVE_DEFAULT_CONCURRENCY = 6
_YM_RE = re.compile(r"^(\d{1,2})-(\d{4})$")


def fx_archive_url(day: date) -> str:
    return f"https://www.tcmb.gov.tr/kurlar/{day:%Y%m}/{day:%d%m%Y}.xml"


@dataclass(frozen=True)
class RateObservation:
    observation_date: date
    borrowing: Decimal | None
    lending: Decimal | None


@dataclass(frozen=True)
class InflationObservation:
    observation_date: date  # first day of the reported month
    year_month: str  # "MM-YYYY", as printed on the page
    yoy: Decimal | None
    mom: Decimal | None


@dataclass(frozen=True)
class FxBulletinData:
    bulletin_date: date
    rates: dict[str, dict[str, Any]]  # currency -> {name, quoted_unit, forex_buying, forex_selling, banknote_buying, banknote_selling}


# ---------------------------------------------------------------------------
# Parsing (no network — unit-tested directly)
# ---------------------------------------------------------------------------

def _parse_decimal(text: str | None) -> Decimal | None:
    """Turkish or plain decimal number; ``""``/``"-"``/unparsable -> ``None``."""
    if text is None:
        return None
    cleaned = text.strip().replace("\xa0", "")
    if not cleaned or cleaned in ("-", "—", "–"):
        return None
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    try:
        return Decimal(cleaned)
    except InvalidOperation:
        return None


def _parse_tcmb_date(text: str | None) -> date | None:
    """``"23.01.2026"`` or ``"23.01.26"`` -> :class:`date`."""
    if not text:
        return None
    cleaned = text.strip()
    parts = cleaned.split(".")
    if len(parts) != 3:
        return None
    fmt = "%d.%m.%y" if len(parts[-1]) == 2 else "%d.%m.%Y"
    try:
        return datetime.strptime(cleaned, fmt).date()
    except ValueError:
        return None


def _parse_year_month(text: str) -> date | None:
    """``"08-2026"`` -> ``date(2026, 8, 1)``."""
    match = _YM_RE.match(text.strip())
    if not match:
        return None
    month, year = int(match.group(1)), int(match.group(2))
    if not 1 <= month <= 12:
        return None
    try:
        return date(year, month, 1)
    except ValueError:
        return None


def parse_rate_table(html: str) -> list[RateObservation]:
    """Parse a TCMB rate-history page. Rows are oldest -> newest (see module docstring)."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return []
    out: list[RateObservation] = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 3:
            continue
        day = _parse_tcmb_date(cols[0].get_text())
        if day is None:
            continue
        out.append(
            RateObservation(
                observation_date=day,
                borrowing=_parse_decimal(cols[1].get_text()),
                lending=_parse_decimal(cols[2].get_text()),
            )
        )
    return out


def parse_cpi_table(html: str) -> list[InflationObservation]:
    """Parse the TÜFE table (3 columns, newest first)."""
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return []
    out: list[InflationObservation] = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 3:
            continue
        year_month = cols[0].get_text(strip=True)
        day = _parse_year_month(year_month)
        if day is None:
            continue
        out.append(
            InflationObservation(
                observation_date=day,
                year_month=year_month,
                yoy=_parse_decimal(cols[1].get_text()),
                mom=_parse_decimal(cols[2].get_text()),
            )
        )
    return out


def parse_ppi_table(html: str) -> list[InflationObservation]:
    """Parse the ÜFE page: coalesces the classic ÜFE and Yİ-ÜFE columns (see module docstring).

    Header spans two ``<tr>`` rows (colspan); data rows normally have 5 columns
    (Ay-Yıl, ÜFE yoy, Yİ-ÜFE yoy, ÜFE mom, Yİ-ÜFE mom). Falls back to a plain
    3-column reading if TCMB ever simplifies the table.
    """
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table")
    if table is None:
        return []
    rows = table.find_all("tr")
    data_rows = rows[2:] if len(rows) >= 2 and _is_ppi_subheader(rows[1]) else rows[1:]
    out: list[InflationObservation] = []
    for row in data_rows:
        cols = row.find_all("td")
        if len(cols) >= 5:
            year_month = cols[0].get_text(strip=True)
            day = _parse_year_month(year_month)
            if day is None:
                continue
            classic_yoy = _parse_decimal(cols[1].get_text())
            yoy = classic_yoy if classic_yoy is not None else _parse_decimal(cols[2].get_text())
            classic_mom = _parse_decimal(cols[3].get_text())
            mom = classic_mom if classic_mom is not None else _parse_decimal(cols[4].get_text())
            out.append(InflationObservation(day, year_month, yoy, mom))
        elif len(cols) >= 3:
            year_month = cols[0].get_text(strip=True)
            day = _parse_year_month(year_month)
            if day is None:
                continue
            out.append(
                InflationObservation(
                    day, year_month, _parse_decimal(cols[1].get_text()), _parse_decimal(cols[2].get_text())
                )
            )
    return out


def _is_ppi_subheader(row: Any) -> bool:
    """True when ``row`` is the ÜFE page's second header row (empty first cell, "ÜFE"/"Yİ-ÜFE" labels)."""
    cells = [c.get_text(strip=True) for c in row.find_all("td")]
    return bool(cells) and cells[0] == "" and any("ÜFE" in c for c in cells[1:])


def parse_fx_bulletin_xml(xml_text: str) -> FxBulletinData:
    """Parse a TCMB daily bulletin (``today.xml`` / archive), normalised to 1 currency unit."""
    root = ElementTree.fromstring(xml_text)
    raw_date = root.attrib.get("Tarih") or root.attrib.get("Date")
    bulletin_date: date | None = None
    for fmt in ("%d.%m.%Y", "%m/%d/%Y"):
        try:
            bulletin_date = datetime.strptime(raw_date or "", fmt).date()
            break
        except ValueError:
            continue
    if bulletin_date is None:
        raise MarketDataError("TCMB kur bülteni tarihi okunamadı", status_code=502)

    rates: dict[str, dict[str, Any]] = {}
    for node in root.findall("Currency"):
        code = (node.attrib.get("CurrencyCode") or node.attrib.get("Kod") or "").strip().upper()
        if not code:
            continue
        unit_text = (node.findtext("Unit") or "1").strip()
        try:
            unit = int(unit_text)
        except ValueError:
            unit = 1
        divisor = unit if unit > 0 else 1

        def _num(tag: str, _node: ElementTree.Element = node, _divisor: int = divisor) -> Decimal | None:
            value = _parse_decimal(_node.findtext(tag))
            if value is None:
                return None
            value = value / _divisor
            return value if value > 0 else None

        rates[code] = {
            "name": (node.findtext("CurrencyName") or node.findtext("Isim") or code).strip(),
            "quoted_unit": unit,
            "forex_buying": _num("ForexBuying"),
            "forex_selling": _num("ForexSelling"),
            "banknote_buying": _num("BanknoteBuying"),
            "banknote_selling": _num("BanknoteSelling"),
        }
    return FxBulletinData(bulletin_date=bulletin_date, rates=rates)


# ---------------------------------------------------------------------------
# Fetchers (network)
# ---------------------------------------------------------------------------

async def fetch_rate_history(rate_type: str) -> list[RateObservation]:
    url = RATE_PAGE_URLS.get(rate_type)
    if url is None:
        raise ValueError(f"unknown rate_type: {rate_type!r} (expected one of {list(RATE_PAGE_URLS)})")
    response = await get_http_client().get(url)
    response.raise_for_status()
    rows = parse_rate_table(response.text)
    if not rows:
        raise MarketDataError(f"TCMB {rate_type} faiz tablosu boş", status_code=502)
    return rows


async def fetch_cpi_history() -> list[InflationObservation]:
    response = await get_http_client().get(CPI_PAGE_URL)
    response.raise_for_status()
    rows = parse_cpi_table(response.text)
    if not rows:
        raise MarketDataError("TÜFE tablosu boş", status_code=502)
    return rows


async def fetch_ppi_history() -> list[InflationObservation]:
    response = await get_http_client().get(PPI_PAGE_URL)
    response.raise_for_status()
    rows = parse_ppi_table(response.text)
    if not rows:
        raise MarketDataError("ÜFE tablosu boş", status_code=502)
    return rows


async def fetch_fx_bulletin(day: date | None = None) -> FxBulletinData | None:
    """Bulletin for ``day`` (``None`` = today's ``today.xml``). ``None`` on a 404
    (weekend/holiday — TCMB publishes no bulletin; never fabricate one)."""
    url = FX_TODAY_URL if day is None else fx_archive_url(day)
    response = await get_http_client().get(url)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return parse_fx_bulletin_xml(response.text)


async def fetch_fx_backfill(
    days: int, *, concurrency: int = _FX_ARCHIVE_DEFAULT_CONCURRENCY
) -> list[FxBulletinData]:
    """Today's bulletin plus up to ``days`` calendar days of history, ascending.

    Only weekday archive URLs are requested (TCMB never publishes on
    Sat/Sun); a 404 (public holiday) is skipped, not fabricated.
    """
    current = await fetch_fx_bulletin(None)
    if current is None:
        raise MarketDataError("TCMB güncel kur bülteni alınamadı", status_code=502)

    candidates = [
        current.bulletin_date - timedelta(days=offset)
        for offset in range(1, days + 1)
        if (current.bulletin_date - timedelta(days=offset)).weekday() < 5
    ]
    semaphore = asyncio.Semaphore(max(1, concurrency))

    async def _one(day: date) -> FxBulletinData | None:
        async with semaphore:
            try:
                return await fetch_fx_bulletin(day)
            except Exception as e:
                logger.info("tcmb_fx_archive_unavailable", day=day.isoformat(), error=f"{type(e).__name__}: {e}")
                return None

    results = await asyncio.gather(*(_one(day) for day in candidates))
    by_date: dict[date, FxBulletinData] = {b.bulletin_date: b for b in results if b is not None and b.rates}
    by_date[current.bulletin_date] = current
    return sorted(by_date.values(), key=lambda b: b.bulletin_date)
